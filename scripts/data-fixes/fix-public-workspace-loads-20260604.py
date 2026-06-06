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
USER_ID = 1
GROUP_ID = 1
NOTE = "Codex backfilled missing normal-load metadata for Public Extraction Workspace rows."


def dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def backup_database(db_path: Path) -> Path:
    backup_path = db_path.with_suffix(db_path.suffix + f".bak-public-workspace-loads-20260604-{int(time.time())}")
    shutil.copy2(db_path, backup_path)
    return backup_path


def table_columns(conn: sqlite3.Connection, table: str) -> set[str]:
    return {row["name"] for row in conn.execute(f"PRAGMA table_info({table})")}


def blank(value: Any) -> bool:
    return value is None or str(value).strip() == ""


def append_note(existing: str | None) -> str:
    if blank(existing):
        return NOTE
    if NOTE in str(existing):
        return str(existing)
    return f"{existing} {NOTE}"


def patch_field_evidence(field_json: str | None, fix: dict[str, Any], page: int | None) -> str:
    try:
        field_map = json.loads(field_json or "{}")
    except Exception:
        field_map = {}
    if not isinstance(field_map, dict):
        field_map = {}

    evidence = {
        "source_type": fix["source_type"],
        "page": page or fix.get("source_page"),
        "source_label": fix["source_label"],
        "quote": fix["quote"],
        "bbox": None,
        "matched_text": fix["matched_text"],
    }
    entry = {
        "value": fix["load_value"],
        "confidence": fix["confidence"],
        "evidence": evidence,
        "grounding_mode": "explicit",
        "grounding_note": fix["grounding_note"],
    }
    field_map["load"] = entry
    field_map["normal_load"] = entry
    return dumps(field_map)


C3CP_FIX = {
    "doi": "10.1039/c3cp52638k",
    "load_value": ">5 nN",
    "load_raw": "single-ion-layer region above 5 nN",
    "load_conditions": {
        "raw_text": "single-ion-layer region above 5 nN",
        "value_type": "threshold",
        "operator": ">",
        "value": 5,
        "unit": "nN",
        "note": "Rows from the friction-coefficient tables are assigned to the single-ion-layer load region.",
    },
    "source_type": "table",
    "source_label": "Tables 2-3 / single-ion-layer friction regime",
    "quote": "Friction coefficients are reported for the single-ion-layer region above 5 nN.",
    "matched_text": "single-ion-layer region above 5 nN",
    "confidence": 0.94,
    "grounding_note": "Matched to the existing curated Library records for the same DOI and table rows.",
}


