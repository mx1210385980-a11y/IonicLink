"""
Data Explorer Router for IonicLink
API endpoints for searching and exploring tribology data.
"""

import logging
from typing import Any, List, Optional, Literal
import re
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, func, desc, or_
from sqlalchemy.orm import selectinload

from database import get_db_session
from models.db_models import DiffusionCandidate, DiffusionRecord, RecordCandidate, TribologyData, Literature
from security import (
    AuthPrincipal,
    RequestScope,
    get_current_principal,
    get_request_scope,
    literature_scope_conditions,
    require_record_access,
    require_candidate_access,
    scope_filters,
)
from services.activity_logging_service import log_activity
from services.score_service import calculate_confidence, calculate_confidence_details
from services.agent_runtime_service import get_agent_runtime
from services.file_service import (
    _is_derived_speed_conditions,
    _normalize_record_chemistry,
    _parse_json_object,
    _repair_response_field_evidence_map,
)
from services.il_resolver_service import ANION_DB, CATION_DB, resolve_il
from services.insight_service import get_pattern_discovery, save_pattern_discovery_report
from services.quality_service import get_quality_asset_summary
from services.query_service import _ion_component_filter_terms, _record_to_payload, format_record_display_id
from services.sync_facade_service import _diffusion_record_to_payload
from services.relationship_graph_service import (
    build_relationship_graph,
    drilldown_relationship_graph,
)
from knowledge_base import normalize_ionic_liquid
from utils.cof_extraction import derive_cof_extracted, normalize_cof_extracted, serialize_cof_extracted
from utils.experiment_profile import build_experiment_profile
from utils.lubricant_mixture import (
    compact_lubricant_label,
    components_for_record,
    format_lubricant_tooltip,
    normalize_lubricant_components,
    serialize_lubricant_components,
)
from utils.structured_conditions import (
    derive_load_conditions,
    derive_tribological_system,
    normalize_load_conditions,
    normalize_tribological_system,
    serialize_load_conditions,
    serialize_tribological_system,
)
from utils.speed_conditions import (
    derive_speed_conditions,
    normalize_speed_conditions,
    serialize_speed_conditions,
    speed_value_from_conditions,
)
from utils.tribopair import (
    compose_tribopair_label,
    composite_roughness_label,
    derive_legacy_material_name,
    derive_legacy_surface_roughness,
)


router = APIRouter(
    prefix="/api/records",
    tags=["Data Explorer"],
    responses={404: {"description": "Not found"}},
)
logger = logging.getLogger(__name__)


def _raise_internal_error(action: str, exc: Exception) -> None:
    logger.exception("%s failed", action)
    raise HTTPException(status_code=500, detail=f"{action} failed.") from exc


def _normalized_scale_filter_terms(values: list[str] | tuple[str, ...] | set[str]) -> list[str]:
    terms: set[str] = set()
    for value in values or []:
        text = str(value or "").strip().lower().replace("-", "_")
        if not text:
            continue
        if text in {"macro", "macroscopic", "macroscale", "macro_performance"}:
            terms.update({"macroscale", "macro"})
        elif text in {"nano", "nanoscopic", "nanoscale", "nanotribology", "afm", "afm_surface_response", "nanoscale_afm"}:
            terms.update({"nanoscale", "nano"})
        elif text in {"micro", "microscopic", "microscale"}:
            terms.update({"microscale", "micro"})
        else:
            terms.add(text)
    return sorted(terms)


def _normalized_json_filter_terms(values: list[str] | tuple[str, ...] | set[str]) -> list[str]:
    return sorted({str(value or "").strip().lower() for value in values or [] if str(value or "").strip()})


def _json_text(path: str):
    return func.lower(func.coalesce(func.json_extract(TribologyData.tribological_system_json, path), ""))


# --- Pydantic Models ---

