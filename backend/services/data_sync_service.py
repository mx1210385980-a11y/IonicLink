"""
Data Sync Service for IonicLink (Refactored)
Implements batch data sync logic with Literature get-or-create pattern.

Main Features:
- Get-or-create Literature by DOI or title
- Bulk insert TribologyData records linked to Literature
- Transaction management with rollback on failure
"""

from datetime import datetime
from typing import List, Optional, Tuple
import traceback
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete

from models.db_models import Literature, TribologyData
from schemas import (
    LiteratureCreate,
    TribologyDataCreate,
    SyncPayload,
    SyncResult
)
from services.doi_service import DOIService

# DOI normalizer instance
_doi_service = DOIService()


# ============== Core Sync Logic ==============

async def get_or_create_literature(
    db: AsyncSession,
    metadata: LiteratureCreate
) -> Tuple[Literature, bool]:
    """
    Get existing Literature by DOI, or create new one.
    
    Deduplication strategy:
    1. Primary: Match by DOI (unique identifier)
    2. Fallback: Match by title (if DOIs differ)
    
    Args:
        db: Database session
        metadata: Literature metadata from frontend
    
    Returns:
        Tuple of (Literature instance, is_new: bool)
    """
    # Normalize DOI before lookup (remove prefixes like http://doi.org/, doi:)
    raw_doi = metadata.doi.strip() if metadata.doi else ""
    normalized_doi = _doi_service._normalize_doi(raw_doi) if raw_doi else ""
    
    # CRITICAL: Empty DOI must be None (NULL) to avoid UNIQUE constraint violation
    # SQL allows multiple NULLs but not multiple empty strings
    final_doi = normalized_doi if normalized_doi else None
    
    print(f"[Sync] DOI processing: raw='{raw_doi}' -> normalized='{normalized_doi}' -> final={repr(final_doi)}")
    
    # Try to find by DOI first (primary key for deduplication)
    if final_doi:
        query = select(Literature).where(Literature.doi == final_doi)
        result = await db.execute(query)
        existing = result.scalar_one_or_none()
        
        if existing:
            print(f"[Sync] Found existing Literature ID={existing.id} with DOI={final_doi}")
            return existing, False
    
    # Create new Literature entry
    # NOTE: pmid and arxiv_id fields were removed from the model, do NOT include them
    file_hash_value = getattr(metadata, 'file_hash', None)
    print(f"[Sync] Creating new Literature: title='{metadata.title[:50] if metadata.title else 'N/A'}...', file_hash={file_hash_value}")
    new_literature = Literature(
        doi=final_doi,  # Use None if empty to avoid UNIQUE constraint
        title=metadata.title,
        authors=metadata.authors,
        journal=metadata.journal,
        issn=getattr(metadata, 'issn', None),
        year=metadata.year,
        volume=getattr(metadata, 'volume', None),
        issue=getattr(metadata, 'issue', None),
        pages=getattr(metadata, 'pages', None),
        file_path=getattr(metadata, 'file_path', None),
        file_hash=file_hash_value  # Smart caching hash
    )
    
    db.add(new_literature)
    await db.flush()  # Get the ID without committing
    print(f"[Sync] Created new Literature ID={new_literature.id}, file_hash={new_literature.file_hash}")
    
    return new_literature, True


async def sync_batch_data(
    db: AsyncSession,
    payload: SyncPayload
) -> SyncResult:
    """
    Batch sync tribology data to database.
    
    Strategy:
    1. Get or create Literature from metadata
    2. (Optional) Delete existing TribologyData for this Literature
    3. Bulk insert new TribologyData records
    4. Commit or rollback
    
    Args:
        db: Database session
        payload: SyncPayload containing metadata and records
    
    Returns:
        SyncResult with operation status
    """
    try:
        # Step 1: Get or create Literature
        literature, is_new = await get_or_create_literature(db, payload.metadata)
        
        # Step 2: 【关键修复】If Literature exists, clear old data to prevent duplicates
        if not is_new:
            print(f"[Sync Debug] Overwriting data for Literature ID: {literature.id}")
            delete_stmt = delete(TribologyData).where(
                TribologyData.literature_id == literature.id
            )
            delete_result = await db.execute(delete_stmt)
            print(f"[Sync Debug] Deleted {delete_result.rowcount} old records for Literature ID: {literature.id}")
        
        # Step 3: Bulk insert new TribologyData records
        new_records: List[TribologyData] = []
        
        for record in payload.records:
            tribology_record = TribologyData(
                literature_id=literature.id,
                material_name=record.material_name,
                lubricant=record.lubricant,
                cof_value=record.cof_value,
                cof_operator=record.cof_operator,
                cof_raw=record.cof_raw,
                load_value=record.load_value,
                load_raw=record.load_raw,
                speed_value=record.speed_value,
                temperature=record.temperature,
                # Environmental variables
                potential=getattr(record, 'potential', None),
                water_content=getattr(record, 'water_content', None),
                surface_roughness=getattr(record, 'surface_roughness', None),
                confidence=record.confidence
            )
            new_records.append(tribology_record)
        
        db.add_all(new_records)
        
        # Step 4: Commit transaction
        await db.commit()
        
        return SyncResult(
            success=True,
            literature_id=literature.id,
            synced_count=len(new_records),
            message=f"成功同步 {len(new_records)} 条记录到文献 ID={literature.id}"
        )
        
    except Exception as e:
        print(f"[Sync] ERROR: {str(e)}")
        traceback.print_exc()  # Print full stack trace for debugging
        await db.rollback()
        # Return a failed result - use literature_id=0 to indicate failure
        return SyncResult(
            success=False,
            literature_id=0,
            synced_count=0,
            message=f"同步失败: {str(e)}"
        )


