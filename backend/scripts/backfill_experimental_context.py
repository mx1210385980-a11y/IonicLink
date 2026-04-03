from __future__ import annotations

import sqlite3
import sys
from pathlib import Path

import fitz

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from utils.document_context import apply_experimental_document_context, extract_experimental_document_context


DB_PATH = ROOT / "data" / "ioniclink.db"
FIELDS = [
    "material_name",
    "load_value",
    "speed_value",
    "temperature",
    "probe_material",
    "probe_geometry",
    "probe_radius",
    "probe_roughness",
    "substrate_material",
    "substrate_coating",
    "substrate_roughness",
    "surface_roughness",
    "film_thickness",
]


def _load_page_texts(pdf_path: Path) -> dict[int, str]:
    doc = fitz.open(pdf_path)
    try:
        return {page_index: doc[page_index].get_text("text") or "" for page_index in range(len(doc))}
    finally:
        doc.close()


def main() -> None:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    cur.execute("SELECT id, file_path FROM literature WHERE file_path IS NOT NULL AND TRIM(file_path) != ''")
    literature_rows = cur.fetchall()

    literature_changed = 0
    records_changed = 0

    for literature in literature_rows:
        raw_path = Path(str(literature["file_path"]))
        pdf_path = raw_path if raw_path.is_absolute() else (ROOT / raw_path)
        if not pdf_path.exists():
            continue

        page_texts = _load_page_texts(pdf_path)
        context = extract_experimental_document_context(page_texts)
        if not context:
            continue

        cur.execute(
            """
            SELECT
                id,
                material_name,
                load_value,
                speed_value,
                temperature,
                probe_material,
                probe_geometry,
                probe_radius,
                probe_roughness,
                substrate_material,
                substrate_coating,
                substrate_roughness,
                surface_roughness,
                film_thickness
            FROM tribology_data
            WHERE literature_id = ?
            ORDER BY id
            """,
            (literature["id"],),
        )
        rows = cur.fetchall()
        changed_here = 0

        for row in rows:
            before = {field: row[field] for field in FIELDS}
            enriched = apply_experimental_document_context(
                before,
                context,
                override_probe_material=True,
            )
            updates = {field: enriched.get(field) for field in FIELDS if enriched.get(field) != before.get(field)}
            if not updates:
                continue

            assignments = ", ".join(f"{field} = ?" for field in updates)
            values = [updates[field] for field in updates]
            values.append(row["id"])
            cur.execute(f"UPDATE tribology_data SET {assignments} WHERE id = ?", values)
            changed_here += 1
            records_changed += 1

        if changed_here:
            literature_changed += 1
            print(f"literature_id={literature['id']} updated_records={changed_here} context={context}")

    conn.commit()
    conn.close()
    print(f"literature_changed={literature_changed} records_changed={records_changed}")


if __name__ == "__main__":
    main()
