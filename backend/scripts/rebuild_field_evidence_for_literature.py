from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from pathlib import Path
from types import SimpleNamespace
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from services.file_service import _build_field_evidence_map
from services.file_service import DEFAULT_TEMPERATURE_VALUE
from services.file_service import _field_evidence_map_looks_generic
from services.file_service import _locate_source_anchor_evidence
from services.file_service import _merge_field_review_metadata
from services.file_service import _resolve_existing_path
from services.file_service import _resolve_review_status
from services.file_service import _source_label_has_precise_region

DB_PATH = ROOT / "data" / "ioniclink.db"
TABLES = ("record_candidates", "tribology_data")


def _load_json_object(raw: Any) -> dict[str, Any]:
    if isinstance(raw, dict):
        return raw
    text = str(raw or "").strip()
    if not text:
        return {}
    try:
        parsed = json.loads(text)
    except Exception:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _entry_has_value(entry: Any) -> bool:
    return isinstance(entry, dict) and bool(str(entry.get("value") or "").strip())


def _entry_has_location(entry: Any) -> bool:
    if not isinstance(entry, dict):
        return False
    evidence = entry.get("evidence") or {}
    bbox = evidence.get("bbox")
    return bool(evidence.get("page") and isinstance(bbox, list) and len(bbox) >= 4)


def _field_location_counts(field_map: dict[str, Any]) -> tuple[int, int]:
    fields_with_values = 0
    fields_with_locations = 0
    for key, entry in (field_map or {}).items():
        if key == "source_page" or not _entry_has_value(entry):
            continue
        fields_with_values += 1
        if _entry_has_location(entry):
            fields_with_locations += 1
    return fields_with_values, fields_with_locations


def _fill_missing_source_anchors(field_map: dict[str, Any], file_path: str) -> tuple[dict[str, Any], int]:
    updated = 0
    for key, entry in list((field_map or {}).items()):
        if key == "source_page" or not _entry_has_value(entry):
            continue
        evidence = entry.get("evidence") or {}
        if _entry_has_location(entry):
            continue
        if not _source_label_has_precise_region(evidence.get("source_type"), evidence.get("source_label")):
            continue
        located = _locate_source_anchor_evidence(
            file_path=file_path,
            source_label=evidence.get("source_label"),
            page_hint=int(evidence.get("page") or 0) or None,
            source_type=evidence.get("source_type"),
        )
        if not located:
            continue
        entry["evidence"] = {
            **evidence,
            **located,
            "sample_id": evidence.get("sample_id"),
        }
        field_map[key] = entry
        updated += 1
    return field_map, updated


def _stringify_metric(row: sqlite3.Row, raw_key: str, value_key: str) -> Any:
    raw = row[raw_key] if raw_key in row.keys() else None
    if raw not in (None, ""):
        return raw
    value = row[value_key] if value_key in row.keys() else None
    return str(value) if value not in (None, "") else None


def _build_item_payload(row: sqlite3.Row) -> dict[str, Any]:
    load_value = _stringify_metric(row, "load_raw", "load_value")
    cof_value = _stringify_metric(row, "cof_raw", "cof_value")
    temperature = row["temperature"] if "temperature" in row.keys() else None
    if not str(temperature or "").strip():
        temperature = DEFAULT_TEMPERATURE_VALUE
    return {
        "material_name": row["material_name"],
        "ionic_liquid": row["lubricant"],
        "lubricant": row["lubricant"],
        "cof": cof_value,
        "load": load_value,
        "normal_load": load_value,
        "speed": row["speed_value"] if "speed_value" in row.keys() else None,
        "shear_rate": row["shear_rate"] if "shear_rate" in row.keys() else None,
        "temperature": temperature,
        "potential": row["potential"] if "potential" in row.keys() else None,
        "water_content": row["water_content"] if "water_content" in row.keys() else None,
        "probe_roughness": row["probe_roughness"] if "probe_roughness" in row.keys() else None,
        "substrate_roughness": row["substrate_roughness"] if "substrate_roughness" in row.keys() else None,
        "surface_roughness": row["surface_roughness"] if "surface_roughness" in row.keys() else None,
        "film_thickness": row["film_thickness"] if "film_thickness" in row.keys() else None,
        "residual_film_thickness_d": row["residual_film_thickness_d"] if "residual_film_thickness_d" in row.keys() else None,
        "layer_spacing_delta": row["layer_spacing_delta"] if "layer_spacing_delta" in row.keys() else None,
        "friction_force": row["friction_force"] if "friction_force" in row.keys() else None,
        "wear_rate": row["wear_rate"] if "wear_rate" in row.keys() else None,
        "evidence": row["evidence"] if "evidence" in row.keys() else None,
        "source": row["source"] if "source" in row.keys() else None,
        "source_page": row["source_page"] if "source_page" in row.keys() else None,
        "source_figure": row["source_figure"] if "source_figure" in row.keys() else None,
        "sample_id": row["sample_id"] if "sample_id" in row.keys() else None,
        "series_id": row["series_id"] if "series_id" in row.keys() else None,
    }


