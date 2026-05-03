from __future__ import annotations

import re
from typing import Any


def _is_blank(value: Any) -> bool:
    if value is None:
        return True
    return str(value).strip() == ""


def _normalize_text(text: str) -> str:
    value = str(text or "")
    value = (
        value.replace("µ", "u")
        .replace("μ", "u")
        .replace("–", "-")
        .replace("—", "-")
        .replace("−", "-")
    )
    return re.sub(r"\s+", " ", value).strip()


def _format_number(value: str) -> str:
    try:
        numeric = float(value)
    except Exception:
        return str(value).strip()
    if numeric.is_integer():
        return str(int(numeric))
    return f"{numeric:.3f}".rstrip("0").rstrip(".")


def _normalize_length_unit(unit: str) -> str:
    lowered = str(unit or "").strip().lower()
    if lowered in {"um", "u m"}:
        return "um"
    if lowered in {"nm", "pm"}:
        return lowered
    if lowered in {"a", "angstrom", "angstroms"}:
        return "angstrom"
    return lowered


def _format_length(value: str, unit: str) -> str:
    normalized_unit = _normalize_length_unit(unit)
    if normalized_unit == "um":
        rendered_unit = "um"
    elif normalized_unit == "angstrom":
        rendered_unit = "angstrom"
    else:
        rendered_unit = normalized_unit
    return f"{_format_number(value)} {rendered_unit}".strip()


def _format_speed(value: str, unit: str) -> str:
    normalized_unit = _normalize_length_unit(unit)
    rendered_unit = "μm" if normalized_unit == "um" else normalized_unit
    return f"{_format_number(value)} {rendered_unit}/s".strip()


def _format_force_range(low: str, high: str, unit: str) -> str:
    normalized_unit = str(unit or "").strip()
    return f"{_format_number(low)}-{_format_number(high)} {normalized_unit}".strip()


def _roughness_looks_meaningful(text: str) -> bool:
    return bool(
        re.search(
            r"\b(rms|ra|rq|roughness|atomically\s+flat|fresh(?:ly)?\s+cleav(?:ed|e))\b|(?:<=|>=|[<>~])?\s*\d+(?:\.\d+)?\s*(nm|um|pm|angstrom(?:s)?|a)\b",
            text,
            flags=re.IGNORECASE,
        )
    )


def _match_explicit_roughness(text: str) -> str | None:
    normalized = _normalize_text(text)
    if not normalized:
        return None

    uncertainty_match = re.search(
        r"\b(?P<label>rms|ra|rq)\b(?:\s+roughness)?(?:\s+was|\s*=|\s+of|\s*:)?\s*"
        r"(?P<value>\d+(?:\.\d+)?)\s*(?:±|\+/-)\s*(?P<error>\d+(?:\.\d+)?)\s*"
        r"(?P<unit>nm|um|pm|angstrom(?:s)?|a)\b",
        normalized,
        flags=re.IGNORECASE,
    )
    if uncertainty_match:
        label = str(uncertainty_match.group("label") or "").upper().strip()
        value = str(uncertainty_match.group("value") or "").strip()
        error = str(uncertainty_match.group("error") or "").strip()
        unit = _normalize_length_unit(uncertainty_match.group("unit"))
        rendered_unit = "um" if unit == "um" else ("angstrom" if unit == "angstrom" else unit)
        return f"{label} {value} ± {error} {rendered_unit}".strip()

    prefix_match = re.search(
        r"\b(?P<label>rms|ra|rq)\b(?:\s+roughness)?(?:\s+was|\s*=|\s+of|\s*:)?\s*(?P<op><=|>=|[<>~])?\s*(?P<value>\d+(?:\.\d+)?)\s*(?P<unit>nm|um|pm|angstrom(?:s)?|a)\b",
        normalized,
        flags=re.IGNORECASE,
    )
    suffix_match = re.search(
        r"(?P<op><=|>=|[<>~])?\s*(?P<value>\d+(?:\.\d+)?)\s*(?P<unit>nm|um|pm|angstrom(?:s)?|a)\s*(?P<label>rms|ra|rq)\b",
        normalized,
        flags=re.IGNORECASE,
    )
    generic_match = re.search(
        r"(?:surface\s+roughness|roughness)(?:\s+was|\s*=|\s+of|\s*:)?(?:[^.;]{0,48}?)?(?P<op><=|>=|[<>~])?\s*(?P<value>\d+(?:\.\d+)?)\s*(?P<unit>nm|um|pm|angstrom(?:s)?|a)\b",
        normalized,
        flags=re.IGNORECASE,
    )
    match = prefix_match or suffix_match or generic_match
    if not match:
        return None

    label = str(match.groupdict().get("label") or "").upper().strip()
    operator = str(match.group("op") or "").strip()
    value = match.group("value")
    unit = match.group("unit")
    rendered = _format_length(value, unit)
    prefix = f"{label} " if label else ""
    if operator == "<=":
        return f"{prefix}<= {rendered}".strip()
    if operator == ">=":
        return f"{prefix}>= {rendered}".strip()
    if operator == "~":
        return f"{prefix}~{rendered}".strip()
    if operator:
        return f"{prefix}{operator} {rendered}".strip()
    return f"{prefix}{rendered}".strip()


