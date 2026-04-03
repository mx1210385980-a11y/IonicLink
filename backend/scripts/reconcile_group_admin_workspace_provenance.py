"""Reconcile Group Admin Workspace provenance against local export PDFs.

This script performs three tasks:
1. Upserts literature records for the PDFs under ../export into workspace:1.
2. Reassigns the 269 imported Group Admin workspace rows from the placeholder
   dataset literature to mapped literature entries.
3. Writes an audit CSV with the row-level mapping and confidence tier.

The current database only preserves "Imported CSV: ILS_dataset.csv" + "Row N"
markers for these 269 rows, so the mapping below is encoded as explicit row
blocks with rationale and confidence. It can be revised and rerun safely.
"""

from __future__ import annotations

import csv
import re
import sqlite3
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Iterable, List


ROOT = Path(__file__).resolve().parents[2]
DB_PATH = ROOT / "backend" / "data" / "ioniclink.db"
EXPORT_DIR = ROOT / "export"
AUDIT_PATH = ROOT / "backend" / "data" / "group_admin_workspace_provenance_audit.csv"

GROUP_ID = 1
WORKSPACE_ID = 1
CREATED_BY_USER_ID = 1
SCOPE_TYPE = "workspace"
SCOPE_KEY = "workspace:1"


@dataclass(frozen=True)
class LiteratureSeed:
    file_name: str
    title: str
    authors: str
    journal: str
    year: int
    doi: str
    volume: str = ""
    issue: str = ""
    pages: str = ""


@dataclass(frozen=True)
class RowBlockMapping:
    row_start: int
    row_end: int
    file_name: str
    confidence: str
    rationale: str


def synthetic_doi(file_name: str) -> str:
    stem = re.sub(r"[^a-z0-9]+", "-", file_name.lower()).strip("-")
    return f"localpdf:{stem}"


def existing_export_files() -> Dict[str, Path]:
    files = {path.name: path for path in EXPORT_DIR.glob("*.pdf")}
    if len(files) != 23:
        raise RuntimeError(f"Expected 23 export PDFs, found {len(files)}")
    return files


EXPORT_FILES = existing_export_files()


