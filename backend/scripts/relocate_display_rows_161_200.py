"""Relocate displayed tribology rows 161-200 to their primary PDFs."""

from __future__ import annotations

import json
import shutil
import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[2]
DB_PATH = ROOT / "backend" / "data" / "ioniclink.db"

PDF_ION_STRUCTURE_2013 = Path("Reference/Extracted/2013-rutland-Ionic liquid lubrication influence of ion structure, surface potential and sliding velocity.pdf")
PDF_TITANIUM_2022 = Path("Reference/Extracted/2022-an-Probing the nanofriction of non-halogenated phosphonium-based ionic liquid additives in glycol ether oil on titanium surface.pdf")
PDF_SOLVATE_2017 = Path("Reference/Extracted/2017-Rutland-Boundary layer friction of solvate ionic liquids as a function of potential.pdf")

TITLE_ION_STRUCTURE_2013 = "Ionic liquid lubrication: influence of ion structure, surface potential and sliding velocity"
TITLE_TITANIUM_2022 = "Probing the nanofriction of non-halogenated phosphonium-based ionic liquid additives in glycol ether oil on titanium surface"
TITLE_SOLVATE_2017 = "Boundary layer friction of solvate ionic liquids as a function of potential"

DEGDBE = "DEGDBE"


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


def component_key(compound: str) -> str:
    slug = "".join(ch.lower() if ch.isalnum() else "_" for ch in compound).strip("_")
    while "__" in slug:
        slug = slug.replace("__", "_")
    return f"compound_{slug or 'component'}"


def components_json(components: list[dict[str, Any]] | None) -> str | None:
    return dumps(components) if components else None


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


def cof_payload(cof: str, source_label: str, condition: str, note: str) -> str:
    value = float(cof)
    return dumps(
        {
            "raw_text": cof,
            "value_type": "single",
            "cof_min": value,
            "cof_max": value,
            "cof_average": value,
            "dependent_variable": None,
            "test_condition_value": condition,
            "note": note,
            "source_label": source_label,
        }
    )


def speed_conditions(raw: str, value: float) -> str:
    return dumps(
        {
            "raw_text": raw,
            "value_type": "linear",
            "sliding_velocity_um_s": value,
            "scan_rate_hz": None,
            "scan_length_um": None,
            "unit_warning": False,
        }
    )


def load_conditions(raw: str, min_n: float | None = None, max_n: float | None = None) -> str:
    return dumps(
        {
            "raw_text": raw,
            "value_type": "range" if min_n is not None or max_n is not None else "description",
            "system_total_load_N": None,
            "contact_load_per_unit_N": None,
            "contact_unit_type": None,
            "load_min_N": min_n,
            "load_max_N": max_n,
        }
    )


def tribosystem(method: str, profile: str) -> str:
    return dumps(
        {
            "raw_text": method,
            "friction_regime": "boundary",
            "contact_geometry": profile,
            "scale": "nano",
            "method": "AFM lateral force",
            "instrument": "AFM",
            "measurement_type": "coefficient_of_friction",
            "profile": profile,
            "training_view": "nanoscale_afm",
            "training_views": ["nanoscale_afm"],
        }
    )


