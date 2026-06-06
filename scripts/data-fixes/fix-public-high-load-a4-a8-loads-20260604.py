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
WORKSPACE_SLUG = "public-extractor-workspace"
DOI = "10.1021/acssuschemeng.5c10210"
USER_ID = 1
GROUP_ID = 1
NOTE = (
    "Codex corrected A4/A8 high-load paper normal-load values: AFM voltage setpoint "
    "was removed from load and replaced with the Figure 1 normal-load range."
)


FIXES = [
    {
        "lubricant": "[N88812][A4BMB]",
        "cof_raw": "0.0032",
        "load_value": "15-45 nN",
        "load_raw": "stable across the tested normal-load range in Fig. 1(b,c), approximately 15-45 nN",
        "conditions_note": "Figure 1(b,c) plots A4 over the normal-load axis from about 15 to 45 nN.",
        "quote": "A4 shows μ = 0.0032 across the Figure 1 normal-load range, approximately 15-45 nN.",
        "matched_text": "Normal Load, nN; μ=0.0032",
    },
    {
        "lubricant": "[N88812][A8BMB]",
        "cof_raw": "0.0068",
        "load_value": "15-45 nN",
        "load_raw": "stable across the tested normal-load range in Fig. 1(b,c), approximately 15-45 nN",
        "conditions_note": "Figure 1(b,c) plots A8 over the normal-load axis from about 15 to 45 nN.",
        "quote": "A8 shows μ = 0.0068 across the Figure 1 normal-load range, approximately 15-45 nN.",
        "matched_text": "Normal Load, nN; μ=0.0068",
    },
]


def dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def backup_database(db_path: Path) -> Path:
    backup_path = db_path.with_suffix(db_path.suffix + f".bak-public-high-load-a4-a8-20260604-{int(time.time())}")
    shutil.copy2(db_path, backup_path)
    return backup_path


def blank(value: Any) -> bool:
    return value is None or str(value).strip() == ""


def append_note(existing: str | None) -> str:
    if blank(existing):
        return NOTE
    if NOTE in str(existing):
        return str(existing)
    return f"{existing} {NOTE}"


def load_conditions(fix: dict[str, str]) -> str:
    return dumps(
        {
            "raw_text": fix["load_raw"],
            "value_type": "range",
            "min": 15,
            "max": 45,
            "unit": "nN",
            "note": fix["conditions_note"],
        }
    )


def patch_field_evidence(field_json: str | None, fix: dict[str, str]) -> str:
    try:
        field_map = json.loads(field_json or "{}")
    except Exception:
        field_map = {}
    if not isinstance(field_map, dict):
        field_map = {}

    entry = {
        "value": fix["load_value"],
        "confidence": 0.93,
        "evidence": {
            "source_type": "figure",
            "page": 3,
            "source_label": "Figure 1(b,c)",
            "quote": fix["quote"],
            "bbox": None,
            "matched_text": fix["matched_text"],
        },
        "grounding_mode": "explicit",
        "grounding_note": "Figure 1(b,c) uses normal load in nN; the AFM voltage setpoint is not stored as a load value.",
    }
    field_map["load"] = entry
    field_map["normal_load"] = entry
    return dumps(field_map)


def find_workspace_id(conn: sqlite3.Connection) -> int | None:
    row = conn.execute("SELECT id FROM workspaces WHERE slug = ? ORDER BY id LIMIT 1", (WORKSPACE_SLUG,)).fetchone()
    return int(row["id"]) if row else None


def find_literature_id(conn: sqlite3.Connection, workspace_id: int) -> int | None:
    row = conn.execute(
        """
        SELECT id
          FROM literature
         WHERE workspace_id = ?
           AND lower(coalesce(doi, '')) = lower(?)
         ORDER BY id
         LIMIT 1
        """,
        (workspace_id, DOI),
    ).fetchone()
    return int(row["id"]) if row else None


def log_activity(conn: sqlite3.Connection, now: str, candidate_id: int, fix: dict[str, str], before: dict[str, Any]) -> None:
    columns = {row["name"] for row in conn.execute("PRAGMA table_info(user_activity_logs)")}
    if not columns:
        return
    payload = {
        "user_id": USER_ID,
        "group_id": GROUP_ID,
        "action_type": "public_workspace_load_correction",
        "action_detail": dumps(
            {
                "doi": DOI,
                "candidate_id": candidate_id,
                "lubricant": fix["lubricant"],
                "cof_raw": fix["cof_raw"],
                "old_load_value": before.get("load_value"),
                "old_load_raw": before.get("load_raw"),
                "new_load_value": fix["load_value"],
                "new_load_raw": fix["load_raw"],
                "reason": "0-3.5 V is the AFM setpoint/control range, not a normal-load unit.",
            }
        ),
        "resource_type": "record_candidates",
        "resource_id": candidate_id,
        "created_at": now,
    }
    insert_columns = [column for column in payload if column in columns]
    placeholders = ",".join("?" for _ in insert_columns)
    conn.execute(
        f"INSERT INTO user_activity_logs ({','.join(insert_columns)}) VALUES ({placeholders})",
        [payload[column] for column in insert_columns],
    )


def apply_fix(conn: sqlite3.Connection, lit_id: int, now: str, fix: dict[str, str]) -> int:
    rows = conn.execute(
        """
        SELECT id, load_value, load_raw, field_evidence_json, assembly_notes
          FROM record_candidates
         WHERE literature_id = ?
           AND lubricant = ?
           AND cof_raw = ?
        """,
        (lit_id, fix["lubricant"], fix["cof_raw"]),
    ).fetchall()

    updated = 0
    for row in rows:
        before = dict(row)
        conn.execute(
            """
            UPDATE record_candidates
               SET load_value = ?,
                   load_raw = ?,
                   load_conditions_json = ?,
                   field_evidence_json = ?,
                   source_figure = COALESCE(source_figure, 'Figure 1(b,c)'),
                   assembly_notes = ?
             WHERE id = ?
            """,
            (
                fix["load_value"],
                fix["load_raw"],
                load_conditions(fix),
                patch_field_evidence(row["field_evidence_json"], fix),
                append_note(row["assembly_notes"]),
                row["id"],
            ),
        )
        log_activity(conn, now, int(row["id"]), fix, before)
        updated += 1
    return updated


def main() -> int:
    if not DB_PATH.exists():
        raise SystemExit(f"Database not found: {DB_PATH}")

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        workspace_id = find_workspace_id(conn)
        if workspace_id is None:
            print(f"No workspace with slug {WORKSPACE_SLUG!r}; nothing to update.")
            return 0
        lit_id = find_literature_id(conn, workspace_id)
        if lit_id is None:
            print(f"No matching literature for {DOI} in workspace {workspace_id}; nothing to update.")
            return 0

        backup_path = backup_database(DB_PATH)
        now = now_iso()
        with conn:
            updated = sum(apply_fix(conn, lit_id, now, fix) for fix in FIXES)

        print(f"backup={backup_path}")
        print(f"workspace_id={workspace_id}")
        print(f"literature_id={lit_id}")
        print(f"updated_candidates={updated}")
        return 0
    finally:
        conn.close()


if __name__ == "__main__":
    raise SystemExit(main())
