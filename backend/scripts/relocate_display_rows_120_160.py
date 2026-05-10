"""Relocate displayed tribology rows 120-160 to their primary PDFs."""

from __future__ import annotations

import json
import shutil
import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[2]
DB_PATH = ROOT / "backend" / "data" / "ioniclink.db"

PDF_POLYMERIC_2022 = Path("Reference/Extracted/Interfacial nanostructure and friction of a polymeric ionic liquid-ionic.pdf")
PDF_EAN_2012 = Path("Reference/Extracted/2012-rutland-Ionic liquid nanotribology mica–silica interactions in ethylammonium nitrate.pdf")
PDF_ION_STRUCTURE_2013 = Path("Reference/Extracted/2013-rutland-Ionic liquid lubrication influence of ion structure, surface potential and sliding velocity.pdf")

TITLE_POLYMERIC_2022 = "Interfacial nanostructure and friction of a polymeric ionic liquid-ionic liquid mixture as a function of potential at Au(111) electrode interface"
TITLE_EAN_2012 = "Ionic liquid nanotribology: mica-silica interactions in ethylammonium nitrate"
TITLE_ION_STRUCTURE_2013 = "Ionic liquid lubrication: influence of ion structure, surface potential and sliding velocity"

BMIM_TFSI = "[BMIM][TFSI]"
PIL_TFSI = "[Poly(3MAPIm)][TFSI]"


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


def components_json(components: list[dict[str, Any]] | None) -> str | None:
    return dumps(components) if components else None


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


def tribosystem(method: str, profile: str, scale: str = "nano") -> str:
    return dumps(
        {
            "raw_text": method,
            "friction_regime": "boundary",
            "contact_geometry": profile,
            "scale": scale,
            "method": "AFM lateral force",
            "instrument": "AFM",
            "measurement_type": "coefficient_of_friction",
            "profile": profile,
            "training_view": "nanoscale_afm",
            "training_views": ["nanoscale_afm"],
        }
    )


