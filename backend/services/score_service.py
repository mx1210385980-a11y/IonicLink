"""
Confidence scoring for extracted tribology records.

Storage convention:
- DB stores confidence in [0.0, 1.0]
- UI can display confidence * 100 as percentage
"""

from __future__ import annotations

from typing import Any, Dict, List, Tuple
import re


def _pick(record: Dict[str, Any], *keys: str) -> Any:
    for k in keys:
        if k in record:
            v = record.get(k)
            if v is not None:
                return v
    return None


def _is_missing(value: Any) -> bool:
    if value is None:
        return True
    s = str(value).strip().lower()
    return s in ("", "-", "--", "null", "none", "n/a", "na")


def _looks_unknown(value: Any) -> bool:
    if value is None:
        return False
    s = str(value).strip().lower()
    return any(tag in s for tag in ("unknown", "unk"))


def _extract_panel_letter(source: Any) -> str | None:
    text = str(source or "").strip()
    if not text:
        return None
    m = re.search(
        r"\bfig(?:ure)?\.?\s*\d+\s*(?:\(\s*([a-z])\s*\)|([a-z]))\b",
        text,
        re.IGNORECASE,
    )
    if m:
        return (m.group(1) or m.group(2) or "").strip().lower() or None
    m2 = re.fullmatch(r"\d+\s*([a-z])", text, re.IGNORECASE)
    if m2:
        return (m2.group(1) or "").strip().lower() or None
    return None


def _is_generic_source_label(value: Any) -> bool:
    if _is_missing(value):
        return False
    s = str(value).strip().lower()
    return s in {
        "text",
        "text only",
        "text snippet",
        "unknown",
        "image",
        "image region",
        "visual",
    }


def _parse_float(value: Any) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except Exception:
        pass
    m = re.search(r"-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?", str(value))
    if not m:
        return None
    try:
        return float(m.group(0))
    except Exception:
        return None


def _has_valid_bbox(value: Any) -> bool:
    if isinstance(value, (list, tuple)) and len(value) == 4:
        try:
            x0, y0, x1, y1 = map(float, value)
            return x1 > x0 and y1 > y0
        except Exception:
            return False
    text = str(value or "").strip()
    if not text:
        return False
    nums = re.findall(r"-?\d+(?:\.\d+)?", text)
    if len(nums) != 4:
        return False
    try:
        x0, y0, x1, y1 = map(float, nums)
        return x1 > x0 and y1 > y0
    except Exception:
        return False


