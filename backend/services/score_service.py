"""
Confidence scoring for extracted records.

Storage convention:
- DB stores confidence in [0.0, 1.0]
- UI can display confidence * 100 as percentage
"""

from __future__ import annotations

import json
import math
import re
from typing import Any, Dict, Iterable, List, Mapping, Tuple


TRIBOLOGY_PRIMARY_METRIC_KEYS = (
    "cof",
    "friction_force",
    "wear_rate",
    "film_thickness",
    "residual_film_thickness_d",
    "layer_spacing_delta",
    "surface_roughness",
)
DIFFUSION_COEFFICIENT_KEYS = ("d_total", "d_cation", "d_anion")
CONDITION_KEYS = (
    "load",
    "speed",
    "shear_rate",
    "temperature",
    "potential",
    "water_content",
    "probe_roughness",
    "substrate_roughness",
    "surface_roughness",
    "film_thickness",
    "regime",
)

COMPLETENESS_WEIGHT = 0.30
GROUNDING_WEIGHT = 0.36
VALUE_QUALITY_WEIGHT = 0.20
CONTEXT_WEIGHT = 0.10
REVIEW_WEIGHT = 0.04


def _pick(record: Mapping[str, Any], *keys: str) -> Any:
    for key in keys:
        if key in record:
            value = record.get(key)
            if value is not None:
                return value
    return None


def _trim(value: Any) -> str:
    return str(value or "").strip()


def _lower(value: Any) -> str:
    return _trim(value).lower()


def _is_missing(value: Any) -> bool:
    if value is None:
        return True
    if isinstance(value, (list, tuple, set, dict)):
        return len(value) == 0
    text = _lower(value)
    return text in {"", "-", "--", "null", "none", "n/a", "na", "not captured yet"}


def _looks_unknown(value: Any) -> bool:
    text = _lower(value)
    if not text:
        return False
    return any(tag in text for tag in ("unknown", "unk", "not specified", "unspecified"))