async def sync_batch_data_with_replacement(
    db: AsyncSession,
    payload: SyncPayload
) -> SyncResult:
    """
    Batch sync with FULL REPLACEMENT strategy.
    Deletes all existing TribologyData for the Literature before inserting new.
    
    Args:
        db: Database session
        payload: SyncPayload containing metadata and records
    
    Returns:
        SyncResult with operation status
    """
    try:
        # Step 1: Get or create Literature
        literature, is_new = await get_or_create_literature(db, payload.metadata)
        
        deleted_count = 0
        # Step 2: Delete existing TribologyData if Literature exists
        if not is_new:
            delete_stmt = delete(TribologyData).where(
                TribologyData.literature_id == literature.id
            )
            delete_result = await db.execute(delete_stmt)
            deleted_count = delete_result.rowcount
        
        # Step 3: Bulk insert new TribologyData records
        new_records: List[TribologyData] = []
        
        for record in payload.records:
            tribology_record = TribologyData(
                literature_id=literature.id,
                material_name=record.material_name,
                lubricant=record.lubricant,
                cof_value=record.cof_value,
                cof_operator=record.cof_operator,
                cof_raw=record.cof_raw,
                load_value=record.load_value,
                load_raw=record.load_raw,
                speed_value=record.speed_value,
                temperature=record.temperature,
                # Environmental variables
                potential=getattr(record, 'potential', None),
                water_content=getattr(record, 'water_content', None),
                surface_roughness=getattr(record, 'surface_roughness', None),
                confidence=record.confidence
            )
            new_records.append(tribology_record)
        
        db.add_all(new_records)
        
        # Step 4: Commit transaction
        await db.commit()
        
        return SyncResult(
            success=True,
            literature_id=literature.id,
            synced_count=len(new_records),
            message=f"成功同步 {len(new_records)} 条记录 (删除 {deleted_count} 条旧记录)"
        )
        
    except Exception as e:
        await db.rollback()
        return SyncResult(
            success=False,
            literature_id=0,
            synced_count=0,
            message=f"同步失败: {str(e)}"
        )


# ============== Query Functions ==============

async def get_literature_by_id(
    db: AsyncSession,
    literature_id: int
) -> Optional[Literature]:
    """Get Literature by ID with eager loading of tribology_data."""
    query = select(Literature).where(Literature.id == literature_id)
    result = await db.execute(query)
    return result.scalar_one_or_none()


async def get_literature_by_doi(
    db: AsyncSession,
    doi: str
) -> Optional[Literature]:
    """Get Literature by DOI."""
    query = select(Literature).where(Literature.doi == doi)
    result = await db.execute(query)
    return result.scalar_one_or_none()


async def get_literature_by_hash(
    db: AsyncSession,
    file_hash: str
) -> Optional[Literature]:
    """
    Get Literature by file content hash.
    Used for smart caching - skip LLM if same file was extracted before.
    """
    if not file_hash:
        return None
    query = select(Literature).where(Literature.file_hash == file_hash)
    result = await db.execute(query)
    return result.scalar_one_or_none()


async def get_records_by_literature(
    db: AsyncSession,
    literature_id: int
) -> List[TribologyData]:
    """Get all TribologyData for a Literature."""
    query = select(TribologyData).where(
        TribologyData.literature_id == literature_id
    )
    result = await db.execute(query)
    return list(result.scalars().all())


async def get_all_literature(
    db: AsyncSession,
    skip: int = 0,
    limit: int = 100
) -> List[Literature]:
    """Get all Literature records with pagination."""
    query = (
        select(Literature)
        .order_by(Literature.created_at.desc())
        .offset(skip)
        .limit(limit)
    )
    result = await db.execute(query)
    return list(result.scalars().all())


async def delete_literature(
    db: AsyncSession,
    literature_id: int
) -> bool:
    """
    Delete a Literature and all its TribologyData (cascade).
    
    Returns:
        True if deleted, False if not found
    """
    literature = await get_literature_by_id(db, literature_id)
    if not literature:
        return False
    
    await db.delete(literature)
    await db.commit()
    return True
