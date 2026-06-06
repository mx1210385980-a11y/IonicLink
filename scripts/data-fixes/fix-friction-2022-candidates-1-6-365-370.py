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
DOI = "10.1007/s40544-021-0566-5"
USER_ID = 1

SOURCE_PAGE = 7
SOURCE_FIGURE = "Table 1"
SERIES_ID = "friction-2022-uncharged-charged-table1"
PROBE_RADIUS = "~10 μm"
SCAN_RATE_CONDITIONS = {
    "raw_text": "SiO2 and PMMA colloid probes were employed throughout the friction measurements with a scan rate of 2 Hz.",
    "value_type": "scan_rate",
    "scan_rate_hz": 2,
    "unit_warning": True,
    "note": "Linear sliding velocity is not derived because scan size/line length is not reported in the source text.",
}
LOAD_CONDITIONS = {
    "raw_text": "Average friction coefficient was determined from the gradient of friction force versus normal load.",
    "value_type": "varied_normal_load",
    "unit_warning": False,
    "note": "The exact normal-load range is not stated in the extracted source text, so load_value is intentionally left blank.",
}
ASSEMBLY_NOTE = (
    "Codex reviewed Friction 2022 Table 1; linked duplicate candidates to the "
    "group Library records, corrected colloid-probe metadata, and kept speed/load "
    "blank where only scan rate or varied-load context is reported."
)


def dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def backup_database(db_path: Path) -> Path:
    backup_path = db_path.with_suffix(db_path.suffix + f".bak-friction-2022-1-6-365-370-{int(time.time())}")
    shutil.copy2(db_path, backup_path)
    return backup_path


ROWS = [
    {
        "record_id": 427,
        "candidate_ids": [1, 365],
        "sample_id": "friction-2022-sio2-bp-mica",
        "row_label": "SiO2-BP-M",
        "material_name": "SiO2 colloid probe / [BMIM][PF6] / mica",
        "lubricant": "[BMIM][PF6]",
        "lubricant_alias": "BP",
        "cation": "BMIM",
        "anion": "PF6",
        "substrate": "Mica",
        "probe_material": "SiO2",
        "cof_value": 0.23,
        "cof_raw": "0.23 ± 0.021",
        "cof_sd": 0.021,
        "adhesion_raw": "21 ± 1.80 nN",
    },
    {
        "record_id": 428,
        "candidate_ids": [2, 366],
        "sample_id": "friction-2022-sio2-bb-mica",
        "row_label": "SiO2-BB-M",
        "material_name": "SiO2 colloid probe / [BMIM][BF4] / mica",
        "lubricant": "[BMIM][BF4]",
        "lubricant_alias": "BB",
        "cation": "BMIM",
        "anion": "BF4",
        "substrate": "Mica",
        "probe_material": "SiO2",
        "cof_value": 0.40,
        "cof_raw": "0.40 ± 0.017",
        "cof_sd": 0.017,
        "adhesion_raw": "51 ± 0.87 nN",
    },
    {
        "record_id": 429,
        "candidate_ids": [3, 367],
        "sample_id": "friction-2022-pmma-bp-mica",
        "row_label": "PMMA-BP-M",
        "material_name": "PMMA colloid probe / [BMIM][PF6] / mica",
        "lubricant": "[BMIM][PF6]",
        "lubricant_alias": "BP",
        "cation": "BMIM",
        "anion": "PF6",
        "substrate": "Mica",
        "probe_material": "PMMA",
        "cof_value": 0.32,
        "cof_raw": "0.32 ± 0.012",
        "cof_sd": 0.012,
        "adhesion_raw": "36 ± 1.30 nN",
    },
    {
        "record_id": 430,
        "candidate_ids": [4, 368],
        "sample_id": "friction-2022-pmma-bb-mica",
        "row_label": "PMMA-BB-M",
        "material_name": "PMMA colloid probe / [BMIM][BF4] / mica",
        "lubricant": "[BMIM][BF4]",
        "lubricant_alias": "BB",
        "cation": "BMIM",
        "anion": "BF4",
        "substrate": "Mica",
        "probe_material": "PMMA",
        "cof_value": 0.53,
        "cof_raw": "0.53 ± 0.021",
        "cof_sd": 0.021,
        "adhesion_raw": "71 ± 1.30 nN",
    },
    {
        "record_id": 431,
        "candidate_ids": [5, 369],
        "sample_id": "friction-2022-sio2-bp-hopg",
        "row_label": "SiO2-BP-H",
        "material_name": "SiO2 colloid probe / [BMIM][PF6] / HOPG",
        "lubricant": "[BMIM][PF6]",
        "lubricant_alias": "BP",
        "cation": "BMIM",
        "anion": "PF6",
        "substrate": "HOPG",
        "probe_material": "SiO2",
        "cof_value": 0.064,
        "cof_raw": "0.064 ± 0.003",
        "cof_sd": 0.003,
        "adhesion_raw": "13 ± 1.30 nN",
    },
    {
        "record_id": 432,
        "candidate_ids": [6, 370],
        "sample_id": "friction-2022-sio2-bb-hopg",
        "row_label": "SiO2-BB-H",
        "material_name": "SiO2 colloid probe / [BMIM][BF4] / HOPG",
        "lubricant": "[BMIM][BF4]",
        "lubricant_alias": "BB",
        "cation": "BMIM",
        "anion": "BF4",
        "substrate": "HOPG",
        "probe_material": "SiO2",
        "cof_value": 0.010,
        "cof_raw": "0.010 ± 0.001",
        "cof_sd": 0.001,
        "adhesion_raw": "6.8 ± 0.82 nN",
    },
]


