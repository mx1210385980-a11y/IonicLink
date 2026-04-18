from __future__ import annotations

import argparse
import hashlib
import sqlite3
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
WORKSPACE_ROOT = ROOT.parent
DB_PATH = ROOT / "data" / "ioniclink.db"


def resolve_file_path(raw_path: str) -> Path:
    path = Path(raw_path)
    if path.is_absolute():
        return path

    candidates = [
        (ROOT / path).resolve(),
        (WORKSPACE_ROOT / path).resolve(),
    ]
    for candidate in candidates:
        if candidate.exists() and candidate.is_file():
            return candidate
    return (ROOT / path).resolve()


def compute_file_hash(path: Path) -> str:
    hasher = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            hasher.update(chunk)
    return hasher.hexdigest()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Backfill literature.file_hash from stored PDF files.")
    parser.add_argument("--limit", type=int, default=None, help="Only process up to N missing rows.")
    parser.add_argument("--dry-run", action="store_true", help="Compute hashes without writing them to the database.")
    parser.add_argument(
        "--rewrite-mismatch",
        action="store_true",
        help="Also recompute rows that already have file_hash and rewrite them when the value differs.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row

    try:
        where_clause = "WHERE file_path IS NOT NULL AND TRIM(file_path) != ''"
        if not args.rewrite_mismatch:
            where_clause += " AND (file_hash IS NULL OR TRIM(file_hash) = '')"

        query = f"""
            SELECT id, title, file_path, file_hash
            FROM literature
            {where_clause}
            ORDER BY id
        """
        if args.limit:
            query += " LIMIT ?"
            rows = conn.execute(query, (args.limit,)).fetchall()
        else:
            rows = conn.execute(query).fetchall()

        scanned = 0
        updated = 0
        skipped_missing_file = 0
        skipped_unchanged = 0
        skipped_errors = 0

        for row in rows:
            scanned += 1
            pdf_path = resolve_file_path(str(row["file_path"]))
            if not pdf_path.exists() or not pdf_path.is_file():
                skipped_missing_file += 1
                print(f"skip missing literature_id={row['id']} path={pdf_path}")
                continue

            try:
                computed_hash = compute_file_hash(pdf_path)
            except OSError as exc:
                skipped_errors += 1
                print(f"skip error literature_id={row['id']} path={pdf_path} error={exc}")
                continue

            existing_hash = (row["file_hash"] or "").strip()
            if existing_hash == computed_hash:
                skipped_unchanged += 1
                continue

            print(
                f"backfill literature_id={row['id']} hash={computed_hash} "
                f"title={str(row['title'] or '').strip()[:80]}"
            )
            if not args.dry_run:
                conn.execute(
                    "UPDATE literature SET file_hash = ? WHERE id = ?",
                    (computed_hash, row["id"]),
                )
            updated += 1

        if not args.dry_run:
            conn.commit()
    finally:
        conn.close()

    print(f"scanned={scanned}")
    print(f"updated={updated}")
    print(f"skipped_missing_file={skipped_missing_file}")
    print(f"skipped_unchanged={skipped_unchanged}")
    print(f"skipped_errors={skipped_errors}")
    print(f"dry_run={args.dry_run}")


if __name__ == "__main__":
    main()
