from __future__ import annotations

import re
from pathlib import Path
from typing import Any, Optional

import fitz

from services.doi_service import DOIService

DEFAULT_TEMPERATURE = "298.15 K"


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


def extract_table_fallback_records(content: str, pdf_path: Optional[str] = None) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    material_name = _infer_material_name(content)
    page_texts = _page_texts_from_pdf(pdf_path, content)
    records: list[dict[str, Any]] = []
    matched_page: int | None = None
    matched_table: str | None = None

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
                }
            )
            records.append(
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
                }
            )
        break

    return records, {
        "matched_page": matched_page,
        "matched_table": matched_table,
        "record_count": len(records),
        "material_name": material_name,
    }
