import { randomUUID } from "node:crypto";
import { getTeachingDb } from "./store";
import type { PredictionSubmission, PredictionSubmissionInput } from "./predictionShared";
import { validatePredictionSubmission } from "./predictionValidation";

const TEACHER_SUBMISSION_LIMIT = 100;
const STUDENT_SUBMISSION_LIMIT = 20;

function db() {
  const store = getTeachingDb();
  store.exec(`CREATE TABLE IF NOT EXISTS prediction_submissions (
    id TEXT PRIMARY KEY,
    user_key TEXT NOT NULL,
    student_name TEXT NOT NULL,
    payload TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_prediction_submissions_user
    ON prediction_submissions(user_key, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_prediction_submissions_created
    ON prediction_submissions(created_at DESC);`);
  return store;
}

function read(row: unknown): PredictionSubmission {
  return JSON.parse((row as { payload: string }).payload) as PredictionSubmission;
}

function requiredAccountValue(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 120) throw new Error(`Invalid ${label}.`);
  return value.trim();
}

export function createPredictionSubmission(account: {
  userKey: unknown;
  studentName: unknown;
}, input: PredictionSubmissionInput): PredictionSubmission {
  const userKey = requiredAccountValue(account.userKey, "student account");
  const studentName = requiredAccountValue(account.studentName, "student name");
  const validated = validatePredictionSubmission(input);
  const value: PredictionSubmission = {
    id: randomUUID(),
    userKey,
    studentName,
    ...validated,
    createdAt: new Date().toISOString(),
  };
  db().prepare("INSERT INTO prediction_submissions (id, user_key, student_name, payload, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(value.id, userKey, studentName, JSON.stringify(value), value.createdAt);
  return value;
}

export function listPredictionSubmissions(userKey?: string): PredictionSubmission[] {
  if (userKey !== undefined) {
    const account = requiredAccountValue(userKey, "student account");
    return db().prepare("SELECT payload FROM prediction_submissions WHERE user_key = ? ORDER BY created_at DESC, rowid DESC LIMIT ?")
      .all(account, STUDENT_SUBMISSION_LIMIT).map(read);
  }
  return db().prepare("SELECT payload FROM prediction_submissions ORDER BY created_at DESC, rowid DESC LIMIT ?")
    .all(TEACHER_SUBMISSION_LIMIT).map(read);
}