def _build_record_namespace(row: sqlite3.Row) -> SimpleNamespace:
    return SimpleNamespace(
        source=row["source"] if "source" in row.keys() else None,
        source_figure=row["source_figure"] if "source_figure" in row.keys() else None,
        evidence_page=row["evidence_page"] if "evidence_page" in row.keys() else None,
        source_page=row["source_page"] if "source_page" in row.keys() else None,
        evidence_bbox=row["evidence_bbox"] if "evidence_bbox" in row.keys() else None,
        sample_id=row["sample_id"] if "sample_id" in row.keys() else None,
    )


def _next_review_status(current_status: Any, recomputed_status: str) -> str:
    text = str(current_status or "").strip()
    if not text or text == "needs_evidence":
        return recomputed_status
    return text


def _next_assembly_notes(current_notes: Any, recomputed_notes: Any, current_status: Any, next_status: str) -> Any:
    text = str(current_notes or "").strip()
    auto_missing = text.startswith("Missing field evidence for:")
    if next_status == "needs_evidence":
        return recomputed_notes
    if auto_missing or str(current_status or "").strip() == "needs_evidence":
        return None
    return current_notes


def rebuild_literature(
    literature_id: int,
    *,
    dry_run: bool = False,
    tables: tuple[str, ...] = TABLES,
    source_anchor_only: bool = False,
) -> dict[str, Any]:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    literature = cur.execute(
        "select id, file_path, title from literature where id = ?",
        (literature_id,),
    ).fetchone()
    if literature is None:
        raise SystemExit(f"literature {literature_id} not found")

    resolved_file_path = _resolve_existing_path(literature["file_path"])
    if not resolved_file_path:
        raise SystemExit(f"literature {literature_id} file path not found: {literature['file_path']}")

    print(f"Rebuilding field evidence for literature {literature_id}: {literature['title']}")
    print(f"PDF: {resolved_file_path}")

    summary: dict[str, Any] = {
        "literature_id": literature_id,
        "rows_updated": 0,
        "fields_before": 0,
        "fields_after": 0,
        "located_before": 0,
        "located_after": 0,
    }

    for table in tables:
        rows = cur.execute(f"select * from {table} where literature_id = ? order by id", (literature_id,)).fetchall()
        generic_before = 0
        generic_after = 0
        updated_rows = 0
        fields_before = 0
        fields_after = 0
        located_before = 0
        located_after = 0
        anchored_fields = 0

        for row in rows:
            existing_map = _load_json_object(row["field_evidence_json"] if "field_evidence_json" in row.keys() else None)
            row_fields_before, row_located_before = _field_location_counts(existing_map)
            fields_before += row_fields_before
            located_before += row_located_before
            if _field_evidence_map_looks_generic(existing_map):
                generic_before += 1

            if source_anchor_only:
                rebuilt_map, row_anchored_fields = _fill_missing_source_anchors(existing_map, resolved_file_path)
                anchored_fields += row_anchored_fields
            else:
                rebuilt_map = _merge_field_review_metadata(
                    _build_field_evidence_map(
                        _build_item_payload(row),
                        _build_record_namespace(row),
                        confidence=float(row["confidence"] or 0.9),
                        file_path=resolved_file_path,
                    ),
                    existing_map,
                )
            if _field_evidence_map_looks_generic(rebuilt_map):
                generic_after += 1
            row_fields_after, row_located_after = _field_location_counts(rebuilt_map)
            fields_after += row_fields_after
            located_after += row_located_after

            recomputed_status, recomputed_notes = _resolve_review_status(rebuilt_map)
            next_status = _next_review_status(row["review_status"] if "review_status" in row.keys() else None, recomputed_status)
            next_notes = _next_assembly_notes(
                row["assembly_notes"] if "assembly_notes" in row.keys() else None,
                recomputed_notes,
                row["review_status"] if "review_status" in row.keys() else None,
                next_status,
            )

            payload = json.dumps(rebuilt_map, ensure_ascii=False)
            if not dry_run:
                cur.execute(
                    f"""
                    update {table}
                    set field_evidence_json = ?,
                        temperature = coalesce(nullif(temperature, ''), ?),
                        review_status = ?,
                        assembly_notes = ?
                    where id = ?
                    """,
                    (payload, DEFAULT_TEMPERATURE_VALUE, next_status, next_notes, row["id"]),
                )
            updated_rows += 1

        summary["rows_updated"] += updated_rows
        summary["fields_before"] += fields_before
        summary["fields_after"] += fields_after
        summary["located_before"] += located_before
        summary["located_after"] += located_after
        print(
            f"{table}: updated={updated_rows}, "
            f"generic_before={generic_before}, generic_after={generic_after}, "
            f"located={located_before}/{fields_before} -> {located_after}/{fields_after}, "
            f"anchored_fields={anchored_fields}"
        )

    if not dry_run:
        conn.commit()
    conn.close()
    print(f"Done. rows_updated={summary['rows_updated']}, dry_run={dry_run}, source_anchor_only={source_anchor_only}")
    return summary


