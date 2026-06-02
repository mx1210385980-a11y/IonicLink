from __future__ import annotations

import re
from typing import Any

CANONICAL_DIFFUSION_UNIT = "10⁻¹² m²/s"


def _to_float(value: Any) -> float | None:
    try:
        return float(str(value).strip())
    except Exception:
        return None


def _canonical_from_10_minus_10(value: Any) -> float | None:
    numeric = _to_float(value)
    if numeric is None:
        return None
    return round(numeric * 100.0, 12)


def _normalize_ion_token(value: str) -> str:
    return re.sub(r"[^A-Za-z0-9]", "", value or "")


def _ionic_liquid_from_caption(caption: str) -> str | None:
    text = caption or ""
    cation = None
    anion = None
    if re.search(r"\bBuPy\s*\+", text, flags=re.IGNORECASE):
        cation = "BuPy"
    if re.search(r"\bNTf\s*2|NTf2|TFSI", text, flags=re.IGNORECASE):
        anion = "NTf2"
    if cation and anion:
        return f"[{cation}][{anion}]"

    bracket_match = re.search(r"\[([^\]]+)\]\s*\[([^\]]+)\]", text)
    if bracket_match:
        return f"[{_normalize_ion_token(bracket_match.group(1))}][{_normalize_ion_token(bracket_match.group(2))}]"
    return None


def _word_bbox(words: list[tuple]) -> list[float]:
    return [
        float(min(word[0] for word in words)),
        float(min(word[1] for word in words)),
        float(max(word[2] for word in words)),
        float(max(word[3] for word in words)),
    ]


def _merge_bboxes(bboxes: list[list[float]]) -> list[float] | None:
    valid = [bbox for bbox in bboxes if len(bbox) >= 4]
    if not valid:
        return None
    return [
        float(min(bbox[0] for bbox in valid)),
        float(min(bbox[1] for bbox in valid)),
        float(max(bbox[2] for bbox in valid)),
        float(max(bbox[3] for bbox in valid)),
    ]


def _line_groups(words: list[tuple]) -> list[list[tuple]]:
    rows: list[list[tuple]] = []
    for word in sorted(words, key=lambda item: (float(item[1]), float(item[0]))):
        if not rows or abs(float(rows[-1][0][1]) - float(word[1])) > 3.5:
            rows.append([word])
        else:
            rows[-1].append(word)
    return rows


def _line_text(row: list[tuple]) -> str:
    return " ".join(str(word[4] or "") for word in sorted(row, key=lambda item: float(item[0]))).strip()


def _row_values(row: list[tuple]) -> list[str] | None:
    values = [str(word[4] or "").strip().rstrip(",;") for word in sorted(row, key=lambda item: float(item[0]))]
    if len(values) < 9:
        return None
    if _to_float(values[0]) is None:
        return None
    numeric_or_na = values[:9]
    if not all(value.lower() == "n/a" or _to_float(value) is not None for value in numeric_or_na):
        return None
    return numeric_or_na


def _layer_payload(values: list[str]) -> list[dict[str, Any]]:
    layers = []
    for layer, cation_index, anion_index in (("I", 3, 4), ("II", 5, 6), ("III", 7, 8)):
        cation = None if values[cation_index].lower() == "n/a" else _canonical_from_10_minus_10(values[cation_index])
        anion = None if values[anion_index].lower() == "n/a" else _canonical_from_10_minus_10(values[anion_index])
        if cation is None and anion is None:
            continue
        layers.append(
            {
                "layer": layer,
                "D_cation": cation,
                "D_anion": anion,
                "unit": CANONICAL_DIFFUSION_UNIT,
            }
        )
    return layers


def _surface_for_y(surface_markers: list[tuple[float, str]], y: float) -> str | None:
    active = None
    for marker_y, label in sorted(surface_markers, key=lambda item: item[0]):
        if marker_y <= y + 1:
            active = label
        else:
            break
    return active


