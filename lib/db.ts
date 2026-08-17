import Database from "better-sqlite3";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { Domain, DomainDraft, DomainRecord } from "./domain";
import type {
  BatchJob,
  FieldProvenance,
  JobEvent,
  JobHistorySummary,
  JobStatus,
  RecordStatus,
  SourceDoc,
} from "./schema";
import { extractDoiFromPages, normalizeDoi } from "./doi";
import { summarizeJobEvents } from "./jobHistory";
import { getModule } from "./modules/registry.server";
import { parseQuantity, ROOM_TEMPERATURE_RAW, type Dimension, type Quantity } from "./units";
import { standardizeSubstrate } from "./substrates";
import { applySurfaceDescriptorsToRecord } from "./surfaceDescriptors";
import { recordStructureKey } from "./structureSearch.server";
import type { ExactStructureFilter } from "./structureSearch";

/** JSON-safe provenance patch; `null` explicitly removes a persisted crop. */
export type FieldProvenancePatch = Omit<FieldProvenance, "figureBox"> & {
  figureBox?: FieldProvenance["figureBox"] | null;
};

/**
 * SQLite-backed store, ONE database file per domain (`data/<domain>.db`). The
 * full three-layer record lives in a JSON `payload` column (so the schema can
 * evolve without migrations); a few shared columns plus the module's promoted
 * columns keep listing, filtering, and comparison fast.
 *
 * Isolation: every exported function takes `domain` as its first argument and
 * operates ONLY on that domain's file. The per-domain handle/id-sequence caches
 * below are keyed by domain — there is no shared state across domains, so a
 * conductivity record can never appear in a tribology query.
 */

type AnyRecord = DomainRecord<any, any>;
type AnyDraft = DomainDraft<any, any>;

const DATA_DIR = path.resolve(process.env.IONICLINK_DATA_DIR || path.join(process.cwd(), "data"));
export const getDataDir = () => DATA_DIR;
const dbPath = (domain: Domain) => path.join(DATA_DIR, `${domain}.db`);

const _dbs = new Map<Domain, Database.Database>();
const _counters = new Map<Domain, number>();

/** Columns present for every domain. The rest come from `module.promotedColumns`. */
const SHARED_COLUMNS = [
  "id",
  "status",
  "paper_title",
  "cation",
  "anion",
  "cation_structure_key",
  "anion_structure_key",
  "created_at",
  "payload",
];

const JOBS_DDL = `
    CREATE TABLE IF NOT EXISTS jobs (
      id          TEXT PRIMARY KEY,
      status      TEXT NOT NULL,
      filename    TEXT NOT NULL,
      created_at  TEXT NOT NULL,
      text        TEXT,          -- extracted source text (internal)
      payload     TEXT NOT NULL  -- BatchJob JSON (no text)
    );
    CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
    CREATE TABLE IF NOT EXISTS job_events (
      event_id     INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id       TEXT NOT NULL,
      status       TEXT NOT NULL,
      occurred_at  TEXT NOT NULL,
      record_count INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_job_events_job_id ON job_events(job_id, event_id);
`;

const SOURCES_DDL = `
    CREATE TABLE IF NOT EXISTS sources (
      id          TEXT PRIMARY KEY,
      filename    TEXT NOT NULL,
      page_count  INTEGER NOT NULL,
      created_at  TEXT NOT NULL,
      payload     TEXT NOT NULL  -- SourceDoc JSON (per-page text)
    );
`;

const DATASET_IMPORTS_DDL = `
    CREATE TABLE IF NOT EXISTS dataset_imports (
      fingerprint  TEXT PRIMARY KEY,
      filename     TEXT NOT NULL,
      adapter      TEXT NOT NULL,
      created_at   TEXT NOT NULL,
      record_count INTEGER NOT NULL,
      payload      TEXT NOT NULL
    );
`;