def update_polymeric_2022(conn: sqlite3.Connection, lit_id: int) -> int:
    method_ev = evidence(
        "text",
        3,
        "AFM friction method",
        "AFM imaging, normal force curve and friction measurements were performed using a Veeco Nanoscope IV AFM in contact mode on Au(111). The scan size was 500 nm and scan rate was 6 Hz.",
        [37.6, 464.9, 557.7, 755.4],
        matched_text="scan size was 500 nm; scan rate was 6 Hz",
    )
    pure_ev = evidence(
        "figure",
        3,
        "Fig. 2g",
        "Fig. 2g shows lateral force versus normal load of BMIM TFSI on Au(111) at OCP, -1.0 V and +1.0 V.",
        [37.6, 243.4, 557.7, 275.6],
        matched_text="BMIM TFSI on Au(111) at OCP, -1.0 V and +1.0 V",
    )
    mixture_prep_ev = evidence(
        "text",
        3,
        "5 wt% PIL/BMIM TFSI preparation",
        "Because pure PIL is paste-like, a 5 wt% PIL/BMIM TFSI solution was made by mixing 0.2 g PIL with 3.8 g BMIM TFSI after THF-assisted dissolution.",
        [37.6, 359.7, 288.7, 430.6],
        matched_text="5 wt% PIL/BMIM TFSI solution",
    )
    mixture_ev = evidence(
        "figure",
        7,
        "Fig. 6a",
        "Fig. 6a shows lateral force versus normal force of 5 wt% PIL/BMIM TFSI on Au(111) at OCP, -1.0 V and +1.0 V.",
        [37.6, 208.9, 557.6, 232.4],
        matched_text="5 wt% PIL/BMIM TFSI on Au(111) at OCP, -1.0 V and +1.0 V",
    )
    rough_ev = evidence(
        "text",
        3,
        "Au(111) substrate",
        "Atomically smooth Au(111) surfaces were used for the friction measurements.",
        [37.6, 464.9, 288.7, 535.0],
        matched_text="Atomically smooth Au(111) surfaces",
    )
    regime_ev = evidence(
        "text",
        1,
        "abstract",
        "The polymeric cations adsorb at Au(111) and form a boundary layer whose friction response is tuned by potential.",
        [305.0, 220.0, 557.0, 374.0],
        matched_text="boundary layer",
    )

    rows = {
        198: ("BMIM TFSI OCP", BMIM_TFSI, "BMIM", "TFSI", "0.044", "OCP", pure_ev, None, 3, "Fig. 2g"),
        199: ("BMIM TFSI -1.0 V", BMIM_TFSI, "BMIM", "TFSI", "0.006", "-1 V", pure_ev, None, 3, "Fig. 2g"),
        200: ("BMIM TFSI +1.0 V", BMIM_TFSI, "BMIM", "TFSI", "0.119", "+1 V", pure_ev, None, 3, "Fig. 2g"),
        204: ("5 wt% PIL/BMIM TFSI OCP", BMIM_TFSI, "BMIM", "TFSI", "0.634", "OCP", mixture_ev, "5 wt% PIL", 7, "Fig. 6a"),
        205: ("5 wt% PIL/BMIM TFSI +1.0 V", BMIM_TFSI, "BMIM", "TFSI", "0.184", "+1 V", mixture_ev, "5 wt% PIL", 7, "Fig. 6a"),
        206: ("5 wt% PIL/BMIM TFSI -1.0 V", BMIM_TFSI, "BMIM", "TFSI", "0.911", "-1 V", mixture_ev, "5 wt% PIL", 7, "Fig. 6a"),
    }

    before = conn.total_changes
    for data_id, (sample_id, lubricant, cation, anion, cof, potential, value_ev, ratio, page, source_label) in rows.items():
        components = None
        field_map = {
            "material": entry("silicon AFM tip / Au(111)", method_ev),
            "ionic_liquid": entry(lubricant, value_ev, grounding_note="Coefficient is a curated slope value anchored to the plotted lateral-force curve."),
            "cof": entry(cof, value_ev, confidence=0.9, grounding_note="Digitized/curated coefficient from the plotted lateral-force slope."),
            "speed": entry("6 μm/s", method_ev, confidence=0.9, grounding_note="Derived from the source scan size (500 nm) and scan rate (6 Hz)."),
            "potential": entry(potential, value_ev),
            "regime": entry("boundary", regime_ev),
            "surface_roughness": entry("atomically smooth Au(111)", rough_ev),
            "substrate_roughness": entry("atomically smooth Au(111)", rough_ev),
            "source": entry(source_label, value_ev),
            "source_page": entry(f"Page {page}", value_ev),
        }
        if ratio:
            components = [
                {"compound": BMIM_TFSI, "fraction": 95, "unit": "wt%", "role": "ionic_liquid"},
                {"compound": PIL_TFSI, "fraction": 5, "unit": "wt%", "role": "polymeric_ionic_liquid"},
            ]
            field_map["mol_ratio"] = entry("5 wt% PIL / 95 wt% BMIM TFSI", mixture_prep_ev)
            field_map[component_key(PIL_TFSI)] = entry(PIL_TFSI, mixture_prep_ev, literature_alias="Poly(3MAPIm) TFSI")
        else:
            components = [{"compound": BMIM_TFSI, "fraction": 100, "unit": "wt%", "role": "ionic_liquid"}]

        conn.execute(
            """
            UPDATE tribology_data
               SET literature_id = ?, source = ?, source_page = ?, source_figure = ?,
                   evidence = ?, evidence_page = ?, evidence_bbox = ?, confidence = 0.92,
                   material_name = 'silicon AFM tip / Au(111)', probe_material = 'silicon',
                   probe_geometry = 'sharp AFM tip', probe_radius = '8 nm',
                   substrate_material = 'Au(111)', substrate_roughness = 'atomically smooth Au(111)',
                   surface_roughness = 'atomically smooth Au(111)',
                   lubricant = ?, cation = ?, anion = ?, cof_raw = ?, cof_value = ?,
                   speed_value = '6', temperature = NULL, potential = ?, mol_ratio = ?,
                   water_content = NULL, lubricant_components_json = ?, cof_extracted_json = ?,
                   speed_conditions_json = ?, load_conditions_json = NULL,
                   tribological_system_json = ?, field_evidence_json = ?,
                   sample_id = ?, series_id = 'li-2022-polymeric-bmim-tfsi-au-potential',
                   record_origin = 'manual_relocation', review_status = 'pending_review',
                   assembly_notes = 'Relocated displayed rows 120-125 from the 2022 AFM review cache to the primary 2022 polymeric-IL/BMIM-TFSI Au(111) paper; pure rows use Fig. 2g and 5 wt% PIL mixture rows use Fig. 6a.'
             WHERE id = ?
            """,
            (
                lit_id,
                TITLE_POLYMERIC_2022,
                page,
                source_label,
                value_ev["quote"],
                page,
                dumps(value_ev["bbox"]),
                lubricant,
                cation,
                anion,
                cof,
                float(cof),
                potential,
                ratio,
                components_json(components),
                cof_payload(cof, source_label, f"{potential}; {ratio or 'pure BMIM TFSI'}", "Curated slope coefficient from the source figure."),
                speed_conditions("500 nm scan size at 6 Hz scan rate", 6.0),
                tribosystem("Sharp silicon AFM tip sliding on Au(111) in BMIM TFSI or 5 wt% PIL/BMIM TFSI.", "afm_sharp_tip"),
                dumps(field_map),
                sample_id,
                data_id,
            ),
        )
    return conn.total_changes - before


