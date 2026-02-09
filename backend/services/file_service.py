"""
File Service for IonicLink
Handles file-based operations including reprocessing of Literature records.
"""

import os
from typing import Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import delete
from sqlalchemy import delete
import io
import fitz  # PyMuPDF
from utils.pdf_utils import process_pdf_to_base64, extract_pdf_text_fitz

from database import Base  # Ensure valid import base
from models.db_models import Literature, TribologyData
from schemas import LiteratureCreate, TribologyDataCreate
from services.llm_service import llm_service
from database import async_session_maker  # Session factory
from models.db_models import Literature, TribologyData
from services.llm_service import llm_service
from services.data_sync_service import get_literature_by_id
from utils.pdf_utils import process_pdf_to_base64, extract_pdf_text_fitz
from sqlalchemy.future import select
from sqlalchemy import delete, update

async def get_literature_by_hash(db: AsyncSession, file_hash: str):
    """
    通过文件哈希值查找数据库中是否已存在该文件
    """
    if not file_hash:
        return None
        
    # 假设你的 Literature 模型里有一个 'file_hash' 字段
    # 如果你的模型里叫 'hash' 或者其他名字，请在这里修改: Literature.file_hash
    stmt = select(Literature).where(Literature.file_hash == file_hash)
    result = await db.execute(stmt)
    return result.scalar_one_or_none()

