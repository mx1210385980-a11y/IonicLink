"""
File Service for IonicLink
Handles file-based operations including reprocessing of Literature records.
"""

import json
import math
import os
import re
import shutil
import uuid
import asyncio
import logging
import time
import hashlib
import fitz
from difflib import SequenceMatcher
from datetime import datetime, timedelta
from typing import Any, Awaitable, Callable, Optional

from fastapi import UploadFile
from sqlalchemy import delete, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from utils.pdf_utils import extract_pdf_text_fitz, validate_pdf_bytes
from database import async_session_maker
from models.db_models import ExtractionRun, Literature, RecordCandidate, TribologyData
from services.llm_service import llm_service
from services.llm.deduplication import deduplicate_records_with_report
from services.data_sync_service import get_literature_by_id
from services.doi_service import DOIService
from services.llm.utils import normalize_record_value
from services.normalization import normalize_extraction_row
from knowledge_base import normalize_ionic_liquid
from services.score_service import calculate_confidence, calculate_confidence_details
from services.tribology_review_quality import (
    annotate_tribology_payload_quality,
    field_grounding_status,
)
from services.weak_candidate_service import build_weak_candidate_items
from services.fallback_extraction_service import extract_metadata_fallback, extract_table_fallback_records
from services.il_resolver_service import (
    ANION_DB,
    CATION_DB,
    filter_to_supported_ionic_liquid_records,
    resolve_il,
    resolve_ionic_liquid_alias,
)
from services.extraction_trace_service import (
    CANCELLED_EXTRACTION_MESSAGE,
    ExtractionCancelledError,
    add_extraction_candidates,
    compute_extraction_progress_percent,
    create_extraction_run,
    finalize_extraction_run,
    get_extraction_run,
    is_extraction_cancelled,
    mark_extraction_run_started,
    update_extraction_run_progress,
)
from utils.cof_extraction import derive_cof_extracted, normalize_cof_extracted, serialize_cof_extracted
from utils.experiment_profile import build_experiment_profile
from utils.lubricant_mixture import (
    compact_lubricant_label,
    components_for_record,
    format_lubricant_tooltip,
    normalize_lubricant_components,
    parse_lubricant_components,
    serialize_lubricant_components,
)
from utils.no_data_reason import build_no_data_reason, is_generic_no_data_message
from utils.structured_conditions import (
    derive_load_conditions,
    derive_tribological_system,
    normalize_load_conditions,
    normalize_tribological_system,
    serialize_load_conditions,
    serialize_tribological_system,
)
from utils.speed_conditions import (
    derive_speed_conditions,
    normalize_speed_conditions,
    serialize_speed_conditions,
    speed_value_from_conditions,
)
from models.tribology import TribologyData as ExtractTribologyData
from security import AuthPrincipal, RequestScope, build_scope_key, can_manage_literature
from utils.tribopair import composite_roughness_label
from utils.document_context import apply_experimental_document_context, extract_experimental_document_context

TEMP_UPLOAD_DIR = "temp_uploads"
EXTRACTED_REFERENCE_DIR = os.path.join("Reference", "Extracted")
ENABLE_CACHED_PDF_EVIDENCE_RELOCATION = os.getenv("ENABLE_CACHED_PDF_EVIDENCE_RELOCATION", "false").lower() == "true"
DEFAULT_TEMPERATURE_VALUE = "298.15 K"
DEFAULT_VISUAL_FALLBACK_MAX_PAGES = 12
DEFAULT_VISUAL_FALLBACK_TIMEOUT_SECONDS = 960
VISUAL_FALLBACK_PROFILE = "review_figure_estimate"
logger = logging.getLogger(__name__)
REJECTED_REVIEW_STATUSES = {"rejected", "flagged", "needs_evidence", "needs_review"}


class InvalidUploadError(ValueError):
    """Raised when an uploaded file is readable enough to identify but not usable."""
_SOURCE_ANCHOR_CACHE: dict[tuple[str, str, int, str], Optional[dict[str, Any]]] = {}


def _resolve_confidence(raw: object, record_like: dict) -> float:
    scoring_input = dict(record_like or {})
    try:
        if raw is not None and str(raw).strip() != "":
            scoring_input["model_confidence"] = float(raw)
    except Exception:
        scoring_input["model_confidence"] = raw
    return float(calculate_confidence(scoring_input))


def _bounded_int_env(name: str, default: int, minimum: int, maximum: int) -> int:
    try:
        value = int(os.getenv(name, str(default)))
    except (TypeError, ValueError):
        return default
    return max(minimum, min(maximum, value))


def _bounded_float_env(name: str, default: float, minimum: float, maximum: float) -> float:
    try:
        value = float(os.getenv(name, str(default)))
    except (TypeError, ValueError):
        return default
    if not math.isfinite(value):
        return default
    return max(minimum, min(maximum, value))


def _should_retry_tribology_visual_fallback(result: dict[str, Any], *, profile: str) -> bool:
    if str(profile or "").strip().lower() != "standard":
        return False
    data_rows = result.get("data") or []
    has_primary_metric = any(_resolve_primary_metric_key(item) for item in data_rows if isinstance(item, dict))

    summary = result.get("extraction_summary") or {}
    coverage = summary.get("page_coverage") or {}
    visual_pages = coverage.get("visual_pages") or []
    selected_visual_pages = coverage.get("selected_visual_pages") or []
    if not visual_pages or selected_visual_pages:
        return False

    total_pages = int(coverage.get("total_pages") or len(visual_pages) or 0)
    max_pages = _bounded_int_env("LLM_VISUAL_FALLBACK_MAX_PAGES", DEFAULT_VISUAL_FALLBACK_MAX_PAGES, 1, 80)
    if total_pages > max_pages:
        return False

    trace_candidates = result.get("trace_candidates") or []
    candidate_count = max(int(summary.get("candidate_count") or 0), len(trace_candidates))
    dropped = summary.get("dropped_by_reason") or {}
    has_metric_gap = any(
        int(dropped.get(reason) or 0) > 0
        for reason in ("missing_primary_metric", "no_target_metric", "no_core_quant_signal")
    )
    if has_primary_metric and not has_metric_gap:
        return False
    return candidate_count > 0 or has_metric_gap


def _allow_likely_ils_for_persistence(
    *,
    profile: str,
    visual_fallback_used: bool,
    extraction_summary: dict[str, Any] | None = None,
) -> bool:
    if str(profile or "").strip().lower() == "review_figure_estimate":
        return True
    visual_summary = (extraction_summary or {}).get("visual_fallback") if isinstance(extraction_summary, dict) else {}
    return bool(visual_fallback_used or (isinstance(visual_summary, dict) and visual_summary.get("used")))


def _page_int(value: Any) -> int | None:
    try:
        page = int(value)
    except (TypeError, ValueError):
        return None
    return page if page > 0 else None


def _visual_fallback_page_hints(result: dict[str, Any]) -> list[int]:
    summary = result.get("extraction_summary") or {}
    coverage = summary.get("page_coverage") or {}
    visual_pages = {_page_int(page) for page in (coverage.get("visual_pages") or [])}
    visual_pages.discard(None)
    max_pages = _bounded_int_env("LLM_VISUAL_FALLBACK_FOCUS_MAX_PAGES", 6, 1, 20)

    scored: dict[int, int] = {}
    page_candidate_counts = summary.get("page_candidate_counts") or {}
    if isinstance(page_candidate_counts, dict):
        for raw_page, stats in page_candidate_counts.items():
            page = _page_int(raw_page)
            if page is None:
                continue
            if visual_pages and page not in visual_pages:
                continue
            total = 1
            if isinstance(stats, dict):
                total = int(stats.get("total") or stats.get("figure") or stats.get("text") or 1)
            scored[page] = max(scored.get(page, 0), total)

    for candidate in result.get("trace_candidates") or []:
        if not isinstance(candidate, dict):
            continue
        raw = candidate.get("raw") if isinstance(candidate.get("raw"), dict) else {}
        page = _page_int(candidate.get("page") or raw.get("source_page") or raw.get("page"))
        if page is None:
            continue
        if visual_pages and page not in visual_pages:
            continue
        scored[page] = max(scored.get(page, 0), 1)

    if not scored:
        return []
    selected = sorted(scored, key=lambda page: (-scored[page], page))[:max_pages]
    return sorted(selected)


def _merge_visual_fallback_result(
    original: dict[str, Any],
    visual: dict[str, Any],
    *,
    used: bool,
) -> dict[str, Any]:
    original_summary = dict(original.get("extraction_summary") or {})
    visual_summary = dict(visual.get("extraction_summary") or {})
    visual_records = visual.get("data") or []
    visual_traces = visual.get("trace_candidates") or []
    original_traces = original.get("trace_candidates") or []

    if visual_records:
        merged = dict(visual)
        merged_summary = dict(visual_summary)
        merged_summary["visual_fallback"] = {
            "used": used,
            "profile": VISUAL_FALLBACK_PROFILE,
            "replaced_empty_text_result": True,
            "original_candidate_count": max(
                int(original_summary.get("candidate_count") or 0),
                len(original_traces),
            ),
        }
        merged_summary["progress_log"] = [
            *(original_summary.get("progress_log") or []),
            {
                "stage": "stage_c.visual_retry_start",
                "message": f"profile={VISUAL_FALLBACK_PROFILE}",
            },
            *(visual_summary.get("progress_log") or []),
        ]
        merged["extraction_summary"] = merged_summary
        merged["trace_candidates"] = [*original_traces, *visual_traces]
        return merged

    merged = dict(original)
    merged_traces = [*original_traces, *visual_traces]
    merged_summary = {
        **original_summary,
        "candidate_count": max(
            int(original_summary.get("candidate_count") or 0),
            len(merged_traces),
            int(visual_summary.get("candidate_count") or 0),
        ),
        "progress_log": [
            *(original_summary.get("progress_log") or []),
            {
                "stage": "stage_c.visual_retry_start",
                "message": f"profile={VISUAL_FALLBACK_PROFILE}",
            },
            *(visual_summary.get("progress_log") or []),
        ],
        "visual_fallback": {
            "used": used,
            "profile": VISUAL_FALLBACK_PROFILE,
            "replaced_empty_text_result": False,
            "visual_candidate_count": max(
                int(visual_summary.get("candidate_count") or 0),
                len(visual_traces),
            ),
        },
    }
    merged["trace_candidates"] = merged_traces
    merged["extraction_summary"] = merged_summary
    return merged


async def _maybe_retry_tribology_visual_fallback(
    result: dict[str, Any],
    *,
    content: str,
    images: Optional[list[str]],
    pdf_path: Optional[str],
    profile: str,
    strict_cof_mode: bool,
    progress_callback: Optional[Callable[[dict[str, Any]], Awaitable[None]]],
    extract_with_metadata: Callable[..., Awaitable[dict[str, Any]]],
) -> tuple[dict[str, Any], bool]:
    if not _should_retry_tribology_visual_fallback(result, profile=profile):
        return result, False

    event = {
        "stage": "stage_c.visual_retry_start",
        "message": f"profile={VISUAL_FALLBACK_PROFILE}",
        "force": True,
        "candidate_count": int((result.get("extraction_summary") or {}).get("candidate_count") or 0),
        "kept_count": 0,
        "dropped_by_reason": (result.get("extraction_summary") or {}).get("dropped_by_reason") or {},
        "page_coverage": (result.get("extraction_summary") or {}).get("page_coverage") or {},
        "page_candidate_counts": (result.get("extraction_summary") or {}).get("page_candidate_counts") or {},
        "progress_log": [
            *((result.get("extraction_summary") or {}).get("progress_log") or []),
            {"stage": "stage_c.visual_retry_start", "message": f"profile={VISUAL_FALLBACK_PROFILE}"},
        ],
    }
    visual_page_hints = _visual_fallback_page_hints(result)
    if visual_page_hints:
        event["visual_page_hints"] = visual_page_hints
    if progress_callback:
        try:
            await progress_callback(event)
        except Exception as progress_err:
            logger.warning("Visual fallback progress persistence failed: %s", progress_err)

    timeout_s = _bounded_float_env(
        "LLM_VISUAL_FALLBACK_TIMEOUT_SECONDS",
        DEFAULT_VISUAL_FALLBACK_TIMEOUT_SECONDS,
        30.0,
        1800.0,
    )
    try:
        kwargs = {
            "content": content,
            "pdf_path": pdf_path,
            "extraction_profile": VISUAL_FALLBACK_PROFILE,
            "progress_callback": progress_callback,
            "strict_cof_mode": True if strict_cof_mode is False else strict_cof_mode,
        }
        if visual_page_hints:
            kwargs["visual_page_hints"] = visual_page_hints
        if images:
            kwargs["images"] = images
        visual_result = await asyncio.wait_for(extract_with_metadata(**kwargs), timeout=timeout_s)
    except Exception as err:
        merged = dict(result)
        summary = dict(merged.get("extraction_summary") or {})
        summary["visual_fallback"] = {
            "used": False,
            "profile": VISUAL_FALLBACK_PROFILE,
            "error": f"{type(err).__name__}: {err}",
        }
        summary["progress_log"] = [
            *(summary.get("progress_log") or []),
            {
                "stage": "stage_c.visual_retry_error",
                "message": f"{type(err).__name__}: {err}",
            },
        ]
        merged["extraction_summary"] = summary
        return merged, False

    return _merge_visual_fallback_result(result, visual_result or {}, used=True), True


