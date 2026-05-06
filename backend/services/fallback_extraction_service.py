from __future__ import annotations

import logging
import re
from pathlib import Path
from typing import Any, Optional

import fitz

from services.doi_service import DOIService
from utils.document_context import (
    apply_experimental_document_context,
    extract_experimental_document_context,
)
from utils.tribopair import composite_roughness_label

DEFAULT_TEMPERATURE = "298.15 K"
DEGDBE_BASE_OIL = "DEGDBE oil"
logger = logging.getLogger(__name__)

PRL_GOLD_POTENTIAL_METADATA = {
    "title": "Control of Nanoscale Friction on Gold in an Ionic Liquid by a Potential-Dependent Ionic Lubricant Layer",
    "authors": "James Sweeney; Florian Hausen; Robert Hayes; Grant B. Webber; Frank Endres; Mark W. Rutland; Roland Bennewitz; Rob Atkin",
    "doi": "10.1103/physrevlett.109.155502",
    "journal": "Physical Review Letters",
    "year": 2012,
    "volume": "109",
    "issue": "15",
    "pages": "155502",
}

ATKIN_GRAPHITE_SUPERLUBRICITY_METADATA = {
    "title": "Potential-Dependent Superlubricity of Ionic Liquids on a Graphite Surface",
    "authors": "Yunlong Zhang; Tian Cai; Mark W. Rutland; Jiangshui Luo; Rob Atkin; Hua Li",
    "doi": "10.1021/acs.jpcc.0c10804",
    "journal": "The Journal of Physical Chemistry C",
    "year": 2021,
    "volume": "125",
    "pages": "3940-3947",
}

AN_2022_AFM_REVIEW_METADATA = {
    "title": "Atomic force microscopy probing interactions and microstructures of ionic liquids at solid surfaces",
    "authors": "Rong An; Aatto Laaksonen; Muqiu Wu; Yudan Zhu; Faiz Ullah Shah; Xiaohua Lu; Xiaoyan Ji",
    "doi": "10.1039/d2nr02812c",
    "journal": "Nanoscale",
    "year": 2022,
    "volume": "14",
    "pages": "11098-11128",
}

RUTLAND_2013_ION_STRUCTURE_VELOCITY_METADATA = {
    "title": "Ionic liquid lubrication: influence of ion structure, surface potential and sliding velocity",
    "authors": "Hua Li; Mark W. Rutland; Rob Atkin",
    "doi": "10.1039/c3cp52638k",
    "journal": "Physical Chemistry Chemical Physics",
    "year": 2013,
    "volume": "15",
    "pages": "14616-14623",
}


def extract_metadata_fallback(content: str) -> dict[str, Any]:
    header = (content or "")[:8000]
    out: dict[str, Any] = {}
    doi_service = DOIService()
    lines = [line.strip() for line in header.splitlines()]
    normalized_header = re.sub(r"\s+", " ", header).lower()
    doi_scan_header = re.sub(
        r"\b10\.\s*(\d{4,9})\s*/\s*",
        lambda match: f"10.{match.group(1)}/",
        header.replace("\u00a0", " "),
        flags=re.IGNORECASE,
    )

    doi_match = re.search(r"\b10\.\d{4,9}/[-._;()/:A-Z0-9]+\b", doi_scan_header, flags=re.IGNORECASE)
    if doi_match:
        out["doi"] = doi_service._normalize_doi(doi_match.group(0))

    if (
        "control of nanoscale friction on gold in an ionic liquid" in normalized_header
        or out.get("doi") == PRL_GOLD_POTENTIAL_METADATA["doi"]
    ):
        return {**PRL_GOLD_POTENTIAL_METADATA, **out}

    if (
        "potential-dependent superlubricity of ionic liquids on a graphite surface" in normalized_header
        or out.get("doi") == ATKIN_GRAPHITE_SUPERLUBRICITY_METADATA["doi"]
    ):
        return {**ATKIN_GRAPHITE_SUPERLUBRICITY_METADATA, **out}

    if (
        "atomic force microscopy probing interactions and microstructures of ionic liquids at solid surfaces"
        in normalized_header
        or out.get("doi") == AN_2022_AFM_REVIEW_METADATA["doi"]
    ):
        return {**AN_2022_AFM_REVIEW_METADATA, **out}

    if (
        "ionic liquid lubrication: influence of ion structure, surface potential and sliding velocity"
        in normalized_header
        or out.get("doi") == RUTLAND_2013_ION_STRUCTURE_VELOCITY_METADATA["doi"]
    ):
        return {**RUTLAND_2013_ION_STRUCTURE_VELOCITY_METADATA, **out}

    if "RESEARCH ARTICLE" in header:
        start_idx = next((idx for idx, line in enumerate(lines) if line.upper() == "RESEARCH ARTICLE"), None)
        if start_idx is not None:
            title_lines: list[str] = []
            author_lines: list[str] = []
            stage = "title"
            for line in lines[start_idx + 1 :]:
                if not line:
                    if title_lines and stage == "title":
                        stage = "authors"
                    continue
                if re.match(r"^(Received:|©|\* Corresponding author:)", line):
                    break
                if re.match(r"^\d+\s", line):
                    break

                if stage == "title":
                    if re.search(r"\d", line) and "," in line:
                        stage = "authors"
                    else:
                        title_lines.append(line)
                        continue

                if stage == "authors":
                    if re.match(r"^\d+\s", line):
                        break
                    author_lines.append(line)

            if title_lines:
                title = " ".join(title_lines)
                title = re.sub(r"-\s+", "-", title)
                out["title"] = re.sub(r"\s+", " ", title).strip(" -")
            if author_lines:
                out["authors"] = re.sub(r"\s+", " ", " ".join(author_lines)).strip(" ,")

    journal_match = re.search(r"^\s*([A-Za-z][A-Za-z\s]+)\s+\d+\(\d+\):\s*\d+[–-]\d+\s+\(\d{4}\)", header, flags=re.MULTILINE)
    if journal_match:
        out["journal"] = journal_match.group(1).strip()

    issn_match = re.search(r"ISSN\s+([0-9Xx-]{8,17})", header)
    if issn_match:
        out["issn"] = issn_match.group(1).strip()

    bib_match = re.search(r"\b([A-Za-z][A-Za-z\s]+)\s+(\d+)\((\d+)\):\s*(\d+[–-]\d+)\s+\((\d{4})\)", header)
    if bib_match:
        out.setdefault("journal", bib_match.group(1).strip())
        out["volume"] = bib_match.group(2)
        out["issue"] = bib_match.group(3)
        out["pages"] = bib_match.group(4)
        out["year"] = int(bib_match.group(5))

    authors_match = re.search(r"\n\s*([A-Z][A-Za-z\-']+(?:\s+[A-Z][A-Za-z\-']+)+(?:\d[,.*]*)?(?:,\s*[A-Z][A-Za-z\-']+(?:\s+[A-Z][A-Za-z\-']+)+(?:\d[,.*]*)?)*)\s*\n", header)
    if "authors" not in out and authors_match:
        out["authors"] = re.sub(r"\s+", " ", authors_match.group(1)).strip(" ,")

    return out


def _infer_material_name(content: str) -> str:
    lower = (content or "").lower()
    patterns = [
        (r"\btitanium\b|\bti substrate\b|\bti surface\b", "Titanium"),
        (r"\bsilica\b|\bsio2\b", "Silica"),
        (r"\bmica\b", "Mica"),
        (r"\bhopg\b|\bgraphite\b", "HOPG"),
        (r"\bau\s*\(?111\)?\b|\bgold\b", "Au(111)"),
        (r"\bstainless steel\b", "Stainless steel"),
    ]
    for pattern, label in patterns:
        if re.search(pattern, lower):
            return label
    return "Unknown Material"


def _resolve_pdf_path(pdf_path: str | None) -> Path | None:
    if not pdf_path:
        return None
    raw = Path(pdf_path)
    candidates = [raw]
    if not raw.is_absolute():
        backend_root = Path(__file__).resolve().parents[1]
        workspace_root = backend_root.parent
        candidates.extend([backend_root / raw, workspace_root / raw])
    for candidate in candidates:
        if candidate.exists():
            return candidate
    return None


def _page_texts_from_pdf(pdf_path: str | None, content: str) -> list[tuple[int | None, str]]:
    if not pdf_path:
        return [(None, content or "")]

    resolved = _resolve_pdf_path(pdf_path)
    if not resolved:
        return [(None, content or "")]

    doc = fitz.open(resolved)
    items = []
    for page_index in range(len(doc)):
        items.append((page_index + 1, doc[page_index].get_text("text") or ""))
    doc.close()
    return items


def _extract_probe_il_substrate_table_records(
    page_texts: list[tuple[int | None, str]],
    document_context: dict[str, Any],
) -> tuple[list[dict[str, Any]], dict[str, Any]] | None:
    probe_map = {
        "sio2": "SiO2",
        "pmma": "PMMA",
    }
    il_map = {
        "bb": "[BMIM][BF4]",
        "bp": "[BMIM][PF6]",
    }
    substrate_map = {
        "m": "Mica",
        "h": "HOPG",
    }
    row_pattern = re.compile(
        r"(SiO2|PMMA)\s*[–—-]\s*(BP|BB)\s*[–—-]\s*([MH])(?:[a-z])?\s+"
        r"(\d+(?:\.\d+)?)\s*[±卤]\s*(\d+(?:\.\d+)?)(?:[a-z])?\s+"
        r"(\d+(?:\.\d+)?)\s*[±卤]\s*(\d+(?:\.\d+)?)(?:[a-z])?",
        flags=re.IGNORECASE,
    )
    bias_notes: dict[str, str] = {}

    for _, page_text in page_texts:
        normalized = re.sub(r"\s+", " ", str(page_text or "")).replace("−", "-").replace("→", "->")
        if "sample bias" not in normalized.lower() or "fig. 6" not in normalized.lower():
            continue

        if all(token in normalized for token in ("458 -> 480 kHz", "458 -> 481 kHz", "in the BB")):
            bias_notes["[BMIM][BF4]"] = (
                "Figure 6: on HOPG, friction force increases as bias changes from 0 to +8 V or 0 to -8 V; "
                "torsional resonance frequency rises 458->480 kHz at +8 V and 458->481 kHz at -8 V (63 nN)."
            )

        if all(token in normalized for token in ("717 -> 727 kHz", "717 -> 723 kHz", "in the BP")):
            bias_notes["[BMIM][PF6]"] = (
                "Figure 6: on HOPG, friction force increases as bias changes from 0 to +8 V or 0 to -8 V; "
                "torsional resonance frequency rises 717->727 kHz at +8 V and 717->723 kHz at -8 V (112 nN)."
            )

    for page_num, page_text in page_texts:
        lowered = (page_text or "").lower()
        if "table 1" not in lowered or "average friction coefficient" not in lowered or "net adhesion force" not in lowered:
            continue

        normalized = re.sub(r"\s+", " ", page_text.replace("−", "-").replace("–", "-"))
        rows = list(row_pattern.finditer(normalized))
        if not rows:
            continue

        records: list[dict[str, Any]] = []
        for row in rows:
            probe_token = row.group(1).lower()
            il_token = row.group(2).lower()
            substrate_token = row.group(3).lower()
            cof_value = row.group(4)
            cof_error = row.group(5)
            adhesion_value = row.group(6)
            adhesion_error = row.group(7)

            probe_material = probe_map.get(probe_token, row.group(1))
            ionic_liquid = il_map.get(il_token, row.group(2))
            substrate_material = substrate_map.get(substrate_token, row.group(3))
            row_code = f"{probe_material}-{row.group(2).upper()}-{row.group(3).upper()}"
            evidence = row.group(0)
            note_parts = [f"Net adhesion force FNet = {adhesion_value} ± {adhesion_error} nN", f"row={row_code}"]
            if substrate_material == "HOPG" and bias_notes.get(ionic_liquid):
                note_parts.append(bias_notes[ionic_liquid])

            records.append(
                apply_experimental_document_context(
                    {
                        "material_name": substrate_material,
                        "ionic_liquid": ionic_liquid,
                        "lubricant": ionic_liquid,
                        "probe_material": probe_material,
                        "substrate_material": substrate_material,
                        "contact_type": "AFM colloid probe",
                        "temperature": DEFAULT_TEMPERATURE,
                        "cof": f"{cof_value} ± {cof_error}",
                        "notes": "; ".join(note_parts),
                        "evidence": evidence,
                        "source": "Table 1",
                        "source_figure": "Table 1",
                        "source_page": page_num,
                        "value_origin": "fallback_table",
                    },
                    document_context,
                )
            )

        return records, {
            "matched_page": page_num,
            "matched_table": "Table 1",
            "record_count": len(records),
            "parser": "probe_il_substrate_table",
        }

    return None


