"""
Script to clean up non-ionic lubricants from the tribology_data table.

This script:
1. Connects to the SQLite database
2. Identifies records with non-ionic lubricants
3. Shows a summary of what will be deleted
4. Deletes those records (with confirmation)
5. Reorders remaining IDs sequentially
6. Provides a summary of the cleanup
"""

import sqlite3
import sys
from typing import List, Tuple


# List of common non-ionic lubricants to filter out
NON_IONIC_LUBRICANTS = [
    "pao",
    "mineral oil",
    "grease",
    "water",
    "glycerol",
    "hexadecane",
    "base oil",
    "paraffin",
    "polyalphaolefin",
    "poly alpha olefin",
    "synthetic oil",
    "engine oil",
    "motor oil",
    "hydraulic oil",
    "silicone oil",
    "vegetable oil",
    "castor oil",
    "olive oil",
    "soybean oil",
    "rapeseed oil",
    "canola oil",
    "palm oil",
    "coconut oil",
    "ester",
    "polyol ester",
    "trimethylolpropane",
    "pentaerythritol",
    "polyglycol",
    "polyethylene glycol",
    "peg",
    "polypropylene glycol",
    "ppg",
    "perfluoropolyether",
    "pfpe",
    "krytox",
    "fomblin",
    "demnum",
    "polytetrafluoroethylene",
    "ptfe",
    "teflon",
    "molybdenum disulfide",
    "mos2",
    "graphite",
    "graphene",
    "carbon nanotube",
    "cnt",
    "fullerene",
    "diamond-like carbon",
    "dlc",
    "tungsten disulfide",
    "ws2",
    "boron nitride",
    "bn",
    "dry",
    "air",
    "nitrogen",
    "argon",
    "vacuum",
    "no lubricant",
    "unlubricated",
]


def connect_to_db(db_path: str) -> sqlite3.Connection:
    """Connect to the SQLite database."""
    try:
        conn = sqlite3.connect(db_path)
        conn.row_factory = sqlite3.Row
        return conn
    except sqlite3.Error as e:
        print(f"Error connecting to database: {e}")
        sys.exit(1)


def find_non_ionic_records(conn: sqlite3.Connection) -> List[Tuple]:
    """Find records with non-ionic lubricants."""
    cursor = conn.cursor()

    # Build the WHERE clause to match any non-ionic lubricant
    conditions = " OR ".join([f"LOWER(lubricant) LIKE '%{term}%'" for term in NON_IONIC_LUBRICANTS])

    query = f"""
    SELECT id, lubricant, material_name, cof_value, literature_id
    FROM tribology_data
    WHERE {conditions}
    ORDER BY id
    """

    cursor.execute(query)
    return cursor.fetchall()


def get_total_count(conn: sqlite3.Connection) -> int:
    """Get total number of records in tribology_data."""
    cursor = conn.cursor()
    cursor.execute("SELECT COUNT(*) FROM tribology_data")
    return cursor.fetchone()[0]


def display_summary(records: List[Tuple], total_count: int):
    """Display a summary of records to be deleted."""
    print("\n" + "="*80)
    print("NON-IONIC LUBRICANT CLEANUP SUMMARY")
    print("="*80)
    print(f"\nTotal records in database: {total_count}")
    print(f"Records to be deleted: {len(records)}")
    print(f"Records to remain: {total_count - len(records)}")
    print(f"Percentage to be deleted: {len(records)/total_count*100:.1f}%")

    if records:
        print("\n" + "-"*80)
        print("SAMPLE OF RECORDS TO BE DELETED (first 20):")
        print("-"*80)
        print(f"{'ID':<8} {'Lubricant':<40} {'Material':<30}")
        print("-"*80)

        for record in records[:20]:
            lubricant = record[1][:38] + ".." if len(record[1]) > 40 else record[1]
            material = record[2][:28] + ".." if len(record[2]) > 30 else record[2]
            print(f"{record[0]:<8} {lubricant:<40} {material:<30}")

        if len(records) > 20:
            print(f"\n... and {len(records) - 20} more records")

        # Show lubricant distribution
        print("\n" + "-"*80)
        print("LUBRICANT DISTRIBUTION (top 15):")
        print("-"*80)

        lubricant_counts = {}
        for record in records:
            lub = record[1].lower()
            lubricant_counts[lub] = lubricant_counts.get(lub, 0) + 1

        sorted_lubricants = sorted(lubricant_counts.items(), key=lambda x: x[1], reverse=True)
        for lub, count in sorted_lubricants[:15]:
            print(f"  {lub:<50} {count:>5} records")

        if len(sorted_lubricants) > 15:
            print(f"\n... and {len(sorted_lubricants) - 15} more unique lubricants")


