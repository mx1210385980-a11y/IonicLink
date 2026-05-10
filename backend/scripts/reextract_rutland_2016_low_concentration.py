"""Deterministically rebuild records for Rutland 2016 low-concentration IL paper.

The generic vision/LLM extractor can misread the compact PDF table layout in
this article and treat "Table 1" as a lubricant label.  The two quantitative
tables are explicit in the article text, so this script rebuilds the paper's
COF records directly from Table 1 and Table 2 with page/table grounding.
"""

from __future__ import annotations

import json
import re
import sqlite3
import shutil
from dataclasses import dataclass
from datetime import datetime, UTC
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[2]
DB_PATH = ROOT / "backend" / "data" / "ioniclink.db"
LITERATURE_ID = 23


@dataclass(frozen=True)
class ExtractedRecord:
    source: str
    source_page: int
    source_figure: str
    evidence_bbox: list[float]
    evidence_quote: str
    material_name: str
    lubricant: str
    cof_raw: str
    cof_value: float | None
    mol_ratio: str
    load_value: str
    speed_value: str
    probe_material: str
    probe_geometry: str
    probe_radius: str | None
    substrate_material: str
    substrate_roughness: str | None
    surface_roughness: str | None
    regime: str
    sample_id: str
    series_id: str
    lubricant_alias: str | None = None
    cation: str | None = "[P6,6,6,14]+"
    anion: str | None = "[i(C8)2PO2]-"


TABLE1_BBOX = [42.52, 665.77, 291.98, 716.46]
TABLE2_BBOX = [303.3, 50.0, 541.5, 100.5]
FIG1_CAPTION_BBOX = [42.5, 616.8, 292.0, 644.3]
FIG2_CAPTION_BBOX = [42.5, 688.6, 292.0, 716.0]
MATERIAL_BBOX = [172.1, 267.0, 552.8, 336.0]

TABLE1_QUOTE = "Table 1. Nanoscale friction coefficients of IL-hexadecane mixtures in the linear regime."
TABLE2_QUOTE = "Table 2. Macroscale friction coefficients of IL-hexadecane mixtures."
FIG1_CAPTION_QUOTE = (
    "Fig. 1 caption reports a sharp silicon AFM tip sliding on silicon wafer at 6 μm/s up to 300 nN."
)
FIG2_CAPTION_QUOTE = (
    "Fig. 2 caption reports normal loads of 2 N and 10 N, sliding speed 50 mm/s, and sliding distance 20 m."
)
MATERIAL_QUOTE = (
    "The abstract states that silica surfaces are probed at nanoscale and macroscale using AFM and a ball-on-disc tribometer."
)

IL = "[P6,6,6,14][i(C8)2PO2]"
IL_PURE = "[P6,6,6,14][i(C8)2PO2]"
HEX = "hexadecane"


def cof_payload(raw: str, value: float | None, *, load: str | None = None) -> str:
    if "/" not in raw:
        number = value
        payload = {
            "raw_text": raw,
            "value_type": "single",
            "cof_min": number,
            "cof_max": number,
            "cof_average": number,
            "dependent_variable": None,
            "test_condition_value": load,
        }
    else:
        parts = [float(part.strip()) for part in raw.split("/") if part.strip()]
        payload = {
            "raw_text": raw,
            "value_type": "conditional",
            "cof_min": min(parts),
            "cof_max": max(parts),
            "cof_average": value,
            "dependent_variable": "sliding distance",
            "test_condition_value": load,
            "note": "Table reports 0.08/0.14 for the 10 mol% IL mixture at 10 N.",
            "segments": [
                {
                    "raw_text": "initial value 0.08",
                    "value_type": "conditional",
                    "cof_min": 0.08,
                    "cof_max": 0.08,
                    "cof_average": 0.08,
                    "dependent_variable": "sliding distance",
                    "test_condition_value": "initial",
                },
                {
                    "raw_text": "increased value 0.14",
                    "value_type": "conditional",
                    "cof_min": 0.14,
                    "cof_max": 0.14,
                    "cof_average": 0.14,
                    "dependent_variable": "sliding distance",
                    "test_condition_value": "after ~6 m",
                },
            ],
        }
    return json.dumps(payload, ensure_ascii=False)


