"""Deterministically rebuild records for Rutland 2016 tribotronic paper.

The legacy group-library rows for this article were imported as "Row 50" style
records, so the values were connected to the paper but not to the PDF evidence.
One of the two 0.46 OCP records was also previously treated as a duplicate even
though Table 1 reports both 1 mol% IL and 5 mol% IL at the same coefficient.

This script rebuilds literature id 25 from the explicit Table 1 values plus the
curated Fig. 3 slope values, preserving record ids 99-115 so the existing table
ordering remains stable.
"""

from __future__ import annotations

import json
import shutil
import sqlite3
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[2]
DB_PATH = ROOT / "backend" / "data" / "ioniclink.db"
LITERATURE_ID = 25
PDF_PATH = "Reference/Extracted/2016-cooper-Tribotronic control of friction in oil-based lubricants with ionic liquid additives.pdf"

IL = "[P6,6,6,14][i(C8)2PO2]"
HEX = "hexadecane"

CATION = "P6,6,6,14"
ANION = "i(C8)2PO2"
CATION_SMILES = "CCCCCCCCCCCCCC[P+](CCCCCC)(CCCCCC)CCCCCC"
ANION_SMILES = "O=P([O-])(CC(C)CC(C)(C)C)CC(C)CC(C)(C)C"

TABLE1_BBOX = [42.5, 520.6, 292.0, 572.9]
FIG3_BBOX = [92.0, 606.0, 520.0, 717.5]
FIG2_CAPTION_BBOX = [303.3, 687.0, 552.8, 716.0]
ROUGHNESS_BBOX = [42.5, 456.0, 292.0, 480.0]
FIG3_TEXT_BBOX = [303.3, 145.0, 552.8, 238.5]
WATER_BBOX = [42.5, 535.0, 292.0, 565.0]

TABLE1_QUOTE = (
    "Table 1 reports friction coefficients for hexadecane, 0.001% IL, 1% IL, "
    "5% IL and pure IL as 0.89, 0.50, 0.46, 0.46 and 0.47."
)
FIG3_QUOTE = (
    "Fig. 3 shows lateral force vs. normal load for 1 mol%, 5 mol%, 10 mol% "
    "and pure IL mixtures at different applied potentials."
)
SYSTEM_QUOTE = (
    "Fig. 2 caption specifies a sharp silicon AFM tip, Au(111), 6.5 um/s and "
    "up to 100 nN applied normal load."
)
ROUGHNESS_QUOTE = "The text reports silica (RMS = 0.5 +/- 0.3 nm) and gold (RMS = 1.0 +/- 0.5) surfaces."
WATER_QUOTE = "The water content of the IL and hexadecane-IL mixtures was low (<0.2 wt%)."


@dataclass(frozen=True)
class Record:
    id: int
    cof: float
    cof_raw: str
    mol_ratio: str
    concentration_value: float | None
    potential: str
    source_figure: str
    evidence_bbox: list[float]
    evidence_quote: str
    source_type: str
    lubricant: str
    cation: str | None
    anion: str | None
    cation_smiles: str | None
    anion_smiles: str | None
    sample_id: str
    series_id: str
    confidence: float


def json_dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def evidence(
    *,
    source_type: str,
    page: int,
    source_label: str,
    quote: str,
    bbox: list[float],
    sample_id: str,
    matched_text: str | None = None,
) -> dict[str, Any]:
    return {
        "source_type": source_type,
        "page": page,
        "source_label": source_label,
        "quote": quote,
        "bbox": bbox,
        "sample_id": sample_id,
        "matched_text": matched_text,
    }


def field_entry(value: Any, confidence: float, field_evidence: dict[str, Any], *, source_anchor: bool = False) -> dict[str, Any]:
    entry: dict[str, Any] = {
        "value": str(value),
        "confidence": confidence,
        "evidence": field_evidence,
    }
    if source_anchor:
        entry["grounding_mode"] = "source_anchor"
        entry["grounding_note"] = (
            "Value is anchored to the source figure; exact numeric text is read from the plot/slope rather than selectable PDF text."
        )
    return entry