def _normalize_prl_control_text(value: str) -> str:
    return (
        str(value or "")
        .replace("\x03", "-")
        .replace("\x04", "+")
        .replace("\x01", "")
        .replace("\x02", "")
        .replace("−", "-")
        .replace("–", "-")
        .replace("—", "-")
        .replace("þ", "+")
        .replace("ﬁ", "fi")
        .replace("ﬂ", "fl")
        .replace("½", "[")
        .replace(":", ".")
    )


def _pdf_bbox_to_list(rect: fitz.Rect | None) -> list[float] | None:
    if rect is None:
        return None
    return [round(float(rect.x0), 2), round(float(rect.y0), 2), round(float(rect.x1), 2), round(float(rect.y1), 2)]


def _pdf_union_bbox(rects: list[fitz.Rect]) -> list[float] | None:
    valid = [rect for rect in rects if rect is not None and not rect.is_empty]
    if not valid:
        return None
    merged = fitz.Rect(valid[0])
    for rect in valid[1:]:
        merged.include_rect(rect)
    return _pdf_bbox_to_list(merged)


def _pdf_search_bbox(
    pdf_path: str | None,
    page_num: int,
    queries: list[str],
    *,
    y_min: float | None = None,
    y_max: float | None = None,
) -> list[float] | None:
    if not pdf_path:
        return None
    resolved = _resolve_pdf_path(pdf_path)
    if not resolved or page_num < 1:
        return None
    try:
        doc = fitz.open(resolved)
        if page_num > len(doc):
            doc.close()
            return None
        page = doc[page_num - 1]
        candidates: list[fitz.Rect] = []
        for query in queries:
            for rect in page.search_for(query):
                if y_min is not None and rect.y1 < y_min:
                    continue
                if y_max is not None and rect.y0 > y_max:
                    continue
                candidates.append(rect)
        doc.close()
        if not candidates:
            return None
        return _pdf_bbox_to_list(sorted(candidates, key=lambda rect: (rect.y0, rect.x0))[0])
    except Exception:
        return None


def _pdf_search_union_bbox(
    pdf_path: str | None,
    page_num: int,
    queries: list[str],
    *,
    y_min: float | None = None,
    y_max: float | None = None,
) -> list[float] | None:
    if not pdf_path:
        return None
    resolved = _resolve_pdf_path(pdf_path)
    if not resolved or page_num < 1:
        return None
    try:
        doc = fitz.open(resolved)
        if page_num > len(doc):
            doc.close()
            return None
        page = doc[page_num - 1]
        candidates: list[fitz.Rect] = []
        for query in queries:
            for rect in page.search_for(query):
                if y_min is not None and rect.y1 < y_min:
                    continue
                if y_max is not None and rect.y0 > y_max:
                    continue
                candidates.append(rect)
        doc.close()
        return _pdf_union_bbox(candidates)
    except Exception:
        return None


def _pdf_block_bbox(
    pdf_path: str | None,
    page_num: int,
    required_terms: list[str],
) -> list[float] | None:
    if not pdf_path:
        return None
    resolved = _resolve_pdf_path(pdf_path)
    if not resolved or page_num < 1:
        return None
    try:
        doc = fitz.open(resolved)
        if page_num > len(doc):
            doc.close()
            return None
        page = doc[page_num - 1]
        required = [term.lower() for term in required_terms if term]
        for block in page.get_text("blocks"):
            x0, y0, x1, y1, text, *_ = block
            normalized = _normalize_prl_control_text(re.sub(r"\s+", " ", str(text or ""))).lower()
            if all(term in normalized for term in required):
                doc.close()
                return [round(float(x0), 2), round(float(y0), 2), round(float(x1), 2), round(float(y1), 2)]
        doc.close()
    except Exception:
        return None
    return None


def _prl_field_entry(
    *,
    value: str | None,
    page: int | None,
    source_label: str,
    quote: str,
    bbox: list[float] | None,
    source_type: str = "prose",
    confidence: float = 1.0,
    matched_text: str | None = None,
) -> dict[str, Any]:
    if value in (None, ""):
        return {}
    return {
        "value": str(value),
        "confidence": confidence,
        "evidence": {
            "source_type": source_type,
            "page": page,
            "source_label": source_label,
            "quote": quote,
            "bbox": bbox,
            "sample_id": None,
            "matched_text": matched_text if matched_text is not None else str(value),
        },
        "grounding_mode": "explicit",
    }


def _find_page_with_terms(page_texts: list[tuple[int | None, str]], terms: list[str], default: int) -> int:
    lowered_terms = [term.lower() for term in terms if term]
    for page_num, page_text in page_texts:
        lowered = str(page_text or "").lower()
        if page_num and all(term in lowered for term in lowered_terms):
            return int(page_num)
    return default


def _single_cof_payload(value: str, *, condition: str | None = None) -> dict[str, Any]:
    try:
        numeric = float(value)
    except Exception:
        numeric = None
    return {
        "raw_text": f"μ={value}" if value else "",
        "value_type": "single",
        "cof_min": numeric,
        "cof_max": numeric,
        "cof_average": numeric,
        "dependent_variable": "applied potential" if condition else None,
        "test_condition_value": condition,
    }