function getDb(domain: Domain): Database.Database {
  const cached = _dbs.get(domain);
  if (cached) return cached;
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  const db = new Database(dbPath(domain));
  db.pragma("journal_mode = WAL");
  const mod = getModule(domain);
  const promoted = mod.promotedColumns.map((c) => `${c.name} ${c.type}`).join(",\n      ");
  db.exec(`
    CREATE TABLE IF NOT EXISTS records (
      id           TEXT PRIMARY KEY,
      status       TEXT NOT NULL,
      paper_title  TEXT NOT NULL,
      cation       TEXT NOT NULL,
      anion        TEXT NOT NULL,
      cation_structure_key TEXT,
      anion_structure_key  TEXT,
      ${promoted ? promoted + "," : ""}
      created_at   TEXT NOT NULL,
      payload      TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_records_status ON records(status);
    ${JOBS_DDL}
    ${SOURCES_DDL}
    ${DATASET_IMPORTS_DDL}
  `);
  // Promoted columns evolve with the module (diffusion gained system_name /
  // pore_size_m) — add any that an existing DB is missing. Values backfill
  // lazily: each row rewrite re-derives them from the payload.
  const existing = new Set(
    (db.prepare("PRAGMA table_info(records)").all() as { name: string }[]).map((c) => c.name)
  );
  for (const c of mod.promotedColumns) {
    if (!existing.has(c.name)) db.exec(`ALTER TABLE records ADD COLUMN ${c.name} ${c.type}`);
  }
  let needsStructureBackfill = false;
  if (!existing.has("cation_structure_key")) {
    db.exec("ALTER TABLE records ADD COLUMN cation_structure_key TEXT");
    needsStructureBackfill = true;
  }
  if (!existing.has("anion_structure_key")) {
    db.exec("ALTER TABLE records ADD COLUMN anion_structure_key TEXT");
    needsStructureBackfill = true;
  }
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_records_cation_structure
      ON records(cation_structure_key, status)
      WHERE cation_structure_key IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_records_anion_structure
      ON records(anion_structure_key, status)
      WHERE anion_structure_key IS NOT NULL;
  `);
  _dbs.set(domain, db);
  if (needsStructureBackfill) backfillStructureKeys(domain);
  return db;
}

function rowToRecord(domain: Domain, row: { payload: string }, db?: Database.Database): AnyRecord {
  return normalizeLegacyRecord(domain, JSON.parse(row.payload) as AnyRecord, db);
}

function normalizeLegacyRecord(domain: Domain, rec: AnyRecord, db?: Database.Database): AnyRecord {
  let next = normalizeLegacyTemperature(rec);
  next = normalizeLegacyQuantities(domain, next);
  next = normalizeLegacySubstrate(domain, next);
  next = normalizeLegacySurface(domain, next);
  if (db) next = backfillTemperatureProvenance(db, next);
  return next;
}

type QuantityPath = {
  section: "core" | "extended";
  key: string;
  dim: Dimension;
};

const LEGACY_QUANTITY_PATHS: Record<Domain, QuantityPath[]> = {
  tribology: [
    { section: "core", key: "temperature", dim: "temperature" },
    { section: "core", key: "load", dim: "force" },
    { section: "extended", key: "velocity", dim: "velocity" },
    { section: "extended", key: "potential", dim: "potential" },
    { section: "extended", key: "roughness", dim: "length" },
  ],
  conductivity: [
    { section: "core", key: "temperature", dim: "temperature" },
    { section: "core", key: "conductivity", dim: "conductivity" },
    { section: "extended", key: "viscosity", dim: "viscosity" },
  ],
  diffusion: [
    { section: "core", key: "temperature", dim: "temperature" },
    { section: "core", key: "diffusion", dim: "diffusion" },
    { section: "extended", key: "viscosity", dim: "viscosity" },
  ],
};

function normalizeLegacyQuantities(domain: Domain, rec: AnyRecord): AnyRecord {
  let next = rec;
  for (const { section, key, dim } of LEGACY_QUANTITY_PATHS[domain]) {
    const group = next[section] as Record<string, unknown> | undefined;
    const current = group?.[key] as Partial<Quantity> | null | undefined;
    const raw = typeof current?.raw === "string" ? current.raw.trim() : "";
    if (!raw) continue;

    const normalized = parseQuantity(raw, dim);
    if (!normalized) continue;

    next = {
      ...next,
      [section]: {
        ...next[section],
        [key]: normalized,
      },
    };
  }
  return next;
}

function normalizeLegacySubstrate(domain: Domain, rec: AnyRecord): AnyRecord {
  if (domain !== "tribology") return rec;
  const current = rec.core?.substrate;
  if (typeof current !== "string") return rec;
  const normalized = standardizeSubstrate(current, rec.provenance?.substrate);
  if (normalized === current) return rec;

  return {
    ...rec,
    core: {
      ...rec.core,
      substrate: normalized,
    },
  };
}

function normalizeLegacySurface(domain: Domain, rec: AnyRecord): AnyRecord {
  return domain === "tribology" ? applySurfaceDescriptorsToRecord(rec) : rec;
}

function normalizeLegacyTemperature(rec: AnyRecord): AnyRecord {
  const temp = rec.core?.temperature;
  const rawUsed = temp?.raw?.trim() || ROOM_TEMPERATURE_RAW;
  const normalized = parseQuantity(rawUsed, "temperature");
  if (!normalized || normalized.value == null) return rec;

  const next: AnyRecord = {
    ...rec,
    core: {
      ...rec.core,
      temperature: normalized,
    },
  };
  // A digit-less temperature ("not stated", "room temperature", "ambient
  // conditions", or an empty field) is a convention, not a reported value — label it "assumed" so
  // it can't read as located evidence.
  if (!/\d/.test(rawUsed) && !next.provenance?.temperature) {
    next.provenance = {
      ...next.provenance,
      temperature: {
        basis: "assumed",
        basisNote: `no explicit value — "${rawUsed}" recorded as ${normalized.value} K by convention`,
      },
    };
  }
  return next;
}

function backfillTemperatureProvenance(db: Database.Database, rec: AnyRecord): AnyRecord {
  if (rec.provenance?.temperature || !rec.sourceId || !rec.core?.temperature?.raw?.trim()) return rec;

  const inferred = inferTemperatureProvenance(db, rec.sourceId, rec.core.temperature.raw);
  if (!inferred) return rec;

  return {
    ...rec,
    provenance: {
      ...rec.provenance,
      temperature: inferred,
    },
  };
}

function inferTemperatureProvenance(
  db: Database.Database,
  sourceId: string,
  rawTemperature: string
): FieldProvenance | null {
  const row = db.prepare("SELECT payload FROM sources WHERE id = ?").get(sourceId) as { payload: string } | undefined;
  if (!row) return null;

  const source = JSON.parse(row.payload) as SourceDoc;
  const patterns = temperatureSearchPatterns(rawTemperature);
  for (const page of source.pages) {
    for (const pattern of patterns) {
      const match = pattern.exec(page.text);
      if (!match || match.index == null) continue;
      // A text-search hit proves the value appears in the paper, NOT that the
      // sentence refers to this measurement — never stronger than "inferred".
      return {
        page: page.page,
        quote: quoteAround(page.text, match.index, match[0].length),
        basis: "inferred",
        basisNote: "auto-matched in source text — verify the quoted context applies to this measurement",
      };
    }
  }
  return null;
}

function temperatureSearchPatterns(rawTemperature: string): RegExp[] {
  const raw = rawTemperature.trim();
  const escapedRaw = escapeRegExp(raw).replace(/\s+/g, "\\s+");
  const patterns = [new RegExp(escapedRaw, "i")];
  const parsed = parseQuantity(raw, "temperature");
  if (parsed?.value != null) {
    const value = escapeRegExp(String(parsed.value));
    const unit =
      parsed.unit === "°C"
        ? "(?:°\\s*C|C|℃|摄氏度|摄氏)"
        : parsed.unit === "°F"
          ? "(?:°\\s*F|F)"
          : "K";
    patterns.push(new RegExp(`${value}\\s*(?:±|\\+/-|\\+-)\\s*\\d+(?:\\.\\d+)?\\s*${unit}`, "i"));
    patterns.push(new RegExp(`${value}\\s*${unit}`, "i"));
  }
  return patterns;
}

function quoteAround(text: string, index: number, length: number): string {
  const start = Math.max(0, index - 90);
  const end = Math.min(text.length, index + length + 90);
  return text.slice(start, end).replace(/\s+/g, " ").trim();
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function nextId(domain: Domain, db: Database.Database): string {
  let counter = _counters.get(domain);
  if (counter == null) {
    const row = db.prepare("SELECT id FROM records ORDER BY id DESC LIMIT 1").get() as
      | { id: string }
      | undefined;
    counter = row ? parseInt(row.id.replace(/\D/g, ""), 10) || 0 : 0;
  }
  counter += 1;
  _counters.set(domain, counter);
  return "#" + String(counter).padStart(3, "0");
}

export interface ListOptions {
  status?: RecordStatus;
  search?: string;
  /** Secondary filter; applied via the module's `facet` (tribology: scale; conductivity: method). */
  facet?: string;
  /** Restrict to one source paper (exact `paper_title` match). */
  paper?: string;
  /** Exact canonical molecular identity for one ion position. */
  structure?: ExactStructureFilter;
}

export function listRecords(domain: Domain, opts: ListOptions = {}): AnyRecord[] {
  const db = getDb(domain);
  const mod = getModule(domain);
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (opts.status) {
    clauses.push("status = ?");
    params.push(opts.status);
  }
  if (opts.facet && mod.facet && mod.facet.values.includes(opts.facet)) {
    clauses.push(`${mod.facet.column} = ?`);
    params.push(opts.facet);
  }
  if (opts.paper) {
    clauses.push("paper_title = ?");
    params.push(opts.paper);
  }
  if (opts.search) {
    const cols = mod.searchColumns;
    clauses.push("(" + cols.map((c) => `${c} LIKE ?`).join(" OR ") + ")");
    const q = `%${opts.search}%`;
    for (let i = 0; i < cols.length; i++) params.push(q);
  }
  if (opts.structure) {
    if (opts.structure.target === "cation") {
      clauses.push("cation_structure_key = ?");
      params.push(opts.structure.key);
    } else if (opts.structure.target === "anion") {
      clauses.push("anion_structure_key = ?");
      params.push(opts.structure.key);
    } else {
      clauses.push("(cation_structure_key = ? OR anion_structure_key = ?)");
      params.push(opts.structure.key, opts.structure.key);
    }
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = db
    .prepare(`SELECT payload FROM records ${where} ORDER BY created_at ASC, id ASC`)
    .all(...params) as { payload: string }[];
  return rows.map((row) => rowToRecord(domain, row, db));
}

/**
 * Distinct source papers (with record counts) for one queue, in the same
 * creation order as the record list — feeds the database view's source filter.
 */
export function listPapers(domain: Domain, status?: RecordStatus): { title: string; n: number }[] {
  const db = getDb(domain);
  const where = status ? "WHERE status = ?" : "";
  return db
    .prepare(
      `SELECT paper_title AS title, COUNT(*) AS n FROM records ${where}
       GROUP BY paper_title ORDER BY MIN(created_at) ASC, MIN(id) ASC`
    )
    .all(...(status ? [status] : [])) as { title: string; n: number }[];
}

export function countByStatus(domain: Domain): { official: number; review: number } {
  const db = getDb(domain);
  const rows = db
    .prepare("SELECT status, COUNT(*) as n FROM records GROUP BY status")
    .all() as { status: RecordStatus; n: number }[];
  const out = { official: 0, review: 0 };
  for (const r of rows) out[r.status] = r.n;
  return out;
}

export function getRecord(domain: Domain, id: string): AnyRecord | null {
  const db = getDb(domain);
  const row = db.prepare("SELECT payload FROM records WHERE id = ?").get(id) as
    | { payload: string }
    | undefined;
  return row ? rowToRecord(domain, row, db) : null;
}

function write(db: Database.Database, domain: Domain, rec: AnyRecord): void {
  const mod = getModule(domain);
  const cols = [...SHARED_COLUMNS, ...mod.promotedColumns.map((c) => c.name)];
  const params: Record<string, unknown> = {
    id: rec.id,
    status: rec.status,
    paper_title: rec.paper.title,
    cation: rec.core.ionicLiquid.cation,
    anion: rec.core.ionicLiquid.anion,
    cation_structure_key: recordStructureKey(rec, "cation"),
    anion_structure_key: recordStructureKey(rec, "anion"),
    created_at: rec.createdAt,
    payload: JSON.stringify(rec),
  };
  for (const c of mod.promotedColumns) params[c.name] = c.get(rec);
  db.prepare(
    `INSERT OR REPLACE INTO records (${cols.join(", ")}) VALUES (${cols.map((c) => "@" + c).join(", ")})`
  ).run(params);
}

/** Create already-ingested record drafts. Defaults to the review queue. */
export function createRecords(
  domain: Domain,
  drafts: AnyDraft[],
  status: RecordStatus = "review",
  createdAt = new Date().toISOString()
): AnyRecord[] {
  const db = getDb(domain);
  const mod = getModule(domain);
  if (status === "official") {
    const mockIndices = drafts
      .map((draft, i) => (draft.extraction?.source === "mock" ? i : -1))
      .filter((i) => i >= 0);
    if (mockIndices.length) {
      throw new Error(
        `Cannot create checked records from mock extraction: ${mockIndices
          .map((i) => `#${i + 1}`)
          .join(", ")}. Re-extract with a live model or enter the records manually.`
      );
    }
    const bad = drafts
      .map((draft, i) => ({ i, missing: mod.coreCompleteness(draft).missing }))
      .filter((row) => row.missing.length);
    if (bad.length) {
      const details = bad.map((row) => `#${row.i + 1}: ${row.missing.join(", ")}`).join("; ");
      throw new Error(`Cannot create checked records — missing core fields: ${details}`);
    }
  }
  const made: AnyRecord[] = [];
  const tx = db.transaction(() => {
    for (const d of drafts) {
      const rec: AnyRecord = { ...d, id: nextId(domain, db), status, createdAt };
      write(db, domain, rec);
      made.push(rec);
    }
  });
  tx();
  return made;
}

