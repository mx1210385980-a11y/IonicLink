"""Relocate the first 37 displayed tribology rows to their primary PDFs.

The legacy CSV import cached these rows against the 2022 AFM review and only
kept "Row N" markers.  This script reassigns the currently displayed first 37
rows (ordered by ``tribology_data.id``) to the local primary PDFs and rebuilds
field-level evidence anchors.
"""

from __future__ import annotations

import json
import re
import shutil
import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[2]
DB_PATH = ROOT / "backend" / "data" / "ioniclink.db"

PDF_2025 = Path("Reference/Extracted/2025-Potential-dependent superlubricity of stainless steel and Au(111) using a.pdf")
PDF_2017 = Path("Reference/Extracted/2017-atkin-Ionic Liquid Lubrication of Stainless Steel  Friction is Inversely Correlated with Interfacial Liquid Nanostructure.pdf")
PDF_2024 = Path("Reference/Extracted/Surface-active ionic liquids as lubricant additives to hexadecane and diethyl succinate.pdf")

TITLE_2025 = "Potential-dependent superlubricity of stainless steel and Au(111) using a water-in-surface-active ionic liquid mixture"
TITLE_2017 = "Ionic Liquid Lubrication of Stainless Steel: Friction is Inversely Correlated with Interfacial Liquid Nanostructure"
TITLE_2024 = "Surface-active ionic liquids as lubricant additives to hexadecane and diethyl succinate"

SOURCE_ANCHOR_NOTE = (
    "Value is anchored to the source figure; exact numeric text may be read "
    "from the image rather than selectable PDF text."
)


def dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def evidence(
    source_type: str,
    page: int | None,
    label: str,
    quote: str,
    bbox: list[float] | None,
    *,
    matched_text: str | None = None,
    sample_id: str | None = None,
) -> dict[str, Any]:
    return {
        "source_type": source_type,
        "page": page,
        "source_label": label,
        "quote": quote,
        "bbox": bbox,
        "sample_id": sample_id,
        "matched_text": matched_text,
    }


def entry(
    value: Any,
    ev: dict[str, Any],
    *,
    confidence: float = 0.96,
    grounding_mode: str | None = "explicit",
    grounding_note: str | None = None,
    literature_alias: str | None = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "value": str(value),
        "confidence": confidence,
        "evidence": ev,
    }
    if grounding_mode:
        payload["grounding_mode"] = grounding_mode
    if grounding_note:
        payload["grounding_note"] = grounding_note
    if literature_alias:
        payload["literature_alias"] = literature_alias
    return payload


def source_anchor_entry(value: Any, ev: dict[str, Any], *, confidence: float = 0.92) -> dict[str, Any]:
    return entry(
        value,
        ev,
        confidence=confidence,
        grounding_mode="source_anchor",
        grounding_note=SOURCE_ANCHOR_NOTE,
    )


def inferred_temperature(value: str = "298 K", *, confidence: float = 0.9) -> dict[str, Any]:
    return {
        "value": value,
        "confidence": confidence,
        "evidence": {
            "source_type": "inferred",
            "page": None,
            "source_label": "Default condition",
            "quote": "Defaulted to room-temperature condition when no explicit nanoscale friction temperature is reported.",
            "bbox": None,
            "sample_id": None,
            "matched_text": None,
        },
        "grounding_mode": "inferred",
        "grounding_note": "No explicit nanoscale-friction temperature found in the source block; stored as the default room-temperature condition.",
    }


def component_key(compound: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "_", compound.lower()).strip("_")
    return f"compound_{slug}" if slug else "lubricant_component"


def component_entry(compound: str, ev: dict[str, Any]) -> tuple[str, dict[str, Any]]:
    return component_key(compound), source_anchor_entry(compound, ev, confidence=0.93)


def parse_x_il(value: Any) -> float | None:
    match = re.search(r"-?\d+(?:\.\d+)?", str(value or ""))
    if not match:
        return None
    try:
        return float(match.group(0))
    except ValueError:
        return None