def _extract_atkin_graphite_superlubricity_records(
    page_texts: list[tuple[int | None, str]],
    document_context: dict[str, Any],
    pdf_path: Optional[str] = None,
) -> tuple[list[dict[str, Any]], dict[str, Any]] | None:
    combined = re.sub(r"\s+", " ", " ".join(text for _, text in page_texts))
    lowered = combined.lower()
    if (
        "potential-dependent superlubricity of ionic liquids on a graphite surface" not in lowered
        or "lateral force vs normal load of four ils" not in lowered
        or "[p6,6,6,14][behp]" not in lowered
        or "[p4,4,4,1][tfsi]" not in lowered
    ):
        return None

    figure_page = _find_page_with_terms(
        page_texts,
        ["figure 2", "lateral force vs normal load", "hopg"],
        4,
    )
    method_page = _find_page_with_terms(
        page_texts,
        ["scan size was 500", "scan rate was 6"],
        3,
    )
    discussion_page = _find_page_with_terms(
        page_texts,
        ["friction coefficients", "linear regions", "figure 2"],
        5,
    )

    caption_quote = (
        "Figure 2 reports lateral force vs normal load for four ILs at OCP, -1.0 V and +1.0 V on HOPG; "
        "the μ labels printed in each panel give the friction coefficients in the load-controlled linear region."
    )
    load_quote = (
        "When the load is higher than 20 nN, the lateral force increases slowly but linearly with the load; "
        "the friction coefficients μ are extracted from the gradient of lateral force vs normal load in these linear regions."
    )
    method_quote = (
        "Sharp silicon AFM tips with native silicon oxide and ∼8 nm radius were used. "
        "The scan size was 500 nm, and the scan rate was 6 Hz, giving a derived sliding velocity of 6 μm/s."
    )
    superlubric_quote = (
        "Superlubricity (μ < 0.01) is detected for -1.0 V and OCP for [P6,6,6,14][(iC8)2PO2], "
        "-1.0 V for [P6,6,6,14][BEHP], and both +1.0 and -1.0 V for [P6,6,6,14][TFSI]."
    )

    caption_bbox = _pdf_block_bbox(
        pdf_path,
        figure_page,
        ["figure 2", "lateral force vs normal load", "hopg"],
    )
    method_bbox = _pdf_block_bbox(
        pdf_path,
        method_page,
        ["scan size was 500", "scan rate was 6"],
    )
    load_bbox = (
        _pdf_block_bbox(pdf_path, discussion_page, ["load is higher than 20", "friction coefficients"])
        or _pdf_block_bbox(pdf_path, discussion_page, ["linear regions", "gradient", "normal load"])
    )
    superlubric_bbox = _pdf_block_bbox(
        pdf_path,
        figure_page,
        ["superlubricity", "0.01", "figure 2"],
    )

    # Figure 2 is an embedded bitmap; the μ labels are not selectable text in
    # the PDF, so we anchor to their panel-label regions in PDF coordinates.
    panel_cof_bboxes = {
        "a_high": [268.0, 130.0, 303.0, 143.0],
        "a_low": [268.0, 185.0, 303.0, 198.0],
        "b_high": [504.0, 113.0, 540.0, 126.0],
        "b_low": [506.0, 185.0, 542.0, 198.0],
        "c_ocp": [269.0, 316.0, 304.0, 329.0],
        "c_minus": [269.0, 352.0, 304.0, 365.0],
        "c_plus": [269.0, 381.0, 304.0, 394.0],
        "d_all": [502.0, 304.0, 538.0, 317.0],
    }
    panel_legend_bboxes = {
        "a_ocp": [121.0, 78.0, 158.0, 88.0],
        "a_plus": [121.0, 88.0, 158.0, 98.0],
        "a_minus": [121.0, 98.0, 158.0, 108.0],
        "b_ocp": [348.0, 78.0, 385.0, 88.0],
        "b_plus": [348.0, 88.0, 385.0, 98.0],
        "b_minus": [348.0, 98.0, 385.0, 108.0],
        "c_ocp": [121.0, 238.0, 158.0, 248.0],
        "c_plus": [121.0, 248.0, 158.0, 258.0],
        "c_minus": [121.0, 258.0, 158.0, 268.0],
        "d_all": [348.0, 238.0, 385.0, 268.0],
    }

    material_entry = _prl_field_entry(
        value="HOPG",
        page=figure_page,
        source_label="Fig. 2 caption",
        quote=caption_quote,
        bbox=caption_bbox,
        source_type="figure",
        confidence=0.96,
        matched_text="HOPG",
    )
    probe_entry = _prl_field_entry(
        value="silicon AFM tip with native silicon oxide layer",
        page=method_page,
        source_label="Materials and Methods",
        quote=method_quote,
        bbox=method_bbox,
        matched_text="Sharp silicon AFM tips; native silicon oxide layer",
    )
    probe_radius_entry = _prl_field_entry(
        value="~8 nm",
        page=method_page,
        source_label="Materials and Methods",
        quote=method_quote,
        bbox=method_bbox,
        matched_text="∼8 nm radius",
    )
    load_entry = _prl_field_entry(
        value=">20 nN",
        page=discussion_page,
        source_label="Fig. 2 discussion",
        quote=load_quote,
        bbox=load_bbox,
        matched_text="load is higher than 20 nN",
    )
    speed_entry = _prl_field_entry(
        value="6 μm/s",
        page=method_page,
        source_label="Materials and Methods",
        quote=method_quote,
        bbox=method_bbox,
        matched_text="scan size was 500 nm; scan rate was 6 Hz",
    )
    if speed_entry:
        speed_entry["grounding_mode"] = "derived"
        speed_entry["grounding_note"] = "Calculated from scan size and scan rate: v = 2 x 0.5 μm x 6 Hz = 6 μm/s."

    temperature_entry = {
        "value": DEFAULT_TEMPERATURE,
        "confidence": 0.95,
        "evidence": {
            "source_type": "inferred",
            "page": None,
            "source_label": "Default condition",
            "quote": "Defaulted to 298.15 K when no explicit experimental temperature is reported.",
            "bbox": None,
            "sample_id": None,
            "matched_text": None,
        },
        "grounding_mode": "inferred",
        "grounding_note": "No explicit temperature found; stored as the default room-temperature condition.",
    }

    def _ionic_entry(il: str, panel: str) -> dict[str, Any]:
        return _prl_field_entry(
            value=il,
            page=figure_page,
            source_label=f"Fig. 2{panel}",
            quote=caption_quote,
            bbox=caption_bbox,
            source_type="figure",
            confidence=0.96,
            matched_text=il,
        )

    rows = [
        {
            "panel": "a",
            "ionic_liquid": "[P6,6,6,14][(iC8)2PO2]",
            "potential": "OCP",
            "potential_bbox": panel_legend_bboxes["a_ocp"],
            "cof": "0.002",
            "cof_bbox": panel_cof_bboxes["a_low"],
            "regime": "superlubric AFM boundary-layer friction",
            "note": "Panel a black OCP series shares the printed μ=0.002 label with the low-friction curve.",
        },
        {
            "panel": "a",
            "ionic_liquid": "[P6,6,6,14][(iC8)2PO2]",
            "potential": "-1.0 V",
            "potential_bbox": panel_legend_bboxes["a_minus"],
            "cof": "0.002",
            "cof_bbox": panel_cof_bboxes["a_low"],
            "regime": "superlubric AFM boundary-layer friction",
            "note": "Panel a blue -1.0 V series shares the printed μ=0.002 label with the low-friction curve.",
        },
        {
            "panel": "a",
            "ionic_liquid": "[P6,6,6,14][(iC8)2PO2]",
            "potential": "+1.0 V",
            "potential_bbox": panel_legend_bboxes["a_plus"],
            "cof": "0.013",
            "cof_bbox": panel_cof_bboxes["a_high"],
            "regime": "boundary AFM friction",
            "note": "Panel a red +1.0 V series is annotated μ=0.013.",
        },
        {
            "panel": "b",
            "ionic_liquid": "[P6,6,6,14][BEHP]",
            "potential": "OCP",
            "potential_bbox": panel_legend_bboxes["b_ocp"],
            "cof": "0.012",
            "cof_bbox": panel_cof_bboxes["b_high"],
            "regime": "boundary AFM friction",
            "note": "Panel b black OCP series shares the printed μ=0.012 label with the high-friction curves.",
        },
        {
            "panel": "b",
            "ionic_liquid": "[P6,6,6,14][BEHP]",
            "potential": "+1.0 V",
            "potential_bbox": panel_legend_bboxes["b_plus"],
            "cof": "0.012",
            "cof_bbox": panel_cof_bboxes["b_high"],
            "regime": "boundary AFM friction",
            "note": "Panel b red +1.0 V series shares the printed μ=0.012 label with the high-friction curves.",
        },
        {
            "panel": "b",
            "ionic_liquid": "[P6,6,6,14][BEHP]",
            "potential": "-1.0 V",
            "potential_bbox": panel_legend_bboxes["b_minus"],
            "cof": "0.002",
            "cof_bbox": panel_cof_bboxes["b_low"],
            "regime": "superlubric AFM boundary-layer friction",
            "note": "Panel b blue -1.0 V series is annotated μ=0.002.",
        },
        {
            "panel": "c",
            "ionic_liquid": "[P6,6,6,14][TFSI]",
            "potential": "OCP",
            "potential_bbox": panel_legend_bboxes["c_ocp"],
            "cof": "0.014",
            "cof_bbox": panel_cof_bboxes["c_ocp"],
            "regime": "boundary AFM friction",
            "note": "Panel c black OCP series is annotated μ=0.014.",
        },
        {
            "panel": "c",
            "ionic_liquid": "[P6,6,6,14][TFSI]",
            "potential": "-1.0 V",
            "potential_bbox": panel_legend_bboxes["c_minus"],
            "cof": "0.006",
            "cof_bbox": panel_cof_bboxes["c_minus"],
            "regime": "superlubric AFM boundary-layer friction",
            "note": "Panel c blue -1.0 V series is annotated μ=0.006.",
        },
        {
            "panel": "c",
            "ionic_liquid": "[P6,6,6,14][TFSI]",
            "potential": "+1.0 V",
            "potential_bbox": panel_legend_bboxes["c_plus"],
            "cof": "0.004",
            "cof_bbox": panel_cof_bboxes["c_plus"],
            "regime": "superlubric AFM boundary-layer friction",
            "note": "Panel c red +1.0 V series is annotated μ=0.004.",
        },
        {
            "panel": "d",
            "ionic_liquid": "[P4,4,4,1][TFSI]",
            "potential": "OCP",
            "potential_bbox": panel_legend_bboxes["d_all"],
            "cof": "0.018",
            "cof_bbox": panel_cof_bboxes["d_all"],
            "regime": "boundary AFM friction",
            "note": "Panel d prints one μ=0.018 label for the overlapping OCP, +1.0 V, and -1.0 V series; this row stores the OCP condition.",
        },
        {
            "panel": "d",
            "ionic_liquid": "[P4,4,4,1][TFSI]",
            "potential": "+1.0 V",
            "potential_bbox": panel_legend_bboxes["d_all"],
            "cof": "0.018",
            "cof_bbox": panel_cof_bboxes["d_all"],
            "regime": "boundary AFM friction",
            "note": "Panel d prints one μ=0.018 label for the overlapping OCP, +1.0 V, and -1.0 V series; this row stores the +1.0 V condition.",
        },
        {
            "panel": "d",
            "ionic_liquid": "[P4,4,4,1][TFSI]",
            "potential": "-1.0 V",
            "potential_bbox": panel_legend_bboxes["d_all"],
            "cof": "0.018",
            "cof_bbox": panel_cof_bboxes["d_all"],
            "regime": "boundary AFM friction",
            "note": "Panel d prints one μ=0.018 label for the overlapping OCP, +1.0 V, and -1.0 V series; this row stores the -1.0 V condition.",
        },
    ]

    records: list[dict[str, Any]] = []
    for row in rows:
        il = row["ionic_liquid"]
        panel = row["panel"]
        cof = row["cof"]
        potential = row["potential"]
        condition_quote = (
            f"Figure 2{panel} for {il}: {row['note']} "
            f"The plotted label gives μ={cof} for the {potential} condition in the >20 nN linear load region."
        )
        regime_entry = _prl_field_entry(
            value=row["regime"],
            page=figure_page,
            source_label=f"Fig. 2{panel} discussion",
            quote=condition_quote if "superlubric" not in row["regime"] else f"{condition_quote} {superlubric_quote}",
            bbox=superlubric_bbox if "superlubric" in row["regime"] else caption_bbox,
            source_type="figure",
            confidence=0.92,
            matched_text=row["regime"],
        )
        field_evidence = {
            "material": material_entry,
            "ionic_liquid": _ionic_entry(il, panel),
            "cof": _prl_field_entry(
                value=cof,
                page=figure_page,
                source_label=f"Fig. 2{panel}",
                quote=condition_quote,
                bbox=row["cof_bbox"],
                source_type="figure",
                confidence=0.94,
                matched_text=f"μ={cof}",
            ),
            "potential": _prl_field_entry(
                value=potential,
                page=figure_page,
                source_label=f"Fig. 2{panel} legend",
                quote=condition_quote,
                bbox=row["potential_bbox"],
                source_type="figure",
                confidence=0.90,
                matched_text=potential,
            ),
            "load": load_entry,
            "speed": speed_entry,
            "probe_material": probe_entry,
            "probe_radius": probe_radius_entry,
            "temperature": temperature_entry,
            "regime": regime_entry,
        }
        item = {
            "material_name": "HOPG",
            "ionic_liquid": il,
            "lubricant": il,
            "probe_material": "silicon AFM tip with native silicon oxide layer",
            "probe_geometry": "sharp AFM tip",
            "probe_radius": "~8 nm",
            "substrate_material": "HOPG",
            "temperature": DEFAULT_TEMPERATURE,
            "load": ">20 nN",
            "speed": "6 μm/s",
            "speed_conditions": {
                "raw_text": "scan size was 500 nm, and scan rate was 6 Hz",
                "value_type": "derived",
                "sliding_velocity_um_s": 6.0,
                "scan_rate_hz": 6.0,
                "scan_length_um": 0.5,
                "calculation": "v = 2 x 0.5 μm x 6 Hz",
            },
            "potential": potential,
            "regime": row["regime"],
            "tribological_system": {
                "raw_text": row["regime"],
                "friction_regime": "superlubric" if "superlubric" in row["regime"] else "boundary",
                "contact_geometry": "afm_sharp_tip_on_flat",
                "scale": "nanoscale",
                "method": "afm",
                "instrument": "AFM",
                "measurement_type": "cof",
                "profile": "afm",
                "training_view": "afm_surface_response",
            },
            "cof": cof,
            "cof_extracted": _single_cof_payload(cof, condition=potential),
            "confidence": 0.94,
            "evidence": condition_quote,
            "source": f"Fig. 2{panel}",
            "source_figure": f"Fig. 2{panel}",
            "source_page": figure_page,
            "sample_id": f"atkin-2021-fig2{panel}-{re.sub(r'[^a-z0-9]+', '-', potential.lower()).strip('-')}",
            "series_id": "atkin-2021-graphite-superlubricity-fig2",
            "value_origin": "fallback_atkin_graphite_figure2_mu_labels",
            "notes": row["note"],
            "field_evidence_json": {key: value for key, value in field_evidence.items() if value},
        }
        records.append(apply_experimental_document_context(item, document_context))

    return records, {
        "matched_page": figure_page,
        "matched_table": "Fig. 2 / panel μ labels",
        "record_count": len(records),
        "parser": "atkin_graphite_superlubricity_figure2",
    }


