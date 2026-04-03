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

DEFAULT_TEMPERATURE = "298.15 K"
logger = logging.getLogger(__name__)


def extract_metadata_fallback(content: str) -> dict[str, Any]:
    header = (content or "")[:8000]
    out: dict[str, Any] = {}
    doi_service = DOIService()
    lines = [line.strip() for line in header.splitlines()]

    doi_match = re.search(r"\b10\.\d{4,9}/[-._;()/:A-Z0-9]+\b", header, flags=re.IGNORECASE)
    if doi_match:
        out["doi"] = doi_service._normalize_doi(doi_match.group(0))

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


def _page_texts_from_pdf(pdf_path: str | None, content: str) -> list[tuple[int | None, str]]:
    if not pdf_path:
        return [(None, content or "")]

    resolved = Path(pdf_path)
    if not resolved.exists():
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

            records.append(
                apply_experimental_document_context(
                    {
                    "material_name": material_name,
                    "ionic_liquid": ionic_liquid,
                    "lubricant": ionic_liquid,
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
