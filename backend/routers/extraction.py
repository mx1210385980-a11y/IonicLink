import os
import uuid
import hashlib
import json
import re
from typing import List
from fastapi import APIRouter, UploadFile, File, HTTPException, Depends, BackgroundTasks, Query
import fitz  # PyMuPDF
import base64
import io
from pathlib import Path
from fastapi.responses import FileResponse

from sqlalchemy.ext.asyncio import AsyncSession

from models.tribology import TribologyData, ExtractionResponse, ChatRequest, LiteratureMetadata
from models.db_models import Literature, TribologyData as TribologyDataDB
from services.llm_service import llm_service
from services.data_sync_service import get_records_by_literature, get_all_literature
from services.score_service import calculate_confidence
from database import get_db
from security import (
    AuthPrincipal,
    RequestScope,
    ensure_scope_writable,
    get_current_principal,
    get_request_scope,
    literature_scope_conditions,
    require_literature_access,
    require_record_access,
    scope_filters,
)
from utils.pdf_utils import process_pdf_to_base64, extract_pdf_text_fitz
from services.file_service import save_upload_entry, process_file_safe, process_file_background
from services.extraction_trace_service import get_extraction_run, list_extraction_candidates
from services.extraction_trace_service import get_latest_extraction_run_by_literature
from services.agent_runtime_service import get_agent_runtime

router = APIRouter(prefix="/api", tags=["extraction"])

# 临时存储提取的数据
extracted_data_store: dict = {}
uploaded_files_store: dict = {}

# Ensure temp directory exists
TEMP_UPLOAD_DIR = "temp_uploads"
os.makedirs(TEMP_UPLOAD_DIR, exist_ok=True)


def _resolve_existing_path(raw_path: str | None) -> str | None:
    """Resolve relative storage paths regardless of current working directory."""
    if not raw_path:
        return None

    candidates = [raw_path]
    if not os.path.isabs(raw_path):
        backend_root = Path(__file__).resolve().parents[1]
        candidates.append(str((backend_root / raw_path).resolve()))

    for p in candidates:
        if p and os.path.exists(p):
            return p
    return None


def _normalize_term_key(value: str) -> str:
    return re.sub(r"[^a-z0-9]", "", str(value or "").lower().replace("μ", "u").replace("µ", "u"))


def _build_term_query_variants(term: str) -> list[str]:
    raw = str(term or "").strip()
    if len(raw) < 2:
        return []

    variants: list[str] = [raw, re.sub(r"\s+", " ", raw).strip()]
    lowered = raw.lower()

    # Micro symbol / unit variants (e.g. 1 μm/s, 1 um/s, 1 μm s−1).
    if "m/s" in lowered or "m s" in lowered:
        unit_swaps = [
            ("μ", "u"),
            ("μ", "µ"),
            ("µ", "u"),
            ("u", "μ"),
        ]
        expanded = set(variants)
        for base in list(expanded):
            for a, b in unit_swaps:
                expanded.add(base.replace(a, b))
        with_rate_forms = set()
        for base in expanded:
            with_rate_forms.add(base.replace("/s", " s-1"))
            with_rate_forms.add(base.replace("/s", " s−1"))
            with_rate_forms.add(base.replace(" s-1", "/s"))
            with_rate_forms.add(base.replace(" s−1", "/s"))
            with_rate_forms.add(base.replace(" / ", "/"))
        variants.extend(list(expanded))
        variants.extend(list(with_rate_forms))

    # Kelvin formatting variants (e.g. 298.15K <-> 298.15 K).
    kelvin_match = re.match(r"^\s*(\d+(?:\.\d+)?)\s*[kK]\s*$", raw)
    if kelvin_match:
        num = kelvin_match.group(1)
        variants.extend([f"{num}K", f"{num} K"])
        try:
            k_val = float(num)
            # Room-temperature style phrasing often used instead of explicit K value.
            if 293.0 <= k_val <= 300.0:
                variants.extend(["room temperature", "ambient temperature"])
        except Exception:
            pass

    # Keep order, remove duplicates/noise.
    deduped: list[str] = []
    seen: set[str] = set()
    for item in variants:
        candidate = re.sub(r"\s+", " ", str(item or "")).strip()
        if len(candidate) < 2:
            continue
        key = _normalize_term_key(candidate)
        if not key or key in seen:
            continue
        seen.add(key)
        deduped.append(candidate)
    return deduped


