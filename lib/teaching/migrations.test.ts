import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import {
  DEFAULT_EXPERIMENT,
  defaultExperimentChecksum,
  ensureDefaultTeachingExperiment,
} from "./config";
import { migrateTeachingSchema } from "./migrations";
import { closeTeachingStoreForTests, getTeachingDb } from "./store";
import { columnNames, tableNames } from "./testFixtures";

function legacyBusinessRows(db: Database.Database): Record<string, unknown> {
  return {
    project: db
      .prepare(
        `SELECT id, name, domain, invite_code, status, fields_json, created_at
         FROM teaching_projects WHERE id = 'legacy-project'`
      )
      .get(),
    paper: db
      .prepare(
        `SELECT id, project_id, paper_no, title, doi, journal, source_url, source_record_id,
                ai_snapshot_json, ai_model, ai_extracted_at, created_at
         FROM teaching_papers WHERE id = 'legacy-paper'`
      )
      .get(),
    participant: db
      .prepare(
        `SELECT id, project_id, group_code, student_alias, assigned_paper_id, created_at
         FROM teaching_participants WHERE id = 'legacy-participant'`
      )
      .get(),
    submission: db
      .prepare(
        `SELECT id, project_id, paper_id, participant_id, started_at, submitted_at,
                answers_json, version, updated_at
         FROM teaching_submissions WHERE id = 'legacy-submission'`
      )
      .get(),
    review: db
      .prepare(
        `SELECT submission_id, human_scores_json, ai_scores_json, reviewed_at, reviewer_id
         FROM teaching_reviews WHERE submission_id = 'legacy-submission'`
      )
      .get(),
  };
}

