import Database from "better-sqlite3";

export const TEACHING_SCHEMA_VERSION = 3;

const COLUMN_MIGRATIONS: ReadonlyArray<{
  table: string;
  columns: readonly string[];
}> = [
  {
    table: "teaching_projects",
    columns: [
      "experiment_kind TEXT NOT NULL DEFAULT 'legacy'",
      "config_version TEXT",
      "config_checksum TEXT",
      "is_default INTEGER NOT NULL DEFAULT 0",
      // Group-crossover experiments freeze their group count at creation.
      "group_count INTEGER",
    ],
  },
  {
    table: "teaching_papers",
    columns: [
      "task_prompt TEXT NOT NULL DEFAULT ''",
      "gold_snapshot_json TEXT NOT NULL DEFAULT '{}'",
      "scoring_rules_json TEXT NOT NULL DEFAULT '{}'",
      "config_version TEXT",
      // Group-crossover papers are assigned to exactly one group (1..group_count).
      "group_no INTEGER",
    ],
  },
  {
    table: "teaching_participants",
    columns: [
      "sequence_code TEXT",
      "identity_key TEXT",
      "completed_at TEXT",
      "excluded_at TEXT",
      "exclusion_reason TEXT",
    ],
  },
  {
    table: "teaching_submissions",
    columns: [
      "round_no INTEGER",
      "mode TEXT",
      "active_seconds INTEGER NOT NULL DEFAULT 0",
      "ai_initial_json TEXT NOT NULL DEFAULT '{}'",
      "auto_value_scores_json TEXT NOT NULL DEFAULT '{}'",
      "auto_evidence_scores_json TEXT NOT NULL DEFAULT '{}'",
      "scoring_version TEXT",
      "scoring_status TEXT NOT NULL DEFAULT 'legacy'",
      "auto_scored_at TEXT",
    ],
  },
];

const REQUIRED_SCHEMA_OBJECTS = [
  { type: "table", name: "teaching_projects" },
  { type: "table", name: "teaching_papers" },
  { type: "table", name: "teaching_participants" },
  { type: "table", name: "teaching_submissions" },
  { type: "table", name: "teaching_reviews" },
  { type: "table", name: "teaching_sessions" },
  { type: "table", name: "teaching_activity_events" },
  { type: "table", name: "teaching_roster" },
  { type: "index", name: "idx_teaching_submissions_project" },
  { type: "index", name: "idx_teaching_sessions_expiry" },
  { type: "index", name: "idx_teaching_default_identity" },
  { type: "index", name: "idx_teaching_participant_round" },
  { type: "index", name: "idx_teaching_activity_submission" },
  { type: "index", name: "idx_teaching_roster_project" },
] as const;

function existingColumns(db: Database.Database, table: string): Set<string> {
  return new Set(
    (db.pragma(`table_info(${table})`) as Array<{ name: string }>).map((column) => column.name)
  );
}

export function hasCompleteTeachingSchema(db: Database.Database): boolean {
  for (const migration of COLUMN_MIGRATIONS) {
    const columns = existingColumns(db, migration.table);
    for (const definition of migration.columns) {
      const [name] = definition.split(/\s+/, 1);
      if (!columns.has(name)) return false;
    }
  }

  const schemaObjects = new Set(
    (db
      .prepare(
        `SELECT type, name FROM sqlite_master
         WHERE name IN (${REQUIRED_SCHEMA_OBJECTS.map(() => "?").join(", ")})`
      )
      .all(...REQUIRED_SCHEMA_OBJECTS.map(({ name }) => name)) as Array<{
        type: string;
        name: string;
      }>).map(({ type, name }) => `${type}:${name}`)
  );
  return REQUIRED_SCHEMA_OBJECTS.every(({ type, name }) => schemaObjects.has(`${type}:${name}`));
}

export function migrateTeachingSchema(db: Database.Database): void {
  const currentVersion = Number(db.pragma("user_version", { simple: true }));
  if (currentVersion > TEACHING_SCHEMA_VERSION) return;
  if (currentVersion === TEACHING_SCHEMA_VERSION && hasCompleteTeachingSchema(db)) return;

  db.transaction(() => {
    for (const migration of COLUMN_MIGRATIONS) {
      const columns = existingColumns(db, migration.table);
      for (const definition of migration.columns) {
        const [name] = definition.split(/\s+/, 1);
        if (columns.has(name)) continue;
        db.exec(`ALTER TABLE ${migration.table} ADD COLUMN ${definition}`);
        columns.add(name);
      }
    }

    db.exec(`
      CREATE TABLE IF NOT EXISTS teaching_activity_events (
        id TEXT PRIMARY KEY,
        submission_id TEXT NOT NULL REFERENCES teaching_submissions(id) ON DELETE CASCADE,
        event_type TEXT NOT NULL,
        field_key TEXT,
        client_at TEXT NOT NULL,
        received_at TEXT NOT NULL,
        active_delta_seconds INTEGER NOT NULL DEFAULT 0,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        UNIQUE(submission_id, id)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_teaching_default_identity
        ON teaching_participants(project_id, identity_key) WHERE sequence_code IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_teaching_participant_round
        ON teaching_submissions(participant_id, round_no) WHERE round_no IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_teaching_activity_submission
        ON teaching_activity_events(submission_id, received_at);
      CREATE TABLE IF NOT EXISTS teaching_roster (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES teaching_projects(id) ON DELETE CASCADE,
        student_name TEXT NOT NULL,
        identity_key TEXT NOT NULL,
        group_no INTEGER NOT NULL,
        participant_id TEXT REFERENCES teaching_participants(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL,
        UNIQUE(project_id, identity_key)
      );
      CREATE INDEX IF NOT EXISTS idx_teaching_roster_project
        ON teaching_roster(project_id, group_no);
    `);

    db.pragma(`user_version = ${TEACHING_SCHEMA_VERSION}`);
  }).immediate();
}