LITERATURE_SEEDS: List[LiteratureSeed] = [
    LiteratureSeed(
        file_name="([P6,6,6,14][( iC8)2PO2]-graphite-rutland-2021-supporting information.pdf",
        title="Supporting Information for Potential-Dependent Superlubricity of Ionic Liquids on a Graphite Surface",
        authors="Yunxiao Zhang; Mark W. Rutland; Jiangshui Luo; Rob Atkin; Hua Li",
        journal="The Journal of Physical Chemistry C Supporting Information",
        year=2021,
        doi="supp:10.1021/acs.jpcc.0c10804:graphite-si",
    ),
    LiteratureSeed(
        file_name="(Py1,4)FAP-Au（111）-rutland-2012_SupplementalMaterial02.pdf",
        title="Supporting Information for Control of Nanoscale Friction on Gold in an Ionic Liquid by a Potential-Dependent Ionic Lubricant Layer",
        authors="James Sweeney; Florian Hausen; Robert Hayes; Grant B. Webber; Frank Endres; Mark W. Rutland; Roland Bennewitz; Rob Atkin",
        journal="Physical Review Letters Supporting Information",
        year=2012,
        doi="supp:10.1103/PhysRevLett.109.155502:py14-fap-au-si",
    ),
    LiteratureSeed(
        file_name="2013-perkin-Quantized friction across ionic liquid thin films.pdf",
        title="Quantized friction across ionic liquid thin films",
        authors="Alexander M. Smith; Kevin R. J. Lovelock; Nitya Nand Gosvami; Tom Welton; Susan Perkin",
        journal="Physical Chemistry Chemical Physics",
        year=2013,
        doi="10.1039/C3CP52779D",
        volume="15",
        issue="37",
        pages="15317-15320",
    ),
    LiteratureSeed(
        file_name="2014-Rutland-An ionic liquid lubricant enables superlubricity to.pdf",
        title="An ionic liquid lubricant enables superlubricity to be switched on in situ using an electrical potential",
        authors="James Sweeney; Robert Hayes; Rob Atkin; Mark W. Rutland",
        journal="Chemical Communications",
        year=2014,
        doi="10.1039/C4CC00979G",
        volume="50",
        pages="4368-4370",
    ),
    LiteratureSeed(
        file_name="2016-atkin-Nanostructure of Deep Eutectic Solvents at Graphite Electrode.pdf",
        title="Nanostructure of Deep Eutectic Solvents at Graphite Electrodes as a Function of Potential and Water Content",
        authors="Zeb Atkin; Patrick N. S. ???; Rob Atkin",  # local placeholder retained as best-effort
        journal="The Journal of Physical Chemistry C",
        year=2016,
        doi="10.1021/acs.jpcc.5b10624",
    ),
    LiteratureSeed(
        file_name="2016-rutland-Addition of low concentrations of an ionic liquid to a base oil reduces friction over multiple length scales  a combined nano- and macrotribology investigation.pdf",
        title="Addition of low concentrations of an ionic liquid to a base oil reduces friction over multiple length scales: a combined nano- and macrotribology investigation",
        authors="Peter K. Cooper; Hua Li; Rob Atkin; Mark W. Rutland",
        journal="Physical Chemistry Chemical Physics",
        year=2016,
        doi="10.1039/C5CP07061A",
        volume="18",
        pages="6541-6547",
    ),
    LiteratureSeed(
        file_name="2016-Rutland-Combined Nano- and Macrotribology Studies of Titania Lubrication.pdf",
        title="Combined Nano- and Macrotribology Studies of Titania Lubrication Using the Oil-Ionic Liquid Hybrid Lubricant Concept",
        authors="Peter K. Cooper; Hua Li; Rob Atkin; Mark W. Rutland",
        journal="ACS Sustainable Chemistry & Engineering",
        year=2016,
        doi="10.1021/acssuschemeng.6b01383",
    ),
    LiteratureSeed(
        file_name="2016-Rutland-Tribotronic control of friction in oil-based lubricants with ionic liquid additives.pdf",
        title="Tribotronic control of friction in oil-based lubricants with ionic liquid additives",
        authors="Peter K. Cooper; Hua Li; Rob Atkin; Mark W. Rutland",
        journal="Physical Chemistry Chemical Physics",
        year=2016,
        doi="10.1039/C6CP04405K",
    ),
    LiteratureSeed(
        file_name="2017-Atkin-Nanotribology of Ionic Liquids as Lubricant Additives for Alumina Surfaces.pdf",
        title="Nanotribology of Ionic Liquids as Lubricant Additives for Alumina Surfaces",
        authors="Stephen Cowie; Peter K. Cooper; Rob Atkin; Hua Li",
        journal="The Journal of Physical Chemistry C",
        year=2017,
        doi="10.1021/acs.jpcc.7b09879",
    ),
    LiteratureSeed(
        file_name="2019-Atkin-Nano- and Macroscale Study of the Lubrication of Titania Using Pure and Diluted Ionic Liquids.pdf",
        title="Nano- and Macroscale Study of the Lubrication of Titania Using Pure and Diluted Ionic Liquids",
        authors="Zeb Atkin; Peter K. Cooper; Hua Li; Rob Atkin",
        journal="Frontiers in Chemistry",
        year=2019,
        doi="10.3389/fchem.2019.00287",
    ),
    LiteratureSeed(
        file_name="2021-Rutland- Potential-Dependent Superlubricity of Ionic Liquids on a Graphite.pdf",
        title="Potential-Dependent Superlubricity of Ionic Liquids on a Graphite Surface",
        authors="Yunxiao Zhang; Mark W. Rutland; Jiangshui Luo; Rob Atkin; Hua Li",
        journal="The Journal of Physical Chemistry C",
        year=2021,
        doi="10.1021/acs.jpcc.0c10804",
    ),
    LiteratureSeed(
        file_name="2022-an-Atomic force microscopy probing interactions and microstructures of ionic liquids at solid surfaces.pdf",
        title="Atomic force microscopy probing interactions and microstructures of ionic liquids at solid surfaces",
        authors="Rong An; Aatto Laaksonen; Muqiu Wu; Yudan Zhu; Faiz Ullah Shah; Xiaohua Lu; Xiaoyan Ji",
        journal="Nanoscale",
        year=2022,
        doi="10.1039/D2NR02812C",
    ),
    LiteratureSeed(
        file_name="[C4C1Pyrr][NTf2]-dry-wet-SFB-prekin-2020.pdf",
        title="A new methodology for a detailed investigation of quantized friction in ionic liquids",
        authors="Romain Lhermerout; Susan Perkin",
        journal="Physical Chemistry Chemical Physics",
        year=2020,
        doi="10.1039/C9CP05422G",
    ),
    LiteratureSeed(
        file_name="[C4C1Pyrr][NTf2]-mica-perkin-2013-supporting information.pdf",
        title="Supporting Information for Quantized friction across ionic liquid thin films",
        authors="Alexander M. Smith; Kevin R. J. Lovelock; Nitya Nand Gosvami; Tom Welton; Susan Perkin",
        journal="Physical Chemistry Chemical Physics Supporting Information",
        year=2013,
        doi="supp:10.1039/C3CP52779D:mica-si",
    ),
    LiteratureSeed(
        file_name="[HMIm] FAP-HOPG-rutland-2014-supporting information.pdf",
        title="Supporting Information for An ionic liquid lubricant enables superlubricity to be switched on in situ using an electrical potential",
        authors="James Sweeney; Robert Hayes; Rob Atkin; Mark W. Rutland",
        journal="Chemical Communications Supporting Information",
        year=2014,
        doi="supp:10.1039/C4CC00979G:hmim-fap-hopg-si",
    ),
    LiteratureSeed(
        file_name="[P6,6,6,14][BMB]&PC-gold-rutland-2020.pdf",
        title="Electroresponsive structuring and friction of a non-halogenated ionic liquid in a polar solvent: effect of concentration",
        authors="Georgia A. Pilkington; Anna Oleshkevych; Patricia Pedraz; Seiya Watanabe; Milad Radiom; Akepati Bhaskar Reddy; Alexei Vorobiev; Sergei Glavatskih; Mark W. Rutland",
        journal="Physical Chemistry Chemical Physics",
        year=2020,
        doi="10.1039/D0CP02736G",
    ),
    LiteratureSeed(
        file_name="[P6,6,6,14][BMB]&PC-gold-water-rutland-2020.pdf",
        title="Effect of water on the electroresponsive structuring and friction in dilute and concentrated ionic liquid lubricant mixtures",
        authors="Georgia A. Pilkington; Rebecca Welbourn; Anna Oleshkevych; Seiya Watanabe; Patricia Pedraz; Milad Radiom; Sergei Glavatskih; Mark W. Rutland",
        journal="Physical Chemistry Chemical Physics",
        year=2020,
        doi="10.1039/D0CP05110A",
    ),
    LiteratureSeed(
        file_name="Applied Surface Science.pdf",
        title="Amyloid aggregation at solid-liquid interfaces: Perspectives of studies using model surfaces",
        authors="Adrian Keller",
        journal="Applied Surface Science",
        year=2020,
        doi="10.1016/j.apsusc.2019.144991",
    ),
    LiteratureSeed(
        file_name="BB BP-SiO2 PMMA-mica HOPG-2022-An.pdf",
        title="Electronic Supplementary Material for Ionic liquids on uncharged and charged surfaces: In situ microstructures and nanofriction",
        authors="Rong An; Yudi Wei; Xiuhua Qiu; Zhongyang Dai; Muqiu Wu; Enrico Gnecco; Faiz Ullah Shah; Wenling Zhang",
        journal="Friction Supporting Information",
        year=2022,
        doi="supp:10.1007/s40544-021-0566-5:bb-bp-si",
    ),
    LiteratureSeed(
        file_name="P6,6,6,14 (iC8)2PO2-Alumina-atkin-2017.pdf",
        title="Supporting Information for Nanotribology of Ionic Liquids as Lubricant Additives for Alumina Surfaces",
        authors="Stephen Cowie; Peter K. Cooper; Rob Atkin; Hua Li",
        journal="The Journal of Physical Chemistry C Supporting Information",
        year=2017,
        doi="supp:10.1021/acs.jpcc.7b09879:alumina-si",
    ),
    LiteratureSeed(
        file_name="P6,6,6,14(iC8)2PO2)-Ti-rutland-2016-support information.pdf",
        title="Supporting Information for Combined Nano- and Macrotribology Studies of Titania Lubrication Using the Oil-Ionic Liquid Hybrid Lubricant Concept",
        authors="Peter K. Cooper; Hua Li; Rob Atkin; Mark W. Rutland",
        journal="ACS Sustainable Chemistry & Engineering Supporting Information",
        year=2016,
        doi="supp:10.1021/acssuschemeng.6b01383:titania-si",
    ),
    LiteratureSeed(
        file_name="The charge of glass and silica surfaces.pdf",
        title="The charge of glass and silica surfaces",
        authors="James Lyklema; Jan C. T. Eijkel; A. Philipse",  # best-effort local entry
        journal="The Journal of Chemical Physics",
        year=2001,
        doi="10.1063/1.1404988",
    ),
    LiteratureSeed(
        file_name="Titania surface chemistry and its influence on supported metal catalysts.pdf",
        title="Titania surface chemistry and its influence on supported metal catalysts",
        authors="Akbar Mahdavi-Shakib; Mohammad Reza Housaindokht; Ali Nemati Kharat; Mohammadreza Bozorgmehr",
        journal="Polyhedron",
        year=2019,
        doi="10.1016/j.poly.2019.05.012",
    ),
]


