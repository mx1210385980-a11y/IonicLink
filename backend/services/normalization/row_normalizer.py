from __future__ import annotations

import re
from typing import Any, List, Optional

from knowledge_base import normalize_ionic_liquid
from services.cleaning_service import normalize_temperature
from services.normalization.potential import normalize_potential_text
from utils.document_context import normalize_surface_roughness_value
from utils.speed_conditions import derive_speed_conditions, normalize_speed_conditions, speed_value_from_conditions


def _format_thickness_nm(value: float) -> str:
    if float(value).is_integer():
        return f"{int(value)} nm"
    return f"{value:.3f}".rstrip("0").rstrip(".") + " nm"


def _normalize_quantitative_thickness(value: Any) -> Optional[str]:
    text = str(value or "").strip()
    if not text or text.lower() in {"-", "--", "n/a", "none", "unknown"}:
        return None

    uncertainty_match = re.search(
        r"([-+]?\d*\.?\d+)\s*(?:±|\+/-|\+∕-)\s*([-+]?\d*\.?\d+)\s*(nm|μm|µm|um|pm|å|a\b|angstrom(?:s)?)",
        text,
        flags=re.IGNORECASE,
    )
    if uncertainty_match:
        magnitude = float(uncertainty_match.group(1))
        uncertainty = float(uncertainty_match.group(2))
        unit = uncertainty_match.group(3).lower()
        if unit in {"μm", "µm", "um"}:
            magnitude *= 1000.0
            uncertainty *= 1000.0
        elif unit == "pm":
            magnitude /= 1000.0
            uncertainty /= 1000.0
        elif unit in {"å", "a", "angstrom", "angstroms"}:
            magnitude /= 10.0
            uncertainty /= 10.0
        return f"{_format_thickness_nm(magnitude).removesuffix(' nm')} ± {_format_thickness_nm(uncertainty)}"

    match = re.search(
        r"([-+]?\d*\.?\d+)\s*(nm|μm|µm|um|pm|å|a\b|angstrom(?:s)?)",
        text,
        flags=re.IGNORECASE,
    )
    if not match:
        return None

    magnitude = float(match.group(1))
    unit = match.group(2).lower()
    if unit in {"μm", "µm", "um"}:
        magnitude *= 1000.0
    elif unit == "pm":
        magnitude /= 1000.0
    elif unit in {"å", "a", "angstrom", "angstroms"}:
        magnitude /= 10.0

    return _format_thickness_nm(magnitude)


def _sanitize_thickness_fields(item: dict[str, Any]) -> None:
    for field in ("film_thickness", "residual_film_thickness_d", "layer_spacing_delta"):
        if field in item:
            item[field] = _normalize_quantitative_thickness(item.get(field))


def _looks_like_shear_rate(value: Any) -> bool:
    text = str(value or "").strip().lower()
    if not text:
        return False
    return bool(
        re.search(r"\bshear\s+rate\b", text)
        or re.search(r"\bs\s*(?:\^\s*)?[-−]?\s*1\b", text)
        or re.search(r"\bs[−-]1\b", text)
        or "s⁻¹" in text
    )


def _normalize_shear_rate(value: Any) -> Optional[str]:
    text = str(value or "").strip()
    if not text:
        return None
    normalized = re.sub(r"\s+", " ", text.replace("–", "-").replace("—", "-").replace("−", "-"))
    match = re.search(
        r"([<>≈~±≤≥]?\s*\d+(?:\.\d+)?(?:\s*[-~]\s*\d+(?:\.\d+)?)?)\s*(?:s\s*(?:\^\s*)?[-−]?\s*1|s[−-]1|s⁻¹)",
        normalized,
        flags=re.IGNORECASE,
    )
    if match:
        return f"{match.group(1).strip()} s^-1"
    fallback = re.search(r"([<>≈~±≤≥]?\s*\d+(?:\.\d+)?(?:\s*[-~]\s*\d+(?:\.\d+)?)?)", normalized)
    if fallback:
        return f"{fallback.group(1).strip()} s^-1"
    return normalized