def update_ion_structure_2013(conn: sqlite3.Connection, lit_id: int) -> int:
    method_ev = evidence(
        "text",
        2,
        "AFM colloid-probe method",
        "Friction measurements used a silica probe with 5 μm diameter attached to a tipless cantilever.",
        [42.5, 520.0, 292.0, 603.0],
        matched_text="silica probe (5 μm diameter)",
    )
    substrate_ev = evidence(
        "text",
        3,
        "Au(111) substrate",
        "Atomically smooth Au(111), a gold film of about 150 nm thickness on mica, was used as both working electrode and solid substrate for friction measurements.",
        [42.5, 300.7, 292.0, 477.5],
        matched_text="Atomically smooth Au(111)",
    )
    temp_ev = evidence(
        "text",
        3,
        "friction data collection",
        "Friction data were collected at 20 °C; each individual lateral force data point is an average of six repeat friction loops.",
        [42.5, 540.3, 292.0, 644.9],
        matched_text="Friction data were collected at 20 °C",
    )
    load_ev = evidence(
        "text",
        4,
        "single-layer load region",
        "The discussion focuses on normal forces greater than 5 nN, where only a single layer of ions is present between the sliding surfaces.",
        [42.5, 636.0, 292.0, 716.7],
        matched_text="normal forces greater than 5 nN",
    )
    table3_ev = evidence(
        "table",
        5,
        "Table 3",
        "Table 3 gives friction coefficients of EMIM FAP at different sliding speeds and surface potentials.",
        [42.5, 600.3, 291.9, 690.0],
        matched_text="Friction coefficients of [EMIM] FAP at different sliding speeds and surface potentials",
    )
    water_ev = evidence(
        "text",
        2,
        "materials",
        "The ionic liquids were purchased in high purity grade with water content below 100 ppm.",
        [42.5, 520.0, 292.0, 603.0],
        matched_text="water content < 100 ppm",
    )

    rows = {
        242: ("0.35", "+1 V", "6"),
        243: ("0.39", "+1.5 V", "6"),
        244: ("0.14", "-2 V", "12"),
        245: ("0.19", "-1 V", "12"),
        246: ("0.22", "-0.5 V", "12"),
        247: ("0.29", "0 V", "12"),
        248: ("0.30", "+0.5 V", "12"),
        249: ("0.35", "+1 V", "12"),
        250: ("0.39", "+1.5 V", "12"),
        251: ("0.15", "-2 V", "20"),
        252: ("0.20", "-1 V", "20"),
        253: ("0.24", "-0.5 V", "20"),
        254: ("0.34", "0 V", "20"),
        255: ("0.31", "+0.5 V", "20"),
        256: ("0.36", "+1 V", "20"),
        257: ("0.39", "+1.5 V", "20"),
    }
    before = conn.total_changes
    for data_id, (cof, potential, speed) in rows.items():
        sample_id = f"Table 3 [EMIM][FAP] {potential} {speed} um/s"
        field_map = {
            "material": entry("silica colloid probe / Au(111)", method_ev),
            "ionic_liquid": entry("[EMIM][FAP]", table3_ev),
            "cof": entry(cof, table3_ev),
            "load": entry(">5 nN", load_ev, confidence=0.86, grounding_note="The paper discusses the tabulated friction coefficients in the single-ion-layer region above 5 nN."),
            "speed": entry(f"{speed} μm/s", table3_ev),
            "temperature": entry("293 K", temp_ev, literature_alias="20 °C"),
            "potential": entry(potential, table3_ev),
            "water_content": entry("<100 ppm", water_ev),
            "surface_roughness": entry("atomically smooth Au(111)", substrate_ev),
            "substrate_roughness": entry("atomically smooth Au(111)", substrate_ev),
            "source": entry("Table 3", table3_ev),
            "source_page": entry("Page 5", table3_ev),
        }
        conn.execute(
            """
            UPDATE tribology_data
               SET literature_id = ?, source = ?, source_page = 5, source_figure = 'Table 3',
                   evidence = ?, evidence_page = 5, evidence_bbox = ?, confidence = 0.97,
                   material_name = 'silica colloid probe / Au(111)',
                   probe_material = 'silica', probe_geometry = 'colloidal probe',
                   probe_radius = '2.5 μm', substrate_material = 'Au(111)',
                   substrate_roughness = 'atomically smooth Au(111)',
                   surface_roughness = 'atomically smooth Au(111)',
                   lubricant = '[EMIM][FAP]', cation = 'EMIM', anion = 'FAP',
                   cof_raw = ?, cof_value = ?, load_value = '>5 nN',
                   load_raw = 'single-ion-layer region above 5 nN',
                   speed_value = ?, temperature = '293 K', potential = ?, mol_ratio = NULL,
                   water_content = '<100 ppm', lubricant_components_json = NULL,
                   cof_extracted_json = ?, load_conditions_json = ?,
                   speed_conditions_json = ?, tribological_system_json = ?,
                   field_evidence_json = ?, sample_id = ?,
                   series_id = 'li-2013-emim-fap-speed-potential-table3',
                   record_origin = 'manual_relocation', review_status = 'pending_review',
                   assembly_notes = 'Relocated displayed rows 161-176 from the 2022 AFM review cache to the primary 2013 ion-structure/surface-potential Au(111) paper.'
             WHERE id = ?
            """,
            (
                lit_id,
                TITLE_ION_STRUCTURE_2013,
                table3_ev["quote"],
                dumps(table3_ev["bbox"]),
                cof,
                float(cof),
                speed,
                potential,
                cof_payload(cof, "Table 3", f"[EMIM][FAP]; {potential}; {speed} um/s", "Explicit source table coefficient."),
                load_conditions("single-ion-layer region above 5 nN", 5e-9, None),
                speed_conditions(f"{speed} μm/s", float(speed)),
                tribosystem("5 μm silica colloid probe sliding on Au(111) in [EMIM][FAP] under applied potential.", "colloidal_probe"),
                dumps(field_map),
                sample_id,
                data_id,
            ),
        )
    return conn.total_changes - before


