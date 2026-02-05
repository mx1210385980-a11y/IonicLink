"""
Data Explorer Router for IonicLink
API endpoints for searching and exploring tribology data.
"""

from typing import List, Optional
from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_
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
    materials: List[str] = Field(default_factory=list, description="材料名称列表")
    lubricants: List[str] = Field(default_factory=list, description="润滑剂列表")
    load_min: Optional[float] = Field(None, alias="loadMin", description="最小载荷 (N)")
    load_max: Optional[float] = Field(None, alias="loadMax", description="最大载荷 (N)")
    cof_min: Optional[float] = Field(None, alias="cofMin", description="最小 COF")
    cof_max: Optional[float] = Field(None, alias="cofMax", description="最大 COF")
    
    class Config:
        populate_by_name = True


class LiteratureDTO(BaseModel):
    """Simplified Literature info for record response"""
    id: int
    doi: str
    title: str
    journal: str
    year: int
    
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
    
    load_value: Optional[float] = Field(None, alias="loadValue")
    load_raw: Optional[str] = Field(None, alias="loadRaw")
    
    speed_value: Optional[float] = Field(None, alias="speedValue")
    temperature: Optional[float] = None
    
    confidence: float
    literature_id: int = Field(..., alias="literatureId")
    literature: Optional[LiteratureDTO] = None

    class Config:
        from_attributes = True
        populate_by_name = True


# --- API Endpoints ---

@router.post("/search", response_model=List[RecordResponse])
async def search_records(
    filter_params: SearchFilter,
    session: AsyncSession = Depends(get_db_session)
):
    """
    搜索摩擦学数据记录
    支持按材料、润滑剂、载荷范围、COF范围过滤
    """
    stmt = select(TribologyData).options(
        selectinload(TribologyData.literature)
    )
    
    conditions = []
    
    # Material Filter
    if filter_params.materials:
        conditions.append(TribologyData.material_name.in_(filter_params.materials))
        
    # Lubricant Filter
    if filter_params.lubricants:
        conditions.append(TribologyData.lubricant.in_(filter_params.lubricants))
        
    # Load Range Filter
    if filter_params.load_min is not None:
        conditions.append(TribologyData.load_value >= filter_params.load_min)
    if filter_params.load_max is not None:
        conditions.append(TribologyData.load_value <= filter_params.load_max)
        
    # COF Range Filter
    if filter_params.cof_min is not None:
        conditions.append(TribologyData.cof_value >= filter_params.cof_min)
    if filter_params.cof_max is not None:
        conditions.append(TribologyData.cof_value <= filter_params.cof_max)

    if conditions:
        stmt = stmt.where(and_(*conditions))
        
    # Limit results to avoid overwhelming frontend
    stmt = stmt.limit(1000)

    result = await session.execute(stmt)
    records = result.scalars().all()
    
    # Convert to response models
    response = []
    for r in records:
        lit_dto = None
        if r.literature:
            lit_dto = LiteratureDTO(
                id=r.literature.id,
                doi=r.literature.doi,
                title=r.literature.title,
                journal=r.literature.journal,
                year=r.literature.year
            )
        
        response.append(RecordResponse(
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
            confidence=r.confidence,
            literature_id=r.literature_id,
            literature=lit_dto
        ))
    
    return response


@router.get("/options", response_model=dict)
async def get_filter_options(session: AsyncSession = Depends(get_db_session)):
    """
    获取可用的过滤选项（材料列表、润滑剂列表等）
    """
    # 获取唯一的材料名称
    result_materials = await session.execute(
        select(TribologyData.material_name).distinct()
    )
    materials = result_materials.scalars().all()
    
    # 获取唯一的润滑剂名称
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
    获取数据统计信息
    """
    from sqlalchemy import func
    
    # 总记录数
    total_records = await session.execute(
        select(func.count(TribologyData.id))
    )
    total = total_records.scalar()
    
    # 文献数量
    total_lit = await session.execute(
        select(func.count(Literature.id))
    )
    literature_count = total_lit.scalar()
    
    # COF 范围
    cof_stats = await session.execute(
        select(
            func.min(TribologyData.cof_value),
            func.max(TribologyData.cof_value),
            func.avg(TribologyData.cof_value)
        )
    )
    cof_row = cof_stats.one()
    
    return {
        "total_records": total,
        "literature_count": literature_count,
        "cof_stats": {
            "min": cof_row[0],
            "max": cof_row[1],
            "avg": float(cof_row[2]) if cof_row[2] else None
        }
    }
