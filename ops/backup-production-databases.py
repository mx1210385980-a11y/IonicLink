#!/usr/bin/env python3
"""Create consistent online backups of IonicLink's top-level SQLite databases."""

from __future__ import annotations

import json
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path


def main() -> int:
    if len(sys.argv) != 3:
        print(
            "usage: backup-production-databases.py DATA_DIR BACKUP_DIR",
            file=sys.stderr,
        )
        return 64

    data_dir = Path(sys.argv[1]).resolve()
    backup_dir = Path(sys.argv[2]).resolve()

    if not data_dir.is_dir():
        print(f"data directory does not exist: {data_dir}", file=sys.stderr)
        return 66

    backup_dir.mkdir(parents=True, mode=0o700, exist_ok=False)
    manifest: list[dict[str, object]] = []

    databases = [
        path
        for path in sorted(data_dir.glob("*.db"))
        if ".before-" not in path.name
    ]
    if not databases:
        print(f"no top-level SQLite databases found in {data_dir}", file=sys.stderr)
        return 66

    for database in databases:
        target = backup_dir / database.name
        source_uri = f"{database.as_uri()}?mode=ro"

        with sqlite3.connect(source_uri, uri=True, timeout=30) as source:
            with sqlite3.connect(target, timeout=30) as destination:
                source.backup(destination)
                result = destination.execute("PRAGMA quick_check").fetchone()
                if result is None or result[0] != "ok":
                    raise RuntimeError(
                        f"SQLite quick_check failed for {database.name}: {result}"
                    )

        target.chmod(0o600)
        manifest.append(
            {
                "name": database.name,
                "source_size_bytes": database.stat().st_size,
                "backup_size_bytes": target.stat().st_size,
            }
        )

    manifest_path = backup_dir / "manifest.json"
    manifest_path.write_text(
        json.dumps(
            {
                "created_at": datetime.now(timezone.utc).isoformat(),
                "databases": manifest,
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    manifest_path.chmod(0o600)
    print(f"Backed up {len(manifest)} SQLite databases to {backup_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
