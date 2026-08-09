import Database from "better-sqlite3";

export function columnNames(db: Database.Database, table: string): Set<string> {
  return new Set(
    (db.pragma(`table_info(${table})`) as Array<{ name: string }>).map((column) => column.name)
  );
}

export function tableNames(db: Database.Database): Set<string> {
  return new Set(
    (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>)
      .map((row) => row.name)
  );
}

export function sequenceCounts(db: Database.Database): Record<string, number> {
  return Object.fromEntries(
    (db.prepare("SELECT sequence_code AS code, COUNT(*) AS n FROM teaching_participants WHERE sequence_code IS NOT NULL GROUP BY sequence_code").all() as Array<{ code: string; n: number }>)
      .map((row) => [row.code, row.n])
  );
}

export function participants(db: Database.Database): Array<{ id: string; student_alias: string }> {
  return db.prepare("SELECT id, student_alias FROM teaching_participants WHERE sequence_code IS NOT NULL ORDER BY created_at, id").all() as Array<{ id: string; student_alias: string }>;
}

export function submissionsFor(db: Database.Database, participantId: string): Array<Record<string, unknown>> {
  return db.prepare("SELECT * FROM teaching_submissions WHERE participant_id = ? ORDER BY round_no").all(participantId) as Array<Record<string, unknown>>;
}
