from __future__ import annotations

import logging
import re
from typing import Any, Optional

from sqlalchemy import and_, desc, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from models.db_models import Literature, RecordCandidate, TribologyData
from security import literature_scope_conditions
from services.file_service import (
    _is_derived_speed_conditions,
    _normalize_record_chemistry,
    _parse_json_object,
    _repair_response_field_evidence_map,
)
from services.il_resolver_service import ANION_DB, CATION_DB, resolve_il
from services.score_service import calculate_confidence, calculate_confidence_details
from services.tribology_review_quality import evidence_quality_summary
from services.unit_converter import parse_force_range_to_newtons, parse_force_to_newtons
from services.usage_metrics_service import get_usage_metrics_service
from knowledge_base import normalize_ionic_liquid
from utils.cof_extraction import derive_cof_extracted, normalize_cof_extracted
from utils.experiment_profile import build_experiment_profile
from utils.lubricant_mixture import (
    compact_lubricant_label,
    components_for_record,
    format_lubricant_tooltip,
)
from utils.structured_conditions import (
    derive_load_conditions,
    derive_tribological_system,
    normalize_load_conditions,
    normalize_tribological_system,
)
from utils.speed_conditions import derive_speed_conditions, normalize_speed_conditions, speed_value_from_conditions
from utils.tribopair import compose_tribopair_label, composite_roughness_label

logger = logging.getLogger(__name__)


def _trusted_final_record_condition(model: Any):
    page_conditions = []
    if hasattr(model, "evidence_page"):
        page_conditions.append(model.evidence_page.is_not(None))
    if hasattr(model, "source_page"):
        page_conditions.append(model.source_page.is_not(None))
    page_locator_condition = or_(*page_conditions) if page_conditions else False
    return and_(
        or_(
            model.review_status.is_(None),
            func.trim(model.review_status) == "",
            func.lower(model.review_status) == "approved",
        ),
        func.length(func.trim(model.evidence)) > 0,
        page_locator_condition,
    )


async def _execute_counted(session: AsyncSession, stmt: Any, *, operation: str):
    get_usage_metrics_service().record_db_query(operation=operation)
    return await session.execute(stmt)


def _strip_ion_component_markup(value: object) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    text = re.sub(r"^\[", "", text)
    text = re.sub(r"\]\s*(?:\d+)?\s*[+-]?$", "", text)
    text = text.rstrip("+-").strip()
    return text


def _ion_component_key(value: object) -> str:
    return re.sub(r"[^a-z0-9]+", "", _strip_ion_component_markup(value).lower())


def _resolve_ion_component(value: object, db: dict[str, dict[str, Any]]) -> str | None:
    key = _ion_component_key(value)
    if not key:
        return None

    for canonical, info in db.items():
        candidates = [
            canonical,
            info.get("display_name"),
            info.get("full_name"),
            *(info.get("aliases") or []),
        ]
        if any(_ion_component_key(candidate) == key for candidate in candidates if candidate):
            return canonical
    return None


def _display_ion_component(value: object, db: dict[str, dict[str, Any]]) -> str:
    canonical = _resolve_ion_component(value, db)
    if canonical:
        info = db.get(canonical) or {}
        return str(info.get("display_name") or canonical).strip()
    return _strip_ion_component_markup(value)


def _ion_component_filter_terms(
    values: list[str] | tuple[str, ...] | set[str],
    db: dict[str, dict[str, Any]],
    *,
    charge_suffix: str,
) -> list[str]:
    terms: set[str] = set()

    def add_variant(candidate: object) -> None:
        text = str(candidate or "").strip()
        if not text:
            return
        terms.add(text)
        stripped = _strip_ion_component_markup(text)
        if stripped:
            terms.add(stripped)
            terms.add(f"[{stripped}]")
            terms.add(f"{stripped}{charge_suffix}")
            terms.add(f"[{stripped}]{charge_suffix}")

    for value in values or []:
        add_variant(value)
        canonical = _resolve_ion_component(value, db)
        if not canonical:
            continue
        info = db.get(canonical) or {}
        for candidate in [
            canonical,
            info.get("display_name"),
            info.get("full_name"),
            *(info.get("aliases") or []),
        ]:
            add_variant(candidate)

    return sorted(terms)


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


def _json_text(path: str, model: Any = TribologyData):
    return func.lower(func.coalesce(func.json_extract(model.tribological_system_json, path), ""))


def _text_search_condition(query: object, model: Any = TribologyData):
    term = str(query or "").strip().lower()
    if not term:
        return None
    pattern = f"%{term}%"
    fields = [
        Literature.doi,
        Literature.title,
        Literature.authors,
        Literature.journal,
        model.lubricant,
        model.lubricant_alias,
        model.cation,
        model.anion,
        model.probe_material,
        model.substrate_material,
        model.substrate_coating,
        model.material_name,
    ]
    return or_(*[
        func.lower(func.coalesce(field, "")).like(pattern)
        for field in fields
    ])