def compact_number(value: float) -> str:
    if float(value).is_integer():
        return str(int(value))
    return f"{value:.4f}".rstrip("0").rstrip(".")


def x_il_label(value: Any) -> str | None:
    parsed = parse_x_il(value)
    if parsed is None:
        return None
    return f"{compact_number(parsed)} mol% IL"


def components_json(ionic_liquid: str, compound: str | None, fraction: str | None = None) -> str | None:
    x_il = parse_x_il(fraction)
    if not compound:
        return None
    if x_il is None:
        components: list[dict[str, Any]] = [
            {"compound": ionic_liquid, "role": "ionic_liquid"},
            {"compound": compound, "role": "solvent"},
        ]
        return dumps(components)
    if x_il <= 0:
        return dumps([
            {"compound": compound, "role": "solvent", "fraction": 100, "unit": "mol%"},
        ])
    if x_il >= 100:
        return dumps([
            {"compound": ionic_liquid, "role": "ionic_liquid", "fraction": 100, "unit": "mol%"},
        ])
    components = [
        {"compound": ionic_liquid, "role": "ionic_liquid", "fraction": compact_number(x_il), "unit": "mol%"},
        {"compound": compound, "role": "solvent", "fraction": compact_number(100 - x_il), "unit": "mol%"},
    ]
    return dumps(components)


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
) -> int:
    row = conn.execute(
        """
        SELECT id FROM literature
         WHERE group_id = 1 AND scope_key = 'group_library' AND doi = ?
        """,
        (doi,),
    ).fetchone()
    if row:
        lit_id = int(row["id"])
        conn.execute(
            """
            UPDATE literature
               SET title = ?, authors = ?, journal = ?, year = ?, volume = ?,
                   pages = ?, file_path = ?, group_id = 1, created_by_user_id = 1,
                   scope_type = 'group_library', scope_key = 'group_library',
                   status = 'completed', error_message = NULL
             WHERE id = ?
            """,
            (title, authors, journal, year, volume, pages, str(file_path), lit_id),
        )
        return lit_id

    conn.execute(
        """
        INSERT INTO literature (
            doi, title, authors, journal, issn, year, volume, issue, pages,
            content, file_path, group_id, workspace_id, created_by_user_id,
            scope_type, scope_key, status, error_message, created_at
        ) VALUES (?, ?, ?, ?, NULL, ?, ?, NULL, ?, NULL, ?, 1, NULL, 1,
                  'group_library', 'group_library', 'completed', NULL, CURRENT_TIMESTAMP)
        """,
        (doi, title, authors, journal, year, volume, pages, str(file_path)),
    )
    return int(conn.execute("SELECT last_insert_rowid()").fetchone()[0])


TABLE1_BBOX = [37.6, 52.5, 551.7, 127.7]
TABLE1_TEXT = (
    "Table 1 Friction coefficient of 1.6 M [BMIm][AOT] on Au(111) at different potentials. "
    "Air OCP OCP-0.5 V OCP-1.0 V OCP+0.5 V OCP+1.0 V; "
    "mu 1.125 0.524 0.312 0.312 0.001 0.442 0.001 0.431; errors within +/-10%."
)
TABLE3_BBOX = [37.6, 533.8, 290.8, 627.8]
TABLE3_TEXT = (
    "Table 3 Friction coefficient of 1.6 M [BMIm][AOT] on stainless steel at different potentials. "
    "OCP OCP-1.0 V OCP+1.0 V; mu 3.400 3.400 0.003 0.009 0.009; errors within +/-10%."
)
AFM_2025_METHOD_BBOX = [306.6, 652.2, 560.0, 738.5]
AFM_2025_METHOD_TEXT = (
    "Friction forces were obtained by performing AFM scans with a scan angle of 90 degrees; "
    "the scan size was 500 nm, and scan rate was 6 Hz."
)
SS_2025_ROUGHNESS_BBOX = [306.6, 424.1, 560.0, 447.6]
SS_2025_ROUGHNESS_TEXT = "The roughness of the stainless steel surface is about 0.8 nm."

