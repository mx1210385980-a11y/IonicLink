"""
File Service for IonicLink
Handles file-based operations including reprocessing of Literature records.
"""

import json
import os
import re
import uuid
import asyncio
import logging
import time
import hashlib
import fitz
from difflib import SequenceMatcher
from datetime import datetime, timedelta
from typing import Any, Optional

from fastapi import UploadFile
from sqlalchemy import delete, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from utils.pdf_utils import extract_pdf_text_fitz
from database import async_session_maker
from models.db_models import ExtractionRun, Literature, RecordCandidate, TribologyData
from services.llm_service import llm_service
from services.llm.deduplication import deduplicate_records_with_report
from services.data_sync_service import get_literature_by_id
from services.doi_service import DOIService
from services.llm.utils import normalize_record_value
from knowledge_base import normalize_ionic_liquid
from services.score_service import calculate_confidence
from services.fallback_extraction_service import extract_metadata_fallback, extract_table_fallback_records
from services.il_resolver_service import filter_to_supported_ionic_liquid_records, resolve_il
from services.extraction_trace_service import (
    add_extraction_candidates,
    create_extraction_run,
    finalize_extraction_run,
    update_extraction_run_progress,
)
from models.tribology import TribologyData as ExtractTribologyData
from security import AuthPrincipal, RequestScope, build_scope_key, can_manage_literature

TEMP_UPLOAD_DIR = "temp_uploads"
logger = logging.getLogger(__name__)


def _resolve_confidence(raw: object, record_like: dict) -> float:
    try:
        if raw is not None and str(raw).strip() != "":
            return float(raw)
    except Exception:
        pass
    return float(calculate_confidence(record_like or {}))


def _title_key(value: Optional[str]) -> str:
    text = str(value or "").strip().lower()
    text = re.sub(r"\.pdf$", "", text, flags=re.IGNORECASE)
    text = re.sub(r"^[12]\d{3}[-_\s]*(an|a|the)?[-_\s]*", "", text, flags=re.IGNORECASE)
    text = re.sub(r"[^a-z0-9]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def _extract_doi_candidates(text_content: str, filename: str) -> list[str]:
    patterns = [
        r"\b10\.\d{4,9}/[-._;()/:A-Z0-9]+\b",
        r"\b10\.\d{4,9}/\S+\b",
    ]
    merged = f"{text_content or ''}\n{filename or ''}"
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

    candidates = [raw_path]
    if not os.path.isabs(raw_path):
        backend_root = os.path.dirname(os.path.dirname(__file__))
        workspace_root = os.path.dirname(backend_root)
        candidates.append(os.path.abspath(os.path.join(backend_root, raw_path)))
        candidates.append(os.path.abspath(os.path.join(workspace_root, raw_path)))

    for p in candidates:
        if p and os.path.exists(p):
            return p
    return None


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
    return text in {"", "unknown", "unknown il", "n/a", "none", "-", "--"}


def _normalize_il_token(token: str) -> str:
    text = str(token or "").strip()
    text = re.sub(r"\]\s+\[", "][", text)
    text = re.sub(r"\]\s*i\s*\[", "]i[", text, flags=re.IGNORECASE)
    return text


def _extract_il_candidates(text: str) -> list[str]:
    if not text:
        return []
    candidates: list[str] = []
    def _canonicalize_il(value: Optional[str]) -> str:
        token = str(value or "").strip()
        if not token:
            return ""
        token_l = token.lower()
        if "ethylammonium nitrate" in token_l or re.search(r"\bean\b", token_l):
            return "EAN"
        if "ethaline" in token_l:
            return "Ethaline"
        m = re.search(r"(\[[^\[\]]+?\]\s*(?:i\s*)?\[[^\[\]]+?\])", token)
        if m:
            return re.sub(r"\s+", "", m.group(1)).replace("]i[", "][")
        if len(token) > 80:
            return ""
        return token
    patterns = [
        r"(\[[^\[\]]+?\]\s*\[[^\[\]]+?\])",
        r"(\[[^\[\]]+?\]\s*i\s*\[[^\[\]]+?\])",
    ]
    for pat in patterns:
        for hit in re.findall(pat, text, flags=re.IGNORECASE):
            token = _normalize_il_token(hit)
            if not token:
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
    if normalized_text and normalized_text not in candidates and not _is_unknown_il(normalized_text):
        candidates.append(normalized_text)
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
_FIELD_EVIDENCE_REQUIRED_KEYS = ("material", "ionic_liquid", "cof")


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
    if _looks_like_trend_record(item):
        return "trend_statement"
    return None


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
        },
    }


