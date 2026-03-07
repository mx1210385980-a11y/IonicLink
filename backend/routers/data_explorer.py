"""
Data Explorer Router for IonicLink
API endpoints for searching and exploring tribology data.
"""

from typing import List, Optional
import re
from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, func, desc
from sqlalchemy.orm import selectinload

from database import get_db_session
from models.db_models import TribologyData, Literature


router = APIRouter(
    prefix="/api/records",
    tags=["Data Explorer"],
    responses={404: {"description": "Not found"}},
)


# --- Pydantic Models ---

class SearchFilter(BaseModel):
    """Filter parameters for searching tribology records"""
    materials: List[str] = Field(default_factory=list, description="List of material names")
    lubricants: List[str] = Field(default_factory=list, description="List of lubricants")
    load_min: Optional[float] = Field(None, alias="loadMin", description="Min load (N)")
    load_max: Optional[float] = Field(None, alias="loadMax", description="Max load (N)")
    cof_min: Optional[float] = Field(None, alias="cofMin", description="Min COF")
    cof_max: Optional[float] = Field(None, alias="cofMax", description="Max COF")
    doi: Optional[str] = Field(None, description="Literature DOI")
    file_id: Optional[str] = Field(None, alias="fileId", description="File ID to filter by a specific uploaded file")
    
    class Config:
        populate_by_name = True


class LiteratureDTO(BaseModel):
    """Simplified Literature info for record response"""
    id: int
    doi: str
    title: str
    authors: Optional[str] = None
    journal: str
    year: Optional[int] = None
    
    class Config:
        from_attributes = True


class RecordResponse(BaseModel):
    """Response model for tribology records"""
    id: int
    material_name: str = Field(..., alias="materialName")
    lubricant: str
    
    cof_value: Optional[float] = Field(None, alias="cofValue")
    cof_operator: Optional[str] = Field(None, alias="cofOperator")
    cof_raw: Optional[str] = Field(None, alias="cofRaw")
    
    load_value: Optional[str] = Field(None, alias="loadValue")   # stored with units, e.g. '20 nN'
    load_raw: Optional[str] = Field(None, alias="loadRaw")
    
    speed_value: Optional[str] = Field(None, alias="speedValue")  # stored with units, e.g. '1 碌m/s'
    temperature: Optional[str] = None
    potential: Optional[str] = None
    water_content: Optional[str] = Field(None, alias="waterContent")
    surface_roughness: Optional[str] = Field(None, alias="surfaceRoughness")
    film_thickness: Optional[str] = Field(None, alias="filmThickness")
    
    # Evidence / Source fields
    evidence: Optional[str] = None
    evidence_page: Optional[int] = Field(None, alias="evidencePage")
    evidence_bbox: Optional[str] = Field(None, alias="evidenceBbox")
    source: Optional[str] = None
    
    confidence: float
    literature_id: int = Field(..., alias="literatureId")
    literature: Optional[LiteratureDTO] = None

    class Config:
        from_attributes = True
        populate_by_name = True


class PaginatedRecordResponse(BaseModel):
    """Paginated response for tribology records"""
    total: int
    skip: int
    limit: int
    items: List[RecordResponse]


class RecordUpdatePayload(BaseModel):
    """Payload for updating a single tribology record"""
    cof_raw: Optional[str] = Field(None, alias="cofRaw")
    cof_value: Optional[float] = Field(None, alias="cofValue")
    temperature: Optional[str] = None
    potential: Optional[str] = None
    water_content: Optional[str] = Field(None, alias="waterContent")
    speed_value: Optional[str] = Field(None, alias="speedValue")
    load_value: Optional[str] = Field(None, alias="loadValue")
    surface_roughness: Optional[str] = Field(None, alias="surfaceRoughness")
    film_thickness: Optional[str] = Field(None, alias="filmThickness")
    material_name: Optional[str] = Field(None, alias="materialName")
    lubricant: Optional[str] = None

    class Config:
        populate_by_name = True


# --- Helper: Build query conditions ---

def _build_conditions(filter_params: SearchFilter):
    conditions = []
    if filter_params.materials:
        conditions.append(TribologyData.material_name.in_(filter_params.materials))
    if filter_params.lubricants:
        conditions.append(TribologyData.lubricant.in_(filter_params.lubricants))
    if filter_params.cof_min is not None:
        conditions.append(TribologyData.cof_value >= filter_params.cof_min)
    if filter_params.cof_max is not None:
        conditions.append(TribologyData.cof_value <= filter_params.cof_max)
    if filter_params.doi:
        conditions.append(Literature.doi == filter_params.doi)
    if filter_params.file_id:
        # Try to filter by Literature.id directly (most reliable since file_id IS the lit id)
        try:
            lit_id = int(filter_params.file_id)
            conditions.append(TribologyData.literature_id == lit_id)
        except (ValueError, TypeError):
            # Fallback: match against file_path stored in Literature table
            conditions.append(Literature.file_path.like(f"%{filter_params.file_id}%"))
    return conditions


