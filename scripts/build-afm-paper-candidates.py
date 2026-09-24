from __future__ import annotations

import argparse
import json
import os
import re
from pathlib import Path

from pypdf import PdfReader


DEFAULT_PAPERS_ROOT = Path(os.environ.get("IONICLINK_PAPER_ROOT", "../文献来源"))
DEFAULT_CURVES = Path("data/afm/afm-curves.json")
DEFAULT_CURATION = Path("data/afm/afm-curation.json")
DEFAULT_OUTPUT = Path("data/afm/afm-paper-candidates.json")
DOI_PATTERN = re.compile(r"10\.\d{4,9}/[-._;()/:A-Z0-9]+", re.IGNORECASE)
TITLE_OVERRIDES = {
    "c3cp44163f.pdf": "Adsorbed and near surface structure of ionic liquids at a solid interface",
    "Hoth_2014_J._Phys.__Condens._Matter_26_284110.pdf": "Force microscopy of layering and friction in an ionic liquid",
    "jp067420g.pdf": "Structure in Confined Room-Temperature Ionic Liquids",
    "jp200544b.pdf": "Double Layer Structure of Ionic Liquids at the Au(111) Electrode Interface: An Atomic Force Microscopy Investigation",
    "c0cp02846k.pdf": "An in situ STM/AFM and impedance spectroscopy study of the extremely pure 1-butyl-1-methylpyrrolidinium tris(pentafluoroethyl)trifluorophosphate/Au(111) interface: potential dependent solvation layers and the herringbone reconstruction",
    "c6dt04149c.pdf": "Electrodeposition of zinc nanoplates from an ionic liquid composed of 1-butylpyrrolidine and ZnCl2: electrochemical, in situ AFM and spectroscopic studies",
    "cui2016.pdf": "Influence of Water on the Electrified Ionic Liquid/Solid Interface: A Direct Observation of the Transition From a Multilayered Structure to a Double Layer Structure",
}


def natural_key(value: str) -> list[object]:
    return [int(part) if part.isdigit() else part.casefold() for part in re.split(r"(\d+)", value)]


def normalize_doi(value: str | None) -> str | None:
    if not value:
        return None
    match = DOI_PATTERN.search(value)
    if not match:
        return None
    return match.group(0).rstrip(".,;)]}").lower()


def clean_title(value: str | None) -> str | None:
    if not value:
        return None
    title = re.sub(r"\s+", " ", value).strip(" \t\r\n-_")
    if not title or title.casefold() in {"untitled", "title", "microsoft word"}:
        return None
    if len(title) < 8 or len(title) > 400:
        return None
    return title


def title_from_first_page(text: str) -> str | None:
    lines = [re.sub(r"\s+", " ", line).strip() for line in text.splitlines()]
    lines = [line for line in lines if 12 <= len(line) <= 220]
    excluded = ("downloaded from", "http://", "https://", "doi:", "copyright", "abstract")
    for line in lines[:35]:
        lower = line.casefold()
        if any(token in lower for token in excluded):
            continue
        if re.fullmatch(r"[\d\W]+", line):
            continue
        return clean_title(line)
    return None


def extract_pdf_metadata(pdf_path: Path) -> dict[str, object]:
    result: dict[str, object] = {
        "title": None,
        "doi": normalize_doi(pdf_path.stem),
        "pageCount": None,
        "metadataStatus": "unreadable",
        "metadataError": None,
    }
    try:
        reader = PdfReader(str(pdf_path))
        result["pageCount"] = len(reader.pages)
        metadata = reader.metadata or {}
        first_text = ""
        second_text = ""
        if reader.pages:
            first_text = reader.pages[0].extract_text() or ""
        if len(reader.pages) > 1:
            second_text = reader.pages[1].extract_text() or ""
        result["title"] = (
            TITLE_OVERRIDES.get(pdf_path.name)
            or clean_title(getattr(metadata, "title", None))
            or title_from_first_page(first_text)
        )
        result["doi"] = result["doi"] or normalize_doi(first_text + "\n" + second_text)
        result["metadataStatus"] = "extracted"
    except Exception as exc:  # keep the curation queue usable when one PDF is malformed
        result["metadataError"] = f"{type(exc).__name__}: {exc}"
    return result


def significant_tokens(value: str | None) -> set[str]:
    if not value:
        return set()
    stop = {"the", "and", "of", "a", "an", "at", "on", "in", "to", "for", "ionic", "liquid", "liquids", "afm"}
    return {
        token
        for token in re.findall(r"[a-z0-9]+", value.casefold())
        if len(token) >= 3 and token not in stop and not token.isdigit()
    }


