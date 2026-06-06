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
DOI = "10.1021/acs.nanolett.5c01851"
USER_ID = 1


def dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def backup_database(db_path: Path) -> Path:
    backup_path = db_path.with_suffix(db_path.suffix + f".bak-nanolett-2025-470-478-{int(time.time())}")
    shutil.copy2(db_path, backup_path)
    return backup_path


def components(*items: tuple[str, str | None, float | None]) -> str:
    payload = []
    for name, role, fraction in items:
        entry: dict[str, Any] = {"name": name}
        if role:
            entry["role"] = role
        if fraction is not None:
            entry["fraction"] = fraction
            entry["unit"] = "molar_ratio"
        payload.append(entry)
    return dumps(payload)


def cof_payload(raw: str, figure: str, note: str) -> str:
    return dumps(
        {
            "raw_text": raw,
            "cof_average": None,
            "cof_min": None,
            "cof_max": None,
            "cof_values": [],
            "extraction_method": "codex_review",
            "source": figure,
            "note": note,
        }
    )


def tribosystem(raw_text: str, *, regime: str = "superlubric") -> str:
    return dumps(
        {
            "raw_text": raw_text,
            "friction_regime": regime,
            "contact_geometry": "afm_tip",
            "scale": "nanoscale",
            "method": "AFM lateral/friction force microscopy",
            "instrument": "AFM",
            "measurement_type": "friction_coefficient",
            "profile": "nanoscale_afm_lfm",
            "training_view": "AFM LFM nanofriction on monolayer ionic liquid/perfluorocarbon films on graphite.",
        }
    )


def evidence_map(row: dict[str, Any]) -> str:
    evidence = {
        "source_type": "text",
        "page": row["source_page"],
        "source_label": row["source_figure"],
        "quote": row["evidence"],
        "bbox": None,
        "matched_text": row["matched_text"],
    }
    field_map = {
        "material": {"value": row["material_name"], "confidence": 0.9, "evidence": evidence},
        "ionic_liquid": {"value": row["lubricant"], "confidence": 0.9, "evidence": evidence},
        "cof": {"value": row["cof_raw"], "confidence": 0.88, "evidence": evidence},
        "probe_material": {"value": row["probe_material"], "confidence": 0.86, "evidence": evidence},
        "probe_geometry": {"value": row["probe_geometry"], "confidence": 0.86, "evidence": evidence},
        "substrate_material": {"value": row["substrate_material"], "confidence": 0.9, "evidence": evidence},
        "temperature": {"value": "298.15 K", "confidence": 0.7, "evidence": evidence},
        "source": {"value": row["source_figure"], "confidence": 0.9, "evidence": evidence},
    }
    if row.get("mol_ratio"):
        field_map["mol_ratio"] = {"value": row["mol_ratio"], "confidence": 0.9, "evidence": evidence}
    return dumps(field_map)


