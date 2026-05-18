"""Pydantic schemas for IonicLink APIs."""

from __future__ import annotations

import json
from datetime import datetime
from typing import Any, List, Optional

from pydantic import BaseModel, Field, field_validator, model_validator

from utils.cof_extraction import normalize_cof_extracted
from utils.experiment_profile import build_experiment_profile
from utils.lubricant_mixture import normalize_lubricant_components
from utils.speed_conditions import derive_speed_conditions, normalize_speed_conditions, speed_value_from_conditions
from utils.structured_conditions import normalize_load_conditions, normalize_tribological_system
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
    file_hash: Optional[str] = Field(None, alias="fileHash")

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
    status: Optional[str] = None
    error_message: Optional[str] = Field(None, alias="errorMessage")
    record_count: Optional[int] = Field(None, alias="recordCount")
    candidate_count: Optional[int] = Field(None, alias="candidateCount")
    has_pdf: Optional[bool] = Field(None, alias="hasPdf")
    created_at: datetime

    class Config:
        from_attributes = True
        populate_by_name = True


class TribologyDataBase(BaseModel):
    material_name: Optional[str] = Field(None, alias="materialName")
    lubricant: str = Field("")
    lubricant_components: List[dict[str, Any]] = Field(default_factory=list, alias="lubricantComponents")
    lubricant_alias: Optional[str] = Field(None, alias="lubricantAlias")
    ionic_liquid_display: Optional[str] = Field(None, alias="ionicLiquidDisplay")
    lubricant_tooltip: Optional[str] = Field(None, alias="lubricantTooltip")

    cof_value: Optional[float] = Field(None, alias="cofValue")
    cof_operator: Optional[str] = Field(None, alias="cofOperator")
    cof_raw: Optional[str] = Field(None, alias="cofRaw")
    cof_extracted: dict[str, Any] = Field(default_factory=dict, alias="cofExtracted")

    load_value: Optional[str] = Field(None, alias="loadValue")
    load_raw: Optional[str] = Field(None, alias="loadRaw")
    load_conditions: dict[str, Any] = Field(default_factory=dict, alias="loadConditions")

    speed_value: Optional[str] = Field(None, alias="speedValue")
    speed_raw: Optional[str] = Field(None, alias="speedRaw")
    speed_conditions: dict[str, Any] = Field(default_factory=dict, alias="speedConditions")
    shear_rate: Optional[str] = Field(None, alias="shearRate")
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
    regime: Optional[str] = None
    tribological_system: dict[str, Any] = Field(default_factory=dict, alias="tribologicalSystem")
    experiment_scale: Optional[str] = Field(None, alias="experimentScale")
    experiment_method: Optional[str] = Field(None, alias="experimentMethod")
    measurement_type: Optional[str] = Field(None, alias="measurementType")
    training_view: Optional[str] = Field(None, alias="trainingView")

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
    sample_id: Optional[str] = Field(None, alias="sampleId")
    series_id: Optional[str] = Field(None, alias="seriesId")
    field_evidence_json: dict[str, Any] = Field(default_factory=dict, alias="fieldEvidenceJson")
    review_status: Optional[str] = Field(None, alias="reviewStatus")
    record_origin: Optional[str] = Field(None, alias="recordOrigin")
    review_entity_type: Optional[str] = Field(None, alias="reviewEntityType")
    assembly_notes: Optional[str] = Field(None, alias="assemblyNotes")

    confidence: float = Field(0.9, ge=0.0, le=1.0)

    @field_validator("field_evidence_json", mode="before")
    @classmethod
    def parse_field_evidence_json(cls, value: Any) -> dict[str, Any]:
        if isinstance(value, str):
            try:
                loaded = json.loads(value)
                return loaded if isinstance(loaded, dict) else {}
            except Exception:
                return {}
        if isinstance(value, dict):
            return value
        return {}

    @field_validator("lubricant_components", mode="before")
    @classmethod
    def parse_lubricant_components(cls, value: Any) -> list[dict[str, Any]]:
        return normalize_lubricant_components(value)

    @field_validator("cof_extracted", mode="before")
    @classmethod
    def parse_cof_extracted(cls, value: Any) -> dict[str, Any]:
        return normalize_cof_extracted(value)

    @field_validator("load_conditions", mode="before")
    @classmethod
    def parse_load_conditions(cls, value: Any) -> dict[str, Any]:
        return normalize_load_conditions(value)

    @field_validator("speed_conditions", mode="before")
    @classmethod
    def parse_speed_conditions(cls, value: Any) -> dict[str, Any]:
        return normalize_speed_conditions(value)

    @field_validator("tribological_system", mode="before")
    @classmethod
    def parse_tribological_system(cls, value: Any) -> dict[str, Any]:
        return normalize_tribological_system(value)

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
        speed_conditions = normalize_speed_conditions(self.speed_conditions) or derive_speed_conditions(
            self.speed_raw or self.speed_value,
            context=self.evidence,
        )
        if speed_conditions:
            self.speed_conditions = speed_conditions
            derived_speed_value = speed_value_from_conditions(speed_conditions)
            if derived_speed_value:
                self.speed_value = derived_speed_value
            elif speed_conditions.get("scan_rate_hz") is not None:
                self.speed_value = None
        experiment_profile = build_experiment_profile(
            {
                "tribological_system": self.tribological_system,
                "experiment_scale": self.experiment_scale,
                "experiment_method": self.experiment_method,
                "measurement_type": self.measurement_type,
                "cof": self.cof_raw or self.cof_value,
                "load": self.load_raw or self.load_value,
                "speed": self.speed_raw or self.speed_value,
                "probe_geometry": self.probe_geometry,
                "probe_radius": self.probe_radius,
                "regime": self.regime,
                "evidence": self.evidence,
                "source": self.source,
                "source_figure": self.source_figure,
            }
        )
        self.tribological_system = {**(self.tribological_system or {}), **experiment_profile}
        self.experiment_scale = experiment_profile["scale"]
        self.experiment_method = experiment_profile["method"]
        self.measurement_type = experiment_profile["measurement_type"]
        self.training_view = experiment_profile["training_view"]
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
    diffusion_data: List[dict[str, Any]] = Field(default_factory=list, alias="diffusionData")

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