def patch_field_evidence(field_json: str | None, row: dict[str, Any]) -> str:
    try:
        field_map = json.loads(field_json or "{}")
    except Exception:
        field_map = {}
    if not isinstance(field_map, dict):
        field_map = {}

    probe_evidence = {
        "source_type": "text",
        "page": 3,
        "source_label": "Materials and methods",
        "quote": "SiO2 and PMMA colloid probes were employed throughout the friction measurements with a scan rate of 2 Hz.",
        "bbox": None,
        "matched_text": "colloid probes; scan rate of 2 Hz",
    }
    radius_evidence = {
        "source_type": "text",
        "page": 3,
        "source_label": "Materials and methods",
        "quote": "SiO2 (silica) and PMMA microspheres (20 μm in dimension) were obtained from EPRUI Biotech.",
        "bbox": None,
        "matched_text": "microspheres (20 μm in dimension)",
    }
    table_evidence = {
        "source_type": "table",
        "page": SOURCE_PAGE,
        "source_label": SOURCE_FIGURE,
        "quote": f"{row['row_label']} {row['cof_raw']} {row['adhesion_raw']}",
        "bbox": None,
        "matched_text": row["row_label"],
    }

    field_map.update(
        {
            "material": {
                "value": row["material_name"],
                "confidence": 0.96,
                "evidence": table_evidence,
                "grounding_note": "Material name normalized to the full colloid-probe / ionic-liquid / substrate tribopair.",
            },
            "ionic_liquid": {
                "value": row["lubricant"],
                "confidence": 0.96,
                "evidence": table_evidence,
            },
            "substrate": {
                "value": row["substrate"],
                "confidence": 0.96,
                "evidence": table_evidence,
            },
            "probe_material": {
                "value": row["probe_material"],
                "confidence": 0.95,
                "evidence": probe_evidence,
            },
            "probe_geometry": {
                "value": "Colloid probe",
                "confidence": 0.97,
                "evidence": probe_evidence,
            },
            "probe_radius": {
                "value": PROBE_RADIUS,
                "confidence": 0.92,
                "evidence": radius_evidence,
                "grounding_note": "Radius inferred from 20 μm microsphere dimension.",
            },
            "speed": {
                "value": None,
                "confidence": 0.92,
                "evidence": probe_evidence,
                "grounding_note": "Only scan rate is reported; no linear speed is derived without scan size.",
            },
            "load": {
                "value": None,
                "confidence": 0.88,
                "evidence": table_evidence,
                "grounding_note": "Friction coefficient is based on a friction-force versus normal-load gradient; no exact load range is stored.",
            },
        }
    )
    return dumps(field_map)