const LEGACY_SCHEMA = `
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

const databasePath = path.join(process.env.IONICLINK_DATA_DIR!, "teaching.db");
const legacy = new Database(databasePath);
legacy.pragma("foreign_keys = ON");
legacy.exec(LEGACY_SCHEMA);

const timestamp = "2026-01-01T00:00:00.000Z";
legacy
  .prepare(
    `INSERT INTO teaching_projects
     (id, name, domain, invite_code, status, fields_json, created_at)
     VALUES ('legacy-project', 'Legacy', 'tribology', 'LEGACY', 'open', '[]', ?)`
  )
  .run(timestamp);
legacy
  .prepare(
    `INSERT INTO teaching_papers
     (id, project_id, paper_no, title, doi, journal, source_url, source_record_id,
      ai_snapshot_json, ai_model, ai_extracted_at, created_at)
     VALUES ('legacy-paper', 'legacy-project', 'L', 'Legacy paper', NULL, NULL, NULL, NULL,
             '{}', NULL, NULL, ?)`
  )
  .run(timestamp);
legacy
  .prepare(
    `INSERT INTO teaching_participants
     (id, project_id, group_code, student_alias, assigned_paper_id, created_at)
     VALUES ('legacy-participant', 'legacy-project', 'legacy-group', 'legacy-student',
             'legacy-paper', ?)`
  )
  .run(timestamp);
legacy
  .prepare(
    `INSERT INTO teaching_submissions
     (id, project_id, paper_id, participant_id, started_at, submitted_at,
      answers_json, version, updated_at)
     VALUES ('legacy-submission', 'legacy-project', 'legacy-paper', 'legacy-participant',
             ?, ?, '{"cation":{"value":"legacy"}}', 1, ?)`
  )
  .run(timestamp, timestamp, timestamp);
legacy
  .prepare(
    `INSERT INTO teaching_reviews
     (submission_id, human_scores_json, ai_scores_json, reviewed_at, reviewer_id)
     VALUES ('legacy-submission', '{}', '{}', ?, 'teacher')`
  )
  .run(timestamp);
const legacyRowsBeforeMigration = legacyBusinessRows(legacy);
legacy.close();

const db = getTeachingDb();

assert.equal(columnNames(db, "teaching_projects").has("config_checksum"), true);
assert.equal(columnNames(db, "teaching_papers").has("gold_snapshot_json"), true);
assert.equal(columnNames(db, "teaching_participants").has("sequence_code"), true);
assert.equal(columnNames(db, "teaching_participants").has("identity_key"), true);
assert.equal(columnNames(db, "teaching_submissions").has("active_seconds"), true);
assert.equal(tableNames(db).has("teaching_activity_events"), true);
assert.equal(tableNames(db).has("teaching_roster"), true);
assert.equal(db.pragma("user_version", { simple: true }), 3);
for (const [table, expectedColumns] of Object.entries({
  teaching_projects: [
    "experiment_kind",
    "config_version",
    "config_checksum",
    "is_default",
    "group_count",
  ],
  teaching_papers: [
    "task_prompt",
    "gold_snapshot_json",
    "scoring_rules_json",
    "config_version",
    "group_no",
  ],
  teaching_participants: [
    "sequence_code",
    "identity_key",
    "completed_at",
    "excluded_at",
    "exclusion_reason",
  ],
  teaching_submissions: [
    "round_no",
    "mode",
    "active_seconds",
    "ai_initial_json",
    "auto_value_scores_json",
    "auto_evidence_scores_json",
    "scoring_version",
    "scoring_status",
    "auto_scored_at",
  ],
})) {
  const actualColumns = columnNames(db, table);
  for (const column of expectedColumns) {
    assert.equal(actualColumns.has(column), true, `${table}.${column} should exist`);
  }
}
const migrationIndexes = new Set(
  db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'index'")
    .pluck()
    .all() as string[]
);
for (const index of [
  "idx_teaching_default_identity",
  "idx_teaching_participant_round",
  "idx_teaching_activity_submission",
  "idx_teaching_roster_project",
]) {
  assert.equal(migrationIndexes.has(index), true, `${index} should exist`);
}
const rosterColumns = columnNames(db, "teaching_roster");
for (const column of [
  "id",
  "project_id",
  "student_name",
  "identity_key",
  "group_no",
  "participant_id",
  "created_at",
]) {
  assert.equal(rosterColumns.has(column), true, `teaching_roster.${column} should exist`);
}
assert.equal(
  db.prepare("SELECT name FROM teaching_projects WHERE id = 'legacy-project'").pluck().get(),
  "Legacy"
);
assert.equal(
  db.prepare("SELECT reviewer_id FROM teaching_reviews WHERE submission_id = 'legacy-submission'").pluck().get(),
  "teacher"
);
assert.equal(db.pragma("quick_check", { simple: true }), "ok");
assert.deepEqual(legacyBusinessRows(db), legacyRowsBeforeMigration);

ensureDefaultTeachingExperiment(db);
const firstChecksum = db
  .prepare("SELECT config_checksum FROM teaching_projects WHERE id = ?")
  .pluck()
  .get(DEFAULT_EXPERIMENT.id);
ensureDefaultTeachingExperiment(db);

assert.equal(
  db.prepare("SELECT COUNT(*) FROM teaching_projects WHERE is_default = 1").pluck().get(),
  1
);
assert.equal(
  db.prepare("SELECT COUNT(*) FROM teaching_papers WHERE project_id = ?").pluck().get(DEFAULT_EXPERIMENT.id),
  2
);
assert.equal(firstChecksum, defaultExperimentChecksum());
assert.equal(
  db.prepare("SELECT config_checksum FROM teaching_projects WHERE id = ?").pluck().get(DEFAULT_EXPERIMENT.id),
  firstChecksum
);
for (const paper of DEFAULT_EXPERIMENT.papers) {
  const stored = db
    .prepare(
      `SELECT task_prompt, ai_snapshot_json, gold_snapshot_json, scoring_rules_json
       FROM teaching_papers WHERE id = ?`
    )
    .get(paper.id) as {
    task_prompt: string;
    ai_snapshot_json: string;
    gold_snapshot_json: string;
    scoring_rules_json: string;
  };
  assert.equal(stored.task_prompt, paper.taskPrompt);
  assert.deepEqual(JSON.parse(stored.ai_snapshot_json), paper.aiInitial);
  assert.deepEqual(
    JSON.parse(stored.gold_snapshot_json),
    Object.fromEntries(Object.entries(paper.gold).map(([key, rule]) => [key, rule.value]))
  );
  assert.deepEqual(JSON.parse(stored.scoring_rules_json), paper.gold);
}
assert.deepEqual(
  legacyBusinessRows(db),
  legacyRowsBeforeMigration
);
assert.equal(db.pragma("quick_check", { simple: true }), "ok");

const readonlyCompleteDb = new Database(databasePath, { readonly: true, fileMustExist: true });
assert.doesNotThrow(
  () => migrateTeachingSchema(readonlyCompleteDb),
  "opening a complete v3 schema must not attempt DDL or a write transaction"
);
readonlyCompleteDb.close();

db.exec(`
  DROP INDEX idx_teaching_submissions_project;
  DROP INDEX idx_teaching_default_identity;
  DROP INDEX idx_teaching_participant_round;
  DROP TABLE teaching_sessions;
  DROP TABLE teaching_activity_events;
  ALTER TABLE teaching_projects DROP COLUMN config_checksum;