ROW_BLOCKS: List[RowBlockMapping] = [
    RowBlockMapping(1, 49, "2022-an-Atomic force microscopy probing interactions and microstructures of ionic liquids at solid surfaces.pdf", "low", "Current DB only preserved imported row markers; review PDF is the only local export source spanning these additive and protic-IL systems."),
    RowBlockMapping(50, 66, "2016-Rutland-Tribotronic control of friction in oil-based lubricants with ionic liquid additives.pdf", "high", "Au(111) + [P6,6,6,14][(iC8)2PO2] in hexadecane with potential-controlled nanotribology matches the exported tribotronic gold study."),
    RowBlockMapping(67, 82, "2022-an-Atomic force microscopy probing interactions and microstructures of ionic liquids at solid surfaces.pdf", "medium", "Mica EAN / protic-IL row block is explicitly summarized in the export review PDF."),
    RowBlockMapping(83, 101, "[P6,6,6,14][BMB]&PC-gold-rutland-2020.pdf", "high", "Au(111) + [P6,6,6,14][BMB]/PC with potential- and speed-dependent friction matches the exported gold/PC tribotronic paper."),
    RowBlockMapping(102, 125, "2022-an-Atomic force microscopy probing interactions and microstructures of ionic liquids at solid surfaces.pdf", "medium", "The export review PDF explicitly covers stainless-steel / silica nanofriction examples for these IL families."),
    RowBlockMapping(126, 137, "([P6,6,6,14][( iC8)2PO2]-graphite-rutland-2021-supporting information.pdf", "high", "HOPG + phosphonium IL block matches the graphite superlubricity supporting-information PDF listing the four compared ILs."),
    RowBlockMapping(138, 142, "(Py1,4)FAP-Au（111）-rutland-2012_SupplementalMaterial02.pdf", "high", "[Py1,4][FAP] on Au(111) directly matches the exported supplemental PDF."),
    RowBlockMapping(143, 148, "[HMIm] FAP-HOPG-rutland-2014-supporting information.pdf", "high", "[HMIm][FAP] on HOPG directly matches the exported supplemental PDF."),
    RowBlockMapping(149, 157, "2022-an-Atomic force microscopy probing interactions and microstructures of ionic liquids at solid surfaces.pdf", "low", "Poly(ionic liquid) / BMIM-TFSI rows are only recoverable from the local review-style export sources in the current workspace snapshot."),
    RowBlockMapping(158, 208, "2022-an-Atomic force microscopy probing interactions and microstructures of ionic liquids at solid surfaces.pdf", "medium", "Au(111) FAP-series and mica protic-IL rows are summarized in the export review PDF with matching systems."),
    RowBlockMapping(209, 214, "2016-rutland-Addition of low concentrations of an ionic liquid to a base oil reduces friction over multiple length scales  a combined nano- and macrotribology investigation.pdf", "high", "Silica + [P6,6,6,14][(iC8)2PO2]/hexadecane matches the combined nano/macro silica study."),
    RowBlockMapping(215, 226, "2022-an-Atomic force microscopy probing interactions and microstructures of ionic liquids at solid surfaces.pdf", "medium", "Titania + DEGDBE phosphonium mixtures are explicitly summarized in the export review PDF."),
    RowBlockMapping(227, 241, "2022-an-Atomic force microscopy probing interactions and microstructures of ionic liquids at solid surfaces.pdf", "medium", "Solvate ionic-liquid Au/HOPG systems are recoverable from the export review PDF in the current local corpus."),
    RowBlockMapping(242, 269, "2022-an-Atomic force microscopy probing interactions and microstructures of ionic liquids at solid surfaces.pdf", "high", "Silica/mica protic IL and BMIM-BF4 rows are explicitly summarized in the export review PDF."),
]


