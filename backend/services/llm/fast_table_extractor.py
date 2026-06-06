from __future__ import annotations

import os
import re
from typing import Any, Optional

import fitz

from services.llm.utils import clean_and_parse_json
from services.normalization import normalize_extraction_row
from services.normalization.potential import normalize_potential_text
from utils.pdf_utils import repair_pdf_text_unit_artifacts


FAST_TABLE_RECORD_ORIGIN = "fast_table_extraction"


def _filled(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, (int, float)):
        return str(value).strip()
    return str(value or "").strip()


def _normalized_header(value: Any) -> str:
    text = _filled(value).lower()
    text = text.replace("µ", "μ")
    return re.sub(r"[\s_\-:：/\\（）()\[\]{}]+", "", text)


def _header_matches(header: Any, aliases: tuple[str, ...], *, exclude: tuple[str, ...] = ()) -> bool:
    normalized = _normalized_header(header)
    if not normalized:
        return False
    for blocked in exclude:
        if _normalized_header(blocked) in normalized:
            return False
    for alias in aliases:
        alias_norm = _normalized_header(alias)
        if alias_norm and (normalized == alias_norm or alias_norm in normalized):
            return True
    return False


def _field_value(row: dict[str, Any], aliases: tuple[str, ...], *, exclude: tuple[str, ...] = ()) -> str:
    for key, value in row.items():
        if _header_matches(key, aliases, exclude=exclude):
            text = _filled(value)
            if text and text.lower() not in {"null", "none", "n/a", "na", "-", "--"}:
                return text
    return ""


def _tribopair_material_label(text: str) -> str:
    cleaned = re.sub(
        r"\b(?:colloid(?:al)?|afm|probe|tip|sphere|ball|pin|disk|disc|surface|substrate|electrode|counterface|sample|specimen)\b",
        " ",
        text,
        flags=re.IGNORECASE,
    )
    normalized = re.sub(r"\s+", " ", cleaned).strip(" /,;:-")
    lowered = text.lower()
    if re.search(r"\bau\s*\(?111\)?\b|\bgold\b", lowered):
        return "Au(111)"
    if re.search(r"\bhopg\b|\bgraphite\b", lowered):
        return "HOPG"
    if re.search(r"\bmica\b", lowered):
        return "Mica"
    if re.search(r"\bsilica\b|\bsio2\b", lowered):
        return "Silica"
    if re.search(r"\bsilicon\s+nitride\b|\bsi3n4\b", lowered):
        return "Silicon nitride"
    if re.search(r"\bsilicon\b|\bsi\b", lowered):
        return "Silicon"
    if re.search(r"\bsteel\b|100cr6|52100|suj2", lowered):
        return "Steel"
    return normalized or text.strip()


def _tribopair_probe_geometry(text: str) -> str | None:
    lowered = text.lower()
    if re.search(r"\bcolloid(?:al)?\s+probe\b|\bmicrosphere\b|\bsphere\b", lowered):
        return "Colloid probe"
    if re.search(r"\b(?:afm\s+)?(?:tip|probe)\b", lowered):
        return "Tip"
    if re.search(r"\bball\b", lowered):
        return "Ball"
    if re.search(r"\bpin\b", lowered):
        return "Pin"
    return None


def _split_fast_table_friction_pair(value: str) -> dict[str, str]:
    text = _filled(value)
    if not text:
        return {}
    normalized = (
        text.replace("−", "-")
        .replace("–", " / ")
        .replace("—", " / ")
        .replace(" vs. ", " / ")
        .replace(" vs ", " / ")
    )
    parts = [part.strip() for part in re.split(r"\s*/\s*", normalized) if part.strip()]
    if len(parts) < 2:
        return {}

    first, second = parts[0], parts[1]
    first_l = first.lower()
    second_l = second.lower()
    first_is_probe = bool(re.search(r"\b(?:colloid(?:al)?\s+probe|afm\s+tip|probe|tip|ball|pin|sphere)\b", first_l))
    second_is_substrate = bool(re.search(r"\b(?:substrate|surface|disk|disc|plate|electrode|hopg|mica|au\s*\(?111\)?|gold|steel|silica|graphite)\b", second_l))
    if not first_is_probe and not second_is_substrate:
        return {}

    result = {
        "probe_material": _tribopair_material_label(first),
        "substrate_material": _tribopair_material_label(second),
    }
    geometry = _tribopair_probe_geometry(first)
    if geometry:
        result["probe_geometry"] = geometry
    return result


