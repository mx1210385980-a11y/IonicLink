"""Relocate displayed tribology rows 201-231 to their primary PDFs."""

from __future__ import annotations

import json
import shutil
import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[2]
DB_PATH = ROOT / "backend" / "data" / "ioniclink.db"

PDF_SOLVATE_2017 = Path("Reference/Extracted/2017-Rutland-Boundary layer friction of solvate ionic liquids as a function of potential.pdf")
PDF_PEO_2016 = Path("Reference/Extracted/2016-Atkin-Poly(ethylene oxide) Mushrooms Adsorbed at Silica−Ionic Liquid.pdf")
PDF_PIL_2014 = Path("Reference/Extracted/2014-Rutland-Effect of ion structure on nanoscale friction in protic ionic liquids.pdf")

TITLE_SOLVATE_2017 = "Boundary layer friction of solvate ionic liquids as a function of potential"
TITLE_PEO_2016 = "Poly(ethylene oxide) Mushrooms Adsorbed at Silica-Ionic Liquid Interfaces Reduce Friction"
TITLE_PIL_2014 = "Effect of ion structure on nanoscale friction in protic ionic liquids"

NITRATE_SMILES = "[O-][N+](=O)[O-]"
FORMATE_SMILES = "[O-]C=O"
BF4_SMILES = "F[B-](F)(F)F"

IL_META: dict[str, dict[str, str | None]] = {
    "[PA][NO3]": {
        "cation": "PA",
        "anion": "NO3",
        "alias": "PAN",
        "cation_smiles": "CCC[NH3+]",
        "anion_smiles": NITRATE_SMILES,
        "il_smiles": f"CCC[NH3+].{NITRATE_SMILES}",
        "water": "<0.1 wt%",
    },
    "[PA][formate]": {
        "cation": "PA",
        "anion": "formate",
        "alias": "PAF",
        "cation_smiles": "CCC[NH3+]",
        "anion_smiles": FORMATE_SMILES,
        "il_smiles": f"CCC[NH3+].{FORMATE_SMILES}",
        "water": "<0.5 wt%",
    },
    "[EA][NO3]": {
        "cation": "EA",
        "anion": "NO3",
        "alias": "EAN",
        "cation_smiles": "CC[NH3+]",
        "anion_smiles": NITRATE_SMILES,
        "il_smiles": f"CC[NH3+].{NITRATE_SMILES}",
        "water": "<0.1 wt%",
    },
    "[EA][formate]": {
        "cation": "EA",
        "anion": "formate",
        "alias": "EAF",
        "cation_smiles": "CC[NH3+]",
        "anion_smiles": FORMATE_SMILES,
        "il_smiles": f"CC[NH3+].{FORMATE_SMILES}",
        "water": "<0.5 wt%",
    },
    "[EtA][NO3]": {
        "cation": "EtA",
        "anion": "NO3",
        "alias": "EtAN",
        "cation_smiles": "C(CO)[NH3+]",
        "anion_smiles": NITRATE_SMILES,
        "il_smiles": f"C(CO)[NH3+].{NITRATE_SMILES}",
        "water": "<0.1 wt%",
    },
    "[DMEA][formate]": {
        "cation": "DMEA",
        "anion": "formate",
        "alias": "DMEAF",
        "cation_smiles": "CC[NH+](C)C",
        "anion_smiles": FORMATE_SMILES,
        "il_smiles": f"CC[NH+](C)C.{FORMATE_SMILES}",
        "water": "<0.5 wt%",
    },
    "[BMIM][BF4]": {
        "cation": "BMIM",
        "anion": "BF4",
        "alias": None,
        "cation_smiles": "CCCCn1cc[n+](C)c1",
        "anion_smiles": BF4_SMILES,
        "il_smiles": f"CCCCn1cc[n+](C)c1.{BF4_SMILES}",
        "water": None,
    },
}


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


