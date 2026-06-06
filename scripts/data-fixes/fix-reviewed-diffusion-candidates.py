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
USER_ID = 1
UNIT = "10⁻¹² m²/s"


def dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def backup_database(db_path: Path) -> Path:
    backup_path = db_path.with_suffix(db_path.suffix + f".bak-reviewed-diffusion-{int(time.time())}")
    shutil.copy2(db_path, backup_path)
    return backup_path


def fetch_one(conn: sqlite3.Connection, sql: str, params: tuple[Any, ...]) -> sqlite3.Row | None:
    return conn.execute(sql, params).fetchone()


def literature_id(conn: sqlite3.Connection, doi: str, *, scope_type: str = "group_library") -> int:
    row = fetch_one(
        conn,
        """
        SELECT id
          FROM literature
         WHERE lower(doi) = lower(?)
           AND scope_type = ?
         ORDER BY id
         LIMIT 1
        """,
        (doi, scope_type),
    )
    if not row:
        raise RuntimeError(f"No {scope_type} literature found for DOI {doi}")
    return int(row["id"])


def standard_fields(record: dict[str, Any]) -> dict[str, Any]:
    coefficient_kind = "total"
    coefficient_value = record.get("d_total")
    diffusing_ion = "overall"
    if coefficient_value is None and record.get("d_cation") is not None and record.get("d_anion") is not None:
        coefficient_kind = "cation / anion"
        coefficient_value = record["d_cation"]
        diffusing_ion = "cation / anion"
    elif coefficient_value is None and record.get("d_anion") is not None:
        coefficient_kind = "anion"
        coefficient_value = record["d_anion"]
        diffusing_ion = "anion"
    elif coefficient_value is None and record.get("d_cation") is not None:
        coefficient_kind = "cation"
        coefficient_value = record["d_cation"]
        diffusing_ion = "cation"

    value = float(coefficient_value) if coefficient_value is not None else None
    return {
        "schema_version": "diffusion.standard.v1",
        "cation": record.get("cation"),
        "anion": record.get("anion"),
        "diffusing_ion": diffusing_ion,
        "data_type": "文献报道值",
        "coefficient_kind": coefficient_kind,
        "coefficient_value": value,
        "coefficient_unit": UNIT if value is not None else None,
        "coefficient_m2_s": value * 1e-12 if value is not None else None,
        "coefficient_a2_ps": value * 1e-4 if value is not None else None,
    }


def source_values(record: dict[str, Any]) -> dict[str, Any]:
    unit = record.get("source_unit", UNIT)
    values = {}
    for field, raw in (("D_total", record.get("raw_total")), ("D_cation", record.get("raw_cation")), ("D_anion", record.get("raw_anion"))):
        canonical_key = field.lower().replace("d_", "d_")
        canonical_value = record.get(canonical_key)
        if raw is None or canonical_value is None:
            continue
        values[field] = {
            "raw_text": f"{raw} {unit}",
            "raw_value": raw,
            "raw_unit": unit,
            "canonical_value": canonical_value,
            "canonical_unit": UNIT,
        }
    return values


def feature_json(record: dict[str, Any]) -> str:
    payload: dict[str, Any] = {
        "source_values": source_values(record),
        "standard_fields": standard_fields(record),
    }
    if record.get("water_uptake_value") is not None:
        payload["water_uptake_value"] = record["water_uptake_value"]
        payload["water_uptake_unit"] = "wt %"
    if record.get("surface_polarizability"):
        payload["surface_polarizability"] = record["surface_polarizability"]
    return dumps(payload)


def field_evidence_json(record: dict[str, Any]) -> str:
    evidence = {
        "source_type": "table",
        "page": record["source_page"],
        "source_label": record["source"],
        "quote": record["evidence"],
        "bbox": None,
    }
    values = {
        "system_name": record["system_name"],
        "ionic_liquid": record["ionic_liquid"],
        "d_total": record.get("d_total"),
        "d_cation": record.get("d_cation"),
        "d_anion": record.get("d_anion"),
        "d_unit": UNIT,
        "temperature_value": record.get("temperature_value"),
        "confinement_scale_value": record.get("confinement_scale_value"),
        "confinement_scale_unit": record.get("confinement_scale_unit"),
        "source_page": record["source_page"],
    }
    return dumps(
        {
            field: {
                "value": value,
                "confidence": 0.97,
                "evidence": evidence,
                "review_state": "approved",
            }
            for field, value in values.items()
        }
    )