def _separate_shear_rate_from_speed(item: dict[str, Any]) -> None:
    raw = item.get("shear_rate") or item.get("shearRate")
    if raw not in (None, ""):
        item["shear_rate"] = _normalize_shear_rate(raw)
        return
    speed = item.get("speed") or item.get("speed_value")
    if _looks_like_shear_rate(speed):
        item["shear_rate"] = _normalize_shear_rate(speed)
        item["speed"] = None
        item["speed_value"] = None


def _normalize_range_text(text: Any, unit_hint: str = "") -> Optional[str]:
    raw = str(text or "").strip()
    if not raw:
        return None
    normalized = (
        raw.replace("–", "-")
        .replace("—", "-")
        .replace("−", "-")
        .replace(" to ", "-")
        .replace(" µ", " µ")
    )
    match = re.search(
        r"(\d+(?:\.\d+)?)\s*(?:-|~\s*|to\s+)\s*(\d+(?:\.\d+)?)\s*([a-zA-Zµμ/]+)?",
        normalized,
        flags=re.IGNORECASE,
    )
    if not match:
        return None
    low = match.group(1)
    high = match.group(2)
    unit = (match.group(3) or unit_hint or "").strip()
    return f"{low}-{high} {unit}".strip()


def _extract_panel_context(text: str, source_label: str) -> str:
    if not text or not source_label:
        return ""
    match = re.search(r"([a-z])\s*$", source_label.strip().lower())
    if not match:
        return ""
    panel = match.group(1)
    patterns = [
        rf"\({panel}\)\s*(.*?)(?=\([a-z]\)\s*|$)",
        rf"\b{panel}\)\s*(.*?)(?=\b[a-z]\)\s*|$)",
    ]
    for pattern in patterns:
        hit = re.search(pattern, text, flags=re.IGNORECASE | re.DOTALL)
        if hit:
            return re.sub(r"\s+", " ", hit.group(1)).strip()[:1800]
    return ""


def _collect_il_candidates(text: str) -> List[str]:
    candidates: List[str] = []
    patterns = [
        r"(\[[A-Za-z0-9,+\-]+?\]\[[A-Za-z0-9,+\-]+?\])",
        r"(\[[A-Za-z0-9,+\-()]+?\]\s*i\s*\[[A-Za-z0-9,+\-()]+?\])",
        r"(\[[A-Za-z0-9,+\-()]+?\]\s*[A-Za-z][A-Za-z0-9,+\-()]{1,24})",
    ]
    for pattern in patterns:
        for hit in re.findall(pattern, text, flags=re.IGNORECASE):
            il = re.sub(r"\s+", "", str(hit))
            mixed_left = re.fullmatch(r"(\[[^\[\]]+?\])([A-Za-z][A-Za-z0-9,+\-()]{1,24})", il)
            if mixed_left:
                il = f"{mixed_left.group(1)}[{mixed_left.group(2)}]"
            if il and il not in candidates:
                candidates.append(il)
    return candidates


def _looks_like_source_label(text: Any) -> bool:
    value = str(text or "").strip()
    if not value:
        return False
    return bool(
        re.fullmatch(
            r"(?:text|fig(?:ure)?\.?\s*\d+[a-z]?|table\s*\d+[a-z]?|\d+[a-z]?)",
            value,
            flags=re.IGNORECASE,
        )
    )


def _is_invalid_ionic_liquid_value(value: Any, source: Any, source_figure: Any) -> bool:
    text = str(value or "").strip()
    if not text:
        return True

    normalized = text.lower()
    if normalized in {"unknown", "unknown il", "n/a", "none", "-", "--"}:
        return True
    if _looks_like_source_label(text):
        return True

    source_candidates = {
        str(source or "").strip().lower(),
        str(source_figure or "").strip().lower(),
    }
    source_candidates.discard("")
    if normalized in source_candidates:
        return True

    return False


