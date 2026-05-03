from __future__ import annotations

import json
import math
import re
from functools import reduce
from math import gcd
from typing import Any


COMPOUND_PAIR_RE = re.compile(r"\[[^\]]+\]\[[^\]]+\]")
BRACKET_TOKEN_RE = re.compile(r"\[[^\]]+\]")


def _as_float(value: Any) -> float | None:
    if value in (None, ""):
        return None
    try:
        parsed = float(str(value).strip().rstrip("%"))
    except (TypeError, ValueError):
        return None
    return parsed if math.isfinite(parsed) else None


def _compact_number(value: float | int | None) -> float | int | None:
    if value is None:
        return None
    numeric = float(value)
    if numeric.is_integer():
        return int(numeric)
    return round(numeric, 4)


def _normalize_unit(value: Any) -> str | None:
    unit = str(value or "").strip()
    if not unit:
        return None
    lowered = unit.lower().replace(" ", "")
    if lowered in {"wt", "wt%", "mass", "mass%", "weight", "weight%"}:
        return "wt%"
    if lowered in {"mol", "mol%", "molar"}:
        return "mol%"
    return unit


def normalize_lubricant_components(value: Any) -> list[dict[str, Any]]:
    """Normalize user/LLM mixture payloads into a stable component list."""
    if value in (None, "", []):
        return []
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except Exception:
            return []
    if isinstance(value, dict):
        value = value.get("components") or value.get("Lubricant_Mixture") or value.get("lubricant_components") or []
    if not isinstance(value, list):
        return []

    normalized: list[dict[str, Any]] = []
    for raw in value:
        if isinstance(raw, str):
            component = {"compound": raw}
        elif isinstance(raw, dict):
            component = dict(raw)
        else:
            continue

        compound = str(
            component.get("compound")
            or component.get("component")
            or component.get("name")
            or component.get("ionic_liquid")
            or ""
        ).strip()
        if not compound:
            continue

        entry: dict[str, Any] = {"compound": compound}
        fraction = _as_float(component.get("fraction"))
        if fraction is not None:
            entry["fraction"] = _compact_number(fraction)
        unit = _normalize_unit(component.get("unit"))
        if unit:
            entry["unit"] = unit
        role = str(component.get("role") or "").strip()
        if role:
            entry["role"] = role
        normalized.append(entry)
    return normalized


def serialize_lubricant_components(value: Any) -> str | None:
    components = normalize_lubricant_components(value)
    if not components:
        return None
    return json.dumps(components, ensure_ascii=False)


def _extract_ratio(text: Any) -> tuple[list[float], str | None]:
    normalized = str(text or "")
    match = re.search(
        r"(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)(?:\s*(mass|wt|weight|mol))?",
        normalized,
        flags=re.IGNORECASE,
    )
    if not match:
        return [], None
    values = [_as_float(match.group(1)), _as_float(match.group(2))]
    if any(value is None for value in values):
        return [], None
    return [float(values[0]), float(values[1])], _normalize_unit(match.group(3))


def _fraction_components(compounds: list[str], ratio_values: list[float], unit: str | None) -> list[dict[str, Any]]:
    if len(compounds) < 2 or len(ratio_values) != len(compounds):
        return []
    total = sum(ratio_values)
    if total <= 0:
        return []
    resolved_unit = _normalize_unit(unit) or "wt%"
    return [
        {
            "compound": compound,
            "fraction": _compact_number(value / total * 100.0),
            "unit": resolved_unit,
        }
        for compound, value in zip(compounds, ratio_values)
    ]


def parse_lubricant_components(
    lubricant: Any,
    mol_ratio: Any = None,
    cation: Any = None,
    anion: Any = None,
) -> list[dict[str, Any]]:
    """Infer mixture components from compact ILM labels such as A:B = 4:1 mass ratio."""
    lubricant_text = str(lubricant or "").strip()
    compounds = COMPOUND_PAIR_RE.findall(lubricant_text)
    ratio_source = mol_ratio or lubricant_text
    ratio_values, unit = _extract_ratio(ratio_source)
    if ratio_values and unit is None:
        unit = "mol%" if mol_ratio else "wt%"
    if len(compounds) >= 2 and len(ratio_values) == 2:
        return _fraction_components(compounds[:2], ratio_values, unit)

    cation_text = str(cation or "").strip()
    anion_text = str(anion or "").strip()
    anion_parts = BRACKET_TOKEN_RE.findall(anion_text)
    if cation_text and len(anion_parts) >= 2 and len(ratio_values) == 2:
        cation_label = cation_text if cation_text.startswith("[") else f"[{cation_text}]"
        compounds = [f"{cation_label}{anion_part}" for anion_part in anion_parts[:2]]
        return _fraction_components(compounds, ratio_values, unit)

    return []


def components_for_record(record: Any) -> list[dict[str, Any]]:
    stored = normalize_lubricant_components(getattr(record, "lubricant_components_json", None))
    if stored:
        return stored
    return parse_lubricant_components(
        getattr(record, "lubricant", None),
        getattr(record, "mol_ratio", None),
        getattr(record, "cation", None),
        getattr(record, "anion", None),
    )


def _component_ratio_label(components: list[dict[str, Any]]) -> str | None:
    fractions = [_as_float(component.get("fraction")) for component in components]
    if not fractions or any(value is None for value in fractions):
        return None
    scaled = [int(round(float(value) * 1000)) for value in fractions]
    common = reduce(gcd, [abs(value) for value in scaled if value])
    ratio_parts = [str(value // common) if common else str(value) for value in scaled]
    units = {_normalize_unit(component.get("unit")) for component in components if component.get("unit")}
    suffix = ""
    if len(units) == 1:
        unit = next(iter(units))
        suffix = " wt" if unit == "wt%" else f" {unit}".rstrip()
    return f"{':'.join(ratio_parts)}{suffix}"


def compact_lubricant_label(
    lubricant: Any,
    components: list[dict[str, Any]] | None = None,
    alias: Any = None,
) -> str:
    component_list = normalize_lubricant_components(components) or parse_lubricant_components(lubricant)
    if len(component_list) == 1:
        return str(component_list[0].get("compound") or "").strip() or str(lubricant or "").strip() or "--"

    parsed = [
        re.match(r"^\[([^\]]+)\]\[([^\]]+)\]$", str(component.get("compound") or "").strip())
        for component in component_list
    ]
    if component_list and all(parsed):
        cations = [match.group(1) for match in parsed if match]
        anions = [match.group(2) for match in parsed if match]
        ratio = _component_ratio_label(component_list)
        if len(set(cations)) == 1 and len(anions) >= 2:
            anion_label = "/".join(f"[{anion}]" for anion in anions)
            label = f"[{cations[0]}] {anion_label}"
            return f"{label} ({ratio})" if ratio else label
        label = "/".join(component.get("compound", "") for component in component_list)
        return f"{label} ({ratio})" if ratio else label

    return str(lubricant or "").strip() or "--"


def format_lubricant_tooltip(
    lubricant: Any,
    components: list[dict[str, Any]] | None = None,
    alias: Any = None,
) -> str:
    component_list = normalize_lubricant_components(components) or parse_lubricant_components(lubricant)
    compact = compact_lubricant_label(lubricant, component_list, alias=None)
    parts: list[str] = []
    for component in component_list:
        label = str(component.get("compound") or "").strip()
        fraction = component.get("fraction")
        unit = component.get("unit")
        if fraction not in (None, "") and unit:
            label = f"{label}: {fraction} {unit}"
        parts.append(label)

    detail = "; ".join(parts) if parts else str(lubricant or "").strip()
    return detail or compact
