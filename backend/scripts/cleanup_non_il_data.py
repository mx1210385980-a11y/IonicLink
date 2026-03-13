from __future__ import annotations

import shutil
import sqlite3
import sys
from datetime import datetime
from pathlib import Path


BACKEND_ROOT = Path(__file__).resolve().parents[1]
PROJECT_ROOT = BACKEND_ROOT.parent
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from services.il_resolver_service import is_supported_ionic_liquid_name


DB_PATH = BACKEND_ROOT / "data" / "ioniclink.db"
BACKUP_DIR = PROJECT_ROOT / "databackup"


def backup_database() -> Path:
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    backup_path = BACKUP_DIR / f"ioniclink-pre-il-cleanup-{stamp}.db"
    shutil.copy2(DB_PATH, backup_path)
    return backup_path


def resequence_primary_key(conn: sqlite3.Connection, table: str) -> None:
    rows = conn.execute(f"SELECT id FROM {table} ORDER BY id").fetchall()
    mapping = {old_id: index for index, (old_id,) in enumerate(rows, start=1)}
    if all(old_id == new_id for old_id, new_id in mapping.items()):
        return

    for old_id, new_id in mapping.items():
        conn.execute(f"UPDATE {table} SET id = ? WHERE id = ?", (-new_id, old_id))
    conn.execute(f"UPDATE {table} SET id = ABS(id)")


def resequence_literature_ids(conn: sqlite3.Connection) -> None:
    rows = conn.execute("SELECT id FROM literature ORDER BY id").fetchall()
    mapping = {old_id: index for index, (old_id,) in enumerate(rows, start=1)}
    if all(old_id == new_id for old_id, new_id in mapping.items()):
        return

    for old_id, new_id in mapping.items():
        negative_id = -new_id
        conn.execute("UPDATE literature SET id = ? WHERE id = ?", (negative_id, old_id))
        conn.execute("UPDATE tribology_data SET literature_id = ? WHERE literature_id = ?", (negative_id, old_id))
        conn.execute("UPDATE extraction_runs SET literature_id = ? WHERE literature_id = ?", (negative_id, old_id))

    conn.execute("UPDATE literature SET id = ABS(id)")
    conn.execute("UPDATE tribology_data SET literature_id = ABS(literature_id)")
    conn.execute("UPDATE extraction_runs SET literature_id = ABS(literature_id)")


def reset_sqlite_sequence(conn: sqlite3.Connection, table: str) -> None:
    sequence_table_exists = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'sqlite_sequence'"
    ).fetchone()
    if not sequence_table_exists:
        return

    max_id = conn.execute(f"SELECT COALESCE(MAX(id), 0) FROM {table}").fetchone()[0]
    conn.execute("DELETE FROM sqlite_sequence WHERE name = ?", (table,))
    conn.execute("INSERT INTO sqlite_sequence(name, seq) VALUES (?, ?)", (table, max_id))


def main() -> None:
    if not DB_PATH.exists():
        raise SystemExit(f"Database not found: {DB_PATH}")

    backup_path = backup_database()
    print(f"[Backup] {backup_path}")

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row

    try:
        conn.execute("BEGIN")

        rows = conn.execute(
            """
            SELECT id, literature_id, lubricant
            FROM tribology_data
            ORDER BY id
            """
        ).fetchall()

        delete_record_ids: list[int] = []
        for row in rows:
            if not is_supported_ionic_liquid_name(row["lubricant"]):
                delete_record_ids.append(int(row["id"]))

        if delete_record_ids:
            conn.executemany("DELETE FROM tribology_data WHERE id = ?", [(record_id,) for record_id in delete_record_ids])

        empty_literature_ids = [
            int(row["id"])
            for row in conn.execute(
                """
                SELECT l.id
                FROM literature l
                LEFT JOIN tribology_data t ON t.literature_id = l.id
                GROUP BY l.id
                HAVING COUNT(t.id) = 0
                """
            ).fetchall()
        ]

        deleted_runs = 0
        deleted_candidates = 0
        if empty_literature_ids:
            placeholders = ",".join("?" for _ in empty_literature_ids)
            run_ids = [
                row["run_id"]
                for row in conn.execute(
                    f"SELECT run_id FROM extraction_runs WHERE literature_id IN ({placeholders})",
                    empty_literature_ids,
                ).fetchall()
            ]
            if run_ids:
                run_placeholders = ",".join("?" for _ in run_ids)
                deleted_candidates = conn.execute(
                    f"DELETE FROM extraction_candidates WHERE run_id IN ({run_placeholders})",
                    run_ids,
                ).rowcount
            deleted_runs = conn.execute(
                f"DELETE FROM extraction_runs WHERE literature_id IN ({placeholders})",
                empty_literature_ids,
            ).rowcount
            conn.execute(
                f"DELETE FROM literature WHERE id IN ({placeholders})",
                empty_literature_ids,
            )

        resequence_literature_ids(conn)
        resequence_primary_key(conn, "tribology_data")
        resequence_primary_key(conn, "extraction_runs")
        resequence_primary_key(conn, "extraction_candidates")

        for table in ("literature", "tribology_data", "extraction_runs", "extraction_candidates"):
            reset_sqlite_sequence(conn, table)

        conn.commit()

        remaining_records = conn.execute("SELECT COUNT(*) FROM tribology_data").fetchone()[0]
        remaining_literature = conn.execute("SELECT COUNT(*) FROM literature").fetchone()[0]

        print(
            "[Cleanup] "
            f"deleted_records={len(delete_record_ids)}, "
            f"deleted_literature={len(empty_literature_ids)}, "
            f"deleted_runs={deleted_runs}, "
            f"deleted_candidates={deleted_candidates}, "
            f"remaining_records={remaining_records}, "
            f"remaining_literature={remaining_literature}"
        )
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    main()