def lubricant_components(record: Record) -> str | None:
    if record.concentration_value is None:
        return json_dumps([{"compound": HEX, "fraction": 100, "unit": "mol%", "role": "base_oil"}])
    if record.concentration_value >= 100:
        return json_dumps([{"compound": IL, "fraction": 100, "unit": "mol%", "role": "ionic_liquid"}])
    return json_dumps(
        [
            {"compound": IL, "fraction": record.concentration_value, "unit": "mol%", "role": "ionic_liquid"},
            {"compound": HEX, "fraction": round(100 - record.concentration_value, 6), "unit": "mol%", "role": "base_oil"},
        ]
    )


def cof_payload(record: Record) -> str:
    note = "Explicit Table 1 coefficient." if record.source_figure == "Table 1" else "Curated slope coefficient from Fig. 3."
    return json_dumps(
        {
            "raw_text": record.cof_raw,
            "value_type": "single",
            "cof_min": record.cof,
            "cof_max": record.cof,
            "cof_average": record.cof,
            "dependent_variable": None,
            "test_condition_value": f"{record.mol_ratio}; {record.potential}",
            "note": note,
        }
    )


def load_conditions() -> str:
    return json_dumps(
        {
            "raw_text": "up to 100 nN applied normal load",
            "value_type": "range",
            "system_total_load_N": None,
            "contact_load_per_unit_N": None,
            "contact_unit_type": None,
            "load_min_N": 0,
            "load_max_N": 1e-7,
        }
    )


def speed_conditions() -> str:
    return json_dumps(
        {
            "raw_text": "6.5 μm/s",
            "value_type": "linear",
            "sliding_velocity_um_s": 6.5,
            "scan_rate_hz": None,
            "scan_length_um": None,
            "unit_warning": False,
        }
    )


def tribological_system() -> str:
    return json_dumps(
        {
            "raw_text": "AFM lateral force, sharp silicon tip sliding on Au(111), boundary lubrication",
            "friction_regime": "boundary",
            "contact_geometry": "afm_sharp_tip",
            "scale": "nano",
            "method": "AFM lateral force",
            "instrument": "Bruker Multimode 8 AFM",
            "measurement_type": "coefficient_of_friction",
            "profile": "afm_sharp_tip",
            "training_view": "nanoscale_afm",
            "training_views": ["nanoscale_afm"],
        }
    )


def field_evidence(record: Record) -> str:
    page = 3
    sample_id = record.sample_id
    source_label = record.source_figure
    is_figure = record.source_figure == "Fig. 3"

    value_ev = evidence(
        source_type=record.source_type,
        page=page,
        source_label=source_label,
        quote=record.evidence_quote,
        bbox=record.evidence_bbox,
        sample_id=sample_id,
        matched_text=f"{record.mol_ratio}; {record.potential}; mu={record.cof_raw}",
    )
    system_ev = evidence(
        source_type="figure",
        page=2,
        source_label="Fig. 2 caption",
        quote=SYSTEM_QUOTE,
        bbox=FIG2_CAPTION_BBOX,
        sample_id=sample_id,
        matched_text="silicon AFM tip; Au(111); 6.5 um/s; up to 100 nN",
    )
    roughness_ev = evidence(
        source_type="text",
        page=3,
        source_label="Text near Fig. 3",
        quote=ROUGHNESS_QUOTE,
        bbox=ROUGHNESS_BBOX,
        sample_id=sample_id,
        matched_text="gold (RMS = 1.0 +/- 0.5)",
    )
    context_ev = evidence(
        source_type="text",
        page=3,
        source_label="Text discussing Fig. 3",
        quote=FIG3_QUOTE,
        bbox=FIG3_TEXT_BBOX,
        sample_id=sample_id,
        matched_text="boundary layer; different applied potentials",
    )
    water_ev = evidence(
        source_type="text",
        page=2,
        source_label="Experimental text",
        quote=WATER_QUOTE,
        bbox=WATER_BBOX,
        sample_id=sample_id,
        matched_text="<0.2 wt%",
    )

    fields = {
        "material": field_entry("Au(111)", record.confidence, system_ev),
        "ionic_liquid": field_entry(record.lubricant, record.confidence, value_ev, source_anchor=is_figure),
        "cof": field_entry(record.cof_raw, record.confidence, value_ev, source_anchor=is_figure),
        "load": field_entry("up to 100 nN", record.confidence, system_ev),
        "speed": field_entry("6.5 μm/s", record.confidence, system_ev),
        "mol_ratio": field_entry(record.mol_ratio, record.confidence, value_ev, source_anchor=is_figure),
        "potential": field_entry(record.potential, record.confidence, value_ev, source_anchor=is_figure),
        "regime": field_entry("boundary", record.confidence, context_ev),
        "surface_roughness": field_entry("Au(111) RMS = 1.0 +/- 0.5 nm", record.confidence, roughness_ev),
        "substrate_roughness": field_entry("Au(111) RMS = 1.0 +/- 0.5 nm", record.confidence, roughness_ev),
        "water_content": field_entry("<0.2 wt%", record.confidence, water_ev),
        "source_page": field_entry(f"Page {page}", record.confidence, value_ev, source_anchor=is_figure),
    }
    if record.lubricant == IL:
        fields["ionic_liquid"]["literature_alias"] = "IL"
    if record.concentration_value is not None and 0 < record.concentration_value < 100:
        fields["compound_hexadecane"] = field_entry(HEX, record.confidence, value_ev, source_anchor=is_figure)
    return json_dumps(fields)


