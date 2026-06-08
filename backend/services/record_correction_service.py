"""Reviewer-driven curated corrections for tribology records.

This service consolidates what the ad-hoc ``scripts/data-fixes/*.py`` scripts do
with raw SQL: apply corrected field values + curated per-field evidence to a final
``TribologyData`` record, keep its source ``RecordCandidate`` rows in sync (and link
any duplicates), recompute confidence, and report a before/after diff.

A ``dry_run`` mode applies the change in-memory and rolls it back, returning the diff
so a reviewer can preview exactly what would be written before committing — the check
that was missing when extraction mistakes were patched by hand.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Callable, Mapping, Sequence

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from models.db_models import RecordCandidate, TribologyData
from utils.cof_extraction import normalize_cof_extracted
from utils.structured_conditions import normalize_load_conditions

# Scalar columns a reviewer may correct directly. Deliberately excludes identity and
# relationship columns (id, literature_id, extracted_at, source_candidates).
CORRECTABLE_SCALAR_FIELDS: frozenset[str] = frozenset(
    {
        "material_name",
        "lubricant",
        "lubricant_alias",
        "cof_value",
        "cof_operator",
        "cof_raw",
        "load_value",
        "load_raw",
        "speed_value",
        "shear_rate",
        "temperature",
        "potential",
        "water_content",
        "probe_material",
        "probe_geometry",
        "probe_radius",
        "probe_roughness",
        "substrate_material",
        "substrate_coating",
        "substrate_roughness",
        "surface_roughness",
        "residual_film_thickness_d",
        "layer_spacing_delta",
        "film_thickness",
        "regime",
        "mol_ratio",
        "cation",
        "anion",
        "cation_smiles",
        "anion_smiles",
        "il_smiles",
        "il_inchikey",
        "alkyl_chain_length",
        "sample_id",
        "series_id",
        "review_status",
        "record_origin",
        "assembly_notes",
        "evidence",
        "evidence_page",
        "evidence_bbox",
        "source",
        "source_page",
        "source_figure",
        "confidence",
    }
)

# JSON/Text columns whose value may be supplied as a dict/list (serialized here) or a
# pre-serialized string (stored as-is).
CORRECTABLE_JSON_FIELDS: frozenset[str] = frozenset(
    {
        "lubricant_components_json",
        "cof_extracted_json",
        "load_conditions_json",
        "speed_conditions_json",
        "tribological_system_json",
        "field_evidence_json",
    }
)

CORRECTABLE_FIELDS: frozenset[str] = CORRECTABLE_SCALAR_FIELDS | CORRECTABLE_JSON_FIELDS

CANDIDATE_REVIEW_CORRECTABLE_FIELDS: frozenset[str] = frozenset(
    {
        "material_name",
        "lubricant",
        "lubricant_alias",
        "cation",
        "anion",
        "probe_material",
        "probe_geometry",
        "probe_radius",
        "probe_roughness",
        "substrate_material",
        "substrate_coating",
        "substrate_roughness",
        "surface_roughness",
        "temperature",
        "potential",
        "water_content",
        "evidence",
        "source",
        "source_page",
        "source_figure",
    }
)

CANDIDATE_FIELD_EVIDENCE_KEYS: dict[str, str] = {
    "material_name": "material",
    "lubricant": "lubricant",
    "lubricant_alias": "lubricant",
    "cation": "cation",
    "anion": "anion",
    "probe_material": "probe_material",
    "probe_geometry": "probe_geometry",
    "probe_radius": "probe_radius",
    "probe_roughness": "probe_roughness",
    "substrate_material": "substrate_material",
    "substrate_coating": "substrate_coating",
    "substrate_roughness": "substrate_roughness",
    "surface_roughness": "surface_roughness",
    "temperature": "temperature",
    "potential": "potential",
    "water_content": "water_content",
    "evidence": "evidence",
    "source_page": "source",
}

STRICT_CORE_SCHEMA_FIELDS: tuple[dict[str, str], ...] = (
    {"key": "cation", "label": "Cation"},
    {"key": "anion", "label": "Anion"},
    {"key": "substrate_material", "label": "Substrate"},
    {"key": "temperature", "label": "Temperature"},
    {"key": "load", "label": "Load"},
    {"key": "cof", "label": "COF"},
)

DEFAULT_EXTENDED_SCHEMA_FIELDS: tuple[dict[str, str], ...] = (
    {"key": "material_name", "label": "Paper / system"},
    {"key": "lubricant", "label": "Ionic liquid label"},
    {"key": "speed", "label": "Speed"},
    {"key": "additive", "label": "Additive"},
    {"key": "surface_roughness", "label": "Roughness"},
    {"key": "test_duration", "label": "Test duration"},
    {"key": "tribological_system", "label": "Method"},
    {"key": "potential", "label": "Potential"},
)

_EMPTY_SCHEMA_VALUES = {
    "",
    "-",
    "--",
    "n/a",
    "na",
    "none",
    "null",
    "not specified",
    "not stated",
    "not reported",
    "not provided",
    "not given",
    "unspecified",
    "unknown",
    "review required",
}


@dataclass
class RecordCorrection:
    """A reviewer's curated correction to a single tribology record."""

    # Column name -> corrected value. JSON columns accept dict/list or string.
    fields: Mapping[str, Any] = field(default_factory=dict)
    # Per-field evidence entries merged into ``field_evidence_json`` (curated quotes,
    # page numbers, confidence, grounding notes). Merge, not replace.
    field_evidence_patch: Mapping[str, Any] | None = None
    # Extra candidate ids (e.g. duplicates) to link to this record and sync.
    link_candidate_ids: Sequence[int] = ()


