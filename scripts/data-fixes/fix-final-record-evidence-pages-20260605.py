#!/usr/bin/env python3
from __future__ import annotations

import json
import shutil
import sqlite3
import time
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[2]
DB_PATH = REPO_ROOT / "backend" / "data" / "ioniclink.db"


def backup_database(db_path: Path) -> Path:
    backup_path = db_path.with_suffix(db_path.suffix + f".bak-final-record-evidence-pages-20260605-{int(time.time())}")
    shutil.copy2(db_path, backup_path)
    return backup_path


def field_evidence_pages(raw: str | None) -> list[int]:
    try:
        payload = json.loads(raw or "{}")
    except Exception:
        return []
    if not isinstance(payload, dict):
        return []

    pages: set[int] = set()
    for value in payload.values():
        if not isinstance(value, dict):
            continue
        evidence = value.get("evidence")
        if not isinstance(evidence, dict):
            continue
        page = evidence.get("page")
        if isinstance(page, int) and page > 0:
            pages.add(page)
    return sorted(pages)


def candidates(conn: sqlite3.Connection) -> list[dict[str, Any]]:
    rows = conn.execute(
        """
        SELECT id, literature_id, source_page, evidence_page, field_evidence_json
          FROM tribology_data
         WHERE (review_status IS NULL OR trim(review_status) = '' OR lower(review_status) = 'approved')
           AND evidence IS NOT NULL
           AND trim(evidence) != ''
           AND source_page IS NULL
           AND evidence_page IS NULL
         ORDER BY id
        """
    ).fetchall()
    fixes: list[dict[str, Any]] = []
    for row in rows:
        pages = field_evidence_pages(row["field_evidence_json"])
        if len(pages) == 1:
            fixes.append({"id": row["id"], "literature_id": row["literature_id"], "page": pages[0]})
    return fixes


def apply_fixes(conn: sqlite3.Connection, fixes: list[dict[str, Any]]) -> int:
    updated = 0
    for fix in fixes:
        cursor = conn.execute(
            """
            UPDATE tribology_data
               SET source_page = ?,
                   evidence_page = ?
             WHERE id = ?
               AND source_page IS NULL
               AND evidence_page IS NULL
            """,
            (fix["page"], fix["page"], fix["id"]),
        )
        updated += cursor.rowcount
    return updated


def main() -> None:
    if not DB_PATH.exists():
        raise SystemExit(f"database not found: {DB_PATH}")

    backup_path = backup_database(DB_PATH)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        fixes = candidates(conn)
        updated = apply_fixes(conn, fixes)
        conn.commit()
    finally:
        conn.close()

    print(f"backup={backup_path}")
    print(f"candidate_fixes={len(fixes)}")
    for fix in fixes:
        print(f"record={fix['id']} literature={fix['literature_id']} page={fix['page']}")
    print(f"updated={updated}")


if __name__ == "__main__":
    main()