def _split_markdown_row(line: str) -> list[str]:
    stripped = line.strip()
    if stripped.startswith("|"):
        stripped = stripped[1:]
    if stripped.endswith("|"):
        stripped = stripped[:-1]
    return [cell.strip() for cell in stripped.split("|")]


def _is_markdown_separator(cells: list[str]) -> bool:
    return bool(cells) and all(re.fullmatch(r":?-{3,}:?", cell.strip()) for cell in cells)


def _parse_markdown_table(text: str) -> list[dict[str, str]]:
    lines = [
        line
        for line in (_filled(text).replace("```", "").splitlines())
        if "|" in line and line.strip().strip("|").strip()
    ]
    if len(lines) < 2:
        return []

    headers: list[str] = []
    rows: list[dict[str, str]] = []
    for line in lines:
        cells = _split_markdown_row(line)
        if _is_markdown_separator(cells):
            continue
        if not headers:
            headers = cells
            continue
        if not any(cells):
            continue
        if len(cells) < len(headers):
            cells = [*cells, *([""] * (len(headers) - len(cells)))]
        if len(cells) > len(headers):
            cells = cells[: len(headers)]
        rows.append(dict(zip(headers, cells)))
    return rows


def parse_fast_table_response(text: str) -> list[dict[str, Any]]:
    if "|" in _filled(text):
        markdown_rows = _parse_markdown_table(text)
        if markdown_rows:
            return markdown_rows

    parsed = clean_and_parse_json(text)
    if isinstance(parsed, dict):
        for key in ("data", "records", "rows"):
            value = parsed.get(key)
            if isinstance(value, list):
                return [row for row in value if isinstance(row, dict)]
        return [parsed]
    if isinstance(parsed, list):
        return [row for row in parsed if isinstance(row, dict)]
    return _parse_markdown_table(text)


def _extract_cof(value: Any) -> Optional[str]:
    text = _filled(value).replace("μ", "").replace("µ", "")
    if not text:
        return None
    match = re.search(r"-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?", text)
    if not match:
        return None
    try:
        number = float(match.group(0))
    except ValueError:
        return None
    if not (0.0 <= number <= 5.0):
        return None
    return match.group(0)


def _extract_source_page(*values: Any) -> Optional[int]:
    for value in values:
        text = _filled(value)
        if not text:
            continue
        for pattern in (
            r"\bsource[_\s-]*page\b\s*[:：#]?\s*(\d{1,4})",
            r"\bpage\b\s*[:：#]?\s*(\d{1,4})",
            r"\bp\.?\s*(\d{1,4})\b",
            r"\bpdf\s*\+\s*(\d{1,4})\b",
            r"第\s*(\d{1,4})\s*页",
        ):
            match = re.search(pattern, text, flags=re.IGNORECASE)
            if match:
                return int(match.group(1))
        if isinstance(value, int) or (isinstance(value, str) and value.strip().isdigit()):
            page = int(value)
            if page > 0:
                return page
    return None