def ratio_components(il: str, ratio: str) -> list[dict[str, Any]]:
    left, right = ratio.split(":")
    il_part = float(left)
    oil_part = float(right)
    total = il_part + oil_part
    return [
        {"compound": il, "fraction": round(il_part / total * 100, 6), "unit": "mol%", "role": "ionic_liquid"},
        {"compound": DEGDBE, "fraction": round(oil_part / total * 100, 6), "unit": "mol%", "role": "base_oil"},
    ]


def update_titanium_2022(conn: sqlite3.Connection, lit_id: int) -> int:
    method_ev = evidence(
        "text",
        3,
        "AFM friction method",
        "Si3N4 cantilever tips with tip radius of 20 nm were employed with a scan rate of 2 Hz and scan size of 5 μm x 5 μm.",
        [307.1, 72.2, 546.8, 295.4],
        matched_text="scan rate of 2 Hz and scan size of 5 μm x 5 μm",
    )
    materials_ev = evidence(
        "text",
        3,
        "materials and mixture preparation",
        "The ILs and the base oil DEGDBE are shown in Fig. 1; samples were prepared by dissolving the ILs in DEGDBE at molar ratios 1:10 and 1:70.",
        [51.1, 190.3, 290.8, 413.4],
        matched_text="molar ratios, i.e., 1:10, 1:70",
    )
    fig_ev = evidence(
        "figure",
        6,
        "Fig. 5",
        "Fig. 5 shows friction force measurements for the bare Ti substrate, neat DEGDBE oil, and IL-oil mixtures on Ti with a silicon nitride AFM tip.",
        [51.1, 454.6, 290.5, 525.1],
        matched_text="The fitting slope in (a) and (b) is μ",
    )
    table_ev = evidence(
        "table",
        6,
        "Table 1",
        "Table 1 gives nanofriction coefficients of the bare Ti substrate, neat DEGDBE oil on Ti, and IL-oil mixtures at 1:70 and 1:10.",
        [307.1, 548.3, 546.5, 718.7],
        matched_text="Nanofriction coefficients of the bare Ti substrate, neat DEGDBE oil on Ti surface, and ILs-oil mixtures",
    )
    discussion_ev = evidence(
        "text",
        6,
        "Fig. 5 discussion",
        "The bare Ti substrate has μ = 0.23, neat oil has μ = 0.14, and higher IL concentration at 1:10 gives μ about 0.052-0.063.",
        [307.1, 72.1, 546.9, 418.2],
        matched_text="μ = 0.23; μ = 0.14; μ ~ 0.052-0.063",
    )
    ambient_ev = evidence(
        "text",
        3,
        "AFM conditions",
        "AFM measurements were performed in contact mode at ambient conditions.",
        [307.1, 72.2, 546.8, 295.4],
        matched_text="ambient conditions",
    )

    rows = {
        264: ("bare titanium substrate", None, None, "0.23", None, None, "bare Ti control"),
        265: (DEGDBE, None, None, "0.14", None, [{"compound": DEGDBE, "fraction": 100, "unit": "mol%", "role": "base_oil"}], "neat DEGDBE oil"),
        266: ("[P6,6,6,14][BScB]", "P6,6,6,14", "BScB", "0.11", "1:70 mol", ratio_components("[P6,6,6,14][BScB]", "1:70"), None),
        267: ("[P6,6,6,14][BScB]", "P6,6,6,14", "BScB", "0.058", "1:10 mol", ratio_components("[P6,6,6,14][BScB]", "1:10"), None),
        268: ("[P6,6,6,14][DCA]", "P6,6,6,14", "DCA", "0.10", "1:70 mol", ratio_components("[P6,6,6,14][DCA]", "1:70"), None),
        269: ("[P6,6,6,14][DCA]", "P6,6,6,14", "DCA", "0.052", "1:10 mol", ratio_components("[P6,6,6,14][DCA]", "1:10"), None),
        270: ("[P6,6,6,14][BOB]", "P6,6,6,14", "BOB", "0.14", "1:70 mol", ratio_components("[P6,6,6,14][BOB]", "1:70"), None),
        271: ("[P6,6,6,14][BOB]", "P6,6,6,14", "BOB", "0.060", "1:10 mol", ratio_components("[P6,6,6,14][BOB]", "1:10"), None),
        272: ("[P6,6,6,14][BMB]", "P6,6,6,14", "BMB", "0.12", "1:70 mol", ratio_components("[P6,6,6,14][BMB]", "1:70"), None),
        273: ("[P6,6,6,14][BMB]", "P6,6,6,14", "BMB", "0.063", "1:10 mol", ratio_components("[P6,6,6,14][BMB]", "1:10"), None),
        274: ("[P4,4,4,8][BScB]", "P4,4,4,8", "BScB", "0.10", "1:70 mol", ratio_components("[P4,4,4,8][BScB]", "1:70"), None),
        275: ("[P4,4,4,8][BScB]", "P4,4,4,8", "BScB", "0.056", "1:10 mol", ratio_components("[P4,4,4,8][BScB]", "1:10"), None),
    }
    before = conn.total_changes
    for data_id, (lubricant, cation, anion, cof, ratio, components, alias) in rows.items():
        sample_id = alias or f"Table 1 {lubricant} {ratio}"
        field_map = {
            "material": entry("Si3N4 AFM tip / titanium substrate", method_ev),
            "cof": entry(cof, table_ev),
            "speed": entry("20 μm/s", method_ev, confidence=0.88, grounding_note="Stored as the line speed corresponding to the 5 μm scan size and 2 Hz scan rate."),
            "source": entry("Table 1", table_ev),
            "source_page": entry("Page 6", table_ev),
        }
        if cation and anion:
            field_map["ionic_liquid"] = entry(lubricant, table_ev)
            field_map["mol_ratio"] = entry(ratio, table_ev, literature_alias=ratio.replace(" mol", ""))
            field_map[component_key(DEGDBE)] = entry(DEGDBE, materials_ev)
        elif lubricant == DEGDBE:
            field_map[component_key(DEGDBE)] = entry(DEGDBE, table_ev, literature_alias="neat DEGDBE oil")
            field_map["ionic_liquid"] = entry("No ionic liquid; neat DEGDBE oil control", table_ev, confidence=0.9)
        else:
            field_map[component_key("bare titanium substrate")] = entry("bare titanium substrate", table_ev, literature_alias="Bare Ti")
            field_map["ionic_liquid"] = entry("No ionic liquid; bare Ti control", table_ev, confidence=0.9)
        field_map["ambient_conditions"] = entry("ambient conditions", ambient_ev, confidence=0.82)

        conn.execute(
            """
            UPDATE tribology_data
               SET literature_id = ?, source = ?, source_page = 6, source_figure = 'Table 1',
                   evidence = ?, evidence_page = 6, evidence_bbox = ?, confidence = 0.96,
                   material_name = 'Si3N4 AFM tip / titanium substrate',
                   probe_material = 'Si3N4', probe_geometry = 'AFM tip',
                   probe_radius = '20 nm', substrate_material = 'titanium',
                   substrate_roughness = NULL, surface_roughness = NULL,
                   lubricant = ?, cation = ?, anion = ?, cof_raw = ?, cof_value = ?,
                   load_value = NULL, load_raw = NULL, speed_value = '20',
                   temperature = NULL, potential = NULL, mol_ratio = ?, water_content = NULL,
                   lubricant_alias = ?, lubricant_components_json = ?,
                   cof_extracted_json = ?, load_conditions_json = NULL,
                   speed_conditions_json = ?, tribological_system_json = ?,
                   field_evidence_json = ?, sample_id = ?,
                   series_id = 'qiu-2022-titanium-degdbe-il-table1',
                   record_origin = 'manual_relocation', review_status = 'pending_review',
                   assembly_notes = 'Relocated displayed rows 177-188 from the 2022 AFM review cache to the primary 2022 titanium/DEGDBE ionic-liquid-additive paper; bare Ti and neat DEGDBE controls were separated from ionic-liquid mixture rows.'
             WHERE id = ?
            """,
            (
                lit_id,
                TITLE_TITANIUM_2022,
                table_ev["quote"],
                dumps(table_ev["bbox"]),
                lubricant,
                cation,
                anion,
                cof,
                float(cof),
                ratio,
                alias,
                components_json(components),
                cof_payload(cof, "Table 1", f"{lubricant}; {ratio or alias or 'control'}", "Explicit source table coefficient."),
                speed_conditions("5 μm scan size at 2 Hz scan rate", 20.0),
                tribosystem("Si3N4 AFM tip sliding on titanium coated with DEGDBE or IL-DEGDBE mixtures.", "afm_tip"),
                dumps(field_map),
                sample_id,
                data_id,
            ),
        )
    return conn.total_changes - before


