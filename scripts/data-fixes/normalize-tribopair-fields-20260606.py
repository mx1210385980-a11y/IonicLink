#!/usr/bin/env python3
from __future__ import annotations

import json
import re
import shutil
import sqlite3
import time
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[2]
DB_PATH = REPO_ROOT / "backend" / "data" / "ioniclink.db"
NOTE = "Codex tribopair normalized 2026-06-06: structured probe/substrate fields from the stored reviewed tribopair label."

MANUAL_TRIBOPAIR_BY_LABEL = {
    "ionic liquid humidity tribotest": {
        "material_name": "AISI 52100 steel ball / AISI 52100 steel disk",
        "probe_material": "AISI 52100 steel ball",
        "probe_geometry": "Ball",
        "substrate_material": "AISI 52100 steel disk",
        "evidence": {
            "source_type": "text",
            "page": 2,
            "source_label": "Experimental section / Friction tests",
            "quote": "For the friction tests, a disk and ball of AISI 52100 steel were used.",
            "matched_text": "disk and ball of AISI 52100 steel",
        },
    }
}


def backup_database(db_path: Path) -> Path:
    backup_path = db_path.with_suffix(db_path.suffix + f".bak-tribopair-normalize-20260606-{int(time.time())}")
    shutil.copy2(db_path, backup_path)
    return backup_path


