#!/usr/bin/env python3
from __future__ import annotations

import shutil
import sqlite3
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[1]
DB_PATH = REPO_ROOT / "backend" / "data" / "ioniclink.db"
DOI = "10.1021/acs.jpcc.0c10804"
USER_ID = 1

ASSEMBLY_NOTE = (
    "Codex reviewed JPCC 2021 Fig. 2 duplicate candidates; linked the repeated "
    "candidate batch to existing Library records and normalized potential-specific sample IDs."
)

ROWS: list[dict[str, Any]] = [
    {
        "record_id": 399,
        "candidate_ids": [256, 330],
        "sample_id": "atkin-2021-fig2a-ocp",
        "potential": "0 V vs OCP",
    },
    {
        "record_id": 400,
        "candidate_ids": [257, 331],
        "sample_id": "atkin-2021-fig2a-minus-1-0-v",
        "potential": "-1 V",
    },
    {
        "record_id": 401,
        "candidate_ids": [258, 332],
        "sample_id": "atkin-2021-fig2a-plus-1-0-v",
        "potential": "+1 V",
    },
    {
        "record_id": 402,
        "candidate_ids": [259, 333],
        "sample_id": "atkin-2021-fig2b-ocp",
        "potential": "0 V vs OCP",
    },
    {
        "record_id": 403,
        "candidate_ids": [260, 334],
        "sample_id": "atkin-2021-fig2b-plus-1-0-v",
        "potential": "+1 V",
    },
    {
        "record_id": 404,
        "candidate_ids": [261, 335],
        "sample_id": "atkin-2021-fig2b-minus-1-0-v",
        "potential": "-1 V",
    },
    {
        "record_id": 405,
        "candidate_ids": [262, 336],
        "sample_id": "atkin-2021-fig2c-ocp",
        "potential": "0 V vs OCP",
    },
    {
        "record_id": 406,
        "candidate_ids": [263, 337],
        "sample_id": "atkin-2021-fig2c-minus-1-0-v",
        "potential": "-1 V",
    },
    {
        "record_id": 407,
        "candidate_ids": [264, 338],
        "sample_id": "atkin-2021-fig2c-plus-1-0-v",
        "potential": "+1 V",
    },
    {
        "record_id": 408,
        "candidate_ids": [265, 339],
        "sample_id": "atkin-2021-fig2d-ocp",
        "potential": "0 V vs OCP",
    },
    {
        "record_id": 409,
        "candidate_ids": [266, 340],
        "sample_id": "atkin-2021-fig2d-plus-1-0-v",
        "potential": "+1 V",
    },
    {
        "record_id": 410,
        "candidate_ids": [267, 341],
        "sample_id": "atkin-2021-fig2d-minus-1-0-v",
        "potential": "-1 V",
    },
]


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def backup_database(db_path: Path) -> Path:
    backup_path = db_path.with_suffix(db_path.suffix + f".bak-jpcc-2021-330-341-{int(time.time())}")
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


def update_records_and_candidates(conn: sqlite3.Connection, lit_id: int, now: str) -> tuple[int, int]:
    updated_records = 0
    linked_candidates = 0

    for row in ROWS:
        record = conn.execute(
            "SELECT id FROM tribology_data WHERE id = ? AND literature_id = ?",
            (row["record_id"], lit_id),
        ).fetchone()
        if not record:
            continue

        conn.execute(
            """
            UPDATE tribology_data
               SET sample_id = ?,
                   potential = ?,
                   review_status = 'approved',
                   record_origin = 'codex_reviewed_condition',
                   confidence = 0.96,
                   extracted_at = ?,
                   assembly_notes = ?
             WHERE id = ?
            """,
            (row["sample_id"], row["potential"], now, ASSEMBLY_NOTE, row["record_id"]),
        )
        updated_records += 1

        for candidate_id in row["candidate_ids"]:
            candidate = conn.execute(
                "SELECT id FROM record_candidates WHERE id = ?",
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
                       sample_id = ?,
                       potential = ?,
                       record_origin = 'codex_reviewed_condition',
                       confidence = 0.96,
                       assembly_notes = ?
                 WHERE id = ?
                """,
                (
                    row["record_id"],
                    now,
                    row["sample_id"],
                    row["potential"],
                    ASSEMBLY_NOTE,
                    candidate_id,
                ),
            )
            linked_candidates += 1

    return updated_records, linked_candidates


def update_literature(conn: sqlite3.Connection, lit_id: int, now: str) -> int:
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

    duplicate_count = 0
    for row in conn.execute(
        """
        SELECT id
          FROM literature
         WHERE doi = ?
           AND id <> ?
        """,
        (DOI, lit_id),
    ).fetchall():
        conn.execute(
            """
            UPDATE literature
               SET status = 'completed',
                   submission_status = 'approved',
                   promoted_literature_id = ?,
                   reviewed_at = ?,
                   reviewed_by_user_id = ?,
                   review_note = 'Duplicate upload reviewed by Codex and linked to group Library literature.'
             WHERE id = ?
            """,
            (lit_id, now, USER_ID, int(row["id"])),
        )
        duplicate_count += 1
    return duplicate_count


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
            updated_records, linked_candidates = update_records_and_candidates(conn, lit_id, now)
            duplicate_literature = update_literature(conn, lit_id, now)

        print(f"backup={backup_path}")
        print(f"literature_id={lit_id}")
        print(f"updated_records={updated_records}")
        print(f"linked_candidates={linked_candidates}")
        print(f"duplicate_literature_marked={duplicate_literature}")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
