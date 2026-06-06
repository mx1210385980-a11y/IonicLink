#!/usr/bin/env python3
from __future__ import annotations

import json
import shutil
import sqlite3
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[1]
DB_PATH = REPO_ROOT / "backend" / "data" / "ioniclink.db"
DOI = "10.1007/s40544-021-0486-4"
USER_ID = 1

SPEED_VALUE = "20 μm/s"
SPEED_CONDITIONS = {
    "raw_text": "scan rate of 2 Hz and scan size of 5 μm × 5 μm",
    "value_type": "derived",
    "sliding_velocity_um_s": 20,
    "scan_rate_hz": 2,
    "scan_length_um": 5,
    "unit_warning": False,
    "calculation": "v = 2 x 5 μm x 2 Hz = 20 μm/s",
}
ASSEMBLY_NOTE = (
    "Codex reviewed Friction 2022 Table 1 records; linked stale candidates, "
    "restored derived AFM sliding speed, and removed duplicate no-sample-id records."
)


def dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def backup_database(db_path: Path) -> Path:
    backup_path = db_path.with_suffix(db_path.suffix + f".bak-friction-2022-10-19-{int(time.time())}")
    shutil.copy2(db_path, backup_path)
    return backup_path


def patch_field_evidence(field_json: str | None, *, speed_value: str = SPEED_VALUE) -> str | None:
    try:
        field_map = json.loads(field_json or "{}")
    except Exception:
        field_map = {}
    if not isinstance(field_map, dict):
        field_map = {}
    speed_evidence = {
        "source_type": "text",
        "page": 3,
        "source_label": "Force measurements",
        "quote": "Si3N4 cantilever tips were employed with a scan rate of 2 Hz and scan size of 5 μm × 5 μm.",
        "bbox": None,
        "matched_text": "scan rate of 2 Hz and scan size of 5 μm × 5 μm",
    }
    field_map["speed"] = {
        "value": speed_value,
        "confidence": 0.94,
        "evidence": speed_evidence,
        "grounding_note": "Calculated as trace plus retrace: 2 x 5 μm x 2 Hz = 20 μm/s.",
    }
    field_map["probe_material"] = {
        "value": "Silicon nitride",
        "confidence": 0.93,
        "evidence": speed_evidence,
    }
    field_map["probe_radius"] = {
        "value": "20 nm",
        "confidence": 0.93,
        "evidence": speed_evidence,
    }
    return dumps(field_map)


ROWS = [
    (10, 266, "[P6,6,6,14][BScB]", "P6,6,6,14", "BScB", "1:70"),
    (11, 267, "[P6,6,6,14][BScB]", "P6,6,6,14", "BScB", "1:10"),
    (12, 268, "[P6,6,6,14][DCA]", "P6,6,6,14", "DCA", "1:70"),
    (13, 269, "[P6,6,6,14][DCA]", "P6,6,6,14", "DCA", "1:10"),
    (14, 270, "[P6,6,6,14][BOB]", "P6,6,6,14", "BOB", "1:70"),
    (15, 271, "[P6,6,6,14][BOB]", "P6,6,6,14", "BOB", "1:10"),
    (16, 272, "[P6,6,6,14][BMB]", "P6,6,6,14", "BMB", "1:70"),
    (17, 273, "[P6,6,6,14][BMB]", "P6,6,6,14", "BMB", "1:10"),
    (18, 274, "[P4,4,4,8][BScB]", "P4,4,4,8", "BScB", "1:70"),
    (19, 275, "[P4,4,4,8][BScB]", "P4,4,4,8", "BScB", "1:10"),
]

DUPLICATE_RECORD_MAP = {
    417: 266,
    418: 267,
    419: 268,
    420: 269,
    421: 270,
    422: 271,
    423: 272,
    424: 273,
    425: 274,
    426: 275,
}