export interface DatasetImportCommitResult {
  alreadyCommitted: boolean;
  recordIds: string[];
  recordCount: number;
}

/**
 * Atomically commit one adapted dataset and its idempotency receipt. A retry
 * with the same file fingerprint returns the first result without new rows.
 */
export function commitDatasetImport(
  domain: Domain,
  input: {
    fingerprint: string;
    filename: string;
    adapter: string;
    drafts: AnyDraft[];
    metadata?: Record<string, unknown>;
  }
): DatasetImportCommitResult {
  const db = getDb(domain);
  const tx = db.transaction(() => {
    const existing = db
      .prepare("SELECT record_count, payload FROM dataset_imports WHERE fingerprint = ?")
      .get(input.fingerprint) as { record_count: number; payload: string } | undefined;
    if (existing) {
      const payload = JSON.parse(existing.payload) as { recordIds?: string[] };
      return {
        alreadyCommitted: true,
        recordIds: payload.recordIds ?? [],
        recordCount: existing.record_count,
      };
    }

    const createdAt = new Date().toISOString();
    const records: AnyRecord[] = [];
    for (const draft of input.drafts) {
      const record: AnyRecord = {
        ...draft,
        id: nextId(domain, db),
        status: "review",
        createdAt,
      };
      write(db, domain, record);
      records.push(record);
    }
    const recordIds = records.map((record) => record.id);
    db.prepare(
      `INSERT INTO dataset_imports
       (fingerprint, filename, adapter, created_at, record_count, payload)
       VALUES (@fingerprint, @filename, @adapter, @created_at, @record_count, @payload)`
    ).run({
      fingerprint: input.fingerprint,
      filename: input.filename,
      adapter: input.adapter,
      created_at: createdAt,
      record_count: records.length,
      payload: JSON.stringify({ recordIds, metadata: input.metadata ?? {} }),
    });
    return { alreadyCommitted: false, recordIds, recordCount: records.length };
  });
  return tx();
}

