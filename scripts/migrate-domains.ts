/**
 * One-time migration from the single-domain store to the per-domain layout:
 *   data/ioniclink.db   → data/tribology.db
 *   data/sources/<id>/  → data/tribology/sources/<id>/
 *
 * Idempotent — safe to re-run. Does nothing if data/tribology.db already exists,
 * and copies (not moves) the DB so the original ioniclink.db stays as a rollback.
 *
 * Run: npm run migrate   (or: npx tsx scripts/migrate-domains.ts)
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const DATA = path.join(process.cwd(), "data");
const OLD_DB = path.join(DATA, "ioniclink.db");
const NEW_DB = path.join(DATA, "tribology.db");
const OLD_SOURCES = path.join(DATA, "sources");
const NEW_SOURCES = path.join(DATA, "tribology", "sources");

function migrateDb(): void {
  if (existsSync(NEW_DB)) {
    console.log("• data/tribology.db already exists — skipping DB copy.");
    return;
  }
  if (!existsSync(OLD_DB)) {
    console.log("• No data/ioniclink.db found — nothing to migrate (fresh install).");
    return;
  }
  // Checkpoint the WAL so the main .db file is self-contained before copying.
  const db = new Database(OLD_DB);
  db.pragma("wal_checkpoint(TRUNCATE)");
  db.close();
  copyFileSync(OLD_DB, NEW_DB);
  console.log("✓ Copied data/ioniclink.db → data/tribology.db");
}

function migrateSources(): void {
  if (!existsSync(OLD_SOURCES)) {
    console.log("• No data/sources/ — skipping source move.");
    return;
  }
  mkdirSync(NEW_SOURCES, { recursive: true });
  let moved = 0;
  for (const entry of readdirSync(OLD_SOURCES)) {
    const to = path.join(NEW_SOURCES, entry);
    if (existsSync(to)) continue; // already migrated
    renameSync(path.join(OLD_SOURCES, entry), to);
    moved++;
  }
  console.log(`✓ Moved ${moved} source folder(s) → data/tribology/sources/`);
}

migrateDb();
migrateSources();
console.log("Migration complete.");
