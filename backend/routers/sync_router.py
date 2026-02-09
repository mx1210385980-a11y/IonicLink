"""
Sync Router for IonicLink (Refactored)
API endpoints for Literature and TribologyData synchronization.
"""

from typing import List
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy.ext.asyncio import AsyncSession
import os

from database import get_db_session
from schemas import (
    LiteratureSchema,
    LiteratureWithRecords,
    TribologyDataSchema,
    SyncPayload,
    SyncResult
)
from services.data_sync_service import (
    sync_batch_data,
    sync_batch_data_with_replacement,
    get_literature_by_id,
    get_literature_by_doi,
    get_records_by_literature,
    get_all_literature,
    delete_literature
)
from services.file_service import reprocess_literature



router = APIRouter(prefix="/api/sync", tags=["sync"])


# ============== Sync Endpoints ==============

@router.post("/", response_model=SyncResult)
async def sync_data(
    payload: SyncPayload,
    db: AsyncSession = Depends(get_db_session)
):
    """
    Sync tribology data to database (APPEND mode).
    
    Creates Literature if not exists (by DOI), adds new TribologyData records.
    Does NOT delete existing records.
    
    Args:
        payload: SyncPayload with metadata and records
    
    Returns:
        SyncResult with literature_id and synced count
    """
    result = await sync_batch_data(db, payload)
    
    if not result.success:
        raise HTTPException(status_code=500, detail=result.message)
    
    return result


@router.post("/replace", response_model=SyncResult)
async def sync_data_replace(
    payload: SyncPayload,
    db: AsyncSession = Depends(get_db_session)
):
    """
    Sync tribology data to database (REPLACE mode).
    
    Creates Literature if not exists, DELETES all existing TribologyData
    for this Literature, then inserts new records.
    
    Args:
        payload: SyncPayload with metadata and records
    
    Returns:
        SyncResult with literature_id and synced count
    """
    result = await sync_batch_data_with_replacement(db, payload)
    
    if not result.success:
        raise HTTPException(status_code=500, detail=result.message)
    
    return result


# ============== Literature Endpoints ==============

@router.get("/literature", response_model=List[LiteratureSchema])
async def list_literature(
    skip: int = 0,
    limit: int = 100,
    db: AsyncSession = Depends(get_db_session)
):
    """
    Get all literature records with pagination.
    
    Args:
        skip: Number of records to skip (default 0)
        limit: Maximum records to return (default 100)
    
    Returns:
        List of LiteratureSchema
    """
    literature_list = await get_all_literature(db, skip=skip, limit=limit)
    
    return [
        LiteratureSchema(
            id=lit.id,
            doi=lit.doi or "",
            title=lit.title,
            authors=lit.authors,
            journal=lit.journal,
            issn=lit.issn,
            year=lit.year,
            volume=lit.volume,
            issue=lit.issue,
            pages=lit.pages,
            file_path=lit.file_path or "",
            file_hash=lit.file_hash,
            created_at=lit.created_at
        )
        for lit in literature_list
    ]


@router.get("/literature/{literature_id}", response_model=LiteratureWithRecords)
async def get_literature(
    literature_id: int,
    db: AsyncSession = Depends(get_db_session)
):
    """
    Get a specific Literature with all its TribologyData records.
    
    Args:
        literature_id: Literature ID
    
    Returns:
        LiteratureWithRecords including nested tribology_data
    """
    literature = await get_literature_by_id(db, literature_id)
    
    if not literature:
        raise HTTPException(status_code=404, detail=f"Literature ID={literature_id} not found")
    
    records = await get_records_by_literature(db, literature_id)
    
    return LiteratureWithRecords(
        id=literature.id,
        doi=literature.doi or "",
        title=literature.title,
        authors=literature.authors,
        journal=literature.journal,
        issn=literature.issn,
        year=literature.year,
        volume=literature.volume,
        issue=literature.issue,
        pages=literature.pages,
        file_path=literature.file_path or "",
        file_hash=literature.file_hash,
        created_at=literature.created_at,
        tribology_data=[
            TribologyDataSchema(
                id=r.id,
                literature_id=r.literature_id,
                material_name=r.material_name,
                lubricant=r.lubricant,
                cof_value=r.cof_value,
                cof_operator=r.cof_operator,
                cof_raw=r.cof_raw,
                load_value=r.load_value,
                load_raw=r.load_raw,
                speed_value=r.speed_value,
                temperature=r.temperature,
                confidence=r.confidence,
                extracted_at=r.extracted_at
            )
            for r in records
        ]
    )


@router.get("/literature/doi/{doi:path}", response_model=LiteratureSchema)
async def get_literature_by_doi_endpoint(
    doi: str,
    db: AsyncSession = Depends(get_db_session)
):
    """
    Get Literature by DOI.
    
    Args:
        doi: The DOI string (URL-encoded if necessary)
    
    Returns:
        LiteratureSchema
    """
    literature = await get_literature_by_doi(db, doi)
    
    if not literature:
        raise HTTPException(status_code=404, detail=f"Literature with DOI={doi} not found")
    
    return LiteratureSchema(
        id=literature.id,
        doi=literature.doi or "",
        title=literature.title,
        authors=literature.authors,
        journal=literature.journal,
        issn=literature.issn,
        year=literature.year,
        volume=literature.volume,
        issue=literature.issue,
        pages=literature.pages,
        file_path=literature.file_path or "",
        file_hash=literature.file_hash,
        created_at=literature.created_at
    )