def _target_literature_ids(scope: str | None) -> list[int]:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    clauses = ["file_path IS NOT NULL", "TRIM(file_path) != ''"]
    params: list[Any] = []
    if scope:
        clauses.append("scope_type = ?")
        params.append(scope)
    rows = conn.execute(
        f"""
        SELECT id
        FROM literature
        WHERE {' AND '.join(clauses)}
        ORDER BY id
        """,
        params,
    ).fetchall()
    conn.close()
    return [int(row["id"]) for row in rows]


def main() -> None:
    parser = argparse.ArgumentParser(description="Rebuild field-level evidence for literature records")
    parser.add_argument("literature_id", type=int, nargs="?", help="Single literature id to rebuild")
    parser.add_argument("--all", action="store_true", help="Rebuild every literature row that has a PDF path")
    parser.add_argument("--scope", choices=("group_library", "workspace"), help="Limit --all to one scope type")
    parser.add_argument("--dry-run", action="store_true", help="Compute evidence without writing database changes")
    parser.add_argument("--table", choices=TABLES, action="append", help="Limit rebuild to one table; repeatable")
    parser.add_argument(
        "--source-anchor-only",
        action="store_true",
        help="Only fill missing field bboxes from existing source/page anchors; preserves exact field hits",
    )
    args = parser.parse_args()
    tables = tuple(args.table or TABLES)

    if args.all:
        literature_ids = _target_literature_ids(args.scope)
    elif args.literature_id is not None:
        literature_ids = [args.literature_id]
    else:
        parser.error("provide a literature_id or use --all")

    total = {
        "rows_updated": 0,
        "fields_before": 0,
        "fields_after": 0,
        "located_before": 0,
        "located_after": 0,
    }
    for literature_id in literature_ids:
        summary = rebuild_literature(
            literature_id,
            dry_run=args.dry_run,
            tables=tables,
            source_anchor_only=args.source_anchor_only,
        )
        for key in total:
            total[key] += int(summary.get(key) or 0)

    print(
        "TOTAL: "
        f"literature={len(literature_ids)}, rows_updated={total['rows_updated']}, "
        f"located={total['located_before']}/{total['fields_before']} -> "
        f"{total['located_after']}/{total['fields_after']}, dry_run={args.dry_run}"
    )


if __name__ == "__main__":
    main()
