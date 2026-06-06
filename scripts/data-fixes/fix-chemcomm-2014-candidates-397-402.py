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
DOI = "10.1039/c4cc00979g"
USER_ID = 1


def dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def backup_database(db_path: Path) -> Path:
    backup_path = db_path.with_suffix(db_path.suffix + f".bak-chemcomm-2014-397-402-{int(time.time())}")
    shutil.copy2(db_path, backup_path)
    return backup_path


def load_conditions() -> str:
    return dumps(
        {
            "raw_text": ">10 nN single-interfacial-layer region; load ramp 0-40 nN",
            "value_type": "range",
            "system_total_load_N": None,
            "contact_load_per_unit_N": None,
            "contact_unit_type": None,
            "load_min_N": 1e-8,
            "load_max_N": 4e-8,
            "note": "The paper discusses the Fig. 2 friction coefficients for normal forces greater than 10 nN; the load was ramped from 0 to 40 nN.",
        }
    )


def speed_conditions() -> str:
    return dumps(
        {
            "raw_text": "scan speed of 6.5 μm s^-1",
            "value_type": "single",
            "speed_value": 6.5,
            "speed_unit": "μm/s",
            "sliding_speed_um_s": 6.5,
            "note": "Fig. 2 measurements used 100 nm scan size at 6.5 μm/s.",
        }
    )


def cof_payload(raw: str, condition: str) -> str:
    return dumps(
        {
            "raw_text": raw,
            "value_type": "single",
            "cof_min": float(raw),
            "cof_max": float(raw),
            "cof_average": float(raw),
            "dependent_variable": "potential",
            "test_condition_value": condition,
            "source": "Fig. 2",
        }
    )


def tribosystem(raw_text: str, *, regime: str) -> str:
    return dumps(
        {
            "raw_text": raw_text,
            "friction_regime": regime,
            "contact_geometry": "afm_tip",
            "scale": "nanoscale",
            "method": "AFM friction force microscopy",
            "instrument": "AFM",
            "measurement_type": "friction_coefficient",
            "profile": "nanoscale_afm_ffm",
            "training_view": "Silica AFM tip sliding on HOPG with potential-controlled [HMIM][FAP] boundary layers.",
        }
    )


def field_evidence(row: dict[str, Any]) -> str:
    source = {
        "source_type": "text",
        "page": 2,
        "source_label": "Fig. 2",
        "quote": row["evidence"],
        "bbox": None,
        "matched_text": row["matched_text"],
    }
    field_map = {
        "material": {"value": row["material_name"], "confidence": 0.9, "evidence": source},
        "ionic_liquid": {"value": row["lubricant"], "confidence": 0.9, "evidence": source},
        "cof": {"value": row["cof_raw"], "confidence": 0.92, "evidence": source},
        "load": {"value": ">10 nN; ramp 0-40 nN", "confidence": 0.9, "evidence": source},
        "speed": {"value": "6.5 μm/s", "confidence": 0.9, "evidence": source},
        "probe_material": {"value": "Silica", "confidence": 0.9, "evidence": source},
        "probe_geometry": {"value": "AFM tip", "confidence": 0.9, "evidence": source},
        "probe_radius": {"value": "~5 nm", "confidence": 0.82, "evidence": source},
        "substrate_material": {"value": "HOPG", "confidence": 0.95, "evidence": source},
        "temperature": {"value": "298.15 K", "confidence": 0.65, "evidence": source},
        "source": {"value": "Fig. 2", "confidence": 0.9, "evidence": source},
    }
    if row.get("potential"):
        field_map["potential"] = {"value": row["potential"], "confidence": 0.92, "evidence": source}
    if row.get("water_content"):
        field_map["water_content"] = {"value": row["water_content"], "confidence": 0.9, "evidence": source}
    return dumps(field_map)