def _build_conditions(filter_params: Any, model: Any = TribologyData):
    conditions = []
    if getattr(filter_params, "record_id", None) is not None:
        conditions.append(model.id == filter_params.record_id)
    if getattr(filter_params, "materials", None):
        terms = [term for term in getattr(filter_params, "materials", None) or [] if str(term or "").strip()]
        if terms:
            conditions.append(
                or_(
                    model.probe_material.in_(terms),
                    model.substrate_material.in_(terms),
                    model.substrate_coating.in_(terms),
                    model.material_name.in_(terms),
                )
            )
    if getattr(filter_params, "lubricants", None):
        lubricant_terms: set[str] = set()
        for raw_value in getattr(filter_params, "lubricants", None) or []:
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
            conditions.append(model.lubricant.in_(sorted(lubricant_terms)))
    if getattr(filter_params, "cations", None):
        cation_terms = _ion_component_filter_terms(
            getattr(filter_params, "cations", None) or [],
            CATION_DB,
            charge_suffix="+",
        )
        if cation_terms:
            conditions.append(model.cation.in_(cation_terms))
    if getattr(filter_params, "anions", None):
        anion_terms = _ion_component_filter_terms(
            getattr(filter_params, "anions", None) or [],
            ANION_DB,
            charge_suffix="-",
        )
        if anion_terms:
            conditions.append(model.anion.in_(anion_terms))
    if getattr(filter_params, "cof_min", None) is not None:
        conditions.append(model.cof_value >= filter_params.cof_min)
    if getattr(filter_params, "cof_max", None) is not None:
        conditions.append(model.cof_value <= filter_params.cof_max)
    review_statuses = [str(status).strip().lower() for status in (getattr(filter_params, "review_statuses", None) or []) if str(status or "").strip()]
    if review_statuses:
        conditions.append(func.lower(model.review_status).in_(review_statuses))
    experiment_scales = _normalized_scale_filter_terms(getattr(filter_params, "experiment_scales", None) or [])
    if experiment_scales:
        conditions.append(_json_text("$.scale", model).in_(experiment_scales))
    experiment_methods = _normalized_json_filter_terms(getattr(filter_params, "experiment_methods", None) or [])
    if experiment_methods:
        conditions.append(_json_text("$.method", model).in_(experiment_methods))
    measurement_types = _normalized_json_filter_terms(getattr(filter_params, "measurement_types", None) or [])
    if measurement_types:
        conditions.append(_json_text("$.measurement_type", model).in_(measurement_types))
    training_views = _normalized_json_filter_terms(getattr(filter_params, "training_views", None) or [])
    if training_views:
        conditions.append(_json_text("$.training_view", model).in_(training_views))
    if getattr(filter_params, "speed_values", None):
        conditions.append(model.speed_value.in_(filter_params.speed_values))
    if getattr(filter_params, "shear_rate_values", None):
        conditions.append(model.shear_rate.in_(filter_params.shear_rate_values))
    if getattr(filter_params, "temperature_values", None):
        conditions.append(model.temperature.in_(filter_params.temperature_values))
    if getattr(filter_params, "potential_values", None):
        conditions.append(model.potential.in_(filter_params.potential_values))
    if getattr(filter_params, "water_content_values", None):
        conditions.append(model.water_content.in_(filter_params.water_content_values))
    if getattr(filter_params, "doi", None):
        conditions.append(Literature.doi == filter_params.doi)
    text_condition = _text_search_condition(
        getattr(filter_params, "query", None) or getattr(filter_params, "q", None),
        model,
    )
    if text_condition is not None:
        conditions.append(text_condition)
    if getattr(filter_params, "file_id", None):
        try:
            conditions.append(model.literature_id == int(filter_params.file_id))
        except (TypeError, ValueError):
            conditions.append(Literature.file_path.like(f"%{filter_params.file_id}%"))
    return conditions


def _parse_load_numeric(value: Optional[str]) -> Optional[float]:
    if value is None:
        return None

    text = str(value).strip()
    if not text:
        return None

    match = re.search(r"-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?", text)
    if not match:
        return None

    try:
        return float(match.group(0))
    except ValueError:
        return None


def _parse_load_bounds(value: Optional[str]) -> Optional[tuple[float, float]]:
    if value is None:
        return None

    text = str(value).strip()
    if not text:
        return None

    range_bounds = parse_force_range_to_newtons(text)
    if range_bounds is not None:
        return range_bounds

    scalar = parse_force_to_newtons(text)
    if scalar is None:
        return None

    return scalar, scalar


def _load_matches_filter(value: Optional[str], load_min: float | None, load_max: float | None) -> bool:
    bounds = _parse_load_bounds(value)
    if bounds is None:
        return False

    record_min, record_max = bounds
    if load_min is not None and record_max < load_min:
        return False
    if load_max is not None and record_min > load_max:
        return False
    return True