def _extract_numeric_values(text: str) -> list[float]:
    values: list[float] = []
    for token in re.findall(r"-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?", str(text or "")):
        try:
            values.append(float(token))
        except Exception:
            continue
    return values


def _numeric_term_matches(term: str, matched_text: str) -> bool:
    term_values = _extract_numeric_values(term)
    matched_values = _extract_numeric_values(matched_text)
    if not term_values or not matched_values:
        return False
    for t in term_values:
        for m in matched_values:
            tol = max(1e-6, abs(t) * 0.01)
            if abs(t - m) <= tol:
                return True
    return False


def _build_visual_focus_queries(record: TribologyDataDB) -> list[str]:
    """
    Build high-priority queries for visual evidence localization.
    Prefer explicit μ/COF markers to refine figure bbox to a local subregion.
    """
    terms: list[str] = []
    seen: set[str] = set()

    def _add(raw: str | None):
        s = str(raw or "").strip()
        if len(s) < 2:
            return
        key = _normalize_term_key(s)
        if not key or key in seen:
            return
        seen.add(key)
        terms.append(s)

    cof_raw = str(getattr(record, "cof_raw", "") or "").strip()
    cof_value = getattr(record, "cof_value", None)
    potential = str(getattr(record, "potential", "") or "").strip()
    water = str(getattr(record, "water_content", "") or "").strip()

    _add(cof_raw)
    if cof_value is not None:
        try:
            val = float(cof_value)
            for fmt in (f"{val:.1f}", f"{val:.2f}", f"{val:.3f}", f"{val:.4f}"):
                _add(fmt.rstrip("0").rstrip("."))
        except Exception:
            pass

    # Prefix forms commonly appearing in legends.
    number_candidates = []
    m = re.search(r"-?\d+(?:\.\d+)?", cof_raw)
    if m:
        number_candidates.append(m.group(0))
    if cof_value is not None:
        try:
            val = float(cof_value)
            number_candidates.extend(
                [
                    f"{val:.1f}".rstrip("0").rstrip("."),
                    f"{val:.2f}".rstrip("0").rstrip("."),
                    f"{val:.3f}".rstrip("0").rstrip("."),
                ]
            )
        except Exception:
            pass
    for num in number_candidates:
        _add(f"μ={num}")
        _add(f"μ = {num}")
        _add(f"mu={num}")
        _add(f"mu = {num}")
        _add(f"cof={num}")
        _add(f"cof = {num}")

    # Secondary discriminators for curve labels.
    _add(potential)
    _add(water)

    queries: list[str] = []
    q_seen: set[str] = set()
    for term in terms:
        for q in _build_term_query_variants(term):
            if len(q.strip()) < 2:
                continue
            key = _normalize_term_key(q)
            if not key or key in q_seen:
                continue
            q_seen.add(key)
            queries.append(q)
    return queries