export interface UpdateResult {
  record?: AnyRecord;
  error?: string;
  status?: number;
}

/**
 * Update a record. `fields` re-ingests the content (re-standardizing units via
 * the domain's ingest); `status` changes the queue — promotion to "official" is
 * gated on the domain's core-completeness rule.
 */
export function updateRecord(
  domain: Domain,
  id: string,
  patch: {
    fields?: any;
    status?: RecordStatus;
    setProvenance?: { field: string; prov: FieldProvenancePatch };
  }
): UpdateResult {
  const db = getDb(domain);
  const mod = getModule(domain);
  const current = getRecord(domain, id);
  if (!current) return { error: "Record not found", status: 404 };

  let next: AnyRecord = current;
  if (patch.fields) {
    const draft = mod.ingest(patch.fields);
    next = {
      ...draft,
      id: current.id,
      status: current.status,
      createdAt: current.createdAt,
      sourceId: current.sourceId, // preserve link to the source document
      extraction: current.extraction, // preserve extractor provenance across curator edits
    };
  }
  if (patch.setProvenance) {
    const { field, prov } = patch.setProvenance;
    const { figureBox, ...rest } = prov;
    const nextFieldProvenance: FieldProvenance = { ...next.provenance?.[field], ...rest };
    if (figureBox === null) delete nextFieldProvenance.figureBox;
    else if (figureBox !== undefined) nextFieldProvenance.figureBox = figureBox;
    next = { ...next, provenance: { ...next.provenance, [field]: nextFieldProvenance } };
  }
  if (patch.status && patch.status !== next.status) {
    if (patch.status === "official") {
      if (next.extraction?.source === "mock") {
        return {
          error: "Cannot approve a mock-extracted record; re-extract it with a live model or enter it manually.",
          status: 422,
        };
      }
      const { complete, missing } = mod.coreCompleteness(next);
      if (!complete) {
        return { error: `Cannot approve — missing core fields: ${missing.join(", ")}`, status: 422 };
      }
    }
    next = { ...next, status: patch.status };
  }
  write(db, domain, next);
  return { record: next };
}