def update_ean_2012(conn: sqlite3.Connection, lit_id: int) -> int:
    method_ev = evidence(
        "text",
        4,
        "Fig. 3 method text",
        "Fig. 3 shows the lateral friction force acting on a 20.8 μm diameter silica colloid moving at various speeds over 5 μm across the EAN-mica interface.",
        [51.5, 138.1, 288.8, 422.1],
        matched_text="20.8 μm diameter silica colloid moving at various speeds over a distance of 5 μm",
    )
    interval_ev = evidence(
        "text",
        4,
        "Interval II discussion",
        "At separations with only a single confined layer remaining, the friction coefficient depends strongly on lateral velocity; this Interval II region lies between about 5 nN and 13 nN.",
        [306.6, 54.3, 543.7, 319.3],
        matched_text="friction coefficient depends strongly on lateral velocity",
    )
    fig_ev = evidence(
        "figure",
        5,
        "Fig. 4",
        "Fig. 4 gives colloid probe speed dependent friction coefficient of Interval II (diamonds) and III (circles).",
        [51.5, 58.0, 288.8, 261.0],
        matched_text="Colloid probe speed dependent friction coefficient of Interval II",
    )

    rows = {
        207: ("0.5", "0.022795699"),
        208: ("1", "0.019871158"),
        209: ("5", "0.04905363"),
        210: ("10", "0.080214931"),
        211: ("20", "0.100018741"),
        212: ("30", "0.114781888"),
        213: ("40", "0.128900651"),
    }

    before = conn.total_changes
    for data_id, (speed, cof) in rows.items():
        sample_id = f"Fig. 4 Interval II {speed} um/s"
        field_map = {
            "material": entry("silica colloid probe / mica substrate", method_ev),
            "ionic_liquid": entry("[EA][NO3]", fig_ev, literature_alias="EAN"),
            "cof": entry(cof, fig_ev, confidence=0.9, grounding_note="Digitized coefficient from Fig. 4 Interval II diamonds."),
            "load": entry("5-13 nN", interval_ev, confidence=0.86, grounding_note="Interval II spans the single-confined-layer load region described in the text."),
            "speed": entry(f"{speed} μm/s", fig_ev, confidence=0.9),
            "regime": entry("Interval II, single confined EAN layer", interval_ev),
            "source": entry("Fig. 4", fig_ev),
            "source_page": entry("Page 5", fig_ev),
        }
        conn.execute(
            """
            UPDATE tribology_data
               SET literature_id = ?, source = ?, source_page = 5, source_figure = 'Fig. 4',
                   evidence = ?, evidence_page = 5, evidence_bbox = ?, confidence = 0.90,
                   material_name = 'silica colloid probe / mica substrate',
                   probe_material = 'silica', probe_geometry = 'colloidal probe',
                   probe_radius = '10.4 μm', substrate_material = 'mica',
                   substrate_roughness = NULL, surface_roughness = NULL,
                   lubricant = '[EA][NO3]', cation = 'EA', anion = 'NO3',
                   cof_raw = ?, cof_value = ?, load_value = '5-13 nN',
                   load_raw = 'Interval II single confined layer, approximately 5-13 nN',
                   speed_value = ?, temperature = NULL, potential = NULL, mol_ratio = NULL,
                   water_content = NULL, lubricant_components_json = NULL,
                   cof_extracted_json = ?, load_conditions_json = ?,
                   speed_conditions_json = ?, tribological_system_json = ?,
                   field_evidence_json = ?, sample_id = ?,
                   series_id = 'werzer-2012-ean-mica-speed-interval-ii',
                   record_origin = 'manual_relocation', review_status = 'pending_review',
                   assembly_notes = 'Relocated displayed rows 126-132 from the 2022 AFM review cache to the primary 2012 EAN mica-silica nanotribology paper; coefficients are anchored to Fig. 4 Interval II.'
             WHERE id = ?
            """,
            (
                lit_id,
                TITLE_EAN_2012,
                fig_ev["quote"],
                dumps(fig_ev["bbox"]),
                cof,
                float(cof),
                speed,
                cof_payload(cof, "Fig. 4", f"Interval II; {speed} um/s", "Digitized from Fig. 4 Interval II diamonds."),
                load_conditions("Interval II single confined layer, approximately 5-13 nN", 5e-9, 13e-9),
                speed_conditions(f"{speed} μm/s", float(speed)),
                tribosystem("20.8 μm silica colloid probe sliding across the EAN-mica interface.", "colloidal_probe"),
                dumps(field_map),
                sample_id,
                data_id,
            ),
        )
    return conn.total_changes - before


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
    table2_ev = evidence(
        "table",
        4,
        "Table 2",
        "Table 2 gives friction coefficients of EMIM FAP, BMIM FAP, HMIM FAP and BMIM I on Au(111) at different potentials with sliding speed 2 μm/s.",
        [42.5, 349.3, 292.0, 436.4],
        matched_text="Friction coefficients of [EMIM] FAP, [BMIM] FAP, [HMIM] FAP and [BMIM] I",
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

    table2_rows = {
        214: ("[EMIM][FAP]", "EMIM", "FAP", "0.12", "-2 V"),
        215: ("[EMIM][FAP]", "EMIM", "FAP", "0.16", "-1 V"),
        216: ("[EMIM][FAP]", "EMIM", "FAP", "0.20", "-0.5 V"),
        217: ("[EMIM][FAP]", "EMIM", "FAP", "0.23", "0 V"),
        218: ("[EMIM][FAP]", "EMIM", "FAP", "0.28", "+0.5 V"),
        219: ("[EMIM][FAP]", "EMIM", "FAP", "0.35", "+1 V"),
        220: ("[EMIM][FAP]", "EMIM", "FAP", "0.38", "+1.5 V"),
        221: ("[BMIM][FAP]", "BMIM", "FAP", "0.23", "-1 V"),
        222: ("[BMIM][FAP]", "BMIM", "FAP", "0.24", "-0.5 V"),
        223: ("[BMIM][FAP]", "BMIM", "FAP", "0.29", "0 V"),
        224: ("[BMIM][FAP]", "BMIM", "FAP", "0.30", "+0.5 V"),
        225: ("[BMIM][FAP]", "BMIM", "FAP", "0.38", "+1 V"),
        226: ("[HMIM][FAP]", "HMIM", "FAP", "0.10", "-2 V"),
        227: ("[HMIM][FAP]", "HMIM", "FAP", "0.15", "-1 V"),
        228: ("[HMIM][FAP]", "HMIM", "FAP", "0.20", "-0.5 V"),
        229: ("[HMIM][FAP]", "HMIM", "FAP", "0.28", "0 V"),
        230: ("[HMIM][FAP]", "HMIM", "FAP", "0.30", "+0.5 V"),
        231: ("[HMIM][FAP]", "HMIM", "FAP", "0.36", "+1 V"),
        232: ("[HMIM][FAP]", "HMIM", "FAP", "0.41", "+1.5 V"),
        233: ("[BMIM][I]", "BMIM", "I", "0.24", "-1 V"),
        234: ("[BMIM][I]", "BMIM", "I", "0.20", "-0.5 V"),
        235: ("[BMIM][I]", "BMIM", "I", "0.17", "0 V"),
        236: ("[BMIM][I]", "BMIM", "I", "0.12", "+0.5 V"),
    }
    table3_rows = {
        237: ("[EMIM][FAP]", "EMIM", "FAP", "0.13", "-2 V", "6"),
        238: ("[EMIM][FAP]", "EMIM", "FAP", "0.17", "-1 V", "6"),
        239: ("[EMIM][FAP]", "EMIM", "FAP", "0.22", "-0.5 V", "6"),
        240: ("[EMIM][FAP]", "EMIM", "FAP", "0.26", "0 V", "6"),
        241: ("[EMIM][FAP]", "EMIM", "FAP", "0.30", "+0.5 V", "6"),
    }

    before = conn.total_changes

    def apply_row(
        data_id: int,
        lubricant: str,
        cation: str,
        anion: str,
        cof: str,
        potential: str,
        speed: str,
        value_ev: dict[str, Any],
        source_page: int,
        source_figure: str,
    ) -> None:
        sample_id = f"{source_figure} {lubricant} {potential} {speed} um/s"
        field_map = {
            "material": entry("silica colloid probe / Au(111)", method_ev),
            "ionic_liquid": entry(lubricant, value_ev),
            "cof": entry(cof, value_ev),
            "load": entry(">5 nN", load_ev, confidence=0.86, grounding_note="The paper discusses the tabulated friction coefficients in the single-ion-layer region above 5 nN."),
            "speed": entry(f"{speed} μm/s", value_ev),
            "temperature": entry("293 K", temp_ev, literature_alias="20 °C"),
            "potential": entry(potential, value_ev),
            "water_content": entry("<100 ppm", water_ev),
            "surface_roughness": entry("atomically smooth Au(111)", substrate_ev),
            "substrate_roughness": entry("atomically smooth Au(111)", substrate_ev),
            "source": entry(source_figure, value_ev),
            "source_page": entry(f"Page {source_page}", value_ev),
        }
        conn.execute(
            """
            UPDATE tribology_data
               SET literature_id = ?, source = ?, source_page = ?, source_figure = ?,
                   evidence = ?, evidence_page = ?, evidence_bbox = ?, confidence = 0.97,
                   material_name = 'silica colloid probe / Au(111)',
                   probe_material = 'silica', probe_geometry = 'colloidal probe',
                   probe_radius = '2.5 μm', substrate_material = 'Au(111)',
                   substrate_roughness = 'atomically smooth Au(111)',
                   surface_roughness = 'atomically smooth Au(111)',
                   lubricant = ?, cation = ?, anion = ?, cof_raw = ?, cof_value = ?,
                   load_value = '>5 nN', load_raw = 'single-ion-layer region above 5 nN',
                   speed_value = ?, temperature = '293 K', potential = ?, mol_ratio = NULL,
                   water_content = '<100 ppm', lubricant_components_json = NULL,
                   cof_extracted_json = ?, load_conditions_json = ?,
                   speed_conditions_json = ?, tribological_system_json = ?,
                   field_evidence_json = ?, sample_id = ?,
                   series_id = 'li-2013-ion-structure-au-potential-speed',
                   record_origin = 'manual_relocation', review_status = 'pending_review',
                   assembly_notes = 'Relocated displayed rows 133-160 from the 2022 AFM review cache to the primary 2013 ion-structure/surface-potential Au(111) paper.'
             WHERE id = ?
            """,
            (
                lit_id,
                TITLE_ION_STRUCTURE_2013,
                source_page,
                source_figure,
                value_ev["quote"],
                source_page,
                dumps(value_ev["bbox"]),
                lubricant,
                cation,
                anion,
                cof,
                float(cof),
                speed,
                potential,
                cof_payload(cof, source_figure, f"{lubricant}; {potential}; {speed} um/s", "Explicit source table coefficient."),
                load_conditions("single-ion-layer region above 5 nN", 5e-9, None),
                speed_conditions(f"{speed} μm/s", float(speed)),
                tribosystem("5 μm silica colloid probe sliding on Au(111) in ionic liquid under applied potential.", "colloidal_probe"),
                dumps(field_map),
                sample_id,
                data_id,
            ),
        )

    for data_id, (lubricant, cation, anion, cof, potential) in table2_rows.items():
        apply_row(data_id, lubricant, cation, anion, cof, potential, "2", table2_ev, 4, "Table 2")
    for data_id, (lubricant, cation, anion, cof, potential, speed) in table3_rows.items():
        apply_row(data_id, lubricant, cation, anion, cof, potential, speed, table3_ev, 5, "Table 3")

    return conn.total_changes - before


def main() -> None:
    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    backup = DB_PATH.with_name(f"ioniclink.before-display-120-160-relocate-{timestamp}.db")
    shutil.copy2(DB_PATH, backup)

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        with conn:
            lit_polymeric = upsert_literature(
                conn,
                doi="10.1016/j.jcis.2021.08.067",
                title=TITLE_POLYMERIC_2022,
                authors="Hua Li; Yunxiao Zhang; Seamus Jones; Rachel Segalman; Gregory G. Warr; Rob Atkin",
                journal="Journal of Colloid and Interface Science",
                year=2022,
                volume="606",
                pages="1170-1178",
                file_path=PDF_POLYMERIC_2022,
                prefer_existing_title="polymeric ionic liquid-ionic liquid mixture",
            )
            lit_ean = upsert_literature(
                conn,
                doi="10.1039/c1cp23134k",
                title=TITLE_EAN_2012,
                authors="Oliver Werzer; Emily D. Cranston; Gregory G. Warr; Rob Atkin; Mark W. Rutland",
                journal="Physical Chemistry Chemical Physics",
                year=2012,
                volume="14",
                pages="5147-5152",
                file_path=PDF_EAN_2012,
                prefer_existing_title="mica",
            )
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

            counts = {
                "2022_polymeric_rows_updated": update_polymeric_2022(conn, lit_polymeric),
                "2012_ean_rows_updated": update_ean_2012(conn, lit_ean),
                "2013_ion_structure_rows_updated": update_ion_structure_2013(conn, lit_ion_structure),
            }
    finally:
        conn.close()

    print(f"backup: {backup}")
    print(f"2022_polymeric_literature_id: {lit_polymeric}")
    print(f"2012_ean_literature_id: {lit_ean}")
    print(f"2013_ion_structure_literature_id: {lit_ion_structure}")
    for key, value in counts.items():
        print(f"{key}: {value}")


if __name__ == "__main__":
    main()