def find_record(conn: sqlite3.Connection, record: dict[str, Any]) -> int | None:
    row = fetch_one(
        conn,
        """
        SELECT id
          FROM diffusion_records
         WHERE literature_id = ?
           AND system_name = ?
           AND ionic_liquid = ?
           AND source = ?
           AND COALESCE(confinement_scale_value, -999999) = COALESCE(?, -999999)
           AND COALESCE(surface_functional_groups, '') = COALESCE(?, '')
         ORDER BY id
         LIMIT 1
        """,
        (
            record["literature_id"],
            record["system_name"],
            record["ionic_liquid"],
            record["source"],
            record.get("confinement_scale_value"),
            record.get("surface_functional_groups"),
        ),
    )
    return int(row["id"]) if row else None


def upsert_record(conn: sqlite3.Connection, record: dict[str, Any], now: str) -> int:
    record_id = record.get("record_id") or find_record(conn, record)
    values = (
        record["literature_id"],
        record["system_name"],
        record["confinement_material_class"],
        record["confinement_geometry_class"],
        record.get("surface_functional_groups"),
        record["confinement_dimensionality"],
        record["ionic_liquid"],
        record.get("d_total"),
        record.get("d_cation"),
        record.get("d_anion"),
        UNIT,
        record.get("temperature_value"),
        record.get("confinement_scale_value"),
        record.get("confinement_scale_unit"),
        record["source"],
        record["source_page"],
        record["evidence"],
        "codex-reviewed",
        "codex-reviewed-diffusion",
        dumps({"reviewed_by": "Codex", "reviewed_at": now, "raw_model_output_was_audited": True}),
        field_evidence_json(record),
        "approved",
        "codex_reviewed_diffusion",
        record["assembly_notes"],
        0.97,
        feature_json(record),
        record.get("smiles"),
        now,
    )
    if record_id:
        conn.execute(
            """
            UPDATE diffusion_records
               SET literature_id = ?,
                   system_name = ?,
                   confinement_material_class = ?,
                   confinement_geometry_class = ?,
                   surface_functional_groups = ?,
                   confinement_dimensionality = ?,
                   ionic_liquid = ?,
                   d_total = ?,
                   d_cation = ?,
                   d_anion = ?,
                   d_unit = ?,
                   temperature_value = ?,
                   confinement_scale_value = ?,
                   confinement_scale_unit = ?,
                   source = ?,
                   source_page = ?,
                   evidence = ?,
                   provider = ?,
                   prompt_version = ?,
                   raw_model_output = ?,
                   field_evidence_json = ?,
                   review_status = ?,
                   record_origin = ?,
                   assembly_notes = ?,
                   confidence = ?,
                   novel_features_json = ?,
                   smiles = ?,
                   extracted_at = ?
             WHERE id = ?
            """,
            (*values, record_id),
        )
        return int(record_id)

    cursor = conn.execute(
        """
        INSERT INTO diffusion_records (
            literature_id, system_name, confinement_material_class, confinement_geometry_class,
            surface_functional_groups, confinement_dimensionality, ionic_liquid,
            d_total, d_cation, d_anion, d_unit, temperature_value,
            confinement_scale_value, confinement_scale_unit, source, source_page, evidence,
            provider, prompt_version, raw_model_output, field_evidence_json,
            review_status, record_origin, assembly_notes, confidence,
            novel_features_json, smiles, extracted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        values,
    )
    return int(cursor.lastrowid)


def update_candidate(conn: sqlite3.Connection, candidate_id: int, record_id: int, record: dict[str, Any], now: str) -> None:
    conn.execute(
        """
        UPDATE diffusion_candidates
           SET promoted_record_id = ?,
               promoted_at = COALESCE(promoted_at, ?),
               system_name = ?,
               confinement_material_class = ?,
               confinement_geometry_class = ?,
               surface_functional_groups = ?,
               confinement_dimensionality = ?,
               ionic_liquid = ?,
               d_total = ?,
               d_cation = ?,
               d_anion = ?,
               d_unit = ?,
               temperature_value = ?,
               confinement_scale_value = ?,
               confinement_scale_unit = ?,
               source = ?,
               source_page = ?,
               evidence = ?,
               provider = 'codex-reviewed',
               prompt_version = 'codex-reviewed-diffusion',
               raw_model_output = ?,
               field_evidence_json = ?,
               review_status = 'approved',
               record_origin = 'codex_reviewed_diffusion_candidate',
               assembly_notes = ?,
               confidence = 0.97,
               novel_features_json = ?,
               smiles = ?
         WHERE id = ?
        """,
        (
            record_id,
            now,
            record["system_name"],
            record["confinement_material_class"],
            record["confinement_geometry_class"],
            record.get("surface_functional_groups"),
            record["confinement_dimensionality"],
            record["ionic_liquid"],
            record.get("d_total"),
            record.get("d_cation"),
            record.get("d_anion"),
            UNIT,
            record.get("temperature_value"),
            record.get("confinement_scale_value"),
            record.get("confinement_scale_unit"),
            record["source"],
            record["source_page"],
            record["evidence"],
            dumps({"reviewed_by": "Codex", "reviewed_at": now, "raw_model_output_was_audited": True}),
            field_evidence_json(record),
            record["assembly_notes"],
            feature_json(record),
            record.get("smiles"),
            candidate_id,
        ),
    )
    conn.execute(
        """
        UPDATE diffusion_feature_sets
           SET record_id = ?
         WHERE candidate_id = ?
        """,
        (record_id, candidate_id),
    )


def mark_literature_reviewed(conn: sqlite3.Connection, literature_ids: set[int], now: str) -> None:
    for lit_id in literature_ids:
        conn.execute(
            """
            UPDATE literature
               SET status = 'completed',
                   submission_status = 'approved',
                   reviewed_at = COALESCE(reviewed_at, ?),
                   reviewed_by_user_id = COALESCE(reviewed_by_user_id, ?),
                   review_note = 'Codex-reviewed diffusion extraction; candidate rows linked to approved Library records.'
             WHERE id = ?
            """,
            (now, USER_ID, lit_id),
        )


def update_promoted_literature_links(conn: sqlite3.Connection) -> None:
    links = [
        ("10.1016/j.seppur.2022.120736", 105, 123),
        ("10.1063/5.0077408", 106, 107),
    ]
    for doi, workspace_id, library_id in links:
        conn.execute(
            """
            UPDATE literature
               SET promoted_literature_id = ?,
                   status = 'completed',
                   submission_status = 'approved'
             WHERE id = ?
               AND lower(doi) = lower(?)
            """,
            (library_id, workspace_id, doi),
        )


def reviewed_records(conn: sqlite3.Connection) -> list[dict[str, Any]]:
    lit59 = literature_id(conn, "10.1016/j.desal.2025.119434")
    lit101 = literature_id(conn, "10.1016/j.seppur.2025.132933")
    lit123 = literature_id(conn, "10.1016/j.seppur.2022.120736")
    lit107 = literature_id(conn, "10.1063/5.0077408")

    return [
        {
            "literature_id": lit59,
            "candidate_ids": [14],
            "system_name": "MPIL_ethyl",
            "confinement_material_class": "Polymer",
            "confinement_geometry_class": "Interconnected Network",
            "surface_functional_groups": "phosphonium",
            "confinement_dimensionality": "3D",
            "ionic_liquid": "MPIL_ethyl",
            "d_total": 5500.0,
            "d_anion": 5500.0,
            "temperature_value": 293.0,
            "source": "Table 3",
            "source_page": 5,
            "raw_anion": "5.50 x 10^-1",
            "source_unit": "A2 ps-1",
            "water_uptake_value": 81.0,
            "cation": "phosphonium polymer",
            "anion": "Cl−",
            "evidence": "Table 3 reports MPIL_ethyl DCl- = (5.50 ± 1.20) x 10^-1 Å2 ps^-1; converted to 5500 x 10^-12 m2/s.",
            "assembly_notes": "Codex reviewed Desalination 2026 Table 3; Å2 ps^-1 values converted to canonical 10^-12 m2/s.",
        },
        {
            "literature_id": lit59,
            "candidate_ids": [15],
            "system_name": "MPIL_butyl",
            "confinement_material_class": "Polymer",
            "confinement_geometry_class": "Interconnected Network",
            "surface_functional_groups": "phosphonium",
            "confinement_dimensionality": "3D",
            "ionic_liquid": "MPIL_butyl",
            "d_total": 175.0,
            "d_anion": 175.0,
            "temperature_value": 293.0,
            "source": "Table 3",
            "source_page": 5,
            "raw_anion": "1.75 x 10^-2",
            "source_unit": "A2 ps-1",
            "water_uptake_value": 27.0,
            "cation": "phosphonium polymer",
            "anion": "Cl−",
            "evidence": "Table 3 reports MPIL_butyl DCl- = (1.75 ± 0.09) x 10^-2 Å2 ps^-1; converted to 175 x 10^-12 m2/s.",
            "assembly_notes": "Codex reviewed Desalination 2026 Table 3; Å2 ps^-1 values converted to canonical 10^-12 m2/s.",
        },
        {
            "literature_id": lit59,
            "candidate_ids": [16],
            "system_name": "MPIL_octyl",
            "confinement_material_class": "Polymer",
            "confinement_geometry_class": "Interconnected Network",
            "surface_functional_groups": "phosphonium",
            "confinement_dimensionality": "3D",
            "ionic_liquid": "MPIL_octyl",
            "d_total": 5.7,
            "d_anion": 5.7,
            "temperature_value": 293.0,
            "source": "Table 3",
            "source_page": 5,
            "raw_anion": "5.70 x 10^-4",
            "source_unit": "A2 ps-1",
            "water_uptake_value": 9.0,
            "cation": "phosphonium polymer",
            "anion": "Cl−",
            "evidence": "Table 3 reports MPIL_octyl DCl- = (5.70 ± 4.50) x 10^-4 Å2 ps^-1; converted to 5.7 x 10^-12 m2/s.",
            "assembly_notes": "Codex reviewed Desalination 2026 Table 3; Å2 ps^-1 values converted to canonical 10^-12 m2/s.",
        },
        {
            "literature_id": lit101,
            "candidate_ids": [17],
            "system_name": "TpPa-1 COF-confined [Bmim][PF6]",
            "confinement_material_class": "MOF/COF",
            "confinement_geometry_class": "Pore",
            "surface_functional_groups": "TpPa-1 COF pore walls",
            "confinement_dimensionality": "2D",
            "ionic_liquid": "[Bmim][PF6]",
            "d_total": 0.047,
            "d_cation": 0.042,
            "d_anion": 0.052,
            "temperature_value": 300.0,
            "confinement_scale_value": 3.4,
            "confinement_scale_unit": "Å interlayer spacing",
            "source": "Table 1",
            "source_page": 6,
            "raw_total": "0.47 x 10^-13",
            "raw_cation": "0.42 x 10^-13",
            "raw_anion": "0.52 x 10^-13",
            "source_unit": "m2/s",
            "cation": "Bmim+",
            "anion": "PF₆−",
            "evidence": "Table 1 reports confined [Bmim][PF6] self-diffusion coefficients: cation 0.42, anion 0.52, and ILs 0.47 in units of 1 x 10^-13 m2/s.",
            "assembly_notes": "Codex reviewed Seppur 2025 Table 1; corrected suffix-labeled total/cation/anion mapping and canonical 10^-12 m2/s conversion.",
        },
        *[
            {
                "record_id": record_id,
                "literature_id": lit123,
                "candidate_ids": [candidate_id],
                "system_name": "Graphene oxide membrane",
                "confinement_material_class": "Carbon",
                "confinement_geometry_class": "Slit",
                "surface_functional_groups": "-OH, epoxy",
                "confinement_dimensionality": "2D",
                "ionic_liquid": "[Bmim][PF6]",
                "d_cation": d_cation,
                "d_anion": d_anion,
                "temperature_value": 300.0,
                "confinement_scale_value": scale,
                "confinement_scale_unit": "nm",
                "source": "Table 1",
                "source_page": 6,
                "raw_cation": f"{raw_cation} x 10^-13",
                "raw_anion": f"{raw_anion} x 10^-13",
                "source_unit": "m2/s",
                "cation": "Bmim+",
                "anion": "PF₆−",
                "evidence": f"Table 1 reports [Bmim][PF6]/GO at {scale:g} nm: D[cation] = {raw_cation} and D[anion] = {raw_anion} in units of 1 x 10^-13 m2/s.",
                "assembly_notes": "Codex reviewed Seppur 2022 Table 1; workspace candidate linked to existing Library record.",
            }
            for record_id, candidate_id, scale, raw_cation, raw_anion, d_cation, d_anion in [
                (7, 20, 2.0, "0.65", "0.17", 0.065, 0.017),
                (8, 21, 3.0, "0.95", "0.35", 0.095, 0.035),
                (9, 22, 4.0, "1.53", "0.43", 0.153, 0.043),
            ]
        ],
        *[
            {
                "record_id": record_id,
                "literature_id": lit107,
                "candidate_ids": candidate_ids,
                "system_name": "Graphene slit pore",
                "confinement_material_class": "Carbon",
                "confinement_geometry_class": "Slit",
                "surface_functional_groups": surface,
                "confinement_dimensionality": "2D",
                "ionic_liquid": "[BuPy][NTf2]",
                "d_cation": d_cation,
                "d_anion": d_anion,
                "temperature_value": 340.0,
                "confinement_scale_value": scale,
                "confinement_scale_unit": "nm",
                "source": "Table II",
                "source_page": 8,
                "raw_cation": f"{raw_cation} x 10^-10",
                "raw_anion": f"{raw_anion} x 10^-10",
                "source_unit": "m2/s",
                "surface_polarizability": surface.replace(" surface", ""),
                "cation": "BuPy+",
                "anion": "NTf₂−",
                "evidence": f"Table II reports {surface} at d={scale:g} nm: D+tot = {raw_cation} and D-tot = {raw_anion} in units of 10^-10 m2/s.",
                "assembly_notes": "Codex reviewed JCP 2022 Table II; retained species-specific D+tot/D-tot values and linked stale workspace candidates.",
            }
            for record_id, candidate_ids, scale, surface, raw_cation, raw_anion, d_cation, d_anion in [
                (10, [29, 43], 4.09, "polarizable surface", "1.506", "1.176", 150.6, 117.6),
                (11, [30, 44], 2.36, "polarizable surface", "0.958", "0.982", 95.8, 98.2),
                (12, [31, 45], 1.65, "polarizable surface", "0.410", "0.418", 41.0, 41.8),
                (13, [32], 4.09, "non-polarizable surface", "1.584", "1.499", 158.4, 149.9),
                (14, [33], 2.36, "non-polarizable surface", "0.725", "0.702", 72.5, 70.2),
                (15, [34], 1.65, "non-polarizable surface", "0.215", "0.215", 21.5, 21.5),
            ]
        ],
    ]


def main() -> None:
    if not DB_PATH.exists():
        raise SystemExit(f"DB not found: {DB_PATH}")

    backup = backup_database(DB_PATH)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    now = now_iso()
    try:
        records = reviewed_records(conn)
        touched_literature_ids: set[int] = set()
        linked_candidates = 0
        updated_records = 0
        for record in records:
            record_id = upsert_record(conn, record, now)
            updated_records += 1
            touched_literature_ids.add(int(record["literature_id"]))
            for candidate_id in record.get("candidate_ids", []):
                if fetch_one(conn, "SELECT id FROM diffusion_candidates WHERE id = ?", (candidate_id,)):
                    update_candidate(conn, int(candidate_id), record_id, record, now)
                    linked_candidates += 1

        update_promoted_literature_links(conn)
        touched_literature_ids.update({105, 106})
        mark_literature_reviewed(conn, touched_literature_ids, now)
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

    print(f"backup={backup}")
    print(f"updated_records={updated_records}")
    print(f"linked_candidates={linked_candidates}")
    print(f"reviewed_literature={sorted(touched_literature_ids)}")


if __name__ == "__main__":
    main()