@dataclass
class CorrectionResult:
    record_id: int
    committed: bool
    record_diff: dict[str, dict[str, Any]]
    candidate_ids: list[int]
    confidence: float | None


@dataclass
class CandidateCorrectionResult:
    candidate_id: int
    committed: bool
    field_diff: dict[str, dict[str, Any]]


def _serialize_json_value(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, str):
        return value
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def _merge_field_evidence(existing_json: str | None, patch: Mapping[str, Any]) -> str:
    try:
        current = json.loads(existing_json or "{}")
    except (TypeError, ValueError):
        current = {}
    if not isinstance(current, dict):
        current = {}
    current.update(patch)
    return json.dumps(current, ensure_ascii=False, separators=(",", ":"))


def _parse_field_evidence_json(existing_json: Any) -> dict[str, Any]:
    if isinstance(existing_json, dict):
        return dict(existing_json)
    try:
        parsed = json.loads(existing_json or "{}")
    except (TypeError, ValueError):
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _candidate_review_status_from_field_map(field_map: Mapping[str, Any]) -> str:
    for entry in field_map.values():
        if isinstance(entry, Mapping) and str(entry.get("review_state") or "").strip().lower() == "flagged":
            return "flagged"
    return "needs_review"


def _schema_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value).strip()


def _schema_has_value(value: Any) -> bool:
    text = _schema_text(value)
    return bool(text and text.lower() not in _EMPTY_SCHEMA_VALUES)


def _json_value(value: Any) -> Any:
    if value in (None, ""):
        return None
    if isinstance(value, (dict, list)):
        return value
    try:
        return json.loads(value)
    except (TypeError, ValueError):
        return None


def _raw_flexible_json_from_record(record: TribologyData | RecordCandidate) -> dict[str, Any]:
    field_map = _parse_field_evidence_json(getattr(record, "field_evidence_json", None))
    schema_layers = field_map.get("_schema_layers")
    if not isinstance(schema_layers, Mapping):
        return {}
    raw_flexible_json = schema_layers.get("raw_flexible_json")
    return dict(raw_flexible_json) if isinstance(raw_flexible_json, Mapping) else {}


def _field_evidence_entry_from_record(record: TribologyData | RecordCandidate, *keys: str) -> Any:
    field_map = _parse_field_evidence_json(getattr(record, "field_evidence_json", None))
    raw_flexible_json = _raw_flexible_json_from_record(record)
    for key in keys:
        entry = raw_flexible_json.get(key)
        if _schema_has_value(entry):
            return entry
        entry = field_map.get(key)
        if isinstance(entry, Mapping):
            for value_key in ("value", "raw_text", "text", "reported_value"):
                value = entry.get(value_key)
                if _schema_has_value(value):
                    return value
        elif _schema_has_value(entry):
            return entry
    return None


