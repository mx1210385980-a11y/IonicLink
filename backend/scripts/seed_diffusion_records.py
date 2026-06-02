"""Promote existing diffusion candidates into the final diffusion library."""

from __future__ import annotations

import argparse
import shutil
import sqlite3
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DB_PATH = ROOT / "backend" / "data" / "ioniclink.db"

DIFFUSION_COPY_COLUMNS = [
    "literature_id",
    "system_name",
    "confinement_material_class",
    "confinement_geometry_class",
    "surface_functional_groups",
    "confinement_dimensionality",
    "ionic_liquid",
    "d_total",
    "d_cation",
    "d_anion",
    "d_unit",
    "temperature_value",
    "confinement_scale_value",
    "confinement_scale_unit",
    "source",
    "source_page",
    "source_bbox",
    "evidence",
    "provider",
    "prompt_version",
    "raw_model_output",
    "field_evidence_json",
    "review_status",
    "assembly_notes",
    "confidence",
    "novel_features_json",
    "smiles",
    "rdkit_features_json",
    "extracted_at",
]


def _has_table(conn: sqlite3.Connection, table_name: str) -> bool:
    row = conn.execute(
        "select 1 from sqlite_master where type = 'table' and name = ?",
        (table_name,),
    ).fetchone()
    return row is not None


def promote_diffusion_candidates(db_path: Path, *, limit: int = 6) -> int:
    """Promote up to ``limit`` unpromoted candidates with at least one D value."""
    if limit <= 0:
        return 0

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    try:
        candidates = conn.execute(
            """
            select *
              from diffusion_candidates
             where promoted_record_id is null
               and (d_total is not null or d_cation is not null or d_anion is not null)
             order by literature_id asc, id asc
             limit ?
            """,
            (limit,),
        ).fetchall()
        if not candidates:
            return 0

        now = datetime.now(timezone.utc).isoformat(timespec="seconds")
        promoted = 0
        for candidate in candidates:
            insert_columns = [*DIFFUSION_COPY_COLUMNS, "record_origin"]
            insert_values = [candidate[column] for column in DIFFUSION_COPY_COLUMNS]
            insert_values.append("seed_promoted_candidate")
            placeholders = ", ".join("?" for _ in insert_columns)
            conn.execute(
                f"insert into diffusion_records ({', '.join(insert_columns)}) values ({placeholders})",
                insert_values,
            )
            record_id = int(conn.execute("select last_insert_rowid()").fetchone()[0])
            conn.execute(
                "update diffusion_candidates set promoted_record_id = ?, promoted_at = ? where id = ?",
                (record_id, now, candidate["id"]),
            )
            if _has_table(conn, "diffusion_feature_sets"):
                conn.execute(
                    "update diffusion_feature_sets set record_id = ? where candidate_id = ?",
                    (record_id, candidate["id"]),
                )
            promoted += 1

        conn.commit()
        return promoted
    finally:
        conn.close()


def main() -> None:
    parser = argparse.ArgumentParser(description="Promote existing diffusion candidates into diffusion_records.")
    parser.add_argument("--db", type=Path, default=DEFAULT_DB_PATH)
    parser.add_argument("--limit", type=int, default=6)
    parser.add_argument("--no-backup", action="store_true")
    args = parser.parse_args()

    if not args.db.exists():
        raise SystemExit(f"Database not found: {args.db}")

    if not args.no_backup:
        stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
        backup_path = args.db.with_name(f"{args.db.stem}.before-diffusion-seed-{stamp}{args.db.suffix}")
        shutil.copy2(args.db, backup_path)
        print(f"Backup written: {backup_path}")

    promoted = promote_diffusion_candidates(args.db, limit=args.limit)
    print(f"Promoted {promoted} diffusion candidate(s).")


if __name__ == "__main__":
    main()