async def save_upload_entry(db: AsyncSession, filename: str, content: str, file_hash: str, file_path: str = None) -> Literature:
    """
    Create initial Literature record in 'processing' state.
    This runs in the Router's request-scope session (so we can await commit and return ID).
    """
    # Check existing
    existing = await get_literature_by_hash(db, file_hash)
    if existing:
        print(f"[Upload] Found existing file {existing.id} for hash {file_hash}")
        return existing
        
    new_lit = Literature(
        title=filename,  # Temp title
        doi="",
        authors="",
        journal="",
        year=0,
        file_hash=file_hash,
        file_path=file_path,
        content=content,  # Save content immediately
        status="processing"
    )
    db.add(new_lit)
    await db.commit()
    await db.refresh(new_lit)
    print(f"[Upload] Created new Literature ID {new_lit.id}")
    return new_lit


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

            # 3. Smart Caching Check
            # If valid, completed, and not forced, return existing data
            if not force and literature.status == 'completed':
                 print(f"[Process] Cache Hit for Lit ID {file_id}. Fetching from DB.")
                 # Fetch existing records
                 stmt = select(TribologyData).where(TribologyData.literature_id == literature.id)
                 result = await db.execute(stmt)
                 db_records = result.scalars().all()
                 
                 # Convert to list of dicts
                 data_list = []
                 for i, r in enumerate(db_records):
                     item = {
                         "id": f"{literature.file_hash}_{i}",
                         "material_name": r.material_name,
                         "lubricant": r.lubricant,
                         "ionic_liquid": r.lubricant,
                         "cof_value": r.cof_value,
                         "cof_operator": r.cof_operator,
                         "cof_raw": r.cof_raw,
                         "load_value": r.load_value,
                         "load_raw": r.load_raw,
                         "speed_value": r.speed_value,
                         "temperature": r.temperature,
                         "potential": r.potential,
                         "water_content": r.water_content,
                         "surface_roughness": r.surface_roughness,
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
                     "pages": literature.pages,
                     "file_hash": literature.file_hash,
                     "fileHash": literature.file_hash
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

            # Call LLM
            if images:
                result = await llm_service.extract_with_metadata(content=content, images=images)
            else:
                result = await llm_service.extract_with_metadata(content=content)
            
            records = result.get("data", [])
            metadata = result.get("metadata", {})
            
            # 5. Save Results
            if records:
                # Clear old data
                await db.execute(delete(TribologyData).where(TribologyData.literature_id == literature.id))
                
                new_records_db = []
                response_data_list = []
                
                for i, item in enumerate(records):
                    db_record = TribologyData(
                        literature_id=literature.id,
                        material_name=item.get("material_name", "Unknown"),
                        lubricant=item.get("ionic_liquid", item.get("lubricant", "")),
                        cof_value=item.get("cof_value"),
                        cof_operator=item.get("cof_operator"),
                        cof_raw=item.get("cof"),
                        load_value=item.get("load_value"),
                        load_raw=item.get("load"),
                        speed_value=item.get("speed_value"),
                        temperature=item.get("temperature"),
                        potential=item.get("potential"),
                        water_content=item.get("water_content"),
                        surface_roughness=item.get("surface_roughness"),
                        confidence=item.get("confidence", 0.9),
                        evidence=item.get("evidence")
                    )
                    new_records_db.append(db_record)
                    
                    # Prepare response item
                    resp_item = item.copy()
                    resp_item["id"] = f"{literature.file_hash}_{i}"
                    response_data_list.append(resp_item)
                
                db.add_all(new_records_db)
                
                # Update Metadata
                if metadata:
                    if metadata.get("title"): literature.title = metadata["title"]
                    if metadata.get("doi"): literature.doi = metadata["doi"]
                    if metadata.get("authors"): literature.authors = metadata["authors"]
                    if metadata.get("journal"): literature.journal = metadata["journal"]
                    if metadata.get("year"): literature.year = metadata["year"]
                    if metadata.get("volume"): literature.volume = metadata["volume"]
                    if metadata.get("issue"): literature.issue = metadata["issue"]
                    if metadata.get("pages"): literature.pages = metadata["pages"]
                    if metadata.get("issn"): literature.issn = metadata["issn"]
                
                # Include file_hash in metadata return
                metadata["file_hash"] = literature.file_hash
                metadata["fileHash"] = literature.file_hash # CamelCase
                
                literature.status = "completed"
                literature.error_message = None
                print(f"[Success] Saved {len(new_records_db)} records.")
                
                await db.commit()
                return metadata, response_data_list
            else:
                literature.status = "failed"
                literature.error_message = "No valid data extracted."
                print("[Warning] No data extracted.")
                await db.commit()
                return {}, []

        except Exception as e:
            print(f"[Critical Error] Process failed: {e}")
            import traceback
            traceback.print_exc()
            try:
                literature.status = "failed"
                literature.error_message = str(e)
                await db.commit()
            except: pass
            return {}, []


async def reprocess_literature(
    literature_id: int,
    db: AsyncSession,
    file_content: Optional[str] = None
) -> dict:
    """
    Reprocess an existing Literature record by re-extracting data.
    
    Since the original file content is not stored in the database, this function
    requires the file content to be provided as a parameter.
    
    This function:
    1. Fetches the Literature record by ID
    2. Uses the provided file content (or attempts to read from file_path if available)
    3. Re-runs LLM extraction with updated logic
    4. Atomically replaces old TribologyData with new records
    5. Optionally updates Literature metadata if improved
    
    Args:
        literature_id: ID of the Literature to reprocess
        db: Database session
        file_content: Optional text content of the file. If not provided, will attempt
                     to read from file_path in the database.
    
    Returns:
        dict: {
            "success": bool,
            "literature_id": int,
            "reprocessed_count": int,
            "message": str,
            "metadata": dict (optional),
            "needs_upload": bool (if file content is required)
        }
    
    Raises:
        ValueError: If Literature not found or file cannot be accessed
        Exception: If extraction or database operation fails
    """
    try:
        # Step 1: Fetch Literature record
        literature = await get_literature_by_id(db, literature_id)
        
        if not literature:
            raise ValueError(f"Literature ID={literature_id} not found")
        
        print(f"[Reprocess] Found Literature ID={literature_id}, title='{literature.title[:50]}...'")
        
        # Step 2: Get file content (priority: parameter > database content > file_path > error)
        content = None
        
        if file_content:
            # Content provided as parameter
            print(f"[Reprocess] Using provided file content ({len(file_content)} characters)")
            content = file_content
            
            # CRITICAL: Persist this content to the database so next time we don't need upload
            literature.content = content
            print(f"[Reprocess] Persisted new file content to database")
            
        elif literature.content:
            # Use stored content from database
            print(f"[Reprocess] Using stored content from database ({len(literature.content)} characters)")
            content = literature.content
            
        elif literature.file_path and os.path.exists(literature.file_path):
            # Try to read from file_path if it exists
            print(f"[Reprocess] Reading file from: {literature.file_path}")
            try:
                content = _read_file_content(literature.file_path)
                print(f"[Reprocess] Read {len(content)} characters from file")
                
                # Persist to database for future robustness
                literature.content = content
                print(f"[Reprocess] Persisted file content to database")
                
            except Exception as e:
                print(f"[Reprocess] Failed to read file: {e}")
                raise ValueError(
                    f"Failed to read file from path: {literature.file_path}. "
                    f"Error: {str(e)}"
                )
        else:
            # No content available - need user to provide it
            message = (
                f"Literature ID={literature_id} does not have stored file content. "
                "The original file content is required for reprocessing. "
                "Please use the file upload endpoint to provide the content."
            )
            print(f"[Reprocess] {message}")
            return {
                "success": False,
                "literature_id": literature_id,
                "reprocessed_count": 0,
                "message": message,
                "metadata": None,
                "needs_upload": True
            }
        
        if not content or len(content.strip()) < 100:
            raise ValueError("File content is empty or too short")
        
        # Step 3: Re-run LLM extraction with new logic (Vision Support)
        print("[Reprocess] Starting LLM extraction with updated logic...")
        
        # Check if we can use Vision (if file_path exists and is PDF)
        base64_images = []
        if literature.file_path and os.path.exists(literature.file_path) and literature.file_path.lower().endswith('.pdf'):
            try:
                # Use in-memory processing
                print(f"[Reprocess] Processing PDF for Vision (In-Memory)...")
                base64_images = process_pdf_to_base64(
                    _read_file_bytes(literature.file_path)
                )
                print(f"[Reprocess] Generated {len(base64_images)} images for Vision extraction")
            except Exception as e:
                print(f"[Reprocess] Failed to generate images: {e}, falling back to text")
        
        if base64_images:
            extraction_result = await llm_service.extract_with_metadata(content=content, images=base64_images)
        else:
            extraction_result = await llm_service.extract_with_metadata(content)
        
        metadata_dict = extraction_result.get("metadata", {})
        data_list = extraction_result.get("data", [])
        
        print(f"[Reprocess] Extraction complete: {len(data_list)} records extracted")
        
        # Step 4: Atomic transaction - delete old data and insert new
        # Old delete block removed (shifted down)
        # print(f"[Reprocess] Deleted {deleted_count} old records")
        
        # Insert new TribologyData records with all fields
        new_records = []
        for record_data in data_list:
            tribology_record = TribologyData(
                literature_id=literature_id,
                material_name=record_data.get("material_name", "Unknown"),
                lubricant=record_data.get("ionic_liquid", record_data.get("lubricant", "")),
                cof_value=record_data.get("cof_value"),
                cof_operator=record_data.get("cof_operator"),
                cof_raw=record_data.get("cof"),
                load_value=record_data.get("load_value"),
                load_raw=record_data.get("load"),
                speed_value=record_data.get("speed_value"),
                temperature=record_data.get("temperature"),
                # NEW FIELDS - Environmental variables
                potential=record_data.get("potential"),
                water_content=record_data.get("water_content"),
                surface_roughness=record_data.get("surface_roughness"),
                confidence=record_data.get("confidence", 0.9),
                evidence=record_data.get("evidence")
            )
            new_records.append(tribology_record)
        
        if new_records:
            print(f"[Reprocess] Clearing old data for Literature ID {literature_id}...")
            # 1. DELETE existing records for this file
            delete_stmt = delete(TribologyData).where(
                TribologyData.literature_id == literature_id
            )
            await db.execute(delete_stmt)
            
            # 2. Add new records
            db.add_all(new_records)
            print(f"[Reprocess] Successfully replaced with {len(new_records)} new records.")
        else:
            print("[Reprocess] No new records extracted. Keeping existing data.")
        
        print(f"[Reprocess] Inserted {len(new_records)} new records")
        
        # Step 5: Optionally update Literature metadata if improved
        # Only update if new metadata has meaningful improvements
        should_update_metadata = _should_update_metadata(literature, metadata_dict)
        
        if should_update_metadata:
            print("[Reprocess] Updating Literature metadata with improved data")
            # Update fields that might have been improved by DOI enrichment
            if metadata_dict.get("title"):
                literature.title = metadata_dict["title"]
            if metadata_dict.get("authors"):
                literature.authors = metadata_dict["authors"]
            if metadata_dict.get("journal"):
                literature.journal = metadata_dict["journal"]
            if metadata_dict.get("year"):
                literature.year = metadata_dict["year"]
            if metadata_dict.get("volume"):
                literature.volume = metadata_dict["volume"]
            if metadata_dict.get("issue"):
                literature.issue = metadata_dict["issue"]
            if metadata_dict.get("pages"):
                literature.pages = metadata_dict["pages"]
            if metadata_dict.get("issn"):
                literature.issn = metadata_dict["issn"]
        
        # [CRITICAL] Update Status to Completed
        literature.status = 'completed'
        
        # Commit transaction
        await db.commit()
        
        print(f"[Reprocess] Successfully committed changes for Literature ID={literature_id}")
        
        return {
            "success": True,
            "literature_id": literature_id,
            "reprocessed_count": len(new_records),
            "message": f"成功重新提取 {len(new_records)} 条数据记录 (已删除旧记录)",
            "metadata": metadata_dict if should_update_metadata else None,
            "needs_upload": False
        }
        
    except ValueError as e:
        # User-facing errors (not found, file missing, etc.)
        await db.rollback()
        return {
            "success": False,
            "literature_id": literature_id,
            "reprocessed_count": 0,
            "message": str(e),
            "metadata": None,
            "needs_upload": "file content" in str(e).lower() or "file_path" in str(e).lower()
        }
    
    except Exception as e:
        # System errors (LLM, database, etc.)
        print(f"[Reprocess] ERROR: {str(e)}")
        import traceback
        traceback.print_exc()
        await db.rollback()
        return {
            "success": False,
            "literature_id": literature_id,
            "reprocessed_count": 0,
            "message": f"重新提取失败: {str(e)}",
            "metadata": None,
            "needs_upload": False
        }


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
