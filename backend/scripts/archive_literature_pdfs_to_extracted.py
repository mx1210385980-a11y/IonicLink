"""Move/copy literature PDFs referenced by the DB into Reference/Extracted."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Any


BACKEND_ROOT = Path(__file__).resolve().parents[1]
WORKSPACE_ROOT = BACKEND_ROOT.parent
DB_PATH = BACKEND_ROOT / "data" / "ioniclink.db"
EXTRACTED_DIR = WORKSPACE_ROOT / "Reference" / "Extracted"

SEARCH_ROOTS = [
    WORKSPACE_ROOT / "Reference",
    WORKSPACE_ROOT / "export",
    WORKSPACE_ROOT / "PaperData" / "Reference",
    BACKEND_ROOT / "temp_uploads" / "pdfs",
    BACKEND_ROOT / "data" / "literature_monitor_pdfs",
]
MOVE_SOURCE_ROOTS = [
    WORKSPACE_ROOT / "Reference",
    WORKSPACE_ROOT / "export",
    WORKSPACE_ROOT / "temp_uploads",
    BACKEND_ROOT / "temp_uploads",
]


def rel(path: Path) -> str:
    return str(path.resolve().relative_to(WORKSPACE_ROOT)).replace("\\", "/")


def is_within(path: Path, parent: Path) -> bool:
    try:
        path.resolve().relative_to(parent.resolve())
        return True
    except ValueError:
        return False


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def clean_filename(value: str) -> str:
    cleaned = re.sub(r"[\\/:*?\"<>|]+", " ", value)
    cleaned = re.sub(r"\s+", " ", cleaned).strip(" ._-")
    return cleaned[:210].strip(" ._-") or "literature"


def first_author_token(authors: str | None) -> str:
    first = (authors or "").replace(",", ";").split(";")[0].strip()
    if not first:
        return ""
    parts = re.split(r"\s+", first)
    return clean_filename(parts[-1].lower())


def destination_filename(row: sqlite3.Row, source: Path) -> str:
    source_name = source.name.strip()
    source_is_temp_id = bool(re.fullmatch(r"\d+\.pdf", source_name, flags=re.IGNORECASE))
    if source_name and not source_is_temp_id:
        return clean_filename(source_name[:-4] if source_name.lower().endswith(".pdf") else source_name) + ".pdf"

    parts: list[str] = []
    year = int(row["year"] or 0)
    if year > 0:
        parts.append(str(year))
    author = first_author_token(row["authors"])
    if author:
        parts.append(author)
    title = str(row["title"] or "").strip()
    if title.lower().endswith(".pdf"):
        title = title[:-4]
    parts.append(title or f"literature-{row['id']}")
    return clean_filename("-".join(parts)) + ".pdf"


def normalize_for_match(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", value.lower())


def build_pdf_indexes() -> tuple[dict[str, list[Path]], dict[str, list[Path]]]:
    by_hash: dict[str, list[Path]] = {}
    by_name: dict[str, list[Path]] = {}
    for root in SEARCH_ROOTS:
        if not root.exists():
            continue
        for path in root.rglob("*.pdf"):
            if not path.is_file():
                continue
            try:
                digest = sha256(path)
            except OSError:
                continue
            by_hash.setdefault(digest, []).append(path.resolve())
            by_name.setdefault(path.name.lower(), []).append(path.resolve())
    return by_hash, by_name


def resolve_existing_path(raw_path: str, row: sqlite3.Row, by_hash: dict[str, list[Path]], by_name: dict[str, list[Path]]) -> Path | None:
    raw_path = (raw_path or "").replace("\\", "/")
    path = Path(raw_path)
    candidates: list[Path] = []
    if path.is_absolute():
        candidates.append(path)
    else:
        candidates.append(WORKSPACE_ROOT / path)
        candidates.append(BACKEND_ROOT / path)
        parts = path.parts
        if parts and parts[0].lower() == "backend":
            candidates.append(WORKSPACE_ROOT / Path(*parts[1:]))
    for candidate in candidates:
        if candidate.exists() and candidate.is_file():
            return candidate.resolve()

    stored_hash = (row["file_hash"] or "").strip().lower()
    if stored_hash:
        live_matches = [p for p in by_hash.get(stored_hash, []) if p.exists() and p.is_file()]
        if live_matches:
            return choose_best_match(live_matches, row)

    basename = Path(raw_path).name.lower()
    live_name_matches = [p for p in by_name.get(basename, []) if p.exists() and p.is_file()]
    if live_name_matches:
        return choose_best_match(live_name_matches, row)

    title = str(row["title"] or "").strip()
    if title.lower().endswith(".pdf"):
        live_title_matches = [p for p in by_name.get(title.lower(), []) if p.exists() and p.is_file()]
        if live_title_matches:
            return choose_best_match(live_title_matches, row)
    return None


def choose_best_match(paths: list[Path], row: sqlite3.Row) -> Path:
    title_key = normalize_for_match(str(row["title"] or ""))

    def score(path: Path) -> tuple[int, int, str]:
        name_key = normalize_for_match(path.stem)
        extracted_bonus = 10 if is_within(path, EXTRACTED_DIR) else 0
        title_bonus = len(title_key) if title_key and title_key in name_key else 0
        return (extracted_bonus + title_bonus, -len(str(path)), str(path))

    return sorted(paths, key=score, reverse=True)[0]


def unique_target_path(filename: str, source_hash: str) -> Path:
    EXTRACTED_DIR.mkdir(parents=True, exist_ok=True)
    stem = Path(filename).stem
    suffix = Path(filename).suffix or ".pdf"
    for index in range(0, 200):
        postfix = "" if index == 0 else f"-{index}"
        candidate = EXTRACTED_DIR / f"{stem}{postfix}{suffix}"
        if not candidate.exists():
            return candidate
        try:
            if sha256(candidate) == source_hash:
                return candidate
        except OSError:
            continue
    return EXTRACTED_DIR / f"{stem}-{source_hash[:8]}{suffix}"


def archive_one(row: sqlite3.Row, by_hash: dict[str, list[Path]], by_name: dict[str, list[Path]], *, dry_run: bool) -> dict[str, Any]:
    source = resolve_existing_path(str(row["file_path"] or ""), row, by_hash, by_name)
    result: dict[str, Any] = {
        "literature_id": row["id"],
        "title": row["title"],
        "old_path": row["file_path"],
        "status": "missing",
    }
    if not source:
        return result

    source_hash = sha256(source)
    existing_extracted = [p for p in by_hash.get(source_hash, []) if p.exists() and is_within(p, EXTRACTED_DIR)]
    if existing_extracted:
        target = choose_best_match(existing_extracted, row)
    else:
        target = unique_target_path(destination_filename(row, source), source_hash)

    target_exists_same = target.exists() and sha256(target) == source_hash
    source_already_extracted = is_within(source, EXTRACTED_DIR)
    should_move = any(is_within(source, parent) for parent in MOVE_SOURCE_ROOTS) and not source_already_extracted
    action = "already_extracted" if source_already_extracted else ("dedupe" if target_exists_same else ("move" if should_move else "copy"))

    if not dry_run:
        if source_already_extracted:
            pass
        elif target_exists_same:
            if should_move and source.exists():
                source.unlink()
        elif should_move:
            shutil.move(str(source), str(target))
        else:
            shutil.copy2(source, target)
        by_hash.setdefault(source_hash, [])
        if target.resolve() not in by_hash[source_hash]:
            by_hash[source_hash].append(target.resolve())

    result.update(
        {
            "status": action,
            "source": rel(source),
            "target": rel(target),
            "hash": source_hash,
        }
    )
    return result


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Archive all DB-referenced literature PDFs into Reference/Extracted.")
    parser.add_argument("--dry-run", action="store_true", help="Print planned moves without changing files or DB.")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    by_hash, by_name = build_pdf_indexes()
    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    db_backup = DB_PATH.with_name(f"ioniclink.before-literature-pdf-archive-{timestamp}.db")
    manifest_path = BACKEND_ROOT / "data" / f"literature_pdf_archive_manifest_{timestamp}.json"

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        rows = conn.execute(
            """
            SELECT id, doi, title, authors, year, file_path, file_hash
              FROM literature
             WHERE file_path IS NOT NULL AND TRIM(file_path) != ''
             ORDER BY id
            """
        ).fetchall()
        if not args.dry_run:
            shutil.copy2(DB_PATH, db_backup)

        results = [archive_one(row, by_hash, by_name, dry_run=args.dry_run) for row in rows]

        if not args.dry_run:
            with conn:
                for result in results:
                    if result["status"] == "missing":
                        continue
                    conn.execute(
                        """
                        UPDATE literature
                           SET file_path = ?, file_hash = ?
                         WHERE id = ?
                        """,
                        (result["target"], result["hash"], result["literature_id"]),
                    )
            manifest_path.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")

        counts: dict[str, int] = {}
        for result in results:
            counts[result["status"]] = counts.get(result["status"], 0) + 1
        print(f"dry_run: {args.dry_run}")
        if not args.dry_run:
            print(f"db_backup: {db_backup}")
            print(f"manifest: {manifest_path}")
        print("counts:", json.dumps(counts, ensure_ascii=False, sort_keys=True))
        for result in results:
            if result["status"] == "missing":
                print(f"missing literature_id={result['literature_id']} old_path={result['old_path']} title={result['title']}")
            elif args.dry_run:
                print(f"{result['status']} literature_id={result['literature_id']} {result['source']} -> {result['target']}")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