FIG1_2017_BBOX = [182.32, 64.0, 439.16, 312.44]
FIG1_2017_TEXT = (
    "Figure 1 lateral force versus applied normal force in six ionic liquids on a stainless steel "
    "surface; includes P6,6,6,14 TFSI and measurements over 100 nm at 6 um s-1."
)
FIG1_2017_CAPTION_BBOX = [72.0, 345.1, 322.6, 359.6]
FIG1_2017_CAPTION_TEXT = "The measurements were made on a stainless steel surface over 100 nm at 6 um s-1."
SS_2017_ROUGHNESS_BBOX = [72.0, 480.0, 543.0, 547.2]
SS_2017_ROUGHNESS_TEXT = "The roughness of the stainless steel was measured by AFM; RMS roughness was 0.89 nm."

FIG3_2024_BBOX = [61.62, 303.47, 533.66, 705.49]
FIG3_2024_TEXT = (
    "Fig. 3. Lateral force vs normal force of a silicon AFM tip on stainless steel immersed in "
    "pure [P6,6,6,14] [AOT], pure HD, pure (CH2CO2Et)2, and their solutions, and the analogous "
    "[P6,6,6,14] [DS] systems."
)
FIG3_2024_EXPLANATION_BBOX = [37.6, 563.9, 291.0, 618.7]
FIG3_2024_EXPLANATION = (
    "Fig. 3C-D present nanofriction force versus normal force; the friction coefficient for each "
    "condition is extracted from the gradient of these plots and shown in Fig. 3C-D."
)
FIG5_2024_BBOX = [304.09, 47.45, 560.13, 553.44]
FIG5_2024_TEXT = (
    "Fig. 5. Lateral force vs normal load on stainless steel immersed in pure [P6,6,6,14] [AOT] "
    "and 5 wt% [P6,6,6,14] [AOT] in (CH2CO2Et)2 at OCP, OCP-1.0 V, and OCP+1.0 V."
)
NANO_2024_SPEED_BBOX = [306.6, 51.3, 560.0, 294.4]
NANO_2024_SPEED_TEXT = "The sliding velocity at the nanoscale is 6 um s-1."
SS_2024_ROUGHNESS_BBOX = [306.6, 257.4, 560.0, 437.9]
SS_2024_ROUGHNESS_TEXT = "The surface roughness of the stainless steel sheets was 0.9 +/- 0.3 nm."


def table1_evidence() -> dict[str, Any]:
    return evidence("table", 4, "Table 1", TABLE1_TEXT, TABLE1_BBOX, matched_text=TABLE1_TEXT)


def table3_evidence() -> dict[str, Any]:
    return evidence("table", 7, "Table 3", TABLE3_TEXT, TABLE3_BBOX, matched_text=TABLE3_TEXT)