def normalized_load_conditions(raw: str, *, min_mn_m: float | None = None, max_mn_m: float | None = None) -> str:
    return dumps(
        {
            "raw_text": raw,
            "value_type": "normalized_load",
            "normalized_load_min_mN_m": min_mn_m,
            "normalized_load_max_mN_m": max_mn_m,
            "system_total_load_N": None,
            "contact_load_per_unit_N": None,
            "contact_unit_type": "normalized_by_probe_radius",
        }
    )


def nanoscale_tribosystem(method: str, profile: str = "colloidal_probe") -> str:
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
        "Table 1 lists Au(111) Li(G4) NO3 friction coefficients of 0.24, 1.0, and 1.3 at 0, +0.5, and +1 V.",
        [61.7, 534.5, 380.5, 613.0],
        matched_text="Li(G4) NO3 0.048 0.12 0.24 1.0 1.3",
    )
    au_load_ev = evidence(
        "text",
        8,
        "Au(111) boundary-layer region",
        "At Au(111), a multilayer regime below 8 nN and a boundary layer regime above 8 nN were detected.",
        [61.7, 342.6, 380.6, 483.6],
        matched_text="boundary layer regime (FN > 8 nN)",
    )

    rows = {
        288: ("0.24", "0 V"),
        289: ("1.0", "+0.5 V"),
        290: ("1.3", "+1 V"),
    }
    before = conn.total_changes
    for data_id, (cof, potential) in rows.items():
        sample_id = f"Table 1 Au(111) [Li(G4)][NO3] {potential}"
        field_map = {
            "material": entry("silicon AFM tip / Au(111)", method_ev),
            "ionic_liquid": entry("[Li(G4)][NO3]", table_ev),
            "cof": entry(cof, table_ev),
            "load": entry(">8 nN", au_load_ev),
            "speed": entry("6 μm/s", method_ev, confidence=0.9, grounding_note="Line speed derived from the source scan size and scan rate."),
            "potential": entry(potential, table_ev),
            "water_content": entry("<100 ppm", water_ev),
            "regime": entry("boundary layer", au_load_ev),
            "source": entry("Table 1", table_ev),
            "source_page": entry("Page 8", table_ev),
        }
        conn.execute(
            """
            UPDATE tribology_data
               SET literature_id = ?, source = ?, source_page = 8, source_figure = 'Table 1',
                   evidence = ?, evidence_page = 8, evidence_bbox = ?, confidence = 0.97,
                   material_name = 'silicon AFM tip / Au(111)',
                   probe_material = 'silicon', probe_geometry = 'sharp AFM tip',
                   probe_radius = NULL, substrate_material = 'Au(111)',
                   substrate_roughness = NULL, surface_roughness = NULL,
                   lubricant = '[Li(G4)][NO3]', lubricant_alias = NULL,
                   cation = 'Li(G4)', anion = 'NO3',
                   cation_smiles = NULL, anion_smiles = ?, il_smiles = NULL,
                   cof_raw = ?, cof_value = ?, load_value = '>8 nN',
                   load_raw = 'Au(111) boundary-layer regime above 8 nN',
                   speed_value = '6', temperature = NULL, potential = ?, mol_ratio = NULL,
                   water_content = '<100 ppm', regime = 'boundary layer',
                   lubricant_components_json = NULL, cof_extracted_json = ?,
                   load_conditions_json = ?,
                   speed_conditions_json = ?, tribological_system_json = ?,
                   field_evidence_json = ?, sample_id = ?,
                   series_id = 'li-2017-solvate-il-table1-potential',
                   record_origin = 'manual_relocation', review_status = 'pending_review',
                   assembly_notes = 'Relocated displayed rows 201-203 from the 2022 AFM review cache to the primary 2017 solvate-ionic-liquid boundary-friction paper.'
             WHERE id = ?
            """,
            (
                lit_id,
                TITLE_SOLVATE_2017,
                table_ev["quote"],
                dumps(table_ev["bbox"]),
                NITRATE_SMILES,
                cof,
                float(cof),
                potential,
                cof_payload(cof, "Table 1", f"Au(111); [Li(G4)][NO3]; {potential}", "Explicit source table coefficient."),
                dumps(
                    {
                        "raw_text": "Au(111) boundary-layer regime above 8 nN",
                        "value_type": "range",
                        "load_min_N": 8e-9,
                        "load_max_N": None,
                    }
                ),
                speed_conditions("100 nm scan size at 30 Hz scan rate", 6.0),
                nanoscale_tribosystem("Sharp silicon AFM tip sliding on Au(111) in [Li(G4)][NO3] under applied potential.", "afm_sharp_tip"),
                dumps(field_map),
                sample_id,
                data_id,
            ),
        )
    return conn.total_changes - before


