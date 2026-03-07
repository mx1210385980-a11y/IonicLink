import os
import uuid
import hashlib
import json
import re
from typing import List
from fastapi import APIRouter, UploadFile, File, HTTPException, Depends, BackgroundTasks
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
from utils.pdf_utils import process_pdf_to_base64, extract_pdf_text_fitz
from services.file_service import save_upload_entry, process_file_safe, process_file_background

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
async def serve_pdf(literature_id: int, db: AsyncSession = Depends(get_db)):
    """Serve the uploaded PDF file for the Source Grounding PDF viewer."""
    literature = await db.get(Literature, literature_id)
    if not literature:
        raise HTTPException(status_code=404, detail="Literature not found")

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
async def get_pdf_highlights(literature_id: int, db: AsyncSession = Depends(get_db)):
    """
    Return bounding-box coordinates for extracted data text found in the PDF.
    Uses fitz (PyMuPDF) text search to locate each TribologyData record's text.
    """
    from utils.pdf_coords import find_text_coordinates, build_search_queries_for_record

    literature = await db.get(Literature, literature_id)
    if not literature:
        raise HTTPException(status_code=404, detail="Literature not found")

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
    stmt = sa_select(TribologyDataDB).where(
        TribologyDataDB.id == record_id,
        TribologyDataDB.literature_id == literature_id
    )
    result = await db.execute(stmt)
    record = result.scalar_one_or_none()

    if not record:
        raise HTTPException(status_code=404, detail="Record not found")

    literature = await db.get(Literature, literature_id)
    if not literature:
        raise HTTPException(status_code=404, detail="Literature not found")

    evidence_text = getattr(record, 'evidence', None)
    evidence_page = getattr(record, 'evidence_page', None)
    evidence_bbox_raw = getattr(record, 'evidence_bbox', None)
    source_label = getattr(record, 'source', None)
    source_label_norm = normalize_source_label(source_label) or source_label

    pdf_path = _resolve_existing_path(literature.file_path)
    has_pdf = bool(pdf_path)
    image_b64 = None
    page_preview_b64 = None
    page = evidence_page
    bbox = None

    if evidence_bbox_raw:
        try:
            bbox = json_mod.loads(evidence_bbox_raw)
        except Exception:
            bbox = None

    if has_pdf:
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
                    [{"id": str(record_id), "queries": queries}],
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
    if has_pdf and highlight_terms:
        query_items = [
            {
                "id": f"term_{idx}",
                "queries": _build_term_query_variants(term),
                "page_hint": int(page) if page else None,
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
                term_key = _normalize_term_key(term)
                match_key = _normalize_term_key(matched_text)
                inferred = bool(match_key and term_key and match_key != term_key)
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
    if has_pdf and page:
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

    return {
        "record_id": record_id,
        "evidence_text": evidence_text,
        "text_snippet": text_snippet,
        "highlight_terms": highlight_terms,
        "term_hits": term_hits,
        "source": source_label_norm,
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
    db: AsyncSession = Depends(get_db)
):
    """
    Upload file, persist to DB, and trigger background extraction if new.
    Non-destructive for existing files.
    """
    if not file.filename:
        raise HTTPException(status_code=400, detail="文件名不能为空")

    # 1. Save or Retrieve Entry (non-destructive)
    literature = await save_upload_entry(db, file)

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
    db: AsyncSession = Depends(get_db)
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

        # 2. Process Safely (Synchronous Wait)
        print(f"[Extraction] Starting safe processing for Lit ID: {lit_id}")

        metadata, data_list = await process_file_safe(
            file_id=lit_id,
            force=force
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
                "metadata": meta_obj,
                "data": data_list,
                "message": f"Successfully extracted {len(data_list)} records."
            }
        else:
            return {
                "success": False,
                "metadata": {},
                "data": [],
                "message": "No data extracted or processing failed."
            }

    except HTTPException:
        raise
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/data/{file_id}", response_model=List[TribologyData])
async def get_extracted_data(file_id: str, db: AsyncSession = Depends(get_db)):
    """获取已提取的数据"""
    try:
        lit_id = int(file_id)
        records = await get_records_by_literature(db, lit_id)
        return records
    except ValueError:
        if file_id in extracted_data_store:
            return extracted_data_store[file_id]["data"]
        raise HTTPException(status_code=404, detail="Invalid File ID or Data Not Found")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/data")
async def get_all_data():
    """获取所有提取的数据"""
    all_data = []
    for data_list in extracted_data_store.values():
        all_data.extend(data_list)
    return all_data


@router.post("/chat")
async def chat(request: ChatRequest, db: AsyncSession = Depends(get_db)):
    """与AI助手对话"""

    context = None
    if request.context:
        context = request.context
    else:
        if uploaded_files_store:
            latest_file = list(uploaded_files_store.values())[-1]
            context = latest_file["content"][:3000]
        else:
            recent_lits = await get_all_literature(db, limit=1)
            if recent_lits:
                context = recent_lits[0].content[:3000] if recent_lits[0].content else ""

    response = await llm_service.chat(request.message, context)

    return {
        "success": True,
        "response": response
    }
