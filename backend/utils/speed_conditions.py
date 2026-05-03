from __future__ import annotations

import json
import math
import re
from typing import Any


def _as_float(value: Any) -> float | None:
    if value in (None, ""):
        return None
    try:
        parsed = float(str(value).strip())
    except (TypeError, ValueError):
        return None
    return parsed if math.isfinite(parsed) else None


def _compact(value: float | None, digits: int = 6) -> float | None:
    if value is None:
        return None
    rounded = round(float(value), digits)
    return int(rounded) if float(rounded).is_integer() else rounded


def _normalize_text(value: Any) -> str:
    return (
        str(value or "")
        .strip()
        .replace("µ", "μ")
        .replace("渭", "μ")
        .replace("碌", "μ")
        .replace("μm  s1", "μm/s")
        .replace("μm s−1", "μm/s")
        .replace("μm s-1", "μm/s")
        .replace("μm·s−1", "μm/s")
        .replace("μm·s-1", "μm/s")
        .replace("", "")
        .replace("", "")
        .replace("", "")
        .replace("–", "-")
        .replace("—", "-")
    )


def _linear_velocity_um_s(value: float, unit: str) -> float | None:
    unit_l = unit.lower().replace(" ", "").replace("μ", "u")
    factors = {
        "nm/s": 1e-3,
        "nms-1": 1e-3,
        "nms^-1": 1e-3,
        "um/s": 1.0,
        "ums-1": 1.0,
        "ums^-1": 1.0,
        "mm/s": 1000.0,
        "mms-1": 1000.0,
        "mms^-1": 1000.0,
        "cm/s": 10000.0,
        "m/s": 1_000_000.0,
    }
    factor = factors.get(unit_l)
    return value * factor if factor is not None else None


def _length_um(value: float, unit: str) -> float | None:
    unit_l = unit.lower().replace(" ", "").replace("μ", "u")
    factors = {
        "nm": 1e-3,
        "um": 1.0,
        "mm": 1000.0,
        "cm": 10000.0,
        "m": 1_000_000.0,
    }
    factor = factors.get(unit_l)
    return value * factor if factor is not None else None


def normalize_speed_conditions(value: Any) -> dict[str, Any]:
    if value in (None, "", {}):
        return {}
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except Exception:
            return {}
    if not isinstance(value, dict):
        return {}

    raw_text = _normalize_text(value.get("raw_text") or value.get("rawText"))
    scan_rate = _as_float(value.get("scan_rate_hz") or value.get("scanRateHz"))
    scan_length = _as_float(value.get("scan_length_um") or value.get("scanLengthUm"))
    sliding = _as_float(
        value.get("sliding_velocity_um_s")
        or value.get("slidingVelocityUmS")
        or value.get("sliding_velocity")
    )
    value_type = str(value.get("value_type") or value.get("valueType") or "").strip()
    unit_warning = bool(value.get("unit_warning") or value.get("unitWarning"))
    calculation = _normalize_text(value.get("calculation"))
    note = _normalize_text(value.get("note"))

    if sliding is None and scan_rate is not None and scan_length is not None:
        sliding = 2.0 * scan_length * scan_rate
        calculation = calculation or f"v = 2 x {scan_length:g} μm x {scan_rate:g} Hz"
        value_type = value_type or "derived"
    if not value_type:
        value_type = "linear" if sliding is not None else "scan_rate" if scan_rate is not None else "unknown"
    if scan_rate is not None and sliding is None:
        unit_warning = True

    result: dict[str, Any] = {
        "raw_text": raw_text or None,
        "value_type": value_type,
        "sliding_velocity_um_s": _compact(sliding),
        "scan_rate_hz": _compact(scan_rate),
        "scan_length_um": _compact(scan_length),
        "unit_warning": unit_warning,
    }
    if calculation:
        result["calculation"] = calculation
    if note:
        result["note"] = note
    return {k: v for k, v in result.items() if v is not None and v != ""}


def derive_speed_conditions(speed: Any = None, *, context: Any = None) -> dict[str, Any]:
    text = _normalize_text(" ".join(str(part or "") for part in (speed, context) if part not in (None, "")))
    if not text:
        return {}

    scan_rate: float | None = None
    scan_length: float | None = None
    sliding: float | None = None

    rate_match = re.search(r"(?:scan\s*(?:rate|frequency)|frequency)\D{0,20}([-+]?\d+(?:\.\d+)?)\s*hz\b", text, re.I)
    if not rate_match:
        rate_match = re.search(r"\b([-+]?\d+(?:\.\d+)?)\s*hz\b", text, re.I)
    if rate_match:
        scan_rate = _as_float(rate_match.group(1))

    size_match = re.search(
        r"(?:scan\s*(?:size|length)|track(?:\s*length)?|scan\s*range)\D{0,30}"
        r"([-+]?\d+(?:\.\d+)?)\s*(nm|μm|um|mm|cm|m)"
        r"(?:\s*[x×]\s*[-+]?\d+(?:\.\d+)?\s*(?:nm|μm|um|mm|cm|m)?)?",
        text,
        re.I,
    )
    if not size_match:
        size_match = re.search(
            r"([-+]?\d+(?:\.\d+)?)\s*(nm|μm|um|mm|cm|m)\s*[x×]\s*[-+]?\d+(?:\.\d+)?\s*(?:nm|μm|um|mm|cm|m)?",
            text,
            re.I,
        )
    if size_match:
        length_value = _as_float(size_match.group(1))
        if length_value is not None:
            scan_length = _length_um(length_value, size_match.group(2))

    velocity_match = re.search(
        r"(?:scan\s*speed|sliding\s*velocity|sliding\s*speed|scan\s*velocity|speed|velocity)?\D{0,20}"
        r"([-+]?\d+(?:[.:]\d+)?)\s*(nm/s|nms-1|nms\^-1|μm/s|um/s|ums-1|ums\^-1|mm/s|mms-1|mms\^-1|cm/s|m/s)\b",
        text,
        re.I,
    )
    if velocity_match:
        value = _as_float(velocity_match.group(1).replace(":", "."))
        if value is not None:
            sliding = _linear_velocity_um_s(value, velocity_match.group(2))

    return normalize_speed_conditions({
        "raw_text": str(speed or "").strip() or text,
        "value_type": "derived" if scan_rate is not None and scan_length is not None and sliding is None else "linear" if sliding is not None else "scan_rate" if scan_rate is not None else "unknown",
        "sliding_velocity_um_s": sliding,
        "scan_rate_hz": scan_rate,
        "scan_length_um": scan_length,
    })


def serialize_speed_conditions(value: Any) -> str | None:
    normalized = normalize_speed_conditions(value)
    if not normalized:
        return None
    return json.dumps(normalized, ensure_ascii=False)


def speed_value_from_conditions(value: Any) -> str | None:
    normalized = normalize_speed_conditions(value)
    sliding = _as_float(normalized.get("sliding_velocity_um_s"))
    if sliding is None:
        return None
    return f"{_compact(sliding)} μm/s"