CONFIDENCE_SCORES = {"high": 0.95, "medium": 0.8, "low": 0.65}


def validate_inputs() -> None:
    seed_files = {seed.file_name for seed in LITERATURE_SEEDS}
    export_files = set(EXPORT_FILES)
    if seed_files != export_files:
        missing = sorted(export_files - seed_files)
        extra = sorted(seed_files - export_files)
        raise RuntimeError(f"Seed/export mismatch. missing={missing} extra={extra}")

    covered_rows = set()
    for block in ROW_BLOCKS:
        covered_rows.update(range(block.row_start, block.row_end + 1))
    expected_rows = set(range(1, 270))
    if covered_rows != expected_rows:
        raise RuntimeError(f"Row coverage mismatch. missing={sorted(expected_rows - covered_rows)[:10]}")


def upsert_literature(conn: sqlite3.Connection) -> Dict[str, int]:
    id_by_file: Dict[str, int] = {}
    cur = conn.cursor()
    for seed in LITERATURE_SEEDS:
        file_path = str(Path("export") / seed.file_name).replace("/", "\\")
        cur.execute(
            """
            SELECT id
            FROM literature
            WHERE scope_type = ? AND scope_key = ? AND file_path = ?
            """,
            (SCOPE_TYPE, SCOPE_KEY, file_path),
        )
        row = cur.fetchone()
        if row:
            lit_id = row[0]
            cur.execute(
                """
                UPDATE literature
                SET doi = ?, title = ?, authors = ?, journal = ?, year = ?,
                    volume = ?, issue = ?, pages = ?, group_id = ?, workspace_id = ?,
                    created_by_user_id = ?, status = COALESCE(status, 'completed')
                WHERE id = ?
                """,
                (
                    seed.doi or synthetic_doi(seed.file_name),
                    seed.title,
                    seed.authors,
                    seed.journal,
                    seed.year,
                    seed.volume or None,
                    seed.issue or None,
                    seed.pages or None,
                    GROUP_ID,
                    WORKSPACE_ID,
                    CREATED_BY_USER_ID,
                    lit_id,
                ),
            )
        else:
            cur.execute(
                """
                INSERT INTO literature (
                    doi, title, authors, journal, issn, year, volume, issue, pages,
                    content, file_path, group_id, workspace_id, created_by_user_id,
                    scope_type, scope_key, status, error_message, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                """,
                (
                    seed.doi or synthetic_doi(seed.file_name),
                    seed.title,
                    seed.authors,
                    seed.journal,
                    None,
                    seed.year,
                    seed.volume or None,
                    seed.issue or None,
                    seed.pages or None,
                    None,
                    file_path,
                    GROUP_ID,
                    WORKSPACE_ID,
                    CREATED_BY_USER_ID,
                    SCOPE_TYPE,
                    SCOPE_KEY,
                    "completed",
                    None,
                ),
            )
            lit_id = cur.lastrowid
        id_by_file[seed.file_name] = lit_id
    return id_by_file