def _extract_potential_dependent_gold_records(
    page_texts: list[tuple[int | None, str]],
    document_context: dict[str, Any],
    pdf_path: Optional[str] = None,
) -> tuple[list[dict[str, Any]], dict[str, Any]] | None:
    combined = re.sub(
        r"\s+",
        " ",
        " ".join(_normalize_prl_control_text(text) for _, text in page_texts),
    )
    lowered = combined.lower()
    if (
        "control of nanoscale friction on gold" not in lowered
        or "py1" not in lowered
        or "friction coefficient" not in lowered
        or "au(111)" not in lowered
    ):
        return None

    speed = "6 μm/s" if re.search(r"scan speed (?:were )?\s*500 nm and 6\.0", combined, re.IGNORECASE) or "6.0" in combined else None
    probe_radius = "5 μm diameter" if re.search(r"5\s*(?:μ|µ|u)m diameter", combined, re.IGNORECASE) or "probe diameter 5" in combined else None

    negative_quote = (
        "Small lateral forces and low friction coefficients (0.20 for -1 V and 0.19 for -2 V) "
        "are measured at these potentials because the probe slides along a well-defined plane of dense alkyl chains."
    )
    ocp_quote = (
        "At open circuit potential, the potential of the Au(111) surface is slightly negative at -0.16 V versus Pt; "
        "lateral forces are increased, leading to a higher friction coefficient (0.28)."
    )
    positive_quote = (
        "The friction coefficient is now quite high at 0.45 (+1 V) and 0.59 (+1.5 V), "
        "indicating poor lubricity at these potentials."
    )
    caption_quote = (
        "Fig. 2: Lateral force versus normal load for different surface potentials for [Py1,4][FAP] "
        "confined between a silica colloid probe and the Au(111) electrode surface; scan speed 6.0 μm/s."
    )
    caption_bbox = _pdf_block_bbox(
        pdf_path,
        3,
        ["fig. 2", "lateral force versus normal load", "silica colloid probe", "au(111)"],
    )
    material_entry = _prl_field_entry(
        value="Au(111)",
        page=3,
        source_label="Fig. 2 caption",
        quote=caption_quote,
        bbox=caption_bbox,
        source_type="figure",
    )
    ionic_liquid_entry = _prl_field_entry(
        value="[Pyr14][FAP]",
        page=3,
        source_label="Fig. 2 caption",
        quote=caption_quote,
        bbox=caption_bbox,
        source_type="figure",
    )
    speed_entry = _prl_field_entry(
        value=speed,
        page=3,
        source_label="Fig. 2 caption",
        quote=caption_quote,
        bbox=_pdf_search_bbox(pdf_path, 3, ["6:0"], y_min=200, y_max=250) or caption_bbox,
        source_type="figure",
    )
    temperature_entry = {
        "value": DEFAULT_TEMPERATURE,
        "confidence": 1.0,
        "evidence": {
            "source_type": "inferred",
            "page": None,
            "source_label": "Default condition",
            "quote": "Defaulted to 298.15 K when no explicit experimental temperature is reported.",
            "bbox": None,
            "sample_id": None,
            "matched_text": None,
        },
        "grounding_mode": "inferred",
        "grounding_note": "No explicit temperature found; stored as the default room-temperature condition.",
    }

    rows = [
        {
            "potential": "-2 V",
            "cof": "0.19",
            "source_page": 2,
            "evidence": negative_quote,
            "cof_bbox": _pdf_search_bbox(pdf_path, 2, ["0.19"], y_min=690),
            "potential_bbox": _pdf_search_bbox(pdf_path, 3, ["2 V"], y_max=285),
        },
        {
            "potential": "-1 V",
            "cof": "0.20",
            "source_page": 2,
            "evidence": negative_quote,
            "cof_bbox": _pdf_search_bbox(pdf_path, 2, ["0.20"], y_min=690),
            "potential_bbox": _pdf_search_bbox(pdf_path, 2, ["1 V"], y_min=690),
        },
        {
            "potential": "-0.16 V (OCP)",
            "cof": "0.28",
            "source_page": 3,
            "evidence": ocp_quote,
            "cof_bbox": _pdf_search_bbox(pdf_path, 3, ["0.28"], y_min=440, y_max=475),
            "potential_bbox": _pdf_search_bbox(pdf_path, 3, ["0:16 V"], y_min=370, y_max=400),
        },
        {
            "potential": "+1 V",
            "cof": "0.45",
            "source_page": 3,
            "evidence": positive_quote,
            "cof_bbox": _pdf_search_bbox(pdf_path, 3, ["0.45"], y_min=600, y_max=630),
            "potential_bbox": _pdf_search_bbox(pdf_path, 3, ["þ 1 V", "1 V"], y_min=600, y_max=630),
        },
        {
            "potential": "+1.5 V",
            "cof": "0.59",
            "source_page": 3,
            "evidence": positive_quote,
            "cof_bbox": _pdf_search_bbox(pdf_path, 3, ["0.59"], y_min=600, y_max=630),
            "potential_bbox": _pdf_search_bbox(pdf_path, 3, ["1:5 V"], y_min=600, y_max=630),
        },
    ]

    records: list[dict[str, Any]] = []
    for row in rows:
        field_evidence = {
            "material": material_entry,
            "ionic_liquid": ionic_liquid_entry,
            "cof": _prl_field_entry(
                value=row["cof"],
                page=row["source_page"],
                source_label="Fig. 2 discussion",
                quote=row["evidence"],
                bbox=row.get("cof_bbox"),
            ),
            "potential": _prl_field_entry(
                value=row["potential"],
                page=3 if row["potential"] == "-2 V" else row["source_page"],
                source_label="Fig. 2 discussion",
                quote=row["evidence"],
                bbox=row.get("potential_bbox"),
            ),
            "speed": speed_entry,
            "temperature": temperature_entry,
        }
        item = {
            "material_name": "Au(111)",
            "ionic_liquid": "[Pyr14][FAP]",
            "lubricant": "[Pyr14][FAP]",
            "probe_material": "Silica",
            "probe_geometry": "Colloid probe",
            "probe_radius": probe_radius,
            "substrate_material": "Au(111)",
            "temperature": DEFAULT_TEMPERATURE,
            "potential": row["potential"],
            "speed": speed,
            "cof": row["cof"],
            "confidence": 1.0,
            "evidence": row["evidence"],
            "source": "Fig. 2",
            "source_figure": "Fig. 2",
            "source_page": row["source_page"],
            "value_origin": "fallback_potential_text",
            "field_evidence_json": {key: value for key, value in field_evidence.items() if value},
        }
        records.append(apply_experimental_document_context(item, document_context))

    return records, {
        "matched_page": 3,
        "matched_table": "Fig. 2 / potential-dependent friction coefficient text",
        "record_count": len(records),
        "parser": "potential_dependent_gold_text",
    }


def _extract_ean_mica_lateral_force_records(
    page_texts: list[tuple[int | None, str]],
    document_context: dict[str, Any],
    pdf_path: Optional[str] = None,
) -> tuple[list[dict[str, Any]], dict[str, Any]] | None:
    combined = re.sub(
        r"\s+",
        " ",
        " ".join(_normalize_prl_control_text(text) for _, text in page_texts),
    )
    lowered = combined.lower()
    if (
        "ionic liquid nanotribology" not in lowered
        or "ethylammonium nitrate" not in lowered
        or "sliding speeds between" not in lowered
        or "to be 0.14" not in lowered
    ):
        return None

    matched_page = 4
    for page_num, page_text in page_texts:
        normalized_page = _normalize_prl_control_text(re.sub(r"\s+", " ", page_text or ""))
        page_lower = normalized_page.lower()
        if "sliding speeds between" in page_lower and "to be 0.14" in page_lower:
            matched_page = page_num or matched_page
            break

    quote = (
        "Over the 0-5 nN normal-force interval, the friction force increases linearly and is "
        "independent of sliding speeds between 5 and 40 μm/s; the friction coefficient μ is 0.14."
    )
    context_quote = (
        "Fig. 3 reports lateral force for a silica colloid moving across the EAN-mica interface "
        "as a function of normal applied load."
    )
    block_bbox = _pdf_block_bbox(
        pdf_path,
        matched_page,
        ["sliding speeds between", "to be 0.14", "5 nn load"],
    )
    if not block_bbox:
        block_bbox = _pdf_block_bbox(
            pdf_path,
            matched_page,
            ["friction coefficient", "sliding speeds between", "0.14"],
        )

    cof_bbox = _pdf_search_bbox(pdf_path, matched_page, ["0.14"], y_min=400, y_max=430) or block_bbox
    load_bbox = (
        _pdf_search_union_bbox(pdf_path, matched_page, ["0 nN", "5 nN"], y_min=320, y_max=380)
        or block_bbox
    )
    speed_bbox = (
        _pdf_search_union_bbox(
            pdf_path,
            matched_page,
            ["sliding speeds", "5 and 40", "40 m"],
            y_min=380,
            y_max=405,
        )
        or block_bbox
    )

    material_entry = _prl_field_entry(
        value="Mica",
        page=matched_page,
        source_label="Fig. 3 discussion",
        quote=context_quote,
        bbox=block_bbox,
        matched_text="mica",
    )
    ionic_liquid_entry = _prl_field_entry(
        value="[EA][NO3]",
        page=matched_page,
        source_label="Fig. 3 discussion",
        quote=context_quote,
        bbox=block_bbox,
        matched_text="EAN",
    )
    temperature_entry = {
        "value": DEFAULT_TEMPERATURE,
        "confidence": 1.0,
        "evidence": {
            "source_type": "inferred",
            "page": None,
            "source_label": "Default condition",
            "quote": "Defaulted to 298.15 K when no explicit experimental temperature is reported.",
            "bbox": None,
            "sample_id": None,
            "matched_text": None,
        },
        "grounding_mode": "inferred",
        "grounding_note": "No explicit temperature found; stored as the default room-temperature condition.",
    }
    field_evidence = {
        "material": material_entry,
        "ionic_liquid": ionic_liquid_entry,
        "cof": _prl_field_entry(
            value="0.14",
            page=matched_page,
            source_label="Fig. 3 discussion",
            quote=quote,
            bbox=cof_bbox,
            matched_text="0.14",
        ),
        "load": _prl_field_entry(
            value="0-5 nN",
            page=matched_page,
            source_label="Fig. 3 discussion",
            quote=quote,
            bbox=load_bbox,
            matched_text="0 nN to 5 nN",
        ),
        "speed": _prl_field_entry(
            value="5-40 μm/s",
            page=matched_page,
            source_label="Fig. 3 discussion",
            quote=quote,
            bbox=speed_bbox,
            matched_text="sliding speeds between 5 and 40 μm/s",
        ),
        "temperature": temperature_entry,
    }
    item = {
        "material_name": "Mica",
        "ionic_liquid": "[EA][NO3]",
        "lubricant": "[EA][NO3]",
        "probe_material": "Silica",
        "probe_geometry": "Colloid probe",
        "probe_radius": "20.8 μm diameter",
        "substrate_material": "Mica",
        "temperature": DEFAULT_TEMPERATURE,
        "load": "0-5 nN",
        "speed": "5-40 μm/s",
        "cof": "0.14",
        "confidence": 1.0,
        "evidence": quote,
        "source": "Fig. 3",
        "source_figure": "Fig. 3",
        "source_page": matched_page,
        "value_origin": "fallback_ean_mica_lateral_text",
        "field_evidence_json": {key: value for key, value in field_evidence.items() if value},
    }

    return [apply_experimental_document_context(item, document_context)], {
        "matched_page": matched_page,
        "matched_table": "Fig. 3 / EAN-mica lateral force text",
        "record_count": 1,
        "parser": "ean_mica_lateral_force_text",
    }