def _extract_potential(conditions: str) -> Optional[str]:
    text = _filled(conditions).replace("＋", "+").replace("−", "-")
    if not text:
        return None
    voltage_values = re.findall(
        r"([+\-]?\s*\d+(?:\.\d+)?)\s*(?:mV|millivolts?|V|volts?)\b",
        text,
        flags=re.IGNORECASE,
    )
    if len({re.sub(r"\s+", "", value) for value in voltage_values}) > 1:
        return None
    if re.search(r"\b(?:OCP|OCV|open[-\s]*circuit(?:\s+potential)?)\b", text, flags=re.IGNORECASE):
        normalized = normalize_potential_text(text)
        if normalized and normalized != text:
            return normalized
        if not voltage_values:
            return "0 V vs OCP"
    match = re.search(
        r"([+\-]?\s*\d+(?:\.\d+)?)\s*(mV|millivolts?|V|volts?)\b",
        text,
        flags=re.IGNORECASE,
    )
    if match:
        raw = re.sub(r"\s+", "", match.group(1)) + f" {match.group(2)}"
        return normalize_potential_text(raw) or raw
    if any(token in text for token in ("未施加电压", "无偏置", "no bias", "without bias")):
        return "0 V"
    return None


def _compact_number(value: str) -> str:
    try:
        parsed = float(value.replace(":", "."))
    except ValueError:
        return value
    return f"{parsed:g}"


def _extract_explicit_speed(*values: Any) -> Optional[str]:
    text = " ".join(_filled(value) for value in values if _filled(value))
    if not text:
        return None
    normalized = (
        text.replace("µ", "μ")
        .replace("−", "-")
        .replace("–", "-")
        .replace("\x02", "-")
    )
    match = re.search(
        r"([-+]?\d+(?:[.:]\d+)?)\s*(μm/s|um/s|mm/s|m/s)\b",
        normalized,
        flags=re.IGNORECASE,
    )
    if not match:
        match = re.search(
            r"([-+]?\d+(?:[.:]\d+)?)\s*(μm|um|mm|m)\s*(?:[·⋅.]\s*|\s+)s\s*(?:\^-?1|-1|−1|⁻1|⁻¹)\b",
            normalized,
            flags=re.IGNORECASE,
        )
    if not match:
        return None
    unit = match.group(2).replace("um", "μm")
    if "/" not in unit:
        unit = f"{unit}/s"
    return f"{_compact_number(match.group(1))} {unit}"


def _extract_explicit_load(*values: Any) -> Optional[str]:
    text = " ".join(_filled(value) for value in values if _filled(value))
    if not text:
        return None
    normalized = re.sub(r"\s+", " ", text.replace("−", "-"))
    match = re.search(
        r"\b(?:normal\s+)?load(?:\s*\([^)]+\))?"
        r"(?:\s+(?:applied|applied\s+was|was|of))?\s*(?:=|:|was|of)?\s*"
        r"([-+]?\d+(?:\.\d+)?)\s*(mN|μN|µN|uN|nN|N)\b",
        normalized,
        flags=re.IGNORECASE,
    )
    if not match:
        return None
    unit = match.group(2).replace("µ", "μ").replace("uN", "μN")
    return f"{_compact_number(match.group(1))} {unit}"


def _format_kelvin_from_celsius(value: str) -> Optional[str]:
    try:
        celsius = float(value)
    except ValueError:
        return None
    return f"{celsius + 273.15:.2f} K"


def _extract_temperature_text(*values: Any) -> Optional[str]:
    text = " ".join(_filled(value) for value in values if _filled(value))
    if not text:
        return None
    normalized = re.sub(r"\s+", " ", text.replace("−", "-"))
    number = r"[-+]?\d+(?:\.\d+)?"
    separator = r"(?:\s*,\s*|\s*,?\s+(?:and|or)\s+)"
    number_series = rf"{number}(?:{separator}{number})*"
    temperatures: list[str] = []
    seen: set[str] = set()

    def add_series(series_text: str) -> None:
        for raw_value in re.findall(number, series_text):
            kelvin = _format_kelvin_from_celsius(raw_value)
            if kelvin and kelvin not in seen:
                temperatures.append(kelvin)
                seen.add(kelvin)

    for match in re.finditer(
        rf"\b(?:temperature|temp|test\s+temperature)\s*,\s*(?:°\s*)?C\s+(?P<values>{number_series})\b",
        normalized,
        flags=re.IGNORECASE,
    ):
        add_series(match.group("values"))

    for match in re.finditer(rf"(?P<values>{number_series})\s*(?:°\s*)?C\b", normalized, flags=re.IGNORECASE):
        add_series(match.group("values"))

    if temperatures:
        return "; ".join(temperatures)
    if re.search(r"\b(?:room|ambient)\s+temperature\b|\bRT\b", normalized, flags=re.IGNORECASE):
        return "298.15 K"
    return None