def build_confidence_input(record: TribologyData) -> dict[str, Any]:
    return {
        "material_name": record.material_name,
        "probe_material": record.probe_material,
        "substrate_material": record.substrate_material,
        "substrate_coating": record.substrate_coating,
        "lubricant": record.lubricant,
        "lubricant_components": components_for_record(record),
        "lubricant_alias": getattr(record, "lubricant_alias", None),
        "cof_extracted": normalize_cof_extracted(getattr(record, "cof_extracted_json", None)) or derive_cof_extracted(
            record.cof_raw,
            record.cof_value,
            load=record.load_raw or record.load_value,
            speed=record.speed_value,
        ),
        "cof_value": record.cof_value,
        "cof_raw": record.cof_raw,
        "cof_operator": record.cof_operator,
        "load_value": record.load_value,
        "load_conditions": normalize_load_conditions(getattr(record, "load_conditions_json", None)) or derive_load_conditions(record.load_raw or record.load_value),
        "speed_value": record.speed_value,
        "speed_conditions": normalize_speed_conditions(getattr(record, "speed_conditions_json", None)) or derive_speed_conditions(record.speed_value),
        "shear_rate": getattr(record, "shear_rate", None),
        "temperature": record.temperature,
        "potential": record.potential,
        "water_content": record.water_content,
        "probe_roughness": record.probe_roughness,
        "substrate_roughness": record.substrate_roughness,
        "surface_roughness": composite_roughness_label(
            record.probe_roughness,
            record.substrate_roughness,
            method="rms",
            legacy_surface_roughness=record.surface_roughness,
        ),
        "film_thickness": record.film_thickness,
        "regime": getattr(record, "regime", None),
        "tribological_system": normalize_tribological_system(getattr(record, "tribological_system_json", None)) or derive_tribological_system(getattr(record, "regime", None)),
        "evidence": getattr(record, "evidence", None),
        "evidence_page": getattr(record, "evidence_page", None),
        "source": getattr(record, "source", None),
        "source_page": getattr(record, "source_page", None),
        "source_figure": getattr(record, "source_figure", None),
        "evidence_bbox": getattr(record, "evidence_bbox", None),
        "value_origin": getattr(record, "value_origin", None),
        "field_evidence_json": getattr(record, "field_evidence_json", None),
        "review_status": getattr(record, "review_status", None),
        "model_confidence": getattr(record, "confidence", None),
    }


def effective_confidence_details(record: TribologyData) -> dict[str, Any]:
    return calculate_confidence_details(build_confidence_input(record))


def _grounding_bucket_from_record(record: TribologyData) -> str:
    source = str(getattr(record, "source", "") or "").strip().lower()
    source_figure = str(getattr(record, "source_figure", "") or "").strip().lower()
    value_origin = str(getattr(record, "value_origin", "") or "").strip().lower()

    if any(tag in value_origin for tag in ("infer", "estimated", "derived")):
        return "inferred"

    source_label = source_figure or source
    if any(tag in source_label for tag in ("fig", "figure", "panel", "plot", "image", "visual")):
        return "figure_grounded"

    return "text_grounded"


def format_record_display_id(display_index: int | None, fallback_record_id: int | None = None) -> str:
    try:
        index = int(display_index) if display_index is not None else 0
    except (TypeError, ValueError):
        index = 0
    if index > 0:
        return f"R-{index:06d}"
    try:
        record_id = int(fallback_record_id) if fallback_record_id is not None else 0
    except (TypeError, ValueError):
        record_id = 0
    return f"R-{record_id:06d}" if record_id > 0 else "R-000000"


def _confidence_tier(score: Any) -> str:
    try:
        value = float(score or 0.0)
    except (TypeError, ValueError):
        value = 0.0
    if value >= 0.8:
        return "high"
    if value >= 0.6:
        return "medium"
    return "low"


async def _display_indices_for_records(
    session: AsyncSession,
    records: list[TribologyData],
    *,
    scope_conditions: list[Any] | None = None,
) -> dict[int, int]:
    record_ids = [int(record.id) for record in records if getattr(record, "id", None) is not None]
    if not record_ids:
        return {}

    ranked_stmt = (
        select(
            TribologyData.id.label("record_id"),
            func.row_number().over(order_by=TribologyData.id).label("display_index"),
        )
        .join(TribologyData.literature)
    )
    if scope_conditions:
        ranked_stmt = ranked_stmt.where(*scope_conditions)
    ranked_records = ranked_stmt.subquery()
    stmt = select(ranked_records.c.record_id, ranked_records.c.display_index).where(
        ranked_records.c.record_id.in_(record_ids)
    )
    result = await _execute_counted(session, stmt, operation="search_records.display_ids")
    return {
        int(row.record_id): int(row.display_index)
        for row in result
        if row.record_id is not None and row.display_index is not None
    }


