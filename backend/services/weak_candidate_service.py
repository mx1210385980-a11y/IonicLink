from __future__ import annotations

import math
import re
from typing import Any

from knowledge_base import normalize_ionic_liquid


_EMPTY_VALUES = {
    "",
    "-",
    "--",
    "n/a",
    "na",
    "none",
    "null",
    "nan",
    "unknown",
    "unknown il",
    "unknown material",
}
_IMPORTANT_FIELDS = ("ionic_liquid", "material_name", "cof", "normal_load", "speed")
_FIELD_ALIASES = {
    "ionic_liquid": ("ionic_liquid", "lubricant"),
    "material_name": ("material_name", "probe_material", "substrate_material"),
    "cof": ("cof", "cof_raw", "cof_extracted"),
    "normal_load": ("normal_load", "load"),
    "speed": ("speed", "sliding_speed"),
}


def _text(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def _looks_like_reference_marker_value(value: Any) -> bool:
    text = _text(value)
    if not text:
        return False
    pair = re.fullmatch(r"\[([^\[\]]+)\]\[([^\[\]]+)\]", text)
    if pair:
        left, right = pair.group(1).strip(), pair.group(2).strip()
        common_words = {
            "and", "as", "at", "by", "for", "from", "in", "into", "near",
            "of", "on", "or", "the", "to", "with", "without", "beneficial",
            "previously",
        }
        if left.isdigit():
            return True
        if (
            left.isalpha()
            and right.isalpha()
            and left.islower()
            and right.islower()
            and (left in common_words or right in common_words)
        ):
            return True
    return bool(
        re.fullmatch(r"\[\d{1,4}\]\[[A-Za-z]{2,24}\]", text)
        or re.fullmatch(r"\[\d{1,4}\]", text)
    )


def _has_value(value: Any) -> bool:
    return _text(value).lower() not in _EMPTY_VALUES and not _looks_like_reference_marker_value(value)


def _extract_il_from_context(item: dict[str, Any]) -> str:
    context = " ".join(
        _text(item.get(key))
        for key in (
            "ionic_liquid",
            "lubricant",
            "material_name",
            "substrate_material",
            "evidence",
            "notes",
            "source",
            "source_figure",
            "sample_id",
        )
    )
    for hit in re.findall(r"(\[[^\[\]]+?\]\s*\[[^\[\]]+?\])", context):
        token = re.sub(r"\s+", "", hit)
        if _looks_like_reference_marker_value(token):
            continue
        normalized = normalize_ionic_liquid(token) or token
        if _has_value(normalized):
            return normalized
    return ""


def _first_value(item: dict[str, Any], *keys: str) -> Any:
    for key in keys:
        value = item.get(key)
        if _has_value(value):
            return value
    return None


def _has_performance_signal(item: dict[str, Any]) -> bool:
    if _first_value(
        item,
        "cof",
        "cof_raw",
        "cof_extracted",
        "friction_force",
        "normal_load",
        "load",
        "wear_rate",
        "wear",
    ) is not None:
        return True

    combined = " ".join(
        _text(item.get(key)).lower() for key in ("evidence", "notes", "source")
    )
    return any(
        token in combined
        for token in ("coefficient of friction", "friction", "cof", "wear", "load")
    )


def _has_context_signal(item: dict[str, Any]) -> bool:
    if _first_value(
        item,
        "ionic_liquid",
        "lubricant",
        "material_name",
        "probe_material",
        "substrate_material",
    ):
        return True

    combined = " ".join(
        _text(item.get(key)).lower()
        for key in ("evidence", "notes", "source", "source_figure")
    )
    return any(
        token in combined
        for token in (
            "afm",
            "sfa",
            "tribometer",
            "ball-on-disk",
            "colloid probe",
            "graphene",
            "graphite",
            "mica",
            "steel",
        )
    )


def _missing_fields(item: dict[str, Any]) -> list[str]:
    missing: list[str] = []
    for field in _IMPORTANT_FIELDS:
        if not any(_has_value(item.get(key)) for key in _FIELD_ALIASES[field]):
            missing.append(field)
    return missing


def _quality_notes(missing: list[str]) -> str:
    if not missing:
        return "Candidate was admitted for review from weak extraction evidence."

    labels = {
        "ionic_liquid": "ionic liquid",
        "material_name": "material",
        "cof": "COF",
        "normal_load": "load",
        "speed": "sliding speed",
    }
    readable = [labels.get(field, field) for field in missing]
    if len(readable) == 1:
        missing_text = readable[0]
    else:
        missing_text = ", ".join(readable[:-1]) + f" and {readable[-1]}"
    return f"Candidate was admitted for review, but {missing_text} were not confirmed."


def _safe_confidence(value: Any) -> float:
    try:
        confidence = float(value)
    except (TypeError, ValueError):
        return 0.52
    if not math.isfinite(confidence):
        return 0.52
    if confidence < 0:
        return 0.52
    return min(confidence, 0.52)


def _load_looks_like_ratio_or_cof_noise(value: Any, item: dict[str, Any]) -> bool:
    load_text = _text(value).replace("−", "-").replace("–", "-")
    if not load_text:
        return False
    context = " ".join(
        _text(item.get(key))
        for key in ("evidence", "notes", "source", "source_figure", "regime", "assembly_notes")
    )
    normalized_context = context.replace("−", "-").replace("–", "-").lower()
    has_explicit_load_context = bool(re.search(r"\b(?:normal\s+)?load\b|\bforce\b", normalized_context))
    if has_explicit_load_context:
        return False

    if re.search(r"\b(?:molar\s+)?ratio\b|\bil\s*:\s*c", normalized_context, flags=re.IGNORECASE):
        if re.fullmatch(r"\d+(?:\.\d+)?\s*-\s*\d+(?:\.\d+)?\s*(?:nN|µN|μN|uN|mN|N)", load_text, flags=re.IGNORECASE):
            return True

    descending_range = re.fullmatch(
        r"(?P<first>\d+(?:\.\d+)?)\s*-\s*(?P<second>\d+(?:\.\d+)?)\s*(?:nN|µN|μN|uN|mN|N)",
        load_text,
        flags=re.IGNORECASE,
    )
    if descending_range and float(descending_range.group("second")) < float(descending_range.group("first")):
        return True

    if re.search(r"\b(?:friction\s+)?coefficients?\b|\bcof\b", normalized_context):
        if re.fullmatch(r"10\s*-\s*\d+\s*(?:nN|µN|μN|uN|mN|N|AFM)?", load_text, flags=re.IGNORECASE):
            return True

    return False


def _discard_spurious_load_fields(item: dict[str, Any]) -> None:
    load_value = _first_value(item, "normal_load", "load", "load_value", "load_raw")
    if not _load_looks_like_ratio_or_cof_noise(load_value, item):
        return
    for key in (
        "normal_load",
        "load",
        "load_value",
        "load_raw",
        "load_conditions",
        "loadConditions",
        "load_conditions_json",
    ):
        item.pop(key, None)


def _candidate_source(trace: dict[str, Any], item: dict[str, Any]) -> dict[str, Any]:
    return {
        "page": item.get("source_page"),
        "label": item.get("source_figure") or item.get("source"),
        "source_type": trace.get("modality") or "text",
    }


def _dedupe_key(item: dict[str, Any]) -> tuple[str, str, str, str]:
    metric = _first_value(
        item, "cof", "cof_raw", "cof_extracted", "friction_force", "normal_load"
    )
    return (
        _text(item.get("ionic_liquid")).lower(),
        _text(item.get("material_name")).lower(),
        _text(metric).lower(),
        _text(item.get("source_page")),
    )


def build_weak_candidate_items(
    trace_candidates: list[dict[str, Any]], *, limit: int = 50
) -> tuple[list[dict[str, Any]], dict[str, int]]:
    weak_items: list[dict[str, Any]] = []
    seen: set[tuple[str, str, str, str]] = set()
    if limit <= 0:
        return weak_items, {"weak_candidate_count": 0}

    for trace in trace_candidates or []:
        item = dict(trace.get("normalized") or trace.get("raw") or {})
        if not item:
            continue
        if not _has_performance_signal(item) or not _has_context_signal(item):
            continue

        ionic_liquid = _first_value(item, *_FIELD_ALIASES["ionic_liquid"]) or _extract_il_from_context(item)
        if not _has_value(ionic_liquid):
            continue
        item["ionic_liquid"] = ionic_liquid
        _discard_spurious_load_fields(item)
        item["material_name"] = (
            _first_value(item, *_FIELD_ALIASES["material_name"]) or "Unknown Material"
        )
        if not _has_value(item.get("source_page")):
            item["source_page"] = trace.get("page")
        if not _has_value(item.get("source")):
            item["source"] = item.get("source_figure") or "Extracted weak candidate"

        dedupe_key = _dedupe_key(item)
        if dedupe_key in seen:
            continue
        seen.add(dedupe_key)

        missing = _missing_fields(item)
        item.update(
            {
                "record_origin": "weak_candidate",
                "review_status": "needs_review",
                "confidence": _safe_confidence(item.get("confidence")),
                "confidence_tier": "low",
                "admission_reason": "weak_candidate",
                "missing_fields": missing,
                "quality_notes": _quality_notes(missing),
                "weak_candidate_source": _candidate_source(trace, item),
            }
        )
        weak_items.append(item)
        if len(weak_items) >= limit:
            break

    return weak_items, {"weak_candidate_count": len(weak_items)}