def update_2025_rows(conn: sqlite3.Connection, lit_id: int) -> int:
    table1 = table1_evidence()
    table3 = table3_evidence()
    table1_anchor = evidence("visual", 4, "Table 1", TABLE1_TEXT, TABLE1_BBOX)
    table3_anchor = evidence("visual", 7, "Table 3", TABLE3_TEXT, TABLE3_BBOX)
    speed_ev = evidence("visual", 2, "AFM methods", AFM_2025_METHOD_TEXT, AFM_2025_METHOD_BBOX, matched_text="scan rate was 6 Hz")
    rough_ev = evidence(
        "text",
        6,
        "surface roughness discussion",
        SS_2025_ROUGHNESS_TEXT,
        SS_2025_ROUGHNESS_BBOX,
        matched_text="roughness of the stainless steel surface (~0.8 nm)",
    )
    rows = {
        50: ("Au(111)", "0.524", "OCP", 4, "Table 1", table1, None),
        51: ("Au(111)", "0.312", "OCP-0.5 V", 4, "Table 1", table1, None),
        52: ("Au(111)", "0.312", "OCP-1.0 V", 4, "Table 1", table1, None),
        53: ("Au(111)", "0.442", "OCP+0.5 V", 4, "Table 1", table1, None),
        54: ("Au(111)", "0.431", "OCP+1.0 V", 4, "Table 1", table1, None),
        55: ("stainless steel", "3.4", "OCP", 7, "Table 3", table3, "0.8 nm"),
        56: ("stainless steel", "3.4", "OCP-1.0 V", 7, "Table 3", table3, "0.8 nm"),
        57: ("stainless steel", "0.009", "OCP+1.0 V", 7, "Table 3", table3, "0.8 nm"),
    }
    before = conn.total_changes
    for data_id, (material, cof, potential, source_page, source_figure, primary_ev, roughness) in rows.items():
        potential_ev = table3_anchor if source_figure == "Table 3" else table1_anchor
        field_map: dict[str, Any] = {
            "material": entry(material, primary_ev),
            "ionic_liquid": entry("[BMIM][AOT]", primary_ev, literature_alias="[BMIm][AOT]"),
            "cof": entry(cof, primary_ev),
            "mol_ratio": entry("1.6 M", primary_ev, literature_alias="1.6 M [BMIm][AOT]"),
            "speed": source_anchor_entry("6", speed_ev),
            "temperature": inferred_temperature(),
            "potential": source_anchor_entry(potential, potential_ev),
            "source_page": entry(f"Page {source_page}", primary_ev),
        }
        if roughness:
            field_map["surface_roughness"] = entry(roughness, rough_ev)
        conn.execute(
            """
            UPDATE tribology_data
               SET literature_id = ?, source = ?, source_page = ?, source_figure = ?,
                   evidence = ?, evidence_page = ?, evidence_bbox = ?, confidence = 0.96,
                   potential = ?, mol_ratio = '1.6 M', surface_roughness = ?, field_evidence_json = ?,
                   review_status = 'pending_review',
                   assembly_notes = 'Relocated from legacy Row marker to the primary 2025 J. Colloid Interface Sci. PDF.'
             WHERE id = ?
            """,
            (
                lit_id,
                TITLE_2025,
                source_page,
                source_figure,
                primary_ev["quote"],
                source_page,
                dumps(primary_ev["bbox"]),
                potential,
                roughness,
                dumps(field_map),
                data_id,
            ),
        )
    return conn.total_changes - before


def update_2017_rows(conn: sqlite3.Connection, lit_id: int) -> int:
    fig_ev = evidence("figure", 10, "Fig. 1", FIG1_2017_TEXT, FIG1_2017_BBOX)
    speed_ev = evidence("visual", 10, "Fig. 1 caption", FIG1_2017_CAPTION_TEXT, FIG1_2017_CAPTION_BBOX, matched_text="6 um s-1")
    rough_ev = evidence("text", 6, "substrate roughness", SS_2017_ROUGHNESS_TEXT, SS_2017_ROUGHNESS_BBOX, matched_text="RMS roughness was 0.89 nm")
    rows = conn.execute(
        """
        SELECT id, cof_raw, load_value, speed_value
          FROM tribology_data
         WHERE id BETWEEN 70 AND 81
         ORDER BY id
        """
    ).fetchall()
    before = conn.total_changes
    for row in rows:
        data_id = int(row["id"])
        load_value = str(row["load_value"] or row["speed_value"] or "").strip()
        cof = str(row["cof_raw"] or "").strip()
        field_map = {
            "material": source_anchor_entry("stainless steel", fig_ev),
            "ionic_liquid": source_anchor_entry("[P6,6,6,14][TFSI]", fig_ev, confidence=0.9),
            "cof": source_anchor_entry(cof, fig_ev, confidence=0.9),
            "load": source_anchor_entry(load_value, fig_ev, confidence=0.9),
            "speed": source_anchor_entry("6", speed_ev),
            "temperature": inferred_temperature(),
            "surface_roughness": entry("0.89 nm", rough_ev),
            "source_page": source_anchor_entry("Page 10", fig_ev, confidence=0.9),
        }
        conn.execute(
            """
            UPDATE tribology_data
               SET literature_id = ?, source = ?, source_page = 10, source_figure = 'Fig. 1',
                   evidence = ?, evidence_page = 10, evidence_bbox = ?, confidence = 0.92,
                   load_value = ?, load_raw = ?, speed_value = '6', potential = NULL,
                   mol_ratio = NULL, surface_roughness = '0.89 nm', field_evidence_json = ?,
                   review_status = 'pending_review',
                   assembly_notes = 'Relocated from legacy Row marker to the primary 2017 stainless-steel ionic-liquid lubrication PDF; legacy speed values were moved to normal load.'
             WHERE id = ?
            """,
            (
                lit_id,
                TITLE_2017,
                FIG1_2017_TEXT,
                dumps(FIG1_2017_BBOX),
                load_value,
                f"{load_value} nN" if load_value else None,
                dumps(field_map),
                data_id,
            ),
        )
    return conn.total_changes - before


