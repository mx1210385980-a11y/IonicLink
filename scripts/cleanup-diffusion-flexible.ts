/**
 * One-off migration: apply flexible-layer normalization (merge / drop / rename,
 * see lib/diffusion/flexible.ts) to every diffusion record already in the
 * database. A consistent backup is written to data/backups/ first.
 *
 * Run: npx tsx scripts/cleanup-diffusion-flexible.ts
 */
import path from "node:path";
import Database from "better-sqlite3";
import { backupDomainDatabase } from "../lib/db";
import { normalizeFlexibleFields } from "../lib/diffusion/flexible";

const backup = backupDomainDatabase("diffusion");
console.log("backup:", backup ?? "(none — no existing db)");

const dbPath = path.resolve(process.env.IONICLINK_DATA_DIR || path.join(process.cwd(), "data"), "diffusion.db");
const db = new Database(dbPath);

const rows = db.prepare("SELECT id, payload FROM records").all() as { id: string; payload: string }[];
const update = db.prepare("UPDATE records SET payload = ? WHERE id = ?");

let changed = 0;
let merged = 0;
let dropped = 0;
let renamed = 0;

const tx = db.transaction(() => {
  for (const row of rows) {
    const record = JSON.parse(row.payload);
    const flexible = record.flexible;
    if (!Array.isArray(flexible) || flexible.length === 0) continue;

    const beforeKeys = flexible.map((field: { key: string }) => field.key);
    const extended = { ...(record.extended ?? {}) };
    const beforeExtended = JSON.stringify([extended.polarizable, extended.method, extended.concentration]);

    const cleaned = normalizeFlexibleFields(flexible, extended);
    const afterKeys = cleaned.map((field: { key: string }) => field.key);
    const afterExtended = JSON.stringify([extended.polarizable, extended.method, extended.concentration]);

    if (beforeExtended === afterExtended && JSON.stringify(beforeKeys) === JSON.stringify(afterKeys)) continue;

    merged += beforeExtended !== afterExtended ? 1 : 0;
    dropped += beforeKeys.length - afterKeys.length > 0 ? beforeKeys.length - afterKeys.length : 0;
    renamed += afterKeys.filter((key: string, i: number) => key !== beforeKeys[i]).length;

    record.flexible = cleaned;
    record.extended = extended;
    update.run(JSON.stringify(record), row.id);
    changed += 1;
  }
});
tx();

console.log(`records updated: ${changed} / ${rows.length}`);
console.log(`records with merged fields: ${merged}, flexible entries removed: ${dropped}, renamed: ${renamed}`);
db.close();