def _build_field_evidence_map(item: dict, db_record: TribologyData, *, confidence: float) -> dict[str, Any]:
    source_label = getattr(db_record, "source", None) or getattr(db_record, "source_figure", None) or item.get("source")
    page = getattr(db_record, "evidence_page", None) or getattr(db_record, "source_page", None) or item.get("source_page")
    quote = _filled_text(item.get("evidence")) or _filled_text(item.get("notes")) or None
    bbox = _parse_json_bbox(getattr(db_record, "evidence_bbox", None))
    sample_id = _filled_text(item.get("sample_id")) or None
    source_type = _infer_source_type(source_label) if any([source_label, page, quote, bbox, sample_id]) else None

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
    return {key: value for key, value in entries.items() if value}


def _field_entry_has_evidence(entry: Optional[dict[str, Any]]) -> bool:
    evidence = (entry or {}).get("evidence") or {}
    return any(
        evidence.get(key) not in (None, "", [])
        for key in ("page", "source_label", "quote", "bbox", "sample_id", "source_type")
    )


def _resolve_review_status(field_evidence_map: dict[str, Any]) -> tuple[str, Optional[str]]:
    missing = [key for key in _FIELD_EVIDENCE_REQUIRED_KEYS if not _field_entry_has_evidence(field_evidence_map.get(key))]
    if missing:
        return "needs_evidence", f"Missing field evidence for: {', '.join(missing)}"
    return "pending_review", None


def _record_to_response_item(record: Any) -> dict[str, Any]:
    cof_str = record.cof_raw if record.cof_raw else (str(record.cof_value) if record.cof_value else None)
    return {
        "id": str(record.id),
        "material_name": record.material_name,
        "lubricant": record.lubricant,
        "ionic_liquid": record.lubricant,
        "cof": cof_str,
        "cof_value": record.cof_value,
        "cof_operator": record.cof_operator,
        "cof_raw": record.cof_raw,
        "load": record.load_raw or record.load_value,
        "load_value": record.load_value,
        "load_raw": record.load_raw,
        "speed": record.speed_value,
        "speed_value": record.speed_value,
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
        "surface_roughness": record.surface_roughness,
        "film_thickness": record.film_thickness,
        "residual_film_thickness_d": record.residual_film_thickness_d,
        "layer_spacing_delta": record.layer_spacing_delta,
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
        "field_evidence_json": _parse_json_object(record.field_evidence_json),
        "review_status": record.review_status,
        "record_origin": record.record_origin,
        "assembly_notes": record.assembly_notes,
    }


async def _count_cached_record_artifacts(db: AsyncSession, literature_id: int) -> tuple[int, int]:
    candidate_count = (
        await db.execute(select(func.count(RecordCandidate.id)).where(RecordCandidate.literature_id == literature_id))
    ).scalar() or 0
    final_count = (
        await db.execute(select(func.count(TribologyData.id)).where(TribologyData.literature_id == literature_id))
    ).scalar() or 0
    return int(candidate_count), int(final_count)


