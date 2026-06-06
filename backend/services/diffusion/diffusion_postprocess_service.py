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

_STANDARD_FIELDS_VERSION = "diffusion.standard.v1"
_NORMALIZATION_VERSION = "diffusion.normalization.v1"


def _normalize_unicode_text(value: Any) -> str:
    text = unicodedata.normalize("NFKC", str(value or "").strip())
    text = text.translate(_SUPERSCRIPT_TRANSLATION)
    text = text.replace("\u00d7", "x")
    text = text.replace("\u22c5", "/").replace("\u00b7", "/")
    return text


def _normalize_exponent_label(value: Any) -> str:
    return re.sub(r"\s+", "", _normalize_unicode_text(value))


def _to_float(value: Any) -> float | None:
    if value in (None, ""):
        return None
    if isinstance(value, (int, float)):
        return float(value)

    text = _normalize_unicode_text(value)
    sci_match = re.search(
        r"([-+]?\d+(?:\.\d+)?)\s*(?:x|\*)\s*10\s*(?:\^\s*)?([-+]?\s*\d+)",
        text,
        flags=re.IGNORECASE,
    )
    if sci_match:
        try:
            return float(sci_match.group(1)) * (10 ** int(_normalize_exponent_label(sci_match.group(2))))
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


def _is_figure_source(record: dict[str, Any]) -> bool:
    source = str(_first_present(record.get("source"), record.get("source_figure")) or "").strip().lower()
    return source.startswith(("fig", "figure", "image", "plot"))


def _normalize_diffusion_unit_and_value(value: Any, unit: Any) -> tuple[float | None, str | None]:
    numeric = _to_float(value)
    if numeric is None:
        return None, None

    scale = _diffusion_unit_scale_to_canonical(unit)
    if scale is None:
        return round(float(numeric), 12), None
    return round(float(numeric) * scale, 12), _CANONICAL_DIFFUSION_UNIT


def _diffusion_values_close(left: Any, right: Any) -> bool:
    left_num = _to_float(left)
    right_num = _to_float(right)
    if left_num is None or right_num is None:
        return False
    tolerance = max(1e-9, abs(float(right_num)) * 0.015)
    return abs(float(left_num) - float(right_num)) <= tolerance


