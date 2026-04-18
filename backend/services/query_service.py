from __future__ import annotations

import logging
import re
from typing import Any, Optional

from sqlalchemy import and_, desc, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from models.db_models import Literature, TribologyData
from security import literature_scope_conditions
from services.file_service import _normalize_record_chemistry
from services.il_resolver_service import resolve_il
from services.score_service import calculate_confidence, calculate_confidence_details
from services.unit_converter import parse_force_range_to_newtons, parse_force_to_newtons
from services.usage_metrics_service import get_usage_metrics_service
from knowledge_base import normalize_ionic_liquid
from utils.tribopair import compose_tribopair_label

logger = logging.getLogger(__name__)


async def _execute_counted(session: AsyncSession, stmt: Any, *, operation: str):
    get_usage_metrics_service().record_db_query(operation=operation)
    return await session.execute(stmt)


def _build_conditions(filter_params: Any):
    conditions = []
    if getattr(filter_params, "materials", None):
        terms = [term for term in getattr(filter_params, "materials", None) or [] if str(term or "").strip()]
        if terms:
            conditions.append(
                or_(
                    TribologyData.probe_material.in_(terms),
                    TribologyData.substrate_material.in_(terms),
                    TribologyData.substrate_coating.in_(terms),
                    TribologyData.material_name.in_(terms),
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
            conditions.append(TribologyData.lubricant.in_(sorted(lubricant_terms)))
    if getattr(filter_params, "cof_min", None) is not None:
        conditions.append(TribologyData.cof_value >= filter_params.cof_min)
    if getattr(filter_params, "cof_max", None) is not None:
        conditions.append(TribologyData.cof_value <= filter_params.cof_max)
    if getattr(filter_params, "doi", None):
        conditions.append(Literature.doi == filter_params.doi)
    if getattr(filter_params, "file_id", None):
        try:
            conditions.append(TribologyData.literature_id == int(filter_params.file_id))
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
        "cof_value": record.cof_value,
        "cof_raw": record.cof_raw,
        "cof_operator": record.cof_operator,
        "load_value": record.load_value,
        "speed_value": record.speed_value,
        "temperature": record.temperature,
        "potential": record.potential,
        "water_content": record.water_content,
        "probe_roughness": record.probe_roughness,
        "substrate_roughness": record.substrate_roughness,
        "surface_roughness": record.surface_roughness,
        "film_thickness": record.film_thickness,
        "evidence": getattr(record, "evidence", None),
        "evidence_page": getattr(record, "evidence_page", None),
        "source": getattr(record, "source", None),
        "source_page": getattr(record, "source_page", None),
        "source_figure": getattr(record, "source_figure", None),
        "evidence_bbox": getattr(record, "evidence_bbox", None),
        "value_origin": getattr(record, "value_origin", None),
    }


def effective_confidence_details(record: TribologyData) -> dict[str, Any]:
    runtime_details = calculate_confidence_details(build_confidence_input(record))
    runtime_confidence = float(runtime_details.get("score") or 0.0)
    stored_confidence = float(getattr(record, "confidence", 0.0) or 0.0)
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


def _record_to_payload(record: TribologyData) -> dict[str, Any]:
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
    payload = {
        "id": record.id,
        "material_name": record.material_name,
        "lubricant": record.lubricant,
        "cof_value": record.cof_value,
        "cof_operator": record.cof_operator,
        "cof_raw": record.cof_raw,
        "load_value": record.load_value,
        "load_raw": record.load_raw,
        "speed_value": record.speed_value,
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
        "surface_roughness": record.surface_roughness,
        "residual_film_thickness_d": record.residual_film_thickness_d,
        "layer_spacing_delta": record.layer_spacing_delta,
        "film_thickness": record.film_thickness,
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
        "confidence": float(runtime_details.get("score") or 0.0),
        "confidence_details": runtime_details,
        "literature_id": record.literature_id,
        "literature": literature_payload,
    }
    _normalize_record_chemistry([payload])
    return payload


async def search_records(
    session: AsyncSession,
    filter_params: Any,
    *,
    skip: int = 0,
    limit: int = 20,
    scope_filter_values: dict[str, Any] | None = None,
) -> dict[str, Any]:
    logger.debug("Executing record search skip=%s limit=%s scope=%s", skip, limit, scope_filter_values)
    conditions = _build_conditions(filter_params)
    scope_conditions = literature_scope_conditions(scope_filter_values) if scope_filter_values else []
    use_load_filter = (
        getattr(filter_params, "load_min", None) is not None
        or getattr(filter_params, "load_max", None) is not None
    )

    if use_load_filter:
        stmt = (
            select(TribologyData)
            .join(TribologyData.literature)
            .options(selectinload(TribologyData.literature))
        )
        if scope_conditions:
            stmt = stmt.where(*scope_conditions)
        if conditions:
            stmt = stmt.where(and_(*conditions))
        stmt = stmt.order_by(TribologyData.id)

        result = await _execute_counted(session, stmt, operation="search_records.load_filtered")
        all_records = result.scalars().all()

        filtered_records = []
        for record in all_records:
            if not _load_matches_filter(
                record.load_value or record.load_raw,
                getattr(filter_params, "load_min", None),
                getattr(filter_params, "load_max", None),
            ):
                continue
            filtered_records.append(record)

        total = len(filtered_records)
        records = filtered_records[skip : skip + limit]
    else:
        count_stmt = select(func.count(TribologyData.id)).join(TribologyData.literature)
        if scope_conditions:
            count_stmt = count_stmt.where(*scope_conditions)
        if conditions:
            count_stmt = count_stmt.where(and_(*conditions))
        total_result = await _execute_counted(session, count_stmt, operation="search_records.count")
        total = total_result.scalar() or 0

        stmt = (
            select(TribologyData)
            .join(TribologyData.literature)
            .options(selectinload(TribologyData.literature))
        )
        if scope_conditions:
            stmt = stmt.where(*scope_conditions)
        if conditions:
            stmt = stmt.where(and_(*conditions))
        stmt = stmt.order_by(TribologyData.id).offset(skip).limit(limit)

        result = await _execute_counted(session, stmt, operation="search_records.page")
        records = result.scalars().all()

    return {
        "total": total,
        "skip": skip,
        "limit": limit,
        "items": [_record_to_payload(record) for record in records],
    }


async def get_filter_options(
    session: AsyncSession,
    scope_filter_values: dict[str, Any] | None = None,
) -> dict[str, list[str]]:
    logger.debug("Loading record filter options scope=%s", scope_filter_values)
    lubricants_stmt = select(TribologyData.lubricant).distinct()
    option_fields = [
        ("filter_options.materials.probe", TribologyData.probe_material),
        ("filter_options.materials.substrate", TribologyData.substrate_material),
        ("filter_options.materials.coating", TribologyData.substrate_coating),
        ("filter_options.materials.legacy", TribologyData.material_name),
        ("filter_options.conditions.speed", TribologyData.speed_value),
        ("filter_options.conditions.temperature", TribologyData.temperature),
        ("filter_options.conditions.potential", TribologyData.potential),
        ("filter_options.conditions.water_content", TribologyData.water_content),
    ]
    option_values: dict[str, set[str]] = {
        "materials": set(),
        "probeMaterials": set(),
        "substrateMaterials": set(),
        "substrateCoatings": set(),
        "speedValues": set(),
        "temperatureValues": set(),
        "potentialValues": set(),
        "waterContentValues": set(),
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
        if column is TribologyData.probe_material:
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
        "probeMaterials": sorted(option_values["probeMaterials"]),
        "substrateMaterials": sorted(option_values["substrateMaterials"]),
        "substrateCoatings": sorted(option_values["substrateCoatings"]),
        "speedValues": sorted(option_values["speedValues"]),
        "temperatureValues": sorted(option_values["temperatureValues"]),
        "potentialValues": sorted(option_values["potentialValues"]),
        "waterContentValues": sorted(option_values["waterContentValues"]),
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
        score = max(
            float(getattr(record, "confidence", 0.0) or 0.0),
            calculate_confidence(build_confidence_input(record)),
        )
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
