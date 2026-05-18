from __future__ import annotations

import json
import re
import unicodedata
from typing import Any

from models.diffusion import DiffusionRecord
from services.chemistry.rdkit_feature_service import enrich_diffusion_record
from utils.pdf_coords import find_evidence_coordinates

_SUPERSCRIPT_TRANSLATION = str.maketrans(
    {
        "\u2070": "0",
        "\u00b9": "1",
        "\u00b2": "2",
        "\u00b3": "3",
        "\u2074": "4",
        "\u2075": "5",
        "\u2076": "6",
        "\u2077": "7",
        "\u2078": "8",
        "\u2079": "9",
        "\u207b": "-",
        "\u207a": "+",
        "\u2080": "0",
        "\u2081": "1",
        "\u2082": "2",
        "\u2083": "3",
        "\u2084": "4",
        "\u2085": "5",
        "\u2086": "6",
        "\u2087": "7",
        "\u2088": "8",
        "\u2089": "9",
        "\u208b": "-",
        "\u208a": "+",
        "\u2212": "-",
        "\u2013": "-",
        "\u2014": "-",
    }
)

_CANONICAL_DIFFUSION_UNIT = "10\u207b\u00b9\u00b2 m\u00b2/s"

_IL_TOKEN_RE = re.compile(
    r"(\[[^\]]+\]\s*\[[^\]]+\]|"
    r"\b(?:bmim|emim|hmim|omim|mim|pyr\d*|pyrr|pyrrolidinium|imidazolium|phosphonium|ammonium|"
    r"tfsi|ntf2|bf4|pf6|fap|dca|no3|ethylammonium|ean|pan|pil|mpil)\b)",
    flags=re.IGNORECASE,
)

_COMMON_NON_IL_SOLUTES_RE = re.compile(
    r"\b(?:nacl|kcl|licl|lacl3|mgcl2|cacl2|hcl|naoh|koh|water|aqueous|brine|salt solution)\b",
    flags=re.IGNORECASE,
)


def _normalize_unicode_text(value: Any) -> str:
    text = unicodedata.normalize("NFKC", str(value or "").strip())
    text = text.translate(_SUPERSCRIPT_TRANSLATION)
    text = text.replace("\u00d7", "x")
    text = text.replace("\u22c5", "/").replace("\u00b7", "/")
    return text


def _to_float(value: Any) -> float | None:
    if value in (None, ""):
        return None
    if isinstance(value, (int, float)):
        return float(value)

    text = _normalize_unicode_text(value)
    sci_match = re.search(
        r"([-+]?\d+(?:\.\d+)?)\s*(?:x|\*)\s*10\s*(?:\^)?\s*([-+]?\d+)",
        text,
        flags=re.IGNORECASE,
    )
    if sci_match:
        try:
            return float(sci_match.group(1)) * (10 ** int(sci_match.group(2)))
        except Exception:
            pass

    match = re.search(r"[-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?", text)
    if not match:
        return None
    try:
        return float(match.group(0))
    except Exception:
        return None


def _compact_diffusion_unit(unit: Any) -> str:
    normalized_unit = _normalize_unicode_text(unit).lower()
    compact = normalized_unit.replace(" ", "")
    compact = compact.replace("*", "/")
    compact = compact.replace("ångström", "a")
    compact = compact.replace("ångstrom", "a")
    compact = compact.replace("angstrom", "a")
    compact = compact.replace("å", "a")
    return compact