def _additive_value_from_record(record: TribologyData | RecordCandidate) -> str | None:
    components = _json_value(getattr(record, "lubricant_components_json", None))
    if isinstance(components, Mapping):
        components = [components]
    additive_parts: list[str] = []
    if isinstance(components, list):
        for component in components:
            if not isinstance(component, Mapping):
                continue
            role = str(component.get("role") or "").strip().lower()
            if "additive" not in role:
                continue
            compound = _schema_text(component.get("compound") or component.get("name") or component.get("label"))
            fraction = _schema_text(component.get("fraction") or component.get("value"))
            unit = _schema_text(component.get("unit"))
            amount = f"{fraction} {unit}".strip()
            additive_parts.append(" ".join(part for part in (compound, amount) if part).strip())
    if additive_parts:
        return "; ".join(part for part in additive_parts if part)
    fallback = _field_evidence_entry_from_record(
        record,
        "additive",
        "additive_loading",
        "additive_concentration",
    )
    return _schema_text(fallback) if _schema_has_value(fallback) else None


def _structured_load_schema_value(value: Any) -> str | None:
    load = normalize_load_conditions(value)
    if not load:
        return None
    raw_text = _schema_text(load.get("raw_text"))
    if _schema_has_value(raw_text):
        return raw_text
    load_min = load.get("load_min_N")
    load_max = load.get("load_max_N")
    if load_min is not None and load_max is not None:
        return str(load_min) if load_min == load_max else f"{load_min}-{load_max} N"
    for key in ("system_total_load_N", "contact_load_per_unit_N"):
        if load.get(key) is not None:
            return f"{load[key]} N"
    return None


def _structured_cof_schema_value(value: Any) -> str | None:
    cof = normalize_cof_extracted(value)
    if not cof:
        return None
    raw_text = _schema_text(cof.get("raw_text"))
    if _schema_has_value(raw_text):
        return raw_text
    for key in ("cof_average", "cof_min", "cof_max"):
        if cof.get(key) is not None:
            return str(cof[key])
    for segment in cof.get("segments") or []:
        segment_value = _structured_cof_schema_value(segment)
        if segment_value:
            return segment_value
    return None


def _schema_value_from_record(record: TribologyData | RecordCandidate, key: str) -> Any:
    if key == "load":
        return (
            getattr(record, "load_raw", None)
            or getattr(record, "load_value", None)
            or _structured_load_schema_value(getattr(record, "load_conditions_json", None))
        )
    if key == "cof":
        return (
            getattr(record, "cof_raw", None)
            or getattr(record, "cof_value", None)
            or _structured_cof_schema_value(getattr(record, "cof_extracted_json", None))
        )
    if key == "speed":
        return getattr(record, "speed_value", None) or getattr(record, "shear_rate", None)
    if key == "surface_roughness":
        return (
            getattr(record, "surface_roughness", None)
            or getattr(record, "substrate_roughness", None)
            or getattr(record, "probe_roughness", None)
        )
    if key == "additive":
        return _additive_value_from_record(record)
    if key == "test_duration":
        return _field_evidence_entry_from_record(record, "test_duration", "duration", "test_time")
    if key == "tribological_system":
        return (
            getattr(record, "tribological_system_json", None)
            or getattr(record, "regime", None)
            or getattr(record, "probe_geometry", None)
        )
    if key == "source_location":
        return (
            getattr(record, "source_figure", None)
            or getattr(record, "source", None)
            or (f"Page {getattr(record, 'source_page', None)}" if getattr(record, "source_page", None) else None)
        )
    return getattr(record, key, None)


def _existing_schema_fields(schema_layers: Mapping[str, Any], key: str) -> list[dict[str, Any]]:
    fields = schema_layers.get(key)
    if not isinstance(fields, list):
        return []
    return [dict(field) for field in fields if isinstance(field, Mapping)]


def _refresh_schema_field(
    record: TribologyData | RecordCandidate,
    *,
    definition: Mapping[str, str],
    existing: Mapping[str, Any] | None = None,
    layer: str,
) -> dict[str, Any]:
    key = str(definition.get("key") or existing.get("key") if existing else definition.get("key") or "").strip()
    current_value = _schema_value_from_record(record, key)
    has_current = _schema_has_value(current_value)
    return {
        "key": key,
        "label": str((existing or {}).get("label") or definition.get("label") or key).strip(),
        "layer": layer,
        "status": "ready" if has_current else "review",
        "value": _schema_text(current_value) if has_current else "",
        "note": str((existing or {}).get("note") or definition.get("note") or "").strip(),
    }


