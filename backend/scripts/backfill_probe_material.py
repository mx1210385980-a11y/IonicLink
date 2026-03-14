from __future__ import annotations

import sqlite3
from pathlib import Path


DB_PATH = Path(__file__).resolve().parents[1] / "data" / "ioniclink.db"


def count_missing_probe(conn: sqlite3.Connection) -> int:
    return conn.execute(
        """
        SELECT COUNT(*)
        FROM tribology_data
        WHERE TRIM(COALESCE(probe_material, '')) = ''
        """
    ).fetchone()[0]


def run() -> None:
    conn = sqlite3.connect(DB_PATH)
    try:
        before = count_missing_probe(conn)
        updated = conn.execute(
            """
            UPDATE tribology_data
            SET probe_material = COALESCE(NULLIF(probe_material, ''), substrate_material, material_name)
            WHERE TRIM(COALESCE(probe_material, '')) = ''
              AND TRIM(COALESCE(substrate_material, '')) != ''
              AND TRIM(COALESCE(material_name, '')) != ''
              AND LOWER(TRIM(substrate_material)) = LOWER(TRIM(material_name))
              AND TRIM(COALESCE(probe_geometry, '')) = ''
              AND TRIM(COALESCE(probe_radius, '')) = ''
              AND TRIM(COALESCE(probe_roughness, '')) = ''
            """
        ).rowcount
        conn.commit()
        after = count_missing_probe(conn)
    finally:
        conn.close()

    print(f"probe_material missing before: {before}")
    print(f"rows updated: {updated}")
    print(f"probe_material missing after: {after}")


if __name__ == "__main__":
    run()