def _diffusion_unit_scale_to_canonical(unit: Any) -> float | None:
    compact = _compact_diffusion_unit(unit)

    if compact in {"a2/ps-1", "a^2/ps-1", "a2ps-1", "a^2ps-1", "a2/ps", "a^2/ps", "a2ps", "a^2ps"}:
        return 1.0e4
    if compact in {"a2/ns-1", "a^2/ns-1", "a2ns-1", "a^2ns-1", "a2/ns", "a^2/ns", "a2ns", "a^2ns"}:
        return 10.0
    if compact in {"m2/s", "m^2/s", "m2s-1", "m^2s-1"}:
        return 1.0e12
    if compact in {"cm2/s", "cm^2/s", "cm2s-1", "cm^2s-1"}:
        return 1.0e8

    power_match = re.fullmatch(
        r"(?:10(?:\^)?(?P<power>-?\d+)|1e(?P<epower>-?\d+))m\^?2(?:/s|s-1)",
        compact,
    )
    if power_match:
        exponent = int(power_match.group("power") or power_match.group("epower"))
        return 10 ** (exponent + 12)

    power_match = re.fullmatch(
        r"(?:10(?:\^)?(?P<power>-?\d+)|1e(?P<epower>-?\d+))cm\^?2(?:/s|s-1)",
        compact,
    )
    if power_match:
        exponent = int(power_match.group("power") or power_match.group("epower"))
        return 10 ** (exponent + 16)

    return None


def _is_supported_diffusion_unit(unit: Any) -> bool:
    return _diffusion_unit_scale_to_canonical(unit) is not None


def _normalize_diffusion_unit_and_value(value: Any, unit: Any) -> tuple[float | None, str | None]:
    numeric = _to_float(value)
    if numeric is None:
        return None, None

    scale = _diffusion_unit_scale_to_canonical(unit)
    if scale is None:
        return round(float(numeric), 12), None
    return round(float(numeric) * scale, 12), _CANONICAL_DIFFUSION_UNIT


def _extract_diffusion_measure_from_text(text: Any) -> tuple[float | None, str | None]:
    measures = _extract_diffusion_measures_from_text(text)
    if not measures:
        return None, None
    return measures[0]["value"], measures[0]["unit"]


def _extract_diffusion_measures_from_text(text: Any) -> list[dict[str, Any]]:
    normalized = _normalize_unicode_text(text)
    if not normalized:
        return []

    measures: list[dict[str, Any]] = []

    sci_pattern = re.compile(
        r"\(?\s*([-+]?\d+(?:\.\d+)?)"
        r"(?:\s*(?:±|\+/-)\s*[-+]?\d+(?:\.\d+)?)?"
        r"\s*\)?\s*(?:x|\*)\s*10\s*(?:\^)?\s*([-+]?\d+)\s*"
        r"((?:10\s*(?:\^)?\s*-?\d+\s*)?(?:m|cm|a|A|Å|å|angstrom|Angstrom)\s*(?:\^?2|2)\s*(?:/|/?s)?\s*(?:s|ps|ns)?\s*(?:-?1)?)",
        flags=re.IGNORECASE,
    )
    for match in sci_pattern.finditer(normalized):
        try:
            raw_value = float(match.group(1)) * (10 ** int(match.group(2)))
        except Exception:
            continue
        unit = match.group(3).strip()
        normalized_value, normalized_unit = _normalize_diffusion_unit_and_value(raw_value, unit)
        if normalized_value is None or not normalized_unit:
            continue
        measures.append(
            {
                "value": normalized_value,
                "unit": normalized_unit,
                "start": match.start(),
                "end": match.end(),
                "context": normalized[max(0, match.start() - 90): min(len(normalized), match.end() + 90)].lower(),
                "prefix": normalized[max(0, match.start() - 90): match.start()].lower(),
                "suffix": normalized[match.end(): min(len(normalized), match.end() + 90)].lower(),
            }
        )

    plain_pattern = re.compile(
        r"([-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?)\s*"
        r"((?:10\s*(?:\^)?\s*-?\d+\s*)?(?:m|cm|a|A|Å|å|angstrom|Angstrom)\s*(?:\^?2|2)\s*(?:/|/?s)?\s*(?:s|ps|ns)?\s*(?:-?1)?)",
        flags=re.IGNORECASE,
    )
    for match in plain_pattern.finditer(normalized):
        if any(match.start() >= item["start"] and match.end() <= item["end"] for item in measures):
            continue
        normalized_value, normalized_unit = _normalize_diffusion_unit_and_value(match.group(1), match.group(2))
        if normalized_value is None or not normalized_unit:
            continue
        measures.append(
            {
                "value": normalized_value,
                "unit": normalized_unit,
                "start": match.start(),
                "end": match.end(),
                "context": normalized[max(0, match.start() - 90): min(len(normalized), match.end() + 90)].lower(),
                "prefix": normalized[max(0, match.start() - 90): match.start()].lower(),
                "suffix": normalized[match.end(): min(len(normalized), match.end() + 90)].lower(),
            }
        )

    return sorted(measures, key=lambda item: item["start"])


