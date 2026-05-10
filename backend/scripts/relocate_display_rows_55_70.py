"""Relocate displayed tribology rows 55-70 to their primary source PDFs."""

from __future__ import annotations

import json
import shutil
import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[2]
DB_PATH = ROOT / "backend" / "data" / "ioniclink.db"

PDF_2016_TEMP = Path("Reference/Extracted/2016-Atkin-Is the boundary layer of an ionic liquid equally.pdf")
PDF_2020_HBOND = Path("Reference/Extracted/2020-atkin-Effect of Hydrogen Bonding between Ions of Like Charge on the.pdf")

TITLE_2016_TEMP = "Is the boundary layer of an ionic liquid equally lubricating at higher temperature?"
TITLE_2020_HBOND = "Effect of Hydrogen Bonding between Ions of Like Charge on the Boundary Layer Friction of Hydroxy-Functionalized Ionic Liquids"


def dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def evidence(source_type: str, page: int, source_label: str, quote: str, bbox: list[float], matched_text: str | None = None) -> dict[str, Any]:
    return {
        "source_type": source_type,
        "page": page,
        "source_label": source_label,
        "quote": quote,
        "bbox": bbox,
        "sample_id": None,
        "matched_text": matched_text,
    }


def entry(value: Any, ev: dict[str, Any], confidence: float = 0.94, note: str | None = None) -> dict[str, Any]:
    payload = {
        "value": value,
        "confidence": confidence,
        "evidence": ev,
        "grounding_mode": "source_anchor",
    }
    if note:
        payload["grounding_note"] = note
    return payload


def upsert_literature(
    conn: sqlite3.Connection,
    *,
    doi: str,
    title: str,
    authors: str,
    journal: str,
    year: int,
    file_path: Path,
    volume: str | None = None,
    pages: str | None = None,
    prefer_existing_title: str | None = None,
) -> int:
    row = conn.execute(
        """
        SELECT id FROM literature
         WHERE group_id = 1 AND scope_key = 'group_library' AND doi = ?
        """,
        (doi,),
    ).fetchone()
    if not row and prefer_existing_title:
        row = conn.execute(
            """
            SELECT id FROM literature
             WHERE group_id = 1 AND scope_key = 'group_library' AND title LIKE ?
             ORDER BY id
             LIMIT 1
            """,
            (f"%{prefer_existing_title}%",),
        ).fetchone()

    if row:
        lit_id = int(row["id"])
        conn.execute(
            """
            UPDATE literature
               SET doi = ?, title = ?, authors = ?, journal = ?, year = ?, volume = ?,
                   pages = ?, file_path = ?, group_id = 1, created_by_user_id = 1,
                   scope_type = 'group_library', scope_key = 'group_library',
                   status = COALESCE(NULLIF(status, ''), 'completed')
             WHERE id = ?
            """,
            (doi, title, authors, journal, year, volume, pages, str(file_path), lit_id),
        )
        return lit_id

    now = datetime.now().isoformat(timespec="seconds")
    cur = conn.execute(
        """
        INSERT INTO literature (
            doi, title, authors, journal, year, volume, pages, file_path,
            group_id, created_by_user_id, scope_type, scope_key, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 1, 'group_library', 'group_library', 'completed', ?)
        """,
        (doi, title, authors, journal, year, volume, pages, str(file_path), now),
    )
    return int(cur.lastrowid)


TEMP_2016_ROWS = {
    # data id: (speed in um/s, corrected temperature, extracted mu)
    116: ("10", "298 K", "0.31"),
    117: ("10", "323 K", "0.303"),
    118: ("10", "353 K", "0.258"),
    119: ("20", "298 K", "0.281"),
    120: ("20", "323 K", "0.32"),
    121: ("20", "353 K", "0.309"),
    122: ("30", "298 K", "0.304"),
    123: ("30", "323 K", "0.369"),
    124: ("30", "353 K", "0.352"),
}

