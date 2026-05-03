from __future__ import annotations

import json
import math
import re
from typing import Any


LOAD_VALUE_TYPES = {"single", "range", "composite", "unstated"}
FRICTION_REGIMES = {"static", "kinetic", "boundary", "mixed", "hydrodynamic", "elastohydrodynamic", "unstated"}

FORCE_UNITS_TO_N = {
    "kn": 1e3,
    "n": 1.0,
    "mn": 1e-3,
    "un": 1e-6,
    "µn": 1e-6,
    "μn": 1e-6,
    "nn": 1e-9,
    "pn": 1e-12,
}


def _as_float(value: Any) -> float | None:
    if value in (None, ""):
        return None
    try:
        parsed = float(str(value).strip())
    except (TypeError, ValueError):
        return None
    return parsed if math.isfinite(parsed) else None


def _round(value: float | None) -> float | None:
    if value is None:
        return None
    return round(float(value), 12)


def _clean_text(value: Any) -> str:
    return str(value or "").strip()


def _force_to_newtons(value: Any, unit: Any) -> float | None:
    numeric = _as_float(value)
    if numeric is None:
        return None
    unit_key = str(unit or "").strip().replace("μ", "µ").lower()
    multiplier = FORCE_UNITS_TO_N.get(unit_key)
    if multiplier is None:
        return None
    return _round(numeric * multiplier)


def _force_matches(text: str) -> list[re.Match[str]]:
    pattern = r"(?P<first>\d+(?:\.\d+)?)(?:\s*[-–]\s*(?P<second>\d+(?:\.\d+)?))?\s*(?P<unit>kN|mN|µN|μN|uN|nN|pN|N)\b"
    return list(re.finditer(pattern, text, flags=re.IGNORECASE))


def _force_range_from_match(match: re.Match[str]) -> tuple[float | None, float | None]:
    first = _force_to_newtons(match.group("first"), match.group("unit"))
    second = _force_to_newtons(match.group("second"), match.group("unit")) if match.group("second") else first
    return first, second


def normalize_load_conditions(value: Any) -> dict[str, Any]:
    if value in (None, "", {}):
        return {}
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except Exception:
            return derive_load_conditions(value)
    if not isinstance(value, dict):
        return {}

    raw_text = _clean_text(value.get("raw_text") or value.get("rawText"))
    value_type = _clean_text(value.get("value_type") or value.get("valueType")).lower()
    if value_type not in LOAD_VALUE_TYPES:
        value_type = "composite" if value.get("contact_load_per_unit_N") or value.get("contactLoadPerUnitN") else "single"

    normalized = {
        "raw_text": raw_text,
        "value_type": value_type,
        "system_total_load_N": _round(_as_float(value.get("system_total_load_N", value.get("systemTotalLoadN")))),
        "contact_load_per_unit_N": _round(_as_float(value.get("contact_load_per_unit_N", value.get("contactLoadPerUnitN")))),
        "contact_unit_type": _clean_text(value.get("contact_unit_type") or value.get("contactUnitType")) or None,
        "load_min_N": _round(_as_float(value.get("load_min_N", value.get("loadMinN")))),
        "load_max_N": _round(_as_float(value.get("load_max_N", value.get("loadMaxN")))),
    }
    note = _clean_text(value.get("note"))
    if note:
        normalized["note"] = note
    return normalized


def serialize_load_conditions(value: Any) -> str | None:
    normalized = normalize_load_conditions(value)
    if not normalized:
        return None
    return json.dumps(normalized, ensure_ascii=False)