def evidence_map(record: ExtractedRecord) -> str:
    table_evidence = {
        "source_type": "table",
        "page": record.source_page,
        "source_label": record.source_figure,
        "quote": record.evidence_quote,
        "bbox": record.evidence_bbox,
        "sample_id": record.sample_id,
        "matched_text": f"{record.mol_ratio} -> μ = {record.cof_raw}",
    }
    if record.source_figure == "Table 1":
        condition_evidence = {
            "source_type": "text",
            "page": 3,
            "source_label": "Fig. 1 caption",
            "quote": FIG1_CAPTION_QUOTE,
            "bbox": FIG1_CAPTION_BBOX,
            "sample_id": record.sample_id,
            "matched_text": "6 μm/s; up to 300 nN",
        }
        load_value_for_evidence = "up to 300 nN"
        speed_evidence = condition_evidence
    else:
        condition_evidence = table_evidence
        load_value_for_evidence = record.load_value
        speed_evidence = {
            "source_type": "text",
            "page": 4,
            "source_label": "Fig. 2 caption",
            "quote": FIG2_CAPTION_QUOTE,
            "bbox": FIG2_CAPTION_BBOX,
            "sample_id": record.sample_id,
            "matched_text": "sliding speed is 50 mm/s",
        }

    material_evidence = {
        "source_type": "text",
        "page": 1,
        "source_label": "Abstract",
        "quote": MATERIAL_QUOTE,
        "bbox": MATERIAL_BBOX,
        "sample_id": record.sample_id,
        "matched_text": "Silica surfaces",
    }

    values: dict[str, tuple[Any, dict[str, Any]]] = {
        "material": (record.material_name, material_evidence),
        "ionic_liquid": (record.lubricant, table_evidence),
        "cof": (record.cof_raw, table_evidence),
        "load": (load_value_for_evidence, condition_evidence),
        "speed": (record.speed_value, speed_evidence),
        "mol_ratio": (record.mol_ratio, table_evidence),
        "source": (record.source_figure, table_evidence),
    }
    components = json.loads(lubricant_components(record) or "[]")
    for component in components:
        compound = str(component.get("compound") or "").strip()
        role = str(component.get("role") or "").strip().lower()
        if compound and role != "ionic_liquid":
            slug = re.sub(r"[^a-z0-9]+", "_", compound.lower()).strip("_")
            values[f"compound_{slug}"] = (compound, table_evidence)

    payload: dict[str, Any] = {}
    for key, (value, evidence) in values.items():
        if value in (None, ""):
            continue
        entry = {"value": value, "confidence": 0.99, "evidence": evidence}
        if key == "ionic_liquid" and "[" in str(value):
            entry["literature_alias"] = "IL"
        payload[key] = entry
    return json.dumps(payload, ensure_ascii=False)


def _mol_percent(label: str) -> float | None:
    text = str(label or "").strip().lower()
    if "hexadecane" in text and "0 mol%" in text:
        return 0.0
    if "pure il" in text or "100 mol%" in text:
        return 100.0
    match = re.search(r"(\d+(?:\.\d+)?)\s*mol%\s*il", text)
    if not match:
        return None
    return float(match.group(1))


def lubricant_components(record: ExtractedRecord) -> str | None:
    percent = _mol_percent(record.mol_ratio)
    if percent is None:
        return None
    if percent <= 0:
        return json.dumps([{"compound": HEX, "fraction": 100, "unit": "mol%", "role": "base_oil"}], ensure_ascii=False)
    if percent >= 100:
        return json.dumps([{"compound": IL, "fraction": 100, "unit": "mol%", "role": "ionic_liquid"}], ensure_ascii=False)
    return json.dumps(
        [
            {"compound": IL, "fraction": percent, "unit": "mol%", "role": "ionic_liquid"},
            {"compound": HEX, "fraction": round(100 - percent, 6), "unit": "mol%", "role": "base_oil"},
        ],
        ensure_ascii=False,
    )