SURFACE_2024_COMPOUNDS: dict[int, str | None] = {
    82: "(CH2CO2Et)2",
    83: "hexadecane",
    84: "hexadecane",
    85: "hexadecane",
    86: "(CH2CO2Et)2",
    87: "(CH2CO2Et)2",
    88: "(CH2CO2Et)2",
    89: "(CH2CO2Et)2",
    90: "(CH2CO2Et)2",
    91: None,
    92: None,
    93: None,
    94: None,
    95: "hexadecane",
    96: "(CH2CO2Et)2",
    97: "(CH2CO2Et)2",
    98: None,
}

SURFACE_2024_FIG5_POTENTIALS = {
    88: "OCP",
    89: "OCP-1.0 V",
    90: "OCP+1.0 V",
    91: "OCP",
    92: "OCP-1.0 V",
    93: "OCP+1.0 V",
}


def update_2024_rows(conn: sqlite3.Connection, lit_id: int) -> int:
    fig3_ev = evidence("figure", 6, "Fig. 3", FIG3_2024_TEXT, FIG3_2024_BBOX)
    fig5_ev = evidence("figure", 8, "Fig. 5", FIG5_2024_TEXT, FIG5_2024_BBOX)
    fig3_text_ev = evidence("text", 7, "Fig. 3 discussion", FIG3_2024_EXPLANATION, FIG3_2024_EXPLANATION_BBOX, matched_text="friction coefficient")
    speed_ev = evidence("visual", 6, "nanoscale sliding velocity", NANO_2024_SPEED_TEXT, NANO_2024_SPEED_BBOX, matched_text="6 um s-1")
    rough_ev = evidence("text", 3, "substrate roughness", SS_2024_ROUGHNESS_TEXT, SS_2024_ROUGHNESS_BBOX, matched_text="0.9 +/- 0.3 nm")
    rows = conn.execute(
        """
        SELECT id, lubricant, cof_raw, mol_ratio, potential
          FROM tribology_data
         WHERE id BETWEEN 82 AND 98
         ORDER BY id
        """
    ).fetchall()
    before = conn.total_changes
    for row in rows:
        data_id = int(row["id"])
        lubricant = str(row["lubricant"] or "").strip()
        cof = str(row["cof_raw"] or "").strip()
        compound = SURFACE_2024_COMPOUNDS.get(data_id)
        is_fig5 = data_id in SURFACE_2024_FIG5_POTENTIALS
        source_page = 8 if is_fig5 else 6
        source_figure = "Fig. 5" if is_fig5 else "Fig. 3"
        primary_ev = fig5_ev if is_fig5 else fig3_ev
        potential = SURFACE_2024_FIG5_POTENTIALS.get(data_id)
        mol_ratio_label = x_il_label(row["mol_ratio"])
        field_map: dict[str, Any] = {
            "material": source_anchor_entry("stainless steel", primary_ev),
            "ionic_liquid": source_anchor_entry(lubricant, primary_ev),
            "cof": source_anchor_entry(cof, primary_ev),
            "speed": source_anchor_entry("6", speed_ev),
            "temperature": inferred_temperature(),
            "surface_roughness": entry("0.9 nm", rough_ev),
            "source_page": source_anchor_entry(f"Page {source_page}", primary_ev),
        }
        if not is_fig5:
            field_map["source"] = source_anchor_entry("Fig. 3", fig3_text_ev)
        if potential:
            field_map["potential"] = source_anchor_entry(potential, primary_ev)
        if compound:
            key, comp_entry = component_entry(compound, primary_ev)
            field_map[key] = comp_entry
        if mol_ratio_label:
            field_map["mol_ratio"] = source_anchor_entry(mol_ratio_label, primary_ev)
        conn.execute(
            """
            UPDATE tribology_data
               SET literature_id = ?, source = ?, source_page = ?, source_figure = ?,
                   evidence = ?, evidence_page = ?, evidence_bbox = ?, confidence = 0.93,
                   potential = ?, mol_ratio = ?, surface_roughness = '0.9 nm',
                   lubricant_components_json = ?, field_evidence_json = ?,
                   review_status = 'pending_review',
                   assembly_notes = 'Relocated from legacy Row marker to the primary 2024 surface-active ionic-liquid additives PDF.'
             WHERE id = ?
            """,
            (
                lit_id,
                TITLE_2024,
                source_page,
                source_figure,
                primary_ev["quote"],
                source_page,
                dumps(primary_ev["bbox"]),
                potential,
                mol_ratio_label,
                components_json(lubricant, compound, str(row["mol_ratio"]) if compound and row["mol_ratio"] not in (None, "") else None),
                dumps(field_map),
                data_id,
            ),
        )
    return conn.total_changes - before