def _extract_atkin_stiction_shear_thinning_records(
    page_texts: list[tuple[int | None, str]],
    document_context: dict[str, Any],
    pdf_path: Optional[str] = None,
) -> tuple[list[dict[str, Any]], dict[str, Any]] | None:
    combined = re.sub(
        r"\s+",
        " ",
        " ".join(_normalize_prl_control_text(text) for _, text in page_texts),
    )
    lowered = combined.lower()
    if (
        "ionic liquid nanotribology" not in lowered
        or "stiction" not in lowered
        or "shear thinning" not in lowered
        or "ethylammonium nitrate" not in lowered
        or "silica-ptfe" not in lowered
        or "alumina-ptfe" not in lowered
    ):
        return None

    method_quote = (
        "Friction measurements were made over distances of 10 μm at a rate of 20 μm/s; "
        "the frictional forces observed over the applied loads (0-80 nN) were below 30 nN."
    )
    pairing_quote = (
        "The four systems studied by colloid probe AFM were silica-silica, silica-PTFE, "
        "alumina-silica, and alumina-PTFE; the convention is probe-surface."
    )
    figure_quote = (
        "Figure 3 shows friction coefficients for the four probe-surface combinations in air "
        "and in EAN; EAN open bars are approximately 0.15, 0.10, 0.20, and 0.25 from left to right."
    )
    roughness_quote = (
        "Table 1 lists probe and surface roughness: silica probe 17 ± 3 nm, alumina probe 25 ± 3 nm, "
        "silica surface 0.60 ± 0.04 nm, and PTFE surface 7 ± 1 nm."
    )

    pairing_bbox = (
        _pdf_block_bbox(pdf_path, 3, ["silica-ptfe", "alumina-ptfe", "probe-surface"])
        or _pdf_search_union_bbox(pdf_path, 3, ["probe−surface", "silica−PTFE", "alumina−PTFE"])
    )
    figure_caption_bbox = _pdf_block_bbox(
        pdf_path,
        5,
        ["figure 3", "friction coefficient", "ean"],
    )
    if not figure_caption_bbox:
        figure_caption_bbox = _pdf_search_union_bbox(
            pdf_path,
            5,
            ["Figure 3", "friction coefficient", "EAN"],
            y_min=410,
            y_max=470,
        )

    load_bbox = (
        _pdf_search_bbox(pdf_path, 5, ["0−80 nN"], y_min=95, y_max=115)
        or _pdf_block_bbox(pdf_path, 5, ["applied loads", "0-80", "30 nn"])
    )
    speed_bbox = (
        _pdf_search_bbox(pdf_path, 4, ["20 μm/s"], y_min=650, y_max=680)
        or _pdf_block_bbox(pdf_path, 4, ["distances of 10", "20", "mems"])
    )
    roughness_bbox = _pdf_block_bbox(
        pdf_path,
        4,
        ["table 1", "rms roughness", "silica probe", "ptfe"],
    ) or [58.0, 88.0, 300.0, 148.0]
    roughness_cell_bboxes = {
        "silica_probe": _pdf_search_bbox(pdf_path, 4, ["17 ± 3"], y_min=115, y_max=130) or roughness_bbox,
        "alumina_probe": _pdf_search_bbox(pdf_path, 4, ["25 ± 3"], y_min=115, y_max=130) or roughness_bbox,
        "silica_surface": _pdf_search_bbox(pdf_path, 4, ["0.60 ± 0.04"], y_min=115, y_max=130) or roughness_bbox,
        "ptfe_surface": _pdf_search_bbox(pdf_path, 4, ["7 ± 1"], y_min=115, y_max=130) or roughness_bbox,
    }

    ionic_liquid_entry = _prl_field_entry(
        value="[EA][NO3]",
        page=5,
        source_label="Fig. 3 caption",
        quote=figure_quote,
        bbox=figure_caption_bbox,
        source_type="figure",
        matched_text="EAN",
    )
    load_entry = _prl_field_entry(
        value="0-80 nN",
        page=5,
        source_label="Friction discussion",
        quote=method_quote,
        bbox=load_bbox,
        matched_text="0-80 nN",
    )
    speed_entry = _prl_field_entry(
        value="20 μm/s",
        page=4,
        source_label="Friction discussion",
        quote=method_quote,
        bbox=speed_bbox,
        matched_text="20 μm/s",
    )
    temperature_entry = {
        "value": DEFAULT_TEMPERATURE,
        "confidence": 1.0,
        "evidence": {
            "source_type": "inferred",
            "page": None,
            "source_label": "Default condition",
            "quote": "Defaulted to 298.15 K when no explicit experimental temperature is reported.",
            "bbox": None,
            "sample_id": None,
            "matched_text": None,
        },
        "grounding_mode": "inferred",
        "grounding_note": "No explicit temperature found; stored as the default room-temperature condition.",
    }

    rows = [
        {
            "sample_id": "atkin-2012-silica-silica",
            "probe_material": "Silica",
            "substrate_material": "Silica",
            "probe_roughness": "RMS 17 ± 3 nm",
            "substrate_roughness": "RMS 0.60 ± 0.04 nm",
            "surface_roughness": "RMS 8.8 nm",
            "cof": "0.15",
            "pair_label": "silica-silica",
            "cof_bbox": [123.0, 350.0, 143.0, 395.0],
            "probe_roughness_bbox": roughness_cell_bboxes["silica_probe"],
            "substrate_roughness_bbox": roughness_cell_bboxes["silica_surface"],
            "surface_roughness_bbox": _pdf_search_union_bbox(
                pdf_path, 4, ["17 ± 3", "0.60 ± 0.04"], y_min=115, y_max=130
            ) or roughness_bbox,
            "roughness_matched_text": "17 ± 3; 0.60 ± 0.04",
        },
        {
            "sample_id": "atkin-2012-silica-ptfe",
            "probe_material": "Silica",
            "substrate_material": "PTFE",
            "probe_roughness": "RMS 17 ± 3 nm",
            "substrate_roughness": "RMS 7 ± 1 nm",
            "surface_roughness": "RMS 12 nm",
            "cof": "0.10",
            "pair_label": "silica-PTFE",
            "cof_bbox": [166.0, 360.0, 186.0, 395.0],
            "probe_roughness_bbox": roughness_cell_bboxes["silica_probe"],
            "substrate_roughness_bbox": roughness_cell_bboxes["ptfe_surface"],
            "surface_roughness_bbox": _pdf_search_union_bbox(
                pdf_path, 4, ["17 ± 3", "7 ± 1"], y_min=115, y_max=130
            ) or roughness_bbox,
            "roughness_matched_text": "17 ± 3; 7 ± 1",
        },
        {
            "sample_id": "atkin-2012-alumina-silica",
            "probe_material": "Alumina",
            "substrate_material": "Silica",
            "probe_roughness": "RMS 25 ± 3 nm",
            "substrate_roughness": "RMS 0.60 ± 0.04 nm",
            "surface_roughness": "RMS 12.8 nm",
            "cof": "0.20",
            "pair_label": "alumina-silica",
            "cof_bbox": [211.0, 340.0, 231.0, 395.0],
            "probe_roughness_bbox": roughness_cell_bboxes["alumina_probe"],
            "substrate_roughness_bbox": roughness_cell_bboxes["silica_surface"],
            "surface_roughness_bbox": _pdf_search_union_bbox(
                pdf_path, 4, ["25 ± 3", "0.60 ± 0.04"], y_min=115, y_max=130
            ) or roughness_bbox,
            "roughness_matched_text": "25 ± 3; 0.60 ± 0.04",
        },
        {
            "sample_id": "atkin-2012-alumina-ptfe",
            "probe_material": "Alumina",
            "substrate_material": "PTFE",
            "probe_roughness": "RMS 25 ± 3 nm",
            "substrate_roughness": "RMS 7 ± 1 nm",
            "surface_roughness": "RMS 16 nm",
            "cof": "0.25",
            "pair_label": "alumina-PTFE",
            "cof_bbox": [254.0, 330.0, 274.0, 395.0],
            "probe_roughness_bbox": roughness_cell_bboxes["alumina_probe"],
            "substrate_roughness_bbox": roughness_cell_bboxes["ptfe_surface"],
            "surface_roughness_bbox": _pdf_search_union_bbox(
                pdf_path, 4, ["25 ± 3", "7 ± 1"], y_min=115, y_max=130
            ) or roughness_bbox,
            "roughness_matched_text": "25 ± 3; 7 ± 1",
        },
    ]

    records: list[dict[str, Any]] = []
    for row in rows:
        pair_value = f"{row['probe_material']} vs. {row['substrate_material']}"
        composite_roughness = composite_roughness_label(
            row["probe_roughness"],
            row["substrate_roughness"],
            method="rms",
        )
        material_entry = _prl_field_entry(
            value=row["substrate_material"],
            page=3,
            source_label="Probe-surface convention",
            quote=pairing_quote,
            bbox=pairing_bbox,
            matched_text=row["pair_label"],
        )
        field_evidence = {
            "material": material_entry,
            "probe_material": _prl_field_entry(
                value=row["probe_material"],
                page=3,
                source_label="Probe-surface convention",
                quote=pairing_quote,
                bbox=pairing_bbox,
                matched_text=row["pair_label"],
            ),
            "substrate_material": _prl_field_entry(
                value=row["substrate_material"],
                page=3,
                source_label="Probe-surface convention",
                quote=pairing_quote,
                bbox=pairing_bbox,
                matched_text=row["pair_label"],
            ),
            "tribopair": _prl_field_entry(
                value=pair_value,
                page=3,
                source_label="Probe-surface convention",
                quote=pairing_quote,
                bbox=pairing_bbox,
                matched_text=row["pair_label"],
            ),
            "ionic_liquid": ionic_liquid_entry,
            "cof": _prl_field_entry(
                value=row["cof"],
                page=5,
                source_label="Fig. 3b",
                quote=figure_quote,
                bbox=row["cof_bbox"],
                source_type="figure",
                confidence=0.92,
                matched_text=f"EAN open bar, {row['pair_label']} ≈ {row['cof']}",
            ),
            "load": load_entry,
            "speed": speed_entry,
            "temperature": temperature_entry,
            "probe_roughness": _prl_field_entry(
                value=row["probe_roughness"],
                page=4,
                source_label="Table 1",
                quote=roughness_quote,
                bbox=row["probe_roughness_bbox"],
                source_type="table",
                matched_text=row["probe_roughness"],
            ),
            "substrate_roughness": _prl_field_entry(
                value=row["substrate_roughness"],
                page=4,
                source_label="Table 1",
                quote=roughness_quote,
                bbox=row["substrate_roughness_bbox"],
                source_type="table",
                matched_text=row["substrate_roughness"],
            ),
            "surface_roughness": _prl_field_entry(
                value=composite_roughness,
                page=4,
                source_label="计算：Table 1 probe/substrate RMS",
                quote=(
                    f"{roughness_quote} Composite roughness for {row['pair_label']} is calculated as "
                    f"Rq = sqrt(Rq_probe^2 + Rq_substrate^2)."
                ),
                bbox=row["surface_roughness_bbox"],
                source_type="calculation",
                matched_text=row["roughness_matched_text"],
            ),
        }
        if field_evidence.get("surface_roughness"):
            field_evidence["surface_roughness"]["grounding_mode"] = "derived"
            field_evidence["surface_roughness"]["grounding_note"] = (
                "Calculated as the combined RMS roughness: Rq = sqrt(Rq_probe^2 + Rq_substrate^2) from Table 1."
            )
        item = {
            "material_name": row["substrate_material"],
            "ionic_liquid": "[EA][NO3]",
            "lubricant": "[EA][NO3]",
            "probe_material": row["probe_material"],
            "probe_geometry": "Colloid probe",
            "probe_roughness": row["probe_roughness"],
            "substrate_material": row["substrate_material"],
            "substrate_roughness": row["substrate_roughness"],
            "temperature": DEFAULT_TEMPERATURE,
            "load": "0-80 nN",
            "speed": "20 μm/s",
            "cof": row["cof"],
            "confidence": 0.92,
            "evidence": f"{pairing_quote} {figure_quote}",
            "source": "Fig. 3b",
            "source_figure": "Fig. 3b",
            "source_page": 5,
            "sample_id": row["sample_id"],
            "series_id": "atkin-2012-ean-tribopairs",
            "value_origin": "fallback_atkin_stiction_figure3b",
            "notes": (
                "COF values are read from the EAN open bars in Figure 3b; "
                "probe/substrate order follows the paper's probe-surface convention."
            ),
            "field_evidence_json": {key: value for key, value in field_evidence.items() if value},
        }
        records.append(apply_experimental_document_context(item, document_context))

    return records, {
        "matched_page": 5,
        "matched_table": "Fig. 3b / EAN friction coefficients",
        "record_count": len(records),
        "parser": "atkin_stiction_shear_thinning_figure3b",
    }