def _core_schema_summary(core_fields: list[dict[str, Any]]) -> dict[str, Any]:
    missing_fields = [
        field
        for field in core_fields
        if str(field.get("status") or "").strip().lower() != "ready"
    ]
    return {
        "total": len(core_fields),
        "ready": len(core_fields) - len(missing_fields),
        "missing_keys": [str(field.get("key") or "").strip() for field in missing_fields],
        "missing_labels": [str(field.get("label") or field.get("key") or "").strip() for field in missing_fields],
        "can_promote": not missing_fields,
    }


def refresh_tribology_schema_layers(
    field_map: dict[str, Any],
    record: TribologyData | RecordCandidate,
) -> dict[str, Any]:
    schema_layers = field_map.get("_schema_layers")
    if not isinstance(schema_layers, Mapping):
        schema_layers = {}

    existing_core = {
        str(field.get("key") or "").strip(): field
        for field in _existing_schema_fields(schema_layers, "core_fields")
    }
    existing_extended = {
        str(field.get("key") or "").strip(): field
        for field in _existing_schema_fields(schema_layers, "extended_fields")
    }

    core_fields = [
        _refresh_schema_field(
            record,
            definition=definition,
            existing=existing_core.get(definition["key"]),
            layer="core",
        )
        for definition in STRICT_CORE_SCHEMA_FIELDS
    ]

    extended_definitions = list(DEFAULT_EXTENDED_SCHEMA_FIELDS)
    known_extended_keys = {definition["key"] for definition in extended_definitions}
    for key, field in existing_extended.items():
        if key and key not in known_extended_keys:
            extended_definitions.append({"key": key, "label": str(field.get("label") or key)})
    extended_fields = [
        _refresh_schema_field(
            record,
            definition=definition,
            existing=existing_extended.get(definition["key"]),
            layer="extended",
        )
        for definition in extended_definitions
    ]

    raw_flexible_json = schema_layers.get("raw_flexible_json")
    if not isinstance(raw_flexible_json, Mapping):
        raw_flexible_json = {}
    record_raw_flexible_json = _raw_flexible_json_from_record(record)

    refreshed = dict(schema_layers)
    refreshed["core_fields"] = core_fields
    refreshed["core_summary"] = _core_schema_summary(core_fields)
    refreshed["extended_fields"] = extended_fields
    refreshed["raw_flexible_json"] = {**record_raw_flexible_json, **dict(raw_flexible_json)}
    field_map["_schema_layers"] = refreshed
    return field_map


def _validate_correction(correction: RecordCorrection) -> None:
    unknown = set(correction.fields) - CORRECTABLE_FIELDS
    if unknown:
        raise ValueError(
            f"Unknown or non-correctable field(s): {', '.join(sorted(unknown))}"
        )


def _validate_candidate_correction(fields: Mapping[str, Any]) -> None:
    unknown = set(fields) - CANDIDATE_REVIEW_CORRECTABLE_FIELDS
    if unknown:
        raise ValueError(
            f"Unknown or non-correctable candidate field(s): {', '.join(sorted(unknown))}"
        )


def _resolved_field_values(correction: RecordCorrection) -> dict[str, Any]:
    """Flatten the correction into {column_name: stored_value}, serializing JSON cols."""
    resolved: dict[str, Any] = {}
    for key, value in correction.fields.items():
        if key in CORRECTABLE_JSON_FIELDS:
            resolved[key] = _serialize_json_value(value)
        else:
            resolved[key] = value
    return resolved


def _apply_values(target: TribologyData | RecordCandidate, values: Mapping[str, Any]) -> dict[str, dict[str, Any]]:
    """Apply values to an ORM object, returning a {field: {before, after}} diff for changes."""
    diff: dict[str, dict[str, Any]] = {}
    for key, new_value in values.items():
        if not hasattr(target, key):
            continue
        old_value = getattr(target, key)
        if old_value != new_value:
            diff[key] = {"before": old_value, "after": new_value}
        setattr(target, key, new_value)
    return diff