def main() -> None:
    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    backup_path = DB_PATH.with_name(f"{DB_PATH.stem}.before-first-37-source-relocate-{timestamp}{DB_PATH.suffix}")
    shutil.copy2(DB_PATH, backup_path)

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        with conn:
            lit_2025 = upsert_literature(
                conn,
                doi="10.1016/j.jcis.2024.08.187",
                title=TITLE_2025,
                authors="Yunxiao Zhang; Hua Li; Jianan Wang; Debbie S. Silvester; Gregory G. Warr; Rob Atkin",
                journal="Journal of Colloid and Interface Science",
                year=2025,
                volume="678",
                pages="355-364",
                file_path=PDF_2025,
            )
            lit_2024 = upsert_literature(
                conn,
                doi="10.1016/j.colsurfa.2024.134669",
                title=TITLE_2024,
                authors="Joshua J. Buzolic; Hua Li; Zachary M. Aman; Debbie S. Silvester; Rob Atkin",
                journal="Colloids and Surfaces A: Physicochemical and Engineering Aspects",
                year=2024,
                volume="699",
                pages="134669",
                file_path=PDF_2024,
            )
            row = conn.execute(
                "SELECT id FROM literature WHERE group_id = 1 AND scope_key = 'group_library' AND doi = ?",
                ("10.1021/acssuschemeng.7b03262",),
            ).fetchone()
            if not row:
                raise RuntimeError("Could not find the 2017 stainless-steel lubrication literature row")
            lit_2017 = int(row["id"])
            conn.execute(
                """
                UPDATE literature
                   SET title = ?, file_path = ?, status = 'completed', error_message = NULL
                 WHERE id = ?
                """,
                (TITLE_2017, str(PDF_2017), lit_2017),
            )

            count_2025 = update_2025_rows(conn, lit_2025)
            count_2017 = update_2017_rows(conn, lit_2017)
            count_2024 = update_2024_rows(conn, lit_2024)

    finally:
        conn.close()

    print(f"backup: {backup_path}")
    print(f"2025_rows_updated: {count_2025}")
    print(f"2017_rows_updated: {count_2017}")
    print(f"2024_rows_updated: {count_2024}")


if __name__ == "__main__":
    main()