def _canonicalize_il(value: Any) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    text_l = text.lower()
    if "ethylammonium nitrate" in text_l or re.search(r"\bean\b", text_l):
        return "EAN"
    if "ethaline" in text_l:
        return "Ethaline"
    match = re.search(r"(\[[^\[\]]+?\]\s*(?:i\s*)?\[[^\[\]]+?\])", text)
    if match:
        return re.sub(r"\s+", "", match.group(1)).replace("]i[", "][")
    mixed_match = re.search(r"(\[[^\[\]]+?\]\s*[A-Za-z][A-Za-z0-9,+\-()]{1,24})", text)
    if mixed_match:
        token = re.sub(r"\s+", "", mixed_match.group(1))
        left = re.fullmatch(r"(\[[^\[\]]+?\])([A-Za-z][A-Za-z0-9,+\-()]{1,24})", token)
        if left:
            return f"{left.group(1)}[{left.group(2)}]"
    compact_il_like = bool(
        re.fullmatch(r"[A-Za-z0-9(),+\-\[\]]{2,48}", text)
        or re.fullmatch(r"[A-Za-z0-9(),+\-\[\]]{2,24}\s+[A-Za-z0-9(),+\-\[\]]{1,24}", text)
    )
    if not compact_il_like:
        return ""
    if len(text) > 80:
        return ""
    return text