def normalize_surface_roughness_value(
    value: Any,
    *,
    context_text: str = "",
    substrate_material: Any = None,
) -> str | None:
    raw = _normalize_text(str(value or ""))
    context = _normalize_text(context_text)
    substrate = _normalize_text(str(substrate_material or ""))

    if raw.lower() in {
        "",
        "-",
        "--",
        "null",
        "none",
        "n/a",
        "na",
        "not specified",
        "not specified in text",
        "not reported",
        "not mentioned",
        "unknown",
    }:
        raw = ""

    explicit = _match_explicit_roughness(raw)
    if explicit:
        return explicit

    descriptor_source = raw if _roughness_looks_meaningful(raw) else ""
    combined = " ".join(part for part in (descriptor_source, context, substrate) if part).strip()
    explicit = _match_explicit_roughness(combined)
    if explicit:
        return explicit

    if re.search(r"\batomically\s+flat\b", combined, flags=re.IGNORECASE):
        return "~0.1 nm (Estimated)"
    if re.search(r"\bfresh(?:ly)?\s+cleav(?:ed|e)\b", combined, flags=re.IGNORECASE):
        return "~0.1 nm (Estimated)"

    return None


def _select_experimental_text(page_texts: dict[int, str]) -> str:
    if not page_texts:
        return ""

    normalized_pages = {page: _normalize_text(text) for page, text in page_texts.items()}
    ordered_pages = sorted(normalized_pages)
    selected: set[int] = set()

    heading_pages = [
        page
        for page in ordered_pages
        if re.search(
            r"\b(experimental|materials and methods|methods|methodology)\b",
            normalized_pages[page].lower(),
        )
    ]
    for page in heading_pages:
        for offset in range(0, 4):
            candidate = page + offset
            if candidate in normalized_pages:
                selected.add(candidate)

    keyword_pages = [
        page
        for page in ordered_pages
        if any(
            token in normalized_pages[page].lower()
            for token in (
                "normal load",
                "friction measurements",
                "scan speed",
                "tip radius",
                "roughness",
                "substrate",
                "sharp si tip",
                "silica sphere",
                "afm fluid cell",
            )
        )
    ]
    selected.update(keyword_pages)

    if not selected:
        selected.update(ordered_pages[: min(4, len(ordered_pages))])

    return "\n".join(normalized_pages[page] for page in ordered_pages if page in selected)


def _infer_surface_material(text: str) -> str | None:
    lowered = text.lower()
    patterns = [
        (r"\bstainless steel\b", "Stainless steel"),
        (r"\btitanium\b|\bti substrate\b|\bti surface\b", "Titanium"),
        (r"\bmica\b", "Mica"),
        (r"\bsilica\b|\bsio2\b", "Silica"),
        (r"\bhopg\b|\bgraphite\b", "HOPG"),
        (r"\bau\s*\(?111\)?\b|\bgold\b", "Au(111)"),
    ]
    for pattern, label in patterns:
        if re.search(pattern, lowered):
            return label
    return None