def table1_records() -> list[ExtractedRecord]:
    rows = [
        ("hexadecane", "0 mol% IL (hexadecane)", "0.57", 0.57, "base oil control", None, None),
        (IL, "0.01 mol% IL", "0.40", 0.40, None, "[P6,6,6,14]+", "[i(C8)2PO2]-"),
        (IL, "1 mol% IL", "0.40", 0.40, None, "[P6,6,6,14]+", "[i(C8)2PO2]-"),
        (IL, "2 mol% IL", "0.37", 0.37, None, "[P6,6,6,14]+", "[i(C8)2PO2]-"),
        (IL, "10 mol% IL", "0.39", 0.39, None, "[P6,6,6,14]+", "[i(C8)2PO2]-"),
        (IL_PURE, "100 mol% IL (pure IL)", "0.34", 0.34, "pure IL", "[P6,6,6,14]+", "[i(C8)2PO2]-"),
    ]
    records: list[ExtractedRecord] = []
    for lubricant, mol_ratio, raw, value, alias, cation, anion in rows:
        records.append(
            ExtractedRecord(
                source="Table 1",
                source_page=3,
                source_figure="Table 1",
                evidence_bbox=TABLE1_BBOX,
                evidence_quote=TABLE1_QUOTE,
                material_name="silica",
                lubricant=lubricant,
                cof_raw=raw,
                cof_value=value,
                mol_ratio=mol_ratio,
                load_value="linear regime (>30 nN; up to 300 nN)",
                speed_value="6 μm/s",
                probe_material="silicon",
                probe_geometry="AFM tip",
                probe_radius="8 nm",
                substrate_material="silica",
                substrate_roughness="0.5 ± 0.3 nm",
                surface_roughness="0.5 ± 0.3 nm",
                regime="boundary",
                sample_id=f"Table 1 {mol_ratio}",
                series_id="rutland-2016-table1-nanoscale-il-hexadecane",
                lubricant_alias=alias,
                cation=cation,
                anion=anion,
            )
        )
    return records


def table2_records() -> list[ExtractedRecord]:
    samples = [
        ("hexadecane", "0 mol% IL (hexadecane)", "base oil control", None, None),
        (IL, "0.01 mol% IL", None, "[P6,6,6,14]+", "[i(C8)2PO2]-"),
        (IL, "1 mol% IL", None, "[P6,6,6,14]+", "[i(C8)2PO2]-"),
        (IL, "10 mol% IL", None, "[P6,6,6,14]+", "[i(C8)2PO2]-"),
        (IL_PURE, "100 mol% IL (pure IL)", "pure IL", "[P6,6,6,14]+", "[i(C8)2PO2]-"),
    ]
    values = {
        "2 N": ["0.11", "0.06", "0.06", "0.05", "0.06"],
        "10 N": ["0.12", "0.12", "0.12", "0.08/0.14", "0.08"],
    }
    records: list[ExtractedRecord] = []
    for load, raw_values in values.items():
        for (lubricant, mol_ratio, alias, cation, anion), raw in zip(samples, raw_values):
            value = None if raw == "0.08/0.14" else float(raw)
            if raw == "0.08/0.14":
                value = 0.11
            records.append(
                ExtractedRecord(
                    source="Table 2",
                    source_page=4,
                    source_figure="Table 2",
                    evidence_bbox=TABLE2_BBOX,
                    evidence_quote=TABLE2_QUOTE,
                    material_name="silica",
                    lubricant=lubricant,
                    cof_raw=raw,
                    cof_value=value,
                    mol_ratio=mol_ratio,
                    load_value=load,
                    speed_value="50 mm/s",
                    probe_material="silicon nitride",
                    probe_geometry="ball-on-disk",
                    probe_radius=None,
                    substrate_material="silica",
                    substrate_roughness="2 ± 1 nm",
                    surface_roughness="2 ± 1 nm",
                    regime="mixed",
                    sample_id=f"Table 2 {mol_ratio} {load}",
                    series_id="rutland-2016-table2-macroscale-il-hexadecane",
                    lubricant_alias=alias,
                    cation=cation,
                    anion=anion,
                )
            )
    return records