def title_overlap(folder: str, title: str | None) -> float:
    folder_without_index = re.sub(r"^\s*0*\d+\s*", "", folder)
    folder_tokens = significant_tokens(folder_without_index)
    title_tokens = significant_tokens(title)
    if not folder_tokens or not title_tokens:
        return 0.0
    return len(folder_tokens & title_tokens) / len(folder_tokens)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build review-only paper candidates for AFM curve folders.")
    parser.add_argument("--curves", type=Path, default=DEFAULT_CURVES)
    parser.add_argument("--curation", type=Path, default=DEFAULT_CURATION)
    parser.add_argument(
        "--papers-root",
        type=Path,
        default=DEFAULT_PAPERS_ROOT,
    )
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    dataset = json.loads(args.curves.read_text(encoding="utf-8"))
    curation = json.loads(args.curation.read_text(encoding="utf-8"))
    source_overrides = curation.get("sourceOverrides", {})
    new_curves = [curve for curve in dataset["curves"] if curve["collection"] == "qualified-new"]
    groups: dict[tuple[str, str], list[dict[str, object]]] = {}
    for curve in new_curves:
        date = curve["source"].get("date")
        folder = curve["source"].get("folder")
        if not date or not folder:
            continue
        groups.setdefault((date, folder), []).append(curve)

    pdf_cache: dict[str, list[Path]] = {}
    metadata_cache: dict[str, dict[str, object]] = {}
    records: list[dict[str, object]] = []

    for (date, folder), curves in sorted(groups.items(), key=lambda item: (natural_key(item[0][0]), natural_key(item[0][1]))):
        date_dir = args.papers_root / date
        if date not in pdf_cache:
            pdf_cache[date] = sorted(date_dir.glob("*.pdf"), key=lambda path: natural_key(path.name)) if date_dir.exists() else []
        papers = pdf_cache[date]
        verified_pdf = next(
            (
                source_overrides.get(curve["id"], {}).get("pdfFile") or curve["source"].get("pdfFile")
                for curve in curves
                if source_overrides.get(curve["id"], {}).get("pdfFile") or curve["source"].get("pdfFile")
            ),
            None,
        )
        index_match = re.match(r"^\s*0*(\d+)", folder)
        ordinal = int(index_match.group(1)) if index_match else None
        suggested_path: Path | None = None
        status = "unmatched"
        confidence = 0.0
        reasons: list[str] = []

        if verified_pdf:
            suggested_path = date_dir / str(verified_pdf)
            status = "verified"
            confidence = 1.0
            reasons.append("Existing manual paper/image/workbook verification.")
        elif ordinal and 1 <= ordinal <= len(papers):
            suggested_path = papers[ordinal - 1]
            status = "order-suggested"
            confidence = 0.55
            reasons.append(f"Folder prefix {ordinal} mapped to one-based PDF position {ordinal} within {date}.")
        else:
            reasons.append("No in-range numeric folder prefix was available for an order suggestion.")

        metadata = None
        overlap = 0.0
        if suggested_path and suggested_path.exists():
            key = str(suggested_path)
            if key not in metadata_cache:
                metadata_cache[key] = extract_pdf_metadata(suggested_path)
            metadata = metadata_cache[key]
            overlap = title_overlap(folder, metadata.get("title") if metadata else None)
            if status == "order-suggested" and overlap >= 0.6:
                confidence = 0.85
                status = "order-and-title-suggested"
                reasons.append(f"Folder/title token overlap is {overlap:.0%}.")
            elif status == "order-suggested" and overlap > 0:
                confidence = min(0.75, confidence + overlap * 0.2)
                reasons.append(f"Folder/title token overlap is {overlap:.0%}; manual confirmation remains required.")

        records.append(
            {
                "folderKey": f"{date}/{folder}",
                "date": date,
                "folder": folder,
                "curveIds": [curve["id"] for curve in curves],
                "curveCount": len(curves),
                "status": status,
                "requiresReview": status != "verified",
                "confidence": round(confidence, 3),
                "mappingRule": "numeric-folder-prefix-to-one-based-natural-sorted-pdf-position",
                "folderOrdinal": ordinal,
                "datePdfCount": len(papers),
                "candidate": (
                    {
                        "pdfFile": suggested_path.name,
                        "pdfPath": f"external://paper-library/{date}/{suggested_path.name}",
                        "title": metadata.get("title") if metadata else None,
                        "doi": metadata.get("doi") if metadata else None,
                        "pageCount": metadata.get("pageCount") if metadata else None,
                        "metadataStatus": metadata.get("metadataStatus") if metadata else "missing",
                        "metadataError": metadata.get("metadataError") if metadata else None,
                    }
                    if suggested_path
                    else None
                ),
                "titleTokenOverlap": round(overlap, 3),
                "reasons": reasons,
            }
        )

    summary = {
        "qualifiedNewCurves": len(new_curves),
        "folderGroups": len(records),
        "verifiedFolderGroups": sum(record["status"] == "verified" for record in records),
        "suggestedFolderGroups": sum("suggested" in record["status"] for record in records),
        "unmatchedFolderGroups": sum(record["status"] == "unmatched" for record in records),
        "verifiedCurves": sum(record["curveCount"] for record in records if record["status"] == "verified"),
        "suggestedCurves": sum(record["curveCount"] for record in records if "suggested" in record["status"]),
        "unmatchedCurves": sum(record["curveCount"] for record in records if record["status"] == "unmatched"),
        "candidatesWithTitle": sum(bool(record["candidate"] and record["candidate"].get("title")) for record in records),
        "candidatesWithDoi": sum(bool(record["candidate"] and record["candidate"].get("doi")) for record in records),
    }
    payload = {
        "schemaVersion": 1,
        "scope": "Review-only AFM paper candidates. Suggested matches must never be treated as verified provenance before human confirmation.",
        "papersRoot": "external://paper-library",
        "summary": summary,
        "records": records,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False))


if __name__ == "__main__":
    main()
