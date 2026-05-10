"""Remove obvious duplicate tribology rows.

The library has a few duplicate patterns produced by repeated extraction and by
older CSV/Row imports being superseded by grounded review records.  This script
keeps the best-grounded row for each obvious duplicate set and writes an audit
CSV before applying deletes.

Default mode is a dry run.  Use --apply to mutate the database.
"""

from __future__ import annotations

import argparse
import csv
import re
import shutil
import sqlite3
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Iterable


ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DB_PATH = ROOT / "backend" / "data" / "ioniclink.db"
DEFAULT_AUDIT_DIR = ROOT / "backend" / "data"


@dataclass(frozen=True)
class DeleteDecision:
    delete_id: int
    keep_id: int
    reason: str
    duplicate_key: tuple[str, ...]


def compact_text(value: Any) -> str:
    if value is None:
        return ""
    text = str(value).strip().lower()
    text = text.replace("（", "(").replace("）", ")").replace("−", "-")
    return re.sub(r"\s+", "", text)


def normalize_lubricant(value: Any) -> str:
    text = compact_text(value)
    text = re.sub(r"[\[\](),\-\s]", "", text)

    # Common aliases in this library.
    text = text.replace("py14fap", "pyr14fap")
    text = text.replace("pyr1,4fap", "pyr14fap")
    return text


def normalize_number(value: Any, places: int = 4) -> str:
    if value is None or str(value).strip() == "":
        return ""
    try:
        number = float(value)
    except (TypeError, ValueError):
        match = re.search(r"[-+]?\d+(?:\.\d+)?", str(value))
        if not match:
            return compact_text(value)
        number = float(match.group(0))
    return f"{number:.{places}f}".rstrip("0").rstrip(".")


def normalize_potential(value: Any) -> str:
    if value is None or str(value).strip() == "":
        return ""
    text = str(value).strip().lower().replace("−", "-")
    match = re.search(r"[-+]?\d+(?:\.\d+)?", text)
    if not match:
        return compact_text(text)
    return f"{float(match.group(0)):.3f}".rstrip("0").rstrip(".")


def normalize_speed(value: Any) -> str:
    if value is None or str(value).strip() == "":
        return ""
    text = str(value).strip().lower().replace("μ", "u")
    numbers = re.findall(r"[-+]?\d+(?:\.\d+)?", text)
    if len(numbers) == 1:
        return f"{float(numbers[0]):.3f}".rstrip("0").rstrip(".")
    if len(numbers) > 1:
        return "-".join(f"{float(number):.3f}".rstrip("0").rstrip(".") for number in numbers[:2])
    return compact_text(text)


def normalize_temperature(value: Any) -> str:
    if value is None or str(value).strip() == "":
        return ""
    match = re.search(r"[-+]?\d+(?:\.\d+)?", str(value))
    if not match:
        return compact_text(value)

    # Treat 298 K and 298.15 K as the same room-temperature datum.
    return str(round(float(match.group(0))))


def source_signature(row: sqlite3.Row) -> tuple[str, str, str, str]:
    return (
        str(row["literature_id"]),
        compact_text(row["source"]),
        normalize_number(row["source_page"], places=0),
        compact_text(row["source_figure"]),
    )


def core_key(row: sqlite3.Row) -> tuple[str, ...]:
    return (
        compact_text(row["material_name"]),
        normalize_lubricant(row["lubricant"]),
        normalize_number(row["cof_value"]),
        normalize_potential(row["potential"]),
        normalize_speed(row["speed_value"]),
        normalize_temperature(row["temperature"]),
        compact_text(row["water_content"]),
        compact_text(row["mol_ratio"]),
    )


def is_row_import(row: sqlite3.Row) -> bool:
    figure = str(row["source_figure"] or "").strip()
    origin = str(row["record_origin"] or "").strip()
    return bool(re.fullmatch(r"Row\s+\d+", figure, re.IGNORECASE)) or origin == "cached_record"


