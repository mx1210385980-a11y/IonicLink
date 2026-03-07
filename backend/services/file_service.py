"""
File Service for IonicLink
Handles file-based operations including reprocessing of Literature records.
"""

import os
from typing import Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import delete
from sqlalchemy import delete, func
import io
import json
import fitz  # PyMuPDF
from utils.pdf_utils import process_pdf_to_base64, extract_pdf_text_fitz

from database import Base, async_session_maker
from models.db_models import Literature, TribologyData
from schemas import LiteratureCreate, TribologyDataCreate
from services.llm_service import llm_service
from services.data_sync_service import get_literature_by_id
from services.doi_service import DOIService
from sqlalchemy.future import select
from sqlalchemy import delete, update, func
import re

from fastapi import UploadFile

TEMP_UPLOAD_DIR = "temp_uploads"


def _resolve_existing_path(raw_path: Optional[str]) -> Optional[str]:
    """Resolve relative storage paths regardless of current working directory."""
    if not raw_path:
        return None

    candidates = [raw_path]
    if not os.path.isabs(raw_path):
        backend_root = os.path.dirname(os.path.dirname(__file__))
        candidates.append(os.path.abspath(os.path.join(backend_root, raw_path)))

    for p in candidates:
        if p and os.path.exists(p):
            return p
    return None

async def save_upload_entry(db: AsyncSession, file: UploadFile) -> Literature:
    """
    Save upload entry to DB.
    Non-destructive: If DOI exists with completed status, returns it.
    Uses DOI as unique identifier for deduplication.
    """
    try:
        # 1. Read file content
        content_bytes = await file.read()
        await file.seek(0)
        
        # 2. Extract Text & DOI Check
        text_content = ""
        if file.filename.lower().endswith('.pdf'):
            from utils.pdf_utils import extract_pdf_text_fitz
            text_content = extract_pdf_text_fitz(content_bytes)
        else:
            text_content = content_bytes.decode('utf-8', errors='ignore')

        # --- DOI Guard: Check if we already have this DOI ---
        if text_content:
            doi_match = re.search(r'(10\.\d{4,9}/[-._;()/:A-Z0-9]+)', text_content, re.IGNORECASE)
            
            if doi_match:
                found_doi = doi_match.group(1).lower().strip()
                print(f"[Upload] Extracted DOI candidate: {found_doi}")
                
                try:
                    from services.doi_service import DOIService
                    normalized_doi = DOIService()._normalize_doi(found_doi)
                    
                    # Check DB for existing DOI with completed status
                    stmt = select(Literature).where(
                        Literature.doi == normalized_doi,
                        Literature.status == 'completed'
                    )
                    existing_doi_match = (await db.execute(stmt)).scalar_one_or_none()
                    
                    if existing_doi_match:
                        print(f"[Upload] 🎯 DOI Cache HIT! ({normalized_doi}). Redirecting to existing ID {existing_doi_match.id}")
                        # Backfill PDF on disk if missing
                        if file.filename.lower().endswith('.pdf') and (not existing_doi_match.file_path or not os.path.exists(existing_doi_match.file_path)):
                            pdf_dir = os.path.join(TEMP_UPLOAD_DIR, "pdfs")
                            os.makedirs(pdf_dir, exist_ok=True)
                            pdf_path = os.path.join(pdf_dir, f"{existing_doi_match.id}.pdf")
                            with open(pdf_path, 'wb') as f:
                                f.write(content_bytes)
                            existing_doi_match.file_path = pdf_path
                            await db.commit()
                            print(f"[Upload] Backfilled PDF to {pdf_path}")
                        return existing_doi_match
                except Exception as e:
                    print(f"[Upload] DOI Check Warning: {e}")
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
            content=text_content,
            status="pending" 
        )
        db.add(new_lit)
        await db.commit()
        await db.refresh(new_lit)
        print(f"[Upload] Created new Literature ID {new_lit.id}")

        # Save PDF file to disk for later serving (Source Grounding viewer)
        if file.filename.lower().endswith('.pdf'):
            pdf_dir = os.path.join(TEMP_UPLOAD_DIR, "pdfs")
            os.makedirs(pdf_dir, exist_ok=True)
            pdf_path = os.path.join(pdf_dir, f"{new_lit.id}.pdf")
            with open(pdf_path, 'wb') as f:
                f.write(content_bytes)
            new_lit.file_path = pdf_path
            await db.commit()
            print(f"[Upload] Saved PDF to {pdf_path}")

        return new_lit
        
    except Exception as e:
        print(f"[Upload] Error saving entry: {e}")
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
            Literature.id != literature.id
        )
    )
    conflict = result.scalar_one_or_none()
    if conflict:
        print(f"[DOI Conflict] Skipping DOI update for ID={literature.id}: "
              f"'{norm}' already owned by ID={conflict.id}")
        return False
    literature.doi = norm
    return True