async def apply_tribology_record_correction(
    db: AsyncSession,
    record_id: int,
    correction: RecordCorrection,
    *,
    dry_run: bool = False,
    confidence_fn: Callable[[TribologyData], float] | None = None,
    now: datetime | None = None,
) -> CorrectionResult:
    """Apply a curated correction to a tribology record and its linked candidates.

    Args:
        db: Active async session.
        record_id: The ``TribologyData`` id to correct.
        correction: The curated field corrections.
        dry_run: When True, apply in-memory then roll back; nothing is persisted.
        confidence_fn: Optional callable that recomputes confidence from the mutated
            record (the router passes its existing confidence calculator). When omitted
            confidence is left untouched unless the correction sets it explicitly.
        now: Timestamp for ``promoted_at`` on newly linked candidates (testable).

    Returns:
        CorrectionResult with the record diff, affected candidate ids, and new confidence.

    Raises:
        ValueError: If the record is missing or a correction targets a non-correctable field.
    """
    _validate_correction(correction)

    record = await db.get(TribologyData, record_id)
    if record is None:
        raise ValueError(f"Tribology record {record_id} not found")

    # Resolve the candidates to keep in sync by querying on the FK directly rather than
    # the ORM relationship — the relationship can lazy-load (and raise MissingGreenlet)
    # when the record is already in the session's identity map without it eager-loaded.
    candidate_ids_to_load = {
        cid for cid in correction.link_candidate_ids if cid is not None
    }
    conditions = [RecordCandidate.promoted_record_id == record_id]
    if candidate_ids_to_load:
        conditions.append(RecordCandidate.id.in_(candidate_ids_to_load))
    result = await db.execute(select(RecordCandidate).where(or_(*conditions)))
    candidates: dict[int, RecordCandidate] = {c.id: c for c in result.scalars()}

    values = _resolved_field_values(correction)
    if correction.field_evidence_patch:
        values["field_evidence_json"] = _merge_field_evidence(
            record.field_evidence_json, correction.field_evidence_patch
        )

    # Apply everything inside a savepoint so a dry-run rolls back only this correction,
    # leaving any other pending session work intact.
    savepoint = await db.begin_nested()

    record_diff = _apply_values(record, values)

    stamp = now or datetime.utcnow()
    for candidate in candidates.values():
        _apply_values(candidate, values)
        if candidate.promoted_record_id != record.id:
            candidate.promoted_record_id = record.id
        if candidate.promoted_at is None:
            candidate.promoted_at = stamp

    confidence: float | None = record.confidence
    if confidence_fn is not None and "confidence" not in values:
        confidence = float(confidence_fn(record))
        if record.confidence != confidence:
            record_diff["confidence"] = {"before": record.confidence, "after": confidence}
        record.confidence = confidence
        for candidate in candidates.values():
            candidate.confidence = confidence

    candidate_ids = sorted(candidates.keys())

    if dry_run:
        await savepoint.rollback()
        return CorrectionResult(
            record_id=record_id,
            committed=False,
            record_diff=record_diff,
            candidate_ids=candidate_ids,
            confidence=confidence,
        )

    await savepoint.commit()
    await db.commit()
    return CorrectionResult(
        record_id=record_id,
        committed=True,
        record_diff=record_diff,
        candidate_ids=candidate_ids,
        confidence=confidence,
    )


async def apply_tribology_candidate_correction(
    db: AsyncSession,
    candidate_id: int,
    fields: Mapping[str, Any],
    *,
    dry_run: bool = False,
) -> CandidateCorrectionResult:
    """Apply a narrow reviewer correction to an unpromoted tribology candidate."""
    _validate_candidate_correction(fields)

    candidate = await db.get(RecordCandidate, candidate_id)
    if candidate is None:
        raise ValueError(f"Tribology candidate {candidate_id} not found")

    savepoint = await db.begin_nested()
    field_diff = _apply_values(candidate, fields)

    field_map = _parse_field_evidence_json(candidate.field_evidence_json)
    for column, value in fields.items():
        evidence_key = CANDIDATE_FIELD_EVIDENCE_KEYS.get(column)
        if not evidence_key:
            continue
        entry = field_map.get(evidence_key)
        if not isinstance(entry, dict):
            entry = {}
        entry["value"] = value
        entry["review_state"] = None
        entry["review_note"] = None
        field_map[evidence_key] = entry

    field_map = refresh_tribology_schema_layers(field_map, candidate)
    candidate.field_evidence_json = json.dumps(field_map, ensure_ascii=False, separators=(",", ":"))
    candidate.review_status = _candidate_review_status_from_field_map(field_map)

    if dry_run:
        await savepoint.rollback()
        return CandidateCorrectionResult(
            candidate_id=candidate_id,
            committed=False,
            field_diff=field_diff,
        )

    await savepoint.commit()
    await db.commit()
    return CandidateCorrectionResult(
        candidate_id=candidate_id,
        committed=True,
        field_diff=field_diff,
    )