def _tighten_table_bbox_by_row(
    pdf_path: str,
    page_num: int | None,
    bbox: list | None,
    record: TribologyDataDB,
) -> list | None:
    if not pdf_path or not os.path.exists(pdf_path) or not page_num or not bbox or len(bbox) != 4:
        return bbox

    from utils.pdf_coords import find_text_coordinates

    cof_raw = str(getattr(record, "cof_raw", "") or "").strip()
    cof_value = getattr(record, "cof_value", None)
    lubricant = str(getattr(record, "lubricant", "") or "").strip()

    query_items: list[dict] = []
    cof_queries: list[str] = []
    if cof_raw:
        cof_queries.extend(_build_term_query_variants(cof_raw))
    if cof_value is not None:
        try:
            val = float(cof_value)
            for fmt in (f"{val:.1f}", f"{val:.2f}", f"{val:.3f}", f"{val:.4f}"):
                cof_queries.extend(_build_term_query_variants(fmt.rstrip("0").rstrip(".")))
        except Exception:
            pass
    cof_queries = list(dict.fromkeys(q for q in cof_queries if q and len(q.strip()) >= 2))
    if cof_queries:
        query_items.append(
            {
                "id": "cof",
                "queries": cof_queries,
                "page_hint": int(page_num),
                "restrict_to_page_hint": True,
                "anchor_bbox": bbox,
                "restrict_to_anchor_bbox": True,
            }
        )

    lubricant_queries: list[str] = []
    if lubricant:
        for candidate in [
            lubricant,
            lubricant.strip("()[]"),
            re.sub(r"[\[\]\(\)]", "", lubricant),
        ]:
            lubricant_queries.extend(_build_term_query_variants(candidate))
    lubricant_queries = list(dict.fromkeys(q for q in lubricant_queries if q and len(q.strip()) >= 2))
    if lubricant_queries:
        query_items.append(
            {
                "id": "lubricant",
                "queries": lubricant_queries,
                "page_hint": int(page_num),
                "restrict_to_page_hint": True,
                "anchor_bbox": bbox,
                "restrict_to_anchor_bbox": True,
            }
        )

    if not query_items:
        return bbox

    hits = find_text_coordinates(pdf_path, query_items)
    hit_map: dict[str, dict] = {}
    for hit in hits:
        if (hit.get("w") or 0) <= 0 or (hit.get("h") or 0) <= 0:
            continue
        hit_map.setdefault(str(hit.get("id") or ""), hit)

    cof_hit = hit_map.get("cof")
    lubricant_hit = hit_map.get("lubricant")

    def _to_rect(hit: dict) -> list[float]:
        x0 = float(hit.get("x") or 0)
        y0 = float(hit.get("y") or 0)
        w = float(hit.get("w") or 0)
        h = float(hit.get("h") or 0)
        return [x0, y0, x0 + w, y0 + h]

    if cof_hit and lubricant_hit:
        cx0, cy0, cx1, cy1 = _to_rect(cof_hit)
        lx0, ly0, lx1, ly1 = _to_rect(lubricant_hit)
        cof_cy = (cy0 + cy1) / 2.0
        lub_cy = (ly0 + ly1) / 2.0
        same_row_tol = max(10.0, max(cy1 - cy0, ly1 - ly0) * 2.2)
        if abs(cof_cy - lub_cy) <= same_row_tol:
            return [
                round(max(0.0, min(cx0, lx0) - 10.0), 2),
                round(max(0.0, min(cy0, ly0) - 6.0), 2),
                round(max(cx1, lx1) + 10.0, 2),
                round(max(cy1, ly1) + 6.0, 2),
            ]

    if cof_hit:
        x0, y0, x1, y1 = _to_rect(cof_hit)
        return [
            round(max(0.0, x0 - 8.0), 2),
            round(max(0.0, y0 - 6.0), 2),
            round(x1 + 8.0, 2),
            round(y1 + 6.0, 2),
        ]

    return bbox


