"""Shared semantic identity and evidence-quality helpers for tribology records."""

from __future__ import annotations

import hashlib
import re
from typing import Any


_EMPTY_VALUES = {
    "",
    "-",
    "--",
    "n/a",
    "na",
    "none",
    "null",
    "not specified",
    "unspecified",
    "unknown",
    "probe n/a",
    "substrate n/a",
}

_PRIMARY_METRIC_GROUPS: tuple[tuple[str, ...], ...] = (
    ("cof", "cof_raw", "cof_value", "cof_extracted"),
    ("friction_force",),
    ("wear_rate",),
    ("film_thickness",),
    ("residual_film_thickness_d",),
    ("layer_spacing_delta",),
    ("surface_roughness",),
)

_REQUIRED_GROUPS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("material", ("material", "material_name", "probe_material", "substrate_material")),
    ("ionic_liquid", ("ionic_liquid", "lubricant")),
)


def _get(row: Any, key: str, default: Any = None) -> Any:
    if isinstance(row, dict):
        return row.get(key, default)
    return getattr(row, key, default)


def _has_value(value: Any) -> bool:
    return value not in (None, "", [])


def _normalize_text(value: Any) -> str:
    text = re.sub(r"\s+", " ", str(value or "").strip()).lower()
    if text in _EMPTY_VALUES:
        return ""
    return re.sub(r"[^a-z0-9.+-]+", "", text)


def _normalize_number(value: Any) -> str:
    if value in (None, ""):
        return ""
    match = re.search(r"-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?", str(value))
    if not match:
        return _normalize_text(value)
    try:
        return f"{float(match.group(0)):.8g}"
    except Exception:
        return _normalize_text(value)


def _source_figure_identity(row: dict[str, Any]) -> str:
    explicit = row.get("source_figure") or row.get("sourceFigure") or row.get("source_label") or row.get("sourceLabel")
    if explicit:
        return _normalize_text(explicit)

    field_map = row.get("field_evidence_json") or row.get("fieldEvidenceJson") or {}
    if not isinstance(field_map, dict):
        return ""

    labels: list[str] = []
    for entry in field_map.values():
        if not isinstance(entry, dict):
            continue
        evidence = entry.get("evidence")
        if not isinstance(evidence, dict):
            continue
        label = evidence.get("source_label") or evidence.get("sourceLabel")
        if label:
            labels.append(_normalize_text(label))
    return "|".join(sorted({label for label in labels if label}))


def tribology_payload_dedupe_key(row: dict[str, Any]) -> tuple[str, ...]:
    cof_extracted = row.get("cof_extracted") if isinstance(row.get("cof_extracted"), dict) else {}
    return (
        _normalize_text(row.get("material_name")),
        _normalize_text(
            row.get("ionic_liquid_display")
            or row.get("ionic_liquid")
            or row.get("lubricant_alias")
            or row.get("lubricant")
            or row.get("system_name")
        ),
        _normalize_text(row.get("probe_material")),
        _normalize_text(row.get("substrate_material")),
        _normalize_number(
            row.get("cof")
            or row.get("cof_raw")
            or row.get("cof_value")
            or cof_extracted.get("cof_average")
            or cof_extracted.get("cof_min")
            or cof_extracted.get("cof_max")
        ),
        _normalize_text(row.get("temperature")),
        _normalize_text(row.get("load") or row.get("normal_load") or row.get("load_raw") or row.get("load_value")),
        _normalize_text(row.get("speed") or row.get("speed_value")),
        _normalize_text(row.get("potential")),
        _normalize_text(row.get("water_content")),
        _source_figure_identity(row),
        _normalize_text(row.get("sample_id")),
        _normalize_text(row.get("series_id")),
    )


def tribology_semantic_key(row: dict[str, Any]) -> str:
    raw = "|".join(tribology_payload_dedupe_key(row))
    digest = hashlib.sha1(raw.encode("utf-8")).hexdigest()[:16]
    return f"tribology:{digest}"


def field_grounding_status(entry: dict[str, Any] | None) -> str:
    if str((entry or {}).get("grounding_mode") or "").strip().lower() == "inferred" and _has_value((entry or {}).get("value")):
        return "grounded"
    evidence = (entry or {}).get("evidence") or {}
    bbox = evidence.get("bbox")
    has_page = evidence.get("page") not in (None, "", [])
    has_text_source = any(
        str(evidence.get(key) or "").strip()
        for key in ("quote", "matched_text", "matchedText")
    )
    if has_page and isinstance(bbox, list) and len(bbox) >= 4:
        return "grounded"
    if has_page and has_text_source:
        return "grounded"
    if any(evidence.get(key) not in (None, "", []) for key in ("page", "source_label", "quote", "sample_id", "source_type")):
        return "partial"
    return "missing"