export function deleteRecords(domain: Domain, ids: string[]): number {
  if (ids.length === 0) return 0;
  const db = getDb(domain);
  const stmt = db.prepare("DELETE FROM records WHERE id = ?");
  const tx = db.transaction((list: string[]) => {
    let n = 0;
    for (const id of list) n += stmt.run(id).changes;
    return n;
  });
  return tx(ids);
}

/** Test/seed helper — wipe one domain's records and reset its id counter. */
export function resetAll(domain: Domain): void {
  const db = getDb(domain);
  db.exec("DELETE FROM records; DELETE FROM dataset_imports;");
  _counters.delete(domain);
}

/** Create a consistent SQLite snapshot before an intentional destructive reset. */
export function backupDomainDatabase(domain: Domain): string | null {
  const source = dbPath(domain);
  if (!existsSync(source)) return null;

  const cached = _dbs.get(domain);
  if (cached) {
    cached.pragma("wal_checkpoint(TRUNCATE)");
  } else {
    const snapshotDb = new Database(source);
    snapshotDb.pragma("wal_checkpoint(TRUNCATE)");
    snapshotDb.close();
  }
  const backupDir = path.join(DATA_DIR, "backups");
  mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const target = path.join(backupDir, `${domain}-${stamp}-${randomUUID().slice(0, 8)}.db`);
  copyFileSync(source, target);
  return target;
}

