"""
Pydantic Schemas for IonicLink API
DTOs for Literature and TribologyData models.
"""

from datetime import datetime
from typing import List, Optional
from pydantic import BaseModel, Field


# ============== Literature Schemas ==============

class LiteratureBase(BaseModel):
    """Base schema for Literature metadata"""
    doi: Optional[str] = Field(None, description="Digital Object Identifier")
    
    title: Optional[str] = Field(None, description="文献标题")
    authors: Optional[str] = Field(None, description="作者列表 (comma-separated)")
    journal: Optional[str] = Field(None, description="期刊名")
    issn: Optional[str] = None
    
    year: Optional[int] = Field(None, ge=1900, le=2100, description="发表年份")
    volume: Optional[str] = None
    issue: Optional[str] = None
    pages: Optional[str] = None
    
    file_path: Optional[str] = Field("", alias="filePath", description="本地 PDF 路径")
    
    class Config:
        populate_by_name = True


class LiteratureCreate(LiteratureBase):
    """Schema for creating new Literature entry"""
    pass


class LiteratureSchema(LiteratureBase):
    """Response schema for Literature with ID and timestamps"""
    id: int
    created_at: datetime
    
    class Config:
        from_attributes = True
        populate_by_name = True


# ============== TribologyData Schemas ==============

class TribologyDataBase(BaseModel):
    """Base schema for TribologyData records"""
    material_name: str = Field(..., alias="materialName", description="材料名称/基底表面 (Mica, HOPG, Au(111), Silica, Stainless steel, Titanium)")
    lubricant: str = Field("", description="润滑剂")
    
    # COF Data
    cof_value: Optional[float] = Field(None, alias="cofValue", description="COF 数值")
    cof_operator: Optional[str] = Field(None, alias="cofOperator", description="比较运算符 (<, >, ~, =)")
    cof_raw: Optional[str] = Field(None, alias="cofRaw", description="原始提取文本")
    
    # Load Data
    load_value: Optional[float] = Field(None, alias="loadValue", description="载荷 (N)")
    load_raw: Optional[str] = Field(None, alias="loadRaw", description="原始载荷文本")
    
    # Speed & Temperature
    speed_value: Optional[float] = Field(None, alias="speedValue", description="速度 (m/s)")
    speed_raw: Optional[str] = Field(None, alias="speedRaw", description="原始速度文本 (含单位)")
    temperature: Optional[str] = Field(None, description="温度 (含单位)")
    temperature_value: Optional[float] = Field(None, alias="temperatureValue", description="温度数值")
    
    # Environmental Variables
    potential: Optional[str] = Field(None, description="Electrochemical potential (e.g., '+1.5V', 'OCP')")
    water_content: Optional[str] = Field(None, alias="waterContent", description="Water concentration (e.g., '50 ppm', 'Dry')")
    surface_roughness: Optional[str] = Field(None, alias="surfaceRoughness", description="Surface roughness (e.g., 'RMS 4.9 nm')")
    
    # Film Thickness - Split into two distinct parameters for nanoconfinement studies
    residual_film_thickness_d: Optional[str] = Field(None, alias="residualFilmThicknessD", description="Total confined thickness at hard wall (e.g., '3 nm')")
    layer_spacing_delta: Optional[str] = Field(None, alias="layerSpacingDelta", description="Single molecular layer thickness (e.g., '0.7 nm')")
    film_thickness: Optional[str] = Field(None, alias="filmThickness", description="[Deprecated] Generic film thickness")
    
    mol_ratio: Optional[str] = Field(None, alias="molRatio", description="Molar ratio (e.g., '1:70')")
    cation: Optional[str] = Field(None, description="Cation type (e.g., 'HMIM', 'P66614')")
    anion: Optional[str] = Field(None, description="Anion type (e.g., 'TFSI', 'PF6')")
    cation_smiles: Optional[str] = Field(None, alias="cationSmiles", description="Cation SMILES")
    anion_smiles: Optional[str] = Field(None, alias="anionSmiles", description="Anion SMILES")
    il_smiles: Optional[str] = Field(None, alias="ilSmiles", description="Full IL SMILES")
    il_inchikey: Optional[str] = Field(None, alias="ilInchikey", description="InChIKey for cross-literature alignment")
    alkyl_chain_length: Optional[int] = Field(None, alias="alkylChainLength", description="Alkyl chain length of cation")
    
    # Confidence
    confidence: float = Field(0.9, ge=0.0, le=1.0, description="AI 置信度")
    
    class Config:
        populate_by_name = True


class TribologyDataCreate(TribologyDataBase):
    """Schema for creating new TribologyData entry (without literature_id)"""
    pass


class TribologyDataSchema(TribologyDataBase):
    """Response schema for TribologyData with IDs and timestamps"""
    id: int
    literature_id: int = Field(..., alias="literatureId")
    extracted_at: datetime = Field(..., alias="extractedAt")
    
    class Config:
        from_attributes = True
        populate_by_name = True


# ============== Sync Payload Schemas ==============

class SyncPayload(BaseModel):
    """
    Payload for batch data synchronization.
    Contains literature metadata + list of tribology records.
    """
    metadata: LiteratureCreate = Field(..., description="文献元数据")
    records: List[TribologyDataCreate] = Field(..., description="摩擦学数据记录列表")


class SyncResult(BaseModel):
    """Response model for sync operation"""
    success: bool
    literature_id: int = Field(..., alias="literatureId", description="文献 ID")
    synced_count: int = Field(..., alias="syncedCount", description="同步的记录数")
    message: Optional[str] = None
    
    class Config:
        populate_by_name = True


# ============== Query Schemas ==============

class LiteratureWithRecords(LiteratureSchema):
    """Literature with nested tribology records"""
    tribology_data: List[TribologyDataSchema] = Field(
        default_factory=list,
        alias="tribologyData"
    )
    
    class Config:
        from_attributes = True
        populate_by_name = True


class PaginatedResponse(BaseModel):
    """Generic paginated response wrapper"""
    total: int
    page: int
    page_size: int = Field(..., alias="pageSize")
    items: List[TribologyDataSchema]
    
    class Config:
        populate_by_name = True