def update_peo_2016(conn: sqlite3.Connection, lit_id: int) -> int:
    method_ev = evidence(
        "text",
        3,
        "AFM friction method",
        "Friction data used a 1 μm scan size at 5 Hz, corresponding to a scan velocity of 10 μm/s, over normalized loads from 0 to 35 mN/m.",
        [51.5, 58.5, 291.6, 302.2],
        matched_text="scan velocity of 10 μm s−1",
    )
    fig_ev = evidence(
        "figure",
        5,
        "Fig. 3",
        "Fig. 3 shows normalized shear force versus normalized load for a silica colloid probe sliding against planar silica in PAN and [BMIM][BF4].",
        [51.5, 183.0, 555.5, 222.1],
        matched_text="silica colloid probe sliding against a planar silica surface",
    )
    table_ev = evidence(
        "table",
        5,
        "Table 2",
        "Table 2 gives no-polymer friction coefficients of 1.02 for PAN and 1.57 for [BMIM][BF4].",
        [51.5, 231.5, 555.5, 321.6],
        matched_text="PAN 1.02 ± 0.23; [BMIM][BF4] 1.57 ± 0.21",
    )

    rows = {
        291: ("[PA][NO3]", "1.02"),
        292: ("[BMIM][BF4]", "1.57"),
    }
    before = conn.total_changes
    for data_id, (lubricant, cof) in rows.items():
        meta = IL_META[lubricant]
        alias = meta["alias"]
        sample_id = f"Table 2 {alias or lubricant} no polymer"
        field_map = {
            "material": entry("silica colloid probe / planar silica surface", fig_ev),
            "ionic_liquid": entry(lubricant, table_ev, literature_alias=alias),
            "cof": entry(cof, table_ev),
            "load": entry("0-35 mN/m normalized load", method_ev),
            "speed": entry("10 μm/s", method_ev),
            "source": entry("Table 2", table_ev),
            "source_page": entry("Page 5", table_ev),
        }
        conn.execute(
            """
            UPDATE tribology_data
               SET literature_id = ?, source = ?, source_page = 5, source_figure = 'Table 2',
                   evidence = ?, evidence_page = 5, evidence_bbox = ?, confidence = 0.97,
                   material_name = 'silica colloid probe / planar silica surface',
                   probe_material = 'silica', probe_geometry = 'colloidal probe',
                   probe_radius = NULL, substrate_material = 'silica',
                   substrate_roughness = NULL, surface_roughness = NULL,
                   lubricant = ?, lubricant_alias = ?,
                   cation = ?, anion = ?, cation_smiles = ?, anion_smiles = ?, il_smiles = ?,
                   cof_raw = ?, cof_value = ?, load_value = '0-35 mN/m normalized load',
                   load_raw = 'normalized loads from 0 to 35 mN m-1',
                   speed_value = '10', temperature = NULL, potential = NULL, mol_ratio = NULL,
                   water_content = NULL, regime = NULL, lubricant_components_json = NULL,
                   cof_extracted_json = ?, load_conditions_json = ?,
                   speed_conditions_json = ?, tribological_system_json = ?,
                   field_evidence_json = ?, sample_id = ?,
                   series_id = 'sweeney-2016-peo-silica-il-table2-neat',
                   record_origin = 'manual_relocation', review_status = 'pending_review',
                   assembly_notes = 'Relocated displayed rows 204-205 from the 2022 AFM review cache to the primary 2016 Langmuir PEO/silica-ionic-liquid paper; rows are the no-polymer pure-IL controls in Table 2.'
             WHERE id = ?
            """,
            (
                lit_id,
                TITLE_PEO_2016,
                table_ev["quote"],
                dumps(table_ev["bbox"]),
                lubricant,
                alias,
                meta["cation"],
                meta["anion"],
                meta["cation_smiles"],
                meta["anion_smiles"],
                meta["il_smiles"],
                cof,
                float(cof),
                cof_payload(cof, "Table 2", f"{alias or lubricant}; no polymer", "Explicit source table coefficient."),
                normalized_load_conditions("normalized loads from 0 to 35 mN m-1", min_mn_m=0.0, max_mn_m=35.0),
                speed_conditions("1 μm scan size at 5 Hz scan rate", 10.0),
                nanoscale_tribosystem("Silica colloid probe sliding against a planar silica surface in neat ionic liquid.", "colloidal_probe"),
                dumps(field_map),
                sample_id,
                data_id,
            ),
        )
    return conn.total_changes - before