class SearchFilter(BaseModel):
    """Filter parameters for searching tribology records"""
    record_id: Optional[int] = Field(None, alias="recordId", description="Exact record ID")
    entity_type: Optional[Literal["record", "candidate"]] = Field(None, alias="entityType", description="Exact entity type for recordId")
    materials: List[str] = Field(default_factory=list, description="Probe/substrate/coating search terms")
    probe_materials: List[str] = Field(default_factory=list, alias="probeMaterials", description="Probe material terms")
    substrate_materials: List[str] = Field(default_factory=list, alias="substrateMaterials", description="Substrate material terms")
    substrate_coatings: List[str] = Field(default_factory=list, alias="substrateCoatings", description="Substrate coating terms")
    lubricants: List[str] = Field(default_factory=list, description="List of lubricants")
    cations: List[str] = Field(default_factory=list, description="List of cation terms")
    anions: List[str] = Field(default_factory=list, description="List of anion terms")
    speed_values: List[str] = Field(default_factory=list, alias="speedValues", description="Speed condition terms")
    shear_rate_values: List[str] = Field(default_factory=list, alias="shearRateValues", description="Shear-rate condition terms")
    temperature_values: List[str] = Field(default_factory=list, alias="temperatureValues", description="Temperature condition terms")
    potential_values: List[str] = Field(default_factory=list, alias="potentialValues", description="Potential condition terms")
    water_content_values: List[str] = Field(default_factory=list, alias="waterContentValues", description="Water content condition terms")
    load_min: Optional[float] = Field(None, alias="loadMin", description="Min load (N)")
    load_max: Optional[float] = Field(None, alias="loadMax", description="Max load (N)")
    cof_min: Optional[float] = Field(None, alias="cofMin", description="Min COF")
    cof_max: Optional[float] = Field(None, alias="cofMax", description="Max COF")
    review_statuses: List[str] = Field(default_factory=list, alias="reviewStatuses", description="Review statuses to include")
    experiment_scales: List[str] = Field(default_factory=list, alias="experimentScales", description="Experiment scales to include")
    experiment_methods: List[str] = Field(default_factory=list, alias="experimentMethods", description="Experiment methods to include")
    measurement_types: List[str] = Field(default_factory=list, alias="measurementTypes", description="Measurement types to include")
    training_views: List[str] = Field(default_factory=list, alias="trainingViews", description="Training views to include")
    query: Optional[str] = Field(None, alias="q", description="Broad text search over DOI, title, ions, surfaces, and lubricants")
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
    display_id: Optional[str] = Field(None, alias="displayId")
    entity_type: Optional[str] = Field(None, alias="entityType")
    entity_id: Optional[int] = Field(None, alias="entityId")
    review_entity_type: Optional[str] = Field(None, alias="reviewEntityType")
    confidence_tier: Optional[str] = Field(None, alias="confidenceTier")
    admission_reason: Optional[str] = Field(None, alias="admissionReason")
    quality_notes: Optional[str] = Field(None, alias="qualityNotes")
    material_name: str = Field(..., alias="materialName")
    lubricant: str
    lubricant_components: List[dict] = Field(default_factory=list, alias="lubricantComponents")
    lubricant_alias: Optional[str] = Field(None, alias="lubricantAlias")
    ionic_liquid_display: Optional[str] = Field(None, alias="ionicLiquidDisplay")
    lubricant_tooltip: Optional[str] = Field(None, alias="lubricantTooltip")
    
    cof_value: Optional[float] = Field(None, alias="cofValue")
    cof_operator: Optional[str] = Field(None, alias="cofOperator")
    cof_raw: Optional[str] = Field(None, alias="cofRaw")
    cof_extracted: dict = Field(default_factory=dict, alias="cofExtracted")
    
    load_value: Optional[str] = Field(None, alias="loadValue")   # stored with units, e.g. '20 nN'
    load_raw: Optional[str] = Field(None, alias="loadRaw")
    load_conditions: dict = Field(default_factory=dict, alias="loadConditions")
    
    speed_value: Optional[str] = Field(None, alias="speedValue")  # stored with units, e.g. '1 μm/s'
    speed_conditions: dict = Field(default_factory=dict, alias="speedConditions")
    shear_rate: Optional[str] = Field(None, alias="shearRate")  # stored with units, e.g. '195-1300 s^-1'
    temperature: Optional[str] = None
    potential: Optional[str] = None
    water_content: Optional[str] = Field(None, alias="waterContent")
    probe_material: Optional[str] = Field(None, alias="probeMaterial")
    probe_geometry: Optional[str] = Field(None, alias="probeGeometry")
    probe_radius: Optional[str] = Field(None, alias="probeRadius")
    probe_roughness: Optional[str] = Field(None, alias="probeRoughness")
    substrate_material: Optional[str] = Field(None, alias="substrateMaterial")
    substrate_coating: Optional[str] = Field(None, alias="substrateCoating")
    substrate_roughness: Optional[str] = Field(None, alias="substrateRoughness")
    tribopair_label: Optional[str] = Field(None, alias="tribopairLabel")
    surface_roughness: Optional[str] = Field(None, alias="surfaceRoughness")
    residual_film_thickness_d: Optional[str] = Field(None, alias="residualFilmThicknessD")
    layer_spacing_delta: Optional[str] = Field(None, alias="layerSpacingDelta")
    film_thickness: Optional[str] = Field(None, alias="filmThickness")
    regime: Optional[str] = None
    tribological_system: dict = Field(default_factory=dict, alias="tribologicalSystem")
    experiment_profile: dict = Field(default_factory=dict, alias="experimentProfile")
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
    
    # Evidence / Source fields
    evidence: Optional[str] = None
    evidence_page: Optional[int] = Field(None, alias="evidencePage")
    evidence_bbox: Optional[str] = Field(None, alias="evidenceBbox")
    source: Optional[str] = None
    source_page: Optional[int] = Field(None, alias="sourcePage")
    source_figure: Optional[str] = Field(None, alias="sourceFigure")
    field_evidence_json: dict = Field(default_factory=dict, alias="fieldEvidenceJson")
    
    confidence: float
    confidence_details: dict = Field(default_factory=dict, alias="confidenceDetails")
    review_status: Optional[str] = Field(None, alias="reviewStatus")
    record_origin: Optional[str] = Field(None, alias="recordOrigin")
    assembly_notes: Optional[str] = Field(None, alias="assemblyNotes")
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


class DiffusionLibraryResponse(BaseModel):
    total: int
    skip: int
    limit: int
    items: List[dict[str, Any]]
    summary: dict[str, Any]


class RelationshipGraphDimensionSummary(BaseModel):
    type: str
    label: str
    node_count: int = Field(0, alias="nodeCount")
    coverage_pct: float = Field(0.0, alias="coveragePct")
    non_empty_count: int = Field(0, alias="nonEmptyCount")
    distinct_count: int = Field(0, alias="distinctCount")
    reason: Optional[str] = None

    class Config:
        populate_by_name = True


class RelationshipGraphNode(BaseModel):
    id: str
    type: str
    label: str
    count: int
    coverage_pct: float = Field(..., alias="coveragePct")
    avg_cof: Optional[float] = Field(None, alias="avgCof")
    min_cof: Optional[float] = Field(None, alias="minCof")
    max_cof: Optional[float] = Field(None, alias="maxCof")

    class Config:
        populate_by_name = True


class RelationshipGraphEdge(BaseModel):
    id: str
    source: str
    target: str
    source_type: str = Field(..., alias="sourceType")
    source_label: str = Field(..., alias="sourceLabel")
    target_type: str = Field(..., alias="targetType")
    target_label: str = Field(..., alias="targetLabel")
    count: int
    avg_cof: Optional[float] = Field(None, alias="avgCof")
    min_cof: Optional[float] = Field(None, alias="minCof")
    max_cof: Optional[float] = Field(None, alias="maxCof")

    class Config:
        populate_by_name = True


class RelationshipGraphSummary(BaseModel):
    total_records: int = Field(..., alias="totalRecords")
    total_literature: int = Field(..., alias="totalLiterature")
    avg_cof: Optional[float] = Field(None, alias="avgCof")
    active_dimensions: List[RelationshipGraphDimensionSummary] = Field(default_factory=list, alias="activeDimensions")
    hidden_dimensions: List[RelationshipGraphDimensionSummary] = Field(default_factory=list, alias="hiddenDimensions")

    class Config:
        populate_by_name = True


class RelationshipGraphResponse(BaseModel):
    title: str
    state: str
    summary: RelationshipGraphSummary
    nodes: List[RelationshipGraphNode]
    edges: List[RelationshipGraphEdge]

    class Config:
        populate_by_name = True


