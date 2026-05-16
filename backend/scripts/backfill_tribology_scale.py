#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
import shutil
import sqlite3
import sys
from collections import Counter
from datetime import datetime
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from utils.experiment_profile import build_experiment_profile, canonical_scale  # noqa: E402
from utils.structured_conditions import normalize_tribological_system  # noqa: E402


DB_PATH = ROOT / "data" / "ioniclink.db"
MACRO_METHODS = {"ball_on_disk", "ball_on_3_pins", "ball_on_flat", "ball_on_plate", "pin_on_disk", "four_ball"}
NANO_METHODS = {"afm_colloidal_probe", "afm_sharp_tip", "sfa"}
TITLE_SCALE_HINTS = {
    "electroresponsive structuring and friction of a non-halogenated ionic liquid in a polar solvent": "nanoscale",
    "effect of hydrogen bonding between ions of like charge on the boundary layer friction": "nanoscale",
    "potential-dependent superlubricity of stainless steel and au(111) using a water-in-surface-active ionic liquid mixture": "nanoscale",
    "supporting information for an ionic liquid lubricant enables superlubricity to be switched on in situ": "nanoscale",
    "ionic liquid lubrication of stainless steel: friction is inversely correlated with interfacial liquid nanostructure": "nanoscale",
    "interfacial structure and boundary lubrication of a dicationic ionic liquid": "nanoscale",
}


def _clean(value: Any) -> str:
    return str(value or "").strip()


def _parse_json_object(value: Any) -> dict[str, Any]:
    if not value:
        return {}
    if isinstance(value, dict):
        return value
    try:
        parsed = json.loads(str(value))
    except Exception:
        return {"raw_text": str(value)}
    return parsed if isinstance(parsed, dict) else {}


def _canonical_non_unknown(value: Any) -> str | None:
    scale = canonical_scale(value)
    return scale if scale and scale != "unknown" else None


def _combined_text(row: sqlite3.Row, system: dict[str, Any]) -> str:
    fields = [
        system.get("raw_text"),
        row["title"],
        row["journal"],
        row["regime"],
        row["source"],
        row["source_figure"],
        row["evidence"],
        row["load_value"],
        row["load_raw"],
        row["speed_value"],
        row["shear_rate"],
        row["probe_geometry"],
        row["probe_radius"],
        row["material_name"],
        row["probe_material"],
        row["substrate_material"],
    ]
    return " | ".join(part for part in (_clean(field) for field in fields) if part)


def _scale_from_force_text(text: str) -> str | None:
    if re.search(r"\b\d+(?:\.\d+)?(?:\s*[-–]\s*\d+(?:\.\d+)?)?\s*(?:pN|nN)\b", text, flags=re.IGNORECASE):
        return "nanoscale"
    if re.search(r"\b\d+(?:\.\d+)?(?:\s*[-–]\s*\d+(?:\.\d+)?)?\s*(?:N|kN)\b", text, flags=re.IGNORECASE):
        return "macroscale"
    return None


def _scale_from_text(text: str) -> str | None:
    lower = text.lower()
    if any(fragment in lower for fragment, scale in TITLE_SCALE_HINTS.items() if scale == "nanoscale"):
        return "nanoscale"
    if re.search(r"\b(?:afm|ffm|atomic\s+force\s+microscop|colloid(?:al)?\s+probe|sharp\s+tip|surface\s+force\s+apparatus|surface\s+force\s+balance|sfb|sfa|nanotribolog|nanofriction|nanoscale)\b", lower):
        return "nanoscale"
    if re.search(r"\b(?:lateral|friction)\s+force\s+(?:versus|vs\.?|as\s+a\s+function\s+of)\s+(?:applied\s+)?normal\s+(?:force|load)\b", lower):
        return "nanoscale"
    if "friction force decreased" in lower or "highest friction force" in lower:
        return "nanoscale"
    if re.search(r"\b(?:tribometer|ball[-\s]*on[-\s]*(?:disc|disk|flat|plate|3|three)|pin[-\s]*on[-\s]*(?:disc|disk)|(?:four|4)[-\s]*ball|macroscopic|macroscale|macrotribolog)\b", lower):
        return "macroscale"
    return _scale_from_force_text(text)