def is_grounded(row: sqlite3.Row) -> bool:
    figure = str(row["source_figure"] or "").strip()
    has_specific_figure = bool(figure) and not re.fullmatch(r"Row\s+\d+", figure, re.IGNORECASE)
    return bool(row["source_page"] or row["evidence_page"] or row["evidence_bbox"] or has_specific_figure)


def keep_score(row: sqlite3.Row) -> tuple[float, int, int]:
    status_score = 3 if row["review_status"] == "approved" else 0
    origin_score = 2 if row["record_origin"] == "review_promoted_candidate" else 0
    grounding_score = 0
    if is_grounded(row):
        grounding_score += 4
    if row["source_page"] is not None:
        grounding_score += 2
    if row["evidence_bbox"]:
        grounding_score += 1
    if is_row_import(row):
        grounding_score -= 2

    evidence_len = len(row["field_evidence_json"] or "")
    confidence = float(row["confidence"] or 0)
    score = status_score + origin_score + grounding_score + confidence

    # Higher id is preferred as a final tie-breaker because repeated review
    # promotion usually produced the later, more complete evidence payload.
    return (score, evidence_len, int(row["id"]))


def choose_keep(rows: Iterable[sqlite3.Row]) -> sqlite3.Row:
    return max(rows, key=keep_score)


def add_delete(
    decisions: dict[int, DeleteDecision],
    delete_row: sqlite3.Row,
    keep_row: sqlite3.Row,
    reason: str,
) -> None:
    delete_id = int(delete_row["id"])
    keep_id = int(keep_row["id"])
    if delete_id == keep_id:
        return
    existing = decisions.get(delete_id)
    decision = DeleteDecision(
        delete_id=delete_id,
        keep_id=keep_id,
        reason=reason,
        duplicate_key=core_key(delete_row),
    )
    if existing is None or keep_score(keep_row) > keep_score_by_id(existing.keep_id):
        decisions[delete_id] = decision


_SCORE_BY_ID: dict[int, tuple[float, int, int]] = {}


def keep_score_by_id(row_id: int) -> tuple[float, int, int]:
    return _SCORE_BY_ID.get(row_id, (-999.0, 0, 0))


def find_delete_decisions(rows: list[sqlite3.Row]) -> list[DeleteDecision]:
    global _SCORE_BY_ID
    _SCORE_BY_ID = {int(row["id"]): keep_score(row) for row in rows}

    by_core: dict[tuple[str, ...], list[sqlite3.Row]] = defaultdict(list)
    for row in rows:
        by_core[core_key(row)].append(row)

    decisions: dict[int, DeleteDecision] = {}

    for key, group in by_core.items():
        if len(group) < 2:
            continue

        by_source: dict[tuple[str, ...], list[sqlite3.Row]] = defaultdict(list)
        for row in group:
            by_source[source_signature(row)].append(row)

        for source_rows in by_source.values():
            if len(source_rows) < 2:
                continue
            keep = choose_keep(source_rows)
            for row in source_rows:
                add_delete(decisions, row, keep, "same source and same experimental condition")

        survivors = [row for row in group if int(row["id"]) not in decisions]
        grounded = [row for row in survivors if is_grounded(row) and not is_row_import(row)]
        row_imports = [row for row in survivors if is_row_import(row)]
        if grounded and row_imports:
            keep = choose_keep(grounded)
            for row in row_imports:
                add_delete(decisions, row, keep, "row import superseded by grounded record")

    return sorted(decisions.values(), key=lambda decision: decision.delete_id)


def load_rows(connection: sqlite3.Connection) -> list[sqlite3.Row]:
    connection.row_factory = sqlite3.Row
    return connection.execute("SELECT * FROM tribology_data ORDER BY id").fetchall()