def table1_records() -> list[Record]:
    rows = [
        (99, HEX, None, None, None, 0.89, "0.89", "0 mol% IL (hexadecane)"),
        (100, IL, CATION, ANION, 0.001, 0.50, "0.50", "0.001 mol% IL"),
        (101, IL, CATION, ANION, 1.0, 0.46, "0.46", "1 mol% IL"),
        (102, IL, CATION, ANION, 5.0, 0.46, "0.46", "5 mol% IL"),
        (103, IL, CATION, ANION, 100.0, 0.47, "0.47", "100 mol% IL (pure IL)"),
    ]
    records = []
    for id_, lubricant, cation, anion, concentration, cof, raw, mol_ratio in rows:
        records.append(
            Record(
                id=id_,
                cof=cof,
                cof_raw=raw,
                mol_ratio=mol_ratio,
                concentration_value=concentration,
                potential="OCP (no applied potential)",
                source_figure="Table 1",
                evidence_bbox=TABLE1_BBOX,
                evidence_quote=TABLE1_QUOTE,
                source_type="table",
                lubricant=lubricant,
                cation=cation,
                anion=anion,
                cation_smiles=CATION_SMILES if cation else None,
                anion_smiles=ANION_SMILES if anion else None,
                sample_id=f"Table 1 {mol_ratio}",
                series_id="rutland-2016-tribotronic-table1-ocp",
                confidence=0.99,
            )
        )
    return records


def fig3_records() -> list[Record]:
    rows = [
        (104, 1.0, "1 mol% IL", "+1 V", 0.588),
        (105, 1.0, "1 mol% IL", "0.15 V (OCP)", 0.395),
        (106, 1.0, "1 mol% IL", "-1 V", 0.608),
        (107, 5.0, "5 mol% IL", "+1 V", 0.695),
        (108, 5.0, "5 mol% IL", "-0.15 V (OCP)", 0.424),
        (109, 5.0, "5 mol% IL", "-0.5 V", 0.108),
        (110, 10.0, "10 mol% IL", "+1 V", 0.763),
        (111, 10.0, "10 mol% IL", "-0.15 V (OCP)", 0.314),
        (112, 10.0, "10 mol% IL", "-1 V", 0.079),
        (113, 100.0, "100 mol% IL (pure IL)", "+1 V", 0.840),
        (114, 100.0, "100 mol% IL (pure IL)", "0.1 V (OCP)", 0.478),
        (115, 100.0, "100 mol% IL (pure IL)", "-1 V", 0.015),
    ]
    records = []
    for id_, concentration, mol_ratio, potential, cof in rows:
        records.append(
            Record(
                id=id_,
                cof=cof,
                cof_raw=f"{cof:.3f}".rstrip("0").rstrip("."),
                mol_ratio=mol_ratio,
                concentration_value=concentration,
                potential=potential,
                source_figure="Fig. 3",
                evidence_bbox=FIG3_BBOX,
                evidence_quote=FIG3_QUOTE,
                source_type="figure",
                lubricant=IL,
                cation=CATION,
                anion=ANION,
                cation_smiles=CATION_SMILES,
                anion_smiles=ANION_SMILES,
                sample_id=f"Fig. 3 {mol_ratio} {potential}",
                series_id="rutland-2016-tribotronic-fig3-potential",
                confidence=0.97,
            )
        )
    return records