def _record_to_payload(record: TribologyData, *, display_index: int | None = None) -> dict[str, Any]:
    literature_payload = None
    if record.literature:
        literature_payload = {
            "id": record.literature.id,
            "doi": record.literature.doi or "",
            "title": record.literature.title or "",
            "authors": record.literature.authors,
            "journal": record.literature.journal or "",
            "year": record.literature.year,
        }

    runtime_details = effective_confidence_details(record)
    lubricant_components = components_for_record(record)
    lubricant_alias = getattr(record, "lubricant_alias", None)
    field_evidence_map = _parse_json_object(getattr(record, "field_evidence_json", None))
    repaired_field_evidence_map, repaired_speed_conditions = _repair_response_field_evidence_map(record, field_evidence_map)
    speed_conditions = repaired_speed_conditions or normalize_speed_conditions(getattr(record, "speed_conditions_json", None)) or derive_speed_conditions(record.speed_value)
    speed_value = speed_value_from_conditions(speed_conditions) if _is_derived_speed_conditions(speed_conditions) else None
    speed_value = speed_value or record.speed_value
    cof_extracted = normalize_cof_extracted(getattr(record, "cof_extracted_json", None)) or derive_cof_extracted(
        record.cof_raw,
        record.cof_value,
        load=record.load_raw or record.load_value,
        speed=speed_value,
    )
    load_conditions = normalize_load_conditions(getattr(record, "load_conditions_json", None)) or derive_load_conditions(record.load_raw or record.load_value)
    tribological_system = normalize_tribological_system(getattr(record, "tribological_system_json", None)) or derive_tribological_system(getattr(record, "regime", None))
    experiment_profile = build_experiment_profile(
        {
            "tribological_system": tribological_system,
            "cof": record.cof_raw,
            "cof_value": record.cof_value,
            "load": record.load_raw or record.load_value,
            "speed": speed_value,
            "probe_geometry": record.probe_geometry,
            "probe_radius": record.probe_radius,
            "regime": getattr(record, "regime", None),
            "source": getattr(record, "source", None),
            "source_figure": getattr(record, "source_figure", None),
            "evidence": getattr(record, "evidence", None),
        }
    )
    if tribological_system:
        tribological_system = {**tribological_system, **experiment_profile}
    review_entity_type = "candidate" if isinstance(record, RecordCandidate) else "record"
    evidence_summary = evidence_quality_summary(
        {
            "material_name": record.material_name,
            "lubricant": record.lubricant,
            "cof_raw": record.cof_raw,
            "cof_value": record.cof_value,
            "load_raw": record.load_raw,
            "load_value": record.load_value,
            "speed_value": speed_value,
            "temperature": record.temperature,
            "potential": record.potential,
            "water_content": record.water_content,
            "field_evidence_json": repaired_field_evidence_map,
        }
    )
    payload = {
        "id": record.id,
        "display_id": f"C-{int(record.id):06d}" if review_entity_type == "candidate" else format_record_display_id(display_index, record.id),
        "entity_type": review_entity_type,
        "entity_id": record.id,
        "review_entity_type": review_entity_type,
        "confidence_tier": _confidence_tier(runtime_details.get("score") or getattr(record, "confidence", None)),
        "admission_reason": getattr(record, "record_origin", None) or ("review_candidate" if review_entity_type == "candidate" else "strict_validated"),
        "quality_notes": getattr(record, "assembly_notes", None),
        "material_name": record.material_name,
        "lubricant": record.lubricant,
        "lubricant_components": lubricant_components,
        "lubricant_alias": lubricant_alias,
        "ionic_liquid_display": compact_lubricant_label(record.lubricant, lubricant_components, lubricant_alias),
        "lubricant_tooltip": format_lubricant_tooltip(record.lubricant, lubricant_components, lubricant_alias),
        "cof_extracted": cof_extracted,
        "cof_value": record.cof_value,
        "cof_operator": record.cof_operator,
        "cof_raw": record.cof_raw,
        "load_value": record.load_value,
        "load_raw": record.load_raw,
        "load_conditions": load_conditions,
        "speed_value": speed_value,
        "speed_conditions": speed_conditions,
        "shear_rate": getattr(record, "shear_rate", None),
        "temperature": record.temperature,
        "potential": record.potential,
        "water_content": record.water_content,
        "probe_material": record.probe_material,
        "probe_geometry": record.probe_geometry,
        "probe_radius": record.probe_radius,
        "probe_roughness": record.probe_roughness,
        "substrate_material": record.substrate_material,
        "substrate_coating": record.substrate_coating,
        "substrate_roughness": record.substrate_roughness,
        "tribopair_label": compose_tribopair_label(
            record.probe_material,
            record.substrate_material,
            record.substrate_coating,
        ),
        "surface_roughness": composite_roughness_label(
            record.probe_roughness,
            record.substrate_roughness,
            method="rms",
            legacy_surface_roughness=record.surface_roughness,
        ),
        "residual_film_thickness_d": record.residual_film_thickness_d,
        "layer_spacing_delta": record.layer_spacing_delta,
        "film_thickness": record.film_thickness,
        "regime": getattr(record, "regime", None),
        "tribological_system": tribological_system,
        "experiment_profile": experiment_profile,
        "experiment_scale": experiment_profile["scale"],
        "experiment_method": experiment_profile["method"],
        "measurement_type": experiment_profile["measurement_type"],
        "training_view": experiment_profile["training_view"],
        "mol_ratio": record.mol_ratio,
        "cation": record.cation,
        "anion": record.anion,
        "cation_smiles": record.cation_smiles,
        "anion_smiles": record.anion_smiles,
        "il_smiles": record.il_smiles,
        "il_inchikey": record.il_inchikey,
        "alkyl_chain_length": record.alkyl_chain_length,
        "evidence": getattr(record, "evidence", None),
        "evidence_page": getattr(record, "evidence_page", None),
        "evidence_bbox": getattr(record, "evidence_bbox", None),
        "source": getattr(record, "source", None),
        "source_page": getattr(record, "source_page", None),
        "source_figure": getattr(record, "source_figure", None),
        "field_evidence_json": repaired_field_evidence_map,
        "confidence": float(runtime_details.get("score") or 0.0),
        "evidence_score": evidence_summary["score"],
        "evidenceScore": evidence_summary["score"],
        "evidence_grade": evidence_summary["grade"],
        "evidenceGrade": evidence_summary["grade"],
        "evidence_summary": evidence_summary,
        "evidenceSummary": evidence_summary,
        "confidence_details": runtime_details,
        "review_status": getattr(record, "review_status", None),
        "record_origin": getattr(record, "record_origin", None),
        "assembly_notes": getattr(record, "assembly_notes", None),
        "extracted_at": record.extracted_at.isoformat() if getattr(record, "extracted_at", None) else None,
        "literature_id": record.literature_id,
        "literature": literature_payload,
    }
    _normalize_record_chemistry([payload])
    return payload