def _pick_visual_source_label(source: str | None, source_figure: str | None) -> str:
    """
    Prefer the most specific visual source label (panel-level beats figure-level).
    """
    s = str(source or "").strip()
    sf = str(source_figure or "").strip()

    def _has_panel(text: str) -> bool:
        t = str(text or "").strip()
        if not t:
            return False
        return bool(
            re.search(r"\([a-z]\)", t, re.IGNORECASE)
            or re.search(r"\d+\s*[a-z]\b", t, re.IGNORECASE)
            or re.fullmatch(r"\d+\s*[a-z]", t, re.IGNORECASE)
        )

    label = s
    if _has_panel(sf):
        label = sf
    elif _has_panel(s):
        label = s
    elif sf and len(sf) > len(s):
        label = sf

    label = str(label or "").strip()
    # Normalize shorthand like "3f" -> "Fig. 3f"
    if re.fullmatch(r"\d+\s*[a-z]", label, re.IGNORECASE):
        label = f"Fig. {label}"
    elif re.fullmatch(r"\d+", label):
        label = f"Fig. {label}"
    return label


def _extract_panel_letter(source_label: str | None) -> str | None:
    text = str(source_label or "").strip()
    if not text:
        return None
    m = re.search(
        r"\bfig(?:ure)?\.?\s*\d+\s*(?:\(\s*([a-z])\s*\)|([a-z]))\b",
        text,
        re.IGNORECASE,
    )
    if m:
        return ((m.group(1) or m.group(2) or "").strip().lower() or None)
    m2 = re.fullmatch(r"\d+\s*([a-z])", text, re.IGNORECASE)
    if m2:
        return (m2.group(1) or "").strip().lower() or None
    return None


