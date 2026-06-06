#!/usr/bin/env python3
from __future__ import annotations

import json
import shutil
import sqlite3
import sys
import time
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[2]
BACKEND_DIR = REPO_ROOT / "backend"
DB_PATH = BACKEND_DIR / "data" / "ioniclink.db"
sys.path.insert(0, str(BACKEND_DIR))

from services.tribology_review_quality import evidence_quality_summary, tribology_payload_dedupe_key  # noqa: E402


NOTE_TEMPLATE = "Rejected as duplicate final record of #{kept_id} by Codex evidence audit 2026-06-06."
ORIGIN_PRIORITY = {
    "review_promoted_candidate": 0,
    "codex_reviewed_condition": 1,
    "manual_repair": 2,
    "curated_repair": 2,
    "replacement_sync": 3,
    "deterministic_reextract": 4,
    "llm_extraction": 5,
    "cached_record": 6,
    "workspace_submission": 9,
}


def backup_database(db_path: Path) -> Path:
    backup_path = db_path.with_suffix(db_path.suffix + f".bak-duplicate-final-records-20260606-{int(time.time())}")
    shutil.copy2(db_path, backup_path)
    return backup_path


def parse_field_evidence(raw: str | None) -> dict[str, Any]:
    try:
        parsed = json.loads(raw or "{}")
    except Exception:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def final_record_payload(row: sqlite3.Row) -> dict[str, Any]:
    payload = dict(row)
    payload["field_evidence_json"] = parse_field_evidence(payload.get("field_evidence_json"))
    payload["ionic_liquid"] = payload.get("lubricant")
    payload["cof"] = payload.get("cof_raw") or payload.get("cof_value")
    payload["load"] = payload.get("load_raw") or payload.get("load_value")
    return payload


def active_final_records(conn: sqlite3.Connection) -> list[dict[str, Any]]:
    rows = conn.execute(
        """
        SELECT *
          FROM tribology_data
         WHERE review_status IS NULL
            OR trim(review_status) = ''
            OR lower(review_status) = 'approved'
         ORDER BY id
        """
    ).fetchall()
    return [final_record_payload(row) for row in rows]


def keeper_sort_key(record: dict[str, Any]) -> tuple[float, int, int]:
    summary = evidence_quality_summary(record)
    origin = str(record.get("record_origin") or "").strip()
    return (
        -float(summary.get("score") or 0),
        ORIGIN_PRIORITY.get(origin, 7),
        int(record["id"]),
    )


def duplicate_fixes(records: list[dict[str, Any]]) -> list[dict[str, int]]:
    groups: dict[tuple[str, ...], list[dict[str, Any]]] = {}
    for record in records:
        groups.setdefault(tribology_payload_dedupe_key(record), []).append(record)

    fixes: list[dict[str, int]] = []
    for group in groups.values():
        if len(group) < 2:
            continue
        sorted_group = sorted(group, key=keeper_sort_key)
        kept_id = int(sorted_group[0]["id"])
        for duplicate in sorted_group[1:]:
            fixes.append({"rejected_id": int(duplicate["id"]), "kept_id": kept_id})
    return sorted(fixes, key=lambda fix: fix["rejected_id"])


def append_note(existing: str | None, note: str) -> str:
    current = existing or ""
    if note in current:
        return current
    if current.strip():
        return current + " " + note
    return note


def apply_fixes(conn: sqlite3.Connection) -> list[dict[str, int]]:
    fixes = duplicate_fixes(active_final_records(conn))
    for fix in fixes:
        note = NOTE_TEMPLATE.format(kept_id=fix["kept_id"])
        row = conn.execute(
            "SELECT assembly_notes FROM tribology_data WHERE id = ?",
            (fix["rejected_id"],),
        ).fetchone()
        if row is None:
            continue
        conn.execute(
            """
            UPDATE tribology_data
               SET review_status = 'rejected',
                   assembly_notes = ?
             WHERE id = ?
               AND (review_status IS NULL OR trim(review_status) = '' OR lower(review_status) = 'approved')
            """,
            (append_note(row["assembly_notes"], note), fix["rejected_id"]),
        )
    return fixes


def main() -> None:
    if not DB_PATH.exists():
        raise SystemExit(f"database not found: {DB_PATH}")

    backup_path = backup_database(DB_PATH)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        with conn:
            fixes = apply_fixes(conn)
    finally:
        conn.close()

    print(f"backup={backup_path}")
    print(f"rejected={len(fixes)}")
    for fix in fixes:
        print(f"rejected={fix['rejected_id']} kept={fix['kept_id']}")


if __name__ == "__main__":
    main()