async def process_file_safe(file_id: int, content: str = None, images: list = None, force: bool = False):
    """
    Process file with an ISOLATED database session. 
    Returns (metadata_dict, data_list) for immediate frontend display.
    Handles caching logic internally.
    """
    print(f"[Process] Starting isolated processing for Literature ID: {file_id}")
    
    # 1. Open Scoped Session
    async with async_session_maker() as db:
        try:
            # 2. Fetch Literature
            # Use distinct session, so re-fetch is necessary
            literature = await db.get(Literature, file_id)
            if not literature:
                print(f"[Error] Literature {file_id} not found.")
                return None, []

            # --- ✅ DATA EXISTENCE GUARD (Safety Fallback) ---
            # Even if status is wrong, TRUST THE DATA.
            if not force:
                result = await db.execute(
                    select(func.count(TribologyData.id)).where(TribologyData.literature_id == literature.id)
                )
                data_count = result.scalar() or 0
                
                if data_count > 0:
                     print(f"🛑 [Safe Process] File {file_id} has {data_count} records. Force=False. treating as COMPLETED.")
                     # Setup literature as completed in memory for the next check
                     literature.status = 'completed'
                     # Helper: we will fall through to the 'if ... status == completed' block below
            # ------------------------------------------------

            # 3. Smart Caching Check
            # If valid, completed, and not forced, return existing data
            if not force and literature.status == 'completed':
                print(f"[Process] Cache Hit for Lit ID {file_id}. Fetching from DB.")
                stmt = select(TribologyData).where(TribologyData.literature_id == literature.id)
                result = await db.execute(stmt)
                db_records = result.scalars().all()
                
                data_list = []
                for i, r in enumerate(db_records):
                    cof_str = r.cof_raw if r.cof_raw else (str(r.cof_value) if r.cof_value else None)
                    
                    item = {
                        "id": f"{literature.id}_{i}",
                        "material_name": r.material_name,
                        "lubricant": r.lubricant,
                        "ionic_liquid": r.lubricant,
                        "cof": cof_str,
                        "cof_value": r.cof_value,
                        "cof_operator": r.cof_operator,
                        "cof_raw": r.cof_raw,
                        "load": r.load_raw,
                        "load_value": r.load_value,
                        "load_raw": r.load_raw,
                        "speed": r.speed_value,
                        "speed_value": r.speed_value,
                        "temperature": r.temperature,
                        "potential": r.potential,
                        "water_content": r.water_content,
                        "surface_roughness": r.surface_roughness,
                        "film_thickness": r.film_thickness,
                        "residual_film_thickness_d": r.residual_film_thickness_d,
                        "layer_spacing_delta": r.layer_spacing_delta,
                        "mol_ratio": r.mol_ratio,
                        "cation": r.cation,
                        "anion": r.anion,
                        "cation_smiles": r.cation_smiles,
                        "anion_smiles": r.anion_smiles,
                        "il_smiles": r.il_smiles,
                        "il_inchikey": r.il_inchikey,
                        "alkyl_chain_length": r.alkyl_chain_length,
                        "confidence": r.confidence,
                        "evidence": r.evidence
                    }
                    data_list.append(item)
                
                metadata = {
                    "title": literature.title,
                    "doi": literature.doi,
                    "authors": literature.authors,
                    "journal": literature.journal,
                    "year": literature.year,
                    "volume": literature.volume,
                    "issue": literature.issue,
                    "pages": literature.pages
                }
                return metadata, data_list
            
            # 4. Perform Extraction
            print(f"[Process] Processing '{literature.title}' via LLM...")
            
            # Ensure content
            if not content and literature.content:
                content = literature.content
            
            # Ensure images (if needed)
            if not images and literature.file_path and literature.file_path.endswith('.pdf'):
                 try:
                     images = process_pdf_to_base64(_read_file_bytes(literature.file_path))
                 except: pass

            if not content:
                 print("[Error] No content to extract.")
                 literature.status = "failed"
                 literature.error_message = "No content available"
                 await db.commit()
                 return {}, []
            
            # Update status
            literature.status = "extracting"
            await db.commit()

            # Call LLM (smart routing: pass pdf_path so visual pages go to Qwen-VL only)
            if images:
                result = await llm_service.extract_with_metadata(
                    content=content,
                    images=images,
                    pdf_path=literature.file_path,
                )
            else:
                result = await llm_service.extract_with_metadata(
                    content=content,
                    pdf_path=literature.file_path,
                )
            
            records = result.get("data", [])
            metadata = result.get("metadata", {})
            
            # 5. Save Results
            if records:
                # DELETE OLD DATA NOW
                delete_stmt = delete(TribologyData).where(TribologyData.literature_id == literature.id)
                await db.execute(delete_stmt)

                # Deduplicate records based on key fields
                seen_keys = set()
                unique_records = []
                for item in records:
                    key = (
                        str(item.get("material_name", "")).strip().lower(),
                        str(item.get("ionic_liquid", item.get("lubricant", ""))).strip().lower(),
                        str(item.get("cof", "")).strip(),
                        str(item.get("load", "")).strip(),
                        str(item.get("speed", "")).strip(),
                    )
                    if key not in seen_keys:
                        seen_keys.add(key)
                        unique_records.append(item)
                
                if len(records) != len(unique_records):
                    print(f"[Process] Deduplicated: {len(records)} -> {len(unique_records)} records")
                records = unique_records

                new_records_db = []
                response_data_list = []
                
                for i, item in enumerate(records):
                    cof_raw = item.get("cof")
                    cof_value = None
                    if cof_raw:
                        try:
                            import re
                            match = re.search(r'-?\d+(\.\d+)?([eE][-+]?\d+)?', str(cof_raw))
                            if match:
                                cof_value = float(match.group(0))
                        except:
                            pass
                    
                    db_record = TribologyData(
                        literature_id=literature.id,
                        material_name=item.get("material_name", "Unknown"),
                        lubricant=item.get("ionic_liquid", item.get("lubricant", "")),
                        cof_value=cof_value,
                        cof_operator=item.get("cof_operator"),
                        cof_raw=cof_raw,
                        load_value=item.get("load"),
                        load_raw=item.get("load"),
                        speed_value=item.get("speed"),
                        temperature=item.get("temperature"),
                        potential=item.get("potential"),
                        water_content=item.get("water_content"),
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
                        confidence=item.get("confidence", 0.9),
                        evidence=item.get("evidence"),
                        source=item.get("source"),
                    )
                    # Resolve evidence coordinates from PDF
                    _try_resolve_evidence_coords(db_record, item, literature.file_path)
                    new_records_db.append(db_record)
                    
                    # Prepare response item
                    resp_item = item.copy()
                    resp_item["id"] = f"{literature.id}_{i}"
                    response_data_list.append(resp_item)
                
                db.add_all(new_records_db)
                
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
                print(f"[Success] Saved {len(new_records_db)} records.")
                
                await db.commit()
                return metadata, response_data_list
            else:
                print("[Process] No records found.")
                # Don't mark failed if just empty? Or maybe finished but empty.
                literature.status = "completed"
                literature.error_message = "No tribology data found"
                await db.commit()
                return metadata, []
                
        except Exception as e:
            print(f"[Process] Error: {e}")
            literature.status = "failed"
            literature.error_message = str(e)
            await db.commit()
            return {}, []