class RelationshipGraphSelection(BaseModel):
    kind: Literal["node", "edge"]
    node_type: Optional[str] = Field(None, alias="nodeType")
    node_value: Optional[str] = Field(None, alias="nodeValue")
    source_type: Optional[str] = Field(None, alias="sourceType")
    source_value: Optional[str] = Field(None, alias="sourceValue")
    target_type: Optional[str] = Field(None, alias="targetType")
    target_value: Optional[str] = Field(None, alias="targetValue")

    class Config:
        populate_by_name = True


class RelationshipGraphDrilldownRequest(BaseModel):
    filter: SearchFilter
    selection: RelationshipGraphSelection


class RelationshipGraphDrilldownSummary(BaseModel):
    label: str
    count: int
    avg_cof: Optional[float] = Field(None, alias="avgCof")
    min_cof: Optional[float] = Field(None, alias="minCof")
    max_cof: Optional[float] = Field(None, alias="maxCof")

    class Config:
        populate_by_name = True


class RelationshipGraphLiteratureSummary(BaseModel):
    id: int
    doi: str
    title: str
    journal: str
    year: Optional[int] = None
    hit_count: int = Field(..., alias="hitCount")

    class Config:
        populate_by_name = True


class RelationshipGraphDrilldownResponse(BaseModel):
    selection: RelationshipGraphSelection
    summary: RelationshipGraphDrilldownSummary
    total: int
    skip: int
    limit: int
    items: List[RecordResponse]
    literature_summaries: List[RelationshipGraphLiteratureSummary] = Field(default_factory=list, alias="literatureSummaries")

    class Config:
        populate_by_name = True


class RecordUpdatePayload(BaseModel):
    """Payload for updating a single tribology record"""
    cof_raw: Optional[str] = Field(None, alias="cofRaw")
    cof_value: Optional[float] = Field(None, alias="cofValue")
    cof_extracted: Optional[dict] = Field(None, alias="cofExtracted")
    temperature: Optional[str] = None
    potential: Optional[str] = None
    water_content: Optional[str] = Field(None, alias="waterContent")
    probe_material: Optional[str] = Field(None, alias="probeMaterial")
    probe_geometry: Optional[str] = Field(None, alias="probeGeometry")
    probe_radius: Optional[str] = Field(None, alias="probeRadius")
    probe_roughness: Optional[str] = Field(None, alias="probeRoughness")
    substrate_material: Optional[str] = Field(None, alias="substrateMaterial")
    substrate_coating: Optional[str] = Field(None, alias="substrateCoating")
    substrate_roughness: Optional[str] = Field(None, alias="substrateRoughness")
    speed_value: Optional[str] = Field(None, alias="speedValue")
    speed_conditions: Optional[dict] = Field(None, alias="speedConditions")
    shear_rate: Optional[str] = Field(None, alias="shearRate")
    load_value: Optional[str] = Field(None, alias="loadValue")
    load_conditions: Optional[dict] = Field(None, alias="loadConditions")
    surface_roughness: Optional[str] = Field(None, alias="surfaceRoughness")
    film_thickness: Optional[str] = Field(None, alias="filmThickness")
    regime: Optional[str] = None
    tribological_system: Optional[dict] = Field(None, alias="tribologicalSystem")
    experiment_scale: Optional[str] = Field(None, alias="experimentScale")
    experiment_method: Optional[str] = Field(None, alias="experimentMethod")
    measurement_type: Optional[str] = Field(None, alias="measurementType")
    material_name: Optional[str] = Field(None, alias="materialName")
    lubricant: Optional[str] = None
    lubricant_components: Optional[List[dict]] = Field(None, alias="lubricantComponents")
    lubricant_alias: Optional[str] = Field(None, alias="lubricantAlias")

    class Config:
        populate_by_name = True


class ConfidencePromotePayload(BaseModel):
    confidence: Optional[float] = None
    evidence: Optional[str] = None
    evidence_page: Optional[int] = Field(None, alias="evidencePage")
    evidence_bbox: Optional[str] = Field(None, alias="evidenceBbox")
    source: Optional[str] = None
    source_page: Optional[int] = Field(None, alias="sourcePage")
    source_figure: Optional[str] = Field(None, alias="sourceFigure")

    class Config:
        populate_by_name = True


# --- Helper: Build query conditions ---

def _text_search_conditions(query: str):
    term = str(query or "").strip().lower()
    if not term:
        return None
    pattern = f"%{term}%"
    fields = [
        Literature.doi,
        Literature.title,
        Literature.authors,
        Literature.journal,
        TribologyData.lubricant,
        TribologyData.lubricant_alias,
        TribologyData.cation,
        TribologyData.anion,
        TribologyData.probe_material,
        TribologyData.substrate_material,
        TribologyData.substrate_coating,
        TribologyData.material_name,
    ]
    return or_(*[
        func.lower(func.coalesce(field, "")).like(pattern)
        for field in fields
    ])

