import os
import json
import logging
import re
from datetime import datetime, timedelta
from time import perf_counter
from typing import Any, List
from uuid import uuid4
from fastapi import APIRouter, UploadFile, File, HTTPException, Depends, Query, Request
import base64
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy import func, select

from sqlalchemy.ext.asyncio import AsyncSession

from models.tribology import TribologyData, ChatRequest, LiteratureMetadata
from models.db_models import (
    DiffusionCandidate,
    DiffusionRecord,
    ExtractionRun,
    FigureCropOverride,
    Literature,
    RecordCandidate,
    TribologyData as TribologyDataDB,
)
from services.llm_service import llm_service
from services.data_sync_service import get_records_by_literature
from services.literature_chat_service import (
    build_literature_chat_context,
    build_retrieval_fallback_answer,
    retrieve_literature_chat_sources,
)
from database import get_db
from security import (
    AuthPrincipal,
    RequestScope,
    ensure_scope_writable,
    get_current_principal,
    get_request_scope,
    is_admin,
    literature_scope_conditions,
    require_candidate_access,
    require_diffusion_candidate_access,
    require_diffusion_record_access,
    require_literature_access,
    require_record_access,
    scope_filters,
)
from services.file_service import (
    _count_cached_record_artifacts,
    _derive_speed_conditions_from_pdf_scan_context,
    _derived_speed_grounding_note,
    _derived_speed_locator_text,
    _extract_field_quote_from_bbox,
    _field_location_match_is_reliable,
    _is_default_temperature_value,
    _is_derived_speed_conditions,
    _locate_field_evidence_for_value,
    _normalize_legacy_no_data_state,
    _refine_potential_evidence_from_metric_context_with_pdf,
    _speed_conditions_for_field_evidence,
    _temperature_default_evidence_entry,
    _text_explicitly_matches_field_value,
    InvalidUploadError,
    save_upload_entry,
)
from services.extraction_queue_service import get_extraction_queue
from services.extraction_trace_service import (
    CANCELLED_EXTRACTION_MESSAGE,
    cancel_latest_extraction_run,
    compute_extraction_progress_percent,
    finalize_extraction_run,
    get_extraction_run,
    list_extraction_candidates,
)
from services.extraction_trace_service import get_latest_extraction_run_by_literature
from services.diffusion.diffusion_postprocess_service import (
    build_diffusion_normalization_payload,
    build_diffusion_standard_fields,
    diffusion_normalization_blockers,
    serialize_diffusion_row_for_response,
)
from services.agent_runtime_service import get_agent_runtime
from services.activity_logging_service import log_activity
from services.candidate_promotion_service import (
    promote_diffusion_candidate,
    promote_tribology_candidate,
)
from services.record_correction_service import apply_tribology_candidate_correction
from services.score_service import calculate_confidence_details
from services.tribology_review_quality import (
    annotate_tribology_payload_quality,
    deduplicate_tribology_payloads,
    field_grounding_status,
    tribology_payload_dedupe_key,
)
from services.pdf_service import (
    build_term_query_variants as _build_term_query_variants,
    build_visual_focus_queries as _build_visual_focus_queries,
    extract_numeric_values as _extract_numeric_values,
    extract_panel_letter as _extract_panel_letter,
    extract_text_snippet as _extract_text_snippet,
    normalize_term_key as _normalize_term_key,
    numeric_term_matches as _numeric_term_matches,
    pick_visual_source_label as _pick_visual_source_label,
    resolve_existing_path as _resolve_existing_path,
    tighten_table_bbox_by_row as _tighten_table_bbox_by_row,
    tighten_visual_bbox_by_panel as _tighten_visual_bbox_by_panel,
    visual_hit_prefers_figure_preview as _visual_hit_prefers_figure_preview,
)
from utils.cof_extraction import (
    cof_average_from_extracted,
    derive_cof_extracted,
    normalize_cof_extracted,
    serialize_cof_extracted,
)
from utils.lubricant_mixture import (
    compact_lubricant_label,
    components_for_record,
    format_lubricant_tooltip,
)
from utils.tribopair import composite_roughness_label
from utils.structured_conditions import (
    derive_load_conditions,
    derive_tribological_system,
    normalize_load_conditions,
    normalize_tribological_system,
    serialize_load_conditions,
    serialize_tribological_system,
)
from utils.speed_conditions import (
    normalize_speed_conditions,
    serialize_speed_conditions,
    speed_value_from_conditions,
)

router = APIRouter(prefix="/api", tags=["extraction"])
logger = logging.getLogger(__name__)

_FIELD_KEY_ALIASES = {
    "ionic-liquid": "ionic_liquid",
    "load_value": "load",
    "loadvalue": "load",
    "load_raw": "load",
    "loadraw": "load",
    "normal_load": "load",
    "normalload": "load",
    "source-page": "source_page",
    "voltage": "potential",
}
_TRIBOLOGY_PRIMARY_METRIC_KEYS = (
    "cof",
    "friction_force",
    "wear_rate",
    "film_thickness",
    "residual_film_thickness_d",
    "layer_spacing_delta",
    "surface_roughness",
)


def _merge_figure_preview_segments(
    segments: list[tuple[int, int, int]],
    scale: float,
) -> tuple[int, int] | None:
    if not segments:
        return None
    max_gap = int(42 * scale)
    start, end, _ink = segments[-1]
    for prev_start, prev_end, _prev_ink in reversed(segments[:-1]):
        if start - prev_end > max_gap:
            break
        start = min(start, prev_start)
    return start, end


def _prefer_visual_figure_preview_clip(
    image_clip: tuple[float, float, float, float],
    visual_clip: tuple[float, float, float, float],
) -> bool:
    image_x0, image_y0, image_x1, image_y1 = image_clip
    visual_x0, visual_y0, visual_x1, visual_y1 = visual_clip
    image_width = max(1.0, image_x1 - image_x0)
    image_height = max(1.0, image_y1 - image_y0)
    visual_width = max(1.0, visual_x1 - visual_x0)
    visual_height = max(1.0, visual_y1 - visual_y0)

    extra_top = image_y0 - visual_y0
    extends_top = extra_top >= 24.0
    top_extension_is_reasonable = extra_top <= max(125.0, image_height * 0.45)
    remains_local = (
        visual_height <= max(image_height * 1.5, image_height + 150.0)
        and visual_width <= max(image_width * 1.6, image_width + 120.0)
    )
    overlaps_image = (
        min(image_x1, visual_x1) - max(image_x0, visual_x0) > image_width * 0.45
        and min(image_y1, visual_y1) - max(image_y0, visual_y0) > image_height * 0.35
    )
    return extends_top and top_extension_is_reasonable and remains_local and overlaps_image


_PDF_CAPTION_REFERENCE_START_WORDS = {
    "show",
    "shows",
    "showed",
    "shown",
    "indicate",
    "indicates",
    "indicated",
    "illustrate",
    "illustrates",
    "illustrated",
    "demonstrate",
    "demonstrates",
    "demonstrated",
    "present",
    "presents",
    "presented",
    "plot",
    "plots",
    "plotted",
    "compare",
    "compares",
    "compared",
    "summarize",
    "summarizes",
    "summarized",
    "is",
    "are",
    "was",
    "were",
}


_PDF_CAPTION_START_PATTERN = re.compile(
    r"^\s*((?:fig(?:ure)?\.?|table)\s*(?:\d+[A-Za-z]?|[IVXLCDM]+))(?P<sep>[.:])?\s*(.*)",
    re.IGNORECASE,
)


def _is_probable_pdf_caption_remainder(remainder: str, *, has_separator: bool) -> bool:
    text = " ".join(str(remainder or "").split()).strip()
    if not text:
        return True
    if not has_separator and re.match(r"^[)\]\},;]", text):
        return False
    first_word = re.sub(r"[^A-Za-z]+", "", text.split()[0]).lower()
    if not has_separator and first_word in _PDF_CAPTION_REFERENCE_START_WORDS:
        return False
    return True


def _pdf_label_for_raw_caption(raw_label: str) -> str:
    normalized = raw_label.replace(".", " ")
    parts = [part for part in normalized.split() if part]
    if len(parts) < 2:
        return normalized.title()
    prefix = "Figure" if parts[0].lower().startswith("fig") else "Table"
    return f"{prefix} {parts[1]}"


def _match_pdf_caption_start(
    text: str,
    *,
    line_level: bool = False,
    has_nearby_visual: bool = True,
) -> dict[str, Any] | None:
    cleaned = " ".join(str(text or "").split()).strip()
    if not cleaned:
        return None
    match = _PDF_CAPTION_START_PATTERN.match(cleaned)
    if not match:
        return None
    if not _is_probable_pdf_caption_remainder(match.group(3), has_separator=bool(match.group("sep"))):
        return None
    raw_label = match.group(1)
    label = _pdf_label_for_raw_caption(raw_label)
    if line_level:
        # Line-level scanning is only a fallback for figure captions that were
        # merged into a larger PDF text block. Tables are too often referenced
        # inline as "Table II.", so keep table recovery on block-level captions.
        if label.lower().startswith("table"):
            return None
        if not has_nearby_visual:
            return None
    return {
        "label": label,
        "caption": cleaned,
        "raw_label": raw_label,
        "has_separator": bool(match.group("sep")),
    }


def _rect_tuple(value: Any) -> tuple[float, float, float, float]:
    if hasattr(value, "x0") and hasattr(value, "y0") and hasattr(value, "x1") and hasattr(value, "y1"):
        return (float(value.x0), float(value.y0), float(value.x1), float(value.y1))
    x0, y0, x1, y1 = value
    return (float(x0), float(y0), float(x1), float(y1))


def _rect_area(rect: tuple[float, float, float, float]) -> float:
    x0, y0, x1, y1 = rect
    return max(0.0, x1 - x0) * max(0.0, y1 - y0)


def _rect_intersection_area(
    first: tuple[float, float, float, float],
    second: tuple[float, float, float, float],
) -> float:
    x0 = max(first[0], second[0])
    y0 = max(first[1], second[1])
    x1 = min(first[2], second[2])
    y1 = min(first[3], second[3])
    return max(0.0, x1 - x0) * max(0.0, y1 - y0)


def _rect_contains_center(
    outer: tuple[float, float, float, float],
    inner: tuple[float, float, float, float],
) -> bool:
    x = (inner[0] + inner[2]) / 2
    y = (inner[1] + inner[3]) / 2
    return outer[0] <= x <= outer[2] and outer[1] <= y <= outer[3]


def _trim_pdf_table_preview_clip_at_body_text(
    caption_clip: tuple[float, float, float, float],
    table_clip: tuple[float, float, float, float],
    body_text_clips: list[tuple[float, float, float, float]],
) -> tuple[float, float, float, float]:
    caption = _rect_tuple(caption_clip)
    clip = _rect_tuple(table_clip)
    clip_height_below_caption = max(1.0, clip[3] - caption[3])
    lower_table_region_y = caption[3] + clip_height_below_caption * 0.55
    body_starts: list[float] = []
    for body in body_text_clips:
        rect = _rect_tuple(body)
        horizontal_overlap = max(0.0, min(rect[2], clip[2]) - max(rect[0], clip[0]))
        min_width = max(1.0, min(rect[2] - rect[0], clip[2] - clip[0]))
        if horizontal_overlap < min_width * 0.18:
            continue
        if rect[1] < lower_table_region_y or rect[1] >= clip[3] - 6:
            continue
        body_starts.append(rect[1])
    if not body_starts:
        return clip
    trimmed_y1 = min(clip[3], max(caption[3] + 70.0, min(body_starts) - 8.0))
    return (clip[0], clip[1], clip[2], round(trimmed_y1, 2))


def _score_pdf_figure_preview_candidate(
    page_clip: tuple[float, float, float, float],
    caption_clip: tuple[float, float, float, float],
    candidate: dict[str, Any],
    *,
    body_text_clips: list[tuple[float, float, float, float]] | None = None,
    other_caption_clips: list[tuple[float, float, float, float]] | None = None,
) -> dict[str, Any]:
    clip = _rect_tuple(candidate["clip"])
    body_text_clips = body_text_clips or []
    other_caption_clips = other_caption_clips or []

    page_area = max(1.0, _rect_area(page_clip))
    clip_area = max(1.0, _rect_area(clip))
    width = max(1.0, clip[2] - clip[0])
    height = max(1.0, clip[3] - clip[1])
    page_width = max(1.0, page_clip[2] - page_clip[0])
    page_height = max(1.0, page_clip[3] - page_clip[1])
    area_ratio = clip_area / page_area
    width_ratio = width / page_width
    height_ratio = height / page_height
    text_overlap_ratio = sum(_rect_intersection_area(clip, rect) for rect in body_text_clips) / clip_area
    neighbor_caption_count = sum(1 for rect in other_caption_clips if _rect_contains_center(clip, rect))

    flags: list[str] = []
    if area_ratio > 0.42 or height_ratio > 0.68 or (area_ratio > 0.34 and width_ratio > 0.82):
        flags.append("full_page_like")
    if text_overlap_ratio > 0.20:
        flags.append("body_text_overlap")
    if neighbor_caption_count:
        flags.append("neighbor_caption_inside")
    if clip_area / page_area < 0.012 or width < 70 or height < 45:
        flags.append("tiny_crop")
    if not _rect_contains_center(clip, caption_clip):
        flags.append("caption_outside")

    strategy = str(candidate.get("strategy") or "")
    strategy_bonus = {
        "visual_preferred": 22.0,
        "visual_segment": 12.0,
        "image_block": 8.0,
        "table_visual": 8.0,
        "drawing_or_image_fallback": 3.0,
        "table_text_fallback": -4.0,
        "fixed_height_fallback": -10.0,
    }.get(strategy, 0.0)
    score = 100.0 + strategy_bonus
    score -= min(90.0, text_overlap_ratio * 130.0)
    score -= neighbor_caption_count * 55.0
    if "full_page_like" in flags:
        score -= 70.0 + max(0.0, area_ratio - 0.42) * 80.0
    if "tiny_crop" in flags:
        score -= 50.0
    if "caption_outside" in flags:
        score -= 120.0
    if area_ratio > 0.30:
        score -= (area_ratio - 0.30) * 45.0
    if height_ratio > 0.56:
        score -= (height_ratio - 0.56) * 35.0
    if width_ratio > 0.92:
        score -= 8.0

    return {
        **candidate,
        "clip": clip,
        "flags": flags,
        "score": round(score, 4),
        "area_ratio": round(area_ratio, 4),
        "height_ratio": round(height_ratio, 4),
        "width_ratio": round(width_ratio, 4),
        "text_overlap_ratio": round(text_overlap_ratio, 4),
        "neighbor_caption_count": neighbor_caption_count,
    }


def _choose_pdf_figure_preview_candidate(
    page_clip: tuple[float, float, float, float],
    caption_clip: tuple[float, float, float, float],
    candidates: list[dict[str, Any]],
    *,
    body_text_clips: list[tuple[float, float, float, float]] | None = None,
    other_caption_clips: list[tuple[float, float, float, float]] | None = None,
) -> dict[str, Any]:
    if not candidates:
        raise ValueError("At least one figure preview candidate is required")
    scored = [
        _score_pdf_figure_preview_candidate(
            page_clip,
            caption_clip,
            candidate,
            body_text_clips=body_text_clips,
            other_caption_clips=other_caption_clips,
        )
        for candidate in candidates
    ]
    scored.sort(key=lambda item: (item["score"], -len(item["flags"])), reverse=True)
    return scored[0]


_FIGURE_CROP_ALGORITHM_VERSION = "pdf-visual-segmentation.v1"


def _normalize_figure_crop_label(value: Any) -> str:
    return re.sub(r"[^a-z0-9]+", "", str(value or "").strip().lower())


def _parse_bbox_json(value: Any) -> list[float] | None:
    if value is None:
        return None
    loaded = value
    if isinstance(value, str):
        text = value.strip()
        try:
            loaded = json.loads(text)
        except Exception:
            loaded = [part.strip() for part in text.split(",") if part.strip()]
    if not isinstance(loaded, list) or len(loaded) != 4:
        return None
    try:
        return [round(float(item), 2) for item in loaded]
    except (TypeError, ValueError):
        return None


def _bbox_json(value: list[float] | tuple[float, float, float, float]) -> str:
    bbox = _parse_bbox_json(list(value))
    if bbox is None:
        raise ValueError("Bounding box must contain four numeric values")
    return json.dumps(bbox)


def _figure_crop_override_key(label: Any, page: Any) -> tuple[str, int]:
    try:
        page_number = int(page)
    except (TypeError, ValueError):
        page_number = 0
    return (_normalize_figure_crop_label(label), page_number)


def _serialize_figure_crop_override(override: FigureCropOverride) -> dict[str, Any]:
    return {
        "id": override.id,
        "literature_id": override.literature_id,
        "label": override.label,
        "normalized_label": override.normalized_label,
        "page": override.page,
        "caption": override.caption,
        "bbox": _parse_bbox_json(override.bbox_json) or [],
        "algorithm_bbox": _parse_bbox_json(override.algorithm_bbox_json),
        "algorithm_version": override.algorithm_version,
        "created_by_user_id": override.created_by_user_id,
        "updated_by_user_id": override.updated_by_user_id,
        "created_at": override.created_at.isoformat() if override.created_at else None,
        "updated_at": override.updated_at.isoformat() if override.updated_at else None,
    }


def _apply_figure_crop_overrides_to_items(
    items: list[dict[str, Any]],
    overrides: list[FigureCropOverride],
) -> list[dict[str, Any]]:
    by_target = {
        _figure_crop_override_key(override.label, override.page): override
        for override in overrides
    }
    merged: list[dict[str, Any]] = []
    for item in items:
        algorithm_bbox = _parse_bbox_json(item.get("algorithm_bbox")) or _parse_bbox_json(item.get("clip_bbox"))
        next_item = {
            **item,
            "algorithm_bbox": algorithm_bbox,
            "has_override": False,
            "override_id": None,
        }
        override = by_target.get(_figure_crop_override_key(item.get("label"), item.get("page")))
        if override:
            override_bbox = _parse_bbox_json(override.bbox_json)
            if override_bbox:
                next_item["clip_bbox"] = override_bbox
                next_item["image_b64"] = override.preview_image_b64
                next_item["caption"] = override.caption or next_item.get("caption") or ""
                next_item["has_override"] = True
                next_item["override_id"] = override.id
                next_item["algorithm_version"] = override.algorithm_version
        merged.append(next_item)
    return merged


def _roman_numeral_value(value: str) -> int | None:
    roman = str(value or "").strip().upper()
    if not roman or not re.fullmatch(r"[IVXLCDM]+", roman):
        return None
    values = {"I": 1, "V": 5, "X": 10, "L": 50, "C": 100, "D": 500, "M": 1000}
    total = 0
    previous = 0
    for char in reversed(roman):
        current = values[char]
        if current < previous:
            total -= current
        else:
            total += current
            previous = current
    return total


def _figure_preview_label_sort_key(label: Any) -> tuple[int, int, str]:
    text = str(label or "").strip()
    match = re.match(r"^(figure|fig\.?|table|tab\.?)\s*([A-Za-z]?\d+|[IVXLCDM]+)", text, re.IGNORECASE)
    if not match:
        return (2, 10_000, text.lower())
    kind, number_text = match.groups()
    kind_priority = 0 if kind.lower().startswith(("fig", "figure")) else 1
    number_match = re.search(r"\d+", number_text)
    if number_match:
        number_value = int(number_match.group(0))
    else:
        number_value = _roman_numeral_value(number_text) or 10_000
    return (kind_priority, number_value, text.lower())


def _sort_pdf_figure_preview_items(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return sorted(
        items,
        key=lambda item: (
            *_figure_preview_label_sort_key(item.get("label")),
            int(item.get("page") or 0),
            str(item.get("id") or ""),
        ),
    )


def _build_diffusion_processing_summary(*, profile: str = "auto", message: str | None = None) -> dict[str, Any]:
    return _build_processing_summary(
        extractor_type="diffusion",
        profile=profile,
        message=message or "Diffusion extraction is running in the background.",
    )


def _parse_json_object(value: Any) -> dict[str, Any]:
    if not value:
        return {}
    if isinstance(value, dict):
        return value
    try:
        loaded = json.loads(value)
        return loaded if isinstance(loaded, dict) else {}
    except Exception:
        return {}


def _build_processing_summary(
    *,
    extractor_type: str,
    profile: str = "auto",
    message: str | None = None,
    run: Any | None = None,
) -> dict[str, Any]:
    summary = _parse_json_object(getattr(run, "summary_json", None))
    dropped_by_reason = _parse_json_object(getattr(run, "dropped_by_reason", None))
    page_coverage = _parse_json_object(getattr(run, "page_coverage", None))
    current_message = (
        message
        or summary.get("current_message")
        or f"{extractor_type.title()} extraction is running in the background."
    )
    progress_log = summary.get("progress_log")
    if not isinstance(progress_log, list) or not progress_log:
        progress_log = [{"stage": "stage_a.queued", "message": current_message}]

    current_stage = summary.get("current_stage") or "stage_a.queued"
    effective_page_coverage = page_coverage or summary.get("page_coverage") or {}
    page_candidate_counts = summary.get("page_candidate_counts") or {}
    progress_percent = summary.get("progress_percent")
    if not isinstance(progress_percent, (int, float)):
        progress_percent = compute_extraction_progress_percent(
            current_stage,
            page_coverage=effective_page_coverage,
            page_candidate_counts=page_candidate_counts,
        )

    return {
        "run_id": getattr(run, "run_id", None),
        "extractor_type": extractor_type,
        "profile": profile,
        "status": "processing",
        "candidate_count": int(getattr(run, "candidate_count", 0) or summary.get("candidate_count") or 0),
        "final_count": int(getattr(run, "final_count", 0) or summary.get("final_count") or 0),
        "dropped_by_reason": dropped_by_reason or summary.get("dropped_by_reason") or {"in_progress": 1},
        "page_coverage": effective_page_coverage,
        "page_candidate_counts": page_candidate_counts,
        "progress_log": progress_log,
        "current_stage": current_stage,
        "current_message": current_message,
        "progress_percent": int(progress_percent),
    }


async def _diffusion_can_resolve_inline(db: AsyncSession, literature_id: int, *, force: bool = False) -> bool:
    if force:
        return False
    candidate_count = (
        await db.execute(select(func.count(DiffusionCandidate.id)).where(DiffusionCandidate.literature_id == literature_id))
    ).scalar() or 0
    record_count = (
        await db.execute(select(func.count(DiffusionRecord.id)).where(DiffusionRecord.literature_id == literature_id))
    ).scalar() or 0
    if candidate_count or record_count:
        return True
    latest_run = await get_latest_extraction_run_by_literature(db, literature_id, extractor_type="diffusion")
    return bool(latest_run and str(latest_run.status or "").strip().lower() in {"running", "processing", "completed", "no_data"})


async def _cached_artifact_counts_for_extractor(
    db: AsyncSession,
    literature_id: int,
    extractor_type: str,
) -> tuple[int, int]:
    if extractor_type == "diffusion":
        candidate_count = (
            await db.execute(select(func.count(DiffusionCandidate.id)).where(DiffusionCandidate.literature_id == literature_id))
        ).scalar() or 0
        final_count = (
            await db.execute(select(func.count(DiffusionRecord.id)).where(DiffusionRecord.literature_id == literature_id))
        ).scalar() or 0
        return int(candidate_count), int(final_count)

    return await _count_cached_record_artifacts(db, literature_id)


async def _upload_status_for_extractor(db: AsyncSession, literature: Literature, extractor_type: str) -> str:
    """Return upload status for the selected extraction lane, not the shared literature row."""
    candidate_count, final_count = await _cached_artifact_counts_for_extractor(db, literature.id, extractor_type)
    if candidate_count or final_count:
        return "completed"

    latest_run = await get_latest_extraction_run_by_literature(db, literature.id, extractor_type=extractor_type)
    run_status = str(getattr(latest_run, "status", "") or "").strip().lower()
    if run_status in {"queued", "running", "processing", "extracting"}:
        return "processing"
    if run_status in {"completed", "success"}:
        return "completed"
    if run_status in {"no_data", "failed", "error", "cancelled"}:
        return run_status

    literature_status = str(literature.status or "").strip().lower()
    if latest_run and literature_status in {"queued", "extracting", "processing", "running"}:
        return "processing"
    if latest_run and literature_status in {"failed", "error", "cancelled"}:
        return literature_status

    # A literature-level terminal/active status may belong to the other extractor.
    return "pending"


async def _upload_cache_payload(db: AsyncSession, literature: Literature, extractor_type: str) -> dict[str, Any]:
    candidate_count, record_count = await _cached_artifact_counts_for_extractor(db, literature.id, extractor_type)
    cached_record_count = int(candidate_count or 0) + int(record_count or 0)
    return {
        "metadata": {
            "id": literature.id,
            "title": literature.title,
            "authors": literature.authors,
            "doi": literature.doi,
            "journal": literature.journal,
            "year": literature.year,
            "volume": literature.volume,
            "issue": literature.issue,
            "pages": literature.pages,
            "issn": literature.issn,
        },
        "record_count": int(record_count or 0),
        "candidate_count": int(candidate_count or 0),
        "cached_record_count": cached_record_count,
        "cache_hit": cached_record_count > 0,
    }


def _should_wait_for_fresh_extractor_run(
    literature_status: str | None,
    run_status: str | None,
    *,
    has_requested_run: bool = True,
) -> bool:
    active_literature_statuses = {"queued", "extracting", "processing", "running"}
    normalized_literature_status = str(literature_status or "").strip().lower()
    normalized_run_status = str(run_status or "").strip().lower()
    return has_requested_run and normalized_literature_status in active_literature_statuses and not normalized_run_status


def _no_data_message_for_run(
    *,
    literature_message: str | None = None,
    run_message: str | None = None,
    summary: dict[str, Any] | None = None,
    fallback: str = "No extractable records found",
) -> str:
    summary = summary or {}
    for value in (
        run_message,
        summary.get("no_data_reason"),
        summary.get("current_message"),
        literature_message,
        fallback,
    ):
        message = str(value or "").strip()
        if message:
            return message
    return fallback


def _normalize_field_key(field_key: str) -> str:
    key = str(field_key or "").strip().lower().replace(" ", "_")
    return _FIELD_KEY_ALIASES.get(key, key)


def _parse_field_evidence_map(raw: Any) -> dict[str, Any]:
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str):
        try:
            loaded = json.loads(raw)
            return loaded if isinstance(loaded, dict) else {}
        except Exception:
            return {}
    return {}


def _field_text(value: Any) -> str:
    return str(value or "").strip()


def _derived_speed_evidence_is_contextual(evidence: dict[str, Any]) -> bool:
    text = " ".join(
        _field_text(evidence.get(key))
        for key in ("quote", "matched_text", "matchedText")
    ).lower()
    has_scan_length = bool(re.search(r"scan\s*(?:size|length|range)|\b\d+(?:\.\d+)?\s*(?:nm|μm|um)\b", text))
    has_scan_rate = bool(re.search(r"scan\s*(?:rate|frequency)|\b\d+(?:\.\d+)?\s*hz\b", text))
    return bool(
        text
        and "scan" in text
        and has_scan_length
        and has_scan_rate
    )


def _entry_is_derived_speed_context(field_key: Any, entry: dict[str, Any], evidence: dict[str, Any]) -> bool:
    return (
        str(field_key or "").strip().lower() == "speed"
        and str(entry.get("grounding_mode") or "").strip().lower() == "derived"
        and _derived_speed_evidence_is_contextual(evidence)
    )


def _derived_speed_conditions_need_source_context(speed_conditions: dict[str, Any]) -> bool:
    normalized = normalize_speed_conditions(speed_conditions)
    return (
        _is_derived_speed_conditions(normalized)
        and not _derived_speed_evidence_is_contextual({"matched_text": normalized.get("raw_text")})
    )


def _enrich_derived_speed_conditions_from_pdf_context(
    speed_conditions: dict[str, Any],
    *,
    pdf_path: str | None,
    speed_value: Any,
) -> dict[str, Any]:
    if not pdf_path or not _derived_speed_conditions_need_source_context(speed_conditions):
        return speed_conditions
    pdf_speed_conditions = _derive_speed_conditions_from_pdf_scan_context(pdf_path, speed_value)
    if _is_derived_speed_conditions(pdf_speed_conditions):
        return pdf_speed_conditions
    return speed_conditions


def _apply_derived_speed_display_evidence(entry: dict[str, Any], speed_conditions: dict[str, Any]) -> dict[str, Any]:
    updated = dict(entry)
    evidence = dict(updated.get("evidence") or {})
    raw_text = _derived_speed_locator_text(speed_conditions)
    if raw_text and not _derived_speed_evidence_is_contextual(evidence):
        evidence = {
            **evidence,
            "source_type": "text",
            "page": speed_conditions.get("source_page") or evidence.get("page"),
            "source_label": speed_conditions.get("source_label") or evidence.get("source_label"),
            "bbox": None,
            "matched_text": raw_text,
            "quote": raw_text,
        }
    elif raw_text:
        evidence["quote"] = _field_text(evidence.get("quote")) or raw_text
        matched_text = _field_text(evidence.get("matched_text"))
        if not _derived_speed_evidence_is_contextual({"matched_text": matched_text}):
            matched_text = raw_text
            evidence["bbox"] = None
        evidence["matched_text"] = matched_text
    updated["evidence"] = evidence
    updated["grounding_mode"] = "derived"
    note = _derived_speed_grounding_note(speed_conditions)
    if note:
        updated["grounding_note"] = note
    derived_value = speed_value_from_conditions(speed_conditions)
    if derived_value:
        updated["value"] = derived_value
    return updated


def _component_field_key(component: dict[str, Any], index: int) -> str:
    compound = str(component.get("compound") or "").strip()
    slug = re.sub(r"[^a-z0-9]+", "_", compound.lower()).strip("_")
    return f"compound_{slug}" if slug else f"lubricant_component_{index}"


def _is_ionic_lubricant_component(component: dict[str, Any]) -> bool:
    role = str(component.get("role") or "").strip().lower()
    compound = str(component.get("compound") or "").strip()
    if "ionic" in role:
        return True
    if role in {"base_oil", "oil", "solvent", "compound"}:
        return False
    return bool(re.search(r"\[[^\]]+\]\s*\[[^\]]+\]", compound))


def _is_separate_lubricant_compound(component: dict[str, Any]) -> bool:
    role = str(component.get("role") or "").strip().lower()
    compound = str(component.get("compound") or "").strip().lower()
    if role in {"base_oil", "oil", "solvent", "compound"}:
        return True
    if compound in {"hexadecane", "degdbe", "pao", "peg"}:
        return True
    return not _is_ionic_lubricant_component(component)


def _component_field_value_from_record(record: Any, field_key: str) -> str | None:
    normalized_key = _normalize_field_key(field_key)
    for index, component in enumerate(components_for_record(record)):
        if normalized_key in {_component_field_key(component, index), f"lubricant_component_{index}"}:
            return str(component.get("compound") or "").strip() or None
    return None


def _component_field_entry_from_source(field_map: dict[str, Any], record: Any, field_key: str) -> dict[str, Any]:
    value = _component_field_value_from_record(record, field_key)
    if not value:
        return {}
    source_entry = next(
        (
            field_map.get(key)
            for key in ("mol_ratio", "ionic_liquid", "source")
            if isinstance(field_map.get(key), dict) and field_map.get(key)
        ),
        {},
    )
    if not isinstance(source_entry, dict) or not source_entry:
        return {"value": value, "confidence": getattr(record, "confidence", None)}
    entry = dict(source_entry)
    entry["value"] = value
    entry["confidence"] = entry.get("confidence", getattr(record, "confidence", None))
    entry.pop("review_state", None)
    entry.pop("review_note", None)
    return entry


