import os
import json
import logging
import re
from datetime import datetime
from typing import Any, List
from fastapi import APIRouter, UploadFile, File, HTTPException, Depends, BackgroundTasks, Query, Request
import base64
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy import func, select, update

from sqlalchemy.ext.asyncio import AsyncSession

from models.tribology import TribologyData, ChatRequest, LiteratureMetadata
from models.db_models import (
    DiffusionCandidate,
    DiffusionFeatureSet,
    DiffusionRecord,
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
    _is_default_temperature_value,
    _locate_field_evidence_for_value,
    _normalize_legacy_no_data_state,
    _refine_potential_evidence_from_metric_context_with_pdf,
    _temperature_default_evidence_entry,
    _text_explicitly_matches_field_value,
    process_file_background,
    save_upload_entry,
)
from services.extraction_trace_service import (
    CANCELLED_EXTRACTION_MESSAGE,
    cancel_latest_extraction_run,
    get_extraction_run,
    list_extraction_candidates,
)
from services.extraction_trace_service import get_latest_extraction_run_by_literature
from services.agent_runtime_service import get_agent_runtime
from services.activity_logging_service import log_activity
from services.score_service import calculate_confidence_details
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


def _build_diffusion_processing_summary(*, profile: str = "high_accuracy", message: str | None = None) -> dict[str, Any]:
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
    profile: str = "high_accuracy",
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

    return {
        "run_id": getattr(run, "run_id", None),
        "extractor_type": extractor_type,
        "profile": profile,
        "status": "processing",
        "candidate_count": int(getattr(run, "candidate_count", 0) or summary.get("candidate_count") or 0),
        "final_count": int(getattr(run, "final_count", 0) or summary.get("final_count") or 0),
        "dropped_by_reason": dropped_by_reason or summary.get("dropped_by_reason") or {"in_progress": 1},
        "page_coverage": page_coverage or summary.get("page_coverage") or {},
        "page_candidate_counts": summary.get("page_candidate_counts") or {},
        "progress_log": progress_log,
        "current_stage": summary.get("current_stage") or "stage_a.queued",
        "current_message": current_message,
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
    if literature_status in {"queued", "extracting", "processing", "running"}:
        return "processing"
    if literature_status in {"failed", "error", "cancelled"}:
        return literature_status

    # A literature-level completed/no_data status may belong to the other extractor.
    return "pending"


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
    tribological_system = normalize_tribological_system(getattr(record, "tribological_system_json", None)) or derive_tribological_system(
        getattr(record, "regime", None),
    )

    return {
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
        "surface_roughness": getattr(record, "surface_roughness", None),
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
        "review_status": getattr(record, "review_status", None),
        "record_origin": getattr(record, "record_origin", None),
        "review_entity_type": review_entity_type,
        "assembly_notes": getattr(record, "assembly_notes", None),
    }


def _field_grounding_status(entry: dict[str, Any]) -> str:
    if str((entry or {}).get("grounding_mode") or "").strip().lower() == "inferred" and (entry or {}).get("value") not in (None, ""):
        return "grounded"
    evidence = (entry or {}).get("evidence") or {}
    bbox = evidence.get("bbox")
    if evidence.get("page") and isinstance(bbox, list) and len(bbox) >= 4:
        return "grounded"
    if any(evidence.get(key) not in (None, "", []) for key in ("page", "source_label", "quote", "sample_id", "source_type")):
        return "partial"
    return "missing"


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
        verification_text = bbox_text or matched_text

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

        if source_type in {"text", "table"} and not _text_matches_field_or_alias(key, value, entry, verification_text):
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
    normalized_fields: dict[str, Any] = {}
    field_keys = [
        "material",
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
        normalized_fields[key] = {
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

    pdf_path = getattr(getattr(record, "literature", None), "file_path", None)
    normalized_fields = _sanitize_field_evidence_locations(normalized_fields, pdf_path=pdf_path)
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
            if isinstance(field_map.get(key), dict) and field_map.get(key)
        ]
        return keys or ["load", "speed", "shear_rate", "temperature"]
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


_DIFFUSION_REQUIRED_FIELD_KEYS = ("system_name", "ionic_liquid")
_DIFFUSION_COEFFICIENT_FIELD_KEYS = ("d_total", "d_cation", "d_anion")


def _format_diffusion_numeric(value: Any) -> Any:
    if isinstance(value, float):
        return float(f"{value:.6g}")
    return value


def _diffusion_field_value_from_record(record: Any, field_key: str) -> Any:
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
    normalized_fields: dict[str, Any] = {}
    ordered_keys = (
        "system_name",
        "confinement_material_class",
        "confinement_geometry_class",
        "surface_functional_groups",
        "confinement_dimensionality",
        "ionic_liquid",
        "d_total",
        "d_cation",
        "d_anion",
        "d_unit",
        "temperature_value",
        "confinement_scale_value",
        "confinement_scale_unit",
        "source_page",
    )
    for key in ordered_keys:
        raw_entry = field_map.get(key) if isinstance(field_map.get(key), dict) else {}
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
        "review_status": record.review_status,
        "record_origin": record.record_origin,
        "assembly_notes": getattr(record, "assembly_notes", None),
        "required_fields": ["system_name", "ionic_liquid", "diffusion_coefficient"],
        "fields": normalized_fields,
        "confidence": float(confidence_details.get("score") or 0.0),
        "confidence_details": confidence_details,
    }


def _diffusion_missing_required_fields(field_map: dict[str, Any]) -> list[str]:
    missing = [
        key
        for key in _DIFFUSION_REQUIRED_FIELD_KEYS
        if _field_grounding_status(field_map.get(key) or {}) != "grounded"
    ]
    if not any(_field_grounding_status(field_map.get(key) or {}) == "grounded" for key in _DIFFUSION_COEFFICIENT_FIELD_KEYS):
        missing.append("diffusion_coefficient")
    return missing


def _diffusion_has_blocking_flag(field_map: dict[str, Any]) -> bool:
    if any(
        str((field_map.get(key) or {}).get("review_state") or "").strip().lower() == "flagged"
        for key in _DIFFUSION_REQUIRED_FIELD_KEYS
    ):
        return True
    coefficient_entries = [field_map.get(key) or {} for key in _DIFFUSION_COEFFICIENT_FIELD_KEYS]
    coefficient_candidates = [
        entry
        for entry in coefficient_entries
        if _field_grounding_status(entry) == "grounded"
    ]
    if not coefficient_candidates:
        return False
    return all(str((entry or {}).get("review_state") or "").strip().lower() == "flagged" for entry in coefficient_candidates)


def _recompute_diffusion_review_status(record: Any, field_map: dict[str, Any], *, approved: bool = False) -> None:
    missing_required = _diffusion_missing_required_fields(field_map)
    if approved:
        record.review_status = "approved"
        record.assembly_notes = None
        return
    if _diffusion_has_blocking_flag(field_map):
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
            "Content-Disposition": "inline",
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
    promoted_record = candidate.promoted_record
    if promoted_record is None:
        promoted_record = _copy_candidate_to_final_record(candidate)
        db.add(promoted_record)
        await db.flush()
        candidate.promoted_record_id = promoted_record.id
    else:
        _copy_candidate_to_final_record(candidate, promoted_record)

    candidate.promoted_at = datetime.utcnow()
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
    missing_required = _diffusion_missing_required_fields(field_map)
    if missing_required:
        raise HTTPException(
            status_code=422,
            detail=f"Record cannot be approved. Missing field evidence for: {', '.join(missing_required)}",
        )
    if _diffusion_has_blocking_flag(field_map):
        raise HTTPException(
            status_code=422,
            detail="Record cannot be approved while flagged diffusion fields remain",
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
    missing_required = _diffusion_missing_required_fields(field_map)
    if missing_required:
        raise HTTPException(
            status_code=422,
            detail=f"Candidate cannot be approved. Missing field evidence for: {', '.join(missing_required)}",
        )
    if _diffusion_has_blocking_flag(field_map):
        raise HTTPException(
            status_code=422,
            detail="Candidate cannot be approved while flagged diffusion fields remain",
        )

    _recompute_diffusion_review_status(candidate, field_map, approved=True)
    promoted_record = candidate.promoted_record
    if promoted_record is None:
        promoted_record = _copy_diffusion_candidate_to_final_record(candidate)
        db.add(promoted_record)
        await db.flush()
        candidate.promoted_record_id = promoted_record.id
    else:
        _copy_diffusion_candidate_to_final_record(candidate, promoted_record)

    await db.execute(
        update(DiffusionFeatureSet)
        .where(DiffusionFeatureSet.candidate_id == candidate.id)
        .values(record_id=promoted_record.id)
    )
    candidate.promoted_at = datetime.utcnow()
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


@router.post("/upload")
async def upload_file(
    request: Request,
    file: UploadFile = File(...),
    background_tasks: BackgroundTasks = BackgroundTasks(),
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
        if not file.filename:
            raise HTTPException(status_code=400, detail="Filename is required")

        ensure_scope_writable(principal, scope)

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

        if auto_extract and upload_status == "pending":
            logger.info("Queueing background extraction for literature_id=%s", literature.id)
            literature.status = "queued"
            literature.error_message = None
            await db.commit()
            background_tasks.add_task(process_file_background, literature.id, extractor_type)
            upload_status = "processing"
        elif auto_extract:
            logger.info("Skipping background extraction for literature_id=%s status=%s", literature.id, upload_status)

        return {
            "success": True,
            "message": "File uploaded",
            "file_id": str(literature.id),
            "filename": literature.title,
            "status": upload_status,
            "extractor_type": extractor_type,
        }
    except HTTPException:
        raise
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

        active_statuses = {"processing", "extracting", "running"}
        run_status = str(getattr(run, "status", "") or "").strip().lower()
        literature_status = str(literature.status or "").strip().lower()
        cancelled = run_status == "cancelled" or literature_status in active_statuses
        if cancelled:
            literature.status = "cancelled"
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
    background_tasks: BackgroundTasks,
    force: bool = False,
    profile: str = Query("high_accuracy", pattern="^(high_accuracy|standard|review_figure_estimate)$"),
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

        # 记录提取活动
        await log_activity(
            db=db,
            user_id=principal.user.id,
            group_id=principal.group.id,
            action_type="extract_data",
            action_detail={
                "literature_id": lit_id,
                "profile": profile,
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
        if lane_status == "processing" or run_status in {"queued", "running", "processing", "extracting"}:
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
            literature.status = "queued"
            literature.error_message = None
            await db.commit()
            background_tasks.add_task(
                process_file_background,
                lit_id,
                extractor_type,
                force,
                profile,
                strict_cof_mode,
            )
            summary = _build_processing_summary(
                extractor_type=extractor_type,
                profile=profile,
                message=f"{extractor_type.title()} extraction started in the background. You can keep working while it runs.",
            )
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
            return [_tribology_record_api_payload(record) for record in candidate_records]
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
        return [_tribology_record_api_payload(record) for record in records]
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
    if not run:
        if literature and str(literature.status or "").strip().lower() in {"queued", "extracting", "processing", "running"}:
            summary = _build_processing_summary(
                extractor_type=extractor_type,
                message=f"{extractor_type.title()} extraction is queued. The run log will appear shortly."
            )
            return {
                "run_id": None,
                "literature_id": literature_id,
                "extractor_type": extractor_type,
                "profile": "high_accuracy",
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
    else:
        candidate_count, final_count = await _count_cached_record_artifacts(db, literature_id)
    response_status = run.status
    response_error = run.error_message
    if literature and str(literature.status or "").strip().lower() == "no_data" and not (candidate_count or final_count):
        response_status = "no_data"
        no_data_message = (
            literature.error_message
            or run.error_message
            or summary.get("no_data_reason")
            or summary.get("current_message")
            or "No extractable records found"
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
