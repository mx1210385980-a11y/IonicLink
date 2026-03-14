"""Pydantic schemas for IonicLink APIs."""

from __future__ import annotations

from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, Field, model_validator

from utils.tribopair import compose_tribopair_label, derive_legacy_material_name, derive_legacy_surface_roughness


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
    group_id: Optional[int] = Field(None, alias="groupId")
    workspace_id: Optional[int] = Field(None, alias="workspaceId")
    created_by_user_id: Optional[int] = Field(None, alias="createdByUserId")
    scope_type: Optional[str] = Field(None, alias="scopeType")
    created_at: datetime

    class Config:
        from_attributes = True
        populate_by_name = True


class TribologyDataBase(BaseModel):
    material_name: Optional[str] = Field(None, alias="materialName")
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
    probe_material: Optional[str] = Field(None, alias="probeMaterial")
    probe_geometry: Optional[str] = Field(None, alias="probeGeometry")
    probe_radius: Optional[str] = Field(None, alias="probeRadius")
    probe_roughness: Optional[str] = Field(None, alias="probeRoughness")
    substrate_material: Optional[str] = Field(None, alias="substrateMaterial")
    substrate_coating: Optional[str] = Field(None, alias="substrateCoating")
    substrate_roughness: Optional[str] = Field(None, alias="substrateRoughness")
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

    @model_validator(mode="after")
    def validate_tribopair(self) -> "TribologyDataBase":
        self.material_name = derive_legacy_material_name(
            probe_material=self.probe_material,
            substrate_material=self.substrate_material,
            legacy_material_name=self.material_name,
        )
        self.surface_roughness = derive_legacy_surface_roughness(
            probe_roughness=self.probe_roughness,
            substrate_roughness=self.substrate_roughness,
            legacy_surface_roughness=self.surface_roughness,
        )

        has_probe_details = any(
            value for value in (self.probe_geometry, self.probe_radius, self.probe_roughness)
        )
        has_substrate_details = any(
            value for value in (self.substrate_coating, self.substrate_roughness)
        )
        if has_probe_details and not self.probe_material:
            raise ValueError("probeMaterial is required when probe details are recorded.")
        if has_substrate_details and not self.substrate_material:
            raise ValueError("substrateMaterial is required when substrate details are recorded.")
        return self

    class Config:
        populate_by_name = True


class TribologyDataCreate(TribologyDataBase):
    pass


class TribologyDataSchema(TribologyDataBase):
    id: int
    literature_id: int = Field(..., alias="literatureId")
    extracted_at: datetime = Field(..., alias="extractedAt")
    tribopair_label: Optional[str] = Field(None, alias="tribopairLabel")

    @model_validator(mode="after")
    def populate_tribopair_label(self) -> "TribologyDataSchema":
        self.tribopair_label = compose_tribopair_label(
            self.probe_material,
            self.substrate_material,
            self.substrate_coating,
        )
        return self

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
