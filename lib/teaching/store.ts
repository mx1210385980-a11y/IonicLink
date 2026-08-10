import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";
import {
  hasCompleteTeachingSchema,
  migrateTeachingSchema,
  TEACHING_SCHEMA_VERSION,
} from "./migrations";

const TEACHING_DATABASE_NAME = "teaching.db";
const TEACHING_DATABASE_TIMEOUT_MS = 30_000;

const BASE_SCHEMA = `
  CREATE TABLE IF NOT EXISTS teaching_projects (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    domain      TEXT NOT NULL DEFAULT 'tribology',
    invite_code TEXT NOT NULL UNIQUE,
    status      TEXT NOT NULL DEFAULT 'open',
    fields_json TEXT NOT NULL,
    created_at  TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS teaching_papers (
    id               TEXT PRIMARY KEY,
    project_id       TEXT NOT NULL REFERENCES teaching_projects(id) ON DELETE CASCADE,
    paper_no         TEXT NOT NULL,
    title            TEXT NOT NULL,
    doi              TEXT,
    journal          TEXT,
    source_url       TEXT,
    source_record_id TEXT,
    ai_snapshot_json TEXT NOT NULL,
    ai_model         TEXT,
    ai_extracted_at  TEXT,
    created_at       TEXT NOT NULL,
    UNIQUE(project_id, paper_no)
  );
  CREATE TABLE IF NOT EXISTS teaching_participants (
    id                TEXT PRIMARY KEY,
    project_id        TEXT NOT NULL REFERENCES teaching_projects(id) ON DELETE CASCADE,
    group_code        TEXT NOT NULL,
    student_alias     TEXT NOT NULL,
    assigned_paper_id TEXT REFERENCES teaching_papers(id) ON DELETE SET NULL,
    created_at        TEXT NOT NULL,
    UNIQUE(project_id, group_code, student_alias)
  );
  CREATE TABLE IF NOT EXISTS teaching_submissions (
    id             TEXT PRIMARY KEY,
    project_id     TEXT NOT NULL REFERENCES teaching_projects(id) ON DELETE CASCADE,
    paper_id       TEXT NOT NULL REFERENCES teaching_papers(id) ON DELETE CASCADE,
    participant_id TEXT NOT NULL REFERENCES teaching_participants(id) ON DELETE CASCADE,
    started_at     TEXT NOT NULL,
    submitted_at   TEXT,
    answers_json   TEXT NOT NULL DEFAULT '{}',
    version        INTEGER NOT NULL DEFAULT 0,
    updated_at     TEXT NOT NULL,
    UNIQUE(project_id, paper_id, participant_id)
  );
  CREATE TABLE IF NOT EXISTS teaching_reviews (
    submission_id     TEXT PRIMARY KEY REFERENCES teaching_submissions(id) ON DELETE CASCADE,
    human_scores_json TEXT NOT NULL DEFAULT '{}',
    ai_scores_json    TEXT NOT NULL DEFAULT '{}',
    reviewed_at       TEXT NOT NULL,
    reviewer_id       TEXT NOT NULL DEFAULT 'teacher'
  );
  CREATE TABLE IF NOT EXISTS teaching_sessions (
    token_hash     TEXT PRIMARY KEY,
    role           TEXT NOT NULL,
    project_id     TEXT,
    participant_id TEXT,
    created_at     TEXT NOT NULL,
    expires_at     TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_teaching_submissions_project
    ON teaching_submissions(project_id, submitted_at);
  CREATE INDEX IF NOT EXISTS idx_teaching_sessions_expiry
    ON teaching_sessions(expires_at);
`;

let teachingDb: Database.Database | null = null;

export function teachingDataDir(): string {
  return path.resolve(process.env.IONICLINK_DATA_DIR || path.join(process.cwd(), "data"));
}

export function getTeachingDb(): Database.Database {
  if (teachingDb) return teachingDb;

  const dataDir = teachingDataDir();
  mkdirSync(dataDir, { recursive: true });
  const next = new Database(path.join(dataDir, TEACHING_DATABASE_NAME), {
    timeout: TEACHING_DATABASE_TIMEOUT_MS,
  });
  try {
    const currentVersion = Number(next.pragma("user_version", { simple: true }));
    if (currentVersion > TEACHING_SCHEMA_VERSION) {
      throw new Error(
        `Unsupported teaching database schema version ${currentVersion}; this build supports version ${TEACHING_SCHEMA_VERSION}.`
      );
    }
    next.pragma("foreign_keys = ON");
    const journalMode = String(next.pragma("journal_mode", { simple: true })).toLowerCase();
    if (journalMode !== "wal") next.pragma("journal_mode = WAL");
    const schemaIsComplete =
      currentVersion === TEACHING_SCHEMA_VERSION && hasCompleteTeachingSchema(next);
    if (!schemaIsComplete) next.exec(BASE_SCHEMA);
    migrateTeachingSchema(next);
    teachingDb = next;
    return next;
  } catch (error) {
    next.close();
    throw error;
  }
}

export function closeTeachingStoreForTests(): void {
  teachingDb?.close();
  teachingDb = null;
}
