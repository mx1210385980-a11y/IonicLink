from __future__ import annotations

import importlib.util
import sqlite3
from pathlib import Path


def _load_seed_module():
    script_path = Path(__file__).resolve().parents[1] / "scripts" / "seed-codex-reviewed-library.py"
    spec = importlib.util.spec_from_file_location("seed_codex_reviewed_library", script_path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _load_data_fix_module():
    script_path = Path(__file__).resolve().parents[1] / "scripts" / "data-fixes" / "fix-codex-reviewed-seed-field-evidence-20260606.py"
    spec = importlib.util.spec_from_file_location("fix_codex_reviewed_seed_field_evidence", script_path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_codex_reviewed_seed_records_build_field_evidence_maps():
    module = _load_seed_module()

    for rows in module.RECORDS_BY_DOI.values():
        for row in rows:
            field_map = module.build_field_evidence_map(row)

            assert field_map["material"]["value"] == row["material_name"]
            assert field_map["ionic_liquid"]["value"] == row["lubricant"]
            for key, entry in field_map.items():
                assert entry["evidence"]["quote"] == row["evidence"]
                assert entry["evidence"]["source_label"] == row["source"]
                assert entry["grounding_mode"] == "curated_source_note"

            if row.get("cof_raw") or row.get("cof_value") is not None:
                assert field_map["cof"]["value"] == (row.get("cof_raw") or str(row.get("cof_value")))
            if row.get("load_raw") or row.get("load_value"):
                assert field_map["load"]["value"] == (row.get("load_raw") or row.get("load_value"))
            if row.get("speed_value"):
                assert field_map["speed"]["value"] == row["speed_value"]


def test_codex_reviewed_seed_fix_merges_missing_required_evidence(tmp_path):
    seed_module = _load_seed_module()
    fix_module = _load_data_fix_module()
    row = seed_module.RECORDS_BY_DOI["10.1380/ejssnt.2023-056"][0]
    db_path = tmp_path / "ioniclink.db"
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.executescript(
        """
        create table literature (
            id integer primary key,
            doi text
        );
        create table tribology_data (
            id integer primary key,
            literature_id integer,
            record_origin text,
            material_name text,
            lubricant text,
            evidence text,
            field_evidence_json text,
            assembly_notes text
        );
        """
    )
    conn.execute("insert into literature(id, doi) values (1, ?)", ("10.1380/ejssnt.2023-056",))
    conn.execute(
        """
        insert into tribology_data(
            id, literature_id, record_origin, material_name, lubricant, evidence,
            field_evidence_json, assembly_notes
        ) values (10, 1, 'codex_reviewed_condition', ?, ?, ?, ?, 'Existing note.')
        """,
        (
            row["material_name"],
            row["lubricant"],
            row["evidence"],
            '{"load":{"value":"3.5 N","evidence":{"quote":"load = 3.5 N"}}}',
        ),
    )
    conn.commit()

    updated = fix_module.apply_fixes(conn, seed_module)

    field_map = conn.execute("select field_evidence_json from tribology_data where id=10").fetchone()[0]
    parsed = seed_module.json.loads(field_map)
    assert updated == [10]
    assert parsed["load"]["value"] == "3.5 N"
    assert parsed["material"]["value"] == row["material_name"]
    assert parsed["ionic_liquid"]["value"] == row["lubricant"]
    assert "Field-level evidence map added" in conn.execute("select assembly_notes from tribology_data where id=10").fetchone()[0]
    conn.close()