_SORTABLE_FIELDS = frozenset({"id", "cof", "load", "confidence", "date"})


def _record_sort_value(record: Any, sort_by: str) -> Any:
    """Extract a comparable key for one of the supported sort columns.

    Returns None for records that have no value in that column so callers can
    push them to the end regardless of sort direction.
    """
    if sort_by == "cof":
        return getattr(record, "cof_value", None)
    if sort_by == "load":
        bounds = _parse_load_bounds(getattr(record, "load_value", None) or getattr(record, "load_raw", None))
        if bounds is None:
            return None
        return (bounds[0] + bounds[1]) / 2.0
    if sort_by == "confidence":
        value = getattr(record, "confidence", None)
        try:
            return float(value) if value is not None else None
        except (TypeError, ValueError):
            return None
    if sort_by == "date":
        return getattr(record, "extracted_at", None)
    # Default / "id"
    return int(getattr(record, "id", 0) or 0)


def _apply_explicit_sort(records: list[Any], sort_by: str, sort_dir: str) -> list[Any]:
    """Sort records by an explicit column with missing values pinned last.

    A stable secondary sort by id keeps ordering deterministic for ties.
    """
    reverse = str(sort_dir or "asc").strip().lower() == "desc"
    present: list[tuple[Any, Any]] = []
    missing: list[Any] = []
    for record in records:
        value = _record_sort_value(record, sort_by)
        if value is None:
            missing.append(record)
        else:
            present.append((value, record))
    present.sort(key=lambda pair: int(getattr(pair[1], "id", 0) or 0))
    present.sort(key=lambda pair: pair[0], reverse=reverse)
    missing.sort(key=lambda record: int(getattr(record, "id", 0) or 0))
    return [record for _, record in present] + missing


async def search_records(
    session: AsyncSession,
    filter_params: Any,
    *,
    skip: int = 0,
    limit: int = 20,
    scope_filter_values: dict[str, Any] | None = None,
) -> dict[str, Any]:
    logger.debug("Executing record search skip=%s limit=%s scope=%s", skip, limit, scope_filter_values)
    record_conditions = _build_conditions(filter_params, TribologyData)
    candidate_conditions = _build_conditions(filter_params, RecordCandidate)
    entity_type_filter = str(getattr(filter_params, "entity_type", "") or "").strip().lower()
    include_records = entity_type_filter != "candidate"
    include_candidates = entity_type_filter != "record"
    scope_conditions = literature_scope_conditions(scope_filter_values) if scope_filter_values else []
    use_load_filter = (
        getattr(filter_params, "load_min", None) is not None
        or getattr(filter_params, "load_max", None) is not None
    )
    sort_by = str(getattr(filter_params, "sort_by", "") or "").strip().lower()
    if sort_by not in _SORTABLE_FIELDS:
        sort_by = ""
    sort_dir = str(getattr(filter_params, "sort_dir", "") or "").strip().lower()

    def _database_review_order(record: Any) -> tuple[int, int, int]:
        record_id = int(getattr(record, "id", 0) or 0)
        literature_id = int(getattr(record, "literature_id", 0) or 0)
        if isinstance(record, RecordCandidate):
            return (0, -record_id, -literature_id)
        return (1, literature_id, record_id)

    async def _fetch_records_for_model(model: Any, conditions: list[Any], *, operation: str):
        stmt = (
            select(model)
            .join(model.literature)
            .options(selectinload(model.literature))
        )
        if scope_conditions:
            stmt = stmt.where(*scope_conditions)
        if conditions:
            stmt = stmt.where(and_(*conditions))
        if model is RecordCandidate:
            stmt = stmt.where(RecordCandidate.promoted_record_id.is_(None))
            stmt = stmt.where(
                or_(
                    RecordCandidate.review_status.is_(None),
                    func.lower(RecordCandidate.review_status) != "rejected",
                )
            )
        elif not getattr(filter_params, "review_statuses", None):
            stmt = stmt.where(_trusted_final_record_condition(model))
        stmt = stmt.order_by(model.id)
        result = await _execute_counted(session, stmt, operation=operation)
        return list(result.scalars().all())

    if use_load_filter:
        all_records = [
            *(await _fetch_records_for_model(TribologyData, record_conditions, operation="search_records.load_filtered.records") if include_records else []),
            *(await _fetch_records_for_model(RecordCandidate, candidate_conditions, operation="search_records.load_filtered.candidates") if include_candidates else []),
        ]

        filtered_records = []
        for record in all_records:
            if not _load_matches_filter(
                record.load_value or record.load_raw,
                getattr(filter_params, "load_min", None),
                getattr(filter_params, "load_max", None),
            ):
                continue
            filtered_records.append(record)

        if sort_by:
            filtered_records = _apply_explicit_sort(filtered_records, sort_by, sort_dir)
        else:
            filtered_records.sort(key=_database_review_order)
        total = len(filtered_records)
        records = filtered_records[skip : skip + limit]
    else:
        all_records = [
            *(await _fetch_records_for_model(TribologyData, record_conditions, operation="search_records.page.records") if include_records else []),
            *(await _fetch_records_for_model(RecordCandidate, candidate_conditions, operation="search_records.page.candidates") if include_candidates else []),
        ]
        if sort_by:
            all_records = _apply_explicit_sort(all_records, sort_by, sort_dir)
        else:
            all_records.sort(key=_database_review_order)
        total = len(all_records)
        records = all_records[skip : skip + limit]

    final_records = [record for record in records if isinstance(record, TribologyData)]
    display_indices = await _display_indices_for_records(session, final_records, scope_conditions=scope_conditions)

    return {
        "total": total,
        "skip": skip,
        "limit": limit,
        "items": [
            _record_to_payload(record, display_index=display_indices.get(int(record.id)))
            for record in records
        ],
    }


