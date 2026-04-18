from __future__ import annotations

import json
from datetime import datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field, field_validator, model_validator

from utils.tribopair import derive_legacy_material_name, derive_legacy_surface_roughness


class EvidenceSource(BaseModel):
    source_type: Optional[str] = None
    page: Optional[int] = None
    source_label: Optional[str] = None
    quote: Optional[str] = None
    bbox: Optional[List[float]] = None
    sample_id: Optional[str] = None


class FieldEvidence(BaseModel):
    value: Optional[str] = None
    confidence: Optional[float] = None
    evidence: Optional[EvidenceSource] = None


class TribologyData(BaseModel):
    id: Optional[str] = None
    material_name: str = Field(..., description="Legacy single-surface material label")
    ionic_liquid: Optional[str] = Field("", description="Ionic liquid label")
    base_oil: Optional[str] = None
    concentration: Optional[str] = None
    load: Optional[str] = None
    speed: Optional[str] = None
    temperature: Optional[str] = None
    cof: Optional[str] = None

    # Database-compatible fields
    cof_value: Optional[float] = None
    cof_raw: Optional[str] = None
    cof_operator: Optional[str] = None

    friction_force: Optional[str] = None
    normal_load: Optional[str] = None
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

            if not data.get("ionic_liquid") and data.get("lubricant"):
                data["ionic_liquid"] = data["lubricant"]
            if not data.get("load"):
                data["load"] = data.get("load_raw") or data.get("load_value")
            if not data.get("speed"):
                data["speed"] = data.get("speed_raw") or data.get("speed_value")
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

    @field_validator("potential", mode="before")
    @classmethod
    def normalize_potential(cls, value):
        if value is None:
            return None
        if isinstance(value, bool):
            return str(value)
        if isinstance(value, (int, float)):
            numeric = float(value)
            text = str(int(numeric)) if numeric.is_integer() else str(value)
            return f"{text} V"

        text = str(value).strip()
        if not text:
            return None

        try:
            numeric = float(text)
            normalized = str(int(numeric)) if numeric.is_integer() else text
            return f"{normalized} V"
        except Exception:
            return text

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