def update_pil_2014(conn: sqlite3.Connection, lit_id: int) -> int:
    prep_ev = evidence(
        "text",
        2,
        "PIL preparation and AFM method",
        "The paper prepares nitrate and formate PILs, reports water contents, and measures shear force versus normal load by AFM.",
        [303.3, 169.7, 552.8, 501.4],
        matched_text="Nitrate ILs had water content of less than 0.1 wt%, and formate ILs less than 0.5 wt%",
    )
    material_ev = evidence(
        "text",
        3,
        "colloid-probe mica method",
        "An atomically smooth muscovite mica surface and a colloid probe on a tipless cantilever were used for AFM friction experiments.",
        [42.5, 50.2, 292.1, 346.1],
        matched_text="atomically smooth muscovite mica surface",
    )
    repeat_ev = evidence(
        "text",
        3,
        "velocity series method",
        "The study used five sliding velocities, with repeated loading-unloading cycles at each velocity.",
        [42.5, 349.1, 292.1, 417.8],
        matched_text="five sliding velocities studied",
    )
    boundary_ev = evidence(
        "text",
        3,
        "boundary regime definition",
        "All investigated PILs are in the boundary regime when the normalized load is greater than 0.2 mN/m.",
        [42.5, 576.2, 292.0, 680.8],
        matched_text="boundary regime when the normal load is greater than 0.2 mN m−1",
    )
    fig1_ev = evidence(
        "figure",
        3,
        "Fig. 1",
        "Fig. 1 shows shear force versus normal load at a sliding velocity of 40 μm/s for each PIL.",
        [303.3, 209.6, 552.8, 257.0],
        matched_text="sliding velocity of 40 μm s−1",
    )
    table1_ev = evidence(
        "table",
        4,
        "Table 1",
        "Table 1 gives boundary-regime friction coefficients at 40 μm/s: PAN 1.1, PAF 1.1, EtAN 0.8, DMEAF 0.6, EAN 1.1, and EAF 1.1.",
        [42.5, 492.3, 292.0, 606.8],
        matched_text="PAN 4.4 1.1 PAF 4.5 1.1 EtAN 2.9 0.8 DMEAF 2.2 0.6 EAN 2.3 1.1 EAF 1.7 1.1",
    )
    fig3_ev = evidence(
        "figure",
        6,
        "Fig. 3",
        "Fig. 3 plots boundary-regime friction coefficients for PAF, PAN, EtAN, EAF, and DMEAF as a function of sliding velocity.",
        [42.5, 206.0, 552.8, 243.3],
        matched_text="boundary regime friction coefficients (right) for PAF, PAN, EtAN, EAF, and DMEAF as a function of sliding velocity",
    )

    table_rows = {
        293: ("[PA][NO3]", "1.1", "40"),
        294: ("[PA][formate]", "1.1", "40"),
        295: ("[EtA][NO3]", "0.8", "40"),
        296: ("[DMEA][formate]", "0.6", "40"),
        297: ("[EA][NO3]", "1.1", "40"),
        298: ("[EA][formate]", "1.1", "40"),
    }
    fig_rows = {
        299: ("[PA][formate]", "0.843037975", "5"),
        300: ("[PA][formate]", "0.97721519", "10"),
        301: ("[PA][formate]", "0.964556962", "20"),
        302: ("[PA][formate]", "1.017721519", "30"),
        303: ("[PA][NO3]", "0.936708861", "5"),
        304: ("[PA][NO3]", "0.997468354", "10"),
        305: ("[PA][NO3]", "1.113924051", "20"),
        306: ("[PA][NO3]", "1.113924051", "30"),
        307: ("[EtA][NO3]", "0.643037975", "5"),
        308: ("[EtA][NO3]", "0.678481013", "10"),
        309: ("[EtA][NO3]", "0.670886076", "20"),
        310: ("[EtA][NO3]", "0.77721519", "30"),
        311: ("[DMEA][formate]", "0.508860759", "5"),
        312: ("[DMEA][formate]", "0.463291139", "10"),
        313: ("[DMEA][formate]", "0.569620253", "20"),
        314: ("[DMEA][formate]", "0.607594937", "30"),
        315: ("[EA][formate]", "0.929113924", "5"),
        316: ("[EA][formate]", "1.083544304", "10"),
        317: ("[EA][formate]", "1.040506329", "20"),
        318: ("[EA][formate]", "1.149367089", "30"),
    }

    before = conn.total_changes
    for data_id, (lubricant, cof, speed) in {**table_rows, **fig_rows}.items():
        meta = IL_META[lubricant]
        source_ev = table1_ev if data_id in table_rows else fig3_ev
        source_page = 4 if data_id in table_rows else 6
        source_label = "Table 1" if data_id in table_rows else "Fig. 3"
        load_value = "0.2-1.0 mN/m normalized load" if data_id in table_rows else ">0.2 mN/m normalized load"
        load_conditions = (
            normalized_load_conditions("boundary-regime normal load range from 0.2 to 1.0 mN m-1", min_mn_m=0.2, max_mn_m=1.0)
            if data_id in table_rows
            else normalized_load_conditions("boundary regime above 0.2 mN m-1", min_mn_m=0.2, max_mn_m=None)
        )
        note = "Explicit source table coefficient." if data_id in table_rows else "Digitized from the right panel of Fig. 3 in the primary paper."
        sample_id = f"{source_label} {meta['alias']} boundary {speed} um/s"
        field_map = {
            "material": entry("silica colloid probe / mica surface", material_ev),
            "ionic_liquid": entry(lubricant, source_ev, literature_alias=meta["alias"]),
            "cof": entry(cof, source_ev, confidence=0.94 if data_id in fig_rows else 0.97, grounding_note=note if data_id in fig_rows else None),
            "load": entry(load_value, boundary_ev if data_id in fig_rows else table1_ev),
            "speed": entry(f"{speed} μm/s", fig1_ev if data_id in table_rows else fig3_ev),
            "regime": entry("boundary layer", boundary_ev),
            "water_content": entry(meta["water"], prep_ev),
            "substrate_roughness": entry("atomically smooth muscovite mica", material_ev),
            "source": entry(source_label, source_ev),
            "source_page": entry(f"Page {source_page}", source_ev),
        }
        conn.execute(
            """
            UPDATE tribology_data
               SET literature_id = ?, source = ?, source_page = ?, source_figure = ?,
                   evidence = ?, evidence_page = ?, evidence_bbox = ?, confidence = ?,
                   material_name = 'silica colloid probe / mica surface',
                   probe_material = 'silica', probe_geometry = 'colloidal probe',
                   probe_radius = '14.5 μm diameter', substrate_material = 'mica',
                   substrate_roughness = 'atomically smooth muscovite mica',
                   surface_roughness = 'atomically smooth muscovite mica',
                   lubricant = ?, lubricant_alias = ?,
                   cation = ?, anion = ?, cation_smiles = ?, anion_smiles = ?, il_smiles = ?,
                   cof_raw = ?, cof_value = ?, load_value = ?, load_raw = ?,
                   speed_value = ?, temperature = NULL, potential = NULL, mol_ratio = NULL,
                   water_content = ?, regime = 'boundary layer',
                   lubricant_components_json = NULL, cof_extracted_json = ?,
                   load_conditions_json = ?, speed_conditions_json = ?,
                   tribological_system_json = ?, field_evidence_json = ?, sample_id = ?,
                   series_id = 'sweeney-2014-pil-mica-boundary-friction',
                   record_origin = 'manual_relocation', review_status = 'pending_review',
                   assembly_notes = 'Relocated displayed rows 206-231 from the 2022 AFM review cache to the primary 2014 protic-ionic-liquid ion-structure paper. Formate PILs are normalized as formate, not fluoride; EtAN is separated from EAN.'
             WHERE id = ?
            """,
            (
                lit_id,
                TITLE_PIL_2014,
                source_page,
                source_label,
                source_ev["quote"],
                source_page,
                dumps(source_ev["bbox"]),
                0.95 if data_id in fig_rows else 0.97,
                lubricant,
                meta["alias"],
                meta["cation"],
                meta["anion"],
                meta["cation_smiles"],
                meta["anion_smiles"],
                meta["il_smiles"],
                cof,
                float(cof),
                load_value,
                load_value,
                speed,
                meta["water"],
                cof_payload(cof, source_label, f"{meta['alias']}; boundary regime; {speed} um/s", note),
                load_conditions,
                speed_conditions(f"{speed} μm/s sliding velocity", float(speed)),
                nanoscale_tribosystem("Silica colloid probe sliding against atomically smooth mica in a protic ionic liquid.", "colloidal_probe"),
                dumps(field_map),
                sample_id,
                data_id,
            ),
        )
    return conn.total_changes - before


