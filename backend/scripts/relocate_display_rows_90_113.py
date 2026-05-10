"""Relocate displayed tribology rows 90-113 to their primary PDFs."""

from __future__ import annotations

import json
import shutil
import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[2]
DB_PATH = ROOT / "backend" / "data" / "ioniclink.db"

PDF_STAINLESS_2017 = Path("Reference/Extracted/2017-atkin-Ionic Liquid Lubrication of Stainless Steel  Friction is Inversely Correlated with Interfacial Liquid Nanostructure.pdf")
PDF_DOP_2011 = Path("Reference/Extracted/Tribological Properties of Self-Assembled Monolayers of Catecholic.pdf")
PDF_EAN_2012 = Path("Reference/Extracted/2012-atkin-Ionic Liquid Nanotribology Stiction Suppression and SurfaceInduced Shear Thinning.pdf")
PDF_DICATION_2019 = Path("Reference/Extracted/2019-Interfacial structure and boundary lubrication of a dicationic ionic liquid.pdf")
PDF_ROUGHNESS_2020 = Path("Reference/Extracted/Adv Materials Inter - 2020 - Nalam - Effects of Nanoscale Roughness on the Lubricious Behavior of an Ionic Liquid.pdf")

TITLE_STAINLESS_2017 = "Ionic Liquid Lubrication of Stainless Steel: Friction is Inversely Correlated with Interfacial Liquid Nanostructure"
TITLE_DOP_2011 = "Tribological Properties of Self-Assembled Monolayers of Catecholic Imidazolium and the Spin-Coated Films of Ionic Liquids"
TITLE_EAN_2012 = "Ionic Liquid Nanotribology: Stiction Suppression and Surface Induced Shear Thinning"
TITLE_DICATION_2019 = "Interfacial Structure and Boundary Lubrication of a Dicationic Ionic Liquid"
TITLE_ROUGHNESS_2020 = "Effects of Nanoscale Roughness on the Lubricious Behavior of an Ionic Liquid"


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
) -> dict[str, Any]:
    return {
        "source_type": source_type,
        "page": page,
        "source_label": label,
        "quote": quote,
        "bbox": bbox,
        "sample_id": None,
        "matched_text": matched_text,
    }


def entry(
    value: Any,
    ev: dict[str, Any],
    *,
    confidence: float = 0.94,
    grounding_mode: str = "source_anchor",
    grounding_note: str | None = None,
    literature_alias: str | None = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "value": str(value),
        "confidence": confidence,
        "evidence": ev,
        "grounding_mode": grounding_mode,
    }
    if grounding_note:
        payload["grounding_note"] = grounding_note
    if literature_alias:
        payload["literature_alias"] = literature_alias
    return payload


def inferred_room_temperature(value: str = "298 K") -> dict[str, Any]:
    return {
        "value": value,
        "confidence": 0.86,
        "evidence": {
            "source_type": "inferred",
            "page": None,
            "source_label": "room-temperature condition",
            "quote": "Stored as a room-temperature condition when the exact friction table/figure does not provide a separate temperature field.",
            "bbox": None,
            "sample_id": None,
            "matched_text": None,
        },
        "grounding_mode": "inferred",
        "grounding_note": "No separate per-row temperature is reported in the anchored friction source.",
    }


