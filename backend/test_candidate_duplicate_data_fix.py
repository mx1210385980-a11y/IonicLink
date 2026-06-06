from __future__ import annotations

import importlib.util
import json
import sqlite3
from pathlib import Path


def _load_data_fix_module():
    script_path = Path(__file__).resolve().parents[1] / "scripts" / "data-fixes" / "reject-duplicate-active-candidates-20260606.py"
    spec = importlib.util.spec_from_file_location("reject_duplicate_active_candidates", script_path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_duplicate_candidate_fix_rejects_later_active_duplicates(tmp_path):
    fix_module = _load_data_fix_module()
    db_path = tmp_path / "ioniclink.db"
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.execute(
        """
        create table record_candidates (
            id integer primary key,
            literature_id integer,
            promoted_record_id integer,
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
            "material": {"value": "Graphite", "evidence": {"page": 1, "quote": "graphite"}},
            "ionic_liquid": {"value": "[N88812][A4BMB]", "evidence": {"page": 1, "quote": "[N88812][A4BMB]"}},
            "cof": {"value": "0.0032", "evidence": {"page": 1, "quote": "mu ~= 0.0032"}},
        }
    )
    rows = [
        (1, 10, None, "Graphite", "[N8,8,8,12][A4BMB]", 0.0032, "0.0032", "Not specified", "Not specified", None, "298.15 K", None, None, None, None, None, None, field_map, "needs_evidence", "llm_extraction", "", "mu ~= 0.0032", 1, None),
        (2, 10, None, "Graphite", "[N8,8,8,12][A4BMB]", 0.0032, "0.0032", "Not specified", "Not specified", None, "298.15 K", None, None, None, None, None, None, field_map, "needs_evidence", "llm_extraction", "", "mu ~= 0.0032", 8, None),
        (3, 10, None, "Graphite", "[N8,8,8,12][A8BMB]", 0.0068, "0.0068", "Not specified", "Not specified", None, "298.15 K", None, None, None, None, None, None, field_map, "needs_evidence", "llm_extraction", "", "mu ~= 0.0068", 8, None),
    ]
    conn.executemany(
        """
        insert into record_candidates (
            id, literature_id, promoted_record_id, material_name, lubricant, cof_value, cof_raw,
            load_value, load_raw, speed_value, temperature, potential, water_content,
            probe_material, substrate_material, sample_id, series_id, field_evidence_json,
            review_status, record_origin, assembly_notes, evidence, source_page, source_figure
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        rows,
    )
    conn.commit()

    rejected = fix_module.apply_fixes(conn)

    assert rejected == [{"rejected_id": 2, "kept_id": 1}]
    statuses = {
        row["id"]: row["review_status"]
        for row in conn.execute("select id, review_status from record_candidates order by id")
    }
    assert statuses == {1: "needs_evidence", 2: "rejected", 3: "needs_evidence"}
    note = conn.execute("select assembly_notes from record_candidates where id = 2").fetchone()[0]
    assert "duplicate candidate of #1" in note
    conn.close()