def _build_conditions(filter_params: SearchFilter):
    conditions = []
    if filter_params.materials:
        conditions.append(
            or_(
                TribologyData.probe_material.in_(filter_params.materials),
                TribologyData.substrate_material.in_(filter_params.materials),
                TribologyData.substrate_coating.in_(filter_params.materials),
                TribologyData.material_name.in_(filter_params.materials),
            )
        )
    if filter_params.probe_materials:
        conditions.append(TribologyData.probe_material.in_(filter_params.probe_materials))
    if filter_params.substrate_materials:
        conditions.append(TribologyData.substrate_material.in_(filter_params.substrate_materials))
    if filter_params.substrate_coatings:
        conditions.append(TribologyData.substrate_coating.in_(filter_params.substrate_coatings))
    if filter_params.lubricants:
        lubricant_terms: set[str] = set()
        for raw_value in filter_params.lubricants:
            raw_text = str(raw_value or "").strip()
            if not raw_text:
                continue

            lubricant_terms.add(raw_text)

            normalized = str(normalize_ionic_liquid(raw_text) or "").strip()
            if normalized:
                lubricant_terms.add(normalized)

            resolved = resolve_il(raw_text)
            canonical_name = str(resolved.get("canonical_name") or "").strip()
            if canonical_name:
                lubricant_terms.add(canonical_name)
                if canonical_name == "[EA][NO3]":
                    lubricant_terms.add("EAN")

        if lubricant_terms:
            conditions.append(TribologyData.lubricant.in_(sorted(lubricant_terms)))
    if filter_params.cations:
        cation_terms = _ion_component_filter_terms(filter_params.cations, CATION_DB, charge_suffix="+")
        if cation_terms:
            conditions.append(TribologyData.cation.in_(cation_terms))
    if filter_params.anions:
        anion_terms = _ion_component_filter_terms(filter_params.anions, ANION_DB, charge_suffix="-")
        if anion_terms:
            conditions.append(TribologyData.anion.in_(anion_terms))
    if filter_params.speed_values:
        conditions.append(TribologyData.speed_value.in_(filter_params.speed_values))
    if filter_params.shear_rate_values:
        conditions.append(TribologyData.shear_rate.in_(filter_params.shear_rate_values))
    if filter_params.temperature_values:
        conditions.append(TribologyData.temperature.in_(filter_params.temperature_values))
    if filter_params.potential_values:
        conditions.append(TribologyData.potential.in_(filter_params.potential_values))
    if filter_params.water_content_values:
        conditions.append(TribologyData.water_content.in_(filter_params.water_content_values))
    if filter_params.cof_min is not None:
        conditions.append(TribologyData.cof_value >= filter_params.cof_min)
    if filter_params.cof_max is not None:
        conditions.append(TribologyData.cof_value <= filter_params.cof_max)
    if filter_params.review_statuses:
        review_statuses = [str(status).strip().lower() for status in filter_params.review_statuses if str(status or "").strip()]
        if review_statuses:
            conditions.append(func.lower(TribologyData.review_status).in_(review_statuses))
    experiment_scales = _normalized_scale_filter_terms(filter_params.experiment_scales)
    if experiment_scales:
        conditions.append(_json_text("$.scale").in_(experiment_scales))
    experiment_methods = _normalized_json_filter_terms(filter_params.experiment_methods)
    if experiment_methods:
        conditions.append(_json_text("$.method").in_(experiment_methods))
    measurement_types = _normalized_json_filter_terms(filter_params.measurement_types)
    if measurement_types:
        conditions.append(_json_text("$.measurement_type").in_(measurement_types))
    training_views = _normalized_json_filter_terms(filter_params.training_views)
    if training_views:
        conditions.append(_json_text("$.training_view").in_(training_views))
    if filter_params.doi:
        conditions.append(Literature.doi == filter_params.doi)
    text_condition = _text_search_conditions(filter_params.query or "")
    if text_condition is not None:
        conditions.append(text_condition)
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


def _confidence_input_from_record(r: TribologyData) -> dict:
    return {
        "material_name": r.material_name,
        "probe_material": r.probe_material,
        "substrate_material": r.substrate_material,
        "substrate_coating": r.substrate_coating,
        "lubricant": r.lubricant,
        "lubricant_components": components_for_record(r),
        "lubricant_alias": getattr(r, "lubricant_alias", None),
        "cof_extracted": normalize_cof_extracted(getattr(r, "cof_extracted_json", None)) or derive_cof_extracted(
            r.cof_raw,
            r.cof_value,
            load=r.load_raw or r.load_value,
            speed=r.speed_value,
        ),
        "cof_value": r.cof_value,
        "cof_raw": r.cof_raw,
        "cof_operator": r.cof_operator,
        "load_value": r.load_value,
        "load_conditions": normalize_load_conditions(getattr(r, "load_conditions_json", None)) or derive_load_conditions(r.load_raw or r.load_value),
        "speed_value": r.speed_value,
        "speed_conditions": normalize_speed_conditions(getattr(r, "speed_conditions_json", None)) or derive_speed_conditions(r.speed_value),
        "shear_rate": getattr(r, "shear_rate", None),
        "temperature": r.temperature,
        "potential": r.potential,
        "water_content": r.water_content,
        "probe_roughness": r.probe_roughness,
        "substrate_roughness": r.substrate_roughness,
        "surface_roughness": composite_roughness_label(
            r.probe_roughness,
            r.substrate_roughness,
            method="rms",
            legacy_surface_roughness=r.surface_roughness,
        ),
        "film_thickness": r.film_thickness,
        "regime": getattr(r, "regime", None),
        "tribological_system": normalize_tribological_system(getattr(r, "tribological_system_json", None)) or derive_tribological_system(getattr(r, "regime", None)),
        "evidence": getattr(r, "evidence", None),
        "evidence_page": getattr(r, "evidence_page", None),
        "source": getattr(r, "source", None),
        "source_page": getattr(r, "source_page", None),
        "source_figure": getattr(r, "source_figure", None),
        "evidence_bbox": getattr(r, "evidence_bbox", None),
        "value_origin": getattr(r, "value_origin", None),
        "field_evidence_json": getattr(r, "field_evidence_json", None),
        "review_status": getattr(r, "review_status", None),
        "model_confidence": getattr(r, "confidence", None),
    }


def _grounding_bucket_from_record(r: TribologyData) -> str:
    source = str(getattr(r, "source", "") or "").strip().lower()
    source_figure = str(getattr(r, "source_figure", "") or "").strip().lower()
    value_origin = str(getattr(r, "value_origin", "") or "").strip().lower()

    if any(tag in value_origin for tag in ("infer", "estimated", "derived")):
        return "inferred"

    source_label = source_figure or source
    if any(tag in source_label for tag in ("fig", "figure", "panel", "plot", "image", "visual")):
        return "figure_grounded"

    return "text_grounded"


def _is_blank(value: Optional[str]) -> bool:
    if value is None:
        return True
    return str(value).strip() == ""


def _is_generic_source_label(value: Optional[str]) -> bool:
    if _is_blank(value):
        return True
    normalized = str(value).strip().lower()
    return normalized in {"text", "text snippet", "text only", "unknown", "image", "image region", "visual"}