async def get_filter_options(
    session: AsyncSession,
    scope_filter_values: dict[str, Any] | None = None,
) -> dict[str, list[str]]:
    logger.debug("Loading record filter options scope=%s", scope_filter_values)
    lubricants_stmt = select(TribologyData.lubricant).distinct()
    option_fields = [
        ("filter_options.ions.cation", TribologyData.cation),
        ("filter_options.ions.anion", TribologyData.anion),
        ("filter_options.materials.probe", TribologyData.probe_material),
        ("filter_options.materials.substrate", TribologyData.substrate_material),
        ("filter_options.materials.coating", TribologyData.substrate_coating),
        ("filter_options.materials.legacy", TribologyData.material_name),
        ("filter_options.conditions.speed", TribologyData.speed_value),
        ("filter_options.conditions.shear_rate", TribologyData.shear_rate),
        ("filter_options.conditions.temperature", TribologyData.temperature),
        ("filter_options.conditions.potential", TribologyData.potential),
        ("filter_options.conditions.water_content", TribologyData.water_content),
    ]
    option_values: dict[str, set[str]] = {
        "materials": set(),
        "cations": set(),
        "anions": set(),
        "probeMaterials": set(),
        "substrateMaterials": set(),
        "substrateCoatings": set(),
        "speedValues": set(),
        "shearRateValues": set(),
        "temperatureValues": set(),
        "potentialValues": set(),
        "waterContentValues": set(),
        "experimentScales": set(),
        "experimentMethods": set(),
        "measurementTypes": set(),
        "trainingViews": set(),
    }
    conditions = literature_scope_conditions(scope_filter_values) if scope_filter_values else []
    if conditions:
        lubricants_stmt = lubricants_stmt.join(TribologyData.literature).where(*conditions)
    for operation, column in option_fields:
        stmt = select(column).distinct()
        if conditions:
            stmt = stmt.join(TribologyData.literature).where(*conditions)
        result_values = await _execute_counted(session, stmt, operation=operation)
        cleaned = {str(item).strip() for item in result_values.scalars().all() if str(item or "").strip()}
        if column is TribologyData.cation:
            option_values["cations"].update(_display_ion_component(item, CATION_DB) for item in cleaned)
        elif column is TribologyData.anion:
            option_values["anions"].update(_display_ion_component(item, ANION_DB) for item in cleaned)
        elif column is TribologyData.probe_material:
            option_values["probeMaterials"].update(cleaned)
            option_values["materials"].update(cleaned)
        elif column is TribologyData.substrate_material:
            option_values["substrateMaterials"].update(cleaned)
            option_values["materials"].update(cleaned)
        elif column is TribologyData.substrate_coating:
            option_values["substrateCoatings"].update(cleaned)
            option_values["materials"].update(cleaned)
        elif column is TribologyData.material_name:
            option_values["materials"].update(cleaned)
        elif column is TribologyData.speed_value:
            option_values["speedValues"].update(cleaned)
        elif column is TribologyData.shear_rate:
            option_values["shearRateValues"].update(cleaned)
        elif column is TribologyData.temperature:
            option_values["temperatureValues"].update(cleaned)
        elif column is TribologyData.potential:
            option_values["potentialValues"].update(cleaned)
        elif column is TribologyData.water_content:
            option_values["waterContentValues"].update(cleaned)

    result_lubricants = await _execute_counted(
        session,
        lubricants_stmt,
        operation="filter_options.lubricants",
    )
    lubricants = result_lubricants.scalars().all()

    json_option_fields = [
        ("filter_options.experiment.scale", "$.scale", "experimentScales"),
        ("filter_options.experiment.method", "$.method", "experimentMethods"),
        ("filter_options.experiment.measurement_type", "$.measurement_type", "measurementTypes"),
        ("filter_options.experiment.training_view", "$.training_view", "trainingViews"),
    ]
    for operation, path, key in json_option_fields:
        stmt = select(func.json_extract(TribologyData.tribological_system_json, path)).distinct()
        if conditions:
            stmt = stmt.join(TribologyData.literature).where(*conditions)
        result_values = await _execute_counted(session, stmt, operation=operation)
        option_values[key].update(str(item).strip() for item in result_values.scalars().all() if str(item or "").strip())

    normalized_lubricants: list[str] = []
    for value in lubricants:
        payload = {"lubricant": value}
        _normalize_record_chemistry([payload])
        normalized = str(payload.get("lubricant") or "").strip()
        if normalized:
            normalized_lubricants.append(normalized)

    return {
        "materials": sorted(option_values["materials"]),
        "lubricants": sorted(set(normalized_lubricants)),
        "cations": sorted(option_values["cations"]),
        "anions": sorted(option_values["anions"]),
        "probeMaterials": sorted(option_values["probeMaterials"]),
        "substrateMaterials": sorted(option_values["substrateMaterials"]),
        "substrateCoatings": sorted(option_values["substrateCoatings"]),
        "speedValues": sorted(option_values["speedValues"]),
        "shearRateValues": sorted(option_values["shearRateValues"]),
        "temperatureValues": sorted(option_values["temperatureValues"]),
        "potentialValues": sorted(option_values["potentialValues"]),
        "waterContentValues": sorted(option_values["waterContentValues"]),
        "experimentScales": sorted(option_values["experimentScales"]),
        "experimentMethods": sorted(option_values["experimentMethods"]),
        "measurementTypes": sorted(option_values["measurementTypes"]),
        "trainingViews": sorted(option_values["trainingViews"]),
    }


