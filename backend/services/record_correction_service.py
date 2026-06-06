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
        "probe_material",
        "probe_geometry",
        "probe_radius",
        "probe_roughness",
        "substrate_material",
        "substrate_coating",
        "substrate_roughness",
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
    "probe_material": "probe_material",
    "probe_geometry": "probe_geometry",
    "probe_radius": "probe_radius",
    "probe_roughness": "probe_roughness",
    "substrate_material": "substrate_material",
    "substrate_coating": "substrate_coating",
    "substrate_roughness": "substrate_roughness",
    "temperature": "temperature",
    "potential": "potential",
    "water_content": "water_content",
    "evidence": "evidence",
    "source_page": "source",
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