async def process_file_background(file_id: int):
    """
    Background Task for File Processing with Idempotency Check.
    Wraps process_file_safe with an additional status check to prevent overwriting completed files.
    """
    print(f"--- [START] Background Task for File ID: {file_id} ---")
    
    async with async_session_maker() as db:
        try:
            # 1. Fetch Record
            result = await db.execute(select(Literature).where(Literature.id == file_id))
            literature = result.scalar_one_or_none()
            
            if not literature:
                print(f"[Error] File ID {file_id} not found.")
                return

            # --- ✅ ULTIMATE GUARD: DATA EXISTENCE CHECK ---
            # Don't trust 'status'. Trust the data.
            # If we already have extracted records, DO NOT DELETE THEM.
            result = await db.execute(
                select(func.count(TribologyData.id)).where(TribologyData.literature_id == file_id)
            )
            data_count = result.scalar() or 0
            
            if data_count > 0:
                print(f"🛑 File {file_id} already has {data_count} records. ABORTING overwrite.")
                # Self-healing: Ensure status reflects reality
                if literature.status != 'completed':
                    print(f"[Self-Healing] updating status to 'completed' for File {file_id}")
                    literature.status = 'completed'
                    await db.commit()
                return
            # ------------------------------------------------

            # 2. Update Status to Processing (Only if not completed)
            literature.status = "processing"
            await db.commit()
            
            # 3. Process Logic (Delegate to safe function)
            # process_file_safe will handle the actual extraction, saving, and final status update
            print(f"[Background] Delegating to process_file_safe for File {file_id}")
            await process_file_safe(file_id)
            
        except Exception as e:
            print(f"[Background Error] {e}")
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
        # Step 1: Fetch Literature record
        literature = await get_literature_by_id(db, literature_id)
        
        if not literature:
            raise ValueError(f"Literature ID={literature_id} not found")
        
        print(f"[Reprocess] Found Literature ID={literature_id}, title='{literature.title[:50]}...'")
        
        # Step 2: Get file content
        content = None
        
        if file_content:
            print(f"[Reprocess] Using provided file content ({len(file_content)} characters)")
            content = file_content
            literature.content = content
            
        elif literature.content:
            print(f"[Reprocess] Using stored content from database ({len(literature.content)} characters)")
            content = literature.content
            
        elif literature.file_path and os.path.exists(literature.file_path):
            print(f"[Reprocess] Reading file from: {literature.file_path}")
            try:
                content = _read_file_content(literature.file_path)
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
        print("[Reprocess] Starting LLM extraction...")
        
        # Vision support
        base64_images = []
        if literature.file_path and os.path.exists(literature.file_path) and literature.file_path.lower().endswith('.pdf'):
            try:
                base64_images = process_pdf_to_base64(_read_file_bytes(literature.file_path))
            except: pass
        
        if base64_images:
            extraction_result = await llm_service.extract_with_metadata(
                content=content,
                images=base64_images,
                pdf_path=literature.file_path,
            )
        else:
            extraction_result = await llm_service.extract_with_metadata(
                content,
                pdf_path=literature.file_path,
            )
        
        metadata_dict = extraction_result.get("metadata", {})
        data_list = extraction_result.get("data", [])
        
        # Step 4: Deduplicate records based on key fields
        seen_keys = set()
        unique_data = []
        for item in data_list:
            key = (
                str(item.get("material_name", "")).strip().lower(),
                str(item.get("ionic_liquid", item.get("lubricant", ""))).strip().lower(),
                str(item.get("cof", "")).strip(),
                str(item.get("load", "")).strip(),
                str(item.get("speed", "")).strip(),
            )
            if key not in seen_keys:
                seen_keys.add(key)
                unique_data.append(item)
        
        if len(data_list) != len(unique_data):
            print(f"[Reprocess] Deduplicated: {len(data_list)} -> {len(unique_data)} records")
        data_list = unique_data
        
        # Step 5: Atomic Replace
        new_records = []
        for record_data in data_list:
            cof_raw = record_data.get("cof")
            cof_value = None
            if cof_raw:
                try:
                    import re
                    match = re.search(r'-?\d+(\.\d+)?([eE][-+]?\d+)?', str(cof_raw))
                    if match:
                        cof_value = float(match.group(0))
                except:
                    pass
            
            tribology_record = TribologyData(
                literature_id=literature_id,
                material_name=record_data.get("material_name", "Unknown"),
                lubricant=record_data.get("ionic_liquid", record_data.get("lubricant", "")),
                cof_value=cof_value,
                cof_operator=record_data.get("cof_operator"),
                cof_raw=cof_raw,
                load_value=record_data.get("load"),
                load_raw=record_data.get("load"),
                speed_value=record_data.get("speed"),
                temperature=record_data.get("temperature"),
                potential=record_data.get("potential"),
                water_content=record_data.get("water_content"),
                surface_roughness=record_data.get("surface_roughness"),
                film_thickness=record_data.get("film_thickness"),
                residual_film_thickness_d=record_data.get("residual_film_thickness_d"),
                layer_spacing_delta=record_data.get("layer_spacing_delta"),
                mol_ratio=record_data.get("mol_ratio"),
                cation=record_data.get("cation"),
                anion=record_data.get("anion"),
                cation_smiles=record_data.get("cation_smiles"),
                anion_smiles=record_data.get("anion_smiles"),
                il_smiles=record_data.get("il_smiles"),
                il_inchikey=record_data.get("il_inchikey"),
                alkyl_chain_length=record_data.get("alkyl_chain_length"),
                confidence=record_data.get("confidence", 0.9),
                evidence=record_data.get("evidence"),
                source=record_data.get("source"),
            )
            _try_resolve_evidence_coords(tribology_record, record_data, literature.file_path)
            new_records.append(tribology_record)
        
        if new_records:
            delete_stmt = delete(TribologyData).where(TribologyData.literature_id == literature_id)
            await db.execute(delete_stmt)
            db.add_all(new_records)
            print(f"[Reprocess] Replaced with {len(new_records)} new records.")
        
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
            "reprocessed_count": len(new_records),
            "message": f"Successfully reprocessed {len(new_records)} records"
        }
        
    except Exception as e:
        print(f"[Reprocess] Error: {e}")
        await db.rollback()
        return {"success": False, "message": str(e)}


def _try_resolve_evidence_coords(db_record, item: dict, file_path: Optional[str]) -> None:
    """
    Attempt to resolve PDF bounding-box coordinates for an extracted record's evidence.

    Strategy (tried in order):
      1. If the LLM provided source_figure → search for the figure caption bbox
      2. Else if the record has evidence text → search for the text in the PDF

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
            page_hint_int = None
            try:
                page_hint_int = int(source_page) if source_page is not None else None
            except Exception:
                page_hint_int = None
            page, bbox = find_evidence_coordinates(
                file_path, evidence_text, page_hint=page_hint_int
            )
        except Exception as e:
            print(f"[EvidenceCoords] find_evidence_coordinates error: {e}")

    # Strategy 3: keyword fallback (cof / IL / material) when evidence quote is not directly searchable
    if not bbox:
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
                    [{"id": "fallback", "queries": fallback_queries}],
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
        print(f"[EvidenceCoords] Resolved: page={page}, bbox={bbox}")
    else:
        print(f"[EvidenceCoords] No match for record material={item.get('material_name', '?')}")

