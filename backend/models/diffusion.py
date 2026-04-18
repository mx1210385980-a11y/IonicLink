from __future__ import annotations

import json
from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel, Field, field_validator


class DiffusionRecord(BaseModel):
    id: Optional[str] = None
    system_name: Optional[str] = Field(None, alias="systemName")
    confinement_material_class: Optional[str] = Field(None, alias="confinementMaterialClass")
    confinement_geometry_class: Optional[str] = Field(None, alias="confinementGeometryClass")
    surface_functional_groups: Optional[str] = Field(None, alias="surfaceFunctionalGroups")
    confinement_dimensionality: Optional[str] = Field(None, alias="confinementDimensionality")
    ionic_liquid: Optional[str] = Field(None, alias="ionicLiquid")

    d_total: Optional[float] = Field(None, alias="D_total")
    d_cation: Optional[float] = Field(None, alias="D_cation")
    d_anion: Optional[float] = Field(None, alias="D_anion")
    d_unit: Optional[str] = Field(None, alias="D_unit")

    temperature_value: Optional[float] = Field(None, alias="temperatureValue")
    confinement_scale_value: Optional[float] = Field(None, alias="confinementScaleValue")
    confinement_scale_unit: Optional[str] = Field(None, alias="confinementScaleUnit")

    source: Optional[str] = None
    source_page: Optional[int] = Field(None, alias="sourcePage")
    source_bbox: Optional[list[float]] = Field(None, alias="sourceBbox")
    evidence: Optional[str] = None

    provider: Optional[str] = None
    prompt_version: Optional[str] = Field(None, alias="promptVersion")
    raw_model_output: Optional[str] = Field(None, alias="rawModelOutput")
    field_evidence_json: dict[str, Any] = Field(default_factory=dict, alias="fieldEvidenceJson")
    review_status: Optional[str] = Field(None, alias="reviewStatus")
    record_origin: Optional[str] = Field(None, alias="recordOrigin")
    assembly_notes: Optional[str] = Field(None, alias="assemblyNotes")
    confidence: float = 0.9

    novel_features_json: dict[str, Any] = Field(default_factory=dict, alias="novelFeaturesJson")
    smiles: Optional[str] = None
    rdkit_features_json: dict[str, Any] = Field(default_factory=dict, alias="rdkitFeaturesJson")

    @field_validator("novel_features_json", "rdkit_features_json", "field_evidence_json", mode="before")
    @classmethod
    def _parse_json_dict(cls, value: Any) -> dict[str, Any]:
        if isinstance(value, dict):
            return value
        if isinstance(value, str):
            try:
                loaded = json.loads(value)
                return loaded if isinstance(loaded, dict) else {}
            except Exception:
                return {}
        return {}

    class Config:
        populate_by_name = True


class DiffusionRecordSchema(DiffusionRecord):
    literature_id: int = Field(..., alias="literatureId")
    extracted_at: datetime = Field(..., alias="extractedAt")

    class Config:
        from_attributes = True
        populate_by_name = True