def calculate_confidence_details(record: Dict[str, Any]) -> Dict[str, Any]:
    """
    Return composite confidence with penalty breakdown.
    """
    base_score = 1.0
    score = base_score
    penalties: List[Tuple[str, float]] = []
    boosts: List[Tuple[str, float]] = []

    def penalize(reason: str, value: float) -> None:
        nonlocal score
        score -= value
        penalties.append((reason, value))

    def boost(reason: str, value: float) -> None:
        nonlocal score
        score += value
        boosts.append((reason, value))

    lubricant = _pick(record, "lubricant", "ionic_liquid")
    material = _pick(
        record,
        "tribopair_label",
        "tribopairLabel",
        "substrate_material",
        "substrateMaterial",
        "material_name",
        "materialName",
    )
    probe_material = _pick(record, "probe_material", "probeMaterial")
    substrate_material = _pick(record, "substrate_material", "substrateMaterial")
    cof_value = _pick(record, "cof_value", "cofValue")
    cof_raw = _pick(record, "cof_raw", "cofRaw", "cof")
    cof_operator = _pick(record, "cof_operator", "cofOperator")
    source = _pick(record, "source")
    source_figure = _pick(record, "source_figure", "sourceFigure")
    source_page = _pick(record, "source_page", "sourcePage")
    evidence_page = _pick(record, "evidence_page", "evidencePage")
    evidence = _pick(record, "evidence")
    evidence_bbox = _pick(record, "evidence_bbox", "evidenceBbox")
    value_origin = _pick(record, "value_origin", "valueOrigin")

    # Core completeness
    if _is_missing(lubricant):
        penalize("missing_lubricant", 0.18)
    elif _looks_unknown(lubricant):
        penalize("unknown_lubricant", 0.10)

    if _is_missing(material) and (_is_missing(probe_material) or _is_missing(substrate_material)):
        penalize("missing_material", 0.16)
    elif _looks_unknown(material):
        penalize("unknown_material", 0.08)

    if _is_missing(cof_value) and _is_missing(cof_raw):
        penalize("missing_cof", 0.28)

    # COF uncertainty / physics plausibility
    uncertainty_markers = ("<", ">", "~", "approx", "around", "about")
    combined_cof = f"{cof_operator or ''} {cof_raw or ''}".lower()
    if any(tok in combined_cof for tok in uncertainty_markers):
        penalize("cof_uncertain", 0.08)

    cof_float = _parse_float(cof_value if not _is_missing(cof_value) else cof_raw)
    if cof_float is not None and (cof_float < 0 or cof_float > 1.5):
        penalize("cof_out_of_range", 0.20)

    # Evidence quality: score grounding as a whole rather than punishing each field blindly.
    has_any_source_label = (not _is_missing(source)) or (not _is_missing(source_figure))
    has_specific_source_label = (not _is_missing(source_figure)) or (
        not _is_missing(source) and not _is_generic_source_label(source)
    )
    has_grounding_page = (not _is_missing(source_page)) or (not _is_missing(evidence_page))
    has_evidence_text = not _is_missing(evidence)
    has_evidence_bbox = _has_valid_bbox(evidence_bbox)
    has_grounding_payload = has_evidence_text or has_evidence_bbox

    if not has_any_source_label:
        penalize("missing_source", 0.05)
    elif has_specific_source_label:
        boost("source_labeled", 0.01)

    if not has_grounding_page:
        penalize("missing_source_page", 0.04)
    else:
        boost("page_grounded", 0.02)

    if not has_grounding_payload:
        penalize("missing_evidence", 0.05)
    elif has_evidence_text:
        boost("evidence_quote_present", 0.02)

    panel_from_source = _extract_panel_letter(source)
    panel_from_figure = _extract_panel_letter(source_figure)
    if panel_from_source and panel_from_figure and panel_from_source != panel_from_figure:
        penalize("panel_mismatch", 0.12)

    if has_evidence_bbox:
        boost("grounded_bbox", 0.03)
    if (panel_from_source or panel_from_figure) and has_grounding_page:
        boost("panel_level_grounding", 0.02)

    # Condition richness
    condition_fields = [
        _pick(record, "speed_value", "speedValue", "speed"),
        _pick(record, "shear_rate", "shearRate"),
        _pick(record, "load_value", "loadValue", "load", "normal_load"),
        _pick(record, "temperature"),
        _pick(record, "potential"),
        _pick(record, "water_content", "waterContent"),
        _pick(record, "probe_roughness", "probeRoughness"),
        _pick(record, "substrate_roughness", "substrateRoughness"),
        _pick(record, "surface_roughness", "surfaceRoughness"),
        _pick(record, "film_thickness", "filmThickness"),
    ]
    missing_conditions = sum(1 for v in condition_fields if _is_missing(v))
    if missing_conditions >= 3:
        penalize("sparse_conditions", min(0.15, 0.03 * (missing_conditions - 2)))
    elif missing_conditions <= 1:
        boost("rich_conditions", 0.02)

    if value_origin and any(t in str(value_origin).lower() for t in ("infer", "estimated", "derived")):
        penalize("model_inferred", 0.10)

    score = max(0.05, min(1.0, score))
    score = round(score, 4)
    percent = round(score * 100.0, 1)

    return {
        "base_score": round(base_score, 4),
        "base_percent": round(base_score * 100.0, 1),
        "score": score,
        "percent": percent,
        "penalties": [{"reason": r, "value": v} for r, v in penalties],
        "boosts": [{"reason": r, "value": v} for r, v in boosts],
        "penalty_total": round(sum(v for _, v in penalties), 4),
        "penalty_percent": round(sum(v for _, v in penalties) * 100.0, 1),
        "boost_total": round(sum(v for _, v in boosts), 4),
        "boost_percent": round(sum(v for _, v in boosts) * 100.0, 1),
    }


def calculate_confidence(record: Dict[str, Any]) -> float:
    return float(calculate_confidence_details(record)["score"])


def calculate_batch_confidence(records: list) -> list:
    for record in records:
        record["confidence"] = calculate_confidence(record)
    return records