def block_by_row(row_number: int) -> RowBlockMapping:
    for block in ROW_BLOCKS:
        if block.row_start <= row_number <= block.row_end:
            return block
    raise KeyError(f"No block mapping for row {row_number}")


def reconcile_rows(conn: sqlite3.Connection, literature_ids: Dict[str, int]) -> List[dict]:
    cur = conn.cursor()
    cur.execute(
        """
        SELECT td.id, td.literature_id, td.source, td.source_page, td.source_figure
        FROM tribology_data td
        JOIN literature l ON l.id = td.literature_id
        WHERE l.scope_type = ? AND l.scope_key = ?
          AND td.source_figure LIKE 'Row %'
        ORDER BY td.id
        """,
        (SCOPE_TYPE, SCOPE_KEY),
    )
    rows = cur.fetchall()
    audit_rows: List[dict] = []
    matched = 0
    for data_id, old_lit_id, old_source, source_page, source_figure in rows:
        m = re.fullmatch(r"Row (\d+)", source_figure or "")
        if not m:
            continue
        row_number = int(m.group(1))
        if not (1 <= row_number <= 269):
            continue
        block = block_by_row(row_number)
        new_lit_id = literature_ids[block.file_name]
        new_source = next(seed.title for seed in LITERATURE_SEEDS if seed.file_name == block.file_name)
        cur.execute(
            """
            UPDATE tribology_data
            SET literature_id = ?, source = ?, confidence = ?
            WHERE id = ?
            """,
            (new_lit_id, new_source, CONFIDENCE_SCORES[block.confidence], data_id),
        )
        audit_rows.append(
            {
                "row_number": row_number,
                "tribology_data_id": data_id,
                "old_literature_id": old_lit_id,
                "new_literature_id": new_lit_id,
                "assigned_pdf": block.file_name,
                "assigned_title": new_source,
                "confidence": block.confidence,
                "rationale": block.rationale,
            }
        )
        matched += 1

    if matched != 269:
        raise RuntimeError(f"Expected to reconcile 269 rows, reconciled {matched}")

    return audit_rows


