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
DOI = "10.1021/la3010807"
USER_ID = 1

ASSEMBLY_NOTE = (
    "Codex reviewed Langmuir 2012 Fig. 3b duplicate candidates; linked repeated "
    "candidate rows to existing Library records and restored probe-radius metadata from Table 1."
)
SPEED_CONDITIONS = {
    "raw_text": "Friction measurements were made over distances of 10 μm at a rate of 20 μm/s.",
    "value_type": "direct",
    "sliding_velocity_um_s": 20,
    "unit_warning": False,
}
LOAD_CONDITIONS = {
    "raw_text": "Applied loads were 0-80 nN; Figure 3 compares friction at 35 nN and friction coefficients.",
    "value_type": "range",
    "load_min_nN": 0,
    "load_max_nN": 80,
    "comparison_load_nN": 35,
}

ROWS: list[dict[str, Any]] = [
    {
        "record_id": 339,
        "candidate_ids": [181, 185],
        "sample_id": "atkin-2012-silica-silica",
        "material_name": "Silica colloid probe / [EA][NO3] / silica surface",
        "substrate_material": "Silica",
        "probe_material": "Silica",
        "probe_radius": "4.4 ± 0.4 μm",
        "cof_value": 0.15,
        "cof_raw": "0.15",
    },
    {
        "record_id": 340,
        "candidate_ids": [182, 186],
        "sample_id": "atkin-2012-silica-ptfe",
        "material_name": "Silica colloid probe / [EA][NO3] / PTFE surface",
        "substrate_material": "PTFE",
        "probe_material": "Silica",
        "probe_radius": "4.4 ± 0.4 μm",
        "cof_value": 0.10,
        "cof_raw": "0.10",
    },
    {
        "record_id": 338,
        "candidate_ids": [183, 187],
        "sample_id": "atkin-2012-alumina-silica",
        "material_name": "Alumina colloid probe / [EA][NO3] / silica surface",
        "substrate_material": "Silica",
        "probe_material": "Alumina",
        "probe_radius": "3.3 ± 0.2 μm",
        "cof_value": 0.20,
        "cof_raw": "0.20",
    },
    {
        "record_id": 341,
        "candidate_ids": [184, 188],
        "sample_id": "atkin-2012-alumina-ptfe",
        "material_name": "Alumina colloid probe / [EA][NO3] / PTFE surface",
        "substrate_material": "PTFE",
        "probe_material": "Alumina",
        "probe_radius": "3.3 ± 0.2 μm",
        "cof_value": 0.25,
        "cof_raw": "0.25",
    },
]


def dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def backup_database(db_path: Path) -> Path:
    backup_path = db_path.with_suffix(db_path.suffix + f".bak-langmuir-2012-181-184-{int(time.time())}")
    shutil.copy2(db_path, backup_path)
    return backup_path


def find_group_library_literature(conn: sqlite3.Connection) -> int:
    row = conn.execute(
        """
        SELECT id
          FROM literature
         WHERE doi = ?
           AND scope_type = 'group_library'
           AND scope_key = 'group_library'
         ORDER BY id
         LIMIT 1
        """,
        (DOI,),
    ).fetchone()
    if not row:
        raise RuntimeError(f"No group Library literature found for DOI {DOI}")
    return int(row["id"])


def patch_field_evidence(field_json: str | None, row: dict[str, Any]) -> str:
    try:
        field_map = json.loads(field_json or "{}")
    except Exception:
        field_map = {}
    if not isinstance(field_map, dict):
        field_map = {}

    table_evidence = {
        "source_type": "table",
        "page": 5,
        "source_label": "Table 1 / Fig. 3b",
        "quote": "Table 1 reports silica probe radius 4.4 ± 0.4 μm and alumina probe radius 3.3 ± 0.2 μm; Fig. 3b reports EAN friction coefficients.",
        "bbox": None,
        "matched_text": row["sample_id"],
    }
    field_map.update(
        {
            "probe_radius": {
                "value": row["probe_radius"],
                "confidence": 0.93,
                "evidence": table_evidence,
            },
            "speed": {
                "value": "20 μm/s",
                "confidence": 0.94,
                "evidence": {
                    "source_type": "text",
                    "page": 5,
                    "source_label": "Friction measurements",
                    "quote": "Friction measurements were made over distances of 10 μm at a rate of 20 μm/s.",
                    "bbox": None,
                    "matched_text": "20 μm/s",
                },
            },
            "load": {
                "value": "0-80 nN",
                "confidence": 0.92,
                "evidence": table_evidence,
            },
        }
    )
    return dumps(field_map)