def update_records(conn: sqlite3.Connection, lit_id: int) -> tuple[int, int, int, int]:
    now = now_iso()
    updated_records = 0
    linked_candidates = 0

    control_ids = [264, 265]
    for record_id in control_ids:
        row = conn.execute(
            "SELECT id, field_evidence_json FROM tribology_data WHERE id = ? AND literature_id = ?",
            (record_id, lit_id),
        ).fetchone()
        if not row:
            continue
        conn.execute(
            """
            UPDATE tribology_data
               SET speed_value = ?,
                   speed_conditions_json = ?,
                   probe_material = 'Silicon nitride',
                   probe_geometry = 'AFM tip',
                   probe_radius = '20 nm',
                   substrate_material = 'Titanium',
                   temperature = '298.15 K',
                   review_status = 'approved',
                   record_origin = 'codex_reviewed_condition',
                   confidence = 0.96,
                   extracted_at = ?,
                   field_evidence_json = ?,
                   assembly_notes = ?
             WHERE id = ?
            """,
            (
                SPEED_VALUE,
                dumps(SPEED_CONDITIONS),
                now,
                patch_field_evidence(row["field_evidence_json"]),
                ASSEMBLY_NOTE,
                record_id,
            ),
        )
        updated_records += 1

    for candidate_id, record_id, lubricant, cation, anion, mol_ratio in ROWS:
        record = conn.execute(
            "SELECT id, field_evidence_json FROM tribology_data WHERE id = ? AND literature_id = ?",
            (record_id, lit_id),
        ).fetchone()
        candidate = conn.execute(
            "SELECT id, field_evidence_json FROM record_candidates WHERE id = ? AND literature_id = ?",
            (candidate_id, lit_id),
        ).fetchone()
        if not record:
            continue
        conn.execute(
            """
            UPDATE tribology_data
               SET material_name = 'Si3N4 AFM tip / titanium substrate',
                   lubricant = ?,
                   speed_value = ?,
                   speed_conditions_json = ?,
                   probe_material = 'Silicon nitride',
                   probe_geometry = 'AFM tip',
                   probe_radius = '20 nm',
                   substrate_material = 'Titanium',
                   temperature = '298.15 K',
                   mol_ratio = ?,
                   cation = ?,
                   anion = ?,
                   review_status = 'approved',
                   record_origin = 'codex_reviewed_condition',
                   confidence = 0.96,
                   extracted_at = ?,
                   field_evidence_json = ?,
                   assembly_notes = ?
             WHERE id = ?
            """,
            (
                lubricant,
                SPEED_VALUE,
                dumps(SPEED_CONDITIONS),
                mol_ratio,
                cation,
                anion,
                now,
                patch_field_evidence(record["field_evidence_json"]),
                ASSEMBLY_NOTE,
                record_id,
            ),
        )
        updated_records += 1
        if candidate:
            conn.execute(
                """
                UPDATE record_candidates
                   SET promoted_record_id = ?,
                       promoted_at = ?,
                       review_status = 'approved',
                       material_name = 'Si3N4 AFM tip / titanium substrate',
                       speed_value = ?,
                       speed_conditions_json = ?,
                       probe_material = 'Silicon nitride',
                       probe_geometry = 'AFM tip',
                       probe_radius = '20 nm',
                       substrate_material = 'Titanium',
                       temperature = '298.15 K',
                       mol_ratio = ?,
                       cation = ?,
                       anion = ?,
                       field_evidence_json = ?,
                       assembly_notes = 'Codex reviewed and linked to Library Table 1 record; derived AFM speed restored.'
                 WHERE id = ?
                """,
                (
                    record_id,
                    now,
                    SPEED_VALUE,
                    dumps(SPEED_CONDITIONS),
                    mol_ratio,
                    cation,
                    anion,
                    patch_field_evidence(candidate["field_evidence_json"]),
                    candidate_id,
                ),
            )
            linked_candidates += 1

    for duplicate_id, canonical_id in DUPLICATE_RECORD_MAP.items():
        conn.execute(
            "UPDATE record_candidates SET promoted_record_id = ? WHERE promoted_record_id = ?",
            (canonical_id, duplicate_id),
        )

    duplicate_ids = list(DUPLICATE_RECORD_MAP)
    deleted_duplicates = 0
    if duplicate_ids:
        placeholders = ",".join("?" for _ in duplicate_ids)
        conn.execute(f"DELETE FROM tribology_data WHERE id IN ({placeholders})", duplicate_ids)
        deleted_duplicates = len(duplicate_ids)

    approved_count = conn.execute(
        "SELECT COUNT(*) FROM tribology_data WHERE literature_id = ? AND review_status = 'approved'",
        (lit_id,),
    ).fetchone()[0]
    return updated_records, linked_candidates, deleted_duplicates, int(approved_count)


def main() -> int:
    if not DB_PATH.exists():
        raise SystemExit(f"Database not found: {DB_PATH}")
    backup = backup_database(DB_PATH)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        literature = conn.execute(
            """
            SELECT id
              FROM literature
             WHERE lower(doi) = lower(?)
             ORDER BY
                   CASE WHEN scope_key = 'group_library' THEN 0 ELSE 1 END,
                   CASE WHEN status = 'completed' THEN 0 ELSE 1 END,
                   id
             LIMIT 1
            """,
            (DOI,),
        ).fetchone()
        if not literature:
            print(f"no matching literature for DOI {DOI}; backup={backup}")
            return 0
        lit_id = int(literature["id"])
        conn.execute(
            """
            UPDATE literature
               SET scope_type = 'group_library',
                   scope_key = 'group_library',
                   status = 'completed',
                   submission_status = 'approved',
                   reviewed_at = ?,
                   reviewed_by_user_id = ?,
                   review_note = 'Codex reviewed Table 1 candidates #10-19; linked to Library records and restored derived AFM speed.'
             WHERE id = ?
            """,
            (now_iso(), USER_ID, lit_id),
        )
        updated, linked, deleted, approved = update_records(conn, lit_id)
        conn.commit()
    finally:
        conn.close()

    print(f"backup={backup}")
    print(f"literature_id={lit_id}")
    print(f"updated_records={updated}")
    print(f"linked_candidates={linked}")
    print(f"deleted_duplicate_records={deleted}")
    print(f"approved_records_for_literature={approved}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