def _pick_evidence_measure_for_field(measures: list[dict[str, Any]], field_key: str) -> dict[str, Any] | None:
    if not measures:
        return None
    field_terms = {
        "D_cation": ("cation", "cationic", "positive ion"),
        "D_anion": ("anion", "anionic", "negative ion", "cl-", "cl−"),
        "D_total": ("total", "self-diffusion", "self diffusion", "diffusion coefficient"),
    }.get(field_key, ())
    if not field_terms:
        return None
    best: tuple[int, int, dict[str, Any]] | None = None
    ion_terms = ("cation", "cationic", "anion", "anionic", "positive ion", "negative ion")
    for index, measure in enumerate(measures):
        prefix = str(measure.get("prefix") or "")
        suffix = str(measure.get("suffix") or "")
        prefix_score = max((prefix.rfind(term) for term in field_terms), default=-1)
        suffix_score = 1 if any(term in suffix[:36] for term in field_terms) else 0
        if field_key == "D_total" and any(term in prefix[-48:] for term in ion_terms):
            continue
        score = max(prefix_score, -1) * 10 + suffix_score
        if score < 0:
            continue
        if best is None or score > best[0]:
            best = (score, -index, measure)
    return best[2] if best else None


def _looks_like_ionic_liquid(value: Any) -> bool:
    return bool(_IL_TOKEN_RE.search(str(value or "")))


def _is_non_ionic_liquid_solute(value: Any) -> bool:
    text = str(value or "").strip()
    if not text:
        return False
    return bool(_COMMON_NON_IL_SOLUTES_RE.search(text)) and not _looks_like_ionic_liquid(text)


def diffusion_drop_reason(record: dict[str, Any]) -> str | None:
    if not isinstance(record, dict):
        return "invalid_payload"
    if not record_has_diffusion_value(record):
        return "no_diffusion_value"
    if _is_non_ionic_liquid_solute(record.get("ionic_liquid")):
        return "non_ionic_liquid_solute"
    unit = record.get("D_unit")
    if unit and not _is_supported_diffusion_unit(unit) and not _extract_diffusion_measures_from_text(record.get("evidence")):
        return "unsupported_diffusion_unit"
    return None


def record_has_diffusion_value(record: dict[str, Any]) -> bool:
    return any(_to_float(record.get(key)) is not None for key in ("D_total", "D_cation", "D_anion"))


def _resolve_source_bbox(pdf_path: str | None, row: dict[str, Any]) -> tuple[int | None, list[float] | None]:
    if not pdf_path:
        return None, None
    evidence = str(row.get("evidence") or "").strip()
    page_hint = row.get("source_page")
    page_num, bbox = find_evidence_coordinates(
        pdf_path,
        evidence,
        page_hint=int(page_hint) if str(page_hint or "").isdigit() else None,
        restrict_to_page_hint=bool(page_hint),
    )
    return page_num, bbox


def _confidence_from_row(row: dict[str, Any]) -> float:
    score = 0.5
    if record_has_diffusion_value(row):
        score += 0.2
    if row.get("source"):
        score += 0.1
    if row.get("source_page"):
        score += 0.1
    if row.get("evidence"):
        score += 0.1
    return round(min(score, 0.95), 3)


def _diffusion_source_type(row: dict[str, Any]) -> str | None:
    source = str(row.get("source") or "").strip().lower()
    if not source:
        return "text" if row.get("source_page") else None
    if source.startswith("table"):
        return "table"
    if source.startswith(("fig", "image", "plot")):
        return "figure"
    return "text"


def _format_field_value(value: Any) -> Any:
    if isinstance(value, float):
        return float(f"{value:.6g}")
    return value