def _extract_relative_humidity_text(*values: Any) -> Optional[str]:
    text = " ".join(_filled(value) for value in values if _filled(value))
    if not text:
        return None
    normalized = re.sub(r"\s+", " ", text.replace("−", "-"))
    number = r"\d+(?:\.\d+)?"
    separator = r"(?:\s*,\s*|\s*,?\s+(?:and|or)\s+)"
    number_series = rf"{number}(?:{separator}{number})*"
    humidity_values: list[str] = []
    seen: set[str] = set()

    def add_series(series_text: str) -> None:
        for raw_value in re.findall(number, series_text):
            compact = _compact_number(raw_value)
            label = f"{compact}% RH"
            if label not in seen:
                humidity_values.append(label)
                seen.add(label)

    for match in re.finditer(
        rf"(?P<values>{number_series})\s*%?\s*(?:RH|R\.H\.|relative\s+humidity)\b",
        normalized,
        flags=re.IGNORECASE,
    ):
        add_series(match.group("values"))

    for match in re.finditer(
        rf"\b(?:relative\s+humidity|RH|R\.H\.)\b[^.;]{{0,80}}?\(?\s*(?P<values>{number_series})\s*%?\)?",
        normalized,
        flags=re.IGNORECASE,
    ):
        add_series(match.group("values"))

    if humidity_values:
        return "; ".join(humidity_values)
    return None


