"""
Data Explorer Router for IonicLink
API endpoints for searching and exploring tribology data.
"""

import logging
from typing import List, Optional, Literal
import re
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, func, desc, or_
from sqlalchemy.orm import selectinload

from database import get_db_session
from models.db_models import TribologyData, Literature
from security import (
    AuthPrincipal,
    RequestScope,
    get_current_principal,
    get_request_scope,
    require_record_access,
    scope_filters,
)
from services.score_service import calculate_confidence, calculate_confidence_details
from services.agent_runtime_service import get_agent_runtime
from services.file_service import _normalize_record_chemistry
from services.il_resolver_service import resolve_il
from services.relationship_graph_service import (
    build_relationship_graph,
    drilldown_relationship_graph,
)
from knowledge_base import normalize_ionic_liquid
from utils.tribopair import compose_tribopair_label, derive_legacy_material_name, derive_legacy_surface_roughness


router = APIRouter(
    prefix="/api/records",
    tags=["Data Explorer"],
    responses={404: {"description": "Not found"}},
)
logger = logging.getLogger(__name__)


def _raise_internal_error(action: str, exc: Exception) -> None:
    logger.exception("%s failed", action)
    raise HTTPException(status_code=500, detail=f"{action} failed.") from exc


# --- Pydantic Models ---

class SearchFilter(BaseModel):
    """Filter parameters for searching tribology records"""
    materials: List[str] = Field(default_factory=list, description="Probe/substrate/coating search terms")
    probe_materials: List[str] = Field(default_factory=list, alias="probeMaterials", description="Probe material terms")
    substrate_materials: List[str] = Field(default_factory=list, alias="substrateMaterials", description="Substrate material terms")
    substrate_coatings: List[str] = Field(default_factory=list, alias="substrateCoatings", description="Substrate coating terms")
    lubricants: List[str] = Field(default_factory=list, description="List of lubricants")
    speed_values: List[str] = Field(default_factory=list, alias="speedValues", description="Speed condition terms")
    temperature_values: List[str] = Field(default_factory=list, alias="temperatureValues", description="Temperature condition terms")
    potential_values: List[str] = Field(default_factory=list, alias="potentialValues", description="Potential condition terms")
    water_content_values: List[str] = Field(default_factory=list, alias="waterContentValues", description="Water content condition terms")
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
    
    confidence: float
    confidence_details: dict = Field(default_factory=dict, alias="confidenceDetails")
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
    load_value: Optional[str] = Field(None, alias="loadValue")
    surface_roughness: Optional[str] = Field(None, alias="surfaceRoughness")
    film_thickness: Optional[str] = Field(None, alias="filmThickness")
    material_name: Optional[str] = Field(None, alias="materialName")
    lubricant: Optional[str] = None

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
    if filter_params.speed_values:
        conditions.append(TribologyData.speed_value.in_(filter_params.speed_values))
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


def _confidence_input_from_record(r: TribologyData) -> dict:
    return {
        "material_name": r.material_name,
        "probe_material": r.probe_material,
        "substrate_material": r.substrate_material,
        "substrate_coating": r.substrate_coating,
        "lubricant": r.lubricant,
        "cof_value": r.cof_value,
        "cof_raw": r.cof_raw,
        "cof_operator": r.cof_operator,
        "load_value": r.load_value,
        "speed_value": r.speed_value,
        "temperature": r.temperature,
        "potential": r.potential,
        "water_content": r.water_content,
        "probe_roughness": r.probe_roughness,
        "substrate_roughness": r.substrate_roughness,
        "surface_roughness": r.surface_roughness,
        "film_thickness": r.film_thickness,
        "evidence": getattr(r, "evidence", None),
        "evidence_page": getattr(r, "evidence_page", None),
        "source": getattr(r, "source", None),
        "source_page": getattr(r, "source_page", None),
        "source_figure": getattr(r, "source_figure", None),
        "evidence_bbox": getattr(r, "evidence_bbox", None),
        "value_origin": getattr(r, "value_origin", None),
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
    runtime_details = calculate_confidence_details(_confidence_input_from_record(r))
    runtime_confidence = float(runtime_details.get("score") or 0.0)
    stored_confidence = float(getattr(r, "confidence", 0.0) or 0.0)
    effective_confidence = max(runtime_confidence, stored_confidence)
    if effective_confidence <= runtime_confidence:
        return runtime_details

    details = dict(runtime_details)
    boosts = [dict(item) for item in runtime_details.get("boosts", [])]
    uplift = round(effective_confidence - runtime_confidence, 4)
    if uplift > 0:
        boosts.append({"reason": "stored_promotion", "value": uplift})
    details["boosts"] = boosts
    details["boost_total"] = round(sum(float(item.get("value") or 0.0) for item in boosts), 4)
    details["boost_percent"] = round(details["boost_total"] * 100.0, 1)
    details["score"] = round(effective_confidence, 4)
    details["percent"] = round(effective_confidence * 100.0, 1)
    return details


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

    payload = {
        "id": r.id,
        "material_name": r.material_name,
        "lubricant": r.lubricant,
        "cof_value": r.cof_value,
        "cof_operator": r.cof_operator,
        "cof_raw": r.cof_raw,
        "load_value": r.load_value,
        "load_raw": r.load_raw,
        "speed_value": r.speed_value,
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
        "surface_roughness": r.surface_roughness,
        "residual_film_thickness_d": r.residual_film_thickness_d,
        "layer_spacing_delta": r.layer_spacing_delta,
        "film_thickness": r.film_thickness,
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
        "confidence": runtime_confidence,
        "confidence_details": runtime_details,
        "literature_id": r.literature_id,
        "literature": lit_dto.model_dump() if lit_dto else None,
    }
    _normalize_record_chemistry([payload])
    return RecordResponse(
        **payload,
        literature=lit_dto
    )


# --- API Endpoints ---

@router.post("/search", response_model=PaginatedRecordResponse, response_model_by_alias=True)
async def search_records(
    filter_params: SearchFilter,
    skip: int = Query(0, ge=0, description="Number of records to skip"),
    limit: int = Query(20, ge=1, le=200, description="Max records to return"),
    session: AsyncSession = Depends(get_db_session),
    scope: RequestScope = Depends(get_request_scope),
):
    """
    鎼滅储鎽╂摝瀛︽暟鎹褰曪紙鏀寔鍒嗛〉锛?
    鏀寔鎸夋潗鏂欍€佹鼎婊戝墏銆佽浇鑽疯寖鍥淬€丆OF鑼冨洿杩囨护
    """
    try:
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
    session: AsyncSession = Depends(get_db_session),
    principal: AuthPrincipal = Depends(get_current_principal),
):
    """
    鏇存柊鍗曟潯鎽╂摝瀛︽暟鎹褰曪紙鐢ㄤ簬鍓嶇鍐呰仈缂栬緫纭锛?
    """
    try:
        record = await require_record_access(session, principal, record_id, write=True)

        update_data = payload.dict(exclude_none=True, by_alias=False)
        for field, value in update_data.items():
            if hasattr(record, field):
                setattr(record, field, value)

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
        record.confidence = max(float(getattr(record, "confidence", 0.0) or 0.0), float(details.get("score") or 0.0))

        await session.commit()
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
        promoted_confidence = float(incoming.get("confidence") or 0.0)
        record.confidence = max(
            float(getattr(record, "confidence", 0.0) or 0.0),
            float(recomputed.get("score") or 0.0),
            promoted_confidence,
        )

        await session.commit()
        await session.refresh(record)
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