def extract_experimental_document_context(page_texts: dict[int, str]) -> dict[str, Any]:
    text = _select_experimental_text(page_texts)
    if not text:
        return {}

    lowered = text.lower()
    context: dict[str, Any] = {}

    substrate_material = _infer_surface_material(text)
    if substrate_material:
        context["substrate_material"] = substrate_material
        context["material_name"] = substrate_material

    if not context.get("probe_material"):
        if re.search(r"\bsharp\s+(?:si|silicon)\s+tips?\b|\b(?:si|silicon)\s+tip\b", lowered):
            context["probe_material"] = "Silicon"
        elif re.search(r"\bsilica\s+(?:colloid|sphere|probe)\b", lowered):
            context["probe_material"] = "Silica"
        elif re.search(r"\bsteel\s+(?:ball|sphere|probe|pin|tip)\b", lowered):
            context["probe_material"] = "Steel"

    if not context.get("probe_geometry"):
        if re.search(r"\bcolloid(?:al)?\s+probe\b", lowered):
            context["probe_geometry"] = "Colloid probe"
        elif re.search(r"\b(?:tip radius|sharp si tips?|afm tip|silicon tip|si tip)\b", lowered):
            context["probe_geometry"] = "Tip"
        elif re.search(r"\bsilica\s+sphere\b|\bsphere\b", lowered):
            context["probe_geometry"] = "Sphere"

    radius_match = re.search(
        r"(?:nominal\s+)?tip radius(?:\s+of|\s*=|\s+was)?\s*([0-9]+(?:\.[0-9]+)?)\s*(nm|um|pm|angstrom|angstroms|a)\b",
        lowered,
        flags=re.IGNORECASE,
    )
    if not radius_match:
        radius_match = re.search(
            r"radius(?:\s+of|\s*=|\s+was)?\s*([0-9]+(?:\.[0-9]+)?)\s*(nm|um|pm|angstrom|angstroms|a)\b",
            lowered,
            flags=re.IGNORECASE,
        )
    if radius_match:
        context["probe_radius"] = _format_length(radius_match.group(1), radius_match.group(2))

    speed_match = re.search(
        r"(?:scan|sliding)\s+speed(?:\s+of|\s*=|\s+was)?\s*([0-9]+(?:\.[0-9]+)?)\s*(nm|um|mm|cm|m)\s*(?:/s|s-1)\b",
        lowered,
        flags=re.IGNORECASE,
    )
    if speed_match:
        context["speed_value"] = _format_speed(speed_match.group(1), speed_match.group(2))

    load_match = re.search(
        r"normal load(?:\s+\w+){0,8}?\s+from\s+([0-9]+(?:\.[0-9]+)?)\s*(?:(nN|uN|mN|N)\s*)?to\s+([0-9]+(?:\.[0-9]+)?)\s*(nN|uN|mN|N)\b",
        text,
        flags=re.IGNORECASE,
    )
    if not load_match:
        load_match = re.search(
            r"load(?:\s+\w+){0,8}?\s+ranging\s+from\s+([0-9]+(?:\.[0-9]+)?)\s+to\s+([0-9]+(?:\.[0-9]+)?)\s*(nN|uN|mN|N)\b",
            text,
            flags=re.IGNORECASE,
        )
        if load_match:
            context["load_value"] = _format_force_range(load_match.group(1), load_match.group(2), load_match.group(3))
    else:
        context["load_value"] = _format_force_range(
            load_match.group(1),
            load_match.group(3),
            load_match.group(4) or load_match.group(2),
        )

    if not context.get("temperature"):
        temp_match = re.search(
            r"(?:temperature(?:\s+\w+){0,6}?|measured(?:\s+\w+){0,6}?|performed(?:\s+\w+){0,6}?|conducted(?:\s+\w+){0,6}?|carried out(?:\s+\w+){0,6}?|experiments?(?:\s+\w+){0,6}?)\s+at\s+([0-9]+(?:\.[0-9]+)?)\s*(?:掳\s*)?c\b",
            text,
            flags=re.IGNORECASE,
        )
        if not temp_match:
            temp_match = re.search(
                r"temperature(?:\s+\w+){0,4}?(?:of|was|=)\s*([0-9]+(?:\.[0-9]+)?)\s*(?:掳\s*)?c\b",
                text,
                flags=re.IGNORECASE,
            )
        if temp_match:
            celsius = float(temp_match.group(1)) + 273.15
            context["temperature"] = f"{celsius:.2f} K"
        elif "room temperature" in lowered or "ambient temperature" in lowered:
            context["temperature"] = "298.15 K"

    roughness = normalize_surface_roughness_value(
        None,
        context_text=text,
        substrate_material=context.get("substrate_material"),
    )
    if roughness:
        context["substrate_roughness"] = roughness
        context["surface_roughness"] = roughness

    if "chromium oxide" in lowered:
        context["substrate_coating"] = "Chromium oxide"

    return {key: value for key, value in context.items() if not _is_blank(value)}


