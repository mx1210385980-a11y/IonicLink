from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest


def _resolve_db_path() -> Path | None:
    repo_root = Path(__file__).resolve().parent.parent
    candidates = [
        repo_root / "data" / "ioniclink.db",
        repo_root / "backend" / "data" / "ioniclink.db",
    ]
    for candidate in candidates:
        if candidate.exists():
            return candidate
    return None


DB_PATH = _resolve_db_path()


@pytest.mark.integration
@pytest.mark.skipif(DB_PATH is None, reason="Local SQLite fixture not present")
def test_ethaline_lubricant_query_executes() -> None:
    assert DB_PATH is not None

    with sqlite3.connect(DB_PATH) as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT DISTINCT lubricant
            FROM tribology_data
            WHERE lower(lubricant) LIKE '%ethaline%'
               OR lower(lubricant) LIKE '%chcl%'
            """
        )
        rows = cursor.fetchall()

    assert isinstance(rows, list)
    assert all(isinstance(row, tuple) for row in rows)