def update_rows(conn: sqlite3.Connection, lit_id: int, now: str) -> tuple[int, int]:
    updated_records = 0
    linked_candidates = 0

    for row in ROWS:
        record = conn.execute(
            "SELECT id, field_evidence_json FROM tribology_data WHERE id = ? AND literature_id = ?",
            (row["record_id"], lit_id),
        ).fetchone()
        if not record:
            continue

        conn.execute(
            """
            UPDATE tribology_data
               SET material_name = ?,
                   lubricant = '[EA][NO3]',
                   cof_value = ?,
                   cof_raw = ?,
                   load_value = '0-80 nN',
                   load_raw = '0-80 nN',
                   load_conditions_json = ?,
                   speed_value = '20 μm/s',
                   speed_conditions_json = ?,
                   temperature = '298.15 K',
                   probe_material = ?,
                   probe_geometry = 'Colloid probe',
                   probe_radius = ?,
                   substrate_material = ?,
                   sample_id = ?,
                   series_id = 'atkin-2012-ean-tribopairs',
                   cation = 'EA',
                   anion = 'NO3',
                   source_page = 5,
                   source_figure = 'Fig. 3b',
                   evidence_page = 5,
                   field_evidence_json = ?,
                   review_status = 'approved',
                   record_origin = 'codex_reviewed_condition',
                   confidence = 0.96,
                   extracted_at = ?,
                   assembly_notes = ?
             WHERE id = ?
            """,
            (
                row["material_name"],
                row["cof_value"],
                row["cof_raw"],
                dumps(LOAD_CONDITIONS),
                dumps(SPEED_CONDITIONS),
                row["probe_material"],
                row["probe_radius"],
                row["substrate_material"],
                row["sample_id"],
                patch_field_evidence(record["field_evidence_json"], row),
                now,
                ASSEMBLY_NOTE,
                row["record_id"],
            ),
        )
        updated_records += 1

        for candidate_id in row["candidate_ids"]:
            candidate = conn.execute(
                "SELECT id, field_evidence_json FROM record_candidates WHERE id = ?",
                (candidate_id,),
            ).fetchone()
            if not candidate:
                continue
            conn.execute(
                """
                UPDATE record_candidates
                   SET promoted_record_id = ?,
                       promoted_at = COALESCE(promoted_at, ?),
                       review_status = 'approved',
                       material_name = ?,
                       lubricant = '[EA][NO3]',
                       cof_value = ?,
                       cof_raw = ?,
                       load_value = '0-80 nN',
                       load_raw = '0-80 nN',
                       load_conditions_json = ?,
                       speed_value = '20 μm/s',
                       speed_conditions_json = ?,
                       temperature = '298.15 K',
                       probe_material = ?,
                       probe_geometry = 'Colloid probe',
                       probe_radius = ?,
                       substrate_material = ?,
                       sample_id = ?,
                       series_id = 'atkin-2012-ean-tribopairs',
                       cation = 'EA',
                       anion = 'NO3',
                       source_page = 5,
                       source_figure = 'Fig. 3b',
                       evidence_page = 5,
                       field_evidence_json = ?,
                       record_origin = 'codex_reviewed_condition',
                       confidence = 0.96,
                       assembly_notes = ?
                 WHERE id = ?
                """,
                (
                    row["record_id"],
                    now,
                    row["material_name"],
                    row["cof_value"],
                    row["cof_raw"],
                    dumps(LOAD_CONDITIONS),
                    dumps(SPEED_CONDITIONS),
                    row["probe_material"],
                    row["probe_radius"],
                    row["substrate_material"],
                    row["sample_id"],
                    patch_field_evidence(candidate["field_evidence_json"], row),
                    ASSEMBLY_NOTE,
                    candidate_id,
                ),
            )
            linked_candidates += 1

    return updated_records, linked_candidates


def update_literature(conn: sqlite3.Connection, lit_id: int, now: str) -> None:
    conn.execute(
        """
        UPDATE literature
           SET status = 'completed',
               submission_status = 'approved',
               reviewed_at = ?,
               reviewed_by_user_id = ?,
               review_note = ?
         WHERE id = ?
        """,
        (now, USER_ID, ASSEMBLY_NOTE, lit_id),
    )


def main() -> None:
    if not DB_PATH.exists():
        raise FileNotFoundError(DB_PATH)

    backup_path = backup_database(DB_PATH)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        now = now_iso()
        lit_id = find_group_library_literature(conn)
        with conn:
            updated_records, linked_candidates = update_rows(conn, lit_id, now)
            update_literature(conn, lit_id, now)
        print(f"backup={backup_path}")
        print(f"literature_id={lit_id}")
        print(f"updated_records={updated_records}")
        print(f"linked_candidates={linked_candidates}")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