def normalize_fast_table_rows(
    rows: list[dict[str, Any]],
    *,
    page_context: str = "",
) -> list[dict[str, Any]]:
    normalized_rows: list[dict[str, Any]] = []

    for row in rows or []:
        ionic_liquid = _field_value(
            row,
            ("ionic_liquid", "ionic liquid", "il", "离子液体", "润滑剂"),
        )
        friction_pair = _field_value(
            row,
            ("friction_pair", "tribopair", "摩擦副", "对偶件", "实验系统", "接触副"),
        )
        conditions = _field_value(
            row,
            ("conditions", "condition", "实验工况", "工况", "偏置电压", "测试条件"),
        )
        cof = _extract_cof(
            _field_value(
                row,
                (
                    "cof",
                    "friction coefficient",
                    "coefficient of friction",
                    "mu",
                    "μ",
                    "摩擦系数",
                ),
            )
        )
        data_source_type = _field_value(
            row,
            ("数据来源类型", "source_type", "data_source_type", "measurement type", "方法", "类型"),
        )
        source = _field_value(
            row,
            ("source", "数据来源", "来源", "source_label"),
            exclude=("类型", "type"),
        )
        evidence = _field_value(row, ("evidence", "证据", "原文", "quote", "依据"))
        speed = _extract_explicit_speed(
            _field_value(row, ("speed", "velocity", "sliding speed", "sliding velocity", "速度", "滑移速度")),
            conditions,
            evidence,
        )
        load = _extract_explicit_load(
            _field_value(row, ("load", "normal load", "force", "载荷", "负载", "法向载荷")),
            conditions,
            evidence,
        )
        source_page = _extract_source_page(
            _field_value(row, ("source_page", "page", "页码", "页")),
            source,
            evidence,
        )

        if not ionic_liquid or not friction_pair or not cof:
            continue

        evidence_text = evidence or " | ".join(
            part
            for part in (
                f"IL: {ionic_liquid}",
                f"摩擦副: {friction_pair}",
                f"工况: {conditions}" if conditions else "",
                f"μ: {cof}",
                data_source_type,
                source,
            )
            if part
        )
        notes = "; ".join(
            part
            for part in (
                f"Conditions: {conditions}" if conditions else "",
                f"Data source type: {data_source_type}" if data_source_type else "",
            )
            if part
        )
        source_label = source or "Gemini Flash table"
        source_figure = source_label if re.search(r"\b(fig(?:ure)?|table)\b", source_label, re.IGNORECASE) else None
        temperature_field = _field_value(row, ("temperature", "temp", "温度"))
        temperature = _extract_temperature_text(temperature_field or conditions, "" if temperature_field else evidence_text)
        water_content_field = _field_value(row, ("water_content", "water content", "humidity", "relative humidity", "rh", "湿度"))
        water_content = _extract_relative_humidity_text(
            water_content_field or conditions,
            "" if water_content_field else evidence_text,
        )
        tribopair_parts = _split_fast_table_friction_pair(friction_pair)
        substrate_material = tribopair_parts.get("substrate_material") or friction_pair

        item: dict[str, Any] = {
            "ionic_liquid": ionic_liquid,
            "material_name": friction_pair,
            "probe_material": tribopair_parts.get("probe_material") or None,
            "probe_geometry": tribopair_parts.get("probe_geometry") or None,
            "substrate_material": substrate_material,
            "cof": cof,
            "potential": _extract_potential(conditions),
            "regime": conditions or None,
            "notes": notes or None,
            "load": load,
            "load_value": load,
            "speed": speed,
            "source": source_label,
            "source_page": source_page,
            "source_figure": source_figure,
            "evidence": evidence_text,
            "record_origin": FAST_TABLE_RECORD_ORIGIN,
            "review_status": "needs_review",
            "confidence": 0.72,
            "assembly_notes": "Fast table extraction candidate; review before promotion.",
            "value_origin": FAST_TABLE_RECORD_ORIGIN,
        }
        row_speed_context = " ".join(part for part in (conditions, evidence_text) if part)
        normalized = normalize_extraction_row(
            item,
            fallback_page=source_page,
            page_context=speed or row_speed_context or " ",
        )
        normalized.pop("speed_conditions", None)
        if not speed:
            derived_speed = normalized.get("speed") or normalized.get("speed_value")
            if derived_speed:
                normalized["speed"] = derived_speed
                normalized["speed_value"] = derived_speed
            else:
                normalized.pop("speed", None)
                normalized.pop("speed_value", None)
        else:
            normalized["speed"] = speed
            normalized["speed_value"] = speed
        normalized["record_origin"] = FAST_TABLE_RECORD_ORIGIN
        normalized["review_status"] = "needs_review"
        normalized["assembly_notes"] = item["assembly_notes"]
        normalized["confidence"] = min(float(normalized.get("confidence") or 0.72), 0.72)
        if load:
            normalized["load"] = load
            normalized["load_value"] = load
        if temperature:
            normalized["temperature"] = temperature
        if water_content:
            normalized["water_content"] = water_content
        normalized_rows.append(normalized)

    return normalized_rows


def build_fast_table_document_text(content: str = "", pdf_path: Optional[str] = None, *, max_chars: Optional[int] = None) -> str:
    limit = max_chars
    if limit is None:
        try:
            limit = int(os.getenv("LLM_FAST_TABLE_MAX_INPUT_CHARS", "900000") or "900000")
        except ValueError:
            limit = 900000
    limit = max(20000, min(int(limit), 1200000))

    document_text = ""
    if pdf_path and os.path.exists(pdf_path):
        try:
            with fitz.open(pdf_path) as doc:
                parts = []
                for idx, page in enumerate(doc):
                    page_text = repair_pdf_text_unit_artifacts(page.get_text("text") or "")
                    page_text = re.sub(r"\s+", " ", page_text).strip()
                    if page_text:
                        parts.append(f"[Page {idx + 1}]\n{page_text}")
                document_text = "\n\n".join(parts)
        except Exception:
            document_text = ""

    if not document_text:
        document_text = _filled(content)

    document_text = document_text.replace("\u00ad", "")
    document_text = repair_pdf_text_unit_artifacts(document_text)
    if len(document_text) <= limit:
        return document_text
    return document_text[:limit]