def build_diffusion_field_evidence_map(row: dict[str, Any]) -> dict[str, Any]:
    evidence = {
        "source_type": _diffusion_source_type(row),
        "page": row.get("source_page"),
        "source_label": row.get("source"),
        "quote": row.get("evidence"),
        "bbox": row.get("source_bbox"),
    }
    confidence = row.get("confidence")

    def _entry(field_key: str) -> dict[str, Any]:
        return {
            "value": _format_field_value(row.get(field_key)),
            "confidence": confidence,
            "evidence": evidence,
            "review_state": None,
            "review_note": None,
        }

    return {
        "system_name": _entry("system_name"),
        "confinement_material_class": _entry("confinement_material_class"),
        "confinement_geometry_class": _entry("confinement_geometry_class"),
        "surface_functional_groups": _entry("surface_functional_groups"),
        "confinement_dimensionality": _entry("confinement_dimensionality"),
        "ionic_liquid": _entry("ionic_liquid"),
        "d_total": _entry("D_total"),
        "d_cation": _entry("D_cation"),
        "d_anion": _entry("D_anion"),
        "d_unit": _entry("D_unit"),
        "temperature_value": _entry("temperature_value"),
        "confinement_scale_value": _entry("confinement_scale_value"),
        "confinement_scale_unit": _entry("confinement_scale_unit"),
        "source_page": {
            "value": f"Page {row.get('source_page')}" if row.get("source_page") else None,
            "confidence": confidence,
            "evidence": evidence,
            "review_state": None,
            "review_note": None,
        },
    }


def normalize_diffusion_records(
    rows: list[dict[str, Any]],
    *,
    pdf_path: str | None,
    provider: str,
    prompt_version: str,
    raw_model_output: str,
) -> list[dict[str, Any]]:
    normalized: list[dict[str, Any]] = []
    for raw in rows or []:
        if not isinstance(raw, dict):
            continue
        row = dict(raw)
        if diffusion_drop_reason(row):
            continue

        d_unit = row.get("D_unit")
        evidence_measures = _extract_diffusion_measures_from_text(row.get("evidence"))
        row["D_total"], d_unit = _normalize_diffusion_unit_and_value(row.get("D_total"), d_unit)
        row["D_cation"], d_unit = _normalize_diffusion_unit_and_value(row.get("D_cation"), d_unit)
        row["D_anion"], d_unit = _normalize_diffusion_unit_and_value(row.get("D_anion"), d_unit)
        row["D_unit"] = d_unit

        for key in ("D_total", "D_cation", "D_anion"):
            evidence_measure = _pick_evidence_measure_for_field(evidence_measures, key)
            if evidence_measure:
                row[key] = evidence_measure["value"]
                row["D_unit"] = evidence_measure["unit"]

        if not row.get("D_unit") and len(evidence_measures) == 1:
            populated_fields = [key for key in ("D_total", "D_cation", "D_anion") if row.get(key) is not None]
            if len(populated_fields) == 1:
                row[populated_fields[0]] = evidence_measures[0]["value"]
                row["D_unit"] = evidence_measures[0]["unit"]

        if not row.get("D_unit") or not record_has_diffusion_value(row):
            continue

        row["temperature_value"] = _to_float(row.get("temperature_value"))
        row["confinement_scale_value"] = _to_float(row.get("confinement_scale_value"))

        source_page = row.get("source_page")
        if source_page not in (None, ""):
            try:
                row["source_page"] = int(source_page)
            except Exception:
                row["source_page"] = None

        novel_features = row.pop("novel_features", None)
        row["novel_features_json"] = novel_features if isinstance(novel_features, dict) else {}
        row["provider"] = provider
        row["prompt_version"] = prompt_version
        row["raw_model_output"] = raw_model_output
        row["review_status"] = row.get("review_status") or "pending_review"
        row["record_origin"] = row.get("record_origin") or "diffusion_llm_extraction"

        bbox_page, bbox = _resolve_source_bbox(pdf_path, row)
        if bbox_page and not row.get("source_page"):
            row["source_page"] = bbox_page
        row["source_bbox"] = bbox
        row["confidence"] = _confidence_from_row(row)
        row = enrich_diffusion_record(row)
        row["field_evidence_json"] = build_diffusion_field_evidence_map(row)
        row["assembly_notes"] = row.get("assembly_notes")

        model = DiffusionRecord.model_validate(row)
        normalized.append(
            {
                "system_name": model.system_name,
                "confinement_material_class": model.confinement_material_class,
                "confinement_geometry_class": model.confinement_geometry_class,
                "surface_functional_groups": model.surface_functional_groups,
                "confinement_dimensionality": model.confinement_dimensionality,
                "ionic_liquid": model.ionic_liquid,
                "D_total": model.d_total,
                "D_cation": model.d_cation,
                "D_anion": model.d_anion,
                "D_unit": model.d_unit,
                "temperature_value": model.temperature_value,
                "confinement_scale_value": model.confinement_scale_value,
                "confinement_scale_unit": model.confinement_scale_unit,
                "source": model.source,
                "source_page": model.source_page,
                "source_bbox": model.source_bbox,
                "evidence": model.evidence,
                "provider": model.provider,
                "prompt_version": model.prompt_version,
                "raw_model_output": model.raw_model_output,
                "field_evidence_json": model.field_evidence_json,
                "review_status": model.review_status,
                "record_origin": model.record_origin,
                "assembly_notes": model.assembly_notes,
                "confidence": model.confidence,
                "novel_features_json": model.novel_features_json,
                "smiles": model.smiles,
                "rdkit_features_json": model.rdkit_features_json,
            }
        )
    return normalized