def update_solvate_2017(conn: sqlite3.Connection, lit_id: int) -> int:
    method_ev = evidence(
        "text",
        3,
        "AFM friction method",
        "At HOPG and Au(111), lateral force versus normal load curves were measured with a scan size of 100 nm and a scan rate of 30 Hz.",
        [61.7, 300.0, 380.5, 390.0],
        matched_text="scan size of 100 nm and a scan rate of 30 Hz",
    )
    water_ev = evidence(
        "text",
        3,
        "SIL preparation",
        "Water content in the obtained solvate ionic liquids was below 100 ppm.",
        [61.7, 90.0, 380.5, 145.0],
        matched_text="Water content in the obtained SILs was below 100 ppm",
    )
    table_ev = evidence(
        "table",
        8,
        "Table 1",
        "Table 1 gives friction coefficients of solvate ionic liquids at different potentials: HOPG Li(G4) TFSI, Au(111) Li(G4) TFSI, and Au(111) Li(G4) NO3.",
        [61.7, 534.5, 380.5, 613.0],
        matched_text="Friction coefficients of solvate ionic liquids at different potentials",
    )
    hopg_load_ev = evidence(
        "text",
        8,
        "HOPG boundary-layer region",
        "For Li(G4) TFSI at HOPG, boundary-layer friction coefficients were obtained for normal loads between 8 nN and 50 nN.",
        [61.7, 29.7, 380.5, 302.2],
        matched_text="normal loads between 8 nN and 50 nN",
    )
    au_load_ev = evidence(
        "text",
        8,
        "Au(111) boundary-layer region",
        "At Au(111), a multilayer regime below 8 nN and a boundary layer regime above 8 nN were detected; the analysis focuses on the boundary regime.",
        [61.7, 342.6, 380.6, 483.6],
        matched_text="boundary layer regime (FN > 8 nN)",
    )

    rows = {
        276: ("[Li(G4)][TFSI]", "Li(G4)", "TFSI", "HOPG", "0.033", "-1 V", hopg_load_ev, "8-50 nN"),
        277: ("[Li(G4)][TFSI]", "Li(G4)", "TFSI", "HOPG", "0.024", "-0.5 V", hopg_load_ev, "8-50 nN"),
        278: ("[Li(G4)][TFSI]", "Li(G4)", "TFSI", "HOPG", "0.017", "0 V", hopg_load_ev, "8-50 nN"),
        279: ("[Li(G4)][TFSI]", "Li(G4)", "TFSI", "HOPG", "0.020", "+0.5 V", hopg_load_ev, "8-50 nN"),
        280: ("[Li(G4)][TFSI]", "Li(G4)", "TFSI", "HOPG", "0.010", "+1 V", hopg_load_ev, "8-50 nN"),
        281: ("[Li(G4)][TFSI]", "Li(G4)", "TFSI", "Au(111)", "0.059", "-1 V", au_load_ev, ">8 nN"),
        282: ("[Li(G4)][TFSI]", "Li(G4)", "TFSI", "Au(111)", "0.12", "-0.5 V", au_load_ev, ">8 nN"),
        283: ("[Li(G4)][TFSI]", "Li(G4)", "TFSI", "Au(111)", "0.21", "0 V", au_load_ev, ">8 nN"),
        284: ("[Li(G4)][TFSI]", "Li(G4)", "TFSI", "Au(111)", "0.25", "+0.5 V", au_load_ev, ">8 nN"),
        285: ("[Li(G4)][TFSI]", "Li(G4)", "TFSI", "Au(111)", "0.74", "+1 V", au_load_ev, ">8 nN"),
        286: ("[Li(G4)][NO3]", "Li(G4)", "NO3", "Au(111)", "0.048", "-1 V", au_load_ev, ">8 nN"),
        287: ("[Li(G4)][NO3]", "Li(G4)", "NO3", "Au(111)", "0.12", "-0.5 V", au_load_ev, ">8 nN"),
    }
    before = conn.total_changes
    for data_id, (lubricant, cation, anion, substrate, cof, potential, load_ev, load_value) in rows.items():
        sample_id = f"Table 1 {substrate} {lubricant} {potential}"
        field_map = {
            "material": entry(f"silicon AFM tip / {substrate}", method_ev),
            "ionic_liquid": entry(lubricant, table_ev),
            "cof": entry(cof, table_ev),
            "load": entry(load_value, load_ev),
            "speed": entry("6 μm/s", method_ev, confidence=0.9, grounding_note="Stored as the line speed corresponding to the 100 nm scan size and 30 Hz scan rate."),
            "potential": entry(potential, table_ev),
            "water_content": entry("<100 ppm", water_ev),
            "source": entry("Table 1", table_ev),
            "source_page": entry("Page 8", table_ev),
        }
        conn.execute(
            """
            UPDATE tribology_data
               SET literature_id = ?, source = ?, source_page = 8, source_figure = 'Table 1',
                   evidence = ?, evidence_page = 8, evidence_bbox = ?, confidence = 0.97,
                   material_name = ?, probe_material = 'silicon', probe_geometry = 'sharp AFM tip',
                   substrate_material = ?, substrate_roughness = NULL, surface_roughness = NULL,
                   lubricant = ?, cation = ?, anion = ?, cof_raw = ?, cof_value = ?,
                   load_value = ?, load_raw = ?, speed_value = '6',
                   temperature = NULL, potential = ?, mol_ratio = NULL, water_content = '<100 ppm',
                   lubricant_components_json = NULL, cof_extracted_json = ?,
                   load_conditions_json = ?, speed_conditions_json = ?,
                   tribological_system_json = ?, field_evidence_json = ?,
                   sample_id = ?, series_id = 'li-2017-solvate-il-table1-potential',
                   record_origin = 'manual_relocation', review_status = 'pending_review',
                   assembly_notes = 'Relocated displayed rows 189-200 from the 2022 AFM review cache to the primary 2017 solvate-ionic-liquid boundary-friction paper.'
             WHERE id = ?
            """,
            (
                lit_id,
                TITLE_SOLVATE_2017,
                table_ev["quote"],
                dumps(table_ev["bbox"]),
                f"silicon AFM tip / {substrate}",
                substrate,
                lubricant,
                cation,
                anion,
                cof,
                float(cof),
                load_value,
                "boundary-layer normal load region",
                potential,
                cof_payload(cof, "Table 1", f"{substrate}; {lubricant}; {potential}", "Explicit source table coefficient."),
                load_conditions("boundary-layer normal load region", 8e-9, 50e-9 if substrate == "HOPG" else None),
                speed_conditions("100 nm scan size at 30 Hz scan rate", 6.0),
                tribosystem(f"Sharp silicon AFM tip sliding on {substrate} in solvate ionic liquid under applied potential.", "afm_sharp_tip"),
                dumps(field_map),
                sample_id,
                data_id,
            ),
        )
    return conn.total_changes - before


