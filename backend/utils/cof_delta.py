from __future__ import annotations

import json
import re
from typing import Any


COF_DELTA_REASON = "cof_delta_from_figure"

_DELTA_RE = re.compile(
    r"\b(?P<direction>increase(?:d)?|decrease(?:d)?|delta|change|rise|drop)\b"
    r"(?:\s+range)?(?:\s+of\s+friction\s+coefficient)?(?:\s*(?:by|of|:|=|was|is))?\s*"
    r"(?P<value>[+-]?\d+(?:\.\d+)?)",
    re.IGNORECASE,
)
_CURRENT_RE = re.compile(r"\b(?P<value>[+-]?\d+(?:\.\d+)?)\s*A\b", re.IGNORECASE)
_IRON_OXIDE_LOADING_RE = re.compile(
    r"\b(?P<value>\d+(?:\.\d+)?)\s*%?\s*(?P<oxide>Fe\s*2\s*O\s*3|Fe\s*3\s*O\s*4)\b",
    re.IGNORECASE,
)


def _filled(value: Any) -> str:
    return str(value or "").strip()


def _parse_object(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return dict(value)
    if isinstance(value, str) and value.strip():
        try:
            parsed = json.loads(value)
        except Exception:
            return {}
        return parsed if isinstance(parsed, dict) else {}
    return {}


def parse_cof_delta(raw_value: Any, *, allow_bare_number: bool = False) -> dict[str, str] | None:
    text = _filled(raw_value)
    if not text:
        return None
    match = _DELTA_RE.search(text)
    if not match:
        if allow_bare_number and re.fullmatch(r"[+-]?\d+(?:\.\d+)?", text):
            return {"value": text, "raw_value": text, "direction": "increase"}
        return None
    value = match.group("value")
    direction_raw = (match.group("direction") or "").lower()
    direction = "decrease" if direction_raw.startswith(("decrease", "drop")) else "increase"
    return {"value": value, "raw_value": text, "direction": direction}


def _evidence_payload(item: dict[str, Any]) -> dict[str, Any]:
    evidence = {
        "quote": item.get("evidence") or item.get("notes"),
        "page": item.get("source_page"),
        "source_label": item.get("source") or item.get("source_figure"),
        "bbox": item.get("evidence_bbox"),
    }
    return {key: value for key, value in evidence.items() if value not in (None, "", [], {})}


def _infer_current(item: dict[str, Any]) -> str | None:
    for key in ("current", "Current", "applied_current", "current_intensity"):
        if _filled(item.get(key)):
            return _filled(item.get(key))
    context = " ".join(
        _filled(item.get(key))
        for key in ("evidence", "notes", "source", "source_figure")
        if _filled(item.get(key))
    )
    match = _CURRENT_RE.search(context)
    return f"{match.group('value')} A" if match else None


def _infer_iron_oxide_loading(item: dict[str, Any]) -> str | None:
    for key in ("iron_oxide_additive_ratio", "Fe3O4 loading", "Fe2O3 loading", "additive_loading"):
        if _filled(item.get(key)):
            return _filled(item.get(key))
    context = " ".join(
        _filled(item.get(key))
        for key in ("material_name", "lubricant", "ionic_liquid", "evidence", "notes")
        if _filled(item.get(key))
    )
    match = _IRON_OXIDE_LOADING_RE.search(context)
    return f"{match.group('value')} wt%" if match else None


def _merge_flexible_field(
    flexible: dict[str, Any],
    key: str,
    *,
    label: str,
    value: Any,
    category: str,
    evidence: dict[str, Any],
    **extra: Any,
) -> None:
    if value in (None, "", [], {}):
        return
    existing = flexible.get(key)
    if isinstance(existing, dict) and existing.get("value") not in (None, ""):
        return
    entry = {
        "label": label,
        "value": value,
        "unit": None,
        "category": category,
        "evidence": evidence,
    }
    entry.update({extra_key: extra_value for extra_key, extra_value in extra.items() if extra_value not in (None, "")})
    flexible[key] = entry


def apply_cof_delta_policy(item: dict[str, Any], *, confidence_cap: float = 0.60) -> bool:
    """Move relative COF changes out of the core COF slot and into flexible fields."""
    delta = parse_cof_delta(item.get("cof")) or parse_cof_delta(item.get("cof_delta"), allow_bare_number=True)
    if not delta:
        return False

    evidence = _evidence_payload(item)
    field_evidence = _parse_object(item.get("field_evidence_json") or item.get("field_evidence"))
    flexible = _parse_object(field_evidence.get("_flexible_fields"))

    _merge_flexible_field(
        flexible,
        "cof_delta",
        label="COF delta",
        value=delta["value"],
        category="derived_metric",
        evidence=evidence,
        raw_value=delta["raw_value"],
        direction=delta["direction"],
    )
    current = _infer_current(item)
    _merge_flexible_field(
        flexible,
        "current",
        label="Current",
        value=current,
        category="condition",
        evidence=evidence,
    )
    _merge_flexible_field(
        flexible,
        "baseline_current",
        label="Baseline current",
        value=_filled(item.get("baseline_current")) or "0 A",
        category="condition",
        evidence=evidence,
    )
    _merge_flexible_field(
        flexible,
        "iron_oxide_additive_ratio",
        label="Iron oxide additive ratio",
        value=_infer_iron_oxide_loading(item),
        category="lubricant_component",
        evidence=evidence,
    )

    field_evidence["_flexible_fields"] = flexible
    item["field_evidence_json"] = field_evidence
    item["_flexible_fields"] = flexible
    item["cof_delta"] = delta["value"]
    item["cof"] = None
    item["cof_extracted"] = {}
    item["value_origin"] = "figure_estimate"
    item["figure_estimate_reason"] = COF_DELTA_REASON
    try:
        item["confidence"] = min(float(item.get("confidence") or confidence_cap), confidence_cap)
    except Exception:
        item["confidence"] = confidence_cap
    note = "COF field contained a relative increase/decrease, stored as cof_delta for review instead of absolute COF."
    existing_note = _filled(item.get("notes"))
    item["notes"] = " ".join(part for part in (existing_note, note) if part)
    return True