ROWS: dict[int, dict[str, Any]] = {
    397: {
        "sample_id": "chemcomm-2014-hmim-fap-hopg-air-control",
        "material_name": "silica AFM tip / HOPG",
        "lubricant": "air control (no ionic liquid)",
        "cof_value": 0.013,
        "cof_raw": "0.013",
        "potential": None,
        "water_content": "in air",
        "cation": None,
        "anion": None,
        "evidence": "Fig. 2 air control: silica AFM tip sliding on HOPG in air; μ=0.013.",
        "matched_text": "control experiments obtained in air",
        "regime": "Unlubricated air-control FFM measurement on HOPG.",
        "tribological_system_json": tribosystem("Silica AFM tip sliding on HOPG in air as the Fig. 2 control.", regime="boundary"),
    },
    398: {
        "sample_id": "chemcomm-2014-hmim-fap-hopg-0v",
        "material_name": "silica AFM tip / [HMIM][FAP] boundary layer / HOPG",
        "lubricant": "[HMIM][FAP]",
        "cof_value": 0.019,
        "cof_raw": "0.019",
        "potential": "0 V vs Pt quasi-reference",
        "water_content": None,
        "cation": "HMIM",
        "anion": "FAP",
        "evidence": "Fig. 2 and text report μ=0.019 at 0 V for normal forces greater than 10 nN.",
        "matched_text": "friction coefficient at 0 V ... greater than 10 nN is 0.019",
        "regime": "[HMIM][FAP] boundary layer on HOPG at 0 V.",
        "tribological_system_json": tribosystem("Silica AFM tip sliding on a [HMIM][FAP] boundary layer on HOPG at 0 V.", regime="boundary"),
    },
    399: {
        "sample_id": "chemcomm-2014-hmim-fap-hopg-minus-1v",
        "material_name": "silica AFM tip / [HMIM][FAP] boundary layer / HOPG",
        "lubricant": "[HMIM][FAP]",
        "cof_value": 0.020,
        "cof_raw": "0.020",
        "potential": "-1 V vs Pt quasi-reference",
        "water_content": None,
        "cation": "HMIM",
        "anion": "FAP",
        "evidence": "Fig. 2 labels the -1.0 V condition with μ=0.020 in the single-interfacial-layer region.",
        "matched_text": "-1.0 V μ=0.020",
        "regime": "Cation-rich [HMIM][FAP] boundary layer on HOPG at negative potential.",
        "tribological_system_json": tribosystem("Silica AFM tip sliding on a [HMIM][FAP] boundary layer on HOPG at -1 V.", regime="boundary"),
    },
    400: {
        "sample_id": "chemcomm-2014-hmim-fap-hopg-minus-1p5v",
        "material_name": "silica AFM tip / [HMIM][FAP] boundary layer / HOPG",
        "lubricant": "[HMIM][FAP]",
        "cof_value": 0.020,
        "cof_raw": "0.020",
        "potential": "-1.5 V vs Pt quasi-reference",
        "water_content": None,
        "cation": "HMIM",
        "anion": "FAP",
        "evidence": "Fig. 2 labels the -1.5 V condition with μ=0.020 in the single-interfacial-layer region.",
        "matched_text": "-1.5 V μ=0.020",
        "regime": "Cation-rich [HMIM][FAP] boundary layer on HOPG at negative potential.",
        "tribological_system_json": tribosystem("Silica AFM tip sliding on a [HMIM][FAP] boundary layer on HOPG at -1.5 V.", regime="boundary"),
    },
    401: {
        "sample_id": "chemcomm-2014-hmim-fap-hopg-plus-1v",
        "material_name": "silica AFM tip / [HMIM][FAP] boundary layer / HOPG",
        "lubricant": "[HMIM][FAP]",
        "cof_value": 0.012,
        "cof_raw": "0.012",
        "potential": "+1 V vs Pt quasi-reference",
        "water_content": None,
        "cation": "HMIM",
        "anion": "FAP",
        "evidence": "Text reports μ=0.012 at +1.0 V, lower than at negative potentials.",
        "matched_text": "friction coefficient at +1.0 V is 0.012",
        "regime": "Anion-rich [HMIM][FAP] boundary layer on HOPG at positive potential.",
        "tribological_system_json": tribosystem("Silica AFM tip sliding on an anion-rich [HMIM][FAP] boundary layer on HOPG at +1 V.", regime="boundary"),
    },
    402: {
        "sample_id": "chemcomm-2014-hmim-fap-hopg-plus-1p5v",
        "material_name": "silica AFM tip / [HMIM][FAP] boundary layer / HOPG",
        "lubricant": "[HMIM][FAP]",
        "cof_value": 0.001,
        "cof_raw": "0.001",
        "potential": "+1.5 V vs Pt quasi-reference",
        "water_content": None,
        "cation": "HMIM",
        "anion": "FAP",
        "evidence": "Text reports μ=0.001 at +1.5 V, below the superlubricity threshold.",
        "matched_text": "friction coefficient for +1.5 V is 0.001",
        "regime": "Anion-rich [HMIM][FAP] boundary layer on HOPG in the superlubricity regime.",
        "tribological_system_json": tribosystem("Silica AFM tip sliding on an anion-rich [HMIM][FAP] boundary layer on HOPG at +1.5 V.", regime="superlubric"),
    },
}