def _is_no_data_message(value: Optional[str]) -> bool:
    normalized = str(value or "").strip().lower()
    return normalized in {"no tribology data found", "no extractable records found"}


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

    no_data_message = "No extractable records found"
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
    db_record = model_cls(
        literature_id=literature_id,
        material_name=item.get("material_name", "Unknown"),
        lubricant=item.get("ionic_liquid", item.get("lubricant", "")),
        cof_value=_parse_cof_value(item.get("cof")),
        cof_operator=item.get("cof_operator"),
        cof_raw=item.get("cof"),
        load_value=item.get("load") or item.get("normal_load"),
        load_raw=item.get("load") or item.get("normal_load"),
        speed_value=item.get("speed"),
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
        record_origin=record_origin,
    )
    _try_resolve_evidence_coords(db_record, item, file_path)
    field_evidence_map = _build_field_evidence_map(item, db_record, confidence=confidence)
    review_status, assembly_notes = _resolve_review_status(field_evidence_map)
    db_record.field_evidence_json = _safe_json_dumps(field_evidence_map)
    db_record.review_status = review_status
    db_record.assembly_notes = assembly_notes

    response_item = dict(item)
    response_item.update(
        {
            "sample_id": db_record.sample_id,
            "series_id": db_record.series_id,
            "field_evidence_json": field_evidence_map,
            "review_status": review_status,
            "record_origin": record_origin,
            "assembly_notes": assembly_notes,
        }
    )
    return db_record, response_item


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
    for i, r in enumerate(db_records):
        cof_str = r.cof_raw if r.cof_raw else (str(r.cof_value) if r.cof_value else None)
        cached_item = {
            "material_name": r.material_name,
            "ionic_liquid": r.lubricant,
            "cof": cof_str,
            "load": r.load_raw or r.load_value,
            "speed": r.speed_value,
            "temperature": r.temperature,
            "evidence": r.evidence,
            "source": r.source,
            "source_page": r.source_page,
            "source_figure": r.source_figure,
            "sample_id": r.sample_id,
            "series_id": r.series_id,
        }
        parsed_field_evidence = _parse_json_object(r.field_evidence_json)
        if not parsed_field_evidence:
            parsed_field_evidence = _build_field_evidence_map(cached_item, r, confidence=r.confidence)
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
    cache_summary = {
        "run_id": None,
        "candidate_count": len(data_list),
        "final_count": len(data_list),
        "dropped_by_reason": {},
        "page_coverage": {},
        "page_candidate_counts": {},
        "progress_log": [],
    }
    return metadata, data_list, cache_summary


