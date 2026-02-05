"""
File Service for IonicLink
Handles file-based operations including reprocessing of Literature records.
"""

import os
from typing import Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import delete
from PyPDF2 import PdfReader
import io

from models.db_models import Literature, TribologyData
from schemas import LiteratureCreate, TribologyDataCreate
from services.llm_service import llm_service
from services.data_sync_service import get_literature_by_id


async def reprocess_literature(
    literature_id: int,
    db: AsyncSession
) -> dict:
    """
    Reprocess an existing Literature record by re-extracting data from its file.
    
    This function:
    1. Fetches the Literature record by ID
    2. Reads the original file content from file_path
    3. Re-runs LLM extraction with updated logic
    4. Atomically replaces old TribologyData with new records
    5. Optionally updates Literature metadata if improved
    
    Args:
        literature_id: ID of the Literature to reprocess
        db: Database session
    
    Returns:
        dict: {
            "success": bool,
            "literature_id": int,
            "reprocessed_count": int,
            "message": str,
            "metadata": dict (optional)
        }
    
    Raises:
        ValueError: If Literature not found or file cannot be read
        Exception: If extraction or database operation fails
    """
    try:
        # Step 1: Fetch Literature record
        literature = await get_literature_by_id(db, literature_id)
        
        if not literature:
            raise ValueError(f"Literature ID={literature_id} not found")
        
        print(f"[Reprocess] Found Literature ID={literature_id}, title='{literature.title[:50]}...'")
        
        # Step 2: Read file content from file_path
        if not literature.file_path:
            raise ValueError(f"Literature ID={literature_id} has no file_path")
        
        if not os.path.exists(literature.file_path):
            raise ValueError(
                f"File not found at path: {literature.file_path}. "
                "Please re-upload the file to reprocess."
            )
        
        print(f"[Reprocess] Reading file from: {literature.file_path}")
        content = _read_file_content(literature.file_path)
        
        if not content or len(content.strip()) < 100:
            raise ValueError("File content is empty or too short")
        
        print(f"[Reprocess] Read {len(content)} characters from file")
        
        # Step 3: Re-run LLM extraction with new logic
        print("[Reprocess] Starting LLM extraction with updated logic...")
        extraction_result = await llm_service.extract_with_metadata(content)
        
        metadata_dict = extraction_result.get("metadata", {})
        data_list = extraction_result.get("data", [])
        
        print(f"[Reprocess] Extraction complete: {len(data_list)} records extracted")
        
        # Step 4: Atomic transaction - delete old data and insert new
        # Delete existing TribologyData records
        delete_stmt = delete(TribologyData).where(
            TribologyData.literature_id == literature_id
        )
        delete_result = await db.execute(delete_stmt)
        deleted_count = delete_result.rowcount
        
        print(f"[Reprocess] Deleted {deleted_count} old records")
        
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
                confidence=record_data.get("confidence", 0.9)
            )
            new_records.append(tribology_record)
        
        db.add_all(new_records)
        
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
        
        # Commit transaction
        await db.commit()
        
        print(f"[Reprocess] Successfully committed changes for Literature ID={literature_id}")
        
        return {
            "success": True,
            "literature_id": literature_id,
            "reprocessed_count": len(new_records),
            "message": f"成功重新提取 {len(new_records)} 条数据记录 (删除了 {deleted_count} 条旧记录)",
            "metadata": metadata_dict if should_update_metadata else None
        }
        
    except ValueError as e:
        # User-facing errors (not found, file missing, etc.)
        await db.rollback()
        return {
            "success": False,
            "literature_id": literature_id,
            "reprocessed_count": 0,
            "message": str(e),
            "metadata": None
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
            "metadata": None
        }


def _read_file_content(file_path: str) -> str:
    """
    Read content from a file (PDF or text).
    
    Args:
        file_path: Path to the file
    
    Returns:
        str: File content as text
    
    Raises:
        ValueError: If file type is not supported
        Exception: If file reading fails
    """
    file_ext = os.path.splitext(file_path)[1].lower()
    
    if file_ext == '.pdf':
        # Read PDF
        with open(file_path, 'rb') as f:
            pdf_reader = PdfReader(io.BytesIO(f.read()))
            text_parts = []
            for page in pdf_reader.pages:
                text = page.extract_text()
                if text:
                    text_parts.append(text)
            return "\n\n".join(text_parts)
    
    elif file_ext in ['.txt', '.md']:
        # Read text file
        with open(file_path, 'r', encoding='utf-8') as f:
            return f.read()
    
    else:
        raise ValueError(f"Unsupported file type: {file_ext}. Supported types: .pdf, .txt, .md")


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