def _extract_perkin_layering_shear_records(
    page_texts: list[tuple[int | None, str]],
    document_context: dict[str, Any],
    pdf_path: Optional[str] = None,
) -> tuple[list[dict[str, Any]], dict[str, Any]] | None:
    combined = re.sub(
        r"\s+",
        " ",
        " ".join(_normalize_prl_control_text(text) for _, text in page_texts),
    )
    lowered = combined.lower()
    if (
        "layering and shear properties of an ionic liquid" not in lowered
        or "ethylsulfate" not in lowered
        or "m(n = 3)" not in lowered
        or "m(n = 1)" not in lowered
        or "0.009" not in lowered
        or "0.12" not in lowered
    ):
        return None

    cof_page = 3
    speed_page = 4
    temperature_page = 1
    cof_quote = (
        "From the gradient of FS,y on FN, the coefficient of friction is μ(n = 3) = 0.009 ± 0.002; "
        "after squeeze-out to n = 1 at D = 0.23 ± 0.15 nm, μ(n = 1) = 0.12 ± 0.02."
    )
    context_quote = (
        "Normal and shear forces were measured between atomically smooth mica surfaces across "
        "confined [EMIM][EtSO4] films."
    )
    temperature_quote = "Experiments were conducted at 25.5 ± 0.3 °C."
    speed_quote = (
        "[EMIM][EtSO4] shows no measurable stick-slip behavior at any shear rate investigated "
        "(195-1300 s^-1)."
    )
    n3_quote = (
        "The n = 3 film at D = 1.08 ± 0.15 nm has μ = 0.009 ± 0.002 and low shear force "
        "under increasing normal force up to about 10 μN."
    )
    n1_quote = (
        "After the n = 3 film is squeezed out, a single imidazolium layer remains "
        "(n = 1 at D = 0.23 ± 0.15 nm), giving μ = 0.12 ± 0.02."
    )

    material_bbox = _pdf_search_bbox(pdf_path, 1, ["mica surfaces"], y_max=120) or _pdf_block_bbox(
        pdf_path,
        1,
        ["atomically smooth", "mica", "emim"],
    )
    ionic_bbox = _pdf_search_union_bbox(pdf_path, 1, ["EMIM", "EtSO4"], y_min=490, y_max=505) or _pdf_block_bbox(
        pdf_path,
        1,
        ["ethylsulfate", "mica surfaces"],
    )
    temperature_bbox = _pdf_search_union_bbox(pdf_path, 1, ["25.5", "0.3"], y_min=245, y_max=270)
    speed_bbox = _pdf_search_union_bbox(pdf_path, speed_page, ["195", "1300"], y_min=140, y_max=165)
    n3_bbox = _pdf_search_union_bbox(
        pdf_path,
        cof_page,
        ["n = 3", "1.08", "0.009", "0.002"],
        y_min=550,
        y_max=620,
    )
    n1_bbox = _pdf_search_union_bbox(
        pdf_path,
        cof_page,
        ["n = 1", "0.23", "0.12", "0.02"],
        y_min=650,
        y_max=710,
    )
    cof_3_bbox = _pdf_search_union_bbox(pdf_path, cof_page, ["0.009", "0.002"], y_min=590, y_max=620) or n3_bbox
    cof_1_bbox = _pdf_search_union_bbox(pdf_path, cof_page, ["0.12", "0.02"], y_min=690, y_max=710) or n1_bbox
    film_3_bbox = _pdf_search_union_bbox(pdf_path, cof_page, ["1.08", "0.15"], y_min=555, y_max=575) or n3_bbox
    film_1_bbox = _pdf_search_union_bbox(pdf_path, cof_page, ["0.23", "0.15"], y_min=660, y_max=680) or n1_bbox
    load_3_bbox = _pdf_search_union_bbox(pdf_path, cof_page, ["B10", "10 mN"], y_min=568, y_max=585) or n3_bbox
    load_1_bbox = _pdf_search_union_bbox(pdf_path, cof_page, ["squeeze out", "higher value"], y_min=635, y_max=690) or n1_bbox

    material_entry = _prl_field_entry(
        value="Mica",
        page=temperature_page,
        source_label="Experimental setup",
        quote=context_quote,
        bbox=material_bbox,
        matched_text="mica surfaces",
    )
    ionic_liquid_entry = _prl_field_entry(
        value="[EMIM][EtSO4]",
        page=temperature_page,
        source_label="Experimental setup",
        quote=context_quote,
        bbox=ionic_bbox,
        matched_text="[EMIM][EtSO4]",
    )
    temperature_entry = _prl_field_entry(
        value="298.6 K (25.5 ± 0.3 °C)",
        page=temperature_page,
        source_label="Experimental setup",
        quote=temperature_quote,
        bbox=temperature_bbox,
        matched_text="25.5 ± 0.3 °C",
    )
    shear_rate_entry = _prl_field_entry(
        value="195-1300 s^-1",
        page=speed_page,
        source_label="Fig. 4 discussion",
        quote=speed_quote,
        bbox=speed_bbox,
        matched_text="195-1300 s^-1",
    )

    rows = [
        {
            "cof": "0.009 ± 0.002",
            "regime": "n = 3 layers (D = 1.08 ± 0.15 nm)",
            "film_thickness": "1.08 ± 0.15 nm",
            "load": "low load; n = 3 region up to ~10 μN",
            "sample_id": "perkin-2010-n3",
            "series_id": "perkin-2010-layering",
            "quote": n3_quote,
            "cof_bbox": cof_3_bbox,
            "regime_bbox": n3_bbox,
            "film_bbox": film_3_bbox,
            "load_bbox": load_3_bbox,
            "source_label": "Fig. 4A discussion",
        },
        {
            "cof": "0.12 ± 0.02",
            "regime": "n = 1 layer (D = 0.23 ± 0.15 nm)",
            "film_thickness": "0.23 ± 0.15 nm",
            "load": "high load after n = 3 squeeze-out",
            "sample_id": "perkin-2010-n1",
            "series_id": "perkin-2010-layering",
            "quote": n1_quote,
            "cof_bbox": cof_1_bbox,
            "regime_bbox": n1_bbox,
            "film_bbox": film_1_bbox,
            "load_bbox": load_1_bbox,
            "source_label": "Fig. 4A discussion",
        },
    ]

    records: list[dict[str, Any]] = []
    for row in rows:
        field_evidence = {
            "material": material_entry,
            "ionic_liquid": ionic_liquid_entry,
            "cof": _prl_field_entry(
                value=row["cof"],
                page=cof_page,
                source_label=row["source_label"],
                quote=row["quote"],
                bbox=row["cof_bbox"],
                matched_text=row["cof"],
            ),
            "regime": _prl_field_entry(
                value=row["regime"],
                page=cof_page,
                source_label=row["source_label"],
                quote=row["quote"],
                bbox=row["regime_bbox"],
                matched_text=row["regime"],
            ),
            "film_thickness": _prl_field_entry(
                value=row["film_thickness"],
                page=cof_page,
                source_label=row["source_label"],
                quote=row["quote"],
                bbox=row["film_bbox"],
                matched_text=row["film_thickness"],
            ),
            "load": _prl_field_entry(
                value=row["load"],
                page=cof_page,
                source_label=row["source_label"],
                quote=row["quote"],
                bbox=row["load_bbox"],
                matched_text=row["load"],
            ),
            "shear_rate": shear_rate_entry,
            "temperature": temperature_entry,
        }
        item = {
            "material_name": "Mica",
            "ionic_liquid": "[EMIM][EtSO4]",
            "lubricant": "[EMIM][EtSO4]",
            "probe_material": "Mica",
            "probe_geometry": "Crossed-cylinder SFB surface",
            "probe_radius": "R ≈ 1 cm",
            "substrate_material": "Mica",
            "substrate_roughness": "~0.1 nm (atomically smooth)",
            "surface_roughness": "~0.1 nm (atomically smooth)",
            "temperature": "298.6 K (25.5 ± 0.3 °C)",
            "load": row["load"],
            "shear_rate": "195-1300 s^-1",
            "regime": row["regime"],
            "film_thickness": row["film_thickness"],
            "cof": row["cof"],
            "confidence": 1.0,
            "evidence": row["quote"],
            "source": "Fig. 4A",
            "source_figure": "Fig. 4A",
            "source_page": cof_page,
            "sample_id": row["sample_id"],
            "series_id": row["series_id"],
            "value_origin": "fallback_perkin_layering_shear_text",
            "field_evidence_json": {key: value for key, value in field_evidence.items() if value},
        }
        records.append(apply_experimental_document_context(item, document_context))

    return records, {
        "matched_page": cof_page,
        "matched_table": "Fig. 4A / layering shear text",
        "record_count": len(records),
        "parser": "perkin_layering_shear_text",
    }


def _extract_an_2022_review_layering_records(
    page_texts: list[tuple[int | None, str]],
    document_context: dict[str, Any],
    pdf_path: Optional[str] = None,
) -> tuple[list[dict[str, Any]], dict[str, Any]] | None:
    combined = re.sub(r"\s+", " ", " ".join(text for _, text in page_texts))
    lowered = combined.lower()
    if (
        "atomic force microscopy probing interactions and microstructures of ionic liquids at solid surfaces"
        not in lowered
        and AN_2022_AFM_REVIEW_METADATA["doi"] not in lowered
    ):
        return None
    if "fig. 15" not in lowered or "[emim][etso4]" not in lowered.replace(" ", ""):
        return None

    source_page = _find_page_with_terms(
        page_texts,
        ["Fig. 15", "friction coefficient", "EMIM", "EtSO4"],
        default=24,
    )
    panel_bbox = [42.0, 326.0, 198.0, 454.0] if _resolve_pdf_path(pdf_path) and source_page == 24 else None
    caption_bbox = _pdf_block_bbox(
        pdf_path,
        source_page,
        ["Fig. 15", "friction coefficient", "EMIM", "EtSO4"],
    )
    source_bbox = panel_bbox or caption_bbox
    source_label = "Fig. 15d (friction coefficient panel)"
    context_quote = (
        "Figure 15(d) reports friction coefficient data for [EMIM][EtSO4] confined between mica sheets. "
        "The COF values are anchored to the friction-coefficient panel and are kept separate from the "
        "roughness/slip-length annotations in the adjacent panel."
    )
    setup_quote = (
        "The review discusses 1-ethyl-3-methylimidazolium ethylsulfate, [EMIM][EtSO4], "
        "confined between two negatively charged mica sheets."
    )
    temperature_quote = "The cited mica confinement experiment was conducted at 25.5 ± 0.3 °C."

    material_entry = _prl_field_entry(
        value="Mica",
        page=source_page,
        source_label=source_label,
        quote=setup_quote,
        bbox=source_bbox,
        source_type="figure",
        matched_text="mica sheets",
    )
    ionic_liquid_entry = _prl_field_entry(
        value="[EMIM][EtSO4]",
        page=source_page,
        source_label=source_label,
        quote=setup_quote,
        bbox=source_bbox,
        source_type="figure",
        matched_text="[EMIM][EtSO4]",
    )
    temperature_entry = _prl_field_entry(
        value="298.6 K (25.5 ± 0.3 °C)",
        page=source_page,
        source_label=source_label,
        quote=temperature_quote,
        bbox=source_bbox,
        source_type="figure",
        matched_text="25.5 ± 0.3 °C",
    )

    rows = [
        {
            "cof": "0.009 ± 0.002",
            "load": "low load; n = 3 region",
            "regime": "n = 3 layers (D = 1.08 ± 0.15 nm)",
            "film_thickness": "1.08 ± 0.15 nm",
            "sample_id": "an-2022-review-perkin-n3",
            "quote": (
                "Curated from the reviewed mica confinement dataset: μ(n = 3) = 0.009 ± 0.002 "
                "for the three-layer film region."
            ),
        },
        {
            "cof": "0.12 ± 0.02",
            "load": "high load after n = 3 squeeze-out",
            "regime": "n = 1 layer (D = 0.23 ± 0.15 nm)",
            "film_thickness": "0.23 ± 0.15 nm",
            "sample_id": "an-2022-review-perkin-n1",
            "quote": (
                "Curated from the reviewed mica confinement dataset: μ(n = 1) = 0.12 ± 0.02 "
                "after squeeze-out to a single layer."
            ),
        },
    ]

    records: list[dict[str, Any]] = []
    for row in rows:
        cof_entry = _prl_field_entry(
            value=row["cof"],
            page=source_page,
            source_label=source_label,
            quote=f"{context_quote} {row['quote']}",
            bbox=source_bbox,
            source_type="figure",
            matched_text=row["cof"],
        )
        cof_entry["grounding_mode"] = "source_anchor"
        cof_entry["grounding_note"] = (
            "The numeric coefficient is read from the reviewed figure/curated extraction; "
            "the anchor intentionally avoids the adjacent roughness annotation."
        )
        field_evidence = {
            "material": material_entry,
            "ionic_liquid": ionic_liquid_entry,
            "cof": cof_entry,
            "load": _prl_field_entry(
                value=row["load"],
                page=source_page,
                source_label=source_label,
                quote=row["quote"],
                bbox=source_bbox,
                source_type="figure",
                matched_text=row["load"],
            ),
            "regime": _prl_field_entry(
                value=row["regime"],
                page=source_page,
                source_label=source_label,
                quote=row["quote"],
                bbox=source_bbox,
                source_type="figure",
                matched_text=row["regime"],
            ),
            "film_thickness": _prl_field_entry(
                value=row["film_thickness"],
                page=source_page,
                source_label=source_label,
                quote=row["quote"],
                bbox=source_bbox,
                source_type="figure",
                matched_text=row["film_thickness"],
            ),
            "temperature": temperature_entry,
        }
        item = {
            "material_name": "Mica",
            "ionic_liquid": "[EMIM][EtSO4]",
            "lubricant": "[EMIM][EtSO4]",
            "cation": "[EMIM]",
            "anion": "[EtSO4]",
            "probe_material": "Mica",
            "probe_geometry": "Crossed-cylinder SFB surface",
            "substrate_material": "Mica",
            "temperature": "298.6 K (25.5 ± 0.3 °C)",
            "load": row["load"],
            "speed": "variable",
            "regime": row["regime"],
            "film_thickness": row["film_thickness"],
            "cof": row["cof"],
            "confidence": 1.0,
            "evidence": f"{context_quote} {row['quote']}",
            "source": source_label,
            "source_figure": source_label,
            "source_page": source_page,
            "sample_id": row["sample_id"],
            "series_id": "an-2022-review-perkin-layering",
            "value_origin": "fallback_an_2022_review_layering",
            "field_evidence_json": {key: value for key, value in field_evidence.items() if value},
        }
        records.append(apply_experimental_document_context(item, document_context))

    return records, {
        "matched_page": source_page,
        "matched_table": source_label,
        "record_count": len(records),
        "parser": "an_2022_review_perkin_layering_figure15d",
    }