def _title_key(value: Optional[str]) -> str:
    text = str(value or "").strip().lower()
    text = re.sub(r"\.pdf$", "", text, flags=re.IGNORECASE)
    text = re.sub(r"^[12]\d{3}[-_\s]*(an|a|the)?[-_\s]*", "", text, flags=re.IGNORECASE)
    text = re.sub(r"[^a-z0-9]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def _workspace_root() -> str:
    backend_root = os.path.dirname(os.path.dirname(__file__))
    return os.path.dirname(backend_root)


def _path_is_within(path: str, parent: str) -> bool:
    try:
        return os.path.commonpath([os.path.abspath(path), os.path.abspath(parent)]) == os.path.abspath(parent)
    except ValueError:
        return False


def _file_sha256(path: str) -> Optional[str]:
    try:
        digest = hashlib.sha256()
        with open(path, "rb") as f:
            for chunk in iter(lambda: f.read(1024 * 1024), b""):
                digest.update(chunk)
        return digest.hexdigest()
    except OSError:
        return None


def _clean_filename_part(value: Optional[object]) -> str:
    text = str(value or "").strip()
    text = re.sub(r"\.pdf$", "", text, flags=re.IGNORECASE)
    text = re.sub(r"[/:*?\"<>|]+", " ", text)
    text = re.sub(r"\s+", " ", text).strip(" ._-")
    return text


def _author_filename_token(authors: Optional[object]) -> str:
    text = _clean_filename_part(authors)
    if not text:
        return ""
    first_author = re.split(r"\s*(?:;|\band\b|&)\s*", text, maxsplit=1, flags=re.IGNORECASE)[0]
    first_author = first_author.split(",")[0].strip()
    tokens = re.findall(r"[A-Za-z][A-Za-z'-]*", first_author)
    if not tokens:
        return ""
    return tokens[0].lower()


def _reference_pdf_basename_for_hash(file_hash: Optional[str], source_path: str) -> str:
    if not file_hash:
        return ""
    reference_root = os.path.join(_workspace_root(), "Reference")
    extracted_root = os.path.join(_workspace_root(), EXTRACTED_REFERENCE_DIR)
    if not os.path.isdir(reference_root):
        return ""

    matches: list[str] = []
    for dirpath, _, filenames in os.walk(reference_root):
        if _path_is_within(dirpath, extracted_root):
            continue
        for filename in filenames:
            if not filename.lower().endswith(".pdf"):
                continue
            candidate = os.path.join(dirpath, filename)
            try:
                if os.path.samefile(candidate, source_path):
                    continue
            except OSError:
                pass
            if _file_sha256(candidate) == file_hash:
                matches.append(filename)

    if not matches:
        return ""
    return sorted(matches, key=lambda item: (len(item), item.lower()))[0]


def _build_extracted_pdf_filename(literature, source_path: str, source_hash: Optional[str] = None) -> str:
    source_name = _clean_filename_part(os.path.basename(source_path))
    if source_name and not re.fullmatch(r"\d+", source_name):
        filename = source_name
    else:
        reference_name = _reference_pdf_basename_for_hash(source_hash, source_path)
        if reference_name:
            filename = _clean_filename_part(reference_name)
        else:
            title = _clean_filename_part(getattr(literature, "title", None))
            if not title or title.lower().startswith("temp-"):
                title = f"literature-{getattr(literature, 'id', 'unknown')}"
            parts = []
            year = getattr(literature, "year", None)
            try:
                if int(year or 0) > 0:
                    parts.append(str(int(year)))
            except (TypeError, ValueError):
                pass
            author_token = _author_filename_token(getattr(literature, "authors", None))
            if author_token:
                parts.append(author_token)
            parts.append(title)
            filename = "-".join(parts)

    filename = _clean_filename_part(filename)[:220].strip(" ._-") or f"literature-{getattr(literature, 'id', 'unknown')}"
    if not filename.lower().endswith(".pdf"):
        filename = f"{filename}.pdf"
    return filename


def _unique_extracted_pdf_path(source_path: str, filename: str, source_hash: Optional[str]) -> str:
    target_dir = os.path.join(_workspace_root(), EXTRACTED_REFERENCE_DIR)
    os.makedirs(target_dir, exist_ok=True)

    stem, ext = os.path.splitext(filename)
    ext = ext or ".pdf"
    for index in range(0, 100):
        suffix = "" if index == 0 else f"-{index}"
        candidate = os.path.join(target_dir, f"{stem}{suffix}{ext}")
        if not os.path.exists(candidate):
            return candidate
        try:
            if os.path.samefile(source_path, candidate):
                return candidate
        except OSError:
            pass
        if source_hash and _file_sha256(candidate) == source_hash:
            return candidate
    return os.path.join(target_dir, f"{stem}-{uuid.uuid4().hex[:8]}{ext}")


def _archive_completed_literature_pdf(literature, source_path: Optional[str] = None) -> Optional[str]:
    """Move completed extraction PDFs into Reference/Extracted and update literature.file_path."""
    resolved_source = source_path or _resolve_existing_path(getattr(literature, "file_path", None))
    if not resolved_source or not os.path.exists(resolved_source):
        return None
    if os.path.splitext(resolved_source)[1].lower() != ".pdf":
        return None

    workspace_root = _workspace_root()
    extracted_root = os.path.join(workspace_root, EXTRACTED_REFERENCE_DIR)
    source_hash = _file_sha256(resolved_source)
    filename = _build_extracted_pdf_filename(literature, resolved_source, source_hash)
    target_path = _unique_extracted_pdf_path(resolved_source, filename, source_hash)

    already_archived = _path_is_within(resolved_source, extracted_root)
    try:
        same_file = os.path.exists(target_path) and os.path.samefile(resolved_source, target_path)
    except OSError:
        same_file = False

    if not already_archived and not same_file:
        backend_root = os.path.dirname(os.path.dirname(__file__))
        source_is_managed = any(
            _path_is_within(resolved_source, parent)
            for parent in (
                os.path.join(backend_root, TEMP_UPLOAD_DIR),
                os.path.join(workspace_root, TEMP_UPLOAD_DIR),
                os.path.join(workspace_root, "Reference"),
            )
        )

        if os.path.exists(target_path) and source_hash and _file_sha256(target_path) == source_hash:
            if source_is_managed:
                os.remove(resolved_source)
        elif source_is_managed:
            shutil.move(resolved_source, target_path)
        else:
            shutil.copy2(resolved_source, target_path)
    else:
        target_path = resolved_source

    relative_path = os.path.relpath(target_path, workspace_root).replace(os.sep, "/")
    literature.file_path = relative_path
    if source_hash and not getattr(literature, "file_hash", None):
        literature.file_hash = source_hash
    logger.info("Archived completed literature PDF literature_id=%s path=%s", getattr(literature, "id", None), relative_path)
    return relative_path


def _normalize_doi_scan_text(value: str) -> str:
    text = str(value or "").replace("\u00a0", " ")
    return re.sub(
        r"\b10\.\s*(\d{4,9})\s*/\s*",
        lambda match: f"10.{match.group(1)}/",
        text,
        flags=re.IGNORECASE,
    )


def _doi_front_matter_window(text_content: str, *, limit: int = 12000) -> str:
    text = str(text_content or "")
    if not text:
        return ""

    cutoff = min(len(text), limit)
    for pattern in (
        r"\n\s*(?:references|notes\s+and\s+references|literature\s+cited)\s*\n",
        r"\n\s*REFERENCES\s*\n",
    ):
        for match in re.finditer(pattern, text, flags=re.IGNORECASE):
            cutoff = min(cutoff, match.start())
            break
    return text[:cutoff]


def _extract_doi_candidates(text_content: str, filename: str) -> list[str]:
    """Return DOI candidates suitable for upload de-duplication.

    Only scan the front matter and filename. Full-text scans pick up cited
    reference DOIs, which can make an upload resolve to a different paper.
    """
    patterns = [
        r"\b10\.\d{4,9}/[-._;()/:A-Z0-9]+\b",
        r"\b10\.\d{4,9}/\S+\b",
    ]
    merged = _normalize_doi_scan_text(f"{_doi_front_matter_window(text_content)}\n{filename or ''}")
    doi_service = DOIService()
    seen: set[str] = set()
    out: list[str] = []
    for pattern in patterns:
        for match in re.finditer(pattern, merged, flags=re.IGNORECASE):
            normalized = doi_service._normalize_doi(match.group(0))
            if normalized and normalized not in seen:
                seen.add(normalized)
                out.append(normalized)
    return out


def _doi_metadata_to_upload_payload(metadata: Any) -> dict[str, Any]:
    if not metadata:
        return {}
    return {
        "title": getattr(metadata, "title", None),
        "authors": getattr(metadata, "authors", None),
        "doi": getattr(metadata, "doi", None),
        "journal": getattr(metadata, "journal", None),
        "issn": getattr(metadata, "issn", None),
        "year": getattr(metadata, "year", None),
        "volume": getattr(metadata, "volume", None),
        "issue": getattr(metadata, "issue", None),
        "pages": getattr(metadata, "pages", None),
    }


def _clean_upload_metadata(payload: dict[str, Any]) -> dict[str, Any]:
    cleaned: dict[str, Any] = {}
    for key, value in (payload or {}).items():
        if value in (None, "", []):
            continue
        if key == "year":
            try:
                cleaned[key] = int(value)
            except (TypeError, ValueError):
                continue
        else:
            cleaned[key] = str(value).strip()
    return cleaned


async def _resolve_upload_metadata(
    text_content: str,
    filename: str,
    doi_candidates: Optional[list[str]] = None,
) -> dict[str, Any]:
    doi_candidates = doi_candidates if doi_candidates is not None else _extract_doi_candidates(text_content, filename)
    fallback_metadata = _clean_upload_metadata(extract_metadata_fallback(text_content))
    metadata = dict(fallback_metadata)

    if doi_candidates:
        metadata.setdefault("doi", doi_candidates[0])
        try:
            resolved = await DOIService().resolve_doi(doi_candidates[0])
            resolved_payload = _clean_upload_metadata(_doi_metadata_to_upload_payload(resolved))
            if resolved_payload:
                metadata = {**metadata, **resolved_payload}
        except Exception as exc:
            logger.warning("Upload DOI metadata resolution failed doi=%s: %s", doi_candidates[0], exc)

    if metadata.get("doi"):
        metadata["doi"] = DOIService()._normalize_doi(metadata["doi"]) or metadata["doi"]
    return metadata


async def _find_existing_by_title_fallback(
    db: AsyncSession,
    filename: str,
    *,
    group_id: int,
    scope_key: str,
) -> Optional[Literature]:
    filename_key = _title_key(filename)
    if not filename_key or len(filename_key) < 24:
        return None

    candidates = (
        await db.execute(
            select(Literature)
            .where(
                Literature.group_id == group_id,
                Literature.scope_key == scope_key,
                ~Literature.doi.like("temp-%"),
            )
            .order_by(Literature.created_at.desc())
        )
    ).scalars().all()

    best: Optional[Literature] = None
    best_score = 0.0
    for lit in candidates:
        title_key = _title_key(lit.title)
        if not title_key:
            continue
        score = SequenceMatcher(None, filename_key, title_key).ratio()
        if filename_key in title_key or title_key in filename_key:
            score = max(score, 0.95)
        if score > best_score:
            best = lit
            best_score = score

    if best and best_score >= 0.93:
        logger.info("Upload title fallback matched literature_id=%s score=%.3f", best.id, best_score)
        return best
    return None


def _literature_cache_priority(literature: Literature) -> tuple:
    status = str(literature.status or "").strip().lower()
    status_rank = {
        "completed": 5,
        "no_data": 5,
        "processing": 4,
        "pending": 3,
        "uploaded": 3,
        "failed": 1,
        "error": 1,
        "cancelled": 0,
    }.get(status, 2)
    has_stable_doi = 0 if str(literature.doi or "").startswith("temp-") else 1
    has_resolved_file = 1 if _resolve_existing_path(literature.file_path) else 0
    has_hash = 1 if str(literature.file_hash or "").strip() else 0
    created_at = literature.created_at or datetime.min
    return (status_rank, has_stable_doi, has_resolved_file, has_hash, created_at, literature.id or 0)


async def _find_existing_by_file_hash(
    db: AsyncSession,
    *,
    group_id: int,
    scope_key: str,
    file_hash: str,
) -> Optional[Literature]:
    matches = (
        await db.execute(
            select(Literature).where(
                Literature.group_id == group_id,
                Literature.scope_key == scope_key,
                Literature.file_hash == file_hash,
            )
        )
    ).scalars().all()

    if not matches:
        return None

    if len(matches) > 1:
        logger.warning(
            "Upload file-hash matched multiple literature rows file_hash=%s group_id=%s scope=%s ids=%s",
            file_hash,
            group_id,
            scope_key,
            [item.id for item in matches],
        )
    return max(matches, key=_literature_cache_priority)


def _resolve_existing_path(raw_path: Optional[str]) -> Optional[str]:
    """Resolve relative storage paths regardless of current working directory."""
    if not raw_path:
        return None

    normalized_path = str(raw_path).replace("\\", "/")
    candidates = [raw_path]
    if normalized_path != raw_path:
        candidates.append(normalized_path)
    if not os.path.isabs(normalized_path):
        backend_root = os.path.dirname(os.path.dirname(__file__))
        workspace_root = os.path.dirname(backend_root)
        candidates.append(os.path.abspath(os.path.join(backend_root, normalized_path)))
        candidates.append(os.path.abspath(os.path.join(workspace_root, normalized_path)))

    for p in candidates:
        if p and os.path.exists(p):
            return p
    return None


def _load_literature_context_text(literature: Literature) -> str:
    content = str(getattr(literature, "content", "") or "").strip()
    if content:
        return content

    pdf_path = _resolve_existing_path(getattr(literature, "file_path", None))
    if not pdf_path:
        return ""
    try:
        with fitz.open(pdf_path) as doc:
            return "\n".join(doc[page_index].get_text("text") or "" for page_index in range(len(doc))).strip()
    except Exception as exc:
        logger.warning(
            "Unable to extract PDF text for cached context literature_id=%s file_path=%s error=%s",
            getattr(literature, "id", None),
            getattr(literature, "file_path", None),
            exc,
        )
        return ""


def _build_record_uniqueness_key(item: dict) -> tuple:
    """Conservative uniqueness key used before DB persistence."""
    return (
        normalize_record_value(item.get("material_name")),
        normalize_record_value(item.get("ionic_liquid", item.get("lubricant", ""))),
        normalize_record_value(item.get("cof")),
        normalize_record_value(item.get("friction_force")),
        normalize_record_value(item.get("normal_load", item.get("load"))),
        normalize_record_value(item.get("load")),
        normalize_record_value(item.get("speed")),
        normalize_record_value(item.get("temperature")),
        normalize_record_value(item.get("potential")),
        normalize_record_value(item.get("water_content")),
        normalize_record_value(item.get("surface_roughness")),
        normalize_record_value(item.get("film_thickness")),
        normalize_record_value(item.get("residual_film_thickness_d")),
        normalize_record_value(item.get("layer_spacing_delta")),
        normalize_record_value(item.get("regime")),
        normalize_record_value(item.get("source")),
    )


def _build_in_progress_summary(run: Optional[ExtractionRun]) -> dict:
    summary_payload = {}
    if run and run.summary_json:
        try:
            summary_payload = json.loads(run.summary_json)
        except Exception:
            summary_payload = {}

    return {
        "run_id": run.run_id if run else None,
        "candidate_count": int(run.candidate_count) if run and run.candidate_count is not None else int(summary_payload.get("candidate_count") or 0),
        "final_count": int(run.final_count) if run and run.final_count is not None else int(summary_payload.get("final_count") or 0),
        "dropped_by_reason": {
            **(summary_payload.get("dropped_by_reason") or {}),
            "in_progress": 1,
        },
        "page_coverage": summary_payload.get("page_coverage") or {},
        "page_candidate_counts": summary_payload.get("page_candidate_counts") or {},
        "progress_log": summary_payload.get("progress_log") or [],
    }


def _build_cancelled_extraction_summary(run_id: Optional[str], *, profile: str = "auto") -> dict[str, Any]:
    return {
        "run_id": run_id,
        "candidate_count": 0,
        "final_count": 0,
        "dropped_by_reason": {"cancelled": 1},
        "page_coverage": {},
        "page_candidate_counts": {},
        "current_stage": "cancelled",
        "current_message": CANCELLED_EXTRACTION_MESSAGE,
        "progress_log": [{"stage": "cancelled", "message": CANCELLED_EXTRACTION_MESSAGE}],
        "profile": profile,
        "status": "cancelled",
    }


def _final_merge_records(records: list[dict]) -> tuple[list[dict], dict, list[dict]]:
    """
    Stage E merge: deduplicate once with conservative compatibility rules.
    Returns merged records and merge report.
    """
    candidates: list[ExtractTribologyData] = []
    stage_e_candidates: list[dict] = []
    for item in records or []:
        if not isinstance(item, dict):
            stage_e_candidates.append(
                {
                    "stage": "stage_e",
                    "modality": "merge",
                    "page": None,
                    "source_figure": None,
                    "raw": item,
                    "normalized": None,
                    "drop_reason": "invalid_record_type",
                    "merged_into": None,
                }
            )
            continue
        try:
            candidates.append(ExtractTribologyData(**item))
        except Exception:
            # Keep extraction resilient; malformed rows are handled via trace.
            stage_e_candidates.append(
                {
                    "stage": "stage_e",
                    "modality": "merge",
                    "page": item.get("source_page"),
                    "source_figure": item.get("source_figure"),
                    "raw": item,
                    "normalized": None,
                    "drop_reason": "invalid_schema",
                    "merged_into": None,
                }
            )
            continue

    merged_models, report = deduplicate_records_with_report(candidates)
    trace_by_index = {int(t.get("input_index")): t for t in (report.trace or []) if isinstance(t, dict)}

    merged_dicts: list[dict] = []
    for m in merged_models:
        d = m.model_dump()
        # Keep key frontend aliases stable.
        if not d.get("source") and d.get("source_figure"):
            d["source"] = d.get("source_figure")
        merged_dicts.append(d)

    for idx, candidate in enumerate(candidates):
        row = candidate.model_dump()
        t = trace_by_index.get(idx, {})
        stage_e_candidates.append(
            {
                "stage": "stage_e",
                "modality": "merge",
                "page": row.get("source_page"),
                "source_figure": row.get("source_figure"),
                "raw": row,
                "normalized": row,
                "drop_reason": t.get("drop_reason"),
                "merged_into": t.get("merged_into"),
            }
        )

    report_dict = {
        "input_count": report.input_count,
        "output_count": report.output_count,
        "merged_count": report.merged_count,
        "dropped_count": report.dropped_count,
        "dropped_by_reason": report.dropped_by_reason,
    }
    return merged_dicts, report_dict, stage_e_candidates


def _parse_cof_value(raw_value: Optional[str]) -> Optional[float]:
    if raw_value in (None, ""):
        return None
    try:
        match = re.search(r"-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?", str(raw_value))
        if not match:
            return None
        value = float(match.group(0))
        if 0.0 <= value <= 5.0:
            return value
    except Exception:
        return None
    return None


def _is_unknown_il(value: Optional[str]) -> bool:
    text = str(value or "").strip().lower()
    return text in {"", "unknown", "unknown il", "n/a", "none", "-", "--"} or _looks_like_reference_marker_il(value)


def _looks_like_reference_marker_il(value: Optional[str]) -> bool:
    text = str(value or "").strip()
    if not text:
        return False
    pair = re.fullmatch(r"\[([^\[\]]+)\]\[([^\[\]]+)\]", text)
    if pair:
        left, right = pair.group(1).strip(), pair.group(2).strip()
        common_words = {
            "and", "as", "at", "by", "for", "from", "in", "into", "near",
            "of", "on", "or", "the", "to", "with", "without", "beneficial",
        }
        if left.isdigit():
            return True
        if (
            left.isalpha()
            and right.isalpha()
            and left.islower()
            and right.islower()
            and (left in common_words or right in common_words)
        ):
            return True
    return bool(
        re.fullmatch(r"\[\d{1,4}\]\[[A-Za-z]{2,24}\]", text)
        or re.fullmatch(r"\[\d{1,4}\]", text)
    )


def _normalize_il_token(token: str) -> str:
    text = str(token or "").strip()
    if _looks_like_reference_marker_il(text):
        return ""
    text = re.sub(r"\]\s+\[", "][", text)
    text = re.sub(r"\]\s*i\s*\[", "]i[", text, flags=re.IGNORECASE)
    compact = re.sub(r"\s+", "", text)
    mixed_left = re.fullmatch(r"(\[[^\[\]]+?\])([A-Za-z][A-Za-z0-9,+\-()]{1,24})", compact)
    if mixed_left:
        return f"{mixed_left.group(1)}[{mixed_left.group(2)}]"
    return text


def _extract_il_candidates(text: str) -> list[str]:
    if not text:
        return []
    candidates: list[str] = []
    def _canonicalize_il(value: Optional[str]) -> str:
        token = str(value or "").strip()
        if not token:
            return ""
        if _looks_like_reference_marker_il(token):
            return ""
        token_l = token.lower()
        if "ethylammonium nitrate" in token_l or re.search(r"\bean\b", token_l):
            return "EAN"
        if "ethaline" in token_l:
            return "Ethaline"
        m = re.search(r"(\[[^\[\]]+?\]\s*(?:i\s*)?\[[^\[\]]+?\])", token)
        if m:
            return re.sub(r"\s+", "", m.group(1)).replace("]i[", "][")
        mixed = re.search(r"(\[[^\[\]]+?\]\s*[A-Za-z][A-Za-z0-9,+\-()]{1,24})", token)
        if mixed:
            return _normalize_il_token(mixed.group(1))
        compact_il_like = bool(
            re.fullmatch(r"[A-Za-z0-9(),+\-\[\]]{2,48}", token)
            or re.fullmatch(r"[A-Za-z0-9(),+\-\[\]]{2,24}\s+[A-Za-z0-9(),+\-\[\]]{1,24}", token)
        )
        if not compact_il_like:
            return ""
        if len(token) > 80:
            return ""
        return token
    patterns = [
        r"(\[[^\[\]]+?\]\s*\[[^\[\]]+?\])",
        r"(\[[^\[\]]+?\]\s*i\s*\[[^\[\]]+?\])",
        r"(\[[^\[\]]+?\]\s*[A-Za-z][A-Za-z0-9,+\-()]{1,24})",
    ]
    for pat in patterns:
        for hit in re.findall(pat, text, flags=re.IGNORECASE):
            token = _normalize_il_token(hit)
            if not token:
                continue
            if _looks_like_reference_marker_il(token):
                continue
            normalized = normalize_ionic_liquid(token) or token
            if normalized not in candidates:
                candidates.append(normalized)

    # Acronym / common-name fallback for non-bracket notations (e.g., ethylammonium nitrate (EAN), in EAN).
    text_l = str(text).lower()
    if re.search(r"\bethylammonium\s+nitrate\b", text_l):
        if "EAN" not in candidates:
            candidates.append("EAN")
    if re.search(r"\bean\b", text_l) and not candidates:
        candidates.append("EAN")
    if re.search(r"\bethaline\b", text_l):
        if "Ethaline" not in candidates:
            candidates.append("Ethaline")
    # Last-resort alias normalization for non-bracket notations.
    normalized_text = _canonicalize_il(normalize_ionic_liquid(text))
    normalized_token = _normalize_il_token(normalized_text) if normalized_text else ""
    if (
        normalized_token
        and not _is_unknown_il(normalized_token)
        and all(_normalize_il_token(existing) != normalized_token for existing in candidates)
    ):
        candidates.append(normalized_token)
    return candidates


def _pick_source_label(source: Optional[str], source_figure: Optional[str]) -> str:
    s = str(source or "").strip()
    sf = str(source_figure or "").strip()
    # Prefer labels carrying panel information like "Fig. 10(c)" over plain "10".
    if re.search(r"\([a-z]\)|\d+[a-z]\b", s, flags=re.IGNORECASE):
        return s
    if re.search(r"\([a-z]\)|\d+[a-z]\b", sf, flags=re.IGNORECASE):
        return sf
    return s or sf


def _extract_panel_context(page_text: str, source_label: str) -> str:
    if not page_text or not source_label:
        return ""
    m = re.search(r"(?:\(|\b)([a-z])\)?\s*$", source_label.strip().lower())
    if not m:
        return ""
    panel = m.group(1)
    patterns = [
        rf"\({panel}\)\s*(.*?)(?=\([a-z]\)\s*|$)",
        rf"\b{panel}\)\s*(.*?)(?=\b[a-z]\)\s*|$)",
    ]
    for pat in patterns:
        hit = re.search(pat, page_text, flags=re.IGNORECASE | re.DOTALL)
        if hit:
            return re.sub(r"\s+", " ", hit.group(1)).strip()[:2200]
    return ""


def _extract_fig_sentence_context(page_text: str, source_label: str) -> str:
    if not page_text or not source_label:
        return ""
    label = source_label.lower()
    m = re.search(r"fig\.?\s*(\d+)\s*\(?([a-z])?\)?", label, flags=re.IGNORECASE)
    num = None
    panel = None
    if m:
        num, panel = m.group(1), m.group(2)
    else:
        m2 = re.search(r"^(\d+)\s*([a-z])$", label.strip(), flags=re.IGNORECASE)
        if m2:
            num, panel = m2.group(1), m2.group(2)
    if not num:
        return ""
    if panel:
        pat = rf"[^.?!;]{{0,320}}fig\.?\s*{num}\s*\(?{panel}\)?[^.?!;]{{0,320}}"
    else:
        pat = rf"[^.?!;]{{0,320}}fig\.?\s*{num}[^.?!;]{{0,320}}"
    hit = re.search(pat, page_text, flags=re.IGNORECASE)
    if not hit:
        return ""
    return re.sub(r"\s+", " ", hit.group(0)).strip()


def _infer_ionic_liquid_from_pdf(
    *,
    source_page: Optional[int],
    source: Optional[str],
    source_figure: Optional[str],
    evidence: Optional[str],
    page_text_cache: dict[int, str],
) -> Optional[str]:
    local = " ".join([str(evidence or ""), str(source or ""), str(source_figure or "")]).strip()
    local_ils = _extract_il_candidates(local)
    if len(local_ils) == 1:
        return local_ils[0]

    if not source_page:
        return None
    page_text = str(page_text_cache.get(int(source_page), "") or "")
    if not page_text:
        return None

    source_label = _pick_source_label(source, source_figure)
    panel_ctx = _extract_panel_context(page_text, source_label)
    panel_ils = _extract_il_candidates(" ".join([local, panel_ctx]))
    if len(panel_ils) == 1:
        return panel_ils[0]

    fig_sentence = _extract_fig_sentence_context(page_text, source_label)
    sentence_ils = _extract_il_candidates(" ".join([local, fig_sentence]))
    if len(sentence_ils) == 1:
        return sentence_ils[0]

    page_ils = _extract_il_candidates(page_text)
    if len(page_ils) == 1:
        return page_ils[0]
    return None


def _backfill_unknown_il_records(records: list[dict], pdf_path: Optional[str]) -> dict[int, str]:
    """
    Deterministic IL backfill from PDF text context.
    Returns {record_index: inferred_il}.
    """
    file_path = _resolve_existing_path(pdf_path)
    if not file_path or not os.path.exists(file_path):
        return {}

    unknown_idxs = [i for i, row in enumerate(records or []) if _is_unknown_il(row.get("ionic_liquid") or row.get("lubricant"))]
    if not unknown_idxs:
        return {}

    pages = set()
    for idx in unknown_idxs:
        page = records[idx].get("source_page")
        try:
            if page:
                pages.add(int(page))
        except Exception:
            continue
    if not pages:
        return {}

    page_text_cache: dict[int, str] = {}
    try:
        doc = fitz.open(file_path)
        for p in pages:
            if 1 <= p <= len(doc):
                page_text_cache[p] = " ".join((doc[p - 1].get_text("text") or "").split())
        doc.close()
    except Exception:
        return {}

    changed: dict[int, str] = {}
    for idx in unknown_idxs:
        row = records[idx]
        inferred = _infer_ionic_liquid_from_pdf(
            source_page=row.get("source_page"),
            source=row.get("source"),
            source_figure=row.get("source_figure"),
            evidence=row.get("evidence"),
            page_text_cache=page_text_cache,
        )
        if inferred:
            row["ionic_liquid"] = inferred
            row["lubricant"] = inferred
            changed[idx] = inferred
    return changed


_TREND_PATTERNS = [
    re.compile(r"\bremains?\s+around\b", re.IGNORECASE),
    re.compile(r"\bvaries?\s+between\b", re.IGNORECASE),
    re.compile(r"\bstays?\s+nearly\s+constant\b", re.IGNORECASE),
    re.compile(r"\btends?\s+to\s+(?:increase|decrease)\b", re.IGNORECASE),
    re.compile(r"\bshows?\s+(?:a\s+)?trend\b", re.IGNORECASE),
]
_SAMPLE_ID_PATTERN = re.compile(r"\b[A-Z]{1,5}\d+(?:-\d+)+(?:-[A-Z0-9]+)*\b")
_TRIBOLOGY_PERSISTABLE_METRIC_KEYS = (
    "cof",
    "friction_force",
    "wear_rate",
    "film_thickness",
    "residual_film_thickness_d",
    "layer_spacing_delta",
    "surface_roughness",
)


def _safe_json_dumps(value: Any) -> Optional[str]:
    if value in (None, "", {}, []):
        return None
    try:
        return json.dumps(value, ensure_ascii=False)
    except Exception:
        return json.dumps(str(value), ensure_ascii=False)


def _parse_json_object(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    if isinstance(value, str):
        try:
            loaded = json.loads(value)
            return loaded if isinstance(loaded, dict) else {}
        except Exception:
            return {}
    return {}


def _parse_json_bbox(value: Any) -> Optional[list[float]]:
    if isinstance(value, list) and len(value) == 4:
        try:
            return [float(item) for item in value]
        except Exception:
            return None
    if isinstance(value, str):
        try:
            loaded = json.loads(value)
            if isinstance(loaded, list) and len(loaded) == 4:
                return [float(item) for item in loaded]
        except Exception:
            return None
    return None


def _infer_source_type(source_label: Optional[str]) -> str:
    text = str(source_label or "").strip().lower()
    if not text:
        return "text"
    if text.startswith("table"):
        return "table"
    if text.startswith("fig") or text.startswith("image") or text.startswith("plot") or re.fullmatch(r"\d+[a-z]?", text):
        return "figure"
    return "text"


def _derive_series_id(sample_id: Optional[str]) -> Optional[str]:
    text = str(sample_id or "").strip()
    if text.count("-") < 2:
        return None
    return text.rsplit("-", 1)[0]


def _extract_sample_id(*values: Optional[str]) -> Optional[str]:
    for value in values:
        text = str(value or "")
        match = _SAMPLE_ID_PATTERN.search(text)
        if match:
            return match.group(0)
    return None


def _annotate_record_identity(record: dict) -> None:
    if not isinstance(record, dict):
        return
    sample_id = _extract_sample_id(
        record.get("sample_id"),
        record.get("evidence"),
        record.get("notes"),
        record.get("source"),
        record.get("source_figure"),
    )
    if sample_id and not record.get("sample_id"):
        record["sample_id"] = sample_id
    if sample_id:
        record.setdefault("series_id", _derive_series_id(sample_id))


def _annotate_records_with_identity(records: list[dict]) -> None:
    for record in records or []:
        _annotate_record_identity(record)


def _looks_like_trend_record(item: dict) -> bool:
    haystack = " ".join(
        str(item.get(field) or "")
        for field in ("cof", "evidence", "notes", "source", "source_figure")
    )
    haystack = haystack.strip()
    if not haystack:
        return False
    return any(pattern.search(haystack) for pattern in _TREND_PATTERNS)


def _get_drop_reason_for_final_record(item: dict) -> Optional[str]:
    if not _filled_text(item.get("material_name")):
        return "missing_material"
    ionic_liquid = item.get("ionic_liquid", item.get("lubricant"))
    if _is_unknown_il(ionic_liquid):
        return "missing_ionic_liquid"
    if not _resolve_primary_metric_key(item):
        return "missing_primary_metric"
    if _looks_like_trend_record(item):
        return "trend_statement"
    return None


def _resolve_primary_metric_key(item: dict[str, Any] | dict[str, object]) -> Optional[str]:
    for key in _TRIBOLOGY_PERSISTABLE_METRIC_KEYS:
        if _filled_text((item or {}).get(key)):
            return key
    return None


def _is_default_temperature_value(value: Any) -> bool:
    normalized = re.sub(r"\s+", "", _filled_text(value).lower())
    return normalized in {"298.15k", "298k"}


def _temperature_default_evidence_entry(value: Any, confidence: float) -> dict[str, Any]:
    return {
        "value": _filled_text(value) or DEFAULT_TEMPERATURE_VALUE,
        "confidence": confidence,
        "evidence": {
            "source_type": "inferred",
            "page": None,
            "source_label": "Default condition",
            "quote": "Defaulted to 298.15 K when no explicit experimental temperature is reported.",
            "bbox": None,
            "sample_id": None,
            "matched_text": None,
        },
        "grounding_mode": "inferred",
        "grounding_note": "No explicit temperature found; stored as the default room-temperature condition.",
    }


def _resolve_required_field_keys(field_evidence_map: dict[str, Any]) -> list[str]:
    required = ["material", "ionic_liquid"]
    metric_key = _resolve_primary_metric_key(field_evidence_map)
    if metric_key:
        required.append(metric_key)
    return required


def _build_field_evidence_entry(
    *,
    value: Any,
    confidence: float,
    source_type: Optional[str],
    page: Optional[int],
    source_label: Optional[str],
    quote: Optional[str],
    bbox: Optional[list[float]],
    sample_id: Optional[str],
) -> dict[str, Any]:
    if value in (None, ""):
        return {}
    return {
        "value": str(value),
        "confidence": confidence,
        "evidence": {
            "source_type": source_type,
            "page": page,
            "source_label": source_label,
            "quote": quote,
            "bbox": bbox,
            "sample_id": sample_id,
            "matched_text": None,
        },
    }


def _compact_condition_number(value: Any) -> Optional[str]:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(parsed):
        return None
    if parsed.is_integer():
        return f"{int(parsed)}"
    return f"{parsed:g}"


def _is_derived_speed_conditions(speed_conditions: Any) -> bool:
    normalized = normalize_speed_conditions(speed_conditions)
    return (
        str(normalized.get("value_type") or "").strip().lower() == "derived"
        and normalized.get("scan_rate_hz") is not None
        and normalized.get("scan_length_um") is not None
        and normalized.get("sliding_velocity_um_s") is not None
    )


def _derived_speed_text_is_contextual(text: Any) -> bool:
    normalized = _filled_text(text).lower()
    if not normalized:
        return False
    has_scan_length = bool(re.search(r"scan\s*(?:size|length|range)|\b\d+(?:\.\d+)?\s*(?:nm|μm|um)\b", normalized))
    has_scan_rate = bool(re.search(r"scan\s*(?:rate|frequency)|\b\d+(?:\.\d+)?\s*hz\b", normalized))
    return "scan" in normalized and has_scan_length and has_scan_rate


def _derived_speed_conditions_need_source_context(speed_conditions: Any) -> bool:
    normalized = normalize_speed_conditions(speed_conditions)
    return _is_derived_speed_conditions(normalized) and not _derived_speed_text_is_contextual(normalized.get("raw_text"))


def _derived_speed_locator_text(speed_conditions: Any) -> Optional[str]:
    normalized = normalize_speed_conditions(speed_conditions)
    raw_text = _filled_text(normalized.get("raw_text"))
    if raw_text and _derived_speed_text_is_contextual(raw_text):
        return raw_text
    scan_length = _compact_condition_number(normalized.get("scan_length_um"))
    scan_rate = _compact_condition_number(normalized.get("scan_rate_hz"))
    if scan_length and scan_rate:
        return f"scan size {scan_length} μm; scan rate {scan_rate} Hz"
    return None


def _derived_speed_grounding_note(speed_conditions: Any) -> Optional[str]:
    normalized = normalize_speed_conditions(speed_conditions)
    if not _is_derived_speed_conditions(normalized):
        return None
    calculation = _filled_text(normalized.get("calculation"))
    scan_length = _compact_condition_number(normalized.get("scan_length_um"))
    scan_rate = _compact_condition_number(normalized.get("scan_rate_hz"))
    sliding = _compact_condition_number(normalized.get("sliding_velocity_um_s"))
    if not calculation and scan_length and scan_rate and sliding:
        calculation = f"v = 2 x {scan_length} μm x {scan_rate} Hz = {sliding} μm/s"
    if calculation:
        return f"Derived sliding speed from scan size and scan rate: {calculation}."
    return "Derived sliding speed from scan size and scan rate."


def _clean_derived_speed_source_text(text: Any) -> Optional[str]:
    cleaned = re.sub(r"\s+", " ", _filled_text(text)).strip(" ;")
    if not cleaned:
        return None
    scan_start = re.search(r"(?:the\s+)?scan\s*(?:size|length|range)\b", cleaned, flags=re.IGNORECASE)
    if scan_start:
        prefix = cleaned[:scan_start.start()].strip()
        heading_like_prefix = (
            bool(prefix)
            and not re.search(r"[.;:]", prefix)
            and (
                re.search(r"\b(?:materials and methods|methods?|methodology|experimental)\b", prefix, flags=re.IGNORECASE)
                or prefix.upper() == prefix
            )
        )
        if prefix and re.search(r"[.;:]", prefix) and not heading_like_prefix:
            return cleaned
        if heading_like_prefix:
            cleaned = cleaned[scan_start.start():].strip(" ;")
    match = re.search(
        r"(?:the\s+)?scan\s*(?:size|length|range)[^.;]*?(?:scan\s*(?:rate|frequency)|frequency)[^.;]*[.;]?",
        cleaned,
        flags=re.IGNORECASE,
    )
    if match:
        return match.group(0).strip(" ;")
    return cleaned


def _derived_speed_source_text_from_context(context: Any) -> Optional[str]:
    text = _filled_text(context)
    if not text:
        return None
    sentences = [
        re.sub(r"\s+", " ", candidate).strip(" ;")
        for candidate in re.split(r"(?<=[.!?])\s+|[\n\r]+", text)
    ]
    for sentence in sentences:
        lowered = sentence.lower()
        if "scan" in lowered and re.search(r"scan\s*(?:size|length|range)", lowered) and re.search(r"scan\s*(?:rate|frequency)|frequency", lowered):
            return _clean_derived_speed_source_text(sentence)
    match = re.search(
        r"(?:the\s+)?scan\s*(?:size|length|range)[^.;]{0,120}?scan\s*(?:rate|frequency)[^.;]*",
        text,
        flags=re.IGNORECASE,
    )
    if match:
        return _clean_derived_speed_source_text(match.group(0))
    return None


def _speed_value_matches_derived_speed(value: Any, speed_conditions: Any) -> bool:
    normalized = normalize_speed_conditions(speed_conditions)
    derived = normalized.get("sliding_velocity_um_s")
    if derived is None:
        return False
    value_text = _filled_text(value)
    if not value_text:
        return True
    number = re.search(r"[-+]?\d+(?:\.\d+)?", value_text)
    if not number:
        return True
    try:
        return abs(float(number.group(0)) - float(derived)) <= 0.05
    except Exception:
        return False


def _derive_speed_conditions_from_pdf_scan_context(file_path: Optional[str], speed_value: Any = None) -> dict[str, Any]:
    pdf_path = _resolve_existing_path(file_path)
    if not pdf_path or not os.path.exists(pdf_path):
        return {}
    try:
        with fitz.open(pdf_path) as doc:
            for page_index, page in enumerate(doc):
                page_text = " ".join((page.get_text("text") or "").split())
                source_text = _derived_speed_source_text_from_context(page_text)
                if not source_text:
                    continue
                derived = derive_speed_conditions(speed_value, context=source_text)
                if not _is_derived_speed_conditions(derived):
                    continue
                if not _speed_value_matches_derived_speed(speed_value, derived):
                    continue
                derived["raw_text"] = source_text
                derived["source_page"] = page_index + 1
                derived["source_label"] = "Materials and methods"
                return derived
    except Exception:
        return {}
    return {}


def _derived_speed_evidence_is_contextual(evidence: dict[str, Any]) -> bool:
    text = " ".join(
        _filled_text(evidence.get(key))
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


def _speed_conditions_for_field_evidence(item: dict[str, Any], db_record: Any) -> dict[str, Any]:
    normalized = normalize_speed_conditions(
        item.get("speed_conditions")
        or item.get("speedConditions")
        or getattr(db_record, "speed_conditions_json", None)
    )
    if normalized:
        return normalized

    context = " ".join(
        _filled_text(part)
        for part in (
            item.get("evidence"),
            item.get("notes"),
            item.get("source"),
            item.get("source_figure"),
            getattr(db_record, "source", None),
            getattr(db_record, "source_figure", None),
        )
        if _filled_text(part)
    )
    derived = derive_speed_conditions(item.get("speed") or item.get("speed_value"), context=context)
    if _is_derived_speed_conditions(derived):
        source_text = _derived_speed_source_text_from_context(context)
        raw_text = _filled_text(derived.get("raw_text"))
        if source_text and (not _derived_speed_text_is_contextual(raw_text) or len(source_text) < len(raw_text)):
            derived["raw_text"] = source_text
    return derived


def _field_evidence_text_context(field_evidence: dict[str, Any], field_key: str) -> str:
    entry = field_evidence.get(field_key) if isinstance(field_evidence.get(field_key), dict) else {}
    evidence = entry.get("evidence") if isinstance(entry.get("evidence"), dict) else {}
    return " ".join(
        part
        for part in (
            _filled_text(evidence.get("quote")),
            _filled_text(evidence.get("matched_text") or evidence.get("matchedText")),
            _filled_text(entry.get("grounding_note")),
        )
        if part
    )


def _is_visual_source_type(source_type: Any, source_label: Any = None) -> bool:
    source_type_text = _filled_text(source_type).lower()
    source_label_text = _filled_text(source_label).lower()
    return (
        source_type_text in {"figure", "visual", "image"}
        or bool(re.search(r"\bfig(?:ure)?\.?\s*\d+", source_label_text, flags=re.IGNORECASE))
    )


def _field_value_for_evidence(item: dict[str, Any], field_key: str) -> Any:
    if field_key == "material":
        return item.get("material_name")
    if field_key == "ionic_liquid":
        return item.get("ionic_liquid", item.get("lubricant"))
    if field_key == "cof":
        return item.get("cof")
    if field_key == "friction_force":
        return item.get("friction_force")
    if field_key == "wear_rate":
        return item.get("wear_rate")
    if field_key == "film_thickness":
        return item.get("film_thickness")
    if field_key == "residual_film_thickness_d":
        return item.get("residual_film_thickness_d")
    if field_key == "layer_spacing_delta":
        return item.get("layer_spacing_delta")
    if field_key == "regime":
        return item.get("regime")
    if field_key == "surface_roughness":
        return item.get("surface_roughness")
    if field_key == "probe_roughness":
        return item.get("probe_roughness")
    if field_key == "substrate_roughness":
        return item.get("substrate_roughness")
    if field_key == "load":
        return item.get("load") or item.get("normal_load")
    if field_key == "speed":
        return item.get("speed")
    if field_key == "shear_rate":
        return item.get("shear_rate")
    if field_key == "temperature":
        return item.get("temperature")
    if field_key == "water_content":
        return item.get("water_content")
    if field_key == "potential":
        return item.get("potential")
    return None


def _field_semantic_type(field_key: str) -> str:
    if field_key == "material":
        return "material"
    if field_key == "ionic_liquid":
        return "lubricant"
    if field_key == "cof":
        return "cof"
    if field_key == "friction_force":
        return "friction_force"
    if field_key == "wear_rate":
        return "wear_rate"
    if field_key == "film_thickness":
        return "film_thickness"
    if field_key == "residual_film_thickness_d":
        return "thickness"
    if field_key == "layer_spacing_delta":
        return "spacing"
    if field_key == "regime":
        return "regime"
    if field_key == "surface_roughness":
        return "roughness"
    if field_key in {"probe_roughness", "substrate_roughness"}:
        return "roughness"
    if field_key == "load":
        return "load"
    if field_key == "speed":
        return "speed"
    if field_key == "shear_rate":
        return "shear_rate"
    if field_key == "temperature":
        return "temperature"
    if field_key == "water_content":
        return "water_content"
    if field_key == "potential":
        return "potential"
    return ""


def _ionic_liquid_query_variants(value: Any) -> list[str]:
    text = _filled_text(value)
    if not text:
        return []

    resolved = resolve_il(text)
    cation = str(resolved.get("cation") or "").strip()
    anion = str(resolved.get("anion") or "").strip()
    if not cation or not anion:
        return []

    cation_variants = [cation]
    anion_variants = [anion]
    cation_variants.extend(
        str(alias).strip()
        for alias in (CATION_DB.get(cation, {}) or {}).get("aliases", [])
        if str(alias or "").strip()
    )
    anion_variants.extend(
        str(alias).strip().lstrip("[").rstrip("]").rstrip("-")
        for alias in (ANION_DB.get(anion, {}) or {}).get("aliases", [])
        if str(alias or "").strip()
    )

    variants: list[str] = []
    for cation_variant in cation_variants[:8]:
        for anion_variant in anion_variants[:6]:
            if not cation_variant or not anion_variant:
                continue
            variants.extend(
                [
                    f"[{cation_variant}][{anion_variant}]",
                    f"[{cation_variant}]{anion_variant}",
                    f"{cation_variant} {anion_variant}",
                ]
            )
    return variants


def _micro_text_variants(text: str) -> list[str]:
    variants = [text]
    if "μ" in text or "µ" in text:
        variants.extend([
            text.replace("μ", "µ"),
            text.replace("µ", "μ"),
        ])
    return list(dict.fromkeys(candidate for candidate in variants if candidate))


def _field_context_query_variants(field_key: str, value: Any) -> list[str]:
    text = _filled_text(value)
    if not text:
        return []

    queries: list[str] = []
    if field_key == "material":
        lowered = text.lower()
        if not any(token in lowered for token in ("[", "]")):
            queries.extend([
                f"freshly cleaved {text} surface",
                f"{text} surface",
                f"bare {text}",
                f"uncoated {text}",
            ])
    elif field_key in {"surface_roughness", "probe_roughness", "substrate_roughness"}:
        roughness_number = re.search(r"[-+]?\d+(?:\.\d+)?\s*(?:nm|μm|um|pm)\b", text, flags=re.IGNORECASE)
        roughness_texts = [text]
        if roughness_number:
            roughness_texts.append(roughness_number.group(0).strip())
        for roughness_text in dict.fromkeys(roughness_texts):
            queries.extend([
                f"RMS roughness was smaller than {roughness_text}",
                f"roughness was smaller than {roughness_text}",
                f"RMS roughness {roughness_text}",
                f"roughness {roughness_text}",
            ])
        queries.extend([
            f"{text}",
        ])
    elif field_key == "speed":
        for variant in _micro_text_variants(text):
            queries.extend([
                f"constant sliding velocity of {variant}",
                f"sliding velocity of {variant}",
                f"performed at {variant}",
                f"at {variant}",
            ])
    elif field_key == "shear_rate":
        queries.extend([
            f"shear rate {text}",
            f"shear rates {text}",
            f"at any shear rate investigated {text}",
            str(text),
        ])
    elif field_key == "regime":
        queries.extend([
            text,
            text.replace("layers", "film").replace("layer", "film"),
            "structural force regions",
            "repulsive structural force regions",
        ])
    elif field_key == "load":
        nums = re.findall(r"\d+(?:\.\d+)?", text)
        unit_match = re.search(r"\b(nN|mN|N)\b", text, flags=re.IGNORECASE)
        unit = unit_match.group(1) if unit_match else "nN"
        if len(nums) >= 2:
            low, high = nums[0], nums[1]
            queries.extend([
                f"between {low} and {high} {unit}",
                f"{low} and {high} {unit}",
                f"{low} to {high} {unit}",
                f"{low}-{high} {unit}",
                f"{low}–{high} {unit}",
                f"normal loads between {low} and {high} {unit}",
                f"normal load ranging from {low} to {high} {unit}",
            ])
    return queries


def _field_query_variants(field_key: str, value: Any) -> list[str]:
    from services.pdf_service import build_term_query_variants

    text = _filled_text(value)
    if not text:
        return []

    queries = _field_context_query_variants(field_key, text)
    if field_key == "ionic_liquid":
        queries.extend(build_term_query_variants(text))
        queries.extend(_ionic_liquid_query_variants(text))
    elif field_key == "cof":
        numeric_match = re.search(r"-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?", text)
        if numeric_match:
            numeric = numeric_match.group(0)
            numeric_terms = [numeric]
            try:
                numeric_value = float(numeric)
                if abs(numeric_value) < 1:
                    numeric_terms.insert(0, f"{numeric_value:.3f}")
                elif numeric_value.is_integer():
                    numeric_terms.insert(0, f"{numeric_value:.1f}")
            except Exception:
                pass
            for term in dict.fromkeys(term for term in numeric_terms if term):
                queries.extend(build_term_query_variants(term))
                queries.extend([
                    term,
                    f"μ = {term}",
                    f"mu = {term}",
                    f"COF {term}",
                    f"coefficient of friction {term}",
                ])
    elif field_key == "potential":
        queries.extend(build_term_query_variants(text))
        queries.extend([f"potential {text}", f"voltage {text}"])
        magnitude_match = re.search(r"([+-]?\d+(?:[\.:]\d+)?)", text)
        if magnitude_match:
            magnitude = magnitude_match.group(1)
            decimal_magnitude = magnitude.replace(":", ".")
            colon_magnitude = magnitude.replace(".", ":")
            for candidate in {magnitude, decimal_magnitude, colon_magnitude}:
                queries.extend([
                    f"{candidate} V",
                    f"{candidate}V",
                    f"potential {candidate} V",
                    f"voltage {candidate} V",
                ])
                signed_parts = re.match(r"^([+-])(.+)$", candidate)
                if signed_parts:
                    sign_variants = ["+", "\uff0b"] if signed_parts.group(1) == "+" else ["-", "\u2212", "\u2013"]
                    for sign_variant in sign_variants:
                        signed = f"{sign_variant}{signed_parts.group(2)}"
                        spaced = f"{sign_variant} {signed_parts.group(2)}"
                        queries.extend([
                            f"{signed} V",
                            f"{signed}V",
                            f"{spaced} V",
                            f"{spaced}V",
                            f"potential {signed} V",
                            f"potential {spaced} V",
                            f"voltage {signed} V",
                            f"voltage {spaced} V",
                        ])
        if re.search(r"\bocp\b", text, flags=re.IGNORECASE):
            queries.extend(["OCP", "open circuit potential", "at OCP", "potential at OCP"])
    elif field_key == "load":
        queries.extend(build_term_query_variants(text))
        queries.extend([f"load {text}", f"normal load {text}"])
        if re.search(r"\d+\s*[-–—]\s*\d+\s*n\s*n", text, flags=re.IGNORECASE):
            queries.extend(["normal load", "normal load (nN)", "load (nN)"])
    elif field_key == "speed":
        queries.extend(build_term_query_variants(text))
        queries.extend([f"speed {text}", f"scan speed {text}", f"sliding speed {text}"])
    elif field_key == "shear_rate":
        queries.extend(build_term_query_variants(text))
        queries.extend([f"shear rate {text}", f"shear rates {text}", str(text)])
    elif field_key == "temperature":
        queries.extend(build_term_query_variants(text))
        queries.extend([f"temperature {text}"])
    elif field_key == "water_content":
        queries.extend(build_term_query_variants(text))
        queries.extend([f"water content {text}", f"humidity {text}"])
    else:
        queries.extend(build_term_query_variants(text))

    deduped: list[str] = []
    seen: set[str] = set()
    for query in queries:
        candidate = re.sub(r"\s+", " ", str(query or "")).strip()
        if len(candidate) < 2:
            continue
        key = candidate.lower().replace("μ", "u").replace("µ", "u")
        if key in seen:
            continue
        seen.add(key)
        deduped.append(candidate)
    return deduped


def _field_allows_global_context_fallback(field_key: str, value: Any) -> bool:
    value_text = _filled_text(value)
    if not value_text:
        return False
    if field_key in {"material", "ionic_liquid", "surface_roughness", "probe_roughness", "substrate_roughness", "regime"}:
        return True
    if field_key == "cof":
        return True
    if field_key == "speed":
        return True
    if field_key == "load" and len(re.findall(r"\d+(?:\.\d+)?", value_text)) >= 2:
        return True
    return False


def _all_numeric_values_match(term: str, matched_text: str) -> bool:
    from services.pdf_service import extract_numeric_values

    term_values = extract_numeric_values(term)
    matched_values = extract_numeric_values(matched_text)
    if not term_values or not matched_values:
        return False
    for term_value in term_values:
        tolerance = max(1e-6, abs(term_value) * 0.01)
        if not any(abs(term_value - matched_value) <= tolerance for matched_value in matched_values):
            return False
    return True


def _field_exact_query_variants(field_key: str, value: Any) -> list[str]:
    from services.pdf_service import build_term_query_variants

    text = _filled_text(value)
    if not text:
        return []

    if field_key == "ionic_liquid":
        return _field_query_variants(field_key, value)

    variants = list(build_term_query_variants(text))
    has_numeric_value = bool(re.search(r"\d", text))
    if has_numeric_value:
        variants = [candidate for candidate in variants if re.search(r"\d", candidate)]

    deduped: list[str] = []
    seen: set[str] = set()
    for variant in variants:
        candidate = re.sub(r"\s+", " ", str(variant or "")).strip()
        if len(candidate) < 2:
            continue
        key = candidate.lower().replace("μ", "u").replace("µ", "u")
        if key in seen:
            continue
        seen.add(key)
        deduped.append(candidate)
    return deduped


def _text_explicitly_matches_field_value(field_key: str, value: Any, text: Optional[str]) -> bool:
    from services.pdf_service import normalize_term_key, numeric_term_matches

    source_text = _filled_text(text)
    value_text = _filled_text(value)
    if not source_text or not value_text:
        return False

    if field_key == "potential":
        magnitude_match = re.search(r"(\d+(?:\.\d+)?)", value_text)
        if not magnitude_match:
            return False
        magnitude = magnitude_match.group(1)
        magnitude_pattern = re.escape(magnitude).replace(r"\.", r"[:.]?")
        if re.search(rf"(?<!\d){magnitude_pattern}\s*[vV](?![A-Za-z])", source_text):
            return True
        return False

    normalized_source = normalize_term_key(source_text)
    for variant in _field_exact_query_variants(field_key, value_text):
        candidate = _filled_text(variant)
        if not candidate:
            continue
        if normalize_term_key(candidate) and normalize_term_key(candidate) in normalized_source:
            return True
        if re.search(r"\d", candidate) and numeric_term_matches(candidate, source_text):
            if len(re.findall(r"-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?", candidate)) > 1 and not _all_numeric_values_match(candidate, source_text):
                continue
            if field_key != "potential" or re.search(r"[vV]|volt|potential", source_text):
                return True
    return False


def _derive_grounding_metadata(
    field_key: str,
    value: Any,
    evidence: Optional[dict[str, Any]],
) -> tuple[Optional[str], Optional[str]]:
    value_text = _filled_text(value)
    evidence_map = evidence or {}
    quote = _filled_text(evidence_map.get("quote"))
    matched_text = _filled_text(evidence_map.get("matched_text"))
    combined = " ".join(part for part in [matched_text, quote] if part).strip()
    combined_lower = combined.lower()
    normalized_value = value_text.strip().lower()

    source_is_precise = _source_label_has_precise_region(evidence_map.get("source_type"), evidence_map.get("source_label"))
    if (
        field_key == "temperature"
        and normalized_value in {"298.15 k", "298.15k", "298 k", "298k", "293 k", "293k"}
        and any(token in combined_lower for token in ("room temperature", "room-temperature", "ambient temperature"))
    ):
        return "derived", 'Normalized from room-temperature wording.'

    if not _evidence_has_location(evidence_map):
        return None, None

    if _text_explicitly_matches_field_value(field_key, value_text, matched_text) or _text_explicitly_matches_field_value(field_key, value_text, quote):
        return "explicit", None

    if (
        field_key == "potential"
        and source_is_precise
        and re.search(r"\bocp\b|open circuit potential", normalized_value, flags=re.IGNORECASE)
        and any(token in combined_lower for token in ("open circuit potential", "ocp"))
    ):
        return "derived", 'Derived from open-circuit-potential wording.'
    return None, None


def _refine_potential_evidence_from_metric_context(entries: dict[str, Any]) -> dict[str, Any]:
    return _refine_potential_evidence_from_metric_context_with_pdf(entries, None)


def _locate_table_potential_header_from_metric(
    *,
    pdf_path: str,
    page_num: int,
    metric_bbox: list[float],
    potential_value: Any,
) -> Optional[dict[str, Any]]:
    if not pdf_path or page_num < 1 or not metric_bbox or len(metric_bbox) != 4:
        return None
    try:
        with fitz.open(pdf_path) as doc:
            page = doc[int(page_num) - 1]
            metric_x0, metric_y0, metric_x1, _ = [float(value) for value in metric_bbox]
            metric_cx = (metric_x0 + metric_x1) / 2.0
            y_min = max(0.0, metric_y0 - 90.0)
            y_max = max(0.0, metric_y0 - 2.0)
            words = sorted(page.get_text("words"), key=lambda word: (float(word[1]), float(word[0])))
            candidates: list[tuple[float, list[float], str]] = []
            for idx, word in enumerate(words):
                x0, y0, x1, y1, text, *_ = word
                text = str(text or "").strip()
                if not (y_min <= float(y0) <= y_max) or not re.search(r"\d", text):
                    continue
                if idx + 1 >= len(words):
                    continue
                next_word = words[idx + 1]
                nx0, ny0, nx1, ny1, next_text, *_ = next_word
                next_text = str(next_text or "").strip()
                if next_text.lower() != "v":
                    continue
                if abs(float(ny0) - float(y0)) > 3.0 or float(nx0) - float(x1) > 10.0:
                    continue
                bbox = [float(x0), float(y0), float(nx1), float(max(y1, ny1))]
                center_x = (bbox[0] + bbox[2]) / 2.0
                candidates.append((abs(center_x - metric_cx), bbox, f"{text} {next_text}"))
            if not candidates:
                return None
            _, bbox, pdf_text = min(candidates, key=lambda item: item[0])
            matched_text = _filled_text(potential_value) or pdf_text
            return {
                "page": page_num,
                "bbox": bbox,
                "matched_text": matched_text,
                "quote": _extract_field_quote_from_bbox(pdf_path, page_num, bbox, fallback_term=matched_text),
            }
    except Exception:
        return None


def _potential_value_parts(value: Any) -> tuple[Optional[float], str]:
    text = _filled_text(value)
    match = re.search(r"([+-]?)\s*(\d+(?:[\.:]\d+)?)", text)
    if not match:
        return None, ""
    try:
        magnitude = float(match.group(2).replace(":", "."))
    except Exception:
        return None, ""
    return magnitude, match.group(1) or ""


def _potential_header_matches_value(header_text: str, potential_value: Any) -> bool:
    target_magnitude, target_sign = _potential_value_parts(potential_value)
    if target_magnitude is None:
        return False

    header = (
        _filled_text(header_text)
        .replace("\u2212", "-")
        .replace("\u2013", "-")
        .replace("\u2014", "-")
        .replace("\uff0b", "+")
    )
    match = re.search(r"([+-]?)\s*(\d+(?:[\.:]\d+)?)\s*v\b", header, flags=re.IGNORECASE)
    if not match:
        return False
    try:
        header_magnitude = float(match.group(2).replace(":", "."))
    except Exception:
        return False
    if abs(header_magnitude - target_magnitude) > max(1e-6, abs(target_magnitude) * 0.01):
        return False

    header_sign = match.group(1) or ""
    if abs(target_magnitude) < 1e-12:
        return header_sign in {"", "+"}
    if target_sign == "+":
        return header_sign == "+"
    if target_sign == "-":
        # Some PDFs drop the minus glyph in table headers. An unsigned non-zero
        # header in a signed voltage table is therefore treated as cathodic.
        return header_sign in {"", "-"}
    return True


def _center_in_bbox(bbox: Optional[list[float]], candidate_bbox: list[float], *, margin: float = 12.0) -> bool:
    if not bbox or len(bbox) != 4 or len(candidate_bbox) != 4:
        return True
    ax0, ay0, ax1, ay1 = [float(value) for value in bbox]
    bx0, by0, bx1, by1 = [float(value) for value in candidate_bbox]
    cx = (bx0 + bx1) / 2.0
    cy = (by0 + by1) / 2.0
    return (ax0 - margin) <= cx <= (ax1 + margin) and (ay0 - margin) <= cy <= (ay1 + margin)


def _table_potential_header_candidates(
    *,
    pdf_path: str,
    page_num: int,
    anchor_bbox: Optional[list[float]] = None,
    y_min: Optional[float] = None,
    y_max: Optional[float] = None,
) -> list[tuple[list[float], str]]:
    if not pdf_path or page_num < 1:
        return []
    try:
        with fitz.open(pdf_path) as doc:
            page = doc[int(page_num) - 1]
            words = sorted(page.get_text("words"), key=lambda word: (float(word[1]), float(word[0])))
            candidates: list[tuple[list[float], str]] = []
            for idx, word in enumerate(words):
                x0, y0, x1, y1, text, *_ = word
                text = str(text or "").strip()
                if y_min is not None and float(y0) < y_min:
                    continue
                if y_max is not None and float(y0) > y_max:
                    continue
                if not re.search(r"[+-]?\d+(?:[\.:]\d+)?$", text):
                    continue
                if idx + 1 >= len(words):
                    continue
                next_word = words[idx + 1]
                nx0, ny0, nx1, ny1, next_text, *_ = next_word
                next_text = str(next_text or "").strip()
                if next_text.lower() != "v":
                    continue
                if abs(float(ny0) - float(y0)) > 3.0 or float(nx0) - float(x1) > 10.0:
                    continue
                bbox = [float(x0), float(y0), float(nx1), float(max(y1, ny1))]
                if not _center_in_bbox(anchor_bbox, bbox):
                    continue
                candidates.append((bbox, f"{text} {next_text}"))
            return candidates
    except Exception:
        return []


def _locate_table_potential_header_by_value(
    *,
    pdf_path: str,
    page_num: int,
    potential_value: Any,
    anchor_bbox: Optional[list[float]] = None,
) -> Optional[dict[str, Any]]:
    candidates = [
        (bbox, text)
        for bbox, text in _table_potential_header_candidates(
            pdf_path=pdf_path,
            page_num=page_num,
            anchor_bbox=anchor_bbox,
        )
        if _potential_header_matches_value(text, potential_value)
    ]
    if not candidates:
        return None

    if anchor_bbox and len(anchor_bbox) == 4:
        ax0, ay0, ax1, ay1 = [float(value) for value in anchor_bbox]
        anchor_center = ((ax0 + ax1) / 2.0, (ay0 + ay1) / 2.0)
    else:
        anchor_center = None

    def _score(item: tuple[list[float], str]) -> tuple[float, float]:
        bbox, _ = item
        if not anchor_center:
            return (float(bbox[1]), float(bbox[0]))
        cx = (float(bbox[0]) + float(bbox[2])) / 2.0
        cy = (float(bbox[1]) + float(bbox[3])) / 2.0
        return (math.hypot(cx - anchor_center[0], cy - anchor_center[1]), float(bbox[0]))

    bbox, pdf_text = min(candidates, key=_score)
    matched_text = _filled_text(potential_value) or pdf_text
    return {
        "page": page_num,
        "bbox": bbox,
        "matched_text": matched_text,
        "quote": _extract_field_quote_from_bbox(pdf_path, page_num, bbox, fallback_term=matched_text),
    }


def _numeric_word_matches_value(text: str, value: Any) -> bool:
    target_match = re.search(r"-?\d+(?:[\.:]\d+)?(?:[eE][-+]?\d+)?", _filled_text(value))
    candidate_match = re.search(r"-?\d+(?:[\.:]\d+)?(?:[eE][-+]?\d+)?", _filled_text(text))
    if not target_match or not candidate_match:
        return False
    try:
        target = float(target_match.group(0).replace(":", "."))
        candidate = float(candidate_match.group(0).replace(":", "."))
    except Exception:
        return False
    return abs(candidate - target) <= max(1e-6, abs(target) * 0.01)


def _word_has_adjacent_voltage_unit(words: list[Any], index: int) -> bool:
    if index < 0 or index >= len(words):
        return False
    x0, y0, x1, _, *_ = words[index]
    for neighbor_index in (index - 1, index + 1):
        if neighbor_index < 0 or neighbor_index >= len(words):
            continue
        nx0, ny0, nx1, _, text, *_ = words[neighbor_index]
        if str(text or "").strip().lower() != "v":
            continue
        if abs(float(ny0) - float(y0)) <= 3.0 and min(abs(float(nx0) - float(x1)), abs(float(x0) - float(nx1))) <= 10.0:
            return True
    return False


def _locate_table_numeric_value(
    *,
    pdf_path: str,
    page_num: int,
    field_value: Any,
    anchor_bbox: Optional[list[float]] = None,
) -> Optional[dict[str, Any]]:
    if not pdf_path or page_num < 1:
        return None
    try:
        with fitz.open(pdf_path) as doc:
            page = doc[int(page_num) - 1]
            words = sorted(page.get_text("words"), key=lambda word: (float(word[1]), float(word[0])))
            candidates: list[tuple[float, list[float], str]] = []
            for idx, word in enumerate(words):
                x0, y0, x1, y1, text, *_ = word
                text = str(text or "").strip()
                if not _numeric_word_matches_value(text, field_value):
                    continue
                bbox = [float(x0), float(y0), float(x1), float(y1)]
                if not _center_in_bbox(anchor_bbox, bbox):
                    continue
                if _word_has_adjacent_voltage_unit(words, idx):
                    continue
                distance = _bbox_center_distance(anchor_bbox, bbox) if anchor_bbox else float(y0)
                candidates.append((distance, bbox, text))
            if not candidates:
                return None
            _, bbox, matched_text = min(candidates, key=lambda item: (item[0], item[1][1], item[1][0]))
            return {
                "page": page_num,
                "bbox": bbox,
                "matched_text": matched_text,
                "quote": _extract_field_quote_from_bbox(pdf_path, page_num, bbox, fallback_term=matched_text),
            }
    except Exception:
        return None


def _refine_potential_bbox_near_metric_evidence(
    *,
    file_path: Optional[str],
    potential_value: Any,
    metric_evidence: dict[str, Any],
) -> Optional[dict[str, Any]]:
    from utils.pdf_coords import find_text_coordinates

    pdf_path = _resolve_existing_path(file_path)
    page_num = int(metric_evidence.get("page") or 0)
    metric_bbox = metric_evidence.get("bbox")
    if not pdf_path or page_num < 1 or not isinstance(metric_bbox, list) or len(metric_bbox) != 4:
        return None

    metric_source_type = str(metric_evidence.get("source_type") or "").strip().lower()
    metric_source_label = str(metric_evidence.get("source_label") or "").strip()
    if _looks_like_table_source(metric_source_type, metric_source_label):
        table_header = _locate_table_potential_header_from_metric(
            pdf_path=pdf_path,
            page_num=page_num,
            metric_bbox=[float(value) for value in metric_bbox],
            potential_value=potential_value,
        )
        if table_header:
            return table_header

    magnitude_match = re.search(r"(\d+(?:\.\d+)?)", _filled_text(potential_value))
    if not magnitude_match:
        return None
    magnitude = magnitude_match.group(1)
    magnitude_values = [magnitude]
    try:
        magnitude_float = float(magnitude)
        if magnitude_float.is_integer():
            magnitude_values.append(f"{magnitude_float:.1f}")
    except Exception:
        pass
    value_text = _filled_text(potential_value)
    sign_match = re.search(r"([+-])\s*\d", value_text)
    sign = sign_match.group(1) if sign_match else ""
    sign_variants = [""]
    if sign == "+":
        sign_variants = ["+", "\uff0b"]
    elif sign == "-":
        sign_variants = ["-", "\u2212", "\u2013"]

    query_candidates = []
    for magnitude_candidate in dict.fromkeys(magnitude_values):
        for sign_variant in sign_variants:
            query_candidates.extend([
                f"{sign_variant}{magnitude_candidate} V",
                f"{sign_variant}{magnitude_candidate}V",
            ])
            if sign_variant:
                query_candidates.extend([
                    f"{sign_variant} {magnitude_candidate} V",
                    f"{sign_variant} {magnitude_candidate}V",
                ])
        if not sign or sign == "-":
            # Some PDFs drop the minus glyph in table headers. Keep unsigned
            # candidates and let proximity to the metric column disambiguate.
            query_candidates.extend([
                f"{magnitude_candidate} V",
                f"{magnitude_candidate}V",
            ])
        if "." not in magnitude_candidate:
            continue
        colon_magnitude = magnitude_candidate.replace(".", ":")
        for sign_variant in sign_variants:
            query_candidates.extend([
                f"{sign_variant}{colon_magnitude} V",
                f"{sign_variant}{colon_magnitude}V",
            ])
            if sign_variant:
                query_candidates.extend([
                    f"{sign_variant} {colon_magnitude} V",
                    f"{sign_variant} {colon_magnitude}V",
                ])
        if not sign or sign == "-":
            query_candidates.extend([
                f"{colon_magnitude} V",
                f"{colon_magnitude}V",
            ])

    try:
        matches: list[tuple[float, fitz.Rect, str]] = []
        hits = find_text_coordinates(
            pdf_path,
            [{
                "id": "potential",
                "queries": query_candidates,
                "semantic_type": "potential",
                "page_hint": page_num,
                "restrict_to_page_hint": True,
                "anchor_bbox": metric_bbox,
                "restrict_to_anchor_bbox": False,
            }],
        )
        for hit in hits:
            w = float(hit.get("w") or 0)
            h = float(hit.get("h") or 0)
            if w <= 0 or h <= 0:
                continue
            x0 = float(hit.get("x") or 0)
            y0 = float(hit.get("y") or 0)
            rect = fitz.Rect(x0, y0, x0 + w, y0 + h)
            rect_bbox = [float(rect.x0), float(rect.y0), float(rect.x1), float(rect.y1)]
            score = _bbox_center_distance(metric_bbox, rect_bbox)
            matches.append((score, rect, _filled_text(hit.get("matched_text")) or _filled_text(potential_value)))
        if not matches:
            return None
        _, best_rect, matched_text = min(matches, key=lambda item: item[0])
        bbox = [float(best_rect.x0), float(best_rect.y0), float(best_rect.x1), float(best_rect.y1)]
        return {
            "page": page_num,
            "bbox": bbox,
            "matched_text": _filled_text(matched_text) or _filled_text(potential_value),
            "quote": _extract_field_quote_from_bbox(pdf_path, page_num, bbox, fallback_term=_filled_text(matched_text) or _filled_text(potential_value)),
        }
    except Exception:
        return None


def _refine_potential_evidence_from_metric_context_with_pdf(
    entries: dict[str, Any],
    file_path: Optional[str],
) -> dict[str, Any]:
    potential_entry = entries.get("potential")
    if not isinstance(potential_entry, dict) or not _filled_text(potential_entry.get("value")):
        return entries

    potential_value = potential_entry.get("value")
    potential_evidence = potential_entry.get("evidence") or {}
    if (
        str(potential_entry.get("grounding_mode") or "").strip().lower() == "explicit"
        and _evidence_has_location(potential_evidence)
    ):
        return entries

    primary_metric_keys = (
        "cof",
        "friction_force",
        "wear_rate",
        "film_thickness",
        "residual_film_thickness_d",
        "layer_spacing_delta",
        "surface_roughness",
    )
    for metric_key in primary_metric_keys:
        metric_entry = entries.get(metric_key)
        if not isinstance(metric_entry, dict):
            continue
        metric_evidence = metric_entry.get("evidence") or {}
        refined_bbox_evidence = _refine_potential_bbox_near_metric_evidence(
            file_path=file_path,
            potential_value=potential_value,
            metric_evidence=metric_evidence,
        )
        if not refined_bbox_evidence:
            metric_quote = _filled_text(metric_evidence.get("quote"))
            if not _text_explicitly_matches_field_value("potential", potential_value, metric_quote):
                continue
        potential_entry["evidence"] = {
            **metric_evidence,
            **(refined_bbox_evidence or {}),
            "matched_text": _filled_text((refined_bbox_evidence or {}).get("matched_text")) or _filled_text(potential_value),
        }
        entries["potential"] = potential_entry
        return entries

    return entries


def _clean_field_quote_text(text: Any, *, max_chars: int = 420) -> str:
    cleaned = re.sub(r"\s+", " ", str(text or "")).strip()
    if len(cleaned) > max_chars:
        cleaned = cleaned[:max_chars].strip()
        if re.search(r"[A-Za-z0-9]$", cleaned):
            cleaned = re.sub(r"\s+\S*$", "", cleaned).strip()
    return cleaned


def _extract_line_quote_from_bbox(page: Any, bbox: list[float]) -> str:
    try:
        x0, y0, x1, y1 = [float(value) for value in bbox]
        words = page.get_text("words") or []
    except Exception:
        return ""
    if not words:
        return ""

    def _word_rect(word: Any) -> tuple[float, float, float, float]:
        return (float(word[0]), float(word[1]), float(word[2]), float(word[3]))

    def _intersects_or_near(word: Any, margin: float = 3.0) -> bool:
        wx0, wy0, wx1, wy1 = _word_rect(word)
        return max(x0 - margin, wx0) <= min(x1 + margin, wx1) and max(y0 - margin, wy0) <= min(y1 + margin, wy1)

    target_lines = {
        (int(word[5]), int(word[6]))
        for word in words
        if len(word) >= 7 and _intersects_or_near(word)
    }
    if not target_lines:
        target_cy = (y0 + y1) / 2.0
        nearby = [
            word for word in words
            if len(word) >= 7 and abs(((float(word[1]) + float(word[3])) / 2.0) - target_cy) <= 5.0
        ]
        if nearby:
            closest = min(nearby, key=lambda word: abs(((float(word[0]) + float(word[2])) / 2.0) - ((x0 + x1) / 2.0)))
            target_lines.add((int(closest[5]), int(closest[6])))
    if not target_lines:
        return ""

    min_x = max(0.0, x0 - 260.0)
    max_x = x1 + 360.0
    line_words = [
        word for word in words
        if len(word) >= 7
        and (int(word[5]), int(word[6])) in target_lines
        and min_x <= float(word[0]) <= max_x
    ]
    if not line_words:
        return ""
    line_words.sort(key=lambda word: (int(word[5]), int(word[6]), float(word[0])))
    return _clean_field_quote_text(" ".join(str(word[4] or "") for word in line_words))


def _extract_field_quote_from_bbox(
    pdf_path: Optional[str],
    page_num: Optional[int],
    bbox: Optional[list[float]],
    *,
    fallback_term: Optional[str] = None,
) -> Optional[str]:
    if not pdf_path or not os.path.exists(pdf_path) or not page_num or not bbox or len(bbox) != 4:
        return _filled_text(fallback_term) or None

    try:
        doc = fitz.open(pdf_path)
        page = doc[int(page_num) - 1]
        line_quote = _extract_line_quote_from_bbox(page, bbox)
        if line_quote and (len(line_quote) >= 12 or not _filled_text(fallback_term) or _filled_text(fallback_term) in line_quote):
            doc.close()
            return line_quote
        x0, y0, x1, y1 = [float(value) for value in bbox]
        clip = fitz.Rect(
            max(0, x0 - 140),
            max(0, y0 - 45),
            min(page.rect.width, x1 + 220),
            min(page.rect.height, y1 + 45),
        )
        snippet = re.sub(r"\s+", " ", (page.get_text("text", clip=clip) or "")).strip()
        doc.close()
        if snippet:
            return _clean_field_quote_text(snippet)
    except Exception:
        pass

    try:
        from services.pdf_service import extract_text_snippet

        snippet = extract_text_snippet(
            pdf_path,
            int(page_num),
            bbox,
            fallback_term=_filled_text(fallback_term) or None,
            prefer_term_context=False,
        )
        if snippet:
            return _clean_field_quote_text(snippet)
    except Exception:
        return _filled_text(fallback_term) or None

    return _filled_text(fallback_term) or None


def _bbox_intersects(anchor_bbox: Optional[list[float]], candidate_bbox: Optional[list[float]]) -> bool:
    if not anchor_bbox or not candidate_bbox or len(anchor_bbox) != 4 or len(candidate_bbox) != 4:
        return False
    ax0, ay0, ax1, ay1 = [float(value) for value in anchor_bbox]
    bx0, by0, bx1, by1 = [float(value) for value in candidate_bbox]
    return max(ax0, bx0) < min(ax1, bx1) and max(ay0, by0) < min(ay1, by1)


def _bbox_center_distance(anchor_bbox: Optional[list[float]], candidate_bbox: Optional[list[float]]) -> float:
    if not anchor_bbox or not candidate_bbox or len(anchor_bbox) != 4 or len(candidate_bbox) != 4:
        return float("inf")
    ax0, ay0, ax1, ay1 = [float(value) for value in anchor_bbox]
    bx0, by0, bx1, by1 = [float(value) for value in candidate_bbox]
    anchor_cx = (ax0 + ax1) / 2.0
    anchor_cy = (ay0 + ay1) / 2.0
    candidate_cx = (bx0 + bx1) / 2.0
    candidate_cy = (by0 + by1) / 2.0
    return math.hypot(anchor_cx - candidate_cx, anchor_cy - candidate_cy)


def _source_label_has_precise_region(source_type: Optional[str], source_label: Optional[str]) -> bool:
    normalized_type = str(source_type or "").strip().lower()
    if normalized_type in {"figure", "table"}:
        return True
    source_text = _filled_text(source_label)
    return bool(re.search(r"\b(?:fig(?:ure)?\.?|table|tab\.?)\s*[a-z]?\d+", source_text, flags=re.IGNORECASE))


def _looks_like_table_source(source_type: Optional[str], source_label: Optional[str]) -> bool:
    normalized_type = str(source_type or "").strip().lower()
    source_text = _filled_text(source_label).lower()
    return normalized_type == "table" or bool(re.search(r"\b(?:table|tab\.)\s*[a-z]?\d+", source_text))


def _expand_table_anchor_bbox(pdf_path: str, page_num: Optional[int], bbox: Optional[list[float]]) -> Optional[list[float]]:
    if not pdf_path or not page_num or not bbox or len(bbox) != 4:
        return bbox
    try:
        with fitz.open(pdf_path) as doc:
            page = doc[int(page_num) - 1]
            x0, y0, x1, y1 = [float(value) for value in bbox]
            return [
                max(0.0, x0 - 12.0),
                max(0.0, y0 - 12.0),
                min(float(page.rect.width), x1 + 24.0),
                min(float(page.rect.height), y1 + 150.0),
            ]
    except Exception:
        return bbox


def _field_location_match_is_reliable(field_key: str, value: Any, evidence: dict[str, Any]) -> bool:
    matched_text = _filled_text(evidence.get("matched_text"))
    quote = _filled_text(evidence.get("quote"))
    if field_key in {"surface_roughness", "probe_roughness", "substrate_roughness"}:
        combined = " ".join(part for part in [matched_text, quote] if part).lower()
        if not re.search(r"\b(?:nm|μm|um|rms|roughness|root[- ]mean[- ]square)\b", combined):
            return False
        if not re.search(r"\b(?:rms|roughness|root[- ]mean[- ]square)\b", combined):
            return False
    if _text_explicitly_matches_field_value(field_key, value, matched_text):
        return True
    if _text_explicitly_matches_field_value(field_key, value, quote):
        return True

    combined = " ".join(part for part in [matched_text, quote] if part).lower()
    value_text = _filled_text(value).strip().lower()
    source_is_precise = _source_label_has_precise_region(evidence.get("source_type"), evidence.get("source_label"))
    if field_key == "temperature" and source_is_precise and value_text in {"298 k", "298k", "293 k", "293k"}:
        return any(token in combined for token in ("room temperature", "room-temperature", "ambient temperature"))
    if field_key == "potential" and source_is_precise and re.search(r"\bocp\b|open circuit potential", value_text, flags=re.IGNORECASE):
        return "ocp" in combined or "open circuit potential" in combined
    return False


def _select_best_field_hit(
    hits: list[dict[str, Any]],
    *,
    page_hint: Optional[int],
    anchor_bbox: Optional[list[float]],
) -> Optional[dict[str, Any]]:
    valid_hits = [
        hit for hit in hits
        if float(hit.get("w") or 0) > 0 and float(hit.get("h") or 0) > 0
    ]
    if not valid_hits:
        return None

    def _score(hit: dict[str, Any]) -> tuple[float, float, float, float]:
        page = int(hit.get("page") or page_hint or 1)
        x0 = float(hit.get("x") or 0)
        y0 = float(hit.get("y") or 0)
        w = float(hit.get("w") or 0)
        h = float(hit.get("h") or 0)
        bbox = [x0, y0, x0 + w, y0 + h]
        page_distance = abs(page - page_hint) if page_hint else 0
        intersects_anchor = 0 if _bbox_intersects(anchor_bbox, bbox) else 1
        anchor_distance = _bbox_center_distance(anchor_bbox, bbox)
        area = max(w, 0.0) * max(h, 0.0)
        return (page_distance, intersects_anchor, anchor_distance, area)

    return min(valid_hits, key=_score)


def _locate_field_evidence_for_value(
    *,
    file_path: Optional[str],
    field_key: str,
    field_value: Any,
    source_label: Optional[str],
    page_hint: Optional[int],
    anchor_bbox: Optional[list[float]],
    source_type: Optional[str],
) -> Optional[dict[str, Any]]:
    from utils.pdf_coords import find_figure_bbox, find_text_coordinates, normalize_source_label

    pdf_path = _resolve_existing_path(file_path)
    if not pdf_path:
        return None

    value_text = _filled_text(field_value)
    if not value_text:
        return None

    normalized_source = normalize_source_label(source_label) or _filled_text(source_label) or None
    resolved_page_hint = int(page_hint) if page_hint else None
    resolved_anchor_bbox = _parse_json_bbox(anchor_bbox)
    effective_source_type = str(source_type or _infer_source_type(normalized_source)).strip().lower()
    if resolved_anchor_bbox and not _source_label_has_precise_region(effective_source_type, normalized_source):
        resolved_anchor_bbox = None

    if normalized_source and not resolved_anchor_bbox and _source_label_has_precise_region(effective_source_type, normalized_source):
        try:
            fig_page, fig_bbox = find_figure_bbox(
                pdf_path,
                normalized_source,
                page_hint=resolved_page_hint,
                restrict_to_page_hint=bool(
                    resolved_page_hint
                    and _is_visual_source_type(effective_source_type, normalized_source)
                ),
            )
            if fig_page and fig_bbox:
                if not resolved_page_hint:
                    resolved_page_hint = int(fig_page)
                resolved_anchor_bbox = [float(value) for value in fig_bbox]
                if _looks_like_table_source(effective_source_type, normalized_source):
                    resolved_anchor_bbox = _expand_table_anchor_bbox(pdf_path, resolved_page_hint, resolved_anchor_bbox)
        except Exception:
            pass

    if _looks_like_table_source(effective_source_type, normalized_source) and resolved_page_hint:
        table_located: Optional[dict[str, Any]] = None
        if field_key == "potential":
            table_located = _locate_table_potential_header_by_value(
                pdf_path=pdf_path,
                page_num=resolved_page_hint,
                potential_value=field_value,
                anchor_bbox=resolved_anchor_bbox,
            )
        elif field_key == "cof":
            table_located = _locate_table_numeric_value(
                pdf_path=pdf_path,
                page_num=resolved_page_hint,
                field_value=field_value,
                anchor_bbox=resolved_anchor_bbox,
            )
        if table_located:
            located = {
                "source_type": effective_source_type or "table",
                "source_label": normalized_source,
                **table_located,
            }
            if _field_location_match_is_reliable(field_key, value_text, located):
                return located

    queries = _field_query_variants(field_key, value_text)
    if not queries:
        return None

    def _find_hit(*, use_source_context: bool, use_anchor_bbox: bool = True) -> tuple[Optional[dict[str, Any]], bool, bool]:
        has_source_context = bool(resolved_page_hint or resolved_anchor_bbox)
        if use_source_context and not has_source_context:
            return None, False, False
        if not use_source_context and not _field_allows_global_context_fallback(field_key, value_text):
            return None, False, False

        search_page_hint = resolved_page_hint if use_source_context else None
        search_anchor_bbox = resolved_anchor_bbox if use_source_context and use_anchor_bbox else None
        hits = find_text_coordinates(
            pdf_path,
            [{
                "id": field_key,
                "queries": queries,
                "semantic_type": _field_semantic_type(field_key),
                "page_hint": search_page_hint,
                "restrict_to_page_hint": bool(search_page_hint),
                "max_page_distance": 0 if search_page_hint else None,
                "anchor_bbox": search_anchor_bbox,
                "restrict_to_anchor_bbox": bool(search_anchor_bbox),
            }],
        )
        return (
            _select_best_field_hit(hits, page_hint=search_page_hint, anchor_bbox=search_anchor_bbox),
            not use_source_context,
            bool(search_anchor_bbox),
        )

    hit: Optional[dict[str, Any]] = None
    used_global_fallback = False
    enforced_anchor_bbox = False
    discarded_anchor_hit = False
    if field_key == "load":
        hit, used_global_fallback, enforced_anchor_bbox = _find_hit(use_source_context=False)
    if not hit:
        hit, used_global_fallback, enforced_anchor_bbox = _find_hit(use_source_context=True)
        if hit and enforced_anchor_bbox and resolved_anchor_bbox:
            candidate_bbox = [
                float(hit.get("x") or 0),
                float(hit.get("y") or 0),
                float(hit.get("x") or 0) + float(hit.get("w") or 0),
                float(hit.get("y") or 0) + float(hit.get("h") or 0),
            ]
            if not _bbox_intersects(resolved_anchor_bbox, candidate_bbox):
                hit = None
                discarded_anchor_hit = True
    if not hit and resolved_anchor_bbox:
        hit, used_global_fallback, enforced_anchor_bbox = _find_hit(use_source_context=True, use_anchor_bbox=False)
        if hit and discarded_anchor_hit:
            used_global_fallback = True
    if not hit:
        hit, used_global_fallback, enforced_anchor_bbox = _find_hit(use_source_context=False)
    if not hit:
        return None

    page = int(hit.get("page") or resolved_page_hint or 1)
    x0 = float(hit.get("x") or 0)
    y0 = float(hit.get("y") or 0)
    w = float(hit.get("w") or 0)
    h = float(hit.get("h") or 0)
    bbox = [x0, y0, x0 + w, y0 + h]
    matched_text = _filled_text(hit.get("matched_text")) or value_text
    quote = _extract_field_quote_from_bbox(pdf_path, page, bbox, fallback_term=matched_text)
    resolved_source_type = effective_source_type or _infer_source_type(normalized_source)
    resolved_source_label = normalized_source
    if used_global_fallback:
        resolved_source_type = "text"
        resolved_source_label = "Text"
    if not used_global_fallback and resolved_page_hint and page != resolved_page_hint:
        return None
    if not used_global_fallback and enforced_anchor_bbox and resolved_anchor_bbox and not _bbox_intersects(resolved_anchor_bbox, bbox):
        return None

    located = {
        "source_type": resolved_source_type,
        "page": page,
        "source_label": resolved_source_label,
        "quote": quote,
        "bbox": bbox,
        "matched_text": matched_text,
    }
    if not _field_location_match_is_reliable(field_key, value_text, located):
        return None
    return located


def _evidence_has_location(evidence: Any) -> bool:
    if not isinstance(evidence, dict):
        return False
    bbox = evidence.get("bbox")
    return bool(evidence.get("page") and isinstance(bbox, list) and len(bbox) >= 4)


def _locate_source_anchor_evidence(
    *,
    file_path: Optional[str],
    source_label: Optional[str],
    page_hint: Optional[int],
    source_type: Optional[str],
) -> Optional[dict[str, Any]]:
    from utils.pdf_coords import find_figure_bbox, find_text_coordinates, normalize_source_label

    pdf_path = _resolve_existing_path(file_path)
    if not pdf_path:
        return None

    normalized_source = normalize_source_label(source_label) or _filled_text(source_label)
    resolved_page_hint = int(page_hint) if page_hint else 0
    effective_source_type = str(source_type or _infer_source_type(normalized_source)).strip().lower()

    if not normalized_source and not resolved_page_hint:
        return None

    cache_key = (pdf_path, normalized_source, resolved_page_hint, effective_source_type)
    if cache_key in _SOURCE_ANCHOR_CACHE:
        cached = _SOURCE_ANCHOR_CACHE[cache_key]
        if not cached:
            return None
        return {
            **cached,
            "bbox": list(cached.get("bbox") or []),
        }

    def _remember(value: Optional[dict[str, Any]]) -> Optional[dict[str, Any]]:
        _SOURCE_ANCHOR_CACHE[cache_key] = value
        if not value:
            return None
        return {
            **value,
            "bbox": list(value.get("bbox") or []),
        }

    if normalized_source:
        try:
            anchor_page, anchor_bbox = find_figure_bbox(
                pdf_path,
                normalized_source,
                page_hint=resolved_page_hint or None,
                restrict_to_page_hint=bool(
                    resolved_page_hint
                    and _is_visual_source_type(effective_source_type, normalized_source)
                ),
            )
            if anchor_page and anchor_bbox:
                bbox = [float(value) for value in anchor_bbox]
                quote = _extract_field_quote_from_bbox(
                    pdf_path,
                    int(anchor_page),
                    bbox,
                    fallback_term=normalized_source,
                )
                return _remember({
                    "source_type": effective_source_type or _infer_source_type(normalized_source),
                    "page": int(anchor_page),
                    "source_label": normalized_source,
                    "quote": quote or normalized_source,
                    "bbox": bbox,
                    "matched_text": normalized_source,
                })
        except Exception:
            pass

        source_words = normalized_source.split()
        source_queries = [
            normalized_source,
            " ".join(source_words[:14]),
            normalized_source[:120],
        ]
        source_queries = [
            query.strip()
            for query in dict.fromkeys(source_queries)
            if len(query.strip()) >= 6
        ]
        try:
            hits = find_text_coordinates(
                pdf_path,
                [{
                    "id": "source_anchor",
                    "queries": source_queries,
                    "semantic_type": "source",
                    "page_hint": resolved_page_hint or None,
                    "max_page_distance": 0 if resolved_page_hint else None,
                    "restrict_to_page_hint": bool(resolved_page_hint),
                }],
            )
            hit = _select_best_field_hit(hits, page_hint=resolved_page_hint or None, anchor_bbox=None)
            if hit:
                page = int(hit.get("page") or resolved_page_hint or 1)
                x0 = float(hit.get("x") or 0)
                y0 = float(hit.get("y") or 0)
                w = float(hit.get("w") or 0)
                h = float(hit.get("h") or 0)
                bbox = [x0, y0, x0 + w, y0 + h]
                matched_text = _filled_text(hit.get("matched_text")) or normalized_source
                quote = _extract_field_quote_from_bbox(pdf_path, page, bbox, fallback_term=matched_text)
                return _remember({
                    "source_type": effective_source_type or "text",
                    "page": page,
                    "source_label": normalized_source,
                    "quote": quote or matched_text,
                    "bbox": bbox,
                    "matched_text": matched_text,
                })
        except Exception:
            pass

    return _remember(None)


def _field_evidence_map_looks_generic(field_evidence_map: dict[str, Any]) -> bool:
    signatures: dict[tuple[Any, ...], int] = {}
    located_entry_count = 0
    for key, entry in (field_evidence_map or {}).items():
        if key == "source_page" or not isinstance(entry, dict) or not _filled_text(entry.get("value")):
            continue
        evidence = entry.get("evidence") or {}
        bbox = evidence.get("bbox")
        if not evidence.get("page") or not (isinstance(bbox, list) and len(bbox) >= 4):
            continue
        located_entry_count += 1
        signature = (
            evidence.get("page"),
            _filled_text(evidence.get("source_label")),
            tuple(round(float(v), 2) for v in bbox[:4]),
            _filled_text(evidence.get("quote"))[:160],
        )
        signatures[signature] = signatures.get(signature, 0) + 1
    if not signatures or located_entry_count < 3:
        return False
    dominant_count = max(signatures.values())
    return dominant_count >= 3 and (dominant_count / located_entry_count) >= 0.75


def _merge_field_review_metadata(
    field_evidence_map: dict[str, Any],
    existing_field_evidence_map: Optional[dict[str, Any]],
) -> dict[str, Any]:
    if not field_evidence_map or not isinstance(existing_field_evidence_map, dict):
        return field_evidence_map

    for key, entry in field_evidence_map.items():
        if not isinstance(entry, dict):
            continue
        previous_entry = existing_field_evidence_map.get(key)
        if not isinstance(previous_entry, dict):
            continue
        for metadata_key in ("review_state", "review_note"):
            metadata_value = previous_entry.get(metadata_key)
            if metadata_value not in (None, ""):
                entry[metadata_key] = metadata_value
    return field_evidence_map


def _build_field_evidence_map(item: dict, db_record: TribologyData, *, confidence: float, file_path: Optional[str] = None) -> dict[str, Any]:
    if not _filled_text(item.get("temperature")):
        item = {**item, "temperature": DEFAULT_TEMPERATURE_VALUE}
    provided_field_evidence = _parse_json_object(item.get("field_evidence_json")) or _parse_json_object(item.get("field_evidence"))
    provided_field_keys = {
        key
        for key, entry in provided_field_evidence.items()
        if isinstance(entry, dict) and (
            isinstance(entry.get("evidence"), dict)
            or _filled_text(entry.get("grounding_mode"))
            or _filled_text(entry.get("review_state"))
        )
    }
    source_label = getattr(db_record, "source", None) or getattr(db_record, "source_figure", None) or item.get("source")
    source_page = getattr(db_record, "source_page", None) or item.get("source_page")
    evidence_page = getattr(db_record, "evidence_page", None)
    quote = _filled_text(item.get("evidence")) or _filled_text(item.get("notes")) or None
    sample_id = _filled_text(item.get("sample_id")) or None
    raw_bbox = _parse_json_bbox(getattr(db_record, "evidence_bbox", None))
    source_type = _infer_source_type(source_label) if any([source_label, source_page, evidence_page, quote, raw_bbox, sample_id]) else None
    page = evidence_page or source_page
    resolved_file_path = _resolve_existing_path(file_path)
    has_resolved_file = bool(resolved_file_path)
    bbox = None if has_resolved_file and _is_visual_source_type(source_type, source_label) else raw_bbox
    speed_conditions = _speed_conditions_for_field_evidence(item, db_record)
    if not _is_derived_speed_conditions(speed_conditions):
        speed_context = _field_evidence_text_context(provided_field_evidence, "speed")
        if speed_context:
            speed_conditions = _speed_conditions_for_field_evidence(
                {**item, "evidence": speed_context, "notes": None, "source": None, "source_figure": None},
                db_record,
            )
    if _is_derived_speed_conditions(speed_conditions) and resolved_file_path and _derived_speed_conditions_need_source_context(speed_conditions):
        pdf_speed_conditions = _derive_speed_conditions_from_pdf_scan_context(
            resolved_file_path,
            item.get("speed") or item.get("speed_value"),
        )
        if _is_derived_speed_conditions(pdf_speed_conditions):
            speed_conditions = pdf_speed_conditions
    if not _is_derived_speed_conditions(speed_conditions) and resolved_file_path:
        pdf_speed_conditions = _derive_speed_conditions_from_pdf_scan_context(
            resolved_file_path,
            item.get("speed") or item.get("speed_value"),
        )
        if _is_derived_speed_conditions(pdf_speed_conditions):
            speed_conditions = pdf_speed_conditions
    speed_is_derived = _is_derived_speed_conditions(speed_conditions)
    derived_speed_value = speed_value_from_conditions(speed_conditions) if speed_is_derived else None
    if derived_speed_value:
        item = {**item, "speed": derived_speed_value, "speed_value": derived_speed_value}

    entries = {
        "material": _build_field_evidence_entry(
            value=item.get("material_name"),
            confidence=confidence,
            source_type=source_type,
            page=page,
            source_label=source_label,
            quote=quote,
            bbox=bbox,
            sample_id=sample_id,
        ),
        "ionic_liquid": _build_field_evidence_entry(
            value=item.get("ionic_liquid", item.get("lubricant")),
            confidence=confidence,
            source_type=source_type,
            page=page,
            source_label=source_label,
            quote=quote,
            bbox=bbox,
            sample_id=sample_id,
        ),
        "cof": _build_field_evidence_entry(
            value=item.get("cof"),
            confidence=confidence,
            source_type=source_type,
            page=page,
            source_label=source_label,
            quote=quote,
            bbox=bbox,
            sample_id=sample_id,
        ),
        "friction_force": _build_field_evidence_entry(
            value=item.get("friction_force"),
            confidence=confidence,
            source_type=source_type,
            page=page,
            source_label=source_label,
            quote=quote,
            bbox=bbox,
            sample_id=sample_id,
        ),
        "wear_rate": _build_field_evidence_entry(
            value=item.get("wear_rate"),
            confidence=confidence,
            source_type=source_type,
            page=page,
            source_label=source_label,
            quote=quote,
            bbox=bbox,
            sample_id=sample_id,
        ),
        "film_thickness": _build_field_evidence_entry(
            value=item.get("film_thickness"),
            confidence=confidence,
            source_type=source_type,
            page=page,
            source_label=source_label,
            quote=quote,
            bbox=bbox,
            sample_id=sample_id,
        ),
        "residual_film_thickness_d": _build_field_evidence_entry(
            value=item.get("residual_film_thickness_d"),
            confidence=confidence,
            source_type=source_type,
            page=page,
            source_label=source_label,
            quote=quote,
            bbox=bbox,
            sample_id=sample_id,
        ),
        "layer_spacing_delta": _build_field_evidence_entry(
            value=item.get("layer_spacing_delta"),
            confidence=confidence,
            source_type=source_type,
            page=page,
            source_label=source_label,
            quote=quote,
            bbox=bbox,
            sample_id=sample_id,
        ),
        "regime": _build_field_evidence_entry(
            value=item.get("regime"),
            confidence=confidence,
            source_type=source_type,
            page=page,
            source_label=source_label,
            quote=quote,
            bbox=bbox,
            sample_id=sample_id,
        ),
        "surface_roughness": _build_field_evidence_entry(
            value=item.get("surface_roughness"),
            confidence=confidence,
            source_type=source_type,
            page=page,
            source_label=source_label,
            quote=quote,
            bbox=bbox,
            sample_id=sample_id,
        ),
        "probe_roughness": _build_field_evidence_entry(
            value=item.get("probe_roughness"),
            confidence=confidence,
            source_type=source_type,
            page=page,
            source_label=source_label,
            quote=quote,
            bbox=bbox,
            sample_id=sample_id,
        ),
        "substrate_roughness": _build_field_evidence_entry(
            value=item.get("substrate_roughness"),
            confidence=confidence,
            source_type=source_type,
            page=page,
            source_label=source_label,
            quote=quote,
            bbox=bbox,
            sample_id=sample_id,
        ),
        "load": _build_field_evidence_entry(
            value=item.get("load") or item.get("normal_load"),
            confidence=confidence,
            source_type=source_type,
            page=page,
            source_label=source_label,
            quote=quote,
            bbox=bbox,
            sample_id=sample_id,
        ),
        "speed": _build_field_evidence_entry(
            value=item.get("speed"),
            confidence=confidence,
            source_type=source_type,
            page=page,
            source_label=source_label,
            quote=quote,
            bbox=bbox,
            sample_id=sample_id,
        ),
        "shear_rate": _build_field_evidence_entry(
            value=item.get("shear_rate"),
            confidence=confidence,
            source_type=source_type,
            page=page,
            source_label=source_label,
            quote=quote,
            bbox=bbox,
            sample_id=sample_id,
        ),
        "temperature": _build_field_evidence_entry(
            value=item.get("temperature"),
            confidence=confidence,
            source_type=source_type,
            page=page,
            source_label=source_label,
            quote=quote,
            bbox=bbox,
            sample_id=sample_id,
        ),
        "water_content": _build_field_evidence_entry(
            value=item.get("water_content"),
            confidence=confidence,
            source_type=source_type,
            page=page,
            source_label=source_label,
            quote=quote,
            bbox=bbox,
            sample_id=sample_id,
        ),
        "potential": _build_field_evidence_entry(
            value=item.get("potential"),
            confidence=confidence,
            source_type=source_type,
            page=page,
            source_label=source_label,
            quote=quote,
            bbox=bbox,
            sample_id=sample_id,
        ),
        "source_page": _build_field_evidence_entry(
            value=f"Page {page}" if page else None,
            confidence=confidence,
            source_type=source_type,
            page=page,
            source_label=source_label,
            quote=quote,
            bbox=bbox,
            sample_id=sample_id,
        ),
    }

    for field_key, entry in list(entries.items()):
        if field_key == "source_page" or not isinstance(entry, dict):
            continue
        if field_key in provided_field_keys:
            continue
        evidence = entry.get("evidence") or {}
        if _is_visual_source_type(evidence.get("source_type"), evidence.get("source_label")) and _evidence_has_location(evidence):
            evidence["matched_text"] = None
            entry.setdefault("grounding_mode", "source_anchor")
            entry.setdefault(
                "grounding_note",
                "Value is anchored to the source figure; exact numeric text may be read from the image rather than selectable PDF text.",
            )
        else:
            evidence["bbox"] = None
            evidence["matched_text"] = None
        entry["evidence"] = evidence
        entries[field_key] = entry

    for field_key in provided_field_keys:
        override = provided_field_evidence.get(field_key)
        if not isinstance(override, dict):
            continue
        base = entries.get(field_key) if isinstance(entries.get(field_key), dict) else {}
        merged = {**base, **override}
        if not _filled_text(merged.get("value")) and _filled_text(base.get("value")):
            merged["value"] = base.get("value")
        if "confidence" not in merged and "confidence" in base:
            merged["confidence"] = base.get("confidence")
        entries[field_key] = merged

    if resolved_file_path:
        for field_key, entry in list(entries.items()):
            if field_key == "source_page" or not entry:
                continue
            if field_key in provided_field_keys:
                continue
            if field_key == "temperature" and _is_default_temperature_value(entry.get("value")):
                continue
            field_value = _field_value_for_evidence(item, field_key)
            locate_page = page
            locate_source_label = source_label
            locate_source_type = source_type
            if field_key == "speed" and speed_is_derived:
                field_value = _derived_speed_locator_text(speed_conditions) or field_value
                locate_page = speed_conditions.get("source_page") or locate_page
                locate_source_label = speed_conditions.get("source_label") or locate_source_label
                locate_source_type = "text"
            located = _locate_field_evidence_for_value(
                file_path=resolved_file_path,
                field_key=field_key,
                field_value=field_value,
                source_label=locate_source_label,
                page_hint=int(locate_page) if locate_page else None,
                anchor_bbox=bbox,
                source_type=locate_source_type,
            )
            if located:
                entry["evidence"] = {
                    **(entry.get("evidence") or {}),
                    **located,
                    "sample_id": sample_id,
                }
                if entry.get("grounding_mode") == "source_anchor":
                    entry.pop("grounding_mode", None)
                    entry.pop("grounding_note", None)
            elif _is_visual_source_type(source_type, source_label):
                source_anchor = _locate_source_anchor_evidence(
                    file_path=resolved_file_path,
                    source_label=source_label,
                    page_hint=int(page) if page else None,
                    source_type=source_type,
                )
                if source_anchor:
                    entry["evidence"] = {
                        **(entry.get("evidence") or {}),
                        **source_anchor,
                        "sample_id": sample_id,
                    }
                    entry["grounding_mode"] = "source_anchor"
                    entry["grounding_note"] = (
                        "Value is anchored to the source figure; exact numeric text may be read from the image rather than selectable PDF text."
                    )
            entries[field_key] = entry

    if "potential" not in provided_field_keys:
        entries = _refine_potential_evidence_from_metric_context_with_pdf(entries, resolved_file_path)

    for field_key, entry in list(entries.items()):
        if field_key == "source_page" or not isinstance(entry, dict) or not _filled_text(entry.get("value")):
            continue
        if field_key == "temperature" and _is_default_temperature_value(entry.get("value")):
            evidence = entry.get("evidence") or {}
            if not _evidence_has_location(evidence):
                entries[field_key] = _temperature_default_evidence_entry(entry.get("value"), confidence)
                continue
        grounding_mode, grounding_note = _derive_grounding_metadata(
            field_key,
            entry.get("value"),
            entry.get("evidence") or {},
        )
        if grounding_mode:
            entry["grounding_mode"] = grounding_mode
        elif not _filled_text(entry.get("grounding_mode")):
            entry.pop("grounding_mode", None)
        if grounding_note:
            entry["grounding_note"] = grounding_note
        elif not _filled_text(entry.get("grounding_note")):
            entry.pop("grounding_note", None)
        if field_key == "speed" and speed_is_derived:
            if derived_speed_value:
                entry["value"] = derived_speed_value
            entry["grounding_mode"] = "derived"
            note = _derived_speed_grounding_note(speed_conditions)
            if note:
                entry["grounding_note"] = note
            evidence = entry.get("evidence") if isinstance(entry.get("evidence"), dict) else {}
            raw_text = _derived_speed_locator_text(speed_conditions)
            if raw_text and not _derived_speed_evidence_is_contextual(evidence):
                evidence["quote"] = raw_text
            if raw_text and not _derived_speed_evidence_is_contextual({"matched_text": evidence.get("matched_text")}):
                evidence["matched_text"] = raw_text
                evidence["bbox"] = None
            entry["evidence"] = evidence
        if field_key in {"surface_roughness", "probe_roughness", "substrate_roughness"}:
            evidence = entry.get("evidence") if isinstance(entry.get("evidence"), dict) else {}
            if evidence and not _field_location_match_is_reliable(field_key, entry.get("value"), evidence):
                cleaned_evidence = dict(evidence)
                cleaned_evidence["bbox"] = None
                cleaned_evidence["matched_text"] = None
                cleaned_evidence["quote"] = None
                entry["evidence"] = cleaned_evidence
                entry["grounding_note"] = (
                    "Stored evidence text does not include roughness/unit context; location needs re-extraction."
                )

    return {key: value for key, value in entries.items() if value}


def _field_entry_has_evidence(entry: Optional[dict[str, Any]]) -> bool:
    return field_grounding_status(entry or {}) == "grounded"


def _resolve_review_status(field_evidence_map: dict[str, Any]) -> tuple[str, Optional[str]]:
    missing = [
        key
        for key in _resolve_required_field_keys(field_evidence_map)
        if not _field_entry_has_evidence(field_evidence_map.get(key))
    ]
    if missing:
        return "needs_evidence", f"Missing field evidence for: {', '.join(missing)}"
    return "pending_review", None


def _computed_surface_roughness_label_for_record(record: Any, field_evidence_map: Optional[dict[str, Any]] = None) -> Optional[str]:
    field_map = field_evidence_map or {}
    surface_entry = field_map.get("surface_roughness") if isinstance(field_map, dict) else None
    if isinstance(surface_entry, dict) and _filled_text(surface_entry.get("value")):
        return _filled_text(surface_entry.get("value"))

    return composite_roughness_label(
        getattr(record, "probe_roughness", None),
        getattr(record, "substrate_roughness", None),
        method="rms",
        legacy_surface_roughness=getattr(record, "surface_roughness", None),
    )


def _looks_like_bare_numeric_evidence(text: Any) -> bool:
    value = str(text or "").strip()
    return bool(value and re.fullmatch(r"[-+]?\d+(?:\.\d+)?", value))


def _roughness_contextual_numeric_match(value: Any, quote: Any) -> Optional[str]:
    value_text = _filled_text(value)
    quote_text = _filled_text(quote)
    number_match = re.search(r"[-+]?\d+(?:\.\d+)?", value_text)
    if not number_match or not quote_text:
        return None
    number = number_match.group(0)
    escaped = re.escape(number).replace(r"\.", r"[.]")
    contextual = re.search(
        rf"\b(?:(?:rms|roughness|root[- ]mean[- ]square)\s*)?{escaped}\s*(?:nm|μm|um)\b",
        quote_text,
        flags=re.IGNORECASE,
    )
    return contextual.group(0).strip() if contextual else None


def _response_field_has_bare_numeric_roughness_evidence(field_key: str, entry: dict[str, Any]) -> bool:
    if field_key not in {"surface_roughness", "probe_roughness", "substrate_roughness"}:
        return False
    evidence = entry.get("evidence") if isinstance(entry.get("evidence"), dict) else {}
    quote = evidence.get("quote")
    matched_text = evidence.get("matched_text") or evidence.get("matchedText")
    if not (_looks_like_bare_numeric_evidence(quote) or _looks_like_bare_numeric_evidence(matched_text)):
        return False
    combined = " ".join(str(part or "") for part in (quote, matched_text)).lower()
    return not re.search(r"\b(?:nm|μm|um|rms|roughness|root[- ]mean[- ]square)\b", combined)


def _relocate_response_roughness_evidence(
    field_key: str,
    entry: dict[str, Any],
    *,
    pdf_path: Optional[str],
) -> Optional[dict[str, Any]]:
    if not pdf_path or not _response_field_has_bare_numeric_roughness_evidence(field_key, entry):
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
    contextual_match = _roughness_contextual_numeric_match(entry.get("value"), merged_evidence.get("quote"))
    if contextual_match:
        merged_evidence["matched_text"] = contextual_match
        merged_evidence["bbox"] = None
    repaired = dict(entry or {})
    repaired["evidence"] = merged_evidence
    existing_note = _filled_text(repaired.get("grounding_note"))
    if "roughness/unit context" in existing_note:
        repaired.pop("grounding_note", None)
    return repaired


def _repair_response_roughness_evidence(
    field_key: str,
    entry: dict[str, Any],
    *,
    pdf_path: Optional[str] = None,
) -> dict[str, Any]:
    if field_key not in {"surface_roughness", "probe_roughness", "substrate_roughness"}:
        return entry
    evidence = dict(entry.get("evidence") or {})
    if not evidence:
        return entry
    if _field_location_match_is_reliable(field_key, entry.get("value"), evidence):
        if _looks_like_bare_numeric_evidence(evidence.get("matched_text") or evidence.get("matchedText")):
            contextual_match = _roughness_contextual_numeric_match(entry.get("value"), evidence.get("quote"))
            if contextual_match:
                repaired = dict(entry or {})
                repaired["evidence"] = {
                    **evidence,
                    "matched_text": contextual_match,
                    "bbox": None,
                }
                return repaired
        return entry
    if not _response_field_has_bare_numeric_roughness_evidence(field_key, entry):
        return entry
    relocated = _relocate_response_roughness_evidence(field_key, entry, pdf_path=pdf_path)
    if relocated:
        return relocated

    repaired = dict(entry or {})
    repaired["evidence"] = {
        **evidence,
        "quote": None,
        "matched_text": None,
        "bbox": None,
    }
    repaired["grounding_note"] = (
        _filled_text(repaired.get("grounding_note"))
        or "Stored evidence text does not include roughness/unit context; location needs re-extraction."
    )
    return repaired


def _response_speed_conditions_for_record(
    record: Any,
    field_evidence_map: dict[str, Any],
    *,
    pdf_path: Optional[str] = None,
) -> dict[str, Any]:
    speed_conditions = normalize_speed_conditions(getattr(record, "speed_conditions_json", None))
    if speed_conditions:
        if _is_derived_speed_conditions(speed_conditions) and pdf_path and _derived_speed_conditions_need_source_context(speed_conditions):
            pdf_speed_conditions = _derive_speed_conditions_from_pdf_scan_context(
                pdf_path,
                getattr(record, "speed_value", None),
            )
            if _is_derived_speed_conditions(pdf_speed_conditions):
                return pdf_speed_conditions
        return speed_conditions

    speed_context_item = {
        "speed": getattr(record, "speed_value", None),
        "speed_value": getattr(record, "speed_value", None),
        "evidence": getattr(record, "evidence", None),
        "source": getattr(record, "source", None),
        "source_figure": getattr(record, "source_figure", None),
    }
    speed_conditions = _speed_conditions_for_field_evidence(speed_context_item, record)
    if _is_derived_speed_conditions(speed_conditions):
        return speed_conditions
    speed_context = _field_evidence_text_context(field_evidence_map, "speed")
    if speed_context:
        speed_conditions = _speed_conditions_for_field_evidence(
            {
                "speed": getattr(record, "speed_value", None),
                "speed_value": getattr(record, "speed_value", None),
                "evidence": speed_context,
                "source": None,
                "source_figure": None,
            },
            record,
        )
        if _is_derived_speed_conditions(speed_conditions):
            return speed_conditions
    if pdf_path:
        pdf_speed_conditions = _derive_speed_conditions_from_pdf_scan_context(
            pdf_path,
            getattr(record, "speed_value", None),
        )
        if _is_derived_speed_conditions(pdf_speed_conditions):
            return pdf_speed_conditions
    return speed_conditions


def _apply_derived_speed_response_evidence(
    entry: dict[str, Any],
    speed_conditions: dict[str, Any],
) -> dict[str, Any]:
    updated = dict(entry or {})
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
        evidence["quote"] = _filled_text(evidence.get("quote")) or raw_text
        matched_text = _filled_text(evidence.get("matched_text") or evidence.get("matchedText"))
        if not _derived_speed_evidence_is_contextual({"matched_text": matched_text}):
            matched_text = raw_text
            evidence["bbox"] = None
        evidence["matched_text"] = matched_text
    updated["evidence"] = evidence
    updated["grounding_mode"] = "derived"
    grounding_note = _derived_speed_grounding_note(speed_conditions)
    if grounding_note:
        updated["grounding_note"] = grounding_note
    derived_value = speed_value_from_conditions(speed_conditions)
    if derived_value:
        updated["value"] = derived_value
    return updated


def _repair_response_field_evidence_map(
    record: Any,
    field_evidence_map: dict[str, Any],
    *,
    pdf_path: Optional[str] = None,
) -> tuple[dict[str, Any], dict[str, Any]]:
    repaired_map = {
        key: dict(value)
        for key, value in (field_evidence_map or {}).items()
        if isinstance(value, dict)
    }
    if pdf_path is None:
        pdf_path = getattr(getattr(record, "literature", None), "file_path", None)
    speed_conditions = _response_speed_conditions_for_record(record, repaired_map, pdf_path=pdf_path)
    if _is_derived_speed_conditions(speed_conditions):
        speed_entry = repaired_map.get("speed") if isinstance(repaired_map.get("speed"), dict) else {}
        repaired_map["speed"] = _apply_derived_speed_response_evidence(speed_entry, speed_conditions)

    for roughness_key in ("surface_roughness", "probe_roughness", "substrate_roughness"):
        entry = repaired_map.get(roughness_key)
        if isinstance(entry, dict):
            repaired_map[roughness_key] = _repair_response_roughness_evidence(
                roughness_key,
                entry,
                pdf_path=pdf_path,
            )

    return repaired_map, speed_conditions


def _record_to_response_item(record: Any) -> dict[str, Any]:
    cof_str = record.cof_raw if record.cof_raw else (str(record.cof_value) if record.cof_value else None)
    review_entity_type = "candidate" if isinstance(record, RecordCandidate) else "record"
    field_evidence_map = _parse_json_object(record.field_evidence_json)
    field_evidence_map, speed_conditions = _repair_response_field_evidence_map(
        record,
        field_evidence_map,
        pdf_path=getattr(getattr(record, "literature", None), "file_path", None),
    )
    derived_speed_value = speed_value_from_conditions(speed_conditions) if _is_derived_speed_conditions(speed_conditions) else None
    surface_roughness = _computed_surface_roughness_label_for_record(record, field_evidence_map)
    lubricant_components = components_for_record(record)
    lubricant_alias = getattr(record, "lubricant_alias", None)
    cof_extracted = normalize_cof_extracted(getattr(record, "cof_extracted_json", None)) or derive_cof_extracted(
        cof_str,
        getattr(record, "cof_value", None),
        load=getattr(record, "load_raw", None) or getattr(record, "load_value", None),
        speed=getattr(record, "speed_value", None),
    )
    load_conditions = normalize_load_conditions(getattr(record, "load_conditions_json", None)) or derive_load_conditions(
        getattr(record, "load_raw", None) or getattr(record, "load_value", None),
    )
    tribological_system = normalize_tribological_system(getattr(record, "tribological_system_json", None)) or derive_tribological_system(
        getattr(record, "regime", None),
    )
    experiment_profile = build_experiment_profile(
        {
            "tribological_system": tribological_system,
            "cof": cof_str,
            "load": getattr(record, "load_raw", None) or getattr(record, "load_value", None),
            "speed": derived_speed_value or getattr(record, "speed_value", None),
            "friction_force": getattr(record, "friction_force", None),
            "wear_rate": getattr(record, "wear_rate", None),
            "probe_geometry": getattr(record, "probe_geometry", None),
            "probe_radius": getattr(record, "probe_radius", None),
            "contact_type": getattr(record, "contact_type", None),
            "regime": getattr(record, "regime", None),
            "source": getattr(record, "source", None),
            "source_figure": getattr(record, "source_figure", None),
            "evidence": getattr(record, "evidence", None),
        }
    )
    if tribological_system:
        tribological_system = {**tribological_system, **experiment_profile}
    payload = {
        "id": str(record.id),
        "material_name": record.material_name,
        "lubricant": record.lubricant,
        "ionic_liquid": record.lubricant,
        "lubricant_components": lubricant_components,
        "lubricant_alias": lubricant_alias,
        "ionic_liquid_display": compact_lubricant_label(record.lubricant, lubricant_components, lubricant_alias),
        "lubricant_tooltip": format_lubricant_tooltip(record.lubricant, lubricant_components, lubricant_alias),
        "cof": cof_str,
        "cof_value": record.cof_value,
        "cof_operator": record.cof_operator,
        "cof_raw": record.cof_raw,
        "cof_extracted": cof_extracted,
        "load": record.load_raw or record.load_value,
        "load_value": record.load_value,
        "load_raw": record.load_raw,
        "load_conditions": load_conditions,
        "speed": derived_speed_value or record.speed_value,
        "speed_value": derived_speed_value or record.speed_value,
        "speed_conditions": speed_conditions,
        "shear_rate": getattr(record, "shear_rate", None),
        "temperature": record.temperature,
        "potential": record.potential,
        "water_content": record.water_content,
        "probe_material": record.probe_material,
        "probe_geometry": record.probe_geometry,
        "probe_radius": record.probe_radius,
        "probe_roughness": record.probe_roughness,
        "substrate_material": record.substrate_material,
        "substrate_coating": record.substrate_coating,
        "substrate_roughness": record.substrate_roughness,
        "surface_roughness": surface_roughness,
        "film_thickness": record.film_thickness,
        "residual_film_thickness_d": record.residual_film_thickness_d,
        "layer_spacing_delta": record.layer_spacing_delta,
        "regime": getattr(record, "regime", None),
        "tribological_system": tribological_system,
        "experiment_profile": experiment_profile,
        "experiment_scale": experiment_profile["scale"],
        "experiment_method": experiment_profile["method"],
        "measurement_type": experiment_profile["measurement_type"],
        "training_view": experiment_profile["training_view"],
        "mol_ratio": record.mol_ratio,
        "cation": record.cation,
        "anion": record.anion,
        "cation_smiles": record.cation_smiles,
        "anion_smiles": record.anion_smiles,
        "il_smiles": record.il_smiles,
        "il_inchikey": record.il_inchikey,
        "alkyl_chain_length": record.alkyl_chain_length,
        "confidence": record.confidence,
        "evidence": record.evidence,
        "source": record.source,
        "source_page": record.source_page,
        "source_figure": record.source_figure,
        "sample_id": record.sample_id,
        "series_id": record.series_id,
        "field_evidence_json": field_evidence_map,
        "review_status": record.review_status,
        "record_origin": record.record_origin,
        "review_entity_type": review_entity_type,
        "assembly_notes": record.assembly_notes,
    }
    is_weak_candidate = str(record.record_origin or "").strip().lower() == "weak_candidate"
    model_confidence = getattr(record, "confidence", None)
    if is_weak_candidate:
        try:
            model_confidence = min(float(model_confidence or 0.52), 0.52)
        except (TypeError, ValueError):
            model_confidence = 0.52

    confidence_details = calculate_confidence_details(
        {
            **payload,
            "field_evidence_json": field_evidence_map,
            "model_confidence": model_confidence,
        }
    )
    computed_confidence = float(confidence_details.get("score") or 0.0)
    if is_weak_candidate:
        capped_confidence = min(computed_confidence, 0.52)
        confidence_details = {
            **confidence_details,
            "score": capped_confidence,
            "percent": round(capped_confidence * 100.0, 1),
            "band": "low",
        }
        payload["confidence"] = capped_confidence
    else:
        payload["confidence"] = computed_confidence
    payload["confidence_details"] = confidence_details
    if is_weak_candidate:
        payload.update(
            {
                "confidence_tier": "low",
                "admission_reason": "weak_candidate",
                "review_status": "needs_review",
                "review_entity_type": "candidate",
            }
        )
    return annotate_tribology_payload_quality(payload)


async def _count_cached_record_artifacts(db: AsyncSession, literature_id: int) -> tuple[int, int]:
    candidate_count = (
        await db.execute(select(func.count(RecordCandidate.id)).where(RecordCandidate.literature_id == literature_id))
    ).scalar() or 0
    final_count = (
        await db.execute(select(func.count(TribologyData.id)).where(TribologyData.literature_id == literature_id))
    ).scalar() or 0
    return int(candidate_count), int(final_count)


def _has_stable_doi(value: Any) -> bool:
    doi = _filled_text(value)
    return bool(doi and not doi.lower().startswith("temp-"))


async def _load_reusable_tribology_rows(
    db: AsyncSession,
    source_literature_id: int,
) -> tuple[list[TribologyData | RecordCandidate], str]:
    final_rows = list(
        (
            await db.execute(
                select(TribologyData)
                .where(TribologyData.literature_id == source_literature_id)
                .order_by(TribologyData.id.asc())
            )
        ).scalars().all()
    )
    if final_rows:
        return final_rows, "tribology_data"

    candidate_rows = list(
        (
            await db.execute(
                select(RecordCandidate)
                .where(
                    RecordCandidate.literature_id == source_literature_id,
                    RecordCandidate.promoted_record_id.is_(None),
                )
                .order_by(RecordCandidate.id.asc())
            )
        ).scalars().all()
    )
    reusable_candidates = [
        row
        for row in candidate_rows
        if str(row.review_status or "").strip().lower() not in REJECTED_REVIEW_STATUSES
    ]
    return reusable_candidates, "record_candidates"


async def _find_matching_tribology_cache_source(
    db: AsyncSession,
    literature: Literature,
) -> tuple[Literature, int, int] | None:
    group_id = getattr(literature, "group_id", None)
    if not group_id:
        return None

    matches_by_id: dict[int, Literature] = {}
    if _has_stable_doi(getattr(literature, "doi", None)):
        doi_matches = list(
            (
                await db.execute(
                    select(Literature).where(
                        Literature.group_id == group_id,
                        Literature.id != literature.id,
                        Literature.doi == literature.doi,
                    )
                )
            ).scalars().all()
        )
        matches_by_id.update({item.id: item for item in doi_matches})

    file_hash = _filled_text(getattr(literature, "file_hash", None))
    if file_hash:
        hash_matches = list(
            (
                await db.execute(
                    select(Literature).where(
                        Literature.group_id == group_id,
                        Literature.id != literature.id,
                        Literature.file_hash == file_hash,
                    )
                )
            ).scalars().all()
        )
        matches_by_id.update({item.id: item for item in hash_matches})

    reusable: list[tuple[Literature, int, int]] = []
    for candidate in matches_by_id.values():
        candidate_count, final_count = await _count_cached_record_artifacts(db, candidate.id)
        if candidate_count or final_count:
            reusable.append((candidate, candidate_count, final_count))

    if not reusable:
        return None

    return max(
        reusable,
        key=lambda item: (
            item[2],
            item[1],
            _literature_cache_priority(item[0]),
        ),
    )


def _clone_tribology_row_to_candidate(
    source: TribologyData | RecordCandidate,
    *,
    target_literature_id: int,
    source_literature: Literature,
) -> RecordCandidate:
    skip = {"id", "literature_id", "promoted_record_id", "promoted_at"}
    target_columns = {column.name for column in RecordCandidate.__table__.columns}
    data = {
        column.name: getattr(source, column.name)
        for column in source.__table__.columns
        if column.name in target_columns and column.name not in skip
    }
    existing_note = _filled_text(data.get("assembly_notes"))
    source_note = (
        f"Copied from canonical extraction literature #{source_literature.id} "
        f"({source_literature.scope_key or source_literature.scope_type or 'unknown scope'})."
    )
    data.update(
        {
            "literature_id": target_literature_id,
            "promoted_record_id": None,
            "review_status": "pending_review",
            "record_origin": "canonical_cache",
            "assembly_notes": "; ".join(part for part in (existing_note, source_note) if part),
        }
    )
    return RecordCandidate(**data)


_MISSING_PROBE_VALUES = {
    "",
    "-",
    "--",
    "n/a",
    "na",
    "none",
    "null",
    "unknown",
    "unknown material",
    "probe n/a",
    "not specified",
}


_FAST_TABLE_RECORD_ORIGINS = {"gemini_flash_table", "fast_table_extraction"}


def _is_fast_table_record_origin(value: Any) -> bool:
    return _filled_text(value) in _FAST_TABLE_RECORD_ORIGINS


def _probe_value_is_missing(value: Any) -> bool:
    return str(value or "").strip().lower() in _MISSING_PROBE_VALUES


def _backfill_cached_record_tribopair(
    record: Any,
    item: dict[str, Any],
    *,
    document_context: dict[str, Any],
    page_context: str,
) -> bool:
    enriched = apply_experimental_document_context(item, document_context)
    enriched = normalize_extraction_row(
        enriched,
        getattr(record, "source_page", None),
        page_context=page_context,
    )
    changed = False
    for item_key, column_name in (
        ("probe_material", "probe_material"),
        ("probe_geometry", "probe_geometry"),
        ("probe_radius", "probe_radius"),
        ("probe_roughness", "probe_roughness"),
        ("substrate_material", "substrate_material"),
        ("substrate_coating", "substrate_coating"),
        ("substrate_roughness", "substrate_roughness"),
        ("material_name", "material_name"),
    ):
        value = enriched.get(item_key)
        if not _filled_text(value):
            continue
        current = getattr(record, column_name, None)
        if column_name == "probe_material":
            should_update = _probe_value_is_missing(current)
        elif column_name == "probe_geometry":
            value_l = str(value or "").strip().lower()
            probe_l = str(enriched.get("probe_material") or "").strip().lower()
            should_update = (
                (not _filled_text(current) and (value_l != "surface pair" or probe_l == "mica"))
                or (
                    str(current or "").strip().lower() == "colloid probe"
                    and value_l == "tip"
                    and probe_l == "silicon nitride"
                )
                or (
                    str(current or "").strip().lower() == "colloid probe"
                    and value_l == "surface pair"
                    and probe_l == "mica"
                )
            )
        else:
            should_update = not _filled_text(current)
        if should_update:
            setattr(record, column_name, value)
            item[item_key] = value
            changed = True
    return changed


async def _copy_matching_tribology_cache_records(
    db: AsyncSession,
    literature: Literature,
) -> dict[str, Any] | None:
    existing_candidate_count, existing_final_count = await _count_cached_record_artifacts(db, literature.id)
    if existing_candidate_count or existing_final_count:
        return None

    source_match = await _find_matching_tribology_cache_source(db, literature)
    if not source_match:
        return None

    source_literature, _, _ = source_match
    rows, source_table = await _load_reusable_tribology_rows(db, source_literature.id)
    if not rows:
        return None

    clones = [
        _clone_tribology_row_to_candidate(
            row,
            target_literature_id=literature.id,
            source_literature=source_literature,
        )
        for row in rows
    ]
    db.add_all(clones)
    literature.status = "completed"
    literature.error_message = None
    await db.flush()
    logger.info(
        "Copied %s cached tribology record(s) from literature_id=%s to literature_id=%s",
        len(clones),
        source_literature.id,
        literature.id,
    )
    return {
        "source_literature_id": source_literature.id,
        "source_scope_key": source_literature.scope_key,
        "source_table": source_table,
        "copied_count": len(clones),
    }


def _is_no_data_message(value: Optional[str]) -> bool:
    return is_generic_no_data_message(value)


def _parse_summary_json(raw: Optional[str]) -> dict[str, Any]:
    if not raw:
        return {}
    try:
        loaded = json.loads(raw)
        return loaded if isinstance(loaded, dict) else {}
    except Exception:
        return {}


async def _normalize_legacy_no_data_state(
    db: AsyncSession,
    literature: Literature,
    *,
    candidate_count: Optional[int] = None,
    final_count: Optional[int] = None,
) -> bool:
    if candidate_count is None or final_count is None:
        candidate_count, final_count = await _count_cached_record_artifacts(db, literature.id)

    if candidate_count or final_count:
        return False

    latest_run = (
        await db.execute(
            select(ExtractionRun)
            .where(ExtractionRun.literature_id == literature.id)
            .order_by(ExtractionRun.id.desc())
            .limit(1)
        )
    ).scalar_one_or_none()

    summary = _parse_summary_json(latest_run.summary_json) if latest_run else {}
    run_status = str(latest_run.status or "").strip().lower() if latest_run else ""
    run_final_count = int((latest_run.final_count if latest_run else 0) or summary.get("final_count") or 0)
    summary_message = str(summary.get("current_message") or "").strip()
    run_last_touch = (latest_run.updated_at or latest_run.created_at) if latest_run else None
    run_is_stale = bool(
        latest_run
        and run_status == "running"
        and run_last_touch
        and (datetime.utcnow() - run_last_touch) > timedelta(minutes=5)
    )

    legacy_no_data = False
    if str(literature.status or "").strip().lower() == "no_data":
        legacy_no_data = True
    elif _is_no_data_message(literature.error_message):
        legacy_no_data = True
    elif latest_run and run_status == "no_data":
        legacy_no_data = True
    elif latest_run and run_status == "completed" and run_final_count == 0:
        legacy_no_data = True
    elif latest_run and _is_no_data_message(latest_run.error_message):
        legacy_no_data = True
    elif latest_run and _is_no_data_message(summary_message):
        legacy_no_data = True

    if not legacy_no_data:
        return False

    no_data_message = build_no_data_reason(
        literature=literature,
        content=getattr(literature, "content", None),
        summary=summary,
        fallback=getattr(literature, "error_message", None)
        or (getattr(latest_run, "error_message", None) if latest_run else None)
        or summary_message,
    )
    literature.status = "no_data"
    literature.error_message = no_data_message

    if latest_run and (
        run_status != "running"
        or run_is_stale
        or str(literature.status or "").strip().lower() == "no_data"
    ):
        latest_run.status = "no_data"
        latest_run.final_count = 0
        latest_run.error_message = no_data_message
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
        summary["final_count"] = 0
        summary["current_stage"] = "stage_e.finalize"
        summary["current_message"] = no_data_message
        summary["no_data_reason"] = no_data_message
        summary["progress_log"] = progress_log
        latest_run.summary_json = json.dumps(summary, ensure_ascii=False)

    return True


def _build_db_record_from_item(
    *,
    literature_id: int,
    item: dict,
    file_path: Optional[str],
    record_origin: str,
    model_cls: type[TribologyData] | type[RecordCandidate] = TribologyData,
) -> tuple[Any, dict[str, Any]]:
    _annotate_record_identity(item)
    confidence = _resolve_confidence(item.get("confidence"), item)
    lubricant = item.get("ionic_liquid", item.get("lubricant", ""))
    lubricant_components = normalize_lubricant_components(
        item.get("lubricant_components")
        or item.get("lubricantComponents")
        or item.get("Lubricant_Mixture")
        or item.get("components")
    )
    if not lubricant_components:
        lubricant_components = parse_lubricant_components(
            lubricant,
            item.get("mol_ratio") or item.get("molRatio"),
            item.get("cation"),
            item.get("anion"),
        )
    lubricant_alias = (
        item.get("lubricant_alias")
        or item.get("lubricantAlias")
        or item.get("mixture_alias")
        or item.get("mixtureAlias")
    )
    if not lubricant_alias:
        lubricant_alias = (resolve_ionic_liquid_alias(lubricant) or {}).get("alias")
    cof_extracted = normalize_cof_extracted(item.get("cof_extracted") or item.get("cofExtracted"))
    if not cof_extracted:
        cof_extracted = derive_cof_extracted(
            item.get("cof"),
            _parse_cof_value(item.get("cof")),
            load=item.get("load") or item.get("normal_load"),
            speed=item.get("speed"),
        )
    load_text = item.get("load") or item.get("normal_load")
    load_conditions = normalize_load_conditions(item.get("load_conditions") or item.get("loadConditions")) or derive_load_conditions(load_text)
    resolved_record_origin = _filled_text(item.get("record_origin")) or record_origin
    is_fast_table_record = _is_fast_table_record_origin(resolved_record_origin)
    speed_conditions = {} if is_fast_table_record else normalize_speed_conditions(item.get("speed_conditions") or item.get("speedConditions"))
    if not speed_conditions:
        if is_fast_table_record:
            speed_conditions = {}
        else:
            speed_context = " ".join(
                str(part or "")
                for part in (item.get("evidence"), item.get("notes"), item.get("source"), item.get("source_figure"))
                if part not in (None, "")
            )
            speed_conditions = derive_speed_conditions(item.get("speed"), context=speed_context)
    if is_fast_table_record:
        speed_value = item.get("speed") or item.get("speed_value")
    else:
        speed_value = speed_value_from_conditions(speed_conditions) or item.get("speed")
    if speed_conditions.get("scan_rate_hz") is not None and speed_conditions.get("sliding_velocity_um_s") is None:
        speed_value = None
    tribological_system = normalize_tribological_system(item.get("tribological_system") or item.get("tribologicalSystem")) or derive_tribological_system(item.get("regime"))
    experiment_profile = build_experiment_profile({**item, "tribological_system": tribological_system})
    tribological_system = {**tribological_system, **experiment_profile} if tribological_system else experiment_profile
    db_record = model_cls(
        literature_id=literature_id,
        material_name=item.get("material_name", "Unknown"),
        lubricant=lubricant,
        lubricant_components_json=serialize_lubricant_components(lubricant_components),
        lubricant_alias=str(lubricant_alias).strip() if lubricant_alias else None,
        cof_value=_parse_cof_value(item.get("cof")),
        cof_operator=item.get("cof_operator"),
        cof_raw=item.get("cof"),
        cof_extracted_json=serialize_cof_extracted(cof_extracted),
        load_value=load_text,
        load_raw=load_text,
        load_conditions_json=serialize_load_conditions(load_conditions),
        speed_value=speed_value,
        speed_conditions_json=serialize_speed_conditions(speed_conditions),
        shear_rate=item.get("shear_rate"),
        temperature=item.get("temperature"),
        potential=item.get("potential"),
        water_content=item.get("water_content"),
        probe_material=item.get("probe_material"),
        probe_geometry=item.get("probe_geometry"),
        probe_radius=item.get("probe_radius"),
        probe_roughness=item.get("probe_roughness"),
        substrate_material=item.get("substrate_material"),
        substrate_coating=item.get("substrate_coating"),
        substrate_roughness=item.get("substrate_roughness"),
        surface_roughness=item.get("surface_roughness"),
        film_thickness=item.get("film_thickness"),
        residual_film_thickness_d=item.get("residual_film_thickness_d"),
        layer_spacing_delta=item.get("layer_spacing_delta"),
        regime=item.get("regime"),
        tribological_system_json=serialize_tribological_system(tribological_system),
        mol_ratio=item.get("mol_ratio"),
        cation=item.get("cation"),
        anion=item.get("anion"),
        cation_smiles=item.get("cation_smiles"),
        anion_smiles=item.get("anion_smiles"),
        il_smiles=item.get("il_smiles"),
        il_inchikey=item.get("il_inchikey"),
        alkyl_chain_length=item.get("alkyl_chain_length"),
        confidence=confidence,
        evidence=item.get("evidence"),
        source=item.get("source"),
        source_page=item.get("source_page"),
        source_figure=item.get("source_figure"),
        sample_id=item.get("sample_id"),
        series_id=item.get("series_id"),
        record_origin=resolved_record_origin,
    )
    if resolved_record_origin != "weak_candidate" and not is_fast_table_record:
        _try_resolve_evidence_coords(db_record, item, file_path)
    evidence_lookup_file_path = None if is_fast_table_record else file_path
    field_evidence_map = _build_field_evidence_map(item, db_record, confidence=confidence, file_path=evidence_lookup_file_path)
    review_status, assembly_notes = _resolve_review_status(field_evidence_map)
    requested_review_status = _filled_text(item.get("review_status")).lower()
    if is_fast_table_record or requested_review_status in {"needs_review", "pending_review"}:
        review_status = "needs_review"
    item_assembly_notes = _filled_text(item.get("assembly_notes"))
    if item_assembly_notes:
        assembly_notes = "; ".join(part for part in (assembly_notes, item_assembly_notes) if part)
    confidence_details = calculate_confidence_details(
        {
            **item,
            "field_evidence_json": field_evidence_map,
            "review_status": review_status,
            "model_confidence": item.get("confidence"),
        }
    )
    confidence = float(confidence_details.get("score") or confidence)
    db_record.confidence = confidence
    db_record.field_evidence_json = _safe_json_dumps(field_evidence_map)
    db_record.review_status = review_status
    db_record.assembly_notes = assembly_notes

    response_item = dict(item)
    response_item.update(
        {
            "sample_id": db_record.sample_id,
            "series_id": db_record.series_id,
            "lubricant_components": lubricant_components,
            "lubricant_alias": db_record.lubricant_alias,
            "ionic_liquid_display": compact_lubricant_label(lubricant, lubricant_components, db_record.lubricant_alias),
            "lubricant_tooltip": format_lubricant_tooltip(lubricant, lubricant_components, db_record.lubricant_alias),
            "cof_extracted": cof_extracted,
            "load_conditions": load_conditions,
            "tribological_system": tribological_system,
            "experiment_profile": experiment_profile,
            "experiment_scale": experiment_profile["scale"],
            "experiment_method": experiment_profile["method"],
            "measurement_type": experiment_profile["measurement_type"],
            "training_view": experiment_profile["training_view"],
            "field_evidence_json": field_evidence_map,
            "review_status": review_status,
            "record_origin": resolved_record_origin,
            "assembly_notes": assembly_notes,
            "confidence": confidence,
            "confidence_details": confidence_details,
        }
    )
    response_item = annotate_tribology_payload_quality(response_item)
    return db_record, response_item


async def _persist_weak_candidates_for_review(
    db: AsyncSession,
    *,
    literature: Literature,
    trace_candidates: list[dict[str, Any]],
    file_path: Optional[str],
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    weak_items, weak_summary = build_weak_candidate_items(trace_candidates)
    if not weak_items:
        return [], weak_summary
    _apply_default_temperature(weak_items)
    _normalize_record_chemistry(weak_items)

    await db.execute(delete(RecordCandidate).where(RecordCandidate.literature_id == literature.id))
    await db.execute(delete(TribologyData).where(TribologyData.literature_id == literature.id))

    db_rows: list[RecordCandidate] = []
    response_rows: list[tuple[RecordCandidate, dict[str, Any]]] = []
    for item in weak_items:
        quality_notes = _filled_text(item.get("quality_notes"))
        db_record, response_item = _build_db_record_from_item(
            literature_id=literature.id,
            item={
                **item,
                "confidence": min(float(item.get("confidence") or 0.52), 0.52),
                "record_origin": "weak_candidate",
                "review_status": "needs_review",
                "assembly_notes": quality_notes or item.get("assembly_notes"),
            },
            file_path=None,
            record_origin="weak_candidate",
            model_cls=RecordCandidate,
        )
        db_record.review_status = "needs_review"
        db_record.record_origin = "weak_candidate"
        db_record.confidence = min(float(getattr(db_record, "confidence", 0.52) or 0.52), 0.52)
        db_record.assembly_notes = quality_notes or db_record.assembly_notes
        confidence_details = response_item.get("confidence_details")
        if isinstance(confidence_details, dict):
            confidence_details = {
                **confidence_details,
                "score": db_record.confidence,
                "percent": round(db_record.confidence * 100.0, 1),
                "band": "low",
            }
        else:
            confidence_details = {
                "score": db_record.confidence,
                "percent": round(db_record.confidence * 100.0, 1),
                "band": "low",
            }
        response_item.update(
            {
                "review_status": "needs_review",
                "record_origin": "weak_candidate",
                "review_entity_type": "candidate",
                "confidence": db_record.confidence,
                "confidence_details": confidence_details,
                "confidence_tier": item.get("confidence_tier") or "low",
                "admission_reason": item.get("admission_reason") or "weak_candidate",
                "missing_fields": item.get("missing_fields") or [],
                "quality_notes": quality_notes or item.get("quality_notes"),
                "assembly_notes": db_record.assembly_notes,
            }
        )
        db_rows.append(db_record)
        response_rows.append((db_record, response_item))

    db.add_all(db_rows)
    await db.flush()

    data: list[dict[str, Any]] = []
    for db_record, response_item in response_rows:
        response_item["id"] = str(db_record.id)
        data.append(response_item)

    literature.status = "completed"
    literature.error_message = None

    return data, {
        **weak_summary,
        "review_status": "needs_review",
        "candidate_count": len(data),
        "final_count": 0,
        "admission_reason": "weak_candidate",
    }


async def _finalize_weak_candidates_for_review(
    db: AsyncSession,
    *,
    literature: Literature,
    run_id: str,
    llm_summary: dict[str, Any],
    trace_candidates: list[dict[str, Any]],
    extra_candidates: Optional[list[dict[str, Any]]] = None,
    file_path: Optional[str],
    profile: str,
    dropped_by_reason: Optional[dict[str, Any]] = None,
) -> Optional[tuple[list[dict[str, Any]], dict[str, Any]]]:
    all_candidates = [*(trace_candidates or []), *((extra_candidates or []))]
    weak_rows, weak_summary = await _persist_weak_candidates_for_review(
        db,
        literature=literature,
        trace_candidates=all_candidates,
        file_path=file_path,
    )
    if not weak_rows:
        return None

    await add_extraction_candidates(
        db,
        run_id=run_id,
        candidates=all_candidates,
    )
    weak_count = len(weak_rows)
    candidate_count = max(
        int((llm_summary or {}).get("candidate_count") or 0),
        len(all_candidates),
    )
    weak_message = f"{weak_count} weak candidates need review."
    extraction_summary = {
        "run_id": run_id,
        "candidate_count": candidate_count,
        "final_count": 0,
        "weak_candidate_count": weak_count,
        "review_status": "needs_review",
        "status": "needs_review",
        "dropped_by_reason": dropped_by_reason if dropped_by_reason is not None else (llm_summary or {}).get("dropped_by_reason") or {},
        "page_coverage": (llm_summary or {}).get("page_coverage") or {},
        "page_candidate_counts": (llm_summary or {}).get("page_candidate_counts") or {},
        "progress_log": [
            *((llm_summary or {}).get("progress_log") or []),
            {
                "stage": "stage_e.weak_candidates",
                "message": weak_message,
            },
        ],
        "current_stage": "stage_e.weak_candidates",
        "current_message": weak_message,
        "admission_reason": weak_summary.get("admission_reason") or "weak_candidate",
        "profile": profile,
    }
    await finalize_extraction_run(
        db,
        run_id=run_id,
        status="completed",
        candidate_count=candidate_count,
        final_count=0,
        dropped_by_reason=extraction_summary["dropped_by_reason"],
        summary=extraction_summary,
        error_message=None,
    )
    return weak_rows, extraction_summary


async def _load_cached_extraction_result(
    db: AsyncSession,
    literature: Literature,
) -> tuple[dict, list[dict], dict]:
    stmt = select(RecordCandidate).where(RecordCandidate.literature_id == literature.id)
    result = await db.execute(stmt)
    db_records = list(result.scalars().all())
    if not db_records:
        fallback_stmt = select(TribologyData).where(TribologyData.literature_id == literature.id)
        fallback_result = await db.execute(fallback_stmt)
        db_records = list(fallback_result.scalars().all())

    data_list = []
    changed_db_rows = False
    literature_content = _load_literature_context_text(literature)
    if literature_content and not str(getattr(literature, "content", "") or "").strip():
        literature.content = literature_content
        changed_db_rows = True
    document_context = extract_experimental_document_context({0: literature_content}) if literature_content else {}
    for i, r in enumerate(db_records):
        cof_str = r.cof_raw if r.cof_raw else (str(r.cof_value) if r.cof_value else None)
        cached_item = {
            "material_name": r.material_name,
            "ionic_liquid": r.lubricant,
            "cof": cof_str,
            "load": r.load_raw or r.load_value,
            "load_conditions": normalize_load_conditions(getattr(r, "load_conditions_json", None)) or derive_load_conditions(r.load_raw or r.load_value),
            "speed": r.speed_value,
            "shear_rate": getattr(r, "shear_rate", None),
            "temperature": r.temperature,
            "potential": r.potential,
            "water_content": r.water_content,
            "friction_force": getattr(r, "friction_force", None),
            "wear_rate": getattr(r, "wear_rate", None),
            "film_thickness": getattr(r, "film_thickness", None),
            "residual_film_thickness_d": getattr(r, "residual_film_thickness_d", None),
            "layer_spacing_delta": getattr(r, "layer_spacing_delta", None),
            "regime": getattr(r, "regime", None),
            "tribological_system": normalize_tribological_system(getattr(r, "tribological_system_json", None)) or derive_tribological_system(getattr(r, "regime", None)),
            "surface_roughness": getattr(r, "surface_roughness", None),
            "probe_material": getattr(r, "probe_material", None),
            "probe_geometry": getattr(r, "probe_geometry", None),
            "probe_radius": getattr(r, "probe_radius", None),
            "probe_roughness": getattr(r, "probe_roughness", None),
            "substrate_material": getattr(r, "substrate_material", None),
            "substrate_coating": getattr(r, "substrate_coating", None),
            "substrate_roughness": getattr(r, "substrate_roughness", None),
            "evidence": r.evidence,
            "source": r.source,
            "source_page": r.source_page,
            "source_figure": r.source_figure,
            "sample_id": r.sample_id,
            "series_id": r.series_id,
        }
        if _backfill_cached_record_tribopair(
            r,
            cached_item,
            document_context=document_context,
            page_context=literature_content,
        ):
            changed_db_rows = True
        parsed_field_evidence = _parse_json_object(r.field_evidence_json)
        if not parsed_field_evidence or _field_evidence_map_looks_generic(parsed_field_evidence):
            # Cached extraction is often loaded on app entry. Avoid doing synchronous
            # PDF coordinate relocation here because PyMuPDF word extraction can hang
            # on some already-processed PDFs and block the whole API worker.
            evidence_file_path = literature.file_path if ENABLE_CACHED_PDF_EVIDENCE_RELOCATION else None
            parsed_field_evidence = _merge_field_review_metadata(
                _build_field_evidence_map(cached_item, r, confidence=r.confidence, file_path=evidence_file_path),
                parsed_field_evidence,
            )
            review_status, assembly_notes = _resolve_review_status(parsed_field_evidence)
            r.field_evidence_json = _safe_json_dumps(parsed_field_evidence)
            if not r.review_status:
                r.review_status = review_status
            if not r.record_origin:
                r.record_origin = "cached_record"
            if not r.assembly_notes and assembly_notes:
                r.assembly_notes = assembly_notes
            changed_db_rows = True
        response_item = _record_to_response_item(r)
        response_item["field_evidence_json"] = parsed_field_evidence
        data_list.append(response_item)

    _normalize_record_chemistry(data_list)
    for idx, row in enumerate(data_list):
        if not (0 <= idx < len(db_records)):
            continue
        db_row = db_records[idx]
        normalized_lubricant = row.get("ionic_liquid") or row.get("lubricant")
        normalized_film = row.get("film_thickness")
        if normalized_lubricant and db_row.lubricant != normalized_lubricant:
            db_row.lubricant = normalized_lubricant
            changed_db_rows = True
        if db_row.film_thickness != normalized_film:
            db_row.film_thickness = normalized_film
            changed_db_rows = True
        normalized_cof_extracted = serialize_cof_extracted(row.get("cof_extracted"))
        if getattr(db_row, "cof_extracted_json", None) != normalized_cof_extracted:
            db_row.cof_extracted_json = normalized_cof_extracted
            changed_db_rows = True
        normalized_load_conditions = serialize_load_conditions(row.get("load_conditions"))
        if getattr(db_row, "load_conditions_json", None) != normalized_load_conditions:
            db_row.load_conditions_json = normalized_load_conditions
            changed_db_rows = True
        normalized_tribological_system = serialize_tribological_system(row.get("tribological_system"))
        if getattr(db_row, "tribological_system_json", None) != normalized_tribological_system:
            db_row.tribological_system_json = normalized_tribological_system
            changed_db_rows = True
        normalized_components_json = serialize_lubricant_components(row.get("lubricant_components"))
        if getattr(db_row, "lubricant_components_json", None) != normalized_components_json:
            db_row.lubricant_components_json = normalized_components_json
            changed_db_rows = True
        row_confidence = row.get("confidence")
        if row_confidence is not None:
            try:
                row_confidence_value = float(row_confidence)
            except Exception:
                row_confidence_value = None
            if row_confidence_value is not None and abs(float(getattr(db_row, "confidence", 0.0) or 0.0) - row_confidence_value) > 0.0001:
                db_row.confidence = row_confidence_value
                changed_db_rows = True
        if row.get("lubricant_alias") and getattr(db_row, "lubricant_alias", None) != row.get("lubricant_alias"):
            db_row.lubricant_alias = row.get("lubricant_alias")
            changed_db_rows = True
        for field in ("cation", "anion", "cation_smiles", "anion_smiles", "il_smiles", "il_inchikey", "alkyl_chain_length"):
            if getattr(db_row, field) != row.get(field):
                setattr(db_row, field, row.get(field))
                changed_db_rows = True

    changed = _backfill_unknown_il_records(data_list, literature.file_path)
    if changed:
        for idx, il_name in changed.items():
            if 0 <= idx < len(db_records):
                db_records[idx].lubricant = il_name
        changed_db_rows = True

    if data_list and (str(literature.status or "").strip().lower() != "completed" or literature.error_message):
        literature.status = "completed"
        literature.error_message = None
        changed_db_rows = True

    if changed_db_rows:
        await db.commit()

    metadata = {
        "title": literature.title,
        "doi": literature.doi,
        "authors": literature.authors,
        "journal": literature.journal,
        "year": literature.year,
        "volume": literature.volume,
        "issue": literature.issue,
        "pages": literature.pages,
    }
    weak_candidate_count = sum(
        1
        for row in data_list
        if str(row.get("record_origin") or "").strip().lower() == "weak_candidate"
    )
    final_count = max(0, len(data_list) - weak_candidate_count)
    cache_summary = {
        "run_id": None,
        "candidate_count": len(data_list),
        "final_count": final_count,
        "weak_candidate_count": weak_candidate_count,
        "dropped_by_reason": {},
        "page_coverage": {},
        "page_candidate_counts": {},
        "progress_log": [],
    }
    if weak_candidate_count:
        cache_summary["review_status"] = "needs_review"
        cache_summary["status"] = "needs_review"
    return metadata, data_list, cache_summary


def _filled_text(value: object) -> str:
    return str(value or "").strip()


def _is_review_literature(literature: Literature, content: Optional[str] = None) -> bool:
    haystack = " ".join(
        _filled_text(part)
        for part in (
            getattr(literature, "title", None),
            getattr(literature, "journal", None),
            (content or getattr(literature, "content", None) or "")[:12000],
        )
        if _filled_text(part)
    ).lower()
    return bool(
        re.search(r"\breview\b|\breview article\b", haystack)
        or "view article online" in haystack and "copyright" in haystack and "review" in haystack
    )


def _canonical_lubricant_key(value: Any) -> str:
    text = _filled_text(value)
    if not text:
        return ""
    try:
        resolved = resolve_il(text)
        cation = _filled_text((resolved or {}).get("cation"))
        anion = _filled_text((resolved or {}).get("anion"))
        if cation and anion:
            return re.sub(r"[^a-z0-9]+", "", f"{cation}{anion}".lower())
    except Exception:
        pass
    return re.sub(r"[^a-z0-9]+", "", text.lower())


def _canonical_material_key(value: Any) -> str:
    text = _filled_text(value).lower()
    replacements = {
        "silica": "sio2",
        "silicon dioxide": "sio2",
        "gold": "au",
        "au111": "au111",
        "au(111)": "au111",
    }
    compact = re.sub(r"[^a-z0-9]+", "", text)
    return replacements.get(text, replacements.get(compact, compact))


def _record_metric_value(record_like: Any, metric_key: str) -> Any:
    if isinstance(record_like, dict):
        if metric_key == "cof":
            return record_like.get("cof") or record_like.get("cof_raw") or record_like.get("cof_value")
        return record_like.get(metric_key)
    if metric_key == "cof":
        return getattr(record_like, "cof_raw", None) or getattr(record_like, "cof_value", None)
    return getattr(record_like, metric_key, None)


def _numeric_values_close(a: Any, b: Any, *, relative_tolerance: float = 0.06) -> bool:
    av = _parse_cof_value(str(a)) if _filled_text(a) else None
    bv = _parse_cof_value(str(b)) if _filled_text(b) else None
    if av is None or bv is None:
        return False
    tolerance = max(1e-4, abs(av) * relative_tolerance)
    return abs(av - bv) <= tolerance


def _short_title(value: Any, limit: int = 96) -> str:
    text = re.sub(r"\s+", " ", _filled_text(value))
    if len(text) <= limit:
        return text
    return text[: limit - 1].rstrip() + "…"


def _row_to_review_match_payload(row: Any, literature: Literature, entity_type: str) -> dict[str, Any]:
    return {
        "entity_type": entity_type,
        "record_id": getattr(row, "id", None),
        "literature_id": getattr(row, "literature_id", None),
        "title": getattr(literature, "title", None),
        "doi": getattr(literature, "doi", None),
        "journal": getattr(literature, "journal", None),
        "year": getattr(literature, "year", None),
        "record_origin": getattr(row, "record_origin", None),
        "review_status": getattr(row, "review_status", None),
        "material_name": getattr(row, "material_name", None),
        "lubricant": getattr(row, "lubricant", None),
        "probe_material": getattr(row, "probe_material", None),
        "substrate_material": getattr(row, "substrate_material", None),
        "substrate_coating": getattr(row, "substrate_coating", None),
        "cof": getattr(row, "cof_raw", None) or getattr(row, "cof_value", None),
        "regime": getattr(row, "regime", None),
        "film_thickness": getattr(row, "film_thickness", None),
        "source_page": getattr(row, "source_page", None),
        "source_figure": getattr(row, "source_figure", None),
    }


def _review_canonical_match_score(item: dict[str, Any], candidate: dict[str, Any]) -> tuple[float, list[str]]:
    metric_key = _resolve_primary_metric_key(item)
    if not metric_key:
        return 0.0, []

    matched_fields: list[str] = []
    score = 0.0

    item_il = _canonical_lubricant_key(item.get("ionic_liquid") or item.get("lubricant"))
    candidate_il = _canonical_lubricant_key(candidate.get("lubricant"))
    if item_il and candidate_il and item_il == candidate_il:
        score += 0.34
        matched_fields.append("ionic_liquid")
    else:
        return 0.0, matched_fields

    if _numeric_values_close(_record_metric_value(item, metric_key), candidate.get(metric_key) or candidate.get("cof")):
        score += 0.34
        matched_fields.append(metric_key)
    else:
        return 0.0, matched_fields

    item_probe = _canonical_material_key(item.get("probe_material"))
    item_substrate = _canonical_material_key(item.get("substrate_material"))
    candidate_probe = _canonical_material_key(candidate.get("probe_material"))
    candidate_substrate = _canonical_material_key(candidate.get("substrate_material"))
    if item_probe and candidate_probe and item_probe == candidate_probe:
        score += 0.1
        matched_fields.append("probe_material")
    if item_substrate and candidate_substrate and item_substrate == candidate_substrate:
        score += 0.1
        matched_fields.append("substrate_material")

    item_regime = _filled_text(item.get("regime")).lower()
    candidate_regime = _filled_text(candidate.get("regime")).lower()
    if item_regime and candidate_regime:
        item_nums = set(re.findall(r"\d+(?:\.\d+)?", item_regime))
        candidate_nums = set(re.findall(r"\d+(?:\.\d+)?", candidate_regime))
        if item_nums & candidate_nums or item_regime in candidate_regime or candidate_regime in item_regime:
            score += 0.08
            matched_fields.append("regime")

    item_film = _filled_text(item.get("film_thickness"))
    candidate_film = _filled_text(candidate.get("film_thickness"))
    if item_film and candidate_film and _numeric_values_close(item_film, candidate_film, relative_tolerance=0.04):
        score += 0.04
        matched_fields.append("film_thickness")

    return min(score, 1.0), matched_fields


def _annotate_review_record_with_canonical_match(item: dict[str, Any], match: dict[str, Any], score: float, matched_fields: list[str]) -> None:
    source_title = _short_title(match.get("title"))
    source_label = source_title or f"Literature {match.get('literature_id')}"
    canonical_payload = {
        "kind": "review_secondary_source",
        "match_score": round(float(score), 3),
        "matched_fields": matched_fields,
        "canonical_record": {
            "entity_type": match.get("entity_type"),
            "record_id": match.get("record_id"),
            "literature_id": match.get("literature_id"),
            "title": match.get("title"),
            "doi": match.get("doi"),
            "journal": match.get("journal"),
            "year": match.get("year"),
            "cof": match.get("cof"),
            "source_page": match.get("source_page"),
            "source_figure": match.get("source_figure"),
        },
    }
    field_evidence = _parse_json_object(item.get("field_evidence_json")) or _parse_json_object(item.get("field_evidence"))
    field_evidence["_canonical_source"] = {
        "value": f"Linked to {source_label}",
        "confidence": score,
        "evidence": {
            "source_type": "canonical_record",
            "page": match.get("source_page"),
            "source_label": source_label,
            "quote": (
                "This review-derived row matches an existing extraction from the original/canonical literature. "
                "Use the canonical record for training or deduplicated knowledge exports."
            ),
            "bbox": None,
            "sample_id": None,
            "matched_text": None,
        },
        "grounding_mode": "secondary_source",
        "canonical": canonical_payload,
    }

    metric_key = _resolve_primary_metric_key(item)
    if metric_key and isinstance(field_evidence.get(metric_key), dict):
        field_evidence[metric_key]["canonical"] = canonical_payload
        note = _filled_text(field_evidence[metric_key].get("grounding_note"))
        link_note = f"Secondary review value linked to canonical literature #{match.get('literature_id')} record #{match.get('record_id')}."
        field_evidence[metric_key]["grounding_note"] = " ".join(part for part in (note, link_note) if part)

    item["field_evidence_json"] = field_evidence
    item["record_origin"] = "review_secondary"
    note = (
        f"Review-derived secondary record matched canonical literature #{match.get('literature_id')} "
        f"record #{match.get('record_id')} ({source_label})."
    )
    item["assembly_notes"] = "; ".join(part for part in (_filled_text(item.get("assembly_notes")), note) if part)


async def _annotate_review_secondary_records(
    db: AsyncSession,
    literature: Literature,
    records: list[dict],
    *,
    content: Optional[str] = None,
) -> dict[str, Any]:
    if not records or not _is_review_literature(literature, content):
        return {"review_detected": False, "linked_count": 0}

    candidate_rows: list[dict[str, Any]] = []
    for model_cls, entity_type in ((RecordCandidate, "candidate"), (TribologyData, "record")):
        stmt = select(model_cls, Literature).join(Literature, model_cls.literature_id == Literature.id).where(
            model_cls.literature_id != literature.id
        )
        if _filled_text(getattr(literature, "scope_type", None)) and _filled_text(getattr(literature, "scope_key", None)):
            stmt = stmt.where(
                Literature.scope_type == literature.scope_type,
                Literature.scope_key == literature.scope_key,
            )
        result = await db.execute(stmt)
        for row, source_literature in result.all():
            candidate_rows.append(_row_to_review_match_payload(row, source_literature, entity_type))

    linked_count = 0
    for item in records:
        if not isinstance(item, dict):
            continue
        best_match: Optional[dict[str, Any]] = None
        best_score = 0.0
        best_fields: list[str] = []
        for candidate in candidate_rows:
            score, fields = _review_canonical_match_score(item, candidate)
            if score > best_score:
                best_match = candidate
                best_score = score
                best_fields = fields
        if best_match and best_score >= 0.78 and {"ionic_liquid", _resolve_primary_metric_key(item) or ""}.issubset(set(best_fields)):
            _annotate_review_record_with_canonical_match(item, best_match, best_score, best_fields)
            linked_count += 1

    return {
        "review_detected": True,
        "linked_count": linked_count,
        "candidate_pool": len(candidate_rows),
    }


def _distinct_record_values(records: list[dict], field: str) -> set[str]:
    values: set[str] = set()
    for item in records or []:
        if not isinstance(item, dict):
            continue
        if field == "ionic_liquid":
            candidate = _filled_text(item.get("ionic_liquid") or item.get("lubricant"))
        else:
            candidate = _filled_text(item.get(field))
        if candidate:
            values.add(candidate.lower())
    return values


def _field_evidence_location_count(item: dict) -> int:
    field_evidence = _parse_json_object(item.get("field_evidence_json")) or _parse_json_object(item.get("field_evidence"))
    count = 0
    for entry in field_evidence.values():
        if not isinstance(entry, dict):
            continue
        evidence = entry.get("evidence") or {}
        bbox = evidence.get("bbox")
        if evidence.get("page") and isinstance(bbox, list) and len(bbox) >= 4:
            count += 1
    return count


def _record_quality_snapshot(records: list[dict]) -> dict[str, int]:
    probe_values = _distinct_record_values(records, "probe_material")
    substrate_values = _distinct_record_values(records, "substrate_material")
    ionic_values = _distinct_record_values(records, "ionic_liquid")
    return {
        "count": len(records or []),
        "probe_present": sum(1 for item in records or [] if _filled_text(item.get("probe_material"))),
        "substrate_present": sum(1 for item in records or [] if _filled_text(item.get("substrate_material"))),
        "ionic_present": sum(
            1 for item in records or [] if _filled_text(item.get("ionic_liquid") or item.get("lubricant"))
        ),
        "load_present": sum(
            1 for item in records or [] if _filled_text(item.get("load") or item.get("normal_load") or item.get("load_raw"))
        ),
        "speed_present": sum(1 for item in records or [] if _filled_text(item.get("speed") or item.get("speed_value"))),
        "shear_rate_present": sum(1 for item in records or [] if _filled_text(item.get("shear_rate"))),
        "field_evidence_locations": sum(
            _field_evidence_location_count(item) for item in records or [] if isinstance(item, dict)
        ),
        "probe_distinct": len(probe_values),
        "substrate_distinct": len(substrate_values),
        "ionic_distinct": len(ionic_values),
    }


def _should_audit_cached_records(records: list[dict]) -> bool:
    if not records:
        return False
    quality = _record_quality_snapshot(records)
    if quality["probe_present"] < quality["count"]:
        return True
    if quality["substrate_present"] < quality["count"]:
        return True
    if quality["count"] <= 4 and quality["ionic_distinct"] <= 1:
        return True
    return False


def _fallback_improves_cached_records(cached_records: list[dict], fallback_records: list[dict]) -> bool:
    if not fallback_records:
        return False

    cached = _record_quality_snapshot(cached_records)
    fallback = _record_quality_snapshot(fallback_records)
    return any(
        [
            fallback["count"] > cached["count"],
            fallback["probe_present"] > cached["probe_present"],
            fallback["substrate_present"] > cached["substrate_present"],
            fallback["ionic_present"] > cached["ionic_present"],
            fallback["load_present"] > cached["load_present"],
            fallback["speed_present"] > cached["speed_present"],
            fallback["shear_rate_present"] > cached["shear_rate_present"],
            fallback["field_evidence_locations"] > cached["field_evidence_locations"],
            fallback["probe_distinct"] > cached["probe_distinct"],
            fallback["substrate_distinct"] > cached["substrate_distinct"],
            fallback["ionic_distinct"] > cached["ionic_distinct"],
        ]
    )


def _should_replace_records_with_fallback(
    records: list[dict],
    fallback_records: list[dict],
    fallback_info: dict[str, Any],
) -> bool:
    if not fallback_records:
        return False
    if not records:
        return True
    if not _fallback_improves_cached_records(records, fallback_records):
        return False

    parser = str((fallback_info or {}).get("parser") or "").strip()
    if parser in {
        "atkin_graphite_superlubricity_figure2",
        "atkin_stiction_shear_thinning_figure3b",
        "ean_mica_lateral_force_text",
        "potential_dependent_gold_text",
        "probe_il_substrate_table",
    }:
        return True
    return len(fallback_records) >= len(records)


async def _replace_literature_records_from_items(
    db: AsyncSession,
    literature: Literature,
    records: list[dict],
    *,
    file_path: Optional[str],
) -> int:
    normalized_records = [dict(item) for item in (records or []) if isinstance(item, dict)]
    if not normalized_records:
        return 0

    _apply_default_temperature(normalized_records)
    _normalize_record_chemistry(normalized_records)
    normalized_records, _ = filter_to_supported_ionic_liquid_records(normalized_records)
    _annotate_records_with_identity(normalized_records)
    normalized_records, _, _ = _final_merge_records(normalized_records)
    await _annotate_review_secondary_records(
        db,
        literature,
        normalized_records,
        content=getattr(literature, "content", None),
    )

    new_records_db: list[RecordCandidate] = []
    for item in normalized_records:
        cof_raw = item.get("cof")
        cof_value = _parse_cof_value(cof_raw)
        if cof_value is None:
            continue

        drop_reason = _get_drop_reason_for_final_record(item)
        if drop_reason:
            continue

        db_record, _ = _build_db_record_from_item(
            literature_id=literature.id,
            item=item,
            file_path=file_path,
            record_origin="replacement_sync",
            model_cls=RecordCandidate,
        )
        new_records_db.append(db_record)

    if not new_records_db:
        return 0

    await db.execute(delete(RecordCandidate).where(RecordCandidate.literature_id == literature.id))
    await db.execute(delete(TribologyData).where(TribologyData.literature_id == literature.id))
    db.add_all(new_records_db)
    literature.status = "completed"
    literature.error_message = None
    _archive_completed_literature_pdf(literature, file_path)
    await db.commit()
    return len(new_records_db)


async def _refresh_cached_records_from_fallback(
    db: AsyncSession,
    literature: Literature,
    cached_records: list[dict],
    *,
    file_path: Optional[str],
    content: str,
) -> tuple[dict, list[dict], dict] | None:
    fallback_records, fallback_info = extract_table_fallback_records(content or "", file_path)
    if not _should_replace_records_with_fallback(cached_records, fallback_records, fallback_info):
        return None

    saved_count = await _replace_literature_records_from_items(
        db,
        literature,
        fallback_records,
        file_path=file_path,
    )
    if saved_count <= 0:
        return None

    logger.info(
        "Refreshed stale cached extraction for literature_id=%s using fallback parser=%s saved=%s",
        literature.id,
        fallback_info.get("parser"),
        saved_count,
    )
    metadata, data_list, cache_summary = await _load_cached_extraction_result(db, literature)
    cache_summary = {
        **cache_summary,
        "fallback_extraction": fallback_info,
        "cache_refreshed": True,
    }
    return metadata, data_list, cache_summary

async def save_upload_entry(
    db: AsyncSession,
    file: UploadFile,
    *,
    principal: AuthPrincipal,
    scope: RequestScope,
) -> Literature:
    """
    Save upload entry to DB.
    Non-destructive: If DOI exists with completed status, returns it.
    Uses DOI as unique identifier for deduplication.
    """
    try:
        logger.info("Saving upload entry filename=%s scope=%s", file.filename, scope.scope_key)
        scope_key = build_scope_key(scope.scope_type, scope.workspace.id if scope.workspace else None)
        # 1. Read file content
        read_started_at = time.perf_counter()
        content_bytes = await file.read()
        logger.info(
            "Upload body read filename=%s bytes=%s duration=%.2fs",
            file.filename,
            len(content_bytes or b""),
            time.perf_counter() - read_started_at,
        )
        await file.seek(0)
        file_hash = hashlib.sha256(content_bytes).hexdigest() if content_bytes else None
        is_pdf_upload = file.filename.lower().endswith('.pdf')
        if is_pdf_upload:
            validation_error = validate_pdf_bytes(content_bytes, file.filename)
            if validation_error:
                raise InvalidUploadError(validation_error)
        
        # 2. Extract Text & DOI Check
        text_content = ""
        if is_pdf_upload:
            text_started_at = time.perf_counter()
            text_content = extract_pdf_text_fitz(content_bytes)
            logger.info(
                "Upload PDF text extracted filename=%s chars=%s duration=%.2fs",
                file.filename,
                len(text_content or ""),
                time.perf_counter() - text_started_at,
            )
        else:
            text_content = content_bytes.decode('utf-8', errors='ignore')

        if file_hash:
            existing_hash_match = await _find_existing_by_file_hash(
                db,
                group_id=principal.group.id,
                scope_key=scope_key,
                file_hash=file_hash,
            )
            if existing_hash_match:
                await _normalize_legacy_no_data_state(db, existing_hash_match)
                logger.info(
                    "Upload file-hash cache hit file_hash=%s literature_id=%s status=%s",
                    file_hash,
                    existing_hash_match.id,
                    existing_hash_match.status,
                )
                if not can_manage_literature(principal, existing_hash_match):
                    return existing_hash_match
                existing_hash_match.content = text_content or existing_hash_match.content
                if not existing_hash_match.file_hash:
                    existing_hash_match.file_hash = file_hash
                if is_pdf_upload and (not existing_hash_match.file_path or not os.path.exists(existing_hash_match.file_path)):
                    pdf_dir = os.path.join(TEMP_UPLOAD_DIR, "pdfs")
                    os.makedirs(pdf_dir, exist_ok=True)
                    pdf_path = os.path.join(pdf_dir, f"{existing_hash_match.id}.pdf")
                    with open(pdf_path, 'wb') as f:
                        f.write(content_bytes)
                    existing_hash_match.file_path = pdf_path
                    logger.info("Backfilled PDF for literature_id=%s path=%s", existing_hash_match.id, pdf_path)
                await db.commit()
                return existing_hash_match
        doi_candidates: list[str] = []
        # --- DOI/title dedup guard ---
        try:
            doi_candidates = _extract_doi_candidates(text_content, file.filename)
            for normalized_doi in doi_candidates:
                logger.info("Upload extracted DOI candidate=%s", normalized_doi)
                existing_doi_match = (
                    await db.execute(
                        select(Literature).where(
                            Literature.group_id == principal.group.id,
                            Literature.scope_key == scope_key,
                            Literature.doi == normalized_doi,
                        )
                    )
                ).scalar_one_or_none()
                if not existing_doi_match:
                    continue
                await _normalize_legacy_no_data_state(db, existing_doi_match)
                logger.info(
                    "Upload DOI cache hit doi=%s literature_id=%s status=%s",
                    normalized_doi,
                    existing_doi_match.id,
                    existing_doi_match.status,
                )
                if not can_manage_literature(principal, existing_doi_match):
                    return existing_doi_match
                existing_doi_match.content = text_content or existing_doi_match.content
                if file_hash and not existing_doi_match.file_hash:
                    existing_doi_match.file_hash = file_hash
                if is_pdf_upload and (not existing_doi_match.file_path or not os.path.exists(existing_doi_match.file_path)):
                    pdf_dir = os.path.join(TEMP_UPLOAD_DIR, "pdfs")
                    os.makedirs(pdf_dir, exist_ok=True)
                    pdf_path = os.path.join(pdf_dir, f"{existing_doi_match.id}.pdf")
                    with open(pdf_path, 'wb') as f:
                        f.write(content_bytes)
                    existing_doi_match.file_path = pdf_path
                    logger.info("Backfilled PDF for literature_id=%s path=%s", existing_doi_match.id, pdf_path)
                if existing_doi_match.status == "failed":
                    existing_doi_match.status = "pending"
                    existing_doi_match.error_message = None
                await db.commit()
                return existing_doi_match
            fallback_match = await _find_existing_by_title_fallback(
                db,
                file.filename,
                group_id=principal.group.id,
                scope_key=scope_key,
            )
            if fallback_match:
                await _normalize_legacy_no_data_state(db, fallback_match)
                if not can_manage_literature(principal, fallback_match):
                    return fallback_match
                fallback_match.content = text_content or fallback_match.content
                if file_hash and not fallback_match.file_hash:
                    fallback_match.file_hash = file_hash
                if is_pdf_upload and (not fallback_match.file_path or not os.path.exists(fallback_match.file_path)):
                    pdf_dir = os.path.join(TEMP_UPLOAD_DIR, "pdfs")
                    os.makedirs(pdf_dir, exist_ok=True)
                    pdf_path = os.path.join(pdf_dir, f"{fallback_match.id}.pdf")
                    with open(pdf_path, 'wb') as f:
                        f.write(content_bytes)
                    fallback_match.file_path = pdf_path
                    logger.info("Backfilled PDF for literature_id=%s path=%s", fallback_match.id, pdf_path)
                if fallback_match.status == "failed":
                    fallback_match.status = "pending"
                    fallback_match.error_message = None
                await db.commit()
                return fallback_match
        except Exception as e:
            logger.warning("Upload DOI/title dedup check failed: %s", e)
        # ---------------------------------------------------


        # 3. Create new Literature entry
        upload_metadata = await _resolve_upload_metadata(text_content, file.filename, doi_candidates)
        # Generate a temporary DOI for files without DOI
        temp_doi = f"temp-{int(__import__('time').time() * 1000)}"
        
        new_lit = Literature(
            title=upload_metadata.get("title") or file.filename,
            doi=upload_metadata.get("doi") or temp_doi,
            authors=upload_metadata.get("authors") or "",
            journal=upload_metadata.get("journal") or "",
            year=upload_metadata.get("year") or 0,
            volume=upload_metadata.get("volume"),
            issue=upload_metadata.get("issue"),
            pages=upload_metadata.get("pages"),
            issn=upload_metadata.get("issn"),
            file_path=None, 
            file_hash=file_hash,
            content=text_content,
            status="pending",
            group_id=principal.group.id,
            workspace_id=scope.workspace.id if scope.workspace else None,
            created_by_user_id=principal.user.id,
            scope_type=scope.scope_type,
            scope_key=scope_key,
        )
        db.add(new_lit)
        await db.commit()
        await db.refresh(new_lit)
        logger.info("Created literature upload entry literature_id=%s", new_lit.id)

        # Save PDF file to disk for later serving (Source Grounding viewer)
        if is_pdf_upload:
            pdf_dir = os.path.join(TEMP_UPLOAD_DIR, "pdfs")
            os.makedirs(pdf_dir, exist_ok=True)
            pdf_path = os.path.join(pdf_dir, f"{new_lit.id}.pdf")
            with open(pdf_path, 'wb') as f:
                f.write(content_bytes)
            new_lit.file_path = pdf_path
            await db.commit()
            logger.info("Saved uploaded PDF literature_id=%s path=%s", new_lit.id, pdf_path)

        return new_lit
        
    except Exception as e:
        logger.exception("Failed to save upload entry filename=%s", file.filename)
        raise e



async def _safe_update_doi(db: AsyncSession, literature, new_doi: str) -> bool:
    """
    Safely updates literature.doi only if no other record already owns that DOI.
    Returns True if updated, False if skipped to avoid UNIQUE constraint violation.
    """
    if not new_doi:
        return False
    # Normalize to lowercase for consistency
    norm = DOIService()._normalize_doi(new_doi)
    if not norm or norm == literature.doi:
        return False  # Nothing to do
    # Check if any OTHER record already has this DOI
    result = await db.execute(
        select(Literature).where(
            Literature.doi == norm,
            Literature.id != literature.id,
            Literature.group_id == literature.group_id,
            Literature.scope_key == literature.scope_key,
        )
    )
    conflict = result.scalar_one_or_none()
    if conflict:
        logger.warning(
            "Skipping DOI update for literature_id=%s because doi=%s is already owned by literature_id=%s",
            literature.id,
            norm,
            conflict.id,
        )
        return False
    literature.doi = norm
    return True


def _apply_default_temperature(records: list[dict]) -> None:
    for item in records or []:
        if not isinstance(item, dict):
            continue
        temperature = str(item.get("temperature") or "").strip()
        if not temperature:
            item["temperature"] = DEFAULT_TEMPERATURE_VALUE


def _format_numeric_text(value: float) -> str:
    if float(value).is_integer():
        return str(int(value))
    return f"{value:.3f}".rstrip("0").rstrip(".")


def _normalize_thickness_value(value: object) -> Optional[str]:
    text = str(value or "").strip()
    if not text or text.lower() in {"-", "--", "n/a", "none", "unknown"}:
        return None

    uncertainty_match = re.search(
        r"([-+]?\d*\.?\d+)\s*(?:±|\+/-|\+∕-)\s*([-+]?\d*\.?\d+)\s*(nm|μm|µm|um|pm|å|a\b|angstrom(?:s)?)",
        text,
        flags=re.IGNORECASE,
    )
    if uncertainty_match:
        magnitude = float(uncertainty_match.group(1))
        uncertainty = float(uncertainty_match.group(2))
        unit = uncertainty_match.group(3).lower()
        if unit in {"μm", "µm", "um"}:
            magnitude *= 1000.0
            uncertainty *= 1000.0
        elif unit in {"pm"}:
            magnitude /= 1000.0
            uncertainty /= 1000.0
        elif unit in {"å", "a", "angstrom", "angstroms"}:
            magnitude /= 10.0
            uncertainty /= 10.0
        return f"{_format_numeric_text(magnitude)} ± {_format_numeric_text(uncertainty)} nm"

    match = re.search(r"([-+]?\d*\.?\d+)\s*(nm|μm|µm|um|pm|å|a\b|angstrom(?:s)?)", text, flags=re.IGNORECASE)
    if not match:
        return None

    magnitude = float(match.group(1))
    unit = match.group(2).lower()
    if unit in {"μm", "µm", "um"}:
        magnitude *= 1000.0
    elif unit in {"pm"}:
        magnitude /= 1000.0
    elif unit in {"å", "a", "angstrom", "angstroms"}:
        magnitude /= 10.0

    return f"{_format_numeric_text(magnitude)} nm"


def _canonicalize_ionic_liquid_name(value: object) -> tuple[Optional[str], dict]:
    text = str(value or "").strip()
    if not text or _is_unknown_il(text):
        return None, {}

    embedded_candidates = _extract_il_candidates(text)
    normalized = None
    if len(embedded_candidates) == 1:
        normalized = embedded_candidates[0]
    else:
        normalized = normalize_ionic_liquid(text) or text
    resolved = resolve_il(normalized)
    canonical_name = str(resolved.get("canonical_name") or "").strip()
    if canonical_name and not _is_unknown_il(canonical_name):
        return canonical_name, resolved

    normalized_text = str(normalized or "").strip()
    compact_il_like = bool(
        re.search(r"\[[^\]]+\]\s*\[[^\]]+\]", normalized_text)
        or re.fullmatch(r"[A-Za-z0-9(),+\-\[\]]{2,48}", normalized_text)
        or re.fullmatch(r"[A-Za-z0-9(),+\-\[\]]{2,24}\s+[A-Za-z0-9(),+\-\[\]]{1,24}", normalized_text)
    )
    if compact_il_like and not _is_unknown_il(normalized_text):
        return normalized_text, resolved

    return None, resolved


def _canonical_pair_parts(canonical_name: object, resolved: dict) -> tuple[Optional[str], Optional[str]]:
    canonical_text = str(canonical_name or "").strip()
    match = re.match(r"^\[([^\]]+)\]\s*\[([^\]]+)\](?:\d+)?$", canonical_text)
    if match:
        return match.group(1), match.group(2)
    return resolved.get("cation"), resolved.get("anion")


def _refines_same_cation_pair(current_name: object, current_resolved: dict, next_name: object, next_resolved: dict) -> bool:
    current_cation, current_anion = _canonical_pair_parts(current_name, current_resolved)
    next_cation, next_anion = _canonical_pair_parts(next_name, next_resolved)
    if not current_cation or not next_cation or current_cation != next_cation:
        return False
    if not current_anion or not next_anion or current_anion == next_anion:
        return False
    return len(str(next_anion)) > len(str(current_anion))


def _component_pair_supported_by_context(candidate_name: object, resolved: dict, item: dict[str, Any]) -> bool:
    candidate_text = str(candidate_name or "").strip()
    if not candidate_text:
        return False
    context = " ".join(
        str(item.get(key) or "")
        for key in (
            "ionic_liquid",
            "lubricant",
            "material_name",
            "substrate_material",
            "evidence",
            "notes",
            "source",
            "source_figure",
            "sample_id",
        )
    )
    context_l = context.lower()
    compact_context = re.sub(r"\s+", "", context_l)
    compact_candidate = re.sub(r"\s+", "", candidate_text.lower())
    if compact_candidate and compact_candidate in compact_context:
        return True

    cation, anion = _canonical_pair_parts(candidate_text, resolved)
    if not cation or not anion:
        return False
    cation_pattern = rf"(?<![A-Za-z0-9]){re.escape(str(cation).lower())}(?![A-Za-z0-9])"
    anion_pattern = rf"(?<![A-Za-z0-9]){re.escape(str(anion).lower())}(?![A-Za-z0-9])"
    return bool(re.search(cation_pattern, context_l) and re.search(anion_pattern, context_l))


def _normalize_record_chemistry(records: list[dict]) -> None:
    for item in records or []:
        if not isinstance(item, dict):
            continue

        raw_film_candidate = item.get("film_thickness")
        item["film_thickness"] = _normalize_thickness_value(raw_film_candidate)
        for field in ("residual_film_thickness_d", "layer_spacing_delta"):
            item[field] = _normalize_thickness_value(item.get(field))

        raw_lubricant = item.get("ionic_liquid") or item.get("lubricant")
        cof_extracted = normalize_cof_extracted(item.get("cof_extracted") or item.get("cofExtracted"))
        if not cof_extracted:
            cof_extracted = derive_cof_extracted(
                item.get("cof") or item.get("cof_raw"),
                item.get("cof_value"),
                load=item.get("load") or item.get("normal_load"),
                speed=item.get("speed"),
            )
        if cof_extracted:
            item["cof_extracted"] = cof_extracted
        load_conditions = normalize_load_conditions(item.get("load_conditions") or item.get("loadConditions"))
        if not load_conditions:
            load_conditions = derive_load_conditions(item.get("load") or item.get("normal_load"))
        if load_conditions:
            item["load_conditions"] = load_conditions
        is_fast_table_record = _is_fast_table_record_origin(item.get("record_origin"))
        speed_conditions = {} if is_fast_table_record else normalize_speed_conditions(item.get("speed_conditions") or item.get("speedConditions"))
        if not speed_conditions:
            if is_fast_table_record:
                speed_conditions = {}
            else:
                speed_context = " ".join(
                    str(part or "")
                    for part in (item.get("evidence"), item.get("notes"), item.get("source"), item.get("source_figure"))
                    if part not in (None, "")
                )
                speed_conditions = derive_speed_conditions(item.get("speed") or item.get("speed_value"), context=speed_context)
        if speed_conditions:
            item["speed_conditions"] = speed_conditions
            derived_speed = speed_value_from_conditions(speed_conditions)
            if derived_speed:
                item["speed"] = derived_speed
                item["speed_value"] = derived_speed
            elif speed_conditions.get("scan_rate_hz") is not None:
                item["speed"] = None
                item["speed_value"] = None
        elif is_fast_table_record and item.get("speed") not in (None, "") and item.get("speed_value") in (None, ""):
            item["speed_value"] = item.get("speed")
        tribological_system = normalize_tribological_system(item.get("tribological_system") or item.get("tribologicalSystem"))
        if not tribological_system:
            tribological_system = derive_tribological_system(item.get("regime"))
        if tribological_system:
            item["tribological_system"] = tribological_system
        lubricant_components = normalize_lubricant_components(
            item.get("lubricant_components")
            or item.get("lubricantComponents")
            or item.get("Lubricant_Mixture")
            or item.get("components")
        )
        if not lubricant_components:
            lubricant_components = parse_lubricant_components(
                raw_lubricant,
                item.get("mol_ratio") or item.get("molRatio"),
                item.get("cation"),
                item.get("anion"),
            )
        is_mixture = len(lubricant_components) > 1
        if item.get("lubricantAlias") and not item.get("lubricant_alias"):
            item["lubricant_alias"] = item.get("lubricantAlias")
        if lubricant_components:
            item["lubricant_components"] = lubricant_components
            alias = item.get("lubricant_alias") or item.get("lubricantAlias")
            item["ionic_liquid_display"] = compact_lubricant_label(raw_lubricant, lubricant_components, alias)
            item["lubricant_tooltip"] = format_lubricant_tooltip(raw_lubricant, lubricant_components, alias)

        il_candidates: list[tuple[str, object]] = [
            ("ionic_liquid", item.get("ionic_liquid")),
            ("lubricant", item.get("lubricant")),
            ("components", item.get("cation") and item.get("anion") and f"[{item.get('cation')}][{item.get('anion')}]"),
            ("material_name", item.get("material_name")),
            ("substrate_material", item.get("substrate_material")),
            ("sample_id", item.get("sample_id")),
            ("film_thickness", raw_film_candidate if raw_film_candidate and not item.get("film_thickness") else None),
            ("evidence", item.get("evidence")),
            ("notes", item.get("notes")),
        ]
        if not any(candidate and not _is_unknown_il(candidate) for _, candidate in il_candidates):
            il_candidates.extend([
                ("film_thickness", raw_film_candidate),
            ])

        canonical_name: Optional[str] = None
        resolved: dict = {}
        canonical_matches: list[tuple[str, Optional[str], dict]] = []
        for label, candidate in il_candidates:
            candidate_name, candidate_resolved = _canonicalize_ionic_liquid_name(candidate)
            if label == "components" and candidate_name and not _component_pair_supported_by_context(
                candidate_name,
                candidate_resolved,
                item,
            ):
                continue
            if candidate_name:
                canonical_matches.append((label, candidate_name, candidate_resolved))
        if canonical_matches:
            _, canonical_name, resolved = canonical_matches[0]
            for label, candidate_name, candidate_resolved in canonical_matches[1:]:
                if label in {"film_thickness", "evidence", "notes"} and _refines_same_cation_pair(
                    canonical_name,
                    resolved,
                    candidate_name,
                    candidate_resolved,
                ):
                    canonical_name = candidate_name
                    resolved = candidate_resolved
                    break

        if is_mixture:
            canonical_name = None
            resolved = {}

        if canonical_name:
            item["ionic_liquid"] = canonical_name
            item["lubricant"] = canonical_name
            resolved_alias = (
                resolved.get("lubricant_alias")
                or resolved.get("alias")
                or (resolve_ionic_liquid_alias(raw_lubricant or "") or {}).get("alias")
            )
            if resolved_alias and not item.get("lubricant_alias"):
                item["lubricant_alias"] = resolved_alias

        cation_part, anion_part = _canonical_pair_parts(resolved.get("canonical_name"), resolved)
        if resolved.get("cation"):
            item["cation"] = cation_part or resolved["cation"]
        if resolved.get("anion"):
            item["anion"] = anion_part or resolved["anion"]
        if resolved.get("cation_smiles"):
            item["cation_smiles"] = resolved["cation_smiles"]
        if resolved.get("anion_smiles"):
            item["anion_smiles"] = resolved["anion_smiles"]
        if resolved.get("il_smiles"):
            item["il_smiles"] = resolved["il_smiles"]
        if resolved.get("il_inchikey"):
            item["il_inchikey"] = resolved["il_inchikey"]
        if resolved.get("alkyl_chain_length") is not None:
            item["alkyl_chain_length"] = resolved["alkyl_chain_length"]


async def process_file_safe(
    file_id: int,
    content: str = None,
    images: list = None,
    force: bool = False,
    profile: str = "auto",
    strict_cof_mode: Optional[bool] = None,
    run_id: str | None = None,
):
    """
    Process file with an ISOLATED database session. 
    Returns (metadata_dict, data_list, extraction_summary) for immediate frontend display.
    Handles caching logic internally.
    """
    requested_profile = (profile or "auto").strip().lower()
    profile = "auto"
    resolved_strict_cof_mode = False if strict_cof_mode is None else bool(strict_cof_mode)
    logger.info(
        "Starting isolated processing literature_id=%s profile=%s strict_cof_mode=%s force=%s",
        file_id,
        requested_profile,
        resolved_strict_cof_mode,
        force,
    )
    
    # 1. Open Scoped Session
    async with async_session_maker() as db:
        run_id = run_id or uuid.uuid4().hex
        run_created = False
        try:
            # 2. Fetch Literature
            # Use distinct session, so re-fetch is necessary
            literature = await db.get(Literature, file_id)
            if not literature:
                logger.warning("Literature %s not found during processing", file_id)
                return None, [], {}
            resolved_file_path = _resolve_existing_path(literature.file_path)

            # --- 鉁?DATA EXISTENCE GUARD (Safety Fallback) ---
            # Even if status is wrong, TRUST THE DATA.
            data_count = 0
            if not force:
                candidate_count, final_count = await _count_cached_record_artifacts(db, literature.id)
                data_count = candidate_count or final_count
                
                if data_count > 0:
                     logger.info(
                         "Processing shortcut literature_id=%s existing_records=%s force=%s",
                         file_id,
                         data_count,
                         force,
                     )
                     # Setup literature as completed in memory for the next check
                     literature.status = 'completed'
                     # Helper: we will fall through to the 'if ... status == completed' block below
                elif await _normalize_legacy_no_data_state(
                    db,
                    literature,
                    candidate_count=candidate_count,
                    final_count=final_count,
                ):
                    await db.commit()
            # ------------------------------------------------

            # 3. Smart Caching / In-Progress Reuse
            if literature.status in {"processing", "extracting"}:
                running_run = None
                run_stmt = (
                    select(ExtractionRun)
                    .where(
                        ExtractionRun.literature_id == literature.id,
                        ExtractionRun.status == "running",
                    )
                    .order_by(ExtractionRun.id.desc())
                    .limit(1)
                )
                run_result = await db.execute(run_stmt)
                running_run = run_result.scalar_one_or_none()
                running_run_id = running_run.run_id if running_run else None
                if running_run_id == run_id:
                    running_run = None

                is_stale = False
                if running_run:
                    try:
                        now_utc = datetime.utcnow()
                        last_touch = running_run.updated_at or running_run.created_at
                        if last_touch:
                            stale_minutes = 4
                            is_stale = (now_utc - last_touch) > timedelta(minutes=stale_minutes)
                        if not is_stale and running_run.created_at:
                            has_progress = bool((running_run.summary_json or "").strip() and (running_run.summary_json or "").strip() != "{}")
                            if not has_progress and (now_utc - running_run.created_at) > timedelta(minutes=2):
                                is_stale = True
                    except Exception:
                        is_stale = False

                if is_stale:
                    logger.warning("Stale extraction detected for literature_id=%s; recovering", file_id)
                    running_run.status = "failed"
                    running_run.error_message = "Marked stale after 12+ minutes without completion"
                    literature.status = "failed"
                    literature.error_message = "Recovered from stale extraction state"
                    await db.commit()
                else:
                    if running_run or literature.status == "processing":
                        logger.info(
                            "Literature %s already has an active extraction; returning in-progress status",
                            file_id,
                        )
                        return {}, [], _build_in_progress_summary(running_run)

                    logger.info(
                        "Literature %s is marked extracting without an active run; continuing with a fresh run",
                        file_id,
                    )

            # 4. Smart Caching Check
            # If valid, completed, and not forced, return existing data
            if not force and literature.status in {'completed', 'no_data'}:
                if data_count > 0:
                    cached_result = await _load_cached_extraction_result(db, literature)
                    if _should_audit_cached_records(cached_result[1]):
                        refreshed_result = await _refresh_cached_records_from_fallback(
                            db,
                            literature,
                            cached_result[1],
                            file_path=resolved_file_path,
                            content=content or literature.content or "",
                        )
                        if refreshed_result:
                            return refreshed_result
                    logger.info("Returning cached extraction for literature_id=%s", file_id)
                    return cached_result
                if literature.status == "no_data":
                    canonical_cache = await _copy_matching_tribology_cache_records(db, literature)
                    if canonical_cache:
                        metadata, data_list, cache_summary = await _load_cached_extraction_result(db, literature)
                        cache_summary = {
                            **cache_summary,
                            "canonical_cache": canonical_cache,
                            "cache_refreshed": True,
                            "recovered_from_no_data": True,
                        }
                        await db.commit()
                        return metadata, data_list, cache_summary

                    fallback_records, fallback_info = extract_table_fallback_records(
                        content or literature.content or "",
                        resolved_file_path,
                    )
                    if fallback_records:
                        saved_count = await _replace_literature_records_from_items(
                            db,
                            literature,
                            fallback_records,
                            file_path=resolved_file_path,
                        )
                        if saved_count > 0:
                            logger.info(
                                "Recovered cached no-data literature_id=%s using fallback parser=%s saved=%s",
                                file_id,
                                fallback_info.get("parser"),
                                saved_count,
                            )
                            metadata, data_list, cache_summary = await _load_cached_extraction_result(db, literature)
                            cache_summary = {
                                **cache_summary,
                                "fallback_extraction": fallback_info,
                                "cache_refreshed": True,
                                "recovered_from_no_data": True,
                            }
                            return metadata, data_list, cache_summary

                    logger.info("Returning cached no-data result for literature_id=%s", file_id)
                    no_data_message = build_no_data_reason(
                        literature=literature,
                        metadata={
                            "title": literature.title,
                            "doi": literature.doi,
                            "authors": literature.authors,
                            "journal": literature.journal,
                            "year": literature.year,
                        },
                        content=content or literature.content,
                        fallback=literature.error_message,
                    )
                    if literature.error_message != no_data_message:
                        literature.error_message = no_data_message
                        await db.commit()
                    metadata = {
                        "title": literature.title,
                        "doi": literature.doi,
                        "authors": literature.authors,
                        "journal": literature.journal,
                        "year": literature.year,
                        "volume": literature.volume,
                        "issue": literature.issue,
                        "pages": literature.pages,
                        "issn": literature.issn,
                    }
                    return metadata, [], {
                        "run_id": None,
                        "candidate_count": 0,
                        "final_count": 0,
                        "dropped_by_reason": {"no_records": 1},
                        "page_coverage": {},
                        "page_candidate_counts": {},
                        "current_stage": "stage_e.finalize",
                        "current_message": no_data_message,
                        "no_data_reason": no_data_message,
                        "progress_log": [{"stage": "stage_e.finalize", "message": no_data_message}],
                    }
                logger.warning("Completed literature_id=%s has no cached records; rerunning extraction", file_id)
            
            # 5. Perform Extraction
            logger.info("Running LLM extraction for literature_id=%s title=%s", file_id, literature.title)
            
            # Ensure content
            if not content and literature.content:
                content = literature.content
            
            # Do not eagerly rasterize the full PDF here.
            # LLMService performs page-level profiling and targeted visual extraction from pdf_path.

            if not content:
                 logger.warning("No content available for literature_id=%s", file_id)
                 literature.status = "failed"
                 literature.error_message = "No content available"
                 await db.commit()
                 return {}, [], {}
            
            # Update status
            literature.status = "extracting"
            await db.commit()

            existing_run = await get_extraction_run(db, run_id)
            if existing_run:
                await mark_extraction_run_started(
                    db,
                    run_id=run_id,
                    extractor_type="tribology",
                            profile=profile,
                )
            else:
                await create_extraction_run(
                    db,
                    run_id=run_id,
                    literature_id=literature.id,
                    extractor_type="tribology",
                    profile=profile,
                )
                await mark_extraction_run_started(
                    db,
                    run_id=run_id,
                    extractor_type="tribology",
                    profile=profile,
                )
            run_created = True
            await db.commit()

            last_progress_flush = 0.0

            async def _raise_if_cancelled(stage: str = "cancelled") -> None:
                if await is_extraction_cancelled(
                    db,
                    run_id=run_id if run_created else None,
                    literature_id=literature.id,
                ):
                    logger.info("Extraction cancelled literature_id=%s stage=%s", literature.id, stage)
                    raise ExtractionCancelledError(CANCELLED_EXTRACTION_MESSAGE)

            async def _persist_run_progress(progress_event: dict) -> None:
                nonlocal last_progress_flush
                if not run_created:
                    return

                async with async_session_maker() as cancel_db:
                    if await is_extraction_cancelled(cancel_db, run_id=run_id, literature_id=file_id):
                        raise ExtractionCancelledError(CANCELLED_EXTRACTION_MESSAGE)

                now_mono = time.monotonic()
                force_flush = bool(progress_event.get("force"))
                if not force_flush and (now_mono - last_progress_flush) < 5.0:
                    return

                summary_patch = {
                    "candidate_count": int(progress_event.get("candidate_count") or 0),
                    "kept_count": int(progress_event.get("kept_count") or 0),
                    "dropped_by_reason": progress_event.get("dropped_by_reason") or {},
                    "page_coverage": progress_event.get("page_coverage") or {},
                    "page_candidate_counts": progress_event.get("page_candidate_counts") or {},
                    "progress_log": progress_event.get("progress_log") or [],
                    "current_stage": progress_event.get("stage"),
                    "current_message": progress_event.get("message"),
                    "current_page": progress_event.get("page"),
                    "last_progress_at": datetime.utcnow().isoformat(),
                }
                summary_patch["progress_percent"] = compute_extraction_progress_percent(
                    summary_patch["current_stage"],
                    page_coverage=summary_patch["page_coverage"],
                    page_candidate_counts=summary_patch["page_candidate_counts"],
                )

                try:
                    async with async_session_maker() as progress_db:
                        await update_extraction_run_progress(
                            progress_db,
                            run_id=run_id,
                            candidate_count=summary_patch["candidate_count"],
                            dropped_by_reason=summary_patch["dropped_by_reason"],
                            page_coverage=summary_patch["page_coverage"],
                            summary_patch=summary_patch,
                        )
                        await progress_db.commit()
                    last_progress_flush = now_mono
                except Exception as progress_err:
                    # Progress persistence must never break extraction.
                    logger.warning("Progress persistence failed for run_id=%s: %s", run_id, progress_err)

            # Call LLM (smart routing: pass pdf_path so visual pages go to Qwen-VL only)
            extract_timeout_s = 960
            try:
                if images:
                    result = await asyncio.wait_for(
                        llm_service.extract_with_metadata(
                            content=content,
                            images=images,
                            pdf_path=resolved_file_path,
                            extraction_profile=profile,
                            progress_callback=_persist_run_progress,
                            strict_cof_mode=resolved_strict_cof_mode,
                        ),
                        timeout=extract_timeout_s,
                    )
                else:
                    result = await asyncio.wait_for(
                        llm_service.extract_with_metadata(
                            content=content,
                            pdf_path=resolved_file_path,
                            extraction_profile=profile,
                            progress_callback=_persist_run_progress,
                            strict_cof_mode=resolved_strict_cof_mode,
                        ),
                        timeout=extract_timeout_s,
                    )
            except asyncio.TimeoutError:
                logger.warning("LLM extraction timed out after %ss for literature_id=%s", extract_timeout_s, file_id)
                result = {
                    "metadata": {},
                    "data": [],
                    "extraction_summary": {
                        "candidate_count": 0,
                        "final_count": 0,
                        "dropped_by_reason": {"timeout": 1},
                        "page_coverage": {},
                        "page_candidate_counts": {},
                        "progress_log": [],
                        "timeout_seconds": extract_timeout_s,
                    },
                    "trace_candidates": [],
                }

            if (result.get("extraction_summary") or {}).get("pipeline") == "fast_table":
                visual_fallback_used = False
            else:
                result, visual_fallback_used = await _maybe_retry_tribology_visual_fallback(
                    result,
                    content=content or "",
                    images=images,
                    pdf_path=resolved_file_path,
                    profile=profile,
                    strict_cof_mode=bool(resolved_strict_cof_mode),
                    progress_callback=_persist_run_progress,
                    extract_with_metadata=llm_service.extract_with_metadata,
                )
            if visual_fallback_used:
                logger.info("Visual fallback extraction completed for literature_id=%s", file_id)
            
            records = result.get("data", [])
            metadata = result.get("metadata", {})
            llm_summary = result.get("extraction_summary", {}) or {}
            trace_candidates = result.get("trace_candidates", []) or []
            allow_likely_ils = _allow_likely_ils_for_persistence(
                profile=profile,
                visual_fallback_used=visual_fallback_used,
                extraction_summary=llm_summary,
            )

            await _raise_if_cancelled("stage_d.post_model")

            fallback_metadata = extract_metadata_fallback(content)
            if fallback_metadata:
                metadata = {
                    **fallback_metadata,
                    **{k: v for k, v in (metadata or {}).items() if v not in (None, "", [])},
                }

            fallback_records: list[dict] = []
            fallback_info: dict[str, Any] = {}
            if content:
                fallback_records, fallback_info = extract_table_fallback_records(content, resolved_file_path)

            # Deterministic IL backfill for unknown labels using PDF caption/page text context.
            if isinstance(records, list) and records:
                _backfill_unknown_il_records(records, resolved_file_path)

            if _should_replace_records_with_fallback(records if isinstance(records, list) else [], fallback_records, fallback_info):
                previous_record_count = len(records) if isinstance(records, list) else 0
                logger.info(
                    "Fallback extraction selected %s records from %s on page %s (previous_records=%s)",
                    len(fallback_records),
                    fallback_info.get("matched_table"),
                    fallback_info.get("matched_page"),
                    previous_record_count,
                )
                records = fallback_records
                trace_candidates.extend(
                    [
                        {
                            "stage": "fallback_table",
                            "modality": "text",
                            "page": item.get("source_page"),
                            "source_figure": item.get("source_figure"),
                            "raw": item,
                            "normalized": item,
                            "drop_reason": None,
                            "merged_into": None,
                        }
                        for item in fallback_records
                    ]
                )
                llm_summary = {
                    **llm_summary,
                    "candidate_count": len(fallback_records),
                    "final_count": len(fallback_records),
                    "dropped_by_reason": llm_summary.get("dropped_by_reason") or {},
                    "fallback_extraction": fallback_info,
                    "fallback_replaced_record_count": previous_record_count,
                }

            if isinstance(records, list) and records:
                _apply_default_temperature(records)
                _normalize_record_chemistry(records)
                records, dropped_non_il = filter_to_supported_ionic_liquid_records(records, allow_likely=allow_likely_ils)
                _annotate_records_with_identity(records)
                if dropped_non_il:
                    logger.info("Dropped %s non-ionic-liquid records before persistence", len(dropped_non_il))

            await _raise_if_cancelled("stage_e.before_persistence")
            
            # 5. Save Results
            if records:
                # Clear both stale candidates and stale approved final records before writing a new review queue.
                await db.execute(delete(RecordCandidate).where(RecordCandidate.literature_id == literature.id))
                await db.execute(delete(TribologyData).where(TribologyData.literature_id == literature.id))

                # Stage E final merge (single dedup pass only).
                records, merge_report, stage_e_candidates = _final_merge_records(records)
                review_link_summary = await _annotate_review_secondary_records(
                    db,
                    literature,
                    records,
                    content=content,
                )
                if review_link_summary.get("linked_count"):
                    llm_summary = {
                        **llm_summary,
                        "review_secondary_linking": review_link_summary,
                    }

                new_records_db: list[RecordCandidate] = []
                response_rows: list[tuple[RecordCandidate, dict[str, Any]]] = []
                metric_dropped = 0
                blocked_by_reason: dict[str, int] = {}
                
                for i, item in enumerate(records):
                    if not _resolve_primary_metric_key(item):
                        metric_dropped += 1
                        stage_e_candidates.append(
                            {
                                "stage": "stage_e",
                                "modality": "merge",
                                "page": item.get("source_page"),
                                "source_figure": item.get("source_figure"),
                                "raw": item,
                                "normalized": item,
                                "drop_reason": "missing_primary_metric",
                                "merged_into": None,
                            }
                        )
                        continue

                    drop_reason = _get_drop_reason_for_final_record(item)
                    if drop_reason:
                        blocked_by_reason[drop_reason] = int(blocked_by_reason.get(drop_reason) or 0) + 1
                        stage_e_candidates.append(
                            {
                                "stage": "stage_e",
                                "modality": "merge",
                                "page": item.get("source_page"),
                                "source_figure": item.get("source_figure"),
                                "raw": item,
                                "normalized": item,
                                "drop_reason": drop_reason,
                                "merged_into": None,
                            }
                        )
                        continue
                    
                    db_record, response_item = _build_db_record_from_item(
                        literature_id=literature.id,
                        item=item,
                        file_path=resolved_file_path,
                        record_origin="llm_extraction",
                        model_cls=RecordCandidate,
                    )
                    if _is_fast_table_record_origin(item.get("record_origin")):
                        db_record.record_origin = str(item.get("record_origin") or "").strip()
                        db_record.review_status = "needs_review"
                        response_item.update(
                            {
                                "record_origin": db_record.record_origin,
                                "review_status": "needs_review",
                                "review_entity_type": "candidate",
                                "admission_reason": db_record.record_origin,
                            }
                        )
                    new_records_db.append(db_record)
                    response_rows.append((db_record, response_item))
                
                db.add_all(new_records_db)
                await db.flush()
                response_data_list = []
                for db_record, response_item in response_rows:
                    response_item["id"] = str(db_record.id)
                    response_data_list.append(response_item)

                persisted_candidate_count = len(trace_candidates) + len(stage_e_candidates)
                dropped_by_reason = {
                    **(llm_summary.get("dropped_by_reason") or {}),
                    **(merge_report.get("dropped_by_reason") or {}),
                    **blocked_by_reason,
                }
                if metric_dropped:
                    dropped_by_reason["missing_primary_metric"] = (
                        int(dropped_by_reason.get("missing_primary_metric") or 0) + metric_dropped
                    )

                if not response_data_list:
                    weak_result = await _finalize_weak_candidates_for_review(
                        db,
                        literature=literature,
                        run_id=run_id,
                        llm_summary=llm_summary,
                        trace_candidates=trace_candidates,
                        extra_candidates=stage_e_candidates,
                        file_path=resolved_file_path,
                        profile=profile,
                        dropped_by_reason=dropped_by_reason,
                    )
                    if weak_result:
                        await db.commit()
                        weak_rows, weak_summary = weak_result
                        return metadata, weak_rows, weak_summary
                
                # Update Metadata (with DOI conflict guard)
                if metadata:
                    if metadata.get("title"): literature.title = metadata["title"]
                    if metadata.get("doi"):
                        await _safe_update_doi(db, literature, metadata["doi"])
                    if metadata.get("authors"): literature.authors = metadata["authors"]
                    if metadata.get("journal"): literature.journal = metadata["journal"]
                    if metadata.get("year"): literature.year = metadata["year"]
                    if metadata.get("volume"): literature.volume = metadata["volume"]
                    if metadata.get("issue"): literature.issue = metadata["issue"]
                    if metadata.get("pages"): literature.pages = metadata["pages"]
                    if metadata.get("issn"): literature.issn = metadata["issn"]

                await _raise_if_cancelled("stage_e.before_finalize")
                
                literature.status = "completed"
                literature.error_message = None
                _archive_completed_literature_pdf(literature, resolved_file_path)
                logger.info("Saved %s extracted records for literature_id=%s", len(new_records_db), literature.id)

                await add_extraction_candidates(
                    db,
                    run_id=run_id,
                    candidates=[*trace_candidates, *stage_e_candidates],
                )

                extraction_summary = {
                    "run_id": run_id,
                    "candidate_count": max(
                        int(llm_summary.get("candidate_count") or 0),
                        persisted_candidate_count,
                    ),
                    "final_count": len(response_data_list),
                    "dropped_by_reason": dropped_by_reason,
                    "page_coverage": llm_summary.get("page_coverage") or {},
                    "page_candidate_counts": llm_summary.get("page_candidate_counts") or {},
                    "progress_log": llm_summary.get("progress_log") or [],
                    "profile": profile,
                    "figure_estimate_count": int(llm_summary.get("figure_estimate_count") or 0),
                    "allow_figure_estimates": bool(llm_summary.get("allow_figure_estimates")),
                    "merge_report": merge_report,
                }
                await finalize_extraction_run(
                    db,
                    run_id=run_id,
                    status="completed",
                    candidate_count=extraction_summary["candidate_count"],
                    final_count=extraction_summary["final_count"],
                    dropped_by_reason=extraction_summary["dropped_by_reason"],
                    summary=extraction_summary,
                )
                await db.commit()
                return metadata, response_data_list, extraction_summary
            else:
                weak_result = await _finalize_weak_candidates_for_review(
                    db,
                    literature=literature,
                    run_id=run_id,
                    llm_summary=llm_summary,
                    trace_candidates=trace_candidates,
                    extra_candidates=None,
                    file_path=resolved_file_path,
                    profile=profile,
                )
                if weak_result:
                    await db.commit()
                    weak_rows, extraction_summary = weak_result
                    return metadata, weak_rows, extraction_summary

                await _raise_if_cancelled("stage_e.before_no_data_finalize")
                no_data_message = build_no_data_reason(
                    literature=literature,
                    metadata=metadata,
                    content=content or literature.content,
                    summary=llm_summary,
                    fallback=llm_summary.get("no_data_reason") or llm_summary.get("current_message"),
                )
                logger.info("%s for literature_id=%s", no_data_message, literature.id)
                literature.status = "no_data"
                literature.error_message = no_data_message
                await add_extraction_candidates(
                    db,
                    run_id=run_id,
                    candidates=trace_candidates,
                )
                extraction_summary = {
                    "run_id": run_id,
                    "candidate_count": max(
                        int(llm_summary.get("candidate_count") or 0),
                        len(trace_candidates),
                    ),
                    "final_count": 0,
                    "dropped_by_reason": llm_summary.get("dropped_by_reason") or {"no_records": 1},
                    "page_coverage": llm_summary.get("page_coverage") or {},
                    "page_candidate_counts": llm_summary.get("page_candidate_counts") or {},
                    "current_stage": "stage_e.finalize",
                    "current_message": no_data_message,
                    "no_data_reason": no_data_message,
                    "progress_log": [
                        *(llm_summary.get("progress_log") or []),
                        {"stage": "stage_e.finalize", "message": no_data_message},
                    ],
                }

                # Reliability fallback: keep serving existing DB records instead of empty results.
                candidate_count, final_count = await _count_cached_record_artifacts(db, literature.id)
                existing_count = candidate_count or final_count
                if existing_count > 0:
                    cached_metadata, cached_data, _ = await _load_cached_extraction_result(db, literature)
                    extraction_summary["fallback_to_cached"] = True
                    extraction_summary["cached_final_count"] = len(cached_data)
                    await finalize_extraction_run(
                        db,
                        run_id=run_id,
                        status="no_data",
                        candidate_count=extraction_summary["candidate_count"],
                        final_count=len(cached_data),
                        dropped_by_reason=extraction_summary["dropped_by_reason"],
                        summary=extraction_summary,
                        error_message=no_data_message,
                    )
                    await db.commit()
                    return (metadata or cached_metadata), cached_data, extraction_summary

                canonical_cache = await _copy_matching_tribology_cache_records(db, literature)
                if canonical_cache:
                    cached_metadata, cached_data, _ = await _load_cached_extraction_result(db, literature)
                    extraction_summary["canonical_cache"] = canonical_cache
                    extraction_summary["llm_dropped_by_reason"] = extraction_summary.get("dropped_by_reason") or {}
                    extraction_summary["dropped_by_reason"] = {}
                    extraction_summary["final_count"] = len(cached_data)
                    extraction_summary["current_stage"] = "stage_e.canonical_cache"
                    extraction_summary["current_message"] = "Reused existing extraction records from a matching DOI/file cache."
                    extraction_summary["progress_log"] = [
                        *(extraction_summary.get("progress_log") or []),
                        {
                            "stage": "stage_e.canonical_cache",
                            "message": (
                                "Reused existing extraction records from "
                                f"literature #{canonical_cache['source_literature_id']}."
                            ),
                        },
                    ]
                    await finalize_extraction_run(
                        db,
                        run_id=run_id,
                        status="completed",
                        candidate_count=max(
                            int(extraction_summary.get("candidate_count") or 0),
                            int(canonical_cache.get("copied_count") or 0),
                        ),
                        final_count=len(cached_data),
                        dropped_by_reason=extraction_summary["dropped_by_reason"],
                        summary=extraction_summary,
                        error_message=None,
                    )
                    await db.commit()
                    return (metadata or cached_metadata), cached_data, extraction_summary

                await finalize_extraction_run(
                    db,
                    run_id=run_id,
                    status="no_data",
                    candidate_count=extraction_summary["candidate_count"],
                    final_count=0,
                    dropped_by_reason=extraction_summary["dropped_by_reason"],
                    summary=extraction_summary,
                    error_message=no_data_message,
                )
                await db.commit()
                return metadata, [], extraction_summary
                
        except ExtractionCancelledError:
            logger.info("Processing cancelled for literature_id=%s", file_id)
            literature.status = "cancelled"
            literature.error_message = CANCELLED_EXTRACTION_MESSAGE
            extraction_summary = _build_cancelled_extraction_summary(run_id if run_created else None, profile=profile)
            if run_created:
                await finalize_extraction_run(
                    db,
                    run_id=run_id,
                    status="cancelled",
                    candidate_count=0,
                    final_count=0,
                    dropped_by_reason=extraction_summary["dropped_by_reason"],
                    summary=extraction_summary,
                    error_message=CANCELLED_EXTRACTION_MESSAGE,
                )
            await db.commit()
            return {}, [], extraction_summary

        except Exception as e:
            logger.exception("Processing failed for literature_id=%s", file_id)
            literature.status = "failed"
            literature.error_message = str(e)
            if run_created:
                await finalize_extraction_run(
                    db,
                    run_id=run_id,
                    status="failed",
                    candidate_count=0,
                    final_count=0,
                    dropped_by_reason={},
                    summary={},
                    error_message=str(e),
                )
            await db.commit()
            return {}, [], {}


async def process_file_background(
    file_id: int,
    extractor_type: str = "tribology",
    force: bool = False,
    profile: str = "auto",
    strict_cof_mode: Optional[bool] = None,
    run_id: str | None = None,
):
    """
    Background Task for File Processing with Idempotency Check.
    Wraps process_file_safe with an additional status check to prevent overwriting completed files.
    """
    logger.info("Starting background processing for literature_id=%s", file_id)

    if extractor_type == "diffusion":
        from services.diffusion.diffusion_extractor_service import process_diffusion_file_background

        await process_diffusion_file_background(file_id, force=force, profile=profile, run_id=run_id)
        return
    
    async with async_session_maker() as db:
        try:
            # 1. Fetch Record
            result = await db.execute(select(Literature).where(Literature.id == file_id))
            literature = result.scalar_one_or_none()
            
            if not literature:
                logger.warning("Background processing skipped because literature_id=%s was not found", file_id)
                return
            if str(literature.status or "").strip().lower() == "cancelled":
                logger.info("Background processing skipped because literature_id=%s is cancelled", file_id)
                return

            # --- 鉁?ULTIMATE GUARD: DATA EXISTENCE CHECK ---
            # Don't trust 'status'. Trust the data.
            # If we already have extracted records, DO NOT DELETE THEM.
            candidate_count, final_count = await _count_cached_record_artifacts(db, file_id)
            data_count = candidate_count or final_count
            
            if data_count > 0 and not force:
                logger.info("Background processing aborted for literature_id=%s existing_records=%s", file_id, data_count)
                # Self-healing: Ensure status reflects reality
                if literature.status != 'completed':
                    logger.info("Updating literature_id=%s status to completed during self-heal", file_id)
                    literature.status = 'completed'
                if run_id and await get_extraction_run(db, run_id):
                    summary = {
                        "run_id": run_id,
                        "extractor_type": "tribology",
                        "candidate_count": int(candidate_count or 0),
                        "final_count": int(final_count or 0),
                        "current_stage": "stage_e.finalize",
                        "current_message": "Existing extraction records are already available.",
                        "progress_log": [
                            {
                                "stage": "stage_e.finalize",
                                "message": "Existing extraction records are already available.",
                            }
                        ],
                    }
                    await finalize_extraction_run(
                        db,
                        run_id=run_id,
                        status="completed",
                        candidate_count=int(candidate_count or 0),
                        final_count=int(final_count or 0),
                        dropped_by_reason={},
                        summary=summary,
                    )
                await db.commit()
                return
            if not force and await _normalize_legacy_no_data_state(
                db,
                literature,
                candidate_count=candidate_count,
                final_count=final_count,
            ):
                logger.info("Background processing aborted for literature_id=%s normalized to no_data", file_id)
                if run_id and await get_extraction_run(db, run_id):
                    no_data_message = literature.error_message or "No extractable records found."
                    summary = {
                        "run_id": run_id,
                        "extractor_type": "tribology",
                        "candidate_count": 0,
                        "final_count": 0,
                        "dropped_by_reason": {"no_records": 1},
                        "current_stage": "stage_e.finalize",
                        "current_message": no_data_message,
                        "no_data_reason": no_data_message,
                        "progress_log": [{"stage": "stage_e.finalize", "message": no_data_message}],
                    }
                    await finalize_extraction_run(
                        db,
                        run_id=run_id,
                        status="no_data",
                        candidate_count=0,
                        final_count=0,
                        dropped_by_reason=summary["dropped_by_reason"],
                        summary=summary,
                        error_message=no_data_message,
                    )
                await db.commit()
                return
            # ------------------------------------------------

            # 2. Update Status to Processing (Only if not completed)
            literature.status = "queued"
            await db.commit()
            
            # 3. Process Logic (Delegate to safe function)
            # process_file_safe will handle the actual extraction, saving, and final status update
            logger.info("Delegating background processing to process_file_safe for literature_id=%s", file_id)
            await process_file_safe(
                file_id,
                force=force,
                profile=profile,
                strict_cof_mode=strict_cof_mode,
                run_id=run_id,
            )
            
        except Exception as e:
            logger.exception("Background processing failed for literature_id=%s", file_id)
            await db.rollback()
            message = str(e) or e.__class__.__name__
            literature = await db.get(Literature, file_id)
            if literature:
                literature.status = "failed"
                literature.error_message = message
            if run_id and await get_extraction_run(db, run_id):
                summary = {
                    "run_id": run_id,
                    "extractor_type": "tribology",
                    "current_stage": "failed",
                    "current_message": message,
                    "progress_log": [{"stage": "failed", "message": message}],
                }
                await finalize_extraction_run(
                    db,
                    run_id=run_id,
                    status="failed",
                    candidate_count=0,
                    final_count=0,
                    dropped_by_reason={"worker_error": 1},
                    summary=summary,
                    error_message=message,
                )
            await db.commit()
            raise

def _should_update_metadata(literature: Literature, new_metadata: dict) -> bool:
    """
    Determine if Literature metadata should be updated with new extraction.
    
    Only update if new metadata is meaningfully better (e.g., from DOI enrichment).
    
    Args:
        literature: Existing Literature record
        new_metadata: Newly extracted metadata
    
    Returns:
        bool: True if metadata should be updated
    """
    # Don't update if new metadata is empty
    if not new_metadata:
        return False
    
    # Update if new metadata has DOI but old one doesn't
    if new_metadata.get("doi") and not literature.doi:
        return True
    
    # Update if new metadata has more complete fields
    # (This is a simple heuristic - you can make it more sophisticated)
    new_field_count = sum([
        1 for k in ["title", "authors", "journal", "year", "volume", "issue", "pages"]
        if new_metadata.get(k)
    ])
    
    old_field_count = sum([
        1 for k in ["title", "authors", "journal", "year", "volume", "issue", "pages"]
        if getattr(literature, k, None)
    ])
    
    
    # Only update if new metadata is significantly more complete
    return new_field_count > old_field_count


def _read_file_content(file_path: str) -> str:
    """
    Read content from a file (PDF or text).
    """
    file_ext = os.path.splitext(file_path)[1].lower()
    
    if file_ext == '.pdf':
        try:
            with open(file_path, 'rb') as f:
                content_bytes = f.read()
            return extract_pdf_text_fitz(content_bytes)
        except Exception as e:
            raise ValueError(f"Failed to read PDF: {e}")
    
    elif file_ext in ['.txt', '.md']:
        # Read text file
        with open(file_path, 'r', encoding='utf-8') as f:
            return f.read()
    
    else:
        raise ValueError(f"Unsupported file type: {file_ext}. Supported types: .pdf, .txt, .md")

def _read_file_bytes(file_path: str) -> bytes:
    """Helper to read file bytes"""
    with open(file_path, 'rb') as f:
        return f.read()


async def reprocess_literature(
    literature_id: int,
    db: AsyncSession,
    file_content: Optional[str] = None
) -> dict:
    """
    Reprocess an existing Literature record by re-extracting data.
    """
    try:
        logger.info("Reprocessing literature_id=%s", literature_id)
        # Step 1: Fetch Literature record
        literature = await get_literature_by_id(db, literature_id)
        
        if not literature:
            raise ValueError(f"Literature ID={literature_id} not found")
        
        logger.info("Found literature_id=%s title=%s", literature_id, literature.title[:50])
        resolved_file_path = _resolve_existing_path(literature.file_path)
        
        # Step 2: Get file content
        content = None
        
        if file_content:
            logger.info("Using provided file content for literature_id=%s chars=%s", literature_id, len(file_content))
            content = file_content
            literature.content = content
            
        elif literature.content:
            logger.info("Using stored content from database for literature_id=%s chars=%s", literature_id, len(literature.content))
            content = literature.content
            
        elif resolved_file_path:
            logger.info("Reading literature file from disk literature_id=%s path=%s", literature_id, resolved_file_path)
            try:
                content = _read_file_content(resolved_file_path)
                literature.content = content
            except Exception as e:
                raise ValueError(f"Failed to read file: {e}")
        else:
            message = "Literature does not have stored content. Please upload file."
            return {
                "success": False, 
                "message": message,
                "needs_upload": True
            }
        
        if not content or len(content.strip()) < 100:
            raise ValueError("File content is empty or too short")
        
        # Step 3: Re-run LLM
        logger.info("Starting LLM re-extraction for literature_id=%s", literature_id)
        
        extraction_result = await llm_service.extract_with_metadata(
            content=content,
            pdf_path=resolved_file_path,
            extraction_profile="auto",
            strict_cof_mode=False,
        )
        
        metadata_dict = extraction_result.get("metadata", {})
        data_list = extraction_result.get("data", [])
        if isinstance(data_list, list) and data_list:
            _apply_default_temperature(data_list)
            _normalize_record_chemistry(data_list)
            data_list, dropped_non_il = filter_to_supported_ionic_liquid_records(data_list)
            _annotate_records_with_identity(data_list)
            if dropped_non_il:
                logger.info("Dropped %s non-ionic-liquid records during reprocess", len(dropped_non_il))
        data_list, _merge_report, _ = _final_merge_records(data_list)
        await _annotate_review_secondary_records(
            db,
            literature,
            data_list,
            content=content,
        )
        
        # Step 5: Atomic Replace
        new_records: list[RecordCandidate] = []
        metric_dropped = 0
        for record_data in data_list:
            if not _resolve_primary_metric_key(record_data):
                metric_dropped += 1
                continue

            drop_reason = _get_drop_reason_for_final_record(record_data)
            if drop_reason:
                continue

            tribology_record, _ = _build_db_record_from_item(
                literature_id=literature_id,
                item=record_data,
                file_path=resolved_file_path,
                record_origin="reprocessed_extraction",
                model_cls=RecordCandidate,
            )
            new_records.append(tribology_record)
        
        if new_records:
            await db.execute(delete(RecordCandidate).where(RecordCandidate.literature_id == literature_id))
            await db.execute(delete(TribologyData).where(TribologyData.literature_id == literature_id))
            db.add_all(new_records)
            logger.info("Replaced literature_id=%s with %s reprocessed records", literature_id, len(new_records))
        if metric_dropped:
            logger.info(
                "Dropped %s records without a persistable quantitative metric during reprocess literature_id=%s",
                metric_dropped,
                literature_id,
            )
        
        # Step 5: Update Metadata
        if _should_update_metadata(literature, metadata_dict):
             if metadata_dict.get("title"): literature.title = metadata_dict["title"]
             if metadata_dict.get("doi"):
                 await _safe_update_doi(db, literature, metadata_dict["doi"])
             if metadata_dict.get("year"): literature.year = metadata_dict["year"]
        
        literature.status = 'completed'
        if new_records:
            _archive_completed_literature_pdf(literature, resolved_file_path)
        await db.commit()
        
        return {
            "success": True,
            "literature_id": literature_id,
            "reprocessed_count": len(new_records),
            "message": (
                f"Successfully reprocessed {len(new_records)} records"
                + (f"; skipped {metric_dropped} records without a persistable quantitative metric" if metric_dropped else "")
            ),
            "metadata": metadata_dict,
        }
        
    except Exception as e:
        logger.exception("Reprocessing failed for literature_id=%s", literature_id)
        await db.rollback()
        return {"success": False, "message": str(e)}


def _try_resolve_evidence_coords(db_record, item: dict, file_path: Optional[str]) -> None:
    """
    Attempt to resolve PDF bounding-box coordinates for an extracted record's evidence.

    Strategy (tried in order):
      1. If the LLM provided source_figure 鈫?search for the figure caption bbox
      2. Else if the record has evidence text 鈫?search for the text in the PDF

    On success, sets db_record.evidence_page and db_record.evidence_bbox (JSON string).
    This function is synchronous (PyMuPDF is CPU-bound, not I/O-bound) and fast.
    """
    file_path = _resolve_existing_path(file_path)
    if not file_path:
        return

    from utils.pdf_coords import (
        find_evidence_coordinates,
        find_figure_bbox,
        normalize_source_label,
        find_text_coordinates,
    )
    from types import SimpleNamespace

    # Accept multiple aliases from different extractor versions
    source_page = (
        item.get("source_page")
        or item.get("page_number")
        or item.get("evidence_page")
    )
    source_figure = (
        item.get("source_figure")
        or item.get("figure_reference")
        or item.get("source")
    )
    evidence_text = item.get("evidence", "") or item.get("exact_quote", "")

    # Normalize source label and persist it for downstream evidence UI.
    normalized_source = normalize_source_label(source_figure)
    if normalized_source:
        db_record.source = normalized_source
    elif item.get("source"):
        db_record.source = item.get("source")

    is_figure_source = bool(
        normalized_source and str(normalized_source).strip().lower().startswith("fig")
    )
    try:
        source_page_int = int(source_page) if source_page is not None else None
    except Exception:
        source_page_int = None
    if source_page_int and not getattr(db_record, "source_page", None):
        db_record.source_page = source_page_int

    provided_field_evidence = _parse_json_object(item.get("field_evidence_json")) or _parse_json_object(item.get("field_evidence"))
    if isinstance(provided_field_evidence, dict):
        primary_key = _resolve_primary_metric_key(item) or "cof"
        provided_entry = provided_field_evidence.get(primary_key)
        provided_evidence = provided_entry.get("evidence") if isinstance(provided_entry, dict) else None
        provided_bbox = _parse_json_bbox(provided_evidence.get("bbox")) if isinstance(provided_evidence, dict) else None
        provided_page = provided_evidence.get("page") if isinstance(provided_evidence, dict) else None
        try:
            provided_page_int = int(provided_page) if provided_page is not None else None
        except Exception:
            provided_page_int = None
        if provided_page_int and provided_bbox:
            db_record.evidence_page = provided_page_int
            db_record.evidence_bbox = json.dumps(provided_bbox)
            db_record.source_page = provided_page_int
            provided_label = _filled_text(provided_evidence.get("source_label")) if isinstance(provided_evidence, dict) else None
            if provided_label:
                db_record.source = provided_label
            return

    page, bbox = None, None

    # Strategy 1: figure label search (more accurate for figure-sourced data)
    if normalized_source:
        try:
            page, bbox = find_figure_bbox(file_path, normalized_source)
        except Exception as e:
            print(f"[EvidenceCoords] find_figure_bbox error: {e}")

    # Strategy 2: evidence text fuzzy search
    if not bbox and evidence_text:
        try:
            page, bbox = find_evidence_coordinates(
                file_path,
                evidence_text,
                page_hint=source_page_int,
                restrict_to_page_hint=bool(is_figure_source and source_page_int),
            )
        except Exception as e:
            print(f"[EvidenceCoords] find_evidence_coordinates error: {e}")

    # Strategy 3: keyword fallback (cof / IL / material) when evidence quote is not directly searchable
    if not bbox and (not is_figure_source or source_page_int):
        try:
            fallback_obj = SimpleNamespace(
                evidence=evidence_text,
                cof_raw=item.get("cof"),
                lubricant=item.get("ionic_liquid", item.get("lubricant")),
                material_name=item.get("material_name"),
            )
            fallback_queries = [
                q for q in [
                    getattr(fallback_obj, "cof_raw", None),
                    getattr(fallback_obj, "lubricant", None),
                    getattr(fallback_obj, "material_name", None),
                ]
                if q and str(q).strip()
            ]
            if fallback_queries:
                hits = find_text_coordinates(
                    file_path,
                    [
                        {
                            "id": "fallback",
                            "queries": fallback_queries,
                            "page_hint": source_page_int,
                            "restrict_to_page_hint": bool(is_figure_source and source_page_int),
                        }
                    ],
                )
                hit = next(
                    (
                        h for h in hits
                        if (h.get("w") or 0) > 0 and (h.get("h") or 0) > 0
                    ),
                    None,
                )
                if hit:
                    page = int(hit["page"])
                    x0 = float(hit["x"])
                    y0 = float(hit["y"])
                    w = float(hit["w"])
                    h = float(hit["h"])
                    bbox = [x0, y0, x0 + w, y0 + h]
                    if not db_record.source:
                        db_record.source = "Text"
        except Exception as e:
            print(f"[EvidenceCoords] fallback query search error: {e}")

    if page and bbox:
        db_record.evidence_page = page
        db_record.evidence_bbox = json.dumps(bbox)
        # Store the actual PDF page for downstream highlighting. Extractors may
        # provide article-page numbers, which are often offset by cover pages.
        db_record.source_page = int(page)
        print(f"[EvidenceCoords] Resolved: page={page}, bbox={bbox}")
    else:
        print(f"[EvidenceCoords] No match for record material={item.get('material_name', '?')}")