HIGH_LOAD_FIXES = [
    {
        "doi": "10.1021/acssuschemeng.5c10210",
        "lubricant": "[N88812][A4BMB]",
        "cof_raw": "0.0032",
        "load_value": "15-45 nN",
        "load_raw": "stable across the tested normal-load range in Fig. 1(b,c), approximately 15-45 nN",
        "load_conditions": {
            "raw_text": "stable across the tested normal-load range in Fig. 1(b,c), approximately 15-45 nN",
            "value_type": "range",
            "min": 15,
            "max": 45,
            "unit": "nN",
            "note": "Figure 1(b,c) plots A4 over the normal-load axis from about 15 to 45 nN; the coefficient is summarized across that tested range.",
        },
        "source_type": "figure",
        "source_page": 3,
        "source_label": "Figure 1(b,c)",
        "quote": "A4 shows μ = 0.0032 across the Figure 1 normal-load range, approximately 15-45 nN.",
        "matched_text": "Normal Load, nN; μ=0.0032",
        "confidence": 0.93,
        "grounding_note": "Figure 1(b,c) uses normal load in nN; the AFM voltage setpoint is not stored as a load value.",
    },
    {
        "doi": "10.1021/acssuschemeng.5c10210",
        "lubricant": "[N88812][A8BMB]",
        "cof_raw": "0.0068",
        "load_value": "15-45 nN",
        "load_raw": "stable across the tested normal-load range in Fig. 1(b,c), approximately 15-45 nN",
        "load_conditions": {
            "raw_text": "stable across the tested normal-load range in Fig. 1(b,c), approximately 15-45 nN",
            "value_type": "range",
            "min": 15,
            "max": 45,
            "unit": "nN",
            "note": "Figure 1(b,c) plots A8 over the normal-load axis from about 15 to 45 nN; the coefficient is summarized across that tested range.",
        },
        "source_type": "figure",
        "source_page": 3,
        "source_label": "Figure 1(b,c)",
        "quote": "A8 shows μ = 0.0068 across the Figure 1 normal-load range, approximately 15-45 nN.",
        "matched_text": "Normal Load, nN; μ=0.0068",
        "confidence": 0.93,
        "grounding_note": "Figure 1(b,c) uses normal load in nN; the AFM voltage setpoint is not stored as a load value.",
    },
    {
        "doi": "10.1021/acssuschemeng.5c10210",
        "lubricant": "[N88812][A12BMB]",
        "cof_raw": "0.023",
        "load_value": "<=30 nN",
        "load_raw": "<=30 nN",
        "load_conditions": {
            "raw_text": "lower-load regime up to 30 nN",
            "value_type": "threshold",
            "operator": "<=",
            "value": 30,
            "unit": "nN",
            "note": "A12BMB shows the higher coefficient before the load-triggered transition.",
        },
        "source_type": "text",
        "source_page": 1,
        "source_label": "Abstract / Fig. 1 load-transition discussion",
        "quote": "The A12BMB coefficient is about 0.023 before the load exceeds about 30 nN.",
        "matched_text": "0.023; 30 nN",
        "confidence": 0.93,
        "grounding_note": "Mapped from the paper's load-triggered A12BMB friction transition.",
    },
    {
        "doi": "10.1021/acssuschemeng.5c10210",
        "lubricant": "[N88812][A12BMB]",
        "cof_raw": "0.0013",
        "load_value": ">30 nN (~2.4 GPa)",
        "load_raw": ">30 nN (~2.4 GPa)",
        "load_conditions": {
            "raw_text": "normal load above about 30 nN, corresponding to about 2.4 GPa",
            "value_type": "threshold",
            "operator": ">",
            "value": 30,
            "unit": "nN",
            "contact_pressure": "~2.4 GPa",
            "note": "A12BMB reaches nanoscale superlubricity after the high-load transition.",
        },
        "source_type": "text",
        "source_page": 1,
        "source_label": "Abstract / Fig. 1 load-transition discussion",
        "quote": "The A12BMB coefficient drops to about 0.0013 once the normal load exceeds about 30 nN.",
        "matched_text": "0.0013; exceeds about 30 nN",
        "confidence": 0.95,
        "grounding_note": "Mapped from the paper's load-triggered A12BMB superlubricity transition.",
    },
]


def find_workspace_id(conn: sqlite3.Connection) -> int | None:
    row = conn.execute("SELECT id FROM workspaces WHERE slug = ? ORDER BY id LIMIT 1", (WORKSPACE_SLUG,)).fetchone()
    return int(row["id"]) if row else None


def find_literature_id(conn: sqlite3.Connection, workspace_id: int, doi: str) -> int | None:
    row = conn.execute(
        """
        SELECT id
          FROM literature
         WHERE workspace_id = ?
           AND lower(coalesce(doi, '')) = lower(?)
         ORDER BY id
         LIMIT 1
        """,
        (workspace_id, doi),
    ).fetchone()
    return int(row["id"]) if row else None


def update_row(
    conn: sqlite3.Connection,
    table: str,
    row_id: int,
    existing_field_evidence: str | None,
    existing_notes: str | None,
    fix: dict[str, Any],
    page: int | None,
) -> None:
    conn.execute(
        f"""
        UPDATE {table}
           SET load_value = ?,
               load_raw = ?,
               load_conditions_json = ?,
               field_evidence_json = ?,
               assembly_notes = ?
         WHERE id = ?
        """,
        (
            fix["load_value"],
            fix["load_raw"],
            dumps(fix["load_conditions"]),
            patch_field_evidence(existing_field_evidence, fix, page),
            append_note(existing_notes),
            row_id,
        ),
    )


def log_activity(conn: sqlite3.Connection, now: str, resource_type: str, resource_id: int, detail: dict[str, Any]) -> None:
    columns = table_columns(conn, "user_activity_logs")
    if not columns:
        return
    payload = {
        "user_id": USER_ID,
        "group_id": GROUP_ID,
        "action_type": "public_workspace_load_backfill",
        "action_detail": dumps(detail),
        "resource_type": resource_type,
        "resource_id": resource_id,
        "created_at": now,
    }
    insert_columns = [column for column in payload if column in columns]
    if not insert_columns:
        return
    placeholders = ",".join("?" for _ in insert_columns)
    conn.execute(
        f"INSERT INTO user_activity_logs ({','.join(insert_columns)}) VALUES ({placeholders})",
        [payload[column] for column in insert_columns],
    )


