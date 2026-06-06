from __future__ import annotations

import importlib.util
import json
import sqlite3
from pathlib import Path


def _load_data_fix_module():
    script_path = Path(__file__).resolve().parents[1] / "scripts" / "data-fixes" / "reject-duplicate-final-records-20260606.py"
    spec = importlib.util.spec_from_file_location("reject_duplicate_final_records", script_path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_final_duplicate_fix_rejects_workspace_submission_duplicate(tmp_path):
    fix_module = _load_data_fix_module()
    db_path = tmp_path / "ioniclink.db"
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.execute(
        """
        create table tribology_data (
            id integer primary key,
            literature_id integer,
            material_name text,
            lubricant text,
            cof_value real,
            cof_raw text,
            load_value text,
            load_raw text,
            speed_value text,
            temperature text,
            potential text,
            water_content text,
            probe_material text,
            substrate_material text,
            sample_id text,
            series_id text,
            field_evidence_json text,
            review_status text,
            record_origin text,
            assembly_notes text,
            evidence text,
            source_page integer,
            source_figure text
        )
        """
    )
    field_map = json.dumps(
        {
            "material": {"value": "mica", "evidence": {"page": 11, "quote": "mica"}},
            "ionic_liquid": {"value": "[C10(C1Im)2][NTf2]", "evidence": {"page": 11, "quote": "[C10(C1Im)2][NTf2]"}},
            "cof": {"value": "0.107", "evidence": {"page": 11, "quote": "0.107"}},
        }
    )
    rows = [
        (10, 20, "mica", "[C10(C1Im)2][NTf2]", 0.107, "0.107", None, None, None, None, None, None, None, None, None, None, field_map, "approved", "review_promoted_candidate", "", "Figure 2 reports 0.107.", 11, "Fig. 2"),
        (11, 20, "mica", "[C10(C1Im)2][NTf2]", 0.107, "0.107", None, None, None, None, None, None, None, None, None, None, field_map, "approved", "workspace_submission", "", "Figure 2 reports 0.107.", 11, "Fig. 2"),
        (12, 20, "mica", "[C10(C1Im)2][NTf2]", 0.0594, "0.0594", None, None, None, None, None, None, None, None, None, None, field_map, "approved", "workspace_submission", "", "Figure 2 reports 0.0594.", 11, "Fig. 2"),
    ]
    conn.executemany(
        """
        insert into tribology_data (
            id, literature_id, material_name, lubricant, cof_value, cof_raw, load_value, load_raw,
            speed_value, temperature, potential, water_content, probe_material, substrate_material,
            sample_id, series_id, field_evidence_json, review_status, record_origin, assembly_notes,
            evidence, source_page, source_figure
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        rows,
    )
    conn.commit()

    rejected = fix_module.apply_fixes(conn)

    assert rejected == [{"rejected_id": 11, "kept_id": 10}]
    statuses = {
        row["id"]: row["review_status"]
        for row in conn.execute("select id, review_status from tribology_data order by id")
    }
    assert statuses == {10: "approved", 11: "rejected", 12: "approved"}
    note = conn.execute("select assembly_notes from tribology_data where id = 11").fetchone()[0]
    assert "duplicate final record of #10" in note
    conn.close()