def apply_experimental_document_context(
    record: dict[str, Any],
    context: dict[str, Any],
    *,
    override_probe_material: bool = False,
) -> dict[str, Any]:
    item = dict(record or {})
    doc_context = dict(context or {})
    substrate_material_hint = (
        item.get("substrate_material")
        or item.get("material_name")
        or doc_context.get("substrate_material")
        or doc_context.get("material_name")
    )
    roughness_context = " ".join(
        str(part or "").strip()
        for part in (
            item.get("substrate_roughness"),
            item.get("surface_roughness"),
            item.get("evidence"),
            item.get("notes"),
            item.get("source"),
            substrate_material_hint,
        )
        if str(part or "").strip()
    )

    normalized_substrate_roughness = normalize_surface_roughness_value(
        item.get("substrate_roughness"),
        context_text=roughness_context,
        substrate_material=substrate_material_hint,
    )
    normalized_surface_roughness = (
        normalize_surface_roughness_value(
            item.get("surface_roughness"),
            context_text=roughness_context,
            substrate_material=substrate_material_hint,
        )
        if not _is_blank(item.get("surface_roughness"))
        else None
    )
    inferred_roughness = (
        normalized_substrate_roughness
        or normalized_surface_roughness
        or normalize_surface_roughness_value(
            None,
            context_text=roughness_context,
            substrate_material=substrate_material_hint,
        )
    )
    if normalized_substrate_roughness:
        item["substrate_roughness"] = normalized_substrate_roughness
    elif _is_blank(item.get("substrate_roughness")) and inferred_roughness:
        item["substrate_roughness"] = inferred_roughness

    if normalized_surface_roughness:
        item["surface_roughness"] = normalized_surface_roughness

    if not doc_context:
        return item

    original_probe_material = str(item.get("probe_material") or "").strip().lower()
    original_substrate_material = str(item.get("substrate_material") or "").strip().lower()
    original_probe_details_blank = all(
        _is_blank(item.get(field)) for field in ("probe_geometry", "probe_radius", "probe_roughness")
    )

    for field in (
        "load_value",
        "speed_value",
        "temperature",
        "probe_geometry",
        "probe_radius",
        "probe_roughness",
        "substrate_material",
        "substrate_coating",
        "substrate_roughness",
        "film_thickness",
        "material_name",
    ):
        if _is_blank(item.get(field)) and not _is_blank(doc_context.get(field)):
            item[field] = doc_context[field]

    if _is_blank(item.get("load")) and not _is_blank(doc_context.get("load_value")):
        item["load"] = doc_context["load_value"]
    if _is_blank(item.get("normal_load")) and not _is_blank(doc_context.get("load_value")):
        item["normal_load"] = doc_context["load_value"]
    if _is_blank(item.get("speed")) and not _is_blank(doc_context.get("speed_value")):
        item["speed"] = doc_context["speed_value"]

    if _is_blank(item.get("probe_material")) and not _is_blank(doc_context.get("probe_material")):
        item["probe_material"] = doc_context["probe_material"]
    elif (
        override_probe_material
        and not _is_blank(doc_context.get("probe_material"))
        and original_probe_material
        and original_probe_material == original_substrate_material
        and original_probe_details_blank
    ):
        item["probe_material"] = doc_context["probe_material"]

    if _is_blank(item.get("material_name")) and not _is_blank(item.get("substrate_material")):
        item["material_name"] = item["substrate_material"]
    return item