HBOND_2020_ROWS = {
    # data id: (lubricant, cation, anion, mu, table column/regime)
    125: ("[C5Py][NTf2]", "C5Py", "NTf2", "0.25", "boundary regime"),
    126: ("[HOC4Py][NTf2]", "HOC4Py", "NTf2", "0.15", "high force"),
    127: ("[HOC3Py][NTf2]", "HOC3Py", "NTf2", "0.18", "high force"),
    128: ("[HOC4MPip][NTf2]", "HOC4MPip", "NTf2", "0.17", "high force"),
    129: ("[HOC3MPip][NTf2]", "HOC3MPip", "NTf2", "0.21", "high force"),
    130: ("[HOC4Py][OMs]", "HOC4Py", "OMs", "0.24", "boundary regime"),
    131: ("[HOC3Py][OMs]", "HOC3Py", "OMs", "0.26", "boundary regime"),
}


def update_2016_temperature_rows(conn: sqlite3.Connection, lit_id: int) -> int:
    fig4_ev = evidence(
        "figure",
        6,
        "Fig. 4",
        "Fig. 4 AFM friction loops were collected with the mica-EAN-silica system at room temperature, 50 °C, and 80 °C for scan rates 1, 2, and 3 Hz.",
        [70.98, 49.83, 263.67, 396.79],
        matched_text="Fig. 4",
    )
    method_ev = evidence(
        "text",
        3,
        "friction measurement conditions",
        "For friction, the slow scan axis was disabled and a scan size of 5 μm ... with five different scan rates (0.5, 1, 2, 3, and 4 Hz) was used.",
        [303.31, 300.0, 560.0, 610.0],
        matched_text="scan size of 5 μm",
    )
    mica_ev = evidence(
        "text",
        3,
        "mica substrate preparation",
        "The mica surfaces used were freshly cleaved immediately prior to experiments.",
        [303.31, 230.0, 560.0, 300.0],
        matched_text="mica surfaces",
    )
    before = conn.total_changes
    for data_id, (speed, temperature, cof) in TEMP_2016_ROWS.items():
        field_map = {
            "material": entry("mica", mica_ev),
            "ionic_liquid": entry("[EA][NO3]", fig4_ev),
            "cof": entry(cof, fig4_ev),
            "speed": entry(speed, fig4_ev, note="Stored as line speed in μm/s; Fig. 4 panels correspond to scan rates 1, 2, and 3 Hz over a 5 μm scan."),
            "temperature": entry(temperature, fig4_ev),
            "source": entry("Fig. 4", fig4_ev),
            "source_page": entry("Page 6", fig4_ev),
            "surface_roughness": entry("atomically smooth mica", mica_ev),
            "method": entry("AFM colloidal probe", method_ev),
        }
        conn.execute(
            """
            UPDATE tribology_data
               SET literature_id = ?, source = ?, source_page = 6, source_figure = 'Fig. 4',
                   evidence = ?, evidence_page = 6, evidence_bbox = ?, confidence = 0.94,
                   material_name = 'mica', lubricant = '[EA][NO3]', cation = 'EA', anion = 'NO3',
                   cof_raw = ?, cof_value = ?, speed_value = ?, temperature = ?, potential = NULL,
                   mol_ratio = NULL, surface_roughness = 'atomically smooth mica',
                   field_evidence_json = ?, review_status = 'pending_review',
                   assembly_notes = 'Relocated from legacy ILS_dataset row marker to the primary 2016 temperature-dependent EAN nanotribology PDF.'
             WHERE id = ?
            """,
            (
                lit_id,
                TITLE_2016_TEMP,
                fig4_ev["quote"],
                dumps(fig4_ev["bbox"]),
                cof,
                float(cof),
                speed,
                temperature,
                dumps(field_map),
                data_id,
            ),
        )
    return conn.total_changes - before