def _has_nonpositive_diffusion_value(record: dict[str, Any]) -> bool:
    for key in ("D_total", "D_cation", "D_anion"):
        numeric = _to_float(record.get(key))
        if numeric is not None and numeric <= 0:
            return True
    return False


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
        r"\s*\)?\s*(?:x|\*)\s*10\s*(?:\^\s*)?([-+]?\s*\d+)\s*"
        r"((?:10\s*(?:\^\s*)?[-+]?\s*\d+\s*)?(?:m|cm|a|A|Å|å|angstrom|Angstrom)\s*(?:\^?2|2)\s*(?:/|/?s)?\s*(?:s|ps|ns)?\s*(?:-?1)?)",
        flags=re.IGNORECASE,
    )
    for match in sci_pattern.finditer(normalized):
        exponent = _normalize_exponent_label(match.group(2))
        try:
            raw_value = float(match.group(1)) * (10 ** int(exponent))
        except Exception:
            continue
        if raw_value <= 0:
            continue
        unit = match.group(3).strip()
        normalized_value, normalized_unit = _normalize_diffusion_unit_and_value(raw_value, unit)
        if normalized_value is None or normalized_value <= 0 or not normalized_unit:
            continue
        measures.append(
            {
                "value": normalized_value,
                "unit": normalized_unit,
                "raw_text": match.group(0).strip(),
                "raw_value_label": f"{match.group(1)} x 10^{exponent}",
                "raw_unit": unit,
                "start": match.start(),
                "end": match.end(),
                "context": normalized[max(0, match.start() - 90): min(len(normalized), match.end() + 90)].lower(),
                "prefix": normalized[max(0, match.start() - 90): match.start()].lower(),
                "suffix": normalized[match.end(): min(len(normalized), match.end() + 90)].lower(),
            }
        )

    plain_pattern = re.compile(
        r"([-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?)\s*"
        r"((?:10\s*(?:\^\s*)?[-+]?\s*\d+\s*)?(?:m|cm|a|A|Å|å|angstrom|Angstrom)\s*(?:\^?2|2)\s*(?:/|/?s)?\s*(?:s|ps|ns)?\s*(?:-?1)?)",
        flags=re.IGNORECASE,
    )
    for match in plain_pattern.finditer(normalized):
        if any(match.start() >= item["start"] and match.end() <= item["end"] for item in measures):
            continue
        numeric = _to_float(match.group(1))
        if numeric is None or numeric <= 0:
            continue
        normalized_value, normalized_unit = _normalize_diffusion_unit_and_value(match.group(1), match.group(2))
        if normalized_value is None or not normalized_unit:
            continue
        measures.append(
            {
                "value": normalized_value,
                "unit": normalized_unit,
                "raw_text": match.group(0).strip(),
                "raw_value_label": match.group(1).strip(),
                "raw_unit": match.group(2).strip(),
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
        "D_total": ("total", "d_tot", "d tot", "self-diffusion", "self diffusion", "diffusion coefficient"),
    }.get(field_key, ())
    if not field_terms:
        return None
    best: tuple[int, int, dict[str, Any]] | None = None
    ion_terms = ("cation", "cationic", "anion", "anionic", "positive ion", "negative ion")
    for index, measure in enumerate(measures):
        prefix = str(measure.get("prefix") or "")
        suffix = str(measure.get("suffix") or "")
        immediate_suffix = re.split(r"[-+]?\d+(?:\.\d+)?\s*(?:x|\*)\s*10", suffix, maxsplit=1)[0][:72]
        if any(re.search(rf"\b(?:for|as)\s+(?:the\s+)?{re.escape(term)}\b", immediate_suffix) for term in field_terms):
            candidate = (100000 - index, -index, measure)
            if best is None or candidate[0] > best[0]:
                best = candidate
            continue
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


def _source_value_payload(measure: dict[str, Any]) -> dict[str, Any]:
    return {
        "raw_text": measure.get("raw_text"),
        "raw_value": measure.get("raw_value_label"),
        "raw_unit": measure.get("raw_unit"),
        "canonical_value": measure.get("value"),
        "canonical_unit": measure.get("unit"),
    }


def _looks_like_ionic_liquid(value: Any) -> bool:
    return bool(_IL_TOKEN_RE.search(str(value or "")))


def _is_non_ionic_liquid_solute(value: Any) -> bool:
    text = str(value or "").strip()
    if not text:
        return False
    return bool(_COMMON_NON_IL_SOLUTES_RE.search(text)) and not _looks_like_ionic_liquid(text)


def _json_dict(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return dict(value)
    if isinstance(value, str):
        try:
            loaded = json.loads(value)
            return loaded if isinstance(loaded, dict) else {}
        except Exception:
            return {}
    return {}


def _first_present(*values: Any) -> Any:
    for value in values:
        if value not in (None, "", [], {}):
            return value
    return None


def _subscript_digits(value: Any) -> str:
    return str(value).translate(str.maketrans({"0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄", "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉"}))


def _format_ion_label(value: Any, *, default_charge: str | None = None) -> str | None:
    text = _normalize_unicode_text(value)
    if not text:
        return None
    lower_text = text.lower()
    if any(term in lower_text for term in ("cation", "anion", "phosphonium", "imidazolium", "ammonium")):
        return text.replace("-", "−")
    compact = re.sub(r"[\s\[\]_\-]+", "", text).lower()
    compact = compact.replace("+", "").replace("-", "")
    labels = {
        "cl": "Cl−",
        "chloride": "Cl−",
        "bf4": "BF₄−",
        "tetrafluoroborate": "BF₄−",
        "pf6": "PF₆−",
        "hexafluorophosphate": "PF₆−",
        "tfsi": "TFSI−",
        "ntf2": "TFSI−",
        "fsi": "FSI−",
        "br": "Br−",
        "i": "I−",
        "na": "Na+",
        "li": "Li+",
        "k": "K+",
    }
    if compact in labels:
        return labels[compact]
    if default_charge and not text.endswith(("+", "−", "-")):
        return f"{text}{default_charge}"
    return text.replace("-", "−")


def _bracket_ions(value: Any) -> tuple[str | None, str | None]:
    parts = [match.strip() for match in re.findall(r"\[([^\]]+)\]", str(value or "")) if match.strip()]
    if len(parts) < 2:
        return None, None
    return _format_ion_label(parts[0], default_charge="+"), _format_ion_label(parts[1], default_charge="−")


_CHAIN_WORDS: tuple[tuple[str, int], ...] = (
    ("methyl", 1),
    ("ethyl", 2),
    ("propyl", 3),
    ("butyl", 4),
    ("pentyl", 5),
    ("hexyl", 6),
    ("heptyl", 7),
    ("octyl", 8),
    ("nonyl", 9),
    ("dodecyl", 12),
    ("decyl", 10),
)


def _chain_label(carbons: int | None) -> str | None:
    if not carbons:
        return None
    hydrogens = carbons * 2 + 1
    return f"-C{_subscript_digits(carbons)}H{_subscript_digits(hydrogens)}"


def _infer_side_chain(row: dict[str, Any]) -> dict[str, Any]:
    text = f"{row.get('system_name') or ''} {row.get('ionic_liquid') or ''} {row.get('evidence') or ''}".lower()
    for word, carbons in _CHAIN_WORDS:
        if word in text:
            return {
                "side_chain_label": _chain_label(carbons),
                "side_chain_carbons": carbons,
                "side_chain_name": word,
            }
    match = re.search(r"\bc\s*([1-9]\d?)\b", text)
    if match:
        carbons = int(match.group(1))
        return {
            "side_chain_label": _chain_label(carbons),
            "side_chain_carbons": carbons,
            "side_chain_name": f"C{carbons}",
        }
    return {}


def _infer_water_uptake(row: dict[str, Any]) -> dict[str, Any]:
    features = _json_dict(row.get("novel_features_json"))
    value = _first_present(
        features.get("water_uptake_value"),
        features.get("waterUptakeValue"),
        features.get("water_uptake"),
        features.get("waterUptake"),
    )
    unit = str(_first_present(features.get("water_uptake_unit"), features.get("waterUptakeUnit"), "wt%")).replace(" ", "")
    if value in (None, ""):
        match = re.search(
            r"(?:water\s+uptake|WU|hydration)[^0-9]{0,32}(\d+(?:\.\d+)?)\s*(wt\s*%|%)",
            str(row.get("evidence") or ""),
            flags=re.IGNORECASE,
        )
        if match:
            value = match.group(1)
            unit = match.group(2).replace(" ", "")
    numeric = _to_float(value)
    if numeric is None:
        return {}
    value_label = f"{numeric:g}" if abs(numeric) >= 1 else f"{numeric:.3g}"
    return {
        "water_uptake_value": numeric,
        "water_uptake_unit": unit or "wt%",
        "water_uptake_label": f"{value_label} {unit or 'wt%'}",
    }


def _infer_cation(row: dict[str, Any], side_chain: dict[str, Any]) -> str | None:
    explicit = _format_ion_label(_first_present(row.get("cation"), _json_dict(row.get("novel_features_json")).get("cation")), default_charge="+")
    if explicit:
        return explicit
    text = f"{row.get('system_name') or ''} {row.get('ionic_liquid') or ''}"
    bracket_cation, _ = _bracket_ions(text)
    if bracket_cation:
        return bracket_cation
    lower = text.lower()
    if "mpil" in lower or "phosphonium" in lower:
        chain_name = side_chain.get("side_chain_name")
        if chain_name and str(chain_name).isalpha():
            return f"phosphonium, tri{chain_name}-substituted"
        return "polymer-bound phosphonium-type cation"
    if "imidazolium" in lower or re.search(r"\b[beho]mim\b", lower):
        return "imidazolium cation"
    if "ammonium" in lower:
        return "ammonium cation"
    return None


def _infer_anion(row: dict[str, Any]) -> str | None:
    explicit = _format_ion_label(_first_present(row.get("anion"), _json_dict(row.get("novel_features_json")).get("anion")), default_charge="−")
    if explicit:
        return explicit
    text = f"{row.get('system_name') or ''} {row.get('ionic_liquid') or ''}"
    _, bracket_anion = _bracket_ions(text)
    if bracket_anion:
        return bracket_anion
    lower_system = text.lower()
    if "mpil" in lower_system:
        return "BF₄−"
    lower = f"{text} {row.get('evidence') or ''}".lower()
    for pattern, label in (
        (r"bf\s*4|bf4|tetrafluoroborate", "BF₄−"),
        (r"pf\s*6|pf6|hexafluorophosphate", "PF₆−"),
        (r"tfsi|ntf2", "TFSI−"),
        (r"\bcl[−-]?\b|chloride", "Cl−"),
    ):
        if re.search(pattern, lower):
            return label
    return None


def _infer_diffusing_ion(row: dict[str, Any], standard_anion: str | None) -> str | None:
    features = _json_dict(row.get("novel_features_json"))
    explicit = _format_ion_label(_first_present(row.get("diffusing_species"), features.get("diffusing_ion"), features.get("diffusingIon")))
    if explicit:
        return explicit
    text = f"{row.get('evidence') or ''} {row.get('system_name') or ''} {row.get('ionic_liquid') or ''}".lower()
    if re.search(r"\bcl[−-]?\b|chloride", text) and ("diffus" in text or "msd" in text or row.get("D_anion") is not None):
        return "Cl−"
    if row.get("D_cation") is not None and row.get("D_anion") is None:
        return "cation"
    if row.get("D_anion") is not None and row.get("D_cation") is None:
        return standard_anion or "anion"
    if row.get("D_cation") is not None and row.get("D_anion") is not None:
        return "cation / anion"
    if row.get("D_total") is not None:
        return "overall"
    return None


def _coefficient_metadata(row: dict[str, Any]) -> dict[str, Any]:
    for key, kind in (("D_total", "total"), ("D_anion", "anion"), ("D_cation", "cation")):
        value = row.get(key)
        if value is None:
            continue
        numeric = _to_float(value)
        if numeric is None:
            continue
        unit = row.get("D_unit")
        payload: dict[str, Any] = {
            "coefficient_kind": kind,
            "coefficient_value": numeric,
            "coefficient_unit": unit,
        }
        if str(unit or "") == _CANONICAL_DIFFUSION_UNIT:
            payload["coefficient_m2_s"] = numeric * 1e-12
            payload["coefficient_a2_ps"] = numeric * 1e-4
        return payload
    return {}


def _diffusion_data_type(row: dict[str, Any]) -> str:
    text = f"{row.get('evidence') or ''} {row.get('source') or ''}".lower()
    if re.search(r"msd|einstein|molecular dynamics|\bmd\b|a2|å2|ps", text):
        return "MD 计算值"
    if re.search(r"table|reported|experiment", text):
        return "文献报道值"
    return "结构化记录"


def build_diffusion_standard_fields(row: dict[str, Any]) -> dict[str, Any]:
    side_chain = _infer_side_chain(row)
    cation = _infer_cation(row, side_chain)
    anion = _infer_anion(row)
    standard: dict[str, Any] = {
        "schema_version": _STANDARD_FIELDS_VERSION,
        "cation": cation,
        "anion": anion,
        "diffusing_ion": _infer_diffusing_ion(row, anion),
        "data_type": _diffusion_data_type(row),
        **side_chain,
        **_infer_water_uptake(row),
        **_coefficient_metadata(row),
    }
    return {key: value for key, value in standard.items() if value not in (None, "", [], {})}


def _canonical_metric_values(value: Any) -> dict[str, float] | None:
    numeric = _to_float(value)
    if numeric is None:
        return None
    return {
        "value_10e12_m2_s": round(float(numeric), 12),
        "value_m2_s": float(f"{float(numeric) * 1e-12:.12g}"),
        "value_a2_ps": float(f"{float(numeric) * 1e-4:.12g}"),
    }


def _original_diffusion_label(raw_value: Any, raw_unit: Any) -> str | None:
    value_text = str(raw_value or "").strip()
    unit_text = str(raw_unit or "").strip()
    if value_text and unit_text:
        return f"{value_text} {unit_text}"
    return value_text or unit_text or None


def _source_values_payload(row: dict[str, Any]) -> dict[str, Any]:
    novel_features = _json_dict(row.get("novel_features_json"))
    return _json_dict(novel_features.get("source_values"))


def _normalization_coeff_payload(
    row: dict[str, Any],
    *,
    field_key: str,
    response_key: str,
    label: str,
    source_values: dict[str, Any],
) -> dict[str, Any]:
    source_payload = _json_dict(source_values.get(field_key))
    stored_value = row.get(field_key)
    stored_unit = row.get("D_unit")
    canonical_value = _to_float(source_payload.get("canonical_value"))
    canonical_unit = str(source_payload.get("canonical_unit") or "").strip()

    if canonical_value is None:
        canonical_value, normalized_unit = _normalize_diffusion_unit_and_value(stored_value, stored_unit)
        canonical_unit = canonical_unit or str(normalized_unit or "").strip()

    raw_value = _first_present(source_payload.get("raw_value"), source_payload.get("raw_value_label"))
    raw_unit = source_payload.get("raw_unit")
    original_label = _original_diffusion_label(raw_value, raw_unit)
    if not original_label and stored_value not in (None, ""):
        original_label = _original_diffusion_label(stored_value, stored_unit)

    metric_values = _canonical_metric_values(canonical_value)
    status = "normalized" if metric_values and canonical_unit else "missing"
    if metric_values and not canonical_unit:
        status = "unit_warning"

    payload: dict[str, Any] = {
        "field": response_key,
        "source_field": field_key,
        "label": label,
        "status": status,
        "source": "evidence" if source_payload else "stored_value",
        "original_value": str(raw_value).strip() if raw_value not in (None, "") else stored_value,
        "original_unit": str(raw_unit).strip() if raw_unit not in (None, "") else stored_unit,
        "original_label": original_label,
        "canonical_unit": canonical_unit or None,
        "canonical_label": None,
        "note": None,
    }
    if metric_values:
        payload.update(metric_values)
        payload["canonical_value"] = metric_values["value_10e12_m2_s"]
        payload["canonical_label"] = f"{metric_values['value_10e12_m2_s']:g} {_CANONICAL_DIFFUSION_UNIT}"
    if not source_payload:
        payload["note"] = "No source_values payload; normalized from stored value and unit."
    if status == "unit_warning":
        payload["note"] = "Value parsed, but the source unit could not be confirmed."
    if status == "missing":
        payload["note"] = "No normalizable diffusion coefficient is available."
    return {key: value for key, value in payload.items() if value not in (None, "", [], {})}


def build_diffusion_normalization_payload(row: dict[str, Any]) -> dict[str, Any]:
    source_values = _source_values_payload(row)
    coefficients = {
        "d_total": _normalization_coeff_payload(
            row,
            field_key="D_total",
            response_key="d_total",
            label="D total",
            source_values=source_values,
        ),
        "d_cation": _normalization_coeff_payload(
            row,
            field_key="D_cation",
            response_key="d_cation",
            label="D+",
            source_values=source_values,
        ),
        "d_anion": _normalization_coeff_payload(
            row,
            field_key="D_anion",
            response_key="d_anion",
            label="D-",
            source_values=source_values,
        ),
    }
    populated = {
        key: value
        for key, value in coefficients.items()
        if value.get("status") in {"normalized", "unit_warning"}
    }
    warnings = [
        f"{value.get('label')}: {value.get('note')}"
        for value in coefficients.values()
        if value.get("status") == "unit_warning" and value.get("note")
    ]
    primary_key = next((key for key in ("d_total", "d_anion", "d_cation") if key in populated), None)
    status = "ready" if populated and not any(value.get("status") == "unit_warning" for value in populated.values()) else "partial"
    if not populated:
        status = "missing"

    return {
        "schema_version": _NORMALIZATION_VERSION,
        "status": status,
        "canonical_unit": _CANONICAL_DIFFUSION_UNIT,
        "canonical_unit_si": "m²/s",
        "coefficients": coefficients,
        "primary_field": primary_key,
        "primary": populated.get(primary_key) if primary_key else None,
        "ready_count": len([value for value in coefficients.values() if value.get("status") == "normalized"]),
        "warning_count": len([value for value in coefficients.values() if value.get("status") == "unit_warning"]),
        "warnings": warnings,
    }


def diffusion_normalization_blockers(
    row: dict[str, Any],
    *,
    confidence_score: Any = None,
    low_confidence_threshold: float = 0.55,
) -> list[str]:
    normalization = build_diffusion_normalization_payload(row)
    blockers: list[str] = []
    status = str(normalization.get("status") or "").strip().lower()
    primary = normalization.get("primary") if isinstance(normalization.get("primary"), dict) else {}
    primary_status = str(primary.get("status") or "").strip().lower() if isinstance(primary, dict) else ""

    if status == "missing" or not primary:
        blockers.append("No normalizable diffusion coefficient is available.")
    elif status != "ready" or primary_status != "normalized":
        blockers.append("Diffusion coefficient unit must be confirmed before approval.")

    score = _to_float(confidence_score)
    if score is not None and float(score) < low_confidence_threshold:
        blockers.append(f"Confidence score is below {low_confidence_threshold:.2f}.")

    return blockers


def apply_diffusion_standard_fields(row: dict[str, Any]) -> dict[str, Any]:
    payload = dict(row)
    novel_features = _json_dict(payload.get("novel_features_json"))
    standard_fields = build_diffusion_standard_fields({**payload, "novel_features_json": novel_features})
    normalization = build_diffusion_normalization_payload({**payload, "novel_features_json": novel_features})
    novel_features["standard_fields"] = standard_fields
    payload["novel_features_json"] = novel_features
    payload["diffusion_standard_fields"] = standard_fields
    payload["diffusionStandardFields"] = standard_fields
    payload["diffusion_normalization"] = normalization
    payload["diffusionNormalization"] = normalization
    return payload


def diffusion_drop_reason(record: dict[str, Any], *, require_evidence_measure: bool = False) -> str | None:
    if not isinstance(record, dict):
        return "invalid_payload"
    if not record_has_diffusion_value(record):
        return "no_diffusion_value"
    if _has_nonpositive_diffusion_value(record):
        return "nonpositive_diffusion_value"
    if _is_non_ionic_liquid_solute(record.get("ionic_liquid")):
        return "non_ionic_liquid_solute"
    evidence_text = str(record.get("evidence") or "").strip()
    unit = record.get("D_unit")
    if unit and not _is_supported_diffusion_unit(unit) and _is_figure_source(record):
        return "figure_unit_requires_manual_review"
    evidence_measures = _extract_diffusion_measures_from_text(evidence_text)
    if unit and not _is_supported_diffusion_unit(unit) and not evidence_measures:
        return "unsupported_diffusion_unit"
    if require_evidence_measure:
        if not evidence_text:
            return "missing_evidence_quote"
        if not evidence_measures:
            return "no_numeric_diffusion_in_evidence"
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
    score = 0.35
    if record_has_diffusion_value(row):
        score += 0.2
    if _extract_diffusion_measures_from_text(row.get("evidence")):
        score += 0.25
    if row.get("source"):
        score += 0.05
    if row.get("source_page"):
        score += 0.1
    if row.get("evidence"):
        score += 0.05
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
    standard_fields = build_diffusion_standard_fields(row)
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

    def _inferred_entry(value: Any) -> dict[str, Any]:
        payload = {
            "value": _format_field_value(value),
            "confidence": confidence,
            "evidence": evidence,
            "review_state": None,
            "review_note": None,
        }
        if value not in (None, "", [], {}):
            payload["grounding_mode"] = "inferred"
            payload["grounding_note"] = "Derived by diffusion.standard.v1 from extracted system/evidence."
        return payload

    return {
        "system_name": _entry("system_name"),
        "confinement_material_class": _entry("confinement_material_class"),
        "confinement_geometry_class": _entry("confinement_geometry_class"),
        "surface_functional_groups": _entry("surface_functional_groups"),
        "confinement_dimensionality": _entry("confinement_dimensionality"),
        "ionic_liquid": _entry("ionic_liquid"),
        "cation": _inferred_entry(standard_fields.get("cation")),
        "anion": _inferred_entry(standard_fields.get("anion")),
        "diffusing_ion": _inferred_entry(standard_fields.get("diffusing_ion")),
        "side_chain": _inferred_entry(standard_fields.get("side_chain_label")),
        "water_uptake": _inferred_entry(standard_fields.get("water_uptake_label")),
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
        if diffusion_drop_reason(row, require_evidence_measure=True):
            continue

        d_unit = row.get("D_unit")
        evidence_measures = _extract_diffusion_measures_from_text(row.get("evidence"))
        if not evidence_measures:
            continue
        row["D_total"], d_unit = _normalize_diffusion_unit_and_value(row.get("D_total"), d_unit)
        row["D_cation"], d_unit = _normalize_diffusion_unit_and_value(row.get("D_cation"), d_unit)
        row["D_anion"], d_unit = _normalize_diffusion_unit_and_value(row.get("D_anion"), d_unit)
        row["D_unit"] = d_unit

        supported_coefficient_keys: set[str] = set()
        source_values: dict[str, dict[str, Any]] = {}
        for key in ("D_total", "D_cation", "D_anion"):
            evidence_measure = _pick_evidence_measure_for_field(evidence_measures, key)
            if evidence_measure:
                row[key] = evidence_measure["value"]
                row["D_unit"] = evidence_measure["unit"]
                supported_coefficient_keys.add(key)
                source_values[key] = _source_value_payload(evidence_measure)

        populated_fields = [key for key in ("D_total", "D_cation", "D_anion") if row.get(key) is not None]
        for key in populated_fields:
            if key in supported_coefficient_keys:
                continue
            matching_measure = next(
                (measure for measure in evidence_measures if _diffusion_values_close(row.get(key), measure.get("value"))),
                None,
            )
            if matching_measure:
                row[key] = matching_measure["value"]
                row["D_unit"] = matching_measure["unit"]
                supported_coefficient_keys.add(key)
                source_values[key] = _source_value_payload(matching_measure)

        if len(evidence_measures) == 1 and len(supported_coefficient_keys) == 0:
            target_key = populated_fields[0] if len(populated_fields) == 1 else "D_total"
            row[target_key] = evidence_measures[0]["value"]
            row["D_unit"] = evidence_measures[0]["unit"]
            supported_coefficient_keys.add(target_key)
            source_values[target_key] = _source_value_payload(evidence_measures[0])

        for key in ("D_total", "D_cation", "D_anion"):
            if key not in supported_coefficient_keys:
                row[key] = None

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
        if source_values:
            row["novel_features_json"]["source_values"] = source_values
        row["provider"] = provider
        row["prompt_version"] = prompt_version
        row["raw_model_output"] = raw_model_output
        row["review_status"] = row.get("review_status") or "pending_review"
        row["record_origin"] = row.get("record_origin") or "diffusion_llm_extraction"
        row["assembly_notes"] = row.get("assembly_notes") or (
            "MVP verified: retained only because the evidence quote contains an explicit numeric diffusion coefficient and unit."
        )

        bbox_page, bbox = _resolve_source_bbox(pdf_path, row)
        if bbox_page and not row.get("source_page"):
            row["source_page"] = bbox_page
        row["source_bbox"] = bbox
        row["confidence"] = _confidence_from_row(row)
        row = enrich_diffusion_record(row)
        row = apply_diffusion_standard_fields(row)
        row["field_evidence_json"] = build_diffusion_field_evidence_map(row)

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
    payload["field_evidence_json"] = _json_dict(payload.get("field_evidence_json"))
    payload["novel_features_json"] = _json_dict(payload.get("novel_features_json"))
    payload["rdkit_features_json"] = _json_dict(payload.get("rdkit_features_json"))
    payload = apply_diffusion_standard_fields(payload)
    return payload


def json_dumps(value: Any) -> str | None:
    if value is None:
        return None
    return json.dumps(value, ensure_ascii=False)