def upsert_rows(conn: sqlite3.Connection, lit_id: int) -> tuple[int, int]:
    now = now_iso()
    tribology_columns = [row[1] for row in conn.execute("PRAGMA table_info(tribology_data)") if row[1] != "id"]
    candidate_columns = {row[1] for row in conn.execute("PRAGMA table_info(record_candidates)")}
    records = 0
    links = 0
    for candidate_id, reviewed in ROWS.items():
        candidate = conn.execute(
            "SELECT * FROM record_candidates WHERE id = ? AND literature_id = ?",
            (candidate_id, lit_id),
        ).fetchone()
        candidate_payload = dict(candidate) if candidate else {}
        existing_id = candidate_payload.get("promoted_record_id")
        if not existing_id:
            existing = conn.execute("SELECT id FROM tribology_data WHERE sample_id = ?", (reviewed["sample_id"],)).fetchone()
            existing_id = existing["id"] if existing else None

        payload = {column: candidate_payload.get(column) if column in candidate_columns else None for column in tribology_columns}
        payload.update(reviewed)
        payload.update(
            {
                "literature_id": lit_id,
                "lubricant_components_json": None,
                "load_value": ">10 nN; ramp 0-40 nN",
                "load_raw": "single-interfacial-layer region above 10 nN; load ramp 0-40 nN",
                "load_conditions_json": load_conditions(),
                "speed_value": "6.5 μm/s",
                "speed_conditions_json": speed_conditions(),
                "shear_rate": None,
                "temperature": "298.15 K",
                "surface_roughness": "freshly cleaved HOPG",
                "probe_material": "Silica",
                "probe_geometry": "AFM tip",
                "probe_radius": "~5 nm",
                "substrate_material": "HOPG",
                "substrate_roughness": "freshly cleaved HOPG",
                "cof_extracted_json": cof_payload(reviewed["cof_raw"], reviewed.get("potential") or "air control"),
                "source": "An ionic liquid lubricant enables superlubricity to be switched on in situ using an electrical potential",
                "source_page": 2,
                "source_figure": "Fig. 2",
                "evidence_page": 2,
                "evidence_bbox": None,
                "field_evidence_json": field_evidence(reviewed),
                "review_status": "approved",
                "record_origin": "review_promoted_candidate",
                "confidence": 0.93,
                "extracted_at": now,
                "alkyl_chain_length": 6 if reviewed.get("cation") else None,
                "assembly_notes": "Codex reviewed ChemComm 2014 Fig. 2 candidates; corrected speed, load region, probe material, and air-control labeling.",
            }
        )
        values = [payload.get(column) for column in tribology_columns]
        if existing_id:
            assignments = ", ".join(f"{column} = ?" for column in tribology_columns)
            conn.execute(f"UPDATE tribology_data SET {assignments} WHERE id = ?", [*values, existing_id])
            record_id = int(existing_id)
        else:
            placeholders = ", ".join("?" for _ in tribology_columns)
            conn.execute(
                f"INSERT INTO tribology_data ({', '.join(tribology_columns)}) VALUES ({placeholders})",
                values,
            )
            record_id = int(conn.execute("SELECT last_insert_rowid()").fetchone()[0])
        records += 1
        if candidate:
            conn.execute(
                """
                UPDATE record_candidates
                   SET promoted_record_id = ?,
                       promoted_at = ?,
                       review_status = 'approved',
                       load_value = '>10 nN; ramp 0-40 nN',
                       load_raw = 'single-interfacial-layer region above 10 nN; load ramp 0-40 nN',
                       load_conditions_json = ?,
                       speed_value = '6.5 μm/s',
                       speed_conditions_json = ?,
                       probe_material = 'Silica',
                       probe_radius = '~5 nm',
                       cation = ?,
                       anion = ?,
                       lubricant = ?,
                       potential = ?,
                       assembly_notes = 'Codex reviewed and promoted to Library; corrected Fig. 2 conditions.'
                 WHERE id = ?
                """,
                (
                    record_id,
                    now,
                    load_conditions(),
                    speed_conditions(),
                    reviewed.get("cation"),
                    reviewed.get("anion"),
                    reviewed["lubricant"],
                    reviewed.get("potential"),
                    candidate_id,
                ),
            )
            links += 1
    return records, links


def main() -> int:
    if not DB_PATH.exists():
        raise SystemExit(f"Database not found: {DB_PATH}")
    backup = backup_database(DB_PATH)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        literature = conn.execute(
            "SELECT id FROM literature WHERE lower(doi) = lower(?) ORDER BY id DESC LIMIT 1",
            (DOI,),
        ).fetchone()
        if not literature:
            print(f"no matching literature for DOI {DOI}; backup={backup}")
            return 0
        lit_id = int(literature["id"])
        conn.execute(
            """
            UPDATE literature
               SET scope_type = 'group_library',
                   scope_key = 'group_library',
                   group_id = COALESCE(group_id, 1),
                   status = 'completed',
                   submission_status = 'approved',
                   reviewed_at = ?,
                   reviewed_by_user_id = ?,
                   review_note = 'Codex reviewed Fig. 2 candidates #397-402 and promoted corrected records.'
             WHERE id = ?
            """,
            (now_iso(), USER_ID, lit_id),
        )
        records, candidates = upsert_rows(conn, lit_id)
        conn.commit()
    finally:
        conn.close()

    print(f"backup={backup}")
    print(f"literature_id={lit_id}")
    print(f"upserted_reviewed_records={records}")
    print(f"linked_candidates={candidates}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