def _field_value_from_record(record: Any, field_key: str) -> Any:
    if field_key.startswith("compound_") or field_key.startswith("lubricant_component_"):
        return _component_field_value_from_record(record, field_key)
    if field_key == "material":
        return record.material_name
    if field_key == "material_name":
        return record.material_name
    if field_key in {
        "probe_material",
        "probe_geometry",
        "probe_radius",
        "probe_roughness",
        "substrate_material",
        "substrate_coating",
        "substrate_roughness",
    }:
        return getattr(record, field_key, None)
    if field_key == "ionic_liquid":
        return record.lubricant
    if field_key == "cof":
        return record.cof_raw or record.cof_value
    if field_key == "friction_force":
        return getattr(record, "friction_force", None)
    if field_key == "wear_rate":
        return getattr(record, "wear_rate", None)
    if field_key == "film_thickness":
        return getattr(record, "film_thickness", None)
    if field_key == "residual_film_thickness_d":
        return getattr(record, "residual_film_thickness_d", None)
    if field_key == "layer_spacing_delta":
        return getattr(record, "layer_spacing_delta", None)
    if field_key == "regime":
        return getattr(record, "regime", None)
    if field_key == "surface_roughness":
        return getattr(record, "surface_roughness", None)
    if field_key == "load":
        return record.load_raw or record.load_value
    if field_key == "speed":
        return record.speed_value
    if field_key == "shear_rate":
        return getattr(record, "shear_rate", None)
    if field_key == "temperature":
        return record.temperature
    if field_key == "water_content":
        return getattr(record, "water_content", None)
    if field_key == "potential":
        return getattr(record, "potential", None)
    if field_key == "source_page":
        return f"Page {record.source_page}" if record.source_page else None
    return None


def _tribology_payload_has_value(value: Any) -> bool:
    if value in (None, "", []):
        return False
    if isinstance(value, dict):
        return any(_tribology_payload_has_value(item) for item in value.values())
    if isinstance(value, list):
        return any(_tribology_payload_has_value(item) for item in value)
    return str(value or "").strip().lower() not in _TRIBOLOGY_DEDUPE_EMPTY_VALUES


def _confidence_tier(score: Any) -> str:
    try:
        value = float(score)
    except Exception:
        value = 0.0
    if value >= 0.8:
        return "high"
    if value >= 0.6:
        return "medium"
    return "low"


def _tribology_missing_fields(payload: dict[str, Any]) -> list[str]:
    groups = {
        "ionic_liquid": ("ionic_liquid", "lubricant"),
        "material_name": ("material_name", "probe_material", "substrate_material"),
        "cof": ("cof", "cof_raw", "cof_extracted"),
        "normal_load": ("normal_load", "load"),
        "speed": ("speed",),
    }
    missing: list[str] = []
    for label, keys in groups.items():
        if not any(_tribology_payload_has_value(payload.get(key)) for key in keys):
            missing.append(label)
    return missing


def _quality_notes_for_payload(payload: dict[str, Any], missing: list[str]) -> str | None:
    existing = str(payload.get("assembly_notes") or "").strip()
    if existing:
        return existing
    if payload.get("record_origin") != "weak_candidate":
        return None
    if not missing:
        return "Weak candidate is ready for review."
    labels = {
        "ionic_liquid": "ionic liquid",
        "material_name": "material",
        "cof": "COF",
        "normal_load": "load",
        "speed": "sliding speed",
    }
    readable = [labels.get(field, field) for field in missing]
    if len(readable) == 1:
        missing_text = readable[0]
    else:
        missing_text = ", ".join(readable[:-1]) + f" and {readable[-1]}"
    return f"Candidate needs review because {missing_text} were not confirmed."


def _tribology_record_api_payload(record: Any) -> dict[str, Any]:
    """Serialize candidate/final ORM records into the public TribologyData shape."""
    cof_raw = getattr(record, "cof_raw", None)
    cof_value = getattr(record, "cof_value", None)
    load_raw = getattr(record, "load_raw", None)
    load_value = getattr(record, "load_value", None)
    speed_value = getattr(record, "speed_value", None)
    field_evidence = _parse_field_evidence_map(getattr(record, "field_evidence_json", None))
    record_id = getattr(record, "id", None)
    review_entity_type = "candidate" if isinstance(record, RecordCandidate) else "record"
    lubricant = getattr(record, "lubricant", None)
    lubricant_components = components_for_record(record)
    lubricant_alias = getattr(record, "lubricant_alias", None)
    cof_extracted = normalize_cof_extracted(getattr(record, "cof_extracted_json", None)) or derive_cof_extracted(
        cof_raw,
        cof_value,
        load=load_raw or load_value,
        speed=speed_value,
    )
    load_conditions = normalize_load_conditions(getattr(record, "load_conditions_json", None)) or derive_load_conditions(
        load_raw or load_value,
    )
    speed_conditions = normalize_speed_conditions(getattr(record, "speed_conditions_json", None)) or _speed_conditions_for_field_evidence(
        {
            "speed": speed_value,
            "speed_value": speed_value,
            "evidence": getattr(record, "evidence", None),
            "source": getattr(record, "source", None),
            "source_figure": getattr(record, "source_figure", None),
        },
        record,
    )
    speed_conditions = _enrich_derived_speed_conditions_from_pdf_context(
        speed_conditions,
        pdf_path=getattr(getattr(record, "literature", None), "file_path", None),
        speed_value=speed_value,
    )
    if _is_derived_speed_conditions(speed_conditions):
        existing_speed_entry = field_evidence.get("speed") if isinstance(field_evidence.get("speed"), dict) else {}
        field_evidence["speed"] = _apply_derived_speed_display_evidence(existing_speed_entry, speed_conditions)
    tribological_system = normalize_tribological_system(getattr(record, "tribological_system_json", None)) or derive_tribological_system(
        getattr(record, "regime", None),
    )

    payload = {
        "id": str(record_id) if record_id is not None else None,
        "material_name": getattr(record, "material_name", "") or "",
        "ionic_liquid": lubricant,
        "lubricant": lubricant,
        "lubricant_components": lubricant_components,
        "lubricant_alias": lubricant_alias,
        "ionic_liquid_display": compact_lubricant_label(lubricant, lubricant_components, lubricant_alias),
        "lubricant_tooltip": format_lubricant_tooltip(lubricant, lubricant_components, lubricant_alias),
        "load": load_raw or load_value,
        "load_conditions": load_conditions,
        "speed": speed_value,
        "speed_conditions": speed_conditions,
        "shear_rate": getattr(record, "shear_rate", None),
        "temperature": getattr(record, "temperature", None),
        "cof": cof_raw or (str(cof_value) if cof_value is not None else None),
        "cof_value": cof_value,
        "cof_raw": cof_raw,
        "cof_operator": getattr(record, "cof_operator", None),
        "cof_extracted": cof_extracted,
        "friction_force": getattr(record, "friction_force", None),
        "normal_load": getattr(record, "normal_load", None),
        "wear_rate": getattr(record, "wear_rate", None),
        "test_duration": getattr(record, "test_duration", None),
        "contact_type": getattr(record, "contact_type", None),
        "potential": getattr(record, "potential", None),
        "water_content": getattr(record, "water_content", None),
        "probe_material": getattr(record, "probe_material", None),
        "probe_geometry": getattr(record, "probe_geometry", None),
        "probe_radius": getattr(record, "probe_radius", None),
        "probe_roughness": getattr(record, "probe_roughness", None),
        "substrate_material": getattr(record, "substrate_material", None),
        "substrate_coating": getattr(record, "substrate_coating", None),
        "substrate_roughness": getattr(record, "substrate_roughness", None),
        "surface_roughness": composite_roughness_label(
            getattr(record, "probe_roughness", None),
            getattr(record, "substrate_roughness", None),
            method="rms",
            legacy_surface_roughness=getattr(record, "surface_roughness", None),
        ),
        "residual_film_thickness_d": getattr(record, "residual_film_thickness_d", None),
        "layer_spacing_delta": getattr(record, "layer_spacing_delta", None),
        "film_thickness": getattr(record, "film_thickness", None),
        "regime": getattr(record, "regime", None),
        "tribological_system": tribological_system,
        "mol_ratio": getattr(record, "mol_ratio", None),
        "cation": getattr(record, "cation", None),
        "anion": getattr(record, "anion", None),
        "cation_smiles": getattr(record, "cation_smiles", None),
        "anion_smiles": getattr(record, "anion_smiles", None),
        "il_smiles": getattr(record, "il_smiles", None),
        "il_inchikey": getattr(record, "il_inchikey", None),
        "alkyl_chain_length": getattr(record, "alkyl_chain_length", None),
        "source": getattr(record, "source", None),
        "notes": getattr(record, "notes", None),
        "value_origin": getattr(record, "value_origin", None),
        "evidence": getattr(record, "evidence", None),
        "source_page": getattr(record, "source_page", None),
        "source_figure": getattr(record, "source_figure", None),
        "sample_id": getattr(record, "sample_id", None),
        "series_id": getattr(record, "series_id", None),
        "field_evidence_json": field_evidence,
        "confidence": getattr(record, "confidence", None),
        "review_status": getattr(record, "review_status", None),
        "record_origin": getattr(record, "record_origin", None),
        "review_entity_type": review_entity_type,
        "assembly_notes": getattr(record, "assembly_notes", None),
    }
    missing_fields = _tribology_missing_fields(payload)
    is_weak_candidate = payload.get("record_origin") == "weak_candidate"
    confidence_tier = "low" if is_weak_candidate else _confidence_tier(payload.get("confidence"))
    admission_reason = "weak_candidate" if is_weak_candidate else "strict_validated"
    quality_notes = _quality_notes_for_payload(payload, missing_fields)
    source_label = payload.get("source_figure") or payload.get("source")
    source_payload = {
        "page": payload.get("source_page"),
        "label": source_label,
        "source_type": "text",
    }
    fields_payload = {
        "ionic_liquid": payload.get("ionic_liquid"),
        "material_name": payload.get("material_name"),
        "cof": payload.get("cof"),
        "normal_load": payload.get("normal_load") or payload.get("load"),
        "speed": payload.get("speed"),
        "temperature": payload.get("temperature"),
        "evidence": payload.get("evidence"),
    }
    payload.update(
        {
            "entity_type": review_entity_type,
            "entity_id": record_id,
            "entityType": review_entity_type,
            "entityId": record_id,
            "confidence_tier": confidence_tier,
            "confidenceTier": confidence_tier,
            "admission_reason": admission_reason,
            "admissionReason": admission_reason,
            "missing_fields": missing_fields,
            "missingFields": missing_fields,
            "quality_notes": quality_notes,
            "qualityNotes": quality_notes,
            "fields": fields_payload,
            "display_source": source_payload,
            "displaySource": source_payload,
            "source_label": source_label,
            "sourceLabel": source_label,
        }
    )
    return annotate_tribology_payload_quality(payload)


def _field_grounding_status(entry: dict[str, Any]) -> str:
    return field_grounding_status(entry)


_TRIBOLOGY_DEDUPE_EMPTY_VALUES = {
    "",
    "-",
    "--",
    "n/a",
    "na",
    "none",
    "null",
    "not specified",
    "unspecified",
    "unknown",
    "probe n/a",
    "substrate n/a",
}


def _normalize_tribology_dedupe_text(value: Any) -> str:
    text = re.sub(r"\s+", " ", str(value or "").strip()).lower()
    if text in _TRIBOLOGY_DEDUPE_EMPTY_VALUES:
        return ""
    return re.sub(r"[^a-z0-9.+-]+", "", text)


def _normalize_tribology_dedupe_number(value: Any) -> str:
    if value in (None, ""):
        return ""
    match = re.search(r"-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?", str(value))
    if not match:
        return _normalize_tribology_dedupe_text(value)
    try:
        return f"{float(match.group(0)):.8g}"
    except Exception:
        return _normalize_tribology_dedupe_text(value)


def _tribology_payload_dedupe_key(row: dict[str, Any]) -> tuple[str, ...]:
    return tribology_payload_dedupe_key(row)