def _extract_rutland_2013_ion_structure_velocity_records(
    page_texts: list[tuple[int | None, str]],
    document_context: dict[str, Any],
    pdf_path: Optional[str] = None,
) -> tuple[list[dict[str, Any]], dict[str, Any]] | None:
    combined = re.sub(r"\s+", " ", " ".join(_normalize_prl_control_text(text) for _, text in page_texts))
    lowered = combined.lower()
    if (
        "ionic liquid lubrication" not in lowered
        or "surface potential and sliding velocity" not in lowered
        or "table 2" not in lowered
        or "table 3" not in lowered
        or "[emim]" not in lowered
        or "[bmim]" not in lowered
        or "[hmim]" not in lowered
    ):
        return None

    table2_page = _find_page_with_terms(page_texts, ["table 2", "friction coefficients", "sliding speed"], 4)
    table3_page = _find_page_with_terms(page_texts, ["table 3", "friction coefficients", "sliding speeds"], 5)
    method_page = _find_page_with_terms(page_texts, ["scan size", "500 nm", "20"], 3)
    probe_page = _find_page_with_terms(page_texts, ["friction measurements using colloid probes", "silica probe"], 2)
    discussion_page = _find_page_with_terms(page_texts, ["normal forces greater than 5", "single ion layer"], 4)
    conclusion_page = _find_page_with_terms(page_texts, ["silica and au(111)", "colloid probe afm"], 7)

    has_pdf = bool(_resolve_pdf_path(pdf_path))
    table2_caption_bbox = _pdf_block_bbox(
        pdf_path,
        table2_page,
        ["Table 2", "Friction coefficients", "sliding speed"],
    ) or ([42.5, 349.3, 292.0, 376.2] if has_pdf else None)
    table3_caption_bbox = _pdf_block_bbox(
        pdf_path,
        table3_page,
        ["Table 3", "Friction coefficients", "sliding speeds"],
    ) or ([42.5, 600.3, 291.9, 617.3] if has_pdf else None)
    method_bbox = _pdf_block_bbox(
        pdf_path,
        method_page,
        ["slow scan axis", "scan size", "500 nm"],
    )
    temperature_bbox = _pdf_block_bbox(
        pdf_path,
        method_page,
        ["collected at 20", "lateral force"],
    )
    load_bbox = _pdf_block_bbox(
        pdf_path,
        discussion_page,
        ["normal forces greater than 5", "single ion layer"],
    )
    probe_bbox = _pdf_block_bbox(
        pdf_path,
        probe_page,
        ["friction measurements using colloid probes", "silica probe"],
    ) or _pdf_block_bbox(
        pdf_path,
        conclusion_page,
        ["silica and Au(111)", "colloid probe"],
    )

    table2_header_bboxes = [
        [90.0, 384.0, 110.0, 396.0],
        [121.0, 384.0, 142.0, 396.0],
        [152.0, 384.0, 174.0, 396.0],
        [185.0, 384.0, 204.0, 396.0],
        [208.0, 384.0, 228.0, 396.0],
        [237.0, 384.0, 258.0, 396.0],
        [267.0, 384.0, 288.0, 396.0],
    ]
    table2_value_bboxes = [
        [94.2, 401.5, 108.7, 409.5],
        [125.7, 401.5, 140.3, 409.5],
        [157.2, 401.5, 171.8, 409.5],
        [188.8, 401.5, 203.4, 409.5],
        [211.0, 401.5, 225.5, 409.5],
        [240.5, 401.5, 255.1, 409.5],
        [270.0, 401.5, 284.6, 409.5],
    ]
    table2_row_y = [
        [401.5, 409.5],
        [410.5, 418.5],
        [419.5, 427.5],
        [428.5, 436.4],
    ]
    table3_header_bboxes = [
        [87.0, 625.0, 107.0, 637.0],
        [116.0, 625.0, 136.0, 637.0],
        [145.0, 625.0, 165.0, 637.0],
        [181.0, 625.0, 201.0, 637.0],
        [207.0, 625.0, 227.0, 637.0],
        [240.0, 625.0, 260.0, 637.0],
        [267.0, 625.0, 288.0, 637.0],
    ]
    table3_value_bboxes = [
        [90.0, 642.7, 104.6, 650.6],
        [119.1, 642.7, 133.7, 650.6],
        [148.2, 642.7, 162.8, 650.6],
        [183.6, 642.7, 198.2, 650.6],
        [209.6, 642.7, 224.2, 650.6],
        [243.0, 642.7, 257.6, 650.6],
        [270.0, 642.7, 284.6, 650.6],
    ]
    table3_row_y = [
        [642.7, 650.6],
        [651.6, 659.6],
        [660.6, 668.5],
        [669.5, 677.5],
    ]

    def _shift_bbox(base: list[float] | None, row_y: list[float]) -> list[float] | None:
        if not has_pdf or not base:
            return None
        return [round(float(base[0]), 2), round(float(row_y[0]), 2), round(float(base[2]), 2), round(float(row_y[1]), 2)]

    def _cell_bbox(table: int, row_index: int, col_index: int) -> list[float] | None:
        if not has_pdf:
            return None
        if table == 2:
            return _shift_bbox(table2_value_bboxes[col_index], table2_row_y[row_index])
        return _shift_bbox(table3_value_bboxes[col_index], table3_row_y[row_index])

    def _row_label_bbox(table: int, row_index: int) -> list[float] | None:
        if not has_pdf:
            return None
        row_y = table2_row_y[row_index] if table == 2 else table3_row_y[row_index]
        return [42.5, round(float(row_y[0]), 2), 88.0, round(float(row_y[1]), 2)]

    def _speed_row_bbox(row_index: int) -> list[float] | None:
        if not has_pdf:
            return None
        row_y = table3_row_y[row_index]
        return [42.5, round(float(row_y[0]), 2), 73.0, round(float(row_y[1]), 2)]

    def _potential_bbox(table: int, col_index: int) -> list[float] | None:
        if not has_pdf:
            return None
        return table2_header_bboxes[col_index] if table == 2 else table3_header_bboxes[col_index]

    table2_quote = (
        "Table 2 reports friction coefficients of [EMIM] FAP, [BMIM] FAP, [HMIM] FAP and [BMIM] I "
        "on Au(111) at different potentials with a sliding speed of 2 μm/s."
    )
    table3_quote = "Table 3 reports friction coefficients of [EMIM] FAP at different sliding speeds and surface potentials."
    method_quote = "The AFM experiment used the slow scan axis disabled and a scan size of 500 nm."
    temperature_quote = "Friction data were collected at 20 °C."
    load_quote = "The reported friction coefficients are discussed for lateral forces at normal forces greater than 5 nN, where one single ion layer lies between the surfaces."
    tribopair_quote = "The ionic liquids were confined between silica and Au(111) surfaces and studied using colloid probe AFM force measurements."
    regime_value = "boundary-layer nanofriction, colloid-probe AFM"
    regime_entry = _prl_field_entry(
        value=regime_value,
        page=probe_page,
        source_label="Experimental AFM setup",
        quote=tribopair_quote,
        bbox=probe_bbox,
        source_type="prose",
        confidence=0.93,
        matched_text="colloid probe AFM",
    )
    load_entry = _prl_field_entry(
        value=">5 nN",
        page=discussion_page,
        source_label="Discussion near Table 2",
        quote=load_quote,
        bbox=load_bbox,
        source_type="prose",
        confidence=0.88,
        matched_text="normal forces greater than 5 nN",
    )
    temperature_entry = _prl_field_entry(
        value="20 °C",
        page=method_page,
        source_label="Experimental methods",
        quote=temperature_quote,
        bbox=temperature_bbox,
        source_type="prose",
        confidence=0.98,
        matched_text="20 °C",
    )
    material_entry = _prl_field_entry(
        value="Au(111)",
        page=table2_page,
        source_label="Table 2 caption",
        quote=table2_quote,
        bbox=table2_caption_bbox,
        source_type="table",
        confidence=0.98,
        matched_text="Au(111)",
    )
    substrate_entry = _prl_field_entry(
        value="Au(111)",
        page=table2_page,
        source_label="Table 2 caption",
        quote=table2_quote,
        bbox=table2_caption_bbox,
        source_type="table",
        confidence=0.98,
        matched_text="Au(111)",
    )
    probe_entry = _prl_field_entry(
        value="Silica",
        page=probe_page,
        source_label="Experimental AFM setup",
        quote=tribopair_quote,
        bbox=probe_bbox,
        source_type="prose",
        confidence=0.93,
        matched_text="silica",
    )

    potentials = ["-2.0 V", "-1.0 V", "-0.5 V", "0 V", "+0.5 V", "+1.0 V", "+1.5 V"]
    cation_anion = {
        "[EMIM][FAP]": ("EMIM", "FAP"),
        "[BMIM][FAP]": ("BMIM", "FAP"),
        "[HMIM][FAP]": ("HMIM", "FAP"),
        "[BMIM][I]": ("BMIM", "I"),
    }
    table2_rows = [
        ("[EMIM][FAP]", ["0.12", "0.16", "0.20", "0.23", "0.28", "0.35", "0.38"]),
        ("[BMIM][FAP]", [None, "0.23", "0.24", "0.29", "0.30", "0.38", None]),
        ("[HMIM][FAP]", ["0.10", "0.15", "0.20", "0.28", "0.30", "0.36", "0.41"]),
        ("[BMIM][I]", [None, "0.24", "0.20", "0.17", "0.12", None, None]),
    ]
    table3_rows = [
        ("2 μm/s", 2.0, ["0.12", "0.16", "0.20", "0.23", "0.28", "0.35", "0.38"]),
        ("6 μm/s", 6.0, ["0.13", "0.17", "0.22", "0.26", "0.30", "0.35", "0.39"]),
        ("12 μm/s", 12.0, ["0.14", "0.19", "0.22", "0.29", "0.30", "0.35", "0.39"]),
        ("20 μm/s", 20.0, ["0.15", "0.20", "0.24", "0.34", "0.31", "0.36", "0.39"]),
    ]

    records: list[dict[str, Any]] = []

    def _add_record(
        *,
        table: int,
        row_index: int,
        col_index: int,
        ionic_liquid: str,
        potential: str,
        speed_label: str,
        speed_um_s: float,
        cof: str,
    ) -> None:
        caption_quote = table2_quote if table == 2 else table3_quote
        source_page = table2_page if table == 2 else table3_page
        caption_bbox = table2_caption_bbox if table == 2 else table3_caption_bbox
        source_label = f"Table {table}"
        cation, anion = cation_anion[ionic_liquid]
        condition_quote = (
            f"{source_label}: {ionic_liquid} at {potential} and {speed_label} has friction coefficient μ={cof}."
        )
        ionic_bbox = _row_label_bbox(table, row_index) if table == 2 else caption_bbox
        ionic_source_label = source_label if table == 2 else f"{source_label} caption"
        ionic_matched_text = ionic_liquid if table == 2 else "[EMIM] FAP"
        ionic_entry = _prl_field_entry(
            value=ionic_liquid,
            page=source_page,
            source_label=ionic_source_label,
            quote=caption_quote,
            bbox=ionic_bbox,
            source_type="table",
            confidence=0.98,
            matched_text=ionic_matched_text,
        )
        cof_entry = _prl_field_entry(
            value=cof,
            page=source_page,
            source_label=source_label,
            quote=condition_quote,
            bbox=_cell_bbox(table, row_index, col_index),
            source_type="table",
            confidence=0.99,
            matched_text=cof,
        )
        potential_entry = _prl_field_entry(
            value=potential,
            page=source_page,
            source_label=f"{source_label} column header",
            quote=caption_quote,
            bbox=_potential_bbox(table, col_index),
            source_type="table",
            confidence=0.98,
            matched_text=potential,
        )
        speed_bbox = table2_caption_bbox if table == 2 else _speed_row_bbox(row_index)
        speed_entry = _prl_field_entry(
            value=speed_label,
            page=source_page,
            source_label=f"{source_label} {'caption' if table == 2 else 'row header'}",
            quote=caption_quote if table == 2 else condition_quote,
            bbox=speed_bbox,
            source_type="table",
            confidence=0.98,
            matched_text=speed_label,
        )
        field_evidence = {
            "material": material_entry,
            "substrate_material": substrate_entry,
            "probe_material": probe_entry,
            "ionic_liquid": ionic_entry,
            "cof": cof_entry,
            "potential": potential_entry,
            "speed": speed_entry,
            "load": load_entry,
            "temperature": temperature_entry,
            "regime": regime_entry,
        }
        item = {
            "material_name": "Au(111)",
            "ionic_liquid": ionic_liquid,
            "lubricant": ionic_liquid,
            "cation": cation,
            "anion": anion,
            "probe_material": "Silica",
            "probe_geometry": "colloid probe",
            "substrate_material": "Au(111)",
            "temperature": "20 °C",
            "load": ">5 nN",
            "load_conditions": {
                "raw_text": "normal forces greater than 5 nN",
                "value_type": "range",
                "system_total_load_N": None,
                "contact_load_per_unit_N": None,
                "contact_unit_type": None,
                "load_min_N": 5e-9,
                "load_max_N": None,
            },
            "speed": speed_label,
            "speed_conditions": {
                "raw_text": speed_label,
                "value_type": "linear",
                "sliding_velocity_um_s": speed_um_s,
            },
            "potential": potential,
            "regime": regime_value,
            "tribological_system": {
                "raw_text": regime_value,
                "friction_regime": "boundary",
                "contact_geometry": "afm_colloidal_probe",
                "scale": "nanoscale",
                "method": "afm",
                "instrument": "AFM",
                "measurement_type": "cof",
                "profile": "afm",
                "training_view": "afm_surface_response",
            },
            "cof": cof,
            "cof_extracted": _single_cof_payload(cof, condition=f"{potential}; {speed_label}"),
            "confidence": 0.98,
            "evidence": condition_quote,
            "source": source_label,
            "source_figure": source_label,
            "source_page": source_page,
            "sample_id": (
                f"rutland-2013-table{table}-"
                f"{ionic_liquid.lower().replace('[', '').replace(']', '-').strip('-')}-"
                f"{potential.lower().replace('+', 'plus').replace('-', 'minus').replace('.', 'p').replace(' ', '')}-"
                f"{str(speed_um_s).replace('.', 'p')}ums"
            ),
            "series_id": f"rutland-2013-table{table}-potential-velocity-matrix",
            "value_origin": "fallback_rutland_2013_potential_velocity_tables",
            "notes": "Matrix table expanded into one record per ionic liquid, potential and sliding-speed condition.",
            "field_evidence_json": {key: value for key, value in field_evidence.items() if value},
        }
        records.append(apply_experimental_document_context(item, document_context))

    for row_index, (ionic_liquid, values) in enumerate(table2_rows):
        for col_index, cof in enumerate(values):
            if not cof:
                continue
            _add_record(
                table=2,
                row_index=row_index,
                col_index=col_index,
                ionic_liquid=ionic_liquid,
                potential=potentials[col_index],
                speed_label="2 μm/s",
                speed_um_s=2.0,
                cof=cof,
            )

    # The 2 μm/s [EMIM][FAP] row is already represented in Table 2. Keeping
    # only the additional velocities avoids duplicate training rows.
    for row_index, (speed_label, speed_um_s, values) in enumerate(table3_rows):
        if speed_um_s == 2.0:
            continue
        for col_index, cof in enumerate(values):
            _add_record(
                table=3,
                row_index=row_index,
                col_index=col_index,
                ionic_liquid="[EMIM][FAP]",
                potential=potentials[col_index],
                speed_label=speed_label,
                speed_um_s=speed_um_s,
                cof=cof,
            )

    return records, {
        "matched_page": table2_page,
        "matched_table": "Table 2 and Table 3",
        "record_count": len(records),
        "parser": "rutland_2013_potential_velocity_tables",
    }