def insert_record(conn: sqlite3.Connection, record: Record, extracted_at: str) -> None:
    conn.execute(
        """
        INSERT INTO tribology_data (
            id, literature_id, material_name, lubricant, cof_value, cof_raw,
            load_value, load_raw, speed_value, temperature, potential,
            water_content, surface_roughness, mol_ratio, cation, anion,
            cation_smiles, anion_smiles, extracted_at, confidence, evidence,
            evidence_page, evidence_bbox, source, source_page, source_figure,
            probe_material, probe_geometry, probe_radius, substrate_material,
            substrate_roughness, sample_id, series_id, field_evidence_json,
            review_status, record_origin, regime, lubricant_alias,
            lubricant_components_json, cof_extracted_json, load_conditions_json,
            tribological_system_json, speed_conditions_json
        )
        VALUES (
            :id, :literature_id, :material_name, :lubricant, :cof_value, :cof_raw,
            :load_value, :load_raw, :speed_value, :temperature, :potential,
            :water_content, :surface_roughness, :mol_ratio, :cation, :anion,
            :cation_smiles, :anion_smiles, :extracted_at, :confidence, :evidence,
            :evidence_page, :evidence_bbox, :source, :source_page, :source_figure,
            :probe_material, :probe_geometry, :probe_radius, :substrate_material,
            :substrate_roughness, :sample_id, :series_id, :field_evidence_json,
            :review_status, :record_origin, :regime, :lubricant_alias,
            :lubricant_components_json, :cof_extracted_json, :load_conditions_json,
            :tribological_system_json, :speed_conditions_json
        )
        """,
        {
            "id": record.id,
            "literature_id": LITERATURE_ID,
            "material_name": "Au(111)",
            "lubricant": record.lubricant,
            "cof_value": record.cof,
            "cof_raw": record.cof_raw,
            "load_value": "up to 100 nN",
            "load_raw": "up to 100 nN applied normal load",
            "speed_value": "6.5 μm/s",
            "temperature": None,
            "potential": record.potential,
            "water_content": "<0.2 wt%",
            "surface_roughness": "Au(111) RMS = 1.0 +/- 0.5 nm",
            "mol_ratio": record.mol_ratio,
            "cation": record.cation,
            "anion": record.anion,
            "cation_smiles": record.cation_smiles,
            "anion_smiles": record.anion_smiles,
            "extracted_at": extracted_at,
            "confidence": record.confidence,
            "evidence": record.evidence_quote,
            "evidence_page": 3,
            "evidence_bbox": json_dumps(record.evidence_bbox),
            "source": record.source_figure,
            "source_page": 3,
            "source_figure": record.source_figure,
            "probe_material": "silicon",
            "probe_geometry": "sharp AFM tip",
            "probe_radius": "8 nm",
            "substrate_material": "Au(111)",
            "substrate_roughness": "1.0 +/- 0.5 nm",
            "sample_id": record.sample_id,
            "series_id": record.series_id,
            "field_evidence_json": field_evidence(record),
            "review_status": "approved",
            "record_origin": "deterministic_reextract",
            "regime": "boundary",
            "lubricant_alias": "base oil control" if record.cation is None else ("pure IL" if record.concentration_value == 100 else None),
            "lubricant_components_json": lubricant_components(record),
            "cof_extracted_json": cof_payload(record),
            "load_conditions_json": load_conditions(),
            "tribological_system_json": tribological_system(),
            "speed_conditions_json": speed_conditions(),
        },
    )


def main() -> None:
    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    backup_path = DB_PATH.with_name(f"{DB_PATH.stem}.before-lit25-deterministic-reextract-{timestamp}{DB_PATH.suffix}")
    shutil.copy2(DB_PATH, backup_path)

    records = table1_records() + fig3_records()
    extracted_at = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")

    conn = sqlite3.connect(DB_PATH)
    try:
        with conn:
            conn.execute("DELETE FROM record_candidates WHERE literature_id = ?", (LITERATURE_ID,))
            conn.execute("DELETE FROM tribology_data WHERE literature_id = ?", (LITERATURE_ID,))
            for record in records:
                insert_record(conn, record, extracted_at)
            conn.execute(
                """
                UPDATE literature
                   SET status = 'completed',
                       file_path = ?
                 WHERE id = ?
                """,
                (PDF_PATH, LITERATURE_ID),
            )
    finally:
        conn.close()

    print(f"backup: {backup_path}")
    print(f"inserted_records: {len(records)}")
    print("series:")
    print("  Table 1 OCP concentration sweep: 5")
    print("  Fig. 3 potential sweep: 12")


if __name__ == "__main__":
    main()