def _parse_load_numeric(value: Optional[str]) -> Optional[float]:
    """Extract leading numeric part from load strings like '20 nN' or '0.5 N'."""
    if value is None:
        return None

    text = str(value).strip()
    if not text:
        return None

    match = re.search(r'-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?', text)
    if not match:
        return None

    try:
        return float(match.group(0))
    except ValueError:
        return None

def _record_to_response(r: TribologyData) -> RecordResponse:
    lit_dto = None
    if r.literature:
        lit_dto = LiteratureDTO(
            id=r.literature.id,
            doi=r.literature.doi or "",
            title=r.literature.title or "",
            authors=r.literature.authors,
            journal=r.literature.journal or "",
            year=r.literature.year
        )
    return RecordResponse(
        id=r.id,
        material_name=r.material_name,
        lubricant=r.lubricant,
        cof_value=r.cof_value,
        cof_operator=r.cof_operator,
        cof_raw=r.cof_raw,
        load_value=r.load_value,
        load_raw=r.load_raw,
        speed_value=r.speed_value,
        temperature=r.temperature,
        potential=r.potential,
        water_content=r.water_content,
        surface_roughness=r.surface_roughness,
        film_thickness=r.film_thickness,
        evidence=getattr(r, 'evidence', None),
        evidence_page=getattr(r, 'evidence_page', None),
        evidence_bbox=getattr(r, 'evidence_bbox', None),
        source=getattr(r, 'source', None),
        confidence=r.confidence,
        literature_id=r.literature_id,
        literature=lit_dto
    )


# --- API Endpoints ---

@router.post("/search", response_model=PaginatedRecordResponse, response_model_by_alias=True)
async def search_records(
    filter_params: SearchFilter,
    skip: int = Query(0, ge=0, description="Number of records to skip"),
    limit: int = Query(20, ge=1, le=200, description="Max records to return"),
    session: AsyncSession = Depends(get_db_session)
):
    """
    鎼滅储鎽╂摝瀛︽暟鎹褰曪紙鏀寔鍒嗛〉锛?
    鏀寔鎸夋潗鏂欍€佹鼎婊戝墏銆佽浇鑽疯寖鍥淬€丆OF鑼冨洿杩囨护
    """
    conditions = _build_conditions(filter_params)
    use_load_filter = filter_params.load_min is not None or filter_params.load_max is not None

    if use_load_filter:
        # Load values are stored as strings with units, so apply load filters in Python.
        stmt = select(TribologyData).join(TribologyData.literature).options(selectinload(TribologyData.literature))
        if conditions:
            stmt = stmt.where(and_(*conditions))
        stmt = stmt.order_by(TribologyData.id)

        result = await session.execute(stmt)
        all_records = result.scalars().all()

        filtered_records = []
        for record in all_records:
            numeric_load = _parse_load_numeric(record.load_value)
            if numeric_load is None:
                continue
            if filter_params.load_min is not None and numeric_load < filter_params.load_min:
                continue
            if filter_params.load_max is not None and numeric_load > filter_params.load_max:
                continue
            filtered_records.append(record)

        total = len(filtered_records)
        records = filtered_records[skip: skip + limit]
    else:
        # Count total
        count_stmt = select(func.count(TribologyData.id)).join(TribologyData.literature)
        if conditions:
            count_stmt = count_stmt.where(and_(*conditions))
        total_result = await session.execute(count_stmt)
        total = total_result.scalar() or 0

        # Fetch page
        stmt = select(TribologyData).join(TribologyData.literature).options(selectinload(TribologyData.literature))
        if conditions:
            stmt = stmt.where(and_(*conditions))
        stmt = stmt.order_by(TribologyData.id).offset(skip).limit(limit)

        result = await session.execute(stmt)
        records = result.scalars().all()

    return PaginatedRecordResponse(
        total=total,
        skip=skip,
        limit=limit,
        items=[_record_to_response(r) for r in records]
    )

@router.get("/options", response_model=dict)
async def get_filter_options(session: AsyncSession = Depends(get_db_session)):
    """
    鑾峰彇鍙敤鐨勮繃婊ら€夐」锛堟潗鏂欏垪琛ㄣ€佹鼎婊戝墏鍒楄〃绛夛級
    """
    result_materials = await session.execute(
        select(TribologyData.material_name).distinct()
    )
    materials = result_materials.scalars().all()
    
    result_lubricants = await session.execute(
        select(TribologyData.lubricant).distinct()
    )
    lubricants = result_lubricants.scalars().all()
    
    return {
        "materials": sorted([m for m in materials if m]),
        "lubricants": sorted([l for l in lubricants if l])
    }