def _tighten_visual_bbox_by_panel(
    pdf_path: str,
    page_num: int | None,
    bbox: list | None,
    panel_letter: str | None,
) -> list | None:
    if not pdf_path or not os.path.exists(pdf_path) or not page_num or not bbox or len(bbox) != 4 or not panel_letter:
        return bbox
    try:
        x0, y0, x1, y1 = map(float, bbox[:4])
        bw = max(0.0, x1 - x0)
        bh = max(0.0, y1 - y0)
        if bw <= 1.0 or bh <= 1.0:
            return bbox

        doc = fitz.open(pdf_path)
        page = doc[int(page_num) - 1]
        page_w = float(page.rect.width)
        page_h = float(page.rect.height)
        doc.close()

        # Already compact enough, do not over-refine.
        if (bw / max(page_w, 1.0) <= 0.55) and (bh / max(page_h, 1.0) <= 0.35):
            return bbox

        coarse = (
            (bh / max(page_h, 1.0) > 0.42)
            or (bw / max(page_w, 1.0) > 0.72)
            or (bh / max(bw, 1.0) > 1.3)
        )
        if not coarse:
            return bbox

        idx = max(0, ord(panel_letter[0]) - ord("a"))
        # Split strategy: if region is already a single column, split rows only.
        if bw / max(page_w, 1.0) <= 0.55:
            cols = 1
            rows = 3 if idx >= 1 else 2
            col = 0
            row = min(rows - 1, idx)
        else:
            cols = 2
            rows = 3 if idx >= 3 else 2
            col = min(cols - 1, idx % 2)
            row = min(rows - 1, idx // 2)

        cell_w = bw / max(1, cols)
        cell_h = bh / max(1, rows)
        rx0 = x0 + col * cell_w
        rx1 = x0 + (col + 1) * cell_w
        ry0 = y0 + row * cell_h
        ry1 = y0 + (row + 1) * cell_h
        padx = max(4.0, min(16.0, cell_w * 0.08))
        pady = max(4.0, min(14.0, cell_h * 0.1))
        refined = [
            round(max(0.0, rx0 - padx), 2),
            round(max(0.0, ry0 - pady), 2),
            round(min(page_w, rx1 + padx), 2),
            round(min(page_h, ry1 + pady), 2),
        ]
        return refined
    except Exception:
        return bbox


def _extract_text_snippet(
    pdf_path: str,
    page_num: int,
    bbox: list | None = None,
    fallback_term: str | None = None,
    prefer_term_context: bool = False,
) -> str | None:
    """
    Extract a readable text snippet from a PDF page.
    Prefers text near bbox; falls back to term-centered snippet, then page head.
    """
    if not pdf_path or not os.path.exists(pdf_path) or page_num < 1:
        return None

    def _clean_pdf_text(text: str) -> str:
        # Common PDF ligatures / soft hyphen cleanup
        replacements = {
            "\ufb00": "ff",
            "\ufb01": "fi",
            "\ufb02": "fl",
            "\ufb03": "ffi",
            "\ufb04": "ffl",
            "\u00ad": "",  # soft hyphen
        }
        for k, v in replacements.items():
            text = text.replace(k, v)

        # Normalize micro symbols to Greek mu for consistency.
        text = text.replace("µ", "μ")

        # Heuristic fix: OCR/PDF extraction may misread friction coefficient "μ" as "m".
        # Keep this narrowly scoped to coefficient patterns to avoid changing legitimate "m" usage.
        text = re.sub(
            r"(?i)(friction\s+coefficient[^.;:\n]{0,80}?)\bm\s*=\s*(\d)",
            r"\1μ = \2",
            text,
        )
        text = re.sub(
            r"(?i)(coefficient\s+of\s+friction[^.;:\n]{0,80}?)\bm\s*=\s*(\d)",
            r"\1μ = \2",
            text,
        )
        text = re.sub(
            r"\(\s*m\s*=\s*(\d)",
            r"(μ = \1",
            text,
        )

        text = re.sub(r"\s+", " ", text).strip()
        return text

    def _sentence_context_from_page(full_text: str, term: str, max_chars: int = 420) -> str | None:
        cleaned_full = _clean_pdf_text(full_text)
        if not cleaned_full or not term:
            return None

        sentences = [
            s.strip()
            for s in re.split(r"(?<=[\.\!\?;。！？；])\s+", cleaned_full)
            if s and s.strip()
        ]
        if not sentences:
            return None

        term_lower = term.lower().strip()
        hit_idx = next((i for i, s in enumerate(sentences) if term_lower in s.lower()), None)
        if hit_idx is None:
            return None

        start = hit_idx
        end = hit_idx
        snippet = sentences[hit_idx]

        while len(snippet) < max_chars:
            can_left = start > 0
            can_right = end < len(sentences) - 1
            if not can_left and not can_right:
                break

            if can_right and len(snippet) + 1 + len(sentences[end + 1]) <= max_chars:
                end += 1
                snippet = snippet + " " + sentences[end]
                continue
            if can_left and len(snippet) + 1 + len(sentences[start - 1]) <= max_chars:
                start -= 1
                snippet = sentences[start] + " " + snippet
                continue
            break

        return snippet

    def _trim_snippet(text: str, max_chars: int = 420) -> str:
        snippet = _clean_pdf_text(text)
        if not snippet:
            return snippet

        if len(snippet) > max_chars:
            snippet = snippet[:max_chars]

        # Avoid ending at a broken token
        if re.search(r"[A-Za-z0-9]$", snippet):
            snippet = re.sub(r"\s+\S*$", "", snippet).strip()

        # Prefer ending at sentence boundary if possible
        matches = list(re.finditer(r"[\.!\?;。！？；]", snippet))
        if matches:
            last_end = matches[-1].end()
            if last_end >= 50:
                snippet = snippet[:last_end].strip()

        return snippet

    try:
        doc = fitz.open(pdf_path)
        page_idx = page_num - 1
        if page_idx >= len(doc):
            doc.close()
            return None

        page = doc[page_idx]
        page_text = page.get_text("text") or ""
        snippet = ""

        # For textual evidence, prefer taking context from full page text around key term.
        if prefer_term_context and fallback_term and page_text:
            term = str(fallback_term).strip()
            if term:
                sentence_context = _sentence_context_from_page(page_text, term, max_chars=420)
                if sentence_context:
                    snippet = sentence_context

        if not snippet and bbox and len(bbox) == 4:
            x0, y0, x1, y1 = [float(v) for v in bbox]
            clip = fitz.Rect(
                max(0, x0 - 140),
                max(0, y0 - 45),
                min(page.rect.width, x1 + 220),
                min(page.rect.height, y1 + 45),
            )
            snippet = page.get_text("text", clip=clip).strip()

        if (not snippet or len(snippet) < 24) and fallback_term and page_text:
            term = str(fallback_term).strip()
            if term:
                sentence_context = _sentence_context_from_page(page_text, term, max_chars=420)
                if sentence_context:
                    snippet = sentence_context

        if not snippet and page_text:
            snippet = page_text[:500].strip()

        doc.close()

        if not snippet:
            return None
        return _trim_snippet(snippet, max_chars=420)
    except Exception as e:
        print(f"[EvidenceSnippet] extract error: {e}")
        return None


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

    # Get associated TribologyData records
    from sqlalchemy import select as sa_select
    stmt = sa_select(TribologyDataDB).where(TribologyDataDB.literature_id == literature_id)
    result = await db.execute(stmt)
    records = result.scalars().all()

    if not records:
        return []

    # Build search terms from each record
    search_terms = []
    for rec in records:
        queries = build_search_queries_for_record(rec)
        search_terms.append({
            "id": f"{rec.id}",
            "queries": queries,
        })

    # Run text search
    highlights = find_text_coordinates(pdf_path, search_terms)

    return highlights


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
    from utils.pdf_utils import crop_region_to_base64, render_page_preview_with_bbox_to_base64

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
            is_table_source = bool(
                source_label_norm and str(source_label_norm).strip().lower().startswith("table")
            )
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

            # Refine visual focus to local μ/COF marker within the figure region.
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

    highlight_terms = []
    for term in [
        getattr(record, "cof_raw", None),
        str(getattr(record, "cof_value", "")) if getattr(record, "cof_value", None) is not None else None,
        getattr(record, "lubricant", None),
        getattr(record, "material_name", None),
        getattr(record, "temperature", None),
        getattr(record, "potential", None),
        getattr(record, "water_content", None),
        getattr(record, "speed_value", None),
        getattr(record, "load_value", None),
        getattr(record, "surface_roughness", None),
        getattr(record, "film_thickness", None),
    ]:
        if term and str(term).strip():
            highlight_terms.append(str(term).strip())
    # Keep order, remove duplicates
    highlight_terms = list(dict.fromkeys(highlight_terms))

    term_hits = []
    if has_pdf and highlight_terms and source_type != "visual":
        query_items = [
            {
                "id": f"term_{idx}",
                "queries": _build_term_query_variants(term),
                "page_hint": int(page) if page else None,
                "restrict_to_page_hint": bool(page),
                "anchor_bbox": bbox if bbox and len(bbox) == 4 else None,
            }
            for idx, term in enumerate(highlight_terms)
            if term and len(term.strip()) >= 2
        ]
        if query_items:
            hits = find_text_coordinates(pdf_path, query_items)
            id_to_term = {
                f"term_{idx}": term
                for idx, term in enumerate(highlight_terms)
                if term and len(term.strip()) >= 2
            }
            seen_terms = set()
            for hit in hits:
                term = id_to_term.get(hit.get("id", ""))
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
                        "inferred": inferred,
                    }
                )
                seen_terms.add(term)

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