@router.delete("/literature/{literature_id}")
async def delete_literature_endpoint(
    literature_id: int,
    db: AsyncSession = Depends(get_db_session)
):
    """
    Delete a Literature and all its TribologyData records (cascade).
    
    Args:
        literature_id: Literature ID
    
    Returns:
        Success message
    """
    deleted = await delete_literature(db, literature_id)
    
    if not deleted:
        raise HTTPException(status_code=404, detail=f"Literature ID={literature_id} not found")
    
    return {"success": True, "message": f"Deleted Literature ID={literature_id} and all related data"}


# ============== TribologyData Endpoints ==============

@router.get("/literature/{literature_id}/records", response_model=List[TribologyDataSchema])
async def get_tribology_records(
    literature_id: int,
    db: AsyncSession = Depends(get_db_session)
):
    """
    Get all TribologyData records for a specific Literature.
    
    Args:
        literature_id: Literature ID
    
    Returns:
        List of TribologyDataSchema
    """
    # First verify Literature exists
    literature = await get_literature_by_id(db, literature_id)
    if not literature:
        raise HTTPException(status_code=404, detail=f"Literature ID={literature_id} not found")
    
    records = await get_records_by_literature(db, literature_id)
    
    return [
        TribologyDataSchema(
            id=r.id,
            literature_id=r.literature_id,
            material_name=r.material_name,
            lubricant=r.lubricant,
            cof_value=r.cof_value,
            cof_operator=r.cof_operator,
            cof_raw=r.cof_raw,
            load_value=r.load_value,
            load_raw=r.load_raw,
            speed_value=r.speed_value,
            temperature=r.temperature,
            confidence=r.confidence,
            extracted_at=r.extracted_at
        )
        for r in records
    ]


# ============== Reprocess Endpoint ==============

@router.post("/literature/{literature_id}/reprocess")
async def reprocess_literature_endpoint(
    literature_id: int,
    file: UploadFile = File(None),  # Optional file upload
    db: AsyncSession = Depends(get_db_session)
):
    """
    Re-extract data from an existing Literature record.
    
    This endpoint re-runs the LLM extraction pipeline on existing Literature,
    which is useful for:
    - Populating new fields added to the schema (e.g., potential, water_content, surface_roughness)
    - Fixing incorrectly extracted data
    - Using updated LLM logic or prompts
    
    **Two modes:**
    
    1. **No file upload**: Attempts to use `file_path` from database
       - If `file_path` exists and file is accessible, uses that
       - Otherwise returns error with `needs_upload: true`
    
    2. **With file upload**: Uses the provided file content
       - Reads and extracts from uploaded file
       - Useful when original file is no longer available
    
    **Process:**
    - Deletes all existing TribologyData for this Literature
    - Re-extracts using current LLM logic
    - Inserts new records (including new environmental fields)
    - Optionally updates Literature metadata if improved
    
    **Parameters:**
    - `literature_id`: Database ID of the Literature record
    - `file` (optional): PDF/TXT/MD file to reprocess
    
    **Response:**
    ```json
    {
        "success": true,
        "literatureId": 123,
        "reprocessedCount": 45,
        "message": "成功重新提取 45 条数据记录",
        "metadata": {...},
        "needs_upload": false
    }
    ```
    """
    try:
        # Extract file content if provided
        file_content = None
        if file:
            # Read file content
            content_bytes = await file.read()
            file_ext = os.path.splitext(file.filename)[1].lower()
            
            if file_ext == '.pdf':
                # Extract PDF text
                from PyPDF2 import PdfReader
                import io
                pdf_reader = PdfReader(io.BytesIO(content_bytes))
                text_parts = []
                for page in pdf_reader.pages:
                    text = page.extract_text()
                    if text:
                        text_parts.append(text)
                file_content = "\n\n".join(text_parts)
            elif file_ext in ['.txt', '.md']:
                file_content = content_bytes.decode('utf-8')
            else:
                raise HTTPException(
                    status_code=400,
                    detail=f"Unsupported file type: {file_ext}. Supported: .pdf, .txt, .md"
                )
        
        # Call service function
        result = await reprocess_literature(
            literature_id=literature_id,
            db=db,
            file_content=file_content
        )
        
        if not result["success"]:
            # Determine appropriate status code based on error message
            message = result["message"]
            needs_upload = result.get("needs_upload", False)
            
            if "not found" in message.lower():
                raise HTTPException(status_code=404, detail=message)
            elif needs_upload:
                # File content is needed - return 400 with clear message
                raise HTTPException(
                    status_code=400,
                    detail={
                        "error": message,
                        "needs_upload": True,
                        "hint": "Please upload the original file to reprocess this literature record."
                    }
                )
            else:
                raise HTTPException(status_code=500, detail=message)
        
        return {
            "success": True,
            "literatureId": result["literature_id"],
            "reprocessedCount": result["reprocessed_count"],
            "message": result["message"],
            "metadata": result.get("metadata"),
            "needs_upload": False
        }
        
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(
            status_code=500,
            detail=f"Reprocessing failed: {str(e)}"
        )