def insert_record(conn: sqlite3.Connection, record: ExtractedRecord, extracted_at: str) -> None:
    conn.execute(
        """
        INSERT INTO tribology_data (
            literature_id, material_name, lubricant, cof_value, cof_raw,
            load_value, load_raw, speed_value, surface_roughness,
            mol_ratio, cation, anion, extracted_at, confidence, evidence,
            evidence_page, evidence_bbox, source, source_page, source_figure,
            probe_material, probe_geometry, probe_radius, substrate_material,
            substrate_roughness, sample_id, series_id, field_evidence_json,
            review_status, record_origin, regime, lubricant_alias,
            lubricant_components_json, cof_extracted_json
        )
        VALUES (
            :literature_id, :material_name, :lubricant, :cof_value, :cof_raw,
            :load_value, :load_raw, :speed_value, :surface_roughness,
            :mol_ratio, :cation, :anion, :extracted_at, :confidence, :evidence,
            :evidence_page, :evidence_bbox, :source, :source_page, :source_figure,
            :probe_material, :probe_geometry, :probe_radius, :substrate_material,
            :substrate_roughness, :sample_id, :series_id, :field_evidence_json,
            :review_status, :record_origin, :regime, :lubricant_alias,
            :lubricant_components_json, :cof_extracted_json
        )
        """,
        {
            "literature_id": LITERATURE_ID,
            "material_name": record.material_name,
            "lubricant": record.lubricant,
            "cof_value": record.cof_value,
            "cof_raw": record.cof_raw,
            "load_value": record.load_value,
            "load_raw": record.load_value,
            "speed_value": record.speed_value,
            "surface_roughness": record.surface_roughness,
            "mol_ratio": record.mol_ratio,
            "cation": record.cation,
            "anion": record.anion,
            "extracted_at": extracted_at,
            "confidence": 0.99,
            "evidence": record.evidence_quote,
            "evidence_page": record.source_page,
            "evidence_bbox": json.dumps(record.evidence_bbox),
            "source": record.source,
            "source_page": record.source_page,
            "source_figure": record.source_figure,
            "probe_material": record.probe_material,
            "probe_geometry": record.probe_geometry,
            "probe_radius": record.probe_radius,
            "substrate_material": record.substrate_material,
            "substrate_roughness": record.substrate_roughness,
            "sample_id": record.sample_id,
            "series_id": record.series_id,
            "field_evidence_json": evidence_map(record),
            "review_status": "approved",
            "record_origin": "deterministic_reextract",
            "regime": record.regime,
            "lubricant_alias": record.lubricant_alias,
            "lubricant_components_json": lubricant_components(record),
            "cof_extracted_json": cof_payload(record.cof_raw, record.cof_value, load=record.load_value),
        },
    )


def main() -> None:
    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    backup_path = DB_PATH.with_name(f"{DB_PATH.stem}.before-lit23-deterministic-reextract-{timestamp}{DB_PATH.suffix}")
    shutil.copy2(DB_PATH, backup_path)

    records = table1_records() + table2_records()
    extracted_at = datetime.now(UTC).strftime("%Y-%m-%d %H:%M:%S")

    conn = sqlite3.connect(DB_PATH)
    try:
        with conn:
            conn.execute("DELETE FROM record_candidates WHERE literature_id = ?", (LITERATURE_ID,))
            conn.execute("DELETE FROM tribology_data WHERE literature_id = ?", (LITERATURE_ID,))
            for record in records:
                insert_record(conn, record, extracted_at)
            conn.execute("UPDATE literature SET status = 'completed' WHERE id = ?", (LITERATURE_ID,))
    finally:
        conn.close()

    print(f"backup: {backup_path}")
    print(f"inserted_records: {len(records)}")
    print("series:")
    print("  Table 1 nanoscale: 6")
    print("  Table 2 macroscale: 10")


if __name__ == "__main__":
    main()
