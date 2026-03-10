"""Pydantic schemas for IonicLink APIs."""

from __future__ import annotations

from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, Field


class LiteratureBase(BaseModel):
    doi: Optional[str] = Field(None)
    title: Optional[str] = Field(None)
    authors: Optional[str] = Field(None)
    journal: Optional[str] = Field(None)
    issn: Optional[str] = None
    year: Optional[int] = Field(None, ge=1900, le=2100)
    volume: Optional[str] = None
    issue: Optional[str] = None
    pages: Optional[str] = None
    file_path: Optional[str] = Field("", alias="filePath")

    class Config:
        populate_by_name = True


class LiteratureCreate(LiteratureBase):
    pass


class LiteratureSchema(LiteratureBase):
    id: int
    created_at: datetime

    class Config:
        from_attributes = True
        populate_by_name = True


class TribologyDataBase(BaseModel):
    material_name: str = Field(..., alias="materialName")
    lubricant: str = Field("")

    cof_value: Optional[float] = Field(None, alias="cofValue")
    cof_operator: Optional[str] = Field(None, alias="cofOperator")
    cof_raw: Optional[str] = Field(None, alias="cofRaw")

    load_value: Optional[str] = Field(None, alias="loadValue")
    load_raw: Optional[str] = Field(None, alias="loadRaw")

    speed_value: Optional[str] = Field(None, alias="speedValue")
    speed_raw: Optional[str] = Field(None, alias="speedRaw")
    temperature: Optional[str] = None
    temperature_value: Optional[float] = Field(None, alias="temperatureValue")

    potential: Optional[str] = None
    water_content: Optional[str] = Field(None, alias="waterContent")
    surface_roughness: Optional[str] = Field(None, alias="surfaceRoughness")

    residual_film_thickness_d: Optional[str] = Field(None, alias="residualFilmThicknessD")
    layer_spacing_delta: Optional[str] = Field(None, alias="layerSpacingDelta")
    film_thickness: Optional[str] = Field(None, alias="filmThickness")

    mol_ratio: Optional[str] = Field(None, alias="molRatio")
    cation: Optional[str] = None
    anion: Optional[str] = None
    cation_smiles: Optional[str] = Field(None, alias="cationSmiles")
    anion_smiles: Optional[str] = Field(None, alias="anionSmiles")
    il_smiles: Optional[str] = Field(None, alias="ilSmiles")
    il_inchikey: Optional[str] = Field(None, alias="ilInchikey")
    alkyl_chain_length: Optional[int] = Field(None, alias="alkylChainLength")

    evidence: Optional[str] = None
    source: Optional[str] = None
    source_page: Optional[int] = Field(None, alias="sourcePage")
    source_figure: Optional[str] = Field(None, alias="sourceFigure")

    confidence: float = Field(0.9, ge=0.0, le=1.0)

    class Config:
        populate_by_name = True


class TribologyDataCreate(TribologyDataBase):
    pass


class TribologyDataSchema(TribologyDataBase):
    id: int
    literature_id: int = Field(..., alias="literatureId")
    extracted_at: datetime = Field(..., alias="extractedAt")

    class Config:
        from_attributes = True
        populate_by_name = True


class SyncPayload(BaseModel):
    metadata: LiteratureCreate
    records: List[TribologyDataCreate]


class SyncResult(BaseModel):
    success: bool
    literature_id: int = Field(..., alias="literatureId")
    synced_count: int = Field(..., alias="syncedCount")
    message: Optional[str] = None

    class Config:
        populate_by_name = True


class LiteratureWithRecords(LiteratureSchema):
    tribology_data: List[TribologyDataSchema] = Field(default_factory=list, alias="tribologyData")

    class Config:
        from_attributes = True
        populate_by_name = True


class PaginatedResponse(BaseModel):
    total: int
    page: int
    page_size: int = Field(..., alias="pageSize")
    items: List[TribologyDataSchema]

    class Config:
        populate_by_name = True