REVIEWED_ROWS: dict[int, dict[str, Any]] = {
    470: {
        "sample_id": "nanolett-2025-470-pure-il-baseline",
        "series_id": "nanolett-2025-il-perfluorocarbon-superlubricity",
        "material_name": "AFM probe / C18mimBr monolayer film / graphite substrate",
        "lubricant": "C18mimBr ionic liquid",
        "lubricant_components_json": components(("C18mimBr", "ionic_liquid", None)),
        "cof_value": 0.001,
        "cof_raw": "order of 10^-3",
        "cof_extracted_json": cof_payload("order of 10^-3", "Figure 1c", "Pure IL baseline reported at the 10^-3 friction-coefficient order."),
        "source_page": 2,
        "source_figure": "Figure 1c",
        "evidence": "Pure IL and pure CnF2n+2 systems fall within the 10^-3 friction coefficient order; composite systems reach 10^-4 in Figure 1c.",
        "matched_text": "friction coefficients measured for both pure IL and pure CnF2n+2 systems",
        "probe_material": "AFM probe",
        "probe_geometry": "AFM tip",
        "probe_radius": None,
        "substrate_material": "graphite substrate",
        "mol_ratio": None,
        "regime": "Pure C18mimBr monolayer baseline on graphite.",
        "tribological_system_json": tribosystem("AFM probe sliding on a C18mimBr monolayer film on graphite.", regime="boundary"),
    },
    471: {
        "sample_id": "nanolett-2025-471-pure-il-dnp10",
        "series_id": "nanolett-2025-il-perfluorocarbon-superlubricity",
        "material_name": "DNP-10 AFM C tip / C18mimBr monolayer film / graphite substrate",
        "lubricant": "C18mimBr ionic liquid",
        "lubricant_components_json": components(("C18mimBr", "ionic_liquid", None)),
        "cof_value": 0.001,
        "cof_raw": "order of 10^-3",
        "cof_extracted_json": cof_payload("order of 10^-3", "Figure 3e", "Pure IL and pure perfluorocarbon baselines are reported one order higher than the composite system."),
        "source_page": 5,
        "source_figure": "Figure 3e",
        "evidence": "Pure IL and pure CnF2n+2 systems exhibited friction coefficients of the 10^-3 order; friction experiments used DNP-10 C probes with an approximately 20 nm radius.",
        "matched_text": "DNP-10 probes (C tip) with a radius of approximately 20 nm",
        "probe_material": "DNP-10 AFM C tip",
        "probe_geometry": "AFM tip",
        "probe_radius": "approximately 20 nm",
        "substrate_material": "graphite substrate",
        "mol_ratio": None,
        "regime": "Pure C18mimBr monolayer baseline measured by AFM friction force microscopy.",
        "tribological_system_json": tribosystem("DNP-10 AFM C tip sliding on a C18mimBr monolayer film on graphite.", regime="boundary"),
    },
    472: {
        "sample_id": "nanolett-2025-472-composite-window",
        "series_id": "nanolett-2025-il-perfluorocarbon-superlubricity",
        "material_name": "AFM probe / C18mimBr-CnF2n+2 composite monolayer film / graphite substrate",
        "lubricant": "C18mimBr-CnF2n+2 composite system",
        "lubricant_components_json": components(("C18mimBr", "ionic_liquid", None), ("CnF2n+2", "perfluorocarbon_additive", None)),
        "cof_value": 0.0001,
        "cof_raw": "order of 10^-4",
        "cof_extracted_json": cof_payload("order of 10^-4", "Figure 1c", "The composite system reaches superlubricity within a specific molar-ratio range."),
        "source_page": 2,
        "source_figure": "Figure 1c",
        "evidence": "Within a specific ratio range, the composite system achieves superlubricity with friction coefficients reaching the 10^-4 order in Figure 1c.",
        "matched_text": "friction coefficients reaching the order of 10^-4",
        "probe_material": "AFM probe",
        "probe_geometry": "AFM tip",
        "probe_radius": None,
        "substrate_material": "graphite substrate",
        "mol_ratio": "specific IL:CnF2n+2 superlubricity window",
        "regime": "C18mimBr-perfluorocarbon composite monolayer superlubricity window.",
        "tribological_system_json": tribosystem("AFM probe sliding on a C18mimBr-CnF2n+2 composite monolayer film on graphite."),
    },
    473: {
        "sample_id": "nanolett-2025-473-multiple-probe-radii",
        "series_id": "nanolett-2025-il-perfluorocarbon-superlubricity",
        "material_name": "AFM probe / C18mimBr-CnF2n+2 composite monolayer film / graphite substrate",
        "lubricant": "C18mimBr-CnF2n+2 composite system",
        "lubricant_components_json": components(("C18mimBr", "ionic_liquid", None), ("CnF2n+2", "perfluorocarbon_additive", None)),
        "cof_value": 0.0001,
        "cof_raw": "order of 10^-4",
        "cof_extracted_json": cof_payload("order of 10^-4", "Figure S2", "Superlubricity was reported across multiple AFM probe radii."),
        "source_page": 2,
        "source_figure": "Figure S2",
        "evidence": "Friction measurements across multiple probe radii consistently demonstrate coefficients on the order of 10^-4.",
        "matched_text": "friction measurements across multiple probe radii",
        "probe_material": "AFM probe",
        "probe_geometry": "AFM tip",
        "probe_radius": "10 nm; 20 nm; 1 μm",
        "substrate_material": "graphite substrate",
        "mol_ratio": None,
        "regime": "C18mimBr-perfluorocarbon composite monolayer tested across multiple AFM probe radii.",
        "tribological_system_json": tribosystem("AFM probes with multiple radii sliding on C18mimBr-CnF2n+2 composite monolayer films on graphite."),
    },
    474: {
        "sample_id": "nanolett-2025-474-c12f26-20-to-1",
        "series_id": "nanolett-2025-il-perfluorocarbon-superlubricity",
        "material_name": "DNP-10 AFM C tip / C18mimBr-C12F26 (20:1) composite monolayer film / graphite substrate",
        "lubricant": "C18mimBr-C12F26 composite system",
        "lubricant_components_json": components(("C18mimBr", "ionic_liquid", 20), ("C12F26", "perfluorocarbon_additive", 1)),
        "cof_value": 0.0001,
        "cof_raw": "1 x 10^-4",
        "cof_extracted_json": cof_payload("1 x 10^-4", "Figure 3e", "C18mimBr-C12F26 at 20:1 reaches the superlubricity regime."),
        "source_page": 5,
        "source_figure": "Figure 3e",
        "evidence": "The C18mimBr-C12F26 (20:1) composite system achieved a friction coefficient of 1 x 10^-4; experiments used DNP-10 C probes with an approximately 20 nm radius.",
        "matched_text": "C18mimBr-C12F26 (20:1) composite system",
        "probe_material": "DNP-10 AFM C tip",
        "probe_geometry": "AFM tip",
        "probe_radius": "approximately 20 nm",
        "substrate_material": "graphite substrate",
        "mol_ratio": "IL:C12F26 = 20:1",
        "regime": "C18mimBr-C12F26 20:1 composite monolayer superlubricity.",
        "tribological_system_json": tribosystem("DNP-10 AFM C tip sliding on a C18mimBr-C12F26 20:1 composite monolayer film on graphite."),
    },
    475: {
        "sample_id": "nanolett-2025-475-c12f26-window",
        "series_id": "nanolett-2025-il-perfluorocarbon-superlubricity",
        "material_name": "DNP-10 AFM C tip / C18mimBr-C12F26 composite monolayer film / graphite substrate",
        "lubricant": "C18mimBr-C12F26 composite system",
        "lubricant_components_json": components(("C18mimBr", "ionic_liquid", None), ("C12F26", "perfluorocarbon_additive", None)),
        "cof_value": 0.0001,
        "cof_raw": "order of 10^-4",
        "cof_extracted_json": cof_payload("order of 10^-4", "Figure 3g", "C12F26 gives the broadest superlubricity window."),
        "source_page": 5,
        "source_figure": "Figure 3g",
        "evidence": "C12F26 displays the broadest superlubricity window spanning from 1:1 to 50:1 (IL:C12F26).",
        "matched_text": "1:1 to 50:1 (IL:C12F26)",
        "probe_material": "DNP-10 AFM C tip",
        "probe_geometry": "AFM tip",
        "probe_radius": "approximately 20 nm",
        "substrate_material": "graphite substrate",
        "mol_ratio": "IL:C12F26 = 1:1-50:1",
        "regime": "C18mimBr-C12F26 composite monolayer superlubricity ratio window.",
        "tribological_system_json": tribosystem("DNP-10 AFM C tip sliding on C18mimBr-C12F26 composite monolayer films on graphite over the 1:1-50:1 molar-ratio window."),
    },
    476: {
        "sample_id": "nanolett-2025-476-c14f30-window",
        "series_id": "nanolett-2025-il-perfluorocarbon-superlubricity",
        "material_name": "DNP-10 AFM C tip / C18mimBr-C14F30 composite monolayer film / graphite substrate",
        "lubricant": "C18mimBr-C14F30 composite system",
        "lubricant_components_json": components(("C18mimBr", "ionic_liquid", None), ("C14F30", "perfluorocarbon_additive", None)),
        "cof_value": 0.0001,
        "cof_raw": "order of 10^-4",
        "cof_extracted_json": cof_payload("order of 10^-4", "Figure 3g", "C14F30 gives a narrower superlubricity window than C12F26."),
        "source_page": 5,
        "source_figure": "Figure 3g",
        "evidence": "C14F30 exhibits a narrower superlubricity window of 40:1-10:1.",
        "matched_text": "C14F30 ... 40:1-10:1",
        "probe_material": "DNP-10 AFM C tip",
        "probe_geometry": "AFM tip",
        "probe_radius": "approximately 20 nm",
        "substrate_material": "graphite substrate",
        "mol_ratio": "IL:C14F30 = 40:1-10:1",
        "regime": "C18mimBr-C14F30 composite monolayer superlubricity ratio window.",
        "tribological_system_json": tribosystem("DNP-10 AFM C tip sliding on C18mimBr-C14F30 composite monolayer films on graphite over the 40:1-10:1 molar-ratio window."),
    },
    477: {
        "sample_id": "nanolett-2025-477-c16f34-window",
        "series_id": "nanolett-2025-il-perfluorocarbon-superlubricity",
        "material_name": "DNP-10 AFM C tip / C18mimBr-C16F34 composite monolayer film / graphite substrate",
        "lubricant": "C18mimBr-C16F34 composite system",
        "lubricant_components_json": components(("C18mimBr", "ionic_liquid", None), ("C16F34", "perfluorocarbon_additive", None)),
        "cof_value": 0.0001,
        "cof_raw": "order of 10^-4",
        "cof_extracted_json": cof_payload("order of 10^-4", "Figure 3g", "C16F34 gives a narrower superlubricity window than C12F26."),
        "source_page": 5,
        "source_figure": "Figure 3g",
        "evidence": "C16F34 exhibits a narrower superlubricity window of 30:1-20:1.",
        "matched_text": "C16F34 ... 30:1-20:1",
        "probe_material": "DNP-10 AFM C tip",
        "probe_geometry": "AFM tip",
        "probe_radius": "approximately 20 nm",
        "substrate_material": "graphite substrate",
        "mol_ratio": "IL:C16F34 = 30:1-20:1",
        "regime": "C18mimBr-C16F34 composite monolayer superlubricity ratio window.",
        "tribological_system_json": tribosystem("DNP-10 AFM C tip sliding on C18mimBr-C16F34 composite monolayer films on graphite over the 30:1-20:1 molar-ratio window."),
    },
    478: {
        "sample_id": "nanolett-2025-478-trace-perfluorocarbon",
        "series_id": "nanolett-2025-il-perfluorocarbon-superlubricity",
        "material_name": "AFM probe / ordered C18mimBr-CnF2n+2 composite monolayer film / graphite substrate",
        "lubricant": "C18mimBr-CnF2n+2 composite system",
        "lubricant_components_json": components(("C18mimBr", "ionic_liquid", None), ("CnF2n+2", "perfluorocarbon_additive", None)),
        "cof_value": 0.0001,
        "cof_raw": "as low as 10^-4",
        "cof_extracted_json": cof_payload("as low as 10^-4", "Abstract", "Trace perfluorocarbon additives produce an ordered monolayer film with 10^-4-level friction."),
        "source_page": 1,
        "source_figure": "Abstract",
        "evidence": "The C18mimBr-perfluorocarbon composite system achieves a friction coefficient as low as 10^-4 by forming a robust highly ordered monolayer film.",
        "matched_text": "friction coefficient as low as 10^-4",
        "probe_material": "AFM probe",
        "probe_geometry": "AFM tip",
        "probe_radius": None,
        "substrate_material": "graphite substrate",
        "mol_ratio": "trace CnF2n+2 additive",
        "regime": "Ordered C18mimBr-perfluorocarbon composite monolayer superlubricity.",
        "tribological_system_json": tribosystem("AFM probe sliding on an ordered C18mimBr-CnF2n+2 composite monolayer film on graphite."),
    },
}