def _effective_confidence_details(r: TribologyData) -> dict:
    return calculate_confidence_details(_confidence_input_from_record(r))


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
    runtime_details = _effective_confidence_details(r)
    runtime_confidence = float(runtime_details.get("score") or 0.0)
    lubricant_components = components_for_record(r)
    lubricant_alias = getattr(r, "lubricant_alias", None)
    field_evidence_map = _parse_json_object(getattr(r, "field_evidence_json", None))
    repaired_field_evidence_map, repaired_speed_conditions = _repair_response_field_evidence_map(r, field_evidence_map)
    speed_conditions = repaired_speed_conditions or normalize_speed_conditions(getattr(r, "speed_conditions_json", None)) or derive_speed_conditions(r.speed_value)
    speed_value = speed_value_from_conditions(speed_conditions) if _is_derived_speed_conditions(speed_conditions) else None
    speed_value = speed_value or r.speed_value
    cof_extracted = normalize_cof_extracted(getattr(r, "cof_extracted_json", None)) or derive_cof_extracted(
        r.cof_raw,
        r.cof_value,
        load=r.load_raw or r.load_value,
        speed=speed_value,
    )
    load_conditions = normalize_load_conditions(getattr(r, "load_conditions_json", None)) or derive_load_conditions(r.load_raw or r.load_value)
    tribological_system = normalize_tribological_system(getattr(r, "tribological_system_json", None)) or derive_tribological_system(getattr(r, "regime", None))
    experiment_profile = build_experiment_profile(
        {
            "tribological_system": tribological_system,
            "cof": r.cof_raw,
            "cof_value": r.cof_value,
            "load": r.load_raw or r.load_value,
            "speed": speed_value,
            "probe_geometry": r.probe_geometry,
            "probe_radius": r.probe_radius,
            "regime": getattr(r, "regime", None),
            "source": getattr(r, "source", None),
            "source_figure": getattr(r, "source_figure", None),
            "evidence": getattr(r, "evidence", None),
        }
    )
    if tribological_system:
        tribological_system = {**tribological_system, **experiment_profile}

    payload = {
        "id": r.id,
        "display_id": format_record_display_id(None, r.id),
        "material_name": r.material_name,
        "lubricant": r.lubricant,
        "lubricant_components": lubricant_components,
        "lubricant_alias": lubricant_alias,
        "ionic_liquid_display": compact_lubricant_label(r.lubricant, lubricant_components, lubricant_alias),
        "lubricant_tooltip": format_lubricant_tooltip(r.lubricant, lubricant_components, lubricant_alias),
        "cof_extracted": cof_extracted,
        "cof_value": r.cof_value,
        "cof_operator": r.cof_operator,
        "cof_raw": r.cof_raw,
        "load_value": r.load_value,
        "load_raw": r.load_raw,
        "load_conditions": load_conditions,
        "speed_value": speed_value,
        "speed_conditions": speed_conditions,
        "shear_rate": getattr(r, "shear_rate", None),
        "temperature": r.temperature,
        "potential": r.potential,
        "water_content": r.water_content,
        "probe_material": r.probe_material,
        "probe_geometry": r.probe_geometry,
        "probe_radius": r.probe_radius,
        "probe_roughness": r.probe_roughness,
        "substrate_material": r.substrate_material,
        "substrate_coating": r.substrate_coating,
        "substrate_roughness": r.substrate_roughness,
        "tribopair_label": compose_tribopair_label(
            r.probe_material,
            r.substrate_material,
            r.substrate_coating,
        ),
        "surface_roughness": composite_roughness_label(
            r.probe_roughness,
            r.substrate_roughness,
            method="rms",
            legacy_surface_roughness=r.surface_roughness,
        ),
        "residual_film_thickness_d": r.residual_film_thickness_d,
        "layer_spacing_delta": r.layer_spacing_delta,
        "film_thickness": r.film_thickness,
        "regime": getattr(r, "regime", None),
        "tribological_system": tribological_system,
        "experiment_profile": experiment_profile,
        "experiment_scale": experiment_profile["scale"],
        "experiment_method": experiment_profile["method"],
        "measurement_type": experiment_profile["measurement_type"],
        "training_view": experiment_profile["training_view"],
        "mol_ratio": r.mol_ratio,
        "cation": r.cation,
        "anion": r.anion,
        "cation_smiles": r.cation_smiles,
        "anion_smiles": r.anion_smiles,
        "il_smiles": r.il_smiles,
        "il_inchikey": r.il_inchikey,
        "alkyl_chain_length": r.alkyl_chain_length,
        "evidence": getattr(r, 'evidence', None),
        "evidence_page": getattr(r, 'evidence_page', None),
        "evidence_bbox": getattr(r, 'evidence_bbox', None),
        "source": getattr(r, 'source', None),
        "source_page": getattr(r, 'source_page', None),
        "source_figure": getattr(r, 'source_figure', None),
        "field_evidence_json": repaired_field_evidence_map,
        "confidence": runtime_confidence,
        "confidence_details": runtime_details,
        "review_status": getattr(r, "review_status", None),
        "literature_id": r.literature_id,
        "literature": lit_dto.model_dump() if lit_dto else None,
    }
    _normalize_record_chemistry([payload])
    return RecordResponse(**payload)


def _diffusion_literature_payload(literature: Literature | None) -> dict[str, Any] | None:
    if not literature:
        return None
    return {
        "id": literature.id,
        "doi": literature.doi or "",
        "title": literature.title or "",
        "authors": literature.authors or "",
        "journal": literature.journal or "",
        "year": literature.year,
    }


def _diffusion_search_text(payload: dict[str, Any]) -> str:
    literature = payload.get("literature") or {}
    values = [
        payload.get("system_name"),
        payload.get("ionic_liquid"),
        payload.get("confinement_material_class"),
        payload.get("confinement_geometry_class"),
        payload.get("surface_functional_groups"),
        payload.get("source"),
        payload.get("evidence"),
        literature.get("title"),
        literature.get("doi"),
        literature.get("journal"),
    ]
    return " ".join(str(value or "") for value in values).lower()


def _diffusion_primary_species(record: DiffusionCandidate | DiffusionRecord) -> str:
    text = f"{getattr(record, 'evidence', '') or ''} {getattr(record, 'ionic_liquid', '') or ''} {getattr(record, 'system_name', '') or ''}".lower()
    if getattr(record, "d_anion", None) is not None and getattr(record, "d_cation", None) is None:
        if "cl" in text:
            return "Cl−"
        if "bf4" in text or "bf 4" in text:
            return "BF₄−"
        return "anion"
    if getattr(record, "d_cation", None) is not None and getattr(record, "d_anion", None) is None:
        return "cation"
    if getattr(record, "d_cation", None) is not None and getattr(record, "d_anion", None) is not None:
        return "cation / anion"
    return "overall"


