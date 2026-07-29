/**
 * Backfill tribology surface descriptors into existing records.
 *
 * Run:
 *   npx tsx scripts/backfill-surface-descriptors.ts --dry
 *   npx tsx scripts/backfill-surface-descriptors.ts
 */
import Database from "better-sqlite3";
import path from "node:path";
import { applySurfaceDescriptorsToRecord } from "../lib/surfaceDescriptors";

const dry = process.argv.includes("--dry");
const dbPath = path.join(process.cwd(), "data", "tribology.db");
const db = new Database(dbPath);

const rows = db
  .prepare("SELECT id, status, payload FROM records ORDER BY created_at ASC, id ASC")
  .all() as { id: string; status: string; payload: string }[];

const updates: { id: string; status: string; payload: string }[] = [];
for (const row of rows) {
  const current = JSON.parse(row.payload);
  const next = applySurfaceDescriptorsToRecord(current);
  const payload = JSON.stringify(next);
  if (payload !== row.payload) updates.push({ id: row.id, status: row.status, payload });
}

if (!dry && updates.length > 0) {
  const stmt = db.prepare("UPDATE records SET payload = @payload WHERE id = @id");
  const tx = db.transaction((items: typeof updates) => {
    for (const item of items) stmt.run(item);
  });
  tx(updates);
}

const byStatus = updates.reduce<Record<string, number>>((acc, item) => {
  acc[item.status] = (acc[item.status] ?? 0) + 1;
  return acc;
}, {});

console.log(
  JSON.stringify(
    {
      dry,
      scanned: rows.length,
      updated: updates.length,
      byStatus,
    },
    null,
    2
  )
);