def cof_json(row: dict[str, Any]) -> str:
    return dumps(
        {
            "raw": row["cof_raw"],
            "mean": row["cof_value"],
            "standard_deviation": row["cof_sd"],
            "adhesion_force": row["adhesion_raw"],
            "source": SOURCE_FIGURE,
            "row_label": row["row_label"],
        }
    )


def tribological_system_json(row: dict[str, Any]) -> str:
    return dumps(
        {
            "technique": "AFM colloid-probe friction",
            "instrument": "Dimension Icon AFM",
            "mode": "contact mode",
            "ambient_conditions": True,
            "probe_geometry": "Colloid probe",
            "probe_material": row["probe_material"],
            "probe_radius": PROBE_RADIUS,
            "substrate": row["substrate"],
            "lubricant": row["lubricant"],
            "scan_rate_hz": 2,
        }
    )


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


def ensure_record(conn: sqlite3.Connection, lit_id: int, row: dict[str, Any], now: str) -> int:
    existing = conn.execute(
        "SELECT id, field_evidence_json FROM tribology_data WHERE id = ? AND literature_id = ?",
        (row["record_id"], lit_id),
    ).fetchone()
    if not existing:
        existing = conn.execute(
            """
            SELECT id, field_evidence_json
              FROM tribology_data
             WHERE literature_id = ?
               AND lubricant = ?
               AND substrate_material = ?
               AND probe_material = ?
               AND ABS(cof_value - ?) < 0.000001
             ORDER BY id
             LIMIT 1
            """,
            (lit_id, row["lubricant"], row["substrate"], row["probe_material"], row["cof_value"]),
        ).fetchone()

    field_evidence = patch_field_evidence(existing["field_evidence_json"] if existing else None, row)

    if existing:
        record_id = int(existing["id"])
        conn.execute(
            """
            UPDATE tribology_data
               SET material_name = ?,
                   lubricant = ?,
                   lubricant_alias = ?,
                   cof_value = ?,
                   cof_raw = ?,
                   load_value = NULL,
                   load_raw = NULL,
                   load_conditions_json = ?,
                   speed_value = NULL,
                   speed_conditions_json = ?,
                   temperature = '298.15 K',
                   probe_material = ?,
                   probe_geometry = 'Colloid probe',
                   probe_radius = ?,
                   substrate_material = ?,
                   sample_id = ?,
                   series_id = ?,
                   cation = ?,
                   anion = ?,
                   source_page = ?,
                   source_figure = ?,
                   evidence_page = ?,
                   cof_extracted_json = ?,
                   tribological_system_json = ?,
                   field_evidence_json = ?,
                   review_status = 'approved',
                   record_origin = 'codex_reviewed_condition',
                   confidence = 0.96,
                   extracted_at = ?,
                   assembly_notes = ?
             WHERE id = ?
            """,
            (
                row["material_name"],
                row["lubricant"],
                row["lubricant_alias"],
                row["cof_value"],
                row["cof_raw"],
                dumps(LOAD_CONDITIONS),
                dumps(SCAN_RATE_CONDITIONS),
                row["probe_material"],
                PROBE_RADIUS,
                row["substrate"],
                row["sample_id"],
                SERIES_ID,
                row["cation"],
                row["anion"],
                SOURCE_PAGE,
                SOURCE_FIGURE,
                SOURCE_PAGE,
                cof_json(row),
                tribological_system_json(row),
                field_evidence,
                now,
                ASSEMBLY_NOTE,
                record_id,
            ),
        )
        return record_id

    cursor = conn.execute(
        """
        INSERT INTO tribology_data (
            literature_id, material_name, lubricant, lubricant_alias, cof_value,
            cof_raw, load_value, load_raw, load_conditions_json, speed_value,
            speed_conditions_json, temperature, probe_material, probe_geometry,
            probe_radius, substrate_material, sample_id, series_id, cation, anion,
            source_page, source_figure, evidence_page, cof_extracted_json,
            tribological_system_json, field_evidence_json, review_status,
            record_origin, confidence, extracted_at, assembly_notes
        ) VALUES (
            ?, ?, ?, ?, ?, ?, NULL, NULL, ?, NULL, ?, '298.15 K', ?, 'Colloid probe',
            ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'approved',
            'codex_reviewed_condition', 0.96, ?, ?
        )
        """,
        (
            lit_id,
            row["material_name"],
            row["lubricant"],
            row["lubricant_alias"],
            row["cof_value"],
            row["cof_raw"],
            dumps(LOAD_CONDITIONS),
            dumps(SCAN_RATE_CONDITIONS),
            row["probe_material"],
            PROBE_RADIUS,
            row["substrate"],
            row["sample_id"],
            SERIES_ID,
            row["cation"],
            row["anion"],
            SOURCE_PAGE,
            SOURCE_FIGURE,
            SOURCE_PAGE,
            cof_json(row),
            tribological_system_json(row),
            field_evidence,
            now,
            ASSEMBLY_NOTE,
        ),
    )
    return int(cursor.lastrowid)