def _diffusion_library_item(record: DiffusionCandidate | DiffusionRecord) -> dict[str, Any]:
    payload = _diffusion_record_to_payload(record)
    entity_type = "candidate" if isinstance(record, DiffusionCandidate) else "record"
    literature = _diffusion_literature_payload(getattr(record, "literature", None))
    standard_fields = payload.get("diffusion_standard_fields") if isinstance(payload.get("diffusion_standard_fields"), dict) else {}
    payload["library_id"] = f"{entity_type}:{record.id}"
    payload["libraryId"] = payload["library_id"]
    payload["review_entity_type"] = entity_type
    payload["reviewEntityType"] = entity_type
    payload["literature"] = literature
    payload["literature_title"] = (literature or {}).get("title", "")
    payload["literatureTitle"] = payload["literature_title"]
    payload["literature_doi"] = (literature or {}).get("doi", "")
    payload["literatureDoi"] = payload["literature_doi"]
    payload["diffusing_species"] = standard_fields.get("diffusing_ion") or _diffusion_primary_species(record)
    payload["diffusingSpecies"] = payload["diffusing_species"]
    return payload


def _diffusion_library_rows(
    final_records: list[DiffusionRecord],
    candidate_records: list[DiffusionCandidate],
) -> list[dict[str, Any]]:
    latest_candidates = sorted(candidate_records, key=lambda candidate: int(candidate.id or 0), reverse=True)
    return [
        *[_diffusion_library_item(candidate) for candidate in latest_candidates],
        *[_diffusion_library_item(record) for record in final_records],
    ]


def _diffusion_library_sort_key(item: dict[str, Any]) -> tuple[int, int, int]:
    entity_type = str(
        item.get("review_entity_type")
        or item.get("reviewEntityType")
        or str(item.get("library_id") or "").split(":", 1)[0]
        or "record"
    ).strip().lower()
    row_id = int(item.get("id") or 0)
    literature_id = int(item.get("literature_id") or item.get("literatureId") or 0)
    if entity_type == "candidate":
        return (0, -row_id, -literature_id)
    return (1, -literature_id, -row_id)


def _diffusion_library_matches_focus(
    item: dict[str, Any],
    *,
    literature_id: int | None = None,
    record_id: int | None = None,
    entity_type: Literal["record", "candidate"] | None = None,
) -> bool:
    if literature_id is not None:
        item_literature_id = int(item.get("literature_id") or item.get("literatureId") or 0)
        if item_literature_id != literature_id:
            return False
    if record_id is not None:
        item_record_id = int(item.get("id") or 0)
        if item_record_id != record_id:
            return False
    if entity_type is not None:
        item_entity_type = str(
            item.get("review_entity_type")
            or item.get("reviewEntityType")
            or item.get("entity_type")
            or item.get("entityType")
            or str(item.get("library_id") or "").split(":", 1)[0]
            or "record"
        ).strip().lower()
        if item_entity_type != entity_type:
            return False
    return True


# --- API Endpoints ---

@router.post("/search", response_model=PaginatedRecordResponse, response_model_by_alias=True)
async def search_records(
    filter_params: SearchFilter,
    skip: int = Query(0, ge=0, description="Number of records to skip"),
    limit: int = Query(20, ge=1, le=200, description="Max records to return"),
    session: AsyncSession = Depends(get_db_session),
    principal: AuthPrincipal = Depends(get_current_principal),
    scope: RequestScope = Depends(get_request_scope),
):
    """
    鎼滅储鎽╂摝瀛︽暟鎹褰曪紙鏀寔鍒嗛〉锛?
    鏀寔鎸夋潗鏂欍€佹鼎婊戝墏銆佽浇鑽疯寖鍥淬€丆OF鑼冨洿杩囨护
    """
    try:
        if filter_params.record_id is not None:
            if filter_params.entity_type == "candidate":
                record = await require_candidate_access(session, principal, filter_params.record_id)
                item = RecordResponse(**_record_to_payload(record))
            else:
                record = await require_record_access(session, principal, filter_params.record_id)
                item = _record_to_response(record)
            return PaginatedRecordResponse(
                total=1,
                skip=0,
                limit=limit,
                items=[item],
            )
        result = await get_agent_runtime().search_records(
            session=session,
            filter_params=filter_params,
            skip=skip,
            limit=limit,
            scope_filter_values=scope_filters(scope),
        )
        return PaginatedRecordResponse(
            total=result.get("total", 0),
            skip=result.get("skip", skip),
            limit=result.get("limit", limit),
            items=[RecordResponse(**item) for item in result.get("items", [])],
        )
    except HTTPException:
        raise
    except Exception as exc:
        _raise_internal_error("Search records", exc)


@router.get("/diffusion-library", response_model=DiffusionLibraryResponse)
async def list_diffusion_library(
    q: str | None = Query(None, description="Optional text search over diffusion records and literature metadata"),
    literature_id: int | None = Query(None, ge=1, description="Limit results to one literature item"),
    record_id: int | None = Query(None, ge=1, description="Limit results to one diffusion record id"),
    entity_type: Literal["record", "candidate"] | None = Query(None, description="Limit focus to a final record or review candidate"),
    skip: int = Query(0, ge=0, description="Number of rows to skip"),
    limit: int = Query(500, ge=1, le=1000, description="Max rows to return"),
    session: AsyncSession = Depends(get_db_session),
    scope: RequestScope = Depends(get_request_scope),
):
    """Return a unified diffusion library across final records and unpromoted review candidates."""
    try:
        filters = scope_filters(scope)
        scope_conditions = literature_scope_conditions(filters)

        record_result = await session.execute(
            select(DiffusionRecord)
            .options(selectinload(DiffusionRecord.literature))
            .join(DiffusionRecord.literature)
            .where(*scope_conditions)
            .order_by(desc(DiffusionRecord.extracted_at), desc(DiffusionRecord.id))
        )
        final_records = list(record_result.scalars().all())

        candidate_result = await session.execute(
            select(DiffusionCandidate)
            .options(selectinload(DiffusionCandidate.literature), selectinload(DiffusionCandidate.promoted_record))
            .join(DiffusionCandidate.literature)
            .where(*scope_conditions, DiffusionCandidate.promoted_record_id.is_(None))
            .order_by(desc(DiffusionCandidate.extracted_at), desc(DiffusionCandidate.id))
        )
        candidate_records = list(candidate_result.scalars().all())

        all_rows = _diffusion_library_rows(final_records, candidate_records)
        all_rows.sort(key=_diffusion_library_sort_key)

        normalized_query = str(q or "").strip().lower()
        if normalized_query:
            all_rows = [item for item in all_rows if normalized_query in _diffusion_search_text(item)]
        if literature_id is not None or record_id is not None or entity_type is not None:
            all_rows = [
                item
                for item in all_rows
                if _diffusion_library_matches_focus(item, literature_id=literature_id, record_id=record_id, entity_type=entity_type)
            ]

        literature_ids = {
            int(item.get("literature_id") or item.get("literatureId") or 0)
            for item in all_rows
            if int(item.get("literature_id") or item.get("literatureId") or 0) > 0
        }
        species_counts: dict[str, int] = {}
        for item in all_rows:
            species = str(item.get("diffusing_species") or item.get("diffusingSpecies") or "unknown").strip() or "unknown"
            species_counts[species] = species_counts.get(species, 0) + 1

        total = len(all_rows)
        items = all_rows[skip:skip + limit]
        return DiffusionLibraryResponse(
            total=total,
            skip=skip,
            limit=limit,
            items=items,
            summary={
                "finalRecordCount": len(final_records),
                "candidateCount": len(candidate_records),
                "literatureCount": len(literature_ids),
                "speciesCounts": species_counts,
            },
        )
    except HTTPException:
        raise
    except Exception as exc:
        _raise_internal_error("List diffusion library", exc)