def validate_extraction_result(
    records: list[dict[str, Any]],
    extraction_summary: dict[str, Any] | None,
    extractor_type: str = "tribology",
) -> dict[str, Any]:
    normalized_records = records or []
    duplicate_keys: set[tuple[Any, ...]] = set()
    duplicate_count = 0
    warnings = []

    if extractor_type == "diffusion":
        missing_system = 0
        missing_lubricant = 0
        missing_diffusion = 0

        for record in normalized_records:
            system_name = str(record.get("system_name") or "").strip()
            ionic_liquid = str(record.get("ionic_liquid") or "").strip()
            d_value = record.get("D_total") or record.get("D_cation") or record.get("D_anion")

            if not system_name or system_name.lower().startswith("unknown"):
                missing_system += 1
            if not ionic_liquid or ionic_liquid.lower().startswith("unknown"):
                missing_lubricant += 1
            if d_value in (None, ""):
                missing_diffusion += 1

            dedupe_key = (
                system_name.lower(),
                ionic_liquid.lower(),
                str(record.get("D_total") or "").strip().lower(),
                str(record.get("D_cation") or "").strip().lower(),
                str(record.get("D_anion") or "").strip().lower(),
                str(record.get("source_page") or "").strip(),
                str(record.get("source") or "").strip().lower(),
            )
            if dedupe_key in duplicate_keys:
                duplicate_count += 1
            else:
                duplicate_keys.add(dedupe_key)

        if missing_system:
            warnings.append(f"{missing_system} records are missing system names.")
        if missing_lubricant:
            warnings.append(f"{missing_lubricant} records are missing ionic-liquid labels.")
        if missing_diffusion:
            warnings.append(f"{missing_diffusion} records are missing diffusion coefficients.")
        if duplicate_count:
            warnings.append(f"{duplicate_count} duplicate diffusion candidate groups were detected after extraction.")

        return {
            "record_count": len(normalized_records),
            "summary_final_count": int((extraction_summary or {}).get("final_count") or len(normalized_records)),
            "missing_system_count": missing_system,
            "missing_lubricant_count": missing_lubricant,
            "missing_diffusion_count": missing_diffusion,
            "duplicate_count": duplicate_count,
            "quality_gate_passed": missing_diffusion == 0,
            "warnings": warnings,
        }

    missing_material = 0
    missing_lubricant = 0
    missing_cof = 0

    for record in normalized_records:
        material = str(record.get("material_name") or "").strip()
        lubricant = str(record.get("ionic_liquid") or record.get("lubricant") or "").strip()
        cof = record.get("cof") or record.get("cof_raw") or record.get("cof_value")

        if not material or material.lower().startswith("unknown"):
            missing_material += 1
        if not lubricant or lubricant.lower().startswith("unknown"):
            missing_lubricant += 1
        if cof in (None, ""):
            missing_cof += 1

        dedupe_key = (
            material.lower(),
            lubricant.lower(),
            str(cof or "").strip().lower(),
            str(record.get("source_page") or "").strip(),
            str(record.get("source_figure") or record.get("source") or "").strip().lower(),
        )
        if dedupe_key in duplicate_keys:
            duplicate_count += 1
        else:
            duplicate_keys.add(dedupe_key)

    if missing_material:
        warnings.append(f"{missing_material} records are missing material labels.")
    if missing_lubricant:
        warnings.append(f"{missing_lubricant} records are missing lubricant labels.")
    if missing_cof:
        warnings.append(f"{missing_cof} records are missing COF values.")
    if duplicate_count:
        warnings.append(f"{duplicate_count} duplicate candidate groups were detected after extraction.")

    return {
        "record_count": len(normalized_records),
        "summary_final_count": int((extraction_summary or {}).get("final_count") or len(normalized_records)),
        "missing_material_count": missing_material,
        "missing_lubricant_count": missing_lubricant,
        "missing_cof_count": missing_cof,
        "duplicate_count": duplicate_count,
        "quality_gate_passed": missing_cof == 0,
        "warnings": warnings,
    }