def _deduplicate_tribology_payloads(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return deduplicate_tribology_payloads(rows)


def _build_conditions_entry(field_map: dict[str, Any], record: Any) -> dict[str, Any]:
    condition_values = [
        value
        for value in (
            getattr(record, "regime", None),
            record.load_raw or record.load_value,
            record.speed_value,
            getattr(record, "shear_rate", None),
            record.temperature,
            getattr(record, "potential", None),
            getattr(record, "water_content", None),
        )
        if value
    ]
    primary_entry = next(
        (
            field_map.get(key)
            for key in ("regime", "load", "speed", "shear_rate", "temperature", "potential", "water_content")
            if isinstance(field_map.get(key), dict) and field_map.get(key)
        ),
        {},
    )
    return {
        "value": " | ".join(str(value) for value in condition_values) if condition_values else None,
        "confidence": primary_entry.get("confidence"),
        "evidence": primary_entry.get("evidence"),
        "status": _field_grounding_status(primary_entry),
        "grounding_mode": primary_entry.get("grounding_mode"),
        "grounding_note": primary_entry.get("grounding_note"),
        "review_state": primary_entry.get("review_state"),
        "review_note": primary_entry.get("review_note"),
    }


def _extract_text_from_bbox(pdf_path: str | None, page_num: int | None, bbox: Any) -> str:
    if not pdf_path or not page_num or not isinstance(bbox, list) or len(bbox) < 4:
        return ""
    resolved_path = _resolve_existing_path(pdf_path)
    if not resolved_path:
        return ""
    try:
        import fitz

        with fitz.open(resolved_path) as doc:
            page_index = int(page_num) - 1
            if page_index < 0 or page_index >= len(doc):
                return ""
            rect = fitz.Rect(*[float(value) for value in bbox[:4]])
            return re.sub(r"\s+", " ", doc[page_index].get_textbox(rect) or "").strip()
    except Exception:
        return ""


def _clear_unverified_location(entry: dict[str, Any], note: str) -> dict[str, Any]:
    cleaned = dict(entry or {})
    evidence = dict(cleaned.get("evidence") or {})
    evidence["bbox"] = None
    evidence["matched_text"] = None
    cleaned["evidence"] = evidence
    existing_note = str(cleaned.get("grounding_note") or "").strip()
    cleaned["grounding_note"] = existing_note or note
    return cleaned


def _clear_unverified_text_evidence(entry: dict[str, Any], note: str) -> dict[str, Any]:
    cleaned = _clear_unverified_location(entry, note)
    evidence = dict(cleaned.get("evidence") or {})
    evidence["quote"] = None
    cleaned["evidence"] = evidence
    return cleaned


def _looks_like_bare_numeric_evidence(text: Any) -> bool:
    value = str(text or "").strip()
    return bool(value and re.fullmatch(r"[-+]?\d+(?:\.\d+)?", value))


def _entry_has_bare_numeric_roughness_evidence(field_key: str, entry: dict[str, Any]) -> bool:
    if field_key not in {"surface_roughness", "probe_roughness", "substrate_roughness"}:
        return False
    evidence = entry.get("evidence") if isinstance(entry.get("evidence"), dict) else {}
    quote = evidence.get("quote")
    matched_text = evidence.get("matched_text") or evidence.get("matchedText")
    if not (_looks_like_bare_numeric_evidence(quote) or _looks_like_bare_numeric_evidence(matched_text)):
        return False
    combined = " ".join(str(part or "") for part in (quote, matched_text)).lower()
    return not re.search(r"\b(?:nm|μm|um|rms|roughness|root[- ]mean[- ]square)\b", combined)


def _contextual_numeric_match_from_quote(field_key: str, value: Any, quote: str) -> str | None:
    if field_key not in {"surface_roughness", "probe_roughness", "substrate_roughness"}:
        return None
    value_text = str(value or "")
    number_match = re.search(r"[-+]?\d+(?:\.\d+)?", value_text)
    if not number_match:
        return None
    number = number_match.group(0)
    escaped = re.escape(number).replace(r"\.", r"[.]")
    contextual = re.search(
        rf"\b(?:(?:rms|roughness|root[- ]mean[- ]square)\s*)?{escaped}\s*(?:nm|μm|um)\b",
        quote,
        flags=re.IGNORECASE,
    )
    if contextual:
        return contextual.group(0).strip()
    return None


def _expand_short_field_evidence_context(
    field_key: str,
    entry: dict[str, Any],
    *,
    pdf_path: str | None,
    page_num: int,
    bbox: list,
    bbox_text: str,
) -> dict[str, Any]:
    evidence = entry.get("evidence") if isinstance(entry.get("evidence"), dict) else {}
    matched_text = str(evidence.get("matched_text") or "").strip()
    quote = str(evidence.get("quote") or "").strip()
    if quote and len(quote) >= 24 and not _looks_like_bare_numeric_evidence(quote):
        return entry
    if not (_looks_like_bare_numeric_evidence(matched_text) or _looks_like_bare_numeric_evidence(bbox_text)):
        return entry

    try:
        snippet = _extract_text_snippet(
            pdf_path or "",
            int(page_num),
            bbox,
            fallback_term=matched_text or bbox_text or str(entry.get("value") or ""),
            prefer_term_context=False,
        )
    except Exception:
        snippet = None
    if not snippet:
        try:
            snippet = _extract_field_quote_from_bbox(
                pdf_path,
                int(page_num),
                bbox,
                fallback_term=matched_text or bbox_text or str(entry.get("value") or ""),
            )
        except Exception:
            snippet = None
    expanded_quote = re.sub(r"\s+", " ", str(snippet or "")).strip()
    if len(expanded_quote) < 12:
        return entry

    contextual_match = _contextual_numeric_match_from_quote(field_key, entry.get("value"), expanded_quote)
    candidate_evidence = {
        **evidence,
        "quote": expanded_quote,
        "matched_text": contextual_match or matched_text or bbox_text,
    }
    if not _field_location_match_is_reliable(field_key, entry.get("value"), candidate_evidence):
        return entry
    if field_key in {"surface_roughness", "probe_roughness", "substrate_roughness"}:
        candidate_evidence["bbox"] = None

    expanded = dict(entry or {})
    expanded["evidence"] = candidate_evidence
    return expanded


def _attach_long_field_evidence_context(
    field_map: dict[str, Any],
    *,
    pdf_path: str | None,
) -> dict[str, Any]:
    if not pdf_path:
        return field_map
    contextualized: dict[str, Any] = {}
    for key, entry in field_map.items():
        if not isinstance(entry, dict):
            contextualized[key] = entry
            continue
        evidence = entry.get("evidence") if isinstance(entry.get("evidence"), dict) else {}
        page_num = int(evidence.get("page") or 0)
        bbox = evidence.get("bbox")
        if not page_num or not isinstance(bbox, list) or len(bbox) < 4 or evidence.get("context"):
            contextualized[key] = entry
            continue
        try:
            snippet = _extract_text_snippet(
                pdf_path,
                page_num,
                bbox,
                fallback_term=(
                    evidence.get("matched_text")
                    or evidence.get("matchedText")
                    or evidence.get("quote")
                    or entry.get("value")
                    or ""
                ),
                prefer_term_context=False,
            )
        except Exception:
            snippet = None
        context = re.sub(r"\s+", " ", str(snippet or "")).strip()
        quote = re.sub(r"\s+", " ", str(evidence.get("quote") or "")).strip()
        if len(context) <= max(len(quote), 40):
            contextualized[key] = entry
            continue
        if not _long_context_supports_field_evidence(str(key), entry, context):
            contextualized[key] = entry
            continue
        updated = dict(entry)
        updated["evidence"] = {
            **evidence,
            "context": context,
        }
        contextualized[key] = updated
    return contextualized


def _normalized_evidence_text(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip().lower()


def _long_context_contains_evidence_anchor(evidence: dict[str, Any], context: str) -> bool:
    normalized_context = _normalized_evidence_text(context)
    if not normalized_context:
        return False
    for key in ("matched_text", "matchedText", "quote"):
        anchor = _normalized_evidence_text(evidence.get(key))
        if anchor and len(anchor) >= 8 and anchor in normalized_context:
            return True
    return False


def _long_context_supports_field_evidence(field_key: str, entry: dict[str, Any], context: str) -> bool:
    evidence = entry.get("evidence") if isinstance(entry.get("evidence"), dict) else {}
    if not _normalized_evidence_text(context):
        return False
    if _entry_is_derived_speed_context(
        field_key,
        entry,
        {"quote": context, "matched_text": context},
    ):
        return True
    if _long_context_contains_evidence_anchor(evidence, context):
        return True
    return _text_matches_field_or_alias(field_key, entry.get("value"), entry, context)


def _relocate_bare_numeric_roughness_evidence(
    field_key: str,
    entry: dict[str, Any],
    *,
    pdf_path: str | None,
) -> dict[str, Any] | None:
    if not pdf_path or not _entry_has_bare_numeric_roughness_evidence(field_key, entry):
        return None
    evidence = entry.get("evidence") if isinstance(entry.get("evidence"), dict) else {}
    page = evidence.get("page")
    try:
        page_hint = int(page) if page else None
    except (TypeError, ValueError):
        page_hint = None
    located = _locate_field_evidence_for_value(
        file_path=pdf_path,
        field_key=field_key,
        field_value=entry.get("value"),
        source_label=evidence.get("source_label"),
        page_hint=page_hint,
        anchor_bbox=None,
        source_type=evidence.get("source_type") or "text",
    )
    if not located:
        return None
    merged_evidence = {
        **evidence,
        **located,
    }
    if not _field_location_match_is_reliable(field_key, entry.get("value"), merged_evidence):
        return None
    cleaned = dict(entry or {})
    cleaned["evidence"] = merged_evidence
    existing_note = str(cleaned.get("grounding_note") or "").strip()
    if "roughness/unit context" in existing_note:
        cleaned.pop("grounding_note", None)
    return cleaned


def _text_matches_field_or_alias(field_key: str, value: Any, entry: dict[str, Any], text: str) -> bool:
    if _text_explicitly_matches_field_value(field_key, value, text):
        return True
    if field_key != "ionic_liquid":
        return False

    normalized_text = str(text or "").strip().lower()
    if not normalized_text:
        return False
    alias_candidates = [
        entry.get("literature_alias"),
        entry.get("lubricant_alias"),
        entry.get("original_value"),
        (entry.get("evidence") or {}).get("matched_text") if isinstance(entry.get("evidence"), dict) else None,
    ]
    if "[" in str(value or "") and re.search(r"(?<![A-Za-z0-9])IL(?![A-Za-z0-9])", str(text or "")):
        alias_candidates.append("IL")
    for candidate in alias_candidates:
        alias = str(candidate or "").strip()
        if not alias:
            continue
        pattern = rf"(?<![A-Za-z0-9]){re.escape(alias.lower())}(?![A-Za-z0-9])"
        if re.search(pattern, normalized_text):
            return True
    return False


def _refresh_visual_source_evidence(entry: dict[str, Any], *, pdf_path: str | None) -> dict[str, Any]:
    evidence = entry.get("evidence") if isinstance(entry.get("evidence"), dict) else {}
    source_type = str((evidence or {}).get("source_type") or "").strip().lower()
    source_label = str((evidence or {}).get("source_label") or "").strip()
    page_num = int((evidence or {}).get("page") or 0)
    if source_type in {"text", "table"} or "caption" in source_label.lower():
        return entry
    # A value that already resolves to selectable PDF text (a matched phrase with a
    # tight bbox) is text-grounded — keep that precise location instead of replacing
    # it with the whole figure, even when its source_label cites a figure. Otherwise
    # textual values (e.g. "the load is higher than 20 nN") get anchored to an entire
    # figure crop that pinpoints nothing for the reviewer.
    matched_text = str((evidence or {}).get("matched_text") or "").strip()
    existing_bbox = (evidence or {}).get("bbox")
    if matched_text and isinstance(existing_bbox, list) and len(existing_bbox) >= 4:
        return entry
    if (
        not pdf_path
        or not page_num
        or not source_label
        or not (
            source_type in {"figure", "visual", "image"}
            or source_label.lower().startswith("fig")
        )
    ):
        return entry

    try:
        from utils.pdf_coords import find_figure_bbox, normalize_source_label

        normalized_label = normalize_source_label(source_label) or source_label
        fig_page, fig_bbox = find_figure_bbox(
            pdf_path,
            normalized_label,
            page_hint=page_num,
            restrict_to_page_hint=True,
        )
        if not fig_page or not fig_bbox:
            return entry
        if not fig_bbox:
            return entry
        refreshed = dict(entry)
        refreshed_evidence = dict(evidence)
        refreshed_evidence.update(
            {
                "source_type": "figure",
                "page": int(fig_page),
                "source_label": normalized_label,
                "bbox": [float(value) for value in fig_bbox],
                "matched_text": None,
            }
        )
        refreshed["evidence"] = refreshed_evidence
        refreshed.setdefault("grounding_mode", "source_anchor")
        refreshed.setdefault(
            "grounding_note",
            "Value is anchored to the source figure; exact numeric text may be read from the image rather than selectable PDF text.",
        )
        return refreshed
    except Exception:
        return entry


def _sanitize_field_evidence_locations(
    field_map: dict[str, Any],
    *,
    pdf_path: str | None,
) -> dict[str, Any]:
    sanitized: dict[str, Any] = {}
    for key, entry in field_map.items():
        if not isinstance(entry, dict):
            sanitized[key] = entry
            continue

        evidence = entry.get("evidence") if isinstance(entry.get("evidence"), dict) else {}
        source_type = str((evidence or {}).get("source_type") or "").strip().lower()
        grounding_mode = str(entry.get("grounding_mode") or "").strip().lower()
        if grounding_mode == "inferred" or not evidence:
            sanitized[key] = entry
            continue

        entry = _refresh_visual_source_evidence(entry, pdf_path=pdf_path)
        evidence = entry.get("evidence") if isinstance(entry.get("evidence"), dict) else {}
        source_type = str((evidence or {}).get("source_type") or "").strip().lower()

        bbox = evidence.get("bbox")
        page_num = int(evidence.get("page") or 0)
        if not page_num or not isinstance(bbox, list) or len(bbox) < 4:
            if _entry_has_bare_numeric_roughness_evidence(str(key), entry):
                relocated = _relocate_bare_numeric_roughness_evidence(str(key), entry, pdf_path=pdf_path)
                if relocated:
                    sanitized[key] = relocated
                    continue
                sanitized[key] = _clear_unverified_text_evidence(
                    entry,
                    "Stored evidence text does not include roughness/unit context; location needs re-extraction.",
                )
                continue
            if source_type == "table" and evidence.get("page") and evidence.get("source_label") and entry.get("value") not in (None, ""):
                located = _locate_field_evidence_for_value(
                    file_path=pdf_path,
                    field_key=str(key),
                    field_value=entry.get("value"),
                    source_label=evidence.get("source_label"),
                    page_hint=int(evidence.get("page")),
                    anchor_bbox=None,
                    source_type="table",
                )
                if located:
                    cleaned = dict(entry or {})
                    cleaned["evidence"] = {
                        **(evidence or {}),
                        **located,
                    }
                    sanitized[key] = cleaned
                    continue
            sanitized[key] = entry
            continue

        matched_text = str(evidence.get("matched_text") or "").strip()
        value = entry.get("value")
        bbox_text = _extract_text_from_bbox(pdf_path, page_num, bbox)
        entry = _expand_short_field_evidence_context(
            str(key),
            entry,
            pdf_path=pdf_path,
            page_num=page_num,
            bbox=bbox,
            bbox_text=bbox_text,
        )
        evidence = entry.get("evidence") if isinstance(entry.get("evidence"), dict) else {}
        matched_text = str(evidence.get("matched_text") or "").strip()
        verification_text = bbox_text or matched_text

        if key in {"surface_roughness", "probe_roughness", "substrate_roughness"}:
            roughness_text = " ".join(
                part
                for part in [
                    bbox_text,
                    matched_text,
                    str(evidence.get("quote") or "").strip(),
                ]
                if part
            )
            if not _field_location_match_is_reliable(
                str(key),
                value,
                {"matched_text": roughness_text, "quote": roughness_text},
            ):
                sanitized[key] = _clear_unverified_text_evidence(
                    entry,
                    "Stored bbox text does not include roughness/unit context; location needs re-extraction.",
                )
                continue

        if source_type == "table" and not matched_text:
            if bbox_text and _text_matches_field_or_alias(key, value, entry, bbox_text):
                cleaned = dict(entry or {})
                cleaned_evidence = dict(evidence or {})
                cleaned_evidence["matched_text"] = bbox_text
                cleaned["evidence"] = cleaned_evidence
                sanitized[key] = cleaned
                continue
            if key == "temperature" and _is_default_temperature_value(value):
                inferred = _temperature_default_evidence_entry(value, float(entry.get("confidence") or 0.9))
                inferred["review_state"] = entry.get("review_state")
                inferred["review_note"] = entry.get("review_note")
                sanitized[key] = inferred
                continue
            sanitized[key] = _clear_unverified_location(
                entry,
                "Stored table bbox has no exact field text hit; location needs re-extraction.",
            )
            continue

        if (
            source_type in {"text", "table"}
            and not _entry_is_derived_speed_context(key, entry, evidence)
            and not _text_matches_field_or_alias(key, value, entry, verification_text)
        ):
            sanitized[key] = _clear_unverified_location(
                entry,
                "Stored bbox text does not match this field value; location needs re-extraction.",
            )
            continue

        sanitized[key] = entry
    return sanitized


def _build_record_field_evidence_payload(record: Any) -> dict[str, Any]:
    field_map = {
        _normalize_field_key(str(key)): value
        for key, value in _parse_field_evidence_map(record.field_evidence_json).items()
    }
    pdf_path = getattr(getattr(record, "literature", None), "file_path", None)
    normalized_fields: dict[str, Any] = {}
    field_keys = [
        "material",
        "material_name",
        "probe_material",
        "probe_geometry",
        "probe_radius",
        "probe_roughness",
        "substrate_material",
        "substrate_coating",
        "substrate_roughness",
        "ionic_liquid",
        "cof",
        "friction_force",
        "wear_rate",
        "film_thickness",
        "residual_film_thickness_d",
        "layer_spacing_delta",
        "regime",
        "surface_roughness",
        "load",
        "speed",
        "shear_rate",
        "temperature",
        "water_content",
        "potential",
        "source_page",
    ]
    for key in field_map:
        if key.startswith("compound_") or key.startswith("lubricant_component_"):
            field_keys.append(key)
    components = components_for_record(record)
    if len(components) > 1:
        for index, component in enumerate(components):
            if _is_separate_lubricant_compound(component):
                field_keys.append(_component_field_key(component, index))
    for key in field_map:
        if key not in field_keys:
            field_keys.append(key)

    speed_conditions = normalize_speed_conditions(getattr(record, "speed_conditions_json", None))
    if not speed_conditions:
        speed_conditions = _speed_conditions_for_field_evidence(
            {
                "speed": getattr(record, "speed_value", None),
                "speed_value": getattr(record, "speed_value", None),
                "evidence": getattr(record, "evidence", None),
                "source": getattr(record, "source", None),
                "source_figure": getattr(record, "source_figure", None),
            },
            record,
        )
    if not _is_derived_speed_conditions(speed_conditions):
        speed_entry = field_map.get("speed") if isinstance(field_map.get("speed"), dict) else {}
        speed_evidence = speed_entry.get("evidence") if isinstance(speed_entry.get("evidence"), dict) else {}
        speed_context = " ".join(
            part
            for part in (
                _field_text(speed_evidence.get("quote")),
                _field_text(speed_evidence.get("matched_text") or speed_evidence.get("matchedText")),
                _field_text(speed_entry.get("grounding_note")),
            )
            if part
        )
        if speed_context:
            speed_conditions = _speed_conditions_for_field_evidence(
                {
                    "speed": getattr(record, "speed_value", None),
                    "speed_value": getattr(record, "speed_value", None),
                    "evidence": speed_context,
                },
                record,
            )
    speed_conditions = _enrich_derived_speed_conditions_from_pdf_context(
        speed_conditions,
        pdf_path=pdf_path,
        speed_value=getattr(record, "speed_value", None),
    )
    if not _is_derived_speed_conditions(speed_conditions) and pdf_path:
        pdf_speed_conditions = _derive_speed_conditions_from_pdf_scan_context(
            pdf_path,
            getattr(record, "speed_value", None),
        )
        if _is_derived_speed_conditions(pdf_speed_conditions):
            speed_conditions = pdf_speed_conditions
    for key in dict.fromkeys(field_keys):
        raw_entry = field_map.get(key) if isinstance(field_map.get(key), dict) else {}
        if not raw_entry and (key.startswith("compound_") or key.startswith("lubricant_component_")):
            raw_entry = _component_field_entry_from_source(field_map, record, key)
        evidence = raw_entry.get("evidence") if isinstance(raw_entry.get("evidence"), dict) else None
        if evidence:
            evidence_source_type = str(evidence.get("source_type") or "").strip().lower()
            evidence_source_label = str(evidence.get("source_label") or "").strip()
            if (
                getattr(record, "source_page", None)
                and (
                    evidence_source_type in {"figure", "visual", "image"}
                    or evidence_source_label.lower().startswith("fig")
                )
            ):
                evidence = {
                    **evidence,
                    "page": getattr(record, "source_page", None),
                    "source_label": evidence_source_label or getattr(record, "source_figure", None) or getattr(record, "source", None),
                }
        normalized_entry = {
            **raw_entry,
            "value": raw_entry.get("value", _field_value_from_record(record, key)),
            "confidence": raw_entry.get("confidence", record.confidence),
            "evidence": evidence,
            "status": _field_grounding_status(raw_entry),
            "grounding_mode": raw_entry.get("grounding_mode"),
            "grounding_note": raw_entry.get("grounding_note"),
            "review_state": raw_entry.get("review_state"),
            "review_note": raw_entry.get("review_note"),
        }
        if key == "speed" and _is_derived_speed_conditions(speed_conditions):
            normalized_entry = _apply_derived_speed_display_evidence(normalized_entry, speed_conditions)
        normalized_fields[key] = normalized_entry

    normalized_fields = _sanitize_field_evidence_locations(normalized_fields, pdf_path=pdf_path)
    normalized_fields = _attach_long_field_evidence_context(normalized_fields, pdf_path=pdf_path)
    normalized_fields["conditions"] = _build_conditions_entry(normalized_fields, record)
    normalized_fields = _refine_potential_evidence_from_metric_context_with_pdf(
        normalized_fields,
        pdf_path,
    )
    for key, entry in normalized_fields.items():
        if isinstance(entry, dict):
            entry["status"] = _field_grounding_status(entry)

    confidence_details = calculate_confidence_details(
        {
            "material_name": getattr(record, "material_name", None),
            "lubricant": getattr(record, "lubricant", None),
            "cof_raw": getattr(record, "cof_raw", None),
            "cof_value": getattr(record, "cof_value", None),
            "cof_operator": getattr(record, "cof_operator", None),
            "friction_force": getattr(record, "friction_force", None),
            "wear_rate": getattr(record, "wear_rate", None),
            "film_thickness": getattr(record, "film_thickness", None),
            "residual_film_thickness_d": getattr(record, "residual_film_thickness_d", None),
            "layer_spacing_delta": getattr(record, "layer_spacing_delta", None),
            "surface_roughness": getattr(record, "surface_roughness", None),
            "load": getattr(record, "load_raw", None) or getattr(record, "load_value", None),
            "speed": getattr(record, "speed_value", None),
            "shear_rate": getattr(record, "shear_rate", None),
            "temperature": getattr(record, "temperature", None),
            "potential": getattr(record, "potential", None),
            "water_content": getattr(record, "water_content", None),
            "probe_material": getattr(record, "probe_material", None),
            "substrate_material": getattr(record, "substrate_material", None),
            "substrate_coating": getattr(record, "substrate_coating", None),
            "probe_roughness": getattr(record, "probe_roughness", None),
            "substrate_roughness": getattr(record, "substrate_roughness", None),
            "source": getattr(record, "source", None),
            "source_page": getattr(record, "source_page", None),
            "source_figure": getattr(record, "source_figure", None),
            "evidence": getattr(record, "evidence", None),
            "field_evidence_json": normalized_fields,
            "review_status": getattr(record, "review_status", None),
            "model_confidence": getattr(record, "confidence", None),
        }
    )

    return {
        "record_id": record.id,
        "literature_id": record.literature_id,
        "sample_id": record.sample_id,
        "series_id": record.series_id,
        "review_status": record.review_status,
        "record_origin": record.record_origin,
        "assembly_notes": record.assembly_notes,
        "required_fields": _required_field_keys(field_map),
        "fields": normalized_fields,
        "confidence": float(confidence_details.get("score") or 0.0),
        "confidence_details": confidence_details,
    }


class ReviewFieldActionPayload(BaseModel):
    note: str | None = None


class ReviewFieldEvidencePatchPayload(BaseModel):
    page: int
    bbox: list[float]
    matched_text: str = Field(..., alias="matchedText")
    quote: str | None = None
    source_label: str | None = Field(None, alias="sourceLabel")
    source_type: str = Field("manual_review", alias="sourceType")
    note: str | None = None

    class Config:
        populate_by_name = True


class FigureCropOverridePayload(BaseModel):
    label: str
    page: int = Field(..., ge=1)
    bbox: list[float] = Field(..., min_length=4, max_length=4)
    caption: str | None = None
    algorithm_bbox: list[float] | None = Field(None, alias="algorithmBbox")
    algorithm_version: str | None = Field(None, alias="algorithmVersion")

    class Config:
        populate_by_name = True


def _apply_review_field_evidence_patch(
    record: Any,
    field_key: str,
    payload: ReviewFieldEvidencePatchPayload,
    *,
    value_getter,
) -> dict[str, Any]:
    normalized_key = _normalize_field_key(field_key)
    if payload.page < 1:
        raise HTTPException(status_code=422, detail="Evidence page must be 1 or greater.")
    if len(payload.bbox or []) < 4:
        raise HTTPException(status_code=422, detail="Evidence bbox must contain four numeric values.")
    bbox = [float(value) for value in payload.bbox[:4]]
    if not all(isinstance(value, float) for value in bbox):
        raise HTTPException(status_code=422, detail="Evidence bbox must contain numeric values.")
    matched_text = str(payload.matched_text or "").strip()
    if not matched_text:
        raise HTTPException(status_code=422, detail="matchedText is required.")

    field_map = _parse_field_evidence_map(getattr(record, "field_evidence_json", None))
    target_keys = _target_field_keys_for_action(normalized_key, field_map)
    if not target_keys:
        target_keys = [normalized_key]

    for key in target_keys:
        entry = field_map.get(key)
        if not isinstance(entry, dict):
            entry = {}
        value = entry.get("value", value_getter(record, key))
        entry.update(
            {
                "value": value,
                "confidence": entry.get("confidence", getattr(record, "confidence", None)),
                "evidence": {
                    **(entry.get("evidence") if isinstance(entry.get("evidence"), dict) else {}),
                    "source_type": payload.source_type or "manual_review",
                    "page": int(payload.page),
                    "source_label": payload.source_label,
                    "quote": payload.quote or matched_text,
                    "bbox": bbox,
                    "matched_text": matched_text,
                },
                "grounding_mode": "explicit",
                "grounding_note": "Reviewer replaced this evidence location from the PDF review surface.",
                "review_state": "confirmed",
                "review_note": payload.note or "Evidence location replaced during review.",
            }
        )
        field_map[key] = entry

    if hasattr(record, "source_page"):
        record.source_page = int(payload.page)
    if hasattr(record, "source_bbox"):
        record.source_bbox = json.dumps(bbox)
    if hasattr(record, "evidence"):
        record.evidence = payload.quote or matched_text

    _persist_field_map(record, field_map)
    return field_map


class ManualDiffusionCandidatePayload(BaseModel):
    system_name: str | None = Field(None, alias="systemName")
    ionic_liquid: str | None = Field(None, alias="ionicLiquid")
    diffusing_ion: str | None = Field(None, alias="diffusingIon")
    d_total: float | None = Field(None, alias="dTotal")
    d_cation: float | None = Field(None, alias="dCation")
    d_anion: float | None = Field(None, alias="dAnion")
    d_unit: str | None = Field(None, alias="dUnit")
    temperature_value: float | None = Field(None, alias="temperatureValue")
    confinement_scale_value: float | None = Field(None, alias="confinementScaleValue")
    confinement_scale_unit: str | None = Field(None, alias="confinementScaleUnit")
    source_page: int | None = Field(None, alias="sourcePage")
    source_figure: str | None = Field(None, alias="sourceFigure")
    evidence: str | None = None
    note: str | None = None
    confidence: float | None = None

    class Config:
        populate_by_name = True


class CandidateFieldCorrectionPayload(BaseModel):
    fields: dict[str, Any] = Field(default_factory=dict)


def _dump_manual_diffusion_payload(payload: ManualDiffusionCandidatePayload) -> dict[str, Any]:
    if hasattr(payload, "model_dump"):
        return payload.model_dump(by_alias=True, exclude_none=True)
    return payload.dict(by_alias=True, exclude_none=True)


def _build_manual_diffusion_source_values(payload: ManualDiffusionCandidatePayload) -> dict[str, Any]:
    source_values: dict[str, Any] = {}
    for key, value in {
        "D_total": payload.d_total,
        "D_cation": payload.d_cation,
        "D_anion": payload.d_anion,
    }.items():
        if value is None:
            continue
        source_values[key] = {
            "raw_value": value,
            "raw_unit": payload.d_unit,
        }
        evidence = str(payload.evidence or "").strip()
        if evidence:
            source_values[key]["raw_text"] = evidence
        if payload.source_figure:
            source_values[key]["source_label"] = payload.source_figure
        if payload.source_page:
            source_values[key]["source_page"] = payload.source_page
    return source_values


class CofExtractedUpdatePayload(BaseModel):
    cof_extracted: dict[str, Any] | None = Field(None, alias="cofExtracted")

    class Config:
        populate_by_name = True


class LoadConditionsUpdatePayload(BaseModel):
    load_conditions: dict[str, Any] | None = Field(None, alias="loadConditions")

    class Config:
        populate_by_name = True


class SpeedConditionsUpdatePayload(BaseModel):
    speed_conditions: dict[str, Any] | None = Field(None, alias="speedConditions")

    class Config:
        populate_by_name = True


class TribologicalSystemUpdatePayload(BaseModel):
    tribological_system: dict[str, Any] | None = Field(None, alias="tribologicalSystem")

    class Config:
        populate_by_name = True


def _apply_cof_extracted_update(record: Any, payload: CofExtractedUpdatePayload) -> dict[str, Any]:
    cof_extracted = normalize_cof_extracted(payload.cof_extracted)
    if not cof_extracted:
        raise HTTPException(status_code=422, detail="cofExtracted must be a structured object.")

    record.cof_extracted_json = serialize_cof_extracted(cof_extracted)
    if cof_extracted.get("raw_text"):
        record.cof_raw = str(cof_extracted.get("raw_text"))
    average = cof_average_from_extracted(cof_extracted)
    if average is not None:
        record.cof_value = average

    field_map = _parse_field_evidence_map(record.field_evidence_json)
    cof_entry = field_map.get("cof") if isinstance(field_map.get("cof"), dict) else {}
    cof_entry["value"] = record.cof_raw or (str(record.cof_value) if record.cof_value is not None else None)
    cof_entry["review_state"] = None
    cof_entry["review_note"] = None
    field_map["cof"] = cof_entry
    record.field_evidence_json = json.dumps(field_map, ensure_ascii=False)
    _recompute_review_status(record, field_map)
    return cof_extracted


def _apply_load_conditions_update(record: Any, payload: LoadConditionsUpdatePayload) -> dict[str, Any]:
    load_conditions = normalize_load_conditions(payload.load_conditions)
    if not load_conditions:
        raise HTTPException(status_code=422, detail="loadConditions must be a structured object.")

    record.load_conditions_json = serialize_load_conditions(load_conditions)
    if load_conditions.get("raw_text"):
        raw_text = str(load_conditions.get("raw_text"))
        record.load_raw = raw_text
        record.load_value = raw_text

    field_map = _parse_field_evidence_map(record.field_evidence_json)
    load_entry = field_map.get("load") if isinstance(field_map.get("load"), dict) else {}
    load_entry["value"] = record.load_raw or record.load_value
    load_entry["review_state"] = None
    load_entry["review_note"] = None
    field_map["load"] = load_entry
    record.field_evidence_json = json.dumps(field_map, ensure_ascii=False)
    _recompute_review_status(record, field_map)
    return load_conditions


def _apply_speed_conditions_update(record: Any, payload: SpeedConditionsUpdatePayload) -> dict[str, Any]:
    speed_conditions = normalize_speed_conditions(payload.speed_conditions)
    if not speed_conditions:
        raise HTTPException(status_code=422, detail="speedConditions must be a structured object.")

    record.speed_conditions_json = serialize_speed_conditions(speed_conditions)
    derived_speed_value = speed_value_from_conditions(speed_conditions)
    if derived_speed_value:
        record.speed_value = derived_speed_value
    elif speed_conditions.get("scan_rate_hz") is not None:
        record.speed_value = None

    field_map = _parse_field_evidence_map(record.field_evidence_json)
    speed_entry = field_map.get("speed") if isinstance(field_map.get("speed"), dict) else {}
    speed_entry["value"] = record.speed_value or speed_conditions.get("raw_text")
    speed_entry["review_state"] = None
    speed_entry["review_note"] = None
    field_map["speed"] = speed_entry
    record.field_evidence_json = json.dumps(field_map, ensure_ascii=False)
    _recompute_review_status(record, field_map)
    return speed_conditions


def _apply_tribological_system_update(record: Any, payload: TribologicalSystemUpdatePayload) -> dict[str, Any]:
    tribological_system = normalize_tribological_system(payload.tribological_system)
    if not tribological_system:
        raise HTTPException(status_code=422, detail="tribologicalSystem must be a structured object.")

    record.tribological_system_json = serialize_tribological_system(tribological_system)
    if tribological_system.get("raw_text"):
        record.regime = str(tribological_system.get("raw_text"))

    field_map = _parse_field_evidence_map(record.field_evidence_json)
    regime_entry = field_map.get("regime") if isinstance(field_map.get("regime"), dict) else {}
    regime_entry["value"] = record.regime
    regime_entry["review_state"] = None
    regime_entry["review_note"] = None
    field_map["regime"] = regime_entry
    record.field_evidence_json = json.dumps(field_map, ensure_ascii=False)
    _recompute_review_status(record, field_map)
    return tribological_system


def _required_field_keys(field_map: dict[str, Any]) -> list[str]:
    required = ["material", "ionic_liquid"]
    for key in _TRIBOLOGY_PRIMARY_METRIC_KEYS:
        entry = field_map.get(key) or {}
        if (entry or {}).get("value") not in (None, ""):
            required.append(key)
            break
    return required


def _required_field_missing(field_map: dict[str, Any]) -> list[str]:
    return [key for key in _required_field_keys(field_map) if _field_grounding_status(field_map.get(key) or {}) != "grounded"]


def _persist_field_map(record: Any, field_map: dict[str, Any]) -> None:
    record.field_evidence_json = json.dumps(field_map, ensure_ascii=False)


def _target_field_keys_for_action(field_key: str, field_map: dict[str, Any]) -> list[str]:
    if field_key == "conditions":
        keys = [
            key
            for key in (
                "load",
                "regime",
                "speed",
                "shear_rate",
                "temperature",
                "potential",
                "water_content",
                "temperature_value",
                "confinement_scale_value",
                "confinement_scale_unit",
            )
            if isinstance(field_map.get(key), dict)
            and (field_map.get(key) or {}).get("value") not in (None, "", [])
        ]
        return keys or ["load", "speed", "shear_rate", "temperature"]
    if field_key == "diffusion_coefficient":
        keys = [
            key
            for key in _DIFFUSION_COEFFICIENT_FIELD_KEYS
            if isinstance(field_map.get(key), dict)
            and (field_map.get(key) or {}).get("value") not in (None, "", [])
        ]
        return keys or list(_DIFFUSION_COEFFICIENT_FIELD_KEYS)
    if field_key == "ion_identity":
        keys = [
            key
            for key in ("diffusing_ion", "cation", "anion")
            if isinstance(field_map.get(key), dict)
            and (field_map.get(key) or {}).get("value") not in (None, "", [])
        ]
        return keys or ["diffusing_ion", "cation", "anion"]
    if field_key == "confinement_context":
        keys = [
            key
            for key in (
                "confinement_material_class",
                "confinement_geometry_class",
                "surface_functional_groups",
                "confinement_dimensionality",
                "confinement_scale_value",
                "confinement_scale_unit",
            )
            if isinstance(field_map.get(key), dict)
            and (field_map.get(key) or {}).get("value") not in (None, "", [])
        ]
        return keys or ["confinement_material_class", "confinement_geometry_class"]
    return [field_key]


def _clear_flagged_field_entries(field_map: dict[str, Any], target_keys: list[str], note: str | None = None) -> None:
    for key in target_keys:
        entry = field_map.get(key)
        if not isinstance(entry, dict):
            continue
        if str(entry.get("review_state") or "").strip().lower() != "flagged":
            continue
        entry["review_state"] = None
        entry["review_note"] = note
        field_map[key] = entry


def _recompute_review_status(record: Any, field_map: dict[str, Any], *, approved: bool = False) -> None:
    missing_required = _required_field_missing(field_map)
    flagged_required = [
        key for key in _required_field_keys(field_map)
        if str((field_map.get(key) or {}).get("review_state") or "").strip().lower() == "flagged"
    ]
    if approved:
        record.review_status = "approved"
        record.assembly_notes = None
        return
    if flagged_required:
        record.review_status = "flagged"
        record.assembly_notes = f"Flagged fields: {', '.join(flagged_required)}"
        return
    if missing_required:
        record.review_status = "needs_evidence"
        record.assembly_notes = f"Missing field evidence for: {', '.join(missing_required)}"
        return
    record.review_status = "pending_review"
    record.assembly_notes = None


def _copy_candidate_to_final_record(candidate: RecordCandidate, record: TribologyDataDB | None = None) -> TribologyDataDB:
    target = record or TribologyDataDB(literature_id=candidate.literature_id)
    target.literature_id = candidate.literature_id
    target.material_name = candidate.material_name
    target.lubricant = candidate.lubricant
    target.lubricant_components_json = getattr(candidate, "lubricant_components_json", None)
    target.lubricant_alias = getattr(candidate, "lubricant_alias", None)
    target.cof_value = candidate.cof_value
    target.cof_operator = candidate.cof_operator
    target.cof_raw = candidate.cof_raw
    target.cof_extracted_json = getattr(candidate, "cof_extracted_json", None)
    target.load_value = candidate.load_value
    target.load_raw = candidate.load_raw
    target.load_conditions_json = getattr(candidate, "load_conditions_json", None)
    target.speed_value = candidate.speed_value
    target.speed_conditions_json = getattr(candidate, "speed_conditions_json", None)
    target.shear_rate = getattr(candidate, "shear_rate", None)
    target.temperature = candidate.temperature
    target.potential = candidate.potential
    target.water_content = candidate.water_content
    target.probe_material = candidate.probe_material
    target.probe_geometry = candidate.probe_geometry
    target.probe_radius = candidate.probe_radius
    target.probe_roughness = candidate.probe_roughness
    target.substrate_material = candidate.substrate_material
    target.substrate_coating = candidate.substrate_coating
    target.substrate_roughness = candidate.substrate_roughness
    target.surface_roughness = candidate.surface_roughness
    target.residual_film_thickness_d = candidate.residual_film_thickness_d
    target.layer_spacing_delta = candidate.layer_spacing_delta
    target.film_thickness = candidate.film_thickness
    target.regime = getattr(candidate, "regime", None)
    target.tribological_system_json = getattr(candidate, "tribological_system_json", None)
    target.mol_ratio = candidate.mol_ratio
    target.cation = candidate.cation
    target.anion = candidate.anion
    target.cation_smiles = candidate.cation_smiles
    target.anion_smiles = candidate.anion_smiles
    target.il_smiles = candidate.il_smiles
    target.il_inchikey = candidate.il_inchikey
    target.alkyl_chain_length = candidate.alkyl_chain_length
    target.confidence = candidate.confidence
    target.sample_id = candidate.sample_id
    target.series_id = candidate.series_id
    target.field_evidence_json = candidate.field_evidence_json
    target.review_status = candidate.review_status
    target.record_origin = (
        "review_secondary_promoted"
        if str(candidate.record_origin or "").strip().lower() == "review_secondary"
        else "review_promoted_candidate"
    )
    target.assembly_notes = candidate.assembly_notes
    target.evidence = candidate.evidence
    target.evidence_page = candidate.evidence_page
    target.evidence_bbox = candidate.evidence_bbox
    target.source = candidate.source
    target.source_page = candidate.source_page
    target.source_figure = candidate.source_figure
    return target


_DIFFUSION_COEFFICIENT_FIELD_KEYS = ("d_total", "d_cation", "d_anion")
_DIFFUSION_CORE_FACT_KEYS = (
    "system_name",
    "diffusing_ion",
    "diffusion_coefficient",
    "d_unit",
    "source_evidence",
)


def _format_diffusion_numeric(value: Any) -> Any:
    if isinstance(value, float):
        return float(f"{value:.6g}")
    return value


_SUPERSCRIPT_DIGIT_MAP = str.maketrans({
    "⁰": "0",
    "¹": "1",
    "²": "2",
    "³": "3",
    "⁴": "4",
    "⁵": "5",
    "⁶": "6",
    "⁷": "7",
    "⁸": "8",
    "⁹": "9",
    "⁻": "-",
    "−": "-",
})


def _diffusion_unit_is_10e_minus_12(unit: Any) -> bool:
    normalized = re.sub(r"\s+", "", str(unit or "").translate(_SUPERSCRIPT_DIGIT_MAP).lower())
    return any(token in normalized for token in ("10-12", "10^-12", "10e-12"))


def _diffusion_pdf_numeric_variants(value: Any, *, d_unit: Any = None) -> list[str]:
    try:
        numeric = float(value)
    except Exception:
        return []

    values = [numeric]
    if _diffusion_unit_is_10e_minus_12(d_unit):
        # The library stores diffusion coefficients as 10^-12 m^2/s, while many
        # PDFs report the same table in 10^-10 or 10^-13 m^2/s. Try common
        # printed scales before the normalized library value.
        values.insert(0, numeric / 100.0)
        values.append(numeric * 10.0)

    variants: list[str] = []
    for candidate in values:
        variants.extend(
            [
                f"{candidate:.3f}",
                f"{candidate:.4g}",
                f"{candidate:g}",
            ]
        )
    deduped: list[str] = []
    seen: set[str] = set()
    for variant in variants:
        key = variant.strip()
        if not key or key in seen:
            continue
        seen.add(key)
        deduped.append(key)
    return deduped


def _bbox_center_inside(inner: list[float], outer: list[float] | None) -> bool:
    if not outer or len(outer) != 4:
        return True
    ix0, iy0, ix1, iy1 = [float(value) for value in inner[:4]]
    ox0, oy0, ox1, oy1 = [float(value) for value in outer[:4]]
    cx = (ix0 + ix1) / 2.0
    cy = (iy0 + iy1) / 2.0
    return ox0 <= cx <= ox1 and oy0 <= cy <= oy1


def _locate_diffusion_numeric_word_bbox(
    *,
    pdf_path: str,
    page_num: int,
    terms: list[str],
    anchor_bbox: list[float] | None = None,
) -> tuple[int | None, list[float] | None]:
    try:
        import fitz

        with fitz.open(pdf_path) as doc:
            if page_num < 1 or page_num > len(doc):
                return None, None
            page = doc[page_num - 1]
            words = sorted(page.get_text("words") or [], key=lambda word: (float(word[1]), float(word[0])))
            matched_bboxes: list[list[float]] = []
            matched_keys: set[str] = set()
            row_y: float | None = None
            for term in terms:
                if not re.search(r"\d", str(term or "")):
                    continue
                term_key = str(term or "").strip()
                if term_key in matched_keys:
                    continue
                for word in words:
                    x0, y0, x1, y1, text, *_ = word
                    matched_text = str(text or "").strip().rstrip(",;")
                    if not _numeric_term_matches(str(term), matched_text):
                        continue
                    bbox = [float(x0), float(y0), float(x1), float(y1)]
                    if not _bbox_center_inside(bbox, anchor_bbox):
                        continue
                    if row_y is not None and abs(float(y0) - row_y) > 4.0:
                        continue
                    row_y = float(y0)
                    matched_keys.add(term_key)
                    matched_bboxes.append(bbox)
                    break
            if matched_bboxes:
                x0 = min(bbox[0] for bbox in matched_bboxes)
                y0 = min(bbox[1] for bbox in matched_bboxes)
                x1 = max(bbox[2] for bbox in matched_bboxes)
                y1 = max(bbox[3] for bbox in matched_bboxes)
                return page_num, [x0, y0, x1, y1]
    except Exception:
        return None, None
    return None, None


def _diffusion_metric_pdf_terms(record: Any) -> list[str]:
    terms: list[str] = []
    d_unit = getattr(record, "d_unit", None)
    for numeric_value in (
        getattr(record, "d_total", None),
        getattr(record, "d_cation", None),
        getattr(record, "d_anion", None),
    ):
        if numeric_value in (None, "", []):
            continue
        terms.extend(_diffusion_pdf_numeric_variants(numeric_value, d_unit=d_unit))

    deduped: list[str] = []
    seen: set[str] = set()
    for term in terms:
        key = str(term or "").strip()
        if not key or key in seen:
            continue
        seen.add(key)
        deduped.append(key)
    return deduped


def _diffusion_has_duplicate_coefficients(record: Any) -> bool:
    values: list[float] = []
    for numeric_value in (
        getattr(record, "d_total", None),
        getattr(record, "d_cation", None),
        getattr(record, "d_anion", None),
    ):
        if numeric_value in (None, "", []):
            continue
        try:
            values.append(round(float(numeric_value), 12))
        except Exception:
            continue
    return len(values) != len(set(values))


def _diffusion_prefers_table_bbox(record: Any) -> bool:
    features = _parse_json_object(getattr(record, "novel_features_json", None))
    parser = str(features.get("table_parser") or "").strip().lower()
    return parser == "layerwise_diffusion.v1" and bool(features.get("source_table_bbox"))


def _diffusion_bbox_matches_metric(pdf_path: str | None, page_num: int | None, bbox: Any, terms: list[str]) -> bool:
    if not pdf_path or not page_num or not bbox or not terms:
        return False
    bbox_text = _extract_text_from_bbox(pdf_path, page_num, bbox)
    if not bbox_text:
        return False
    return any(_numeric_term_matches(term, bbox_text) for term in terms)


def _locate_diffusion_metric_bbox(
    *,
    pdf_path: str | None,
    page_hint: int | None,
    terms: list[str],
    anchor_bbox: list[float] | None = None,
    find_evidence_coordinates: Any,
) -> tuple[int | None, list[float] | None]:
    if not pdf_path or not terms:
        return None, None
    if page_hint:
        word_page, word_bbox = _locate_diffusion_numeric_word_bbox(
            pdf_path=pdf_path,
            page_num=int(page_hint),
            terms=terms,
            anchor_bbox=anchor_bbox,
        )
        if word_page and word_bbox:
            return word_page, word_bbox
    for term in terms:
        try:
            page, bbox = find_evidence_coordinates(
                pdf_path,
                term,
                page_hint=int(page_hint) if page_hint else None,
                restrict_to_page_hint=bool(page_hint),
            )
        except Exception:
            continue
        if page and bbox and _diffusion_bbox_matches_metric(pdf_path, int(page), bbox, [term]):
            return int(page), [float(value) for value in bbox]
    return None, None


def _manual_diffusion_note(payload: ManualDiffusionCandidatePayload) -> str:
    return (payload.evidence or payload.note or "Manual figure estimate").strip()


def _manual_diffusion_source_label(payload: ManualDiffusionCandidatePayload) -> str:
    return (payload.source_figure or "Figure estimate").strip()


def _manual_diffusion_evidence(payload: ManualDiffusionCandidatePayload) -> dict[str, Any]:
    return {
        "source_type": "figure",
        "page": payload.source_page,
        "source_label": _manual_diffusion_source_label(payload),
        "quote": _manual_diffusion_note(payload),
    }


def _build_manual_diffusion_candidate_field_map(payload: ManualDiffusionCandidatePayload) -> dict[str, Any]:
    evidence = _manual_diffusion_evidence(payload)
    confidence = float(payload.confidence if payload.confidence is not None else 0.62)
    field_map: dict[str, Any] = {}

    def add_entry(field_key: str, value: Any, *, mode: str = "explicit") -> None:
        if value in (None, "", [], {}):
            return
        field_map[field_key] = {
            "value": value,
            "confidence": confidence,
            "evidence": evidence,
            "grounding_mode": mode,
            "grounding_note": "Manual graph estimate; verify against the figure before approval.",
            "review_state": "pending",
        }

    add_entry("system_name", payload.system_name)
    add_entry("ionic_liquid", payload.ionic_liquid)
    add_entry("diffusing_ion", payload.diffusing_ion)
    add_entry("d_total", payload.d_total, mode="derived")
    add_entry("d_cation", payload.d_cation, mode="derived")
    add_entry("d_anion", payload.d_anion, mode="derived")
    add_entry("d_unit", payload.d_unit)
    add_entry("temperature_value", payload.temperature_value)
    add_entry("confinement_scale_value", payload.confinement_scale_value)
    add_entry("confinement_scale_unit", payload.confinement_scale_unit)
    add_entry("source_page", f"Page {payload.source_page}" if payload.source_page else None)
    return field_map


def _diffusion_row_dict_from_record(record: Any) -> dict[str, Any]:
    return {
        "system_name": getattr(record, "system_name", None),
        "confinement_material_class": getattr(record, "confinement_material_class", None),
        "confinement_geometry_class": getattr(record, "confinement_geometry_class", None),
        "surface_functional_groups": getattr(record, "surface_functional_groups", None),
        "confinement_dimensionality": getattr(record, "confinement_dimensionality", None),
        "ionic_liquid": getattr(record, "ionic_liquid", None),
        "D_total": getattr(record, "d_total", None) or getattr(record, "D_total", None),
        "D_cation": getattr(record, "d_cation", None) or getattr(record, "D_cation", None),
        "D_anion": getattr(record, "d_anion", None) or getattr(record, "D_anion", None),
        "D_unit": getattr(record, "d_unit", None) or getattr(record, "D_unit", None),
        "temperature_value": getattr(record, "temperature_value", None),
        "confinement_scale_value": getattr(record, "confinement_scale_value", None),
        "confinement_scale_unit": getattr(record, "confinement_scale_unit", None),
        "source": getattr(record, "source", None),
        "source_page": getattr(record, "source_page", None),
        "source_bbox": _parse_json_object(getattr(record, "source_bbox", None)),
        "evidence": getattr(record, "evidence", None),
        "confidence": getattr(record, "confidence", None),
        "novel_features_json": _parse_json_object(getattr(record, "novel_features_json", None)),
        "rdkit_features_json": _parse_json_object(getattr(record, "rdkit_features_json", None)),
    }


def _diffusion_standard_fields_from_record(record: Any) -> dict[str, Any]:
    row = _diffusion_row_dict_from_record(record)
    existing = _parse_json_object(row.get("novel_features_json")).get("standard_fields")
    standard = existing if isinstance(existing, dict) else {}
    return {**build_diffusion_standard_fields(row), **standard}


def _diffusion_normalization_from_record(record: Any) -> dict[str, Any]:
    return build_diffusion_normalization_payload(_diffusion_row_dict_from_record(record))


def _diffusion_standard_value(standard_fields: dict[str, Any], field_key: str) -> Any:
    if field_key == "side_chain":
        return standard_fields.get("side_chain_label")
    if field_key == "water_uptake":
        return standard_fields.get("water_uptake_label")
    return standard_fields.get(field_key)


def _diffusion_field_value_from_record(record: Any, field_key: str) -> Any:
    if field_key in {"cation", "anion", "diffusing_ion", "side_chain", "water_uptake"}:
        return _diffusion_standard_value(_diffusion_standard_fields_from_record(record), field_key)
    if field_key == "system_name":
        return record.system_name
    if field_key == "confinement_material_class":
        return record.confinement_material_class
    if field_key == "confinement_geometry_class":
        return record.confinement_geometry_class
    if field_key == "surface_functional_groups":
        return record.surface_functional_groups
    if field_key == "confinement_dimensionality":
        return record.confinement_dimensionality
    if field_key == "ionic_liquid":
        return record.ionic_liquid
    if field_key == "d_total":
        return _format_diffusion_numeric(record.d_total)
    if field_key == "d_cation":
        return _format_diffusion_numeric(record.d_cation)
    if field_key == "d_anion":
        return _format_diffusion_numeric(record.d_anion)
    if field_key == "d_unit":
        return record.d_unit
    if field_key == "temperature_value":
        return _format_diffusion_numeric(record.temperature_value)
    if field_key == "confinement_scale_value":
        return _format_diffusion_numeric(record.confinement_scale_value)
    if field_key == "confinement_scale_unit":
        return record.confinement_scale_unit
    if field_key == "source_page":
        return f"Page {record.source_page}" if getattr(record, "source_page", None) else None
    return None


def _build_diffusion_conditions_entry(field_map: dict[str, Any], record: Any) -> dict[str, Any]:
    temperature_value = _diffusion_field_value_from_record(record, "temperature_value")
    confinement_scale_value = _diffusion_field_value_from_record(record, "confinement_scale_value")
    confinement_scale_unit = _diffusion_field_value_from_record(record, "confinement_scale_unit")

    parts = []
    if temperature_value not in (None, "", []):
        parts.append(f"T={temperature_value}")
    if confinement_scale_value not in (None, "", []):
        scale_part = f"Scale={confinement_scale_value}"
        if confinement_scale_unit not in (None, "", []):
            scale_part = f"{scale_part} {confinement_scale_unit}"
        parts.append(scale_part)

    primary_entry = next(
        (
            field_map.get(key)
            for key in ("temperature_value", "confinement_scale_value", "confinement_scale_unit")
            if isinstance(field_map.get(key), dict) and field_map.get(key)
        ),
        {},
    )
    return {
        "value": " | ".join(str(value) for value in parts) if parts else None,
        "confidence": primary_entry.get("confidence"),
        "evidence": primary_entry.get("evidence"),
        "status": _field_grounding_status(primary_entry),
        "grounding_mode": primary_entry.get("grounding_mode"),
        "grounding_note": primary_entry.get("grounding_note"),
        "review_state": primary_entry.get("review_state"),
        "review_note": primary_entry.get("review_note"),
    }


def _build_diffusion_field_evidence_payload(record: Any) -> dict[str, Any]:
    field_map = _parse_field_evidence_map(getattr(record, "field_evidence_json", None))
    standard_fields = _diffusion_standard_fields_from_record(record)
    normalization = _diffusion_normalization_from_record(record)
    review_entity_type = "candidate" if isinstance(record, DiffusionCandidate) else "record"
    promoted_record_id = getattr(record, "promoted_record_id", None) if review_entity_type == "candidate" else None
    promoted_at = getattr(record, "promoted_at", None) if review_entity_type == "candidate" else None
    promoted_at_text = promoted_at.isoformat() if hasattr(promoted_at, "isoformat") else (str(promoted_at) if promoted_at else None)
    normalized_fields: dict[str, Any] = {}
    ordered_keys = (
        "system_name",
        "confinement_material_class",
        "confinement_geometry_class",
        "surface_functional_groups",
        "confinement_dimensionality",
        "ionic_liquid",
        "cation",
        "anion",
        "diffusing_ion",
        "side_chain",
        "water_uptake",
        "d_total",
        "d_cation",
        "d_anion",
        "d_unit",
        "temperature_value",
        "confinement_scale_value",
        "confinement_scale_unit",
        "source_page",
    )
    standard_field_keys = {"cation", "anion", "diffusing_ion", "side_chain", "water_uptake"}
    inferred_evidence = {
        "source_type": "text" if getattr(record, "source_page", None) else None,
        "page": getattr(record, "source_page", None),
        "source_label": getattr(record, "source", None),
        "quote": getattr(record, "evidence", None),
    }
    for key in ordered_keys:
        raw_entry = field_map.get(key) if isinstance(field_map.get(key), dict) else {}
        if not raw_entry and key in standard_field_keys:
            inferred_value = _diffusion_standard_value(standard_fields, key)
            raw_entry = {
                "value": inferred_value,
                "confidence": getattr(record, "confidence", None),
                "evidence": inferred_evidence,
            }
            if inferred_value not in (None, "", [], {}):
                raw_entry["grounding_mode"] = "inferred"
                raw_entry["grounding_note"] = "Derived by diffusion.standard.v1 from extracted system/evidence."
        normalized_fields[key] = {
            **raw_entry,
            "value": raw_entry.get("value", _diffusion_field_value_from_record(record, key)),
            "confidence": raw_entry.get("confidence", record.confidence),
            "evidence": raw_entry.get("evidence"),
            "status": _field_grounding_status(raw_entry),
            "grounding_mode": raw_entry.get("grounding_mode"),
            "grounding_note": raw_entry.get("grounding_note"),
            "review_state": raw_entry.get("review_state"),
            "review_note": raw_entry.get("review_note"),
        }

    normalized_fields["conditions"] = _build_diffusion_conditions_entry(field_map, record)
    confidence_details = calculate_confidence_details(
        {
            "extractor_type": "diffusion",
            "system_name": getattr(record, "system_name", None),
            "ionic_liquid": getattr(record, "ionic_liquid", None),
            "d_total": getattr(record, "d_total", None) or getattr(record, "D_total", None),
            "d_cation": getattr(record, "d_cation", None) or getattr(record, "D_cation", None),
            "d_anion": getattr(record, "d_anion", None) or getattr(record, "D_anion", None),
            "d_unit": getattr(record, "d_unit", None) or getattr(record, "D_unit", None),
            "temperature_value": getattr(record, "temperature_value", None),
            "confinement_scale_value": getattr(record, "confinement_scale_value", None),
            "diffusion_standard_fields": standard_fields,
            "field_evidence_json": normalized_fields,
            "review_status": getattr(record, "review_status", None),
            "model_confidence": getattr(record, "confidence", None),
        }
    )

    return {
        "record_id": record.id,
        "literature_id": record.literature_id,
        "sample_id": None,
        "series_id": None,
        "extractor_type": "diffusion",
        "review_entity_type": review_entity_type,
        "reviewEntityType": review_entity_type,
        "promoted_record_id": promoted_record_id,
        "promotedRecordId": promoted_record_id,
        "promoted_at": promoted_at_text,
        "promotedAt": promoted_at_text,
        "review_status": record.review_status,
        "record_origin": record.record_origin,
        "assembly_notes": getattr(record, "assembly_notes", None),
        "required_fields": list(_DIFFUSION_CORE_FACT_KEYS),
        "diffusion_standard_fields": standard_fields,
        "diffusionStandardFields": standard_fields,
        "diffusion_normalization": normalization,
        "diffusionNormalization": normalization,
        "fields": normalized_fields,
        "confidence": float(confidence_details.get("score") or 0.0),
        "confidence_details": confidence_details,
    }


def _diffusion_record_response_payload(record: Any) -> dict[str, Any]:
    response = serialize_diffusion_row_for_response(
        {
            **_diffusion_row_dict_from_record(record),
            "provider": getattr(record, "provider", None),
            "prompt_version": getattr(record, "prompt_version", None),
            "raw_model_output": getattr(record, "raw_model_output", None),
            "field_evidence_json": _parse_field_evidence_map(getattr(record, "field_evidence_json", None)),
            "review_status": getattr(record, "review_status", None),
            "record_origin": getattr(record, "record_origin", None),
            "assembly_notes": getattr(record, "assembly_notes", None),
        },
        row_id=getattr(record, "id", None),
    )
    review_entity_type = "candidate" if isinstance(record, DiffusionCandidate) else "record"
    response["literature_id"] = getattr(record, "literature_id", None)
    response["literatureId"] = getattr(record, "literature_id", None)
    response["extractor_type"] = "diffusion"
    response["review_entity_type"] = review_entity_type
    response["reviewEntityType"] = review_entity_type
    promoted_record_id = getattr(record, "promoted_record_id", None)
    if promoted_record_id:
        response["promoted_record_id"] = promoted_record_id
        response["promotedRecordId"] = promoted_record_id
    return response


def _field_has_review_value(entry: dict[str, Any]) -> bool:
    return isinstance(entry, dict) and entry.get("value") not in (None, "", [], {})


def _field_has_source_evidence(entry: dict[str, Any]) -> bool:
    if not isinstance(entry, dict):
        return False
    status = _field_grounding_status(entry)
    return status in {"grounded", "partial"}


def _diffusion_coefficient_entries(field_map: dict[str, Any]) -> list[dict[str, Any]]:
    return [
        field_map.get(key) or {}
        for key in _DIFFUSION_COEFFICIENT_FIELD_KEYS
        if isinstance(field_map.get(key), dict)
    ]


def _diffusion_missing_required_fields(field_map: dict[str, Any]) -> list[str]:
    missing: list[str] = []
    if not _field_has_review_value(field_map.get("system_name") or {}):
        missing.append("system_name")
    if not _field_has_review_value(field_map.get("diffusing_ion") or {}):
        missing.append("diffusing_ion")

    coefficient_entries = _diffusion_coefficient_entries(field_map)
    coefficient_value_entries = [entry for entry in coefficient_entries if _field_has_review_value(entry)]
    if not coefficient_value_entries:
        missing.append("diffusion_coefficient")
    if not _field_has_review_value(field_map.get("d_unit") or {}):
        missing.append("d_unit")
    if coefficient_value_entries and not any(_field_has_source_evidence(entry) for entry in coefficient_value_entries):
        missing.append("source_evidence")
    return missing


def _diffusion_has_blocking_flag(field_map: dict[str, Any]) -> bool:
    if any(
        str((field_map.get(key) or {}).get("review_state") or "").strip().lower() == "flagged"
        for key in ("system_name", "diffusing_ion", "d_unit")
    ):
        return True
    coefficient_entries = _diffusion_coefficient_entries(field_map)
    coefficient_candidates = [
        entry
        for entry in coefficient_entries
        if _field_has_review_value(entry)
    ]
    if not coefficient_candidates:
        return False
    return all(str((entry or {}).get("review_state") or "").strip().lower() == "flagged" for entry in coefficient_candidates)


def _diffusion_approval_blockers(record: Any, review_payload: dict[str, Any]) -> list[str]:
    return diffusion_normalization_blockers(
        _diffusion_row_dict_from_record(record),
        confidence_score=review_payload.get("confidence"),
    )


def _recompute_diffusion_review_status(record: Any, field_map: dict[str, Any], *, approved: bool = False) -> None:
    review_field_map = _build_diffusion_field_evidence_payload(record)["fields"]
    missing_required = _diffusion_missing_required_fields(review_field_map)
    if approved:
        record.review_status = "approved"
        record.assembly_notes = None
        return
    if _diffusion_has_blocking_flag(review_field_map):
        record.review_status = "flagged"
        record.assembly_notes = "Flagged fields require reviewer attention"
        return
    if missing_required:
        record.review_status = "needs_evidence"
        record.assembly_notes = f"Missing field evidence for: {', '.join(missing_required)}"
        return
    record.review_status = "pending_review"
    record.assembly_notes = None


def _copy_diffusion_candidate_to_final_record(
    candidate: DiffusionCandidate,
    record: DiffusionRecord | None = None,
) -> DiffusionRecord:
    target = record or DiffusionRecord(literature_id=candidate.literature_id)
    target.literature_id = candidate.literature_id
    target.system_name = candidate.system_name
    target.confinement_material_class = candidate.confinement_material_class
    target.confinement_geometry_class = candidate.confinement_geometry_class
    target.surface_functional_groups = candidate.surface_functional_groups
    target.confinement_dimensionality = candidate.confinement_dimensionality
    target.ionic_liquid = candidate.ionic_liquid
    target.d_total = candidate.d_total
    target.d_cation = candidate.d_cation
    target.d_anion = candidate.d_anion
    target.d_unit = candidate.d_unit
    target.temperature_value = candidate.temperature_value
    target.confinement_scale_value = candidate.confinement_scale_value
    target.confinement_scale_unit = candidate.confinement_scale_unit
    target.source = candidate.source
    target.source_page = candidate.source_page
    target.source_bbox = candidate.source_bbox
    target.evidence = candidate.evidence
    target.provider = candidate.provider
    target.prompt_version = candidate.prompt_version
    target.raw_model_output = candidate.raw_model_output
    target.field_evidence_json = candidate.field_evidence_json
    target.review_status = candidate.review_status
    target.record_origin = "review_promoted_candidate"
    target.assembly_notes = candidate.assembly_notes
    target.confidence = candidate.confidence
    target.novel_features_json = candidate.novel_features_json
    target.smiles = candidate.smiles
    target.rdkit_features_json = candidate.rdkit_features_json
    return target


def _build_diffusion_highlight_queries(record: Any) -> list[str]:
    queries: list[str] = []
    evidence = str(getattr(record, "evidence", None) or "").strip()
    if len(evidence) >= 5:
        queries.append(evidence[:80] if len(evidence) > 80 else evidence)
    for field_value in (
        getattr(record, "system_name", None),
        getattr(record, "ionic_liquid", None),
        getattr(record, "confinement_material_class", None),
        getattr(record, "confinement_geometry_class", None),
        getattr(record, "surface_functional_groups", None),
    ):
        value = str(field_value or "").strip()
        if len(value) >= 2:
            queries.append(value)
    for numeric_value in (getattr(record, "d_total", None), getattr(record, "d_cation", None), getattr(record, "d_anion", None)):
        formatted = _format_diffusion_numeric(numeric_value)
        if formatted not in (None, "", []):
            queries.append(str(formatted))
    deduped: list[str] = []
    seen: set[str] = set()
    for item in queries:
        key = str(item or "").strip().lower()
        if not key or key in seen:
            continue
        seen.add(key)
        deduped.append(str(item).strip())
    return deduped


def _raise_internal_error(action: str, exc: Exception) -> None:
    logger.exception("%s failed", action)
    raise HTTPException(status_code=500, detail=f"{action} failed.") from exc

# 涓存椂瀛樺偍鎻愬彇鐨勬暟鎹?
extracted_data_store: dict = {}
uploaded_files_store: dict = {}

# Ensure temp directory exists
TEMP_UPLOAD_DIR = "temp_uploads"
os.makedirs(TEMP_UPLOAD_DIR, exist_ok=True)


@router.get("/pdf/{literature_id}")
async def serve_pdf(
    literature_id: int,
    db: AsyncSession = Depends(get_db),
    principal: AuthPrincipal = Depends(get_current_principal),
):
    """Serve the uploaded PDF file for the Source Grounding PDF viewer."""
    literature = await require_literature_access(db, principal, literature_id)

    pdf_path = _resolve_existing_path(literature.file_path)
    if not pdf_path:
        raise HTTPException(status_code=404, detail="PDF file not available on disk")

    return FileResponse(
        path=pdf_path,
        media_type="application/pdf",
        headers={
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.get("/pdf/{literature_id}/content")
async def serve_pdf_content(
    literature_id: int,
    db: AsyncSession = Depends(get_db),
    principal: AuthPrincipal = Depends(get_current_principal),
):
    """Serve the uploaded PDF file as base64 JSON to avoid browser/extension PDF interception."""
    literature = await require_literature_access(db, principal, literature_id)

    pdf_path = _resolve_existing_path(literature.file_path)
    if not pdf_path:
        raise HTTPException(status_code=404, detail="PDF file not available on disk")

    try:
        with open(pdf_path, "rb") as f:
            pdf_bytes = f.read()
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"Failed to read PDF file: {exc}") from exc

    return {
        "filename": os.path.basename(pdf_path),
        "content_type": "application/pdf",
        "data_b64": base64.b64encode(pdf_bytes).decode("ascii"),
    }


@router.get("/pdf/{literature_id}/text")
async def serve_pdf_text(
    literature_id: int,
    db: AsyncSession = Depends(get_db),
    principal: AuthPrincipal = Depends(get_current_principal),
):
    """Return selectable PDF text for the Library paper detail view."""
    literature = await require_literature_access(db, principal, literature_id)

    pdf_path = _resolve_existing_path(literature.file_path)
    if not pdf_path:
        raise HTTPException(status_code=404, detail="PDF file not available on disk")

    try:
        from utils.pdf_utils import extract_pdf_plain_text_pages

        page_count, text = extract_pdf_plain_text_pages(pdf_path)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to read PDF text: {exc}") from exc

    return {
        "literature_id": literature_id,
        "page_count": page_count,
        "text": text,
    }


@router.get("/pdf/{literature_id}/page-image")
async def serve_pdf_page_image(
    literature_id: int,
    page: int = Query(1, ge=1),
    scale: float = Query(1.6, ge=0.6, le=3.0),
    db: AsyncSession = Depends(get_db),
    principal: AuthPrincipal = Depends(get_current_principal),
):
    """Render one original PDF page as an image for admin crop correction."""
    literature = await require_literature_access(db, principal, literature_id)

    pdf_path = _resolve_existing_path(literature.file_path)
    if not pdf_path:
        raise HTTPException(status_code=404, detail="PDF file not available on disk")

    try:
        import fitz

        with fitz.open(pdf_path) as doc:
            if page < 1 or page > len(doc):
                raise HTTPException(status_code=422, detail="Page is outside the PDF page range.")
            pdf_page = doc[page - 1]
            pix = pdf_page.get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=False)
            page_rect = pdf_page.rect
            return {
                "literature_id": literature_id,
                "page": page,
                "page_width": round(float(page_rect.width), 2),
                "page_height": round(float(page_rect.height), 2),
                "scale": scale,
                "image_b64": base64.b64encode(pix.tobytes("png")).decode("ascii"),
            }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to render PDF page: {exc}") from exc


@router.get("/pdf/{literature_id}/bbox-preview")
async def serve_pdf_bbox_preview(
    literature_id: int,
    page: int = Query(1, ge=1),
    bbox: str = Query(..., description="Comma-separated PDF bbox: x0,y0,x1,y1"),
    mode: str = Query("region", pattern="^(region|page)$"),
    context: str = Query("normal", pattern="^(normal|wide)$"),
    db: AsyncSession = Depends(get_db),
    principal: AuthPrincipal = Depends(get_current_principal),
):
    """Render a highlighted evidence preview for a PDF bbox."""
    from utils.pdf_utils import (
        render_page_preview_with_bbox_to_base64,
        render_region_preview_with_highlight_to_base64,
    )

    literature = await require_literature_access(db, principal, literature_id)
    pdf_path = _resolve_existing_path(literature.file_path)
    if not pdf_path:
        raise HTTPException(status_code=404, detail="PDF file not available on disk")

    parsed_bbox = _parse_bbox_json(bbox)
    if parsed_bbox is None:
        raise HTTPException(status_code=422, detail="bbox must contain four numeric values.")

    try:
        import fitz

        with fitz.open(pdf_path) as doc:
            if page < 1 or page > len(doc):
                raise HTTPException(status_code=422, detail="Page is outside the PDF page range.")
            clamped_bbox = _clamp_pdf_highlight_bbox(doc[page - 1].rect, parsed_bbox)

        if mode == "page":
            image_b64 = render_page_preview_with_bbox_to_base64(
                pdf_path=pdf_path,
                page_num=page,
                bbox=clamped_bbox,
                dpi=150,
                max_width=1200,
            )
        else:
            x0, y0, x1, y1 = clamped_bbox
            box_w = max(1.0, abs(x1 - x0))
            box_h = max(1.0, abs(y1 - y0))
            if context == "wide":
                pad_x = max(180.0, box_w * 10.0)
                pad_y = max(80.0, box_h * 12.0)
            else:
                pad_x = max(60.0, box_w * 5.5)
                pad_y = max(34.0, box_h * 7.0)
            region_bbox = [x0 - pad_x, y0 - pad_y, x1 + pad_x, y1 + pad_y]
            image_b64 = render_region_preview_with_highlight_to_base64(
                pdf_path=pdf_path,
                page_num=page,
                region_bbox=region_bbox,
                highlight_bbox=clamped_bbox,
                padding=12 if context == "wide" else 8,
                dpi=170,
                max_width=1400 if context == "wide" else 1100,
            )

        if not image_b64:
            raise HTTPException(status_code=404, detail="Unable to render evidence preview.")
        return {
            "literature_id": literature_id,
            "page": page,
            "bbox": clamped_bbox,
            "mode": mode,
            "context": context,
            "image_b64": image_b64,
        }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to render evidence preview: {exc}") from exc


def _clamp_pdf_highlight_bbox(page_rect: Any, bbox: list[float], *, min_size: float = 12.0) -> list[float]:
    parsed = _parse_bbox_json(bbox)
    if parsed is None:
        raise HTTPException(status_code=422, detail="bbox must contain four numeric values.")
    x0, y0, x1, y1 = parsed

    def clamp_interval(start: float, end: float, lower: float, upper: float) -> tuple[float, float]:
        lo = max(float(lower), min(float(upper), min(start, end)))
        hi = max(float(lower), min(float(upper), max(start, end)))
        page_span = max(0.0, float(upper) - float(lower))
        target_size = min(float(min_size), page_span) if page_span else 0.0
        if target_size and hi - lo < target_size:
            center = (lo + hi) / 2.0
            lo = center - target_size / 2.0
            hi = center + target_size / 2.0
            if lo < lower:
                hi += float(lower) - lo
                lo = float(lower)
            if hi > upper:
                lo -= hi - float(upper)
                hi = float(upper)
            lo = max(float(lower), lo)
            hi = min(float(upper), hi)
        return lo, hi

    x0, x1 = clamp_interval(x0, x1, page_rect.x0, page_rect.x1)
    y0, y1 = clamp_interval(y0, y1, page_rect.y0, page_rect.y1)
    return [round(x0, 2), round(y0, 2), round(x1, 2), round(y1, 2)]


def _clamp_pdf_crop_bbox(page_rect: Any, bbox: list[float]) -> list[float]:
    parsed = _parse_bbox_json(bbox)
    if parsed is None:
        raise HTTPException(status_code=422, detail="bbox must contain four numeric values.")
    x0, y0, x1, y1 = parsed
    x0 = max(float(page_rect.x0), min(float(page_rect.x1), x0))
    y0 = max(float(page_rect.y0), min(float(page_rect.y1), y0))
    x1 = max(float(page_rect.x0), min(float(page_rect.x1), x1))
    y1 = max(float(page_rect.y0), min(float(page_rect.y1), y1))
    if x1 - x0 < 12 or y1 - y0 < 12:
        raise HTTPException(status_code=422, detail="Crop area is too small.")
    return [round(x0, 2), round(y0, 2), round(x1, 2), round(y1, 2)]


def _render_pdf_crop_image_b64(pdf_path: str, page_number: int, bbox: list[float]) -> tuple[str, list[float]]:
    import fitz

    with fitz.open(pdf_path) as doc:
        if page_number < 1 or page_number > len(doc):
            raise HTTPException(status_code=422, detail="Crop page is outside the PDF page range.")
        page = doc[page_number - 1]
        clamped_bbox = _clamp_pdf_crop_bbox(page.rect, bbox)
        pix = page.get_pixmap(matrix=fitz.Matrix(1.7, 1.7), clip=fitz.Rect(clamped_bbox), alpha=False)
        return base64.b64encode(pix.tobytes("png")).decode("ascii"), clamped_bbox


@router.get("/pdf/{literature_id}/figures")
async def serve_pdf_figure_previews(
    literature_id: int,
    limit: int = Query(8, ge=1, le=20),
    db: AsyncSession = Depends(get_db),
    principal: AuthPrincipal = Depends(get_current_principal),
):
    """Return lightweight page previews around Table/Figure captions."""
    literature = await require_literature_access(db, principal, literature_id)

    pdf_path = _resolve_existing_path(literature.file_path)
    if not pdf_path:
        raise HTTPException(status_code=404, detail="PDF file not available on disk")

    items: list[dict[str, Any]] = []
    seen_targets: set[tuple[int, str]] = set()
    override_result = await db.execute(
        select(FigureCropOverride).where(FigureCropOverride.literature_id == literature_id)
    )
    crop_overrides = list(override_result.scalars().all())

    try:
        import fitz
        from PIL import Image

        def _clean_caption(value: str) -> str:
            return " ".join(str(value or "").split()).strip()

        def _block_rect(block: Any) -> Any:
            return fitz.Rect(float(block[0]), float(block[1]), float(block[2]), float(block[3]))

        def _line_caption_has_nearby_visual(page: Any, label: str, caption_rect: Any) -> bool:
            if label.lower().startswith("table"):
                return False
            for block in page.get_text("dict").get("blocks", []) or []:
                if block.get("type") != 1:
                    continue
                rect = fitz.Rect(block.get("bbox"))
                if rect.width < 35 or rect.height < 25:
                    continue
                vertical_gap = caption_rect.y0 - rect.y1
                horizontal_overlap = max(0.0, min(rect.x1, caption_rect.x1) - max(rect.x0, caption_rect.x0))
                if -8 <= vertical_gap <= 85 and horizontal_overlap >= min(rect.width, caption_rect.width) * 0.35:
                    return True
            drawing_hits = 0
            for drawing in page.get_drawings():
                rect = drawing.get("rect")
                if not rect or rect.width < 18 or rect.height < 6:
                    continue
                vertical_gap = caption_rect.y0 - rect.y1
                horizontal_overlap = max(0.0, min(rect.x1, caption_rect.x1) - max(rect.x0, caption_rect.x0))
                if -8 <= vertical_gap <= 95 and horizontal_overlap >= min(rect.width, caption_rect.width) * 0.25:
                    drawing_hits += 1
                    if drawing_hits >= 2:
                        return True
            return False

        def _find_caption_blocks(page: Any) -> list[tuple[str, str, Any]]:
            matches: list[tuple[str, str, Any]] = []
            seen_labels: set[str] = set()

            def _add_caption(match: dict[str, Any], rect: Any) -> None:
                label = str(match["label"])
                key = label.lower()
                if key in seen_labels:
                    return
                seen_labels.add(key)
                matches.append((label, str(match["caption"]), rect))

            for block in page.get_text("blocks") or []:
                if len(block) < 5:
                    continue
                text = _clean_caption(block[4])
                if not text:
                    continue
                match = _match_pdf_caption_start(text)
                if not match:
                    continue
                _add_caption(match, _block_rect(block))

            for block in page.get_text("dict").get("blocks", []) or []:
                if block.get("type") != 0:
                    continue
                for line in block.get("lines", []) or []:
                    line_text = _clean_caption("".join(str(span.get("text", "")) for span in line.get("spans", []) or []))
                    if not line_text:
                        continue
                    line_rect = fitz.Rect(line.get("bbox"))
                    preliminary_match = _match_pdf_caption_start(line_text)
                    if not preliminary_match:
                        continue
                    match = _match_pdf_caption_start(
                        line_text,
                        line_level=True,
                        has_nearby_visual=_line_caption_has_nearby_visual(page, str(preliminary_match["label"]), line_rect),
                    )
                    if not match:
                        continue
                    _add_caption(match, line_rect)
            matches.sort(key=lambda item: (float(item[2].y0), float(item[2].x0)))
            return matches

        def _union_rect(rects: list[Any]) -> Any | None:
            if not rects:
                return None
            rect = fitz.Rect(rects[0])
            for other in rects[1:]:
                rect |= other
            return rect

        def _same_caption_column(rect: Any, caption_rect: Any, margin: float = 12) -> bool:
            left = max(rect.x0, caption_rect.x0 - margin)
            right = min(rect.x1, caption_rect.x1 + margin)
            overlap = max(0, right - left)
            required = min(rect.width, caption_rect.width) * 0.22
            return overlap >= required

        raster_cache: dict[int, tuple[Any, float]] = {}

        def _page_binary_image(page: Any) -> tuple[Any, float]:
            key = int(getattr(page, "number", 0))
            cached = raster_cache.get(key)
            if cached:
                return cached
            scale = 2.0
            pix = page.get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=False)
            mode = "RGB" if pix.n >= 3 else "L"
            image = Image.frombytes(mode, (pix.width, pix.height), pix.samples).convert("L")
            binary = image.point(lambda value: 1 if value < 248 else 0, mode="L")
            raster_cache[key] = (binary, scale)
            return binary, scale

        def _column_window(page_rect: Any, caption_rect: Any) -> tuple[float, float]:
            margin = 34.0
            page_width = page_rect.width
            page_mid = page_rect.x0 + page_width / 2
            if caption_rect.width >= page_width * 0.55:
                return page_rect.x0 + margin, page_rect.x1 - margin
            center = (caption_rect.x0 + caption_rect.x1) / 2
            gutter = 10.0
            if center < page_mid:
                return page_rect.x0 + margin, page_mid - gutter
            return page_mid + gutter, page_rect.x1 - margin

        def _image_block_clip(page: Any, caption_rect: Any) -> Any | None:
            page_rect = page.rect
            x0, x1 = _column_window(page_rect, caption_rect)
            candidates: list[Any] = []
            for block in page.get_text("dict").get("blocks", []) or []:
                if block.get("type") != 1:
                    continue
                rect = fitz.Rect(block.get("bbox"))
                if rect.width < 35 or rect.height < 25 or rect.get_area() < 1400:
                    continue
                if rect.y1 > caption_rect.y0 + 8 or rect.y1 < caption_rect.y0 - 520:
                    continue
                overlap = max(0, min(rect.x1, x1) - max(rect.x0, x0))
                if overlap < rect.width * 0.55:
                    continue
                candidates.append(rect)
            if not candidates:
                return None
            candidates.sort(key=lambda rect: (caption_rect.y0 - rect.y1, -rect.get_area()))
            nearest_bottom = candidates[0].y1
            grouped = [
                rect for rect in candidates
                if abs(rect.y1 - nearest_bottom) < 160
            ]
            visual_rect = _union_rect(grouped)
            if not visual_rect:
                return None
            combined = visual_rect | caption_rect
            return fitz.Rect(
                max(page_rect.x0, combined.x0 - 12),
                max(page_rect.y0, combined.y0 - 12),
                min(page_rect.x1, combined.x1 + 12),
                min(page_rect.y1, combined.y1 + 12),
            )

        def _segments_from_binary(binary: Any, min_ink: int) -> list[tuple[int, int, int]]:
            width, height = binary.size
            raw = binary.tobytes()
            segments: list[tuple[int, int, int]] = []
            start: int | None = None
            ink_total = 0
            for y in range(height):
                row_ink = sum(raw[y * width:(y + 1) * width])
                if row_ink >= min_ink:
                    if start is None:
                        start = y
                        ink_total = 0
                    ink_total += row_ink
                elif start is not None:
                    if y - start >= 3 and ink_total >= min_ink * 3:
                        segments.append((start, y - 1, ink_total))
                    start = None
                    ink_total = 0
            if start is not None and height - start >= 3 and ink_total >= min_ink * 3:
                segments.append((start, height - 1, ink_total))
            return segments

        def _merge_segments_for_table(segments: list[tuple[int, int, int]], scale: float) -> tuple[int, int] | None:
            if not segments:
                return None
            max_gap = int(26 * scale)
            start, end, _ink = segments[0]
            for next_start, next_end, _next_ink in segments[1:]:
                if next_start - end > max_gap:
                    break
                end = max(end, next_end)
            return start, end

        def _merge_segments_for_figure(segments: list[tuple[int, int, int]], scale: float) -> tuple[int, int] | None:
            return _merge_figure_preview_segments(segments, scale)

        def _visual_segment_clip(page: Any, label: str, caption_rect: Any) -> Any | None:
            page_rect = page.rect
            is_table = label.lower().startswith("table")
            x0, x1 = _column_window(page_rect, caption_rect)
            if is_table:
                search_rect = fitz.Rect(
                    x0,
                    min(page_rect.y1, caption_rect.y1 + 1),
                    x1,
                    min(page_rect.y1 - 28, caption_rect.y1 + 260),
                )
            else:
                search_rect = fitz.Rect(
                    x0,
                    max(page_rect.y0 + 22, caption_rect.y0 - 470),
                    x1,
                    max(page_rect.y0 + 24, caption_rect.y0 - 2),
                )
            if search_rect.width < 20 or search_rect.height < 20:
                return None

            binary, scale = _page_binary_image(page)
            crop_box = (
                max(0, int(search_rect.x0 * scale)),
                max(0, int(search_rect.y0 * scale)),
                min(binary.width, int(search_rect.x1 * scale)),
                min(binary.height, int(search_rect.y1 * scale)),
            )
            if crop_box[2] <= crop_box[0] or crop_box[3] <= crop_box[1]:
                return None
            crop = binary.crop(crop_box)
            min_ink = max(8, int(crop.width * (0.012 if is_table else 0.018)))
            segments = _segments_from_binary(crop, min_ink)
            merged = _merge_segments_for_table(segments, scale) if is_table else _merge_segments_for_figure(segments, scale)
            if not merged:
                return None
            y_start, y_end = merged
            selected = crop.crop((0, max(0, y_start - int(4 * scale)), crop.width, min(crop.height, y_end + int(5 * scale))))
            bbox = selected.getbbox()
            if not bbox:
                return None
            sx0, sy0, sx1, sy1 = bbox
            visual_rect = fitz.Rect(
                search_rect.x0 + sx0 / scale,
                search_rect.y0 + (max(0, y_start - int(4 * scale)) + sy0) / scale,
                search_rect.x0 + sx1 / scale,
                search_rect.y0 + (max(0, y_start - int(4 * scale)) + sy1) / scale,
            )
            if visual_rect.width < 20 or visual_rect.height < 12:
                return None
            combined = visual_rect | caption_rect
            pad_x = 10 if is_table else 12
            pad_y_top = 8 if is_table else 10
            pad_y_bottom = 12
            preview_rect = fitz.Rect(
                max(page_rect.x0, combined.x0 - pad_x),
                max(page_rect.y0, combined.y0 - pad_y_top),
                min(page_rect.x1, combined.x1 + pad_x),
                min(page_rect.y1, combined.y1 + pad_y_bottom),
            )
            if is_table:
                body_text_clips = []
                caption_tuple = _rect_tuple(caption_rect)
                for block in page.get_text("blocks") or []:
                    if len(block) < 5 or not _clean_caption(block[4]):
                        continue
                    rect = _rect_tuple(_block_rect(block))
                    if _rect_intersection_area(rect, caption_tuple) > min(_rect_area(rect), _rect_area(caption_tuple)) * 0.55:
                        continue
                    body_text_clips.append(rect)
                return fitz.Rect(_trim_pdf_table_preview_clip_at_body_text(
                    caption_tuple,
                    _rect_tuple(preview_rect),
                    body_text_clips,
                ))
            return preview_rect

        def _fixed_height_clip(page: Any, caption_rect: Any) -> Any:
            page_rect = page.rect
            fallback_height = 310
            return fitz.Rect(
                max(page_rect.x0, caption_rect.x0 - 18),
                max(page_rect.y0, caption_rect.y0 - fallback_height),
                min(page_rect.x1, caption_rect.x1 + 18),
                min(page_rect.y1, caption_rect.y1 + 18),
            )

        def _candidate_context_clips(
            page: Any,
            caption_rect: Any,
            page_captions: list[tuple[str, str, Any]],
        ) -> tuple[list[tuple[float, float, float, float]], list[tuple[float, float, float, float]]]:
            caption_clips = [_rect_tuple(rect) for _label, _caption, rect in page_captions]
            caption_clip = _rect_tuple(caption_rect)
            other_caption_clips = [rect for rect in caption_clips if rect != caption_clip]
            body_text_clips: list[tuple[float, float, float, float]] = []
            for block in page.get_text("blocks") or []:
                if len(block) < 5 or not _clean_caption(block[4]):
                    continue
                rect = _rect_tuple(_block_rect(block))
                if any(
                    _rect_intersection_area(rect, caption) > min(_rect_area(rect), _rect_area(caption)) * 0.55
                    for caption in caption_clips
                ):
                    continue
                body_text_clips.append(rect)
            return body_text_clips, other_caption_clips

        def _choose_preview_rect(
            page: Any,
            caption_rect: Any,
            candidates: list[dict[str, Any]],
            page_captions: list[tuple[str, str, Any]],
        ) -> Any | None:
            if not candidates:
                return None
            body_text_clips, other_caption_clips = _candidate_context_clips(page, caption_rect, page_captions)
            selected = _choose_pdf_figure_preview_candidate(
                _rect_tuple(page.rect),
                _rect_tuple(caption_rect),
                candidates,
                body_text_clips=body_text_clips,
                other_caption_clips=other_caption_clips,
            )
            return fitz.Rect(selected["clip"])

        def _clip_for_caption(
            page: Any,
            label: str,
            caption_rect: Any,
            page_captions: list[tuple[str, str, Any]],
        ) -> Any:
            page_rect = page.rect
            is_table = label.lower().startswith("table")
            candidates: list[dict[str, Any]] = []
            visual_clip = _visual_segment_clip(page, label, caption_rect)

            if not is_table:
                image_clip = _image_block_clip(page, caption_rect)
                if image_clip:
                    candidates.append({"strategy": "image_block", "clip": _rect_tuple(image_clip)})
                if visual_clip:
                    strategy = "visual_segment"
                    if image_clip and _prefer_visual_figure_preview_clip(tuple(image_clip), tuple(visual_clip)):
                        strategy = "visual_preferred"
                    candidates.append({"strategy": strategy, "clip": _rect_tuple(visual_clip)})
            elif visual_clip:
                candidates.append({"strategy": "table_visual", "clip": _rect_tuple(visual_clip)})

            text_blocks = [
                _block_rect(block)
                for block in (page.get_text("blocks") or [])
                if len(block) >= 5 and _clean_caption(block[4])
            ]

            if is_table:
                below_candidates = sorted(
                    [
                        rect for rect in text_blocks
                        if rect.y0 >= caption_rect.y1 - 4
                        and rect.y0 <= caption_rect.y1 + 150
                        and rect.x1 >= caption_rect.x0 - 24
                        and rect.x0 <= caption_rect.x1 + 24
                    ],
                    key=lambda rect: rect.y0,
                )
                below: list[Any] = []
                last_bottom = caption_rect.y1
                for rect in below_candidates:
                    # A larger vertical gap normally means the table ended and
                    # normal body text resumed. This keeps Table I from pulling
                    # the following paragraph into the crop.
                    if below and rect.y0 - last_bottom > 26:
                        break
                    below.append(rect)
                    last_bottom = max(last_bottom, rect.y1)
                table_rect = _union_rect([caption_rect, *below]) or caption_rect
                candidates.append({"strategy": "table_text_fallback", "clip": _rect_tuple(fitz.Rect(
                    max(page_rect.x0, table_rect.x0 - 18),
                    max(page_rect.y0, table_rect.y0 - 12),
                    min(page_rect.x1, table_rect.x1 + 18),
                    min(page_rect.y1, table_rect.y1 + 18),
                ))})
                selected = _choose_preview_rect(page, caption_rect, candidates, page_captions)
                if selected:
                    return selected
                return fitz.Rect(candidates[-1]["clip"])

            image_rects = [
                fitz.Rect(block.get("bbox"))
                for block in (page.get_text("dict").get("blocks", []) or [])
                if block.get("type") == 1
            ]
            above_images = [
                rect for rect in image_rects
                if rect.y1 <= caption_rect.y0 + 8
                and rect.y1 >= caption_rect.y0 - 430
                and _same_caption_column(rect, caption_rect)
            ]
            visual_rect = _union_rect(above_images)
            if not visual_rect:
                drawing_rects = [
                    drawing.get("rect")
                    for drawing in page.get_drawings()
                    if drawing.get("rect")
                    and drawing.get("rect").width > 24
                    and drawing.get("rect").height > 8
                    and drawing.get("rect").y1 <= caption_rect.y0 + 8
                    and drawing.get("rect").y1 >= caption_rect.y0 - 430
                    and _same_caption_column(drawing.get("rect"), caption_rect)
                ]
                visual_rect = _union_rect(drawing_rects)

            if visual_rect:
                combined = visual_rect | caption_rect
                candidates.append({"strategy": "drawing_or_image_fallback", "clip": _rect_tuple(fitz.Rect(
                    max(page_rect.x0, combined.x0 - 18),
                    max(page_rect.y0, combined.y0 - 14),
                    min(page_rect.x1, combined.x1 + 18),
                    min(page_rect.y1, combined.y1 + 18),
                ))})

            candidates.append({"strategy": "fixed_height_fallback", "clip": _rect_tuple(_fixed_height_clip(page, caption_rect))})
            selected = _choose_preview_rect(page, caption_rect, candidates, page_captions)
            if selected:
                return selected
            return _fixed_height_clip(page, caption_rect)

        def _visual_page_fallback_clip(page: Any) -> Any | None:
            page_rect = page.rect
            image_rects = [
                fitz.Rect(block.get("bbox"))
                for block in (page.get_text("dict").get("blocks", []) or [])
                if block.get("type") == 1
                and fitz.Rect(block.get("bbox")).width >= 35
                and fitz.Rect(block.get("bbox")).height >= 25
                and fitz.Rect(block.get("bbox")).get_area() >= 1400
            ]
            drawing_rects = [
                drawing.get("rect")
                for drawing in page.get_drawings()
                if drawing.get("rect")
                and drawing.get("rect").width >= 45
                and drawing.get("rect").height >= 14
                and drawing.get("rect").get_area() >= 900
            ]
            visual_rect = _union_rect(image_rects) or _union_rect(drawing_rects)
            if not visual_rect:
                return None

            page_area = max(1.0, float(page_rect.get_area()))
            if visual_rect.get_area() / page_area > 0.58:
                visual_candidates = image_rects or drawing_rects
                visual_candidates = sorted(visual_candidates, key=lambda rect: rect.get_area(), reverse=True)
                if not visual_candidates:
                    return None
                visual_rect = fitz.Rect(visual_candidates[0])

            if visual_rect.width < 45 or visual_rect.height < 28:
                return None
            return fitz.Rect(
                max(page_rect.x0, visual_rect.x0 - 18),
                max(page_rect.y0, visual_rect.y0 - 18),
                min(page_rect.x1, visual_rect.x1 + 18),
                min(page_rect.y1, visual_rect.y1 + 18),
            )

        with fitz.open(pdf_path) as doc:
            for page_index, page in enumerate(doc, start=1):
                if len(items) >= limit:
                    break
                page_caption_blocks = _find_caption_blocks(page)
                for label, caption, caption_rect in page_caption_blocks:
                    if len(items) >= limit:
                        break
                    target_key = (page_index, label.lower())
                    if target_key in seen_targets:
                        continue
                    seen_targets.add(target_key)
                    clip = _clip_for_caption(page, label, caption_rect, page_caption_blocks)
                    pix = page.get_pixmap(matrix=fitz.Matrix(1.7, 1.7), clip=clip, alpha=False)
                    clip_bbox = list(_rect_tuple(clip))
                    items.append({
                        "id": f"{label.lower().replace(' ', '-')}-page-{page_index}",
                        "label": label,
                        "page": page_index,
                        "caption": caption,
                        "image_b64": base64.b64encode(pix.tobytes("png")).decode("ascii"),
                        "clip_bbox": clip_bbox,
                        "algorithm_bbox": clip_bbox,
                        "page_width": round(float(page.rect.width), 2),
                        "page_height": round(float(page.rect.height), 2),
                        "algorithm_version": _FIGURE_CROP_ALGORITHM_VERSION,
                    })
            if not items:
                for page_index, page in enumerate(doc, start=1):
                    if len(items) >= limit:
                        break
                    clip = _visual_page_fallback_clip(page)
                    if not clip:
                        continue
                    pix = page.get_pixmap(matrix=fitz.Matrix(1.7, 1.7), clip=clip, alpha=False)
                    clip_bbox = list(_rect_tuple(clip))
                    items.append({
                        "id": f"visual-region-page-{page_index}",
                        "label": f"Figure page {page_index}",
                        "page": page_index,
                        "caption": f"Visual region detected on page {page_index}.",
                        "image_b64": base64.b64encode(pix.tobytes("png")).decode("ascii"),
                        "clip_bbox": clip_bbox,
                        "algorithm_bbox": clip_bbox,
                        "page_width": round(float(page.rect.width), 2),
                        "page_height": round(float(page.rect.height), 2),
                        "algorithm_version": f"{_FIGURE_CROP_ALGORITHM_VERSION}:fallback",
                    })
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to render figure previews: {exc}") from exc

    return {
        "literature_id": literature_id,
        "items": _sort_pdf_figure_preview_items(
            _apply_figure_crop_overrides_to_items(items, crop_overrides)
        )[:limit],
        "can_adjust_crops": is_admin(principal),
    }


@router.post("/pdf/{literature_id}/figure-overrides")
async def upsert_pdf_figure_crop_override(
    literature_id: int,
    payload: FigureCropOverridePayload,
    request: Request,
    db: AsyncSession = Depends(get_db),
    principal: AuthPrincipal = Depends(get_current_principal),
):
    """Admin-only crop correction saved as both display override and algorithm benchmark data."""
    literature = await require_literature_access(db, principal, literature_id, write=True)
    if not is_admin(principal):
        raise HTTPException(status_code=403, detail="Only administrators can adjust figure crops.")

    pdf_path = _resolve_existing_path(literature.file_path)
    if not pdf_path:
        raise HTTPException(status_code=404, detail="PDF file not available on disk")

    label = str(payload.label or "").strip()
    normalized_label = _normalize_figure_crop_label(label)
    if not normalized_label:
        raise HTTPException(status_code=422, detail="Figure label is required.")

    preview_image_b64, clamped_bbox = _render_pdf_crop_image_b64(pdf_path, int(payload.page), payload.bbox)
    algorithm_bbox = _parse_bbox_json(payload.algorithm_bbox) if payload.algorithm_bbox else None
    algorithm_version = str(payload.algorithm_version or _FIGURE_CROP_ALGORITHM_VERSION).strip() or _FIGURE_CROP_ALGORITHM_VERSION

    stmt = select(FigureCropOverride).where(
        FigureCropOverride.literature_id == literature_id,
        FigureCropOverride.normalized_label == normalized_label,
        FigureCropOverride.page == int(payload.page),
    )
    override = (await db.execute(stmt)).scalar_one_or_none()
    if override is None:
        override = FigureCropOverride(
            literature_id=literature_id,
            label=label,
            normalized_label=normalized_label,
            page=int(payload.page),
            caption=payload.caption,
            bbox_json=_bbox_json(clamped_bbox),
            algorithm_bbox_json=_bbox_json(algorithm_bbox) if algorithm_bbox else None,
            preview_image_b64=preview_image_b64,
            algorithm_version=algorithm_version,
            created_by_user_id=principal.user.id,
            updated_by_user_id=principal.user.id,
        )
        db.add(override)
    else:
        override.label = label
        override.caption = payload.caption
        override.bbox_json = _bbox_json(clamped_bbox)
        if algorithm_bbox:
            override.algorithm_bbox_json = _bbox_json(algorithm_bbox)
        override.preview_image_b64 = preview_image_b64
        override.algorithm_version = algorithm_version
        override.updated_by_user_id = principal.user.id

    await log_activity(
        db=db,
        user_id=principal.user.id,
        group_id=principal.group.id,
        action_type="adjust_figure_crop",
        action_detail={
            "literature_id": literature_id,
            "label": label,
            "page": int(payload.page),
            "bbox": clamped_bbox,
            "algorithm_bbox": algorithm_bbox,
            "algorithm_version": algorithm_version,
        },
        resource_type="literature",
        resource_id=literature_id,
        request=request,
    )
    await db.commit()
    await db.refresh(override)
    return {
        "success": True,
        "override": _serialize_figure_crop_override(override),
        "image_b64": preview_image_b64,
    }


@router.delete("/pdf/{literature_id}/figure-overrides/{override_id}")
async def delete_pdf_figure_crop_override(
    literature_id: int,
    override_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    principal: AuthPrincipal = Depends(get_current_principal),
):
    await require_literature_access(db, principal, literature_id, write=True)
    if not is_admin(principal):
        raise HTTPException(status_code=403, detail="Only administrators can reset figure crops.")

    override = await db.get(FigureCropOverride, override_id)
    if not override or override.literature_id != literature_id:
        raise HTTPException(status_code=404, detail="Figure crop override not found.")
    await db.delete(override)
    await log_activity(
        db=db,
        user_id=principal.user.id,
        group_id=principal.group.id,
        action_type="reset_figure_crop",
        action_detail={
            "literature_id": literature_id,
            "label": override.label,
            "page": override.page,
            "override_id": override_id,
        },
        resource_type="literature",
        resource_id=literature_id,
        request=request,
    )
    await db.commit()
    return {"success": True, "override_id": override_id}


@router.get("/pdf/{literature_id}/highlights")
async def get_pdf_highlights(
    literature_id: int,
    db: AsyncSession = Depends(get_db),
    principal: AuthPrincipal = Depends(get_current_principal),
):
    """
    Return bounding-box coordinates for extracted data text found in the PDF.
    Uses fitz (PyMuPDF) text search to locate each TribologyData record's text.
    """
    from utils.pdf_coords import find_text_coordinates, build_search_queries_for_record

    literature = await require_literature_access(db, principal, literature_id)

    pdf_path = _resolve_existing_path(literature.file_path)
    if not pdf_path:
        raise HTTPException(status_code=404, detail="PDF file not available on disk")

    # Get associated TribologyData records first
    from sqlalchemy import select as sa_select
    stmt = sa_select(TribologyDataDB).where(TribologyDataDB.literature_id == literature_id)
    result = await db.execute(stmt)
    records = result.scalars().all()

    search_terms = []
    if records:
        for rec in records:
            queries = build_search_queries_for_record(rec)
            search_terms.append({
                "id": f"{rec.id}",
                "queries": queries,
            })
    else:
        diffusion_stmt = sa_select(DiffusionCandidate).where(DiffusionCandidate.literature_id == literature_id)
        diffusion_result = await db.execute(diffusion_stmt)
        diffusion_records = diffusion_result.scalars().all()
        if not diffusion_records:
            return []
        for rec in diffusion_records:
            queries = _build_diffusion_highlight_queries(rec)
            if not queries:
                continue
            search_terms.append({
                "id": f"diffusion-{rec.id}",
                "queries": queries,
            })

    if not search_terms:
        return []

    # Run text search
    highlights = find_text_coordinates(pdf_path, search_terms)

    return highlights


def _build_candidate_pdf_evidence_payload(literature: Any, candidate: RecordCandidate, *, candidate_id: int) -> dict[str, Any]:
    import json as json_mod
    from utils.pdf_coords import (
        find_evidence_coordinates,
        find_figure_bbox,
        normalize_source_label,
        build_search_queries_for_record,
        find_text_coordinates,
    )
    from utils.pdf_utils import (
        crop_region_to_base64,
        render_page_preview_with_bbox_to_base64,
        render_region_preview_with_highlight_to_base64,
    )

    evidence_text = getattr(candidate, "evidence", None)
    evidence_page = getattr(candidate, "evidence_page", None)
    source_page = getattr(candidate, "source_page", None)
    evidence_bbox_raw = getattr(candidate, "evidence_bbox", None)
    source_label = _pick_visual_source_label(
        getattr(candidate, "source", None),
        getattr(candidate, "source_figure", None),
    )
    source_label_norm = normalize_source_label(source_label) or source_label
    source_key = str(source_label_norm or "").strip().lower()
    if source_key in ("", "text", "unknown"):
        source_type = "text"
    elif (
        source_key.startswith("fig")
        or source_key.startswith("table")
        or source_key.startswith("image")
        or source_key.startswith("plot")
        or bool(re.fullmatch(r"\d+[a-z]?", source_key))
    ):
        source_type = "visual"
    else:
        source_type = "unknown"
    is_table_source = bool(source_key.startswith("table"))

    pdf_path = _resolve_existing_path(literature.file_path)
    has_pdf = bool(pdf_path)
    image_b64 = None
    page_preview_b64 = None
    page = evidence_page or source_page
    bbox = None

    if evidence_bbox_raw:
        try:
            bbox = json_mod.loads(evidence_bbox_raw)
        except Exception:
            bbox = None

    if has_pdf:
        if source_type == "visual":
            bbox = None
            if source_label_norm and source_label_norm not in ("Text", "Unknown"):
                fig_page, fig_bbox = find_figure_bbox(
                    pdf_path,
                    source_label_norm,
                    page_hint=int(source_page) if source_page else (int(page) if page else None),
                    restrict_to_page_hint=bool(source_page) and not is_table_source,
                )
                if fig_page and fig_bbox:
                    page = fig_page
                    bbox = fig_bbox
                    panel_letter = _extract_panel_letter(source_label_norm)
                    bbox = _tighten_visual_bbox_by_panel(pdf_path, int(page), bbox, panel_letter)

            if page and bbox:
                if is_table_source:
                    bbox = _tighten_table_bbox_by_row(pdf_path, int(page), bbox, candidate)
                else:
                    focus_queries = _build_visual_focus_queries(candidate)
                    if focus_queries:
                        focus_hits = find_text_coordinates(
                            pdf_path,
                            [
                                {
                                    "id": "visual_focus",
                                    "queries": focus_queries,
                                    "page_hint": int(page),
                                    "restrict_to_page_hint": True,
                                    "anchor_bbox": bbox,
                                    "restrict_to_anchor_bbox": True,
                                }
                            ],
                        )
                        focus_hit = next(
                            (h for h in focus_hits if (h.get("w") or 0) > 0 and (h.get("h") or 0) > 0),
                            None,
                        )
                        if focus_hit:
                            fx0 = float(focus_hit["x"])
                            fy0 = float(focus_hit["y"])
                            fw = float(focus_hit["w"])
                            fh = float(focus_hit["h"])
                            bbox = [
                                max(0.0, fx0 - 22.0),
                                max(0.0, fy0 - 12.0),
                                fx0 + fw + 22.0,
                                fy0 + fh + 12.0,
                            ]

            if bbox and page:
                image_b64 = crop_region_to_base64(pdf_path, page, bbox)

            if not image_b64 and evidence_text and not is_table_source:
                ev_page, ev_bbox = find_evidence_coordinates(pdf_path, evidence_text, page_hint=page)
                if ev_page and ev_bbox:
                    page = ev_page
                    bbox = ev_bbox
                    image_b64 = crop_region_to_base64(pdf_path, page, bbox)
        else:
            if bbox and page:
                image_b64 = crop_region_to_base64(pdf_path, page, bbox)

            if not image_b64 and source_label_norm and source_label_norm not in ("Text", "Unknown"):
                fig_page, fig_bbox = find_figure_bbox(pdf_path, source_label_norm)
                if fig_page and fig_bbox:
                    page = fig_page
                    bbox = fig_bbox
                    image_b64 = crop_region_to_base64(pdf_path, page, bbox)

            if not image_b64 and evidence_text:
                ev_page, ev_bbox = find_evidence_coordinates(pdf_path, evidence_text, page_hint=page)
                if ev_page and ev_bbox:
                    page = ev_page
                    bbox = ev_bbox
                    image_b64 = crop_region_to_base64(pdf_path, page, bbox)

            if not image_b64:
                queries = build_search_queries_for_record(candidate)
                if queries:
                    hits = find_text_coordinates(
                        pdf_path,
                        [
                            {
                                "id": str(candidate_id),
                                "queries": queries,
                                "page_hint": int(page) if page else None,
                                "restrict_to_page_hint": bool(page),
                                "anchor_bbox": bbox if bbox and len(bbox) == 4 else None,
                            }
                        ],
                    )
                    first_hit = next(
                        (h for h in hits if (h.get("w") or 0) > 0 and (h.get("h") or 0) > 0),
                        None,
                    )
                    if first_hit:
                        page = first_hit["page"]
                        x0 = float(first_hit["x"])
                        y0 = float(first_hit["y"])
                        w = float(first_hit["w"])
                        h = float(first_hit["h"])
                        bbox = [x0, y0, x0 + w, y0 + h]
                        image_b64 = crop_region_to_base64(pdf_path, page, bbox)
                        if not evidence_text:
                            evidence_text = first_hit.get("matched_text")
                        if not source_label_norm:
                            source_label_norm = "Text"

    highlight_term_specs = []
    for term, semantic_type in [
        (getattr(candidate, "cof_raw", None), "cof"),
        (str(getattr(candidate, "cof_value", "")) if getattr(candidate, "cof_value", None) is not None else None, "cof"),
        (getattr(candidate, "lubricant", None), "lubricant"),
        (getattr(candidate, "material_name", None), "material"),
        (getattr(candidate, "temperature", None), "temperature"),
        (getattr(candidate, "potential", None), "potential"),
        (getattr(candidate, "water_content", None), "water_content"),
        (getattr(candidate, "speed_value", None), "speed"),
        (getattr(candidate, "shear_rate", None), "shear_rate"),
        (getattr(candidate, "load_value", None), "load"),
        (getattr(candidate, "surface_roughness", None), "surface_roughness"),
        (getattr(candidate, "film_thickness", None), "film_thickness"),
    ]:
        if term and str(term).strip():
            highlight_term_specs.append((str(term).strip(), semantic_type))
    seen_highlight_terms = set()
    deduped_specs = []
    for term, semantic_type in highlight_term_specs:
        if term in seen_highlight_terms:
            continue
        seen_highlight_terms.add(term)
        deduped_specs.append((term, semantic_type))
    highlight_term_specs = deduped_specs
    highlight_terms = [term for term, _ in highlight_term_specs]

    term_hits = []
    if has_pdf and highlight_terms:
        query_items = [
            {
                "id": f"term_{idx}",
                "queries": _build_term_query_variants(term),
                "semantic_type": semantic_type,
                "page_hint": int(page) if page else None,
                "restrict_to_page_hint": bool(page) and (
                    source_type != "visual" or (is_table_source and semantic_type in {"cof", "lubricant"})
                ),
                "max_page_distance": (
                    0
                    if (page and is_table_source and semantic_type in {"cof", "lubricant"})
                    else (3 if (page and source_type == "visual") else None)
                ),
                "anchor_bbox": (
                    bbox
                    if (
                        bbox
                        and len(bbox) == 4
                        and (
                            source_type != "visual"
                            or (is_table_source and semantic_type in {"cof", "lubricant"})
                        )
                    )
                    else None
                ),
                "restrict_to_anchor_bbox": bool(
                    bbox and len(bbox) == 4 and is_table_source and semantic_type in {"cof", "lubricant"}
                ),
            }
            for idx, (term, semantic_type) in enumerate(highlight_term_specs)
            if term and len(term.strip()) >= 2
        ]
        if query_items:
            hits = find_text_coordinates(pdf_path, query_items)
            id_to_spec = {
                f"term_{idx}": {
                    "term": term,
                    "semantic_type": semantic_type,
                }
                for idx, (term, semantic_type) in enumerate(highlight_term_specs)
                if term and len(term.strip()) >= 2
            }
            seen_terms = set()
            for hit in hits:
                spec = id_to_spec.get(hit.get("id", ""))
                term = str((spec or {}).get("term") or "").strip()
                semantic_type = str((spec or {}).get("semantic_type") or "").strip() or None
                if not term or term in seen_terms:
                    continue
                w = float(hit.get("w") or 0)
                h = float(hit.get("h") or 0)
                if w <= 0 or h <= 0:
                    continue
                x0 = float(hit.get("x") or 0)
                y0 = float(hit.get("y") or 0)
                matched_text = str(hit.get("matched_text") or "").strip()
                is_numeric_term = bool(re.search(r"\d", str(term)))
                if is_numeric_term and not _numeric_term_matches(str(term), matched_text):
                    continue
                term_key = _normalize_term_key(term)
                match_key = _normalize_term_key(matched_text)
                inferred = False if is_numeric_term else bool(match_key and term_key and match_key != term_key)
                term_hits.append(
                    {
                        "term": term,
                        "page": int(hit.get("page") or 1),
                        "bbox": [x0, y0, x0 + w, y0 + h],
                        "matched_text": matched_text or None,
                        "semantic_type": semantic_type,
                        "inferred": inferred,
                        "snippet_text": None,
                        "image_b64": None,
                    }
                )
                seen_terms.add(term)

        for term_hit in term_hits:
            bbox_hit = term_hit.get("bbox")
            page_hit = int(term_hit.get("page") or 0)
            if page_hit < 1 or not isinstance(bbox_hit, list) or len(bbox_hit) != 4:
                continue

            is_visual_hit = (
                source_type == "visual"
                and page is not None
                and int(page_hit) == int(page)
                and bbox is not None
                and len(bbox) == 4
            )
            if source_type == "visual":
                image_b64_hit = None
                if is_visual_hit and _visual_hit_prefers_figure_preview(
                    pdf_path=pdf_path,
                    page_num=page_hit,
                    figure_bbox=bbox,
                    hit_bbox=bbox_hit,
                ):
                    image_b64_hit = render_region_preview_with_highlight_to_base64(
                        pdf_path=pdf_path,
                        page_num=page_hit,
                        region_bbox=bbox,
                        highlight_bbox=bbox_hit,
                        padding=10,
                        dpi=160,
                        max_width=1100,
                    )
                else:
                    image_b64_hit = render_page_preview_with_bbox_to_base64(
                        pdf_path=pdf_path,
                        page_num=page_hit,
                        bbox=bbox_hit,
                        dpi=160,
                        max_width=1400,
                    )
                if image_b64_hit:
                    term_hit["image_b64"] = image_b64_hit

            snippet_text = _extract_text_snippet(
                pdf_path=pdf_path,
                page_num=page_hit,
                bbox=bbox_hit,
                fallback_term=str(term_hit.get("matched_text") or term_hit.get("term") or "").strip() or None,
                prefer_term_context=False,
            )
            if snippet_text:
                term_hit["snippet_text"] = snippet_text

    text_snippet = None
    if has_pdf and page and source_type != "visual":
        is_text_source = str(source_label_norm or "").strip().lower() in ("", "text")
        fallback_term = (
            getattr(candidate, "cof_raw", None)
            or evidence_text
            or (highlight_terms[0] if highlight_terms else None)
        )
        text_snippet = _extract_text_snippet(
            pdf_path=pdf_path,
            page_num=int(page),
            bbox=bbox,
            fallback_term=fallback_term,
            prefer_term_context=is_text_source,
        )
        if (not evidence_text or len(str(evidence_text).strip()) < 8) and text_snippet:
            evidence_text = text_snippet

        page_preview_b64 = render_page_preview_with_bbox_to_base64(
            pdf_path=pdf_path,
            page_num=int(page),
            bbox=bbox,
            dpi=120,
            max_width=900,
        )
    elif has_pdf and page:
        page_preview_b64 = render_page_preview_with_bbox_to_base64(
            pdf_path=pdf_path,
            page_num=int(page),
            bbox=bbox,
            dpi=160,
            max_width=1300,
        )

    return {
        "record_id": candidate_id,
        "evidence_text": evidence_text,
        "text_snippet": text_snippet,
        "highlight_terms": highlight_terms,
        "term_hits": term_hits,
        "source": source_label_norm,
        "source_type": source_type,
        "page": page,
        "bbox": bbox,
        "image_b64": image_b64,
        "page_preview_b64": page_preview_b64,
        "has_image": bool(image_b64),
        "has_pdf": has_pdf,
    }


@router.get("/pdf/{literature_id}/evidence/{record_id}")
async def get_record_evidence(
    literature_id: int,
    record_id: int,
    db: AsyncSession = Depends(get_db),
    principal: AuthPrincipal = Depends(get_current_principal),
):
    """
    Return evidence details for a specific TribologyData record:
    - Cropped base64 PNG image of the evidence region in the PDF
    - Verbatim evidence text quote
    - Page number and source label (Fig. X, Table Y, etc.)

    Falls back gracefully if no PDF is available on disk.
    """
    import json as json_mod
    from utils.pdf_coords import (
        find_evidence_coordinates,
        find_figure_bbox,
        normalize_source_label,
        build_search_queries_for_record,
        find_text_coordinates,
    )
    from utils.pdf_utils import (
        crop_region_to_base64,
        render_page_preview_with_bbox_to_base64,
        render_region_preview_with_highlight_to_base64,
    )

    # 1. Fetch record
    from sqlalchemy import select as sa_select
    literature = await require_literature_access(db, principal, literature_id)
    record = await require_record_access(db, principal, record_id)

    if record.literature_id != literature_id:
        raise HTTPException(status_code=404, detail="Record not found")

    evidence_text = getattr(record, 'evidence', None)
    evidence_page = getattr(record, 'evidence_page', None)
    source_page = getattr(record, 'source_page', None)
    evidence_bbox_raw = getattr(record, 'evidence_bbox', None)
    source_label = _pick_visual_source_label(
        getattr(record, "source", None),
        getattr(record, "source_figure", None),
    )
    source_label_norm = normalize_source_label(source_label) or source_label
    source_key = str(source_label_norm or "").strip().lower()
    if source_key in ("", "text", "unknown"):
        source_type = "text"
    elif (
        source_key.startswith("fig")
        or source_key.startswith("table")
        or source_key.startswith("image")
        or source_key.startswith("plot")
        or bool(re.fullmatch(r"\d+[a-z]?", source_key))
    ):
        source_type = "visual"
    else:
        source_type = "unknown"
    is_table_source = bool(source_key.startswith("table"))

    pdf_path = _resolve_existing_path(literature.file_path)
    has_pdf = bool(pdf_path)
    image_b64 = None
    page_preview_b64 = None
    page = evidence_page or source_page
    bbox = None

    if evidence_bbox_raw:
        try:
            bbox = json_mod.loads(evidence_bbox_raw)
        except Exception:
            bbox = None

    if has_pdf:
        # For figure/table/image evidence, prioritize figure-region localization first
        # to avoid drifting to unrelated text blocks on the same page.
        if source_type == "visual":
            # Ignore stale persisted text bbox for visual records; recompute from figure locator.
            bbox = None
            if source_label_norm and source_label_norm not in ("Text", "Unknown"):
                fig_page, fig_bbox = find_figure_bbox(
                    pdf_path,
                    source_label_norm,
                    page_hint=int(source_page) if source_page else (int(page) if page else None),
                    restrict_to_page_hint=bool(source_page) and not is_table_source,
                )
                if fig_page and fig_bbox:
                    page = fig_page
                    bbox = fig_bbox
                    panel_letter = _extract_panel_letter(source_label_norm)
                    bbox = _tighten_visual_bbox_by_panel(pdf_path, int(page), bbox, panel_letter)

            # Refine visual focus to local 渭/COF marker within the figure region.
            if page and bbox:
                if is_table_source:
                    bbox = _tighten_table_bbox_by_row(pdf_path, int(page), bbox, record)
                else:
                    focus_queries = _build_visual_focus_queries(record)
                    if focus_queries:
                        focus_hits = find_text_coordinates(
                            pdf_path,
                            [
                                {
                                    "id": "visual_focus",
                                    "queries": focus_queries,
                                    "page_hint": int(page),
                                    "restrict_to_page_hint": True,
                                    "anchor_bbox": bbox,
                                    "restrict_to_anchor_bbox": True,
                                }
                            ],
                        )
                        focus_hit = next(
                            (
                                h for h in focus_hits
                                if (h.get("w") or 0) > 0 and (h.get("h") or 0) > 0
                            ),
                            None,
                        )
                        if focus_hit:
                            fx0 = float(focus_hit["x"])
                            fy0 = float(focus_hit["y"])
                            fw = float(focus_hit["w"])
                            fh = float(focus_hit["h"])
                            # Slightly enlarge local box for readability in preview.
                            bbox = [
                                max(0.0, fx0 - 22.0),
                                max(0.0, fy0 - 12.0),
                                fx0 + fw + 22.0,
                                fy0 + fh + 12.0,
                            ]

            if bbox and page:
                image_b64 = crop_region_to_base64(pdf_path, page, bbox)

            # Visual fallback only when figure box is unavailable.
            if not image_b64 and evidence_text and not is_table_source:
                ev_page, ev_bbox = find_evidence_coordinates(pdf_path, evidence_text, page_hint=page)
                if ev_page and ev_bbox:
                    page = ev_page
                    bbox = ev_bbox
                    image_b64 = crop_region_to_base64(pdf_path, page, bbox)
        else:
            # Use pre-computed stored bbox directly if available
            if bbox and page:
                image_b64 = crop_region_to_base64(pdf_path, page, bbox)

            # Try figure label search if no image yet
            if not image_b64 and source_label_norm and source_label_norm not in ("Text", "Unknown"):
                fig_page, fig_bbox = find_figure_bbox(pdf_path, source_label_norm)
                if fig_page and fig_bbox:
                    page = fig_page
                    bbox = fig_bbox
                    image_b64 = crop_region_to_base64(pdf_path, page, bbox)

            # Fall back to evidence text fuzzy search
            if not image_b64 and evidence_text:
                ev_page, ev_bbox = find_evidence_coordinates(pdf_path, evidence_text, page_hint=page)
                if ev_page and ev_bbox:
                    page = ev_page
                    bbox = ev_bbox
                    image_b64 = crop_region_to_base64(pdf_path, page, bbox)

            # Final fallback: locate by record key terms even when evidence quote is not searchable.
            if not image_b64:
                queries = build_search_queries_for_record(record)
                if queries:
                    hits = find_text_coordinates(
                        pdf_path,
                        [
                            {
                                "id": str(record_id),
                                "queries": queries,
                                "page_hint": int(page) if page else None,
                                "restrict_to_page_hint": bool(page),
                                "anchor_bbox": bbox if bbox and len(bbox) == 4 else None,
                            }
                        ],
                    )
                    first_hit = next(
                        (
                            h for h in hits
                            if (h.get("w") or 0) > 0 and (h.get("h") or 0) > 0
                        ),
                        None,
                    )
                    if first_hit:
                        page = first_hit["page"]
                        x0 = float(first_hit["x"])
                        y0 = float(first_hit["y"])
                        w = float(first_hit["w"])
                        h = float(first_hit["h"])
                        bbox = [x0, y0, x0 + w, y0 + h]
                        image_b64 = crop_region_to_base64(pdf_path, page, bbox)
                        if not evidence_text:
                            evidence_text = first_hit.get("matched_text")
                        if not source_label_norm:
                            source_label_norm = "Text"

    highlight_term_specs = []
    for term, semantic_type in [
        (getattr(record, "cof_raw", None), "cof"),
        (str(getattr(record, "cof_value", "")) if getattr(record, "cof_value", None) is not None else None, "cof"),
        (getattr(record, "lubricant", None), "lubricant"),
        (getattr(record, "material_name", None), "material"),
        (getattr(record, "temperature", None), "temperature"),
        (getattr(record, "potential", None), "potential"),
        (getattr(record, "water_content", None), "water_content"),
        (getattr(record, "speed_value", None), "speed"),
        (getattr(record, "shear_rate", None), "shear_rate"),
        (getattr(record, "load_value", None), "load"),
        (getattr(record, "surface_roughness", None), "surface_roughness"),
        (getattr(record, "film_thickness", None), "film_thickness"),
    ]:
        if term and str(term).strip():
            highlight_term_specs.append((str(term).strip(), semantic_type))
    seen_highlight_terms = set()
    deduped_specs = []
    for term, semantic_type in highlight_term_specs:
        if term in seen_highlight_terms:
            continue
        seen_highlight_terms.add(term)
        deduped_specs.append((term, semantic_type))
    highlight_term_specs = deduped_specs
    highlight_terms = [term for term, _ in highlight_term_specs]

    term_hits = []
    if has_pdf and highlight_terms:
        query_items = [
            {
                "id": f"term_{idx}",
                "queries": _build_term_query_variants(term),
                "semantic_type": semantic_type,
                "page_hint": int(page) if page else None,
                "restrict_to_page_hint": bool(page) and (
                    source_type != "visual"
                    or (is_table_source and semantic_type in {"cof", "lubricant"})
                ),
                "max_page_distance": (
                    0
                    if (page and is_table_source and semantic_type in {"cof", "lubricant"})
                    else (3 if (page and source_type == "visual") else None)
                ),
                "anchor_bbox": (
                    bbox
                    if (
                        bbox
                        and len(bbox) == 4
                        and (
                            source_type != "visual"
                            or (is_table_source and semantic_type in {"cof", "lubricant"})
                        )
                    )
                    else None
                ),
                "restrict_to_anchor_bbox": bool(
                    bbox
                    and len(bbox) == 4
                    and is_table_source
                    and semantic_type in {"cof", "lubricant"}
                ),
            }
            for idx, (term, semantic_type) in enumerate(highlight_term_specs)
            if term and len(term.strip()) >= 2
        ]
        if query_items:
            hits = find_text_coordinates(pdf_path, query_items)
            id_to_spec = {
                f"term_{idx}": {
                    "term": term,
                    "semantic_type": semantic_type,
                }
                for idx, (term, semantic_type) in enumerate(highlight_term_specs)
                if term and len(term.strip()) >= 2
            }
            seen_terms = set()
            for hit in hits:
                spec = id_to_spec.get(hit.get("id", ""))
                term = str((spec or {}).get("term") or "").strip()
                semantic_type = str((spec or {}).get("semantic_type") or "").strip() or None
                if not term or term in seen_terms:
                    continue
                w = float(hit.get("w") or 0)
                h = float(hit.get("h") or 0)
                if w <= 0 or h <= 0:
                    continue
                x0 = float(hit.get("x") or 0)
                y0 = float(hit.get("y") or 0)
                matched_text = str(hit.get("matched_text") or "").strip()
                is_numeric_term = bool(re.search(r"\d", str(term)))
                if is_numeric_term and not _numeric_term_matches(str(term), matched_text):
                    continue
                term_key = _normalize_term_key(term)
                match_key = _normalize_term_key(matched_text)
                inferred = False if is_numeric_term else bool(match_key and term_key and match_key != term_key)
                term_hits.append(
                    {
                        "term": term,
                        "page": int(hit.get("page") or 1),
                        "bbox": [x0, y0, x0 + w, y0 + h],
                        "matched_text": matched_text or None,
                        "semantic_type": semantic_type,
                        "inferred": inferred,
                        "snippet_text": None,
                        "image_b64": None,
                    }
                )
                seen_terms.add(term)

        for term_hit in term_hits:
            bbox_hit = term_hit.get("bbox")
            page_hit = int(term_hit.get("page") or 0)
            if page_hit < 1 or not isinstance(bbox_hit, list) or len(bbox_hit) != 4:
                continue

            is_visual_hit = (
                source_type == "visual"
                and page is not None
                and int(page_hit) == int(page)
                and bbox is not None
                and len(bbox) == 4
            )
            if source_type == "visual":
                image_b64_hit = None
                if is_visual_hit and _visual_hit_prefers_figure_preview(
                    pdf_path=pdf_path,
                    page_num=page_hit,
                    figure_bbox=bbox,
                    hit_bbox=bbox_hit,
                ):
                    image_b64_hit = render_region_preview_with_highlight_to_base64(
                        pdf_path=pdf_path,
                        page_num=page_hit,
                        region_bbox=bbox,
                        highlight_bbox=bbox_hit,
                        padding=10,
                        dpi=160,
                        max_width=1100,
                    )
                else:
                    image_b64_hit = render_page_preview_with_bbox_to_base64(
                        pdf_path=pdf_path,
                        page_num=page_hit,
                        bbox=bbox_hit,
                        dpi=160,
                        max_width=1400,
                    )
                if image_b64_hit:
                    term_hit["image_b64"] = image_b64_hit

            snippet_text = _extract_text_snippet(
                pdf_path=pdf_path,
                page_num=page_hit,
                bbox=bbox_hit,
                fallback_term=str(term_hit.get("matched_text") or term_hit.get("term") or "").strip() or None,
                prefer_term_context=False,
            )
            if snippet_text:
                term_hit["snippet_text"] = snippet_text

    text_snippet = None
    if has_pdf and page and source_type != "visual":
        is_text_source = (str(source_label_norm or "").strip().lower() in ("", "text"))
        fallback_term = (
            getattr(record, "cof_raw", None)
            or evidence_text
            or (highlight_terms[0] if highlight_terms else None)
        )
        text_snippet = _extract_text_snippet(
            pdf_path=pdf_path,
            page_num=int(page),
            bbox=bbox,
            fallback_term=fallback_term,
            prefer_term_context=is_text_source,
        )
        if (not evidence_text or len(str(evidence_text).strip()) < 8) and text_snippet:
            evidence_text = text_snippet

        # Full-page thumbnail with highlighted bbox (preferred UI artifact)
        page_preview_b64 = render_page_preview_with_bbox_to_base64(
            pdf_path=pdf_path,
            page_num=int(page),
            bbox=bbox,
            dpi=120,
            max_width=900,
        )
    elif has_pdf and page:
        # For visual evidence, always provide the page preview so frontend can open image-only mode.
        page_preview_b64 = render_page_preview_with_bbox_to_base64(
            pdf_path=pdf_path,
            page_num=int(page),
            bbox=bbox,
            dpi=160,
            max_width=1300,
        )

    return {
        "record_id": record_id,
        "evidence_text": evidence_text,
        "text_snippet": text_snippet,
        "highlight_terms": highlight_terms,
        "term_hits": term_hits,
        "source": source_label_norm,
        "source_type": source_type,
        "page": page,
        "bbox": bbox,
        "image_b64": image_b64,
        "page_preview_b64": page_preview_b64,
        "has_image": bool(image_b64),
        "has_pdf": has_pdf,
    }


def _build_diffusion_candidate_pdf_evidence_payload(
    literature: Any,
    candidate: DiffusionCandidate | DiffusionRecord,
    *,
    candidate_id: int,
) -> dict[str, Any]:
    import json as json_mod
    from utils.pdf_coords import find_evidence_coordinates, find_figure_bbox, normalize_source_label
    from utils.pdf_utils import (
        crop_region_to_base64,
        render_page_preview_with_bbox_to_base64,
        render_region_preview_with_highlight_to_base64,
    )

    evidence_text = getattr(candidate, "evidence", None)
    page = getattr(candidate, "source_page", None)
    bbox = None
    raw_bbox = getattr(candidate, "source_bbox", None)
    if raw_bbox:
        try:
            bbox = json_mod.loads(raw_bbox)
        except Exception:
            bbox = None

    source_label = normalize_source_label(getattr(candidate, "source", None)) or getattr(candidate, "source", None)
    source_key = str(source_label or "").strip().lower()
    if source_key.startswith("table"):
        source_type = "table"
    elif source_key.startswith(("fig", "image", "plot")):
        source_type = "figure"
    elif source_key:
        source_type = "text"
    else:
        source_type = "text"

    pdf_path = _resolve_existing_path(literature.file_path)
    has_pdf = bool(pdf_path)
    image_b64 = None
    page_preview_b64 = None
    text_snippet = None
    metric_terms = _diffusion_metric_pdf_terms(candidate)
    prefer_table_bbox = _diffusion_prefers_table_bbox(candidate)

    if (
        has_pdf
        and source_type == "table"
        and not prefer_table_bbox
        and page
        and bbox
        and metric_terms
        and not _diffusion_bbox_matches_metric(pdf_path, int(page), bbox, metric_terms)
    ):
        bbox = None

    if has_pdf and source_type in ("figure", "table") and (not bbox or not page) and source_label:
        fig_page, fig_bbox = find_figure_bbox(
            pdf_path,
            source_label,
            page_hint=int(page) if page else None,
            restrict_to_page_hint=bool(page) and source_type == "figure",
        )
        if fig_page and fig_bbox:
            page = fig_page
            bbox = fig_bbox

    if (
        has_pdf
        and source_type == "table"
        and not prefer_table_bbox
        and metric_terms
        and page
        and not (
            bbox
            and _diffusion_has_duplicate_coefficients(candidate)
            and _diffusion_bbox_matches_metric(pdf_path, int(page), bbox, metric_terms)
        )
    ):
        anchor_bbox = bbox if _diffusion_bbox_matches_metric(pdf_path, int(page), bbox, metric_terms) else None
        metric_page, metric_bbox = _locate_diffusion_metric_bbox(
            pdf_path=pdf_path,
            page_hint=int(page) if page else None,
            terms=metric_terms,
            anchor_bbox=anchor_bbox,
            find_evidence_coordinates=find_evidence_coordinates,
        )
        if metric_page and metric_bbox:
            page = metric_page
            bbox = metric_bbox
        elif bbox and not _diffusion_bbox_matches_metric(pdf_path, int(page), bbox, metric_terms):
            bbox = None

    if has_pdf and evidence_text and (not bbox or not page):
        evidence_page, evidence_bbox = find_evidence_coordinates(
            pdf_path,
            str(evidence_text),
            page_hint=int(page) if page else None,
            restrict_to_page_hint=bool(page),
        )
        if evidence_page and not page:
            page = evidence_page
        if evidence_bbox and not bbox:
            bbox = evidence_bbox

    if (
        has_pdf
        and source_type == "table"
        and page
        and bbox
        and metric_terms
        and not _diffusion_bbox_matches_metric(pdf_path, int(page), bbox, metric_terms)
    ):
        metric_page, metric_bbox = _locate_diffusion_metric_bbox(
            pdf_path=pdf_path,
            page_hint=int(page) if page else None,
            terms=metric_terms,
            anchor_bbox=None,
            find_evidence_coordinates=find_evidence_coordinates,
        )
        if metric_page and metric_bbox:
            page = metric_page
            bbox = metric_bbox
        else:
            bbox = None

    highlight_terms = [
        value
        for value in (
            getattr(candidate, "system_name", None),
            getattr(candidate, "ionic_liquid", None),
            _format_diffusion_numeric(getattr(candidate, "d_total", None)),
            _format_diffusion_numeric(getattr(candidate, "d_cation", None)),
            _format_diffusion_numeric(getattr(candidate, "d_anion", None)),
        )
        if value not in (None, "", [])
    ]

    if has_pdf and page and bbox:
        if source_type in ("figure", "table"):
            image_b64 = crop_region_to_base64(
                pdf_path=pdf_path,
                page_num=int(page),
                bbox=bbox,
                zoom=2.2,
            )
            page_preview_b64 = render_page_preview_with_bbox_to_base64(
                pdf_path=pdf_path,
                page_num=int(page),
                bbox=bbox,
                dpi=160,
                max_width=1200,
            )
        else:
            image_b64 = render_region_preview_with_highlight_to_base64(
                pdf_path=pdf_path,
                page_num=int(page),
                bbox=bbox,
                highlight=bbox,
                dpi=170,
                max_width=1200,
            )
            text_snippet = _extract_text_snippet(
                pdf_path=pdf_path,
                page_num=int(page),
                bbox=bbox,
                fallback_term=str(evidence_text or (highlight_terms[0] if highlight_terms else "")).strip() or None,
                prefer_term_context=True,
            )
            page_preview_b64 = render_page_preview_with_bbox_to_base64(
                pdf_path=pdf_path,
                page_num=int(page),
                bbox=bbox,
                dpi=120,
                max_width=900,
            )
    elif has_pdf and page:
        page_preview_b64 = render_page_preview_with_bbox_to_base64(
            pdf_path=pdf_path,
            page_num=int(page),
            bbox=bbox,
            dpi=120,
            max_width=900,
        )
        if source_type == "text":
            text_snippet = _extract_text_snippet(
                pdf_path=pdf_path,
                page_num=int(page),
                bbox=bbox,
                fallback_term=str(evidence_text or (highlight_terms[0] if highlight_terms else "")).strip() or None,
                prefer_term_context=True,
            )

    if (not evidence_text or len(str(evidence_text).strip()) < 8) and text_snippet:
        evidence_text = text_snippet

    return {
        "record_id": candidate_id,
        "evidence_text": evidence_text,
        "text_snippet": text_snippet,
        "highlight_terms": [str(item) for item in highlight_terms],
        "term_hits": [],
        "source": source_label,
        "source_type": "visual" if source_type in ("figure", "table") else source_type,
        "page": page,
        "bbox": bbox,
        "image_b64": image_b64,
        "page_preview_b64": page_preview_b64,
        "has_image": bool(image_b64),
        "has_pdf": has_pdf,
    }


@router.get("/pdf/{literature_id}/candidates/{candidate_id}/evidence")
async def get_candidate_evidence(
    literature_id: int,
    candidate_id: int,
    db: AsyncSession = Depends(get_db),
    principal: AuthPrincipal = Depends(get_current_principal),
):
    literature = await require_literature_access(db, principal, literature_id)
    candidate = await require_candidate_access(db, principal, candidate_id)
    if candidate.literature_id != literature_id:
        raise HTTPException(status_code=404, detail="Candidate not found")
    return _build_candidate_pdf_evidence_payload(literature, candidate, candidate_id=candidate_id)


@router.get("/pdf/{literature_id}/diffusion-candidates/{candidate_id}/evidence")
async def get_diffusion_candidate_evidence(
    literature_id: int,
    candidate_id: int,
    db: AsyncSession = Depends(get_db),
    principal: AuthPrincipal = Depends(get_current_principal),
):
    literature = await require_literature_access(db, principal, literature_id)
    candidate = await require_diffusion_candidate_access(db, principal, candidate_id)
    if candidate.literature_id != literature_id:
        raise HTTPException(status_code=404, detail="Diffusion candidate not found")
    return _build_diffusion_candidate_pdf_evidence_payload(literature, candidate, candidate_id=candidate_id)


@router.get("/pdf/{literature_id}/diffusion-records/{record_id}/evidence")
async def get_diffusion_record_evidence(
    literature_id: int,
    record_id: int,
    db: AsyncSession = Depends(get_db),
    principal: AuthPrincipal = Depends(get_current_principal),
):
    literature = await require_literature_access(db, principal, literature_id)
    record = await require_diffusion_record_access(db, principal, record_id)
    if record.literature_id != literature_id:
        raise HTTPException(status_code=404, detail="Diffusion record not found")
    return _build_diffusion_candidate_pdf_evidence_payload(literature, record, candidate_id=record_id)


@router.get("/review/records/{record_id}/field-evidence")
async def get_record_field_evidence(
    record_id: int,
    db: AsyncSession = Depends(get_db),
    principal: AuthPrincipal = Depends(get_current_principal),
):
    record = await require_record_access(db, principal, record_id)
    return _build_record_field_evidence_payload(record)


@router.patch("/review/records/{record_id}/cof-extracted")
async def update_record_cof_extracted(
    record_id: int,
    payload: CofExtractedUpdatePayload,
    request: Request,
    db: AsyncSession = Depends(get_db),
    principal: AuthPrincipal = Depends(get_current_principal),
):
    record = await require_record_access(db, principal, record_id, write=True)
    _apply_cof_extracted_update(record, payload)
    await db.commit()
    await log_activity(
        db=db,
        user_id=principal.user.id,
        group_id=principal.group.id,
        action_type="review_update_cof",
        action_detail={"record_id": record.id, "literature_id": record.literature_id},
        resource_type="record",
        resource_id=record.id,
        request=request,
    )
    return _build_record_field_evidence_payload(record)


@router.patch("/review/records/{record_id}/load-conditions")
async def update_record_load_conditions(
    record_id: int,
    payload: LoadConditionsUpdatePayload,
    request: Request,
    db: AsyncSession = Depends(get_db),
    principal: AuthPrincipal = Depends(get_current_principal),
):
    record = await require_record_access(db, principal, record_id, write=True)
    _apply_load_conditions_update(record, payload)
    await db.commit()
    await log_activity(
        db=db,
        user_id=principal.user.id,
        group_id=principal.group.id,
        action_type="review_update_load_conditions",
        action_detail={"record_id": record.id, "literature_id": record.literature_id},
        resource_type="record",
        resource_id=record.id,
        request=request,
    )
    return _build_record_field_evidence_payload(record)


@router.patch("/review/records/{record_id}/speed-conditions")
async def update_record_speed_conditions(
    record_id: int,
    payload: SpeedConditionsUpdatePayload,
    request: Request,
    db: AsyncSession = Depends(get_db),
    principal: AuthPrincipal = Depends(get_current_principal),
):
    record = await require_record_access(db, principal, record_id, write=True)
    _apply_speed_conditions_update(record, payload)
    await db.commit()
    await log_activity(
        db=db,
        user_id=principal.user.id,
        group_id=principal.group.id,
        action_type="review_update_speed_conditions",
        action_detail={"record_id": record.id, "literature_id": record.literature_id},
        resource_type="record",
        resource_id=record.id,
        request=request,
    )
    return _build_record_field_evidence_payload(record)


@router.patch("/review/records/{record_id}/tribological-system")
async def update_record_tribological_system(
    record_id: int,
    payload: TribologicalSystemUpdatePayload,
    request: Request,
    db: AsyncSession = Depends(get_db),
    principal: AuthPrincipal = Depends(get_current_principal),
):
    record = await require_record_access(db, principal, record_id, write=True)
    _apply_tribological_system_update(record, payload)
    await db.commit()
    await log_activity(
        db=db,
        user_id=principal.user.id,
        group_id=principal.group.id,
        action_type="review_update_tribological_system",
        action_detail={"record_id": record.id, "literature_id": record.literature_id},
        resource_type="record",
        resource_id=record.id,
        request=request,
    )
    return _build_record_field_evidence_payload(record)


@router.get("/review/records/{record_id}/field-evidence/{field_key}")
async def get_record_field_evidence_for_field(
    record_id: int,
    field_key: str,
    db: AsyncSession = Depends(get_db),
    principal: AuthPrincipal = Depends(get_current_principal),
):
    record = await require_record_access(db, principal, record_id)
    payload = _build_record_field_evidence_payload(record)
    normalized_key = _normalize_field_key(field_key)
    field_payload = payload["fields"].get(normalized_key)
    if field_payload is None:
        raise HTTPException(status_code=404, detail=f"Field evidence '{field_key}' not found")
    return {
        "record_id": record.id,
        "literature_id": record.literature_id,
        "field_key": normalized_key,
        "field": field_payload,
        "sample_id": record.sample_id,
        "series_id": record.series_id,
        "review_status": record.review_status,
    }


@router.post("/review/records/{record_id}/fields/{field_key}/confirm")
async def confirm_record_field_evidence(
    record_id: int,
    field_key: str,
    payload: ReviewFieldActionPayload,
    request: Request,
    db: AsyncSession = Depends(get_db),
    principal: AuthPrincipal = Depends(get_current_principal),
):
    record = await require_record_access(db, principal, record_id, write=True)
    normalized_key = _normalize_field_key(field_key)
    field_map = _parse_field_evidence_map(record.field_evidence_json)
    target_keys = _target_field_keys_for_action(normalized_key, field_map)
    if not target_keys:
        raise HTTPException(status_code=404, detail=f"Field evidence '{field_key}' not found")
    if any(_field_grounding_status(field_map.get(key) or {}) != "grounded" for key in target_keys):
        raise HTTPException(status_code=422, detail=f"Field '{field_key}' cannot be confirmed without evidence")

    for key in target_keys:
        entry = field_map.get(key)
        if not isinstance(entry, dict):
            continue
        entry["review_state"] = "confirmed"
        if payload.note is not None:
            entry["review_note"] = payload.note
        field_map[key] = entry
    _persist_field_map(record, field_map)
    _recompute_review_status(record, field_map)
    await db.commit()
    await db.refresh(record)
    await log_activity(
        db=db,
        user_id=principal.user.id,
        group_id=principal.group.id,
        action_type="edit_record",
        action_detail={
            "record_id": record.id,
            "literature_id": record.literature_id,
            "review_action": "confirm_field",
            "field_key": normalized_key,
        },
        resource_type="record",
        resource_id=record.id,
        request=request,
    )
    return _build_record_field_evidence_payload(record)


@router.post("/review/records/{record_id}/fields/{field_key}/flag")
async def flag_record_field_evidence(
    record_id: int,
    field_key: str,
    payload: ReviewFieldActionPayload,
    request: Request,
    db: AsyncSession = Depends(get_db),
    principal: AuthPrincipal = Depends(get_current_principal),
):
    record = await require_record_access(db, principal, record_id, write=True)
    normalized_key = _normalize_field_key(field_key)
    field_map = _parse_field_evidence_map(record.field_evidence_json)
    target_keys = _target_field_keys_for_action(normalized_key, field_map)
    for key in target_keys:
        entry = field_map.get(key)
        if not isinstance(entry, dict):
            entry = {
                "value": _field_value_from_record(record, key),
                "confidence": record.confidence,
                "evidence": None,
            }
        entry["review_state"] = "flagged"
        entry["review_note"] = payload.note or "Flagged during review"
        field_map[key] = entry
    _persist_field_map(record, field_map)
    _recompute_review_status(record, field_map)
    await db.commit()
    await db.refresh(record)
    await log_activity(
        db=db,
        user_id=principal.user.id,
        group_id=principal.group.id,
        action_type="edit_record",
        action_detail={
            "record_id": record.id,
            "literature_id": record.literature_id,
            "review_action": "flag_field",
            "field_key": normalized_key,
        },
        resource_type="record",
        resource_id=record.id,
        request=request,
    )
    return _build_record_field_evidence_payload(record)


@router.post("/review/records/{record_id}/fields/{field_key}/unflag")
async def unflag_record_field_evidence(
    record_id: int,
    field_key: str,
    payload: ReviewFieldActionPayload,
    request: Request,
    db: AsyncSession = Depends(get_db),
    principal: AuthPrincipal = Depends(get_current_principal),
):
    record = await require_record_access(db, principal, record_id, write=True)
    normalized_key = _normalize_field_key(field_key)
    field_map = _parse_field_evidence_map(record.field_evidence_json)
    target_keys = _target_field_keys_for_action(normalized_key, field_map)
    _clear_flagged_field_entries(field_map, target_keys, payload.note)
    _persist_field_map(record, field_map)
    _recompute_review_status(record, field_map)
    await db.commit()
    await db.refresh(record)
    await log_activity(
        db=db,
        user_id=principal.user.id,
        group_id=principal.group.id,
        action_type="edit_record",
        action_detail={
            "record_id": record.id,
            "literature_id": record.literature_id,
            "review_action": "unflag_field",
            "field_key": normalized_key,
        },
        resource_type="record",
        resource_id=record.id,
        request=request,
    )
    return _build_record_field_evidence_payload(record)


@router.post("/review/records/{record_id}/approve")
async def approve_record_review(
    record_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    principal: AuthPrincipal = Depends(get_current_principal),
):
    record = await require_record_access(db, principal, record_id, write=True)
    field_map = _parse_field_evidence_map(record.field_evidence_json)
    missing_required = _required_field_missing(field_map)
    if missing_required:
        raise HTTPException(
            status_code=422,
            detail=f"Record cannot be approved. Missing field evidence for: {', '.join(missing_required)}",
        )

    flagged_required = [
        key for key in _required_field_keys(field_map)
        if str((field_map.get(key) or {}).get("review_state") or "").strip().lower() == "flagged"
    ]
    if flagged_required:
        raise HTTPException(
            status_code=422,
            detail=f"Record cannot be approved while flagged fields remain: {', '.join(flagged_required)}",
        )

    _recompute_review_status(record, field_map, approved=True)
    await db.commit()
    await db.refresh(record)
    await log_activity(
        db=db,
        user_id=principal.user.id,
        group_id=principal.group.id,
        action_type="edit_record",
        action_detail={
            "record_id": record.id,
            "literature_id": record.literature_id,
            "review_action": "approve_record",
        },
        resource_type="record",
        resource_id=record.id,
        request=request,
    )
    return _build_record_field_evidence_payload(record)


@router.get("/review/candidates/{candidate_id}/field-evidence")
async def get_candidate_field_evidence(
    candidate_id: int,
    literature_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    principal: AuthPrincipal = Depends(get_current_principal),
):
    candidate = await require_candidate_access(db, principal, candidate_id)
    if literature_id is not None and candidate.literature_id != literature_id:
        raise HTTPException(status_code=404, detail="Candidate not found")
    return _build_record_field_evidence_payload(candidate)


@router.patch("/review/candidates/{candidate_id}/cof-extracted")
async def update_candidate_cof_extracted(
    candidate_id: int,
    payload: CofExtractedUpdatePayload,
    request: Request,
    db: AsyncSession = Depends(get_db),
    principal: AuthPrincipal = Depends(get_current_principal),
):
    candidate = await require_candidate_access(db, principal, candidate_id, write=True)
    _apply_cof_extracted_update(candidate, payload)
    await db.commit()
    await log_activity(
        db=db,
        user_id=principal.user.id,
        group_id=principal.group.id,
        action_type="review_update_candidate_cof",
        action_detail={"candidate_id": candidate.id, "literature_id": candidate.literature_id},
        resource_type="record_candidate",
        resource_id=candidate.id,
        request=request,
    )
    return _build_record_field_evidence_payload(candidate)


@router.patch("/review/candidates/{candidate_id}/load-conditions")
async def update_candidate_load_conditions(
    candidate_id: int,
    payload: LoadConditionsUpdatePayload,
    request: Request,
    db: AsyncSession = Depends(get_db),
    principal: AuthPrincipal = Depends(get_current_principal),
):
    candidate = await require_candidate_access(db, principal, candidate_id, write=True)
    _apply_load_conditions_update(candidate, payload)
    await db.commit()
    await log_activity(
        db=db,
        user_id=principal.user.id,
        group_id=principal.group.id,
        action_type="review_update_candidate_load_conditions",
        action_detail={"candidate_id": candidate.id, "literature_id": candidate.literature_id},
        resource_type="record_candidate",
        resource_id=candidate.id,
        request=request,
    )
    return _build_record_field_evidence_payload(candidate)


@router.patch("/review/candidates/{candidate_id}/speed-conditions")
async def update_candidate_speed_conditions(
    candidate_id: int,
    payload: SpeedConditionsUpdatePayload,
    request: Request,
    db: AsyncSession = Depends(get_db),
    principal: AuthPrincipal = Depends(get_current_principal),
):
    candidate = await require_candidate_access(db, principal, candidate_id, write=True)
    _apply_speed_conditions_update(candidate, payload)
    await db.commit()
    await log_activity(
        db=db,
        user_id=principal.user.id,
        group_id=principal.group.id,
        action_type="review_update_candidate_speed_conditions",
        action_detail={"candidate_id": candidate.id, "literature_id": candidate.literature_id},
        resource_type="record_candidate",
        resource_id=candidate.id,
        request=request,
    )
    return _build_record_field_evidence_payload(candidate)


@router.patch("/review/candidates/{candidate_id}/tribological-system")
async def update_candidate_tribological_system(
    candidate_id: int,
    payload: TribologicalSystemUpdatePayload,
    request: Request,
    db: AsyncSession = Depends(get_db),
    principal: AuthPrincipal = Depends(get_current_principal),
):
    candidate = await require_candidate_access(db, principal, candidate_id, write=True)
    _apply_tribological_system_update(candidate, payload)
    await db.commit()
    await log_activity(
        db=db,
        user_id=principal.user.id,
        group_id=principal.group.id,
        action_type="review_update_candidate_tribological_system",
        action_detail={"candidate_id": candidate.id, "literature_id": candidate.literature_id},
        resource_type="record_candidate",
        resource_id=candidate.id,
        request=request,
    )
    return _build_record_field_evidence_payload(candidate)


@router.get("/review/candidates/{candidate_id}/field-evidence/{field_key}")
async def get_candidate_field_evidence_for_field(
    candidate_id: int,
    field_key: str,
    literature_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    principal: AuthPrincipal = Depends(get_current_principal),
):
    candidate = await require_candidate_access(db, principal, candidate_id)
    if literature_id is not None and candidate.literature_id != literature_id:
        raise HTTPException(status_code=404, detail="Candidate not found")
    payload = _build_record_field_evidence_payload(candidate)
    normalized_key = _normalize_field_key(field_key)
    field_payload = payload["fields"].get(normalized_key)
    if field_payload is None:
        raise HTTPException(status_code=404, detail=f"Field evidence '{field_key}' not found")
    return {
        "record_id": candidate.id,
        "literature_id": candidate.literature_id,
        "field_key": normalized_key,
        "field": field_payload,
        "sample_id": candidate.sample_id,
        "series_id": candidate.series_id,
        "review_status": candidate.review_status,
    }


@router.patch("/review/candidates/{candidate_id}/fields")
async def update_candidate_review_fields(
    candidate_id: int,
    payload: CandidateFieldCorrectionPayload,
    request: Request,
    db: AsyncSession = Depends(get_db),
    principal: AuthPrincipal = Depends(get_current_principal),
):
    candidate = await require_candidate_access(db, principal, candidate_id, write=True)
    try:
        await apply_tribology_candidate_correction(db, candidate.id, payload.fields)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    await db.refresh(candidate)
    await log_activity(
        db=db,
        user_id=principal.user.id,
        group_id=principal.group.id,
        action_type="review_update_candidate_fields",
        action_detail={
            "candidate_id": candidate.id,
            "literature_id": candidate.literature_id,
            "fields": sorted(payload.fields.keys()),
        },
        resource_type="record_candidate",
        resource_id=candidate.id,
        request=request,
    )
    return _build_record_field_evidence_payload(candidate)


@router.post("/review/candidates/{candidate_id}/fields/{field_key}/confirm")
async def confirm_candidate_field_evidence(
    candidate_id: int,
    field_key: str,
    payload: ReviewFieldActionPayload,
    request: Request,
    db: AsyncSession = Depends(get_db),
    principal: AuthPrincipal = Depends(get_current_principal),
):
    candidate = await require_candidate_access(db, principal, candidate_id, write=True)
    normalized_key = _normalize_field_key(field_key)
    field_map = _parse_field_evidence_map(candidate.field_evidence_json)
    target_keys = _target_field_keys_for_action(normalized_key, field_map)
    if not target_keys:
        raise HTTPException(status_code=404, detail=f"Field evidence '{field_key}' not found")
    if any(_field_grounding_status(field_map.get(key) or {}) != "grounded" for key in target_keys):
        raise HTTPException(status_code=422, detail=f"Field '{field_key}' cannot be confirmed without evidence")

    for key in target_keys:
        entry = field_map.get(key)
        if not isinstance(entry, dict):
            continue
        entry["review_state"] = "confirmed"
        if payload.note is not None:
            entry["review_note"] = payload.note
        field_map[key] = entry
    _persist_field_map(candidate, field_map)
    _recompute_review_status(candidate, field_map)
    await db.commit()
    await db.refresh(candidate)
    await log_activity(
        db=db,
        user_id=principal.user.id,
        group_id=principal.group.id,
        action_type="edit_record",
        action_detail={
            "candidate_id": candidate.id,
            "literature_id": candidate.literature_id,
            "review_action": "confirm_candidate_field",
            "field_key": normalized_key,
        },
        resource_type="candidate",
        resource_id=candidate.id,
        request=request,
    )
    return _build_record_field_evidence_payload(candidate)


@router.post("/review/candidates/{candidate_id}/fields/{field_key}/flag")
async def flag_candidate_field_evidence(
    candidate_id: int,
    field_key: str,
    payload: ReviewFieldActionPayload,
    request: Request,
    db: AsyncSession = Depends(get_db),
    principal: AuthPrincipal = Depends(get_current_principal),
):
    candidate = await require_candidate_access(db, principal, candidate_id, write=True)
    normalized_key = _normalize_field_key(field_key)
    field_map = _parse_field_evidence_map(candidate.field_evidence_json)
    target_keys = _target_field_keys_for_action(normalized_key, field_map)
    for key in target_keys:
        entry = field_map.get(key)
        if not isinstance(entry, dict):
            entry = {
                "value": _field_value_from_record(candidate, key),
                "confidence": candidate.confidence,
                "evidence": None,
            }
        entry["review_state"] = "flagged"
        entry["review_note"] = payload.note or "Flagged during review"
        field_map[key] = entry
    _persist_field_map(candidate, field_map)
    _recompute_review_status(candidate, field_map)
    await db.commit()
    await db.refresh(candidate)
    await log_activity(
        db=db,
        user_id=principal.user.id,
        group_id=principal.group.id,
        action_type="edit_record",
        action_detail={
            "candidate_id": candidate.id,
            "literature_id": candidate.literature_id,
            "review_action": "flag_candidate_field",
            "field_key": normalized_key,
        },
        resource_type="candidate",
        resource_id=candidate.id,
        request=request,
    )
    return _build_record_field_evidence_payload(candidate)


@router.post("/review/candidates/{candidate_id}/fields/{field_key}/unflag")
async def unflag_candidate_field_evidence(
    candidate_id: int,
    field_key: str,
    payload: ReviewFieldActionPayload,
    request: Request,
    db: AsyncSession = Depends(get_db),
    principal: AuthPrincipal = Depends(get_current_principal),
):
    candidate = await require_candidate_access(db, principal, candidate_id, write=True)
    normalized_key = _normalize_field_key(field_key)
    field_map = _parse_field_evidence_map(candidate.field_evidence_json)
    target_keys = _target_field_keys_for_action(normalized_key, field_map)
    _clear_flagged_field_entries(field_map, target_keys, payload.note)
    _persist_field_map(candidate, field_map)
    _recompute_review_status(candidate, field_map)
    await db.commit()
    await db.refresh(candidate)
    await log_activity(
        db=db,
        user_id=principal.user.id,
        group_id=principal.group.id,
        action_type="edit_record",
        action_detail={
            "candidate_id": candidate.id,
            "literature_id": candidate.literature_id,
            "review_action": "unflag_candidate_field",
            "field_key": normalized_key,
        },
        resource_type="candidate",
        resource_id=candidate.id,
        request=request,
    )
    return _build_record_field_evidence_payload(candidate)


@router.post("/review/candidates/{candidate_id}/approve")
async def approve_candidate_review(
    candidate_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    principal: AuthPrincipal = Depends(get_current_principal),
):
    candidate = await require_candidate_access(db, principal, candidate_id, write=True)
    field_map = _parse_field_evidence_map(candidate.field_evidence_json)
    missing_required = _required_field_missing(field_map)
    if missing_required:
        raise HTTPException(
            status_code=422,
            detail=f"Candidate cannot be approved. Missing field evidence for: {', '.join(missing_required)}",
        )

    flagged_required = [
        key for key in _required_field_keys(field_map)
        if str((field_map.get(key) or {}).get("review_state") or "").strip().lower() == "flagged"
    ]
    if flagged_required:
        raise HTTPException(
            status_code=422,
            detail=f"Candidate cannot be approved while flagged fields remain: {', '.join(flagged_required)}",
        )

    _recompute_review_status(candidate, field_map, approved=True)
    await promote_tribology_candidate(db, candidate)
    await db.commit()
    await db.refresh(candidate)
    await log_activity(
        db=db,
        user_id=principal.user.id,
        group_id=principal.group.id,
        action_type="edit_record",
        action_detail={
            "candidate_id": candidate.id,
            "promoted_record_id": candidate.promoted_record_id,
            "literature_id": candidate.literature_id,
            "review_action": "approve_candidate",
        },
        resource_type="candidate",
        resource_id=candidate.id,
        request=request,
    )
    return _build_record_field_evidence_payload(candidate)


@router.post("/review/candidates/{candidate_id}/reject")
async def reject_candidate_review(
    candidate_id: int,
    payload: ReviewFieldActionPayload,
    request: Request,
    db: AsyncSession = Depends(get_db),
    principal: AuthPrincipal = Depends(get_current_principal),
):
    candidate = await require_candidate_access(db, principal, candidate_id, write=True)
    candidate.review_status = "rejected"
    await db.commit()
    await db.refresh(candidate)
    await log_activity(
        db=db,
        user_id=principal.user.id,
        group_id=principal.group.id,
        action_type="edit_record",
        action_detail={
            "candidate_id": candidate.id,
            "literature_id": candidate.literature_id,
            "review_action": "reject_candidate",
            "note": payload.note,
        },
        resource_type="candidate",
        resource_id=candidate.id,
        request=request,
    )
    return _build_record_field_evidence_payload(candidate)


@router.get("/review/diffusion-records/{record_id}/field-evidence")
async def get_diffusion_record_field_evidence(
    record_id: int,
    db: AsyncSession = Depends(get_db),
    principal: AuthPrincipal = Depends(get_current_principal),
):
    record = await require_diffusion_record_access(db, principal, record_id)
    return _build_diffusion_field_evidence_payload(record)


@router.get("/review/diffusion-records/{record_id}/field-evidence/{field_key}")
async def get_diffusion_record_field_evidence_for_field(
    record_id: int,
    field_key: str,
    db: AsyncSession = Depends(get_db),
    principal: AuthPrincipal = Depends(get_current_principal),
):
    record = await require_diffusion_record_access(db, principal, record_id)
    payload = _build_diffusion_field_evidence_payload(record)
    normalized_key = _normalize_field_key(field_key)
    field_payload = payload["fields"].get(normalized_key)
    if field_payload is None:
        raise HTTPException(status_code=404, detail=f"Field evidence '{field_key}' not found")
    return {
        "record_id": record.id,
        "literature_id": record.literature_id,
        "field_key": normalized_key,
        "field": field_payload,
        "sample_id": None,
        "series_id": None,
        "review_status": record.review_status,
    }


@router.post("/review/diffusion-records/{record_id}/fields/{field_key}/confirm")
async def confirm_diffusion_record_field_evidence(
    record_id: int,
    field_key: str,
    payload: ReviewFieldActionPayload,
    request: Request,
    db: AsyncSession = Depends(get_db),
    principal: AuthPrincipal = Depends(get_current_principal),
):
    record = await require_diffusion_record_access(db, principal, record_id, write=True)
    normalized_key = _normalize_field_key(field_key)
    field_map = _parse_field_evidence_map(record.field_evidence_json)
    review_field_map = _build_diffusion_field_evidence_payload(record)["fields"]
    target_keys = _target_field_keys_for_action(normalized_key, review_field_map)
    if not target_keys:
        raise HTTPException(status_code=404, detail=f"Field evidence '{field_key}' not found")
    if any(_field_grounding_status(review_field_map.get(key) or {}) != "grounded" for key in target_keys):
        raise HTTPException(status_code=422, detail=f"Field '{field_key}' cannot be confirmed without evidence")

    for key in target_keys:
        entry = field_map.get(key)
        if not isinstance(entry, dict):
            entry = dict(review_field_map.get(key) or {})
        entry["review_state"] = "confirmed"
        if payload.note is not None:
            entry["review_note"] = payload.note
        field_map[key] = entry
    _persist_field_map(record, field_map)
    _recompute_diffusion_review_status(record, field_map)
    await db.commit()
    await db.refresh(record)
    await log_activity(
        db=db,
        user_id=principal.user.id,
        group_id=principal.group.id,
        action_type="edit_record",
        action_detail={
            "record_id": record.id,
            "literature_id": record.literature_id,
            "review_action": "confirm_diffusion_field",
            "field_key": normalized_key,
        },
        resource_type="diffusion_record",
        resource_id=record.id,
        request=request,
    )
    return _build_diffusion_field_evidence_payload(record)


@router.patch("/review/diffusion-records/{record_id}/fields/{field_key}/evidence")
async def patch_diffusion_record_field_evidence(
    record_id: int,
    field_key: str,
    payload: ReviewFieldEvidencePatchPayload,
    request: Request,
    db: AsyncSession = Depends(get_db),
    principal: AuthPrincipal = Depends(get_current_principal),
):
    record = await require_diffusion_record_access(db, principal, record_id, write=True)
    normalized_key = _normalize_field_key(field_key)
    field_map = _apply_review_field_evidence_patch(
        record,
        normalized_key,
        payload,
        value_getter=_diffusion_field_value_from_record,
    )
    _recompute_diffusion_review_status(record, field_map)
    await db.commit()
    await db.refresh(record)
    await log_activity(
        db=db,
        user_id=principal.user.id,
        group_id=principal.group.id,
        action_type="edit_record",
        action_detail={
            "record_id": record.id,
            "literature_id": record.literature_id,
            "review_action": "patch_diffusion_field_evidence",
            "field_key": normalized_key,
        },
        resource_type="diffusion_record",
        resource_id=record.id,
        request=request,
    )
    return _build_diffusion_field_evidence_payload(record)


@router.post("/review/diffusion-records/{record_id}/fields/{field_key}/flag")
async def flag_diffusion_record_field_evidence(
    record_id: int,
    field_key: str,
    payload: ReviewFieldActionPayload,
    request: Request,
    db: AsyncSession = Depends(get_db),
    principal: AuthPrincipal = Depends(get_current_principal),
):
    record = await require_diffusion_record_access(db, principal, record_id, write=True)
    normalized_key = _normalize_field_key(field_key)
    field_map = _parse_field_evidence_map(record.field_evidence_json)
    target_keys = _target_field_keys_for_action(normalized_key, field_map)
    for key in target_keys:
        entry = field_map.get(key)
        if not isinstance(entry, dict):
            entry = {
                "value": _diffusion_field_value_from_record(record, key),
                "confidence": record.confidence,
                "evidence": None,
            }
        entry["review_state"] = "flagged"
        entry["review_note"] = payload.note or "Flagged during review"
        field_map[key] = entry
    _persist_field_map(record, field_map)
    _recompute_diffusion_review_status(record, field_map)
    await db.commit()
    await db.refresh(record)
    await log_activity(
        db=db,
        user_id=principal.user.id,
        group_id=principal.group.id,
        action_type="edit_record",
        action_detail={
            "record_id": record.id,
            "literature_id": record.literature_id,
            "review_action": "flag_diffusion_field",
            "field_key": normalized_key,
        },
        resource_type="diffusion_record",
        resource_id=record.id,
        request=request,
    )
    return _build_diffusion_field_evidence_payload(record)


@router.post("/review/diffusion-records/{record_id}/fields/{field_key}/unflag")
async def unflag_diffusion_record_field_evidence(
    record_id: int,
    field_key: str,
    payload: ReviewFieldActionPayload,
    request: Request,
    db: AsyncSession = Depends(get_db),
    principal: AuthPrincipal = Depends(get_current_principal),
):
    record = await require_diffusion_record_access(db, principal, record_id, write=True)
    normalized_key = _normalize_field_key(field_key)
    field_map = _parse_field_evidence_map(record.field_evidence_json)
    target_keys = _target_field_keys_for_action(normalized_key, field_map)
    _clear_flagged_field_entries(field_map, target_keys, payload.note)
    _persist_field_map(record, field_map)
    _recompute_diffusion_review_status(record, field_map)
    await db.commit()
    await db.refresh(record)
    await log_activity(
        db=db,
        user_id=principal.user.id,
        group_id=principal.group.id,
        action_type="edit_record",
        action_detail={
            "record_id": record.id,
            "literature_id": record.literature_id,
            "review_action": "unflag_diffusion_field",
            "field_key": normalized_key,
        },
        resource_type="diffusion_record",
        resource_id=record.id,
        request=request,
    )
    return _build_diffusion_field_evidence_payload(record)


@router.post("/review/diffusion-records/{record_id}/approve")
async def approve_diffusion_record_review(
    record_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    principal: AuthPrincipal = Depends(get_current_principal),
):
    record = await require_diffusion_record_access(db, principal, record_id, write=True)
    field_map = _parse_field_evidence_map(record.field_evidence_json)
    review_payload = _build_diffusion_field_evidence_payload(record)
    review_field_map = review_payload["fields"]
    missing_required = _diffusion_missing_required_fields(review_field_map)
    if missing_required:
        raise HTTPException(
            status_code=422,
            detail=f"Record cannot be approved. Missing core facts for: {', '.join(missing_required)}",
        )
    if _diffusion_has_blocking_flag(review_field_map):
        raise HTTPException(
            status_code=422,
            detail="Record cannot be approved while flagged core diffusion facts remain",
        )
    normalization_blockers = _diffusion_approval_blockers(record, review_payload)
    if normalization_blockers:
        raise HTTPException(
            status_code=422,
            detail=f"Record cannot be approved. {' '.join(normalization_blockers)}",
        )

    _recompute_diffusion_review_status(record, field_map, approved=True)
    await db.commit()
    await db.refresh(record)
    await log_activity(
        db=db,
        user_id=principal.user.id,
        group_id=principal.group.id,
        action_type="edit_record",
        action_detail={
            "record_id": record.id,
            "literature_id": record.literature_id,
            "review_action": "approve_diffusion_record",
        },
        resource_type="diffusion_record",
        resource_id=record.id,
        request=request,
    )
    return _build_diffusion_field_evidence_payload(record)


@router.get("/review/diffusion-candidates/{candidate_id}/field-evidence")
async def get_diffusion_candidate_field_evidence(
    candidate_id: int,
    db: AsyncSession = Depends(get_db),
    principal: AuthPrincipal = Depends(get_current_principal),
):
    candidate = await require_diffusion_candidate_access(db, principal, candidate_id)
    return _build_diffusion_field_evidence_payload(candidate)


@router.post("/review/literature/{literature_id}/diffusion-candidates/manual")
async def create_manual_diffusion_candidate(
    literature_id: int,
    payload: ManualDiffusionCandidatePayload,
    request: Request,
    db: AsyncSession = Depends(get_db),
    principal: AuthPrincipal = Depends(get_current_principal),
):
    literature = await require_literature_access(db, principal, literature_id, write=True)
    if not any(value is not None for value in (payload.d_total, payload.d_cation, payload.d_anion)):
        raise HTTPException(status_code=422, detail="At least one diffusion coefficient value is required.")
    if not (payload.d_unit or "").strip():
        raise HTTPException(status_code=422, detail="Diffusion unit is required.")

    field_map = _build_manual_diffusion_candidate_field_map(payload)
    confidence = float(payload.confidence if payload.confidence is not None else 0.62)
    candidate = DiffusionCandidate(
        literature_id=literature.id,
        system_name=payload.system_name,
        ionic_liquid=payload.ionic_liquid,
        d_total=payload.d_total,
        d_cation=payload.d_cation,
        d_anion=payload.d_anion,
        d_unit=payload.d_unit,
        temperature_value=payload.temperature_value,
        confinement_scale_value=payload.confinement_scale_value,
        confinement_scale_unit=payload.confinement_scale_unit,
        source=_manual_diffusion_source_label(payload),
        source_page=payload.source_page,
        evidence=_manual_diffusion_note(payload),
        provider="human_review",
        prompt_version="manual.figure_estimate.v1",
        raw_model_output=json.dumps(_dump_manual_diffusion_payload(payload), ensure_ascii=False),
        field_evidence_json=json.dumps(field_map, ensure_ascii=False),
        review_status="pending_review",
        record_origin="manual_figure_estimate",
        confidence=confidence,
        novel_features_json=json.dumps(
            {
                "manual_estimate": True,
                "source_kind": "figure",
                "source_values": _build_manual_diffusion_source_values(payload),
            },
            ensure_ascii=False,
        ),
    )
    _recompute_diffusion_review_status(candidate, field_map)
    db.add(candidate)
    await db.flush()

    literature.status = "completed"
    literature.error_message = None
    db.add(
        ExtractionRun(
            run_id=f"manual-diffusion-{uuid4().hex[:12]}",
            literature_id=literature.id,
            extractor_type="diffusion",
            profile="manual_figure_estimate",
            status="completed",
            candidate_count=1,
            final_count=0,
            dropped_by_reason=json.dumps({}, ensure_ascii=False),
            page_coverage=json.dumps({"manual_entry": 1}, ensure_ascii=False),
            summary_json=json.dumps(
                {
                    "current_message": "Manual figure estimate added for review.",
                    "progress_log": [
                        {
                            "stage": "manual.figure_estimate",
                            "message": "Reviewer added a graph-estimated diffusion candidate.",
                            "page": payload.source_page,
                        }
                    ],
                },
                ensure_ascii=False,
            ),
        )
    )
    await db.commit()
    await db.refresh(candidate)
    await log_activity(
        db=db,
        user_id=principal.user.id,
        group_id=principal.group.id,
        action_type="edit_record",
        action_detail={
            "candidate_id": candidate.id,
            "literature_id": literature.id,
            "review_action": "create_manual_diffusion_candidate",
        },
        resource_type="diffusion_candidate",
        resource_id=candidate.id,
        request=request,
    )
    return _diffusion_record_response_payload(candidate)


@router.get("/review/diffusion-candidates/{candidate_id}/field-evidence/{field_key}")
async def get_diffusion_candidate_field_evidence_for_field(
    candidate_id: int,
    field_key: str,
    db: AsyncSession = Depends(get_db),
    principal: AuthPrincipal = Depends(get_current_principal),
):
    candidate = await require_diffusion_candidate_access(db, principal, candidate_id)
    payload = _build_diffusion_field_evidence_payload(candidate)
    normalized_key = _normalize_field_key(field_key)
    field_payload = payload["fields"].get(normalized_key)
    if field_payload is None:
        raise HTTPException(status_code=404, detail=f"Field evidence '{field_key}' not found")
    return {
        "record_id": candidate.id,
        "literature_id": candidate.literature_id,
        "field_key": normalized_key,
        "field": field_payload,
        "sample_id": None,
        "series_id": None,
        "review_status": candidate.review_status,
    }


@router.post("/review/diffusion-candidates/{candidate_id}/fields/{field_key}/confirm")
async def confirm_diffusion_candidate_field_evidence(
    candidate_id: int,
    field_key: str,
    payload: ReviewFieldActionPayload,
    request: Request,
    db: AsyncSession = Depends(get_db),
    principal: AuthPrincipal = Depends(get_current_principal),
):
    candidate = await require_diffusion_candidate_access(db, principal, candidate_id, write=True)
    normalized_key = _normalize_field_key(field_key)
    field_map = _parse_field_evidence_map(candidate.field_evidence_json)
    review_field_map = _build_diffusion_field_evidence_payload(candidate)["fields"]
    target_keys = _target_field_keys_for_action(normalized_key, review_field_map)
    if not target_keys:
        raise HTTPException(status_code=404, detail=f"Field evidence '{field_key}' not found")
    if any(_field_grounding_status(review_field_map.get(key) or {}) != "grounded" for key in target_keys):
        raise HTTPException(status_code=422, detail=f"Field '{field_key}' cannot be confirmed without evidence")

    for key in target_keys:
        entry = field_map.get(key)
        if not isinstance(entry, dict):
            entry = dict(review_field_map.get(key) or {})
        entry["review_state"] = "confirmed"
        if payload.note is not None:
            entry["review_note"] = payload.note
        field_map[key] = entry
    _persist_field_map(candidate, field_map)
    _recompute_diffusion_review_status(candidate, field_map)
    await db.commit()
    await db.refresh(candidate)
    await log_activity(
        db=db,
        user_id=principal.user.id,
        group_id=principal.group.id,
        action_type="edit_record",
        action_detail={
            "candidate_id": candidate.id,
            "literature_id": candidate.literature_id,
            "review_action": "confirm_diffusion_candidate_field",
            "field_key": normalized_key,
        },
        resource_type="diffusion_candidate",
        resource_id=candidate.id,
        request=request,
    )
    return _build_diffusion_field_evidence_payload(candidate)


@router.patch("/review/diffusion-candidates/{candidate_id}/fields/{field_key}/evidence")
async def patch_diffusion_candidate_field_evidence(
    candidate_id: int,
    field_key: str,
    payload: ReviewFieldEvidencePatchPayload,
    request: Request,
    db: AsyncSession = Depends(get_db),
    principal: AuthPrincipal = Depends(get_current_principal),
):
    candidate = await require_diffusion_candidate_access(db, principal, candidate_id, write=True)
    normalized_key = _normalize_field_key(field_key)
    field_map = _apply_review_field_evidence_patch(
        candidate,
        normalized_key,
        payload,
        value_getter=_diffusion_field_value_from_record,
    )
    _recompute_diffusion_review_status(candidate, field_map)
    await db.commit()
    await db.refresh(candidate)
    await log_activity(
        db=db,
        user_id=principal.user.id,
        group_id=principal.group.id,
        action_type="edit_record",
        action_detail={
            "candidate_id": candidate.id,
            "literature_id": candidate.literature_id,
            "review_action": "patch_diffusion_candidate_field_evidence",
            "field_key": normalized_key,
        },
        resource_type="diffusion_candidate",
        resource_id=candidate.id,
        request=request,
    )
    return _build_diffusion_field_evidence_payload(candidate)


@router.post("/review/diffusion-candidates/{candidate_id}/fields/{field_key}/flag")
async def flag_diffusion_candidate_field_evidence(
    candidate_id: int,
    field_key: str,
    payload: ReviewFieldActionPayload,
    request: Request,
    db: AsyncSession = Depends(get_db),
    principal: AuthPrincipal = Depends(get_current_principal),
):
    candidate = await require_diffusion_candidate_access(db, principal, candidate_id, write=True)
    normalized_key = _normalize_field_key(field_key)
    field_map = _parse_field_evidence_map(candidate.field_evidence_json)
    target_keys = _target_field_keys_for_action(normalized_key, field_map)
    for key in target_keys:
        entry = field_map.get(key)
        if not isinstance(entry, dict):
            entry = {
                "value": _diffusion_field_value_from_record(candidate, key),
                "confidence": candidate.confidence,
                "evidence": None,
            }
        entry["review_state"] = "flagged"
        entry["review_note"] = payload.note or "Flagged during review"
        field_map[key] = entry
    _persist_field_map(candidate, field_map)
    _recompute_diffusion_review_status(candidate, field_map)
    await db.commit()
    await db.refresh(candidate)
    await log_activity(
        db=db,
        user_id=principal.user.id,
        group_id=principal.group.id,
        action_type="edit_record",
        action_detail={
            "candidate_id": candidate.id,
            "literature_id": candidate.literature_id,
            "review_action": "flag_diffusion_candidate_field",
            "field_key": normalized_key,
        },
        resource_type="diffusion_candidate",
        resource_id=candidate.id,
        request=request,
    )
    return _build_diffusion_field_evidence_payload(candidate)


@router.post("/review/diffusion-candidates/{candidate_id}/fields/{field_key}/unflag")
async def unflag_diffusion_candidate_field_evidence(
    candidate_id: int,
    field_key: str,
    payload: ReviewFieldActionPayload,
    request: Request,
    db: AsyncSession = Depends(get_db),
    principal: AuthPrincipal = Depends(get_current_principal),
):
    candidate = await require_diffusion_candidate_access(db, principal, candidate_id, write=True)
    normalized_key = _normalize_field_key(field_key)
    field_map = _parse_field_evidence_map(candidate.field_evidence_json)
    target_keys = _target_field_keys_for_action(normalized_key, field_map)
    _clear_flagged_field_entries(field_map, target_keys, payload.note)
    _persist_field_map(candidate, field_map)
    _recompute_diffusion_review_status(candidate, field_map)
    await db.commit()
    await db.refresh(candidate)
    await log_activity(
        db=db,
        user_id=principal.user.id,
        group_id=principal.group.id,
        action_type="edit_record",
        action_detail={
            "candidate_id": candidate.id,
            "literature_id": candidate.literature_id,
            "review_action": "unflag_diffusion_candidate_field",
            "field_key": normalized_key,
        },
        resource_type="diffusion_candidate",
        resource_id=candidate.id,
        request=request,
    )
    return _build_diffusion_field_evidence_payload(candidate)


@router.post("/review/diffusion-candidates/{candidate_id}/approve")
async def approve_diffusion_candidate_review(
    candidate_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    principal: AuthPrincipal = Depends(get_current_principal),
):
    candidate = await require_diffusion_candidate_access(db, principal, candidate_id, write=True)
    field_map = _parse_field_evidence_map(candidate.field_evidence_json)
    review_payload = _build_diffusion_field_evidence_payload(candidate)
    review_field_map = review_payload["fields"]
    missing_required = _diffusion_missing_required_fields(review_field_map)
    if missing_required:
        raise HTTPException(
            status_code=422,
            detail=f"Candidate cannot be approved. Missing core facts for: {', '.join(missing_required)}",
        )
    if _diffusion_has_blocking_flag(review_field_map):
        raise HTTPException(
            status_code=422,
            detail="Candidate cannot be approved while flagged core diffusion facts remain",
        )
    normalization_blockers = _diffusion_approval_blockers(candidate, review_payload)
    if normalization_blockers:
        raise HTTPException(
            status_code=422,
            detail=f"Candidate cannot be approved. {' '.join(normalization_blockers)}",
        )

    _recompute_diffusion_review_status(candidate, field_map, approved=True)
    await promote_diffusion_candidate(db, candidate)
    await db.commit()
    await db.refresh(candidate)
    await log_activity(
        db=db,
        user_id=principal.user.id,
        group_id=principal.group.id,
        action_type="edit_record",
        action_detail={
            "candidate_id": candidate.id,
            "promoted_record_id": candidate.promoted_record_id,
            "literature_id": candidate.literature_id,
            "review_action": "approve_diffusion_candidate",
        },
        resource_type="diffusion_candidate",
        resource_id=candidate.id,
        request=request,
    )
    return _build_diffusion_field_evidence_payload(candidate)


@router.post("/review/diffusion-candidates/{candidate_id}/reject")
async def reject_diffusion_candidate_review(
    candidate_id: int,
    payload: ReviewFieldActionPayload,
    request: Request,
    db: AsyncSession = Depends(get_db),
    principal: AuthPrincipal = Depends(get_current_principal),
):
    candidate = await require_diffusion_candidate_access(db, principal, candidate_id, write=True)
    candidate.review_status = "rejected"
    await db.commit()
    await db.refresh(candidate)
    await log_activity(
        db=db,
        user_id=principal.user.id,
        group_id=principal.group.id,
        action_type="edit_record",
        action_detail={
            "candidate_id": candidate.id,
            "literature_id": candidate.literature_id,
            "review_action": "reject_diffusion_candidate",
            "note": payload.note,
        },
        resource_type="diffusion_candidate",
        resource_id=candidate.id,
        request=request,
    )
    return _build_diffusion_field_evidence_payload(candidate)


@router.post("/upload")
async def upload_file(
    request: Request,
    file: UploadFile = File(...),
    auto_extract: bool = Query(False),
    extractor_type: str = Query("tribology", pattern="^(tribology|diffusion)$"),
    db: AsyncSession = Depends(get_db),
    principal: AuthPrincipal = Depends(get_current_principal),
    scope: RequestScope = Depends(get_request_scope),
):
    """
    Upload file and persist to DB.
    Extraction is explicitly triggered by the frontend to avoid accidental
    duplicate runs and confusing batch interactions. Background extraction can
    still be enabled via auto_extract=true when needed.
    """
    try:
        started_at = perf_counter()
        if not file.filename:
            raise HTTPException(status_code=400, detail="Filename is required")

        ensure_scope_writable(principal, scope)
        logger.info(
            "Upload request accepted filename=%s extractor_type=%s content_length=%s scope=%s",
            file.filename,
            extractor_type,
            request.headers.get("content-length"),
            scope.scope_key,
        )

        literature = await save_upload_entry(db, file, principal=principal, scope=scope)

        # 记录上传活动
        await log_activity(
            db=db,
            user_id=principal.user.id,
            group_id=principal.group.id,
            action_type="upload_pdf",
            action_detail={
                "filename": file.filename,
                "literature_id": literature.id,
                "extractor_type": extractor_type,
            },
            resource_type="literature",
            resource_id=literature.id,
            request=request,
        )

        upload_status = await _upload_status_for_extractor(db, literature, extractor_type)
        queue_snapshot = None

        if auto_extract and upload_status == "pending":
            logger.info("Queueing background extraction for literature_id=%s", literature.id)
            queue_snapshot = await get_extraction_queue().enqueue(
                literature_id=literature.id,
                extractor_type=extractor_type,
            )
            upload_status = "processing"
        elif auto_extract:
            logger.info("Skipping background extraction for literature_id=%s status=%s", literature.id, upload_status)

        logger.info(
            "Upload request completed literature_id=%s status=%s extractor_type=%s duration=%.2fs",
            literature.id,
            upload_status,
            extractor_type,
            perf_counter() - started_at,
        )

        cache_payload = await _upload_cache_payload(db, literature, extractor_type)
        return {
            "success": True,
            "message": "File uploaded",
            "file_id": str(literature.id),
            "filename": literature.title,
            **cache_payload,
            "status": upload_status,
            "extractor_type": extractor_type,
            "run_id": queue_snapshot.get("run_id") if queue_snapshot else None,
            "queue_position": queue_snapshot.get("queue_position") if queue_snapshot else None,
        }
    except HTTPException:
        raise
    except InvalidUploadError as exc:
        await db.rollback()
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        await db.rollback()
        _raise_internal_error("Upload file", exc)


@router.post("/extract/{file_id}/cancel")
async def cancel_extraction(
    file_id: str,
    request: Request,
    extractor_type: str = Query("tribology", pattern="^(tribology|diffusion)$"),
    db: AsyncSession = Depends(get_db),
    principal: AuthPrincipal = Depends(get_current_principal),
):
    try:
        try:
            lit_id = int(file_id)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid File ID format (expected integer)")

        literature = await require_literature_access(db, principal, lit_id, write=True)
        run = await cancel_latest_extraction_run(
            db,
            literature_id=lit_id,
            extractor_type=extractor_type,
            message=CANCELLED_EXTRACTION_MESSAGE,
        )
        queue_cancel = await get_extraction_queue().cancel(
            literature_id=lit_id,
            extractor_type=extractor_type,
        )

        run_status = str(getattr(run, "status", "") or "").strip().lower()
        cancelled = run_status == "cancelled" or bool(queue_cancel.get("cancelled"))
        if cancelled:
            literature.status = "pending" if extractor_type == "diffusion" else "cancelled"
            literature.error_message = CANCELLED_EXTRACTION_MESSAGE

        await log_activity(
            db=db,
            user_id=principal.user.id,
            group_id=principal.group.id,
            action_type="cancel_extraction",
            action_detail={
                "literature_id": lit_id,
                "extractor_type": extractor_type,
                "run_id": getattr(run, "run_id", None),
                "cancelled": cancelled,
                "queue_cancel": queue_cancel,
            },
            resource_type="literature",
            resource_id=lit_id,
            request=request,
        )
        await db.commit()

        return {
            "success": bool(cancelled),
            "status": "cancelled" if cancelled else literature.status,
            "message": CANCELLED_EXTRACTION_MESSAGE if cancelled else "No running extraction found.",
            "run_id": getattr(run, "run_id", None),
            "literature_id": lit_id,
            "extractor_type": extractor_type,
            "queue_cancel": queue_cancel,
        }
    except HTTPException:
        raise
    except Exception as exc:
        await db.rollback()
        _raise_internal_error("Cancel extraction", exc)


@router.post("/extract/{file_id}")
async def extract_data(
    file_id: str,
    request: Request,
    force: bool = False,
    profile: str = Query("auto", pattern="^(auto|high_accuracy|standard|review_figure_estimate)$"),
    extractor_type: str = Query("tribology", pattern="^(tribology|diffusion)$"),
    strict_cof_mode: bool | None = Query(None),
    db: AsyncSession = Depends(get_db),
    principal: AuthPrincipal = Depends(get_current_principal),
):
    """
    Synchronous Extraction/Retrieval.
    If background task is running, this might wait or return results.
    Refactored to work with DB IDs.
    """
    try:
        # 1. Parse ID (Handle legacy UUID vs new Int ID)
        try:
            lit_id = int(file_id)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid File ID format (expected integer)")

        literature = await require_literature_access(db, principal, lit_id, write=True)
        requested_profile = str(profile or "auto").strip().lower()
        allowed_profiles = {"auto", "high_accuracy", "standard", "review_figure_estimate"}
        profile = requested_profile if requested_profile in allowed_profiles else "auto"

        # 记录提取活动
        await log_activity(
            db=db,
            user_id=principal.user.id,
            group_id=principal.group.id,
            action_type="extract_data",
            action_detail={
                "literature_id": lit_id,
                "profile": profile,
                "requested_profile": requested_profile,
                "force": force,
                "extractor_type": extractor_type,
            },
            resource_type="literature",
            resource_id=lit_id,
            request=request,
        )

        # 2. Process Safely (Synchronous Wait)
        logger.info(
            "Starting extraction literature_id=%s force=%s profile=%s extractor_type=%s strict_cof_mode=%s",
            lit_id,
            force,
            profile,
            extractor_type,
            strict_cof_mode,
        )

        lane_status = await _upload_status_for_extractor(db, literature, extractor_type)
        latest_run = await get_latest_extraction_run_by_literature(db, lit_id, extractor_type=extractor_type)
        run_status = str(getattr(latest_run, "status", "") or "").strip().lower()
        active_run_statuses = {"queued", "running", "processing", "extracting"}
        if force and latest_run and run_status in active_run_statuses:
            last_touch = latest_run.updated_at or latest_run.created_at
            if last_touch and (datetime.utcnow() - last_touch) > timedelta(minutes=10):
                stale_message = "Previous extraction run stalled before finishing; retrying with a fresh run."
                stale_summary = {
                    "run_id": latest_run.run_id,
                    "extractor_type": extractor_type,
                    "profile": latest_run.profile or profile,
                    "status": "failed",
                    "candidate_count": int(latest_run.candidate_count or 0),
                    "final_count": int(latest_run.final_count or 0),
                    "dropped_by_reason": {"stalled_run": 1},
                    "page_coverage": {},
                    "page_candidate_counts": {},
                    "current_stage": "failed",
                    "current_message": stale_message,
                    "progress_log": [{"stage": "failed", "message": stale_message}],
                }
                await finalize_extraction_run(
                    db,
                    run_id=latest_run.run_id,
                    status="failed",
                    candidate_count=int(latest_run.candidate_count or 0),
                    final_count=int(latest_run.final_count or 0),
                    dropped_by_reason=stale_summary["dropped_by_reason"],
                    summary=stale_summary,
                    error_message=stale_message,
                )
                literature.status = "failed"
                literature.error_message = stale_message
                await db.commit()
                lane_status = await _upload_status_for_extractor(db, literature, extractor_type)
                latest_run = await get_latest_extraction_run_by_literature(db, lit_id, extractor_type=extractor_type)
                run_status = str(getattr(latest_run, "status", "") or "").strip().lower()

        if lane_status == "processing" or run_status in active_run_statuses:
            summary = _build_processing_summary(
                extractor_type=extractor_type,
                profile=profile,
                run=latest_run,
                message=f"{extractor_type.title()} extraction is already running in the background.",
            )
            await db.commit()
            return {
                "success": True,
                "status": "processing",
                "metadata": {},
                "data": [],
                "extraction_summary": summary,
                "agent_workflow": {},
                "extractor_type": extractor_type,
                "message": summary["current_message"],
            }

        should_read_cached_inline = (not force) and lane_status in {"completed", "no_data"}
        if not should_read_cached_inline:
            queue_snapshot = await get_extraction_queue().enqueue(
                literature_id=lit_id,
                extractor_type=extractor_type,
                force=force,
                profile=profile,
                strict_cof_mode=strict_cof_mode,
            )
            summary = _build_processing_summary(
                extractor_type=extractor_type,
                profile=profile,
                message=f"{extractor_type.title()} extraction started in the background. You can keep working while it runs.",
            )
            summary["run_id"] = queue_snapshot.get("run_id") or summary.get("run_id")
            summary["queue_position"] = queue_snapshot.get("queue_position")
            summary["current_stage"] = "stage_a.queued"
            if queue_snapshot.get("queue_position"):
                summary["current_message"] = f"Extraction queued at position {queue_snapshot['queue_position']}."
            return {
                "success": True,
                "status": "processing",
                "metadata": {},
                "data": [],
                "extraction_summary": summary,
                "agent_workflow": {},
                "extractor_type": extractor_type,
                "message": summary["current_message"],
            }

        workflow_result = await get_agent_runtime().run_extraction_workflow(
            file_id=lit_id,
            force=force,
            profile=profile,
            extractor_type=extractor_type,
            strict_cof_mode=strict_cof_mode,
        )
        metadata = workflow_result.get("metadata") or {}
        data_list = workflow_result.get("data") or []
        extraction_summary = workflow_result.get("extraction_summary") or {}
        agent_workflow = workflow_result.get("agent_workflow") or {}

        if (
            str((extraction_summary or {}).get("status") or "").lower() == "cancelled"
            or (extraction_summary or {}).get("dropped_by_reason", {}).get("cancelled")
            or str((extraction_summary or {}).get("current_stage") or "").lower() == "cancelled"
        ):
            return {
                "success": False,
                "status": "cancelled",
                "metadata": {},
                "data": [],
                "extraction_summary": extraction_summary,
                "agent_workflow": agent_workflow,
                "extractor_type": extractor_type,
                "message": (extraction_summary or {}).get("current_message") or CANCELLED_EXTRACTION_MESSAGE,
            }

        if (extraction_summary or {}).get("dropped_by_reason", {}).get("in_progress"):
            return {
                "success": True,
                "status": "processing",
                "metadata": {},
                "data": [],
                "extraction_summary": extraction_summary,
                "agent_workflow": agent_workflow,
                "extractor_type": extractor_type,
                "message": "Extraction is still running in the background. Please retry shortly."
            }

        no_data_message = (
            (extraction_summary or {}).get("no_data_reason")
            or (extraction_summary or {}).get("current_message")
            or "No extractable records found."
        )

        # 3. Construct Response
        if data_list or metadata:
            from models.tribology import LiteratureMetadata
            meta_obj = LiteratureMetadata(
                title=metadata.get("title", "Untitled"),
                doi=metadata.get("doi", ""),
                authors=metadata.get("authors", ""),
                journal=metadata.get("journal", ""),
                year=metadata.get("year", 0),
                volume=metadata.get("volume"),
                issue=metadata.get("issue"),
                pages=metadata.get("pages"),
                issn=metadata.get("issn"),
            )

            return {
                "success": True,
                "status": "no_data" if not data_list else "completed",
                "metadata": meta_obj,
                "data": data_list,
                "extraction_summary": extraction_summary,
                "agent_workflow": agent_workflow,
                "extractor_type": extractor_type,
                "message": no_data_message if not data_list else f"Successfully extracted {len(data_list)} records."
            }
        else:
            return {
                "success": True,
                "status": "no_data",
                "metadata": {},
                "data": [],
                "extraction_summary": extraction_summary,
                "agent_workflow": agent_workflow,
                "extractor_type": extractor_type,
                "message": no_data_message
            }

    except HTTPException:
        raise
    except Exception as exc:
        _raise_internal_error("Extract data", exc)


@router.get("/data/{file_id}", response_model=List[TribologyData])
async def get_extracted_data(
    file_id: str,
    db: AsyncSession = Depends(get_db),
    principal: AuthPrincipal = Depends(get_current_principal),
):
    """鑾峰彇宸叉彁鍙栫殑鏁版嵁"""
    try:
        from sqlalchemy import select as sa_select

        lit_id = int(file_id)
        literature = await require_literature_access(db, principal, lit_id)
        candidate_stmt = (
            sa_select(RecordCandidate)
            .where(RecordCandidate.literature_id == lit_id)
            .order_by(RecordCandidate.id.asc())
        )
        candidate_result = await db.execute(candidate_stmt)
        candidate_records = list(candidate_result.scalars().all())
        if candidate_records:
            return _deduplicate_tribology_payloads([
                _tribology_record_api_payload(record) for record in candidate_records
            ])
        records = await get_records_by_literature(
            db,
            lit_id,
            scope_filter_values=scope_filters(
                RequestScope(
                    scope_type=literature.scope_type,
                    group_id=literature.group_id,
                    scope_key=literature.scope_key,
                    workspace=literature.workspace,
                )
            ),
        )
        return _deduplicate_tribology_payloads([
            _tribology_record_api_payload(record) for record in records
        ])
    except ValueError:
        if file_id in extracted_data_store:
            return extracted_data_store[file_id]["data"]
        raise HTTPException(status_code=404, detail="Invalid File ID or Data Not Found")
    except Exception as exc:
        _raise_internal_error("Get extracted data", exc)


@router.get("/data")
async def get_all_data(
    db: AsyncSession = Depends(get_db),
    scope: RequestScope = Depends(get_request_scope),
):
    """鑾峰彇鎵€鏈夋彁鍙栫殑鏁版嵁"""
    from sqlalchemy import select as sa_select

    stmt = (
        sa_select(TribologyDataDB)
        .join(TribologyDataDB.literature)
        .where(*literature_scope_conditions(scope_filters(scope)))
    )
    result = await db.execute(stmt)
    return list(result.scalars().all())


@router.get("/extraction-runs/{run_id}")
async def get_extraction_run_detail(
    run_id: str,
    db: AsyncSession = Depends(get_db),
    principal: AuthPrincipal = Depends(get_current_principal),
):
    run = await get_extraction_run(db, run_id)
    if not run:
        raise HTTPException(status_code=404, detail=f"Extraction run '{run_id}' not found")
    await require_literature_access(db, principal, run.literature_id)

    def _parse_json(value):
        if not value:
            return {}
        try:
            return json.loads(value)
        except Exception:
            return {}

    summary = _parse_json(run.summary_json)
    return {
        "run_id": run.run_id,
        "literature_id": run.literature_id,
        "extractor_type": run.extractor_type,
        "profile": run.profile,
        "status": run.status,
        "candidate_count": run.candidate_count,
        "final_count": run.final_count,
        "dropped_by_reason": _parse_json(run.dropped_by_reason),
        "page_coverage": _parse_json(run.page_coverage),
        "page_candidate_counts": summary.get("page_candidate_counts") or {},
        "progress_log": summary.get("progress_log") or [],
        "summary": summary,
        "error_message": run.error_message,
        "created_at": run.created_at,
        "updated_at": run.updated_at,
    }


@router.get("/extraction-runs/latest/{literature_id}")
async def get_latest_extraction_run_detail(
    literature_id: int,
    extractor_type: str = Query("tribology", pattern="^(tribology|diffusion)$"),
    db: AsyncSession = Depends(get_db),
    principal: AuthPrincipal = Depends(get_current_principal),
):
    from sqlalchemy import func, select as sa_select

    await require_literature_access(db, principal, literature_id)
    literature = await db.get(Literature, literature_id)
    if literature and extractor_type != "diffusion" and await _normalize_legacy_no_data_state(db, literature):
        await db.commit()
    run = await get_latest_extraction_run_by_literature(db, literature_id, extractor_type=extractor_type)
    literature_status = str(getattr(literature, "status", "") or "").strip().lower()
    if not run:
        if literature and _should_wait_for_fresh_extractor_run(literature_status, "", has_requested_run=False):
            summary = _build_processing_summary(
                extractor_type=extractor_type,
                message=f"{extractor_type.title()} extraction is queued. The run log will appear shortly."
            )
            return {
                "run_id": None,
                "literature_id": literature_id,
                "extractor_type": extractor_type,
                "profile": "auto",
                "status": "processing",
                "candidate_count": 0,
                "final_count": 0,
                "dropped_by_reason": summary["dropped_by_reason"],
                "page_coverage": {},
                "page_candidate_counts": {},
                "progress_log": summary["progress_log"],
                "summary": summary,
                "error_message": None,
                "created_at": None,
                "updated_at": None,
            }
        return {
            "run_id": None,
            "literature_id": literature_id,
            "extractor_type": extractor_type,
            "status": "not_started",
            "candidate_count": 0,
            "final_count": 0,
            "dropped_by_reason": {},
            "page_coverage": {},
            "page_candidate_counts": {},
            "progress_log": [],
            "summary": {},
            "error_message": None,
            "created_at": None,
            "updated_at": None,
        }

    run_status = str(getattr(run, "status", "") or "").strip().lower()
    if _should_wait_for_fresh_extractor_run(literature_status, run_status, has_requested_run=True):
        summary = _build_processing_summary(
            extractor_type=extractor_type,
            message=f"{extractor_type.title()} extraction is queued. Waiting for the worker to create a fresh run log.",
        )
        summary["next_action"] = "wait_for_run_log"
        return {
            "run_id": None,
            "literature_id": literature_id,
            "extractor_type": extractor_type,
            "profile": "auto",
            "status": "processing",
            "candidate_count": 0,
            "final_count": 0,
            "dropped_by_reason": summary["dropped_by_reason"],
            "page_coverage": {},
            "page_candidate_counts": {},
            "progress_log": summary["progress_log"],
            "summary": summary,
            "error_message": None,
            "created_at": None,
            "updated_at": None,
        }

    def _parse_json(value):
        if not value:
            return {}
        try:
            return json.loads(value)
        except Exception:
            return {}

    summary = _parse_json(run.summary_json)
    if extractor_type == "diffusion":
        candidate_count = (
            await db.execute(
                sa_select(func.count(DiffusionCandidate.id)).where(DiffusionCandidate.literature_id == literature_id)
            )
        ).scalar() or 0
        final_count = (
            await db.execute(
                sa_select(func.count(DiffusionRecord.id)).where(DiffusionRecord.literature_id == literature_id)
            )
        ).scalar() or 0
        if run_status in {"queued", "running", "processing", "extracting", "completed", "success"}:
            candidate_count = max(
                int(candidate_count or 0),
                int(getattr(run, "candidate_count", 0) or 0),
                int(summary.get("candidate_count") or 0),
            )
            final_count = max(
                int(final_count or 0),
                int(getattr(run, "final_count", 0) or 0),
                int(summary.get("final_count") or 0),
            )
        summary["diffusion_artifacts"] = {
            "candidate_count": int(candidate_count or 0),
            "final_count": int(final_count or 0),
            "reviewable_count": int((candidate_count or 0) + (final_count or 0)),
        }
    else:
        candidate_count, final_count = await _count_cached_record_artifacts(db, literature_id)
        if run_status in {"queued", "running", "processing", "extracting", "completed", "success"}:
            candidate_count = max(
                int(candidate_count or 0),
                int(getattr(run, "candidate_count", 0) or 0),
                int(summary.get("candidate_count") or 0),
            )
            final_count = max(
                int(final_count or 0),
                int(getattr(run, "final_count", 0) or 0),
                int(summary.get("final_count") or 0),
            )
    response_status = "processing" if run_status == "queued" else run.status
    response_error = run.error_message
    if literature and str(literature.status or "").strip().lower() == "no_data" and not (candidate_count or final_count):
        response_status = "no_data"
        no_data_message = _no_data_message_for_run(
            literature_message=literature.error_message,
            run_message=run.error_message,
            summary=summary,
        )
        response_error = no_data_message
        progress_log = summary.get("progress_log")
        if not isinstance(progress_log, list):
            progress_log = []
        if not any(
            isinstance(item, dict)
            and str(item.get("stage") or "").strip() == "stage_e.finalize"
            and str(item.get("message") or "").strip() == no_data_message
            for item in progress_log
        ):
            progress_log = [*progress_log, {"stage": "stage_e.finalize", "message": no_data_message}]
        summary["current_stage"] = "stage_e.finalize"
        summary["current_message"] = no_data_message
        summary["no_data_reason"] = no_data_message
        summary["progress_log"] = progress_log
    elif (
        extractor_type == "diffusion"
        and str(response_status or "").strip().lower() in {"completed", "success"}
        and int((candidate_count or 0) + (final_count or 0)) > 0
    ):
        reviewable_count = int((candidate_count or 0) + (final_count or 0))
        current_message = (
            f"Diffusion extraction produced {reviewable_count} reviewable records "
            f"({int(candidate_count or 0)} candidates, {int(final_count or 0)} approved)."
        )
        progress_log = summary.get("progress_log")
        if not isinstance(progress_log, list):
            progress_log = []
        if not any(
            isinstance(item, dict)
            and str(item.get("stage") or "").strip() == "stage_e.review_queue"
            and str(item.get("message") or "").strip() == current_message
            for item in progress_log
        ):
            progress_log = [*progress_log, {"stage": "stage_e.review_queue", "message": current_message}]
        summary["current_stage"] = "stage_e.review_queue"
        summary["current_message"] = current_message
        summary["next_action"] = "open_review"
        summary["progress_log"] = progress_log

    return {
        "run_id": run.run_id,
        "literature_id": run.literature_id,
        "extractor_type": run.extractor_type,
        "profile": run.profile,
        "status": response_status,
        "candidate_count": int(candidate_count or 0),
        "final_count": int(final_count or 0),
        "dropped_by_reason": _parse_json(run.dropped_by_reason),
        "page_coverage": _parse_json(run.page_coverage),
        "page_candidate_counts": summary.get("page_candidate_counts") or {},
        "progress_log": summary.get("progress_log") or [],
        "summary": summary,
        "error_message": response_error,
        "created_at": run.created_at,
        "updated_at": run.updated_at,
    }


@router.get("/extraction-runs/{run_id}/candidates")
async def get_extraction_run_candidates(
    run_id: str,
    skip: int = 0,
    limit: int = 200,
    db: AsyncSession = Depends(get_db),
    principal: AuthPrincipal = Depends(get_current_principal),
):
    run = await get_extraction_run(db, run_id)
    if not run:
        raise HTTPException(status_code=404, detail=f"Extraction run '{run_id}' not found")
    await require_literature_access(db, principal, run.literature_id)
    total, rows = await list_extraction_candidates(db, run_id, skip=skip, limit=limit)

    def _parse_json(value):
        if not value:
            return None
        try:
            return json.loads(value)
        except Exception:
            return value

    return {
        "run_id": run_id,
        "total": total,
        "skip": skip,
        "limit": limit,
        "items": [
            {
                "id": r.id,
                "stage": r.stage,
                "modality": r.modality,
                "page": r.page,
                "source_figure": r.source_figure,
                "panel_label": r.panel_label,
                "raw": _parse_json(r.raw_json),
                "normalized": _parse_json(r.normalized_json),
                "drop_reason": r.drop_reason,
                "merged_into": r.merged_into,
                "created_at": r.created_at,
            }
            for r in rows
        ],
    }


@router.post("/chat")
async def chat(
    request: ChatRequest,
    db: AsyncSession = Depends(get_db),
    scope: RequestScope = Depends(get_request_scope),
):
    """AI assistant chat grounded in the current literature scope."""

    user_context = None
    if request.context:
        user_context = request.context
    else:
        if uploaded_files_store:
            latest_file = list(uploaded_files_store.values())[-1]
            user_context = latest_file["content"][:3000]

    sources, query_terms = await retrieve_literature_chat_sources(
        db,
        request.message,
        scope_filter_values=scope_filters(scope),
    )
    context = build_literature_chat_context(sources, user_context=user_context)
    response = await llm_service.chat(request.message, context)
    if str(response or "").startswith("Request failed:"):
        response = f"{response}\n\n{build_retrieval_fallback_answer(request.message, sources)}"

    return {
        "success": True,
        "response": response,
        "sources": [source.to_payload() for source in sources],
        "retrieval": {
            "query_terms": query_terms,
            "source_count": len(sources),
        },
    }