`);
assert.equal(db.pragma("user_version", { simple: true }), 3);
closeTeachingStoreForTests();
const repairedDb = getTeachingDb();
assert.equal(columnNames(repairedDb, "teaching_projects").has("config_checksum"), true);
assert.equal(tableNames(repairedDb).has("teaching_sessions"), true);
assert.equal(tableNames(repairedDb).has("teaching_activity_events"), true);
const repairedIndexes = new Set(
  repairedDb
    .prepare("SELECT name FROM sqlite_master WHERE type = 'index'")
    .pluck()
    .all() as string[]
);
for (const index of [
  "idx_teaching_submissions_project",
  "idx_teaching_default_identity",
  "idx_teaching_participant_round",
  "idx_teaching_activity_submission",
]) {
  assert.equal(repairedIndexes.has(index), true, `${index} should be repaired at version 3`);
}
assert.equal(repairedDb.pragma("user_version", { simple: true }), 3);
assert.equal(repairedDb.pragma("quick_check", { simple: true }), "ok");

const rollbackDb = new Database(":memory:");
rollbackDb.pragma("foreign_keys = ON");
rollbackDb.exec(LEGACY_SCHEMA);
rollbackDb.exec(`
  ALTER TABLE teaching_participants ADD COLUMN sequence_code TEXT;
  ALTER TABLE teaching_participants ADD COLUMN identity_key TEXT;
  INSERT INTO teaching_projects
    (id, name, domain, invite_code, status, fields_json, created_at)
    VALUES ('rollback-project', 'Rollback', 'tribology', 'ROLLBACK', 'open', '[]', '${timestamp}');
  INSERT INTO teaching_participants
    (id, project_id, group_code, student_alias, assigned_paper_id, created_at,
     sequence_code, identity_key)
    VALUES
      ('rollback-p1', 'rollback-project', 'g1', 's1', NULL, '${timestamp}', 'manual_then_ai', 'same'),
      ('rollback-p2', 'rollback-project', 'g2', 's2', NULL, '${timestamp}', 'manual_then_ai', 'same');
`);
assert.throws(
  () => migrateTeachingSchema(rollbackDb),
  /UNIQUE constraint failed: teaching_participants\.project_id, teaching_participants\.identity_key/
);
assert.equal(rollbackDb.pragma("user_version", { simple: true }), 0);
assert.equal(columnNames(rollbackDb, "teaching_projects").has("config_checksum"), false);
assert.equal(columnNames(rollbackDb, "teaching_participants").has("completed_at"), false);
assert.equal(tableNames(rollbackDb).has("teaching_activity_events"), false);
assert.equal(
  rollbackDb.prepare("SELECT COUNT(*) FROM teaching_participants").pluck().get(),
  2
);
assert.equal(rollbackDb.pragma("quick_check", { simple: true }), "ok");
rollbackDb.close();

closeTeachingStoreForTests();

const originalDataDir = process.env.IONICLINK_DATA_DIR!;
const futureDataDir = path.join(originalDataDir, "future-version");
const futureDatabasePath = path.join(futureDataDir, "teaching.db");
mkdirSync(futureDataDir, { recursive: true });
const futureDb = new Database(futureDatabasePath);
futureDb.exec(`
  CREATE TABLE future_only (id TEXT PRIMARY KEY);
  PRAGMA user_version = 4;
`);
futureDb.close();

try {
  process.env.IONICLINK_DATA_DIR = futureDataDir;
  assert.throws(() => getTeachingDb(), /schema version 4.*supports version 3/i);
} finally {
  closeTeachingStoreForTests();
  process.env.IONICLINK_DATA_DIR = originalDataDir;
}

const unchangedFutureDb = new Database(futureDatabasePath, { readonly: true, fileMustExist: true });
assert.equal(unchangedFutureDb.pragma("user_version", { simple: true }), 4);
assert.deepEqual([...tableNames(unchangedFutureDb)].sort(), ["future_only"]);
assert.equal(unchangedFutureDb.pragma("quick_check", { simple: true }), "ok");
unchangedFutureDb.close();

console.log("Teaching migration and default bootstrap tests passed");
