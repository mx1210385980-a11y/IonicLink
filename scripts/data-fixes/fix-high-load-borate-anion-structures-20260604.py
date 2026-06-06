#!/usr/bin/env python3
from __future__ import annotations

import json
import re
import shutil
import sqlite3
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[2]
DB_PATH = REPO_ROOT / "backend" / "data" / "ioniclink.db"
DOI = "10.1021/acssuschemeng.5c10210"
USER_ID = 1
GROUP_ID = 1
CATION_SMILES = "CCCCCCCCCCCC[N+](CCCCCCCC)(CCCCCCCC)CCCCCCCC"
NOTE = (
    "Codex corrected the high-load borate IL anion structures so A4BMB, A8BMB, "
    "and A12BMB retain their 4/8/12-carbon mandelato side chains instead of BMB."
)


ANIONS = {
    "A4BMB": {
        "anion_smiles": "[B-]12(OC(=O)C(c3ccc(CCCC)cc3)O1)OC(=O)C(c4ccc(CCCC)cc4)O2",
        "full_name": "bis(4-butylmandelato)borate",
        "side_chain": "4-butyl",
    },
    "A8BMB": {
        "anion_smiles": "[B-]12(OC(=O)C(c3ccc(CCCCCCCC)cc3)O1)OC(=O)C(c4ccc(CCCCCCCC)cc4)O2",
        "full_name": "bis(4-octylmandelato)borate",
        "side_chain": "4-octyl",
    },
    "A12BMB": {
        "anion_smiles": "[B-]12(OC(=O)C(c3ccc(CCCCCCCCCCCC)cc3)O1)OC(=O)C(c4ccc(CCCCCCCCCCCC)cc4)O2",
        "full_name": "bis(4-dodecylmandelato)borate",
        "side_chain": "4-dodecyl",
    },
}


def dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def backup_database(db_path: Path) -> Path:
    backup_path = db_path.with_suffix(db_path.suffix + f".bak-high-load-borate-anions-20260604-{int(time.time())}")
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


def infer_anion(lubricant: str | None, fallback: str | None = None) -> str | None:
    text = f"{lubricant or ''} {fallback or ''}".upper()
    for anion in ("A12BMB", "A8BMB", "A4BMB"):
        if anion in text:
            return anion
    return None


def normalized_lubricant(lubricant: str | None, anion: str) -> str:
    text = str(lubricant or "").strip()
    if text:
        return re.sub(r"\[[^\]]*BMB\]", f"[{anion}]", text)
    return f"[N88812][{anion}]"


def components_json(lubricant: str) -> str:
    return dumps([{"compound": lubricant, "role": "ionic_liquid"}])


def patch_field_evidence(field_json: str | None, lubricant: str, anion: str) -> str:
    try:
        field_map = json.loads(field_json or "{}")
    except Exception:
        field_map = {}
    if not isinstance(field_map, dict):
        field_map = {}

    anion_info = ANIONS[anion]
    evidence = {
        "source_type": "text",
        "page": 2,
        "source_label": "Materials / Table 1 description",
        "quote": (
            f"The paper lists {lubricant} as trioctyldodecylammonium "
            f"{anion_info['full_name']}, with a {anion_info['side_chain']} mandelato side chain."
        ),
        "bbox": None,
        "matched_text": lubricant,
    }
    field_map["anion"] = {
        "value": anion,
        "confidence": 0.96,
        "evidence": evidence,
        "grounding_mode": "explicit",
        "grounding_note": "The paper studies A4, A8, and A12 borate anions with different alkyl-chain lengths; BMB alone omits the measured side chain.",
    }
    field_map["ionic_liquid"] = {
        "value": lubricant,
        "confidence": 0.96,
        "evidence": evidence,
        "grounding_mode": "explicit",
    }
    return dumps(field_map)


def log_activity(conn: sqlite3.Connection, now: str, resource_type: str, resource_id: int, detail: dict[str, Any]) -> None:
    columns = {row["name"] for row in conn.execute("PRAGMA table_info(user_activity_logs)")}
    if not columns:
        return
    payload = {
        "user_id": USER_ID,
        "group_id": GROUP_ID,
        "action_type": "high_load_borate_anion_structure_correction",
        "action_detail": dumps(detail),
        "resource_type": resource_type,
        "resource_id": resource_id,
        "created_at": now,
    }
    insert_columns = [column for column in payload if column in columns]
    placeholders = ",".join("?" for _ in insert_columns)
    conn.execute(
        f"INSERT INTO user_activity_logs ({','.join(insert_columns)}) VALUES ({placeholders})",
        [payload[column] for column in insert_columns],
    )


def update_table(conn: sqlite3.Connection, table: str, now: str) -> int:
    rows = conn.execute(
        f"""
        SELECT r.id, r.lubricant, r.cation, r.anion, r.cation_smiles, r.anion_smiles, r.il_smiles,
               r.lubricant_components_json, r.field_evidence_json, r.assembly_notes
          FROM {table} r
          JOIN literature l ON l.id = r.literature_id
         WHERE lower(coalesce(l.doi, '')) = lower(?)
        """,
        (DOI,),
    ).fetchall()

    updated = 0
    for row in rows:
        anion = infer_anion(row["lubricant"], row["anion"])
        if not anion:
            continue
        anion_info = ANIONS[anion]
        lubricant = normalized_lubricant(row["lubricant"], anion)
        il_smiles = f"{row['cation_smiles'] if 'cation_smiles' in row.keys() and row['cation_smiles'] else CATION_SMILES}.{anion_info['anion_smiles']}"
        before = {
            "anion": row["anion"],
            "anion_smiles": row["anion_smiles"],
            "il_smiles": row["il_smiles"],
        }
        conn.execute(
            f"""
            UPDATE {table}
               SET lubricant = ?,
                   anion = ?,
                   anion_smiles = ?,
                   il_smiles = ?,
                   lubricant_components_json = ?,
                   field_evidence_json = ?,
                   assembly_notes = ?
             WHERE id = ?
            """,
            (
                lubricant,
                anion,
                anion_info["anion_smiles"],
                il_smiles,
                components_json(lubricant),
                patch_field_evidence(row["field_evidence_json"], lubricant, anion),
                append_note(row["assembly_notes"]),
                row["id"],
            ),
        )
        log_activity(
            conn,
            now,
            table,
            int(row["id"]),
            {
                "doi": DOI,
                "record_id": int(row["id"]),
                "table": table,
                "old": before,
                "new": {
                    "lubricant": lubricant,
                    "anion": anion,
                    "anion_smiles": anion_info["anion_smiles"],
                    "il_smiles": il_smiles,
                },
            },
        )
        updated += 1
    return updated


def main() -> int:
    if not DB_PATH.exists():
        raise SystemExit(f"Database not found: {DB_PATH}")

    backup_path = backup_database(DB_PATH)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        now = now_iso()
        with conn:
            candidate_updates = update_table(conn, "record_candidates", now)
            record_updates = update_table(conn, "tribology_data", now)
        print(f"backup={backup_path}")
        print(f"updated_candidates={candidate_updates}")
        print(f"updated_records={record_updates}")
        return 0
    finally:
        conn.close()


if __name__ == "__main__":
    raise SystemExit(main())
