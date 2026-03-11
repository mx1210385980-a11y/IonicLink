"""
Sync Router for IonicLink (Refactored)
API endpoints for Literature and TribologyData synchronization.
"""

from typing import List
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db_session
from schemas import (
    LiteratureSchema,
    LiteratureWithRecords,
    TribologyDataSchema,
    SyncPayload,
    SyncResult
)
from services.sync_facade_service import (
    delete_literature_payload,
    get_literature_by_doi_payload,
    get_literature_detail_payload,
    get_tribology_records_payload,
    list_literature_payload,
    patch_il_resolution_payload,
    read_optional_upload_text,
    reprocess_literature_payload,
    sync_payload,
)



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
    return await sync_payload(db, payload, replace=False)


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
    return await sync_payload(db, payload, replace=True)


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
    payload = await list_literature_payload(db, skip=skip, limit=limit)
    return [LiteratureSchema(**item) for item in payload]


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
    payload = await get_literature_detail_payload(db, literature_id)
    return LiteratureWithRecords(**payload)


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
    payload = await get_literature_by_doi_payload(db, doi)
    return LiteratureSchema(**payload)


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
    return await delete_literature_payload(db, literature_id)


# ============== IL Re-Resolution Patch Endpoint ==============

@router.post("/patch-il-resolution")
async def patch_il_resolution(
    db: AsyncSession = Depends(get_db_session)
):
    """
    Re-run IL resolution on all existing TribologyData records.
    
    This endpoint patches records that have missing cation/anion/SMILES data
    because they were extracted before the IL resolver dictionary was updated.
    Does NOT call the LLM — only re-runs the local/PubChem IL resolution logic.
    
    Returns:
        Summary of updated records
    """
    return await patch_il_resolution_payload(db)


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
    payload = await get_tribology_records_payload(db, literature_id)
    return [TribologyDataSchema(**item) for item in payload]


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
        file_content = await read_optional_upload_text(file)
        return await reprocess_literature_payload(
            db,
            literature_id=literature_id,
            file_content=file_content,
        )
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(
            status_code=500,
            detail=f"Reprocessing failed: {str(e)}"
        )