@router.get("/stats", response_model=dict)
async def get_stats(session: AsyncSession = Depends(get_db_session)):
    """
    鑾峰彇鏁版嵁缁熻淇℃伅
    """
    total_records = await session.execute(
        select(func.count(TribologyData.id))
    )
    total = total_records.scalar() or 0
    
    total_lit = await session.execute(
        select(func.count(Literature.id))
    )
    literature_count = total_lit.scalar() or 0
    
    cof_stats = await session.execute(
        select(
            func.min(TribologyData.cof_value),
            func.max(TribologyData.cof_value),
            func.avg(TribologyData.cof_value)
        )
    )
    cof_row = cof_stats.one()
    
    # --- New Dashboard Stats ---
    # 1. Materials Ratio
    mat_stmt = select(TribologyData.material_name, func.count('*')).group_by(TribologyData.material_name).order_by(desc(func.count('*'))).where(TribologyData.material_name != None).where(TribologyData.material_name != '').limit(5)
    mat_res = await session.execute(mat_stmt)
    materials_ratio = [{"name": row[0], "count": row[1]} for row in mat_res.all() if row[0]]

    # 2. Top Ionic Liquids
    il_stmt = select(TribologyData.lubricant, func.count('*')).group_by(TribologyData.lubricant).order_by(desc(func.count('*'))).where(TribologyData.lubricant != None).where(TribologyData.lubricant != '').where(~func.lower(TribologyData.lubricant).like('%ethaline%')).where(~func.lower(TribologyData.lubricant).like('%chcl%')).limit(5)
    il_res = await session.execute(il_stmt)
    top_liquids = [{"name": row[0], "count": row[1]} for row in il_res.all() if row[0]]

    # 3. Publication Trend (by Year)
    year_stmt = select(Literature.year, func.count('*')).group_by(Literature.year).order_by(Literature.year).where(Literature.year != None)
    year_res = await session.execute(year_stmt)
    publication_trend = [{"year": row[0], "count": row[1]} for row in year_res.all() if row[0]]

    # 4. Top Journals
    journal_stmt = select(Literature.journal, func.count('*')).group_by(Literature.journal).order_by(desc(func.count('*'))).where(Literature.journal != None).where(Literature.journal != '').limit(5)
    journal_res = await session.execute(journal_stmt)
    top_journals = [{"name": row[0], "count": row[1]} for row in journal_res.all() if row[0]]
    
    # 5. Distinct Ionic Liquids Count
    distinct_il_count_stmt = select(func.count(func.distinct(TribologyData.lubricant))).where(TribologyData.lubricant != None).where(TribologyData.lubricant != '').where(~func.lower(TribologyData.lubricant).like('%ethaline%')).where(~func.lower(TribologyData.lubricant).like('%chcl%'))
    distinct_il_count_res = await session.execute(distinct_il_count_stmt)
    distinct_il_count = distinct_il_count_res.scalar() or 0
    
    # 6. COF Ranges by Material
    cof_range_stmt = select(TribologyData.material_name, func.min(TribologyData.cof_value), func.max(TribologyData.cof_value)).group_by(TribologyData.material_name).where(TribologyData.material_name != None).where(TribologyData.material_name != '').where(TribologyData.cof_value != None)
    cof_range_res = await session.execute(cof_range_stmt)
    cof_ranges = [{"name": row[0], "min": row[1], "max": row[2]} for row in cof_range_res.all() if row[0] and row[1] is not None and row[2] is not None]

    return {
        "total_records": total,
        "literature_count": literature_count,
        "distinct_il_count": distinct_il_count,
        "cof_stats": {
            "min": cof_row[0],
            "max": cof_row[1],
            "avg": float(cof_row[2]) if cof_row[2] else None
        },
        "materials_ratio": materials_ratio,
        "top_liquids": top_liquids,
        "publication_trend": publication_trend,
        "top_journals": top_journals,
        "cof_ranges": cof_ranges
    }


@router.put("/{record_id}", response_model=dict, response_model_by_alias=True)
async def update_record(
    record_id: int,
    payload: RecordUpdatePayload,
    session: AsyncSession = Depends(get_db_session)
):
    """
    鏇存柊鍗曟潯鎽╂摝瀛︽暟鎹褰曪紙鐢ㄤ簬鍓嶇鍐呰仈缂栬緫纭锛?
    """
    from fastapi import HTTPException

    result = await session.execute(
        select(TribologyData).where(TribologyData.id == record_id)
    )
    record = result.scalar_one_or_none()
    if not record:
        raise HTTPException(status_code=404, detail=f"Record {record_id} not found")

    update_data = payload.dict(exclude_none=True, by_alias=False)
    for field, value in update_data.items():
        if hasattr(record, field):
            setattr(record, field, value)

    await session.commit()
    return {"success": True, "id": record_id}


@router.delete("/{record_id}", response_model=dict)
async def delete_record(
    record_id: int,
    session: AsyncSession = Depends(get_db_session)
):
    """
    鍒犻櫎鍗曟潯鎽╂摝瀛︽暟鎹褰?
    """
    from fastapi import HTTPException

    result = await session.execute(
        select(TribologyData).where(TribologyData.id == record_id)
    )
    record = result.scalar_one_or_none()
    if not record:
        raise HTTPException(status_code=404, detail=f"Record {record_id} not found")

    await session.delete(record)
    await session.commit()
    return {"success": True, "id": record_id}


@router.get("/il/resolve", response_model=dict)
async def resolve_ionic_liquid(name: str = Query(..., description="Ionic liquid name to resolve")):
    """
    Resolve an IL name to its structural components and chemical identifiers.
    """
    from services.il_resolver_service import resolve_il
    result = resolve_il(name)
    return result



