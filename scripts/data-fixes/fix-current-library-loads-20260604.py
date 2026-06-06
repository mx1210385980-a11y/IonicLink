#!/usr/bin/env python3
from __future__ import annotations

import json
import shutil
import sqlite3
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[2]
DB_PATH = REPO_ROOT / "backend" / "data" / "ioniclink.db"
USER_ID = 1
GROUP_ID = 1


def dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def backup_database(db_path: Path) -> Path:
    backup_path = db_path.with_suffix(db_path.suffix + f".bak-current-library-loads-20260604-{int(time.time())}")
    shutil.copy2(db_path, backup_path)
    return backup_path


FIXES = [
    {
        "doi": "10.1039/D0CP05110A",
        "expected_local_record_id": 499,
        "load_value": "0-250 nN",
        "load_raw": "loading and unloading between 0 to 250 nN",
        "source_page": 8,
        "source_label": "Section 3.2 / Fig. 6",
        "quote": (
            "Friction was measured during loading and unloading between 0 to 250 nN at "
            "three different sliding velocities (1, 6, 12 μm s−1)."
        ),
        "matched_text": "loading and unloading between 0 to 250 nN",
        "load_conditions": {
            "raw_text": "loading and unloading between 0 to 250 nN",
            "value_type": "range",
            "min": 0,
            "max": 250,
            "unit": "nN",
            "note": "AFM friction-force measurements used the 0-250 nN loading/unloading range.",
        },
        "note": "Codex补全PCCP 2020正式库记录的AFM载荷范围。",
    },
    {
        "doi": "10.1380/ejssnt.2023-056",
        "expected_local_record_id": 495,
        "load_value": "3.5 N",
        "load_raw": "load = 3.5 N; maximum Hertzian contact pressure = 1.3 GPa",
        "source_page": 3,
        "source_label": "Experimental / friction-test parameters",
        "quote": (
            "The operating parameters for the friction tests were as follows: temperature = "
            "room temperature (25°C), load = 3.5 N (maximum contact pressure as per the "
            "Hertzian formula = 1.3 GPa), sliding velocity = 52 mm s−1, and test duration = 60 min."
        ),
        "matched_text": "load = 3.5 N",
        "load_conditions": {
            "raw_text": "load = 3.5 N; maximum Hertzian contact pressure = 1.3 GPa",
            "value_type": "fixed",
            "value": 3.5,
            "unit": "N",
            "maximum_hertzian_contact_pressure": "1.3 GPa",
            "note": "Ball-on-disk friction tests used a fixed 3.5 N load.",
        },
        "note": "Codex补全EJSSNT 2023正式库记录的球盘试验载荷。",
    },
]


def patch_field_evidence(field_json: str | None, fix: dict[str, Any]) -> str:
    try:
        field_map = json.loads(field_json or "{}")
    except Exception:
        field_map = {}
    if not isinstance(field_map, dict):
        field_map = {}

    evidence = {
        "source_type": "text",
        "page": fix["source_page"],
        "source_label": fix["source_label"],
        "quote": fix["quote"],
        "bbox": None,
        "matched_text": fix["matched_text"],
    }
    field_map["load"] = {
        "value": fix["load_value"],
        "confidence": 0.97,
        "evidence": evidence,
        "grounding_mode": "explicit",
        "grounding_note": fix["note"],
    }
    field_map["normal_load"] = field_map["load"]
    return dumps(field_map)


def apply_fix(conn: sqlite3.Connection, fix: dict[str, Any], now: str) -> None:
    row = conn.execute(
        """
        SELECT t.id, t.literature_id, t.field_evidence_json, l.doi, l.title
          FROM tribology_data t
          JOIN literature l ON l.id = t.literature_id
         WHERE lower(l.doi) = lower(?)
           AND l.scope_type = 'group_library'
           AND l.scope_key = 'group_library'
         ORDER BY CASE WHEN t.load_value IS NULL OR trim(CAST(t.load_value AS TEXT)) = '' THEN 0 ELSE 1 END,
                  t.id
         LIMIT 1
        """,
        (fix["doi"],),
    ).fetchone()
    if not row:
        raise RuntimeError(f"No group Library record was found for DOI {fix['doi']}")
    record_id = int(row["id"])

    conn.execute(
        """
        UPDATE tribology_data
           SET load_value = ?,
               load_raw = ?,
               load_conditions_json = ?,
               field_evidence_json = ?,
               assembly_notes = CASE
                 WHEN assembly_notes IS NULL OR trim(assembly_notes) = '' THEN ?
                 WHEN instr(assembly_notes, ?) > 0 THEN assembly_notes
                 ELSE assembly_notes || ' ' || ?
               END
         WHERE id = ?
        """,
        (
            fix["load_value"],
            fix["load_raw"],
            dumps(fix["load_conditions"]),
            patch_field_evidence(row["field_evidence_json"], fix),
            fix["note"],
            fix["note"],
            fix["note"],
            record_id,
        ),
    )

    conn.execute(
        """
        INSERT INTO user_activity_logs (
            user_id, group_id, action_type, action_detail, resource_type, resource_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (
            USER_ID,
            GROUP_ID,
            "record_load_backfill",
            dumps(
                {
                    "record_id": record_id,
                    "expected_local_record_id": fix.get("expected_local_record_id"),
                    "literature_id": row["literature_id"],
                    "doi": fix["doi"],
                    "load_value": fix["load_value"],
                    "load_raw": fix["load_raw"],
                    "source_label": fix["source_label"],
                }
            ),
            "tribology_data",
            record_id,
            now,
        ),
    )


def main() -> None:
    if not DB_PATH.exists():
        raise SystemExit(f"Database not found: {DB_PATH}")

    backup_path = backup_database(DB_PATH)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    now = now_iso()
    try:
        with conn:
            for fix in FIXES:
                apply_fix(conn, fix, now)
    finally:
        conn.close()

    print(f"Backed up database to {backup_path}")
    for fix in FIXES:
        print(f"Updated group Library record for {fix['doi']}: {fix['load_value']}")


if __name__ == "__main__":
    main()