def backfill_c3cp(conn: sqlite3.Connection, workspace_id: int, now: str) -> tuple[int, int]:
    lit_id = find_literature_id(conn, workspace_id, C3CP_FIX["doi"])
    if lit_id is None:
        return (0, 0)

    candidate_updates = 0
    for row in conn.execute(
        """
        SELECT id, field_evidence_json, assembly_notes, source_page
          FROM record_candidates
         WHERE literature_id = ?
           AND (load_value IS NULL OR trim(CAST(load_value AS TEXT)) = '')
        """,
        (lit_id,),
    ).fetchall():
        update_row(conn, "record_candidates", int(row["id"]), row["field_evidence_json"], row["assembly_notes"], C3CP_FIX, row["source_page"])
        log_activity(
            conn,
            now,
            "record_candidates",
            int(row["id"]),
            {"doi": C3CP_FIX["doi"], "literature_id": lit_id, "load_value": C3CP_FIX["load_value"]},
        )
        candidate_updates += 1

    record_updates = 0
    for row in conn.execute(
        """
        SELECT id, field_evidence_json, assembly_notes, source_page
          FROM tribology_data
         WHERE literature_id = ?
           AND (load_value IS NULL OR trim(CAST(load_value AS TEXT)) = '')
        """,
        (lit_id,),
    ).fetchall():
        update_row(conn, "tribology_data", int(row["id"]), row["field_evidence_json"], row["assembly_notes"], C3CP_FIX, row["source_page"])
        log_activity(
            conn,
            now,
            "tribology_data",
            int(row["id"]),
            {"doi": C3CP_FIX["doi"], "literature_id": lit_id, "load_value": C3CP_FIX["load_value"]},
        )
        record_updates += 1

    return candidate_updates, record_updates


def backfill_high_load(conn: sqlite3.Connection, workspace_id: int, now: str) -> tuple[int, int]:
    lit_id = find_literature_id(conn, workspace_id, HIGH_LOAD_FIXES[0]["doi"])
    if lit_id is None:
        return (0, 0)

    candidate_updates = 0
    record_updates = 0
    for fix in HIGH_LOAD_FIXES:
        params = (lit_id, fix["lubricant"], fix["cof_raw"])
        candidates = conn.execute(
            """
            SELECT id, field_evidence_json, assembly_notes, source_page
              FROM record_candidates
             WHERE literature_id = ?
               AND lubricant = ?
               AND cof_raw = ?
               AND (load_value IS NULL OR trim(CAST(load_value AS TEXT)) = '')
            """,
            params,
        ).fetchall()
        for row in candidates:
            update_row(conn, "record_candidates", int(row["id"]), row["field_evidence_json"], row["assembly_notes"], fix, row["source_page"])
            log_activity(
                conn,
                now,
                "record_candidates",
                int(row["id"]),
                {"doi": fix["doi"], "literature_id": lit_id, "lubricant": fix["lubricant"], "cof_raw": fix["cof_raw"], "load_value": fix["load_value"]},
            )
            candidate_updates += 1

        records = conn.execute(
            """
            SELECT id, field_evidence_json, assembly_notes, source_page
              FROM tribology_data
             WHERE literature_id = ?
               AND lubricant = ?
               AND cof_raw = ?
               AND (load_value IS NULL OR trim(CAST(load_value AS TEXT)) = '')
            """,
            params,
        ).fetchall()
        for row in records:
            update_row(conn, "tribology_data", int(row["id"]), row["field_evidence_json"], row["assembly_notes"], fix, row["source_page"])
            log_activity(
                conn,
                now,
                "tribology_data",
                int(row["id"]),
                {"doi": fix["doi"], "literature_id": lit_id, "lubricant": fix["lubricant"], "cof_raw": fix["cof_raw"], "load_value": fix["load_value"]},
            )
            record_updates += 1

    return candidate_updates, record_updates


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

        targets = []
        for doi in [C3CP_FIX["doi"], HIGH_LOAD_FIXES[0]["doi"]]:
            lit_id = find_literature_id(conn, workspace_id, doi)
            if lit_id is not None:
                targets.append((doi, lit_id))
        if not targets:
            print(f"No matching literature in workspace {workspace_id}; nothing to update.")
            return 0

        backup_path = backup_database(DB_PATH)
        now = now_iso()
        with conn:
            c3cp_candidates, c3cp_records = backfill_c3cp(conn, workspace_id, now)
            high_candidates, high_records = backfill_high_load(conn, workspace_id, now)

        print(f"backup={backup_path}")
        print(f"workspace_id={workspace_id}")
        print(f"c3cp52638k candidates={c3cp_candidates} records={c3cp_records}")
        print(f"acssuschemeng.5c10210 candidates={high_candidates} records={high_records}")
        return 0
    finally:
        conn.close()


if __name__ == "__main__":
    raise SystemExit(main())