def normalize_extraction_row(
    row: dict[str, Any],
    fallback_page: Optional[int],
    page_context: Optional[str] = None,
) -> dict[str, Any]:
    item = dict(row or {})
    tribopair = item.get("tribopair") if isinstance(item.get("tribopair"), dict) else {}
    if not item.get("cof"):
        for alias in (
            "friction_coefficient",
            "coefficient_of_friction",
            "mu",
            "mu_value",
            "cof_value",
        ):
            if item.get(alias) not in (None, ""):
                item["cof"] = item.get(alias)
                break
    if not item.get("load") and item.get("load_value") not in (None, ""):
        item["load"] = item.get("load_value")
    if not item.get("speed") and item.get("speed_value") not in (None, ""):
        item["speed"] = item.get("speed_value")
    speed_conditions = normalize_speed_conditions(item.get("speed_conditions") or item.get("speedConditions"))
    if not speed_conditions:
        speed_conditions = derive_speed_conditions(item.get("speed"), context=page_context or item.get("evidence"))
    if speed_conditions:
        item["speed_conditions"] = speed_conditions
        derived_speed = speed_value_from_conditions(speed_conditions)
        if derived_speed:
            item["speed"] = derived_speed
            item["speed_value"] = derived_speed
        elif speed_conditions.get("scan_rate_hz") is not None:
            item["speed"] = None
            item["speed_value"] = None
    _separate_shear_rate_from_speed(item)
    if not item.get("material_name"):
        for alias in ("surface", "substrate", "surface_material", "material"):
            if item.get(alias) not in (None, ""):
                item["material_name"] = item.get(alias)
                break
    if not item.get("substrate_material"):
        for alias in ("substrate", "surface", "surface_material", "material", "material_name"):
            if item.get(alias) not in (None, ""):
                item["substrate_material"] = item.get(alias)
                break
    if not item.get("probe_material"):
        for alias in ("probe", "slider", "upper_specimen", "counterface"):
            if item.get(alias) not in (None, ""):
                item["probe_material"] = item.get(alias)
                break
    if not item.get("ionic_liquid"):
        for alias in ("il", "ionicLiquid", "ionic_liquid_name"):
            if item.get(alias) not in (None, ""):
                item["ionic_liquid"] = item.get(alias)
                break

    if not item.get("cof"):
        evidence = " ".join([str(item.get("evidence") or ""), str(item.get("notes") or "")]).strip()
        evidence_norm = evidence.replace("μ", "mu").replace("µ", "mu").replace("渭", "mu").replace("碌", "mu")
        match = re.search(r"(?:\bmu\b|\bcof\b)\s*[:=]?\s*([-+]?\d+(?:\.\d+)?)", evidence_norm, re.IGNORECASE)
        if match:
            item["cof"] = match.group(1)

    page_ctx = str(page_context or "")[:5000]
    source_val = str(item.get("source") or "").strip()
    source_fig_val = str(item.get("source_figure") or "").strip()
    if _is_invalid_ionic_liquid_value(item.get("ionic_liquid"), source_val, source_fig_val):
        item["ionic_liquid"] = None
    if re.search(r"\([a-z]\)|\d+[a-z]\b", source_val, flags=re.IGNORECASE):
        source_tag = source_val
    elif source_fig_val:
        source_tag = source_fig_val
    else:
        source_tag = source_val

    panel_ctx = _extract_panel_context(page_ctx, source_tag)
    if not item.get("ionic_liquid"):
        local_space = " ".join(
            [
                str(item.get("sample") or ""),
                str(item.get("sample_id") or ""),
                str(item.get("condition") or ""),
                str(tribopair.get("coating") or ""),
                str(item.get("evidence") or ""),
                str(item.get("notes") or ""),
                str(item.get("source") or ""),
                str(item.get("source_figure") or ""),
            ]
        )
        full_space = f"{local_space} {page_ctx}".strip()

        local_ils = _collect_il_candidates(local_space)
        if len(local_ils) == 1:
            item["ionic_liquid"] = local_ils[0]
        else:
            panel_ils = _collect_il_candidates(f"{local_space} {panel_ctx}".strip())
            if len(panel_ils) == 1:
                item["ionic_liquid"] = panel_ils[0]
            all_ils = _collect_il_candidates(full_space)
            if (not item.get("ionic_liquid")) and len(all_ils) == 1:
                item["ionic_liquid"] = all_ils[0]

    if not item.get("ionic_liquid"):
        il_spaces = [
            str(item.get("sample") or ""),
            str(item.get("sample_id") or ""),
            str(item.get("condition") or ""),
            str(tribopair.get("coating") or ""),
            str(item.get("evidence") or ""),
            str(item.get("notes") or ""),
            str(item.get("source") or ""),
            str(item.get("source_figure") or ""),
            panel_ctx,
        ]
        for space in il_spaces:
            text = str(space or "").strip()
            if len(text) < 2:
                continue
            inferred = _canonicalize_il(normalize_ionic_liquid(text))
            inferred_l = str(inferred or "").strip().lower()
            if inferred and inferred_l not in {"unknown", "unknown il", "n/a", "-", "--"}:
                item["ionic_liquid"] = inferred
                break

    if not item.get("material_name"):
        local_space_l = " ".join(
            [
                str(item.get("sample") or ""),
                str(item.get("condition") or ""),
                str(item.get("evidence") or ""),
                str(item.get("notes") or ""),
                str(item.get("source") or ""),
                str(item.get("source_figure") or ""),
            ]
        ).lower()
        space_l = f"{local_space_l} {panel_ctx.lower()} {page_ctx.lower()}".strip()
        surface_patterns = [
            (r"\bau\s*\(?111\)?\b|\bgold\s*\(?111\)?\b", "Au(111)"),
            (r"\bmica\b", "Mica"),
            (r"\bhopg\b|\bgraphite\b", "HOPG"),
            (r"\bsilica\b|\bsio2\b", "Silica"),
        ]
        for pattern, label in surface_patterns:
            if re.search(pattern, space_l):
                item["material_name"] = label
                item.setdefault("substrate_material", label)
                break

    tribo_space = " ".join(
        [
            str(item.get("evidence") or ""),
            str(item.get("notes") or ""),
            str(item.get("source") or ""),
            str(item.get("source_figure") or ""),
            panel_ctx,
            page_ctx[:2500],
        ]
    )
    tribo_space_norm = re.sub(r"\s+", " ", tribo_space).strip()
    tribo_l = tribo_space_norm.lower()

    if not item.get("probe_material"):
        if re.search(r"\bsilica\s+(?:colloid|sphere|probe)\b", tribo_l):
            item["probe_material"] = "Silica"
        elif re.search(r"\bsteel\s+(?:ball|sphere|probe|pin)\b", tribo_l):
            item["probe_material"] = "Steel"

    if not item.get("probe_geometry"):
        if re.search(r"\bcolloid(?:al)?\s+probe\b", tribo_l):
            item["probe_geometry"] = "Colloid probe"
        elif re.search(r"\bsilica\s+sphere\b|\bsphere\b", tribo_l):
            item["probe_geometry"] = "Sphere"
        elif re.search(r"\btip\b", tribo_l):
            item["probe_geometry"] = "Tip"

    if not item.get("probe_radius"):
        radius_match = re.search(
            r"(\d+(?:\.\d+)?)\s*-\s*(?:µ|μ|u)m\s+(?:silica\s+)?sphere",
            tribo_space_norm,
            flags=re.IGNORECASE,
        )
        if radius_match:
            item["probe_radius"] = f"{radius_match.group(1)} µm"
        else:
            diameter_match = re.search(
                r"(\d+(?:\.\d+)?)\s*(?:µ|μ|u)m\s+(?:silica\s+)?sphere",
                tribo_space_norm,
                flags=re.IGNORECASE,
            )
            if diameter_match:
                item["probe_radius"] = f"{diameter_match.group(1)} µm"

    if not item.get("substrate_material"):
        if re.search(r"\bmica\b", tribo_l):
            item["substrate_material"] = "Mica"
        elif re.search(r"\bsilica\b", tribo_l):
            item["substrate_material"] = "Silica"

    if not item.get("substrate_coating"):
        if re.search(r"\bpeg(?:-brush|-coated|-il)?\b|\bpll-g-peg\b", tribo_l):
            item["substrate_coating"] = "PEG-brush"
        elif item.get("substrate_material") and re.search(r"\bbare\b|\buncoated\b", tribo_l):
            item["substrate_coating"] = "None"

    roughness_context = " ".join(
        [
            str(item.get("substrate_roughness") or ""),
            str(item.get("surface_roughness") or ""),
            str(item.get("evidence") or ""),
            str(item.get("notes") or ""),
            tribo_space_norm,
            page_ctx[:2500],
        ]
    )
    substrate_material_hint = item.get("substrate_material") or item.get("material_name")
    normalized_substrate_roughness = normalize_surface_roughness_value(
        item.get("substrate_roughness"),
        context_text=roughness_context,
        substrate_material=substrate_material_hint,
    )
    normalized_surface_roughness = normalize_surface_roughness_value(
        item.get("surface_roughness"),
        context_text=roughness_context,
        substrate_material=substrate_material_hint,
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
    elif not item.get("substrate_roughness") and inferred_roughness:
        item["substrate_roughness"] = inferred_roughness
    if normalized_surface_roughness:
        item["surface_roughness"] = normalized_surface_roughness

    if item.get("substrate_material") and not item.get("material_name"):
        item["material_name"] = item["substrate_material"]
    if item.get("substrate_roughness") and not item.get("surface_roughness"):
        item["surface_roughness"] = item["substrate_roughness"]

    load_space = " ".join(
        [
            str(item.get("load") or ""),
            str(item.get("normal_load") or ""),
            str(item.get("evidence") or ""),
            page_ctx[:2500],
        ]
    )
    if not item.get("load"):
        load_range = _normalize_range_text(load_space, "nN")
        if load_range:
            item["load"] = load_range
    if not item.get("normal_load"):
        load_range = _normalize_range_text(load_space, "nN")
        if load_range:
            item["normal_load"] = load_range
    elif str(item.get("normal_load") or "").strip().isdigit() and "ranging from" in load_space.lower():
        load_range = _normalize_range_text(load_space, "nN")
        if load_range:
            item["normal_load"] = load_range
            item["load"] = load_range

    if not item.get("normal_load") and item.get("load"):
        item["normal_load"] = item.get("load")
    if not item.get("load") and item.get("normal_load"):
        item["load"] = item.get("normal_load")
    for key in ("cof", "load", "normal_load", "speed", "shear_rate", "temperature", "film_thickness", "friction_force", "potential"):
        if key in item and item[key] is not None:
            item[key] = re.sub(r"\s+", " ", str(item[key]).replace("µ", "μ").replace("渭", "μ").replace("碌", "μ")).strip()
    _sanitize_thickness_fields(item)
    if item.get("potential"):
        item["potential"] = normalize_potential_text(item["potential"])
    if item.get("temperature"):
        item["temperature"] = normalize_temperature(str(item["temperature"]))
    if fallback_page and not item.get("source_page"):
        item["source_page"] = int(fallback_page)
    if not item.get("source"):
        item["source"] = item.get("source_figure") or "Text"
    if item.get("evidence"):
        text = re.sub(r"\s+", " ", str(item["evidence"]).replace("\u00ad", "")).strip()
        if len(text) > 560:
            text = re.sub(r"\s+\S*$", "", text[:560]).strip()
        item["evidence"] = text
    return item