def upsert_reviewed_rows(conn: sqlite3.Connection, lit_id: int) -> tuple[int, int]:
    now = now_iso()
    tribology_columns = [
        row[1]
        for row in conn.execute("PRAGMA table_info(tribology_data)").fetchall()
        if row[1] != "id"
    ]
    candidate_columns = {
        row[1] for row in conn.execute("PRAGMA table_info(record_candidates)").fetchall()
    }

    inserted_or_updated = 0
    linked_candidates = 0
    for candidate_id, reviewed in REVIEWED_ROWS.items():
        candidate = conn.execute(
            "SELECT * FROM record_candidates WHERE id = ? AND literature_id = ?",
            (candidate_id, lit_id),
        ).fetchone()
        candidate_payload = dict(candidate) if candidate else {}
        existing_id = candidate_payload.get("promoted_record_id")
        if not existing_id:
            existing = conn.execute(
                "SELECT id FROM tribology_data WHERE sample_id = ?",
                (reviewed["sample_id"],),
            ).fetchone()
            existing_id = existing["id"] if existing else None

        payload: dict[str, Any] = {}
        for column in tribology_columns:
            if column in candidate_columns:
                payload[column] = candidate_payload.get(column)
            else:
                payload[column] = None

        payload.update(reviewed)
        payload.update(
            {
                "literature_id": lit_id,
                "load_value": None,
                "load_raw": None,
                "load_conditions_json": None,
                "speed_value": None,
                "speed_conditions_json": None,
                "temperature": "298.15 K",
                "potential": None,
                "water_content": None,
                "surface_roughness": "ordered monolayer film on graphite",
                "substrate_roughness": None,
                "cation": "C18mim",
                "anion": "Br",
                "cation_smiles": None,
                "anion_smiles": None,
                "il_smiles": None,
                "il_inchikey": None,
                "alkyl_chain_length": 18,
                "extracted_at": now,
                "confidence": 0.9,
                "source": "Unlocking Superlubricity: Ionic Liquids Meet Perfluorocarbons",
                "evidence_page": reviewed["source_page"],
                "evidence_bbox": None,
                "field_evidence_json": evidence_map(reviewed),
                "review_status": "approved",
                "record_origin": "review_promoted_candidate",
                "assembly_notes": (
                    "Codex reviewed Nano Letters 2025 weak candidate; removed spurious load "
                    "values derived from friction-coefficient exponents or IL:perfluorocarbon ratios."
                ),
            }
        )

        values = [payload.get(column) for column in tribology_columns]
        if existing_id:
            assignments = ", ".join(f"{column} = ?" for column in tribology_columns)
            conn.execute(
                f"UPDATE tribology_data SET {assignments} WHERE id = ?",
                [*values, existing_id],
            )
            record_id = int(existing_id)
        else:
            placeholders = ", ".join("?" for _ in tribology_columns)
            conn.execute(
                f"INSERT INTO tribology_data ({', '.join(tribology_columns)}) VALUES ({placeholders})",
                values,
            )
            record_id = int(conn.execute("SELECT last_insert_rowid()").fetchone()[0])
        inserted_or_updated += 1

        if candidate:
            conn.execute(
                """
                UPDATE record_candidates
                   SET promoted_record_id = ?,
                       promoted_at = ?,
                       review_status = 'approved',
                       load_value = NULL,
                       load_raw = NULL,
                       load_conditions_json = NULL,
                       mol_ratio = ?,
                       cation = 'C18mim',
                       anion = 'Br',
                       assembly_notes = 'Codex reviewed and promoted to Library; spurious load removed.'
                 WHERE id = ?
                """,
                (record_id, now, reviewed.get("mol_ratio"), candidate_id),
            )
            linked_candidates += 1
    return inserted_or_updated, linked_candidates


def main() -> int:
    db_path = DB_PATH
    if not db_path.exists():
        raise SystemExit(f"Database not found: {db_path}")

    backup_path = backup_database(db_path)
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    try:
        literature = conn.execute(
            "SELECT id FROM literature WHERE lower(doi) = lower(?) ORDER BY id DESC LIMIT 1",
            (DOI,),
        ).fetchone()
        if not literature:
            print(f"no matching literature for DOI {DOI}; backup={backup_path}")
            return 0
        lit_id = int(literature["id"])
        now = now_iso()
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
                   review_note = 'Codex reviewed rows #470-478 and promoted corrected Nano Letters 2025 tribology records.'
             WHERE id = ?
            """,
            (now, USER_ID, lit_id),
        )
        records, candidates = upsert_reviewed_rows(conn, lit_id)
        conn.commit()
    finally:
        conn.close()

    print(f"backup={backup_path}")
    print(f"literature_id={lit_id}")
    print(f"upserted_reviewed_records={records}")
    print(f"linked_candidates={candidates}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
