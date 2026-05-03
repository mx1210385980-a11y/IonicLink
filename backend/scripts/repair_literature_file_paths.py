from __future__ import annotations

import argparse
import sqlite3
from pathlib import Path


BACKEND_ROOT = Path(__file__).resolve().parents[1]
WORKSPACE_ROOT = BACKEND_ROOT.parent
DB_PATH = BACKEND_ROOT / "data" / "ioniclink.db"
SEARCH_ROOTS = [
    WORKSPACE_ROOT / "export",
    WORKSPACE_ROOT / "Reference",
    BACKEND_ROOT / "temp_uploads" / "pdfs",
    BACKEND_ROOT / "data" / "literature_monitor_pdfs",
]


def resolve_existing_path(raw_path: str) -> Path | None:
    normalized_path = raw_path.replace("\\", "/")
    path = Path(normalized_path)
    candidates: list[Path] = []
    if path.is_absolute():
        candidates.append(path.resolve())
    else:
        candidates.append((BACKEND_ROOT / path).resolve())
        candidates.append((WORKSPACE_ROOT / path).resolve())
        parts = path.parts
        if parts and parts[0].lower() == "backend":
            stripped = Path(*parts[1:])
            candidates.append((WORKSPACE_ROOT / stripped).resolve())

    for candidate in candidates:
        if candidate.exists() and candidate.is_file():
            return candidate
    return None


def build_name_index() -> dict[str, list[Path]]:
    index: dict[str, list[Path]] = {}
    for root in SEARCH_ROOTS:
        if not root.exists():
            continue
        for path in root.rglob("*.pdf"):
            index.setdefault(path.name.lower(), []).append(path.resolve())
    return index


def normalize_storage_path(path: Path) -> str:
    path = path.resolve()
    try:
        return str(path.relative_to(BACKEND_ROOT)).replace("\\", "/")
    except ValueError:
        return str(path.relative_to(WORKSPACE_ROOT)).replace("\\", "/")


def choose_repair_path(raw_path: str, file_name_index: dict[str, list[Path]]) -> Path | None:
    resolved = resolve_existing_path(raw_path)
    if resolved:
        return resolved

    basename = Path(raw_path).name.lower()
    matches = file_name_index.get(basename, [])
    if len(matches) == 1:
        return matches[0]
    return None


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Repair stale literature.file_path values.")
    parser.add_argument("--limit", type=int, default=None, help="Only process up to N rows needing repair.")
    parser.add_argument("--dry-run", action="store_true", help="Report fixes without writing them.")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row

    try:
        query = """
            SELECT id, title, file_path
            FROM literature
            WHERE file_path IS NOT NULL
              AND TRIM(file_path) != ''
            ORDER BY id
        """
        rows = conn.execute(query).fetchall()
        file_name_index = build_name_index()

        scanned = 0
        repaired = 0
        unresolved = 0
        already_valid = 0

        for row in rows:
            if args.limit and scanned >= args.limit:
                break
            scanned += 1

            raw_path = str(row["file_path"])
            existing = resolve_existing_path(raw_path)
            if existing:
                normalized_path = normalize_storage_path(existing)
                if normalized_path == raw_path:
                    already_valid += 1
                    continue
                print(f"normalize literature_id={row['id']} from={raw_path} to={normalized_path}")
                if not args.dry_run:
                    conn.execute(
                        "UPDATE literature SET file_path = ? WHERE id = ?",
                        (normalized_path, row["id"]),
                    )
                repaired += 1
                continue

            repaired_path = choose_repair_path(raw_path, file_name_index)
            if not repaired_path:
                unresolved += 1
                print(f"unresolved literature_id={row['id']} path={raw_path} title={row['title']}")
                continue

            normalized_path = normalize_storage_path(repaired_path)
            print(f"repair literature_id={row['id']} from={raw_path} to={normalized_path}")
            if not args.dry_run:
                conn.execute(
                    "UPDATE literature SET file_path = ? WHERE id = ?",
                    (normalized_path, row["id"]),
                )
            repaired += 1

        if not args.dry_run:
            conn.commit()
    finally:
        conn.close()

    print(f"scanned={scanned}")
    print(f"repaired={repaired}")
    print(f"already_valid={already_valid}")
    print(f"unresolved={unresolved}")
    print(f"dry_run={args.dry_run}")


if __name__ == "__main__":
    main()
