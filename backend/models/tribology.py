from __future__ import annotations

import json
from datetime import datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field, field_validator, model_validator

from utils.cof_extraction import normalize_cof_extracted
from utils.experiment_profile import build_experiment_profile
from utils.lubricant_mixture import normalize_lubricant_components
from utils.structured_conditions import normalize_load_conditions, normalize_tribological_system
from services.normalization.potential import normalize_potential_text
from utils.tribopair import derive_legacy_material_name, derive_legacy_surface_roughness


class EvidenceSource(BaseModel):
    source_type: Optional[str] = None
    page: Optional[int] = None
    source_label: Optional[str] = None
    quote: Optional[str] = None
    bbox: Optional[List[float]] = None
    sample_id: Optional[str] = None
    matched_text: Optional[str] = None


class FieldEvidence(BaseModel):
    value: Optional[str] = None
    confidence: Optional[float] = None
    evidence: Optional[EvidenceSource] = None
    grounding_mode: Optional[str] = None
    grounding_note: Optional[str] = None
    review_state: Optional[str] = None
    review_note: Optional[str] = None


class TribologyData(BaseModel):
    id: Optional[str] = None
    material_name: str = Field(..., description="Legacy single-surface material label")
    ionic_liquid: Optional[str] = Field("", description="Ionic liquid label")
    lubricant_components: List[Dict[str, Any]] = Field(default_factory=list)
    lubricant_alias: Optional[str] = None
    ionic_liquid_display: Optional[str] = None
    lubricant_tooltip: Optional[str] = None
    base_oil: Optional[str] = None
    concentration: Optional[str] = None
    load: Optional[str] = None
    speed: Optional[str] = None
    speed_conditions: Dict[str, Any] = Field(default_factory=dict)
    shear_rate: Optional[str] = None
    temperature: Optional[str] = None
    cof: Optional[str] = None

    # Database-compatible fields
    cof_value: Optional[float] = None
    cof_raw: Optional[str] = None
    cof_operator: Optional[str] = None
    cof_extracted: Dict[str, Any] = Field(default_factory=dict)

    friction_force: Optional[str] = None
    normal_load: Optional[str] = None
    load_conditions: Dict[str, Any] = Field(default_factory=dict)
    wear_rate: Optional[str] = None
    test_duration: Optional[str] = None
    contact_type: Optional[str] = None

    potential: Optional[str] = None
    water_content: Optional[str] = None
    probe_material: Optional[str] = None
    probe_geometry: Optional[str] = None
    probe_radius: Optional[str] = None
    probe_roughness: Optional[str] = None
    substrate_material: Optional[str] = None
    substrate_coating: Optional[str] = None
    substrate_roughness: Optional[str] = None
    surface_roughness: Optional[str] = None

    residual_film_thickness_d: Optional[str] = None
    layer_spacing_delta: Optional[str] = None
    film_thickness: Optional[str] = None
    regime: Optional[str] = None
    tribological_system: Dict[str, Any] = Field(default_factory=dict)
    experiment_scale: Optional[str] = None
    experiment_method: Optional[str] = None
    measurement_type: Optional[str] = None
    training_view: Optional[str] = None

    mol_ratio: Optional[str] = None
    cation: Optional[str] = None
    anion: Optional[str] = None
    cation_smiles: Optional[str] = None
    anion_smiles: Optional[str] = None
    il_smiles: Optional[str] = None
    il_inchikey: Optional[str] = None
    alkyl_chain_length: Optional[int] = None
    source: Optional[str] = None
    notes: Optional[str] = None
    value_origin: Optional[str] = None
    evidence: Optional[str] = None
    source_page: Optional[int] = None
    source_figure: Optional[str] = None
    sample_id: Optional[str] = None
    series_id: Optional[str] = None
    field_evidence_json: Dict[str, FieldEvidence] = Field(default_factory=dict)
    review_status: Optional[str] = None
    record_origin: Optional[str] = None
    review_entity_type: Optional[str] = None
    assembly_notes: Optional[str] = None

    @model_validator(mode="before")
    @classmethod
    def map_cof_from_db_fields(cls, data):
        if isinstance(data, dict):
            if not data.get("cof"):
                if data.get("cof_raw"):
                    data["cof"] = data["cof_raw"]
                elif data.get("cof_value") is not None:
                    data["cof"] = str(data["cof_value"])
            if not data.get("cof_extracted") and data.get("cofExtracted"):
                data["cof_extracted"] = data["cofExtracted"]

            if not data.get("ionic_liquid") and data.get("lubricant"):
                data["ionic_liquid"] = data["lubricant"]
            if not data.get("lubricant_components") and data.get("lubricantComponents"):
                data["lubricant_components"] = data["lubricantComponents"]
            if not data.get("lubricant_alias") and data.get("lubricantAlias"):
                data["lubricant_alias"] = data["lubricantAlias"]
            if not data.get("ionic_liquid_display") and data.get("ionicLiquidDisplay"):
                data["ionic_liquid_display"] = data["ionicLiquidDisplay"]
            if not data.get("lubricant_tooltip") and data.get("lubricantTooltip"):
                data["lubricant_tooltip"] = data["lubricantTooltip"]
            if not data.get("load"):
                data["load"] = data.get("load_raw") or data.get("load_value")
            if not data.get("load_conditions") and data.get("loadConditions"):
                data["load_conditions"] = data["loadConditions"]
            if not data.get("speed"):
                data["speed"] = data.get("speed_raw") or data.get("speed_value")
            if not data.get("shear_rate") and data.get("shearRate"):
                data["shear_rate"] = data.get("shearRate")
            if not data.get("tribological_system") and data.get("tribologicalSystem"):
                data["tribological_system"] = data["tribologicalSystem"]
        return data

    @field_validator("field_evidence_json", mode="before")
    @classmethod
    def parse_field_evidence_json(cls, value: Any) -> Dict[str, Any]:
        if value in (None, "", {}):
            return {}
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
    def parse_lubricant_components(cls, value: Any) -> List[Dict[str, Any]]:
        return normalize_lubricant_components(value)

    @field_validator("cof_extracted", mode="before")
    @classmethod
    def parse_cof_extracted(cls, value: Any) -> Dict[str, Any]:
        return normalize_cof_extracted(value)

    @field_validator("load_conditions", mode="before")
    @classmethod
    def parse_load_conditions(cls, value: Any) -> Dict[str, Any]:
        return normalize_load_conditions(value)

    @field_validator("tribological_system", mode="before")
    @classmethod
    def parse_tribological_system(cls, value: Any) -> Dict[str, Any]:
        return normalize_tribological_system(value)

    @field_validator("potential", mode="before")
    @classmethod
    def normalize_potential(cls, value):
        return normalize_potential_text(value)

    @model_validator(mode="after")
    def map_legacy_surface_fields(self):
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
        experiment_profile = build_experiment_profile(
            {
                "tribological_system": self.tribological_system,
                "experiment_scale": self.experiment_scale,
                "experiment_method": self.experiment_method,
                "measurement_type": self.measurement_type,
                "cof": self.cof,
                "load": self.load or self.normal_load,
                "speed": self.speed,
                "friction_force": self.friction_force,
                "wear_rate": self.wear_rate,
                "probe_geometry": self.probe_geometry,
                "probe_radius": self.probe_radius,
                "contact_type": self.contact_type,
                "regime": self.regime,
                "source": self.source,
                "source_figure": self.source_figure,
                "evidence": self.evidence,
            }
        )
        self.tribological_system = {**(self.tribological_system or {}), **experiment_profile}
        self.experiment_scale = experiment_profile["scale"]
        self.experiment_method = experiment_profile["method"]
        self.measurement_type = experiment_profile["measurement_type"]
        self.training_view = experiment_profile["training_view"]
        return self


