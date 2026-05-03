from __future__ import annotations

import json
import math
import re
from typing import Any


COF_VALUE_TYPES = {"single", "range", "conditional"}


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
    return round(float(value), 6)


def _average(min_value: float | None, max_value: float | None, fallback: Any = None) -> float | None:
    if min_value is not None and max_value is not None:
        return _round((min_value + max_value) / 2.0)
    fallback_value = _as_float(fallback)
    return _round(fallback_value)


def normalize_cof_extracted(value: Any) -> dict[str, Any]:
    """Normalize COF extraction payloads into a stable object."""
    if value in (None, "", {}):
        return {}
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except Exception:
            return {}
    if not isinstance(value, dict):
        return {}

    raw_text = str(value.get("raw_text") or value.get("rawText") or "").strip()
    value_type = str(value.get("value_type") or value.get("valueType") or "").strip().lower()
    if value_type not in COF_VALUE_TYPES:
        value_type = "conditional" if value.get("segments") else "range"

    cof_min = _as_float(value.get("cof_min", value.get("cofMin")))
    cof_max = _as_float(value.get("cof_max", value.get("cofMax")))
    cof_average = _as_float(value.get("cof_average", value.get("cofAverage")))
    dependent_variable = str(value.get("dependent_variable") or value.get("dependentVariable") or "").strip() or None
    test_condition_value = str(value.get("test_condition_value") or value.get("testConditionValue") or "").strip() or None
    note = str(value.get("note") or "").strip() or None

    segments = []
    for segment in value.get("segments") or []:
        normalized_segment = normalize_cof_extracted(segment)
        if normalized_segment:
            normalized_segment.pop("segments", None)
            segments.append(normalized_segment)

    normalized: dict[str, Any] = {
        "raw_text": raw_text,
        "value_type": value_type,
        "cof_min": _round(cof_min),
        "cof_max": _round(cof_max),
        "cof_average": _round(cof_average) if cof_average is not None else _average(cof_min, cof_max),
        "dependent_variable": dependent_variable,
        "test_condition_value": test_condition_value,
    }
    if note:
        normalized["note"] = note
    if segments:
        normalized["segments"] = segments
    return normalized


def serialize_cof_extracted(value: Any) -> str | None:
    normalized = normalize_cof_extracted(value)
    if not normalized:
        return None
    return json.dumps(normalized, ensure_ascii=False)


def derive_cof_extracted(
    raw_text: Any,
    cof_value: Any = None,
    *,
    load: Any = None,
    speed: Any = None,
) -> dict[str, Any]:
    text = str(raw_text or "").strip()
    if not text:
        value = _as_float(cof_value)
        if value is None:
            return {}
        return {
            "raw_text": str(value),
            "value_type": "single",
            "cof_min": _round(value),
            "cof_max": _round(value),
            "cof_average": _round(value),
            "dependent_variable": None,
            "test_condition_value": None,
        }

    lower = text.lower()
    numeric_range = re.search(r"(\d+(?:\.\d+)?)\s*[-–]\s*(\d+(?:\.\d+)?)", text)
    single_value = _as_float(text) if re.fullmatch(r"[<>~=]?\s*\d+(?:\.\d+)?", text) else None

    if numeric_range:
        cof_min = _as_float(numeric_range.group(1))
        cof_max = _as_float(numeric_range.group(2))
        condition_match = re.search(r"\bat\s+([^;]+)", text, flags=re.IGNORECASE)
        dependent_variable = None
        test_condition = None
        value_type = "range"

        if "scan velocity" in lower or "velocity" in lower or "speed" in lower:
            dependent_variable = "scan velocity"
            test_condition = None
        if condition_match:
            test_condition = condition_match.group(1).strip()
            if "nn" in test_condition.lower() or "load" in lower:
                dependent_variable = "normal load"
            value_type = "conditional"

        segments: list[dict[str, Any]] = []
        if ";" in text:
            first_part, *rest = [part.strip() for part in text.split(";") if part.strip()]
            first_segment = derive_cof_extracted(first_part, cof_value, load=load, speed=speed)
            if first_segment:
                first_segment.pop("segments", None)
                if first_segment.get("cof_min") is not None and first_segment.get("cof_max") is not None:
                    first_segment["value_type"] = "range"
                segments.append(first_segment)
            for part in rest:
                condition = re.search(r"\bat\s+([^;]+)", part, flags=re.IGNORECASE)
                segment = {
                    "raw_text": part,
                    "value_type": "conditional",
                    "cof_min": None,
                    "cof_max": None,
                    "cof_average": None,
                    "dependent_variable": "normal load" if condition and "nn" in condition.group(1).lower() else dependent_variable,
                    "test_condition_value": condition.group(1).strip() if condition else None,
                    "note": part,
                }
                segments.append(normalize_cof_extracted(segment))
            value_type = "conditional"

        payload = {
            "raw_text": text,
            "value_type": value_type,
            "cof_min": cof_min,
            "cof_max": cof_max,
            "cof_average": _average(cof_min, cof_max, cof_value),
            "dependent_variable": dependent_variable,
            "test_condition_value": test_condition,
        }
        if segments:
            payload["segments"] = segments
        return normalize_cof_extracted(payload)

    if single_value is None:
        single_value = _as_float(cof_value)
    if single_value is None:
        return normalize_cof_extracted({
            "raw_text": text,
            "value_type": "conditional" if any(token in lower for token in ("depend", " at ", "increase")) else "single",
            "cof_min": None,
            "cof_max": None,
            "cof_average": None,
            "dependent_variable": "scan velocity" if "velocity" in lower else None,
            "test_condition_value": None,
        })

    return normalize_cof_extracted({
        "raw_text": text,
        "value_type": "single",
        "cof_min": single_value,
        "cof_max": single_value,
        "cof_average": single_value,
        "dependent_variable": None,
        "test_condition_value": None,
    })


def cof_average_from_extracted(value: Any) -> float | None:
    normalized = normalize_cof_extracted(value)
    return _as_float(normalized.get("cof_average"))