export interface StructureKeyBackfillResult {
  total: number;
  updated: number;
  cationIndexed: number;
  anionIndexed: number;
  unindexed: { id: string; kind: "cation" | "anion" }[];
}

/** Idempotently derive exact-search keys from payload SMILES or known ion labels. */
export function backfillStructureKeys(domain: Domain): StructureKeyBackfillResult {
  const db = getDb(domain);
  const rows = db
    .prepare("SELECT id, payload, cation_structure_key, anion_structure_key FROM records ORDER BY id")
    .all() as {
      id: string;
      payload: string;
      cation_structure_key: string | null;
      anion_structure_key: string | null;
    }[];
  const update = db.prepare(
    "UPDATE records SET cation_structure_key = ?, anion_structure_key = ? WHERE id = ?"
  );
  let updated = 0;
  let cationIndexed = 0;
  let anionIndexed = 0;
  const unindexed: StructureKeyBackfillResult["unindexed"] = [];

  const tx = db.transaction(() => {
    for (const row of rows) {
      const record = rowToRecord(domain, row, db);
      const cationKey = recordStructureKey(record, "cation");
      const anionKey = recordStructureKey(record, "anion");
      if (cationKey) cationIndexed += 1;
      else unindexed.push({ id: row.id, kind: "cation" });
      if (anionKey) anionIndexed += 1;
      else unindexed.push({ id: row.id, kind: "anion" });
      if (cationKey !== row.cation_structure_key || anionKey !== row.anion_structure_key) {
        update.run(cationKey, anionKey, row.id);
        updated += 1;
      }
    }
  });
  tx();

  return { total: rows.length, updated, cationIndexed, anionIndexed, unindexed };
}

/* ------------------------------------------------------------------ */
/* Batch jobs — server-side PDF upload queue (per domain).             */
/* ------------------------------------------------------------------ */

function writeJob(db: Database.Database, job: BatchJob, text?: string): void {
  db.prepare(
    `INSERT OR REPLACE INTO jobs (id, status, filename, created_at, text, payload)
     VALUES (@id, @status, @filename, @created_at,
             COALESCE(@text, (SELECT text FROM jobs WHERE id = @id)), @payload)`
  ).run({
    id: job.id,
    status: job.status,
    filename: job.filename,
    created_at: job.createdAt,
    text: text ?? null,
    payload: JSON.stringify(job),
  });
}

function appendJobEvent(db: Database.Database, job: BatchJob, occurredAt: string): void {
  db.prepare(
    `INSERT INTO job_events (job_id, status, occurred_at, record_count)
     VALUES (@job_id, @status, @occurred_at, @record_count)`
  ).run({
    job_id: job.id,
    status: job.status,
    occurred_at: occurredAt,
    record_count: job.recordCount,
  });
}

/** Enqueue uploaded files (text already extracted). Returns the queued jobs. */
export function createJobs(
  domain: Domain,
  items: { filename: string; text: string; sourceId?: string }[]
): BatchJob[] {
  const db = getDb(domain);
  const now = new Date().toISOString();
  const made: BatchJob[] = [];
  const tx = db.transaction(() => {
    for (const it of items) {
      const job: BatchJob = {
        id: randomUUID(),
        filename: it.filename,
        status: "queued",
        createdAt: now,
        sourceId: it.sourceId,
        recordCount: 0,
        candidates: [],
        chars: it.text.length,
      };
      writeJob(db, job, it.text);
      appendJobEvent(db, job, now);
      made.push(job);
    }
  });
  tx();
  return made;
}