def main() -> None:
    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    backup = DB_PATH.with_name(f"ioniclink.before-display-201-231-relocate-{timestamp}.db")
    shutil.copy2(DB_PATH, backup)

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        with conn:
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
            lit_peo = upsert_literature(
                conn,
                doi="10.1021/acs.langmuir.5b04503",
                title=TITLE_PEO_2016,
                authors="James Sweeney; Grant B. Webber; Rob Atkin",
                journal="Langmuir",
                year=2016,
                volume="32",
                pages="1947-1954",
                file_path=PDF_PEO_2016,
                prefer_existing_title="Mushrooms Adsorbed at Silica",
            )
            lit_pil = upsert_literature(
                conn,
                doi="10.1039/c4cp02320j",
                title=TITLE_PIL_2014,
                authors="James Sweeney; Grant B. Webber; Mark W. Rutland; Rob Atkin",
                journal="Physical Chemistry Chemical Physics",
                year=2014,
                volume="16",
                pages="16651-16658",
                file_path=PDF_PIL_2014,
                prefer_existing_title="nanoscale friction in protic ionic liquids",
            )

            counts = {
                "2017_solvate_rows_updated": update_solvate_2017(conn, lit_solvate),
                "2016_peo_rows_updated": update_peo_2016(conn, lit_peo),
                "2014_pil_rows_updated": update_pil_2014(conn, lit_pil),
            }
    finally:
        conn.close()

    print(f"backup: {backup}")
    print(f"2017_solvate_literature_id: {lit_solvate}")
    print(f"2016_peo_literature_id: {lit_peo}")
    print(f"2014_pil_literature_id: {lit_pil}")
    for key, value in counts.items():
        print(f"{key}: {value}")


if __name__ == "__main__":
    main()