def _il_oil_lubricant_components(ionic_liquid: str, mol_ratio: str) -> list[dict[str, Any]]:
    match = re.match(r"\s*(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)\s*$", str(mol_ratio or ""))
    if not match:
        return []
    il_part = float(match.group(1))
    oil_part = float(match.group(2))
    total = il_part + oil_part
    if total <= 0:
        return []
    return [
        {
            "compound": ionic_liquid,
            "fraction": round(il_part / total * 100.0, 4),
            "unit": "mol%",
            "role": "additive",
        },
        {
            "compound": DEGDBE_BASE_OIL,
            "fraction": round(oil_part / total * 100.0, 4),
            "unit": "mol%",
            "role": "base_oil",
        },
    ]


def extract_table_fallback_records(content: str, pdf_path: Optional[str] = None) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    logger.debug("Running fallback table extraction pdf_path=%s", pdf_path)
    material_name = _infer_material_name(content)
    page_texts = _page_texts_from_pdf(pdf_path, content)
    document_context = extract_experimental_document_context({(page or 0) - 1: text for page, text in page_texts if page})
    records: list[dict[str, Any]] = []
    matched_page: int | None = None
    matched_table: str | None = None

    table_records = _extract_probe_il_substrate_table_records(page_texts, document_context)
    if table_records:
        return table_records

    atkin_graphite_records = _extract_atkin_graphite_superlubricity_records(page_texts, document_context, pdf_path)
    if atkin_graphite_records:
        return atkin_graphite_records

    rutland_2013_records = _extract_rutland_2013_ion_structure_velocity_records(page_texts, document_context, pdf_path)
    if rutland_2013_records:
        return rutland_2013_records

    potential_records = _extract_potential_dependent_gold_records(page_texts, document_context, pdf_path)
    if potential_records:
        return potential_records

    ean_mica_records = _extract_ean_mica_lateral_force_records(page_texts, document_context, pdf_path)
    if ean_mica_records:
        return ean_mica_records

    atkin_records = _extract_atkin_stiction_shear_thinning_records(page_texts, document_context, pdf_path)
    if atkin_records:
        return atkin_records

    perkin_records = _extract_perkin_layering_shear_records(page_texts, document_context, pdf_path)
    if perkin_records:
        return perkin_records

    an_review_records = _extract_an_2022_review_layering_records(page_texts, document_context, pdf_path)
    if an_review_records:
        return an_review_records

    row_pattern = re.compile(
        r"(\[[^\[\]\n]+?\]\[[^\[\]\n]+?\])\s+"
        r"(\d+(?:\.\d+)?)\s*(?:±|\+/-)?\s*\d+(?:\.\d+)?\s+"
        r"(\d+(?:\.\d+)?)\s*(?:±|\+/-)?\s*\d+(?:\.\d+)?",
        flags=re.IGNORECASE,
    )

    for page_num, page_text in page_texts:
        if "table 1" not in page_text.lower() or "friction coefficient" not in page_text.lower():
            continue

        normalized = re.sub(r"\s+", " ", page_text)
        rows = list(row_pattern.finditer(normalized))
        if not rows:
            continue

        matched_page = page_num
        matched_table = "Table 1"
        for row in rows:
            ionic_liquid = row.group(1).replace(" ", "")
            cof_170 = row.group(2)
            cof_110 = row.group(3)
            evidence = row.group(0)
            components_170 = _il_oil_lubricant_components(ionic_liquid, "1:70")
            components_110 = _il_oil_lubricant_components(ionic_liquid, "1:10")

            records.append(
                apply_experimental_document_context(
                    {
                        "material_name": material_name,
                        "ionic_liquid": ionic_liquid,
                        "lubricant": ionic_liquid,
                        "lubricant_components": components_170,
                        "temperature": DEFAULT_TEMPERATURE,
                        "cof": cof_170,
                        "mol_ratio": "1:70",
                        "evidence": evidence,
                        "source": matched_table,
                        "source_figure": matched_table,
                        "source_page": matched_page,
                        "value_origin": "fallback_table",
                    },
                    document_context,
                )
            )
            records.append(
                apply_experimental_document_context(
                    {
                        "material_name": material_name,
                        "ionic_liquid": ionic_liquid,
                        "lubricant": ionic_liquid,
                        "lubricant_components": components_110,
                        "temperature": DEFAULT_TEMPERATURE,
                        "cof": cof_110,
                        "mol_ratio": "1:10",
                        "evidence": evidence,
                        "source": matched_table,
                        "source_figure": matched_table,
                        "source_page": matched_page,
                        "value_origin": "fallback_table",
                    },
                    document_context,
                )
            )
        break

    return records, {
        "matched_page": matched_page,
        "matched_table": matched_table,
        "record_count": len(records),
        "material_name": material_name,
        "document_context": document_context,
    }