@router.get("/options", response_model=dict)
async def get_filter_options(
    session: AsyncSession = Depends(get_db_session),
    scope: RequestScope = Depends(get_request_scope),
):
    """
    鑾峰彇鍙敤鐨勮繃婊ら€夐」锛堟潗鏂欏垪琛ㄣ€佹鼎婊戝墏鍒楄〃绛夛級
    """
    try:
        return await get_agent_runtime().get_filter_options(session=session, scope_filter_values=scope_filters(scope))
    except HTTPException:
        raise
    except Exception as exc:
        _raise_internal_error("Get filter options", exc)


@router.get("/stats", response_model=dict)
async def get_stats(
    session: AsyncSession = Depends(get_db_session),
    scope: RequestScope = Depends(get_request_scope),
):
    """
    鑾峰彇鏁版嵁缁熻淇℃伅
    """
    try:
        return await get_agent_runtime().get_stats(session=session, scope_filter_values=scope_filters(scope))
    except HTTPException:
        raise
    except Exception as exc:
        _raise_internal_error("Get record stats", exc)


@router.get("/quality-assets", response_model=dict)
async def get_quality_assets(
    session: AsyncSession = Depends(get_db_session),
    scope: RequestScope = Depends(get_request_scope),
):
    """Summarize data-asset quality gates for the current literature scope."""
    try:
        return await get_quality_asset_summary(session, scope_filter_values=scope_filters(scope))
    except HTTPException:
        raise
    except Exception as exc:
        _raise_internal_error("Get quality asset summary", exc)


@router.get("/pattern-discovery", response_model=dict)
async def get_pattern_discovery_stats(
    session: AsyncSession = Depends(get_db_session),
    scope: RequestScope = Depends(get_request_scope),
):
    """Build chart-ready statistics and manuscript text for pattern discovery."""
    try:
        return await get_pattern_discovery(session, scope_filter_values=scope_filters(scope))
    except HTTPException:
        raise
    except Exception as exc:
        _raise_internal_error("Get pattern discovery stats", exc)


@router.post("/pattern-discovery/report", response_model=dict)
async def save_pattern_discovery_stats_report(
    session: AsyncSession = Depends(get_db_session),
    principal: AuthPrincipal = Depends(get_current_principal),
    scope: RequestScope = Depends(get_request_scope),
):
    """Save the current pattern-discovery manuscript into the user's personal space."""
    try:
        payload = await get_pattern_discovery(session, scope_filter_values=scope_filters(scope))
        return save_pattern_discovery_report(
            payload,
            username=principal.user.username,
            display_name=principal.user.display_name,
        )
    except HTTPException:
        raise
    except Exception as exc:
        _raise_internal_error("Save pattern discovery report", exc)


@router.post("/relationship-graph", response_model=RelationshipGraphResponse, response_model_by_alias=True)
async def get_relationship_graph(
    filter_params: SearchFilter,
    session: AsyncSession = Depends(get_db_session),
    scope: RequestScope = Depends(get_request_scope),
):
    try:
        payload = await build_relationship_graph(
            session,
            filter_params,
            scope_filter_values=scope_filters(scope),
        )
        return RelationshipGraphResponse(**payload)
    except HTTPException:
        raise
    except Exception as exc:
        _raise_internal_error("Build relationship graph", exc)


@router.post("/relationship-graph/drilldown", response_model=RelationshipGraphDrilldownResponse, response_model_by_alias=True)
async def get_relationship_graph_drilldown(
    payload: RelationshipGraphDrilldownRequest,
    skip: int = Query(0, ge=0, description="Number of records to skip"),
    limit: int = Query(20, ge=1, le=200, description="Max drilldown records to return"),
    session: AsyncSession = Depends(get_db_session),
    scope: RequestScope = Depends(get_request_scope),
):
    try:
        result = await drilldown_relationship_graph(
            session,
            payload.filter,
            payload.selection.model_dump(by_alias=True, exclude_none=True),
            skip=skip,
            limit=limit,
            scope_filter_values=scope_filters(scope),
        )
        return RelationshipGraphDrilldownResponse(**result)
    except HTTPException:
        raise
    except Exception as exc:
        _raise_internal_error("Drill down relationship graph", exc)