def _normalized_diffusion_signature(row: dict[str, Any]) -> tuple[Any, ...]:
    def _text(value: Any) -> str:
        return str(value or "").strip().lower()

    def _number(value: Any) -> float | None:
        numeric = _to_float(value)
        return round(float(numeric), 12) if numeric is not None else None

    return (
        _text(row.get("system_name")),
        _text(row.get("ionic_liquid")),
        _text(row.get("source")),
        int(row.get("source_page")) if row.get("source_page") not in (None, "") else None,
        _number(row.get("D_total")),
        _number(row.get("D_cation")),
        _number(row.get("D_anion")),
        _number(row.get("temperature_value")),
        _number(row.get("confinement_scale_value")),
    )


def _merge_diffusion_rows(base: dict[str, Any], incoming: dict[str, Any]) -> dict[str, Any]:
    merged = dict(base)
    for key, value in incoming.items():
        if key in {"novel_features_json", "rdkit_features_json", "field_evidence_json"}:
            current_payload = merged.get(key) if isinstance(merged.get(key), dict) else {}
            incoming_payload = value if isinstance(value, dict) else {}
            merged[key] = {**current_payload, **incoming_payload}
            continue
        if merged.get(key) in (None, "", [], {}) and value not in (None, "", [], {}):
            merged[key] = value

    merged["confidence"] = max(float(base.get("confidence") or 0.0), float(incoming.get("confidence") or 0.0))
    return merged


def dedupe_normalized_diffusion_records(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    deduped: dict[tuple[Any, ...], dict[str, Any]] = {}
    ordered_keys: list[tuple[Any, ...]] = []

    for row in rows or []:
        signature = _normalized_diffusion_signature(row)
        if signature not in deduped:
            deduped[signature] = dict(row)
            ordered_keys.append(signature)
            continue
        deduped[signature] = _merge_diffusion_rows(deduped[signature], row)

    return [deduped[key] for key in ordered_keys]


def build_feature_set_payload(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "ionic_liquid": row.get("ionic_liquid"),
        "smiles": row.get("smiles"),
        "rdkit_features_json": row.get("rdkit_features_json") or {},
    }


def serialize_diffusion_row_for_response(row: dict[str, Any], *, row_id: int | None = None) -> dict[str, Any]:
    payload = dict(row)
    if row_id is not None:
        payload["id"] = str(row_id)
    payload["extractor_type"] = "diffusion"
    payload["field_evidence_json"] = payload.get("field_evidence_json") or {}
    payload["novel_features_json"] = payload.get("novel_features_json") or {}
    payload["rdkit_features_json"] = payload.get("rdkit_features_json") or {}
    return payload


def json_dumps(value: Any) -> str | None:
    if value is None:
        return None
    return json.dumps(value, ensure_ascii=False)