def main() -> None:
    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    backup = DB_PATH.with_name(f"ioniclink.before-display-161-200-relocate-{timestamp}.db")
    shutil.copy2(DB_PATH, backup)

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        with conn:
            lit_ion_structure = upsert_literature(
                conn,
                doi="10.1039/c3cp52638k",
                title=TITLE_ION_STRUCTURE_2013,
                authors="Hua Li; Mark W. Rutland; Rob Atkin",
                journal="Physical Chemistry Chemical Physics",
                year=2013,
                volume="15",
                pages="14616-14623",
                file_path=PDF_ION_STRUCTURE_2013,
                prefer_existing_title="surface potential and sliding velocity",
            )
            lit_titanium = upsert_literature(
                conn,
                doi="10.1007/s40544-021-0486-4",
                title=TITLE_TITANIUM_2022,
                authors="Xiuhua Qiu; Linghong Lu; Zhenyu Qu; Jiongtao Liao; Qi Fan; Faiz Ullah Shah; Wenling Zhang; Rong An",
                journal="Friction",
                year=2022,
                volume="10",
                pages="268-281",
                file_path=PDF_TITANIUM_2022,
                prefer_existing_title="phosphonium-based ionic liquid additives",
            )
            lit_solvate = upsert_literature(
                conn,
                doi="10.1039/c6fd00236f",
                title=TITLE_SOLVATE_2017,
                authors="Hua Li; Mark W. Rutland; Masayoshi Watanabe; Rob Atkin",
                journal="Faraday Discussions",
                year=2017,
                volume="199",
                pages="311-322",
                file_path=PDF_SOLVATE_2017,
                prefer_existing_title="Boundary layer friction",
            )

            counts = {
                "2013_ion_structure_rows_updated": update_ion_structure_2013(conn, lit_ion_structure),
                "2022_titanium_rows_updated": update_titanium_2022(conn, lit_titanium),
                "2017_solvate_rows_updated": update_solvate_2017(conn, lit_solvate),
            }
    finally:
        conn.close()

    print(f"backup: {backup}")
    print(f"2013_ion_structure_literature_id: {lit_ion_structure}")
    print(f"2022_titanium_literature_id: {lit_titanium}")
    print(f"2017_solvate_literature_id: {lit_solvate}")
    for key, value in counts.items():
        print(f"{key}: {value}")


if __name__ == "__main__":
    main()