def component_key(compound: str) -> str:
    slug = "".join(ch.lower() if ch.isalnum() else "_" for ch in compound).strip("_")
    while "__" in slug:
        slug = slug.replace("__", "_")
    return f"compound_{slug or 'component'}"


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
               SET doi = ?, title = ?, authors = ?, journal = ?, year = ?,
                   volume = ?, pages = ?, file_path = ?, group_id = 1,
                   created_by_user_id = 1, scope_type = 'group_library',
                   scope_key = 'group_library', status = 'completed',
                   error_message = NULL
             WHERE id = ?
            """,
            (doi, title, authors, journal, year, volume, pages, str(file_path), lit_id),
        )
        return lit_id

    cur = conn.execute(
        """
        INSERT INTO literature (
            doi, title, authors, journal, year, volume, pages, file_path,
            group_id, created_by_user_id, scope_type, scope_key, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 1, 'group_library', 'group_library', 'completed', ?)
        """,
        (doi, title, authors, journal, year, volume, pages, str(file_path), datetime.now().isoformat(timespec="seconds")),
    )
    return int(cur.lastrowid)


def update_stainless_2017(conn: sqlite3.Connection, lit_id: int) -> int:
    table_ev = evidence(
        "table",
        10,
        "Table 2",
        "Table 2 gives friction coefficients for Air, HMIM FAP, EMIM FAP, P4,4,4,1 TFSI, HMIM I, P6,6,6,14 (iC8)2PO2, and P6,6,6,14 TFSI.",
        [72.0, 385.3, 360.0, 560.0],
        matched_text="Table 2. Friction coefficient",
    )
    method_ev = evidence(
        "text",
        8,
        "friction method",
        "Friction measurements were performed using a scan size of 100 nm at a scan speed of 6.5 µm s-1.",
        [72.0, 96.0, 543.0, 201.0],
        matched_text="scan speed of 6.5 µm s-1",
    )
    rough_ev = evidence(
        "text",
        6,
        "substrate roughness",
        "For a 500 nm x 500 nm scan, the RMS roughness was 0.89 nm.",
        [72.0, 560.0, 543.0, 610.0],
        matched_text="RMS roughness was 0.89 nm",
    )
    rows = {
        151: ("[HMIM][FAP]", "HMIM", "FAP", "1.16", None),
        152: ("[EMIM][FAP]", "EMIM", "FAP", "0.84", None),
        153: ("[P4,4,4,1][TFSI]", "P4,4,4,1", "TFSI", "0.93", None),
        154: ("[HMIM][I]", "HMIM", "I", "0.46", None),
        155: ("[P6,6,6,14][i(C8)2PO2]", "P6,6,6,14", "i(C8)2PO2", "0.40", None),
        156: ("[P6,6,6,14][TFSI]", "P6,6,6,14", "TFSI", "0.39", None),
        157: ("air", None, None, "0.88", "Air control in Table 2; this is not a pure ionic-liquid row."),
    }
    before = conn.total_changes
    for data_id, (lubricant, cation, anion, cof, note) in rows.items():
        field_map = {
            "material": entry("stainless steel", table_ev),
            "cof": entry(cof, table_ev),
            "speed": entry("6.5", method_ev, confidence=0.9),
            "temperature": inferred_room_temperature(),
            "surface_roughness": entry("0.89 nm", rough_ev),
            "source": entry("Table 2", table_ev),
            "source_page": entry("Page 10", table_ev),
        }
        if cation and anion:
            field_map["ionic_liquid"] = entry(lubricant, table_ev)
        else:
            field_map[component_key("air")] = entry("air", table_ev, grounding_note=note)
        conn.execute(
            """
            UPDATE tribology_data
               SET literature_id = ?, source = ?, source_page = 10, source_figure = 'Table 2',
                   evidence = ?, evidence_page = 10, evidence_bbox = ?, confidence = 0.96,
                   material_name = 'stainless steel', substrate_material = 'stainless steel',
                   lubricant = ?, cation = ?, anion = ?, cof_raw = ?, cof_value = ?,
                   speed_value = '6.5', temperature = '298 K', potential = NULL, mol_ratio = NULL,
                   surface_roughness = '0.89 nm', substrate_roughness = '0.89 nm',
                   lubricant_components_json = NULL, field_evidence_json = ?,
                   review_status = 'pending_review',
                   assembly_notes = 'Relocated displayed rows 90-96 from the 2022 review cache to the primary 2017 stainless-steel lubrication paper.'
             WHERE id = ?
            """,
            (
                lit_id,
                TITLE_STAINLESS_2017,
                table_ev["quote"],
                dumps(table_ev["bbox"]),
                lubricant,
                cation,
                anion,
                cof,
                float(cof),
                dumps(field_map),
                data_id,
            ),
        )
    return conn.total_changes - before


def update_dop_2011(conn: sqlite3.Connection, lit_id: int) -> int:
    fig_ev = evidence(
        "text",
        5,
        "Fig. 6 discussion",
        "Si substrates possess a highest friction force of 3.77FN + 249.34. The friction force decreased to 3.38FN + 195.74 after the DOP-Cl IL was assembled; BF4 and NTf2 are 2.85FN + 199.47 and 2.69FN + 139.96.",
        [52.8, 615.3, 291.9, 747.5],
        matched_text="3.77FN + 249.34",
    )
    method_ev = evidence(
        "text",
        2,
        "AFM friction method",
        "The friction force was measured under a constant load using a 90 degree scan angle. The scan length was 1 µm, and the scan frequency was 1 Hz.",
        [52.8, 555.0, 555.0, 710.0],
        matched_text="scan length was 1 µm",
    )
    rows = {
        158: ("[DOP-IL][Cl]", "[DOP-IL]+", "Cl", "3.38", "DOP-Cl SAM"),
        159: ("[DOP-IL][BF4]", "[DOP-IL]+", "BF4", "2.85", "DOP-BF4 SAM"),
        160: ("[DOP-IL][NTf2]", "[DOP-IL]+", "NTf2", "2.69", "DOP-NTf2 SAM"),
        161: ("bare silicon substrate", None, None, "3.77", "Bare Si substrate control"),
    }
    before = conn.total_changes
    for data_id, (lubricant, cation, anion, cof, label) in rows.items():
        field_map = {
            "material": entry("silicon substrate", fig_ev, literature_alias="Si substrate"),
            "cof": entry(cof, fig_ev),
            "speed": entry("2", method_ev, confidence=0.86, grounding_note="Stored as an approximate line speed from a 1 µm scan at 1 Hz."),
            "temperature": inferred_room_temperature(),
            "source": entry("Fig. 6", fig_ev),
            "source_page": entry("Page 5", fig_ev),
        }
        if cation and anion:
            field_map["ionic_liquid"] = entry(lubricant, fig_ev, literature_alias=label)
        else:
            field_map[component_key("bare silicon substrate")] = entry("bare silicon substrate", fig_ev, literature_alias=label)
        conn.execute(
            """
            UPDATE tribology_data
               SET literature_id = ?, source = ?, source_page = 5, source_figure = 'Fig. 6',
                   evidence = ?, evidence_page = 5, evidence_bbox = ?, confidence = 0.95,
                   material_name = 'silicon substrate', substrate_material = 'silicon substrate',
                   lubricant = ?, cation = ?, anion = ?, cof_raw = ?, cof_value = ?,
                   speed_value = '2', temperature = '298 K', potential = NULL, mol_ratio = NULL,
                   surface_roughness = NULL, substrate_roughness = NULL, lubricant_components_json = NULL,
                   field_evidence_json = ?, review_status = 'pending_review',
                   assembly_notes = 'Relocated displayed rows 97-100 from the 2022 review cache to the primary 2011 catecholic imidazolium SAM paper.'
             WHERE id = ?
            """,
            (
                lit_id,
                TITLE_DOP_2011,
                fig_ev["quote"],
                dumps(fig_ev["bbox"]),
                lubricant,
                cation,
                anion,
                cof,
                float(cof),
                dumps(field_map),
                data_id,
            ),
        )
    return conn.total_changes - before


def update_ean_2012(conn: sqlite3.Connection, lit_id: int) -> int:
    fig_ev = evidence(
        "figure",
        5,
        "Fig. 3 / Fig. 4",
        "Figure 3 gives friction coefficients for the four probe-surface combinations in air and EAN; Figure 4 compares friction coefficient with combined RMS roughness.",
        [60.5, 214.7, 564.5, 550.8],
        matched_text="Figure 3",
    )
    method_ev = evidence(
        "text",
        3,
        "AFM friction method",
        "For the friction experiments, sliding friction was measured over a scan distance of 10 or 5 µm at scan rates of 0.1-3 Hz.",
        [60.5, 330.0, 565.0, 560.0],
        matched_text="sliding friction was measured",
    )
    rough_ev = evidence(
        "figure",
        5,
        "Fig. 4",
        "Figure 4 plots friction coefficient for silica-silica and silica-PTFE contacts in air and EAN against combined RMS roughness.",
        [351.7, 212.7, 537.2, 482.2],
        matched_text="combined RMS roughness",
    )
    rows = {
        162: ("[EA][NO3]", "EA", "NO3", "silica-silica", "0.152419355", "0.6", True),
        163: ("[EA][NO3]", "EA", "NO3", "silica-PTFE", "0.130645161", "7.0", True),
        164: ("air", None, None, "silica-silica", "0.338709677", "0.6", False),
        165: ("air", None, None, "silica-PTFE", "0.200806452", "7.0", False),
    }
    before = conn.total_changes
    for data_id, (lubricant, cation, anion, material, cof, roughness, is_ean) in rows.items():
        field_map = {
            "material": entry(material, fig_ev),
            "cof": entry(cof, fig_ev, confidence=0.9, grounding_note="Value is digitized from the source figure."),
            "speed": entry("20", method_ev, confidence=0.78, grounding_note="Stored from the legacy dataset; source gives the scan-distance/rate range but not a separate per-bar speed."),
            "temperature": inferred_room_temperature(),
            "surface_roughness": entry(f"{roughness} nm", rough_ev, confidence=0.86),
            "source": entry("Fig. 3 / Fig. 4", fig_ev),
            "source_page": entry("Page 5", fig_ev),
        }
        if is_ean:
            field_map["ionic_liquid"] = entry("[EA][NO3]", fig_ev, literature_alias="EAN")
        else:
            field_map[component_key("air")] = entry("air", fig_ev, literature_alias="air control")
        conn.execute(
            """
            UPDATE tribology_data
               SET literature_id = ?, source = ?, source_page = 5, source_figure = 'Fig. 3 / Fig. 4',
                   evidence = ?, evidence_page = 5, evidence_bbox = ?, confidence = 0.90,
                   material_name = ?, substrate_material = ?, lubricant = ?, cation = ?, anion = ?,
                   cof_raw = ?, cof_value = ?, speed_value = '20', temperature = '298 K',
                   potential = NULL, mol_ratio = NULL, surface_roughness = ?, substrate_roughness = ?,
                   lubricant_components_json = NULL, field_evidence_json = ?, review_status = 'pending_review',
                   assembly_notes = 'Relocated displayed rows 101-104 from the 2022 review cache to the primary 2012 EAN stiction-suppression paper.'
             WHERE id = ?
            """,
            (
                lit_id,
                TITLE_EAN_2012,
                fig_ev["quote"],
                dumps(fig_ev["bbox"]),
                material,
                material,
                lubricant,
                cation,
                anion,
                cof,
                float(cof),
                f"{roughness} nm",
                f"{roughness} nm",
                dumps(field_map),
                data_id,
            ),
        )
    return conn.total_changes - before


def update_dication_2019(conn: sqlite3.Connection, lit_id: int) -> int:
    fig_ev = evidence(
        "figure",
        11,
        "Fig. 2",
        "Figure 2 shows kinetic friction force as a function of normal force for [C10(C1Im)2][NTf2]2 between mica surfaces at shearing velocities 470, 105, and 52 nm/s.",
        [72.0, 456.5, 540.1, 584.0],
        matched_text="Kinetic friction force",
    )
    text_ev = evidence(
        "text",
        12,
        "Fig. 2 discussion",
        "The friction coefficient shows a weak velocity dependence ranging from µ = 0.08 to µ = 0.11 with one order of magnitude increase in shearing velocity.",
        [72.0, 510.0, 540.0, 575.0],
        matched_text="µ = 0.08 to µ = 0.11",
    )
    rows = {
        166: ("0.47", "0.0594"),
        167: ("0.105", "0.08"),
        168: ("0.052", "0.107"),
    }
    before = conn.total_changes
    for data_id, (speed, cof) in rows.items():
        field_map = {
            "material": entry("mica", fig_ev),
            "ionic_liquid": entry("[C10(C1Im)2][NTf2]2", fig_ev),
            "cof": entry(cof, text_ev, confidence=0.88, grounding_note="Value is anchored to Fig. 2; some legacy values are digitized from the plotted slopes."),
            "speed": entry(speed, fig_ev, literature_alias=f"{float(speed) * 1000:g} nm/s"),
            "temperature": inferred_room_temperature(),
            "surface_roughness": entry("atomically smooth mica", fig_ev, confidence=0.86),
            "source": entry("Fig. 2", fig_ev),
            "source_page": entry("Page 11", fig_ev),
        }
        conn.execute(
            """
            UPDATE tribology_data
               SET literature_id = ?, source = ?, source_page = 11, source_figure = 'Fig. 2',
                   evidence = ?, evidence_page = 11, evidence_bbox = ?, confidence = 0.89,
                   material_name = 'mica', substrate_material = 'mica',
                   lubricant = '[C10(C1Im)2][NTf2]2', cation = '[C10(C1Im)2]2+', anion = 'NTf2',
                   cof_raw = ?, cof_value = ?, speed_value = ?, temperature = '298 K',
                   potential = NULL, mol_ratio = NULL, surface_roughness = 'atomically smooth mica',
                   substrate_roughness = 'atomically smooth mica', lubricant_components_json = NULL,
                   field_evidence_json = ?, review_status = 'pending_review',
                   assembly_notes = 'Relocated displayed rows 105-107 from the 2022 review cache to the primary 2019 dicationic ionic-liquid paper.'
             WHERE id = ?
            """,
            (
                lit_id,
                TITLE_DICATION_2019,
                fig_ev["quote"],
                dumps(fig_ev["bbox"]),
                cof,
                float(cof),
                speed,
                dumps(field_map),
                data_id,
            ),
        )
    return conn.total_changes - before


def update_roughness_2020(conn: sqlite3.Connection, lit_id: int) -> int:
    table_ev = evidence(
        "table",
        3,
        "Table 1",
        "Table 1 lists nanoparticle densities and RMS roughness values: 0 µm-2, 275 µm-2 with 4.85 nm, and 720 µm-2 with 6.03 nm.",
        [51.0, 635.9, 549.0, 713.5],
        matched_text="RMS roughness",
    )
    fig3_ev = evidence(
        "figure",
        4,
        "Fig. 3b",
        "Figure 3b gives speed-dependent friction force on the three silica substrates at a constant load of 90 nN.",
        [116.2, 498.7, 476.2, 672.9],
        matched_text="Speed-dependent friction force",
    )
    fig4_ev = evidence(
        "text",
        6,
        "Fig. 4 discussion",
        "For sharp-tip measurements, the smooth surface gives µ = 0.036 in regime III, while 275 and 720 µm-2 substrates give µ ≈ 0.066 and 0.075.",
        [48.2, 168.3, 546.5, 321.9],
        matched_text="0.066 and 0.075",
    )
    method_ev = evidence(
        "text",
        9,
        "experimental conditions",
        "Force measurements were performed under ambient laboratory conditions (44-50% RH, 25 °C).",
        [51.0, 80.0, 549.0, 190.0],
        matched_text="25 °C",
    )
    rows = {
        169: ("5", "0.058", "0.2", "0 µm-2", fig3_ev, 4, "Fig. 3b"),
        170: ("5", "0.024", "4.85", "275 µm-2", fig3_ev, 4, "Fig. 3b"),
        171: ("5", "0.036", "6.03", "720 µm-2", fig3_ev, 4, "Fig. 3b"),
        172: ("1", "0.036", "0.2", "0 µm-2", fig4_ev, 6, "Fig. 4 discussion"),
        173: ("1", "0.066", "4.85", "275 µm-2", fig4_ev, 6, "Fig. 4 discussion"),
        174: ("1", "0.075", "6.03", "720 µm-2", fig4_ev, 6, "Fig. 4 discussion"),
    }
    before = conn.total_changes
    for data_id, (speed, cof, roughness, density, source_ev, page, label) in rows.items():
        field_map = {
            "material": entry("silica", source_ev),
            "ionic_liquid": entry("[HMIM][TFSI]", source_ev),
            "cof": entry(cof, source_ev, confidence=0.9, grounding_note="Value is anchored to the plotted or discussed friction coefficient."),
            "speed": entry(speed, source_ev),
            "temperature": entry("298 K", method_ev, literature_alias="25 °C"),
            "surface_roughness": entry(f"{roughness} nm", table_ev, literature_alias=density),
            "source": entry(label, source_ev),
            "source_page": entry(f"Page {page}", source_ev),
        }
        conn.execute(
            """
            UPDATE tribology_data
               SET literature_id = ?, source = ?, source_page = ?, source_figure = ?,
                   evidence = ?, evidence_page = ?, evidence_bbox = ?, confidence = 0.91,
                   material_name = 'silica', substrate_material = 'silica',
                   lubricant = '[HMIM][TFSI]', cation = 'HMIM', anion = 'TFSI',
                   cof_raw = ?, cof_value = ?, speed_value = ?, temperature = '298 K',
                   potential = NULL, mol_ratio = NULL, surface_roughness = ?, substrate_roughness = ?,
                   lubricant_components_json = NULL, field_evidence_json = ?, review_status = 'pending_review',
                   assembly_notes = 'Relocated displayed rows 108-113 from the 2022 review cache to the primary 2020 nanoscale-roughness paper.'
             WHERE id = ?
            """,
            (
                lit_id,
                TITLE_ROUGHNESS_2020,
                page,
                label,
                source_ev["quote"],
                page,
                dumps(source_ev["bbox"]),
                cof,
                float(cof),
                speed,
                f"{roughness} nm",
                f"{roughness} nm",
                dumps(field_map),
                data_id,
            ),
        )
    return conn.total_changes - before


def main() -> None:
    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    backup = DB_PATH.with_name(f"ioniclink.before-display-90-113-relocate-{timestamp}.db")
    shutil.copy2(DB_PATH, backup)

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        with conn:
            lit_stainless = upsert_literature(
                conn,
                doi="10.1021/acssuschemeng.7b03262",
                title=TITLE_STAINLESS_2017,
                authors="Peter K. Cooper; Callan J. Wear; Hua Li; Rob Atkin",
                journal="ACS Sustainable Chemistry & Engineering",
                year=2017,
                volume="5",
                pages="11737-11743",
                file_path=PDF_STAINLESS_2017,
            )
            lit_dop = upsert_literature(
                conn,
                doi="10.1021/la201378b",
                title=TITLE_DOP_2011,
                authors="Jianxi Liu; Jinlong Li; Bo Yu; Baodong Ma; Yangwen Zhu; Xinwang Song; Xulong Cao; Wu Yang; Feng Zhou",
                journal="Langmuir",
                year=2011,
                volume="27",
                pages="11324-11331",
                file_path=PDF_DOP_2011,
                prefer_existing_title="Catecholic",
            )
            lit_ean = upsert_literature(
                conn,
                doi="10.1021/la3010807",
                title=TITLE_EAN_2012,
                authors="Rubén Álvarez Asencio; Emily D. Cranston; Rob Atkin; Mark W. Rutland",
                journal="Langmuir",
                year=2012,
                volume="28",
                pages="9967-9976",
                file_path=PDF_EAN_2012,
            )
            lit_dication = upsert_literature(
                conn,
                doi="10.1021/acs.langmuir.9b01415",
                title=TITLE_DICATION_2019,
                authors="Carla S. Perez-Martinez; Susan Perkin",
                journal="Langmuir",
                year=2019,
                volume="35",
                pages="15444-15450",
                file_path=PDF_DICATION_2019,
                prefer_existing_title="Dicationic Ionic Liquid",
            )
            lit_roughness = upsert_literature(
                conn,
                doi="10.1002/admi.202000314",
                title=TITLE_ROUGHNESS_2020,
                authors="Prathima C. Nalam; Alexis Sheehan; Mengwei Han; Rosa M. Espinosa-Marzal",
                journal="Advanced Materials Interfaces",
                year=2020,
                volume="7",
                pages="2000314",
                file_path=PDF_ROUGHNESS_2020,
                prefer_existing_title="Nanoscale Roughness",
            )

            counts = {
                "2017_stainless_rows_updated": update_stainless_2017(conn, lit_stainless),
                "2011_dop_rows_updated": update_dop_2011(conn, lit_dop),
                "2012_ean_rows_updated": update_ean_2012(conn, lit_ean),
                "2019_dication_rows_updated": update_dication_2019(conn, lit_dication),
                "2020_roughness_rows_updated": update_roughness_2020(conn, lit_roughness),
            }
    finally:
        conn.close()

    print(f"backup: {backup}")
    print(f"2017_stainless_literature_id: {lit_stainless}")
    print(f"2011_dop_literature_id: {lit_dop}")
    print(f"2012_ean_literature_id: {lit_ean}")
    print(f"2019_dication_literature_id: {lit_dication}")
    print(f"2020_roughness_literature_id: {lit_roughness}")
    for key, value in counts.items():
        print(f"{key}: {value}")


if __name__ == "__main__":
    main()