@router.post("/upload")
async def upload_file(
    file: UploadFile = File(...),
    background_tasks: BackgroundTasks = BackgroundTasks(),
    db: AsyncSession = Depends(get_db),
    principal: AuthPrincipal = Depends(get_current_principal),
    scope: RequestScope = Depends(get_request_scope),
):
    """
    Upload file, persist to DB, and trigger background extraction if new.
    Non-destructive for existing files.
    """
    if not file.filename:
        raise HTTPException(status_code=400, detail="文件名不能为空")

    ensure_scope_writable(principal, scope)

    # 1. Save or Retrieve Entry (non-destructive)
    literature = await save_upload_entry(db, file, principal=principal, scope=scope)

    # 2. Trigger Extraction ONLY if it's a NEW file (pending)
    if literature.status == "pending":
        print(f"[Router] Queuing background extraction for NEW file {literature.id}")
        background_tasks.add_task(process_file_background, literature.id)
    else:
        print(f"[Router] Skipping extraction for EXISTING file {literature.id} (Status: {literature.status})")

    return {
        "success": True,
        "message": "File uploaded",
        "file_id": str(literature.id),
        "filename": literature.title,
        "status": literature.status,
    }


@router.post("/extract/{file_id}")
async def extract_data(
    file_id: str,
    force: bool = False,
    profile: str = Query("high_accuracy", pattern="^(high_accuracy|standard)$"),
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

        await require_literature_access(db, principal, lit_id, write=True)

        # 2. Process Safely (Synchronous Wait)
        print(f"[Extraction] Starting safe processing for Lit ID: {lit_id}")

        workflow_result = await get_agent_runtime().run_extraction_workflow(
            file_id=lit_id,
            force=force,
            profile=profile,
            strict_cof_mode=strict_cof_mode,
        )
        metadata = workflow_result.get("metadata") or {}
        data_list = workflow_result.get("data") or []
        extraction_summary = workflow_result.get("extraction_summary") or {}
        agent_workflow = workflow_result.get("agent_workflow") or {}

        if (extraction_summary or {}).get("dropped_by_reason", {}).get("in_progress"):
            return {
                "success": True,
                "status": "processing",
                "metadata": {},
                "data": [],
                "extraction_summary": extraction_summary,
                "agent_workflow": agent_workflow,
                "message": "Extraction is still running in the background. Please retry shortly."
            }

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
                "metadata": meta_obj,
                "data": data_list,
                "extraction_summary": extraction_summary,
                "agent_workflow": agent_workflow,
                "message": f"Successfully extracted {len(data_list)} records."
            }
        else:
            return {
                "success": False,
                "metadata": {},
                "data": [],
                "extraction_summary": extraction_summary,
                "agent_workflow": agent_workflow,
                "message": "No data extracted or processing failed."
            }

    except HTTPException:
        raise
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/data/{file_id}", response_model=List[TribologyData])
async def get_extracted_data(
    file_id: str,
    db: AsyncSession = Depends(get_db),
    principal: AuthPrincipal = Depends(get_current_principal),
):
    """获取已提取的数据"""
    try:
        lit_id = int(file_id)
        literature = await require_literature_access(db, principal, lit_id)
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
        return records
    except ValueError:
        if file_id in extracted_data_store:
            return extracted_data_store[file_id]["data"]
        raise HTTPException(status_code=404, detail="Invalid File ID or Data Not Found")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/data")
async def get_all_data(
    db: AsyncSession = Depends(get_db),
    scope: RequestScope = Depends(get_request_scope),
):
    """获取所有提取的数据"""
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
    db: AsyncSession = Depends(get_db),
    principal: AuthPrincipal = Depends(get_current_principal),
):
    await require_literature_access(db, principal, literature_id)
    run = await get_latest_extraction_run_by_literature(db, literature_id)
    if not run:
        raise HTTPException(status_code=404, detail=f"No extraction runs for literature '{literature_id}'")

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
    """与AI助手对话"""

    context = None
    if request.context:
        context = request.context
    else:
        if uploaded_files_store:
            latest_file = list(uploaded_files_store.values())[-1]
            context = latest_file["content"][:3000]
        else:
            recent_lits = await get_all_literature(db, limit=1, scope_filter_values=scope_filters(scope))
            if recent_lits:
                context = recent_lits[0].content[:3000] if recent_lits[0].content else ""

    response = await llm_service.chat(request.message, context)

    return {
        "success": True,
        "response": response
    }