def classify_record(row: sqlite3.Row) -> tuple[dict[str, Any], bool]:
    existing_system = _parse_json_object(row["tribological_system_json"])
    normalized_system = normalize_tribological_system(existing_system)
    text = _combined_text(row, normalized_system or existing_system)

    profile = build_experiment_profile(
        {
            "tribological_system": normalized_system or existing_system,
            "raw_text": text,
            "cof": row["cof_raw"],
            "cof_value": row["cof_value"],
            "load": row["load_raw"] or row["load_value"],
            "speed": row["speed_value"],
            "probe_geometry": row["probe_geometry"],
            "probe_radius": row["probe_radius"],
            "regime": row["regime"],
            "source": row["source"],
            "source_figure": row["source_figure"],
            "evidence": row["evidence"],
        }
    )

    source = "unknown"
    scale = _canonical_non_unknown((normalized_system or existing_system).get("scale"))
    if scale:
        source = "existing_scale"

    method = profile.get("method") or "unknown"
    instrument = str(profile.get("instrument") or "").lower()
    training_view = str(profile.get("training_view") or "").lower()
    profile_key = str(profile.get("profile") or "").lower()

    if not scale:
        if method in NANO_METHODS or instrument in {"afm", "sfa"}:
            scale = "nanoscale"
            source = "method"
        elif method in MACRO_METHODS or instrument == "tribometer":
            scale = "macroscale"
            source = "method"
        elif training_view == "afm_surface_response" or profile_key in {"afm", "nano"}:
            scale = "nanoscale"
            source = "profile"
        elif training_view == "macro_performance" or profile_key == "macro":
            scale = "macroscale"
            source = "profile"
        else:
            scale = _scale_from_text(text) or "unknown"
            source = "text" if scale != "unknown" else "unknown"

    if scale == "macroscale":
        profile_key = "macro"
        training_view = "macro_performance"
        instrument = "tribometer" if method in MACRO_METHODS else (instrument or "unknown")
    elif scale == "nanoscale":
        if profile_key not in {"afm", "nano"}:
            profile_key = "afm" if method in NANO_METHODS or training_view == "afm_surface_response" else "nano"
        training_view = "afm_surface_response"
        instrument = "afm" if method and method.startswith("afm") else ("sfa" if method == "sfa" else (instrument or "unknown"))
    else:
        profile_key = profile_key if profile_key in {"macro", "afm", "nano", "micro"} else "unknown"
        training_view = training_view if training_view in {"macro_performance", "afm_surface_response"} else "all"
        instrument = instrument or "unknown"

    training_views = ["cross_scale"] if training_view == "all" else [training_view, "cross_scale"]
    payload = {
        **existing_system,
        **normalized_system,
        "raw_text": (normalized_system or existing_system).get("raw_text") or text[:500],
        "scale": scale,
        "method": method,
        "instrument": instrument,
        "contact_geometry": profile.get("contact_geometry") or normalized_system.get("contact_geometry"),
        "measurement_type": profile.get("measurement_type") or normalized_system.get("measurement_type") or "unknown",
        "profile": profile_key,
        "training_view": training_view,
        "training_views": training_views,
        "scale_source": source,
    }
    payload = {key: value for key, value in payload.items() if value not in (None, "")}

    previous = json.dumps(existing_system, ensure_ascii=False, sort_keys=True)
    updated = json.dumps(payload, ensure_ascii=False, sort_keys=True)
    return payload, previous != updated


def load_rows(conn: sqlite3.Connection) -> list[sqlite3.Row]:
    conn.row_factory = sqlite3.Row
    return conn.execute(
        """
        select
            t.id,
            t.literature_id,
            t.material_name,
            t.lubricant,
            t.cof_value,
            t.cof_raw,
            t.load_value,
            t.load_raw,
            t.speed_value,
            t.shear_rate,
            t.probe_geometry,
            t.probe_radius,
            t.probe_material,
            t.substrate_material,
            t.regime,
            t.source,
            t.source_figure,
            t.evidence,
            t.tribological_system_json,
            l.title,
            l.journal
        from tribology_data t
        join literature l on l.id = t.literature_id
        order by t.id
        """
    ).fetchall()


def backfill(db_path: Path, *, write: bool, backup: bool) -> dict[str, Any]:
    if not db_path.exists():
        raise SystemExit(f"Database not found: {db_path}")

    backup_path = None
    if write and backup:
        stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        backup_path = db_path.with_name(f"{db_path.stem}.before-scale-backfill-{stamp}{db_path.suffix}")
        shutil.copy2(db_path, backup_path)

    conn = sqlite3.connect(db_path)
    try:
        rows = load_rows(conn)
        counts = Counter()
        changed = 0
        examples: dict[str, list[dict[str, Any]]] = {"macroscale": [], "nanoscale": [], "unknown": []}

        for row in rows:
            payload, did_change = classify_record(row)
            scale = str(payload.get("scale") or "unknown")
            counts[scale] += 1
            if did_change:
                changed += 1
                if write:
                    conn.execute(
                        "update tribology_data set tribological_system_json = ? where id = ?",
                        (json.dumps(payload, ensure_ascii=False), row["id"]),
                    )
            if len(examples.setdefault(scale, [])) < 5:
                examples[scale].append(
                    {
                        "id": row["id"],
                        "literatureId": row["literature_id"],
                        "title": row["title"],
                        "scale": scale,
                        "method": payload.get("method"),
                        "source": payload.get("scale_source"),
                    }
                )

        if write:
            conn.commit()
        return {
            "database": str(db_path),
            "backup": str(backup_path) if backup_path else None,
            "mode": "write" if write else "dry-run",
            "total": len(rows),
            "changed": changed,
            "counts": dict(counts),
            "examples": examples,
        }
    finally:
        conn.close()


def main() -> int:
    parser = argparse.ArgumentParser(description="Backfill macro/nano experiment scale labels into tribological_system_json.")
    parser.add_argument("--db", type=Path, default=DB_PATH, help="Path to ioniclink.db")
    parser.add_argument("--write", action="store_true", help="Persist updates. Without this flag the script only reports a dry run.")
    parser.add_argument("--no-backup", action="store_true", help="Do not create a .db backup before writing.")
    args = parser.parse_args()

    result = backfill(args.db, write=args.write, backup=not args.no_backup)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
