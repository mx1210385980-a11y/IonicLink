#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import json
import shutil
import sqlite3
import time
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[2]
DB_PATH = REPO_ROOT / "backend" / "data" / "ioniclink.db"
SEED_SCRIPT = REPO_ROOT / "scripts" / "seed-codex-reviewed-library.py"


def load_seed_module():
    spec = importlib.util.spec_from_file_location("seed_codex_reviewed_library", SEED_SCRIPT)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Could not load seed script: {SEED_SCRIPT}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def backup_database(db_path: Path) -> Path:
    backup_path = db_path.with_suffix(db_path.suffix + f".bak-codex-seed-field-evidence-20260606-{int(time.time())}")
    shutil.copy2(db_path, backup_path)
    return backup_path


def matching_record(conn: sqlite3.Connection, doi: str, row: dict[str, Any]) -> sqlite3.Row | None:
    return conn.execute(
        """
        SELECT t.id, t.field_evidence_json
          FROM tribology_data t
          JOIN literature l ON l.id = t.literature_id
         WHERE lower(l.doi) = lower(?)
           AND t.record_origin = 'codex_reviewed_condition'
           AND t.material_name = ?
           AND t.lubricant = ?
           AND t.evidence = ?
         ORDER BY t.id
         LIMIT 1
        """,
        (doi, row["material_name"], row["lubricant"], row["evidence"]),
    ).fetchone()


def needs_field_evidence(raw: str | None) -> bool:
    if raw is None or not raw.strip():
        return True
    try:
        parsed = json.loads(raw)
    except Exception:
        return True
    return not isinstance(parsed, dict) or not parsed


def load_field_evidence_map(raw: str | None) -> dict[str, Any]:
    if raw is None or not raw.strip():
        return {}
    try:
        parsed = json.loads(raw)
    except Exception:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def has_meaningful_field_entry(entry: Any) -> bool:
    if not isinstance(entry, dict):
        return False
    evidence = entry.get("evidence")
    return bool(entry.get("value")) and isinstance(evidence, dict) and bool(evidence)


def merge_seed_field_evidence(existing_raw: str | None, seed_field_map: dict[str, Any]) -> tuple[dict[str, Any], bool]:
    merged = load_field_evidence_map(existing_raw)
    changed = False
    for key, seed_entry in seed_field_map.items():
        if not has_meaningful_field_entry(merged.get(key)):
            merged[key] = seed_entry
            changed = True
    return merged, changed


def apply_fixes(conn: sqlite3.Connection, seed_module) -> list[int]:
    updated_ids: list[int] = []
    for doi, rows in seed_module.RECORDS_BY_DOI.items():
        for row in rows:
            record = matching_record(conn, doi, row)
            if record is None:
                continue
            seed_field_map = seed_module.build_field_evidence_map(row)
            field_map, changed = merge_seed_field_evidence(record["field_evidence_json"], seed_field_map)
            if not changed:
                continue
            conn.execute(
                """
                UPDATE tribology_data
                   SET field_evidence_json = ?,
                       assembly_notes = CASE
                           WHEN instr(coalesce(assembly_notes, ''), 'Field-level evidence map added from Codex-reviewed seed source notes.') > 0
                               THEN assembly_notes
                           ELSE coalesce(assembly_notes, '')
                               || CASE
                                    WHEN coalesce(assembly_notes, '') = '' THEN ''
                                    ELSE ' '
                                  END
                               || 'Field-level evidence map added from Codex-reviewed seed source notes.'
                       END
                 WHERE id = ?
                """,
                (json.dumps(field_map, ensure_ascii=False, separators=(",", ":")), int(record["id"])),
            )
            updated_ids.append(int(record["id"]))
    return updated_ids


def main() -> None:
    if not DB_PATH.exists():
        raise FileNotFoundError(DB_PATH)

    seed_module = load_seed_module()
    backup_path = backup_database(DB_PATH)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        with conn:
            updated_ids = apply_fixes(conn, seed_module)
    finally:
        conn.close()

    print(f"backup={backup_path}")
    print(f"updated={len(updated_ids)}")
    for record_id in updated_ids:
        print(f"record={record_id}")


if __name__ == "__main__":
    main()