def parse_json_map(raw: str | None) -> dict[str, Any]:
    try:
        parsed = json.loads(raw or "{}")
    except Exception:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def clean_text(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def looks_like_ionic_liquid_segment(value: str) -> bool:
    text = value.lower()
    return bool(
        "[" in value
        or "]" in value
        or re.search(r"\b(?:ionic\s+liquid|il|mim|imidazolium|phosphonium|pyridinium)\b", text)
        or re.search(r"\b(?:bmim|emim|hmim|tfsi|ntf2|bf4|pf6|fap|bmb|aot)\b", text)
    )


def looks_like_contact_side(value: str) -> bool:
    return bool(
        re.search(
            r"\b(?:afm|tip|probe|ball|bead|pin|disk|disc|plate|electrode|substrate|surface|mica|hopg|graphite|steel|silica|sio2|alumina|ptfe|au)\b",
            value,
            flags=re.IGNORECASE,
        )
    )


def parse_legacy_tribopair(material_name: str) -> dict[str, str] | None:
    label = clean_text(material_name)
    manual = MANUAL_TRIBOPAIR_BY_LABEL.get(label.lower())
    if manual:
        return dict(manual)
    if "/" not in label:
        return None
    parts = [clean_text(part) for part in re.split(r"\s+/\s+", label) if clean_text(part)]
    if len(parts) >= 3 and looks_like_ionic_liquid_segment(parts[1]):
        return {"probe_material": parts[0], "substrate_material": " / ".join(parts[2:])}
    if len(parts) == 2 and all(looks_like_contact_side(part) for part in parts):
        return {"probe_material": parts[0], "substrate_material": parts[1]}
    return None


def infer_probe_geometry(probe_material: str, material_name: str, system: dict[str, Any]) -> str | None:
    text = " ".join(
        clean_text(part)
        for part in [
            probe_material,
            material_name,
            system.get("contact_geometry"),
            system.get("method"),
            system.get("raw_text"),
        ]
        if part
    ).lower()
    if "colloid" in text or "bead" in text:
        return "Colloid probe"
    if "afm" in text and "tip" in text:
        return "AFM tip"
    if "ball" in text:
        return "Ball"
    if "pin" in text:
        return "Pin"
    return None


def append_note(existing: str | None) -> str:
    current = clean_text(existing)
    if NOTE in current:
        return current
    return f"{current} {NOTE}".strip() if current else NOTE


def evidence_from_material_entry(field_map: dict[str, Any], material_name: str) -> dict[str, Any]:
    material_entry = field_map.get("material") if isinstance(field_map.get("material"), dict) else {}
    evidence = material_entry.get("evidence") if isinstance(material_entry.get("evidence"), dict) else {}
    if evidence:
        return dict(evidence)
    return {
        "source_type": "curated_review",
        "source_label": "Stored tribopair label",
        "quote": f"Structured from stored tribopair label: {material_name}",
        "matched_text": material_name,
    }


def patch_field_evidence(
    raw: str | None,
    material_name: str,
    probe: str,
    substrate: str,
    geometry: str | None,
    evidence_override: dict[str, Any] | None = None,
) -> str:
    field_map = parse_json_map(raw)
    evidence = dict(evidence_override or evidence_from_material_entry(field_map, material_name))
    field_map["probe_material"] = {
        "value": probe,
        "confidence": 0.95,
        "evidence": evidence,
        "grounding_mode": "curated_source_note",
        "grounding_note": "Structured from the reviewed tribopair label.",
    }
    field_map["substrate_material"] = {
        "value": substrate,
        "confidence": 0.95,
        "evidence": evidence,
        "grounding_mode": "curated_source_note",
        "grounding_note": "Structured from the reviewed tribopair label.",
    }
    if geometry:
        field_map["probe_geometry"] = {
            "value": geometry,
            "confidence": 0.9,
            "evidence": evidence,
            "grounding_mode": "curated_source_note",
            "grounding_note": "Probe geometry inferred from the reviewed tribopair label.",
        }
    return dumps(field_map)


def active_clause() -> str:
    return "review_status IS NULL OR trim(review_status) = '' OR lower(review_status) != 'rejected'"


def table_exists(conn: sqlite3.Connection, table: str) -> bool:
    row = conn.execute(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
        (table,),
    ).fetchone()
    return row is not None


def normalize_table(conn: sqlite3.Connection, table: str) -> int:
    if not table_exists(conn, table):
        return 0
    rows = conn.execute(
        f"""
        SELECT id, material_name, probe_material, probe_geometry, substrate_material,
               field_evidence_json, tribological_system_json, assembly_notes
          FROM {table}
         WHERE {active_clause()}
         ORDER BY id
        """
    ).fetchall()
    updated = 0
    for row in rows:
        material_name = clean_text(row["material_name"])
        parsed = parse_legacy_tribopair(material_name)
        if not parsed:
            continue
        existing_probe = clean_text(row["probe_material"])
        existing_substrate = clean_text(row["substrate_material"])
        if existing_probe and existing_substrate:
            continue
        normalized_material = clean_text(parsed.get("material_name")) or material_name
        probe = existing_probe or parsed["probe_material"]
        substrate = existing_substrate or parsed["substrate_material"]
        system = parse_json_map(row["tribological_system_json"])
        geometry = clean_text(row["probe_geometry"]) or clean_text(parsed.get("probe_geometry")) or infer_probe_geometry(probe, normalized_material, system)
        conn.execute(
            f"""
            UPDATE {table}
               SET material_name = ?,
                   probe_material = ?,
                   probe_geometry = ?,
                   substrate_material = ?,
                   field_evidence_json = ?,
                   assembly_notes = ?
             WHERE id = ?
            """,
            (
                normalized_material,
                probe,
                geometry or row["probe_geometry"],
                substrate,
                patch_field_evidence(
                    row["field_evidence_json"],
                    normalized_material,
                    probe,
                    substrate,
                    geometry,
                    parsed.get("evidence") if isinstance(parsed.get("evidence"), dict) else None,
                ),
                append_note(row["assembly_notes"]),
                row["id"],
            ),
        )
        updated += 1
    return updated


def apply_fixes(conn: sqlite3.Connection) -> dict[str, int]:
    return {
        "record_candidates": normalize_table(conn, "record_candidates"),
        "tribology_data": normalize_table(conn, "tribology_data"),
    }


def main() -> None:
    if not DB_PATH.exists():
        raise SystemExit(f"database not found: {DB_PATH}")
    backup_path = backup_database(DB_PATH)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        with conn:
            updated = apply_fixes(conn)
    finally:
        conn.close()
    print(f"backup={backup_path}")
    print(f"updated={updated}")


if __name__ == "__main__":
    main()