def extract_layerwise_diffusion_table_records(pdf_path: str | None) -> list[dict[str, Any]]:
    if not pdf_path:
        return []
    try:
        import fitz
    except Exception:
        return []

    records: list[dict[str, Any]] = []
    try:
        with fitz.open(pdf_path) as doc:
            for page_index, page in enumerate(doc):
                words = page.get_text("words") or []
                lines = _line_groups(words)
                caption_lines = [
                    _line_text(line)
                    for line in lines
                    if "diffusion coefficients" in _line_text(line).lower()
                    and "layer-wise" in _line_text(line).lower()
                ]
                if not caption_lines:
                    continue
                caption = " ".join(caption_lines)
                ionic_liquid = _ionic_liquid_from_caption(caption) or "[BuPy][NTf2]"
                caption_line_groups = [
                    line
                    for line in lines
                    if "diffusion coefficients" in _line_text(line).lower()
                    and "layer-wise" in _line_text(line).lower()
                ]

                surface_markers: list[tuple[float, str]] = []
                surface_marker_lines: list[list[tuple]] = []
                for line in lines:
                    text = _line_text(line).lower()
                    if "non-polarizable surface" in text:
                        surface_markers.append((float(line[0][1]), "non-polarizable surface"))
                        surface_marker_lines.append(line)
                    elif "polarizable surface" in text:
                        surface_markers.append((float(line[0][1]), "polarizable surface"))
                        surface_marker_lines.append(line)

                parsed_lines: list[list[tuple]] = []
                pending_records: list[dict[str, Any]] = []
                for line in lines:
                    values = _row_values(line)
                    if not values:
                        continue
                    y = float(line[0][1])
                    surface = _surface_for_y(surface_markers, y)
                    if not surface:
                        continue
                    scale = _to_float(values[0])
                    d_cation = _canonical_from_10_minus_10(values[1])
                    d_anion = _canonical_from_10_minus_10(values[2])
                    if scale is None or (d_cation is None and d_anion is None):
                        continue
                    parsed_lines.append(line)
                    layers = _layer_payload(values)
                    evidence = (
                        f"Table II reports D+tot={values[1]} and D-tot={values[2]} x 10^-10 m2/s "
                        f"for {ionic_liquid} at d={values[0]} nm on a {surface}."
                    )
                    if layers:
                        evidence += " Layer-wise values are stored in novel_features_json."
                    row_bbox = _word_bbox(line[:9])
                    pending_records.append(
                        {
                            "system_name": "Graphene slit pore",
                            "confinement_material_class": "Carbon",
                            "confinement_geometry_class": "Slit",
                            "surface_functional_groups": surface,
                            "confinement_dimensionality": "2D",
                            "ionic_liquid": ionic_liquid,
                            "D_total": None,
                            "D_cation": d_cation,
                            "D_anion": d_anion,
                            "D_unit": CANONICAL_DIFFUSION_UNIT,
                            "temperature_value": 300.0,
                            "confinement_scale_value": scale,
                            "confinement_scale_unit": "nm",
                            "source": "Table II",
                            "source_page": page_index + 1,
                            "source_bbox": row_bbox,
                            "evidence": evidence,
                            "record_origin": "pdf_layerwise_table_parser",
                            "review_status": "pending_review",
                            "confidence": 0.96,
                            "novel_features_json": {
                                "table_parser": "layerwise_diffusion.v1",
                                "source_unit": "10^-10 m2/s",
                                "source_row_bbox": row_bbox,
                                "surface_polarizability": surface.replace(" surface", ""),
                                "layer_diffusion_coefficients": layers,
                            },
                        }
                    )
                if pending_records:
                    header_lines = [
                        line
                        for line in lines
                        if parsed_lines
                        and min(float(parsed_line[0][1]) for parsed_line in parsed_lines) - 55 <= float(line[0][1]) <= min(float(parsed_line[0][1]) for parsed_line in parsed_lines) - 5
                    ]
                    table_bbox = _merge_bboxes(
                        [_word_bbox(line) for line in [*caption_line_groups, *header_lines, *surface_marker_lines, *parsed_lines]]
                    )
                    for record in pending_records:
                        if table_bbox:
                            record["source_bbox"] = table_bbox
                            record["novel_features_json"]["source_table_bbox"] = table_bbox
                        records.append(record)
    except Exception:
        return records
    return records


def merge_layerwise_table_records(raw_rows: list[dict[str, Any]], parsed_rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if not parsed_rows:
        return raw_rows
    parsed_scales = {round(float(row["confinement_scale_value"]), 6) for row in parsed_rows if row.get("confinement_scale_value") is not None}

    def is_shadow_row(row: dict[str, Any]) -> bool:
        source = str(row.get("source") or "").lower()
        evidence = str(row.get("evidence") or "").lower()
        scale = _to_float(row.get("confinement_scale_value"))
        return (
            "table ii" in source
            and scale is not None
            and round(scale, 6) in parsed_scales
            and row.get("D_total") not in (None, "")
            and row.get("D_cation") in (None, "")
            and row.get("D_anion") in (None, "")
            and ("bupy" in evidence or "ntf" in evidence)
        )

    return [row for row in raw_rows if not is_shadow_row(row)] + parsed_rows