def field_evidence_score(entry: dict[str, Any] | None) -> float:
    if not isinstance(entry, dict) or not _has_value(entry.get("value")):
        return 0.0
    if str(entry.get("review_state") or "").strip().lower() == "flagged":
        return 0.0
    if str(entry.get("grounding_mode") or "").strip().lower() == "inferred":
        return 0.7

    evidence = entry.get("evidence") or {}
    bbox = evidence.get("bbox")
    has_bbox = isinstance(bbox, list) and len(bbox) >= 4
    has_page = evidence.get("page") not in (None, "", [])
    has_text_source = any(
        str(evidence.get(key) or "").strip()
        for key in ("quote", "matched_text", "matchedText")
    )
    has_labeled_source = any(
        str(evidence.get(key) or "").strip()
        for key in ("source_label", "source_type", "sample_id")
    )
    if has_page and has_bbox and has_text_source:
        return 1.0
    if has_page and has_bbox:
        return 0.9
    if has_page and has_text_source:
        return 0.8
    if has_text_source and has_labeled_source:
        return 0.7
    if has_text_source:
        return 0.55
    if any(evidence.get(key) not in (None, "", []) for key in ("page", "source_label", "sample_id", "source_type")):
        return 0.45
    return 0.15


def _field_map(row: dict[str, Any]) -> dict[str, Any]:
    value = row.get("field_evidence_json") or row.get("fieldEvidenceJson") or {}
    return value if isinstance(value, dict) else {}


def _cof_metric_value(row: dict[str, Any]) -> Any:
    cof_extracted = row.get("cof_extracted") if isinstance(row.get("cof_extracted"), dict) else {}
    return (
        row.get("cof")
        or row.get("cof_raw")
        or row.get("cof_value")
        or cof_extracted.get("cof_average")
        or cof_extracted.get("cof_min")
        or cof_extracted.get("cof_max")
    )


def _row_value_for_key(row: dict[str, Any], key: str) -> Any:
    if key == "material":
        return row.get("material") or row.get("material_name")
    if key == "ionic_liquid":
        return row.get("ionic_liquid") or row.get("lubricant")
    if key == "cof":
        return _cof_metric_value(row)
    return row.get(key)


def _best_group_entry(row: dict[str, Any], keys: tuple[str, ...]) -> tuple[str, dict[str, Any]]:
    field_map = _field_map(row)
    best_key = keys[0]
    best_entry: dict[str, Any] = {}
    best_score = -1.0
    for key in keys:
        raw_entry = field_map.get(key)
        if isinstance(raw_entry, dict):
            entry = raw_entry
        else:
            value = _row_value_for_key(row, key)
            entry = {"value": value} if _has_value(value) else {}
        score = field_evidence_score(entry)
        if score > best_score:
            best_key = key
            best_entry = entry
            best_score = score
    return best_key, best_entry


def _required_quality_groups(row: dict[str, Any]) -> list[tuple[str, tuple[str, ...]]]:
    groups = list(_REQUIRED_GROUPS)
    field_map = _field_map(row)
    for metric_keys in _PRIMARY_METRIC_GROUPS:
        if any(_has_value((field_map.get(key) or {}).get("value")) for key in metric_keys if isinstance(field_map.get(key), dict)):
            groups.append((metric_keys[0], metric_keys))
            break
        if any(_has_value(_row_value_for_key(row, key)) for key in metric_keys):
            groups.append((metric_keys[0], metric_keys))
            break
    return groups


def evidence_quality_summary(row: dict[str, Any]) -> dict[str, Any]:
    groups = _required_quality_groups(row)
    required_fields: list[str] = []
    grounded_required: list[str] = []
    partial_required: list[str] = []
    missing_required: list[str] = []
    scores: list[float] = []

    for label, keys in groups:
        key, entry = _best_group_entry(row, keys)
        score = field_evidence_score(entry)
        required_fields.append(key or label)
        scores.append(score)
        if score >= 0.65:
            grounded_required.append(key or label)
        elif score > 0:
            partial_required.append(key or label)
        else:
            missing_required.append(key or label)

    score = round(sum(scores) / len(scores), 3) if scores else 0.0
    if score >= 0.85:
        grade = "strong"
    elif score >= 0.65:
        grade = "adequate"
    elif score > 0:
        grade = "weak"
    else:
        grade = "missing"

    return {
        "score": score,
        "grade": grade,
        "required_fields": required_fields,
        "grounded_required": grounded_required,
        "partial_required": partial_required,
        "missing_required": missing_required,
    }


def annotate_tribology_payload_quality(row: dict[str, Any]) -> dict[str, Any]:
    annotated = dict(row)
    summary = evidence_quality_summary(annotated)
    semantic_key = tribology_semantic_key(annotated)
    annotated["semantic_key"] = semantic_key
    annotated["semanticKey"] = semantic_key
    annotated["evidence_score"] = summary["score"]
    annotated["evidenceScore"] = summary["score"]
    annotated["evidence_grade"] = summary["grade"]
    annotated["evidenceGrade"] = summary["grade"]
    annotated["evidence_summary"] = summary
    annotated["evidenceSummary"] = summary
    return annotated


def deduplicate_tribology_payloads(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    deduped: list[dict[str, Any]] = []
    positions: dict[tuple[str, ...], int] = {}
    for row in rows:
        if not isinstance(row, dict):
            continue
        annotated = annotate_tribology_payload_quality(row)
        key = tribology_payload_dedupe_key(annotated)
        existing_index = positions.get(key)
        if existing_index is None:
            positions[key] = len(deduped)
            deduped.append(annotated)
            continue
        if float(annotated.get("evidence_score") or 0) > float(deduped[existing_index].get("evidence_score") or 0):
            deduped[existing_index] = annotated
    return deduped