def _filled_text(value: object) -> str:
    return str(value or "").strip()


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
            fallback["probe_distinct"] > cached["probe_distinct"],
            fallback["substrate_distinct"] > cached["substrate_distinct"],
            fallback["ionic_distinct"] > cached["ionic_distinct"],
        ]
    )


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
    if not _fallback_improves_cached_records(cached_records, fallback_records):
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
        content_bytes = await file.read()
        await file.seek(0)
        file_hash = hashlib.sha256(content_bytes).hexdigest() if content_bytes else None
        
        # 2. Extract Text & DOI Check
        text_content = ""
        if file.filename.lower().endswith('.pdf'):
            from utils.pdf_utils import extract_pdf_text_fitz
            text_content = extract_pdf_text_fitz(content_bytes)
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
                if file.filename.lower().endswith('.pdf') and (not existing_hash_match.file_path or not os.path.exists(existing_hash_match.file_path)):
                    pdf_dir = os.path.join(TEMP_UPLOAD_DIR, "pdfs")
                    os.makedirs(pdf_dir, exist_ok=True)
                    pdf_path = os.path.join(pdf_dir, f"{existing_hash_match.id}.pdf")
                    with open(pdf_path, 'wb') as f:
                        f.write(content_bytes)
                    existing_hash_match.file_path = pdf_path
                    logger.info("Backfilled PDF for literature_id=%s path=%s", existing_hash_match.id, pdf_path)
                await db.commit()
                return existing_hash_match
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
                if file.filename.lower().endswith('.pdf') and (not existing_doi_match.file_path or not os.path.exists(existing_doi_match.file_path)):
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
                if file.filename.lower().endswith('.pdf') and (not fallback_match.file_path or not os.path.exists(fallback_match.file_path)):
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
        # Generate a temporary DOI for files without DOI
        temp_doi = f"temp-{int(__import__('time').time() * 1000)}"
        
        new_lit = Literature(
            title=file.filename,
            doi=temp_doi,
            authors="",
            journal="",
            year=0,
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
        if file.filename.lower().endswith('.pdf'):
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
            item["temperature"] = "298.15 K"


def _format_numeric_text(value: float) -> str:
    if float(value).is_integer():
        return str(int(value))
    return f"{value:.3f}".rstrip("0").rstrip(".")


def _normalize_thickness_value(value: object) -> Optional[str]:
    text = str(value or "").strip()
    if not text or text.lower() in {"-", "--", "n/a", "none", "unknown"}:
        return None

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


def _normalize_record_chemistry(records: list[dict]) -> None:
    for item in records or []:
        if not isinstance(item, dict):
            continue

        raw_film_candidate = item.get("film_thickness")
        item["film_thickness"] = _normalize_thickness_value(raw_film_candidate)
        for field in ("residual_film_thickness_d", "layer_spacing_delta"):
            item[field] = _normalize_thickness_value(item.get(field))

        il_candidates: list[object] = [
            raw_film_candidate if raw_film_candidate and not item.get("film_thickness") else None,
            item.get("evidence"),
            item.get("notes"),
            item.get("ionic_liquid"),
            item.get("lubricant"),
        ]
        if not any(candidate and not _is_unknown_il(candidate) for candidate in il_candidates):
            il_candidates.extend([
                item.get("cation") and item.get("anion") and f"[{item.get('cation')}][{item.get('anion')}]",
                raw_film_candidate,
            ])

        canonical_name: Optional[str] = None
        resolved: dict = {}
        for candidate in il_candidates:
            canonical_name, resolved = _canonicalize_ionic_liquid_name(candidate)
            if canonical_name:
                break

        if canonical_name:
            item["ionic_liquid"] = canonical_name
            item["lubricant"] = canonical_name

        if resolved.get("cation"):
            item["cation"] = resolved["canonical_name"].split("][")[0].lstrip("[") if resolved.get("canonical_name") else resolved["cation"]
        if resolved.get("anion"):
            item["anion"] = resolved["canonical_name"].split("][")[-1].rstrip("]") if resolved.get("canonical_name") else resolved["anion"]
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
    profile: str = "high_accuracy",
    strict_cof_mode: Optional[bool] = None,
):
    """
    Process file with an ISOLATED database session. 
    Returns (metadata_dict, data_list, extraction_summary) for immediate frontend display.
    Handles caching logic internally.
    """
    profile = (profile or "high_accuracy").strip().lower()
    if profile not in {"high_accuracy", "standard"}:
        profile = "high_accuracy"
    resolved_strict_cof_mode = (profile == "high_accuracy") if strict_cof_mode is None else bool(strict_cof_mode)
    logger.info(
        "Starting isolated processing literature_id=%s profile=%s strict_cof_mode=%s force=%s",
        file_id,
        profile,
        resolved_strict_cof_mode,
        force,
    )
    
    # 1. Open Scoped Session
    async with async_session_maker() as db:
        run_id = uuid.uuid4().hex
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

                is_stale = False
                if running_run:
                    try:
                        now_utc = datetime.utcnow()
                        last_touch = running_run.updated_at or running_run.created_at
                        if last_touch:
                            stale_minutes = 4 if profile == "high_accuracy" else 3
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
                    logger.info("Returning cached no-data result for literature_id=%s", file_id)
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
                        "current_message": "No extractable records found",
                        "progress_log": [{"stage": "stage_e.finalize", "message": "No extractable records found"}],
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

            await create_extraction_run(
                db,
                run_id=run_id,
                literature_id=literature.id,
                extractor_type="tribology",
                profile=profile,
            )
            run_created = True
            await db.commit()

            last_progress_flush = 0.0

            async def _persist_run_progress(progress_event: dict) -> None:
                nonlocal last_progress_flush
                if not run_created:
                    return

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

                try:
                    await update_extraction_run_progress(
                        db,
                        run_id=run_id,
                        candidate_count=summary_patch["candidate_count"],
                        dropped_by_reason=summary_patch["dropped_by_reason"],
                        page_coverage=summary_patch["page_coverage"],
                        summary_patch=summary_patch,
                    )
                    await db.commit()
                    last_progress_flush = now_mono
                except Exception as progress_err:
                    # Progress persistence must never break extraction.
                    logger.warning("Progress persistence failed for run_id=%s: %s", run_id, progress_err)

            # Call LLM (smart routing: pass pdf_path so visual pages go to Qwen-VL only)
            extract_timeout_s = 960 if profile == "high_accuracy" else 720
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
            
            records = result.get("data", [])
            metadata = result.get("metadata", {})
            llm_summary = result.get("extraction_summary", {}) or {}
            trace_candidates = result.get("trace_candidates", []) or []

            fallback_metadata = extract_metadata_fallback(content)
            if fallback_metadata:
                metadata = {
                    **fallback_metadata,
                    **{k: v for k, v in (metadata or {}).items() if v not in (None, "", [])},
                }

            # Deterministic IL backfill for unknown labels using PDF caption/page text context.
            if isinstance(records, list) and records:
                _backfill_unknown_il_records(records, resolved_file_path)
            elif content:
                fallback_records, fallback_info = extract_table_fallback_records(content, resolved_file_path)
                if fallback_records:
                    logger.info(
                        "Fallback extraction recovered %s records from %s on page %s",
                        len(fallback_records),
                        fallback_info.get("matched_table"),
                        fallback_info.get("matched_page"),
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
                        "candidate_count": max(
                            int(llm_summary.get("candidate_count") or 0),
                            len(fallback_records),
                        ),
                        "final_count": len(fallback_records),
                        "dropped_by_reason": llm_summary.get("dropped_by_reason") or {},
                        "fallback_extraction": fallback_info,
                    }

            if isinstance(records, list) and records:
                _apply_default_temperature(records)
                _normalize_record_chemistry(records)
                records, dropped_non_il = filter_to_supported_ionic_liquid_records(records)
                _annotate_records_with_identity(records)
                if dropped_non_il:
                    logger.info("Dropped %s non-ionic-liquid records before persistence", len(dropped_non_il))
            
            # 5. Save Results
            if records:
                # Clear both stale candidates and stale approved final records before writing a new review queue.
                await db.execute(delete(RecordCandidate).where(RecordCandidate.literature_id == literature.id))
                await db.execute(delete(TribologyData).where(TribologyData.literature_id == literature.id))

                # Stage E final merge (single dedup pass only).
                records, merge_report, stage_e_candidates = _final_merge_records(records)

                new_records_db: list[RecordCandidate] = []
                response_rows: list[tuple[RecordCandidate, dict[str, Any]]] = []
                no_cof_dropped = 0
                blocked_by_reason: dict[str, int] = {}
                
                for i, item in enumerate(records):
                    cof_raw = item.get("cof")
                    cof_value = _parse_cof_value(cof_raw)
                    if cof_value is None:
                        no_cof_dropped += 1
                        stage_e_candidates.append(
                            {
                                "stage": "stage_e",
                                "modality": "merge",
                                "page": item.get("source_page"),
                                "source_figure": item.get("source_figure"),
                                "raw": item,
                                "normalized": item,
                                "drop_reason": "no_cof_value",
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
                    new_records_db.append(db_record)
                    response_rows.append((db_record, response_item))
                
                db.add_all(new_records_db)
                await db.flush()
                response_data_list = []
                for db_record, response_item in response_rows:
                    response_item["id"] = str(db_record.id)
                    response_data_list.append(response_item)
                
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
                
                literature.status = "completed"
                literature.error_message = None
                logger.info("Saved %s extracted records for literature_id=%s", len(new_records_db), literature.id)

                await add_extraction_candidates(
                    db,
                    run_id=run_id,
                    candidates=[*trace_candidates, *stage_e_candidates],
                )

                persisted_candidate_count = len(trace_candidates) + len(stage_e_candidates)
                dropped_by_reason = {
                    **(llm_summary.get("dropped_by_reason") or {}),
                    **(merge_report.get("dropped_by_reason") or {}),
                    **blocked_by_reason,
                }
                if no_cof_dropped:
                    dropped_by_reason["no_cof_value"] = int(dropped_by_reason.get("no_cof_value") or 0) + no_cof_dropped
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
                no_data_message = "No extractable records found"
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
                )
                await db.commit()
                return metadata, [], extraction_summary
                
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


async def process_file_background(file_id: int, extractor_type: str = "tribology"):
    """
    Background Task for File Processing with Idempotency Check.
    Wraps process_file_safe with an additional status check to prevent overwriting completed files.
    """
    logger.info("Starting background processing for literature_id=%s", file_id)

    if extractor_type == "diffusion":
        from services.diffusion.diffusion_extractor_service import process_diffusion_file_background

        await process_diffusion_file_background(file_id)
        return
    
    async with async_session_maker() as db:
        try:
            # 1. Fetch Record
            result = await db.execute(select(Literature).where(Literature.id == file_id))
            literature = result.scalar_one_or_none()
            
            if not literature:
                logger.warning("Background processing skipped because literature_id=%s was not found", file_id)
                return

            # --- 鉁?ULTIMATE GUARD: DATA EXISTENCE CHECK ---
            # Don't trust 'status'. Trust the data.
            # If we already have extracted records, DO NOT DELETE THEM.
            candidate_count, final_count = await _count_cached_record_artifacts(db, file_id)
            data_count = candidate_count or final_count
            
            if data_count > 0:
                logger.info("Background processing aborted for literature_id=%s existing_records=%s", file_id, data_count)
                # Self-healing: Ensure status reflects reality
                if literature.status != 'completed':
                    logger.info("Updating literature_id=%s status to completed during self-heal", file_id)
                    literature.status = 'completed'
                    await db.commit()
                return
            if await _normalize_legacy_no_data_state(
                db,
                literature,
                candidate_count=candidate_count,
                final_count=final_count,
            ):
                logger.info("Background processing aborted for literature_id=%s normalized to no_data", file_id)
                await db.commit()
                return
            # ------------------------------------------------

            # 2. Update Status to Processing (Only if not completed)
            literature.status = "processing"
            await db.commit()
            
            # 3. Process Logic (Delegate to safe function)
            # process_file_safe will handle the actual extraction, saving, and final status update
            logger.info("Delegating background processing to process_file_safe for literature_id=%s", file_id)
            await process_file_safe(file_id)
            
        except Exception as e:
            logger.exception("Background processing failed for literature_id=%s", file_id)
            import traceback
            traceback.print_exc()

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
            extraction_profile="high_accuracy",
            strict_cof_mode=True,
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
        
        # Step 5: Atomic Replace
        new_records: list[RecordCandidate] = []
        no_cof_dropped = 0
        for record_data in data_list:
            cof_raw = record_data.get("cof")
            cof_value = _parse_cof_value(cof_raw)
            if cof_value is None:
                no_cof_dropped += 1
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
        if no_cof_dropped:
            logger.info("Dropped %s records without COF during reprocess literature_id=%s", no_cof_dropped, literature_id)
        
        # Step 5: Update Metadata
        if _should_update_metadata(literature, metadata_dict):
             if metadata_dict.get("title"): literature.title = metadata_dict["title"]
             if metadata_dict.get("doi"):
                 await _safe_update_doi(db, literature, metadata_dict["doi"])
             if metadata_dict.get("year"): literature.year = metadata_dict["year"]
        
        literature.status = 'completed'
        await db.commit()
        
        return {
            "success": True,
            "literature_id": literature_id,
            "reprocessed_count": len(new_records),
            "message": f"Successfully reprocessed {len(new_records)} records",
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
        if not getattr(db_record, "source_page", None):
            db_record.source_page = int(page)
        print(f"[EvidenceCoords] Resolved: page={page}, bbox={bbox}")
    else:
        print(f"[EvidenceCoords] No match for record material={item.get('material_name', '?')}")