async def summarize_confidence_buckets(
    session: AsyncSession,
    scope_filter_values: dict[str, Any] | None = None,
) -> dict[str, Any]:
    stmt = select(TribologyData)
    if scope_filter_values:
        stmt = stmt.join(TribologyData.literature).where(*literature_scope_conditions(scope_filter_values))
    conf_records = (await _execute_counted(session, stmt, operation="confidence_buckets.records")).scalars().all()
    runtime_conf = []
    bucket_scores = {
        "text_grounded": [],
        "figure_grounded": [],
        "inferred": [],
    }
    for record in conf_records:
        score = calculate_confidence(build_confidence_input(record))
        runtime_conf.append(score)
        bucket_scores[_grounding_bucket_from_record(record)].append(score)

    if runtime_conf:
        conf_count = len(runtime_conf)
        conf_avg = sum(runtime_conf) / conf_count
        conf_min = min(runtime_conf)
        conf_max = max(runtime_conf)
    else:
        conf_count = 0
        conf_avg = None
        conf_min = None
        conf_max = None

    confidence_breakdown = {}
    total_bucket_count = sum(len(values) for values in bucket_scores.values())
    for bucket, values in bucket_scores.items():
        avg_bucket = (sum(values) / len(values)) if values else None
        confidence_breakdown[bucket] = {
            "count": len(values),
            "share_percent": round((len(values) / total_bucket_count) * 100.0, 1) if total_bucket_count else 0.0,
            "avg": float(avg_bucket) if avg_bucket is not None else None,
            "avg_percent": round(float(avg_bucket) * 100.0, 1) if avg_bucket is not None else None,
        }

    return {
        "avg": float(conf_avg) if conf_avg is not None else None,
        "avg_percent": round(float(conf_avg) * 100.0, 1) if conf_avg is not None else None,
        "min_percent": round(float(conf_min) * 100.0, 1) if conf_min is not None else None,
        "max_percent": round(float(conf_max) * 100.0, 1) if conf_max is not None else None,
        "count": int(conf_count or 0),
        "breakdown": confidence_breakdown,
    }


async def top_entities(
    session: AsyncSession,
    scope_filter_values: dict[str, Any] | None = None,
) -> dict[str, Any]:
    mat_stmt = (
        select(TribologyData.material_name, func.count("*"))
        .join(TribologyData.literature)
        .group_by(TribologyData.material_name)
        .order_by(desc(func.count("*")))
        .where(TribologyData.material_name.is_not(None))
        .where(TribologyData.material_name != "")
        .limit(5)
    )
    if scope_filter_values:
        mat_stmt = mat_stmt.where(*literature_scope_conditions(scope_filter_values))
    mat_res = await _execute_counted(session, mat_stmt, operation="top_entities.materials")

    il_stmt = (
        select(TribologyData.lubricant, func.count("*"))
        .join(TribologyData.literature)
        .group_by(TribologyData.lubricant)
        .order_by(desc(func.count("*")))
        .where(TribologyData.lubricant.is_not(None))
        .where(TribologyData.lubricant != "")
        .where(~func.lower(TribologyData.lubricant).like("%ethaline%"))
        .where(~func.lower(TribologyData.lubricant).like("%chcl%"))
        .limit(5)
    )
    if scope_filter_values:
        il_stmt = il_stmt.where(*literature_scope_conditions(scope_filter_values))
    il_res = await _execute_counted(session, il_stmt, operation="top_entities.liquids")

    return {
        "materials_ratio": [{"name": row[0], "count": row[1]} for row in mat_res.all() if row[0]],
        "top_liquids": [{"name": row[0], "count": row[1]} for row in il_res.all() if row[0]],
    }
