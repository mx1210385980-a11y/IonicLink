"""Move hexadecane out of the ionic-liquid label and into components.

Some imported Rutland records used labels such as
``[P6,6,6,14][i(C8)2PO2] / hexadecane`` in the main ``lubricant`` field.  The
main field should describe the ionic liquid; the base oil belongs in
``lubricant_components_json`` as a component with role ``base_oil``.
"""

from __future__ import annotations

import json
import re
import shutil
import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[2]
DB_PATH = ROOT / "backend" / "data" / "ioniclink.db"
HEX = "hexadecane"


def json_dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def mol_percent(label: str | None) -> float | None:
    text = str(label or "").strip().lower()
    if "0 mol%" in text and "hexadecane" in text:
        return 0.0
    if "pure il" in text or "100 mol%" in text:
        return 100.0
    match = re.search(r"(\d+(?:\.\d+)?)\s*mol%\s*il", text)
    if not match:
        return None
    return float(match.group(1))


def components_for(il_label: str | None, oil_label: str, percent: float | None) -> str | None:
    if percent is None:
        return None
    if percent <= 0 or not il_label:
        return json_dumps([{"compound": oil_label, "fraction": 100, "unit": "mol%", "role": "base_oil"}])
    if percent >= 100:
        return json_dumps([{"compound": il_label, "fraction": 100, "unit": "mol%", "role": "ionic_liquid"}])
    return json_dumps(
        [
            {"compound": il_label, "fraction": percent, "unit": "mol%", "role": "ionic_liquid"},
            {"compound": oil_label, "fraction": round(100 - percent, 6), "unit": "mol%", "role": "base_oil"},
        ]
    )


def parse_components(raw: str | None) -> list[dict[str, Any]]:
    if not raw:
        return []
    try:
        parsed = json.loads(raw)
    except Exception:
        return []
    return parsed if isinstance(parsed, list) else []


def ionic_component_label(components: list[dict[str, Any]]) -> str | None:
    for component in components:
        compound = str(component.get("compound") or "").strip()
        role = str(component.get("role") or "").strip().lower()
        if compound and (role == "ionic_liquid" or ("[" in compound and compound.lower() != HEX)):
            return compound
    return None


def component_field_key(compound: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "_", str(compound or "").strip().lower()).strip("_")
    return f"compound_{slug}" if slug else "lubricant_component"


def clone_entry_with_value(entry: dict[str, Any], value: str) -> dict[str, Any]:
    cloned = json.loads(json.dumps(entry, ensure_ascii=False))
    cloned["value"] = value
    cloned.setdefault("confidence", entry.get("confidence", 0.99))
    cloned.pop("review_state", None)
    cloned.pop("review_note", None)
    return cloned


def normalize_field_evidence(raw: str | None, il_label: str | None, components_json: str | None) -> str | None:
    if not raw:
        return raw
    try:
        field_map = json.loads(raw)
    except Exception:
        return raw
    if not isinstance(field_map, dict):
        return raw

    entry = field_map.get("ionic_liquid")
    if isinstance(entry, dict):
        value = str(entry.get("value") or "")
        if f" / {HEX}" in value:
            entry["value"] = value.split(" / ", 1)[0].strip() or il_label
        elif il_label and value.lower() == HEX:
            entry["value"] = il_label
        if il_label and "[" in il_label:
            entry.setdefault("literature_alias", "IL")

    components = parse_components(components_json)
    source_entry = next(
        (
            field_map.get(key)
            for key in ("mol_ratio", "ionic_liquid", "source")
            if isinstance(field_map.get(key), dict) and field_map.get(key)
        ),
        None,
    )
    if isinstance(source_entry, dict):
        for component in components:
            compound = str(component.get("compound") or "").strip()
            if not compound:
                continue
            role = str(component.get("role") or "").strip().lower()
            if role == "ionic_liquid" and compound == il_label:
                continue
            key = component_field_key(compound)
            existing = field_map.get(key)
            if isinstance(existing, dict) and existing.get("value") == compound and existing.get("evidence"):
                continue
            field_map[key] = clone_entry_with_value(source_entry, compound)
    return json_dumps(field_map)


def main() -> None:
    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    backup_path = DB_PATH.with_name(f"{DB_PATH.stem}.before-hexadecane-component-normalize-{timestamp}{DB_PATH.suffix}")
    shutil.copy2(DB_PATH, backup_path)

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    updates = 0
    try:
        with conn:
            rows = conn.execute(
                """
                SELECT id, lubricant, mol_ratio, lubricant_components_json, field_evidence_json
                  FROM tribology_data
                 WHERE lubricant LIKE ?
                    OR (LOWER(lubricant) = ? AND mol_ratio LIKE '%hexadecane%')
                    OR lubricant_components_json LIKE ?
                """,
                (f"% / {HEX}%", HEX, f"%{HEX}%"),
            ).fetchall()

            for row in rows:
                lubricant = str(row["lubricant"] or "").strip()
                il_label: str | None = None
                oil_label = HEX
                next_lubricant = lubricant
                existing_components = parse_components(row["lubricant_components_json"])
                if " / " in lubricant:
                    il_label, oil_label = [part.strip() for part in lubricant.split(" / ", 1)]
                    next_lubricant = il_label
                elif lubricant.lower() == HEX:
                    oil_label = lubricant
                else:
                    il_label = ionic_component_label(existing_components)

                percent = mol_percent(row["mol_ratio"])
                next_components = components_for(il_label, oil_label, percent)
                components_json = next_components or row["lubricant_components_json"]
                next_field_evidence = normalize_field_evidence(row["field_evidence_json"], il_label, components_json)

                conn.execute(
                    """
                    UPDATE tribology_data
                       SET lubricant = ?,
                           lubricant_components_json = COALESCE(?, lubricant_components_json),
                           field_evidence_json = ?
                     WHERE id = ?
                    """,
                    (next_lubricant, next_components, next_field_evidence, row["id"]),
                )
                updates += 1
    finally:
        conn.close()

    print(f"backup: {backup_path}")
    print(f"updated_records: {updates}")


if __name__ == "__main__":
    main()
