"""
Sync Router for IonicLink (Refactored)
API endpoints for Literature and TribologyData synchronization.
"""

import logging
from typing import List
from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile, File
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
    backfill_literature_metadata_payload,
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
from security import (
    AuthPrincipal,
    RequestScope,
    ensure_scope_writable,
    get_current_principal,
    get_request_scope,
    require_literature_access,
)
from services.activity_logging_service import log_activity



router = APIRouter(prefix="/api/sync", tags=["sync"])
logger = logging.getLogger(__name__)


def _raise_internal_error(action: str, exc: Exception) -> None:
    logger.exception("%s failed", action)
    raise HTTPException(status_code=500, detail=f"{action} failed.") from exc


# ============== Sync Endpoints ==============

@router.post("/", response_model=SyncResult)
async def sync_data(
    payload: SyncPayload,
    request: Request,
    db: AsyncSession = Depends(get_db_session),
    principal: AuthPrincipal = Depends(get_current_principal),
    scope: RequestScope = Depends(get_request_scope),
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
    try:
        ensure_scope_writable(principal, scope)
        result = await sync_payload(db, payload, principal=principal, scope=scope, replace=False)

        # 记录同步活动
        await log_activity(
            db=db,
            user_id=principal.user.id,
            group_id=principal.group.id,
            action_type="sync_data",
            action_detail={
                "doi": payload.metadata.doi if payload.metadata else None,
                "record_count": len(payload.records) if payload.records else 0,
                "literature_id": result.literature_id,
            },
            resource_type="literature",
            resource_id=result.literature_id,
            request=request,
        )

        return result
    except HTTPException:
        raise
    except Exception as exc:
        _raise_internal_error("Data sync", exc)


@router.post("/replace", response_model=SyncResult)
async def sync_data_replace(
    payload: SyncPayload,
    db: AsyncSession = Depends(get_db_session),
    principal: AuthPrincipal = Depends(get_current_principal),
    scope: RequestScope = Depends(get_request_scope),
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
    try:
        ensure_scope_writable(principal, scope)
        return await sync_payload(db, payload, principal=principal, scope=scope, replace=True)
    except HTTPException:
        raise
    except Exception as exc:
        _raise_internal_error("Replacement sync", exc)


# ============== Literature Endpoints ==============

@router.get("/literature", response_model=List[LiteratureSchema])
async def list_literature(
    skip: int = 0,
    limit: int = 100,
    db: AsyncSession = Depends(get_db_session),
    scope: RequestScope = Depends(get_request_scope),
):
    """
    Get all literature records with pagination.
    
    Args:
        skip: Number of records to skip (default 0)
        limit: Maximum records to return (default 100)
    
    Returns:
        List of LiteratureSchema
    """
    try:
        payload = await list_literature_payload(db, scope=scope, skip=skip, limit=limit)
        return [LiteratureSchema(**item) for item in payload]
    except HTTPException:
        raise
    except Exception as exc:
        _raise_internal_error("List literature", exc)


@router.get("/literature/{literature_id}", response_model=LiteratureWithRecords)
async def get_literature(
    literature_id: int,
    db: AsyncSession = Depends(get_db_session),
    principal: AuthPrincipal = Depends(get_current_principal),
):
    """
    Get a specific Literature with all its TribologyData records.
    
    Args:
        literature_id: Literature ID
    
    Returns:
        LiteratureWithRecords including nested tribology_data
    """
    try:
        literature = await require_literature_access(db, principal, literature_id)
        payload = await get_literature_detail_payload(
            db,
            literature_id,
            scope=RequestScope(
                scope_type=literature.scope_type,
                group_id=literature.group_id,
                scope_key=literature.scope_key,
                workspace=literature.workspace,
            ),
        )
        return LiteratureWithRecords(**payload)
    except HTTPException:
        raise
    except Exception as exc:
        _raise_internal_error("Get literature", exc)


@router.get("/literature/doi/{doi:path}", response_model=LiteratureSchema)
async def get_literature_by_doi_endpoint(
    doi: str,
    db: AsyncSession = Depends(get_db_session),
    scope: RequestScope = Depends(get_request_scope),
):
    """
    Get Literature by DOI.
    
    Args:
        doi: The DOI string (URL-encoded if necessary)
    
    Returns:
        LiteratureSchema
    """
    try:
        payload = await get_literature_by_doi_payload(db, doi, scope=scope)
        return LiteratureSchema(**payload)
    except HTTPException:
        raise
    except Exception as exc:
        _raise_internal_error("Get literature by DOI", exc)


@router.delete("/literature/{literature_id}")
async def delete_literature_endpoint(
    literature_id: int,
    db: AsyncSession = Depends(get_db_session),
    principal: AuthPrincipal = Depends(get_current_principal),
):
    """
    Delete a Literature and all its TribologyData records (cascade).
    
    Args:
        literature_id: Literature ID
    
    Returns:
        Success message
    """
    try:
        literature = await require_literature_access(db, principal, literature_id, write=True)
        return await delete_literature_payload(
            db,
            literature_id,
            scope=RequestScope(
                scope_type=literature.scope_type,
                group_id=literature.group_id,
                scope_key=literature.scope_key,
                workspace=literature.workspace,
            ),
        )
    except HTTPException:
        raise
    except Exception as exc:
        _raise_internal_error("Delete literature", exc)


# ============== IL Re-Resolution Patch Endpoint ==============

@router.post("/patch-il-resolution")
async def patch_il_resolution(
    db: AsyncSession = Depends(get_db_session),
    principal: AuthPrincipal = Depends(get_current_principal),
):
    """
    Re-run IL resolution on all existing TribologyData records.
    
    This endpoint patches records that have missing cation/anion/SMILES data
    because they were extracted before the IL resolver dictionary was updated.
    Does NOT call the LLM — only re-runs the local/PubChem IL resolution logic.
    
    Returns:
        Summary of updated records
    """
    try:
        if principal.user.role not in {"principal_investigator", "group_admin"}:
            raise HTTPException(status_code=403, detail="Admin permission required")
        return await patch_il_resolution_payload(db)
    except HTTPException:
        raise
    except Exception as exc:
        _raise_internal_error("Patch IL resolution", exc)


# ============== TribologyData Endpoints ==============

@router.get("/literature/{literature_id}/records", response_model=List[TribologyDataSchema])
async def get_tribology_records(
    literature_id: int,
    db: AsyncSession = Depends(get_db_session),
    principal: AuthPrincipal = Depends(get_current_principal),
):
    """
    Get all TribologyData records for a specific Literature.
    
    Args:
        literature_id: Literature ID
    
    Returns:
        List of TribologyDataSchema
    """
    try:
        literature = await require_literature_access(db, principal, literature_id)
        payload = await get_tribology_records_payload(
            db,
            literature_id,
            scope=RequestScope(
                scope_type=literature.scope_type,
                group_id=literature.group_id,
                scope_key=literature.scope_key,
                workspace=literature.workspace,
            ),
        )
        return [TribologyDataSchema(**item) for item in payload]
    except HTTPException:
        raise
    except Exception as exc:
        _raise_internal_error("Get tribology records", exc)


# ============== Reprocess Endpoint ==============

@router.post("/literature/{literature_id}/metadata/backfill")
async def backfill_literature_metadata_endpoint(
    literature_id: int,
    force: bool = False,
    db: AsyncSession = Depends(get_db_session),
    principal: AuthPrincipal = Depends(get_current_principal),
):
    """
    Fill missing literature metadata without touching confirmed tribology records.

    Uses Crossref when a stable DOI is present; otherwise reads cached/full-text
    source content and runs the metadata-only extractor, then updates only empty
    or temporary metadata fields.
    """
    try:
        await require_literature_access(db, principal, literature_id, write=True)
        return await backfill_literature_metadata_payload(
            db,
            literature_id=literature_id,
            force=force,
        )
    except HTTPException:
        raise
    except Exception as exc:
        _raise_internal_error("Backfill literature metadata", exc)


@router.post("/literature/{literature_id}/reprocess")
async def reprocess_literature_endpoint(
    literature_id: int,
    file: UploadFile = File(None),  # Optional file upload
    db: AsyncSession = Depends(get_db_session),
    principal: AuthPrincipal = Depends(get_current_principal),
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
        await require_literature_access(db, principal, literature_id, write=True)
        file_content = await read_optional_upload_text(file)
        return await reprocess_literature_payload(
            db,
            literature_id=literature_id,
            file_content=file_content,
        )
    except HTTPException:
        raise
    except Exception as exc:
        _raise_internal_error("Reprocess literature", exc)