def derive_load_conditions(raw_text: Any) -> dict[str, Any]:
    text = _clean_text(raw_text)
    if not text:
        return {}

    matches = _force_matches(text)
    lower = text.lower()
    payload: dict[str, Any] = {
        "raw_text": text,
        "value_type": "unstated",
        "system_total_load_N": None,
        "contact_load_per_unit_N": None,
        "contact_unit_type": None,
        "load_min_N": None,
        "load_max_N": None,
    }
    if not matches:
        return normalize_load_conditions(payload)

    min_values: list[float] = []
    max_values: list[float] = []
    for match in matches:
        first_n, second_n = _force_range_from_match(match)
        if first_n is None:
            continue
        min_values.append(first_n)
        max_values.append(second_n if second_n is not None else first_n)
        segment_start = text.rfind(";", 0, match.start()) + 1
        segment_end = text.find(";", match.end())
        if segment_end < 0:
            segment_end = len(text)
        context_start = max(segment_start, match.start() - 12)
        context_end = min(segment_end, match.end() + 48)
        context = text[context_start:context_end].lower()
        if "total" in context or "overall" in context or "system" in context:
            payload["system_total_load_N"] = first_n
        if "per" in context or "/pin" in context or "each" in context:
            payload["contact_load_per_unit_N"] = first_n
            unit_match = re.search(r"(?:per|/)\s*([a-zA-Z][\w-]*)", context)
            if unit_match:
                payload["contact_unit_type"] = unit_match.group(1).strip("-_ ")

    if min_values:
        payload["load_min_N"] = min(min_values)
        payload["load_max_N"] = max(max_values)

    if payload["system_total_load_N"] is not None and payload["contact_load_per_unit_N"] is not None:
        payload["value_type"] = "composite"
    elif len(matches) == 1 and matches[0].group("second"):
        payload["value_type"] = "range"
    elif len(matches) > 1 or ";" in text:
        payload["value_type"] = "composite"
    else:
        payload["value_type"] = "single"
        if "total" in lower:
            payload["system_total_load_N"] = payload["system_total_load_N"] or payload["load_min_N"]
        else:
            payload["contact_load_per_unit_N"] = payload["contact_load_per_unit_N"] or payload["load_min_N"]

    if payload["contact_load_per_unit_N"] is not None and not payload["contact_unit_type"]:
        unit_match = re.search(r"\bper\s+([a-zA-Z][\w-]*)", lower)
        payload["contact_unit_type"] = unit_match.group(1) if unit_match else None

    return normalize_load_conditions(payload)


def normalize_tribological_system(value: Any) -> dict[str, Any]:
    if value in (None, "", {}):
        return {}
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except Exception:
            return derive_tribological_system(value)
    if not isinstance(value, dict):
        return {}

    raw_text = _clean_text(value.get("raw_text") or value.get("rawText"))
    friction_regime = _clean_text(value.get("friction_regime") or value.get("frictionRegime")).lower()
    if friction_regime not in FRICTION_REGIMES:
        friction_regime = "unstated"
    contact_geometry = _clean_text(value.get("contact_geometry") or value.get("contactGeometry")) or None
    scale = _clean_text(value.get("scale")) or None
    note = _clean_text(value.get("note")) or None

    normalized: dict[str, Any] = {
        "raw_text": raw_text,
        "friction_regime": friction_regime,
        "contact_geometry": contact_geometry,
        "scale": scale,
    }
    if note:
        normalized["note"] = note
    return normalized


def serialize_tribological_system(value: Any) -> str | None:
    normalized = normalize_tribological_system(value)
    if not normalized:
        return None
    return json.dumps(normalized, ensure_ascii=False)


def derive_tribological_system(raw_text: Any) -> dict[str, Any]:
    text = _clean_text(raw_text)
    if not text:
        return {}
    lower = text.lower()

    friction_regime = "unstated"
    if "static" in lower:
        friction_regime = "static"
    elif any(token in lower for token in ("kinetic", "sliding", "dynamic")):
        friction_regime = "kinetic"
    if "boundary" in lower:
        friction_regime = "boundary"
    elif "mixed" in lower:
        friction_regime = "mixed"
    elif "elastohydrodynamic" in lower or "ehd" in lower:
        friction_regime = "elastohydrodynamic"
    elif "hydrodynamic" in lower:
        friction_regime = "hydrodynamic"

    contact_geometry = None
    geometry_patterns = [
        (r"ball[-\s]*on[-\s]*(?:3|three)[-\s]*pins?", "ball_on_3_pins"),
        (r"ball[-\s]*on[-\s]*disk", "ball_on_disk"),
        (r"ball[-\s]*on[-\s]*plate", "ball_on_plate"),
        (r"pin[-\s]*on[-\s]*disk", "pin_on_disk"),
        (r"four[-\s]*ball", "four_ball"),
        (r"afm|ffm|colloidal\s+probe|borosilicate\s+glass\s+bead", "afm_colloidal_probe"),
    ]
    for pattern, label in geometry_patterns:
        if re.search(pattern, lower):
            contact_geometry = label
            break

    scale = None
    if "nano" in lower or "afm" in lower or "ffm" in lower:
        scale = "nano"
    elif "micro" in lower:
        scale = "micro"
    elif "macro" in lower:
        scale = "macro"

    return normalize_tribological_system({
        "raw_text": text,
        "friction_regime": friction_regime,
        "contact_geometry": contact_geometry,
        "scale": scale,
    })