class ExtractionRequest(BaseModel):
    file_id: str
    content: str


class LiteratureMetadata(BaseModel):
    title: str = Field("")
    authors: str = Field("")
    doi: str = Field("")
    journal: str = Field("")
    issn: Optional[str] = None
    year: int = Field(0)
    volume: Optional[str] = None
    issue: Optional[str] = None
    pages: Optional[str] = None

    @field_validator("title", "authors", "doi", "journal", mode="before")
    @classmethod
    def normalize_required_text(cls, value: Any) -> str:
        if value is None:
            return ""
        return str(value).strip()

    @field_validator("issn", "volume", "issue", "pages", mode="before")
    @classmethod
    def normalize_optional_text(cls, value: Any) -> Optional[str]:
        if value is None:
            return None
        text = str(value).strip()
        return text or None

    @field_validator("year", mode="before")
    @classmethod
    def normalize_year(cls, value: Any) -> int:
        if value in (None, ""):
            return 0
        try:
            return int(value)
        except (TypeError, ValueError):
            return 0

    class Config:
        populate_by_name = True


class ExtractionResponse(BaseModel):
    success: bool
    metadata: Optional[LiteratureMetadata] = None
    data: List[TribologyData] = []
    message: Optional[str] = None


class ChatMessage(BaseModel):
    role: str
    content: str
    timestamp: Optional[datetime] = None


class ChatRequest(BaseModel):
    message: str
    context: Optional[str] = None