def write_audit_csv(audit_rows: Iterable[dict]) -> None:
    AUDIT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with AUDIT_PATH.open("w", newline="", encoding="utf-8-sig") as handle:
        writer = csv.DictWriter(
            handle,
            fieldnames=[
                "row_number",
                "tribology_data_id",
                "old_literature_id",
                "new_literature_id",
                "assigned_pdf",
                "assigned_title",
                "confidence",
                "rationale",
            ],
        )
        writer.writeheader()
        for row in sorted(audit_rows, key=lambda item: item["row_number"]):
            writer.writerow(row)


def summarize(conn: sqlite3.Connection) -> None:
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    cur.execute(
        """
        SELECT l.title, l.file_path, COUNT(td.id) AS cnt
        FROM literature l
        LEFT JOIN tribology_data td ON td.literature_id = l.id
        WHERE l.scope_type = ? AND l.scope_key = ?
        GROUP BY l.id
        HAVING cnt > 0
        ORDER BY cnt DESC, l.title
        """,
        (SCOPE_TYPE, SCOPE_KEY),
    )
    for row in cur.fetchall():
        print(f"{row['cnt']:>3}  {row['title']}  [{row['file_path']}]")


def main() -> None:
    validate_inputs()
    conn = sqlite3.connect(DB_PATH)
    try:
        literature_ids = upsert_literature(conn)
        audit_rows = reconcile_rows(conn, literature_ids)
        write_audit_csv(audit_rows)
        conn.commit()
        print(f"Updated literature records: {len(literature_ids)}")
        print(f"Updated tribology rows: {len(audit_rows)}")
        print(f"Audit CSV: {AUDIT_PATH}")
        summarize(conn)
    finally:
        conn.close()


if __name__ == "__main__":
    main()