def update_candidate(conn: sqlite3.Connection, candidate_id: int, record_id: int, row: dict[str, Any], now: str) -> bool:
    candidate = conn.execute(
        "SELECT id, field_evidence_json FROM record_candidates WHERE id = ?",
        (candidate_id,),
    ).fetchone()
    if not candidate:
        return False
    conn.execute(
        """
        UPDATE record_candidates
           SET promoted_record_id = ?,
               promoted_at = ?,
               review_status = 'approved',
               material_name = ?,
               lubricant = ?,
               lubricant_alias = ?,
               cof_value = ?,
               cof_raw = ?,
               load_value = NULL,
               load_raw = NULL,
               load_conditions_json = ?,
               speed_value = NULL,
               speed_conditions_json = ?,
               temperature = '298.15 K',
               probe_material = ?,
               probe_geometry = 'Colloid probe',
               probe_radius = ?,
               substrate_material = ?,
               sample_id = ?,
               series_id = ?,
               cation = ?,
               anion = ?,
               source_page = ?,
               source_figure = ?,
               evidence_page = ?,
               cof_extracted_json = ?,
               tribological_system_json = ?,
               field_evidence_json = ?,
               record_origin = 'codex_reviewed_condition',
               confidence = 0.96,
               assembly_notes = ?
         WHERE id = ?
        """,
        (
            record_id,
            now,
            row["material_name"],
            row["lubricant"],
            row["lubricant_alias"],
            row["cof_value"],
            row["cof_raw"],
            dumps(LOAD_CONDITIONS),
            dumps(SCAN_RATE_CONDITIONS),
            row["probe_material"],
            PROBE_RADIUS,
            row["substrate"],
            row["sample_id"],
            SERIES_ID,
            row["cation"],
            row["anion"],
            SOURCE_PAGE,
            SOURCE_FIGURE,
            SOURCE_PAGE,
            cof_json(row),
            tribological_system_json(row),
            patch_field_evidence(candidate["field_evidence_json"], row),
            ASSEMBLY_NOTE,
            candidate_id,
        ),
    )
    return True


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
        updated_records = 0
        linked_candidates = 0
        record_map: dict[int, int] = {}

        with conn:
            for row in ROWS:
                record_id = ensure_record(conn, lit_id, row, now)
                record_map[int(row["record_id"])] = record_id
                updated_records += 1
                for candidate_id in row["candidate_ids"]:
                    if update_candidate(conn, int(candidate_id), record_id, row, now):
                        linked_candidates += 1
            duplicate_literature = update_literature(conn, lit_id, now)

        print(f"backup={backup_path}")
        print(f"literature_id={lit_id}")
        print(f"upserted_records={updated_records}")
        print(f"linked_candidates={linked_candidates}")
        print(f"duplicate_literature_marked={duplicate_literature}")
        print(f"record_map={record_map}")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
