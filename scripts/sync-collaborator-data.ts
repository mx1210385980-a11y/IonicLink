import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { commitDatasetImport, getDataDir, listRecords } from "../lib/db";
import { ingest } from "../lib/conductivity/ingest";
import type { ConductivityExtractedFields } from "../lib/conductivity/schema";
import { conductivityModule } from "../lib/modules/conductivity";

const commit = "04746b5a3ed36d6441753a9c5437d172496d87c1";
const files = ["electrochem-manual-audit.json", "conductivity-corpus-curated-audit.json"];
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
function stable(value: any): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).filter(key => value[key] !== undefined).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
function fingerprint(record: any): string {
  return sha(stable({ paper: record.paper.doi?.toLowerCase() || record.paper.title, core: record.core, extended: record.extended, flexible: record.flexible }));
}
function readRecords(file: string): any[] {
  if (!existsSync(file)) return [];
  const db = new Database(file, { readonly: true });
  try { return (db.prepare("SELECT payload FROM records").all() as { payload: string }[]).map(row => JSON.parse(row.payload)); }
  finally { db.close(); }
}
async function main() {
  const write = process.argv.includes("--write");
  const dbFile = path.join(getDataDir(), "conductivity.db");
  const before = readRecords(dbFile);
  const existing = new Set(before.map(fingerprint));
  const sourceFiles: { file: string; sha256: string; records: number }[] = [];
  const drafts: ReturnType<typeof ingest>[] = [];
  let duplicateRecords = 0;
  for (const file of files) {
    const raw = readFileSync(path.join("data/conductivity", file), "utf8").replace(/\r\n/g, "\n");
    const audit = JSON.parse(raw) as { papers: { doi?: string; records: ConductivityExtractedFields[] }[] };
    sourceFiles.push({ file, sha256: sha(raw), records: audit.papers.reduce((n, paper) => n + paper.records.length, 0) });
    for (const fields of audit.papers.flatMap(paper => paper.records.map(record => ({ ...record, paper: { ...record.paper, doi: record.paper.doi || paper.doi } })))) {
      const draft = ingest(fields);
      assert.ok(conductivityModule.acceptDraft!(draft), `${file}: missing target property`);
      assert.ok(draft.paper.title, `${file}: missing paper identity`);
      const key = fingerprint(draft);
      if (existing.has(key)) { duplicateRecords++; continue; }
      existing.add(key);
      drafts.push(draft);
    }
  }
  const report: Record<string, unknown> = {
    mode: write ? "import" : "dry-run", domain: "conductivity", database: dbFile,
    sourceCommit: commit, sourceFiles, before: before.length, available: sourceFiles.reduce((n, file) => n + file.records, 0),
    duplicateRecords, toImport: drafts.length, papers: new Set(drafts.map(record => record.paper.doi || record.paper.title)).size,
    destinationStatus: "review", sourcePdfsAvailable: false,
  };
  if (write && drafts.length) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupDir = path.join(getDataDir(), "backups", `collaborator-sync-${stamp}`);
    mkdirSync(backupDir, { recursive: true });
    for (const domain of ["conductivity", "diffusion"]) {
      const file = path.join(getDataDir(), `${domain}.db`);
      if (!existsSync(file)) continue;
      const db = new Database(file, { readonly: true });
      try { await db.backup(path.join(backupDir, `${domain}.db`)); }
      finally { db.close(); }
    }
    const result = commitDatasetImport("conductivity", {
      fingerprint: sha(stable({ sourceFiles, records: drafts.map(fingerprint) })),
      filename: "GitHub conductivity audited records", adapter: "collaborator-audit-v1", drafts,
      metadata: { sourceCommit: commit, sourceFiles, sourcePdfsAvailable: false, importedAs: "review" },
    });
    const after = listRecords("conductivity");
    assert.equal(result.recordCount, drafts.length);
    assert.equal(after.length, before.length + drafts.length);
    const stored = new Map(readRecords(dbFile).map(record => [record.id, record]));
    for (const record of before) assert.equal(stable(stored.get(record.id)), stable(record), `Existing record changed: ${record.id}`);
    report.imported = result.recordCount;
    report.recordIds = result.recordIds;
    report.after = after.length;
    report.backup = backupDir;
    report.integrityCheck = (() => { const db = new Database(dbFile, { readonly: true }); try { return db.pragma("integrity_check", { simple: true }); } finally { db.close(); } })();
    writeFileSync(path.join(backupDir, "receipt.json"), JSON.stringify(report, null, 2));
  }
  console.log(JSON.stringify(report, null, 2));
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