@router.put("/{record_id}", response_model=dict, response_model_by_alias=True)
async def update_record(
    record_id: int,
    payload: RecordUpdatePayload,
    request: Request,
    session: AsyncSession = Depends(get_db_session),
    principal: AuthPrincipal = Depends(get_current_principal),
):
    """
    鏇存柊鍗曟潯鎽╂摝瀛︽暟鎹褰曪紙鐢ㄤ簬鍓嶇鍐呰仈缂栬緫纭锛?
    """
    try:
        record = await require_record_access(session, principal, record_id, write=True)

        update_data = payload.dict(exclude_none=True, by_alias=False)
        components_update = update_data.pop("lubricant_components", None)
        cof_extracted_update = update_data.pop("cof_extracted", None)
        load_conditions_update = update_data.pop("load_conditions", None)
        speed_conditions_update = update_data.pop("speed_conditions", None)
        tribological_system_update = update_data.pop("tribological_system", None)
        for field, value in update_data.items():
            if hasattr(record, field):
                setattr(record, field, value)
        if components_update is not None:
            record.lubricant_components_json = serialize_lubricant_components(
                normalize_lubricant_components(components_update)
            )
        if cof_extracted_update is not None:
            record.cof_extracted_json = serialize_cof_extracted(
                normalize_cof_extracted(cof_extracted_update)
            )
        if load_conditions_update is not None:
            record.load_conditions_json = serialize_load_conditions(
                normalize_load_conditions(load_conditions_update)
            )
        if speed_conditions_update is not None:
            speed_conditions = normalize_speed_conditions(speed_conditions_update)
            record.speed_conditions_json = serialize_speed_conditions(speed_conditions)
            derived_speed_value = speed_value_from_conditions(speed_conditions)
            if derived_speed_value:
                record.speed_value = derived_speed_value
        if tribological_system_update is not None:
            record.tribological_system_json = serialize_tribological_system(
                normalize_tribological_system(tribological_system_update)
            )
        if any(field in update_data for field in ("experiment_scale", "experiment_method", "measurement_type")):
            current_system = normalize_tribological_system(record.tribological_system_json) or derive_tribological_system(record.regime)
            explicit_profile = build_experiment_profile(
                {
                    "tribological_system": current_system,
                    "experiment_scale": payload.experiment_scale,
                    "experiment_method": payload.experiment_method,
                    "measurement_type": payload.measurement_type,
                    "cof": record.cof_raw,
                    "cof_value": record.cof_value,
                    "load": record.load_raw or record.load_value,
                    "speed": record.speed_value,
                    "probe_geometry": record.probe_geometry,
                    "regime": record.regime,
                    "evidence": record.evidence,
                }
            )
            record.tribological_system_json = serialize_tribological_system({**current_system, **explicit_profile})

        record.material_name = derive_legacy_material_name(
            probe_material=record.probe_material,
            substrate_material=record.substrate_material,
            legacy_material_name=record.material_name,
        )
        record.surface_roughness = derive_legacy_surface_roughness(
            probe_roughness=record.probe_roughness,
            substrate_roughness=record.substrate_roughness,
            legacy_surface_roughness=record.surface_roughness,
        )
        if any(getattr(record, field) for field in ("probe_geometry", "probe_radius", "probe_roughness")) and not record.probe_material:
            raise HTTPException(status_code=422, detail="probeMaterial is required when probe details are recorded.")
        if any(getattr(record, field) for field in ("substrate_coating", "substrate_roughness")) and not record.substrate_material:
            raise HTTPException(status_code=422, detail="substrateMaterial is required when substrate details are recorded.")

        details = calculate_confidence_details(_confidence_input_from_record(record))
        record.confidence = float(details.get("score") or 0.0)

        await session.commit()
        await log_activity(
            db=session,
            user_id=principal.user.id,
            group_id=principal.group.id,
            action_type="edit_record",
            action_detail={
                "record_id": record.id,
                "literature_id": record.literature_id,
                "updated_fields": sorted(update_data.keys()),
            },
            resource_type="record",
            resource_id=record.id,
            request=request,
        )
        return {"success": True, "id": record_id, "confidence": record.confidence, "confidenceDetails": _effective_confidence_details(record)}
    except HTTPException:
        raise
    except Exception as exc:
        await session.rollback()
        _raise_internal_error("Update record", exc)


@router.post("/{record_id}/promote-confidence", response_model=dict, response_model_by_alias=True)
async def promote_record_confidence(
    record_id: int,
    payload: ConfidencePromotePayload,
    request: Request,
    session: AsyncSession = Depends(get_db_session),
    principal: AuthPrincipal = Depends(get_current_principal),
):
    try:
        record = await require_record_access(session, principal, record_id, write=True)

        incoming = payload.dict(exclude_none=True, by_alias=False)

        incoming_source = incoming.get("source")
        if incoming_source and (_is_blank(record.source) or _is_generic_source_label(record.source)):
            record.source = incoming_source

        if incoming.get("source_figure") and _is_blank(record.source_figure):
            record.source_figure = incoming["source_figure"]

        if incoming.get("source_page") and not getattr(record, "source_page", None):
            record.source_page = incoming["source_page"]

        if incoming.get("evidence_page") and not getattr(record, "evidence_page", None):
            record.evidence_page = incoming["evidence_page"]

        if incoming.get("evidence") and _is_blank(record.evidence):
            record.evidence = incoming["evidence"]

        if incoming.get("evidence_bbox") and _is_blank(record.evidence_bbox):
            record.evidence_bbox = incoming["evidence_bbox"]

        recomputed = calculate_confidence_details(_confidence_input_from_record(record))
        record.confidence = float(recomputed.get("score") or 0.0)

        await session.commit()
        await session.refresh(record)
        await log_activity(
            db=session,
            user_id=principal.user.id,
            group_id=principal.group.id,
            action_type="edit_record",
            action_detail={
                "record_id": record.id,
                "literature_id": record.literature_id,
                "promotion": True,
                "confidence": record.confidence,
            },
            resource_type="record",
            resource_id=record.id,
            request=request,
        )
        details = _effective_confidence_details(record)
        return {"success": True, "id": record_id, "confidence": record.confidence, "confidenceDetails": details}
    except HTTPException:
        raise
    except Exception as exc:
        await session.rollback()
        _raise_internal_error("Promote record confidence", exc)


@router.delete("/{record_id}", response_model=dict)
async def delete_record(
    record_id: int,
    session: AsyncSession = Depends(get_db_session),
    principal: AuthPrincipal = Depends(get_current_principal),
):
    """
    鍒犻櫎鍗曟潯鎽╂摝瀛︽暟鎹褰?
    """
    try:
        record = await require_record_access(session, principal, record_id, write=True)

        await session.delete(record)
        await session.commit()
        return {"success": True, "id": record_id}
    except HTTPException:
        raise
    except Exception as exc:
        await session.rollback()
        _raise_internal_error("Delete record", exc)


@router.get("/il/resolve", response_model=dict)
async def resolve_ionic_liquid(
    name: str = Query(..., description="Ionic liquid name to resolve"),
    _principal: AuthPrincipal = Depends(get_current_principal),
):
    """
    Resolve an IL name to its structural components and chemical identifiers.
    """
    try:
        from services.il_resolver_service import resolve_il
        result = resolve_il(name)
        return result
    except HTTPException:
        raise
    except Exception as exc:
        _raise_internal_error("Resolve ionic liquid", exc)
