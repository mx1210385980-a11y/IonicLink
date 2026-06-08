"""Integration helpers for storing normalized open-ended extraction fields."""

from __future__ import annotations

import re
from typing import Any, Optional

from services.flexible_field_key_normalizer import KeyNormalizer, rule_clean


RESERVED_FLEXIBLE_FIELDS_KEY = "_flexible_fields"
RESERVED_FLEXIBLE_REVIEW_QUEUE_KEY = "_flexible_field_review_queue"

_FIXED_FIELD_KEYS = {
    "material",
    "material_name",
    "ionic_liquid",
    "lubricant",
    "cof",
    "cof_raw",
    "friction_force",
    "wear_rate",
    "film_thickness",
    "residual_film_thickness_d",
    "layer_spacing_delta",
    "regime",
    "surface_roughness",
    "probe_roughness",
    "substrate_roughness",
    "load",
    "normal_load",
    "speed",
    "shear_rate",
    "temperature",
    "water_content",
    "potential",
    "source",
    "source_page",
    "source_figure",
    "evidence",
    "notes",
    "field_evidence",
    "field_evidence_json",
    "lubricant_components",
    "lubricantcomponents",
    "lubricant_components_json",
    "load_conditions",
    "loadconditions",
    "speed_conditions",
    "speedconditions",
    "tribological_system",
    "tribologicalsystem",
}

_CURRENT_KEYS = {
    "current",
    "applied_current",
    "electric_current",
    "test_current",
    "current_intensity",
    "baseline_current",
    "reference_current",
    "control_current",
    "zero_current",
    "current_density",
    "areal_current",
}

_ADDITIVE_KEYS = {
    "iron_oxide_additive_ratio",
    "fe2o3_loading",
    "iron_oxide_content",
    "ferric_oxide_ratio",
    "fe2o3_mass_fraction",
    "fe3o4_loading",
    "fe3o4_mass_fraction",
    "magnetite_loading",
    "additive_ratio",
    "additive_loading",
    "mass_fraction",
    "additive_concentration",
    "additive_wt",
    "additive_wt_percent",
}

_COF_DELTA_KEYS = {
    "cof_delta",
    "delta_cof",
    "cof_increase",
    "coefficient_of_friction_increase",
    "friction_coefficient_increase",
    "friction_coefficient_change",
    "friction_coefficient_increase_range",
    "increase_range_of_friction_coefficient",
}

_FLEXIBLE_CONTAINER_KEYS = {
    "_flexible_fields",
    "flexible_fields",
    "flexiblefields",
    "extra_fields",
    "extrafields",
    "variables",
}

_UNIT_PATTERNS = [
    r"wt\s*%",
    r"mol\s*%",
    r"vol\s*%",
    r"ppm",
    r"ppb",
    r"mA\s*cm-?2",
    r"A\s*cm-?2",
    r"mA",
    r"A",
]


def _present(value: Any) -> bool:
    if value is None:
        return False
    if isinstance(value, str):
        text = value.strip().lower()
        return bool(text) and text not in {"none", "null", "n/a", "na", "unknown", "not reported", "-"}
    if isinstance(value, (list, dict)):
        return bool(value)
    return True


def _label_for_key(raw_key: str) -> str:
    return str(raw_key or "").replace("_", " ").replace("-", " ").strip().title()


def _unit_from_value(value: Any) -> str | None:
    text = str(value or "")
    for pattern in _UNIT_PATTERNS:
        match = re.search(rf"\b({pattern})\b", text, flags=re.IGNORECASE)
        if match:
            return match.group(1).replace(" ", "")
    return None


def _category_for_cleaned_key(cleaned_key: str) -> str | None:
    if cleaned_key in _CURRENT_KEYS:
        return "condition"
    if cleaned_key in _ADDITIVE_KEYS:
        return "lubricant_component"
    if cleaned_key in _COF_DELTA_KEYS:
        return "derived_metric"
    return None


def _payload_from_scalar(raw_key: str, value: Any, item: dict[str, Any], category: str) -> dict[str, Any]:
    evidence = {
        "quote": item.get("evidence") or item.get("notes"),
        "page": item.get("source_page"),
        "source_label": item.get("source") or item.get("source_figure"),
        "bbox": item.get("evidence_bbox"),
    }
    return {
        "label": _label_for_key(raw_key),
        "value": value,
        "unit": _unit_from_value(value),
        "category": category,
        "evidence": {key: val for key, val in evidence.items() if _present(val)},
    }


def extract_raw_flexible_fields(item: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """Extract known open-ended variables before canonical normalization."""
    raw_fields: dict[str, dict[str, Any]] = {}
    for raw_key, value in (item or {}).items():
        if not _present(value):
            continue
        cleaned_key = rule_clean(raw_key)
        if cleaned_key in _FLEXIBLE_CONTAINER_KEYS and isinstance(value, dict):
            for nested_key, nested_value in value.items():
                if not _present(nested_value):
                    continue
                if isinstance(nested_value, dict):
                    payload = dict(nested_value)
                    payload.setdefault("label", _label_for_key(str(nested_key)))
                    payload.setdefault("category", "other")
                else:
                    payload = _payload_from_scalar(str(nested_key), nested_value, item, "other")
                raw_fields[str(nested_key)] = payload
            continue
        if cleaned_key in _FIXED_FIELD_KEYS:
            continue
        category = _category_for_cleaned_key(cleaned_key)
        if not category:
            continue
        if isinstance(value, dict):
            payload = dict(value)
            payload.setdefault("label", _label_for_key(raw_key))
            payload.setdefault("category", category)
            if "value" not in payload and _present(value.get("raw")):
                payload["value"] = value.get("raw")
        else:
            payload = _payload_from_scalar(raw_key, value, item, category)
        raw_fields[str(raw_key)] = payload
    return raw_fields


def normalize_flexible_fields(
    raw_fields: dict[str, Any],
    normalizer: KeyNormalizer,
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    flexible_payload: dict[str, Any] = {}
    review_queue: list[dict[str, Any]] = []

    for raw_key, payload in (raw_fields or {}).items():
        result = normalizer.normalize(raw_key)
        canonical_key = result.canonical_key

        entry = dict(payload or {})
        entry["_raw_key"] = raw_key
        entry["_norm"] = result.to_dict()

        if canonical_key in flexible_payload:
            existing = flexible_payload[canonical_key]
            if isinstance(existing, list):
                existing.append(entry)
            else:
                flexible_payload[canonical_key] = [existing, entry]
        else:
            flexible_payload[canonical_key] = entry

        if not result.resolved:
            review_queue.append(
                {
                    "raw_key": raw_key,
                    "canonical_key": canonical_key,
                    "stage": result.stage,
                    "suggested_merge": result.suggested_merge,
                    "confidence": result.confidence,
                    "value": entry.get("value"),
                    "unit": entry.get("unit"),
                    "category": entry.get("category"),
                    "evidence": entry.get("evidence"),
                    "notes": result.notes,
                }
            )

    return flexible_payload, review_queue


def merge_into_field_evidence_json(
    field_evidence_json: Optional[dict[str, Any]],
    flexible_payload: dict[str, Any],
    reserved_key: str = RESERVED_FLEXIBLE_FIELDS_KEY,
) -> dict[str, Any]:
    field_evidence = dict(field_evidence_json or {})
    field_evidence[reserved_key] = flexible_payload
    return field_evidence