def update_2020_hbond_rows(conn: sqlite3.Connection, lit_id: int) -> int:
    table_ev = evidence(
        "table",
        13,
        "Table 2",
        "Table 2. Friction coefficients (μ) of [C5Py][NTf2] and [HOCnPy][NTf2] ILs.",
        [48.0, 232.0, 555.0, 340.0],
        matched_text="Table 2",
    )
    method_ev = evidence(
        "text",
        7,
        "AFM method",
        "Lateral (frictional) force measurements were performed using a Veeco Nanoscope IV AFM in contact mode with an EV scanner.",
        [55.0, 575.0, 555.0, 710.0],
        matched_text="Lateral (frictional) force measurements",
    )
    before = conn.total_changes
    for data_id, (lubricant, cation, anion, cof, regime) in HBOND_2020_ROWS.items():
        field_map = {
            "material": entry("mica", table_ev),
            "ionic_liquid": entry(lubricant, table_ev),
            "cof": entry(cof, table_ev),
            "regime": entry(regime, table_ev),
            "temperature": entry("293 K", method_ev, confidence=0.86, note="Stored as room-temperature AFM condition for this study."),
            "source": entry("Table 2", table_ev),
            "source_page": entry("Page 13", table_ev),
            "method": entry("AFM contact mode", method_ev),
        }
        conn.execute(
            """
            UPDATE tribology_data
               SET literature_id = ?, source = ?, source_page = 13, source_figure = 'Table 2',
                   evidence = ?, evidence_page = 13, evidence_bbox = ?, confidence = 0.95,
                   material_name = 'mica', lubricant = ?, cation = ?, anion = ?,
                   cof_raw = ?, cof_value = ?, speed_value = NULL, potential = NULL, mol_ratio = NULL,
                   temperature = '293 K', regime = ?, surface_roughness = 'atomically smooth mica',
                   field_evidence_json = ?, review_status = 'pending_review',
                   assembly_notes = 'Relocated from legacy ILS_dataset row marker to the primary 2020 hydroxy-functionalized ionic-liquid boundary-friction PDF.'
             WHERE id = ?
            """,
            (
                lit_id,
                TITLE_2020_HBOND,
                table_ev["quote"],
                dumps(table_ev["bbox"]),
                lubricant,
                cation,
                anion,
                cof,
                float(cof),
                regime,
                dumps(field_map),
                data_id,
            ),
        )
    return conn.total_changes - before


def main() -> None:
    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    backup = DB_PATH.with_name(f"ioniclink.before-display-55-70-relocate-{timestamp}.db")
    shutil.copy2(DB_PATH, backup)

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        lit_2016 = upsert_literature(
            conn,
            doi="10.1039/C5CP05837F",
            title=TITLE_2016_TEMP,
            authors="Nicklas Hjalmarsson; Rob Atkin; Mark W. Rutland",
            journal="Physical Chemistry Chemical Physics",
            year=2016,
            volume="18",
            pages="9232-9239",
            file_path=PDF_2016_TEMP,
            prefer_existing_title="Is the boundary layer",
        )
        lit_2020 = upsert_literature(
            conn,
            doi="10.1021/acs.jpclett.0c00689",
            title=TITLE_2020_HBOND,
            authors="Hua Li; Thomas Niemann; Ralf Ludwig; Rob Atkin",
            journal="Journal of Physical Chemistry Letters",
            year=2020,
            volume="11",
            pages=None,
            file_path=PDF_2020_HBOND,
            prefer_existing_title="Effect of Hydrogen Bonding between Ions of Like Charge",
        )
        changed_2016 = update_2016_temperature_rows(conn, lit_2016)
        changed_2020 = update_2020_hbond_rows(conn, lit_2020)
        conn.commit()
    finally:
        conn.close()

    print(f"backup: {backup}")
    print(f"2016_temperature_literature_id: {lit_2016}")
    print(f"2020_hbond_literature_id: {lit_2020}")
    print(f"2016_rows_updated: {changed_2016}")
    print(f"2020_rows_updated: {changed_2020}")


if __name__ == "__main__":
    main()