def _parse_json_object(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    if not value:
        return {}
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
        except Exception:
            return {}
        return parsed if isinstance(parsed, dict) else {}
    return {}


def _field_map(record: Mapping[str, Any]) -> dict[str, Any]:
    return (
        _parse_json_object(_pick(record, "field_evidence_json", "fieldEvidenceJson", "field_evidence", "fieldEvidence"))
        or {}
    )


def _parse_float(value: Any) -> float | None:
    if value is None:
        return None
    try:
        result = float(value)
        return result if math.isfinite(result) else None
    except Exception:
        pass
    match = re.search(r"-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?", str(value))
    if not match:
        return None
    try:
        result = float(match.group(0))
        return result if math.isfinite(result) else None
    except Exception:
        return None


def _has_valid_bbox(value: Any) -> bool:
    if isinstance(value, (list, tuple)) and len(value) >= 4:
        try:
            x0, y0, x1, y1 = map(float, value[:4])
            return x1 > x0 and y1 > y0
        except Exception:
            return False
    text = _trim(value)
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


def _extract_panel_letter(source: Any) -> str | None:
    text = _trim(source)
    if not text:
        return None
    match = re.search(
        r"\bfig(?:ure)?\.?\s*\d+\s*(?:\(\s*([a-z])\s*\)|([a-z]))\b",
        text,
        re.IGNORECASE,
    )
    if match:
        return (match.group(1) or match.group(2) or "").strip().lower() or None
    fallback = re.fullmatch(r"\d+\s*([a-z])", text, re.IGNORECASE)
    if fallback:
        return (fallback.group(1) or "").strip().lower() or None
    return None


def _is_generic_source_label(value: Any) -> bool:
    if _is_missing(value):
        return True
    text = _lower(value)
    return text in {
        "text",
        "text only",
        "text snippet",
        "unknown",
        "image",
        "image region",
        "visual",
    }


def _normalize_field_key(key: str) -> str:
    aliases = {
        "material_name": "material",
        "materialName": "material",
        "lubricant": "ionic_liquid",
        "cof_raw": "cof",
        "cofRaw": "cof",
        "cof_value": "cof",
        "cofValue": "cof",
        "D_total": "d_total",
        "D_cation": "d_cation",
        "D_anion": "d_anion",
        "D_unit": "d_unit",
        "load_value": "load",
        "loadValue": "load",
        "load_raw": "load",
        "loadRaw": "load",
        "speed_value": "speed",
        "speedValue": "speed",
        "source_page": "source_page",
        "sourcePage": "source_page",
    }
    return aliases.get(key, key)


def _field_entry(field_map: Mapping[str, Any], key: str) -> dict[str, Any]:
    normalized = _normalize_field_key(key)
    entry = field_map.get(normalized)
    return entry if isinstance(entry, dict) else {}


def _field_value(record: Mapping[str, Any], key: str, field_map: Mapping[str, Any] | None = None) -> Any:
    entry = _field_entry(field_map or {}, key)
    if not _is_missing(entry.get("value")):
        return entry.get("value")

    if key == "material":
        tribopair = _pick(record, "tribopair_label", "tribopairLabel")
        if not _is_missing(tribopair):
            return tribopair
        probe = _pick(record, "probe_material", "probeMaterial")
        substrate = _pick(record, "substrate_material", "substrateMaterial")
        coating = _pick(record, "substrate_coating", "substrateCoating")
        parts = [probe, substrate, coating]
        if any(not _is_missing(part) for part in parts):
            return " / ".join(_trim(part) for part in parts if not _is_missing(part))
        return _pick(record, "material_name", "materialName")
    if key == "ionic_liquid":
        return _pick(record, "ionic_liquid", "lubricant")
    if key == "cof":
        extracted = _parse_json_object(_pick(record, "cof_extracted", "cofExtracted"))
        for extracted_key in ("cof_average", "cofAverage", "raw_text", "rawText"):
            if not _is_missing(extracted.get(extracted_key)):
                return extracted.get(extracted_key)
        return _pick(record, "cof", "cof_raw", "cofRaw", "cof_value", "cofValue")
    if key == "load":
        return _pick(record, "load", "load_raw", "loadRaw", "load_value", "loadValue", "normal_load")
    if key == "speed":
        return _pick(record, "speed", "speed_raw", "speedRaw", "speed_value", "speedValue")
    if key == "d_total":
        return _pick(record, "d_total", "D_total", "DTotal")
    if key == "d_cation":
        return _pick(record, "d_cation", "D_cation", "DCation")
    if key == "d_anion":
        return _pick(record, "d_anion", "D_anion", "DAnion")
    if key == "d_unit":
        return _pick(record, "d_unit", "D_unit", "DUnit")

    aliases = {
        "friction_force": ("friction_force", "frictionForce"),
        "wear_rate": ("wear_rate", "wearRate"),
        "film_thickness": ("film_thickness", "filmThickness"),
        "residual_film_thickness_d": ("residual_film_thickness_d", "residualFilmThicknessD"),
        "layer_spacing_delta": ("layer_spacing_delta", "layerSpacingDelta"),
        "surface_roughness": ("surface_roughness", "surfaceRoughness"),
        "probe_roughness": ("probe_roughness", "probeRoughness"),
        "substrate_roughness": ("substrate_roughness", "substrateRoughness"),
        "shear_rate": ("shear_rate", "shearRate"),
        "water_content": ("water_content", "waterContent"),
        "system_name": ("system_name", "systemName"),
        "temperature_value": ("temperature_value", "temperatureValue"),
        "confinement_scale_value": ("confinement_scale_value", "confinementScaleValue"),
    }
    return _pick(record, *(aliases.get(key) or (key,)))


def _extractor_type(record: Mapping[str, Any]) -> str:
    explicit = _lower(_pick(record, "extractor_type", "extractorType"))
    if explicit in {"diffusion", "tribology"}:
        return explicit
    if any(not _is_missing(_field_value(record, key)) for key in ("system_name", *DIFFUSION_COEFFICIENT_KEYS)):
        return "diffusion"
    return "tribology"


def _primary_metric_key(record: Mapping[str, Any], field_map: Mapping[str, Any]) -> str | None:
    for key in TRIBOLOGY_PRIMARY_METRIC_KEYS:
        if not _is_missing(_field_value(record, key, field_map)):
            return key
    for key in TRIBOLOGY_PRIMARY_METRIC_KEYS:
        if _field_entry(field_map, key):
            return key
    return None


def _required_slots(record: Mapping[str, Any], field_map: Mapping[str, Any]) -> list[tuple[str, tuple[str, ...]]]:
    if _extractor_type(record) == "diffusion":
        return [
            ("system_name", ("system_name",)),
            ("ionic_liquid", ("ionic_liquid",)),
            ("diffusion_coefficient", DIFFUSION_COEFFICIENT_KEYS),
        ]

    primary_metric = _primary_metric_key(record, field_map)
    metric_keys = (primary_metric,) if primary_metric else TRIBOLOGY_PRIMARY_METRIC_KEYS
    return [
        ("material", ("material",)),
        ("ionic_liquid", ("ionic_liquid",)),
        ("primary_metric", metric_keys),
    ]


def _value_presence_score(value: Any) -> float:
    if _is_missing(value):
        return 0.0
    if _looks_unknown(value):
        return 0.45
    return 1.0


def _slot_presence_score(record: Mapping[str, Any], field_map: Mapping[str, Any], keys: Iterable[str]) -> float:
    return max((_value_presence_score(_field_value(record, key, field_map)) for key in keys), default=0.0)


def _entry_evidence(entry: Mapping[str, Any]) -> Mapping[str, Any]:
    evidence = entry.get("evidence")
    return evidence if isinstance(evidence, Mapping) else {}


def _entry_status(entry: Mapping[str, Any], value: Any) -> str:
    explicit = _lower(entry.get("status"))
    if explicit in {"grounded", "partial", "missing"}:
        return explicit
    evidence = _entry_evidence(entry)
    has_page = not _is_missing(evidence.get("page"))
    has_quote = any(not _is_missing(evidence.get(key)) for key in ("quote", "matched_text", "text", "source_label"))
    has_bbox = _has_valid_bbox(evidence.get("bbox"))
    if has_page and (has_quote or has_bbox):
        return "grounded"
    if has_page or has_quote or has_bbox:
        return "partial"
    if not _is_missing(value) and _lower(entry.get("grounding_mode")) == "inferred":
        return "partial"
    return "missing"


def _field_grounding_score(
    record: Mapping[str, Any],
    field_map: Mapping[str, Any],
    key: str,
) -> float:
    entry = _field_entry(field_map, key)
    value = _field_value(record, key, field_map)
    if _is_missing(value):
        return 0.0

    review_state = _lower(entry.get("review_state"))
    if review_state == "flagged":
        return 0.0

    status = _entry_status(entry, value)
    grounding_mode = _lower(entry.get("grounding_mode"))
    evidence = _entry_evidence(entry)
    source_type = _lower(evidence.get("source_type"))

    if status == "grounded":
        score = 0.56
    elif status == "partial":
        score = 0.32
    else:
        score = 0.12 if entry else 0.0

    if grounding_mode == "explicit":
        score += 0.04
    elif grounding_mode == "derived":
        score += 0.01
    elif grounding_mode == "inferred":
        score = max(score, 0.48)

    if not _is_missing(evidence.get("page")):
        score += 0.06
    if any(not _is_missing(evidence.get(key)) for key in ("quote", "matched_text", "text")):
        score += 0.08
    if _has_valid_bbox(evidence.get("bbox")):
        score += 0.14
    if not _is_generic_source_label(evidence.get("source_label")):
        score += 0.05
    if source_type in {"figure", "table"}:
        score += 0.03
    if review_state == "confirmed" and status == "grounded":
        score += 0.07

    if not entry:
        has_source = not _is_generic_source_label(_pick(record, "source", "source_figure", "sourceFigure"))
        has_page = not _is_missing(_pick(record, "source_page", "sourcePage", "evidence_page", "evidencePage"))
        has_evidence = not _is_missing(_pick(record, "evidence", "text_snippet", "evidence_text"))
        fallback = 0.0
        if has_source:
            fallback += 0.14
        if has_page:
            fallback += 0.16
        if has_evidence:
            fallback += 0.18
        score = max(score, fallback)

    return max(0.0, min(1.0, score))


def _slot_grounding_score(record: Mapping[str, Any], field_map: Mapping[str, Any], keys: Iterable[str]) -> float:
    return max((_field_grounding_score(record, field_map, key) for key in keys), default=0.0)


def _condition_score(record: Mapping[str, Any], field_map: Mapping[str, Any]) -> float:
    captured = 0
    scored_keys = list(CONDITION_KEYS)
    for key in scored_keys:
        if not _is_missing(_field_value(record, key, field_map)):
            captured += 1

    has_structured_load = bool(_parse_json_object(_pick(record, "load_conditions", "loadConditions")))
    has_structured_speed = bool(_parse_json_object(_pick(record, "speed_conditions", "speedConditions")))
    has_system = bool(_parse_json_object(_pick(record, "tribological_system", "tribologicalSystem")))
    structured_bonus = sum(1 for item in (has_structured_load, has_structured_speed, has_system) if item)

    # Context is intentionally conservative: a few common conditions should
    # help, but they should not make most records look perfect.
    return max(0.0, min(1.0, (captured + structured_bonus * 0.5) / 6.0))


def _cof_quality(record: Mapping[str, Any], field_map: Mapping[str, Any]) -> tuple[float, list[tuple[str, float]]]:
    raw = _field_value(record, "cof", field_map)
    if _is_missing(raw):
        return 0.55, []

    penalties: list[tuple[str, float]] = []
    score = 0.92
    cof_float = _parse_float(_pick(record, "cof_value", "cofValue") if not _is_missing(_pick(record, "cof_value", "cofValue")) else raw)
    if cof_float is not None and (cof_float < 0 or cof_float > 1.5):
        score -= 0.45
        penalties.append(("cof_out_of_range", 0.09))
    elif cof_float is not None and cof_float > 1.0:
        score -= 0.15
        penalties.append(("cof_high_range", 0.03))

    combined = f"{_pick(record, 'cof_operator', 'cofOperator') or ''} {raw}".lower()
    if any(token in combined for token in ("<", ">", "~", "≈", "approx", "around", "about")):
        score -= 0.16
        penalties.append(("cof_uncertain", 0.032))

    extracted = _pick(record, "cof_extracted", "cofExtracted")
    if isinstance(extracted, str):
        extracted = _parse_json_object(extracted)
    if isinstance(extracted, Mapping) and extracted:
        score += 0.04

    return max(0.0, min(1.0, score)), penalties


def _diffusion_quality(record: Mapping[str, Any], field_map: Mapping[str, Any]) -> tuple[float, list[tuple[str, float]]]:
    values = [_parse_float(_field_value(record, key, field_map)) for key in DIFFUSION_COEFFICIENT_KEYS]
    present = [value for value in values if value is not None]
    if not present:
        return 0.45, []
    if any(value <= 0 for value in present):
        return 0.45, [("diffusion_nonpositive", 0.08)]
    score = 0.82 + min(0.18, 0.06 * len(present))
    if _is_missing(_field_value(record, "d_unit", field_map)):
        score -= 0.12
    return max(0.0, min(1.0, score)), []


def _chemistry_quality(record: Mapping[str, Any]) -> tuple[float, list[tuple[str, float]]]:
    lubricant = _field_value(record, "ionic_liquid")
    if _is_missing(lubricant):
        return 0.45, []
    if _looks_unknown(lubricant):
        return 0.55, [("unknown_lubricant", 0.04)]

    components = _pick(record, "lubricant_components", "lubricantComponents")
    cation = _pick(record, "cation")
    anion = _pick(record, "anion")
    smiles = _pick(record, "il_smiles", "ilSmiles", "smiles")
    has_pair = (not _is_missing(cation) and not _is_missing(anion)) or (
        isinstance(components, list) and len(components) > 0
    )
    if has_pair and not _is_missing(smiles):
        return 1.0, []
    if has_pair:
        return 0.93, []
    if re.search(r"\[[^\]]+\]\s*\[[^\]]+\]|\[[^\]]+\]\s*[A-Za-z0-9]", str(lubricant)):
        return 0.82, []
    return 0.68, [("unresolved_ionic_liquid", 0.032)]


def _value_quality_score(record: Mapping[str, Any], field_map: Mapping[str, Any]) -> tuple[float, list[tuple[str, float]]]:
    if _extractor_type(record) == "diffusion":
        metric_score, metric_penalties = _diffusion_quality(record, field_map)
    else:
        metric_score, metric_penalties = _cof_quality(record, field_map)
        if _is_missing(_field_value(record, "cof", field_map)) and _primary_metric_key(record, field_map) not in {None, "cof"}:
            metric_score = 0.78
            metric_penalties = []

    chemistry_score, chemistry_penalties = _chemistry_quality(record)
    temperature = _parse_float(_field_value(record, "temperature", field_map) or _field_value(record, "temperature_value", field_map))
    temp_score = 1.0
    penalties: list[tuple[str, float]] = [*metric_penalties, *chemistry_penalties]
    if temperature is not None and (temperature < -100 or temperature > 650):
        temp_score = 0.55
        penalties.append(("temperature_out_of_range", 0.04))

    panel_from_source = _extract_panel_letter(_pick(record, "source"))
    panel_from_figure = _extract_panel_letter(_pick(record, "source_figure", "sourceFigure"))
    panel_score = 1.0
    if panel_from_source and panel_from_figure and panel_from_source != panel_from_figure:
        panel_score = 0.4
        penalties.append(("panel_mismatch", 0.08))

    model_confidence = _parse_float(_pick(record, "model_confidence", "modelConfidence"))
    model_score = 1.0
    if model_confidence is not None and model_confidence < 0.65:
        model_score = max(0.55, model_confidence)
        penalties.append(("low_model_prior", 0.03))

    score = (metric_score * 0.46) + (chemistry_score * 0.30) + (temp_score * 0.10) + (panel_score * 0.10) + (model_score * 0.04)
    return max(0.0, min(1.0, score)), penalties


def _review_penalties(record: Mapping[str, Any], field_map: Mapping[str, Any]) -> list[tuple[str, float]]:
    penalties: list[tuple[str, float]] = []
    review_status = _lower(_pick(record, "review_status", "reviewStatus"))
    if review_status in {"flagged", "needs_evidence"}:
        penalties.append(("review_flagged", 0.08))
    elif review_status in {"rejected"}:
        penalties.append(("review_rejected", 0.18))

    for slot_name, keys in _required_slots(record, field_map):
        if any(_lower(_field_entry(field_map, key).get("review_state")) == "flagged" for key in keys):
            penalties.append((f"{slot_name}_flagged", 0.06))

    if any(tag in _lower(_pick(record, "value_origin", "valueOrigin")) for tag in ("infer", "estimated", "derived")):
        penalties.append(("model_inferred", 0.05))

    return penalties


def _review_score(record: Mapping[str, Any], field_map: Mapping[str, Any]) -> float:
    review_status = _lower(_pick(record, "review_status", "reviewStatus"))
    if review_status in {"approved", "accepted"}:
        status_score = 1.0
    elif review_status in {"flagged", "needs_evidence"}:
        status_score = 0.25
    elif review_status == "rejected":
        status_score = 0.0
    else:
        status_score = 0.78

    flagged_required = 0
    for _, keys in _required_slots(record, field_map):
        if any(_lower(_field_entry(field_map, key).get("review_state")) == "flagged" for key in keys):
            flagged_required += 1

    if flagged_required:
        status_score = min(status_score, max(0.0, 0.45 - 0.15 * (flagged_required - 1)))

    return max(0.0, min(1.0, status_score))


def _manual_review_ceiling(record: Mapping[str, Any], field_map: Mapping[str, Any]) -> tuple[float | None, str | None]:
    review_status = _lower(_pick(record, "review_status", "reviewStatus"))
    if review_status in {"approved", "accepted"}:
        return None, None
    if review_status in {"flagged", "needs_evidence"}:
        return 0.72, "review_flagged_ceiling"
    if review_status == "rejected":
        return 0.45, "review_rejected_ceiling"

    required_fields = [key for _, keys in _required_slots(record, field_map) for key in keys]
    confirmed_count = sum(
        1
        for key in required_fields
        if _lower(_field_entry(field_map, key).get("review_state")) == "confirmed"
    )
    if confirmed_count >= len(required_fields) and required_fields:
        return 0.94, "field_review_ceiling"
    if confirmed_count:
        return 0.92, "partial_review_ceiling"
    if review_status:
        return 0.89, "pending_review_ceiling"
    return 0.91, "unreviewed_ceiling"


def _component_penalties(
    record: Mapping[str, Any],
    field_map: Mapping[str, Any],
    completeness_scores: list[tuple[str, float]],
    grounding_scores: list[tuple[str, float]],
    condition_score: float,
    review_score: float,
) -> list[tuple[str, float]]:
    penalties: list[tuple[str, float]] = []

    completeness_share = COMPLETENESS_WEIGHT / max(1, len(completeness_scores))
    for name, score in completeness_scores:
        gap = round((1.0 - score) * completeness_share, 4)
        if gap <= 0:
            continue
        if name == "material":
            reason = "missing_material" if score == 0 else "weak_material"
        elif name == "ionic_liquid":
            reason = "missing_lubricant" if score == 0 else "weak_lubricant"
        elif name == "diffusion_coefficient":
            reason = "missing_diffusion_coefficient"
        else:
            reason = "missing_primary_metric"
        penalties.append((reason, gap))

    grounding_share = GROUNDING_WEIGHT / max(1, len(grounding_scores))
    for name, score in grounding_scores:
        gap = round((1.0 - score) * grounding_share, 4)
        if gap <= 0:
            continue
        if score == 0:
            reason = f"missing_{name}_grounding"
        elif score < 0.6:
            reason = f"partial_{name}_grounding"
        else:
            reason = f"weak_{name}_grounding"
        penalties.append((reason, gap))

    condition_gap = round((1.0 - condition_score) * CONTEXT_WEIGHT, 4)
    if condition_gap > 0:
        penalties.append(("sparse_conditions", condition_gap))

    review_gap = round((1.0 - review_score) * REVIEW_WEIGHT, 4)
    if review_gap > 0:
        penalties.append(("review_pending" if review_score >= 0.7 else "review_flagged", review_gap))

    return penalties


def _dedupe_penalties(items: Iterable[tuple[str, float]]) -> list[tuple[str, float]]:
    totals: dict[str, float] = {}
    for reason, value in items:
        if value <= 0:
            continue
        totals[reason] = totals.get(reason, 0.0) + float(value)
    return [(reason, round(value, 4)) for reason, value in totals.items() if value > 0]


def calculate_confidence_details(record: Dict[str, Any]) -> Dict[str, Any]:
    """
    Return a composite confidence score with a transparent breakdown.

    The model intentionally ignores a previously stored confidence as an
    authority. Stored or model-provided scores can be passed as weak inputs,
    but the returned score is recomputed from current values and evidence.
    """
    record = record or {}
    field_map = _field_map(record)
    required = _required_slots(record, field_map)

    completeness_scores = [
        (slot_name, _slot_presence_score(record, field_map, keys))
        for slot_name, keys in required
    ]
    grounding_scores = [
        (slot_name, _slot_grounding_score(record, field_map, keys))
        for slot_name, keys in required
    ]
    value_quality, value_penalties = _value_quality_score(record, field_map)
    condition_score = _condition_score(record, field_map)
    review_score = _review_score(record, field_map)

    penalties = _component_penalties(
        record,
        field_map,
        completeness_scores,
        grounding_scores,
        condition_score,
        review_score,
    )
    value_gap = round((1.0 - value_quality) * VALUE_QUALITY_WEIGHT, 4)
    if value_gap > 0:
        if value_penalties:
            total_hint = sum(max(0.0, float(value)) for _, value in value_penalties) or 1.0
            for reason, hint in value_penalties:
                penalties.append((reason, round(value_gap * (max(0.0, float(hint)) / total_hint), 4)))
        else:
            penalties.append(("value_quality_gap", value_gap))
    penalties = _dedupe_penalties(penalties)

    base_score = 1.0
    boosts: list[tuple[str, float]] = []

    score = base_score - sum(value for _, value in penalties) + sum(value for _, value in boosts)
    ceiling, ceiling_reason = _manual_review_ceiling(record, field_map)
    if ceiling is not None and score > ceiling:
        penalties.append((ceiling_reason or "manual_review_ceiling", round(score - ceiling, 4)))
        penalties = _dedupe_penalties(penalties)
        score = ceiling
    score = max(0.05, min(1.0, score))
    score = round(score, 4)
    percent = round(score * 100.0, 1)

    component_payload = {
        "completeness": round(sum(score for _, score in completeness_scores) / max(1, len(completeness_scores)), 4),
        "grounding": round(sum(score for _, score in grounding_scores) / max(1, len(grounding_scores)), 4),
        "value_quality": round(value_quality, 4),
        "context": round(condition_score, 4),
        "review": round(review_score, 4),
    }

    return {
        "version": "ioniclink.confidence.v2",
        "base_score": round(base_score, 4),
        "base_percent": round(base_score * 100.0, 1),
        "score": score,
        "percent": percent,
        "band": "high" if score >= 0.8 else "medium" if score >= 0.55 else "low",
        "components": component_payload,
        "required_slots": [
            {
                "name": name,
                "completeness": round(completeness, 4),
                "grounding": round(next((g for slot, g in grounding_scores if slot == name), 0.0), 4),
            }
            for name, completeness in completeness_scores
        ],
        "penalties": [{"reason": reason, "value": value} for reason, value in penalties],
        "boosts": [{"reason": reason, "value": value} for reason, value in boosts],
        "penalty_total": round(sum(value for _, value in penalties), 4),
        "penalty_percent": round(sum(value for _, value in penalties) * 100.0, 1),
        "boost_total": round(sum(value for _, value in boosts), 4),
        "boost_percent": round(sum(value for _, value in boosts) * 100.0, 1),
    }


def calculate_confidence(record: Dict[str, Any]) -> float:
    return float(calculate_confidence_details(record)["score"])


def calculate_batch_confidence(records: list) -> list:
    for record in records:
        record["confidence"] = calculate_confidence(record)
        record["confidence_details"] = calculate_confidence_details(record)
    return records
