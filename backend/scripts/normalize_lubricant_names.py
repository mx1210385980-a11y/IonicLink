"""
One-time migration script: Normalize all lubricant names in the database.

Usage:
    python scripts/normalize_lubricant_names.py             # dry-run (show mapping)
    python scripts/normalize_lubricant_names.py --apply      # apply changes
"""

import sys
import os
import sqlite3
import re
from pathlib import Path

# Ensure backend directory is on the path so local imports work.
BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))

from services.il_resolver_service import resolve_il
from services.data_sync_service import _strip_charge_symbols
from knowledge_base import normalize_ionic_liquid

DB_PATH = BACKEND_DIR / "data" / "ioniclink.db"


def _canonicalize(value: str) -> str:
    """Replicate the enhanced _canonicalize_il() logic synchronously."""
    text = value.strip()
    if not text:
        return ""
    text_l = text.lower()
    if "ethylammonium nitrate" in text_l or re.search(r"\bean\b", text_l):
        return "EAN"
    if "ethaline" in text_l:
        return "Ethaline"

    # Strip charge symbols
    text = _strip_charge_symbols(text)

    # Mixture notation: [X][Y] / carrier
    mixture_match = re.match(r"(\[.+?\]\s*\[.+?\])\s*/\s*(.+)", text)
    if mixture_match:
        il_part = mixture_match.group(1).strip()
        carrier = mixture_match.group(2).strip()
        resolved = resolve_il(il_part)
        canonical = resolved.get("canonical_name")
        if canonical:
            return f"{canonical} / {carrier}"
        il_part = re.sub(r"\s+", "", il_part).replace("]i[", "][")
        return f"{il_part} / {carrier}"

    # Full resolve
    resolved = resolve_il(text)
    if resolved.get("canonical_name"):
        return resolved["canonical_name"]

    # Compact bracket notation fallback
    match = re.search(r"(\[[^\[\]]+?\]\s*(?:i\s*)?\[[^\[\]]+?\])", text)
    if match:
        return re.sub(r"\s+", "", match.group(1)).replace("]i[", "][")
    if len(text) > 80:
        return ""
    return text


def main():
    apply = "--apply" in sys.argv

    if not DB_PATH.exists():
        print(f"ERROR: Database not found at {DB_PATH}")
        sys.exit(1)

    conn = sqlite3.connect(str(DB_PATH))
    cur = conn.cursor()

    # Fetch distinct lubricant values and their record counts
    cur.execute(
        "SELECT lubricant, COUNT(*) AS cnt FROM tribology_data GROUP BY lubricant ORDER BY lubricant"
    )
    rows = cur.fetchall()

    print(f"Total distinct lubricant values: {len(rows)}\n")
    print(f"{'Count':>5} | {'Current':50} | {'Canonical'}")
    print("-" * 120)

    changes: list[tuple[str, str]] = []
    unchanged = 0

    for lubricant, count in rows:
        canonical = _canonicalize(lubricant)
        if canonical != lubricant:
            changes.append((lubricant, canonical))
            marker = " ***"
        else:
            unchanged += 1
            marker = ""

        print(f"{count:>5} | {lubricant:50} | {canonical}{marker}")

    print()
    print(f"Summary: {unchanged} unchanged, {len(changes)} to rename")

    if not changes:
        print("Nothing to do.")
        conn.close()
        return

    if not apply:
        print("\nDry-run complete. Run with --apply to apply changes.")
        conn.close()
        return

    print("\nApplying changes...")
    total_updated = 0
    for old_name, new_name in changes:
        # Update lubricant name
        cur.execute(
            "UPDATE tribology_data SET lubricant = ? WHERE lubricant = ?",
            (new_name, old_name),
        )
        affected = cur.rowcount
        total_updated += affected
        print(f"  {affected:>3} rows: {old_name!r} → {new_name!r}")

    # Also backfill cation/anion/SMILES for all records
    print("\nBackfilling chemistry fields...")
    cur.execute(
        "SELECT DISTINCT lubricant FROM tribology_data"
    )
    distinct_lubricants = [r[0] for r in cur.fetchall()]
    chemistry_updates = 0
    for lub in distinct_lubricants:
        resolved = resolve_il(lub)
        if not resolved.get("cation") and not resolved.get("anion"):
            continue
        updates = {}
        if resolved.get("cation"):
            cn = resolved.get("canonical_name") or ""
            cation_display = cn.split("][")[0].lstrip("[") if cn else resolved["cation"]
            updates["cation"] = cation_display
        if resolved.get("anion"):
            cn = resolved.get("canonical_name") or ""
            anion_display = cn.split("][")[-1].rstrip("]") if cn else resolved["anion"]
            updates["anion"] = anion_display
        if resolved.get("cation_smiles"):
            updates["cation_smiles"] = resolved["cation_smiles"]
        if resolved.get("anion_smiles"):
            updates["anion_smiles"] = resolved["anion_smiles"]
        if resolved.get("il_smiles"):
            updates["il_smiles"] = resolved["il_smiles"]
        if resolved.get("il_inchikey"):
            updates["il_inchikey"] = resolved["il_inchikey"]
        if resolved.get("alkyl_chain_length") is not None:
            updates["alkyl_chain_length"] = resolved["alkyl_chain_length"]

        if updates:
            set_clause = ", ".join(f"{k} = ?" for k in updates)
            values = list(updates.values()) + [lub]
            cur.execute(
                f"UPDATE tribology_data SET {set_clause} WHERE lubricant = ? AND cation IS NULL",
                values,
            )
            chemistry_updates += cur.rowcount

    conn.commit()
    print(f"\nDone! Updated {total_updated} lubricant names, backfilled {chemistry_updates} chemistry rows.")
    conn.close()


if __name__ == "__main__":
    main()