def audit_rows(connection: sqlite3.Connection, decisions: list[DeleteDecision]) -> list[dict[str, Any]]:
    if not decisions:
        return []
    ids = sorted({decision.delete_id for decision in decisions} | {decision.keep_id for decision in decisions})
    placeholders = ",".join("?" for _ in ids)
    row_map = {
        int(row["id"]): row
        for row in connection.execute(f"SELECT * FROM tribology_data WHERE id IN ({placeholders})", ids)
    }
    candidate_counts = {
        int(row["promoted_record_id"]): int(row["count"])
        for row in connection.execute(
            f"""
            SELECT promoted_record_id, COUNT(*) AS count
            FROM record_candidates
            WHERE promoted_record_id IN ({placeholders})
            GROUP BY promoted_record_id
            """,
            ids,
        )
    }
    audit: list[dict[str, Any]] = []
    for decision in decisions:
        delete_row = row_map[decision.delete_id]
        keep_row = row_map[decision.keep_id]
        audit.append(
            {
                "delete_id": decision.delete_id,
                "keep_id": decision.keep_id,
                "reason": decision.reason,
                "candidate_rows_deleted": candidate_counts.get(decision.delete_id, 0),
                "material": delete_row["material_name"],
                "lubricant": delete_row["lubricant"],
                "cof_value": delete_row["cof_value"],
                "potential": delete_row["potential"],
                "speed_value": delete_row["speed_value"],
                "temperature": delete_row["temperature"],
                "delete_literature_id": delete_row["literature_id"],
                "keep_literature_id": keep_row["literature_id"],
                "delete_source": delete_row["source"],
                "keep_source": keep_row["source"],
                "delete_source_figure": delete_row["source_figure"],
                "keep_source_figure": keep_row["source_figure"],
                "delete_review_status": delete_row["review_status"],
                "keep_review_status": keep_row["review_status"],
                "delete_record_origin": delete_row["record_origin"],
                "keep_record_origin": keep_row["record_origin"],
            }
        )
    return audit


def write_audit(path: Path, audit: list[dict[str, Any]]) -> None:
    if not audit:
        return
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(audit[0].keys()))
        writer.writeheader()
        writer.writerows(audit)


def apply_deletes(connection: sqlite3.Connection, decisions: list[DeleteDecision]) -> tuple[int, int]:
    delete_ids = [decision.delete_id for decision in decisions]
    if not delete_ids:
        return (0, 0)

    placeholders = ",".join("?" for _ in delete_ids)
    with connection:
        candidate_deleted = connection.execute(
            f"DELETE FROM record_candidates WHERE promoted_record_id IN ({placeholders})",
            delete_ids,
        ).rowcount
        data_deleted = connection.execute(
            f"DELETE FROM tribology_data WHERE id IN ({placeholders})",
            delete_ids,
        ).rowcount
    return (data_deleted, candidate_deleted)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", type=Path, default=DEFAULT_DB_PATH)
    parser.add_argument("--apply", action="store_true", help="delete duplicate rows after writing backup/audit")
    parser.add_argument("--audit-dir", type=Path, default=DEFAULT_AUDIT_DIR)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    db_path = args.db.resolve()
    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    audit_path = args.audit_dir.resolve() / f"tribology_dedupe_audit_{timestamp}.csv"

    connection = sqlite3.connect(db_path)
    rows = load_rows(connection)
    decisions = find_delete_decisions(rows)
    audit = audit_rows(connection, decisions)

    write_audit(audit_path, audit)

    print(f"DB: {db_path}")
    print(f"tribology_data rows: {len(rows)}")
    print(f"duplicate rows selected: {len(decisions)}")
    if audit:
        print(f"audit: {audit_path}")
        reasons = defaultdict(int)
        for decision in decisions:
            reasons[decision.reason] += 1
        for reason, count in sorted(reasons.items()):
            print(f"  {reason}: {count}")
    else:
        print("audit: not written (no duplicate rows selected)")

    if not args.apply:
        print("dry run only; pass --apply to delete")
        return

    backup_path = db_path.with_name(f"{db_path.stem}.before-dedupe-obvious-{timestamp}{db_path.suffix}")
    shutil.copy2(db_path, backup_path)
    data_deleted, candidate_deleted = apply_deletes(connection, decisions)

    print(f"backup: {backup_path}")
    print(f"deleted tribology_data rows: {data_deleted}")
    print(f"deleted record_candidates rows: {candidate_deleted}")


if __name__ == "__main__":
    main()
