import json
import sqlite3

from scripts.relocate_first_37_display_records import update_2025_rows


def test_update_2025_rows_writes_derived_speed_evidence_with_calculation() -> None:
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.execute(
        """
        CREATE TABLE tribology_data (
            id INTEGER PRIMARY KEY,
            literature_id INTEGER,
            source TEXT,
            source_page INTEGER,
            source_figure TEXT,
            evidence TEXT,
            evidence_page INTEGER,
            evidence_bbox TEXT,
            confidence REAL,
            potential TEXT,
            mol_ratio TEXT,
            surface_roughness TEXT,
            speed_value TEXT,
            speed_conditions_json TEXT,
            field_evidence_json TEXT,
            review_status TEXT,
            assembly_notes TEXT
        )
        """
    )
    for row_id in range(50, 58):
        conn.execute(
            "INSERT INTO tribology_data (id, speed_value, field_evidence_json) VALUES (?, '6', '{}')",
            (row_id,),
        )

    update_2025_rows(conn, 86)

    speed_value, speed_conditions_json, field_evidence_json = conn.execute(
        """
        SELECT speed_value, speed_conditions_json, field_evidence_json
          FROM tribology_data
         WHERE id = 50
        """
    ).fetchone()
    speed_conditions = json.loads(speed_conditions_json)
    field_map = json.loads(field_evidence_json)
    speed = field_map["speed"]

    assert speed_value == "6 μm/s"
    assert speed_conditions["value_type"] == "derived"
    assert speed_conditions["scan_length_um"] == 0.5
    assert speed_conditions["scan_rate_hz"] == 6
    assert speed["value"] == "6 μm/s"
    assert speed["grounding_mode"] == "derived"
    assert "v = 2 x 0.5 μm x 6 Hz = 6 μm/s" in speed["grounding_note"]
    assert "scan size was 500 nm" in speed["evidence"]["quote"]
    assert "scan rate was 6 Hz" in speed["evidence"]["quote"]
    assert speed["evidence"]["matched_text"] == speed["evidence"]["quote"]
    assert "Friction coefficient" not in speed["evidence"]["quote"]
