from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from models.db_models import Literature, TribologyData
from typing import Dict, Any, List

async def get_or_create_literature(session: AsyncSession, metadata: Dict[str, Any], file_path: str) -> Literature:
    """
    Check if literature exists by DOI, otherwise create it.
    
    Args:
        session: Database session
        metadata: Dictionary containing metadata (doi, title, authors, etc.)
        file_path: Path to the stored PDF file
        
    Returns:
        Literature instance (persisted)
    """
    doi = metadata.get("doi")
    
    # 1. Try to find existing literature by DOI
    if doi:
        stmt = select(Literature).where(Literature.doi == doi)
        result = await session.execute(stmt)
        existing_lit = result.scalar_one_or_none()
        if existing_lit:
            # Update file_path if needed or just return
            return existing_lit

    # 2. Create new Literature record
    new_lit = Literature(
        doi=doi or "UNKNOWN_DOI_" + file_path, # Fallback if DOI missing, though schema requires unique DOI
        pmid=metadata.get("pmid"),
        arxiv_id=metadata.get("arxiv_id"),
        title=metadata.get("title", "Unknown Title"),
        authors=metadata.get("authors", ""),
        journal=metadata.get("journal", ""),
        issn=metadata.get("issn"),
        year=metadata.get("year", 0),
        volume=metadata.get("volume"),
        issue=metadata.get("issue"),
        pages=metadata.get("pages"),
        file_path=file_path
    )
    
    session.add(new_lit)
    await session.flush() # Flush to get the ID
    await session.refresh(new_lit)
    return new_lit


async def save_tribology_data(session: AsyncSession, literature_id: int, extracted_data: List[Dict[str, Any]]):
    """
    Save extracted data points linked to a literature ID.
    
    Args:
        session: Database session
        literature_id: The ID of the parent Literature record
        extracted_data: List of dictionaries containing extraction results
    """
    for item in extracted_data:
        # Map fields from extraction result to DB model
        record = TribologyData(
            literature_id=literature_id,
            material_name=item.get("material_name", "Unknown"),
            lubricant=item.get("lubricant", "Unknown"),
            
            # COF
            cof_value=item.get("cof_value"),
            cof_operator=item.get("cof_operator"),
            cof_raw=item.get("cof_raw"),
            
            # Load
            load_value=item.get("load_value"),
            load_raw=item.get("load_raw"),
            
            # Speed/Temp
            speed_value=item.get("speed_value"),
            temperature=item.get("temperature"),
            
            # Meta
            confidence=item.get("confidence", 0.9)
        )
        session.add(record)
    
    await session.commit()