def delete_records(conn: sqlite3.Connection, record_ids: List[int]) -> int:
    """Delete records by their IDs."""
    cursor = conn.cursor()

    # Delete in batches to avoid SQL length limits
    batch_size = 500
    total_deleted = 0

    for i in range(0, len(record_ids), batch_size):
        batch = record_ids[i:i + batch_size]
        placeholders = ",".join(["?"] * len(batch))
        query = f"DELETE FROM tribology_data WHERE id IN ({placeholders})"
        cursor.execute(query, batch)
        total_deleted += cursor.rowcount

    conn.commit()
    return total_deleted


def reorder_ids(conn: sqlite3.Connection):
    """Reorder remaining IDs sequentially starting from 1."""
    cursor = conn.cursor()

    # Get all remaining records ordered by current ID
    cursor.execute("SELECT id FROM tribology_data ORDER BY id")
    old_ids = [row[0] for row in cursor.fetchall()]

    if not old_ids:
        print("\nNo records remaining to reorder.")
        return

    # Create a temporary table with new sequential IDs
    cursor.execute("""
        CREATE TEMPORARY TABLE temp_id_mapping (
            old_id INTEGER PRIMARY KEY,
            new_id INTEGER
        )
    """)

    # Insert mapping
    for new_id, old_id in enumerate(old_ids, start=1):
        cursor.execute("INSERT INTO temp_id_mapping (old_id, new_id) VALUES (?, ?)", (old_id, new_id))

    # Update IDs using the mapping
    # First, shift all IDs to negative to avoid conflicts
    cursor.execute("UPDATE tribology_data SET id = -id")

    # Then update to new sequential IDs
    cursor.execute("""
        UPDATE tribology_data
        SET id = (SELECT new_id FROM temp_id_mapping WHERE old_id = -tribology_data.id)
    """)

    # Drop temporary table
    cursor.execute("DROP TABLE temp_id_mapping")

    # Reset the autoincrement counter
    max_id = max(old_ids) if old_ids else 0
    new_max_id = len(old_ids)
    cursor.execute(f"UPDATE sqlite_sequence SET seq = {new_max_id} WHERE name = 'tribology_data'")

    conn.commit()
    print(f"\nReordered {len(old_ids)} records with sequential IDs from 1 to {new_max_id}")


def main():
    """Main execution function."""
    db_path = "data/ioniclink.db"

    print("IonicLink Database Cleanup Tool")
    print("="*80)
    print(f"\nConnecting to database: {db_path}")

    conn = connect_to_db(db_path)

    try:
        # Get total count
        total_count = get_total_count(conn)

        if total_count == 0:
            print("\nDatabase is empty. Nothing to clean up.")
            return

        # Find non-ionic records
        print("\nScanning for non-ionic lubricants...")
        non_ionic_records = find_non_ionic_records(conn)

        # Display summary
        display_summary(non_ionic_records, total_count)

        if not non_ionic_records:
            print("\nNo non-ionic lubricants found. Database is clean!")
            return

        # Ask for confirmation
        print("\n" + "="*80)
        response = input("\nDo you want to proceed with deletion? (yes/no): ").strip().lower()

        if response not in ["yes", "y"]:
            print("\nOperation cancelled. No changes made to the database.")
            return

        # Delete records
        print("\nDeleting records...")
        record_ids = [record[0] for record in non_ionic_records]
        deleted_count = delete_records(conn, record_ids)
        print(f"Successfully deleted {deleted_count} records.")

        # Reorder IDs
        print("\nReordering remaining IDs...")
        reorder_ids(conn)

        # Final summary
        remaining_count = get_total_count(conn)
        print("\n" + "="*80)
        print("CLEANUP COMPLETE")
        print("="*80)
        print(f"Records deleted: {deleted_count}")
        print(f"Records remaining: {remaining_count}")
        print(f"IDs reordered: 1 to {remaining_count}")
        print("\nDatabase cleanup successful!")

    except Exception as e:
        print(f"\nError during cleanup: {e}")
        conn.rollback()
        sys.exit(1)

    finally:
        conn.close()


if __name__ == "__main__":
    main()
