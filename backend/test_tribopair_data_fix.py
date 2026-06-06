from __future__ import annotations

import importlib.util
import json
import sqlite3
from pathlib import Path


def _load_data_fix_module():
    script_path = Path(__file__).resolve().parents[1] / "scripts" / "data-fixes" / "normalize-tribopair-fields-20260606.py"
    spec = importlib.util.spec_from_file_location("normalize_tribopair_fields", script_path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _create_table(conn: sqlite3.Connection, table: str) -> None:
    conn.execute(
        f"""
        create table {table} (
            id integer primary key,
            literature_id integer,
            material_name text,
            lubricant text,
            probe_material text,
            probe_geometry text,
            probe_radius text,
            substrate_material text,
            substrate_coating text,
            field_evidence_json text,
            tribological_system_json text,
            review_status text,
            record_origin text,
            assembly_notes text
        )
        """
    )


def test_tribopair_fix_structures_clear_slash_pairs(tmp_path):
    fix_module = _load_data_fix_module()
    db_path = tmp_path / "ioniclink.db"
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    _create_table(conn, "tribology_data")
    _create_table(conn, "record_candidates")

    evidence_map = json.dumps(
        {
            "material": {
                "value": "sharp Si AFM tip / Au electrode",
                "evidence": {
                    "source_type": "curated_review",
                    "source_label": "Methods",
                    "quote": "AFM friction was measured with a sharp Si AFM tip on an Au electrode.",
                },
            }
        }
    )
    rows = [
        (
            495,
            124,
            "ionic liquid humidity tribotest",
            "[BMIM][FAP]",
            None,
            None,
            None,
            None,
            None,
            "{}",
            json.dumps({"scale": "macroscale", "method": "tribotest"}),
            "approved",
            "codex_reviewed_condition",
            "",
        ),
        (
            499,
            34,
            "sharp Si AFM tip / Au electrode",
            "[P6,6,6,14][BMB] in propylene carbonate",
            None,
            None,
            None,
            None,
            None,
            evidence_map,
            json.dumps({"scale": "nanoscale", "contact_geometry": "afm_tip_on_electrode"}),
            "approved",
            "codex_reviewed_condition",
            "",
        ),
        (
            500,
            127,
            "100Cr6 steel ball / 100Cr6 steel disc",
            "BMIMPF6",
            None,
            None,
            None,
            None,
            None,
            "{}",
            json.dumps({"scale": "macroscale", "contact_geometry": "ball_on_disc"}),
            "approved",
            "codex_reviewed_condition",
            "",
        ),
    ]
    conn.executemany(
        """
        insert into tribology_data (
            id, literature_id, material_name, lubricant, probe_material, probe_geometry,
            probe_radius, substrate_material, substrate_coating, field_evidence_json,
            tribological_system_json, review_status, record_origin, assembly_notes
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        rows,
    )
    conn.execute(
        """
        insert into record_candidates (
            id, literature_id, material_name, lubricant, probe_material, probe_geometry,
            probe_radius, substrate_material, substrate_coating, field_evidence_json,
            tribological_system_json, review_status, record_origin, assembly_notes
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            1,
            78,
            "SiO2 colloid probe / [BMIM][PF6] / mica",
            "[BMIM][PF6]",
            None,
            None,
            None,
            None,
            None,
            "{}",
            json.dumps({"scale": "nanoscale", "contact_geometry": "afm_colloidal_probe"}),
            "approved",
            "codex_reviewed_condition",
            "",
        ),
    )
    conn.commit()

    updated = fix_module.apply_fixes(conn)

    assert updated == {"record_candidates": 1, "tribology_data": 3}
    humidity = conn.execute("select * from tribology_data where id = 495").fetchone()
    assert humidity["material_name"] == "AISI 52100 steel ball / AISI 52100 steel disk"
    assert humidity["probe_material"] == "AISI 52100 steel ball"
    assert humidity["probe_geometry"] == "Ball"
    assert humidity["substrate_material"] == "AISI 52100 steel disk"

    record = conn.execute("select * from tribology_data where id = 499").fetchone()
    assert record["probe_material"] == "sharp Si AFM tip"
    assert record["probe_geometry"] == "AFM tip"
    assert record["substrate_material"] == "Au electrode"
    field_map = json.loads(record["field_evidence_json"])
    assert field_map["probe_material"]["value"] == "sharp Si AFM tip"
    assert field_map["substrate_material"]["value"] == "Au electrode"
    assert "tribopair normalized" in record["assembly_notes"]

    macro = conn.execute("select * from tribology_data where id = 500").fetchone()
    assert macro["probe_material"] == "100Cr6 steel ball"
    assert macro["probe_geometry"] == "Ball"
    assert macro["substrate_material"] == "100Cr6 steel disc"

    candidate = conn.execute("select * from record_candidates where id = 1").fetchone()
    assert candidate["probe_material"] == "SiO2 colloid probe"
    assert candidate["probe_geometry"] == "Colloid probe"
    assert candidate["substrate_material"] == "mica"
    conn.close()