export function countQueuedJobs(domain: Domain): number {
  const db = getDb(domain);
  return (db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE status = 'queued'").get() as { n: number }).n;
}

export function listJobs(domain: Domain): BatchJob[] {
  const db = getDb(domain);
  const rows = db
    .prepare("SELECT payload FROM jobs ORDER BY created_at DESC, id DESC")
    .all() as { payload: string }[];
  return rows.map((r) => JSON.parse(r.payload) as BatchJob);
}

export function getJob(domain: Domain, id: string): BatchJob | null {
  const db = getDb(domain);
  const row = db.prepare("SELECT payload FROM jobs WHERE id = ?").get(id) as { payload: string } | undefined;
  return row ? (JSON.parse(row.payload) as BatchJob) : null;
}

export function getJobText(domain: Domain, id: string): string | null {
  const db = getDb(domain);
  const row = db.prepare("SELECT text FROM jobs WHERE id = ?").get(id) as { text: string | null } | undefined;
  return row?.text ?? null;
}

export function updateJob(domain: Domain, id: string, patch: Partial<BatchJob>): BatchJob | null {
  const db = getDb(domain);
  const tx = db.transaction(() => {
    const row = db.prepare("SELECT payload FROM jobs WHERE id = ?").get(id) as
      | { payload: string }
      | undefined;
    if (!row) return null;

    const current = JSON.parse(row.payload) as BatchJob;
    const statusChanged = patch.status != null && patch.status !== current.status;
    const occurredAt = new Date().toISOString();
    let next: BatchJob = { ...current, ...patch };

    if (statusChanged) {
      if (next.status === "extracting") {
        next = { ...next, startedAt: current.startedAt ?? occurredAt };
      }
      if (next.status === "done" || next.status === "error") {
        next = { ...next, completedAt: current.completedAt ?? occurredAt };
      }
      if (next.status === "committed") {
        next = { ...next, committedAt: current.committedAt ?? occurredAt };
      }
    }

    writeJob(db, next);
    if (statusChanged) appendJobEvent(db, next, occurredAt);
    return next;
  });
  return tx();
}

/** Atomically claim the oldest queued job (queued → extracting). */
export function claimNextJob(domain: Domain): { job: BatchJob; text: string } | null {
  const db = getDb(domain);
  const tx = db.transaction(() => {
    const row = db
      .prepare("SELECT id FROM jobs WHERE status = 'queued' ORDER BY created_at ASC, id ASC LIMIT 1")
      .get() as { id: string } | undefined;
    if (!row) return null;
    const job = getJob(domain, row.id)!;
    const text = getJobText(domain, row.id) ?? "";
    const hasQueuedEvent = db
      .prepare("SELECT 1 FROM job_events WHERE job_id = ? AND status = 'queued' LIMIT 1")
      .get(job.id);
    if (!hasQueuedEvent) appendJobEvent(db, { ...job, status: "queued" }, job.createdAt);

    const occurredAt = new Date().toISOString();
    const claimed = {
      ...job,
      status: "extracting" as JobStatus,
      startedAt: job.startedAt ?? occurredAt,
    };
    writeJob(db, claimed);
    appendJobEvent(db, claimed, occurredAt);
    return { job: claimed, text };
  });
  return tx();
}

/** Historical funnel and elapsed-time metrics derived only from recorded events. */
export function getJobHistorySummary(domain: Domain): JobHistorySummary {
  const db = getDb(domain);
  const rows = db
    .prepare(
      `SELECT event_id, job_id, status, occurred_at, record_count
       FROM job_events ORDER BY event_id ASC`
    )
    .all() as {
    event_id: number;
    job_id: string;
    status: JobStatus;
    occurred_at: string;
    record_count: number;
  }[];
  const events: JobEvent[] = rows.map((row) => ({
    eventId: row.event_id,
    jobId: row.job_id,
    status: row.status,
    occurredAt: row.occurred_at,
    recordCount: row.record_count,
  }));
  return summarizeJobEvents(events);
}

export function deleteJob(domain: Domain, id: string): number {
  const db = getDb(domain);
  return db.prepare("DELETE FROM jobs WHERE id = ?").run(id).changes;
}

export function clearFinishedJobs(domain: Domain): number {
  const db = getDb(domain);
  return db.prepare("DELETE FROM jobs WHERE status IN ('done','error','committed')").run().changes;
}

/**
 * Commit a finished job's candidates into the review queue. Pass `indices` to
 * commit only the selected candidates; omit to commit all. The candidates land
 * in the SAME domain's records table — there is no cross-domain path.
 */
export function commitJob(
  domain: Domain,
  id: string,
  indices?: number[]
): { created: number; job: BatchJob } | { error: string } {
  const job = getJob(domain, id);
  if (!job) return { error: "Job not found" };
  if (job.status !== "done") return { error: `Job is "${job.status}", not ready to commit` };
  const selected =
    indices && indices.length ? job.candidates.filter((_, i) => indices.includes(i)) : job.candidates;
  const extraction = job.source
    ? { source: job.source, ...(job.model ? { model: job.model } : {}) }
    : undefined;
  const chosen = extraction
    ? selected.map((candidate) => ({ ...candidate, extraction }))
    : selected;
  const created = createRecords(domain, chosen, "review");
  const updated = updateJob(domain, id, { status: "committed", recordCount: created.length })!;
  return { created: created.length, job: updated };
}

/* ------------------------------------------------------------------ */
/* Source documents — uploaded PDFs + per-page text (per domain).      */
/* ------------------------------------------------------------------ */

export function createSource(domain: Domain, doc: SourceDoc): void {
  const db = getDb(domain);
  db.prepare(
    `INSERT OR REPLACE INTO sources (id, filename, page_count, created_at, payload)
     VALUES (@id, @filename, @page_count, @created_at, @payload)`
  ).run({
    id: doc.id,
    filename: doc.filename,
    page_count: doc.pageCount,
    created_at: doc.createdAt,
    payload: JSON.stringify(doc),
  });
}

export function getSource(domain: Domain, id: string): SourceDoc | null {
  const db = getDb(domain);
  const row = db.prepare("SELECT payload FROM sources WHERE id = ?").get(id) as { payload: string } | undefined;
  return row ? (JSON.parse(row.payload) as SourceDoc) : null;
}

export interface SourceCascadeDeleteResult {
  sourceId: string;
  filename: string;
  deletedJobs: number;
  deletedJobEvents: number;
  deletedRecords: number;
}

function payloadSourceId(payload: string): string | null {
  try {
    const value = (JSON.parse(payload) as { sourceId?: unknown }).sourceId;
    return typeof value === "string" ? value : null;
  } catch {
    return null;
  }
}

/** Delete every database row owned by one uploaded source in one transaction. */
export function deleteSourceCascadeData(domain: Domain, sourceId: string): SourceCascadeDeleteResult | null {
  const db = getDb(domain);
  const tx = db.transaction(() => {
    const source = db.prepare("SELECT filename FROM sources WHERE id = ?").get(sourceId) as
      | { filename: string }
      | undefined;
    if (!source) return null;

    const jobIds = (db.prepare("SELECT id, payload FROM jobs").all() as { id: string; payload: string }[])
      .filter((row) => payloadSourceId(row.payload) === sourceId)
      .map((row) => row.id);
    const recordIds = (db.prepare("SELECT id, payload FROM records").all() as { id: string; payload: string }[])
      .filter((row) => payloadSourceId(row.payload) === sourceId)
      .map((row) => row.id);

    const deleteEvents = db.prepare("DELETE FROM job_events WHERE job_id = ?");
    const deleteJobRow = db.prepare("DELETE FROM jobs WHERE id = ?");
    const deleteRecordRow = db.prepare("DELETE FROM records WHERE id = ?");
    let deletedJobEvents = 0;
    let deletedJobs = 0;
    let deletedRecords = 0;
    for (const jobId of jobIds) {
      deletedJobEvents += deleteEvents.run(jobId).changes;
      deletedJobs += deleteJobRow.run(jobId).changes;
    }
    for (const recordId of recordIds) deletedRecords += deleteRecordRow.run(recordId).changes;
    db.prepare("DELETE FROM sources WHERE id = ?").run(sourceId);

    return {
      sourceId,
      filename: source.filename,
      deletedJobs,
      deletedJobEvents,
      deletedRecords,
    };
  });
  return tx();
}

/**
 * Find an already-uploaded source by DOI — the upload duplicate check.
 * Sources stored before DOIs were captured compute theirs lazily from the
 * indexed page text, so the whole library participates without a migration.
 */
export function findSourceByDoi(
  domain: Domain,
  doi: string
): { id: string; filename: string; createdAt: string } | null {
  const want = normalizeDoi(doi);
  if (!want) return null;
  const db = getDb(domain);
  const rows = db.prepare("SELECT payload FROM sources").all() as { payload: string }[];
  for (const row of rows) {
    const doc = JSON.parse(row.payload) as SourceDoc;
    const have = doc.doi ?? extractDoiFromPages(doc.pages ?? []);
    if (have === want) return { id: doc.id, filename: doc.filename, createdAt: doc.createdAt };
  }
  return null;
}

export function getSourcePageText(domain: Domain, id: string, page: number): string | null {
  const doc = getSource(domain, id);
  if (!doc) return null;
  return doc.pages.find((p) => p.page === page)?.text ?? null;
}

/** Lightweight list of uploaded sources (no per-page text) for the library. */
export function listSourceSummaries(domain: Domain): {
  id: string;
  filename: string;
  pageCount: number;
  createdAt: string;
}[] {
  const db = getDb(domain);
  const rows = db
    .prepare("SELECT id, filename, page_count, created_at FROM sources ORDER BY created_at DESC")
    .all() as { id: string; filename: string; page_count: number; created_at: string }[];
  return rows.map((r) => ({ id: r.id, filename: r.filename, pageCount: r.page_count, createdAt: r.created_at }));
}
