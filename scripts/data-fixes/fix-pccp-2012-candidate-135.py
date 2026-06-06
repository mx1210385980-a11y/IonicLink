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
DOI = "10.1039/c1cp23134k"
USER_ID = 1

RECORD_ID = 324
CANDIDATE_IDS = [135, 136]
SAMPLE_ID = "rutland-2012-ean-mica-interval-i"
SERIES_ID = "rutland-2012-ean-mica-load-speed"
ASSEMBLY_NOTE = (
    "Codex reviewed PCCP 2012 Fig. 3 duplicate candidate; linked repeated "
    "candidate rows to the existing Library record and normalized silica colloid-probe radius."
)
SPEED_CONDITIONS = {
    "raw_text": "Interval I friction was independent of sliding speeds between 5 and 40 μm/s.",
    "value_type": "range",
    "speed_min_um_s": 5,
    "speed_max_um_s": 40,
    "unit_warning": False,
}
LOAD_CONDITIONS = {
    "raw_text": "Interval I spans applied normal force from 0 to 5 nN.",
    "value_type": "range",
    "load_min_nN": 0,
    "load_max_nN": 5,
}


def dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def backup_database(db_path: Path) -> Path:
    backup_path = db_path.with_suffix(db_path.suffix + f".bak-pccp-2012-135-{int(time.time())}")
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


def patch_field_evidence(field_json: str | None) -> str:
    try:
        field_map = json.loads(field_json or "{}")
    except Exception:
        field_map = {}
    if not isinstance(field_map, dict):
        field_map = {}

    fig_evidence = {
        "source_type": "figure",
        "page": 4,
        "source_label": "Fig. 3",
        "quote": "Fig. 3 reports lateral force for a 20.8 μm diameter silica colloid moving at speeds over the EAN-mica interface.",
        "bbox": None,
        "matched_text": "Interval I; μ = 0.14",
    }
    field_map.update(
        {
            "probe_radius": {
                "value": "10.4 μm",
                "confidence": 0.93,
                "evidence": fig_evidence,
                "grounding_note": "Radius inferred from the reported 20.8 μm silica colloid diameter.",
            },
            "speed": {
                "value": "5-40 μm/s",
                "confidence": 0.92,
                "evidence": fig_evidence,
            },
            "load": {
                "value": "0-5 nN",
                "confidence": 0.92,
                "evidence": fig_evidence,
            },
        }
    )
    return dumps(field_map)


def update_rows(conn: sqlite3.Connection, lit_id: int, now: str) -> tuple[int, int]:
    record = conn.execute(
        "SELECT id, field_evidence_json FROM tribology_data WHERE id = ? AND literature_id = ?",
        (RECORD_ID, lit_id),
    ).fetchone()
    if not record:
        raise RuntimeError(f"Record {RECORD_ID} not found for literature {lit_id}")

    conn.execute(
        """
        UPDATE tribology_data
           SET material_name = 'Silica colloid probe / [EA][NO3] / mica surface',
               lubricant = '[EA][NO3]',
               cof_value = 0.14,
               cof_raw = '0.14',
               load_value = '0-5 nN',
               load_raw = '0-5 nN',
               load_conditions_json = ?,
               speed_value = '5-40 μm/s',
               speed_conditions_json = ?,
               temperature = '298.15 K',
               probe_material = 'Silica',
               probe_geometry = 'Colloid probe',
               probe_radius = '10.4 μm',
               substrate_material = 'Mica',
               sample_id = ?,
               series_id = ?,
               cation = 'EA',
               anion = 'NO3',
               source_page = 4,
               source_figure = 'Fig. 3',
               evidence_page = 4,
               field_evidence_json = ?,
               review_status = 'approved',
               record_origin = 'codex_reviewed_condition',
               confidence = 0.96,
               extracted_at = ?,
               assembly_notes = ?
         WHERE id = ?
        """,
        (
            dumps(LOAD_CONDITIONS),
            dumps(SPEED_CONDITIONS),
            SAMPLE_ID,
            SERIES_ID,
            patch_field_evidence(record["field_evidence_json"]),
            now,
            ASSEMBLY_NOTE,
            RECORD_ID,
        ),
    )

    linked_candidates = 0
    for candidate_id in CANDIDATE_IDS:
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
                   material_name = 'Silica colloid probe / [EA][NO3] / mica surface',
                   lubricant = '[EA][NO3]',
                   cof_value = 0.14,
                   cof_raw = '0.14',
                   load_value = '0-5 nN',
                   load_raw = '0-5 nN',
                   load_conditions_json = ?,
                   speed_value = '5-40 μm/s',
                   speed_conditions_json = ?,
                   temperature = '298.15 K',
                   probe_material = 'Silica',
                   probe_geometry = 'Colloid probe',
                   probe_radius = '10.4 μm',
                   substrate_material = 'Mica',
                   sample_id = ?,
                   series_id = ?,
                   cation = 'EA',
                   anion = 'NO3',
                   source_page = 4,
                   source_figure = 'Fig. 3',
                   evidence_page = 4,
                   field_evidence_json = ?,
                   record_origin = 'codex_reviewed_condition',
                   confidence = 0.96,
                   assembly_notes = ?
             WHERE id = ?
            """,
            (
                RECORD_ID,
                now,
                dumps(LOAD_CONDITIONS),
                dumps(SPEED_CONDITIONS),
                SAMPLE_ID,
                SERIES_ID,
                patch_field_evidence(candidate["field_evidence_json"]),
                ASSEMBLY_NOTE,
                candidate_id,
            ),
        )
        linked_candidates += 1

    return 1, linked_candidates


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
