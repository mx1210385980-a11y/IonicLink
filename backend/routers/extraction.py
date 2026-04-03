import os
import json
import logging
import re
from typing import List
from fastapi import APIRouter, UploadFile, File, HTTPException, Depends, BackgroundTasks, Query, Request
import base64
from fastapi.responses import FileResponse

from sqlalchemy.ext.asyncio import AsyncSession

from models.tribology import TribologyData, ChatRequest, LiteratureMetadata
from models.db_models import TribologyData as TribologyDataDB
from services.llm_service import llm_service
from services.data_sync_service import get_records_by_literature, get_all_literature
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
from services.file_service import save_upload_entry, process_file_background
from services.extraction_trace_service import get_extraction_run, list_extraction_candidates
from services.extraction_trace_service import get_latest_extraction_run_by_literature
from services.agent_runtime_service import get_agent_runtime
from services.activity_logging_service import log_activity
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

router = APIRouter(prefix="/api", tags=["extraction"])
logger = logging.getLogger(__name__)


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


@router.post("/upload")
async def upload_file(
    request: Request,
    file: UploadFile = File(...),
    background_tasks: BackgroundTasks = BackgroundTasks(),
    auto_extract: bool = Query(False),
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
            action_detail={"filename": file.filename, "literature_id": literature.id},
            resource_type="literature",
            resource_id=literature.id,
            request=request,
        )

        if auto_extract and literature.status == "pending":
            logger.info("Queueing background extraction for literature_id=%s", literature.id)
            background_tasks.add_task(process_file_background, literature.id)
        elif auto_extract:
            logger.info("Skipping background extraction for literature_id=%s status=%s", literature.id, literature.status)

        return {
            "success": True,
            "message": "File uploaded",
            "file_id": str(literature.id),
            "filename": literature.title,
            "status": literature.status,
        }
    except HTTPException:
        raise
    except Exception as exc:
        await db.rollback()
        _raise_internal_error("Upload file", exc)


@router.post("/extract/{file_id}")
async def extract_data(
    file_id: str,
    request: Request,
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

        # 记录提取活动
        await log_activity(
            db=db,
            user_id=principal.user.id,
            group_id=principal.group.id,
            action_type="extract_data",
            action_detail={"literature_id": lit_id, "profile": profile, "force": force},
            resource_type="literature",
            resource_id=lit_id,
            request=request,
        )

        # 2. Process Safely (Synchronous Wait)
        logger.info(
            "Starting extraction literature_id=%s force=%s profile=%s strict_cof_mode=%s",
            lit_id,
            force,
            profile,
            strict_cof_mode,
        )

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
    """涓嶢I鍔╂墜瀵硅瘽"""

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

