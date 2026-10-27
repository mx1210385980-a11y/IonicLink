import { randomUUID } from "node:crypto";
import { getTeachingDb } from "./store";
import { validateSimpleRows } from "./simpleScoring";
import { scoreLive, type LiveDashboard, type LiveExperiment, type LiveMark, type LiveParticipant, type LiveParticipantView, type LiveStudentState } from "./liveShared";

function db() {
  const store = getTeachingDb();
  store.exec(`CREATE TABLE IF NOT EXISTS live_experiments (
    id TEXT PRIMARY KEY, payload TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS live_participants (
    id TEXT PRIMARY KEY, experiment_id TEXT NOT NULL REFERENCES live_experiments(id),
    user_key TEXT NOT NULL, payload TEXT NOT NULL, UNIQUE(experiment_id, user_key));`);
  return store;
}

function read<T>(row: unknown): T | null {
  return row ? JSON.parse((row as { payload: string }).payload) as T : null;
}

function required(value: unknown, label: string, max = 200): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max) throw new Error(`Invalid ${label}`);
  return value.trim();
}

function writeExperiment(value: LiveExperiment): void {
  db().prepare("UPDATE live_experiments SET payload = ? WHERE id = ?").run(JSON.stringify(value), value.id);
}

function writeParticipant(value: LiveParticipant): void {
  db().prepare("UPDATE live_participants SET payload = ? WHERE id = ?").run(JSON.stringify(value), value.id);
}

export function getLiveExperiment(id: string): LiveExperiment {
  const value = read<LiveExperiment>(db().prepare("SELECT payload FROM live_experiments WHERE id = ?").get(id));
  if (!value) throw new Error("Experiment not found");
  return value;
}

export function listLiveExperiments(): LiveExperiment[] {
  return db().prepare("SELECT payload FROM live_experiments ORDER BY rowid DESC").all().map((row) => read<LiveExperiment>(row)!);
}

export function createLiveExperiment(input: { name: unknown; groupCount: unknown }): LiveExperiment {
  const name = required(input.name, "Experiment name", 100);
  const groupCount = Number(input.groupCount);
  if (!Number.isInteger(groupCount) || groupCount < 2 || groupCount > 8) throw new Error("Choose 2–8 groups");
  const value: LiveExperiment = {
    id: randomUUID(), name, groupCount, status: "open",
    paperSourceId: "", paperTitle: "", gold: [],
    createdAt: new Date().toISOString(), startedAt: null, finishedAt: null,
  };
  db().prepare("INSERT INTO live_experiments VALUES (?, ?)").run(value.id, JSON.stringify(value));
  return value;
}

function participants(experimentId: string): LiveParticipant[] {
  return db().prepare("SELECT payload FROM live_participants WHERE experiment_id = ? ORDER BY rowid").all(experimentId)
    .map((row) => read<LiveParticipant>(row)!);
}

function participant(id: string): LiveParticipant {
  const value = read<LiveParticipant>(db().prepare("SELECT payload FROM live_participants WHERE id = ?").get(id));
  if (!value) throw new Error("Participant not found");
  return value;
}

function withScore(experiment: LiveExperiment, value: LiveParticipant): LiveParticipantView {
  // Cells are reviewable even before an answer key exists; accuracy only
  // becomes meaningful once the instructor provides one.
  return { ...value, score: value.status === "submitted" ? scoreLive(experiment.gold, value.rows, value.overrides) : null };
}

export function getLiveDashboard(experimentId: string): LiveDashboard {
  const experiment = getLiveExperiment(experimentId);
  return { experiment, participants: participants(experimentId).map((value) => withScore(experiment, value)) };
}

export function joinLiveExperiment(experimentId: string, input: { userKey: unknown; alias: unknown }): LiveParticipant {
  const userKey = required(input.userKey, "Account", 120);
  const alias = required(input.alias, "Student name", 80);
  return db().transaction(() => {
    const experiment = getLiveExperiment(experimentId);
    const existing = read<LiveParticipant>(db().prepare("SELECT payload FROM live_participants WHERE experiment_id = ? AND user_key = ?").get(experimentId, userKey));
    if (existing) return existing;
    if (experiment.status !== "open") throw new Error("This experiment has already started. Ask your instructor about the next session");
    const value: LiveParticipant = {
      id: randomUUID(), experimentId, userKey, alias, groupNo: null, mode: null,
      status: "waiting", rows: [], version: 0,
      startedAt: null, extractionAttemptAt: null, extractedAt: null, submittedAt: null,
      elapsedSeconds: null, error: null, overrides: {}, reviewNote: "", reviewedAt: null,
    };
    db().prepare("INSERT INTO live_participants VALUES (?, ?, ?, ?)").run(value.id, experimentId, userKey, JSON.stringify(value));
    return value;
  })();
}

export function findLiveParticipant(userKey: string): LiveParticipant | null {
  return read<LiveParticipant>(db().prepare("SELECT payload FROM live_participants WHERE user_key = ? ORDER BY rowid DESC LIMIT 1").get(userKey));
}

export function setLivePaper(experimentId: string, input: { sourceId: unknown; paperTitle: unknown }): LiveExperiment {
  const sourceId = required(input.sourceId, "Paper", 80);
  const paperTitle = required(input.paperTitle, "Paper title", 1000);
  if (!/^[0-9a-f-]{36}$/i.test(sourceId)) throw new Error("Invalid paper ID");
  const experiment = getLiveExperiment(experimentId);
  if (experiment.status !== "open") throw new Error("The paper is fixed once the experiment starts");
  experiment.paperSourceId = sourceId;
  experiment.paperTitle = paperTitle;
  writeExperiment(experiment);
  return experiment;
}

export function setLiveGold(experimentId: string, input: unknown): LiveExperiment {
  const gold = validateSimpleRows(input);
  if (gold.some((row) => Object.values(row).some((cell) => !cell))) throw new Error("Complete all six answer-key fields. Enter NR for unreported values");
  const experiment = getLiveExperiment(experimentId);
  experiment.gold = gold;
  writeExperiment(experiment);
  // A changed answer key invalidates earlier teacher marks, mirroring the classic lab.
  for (const value of participants(experimentId)) {
    value.overrides = {}; value.reviewNote = ""; value.reviewedAt = null; value.version++;
    writeParticipant(value);
  }
  return experiment;
}

export function startLiveExperiment(experimentId: string): LiveExperiment {
  return db().transaction(() => {
    const experiment = getLiveExperiment(experimentId);
    if (experiment.status !== "open") throw new Error("This experiment has already started");
    if (!experiment.paperSourceId) throw new Error("Upload the experiment paper first");
    const joined = participants(experimentId);
    if (!joined.length) throw new Error("Wait for at least one student to join");
    joined.forEach((value, index) => {
      value.groupNo = (index % experiment.groupCount) + 1;
      // No AI model is connected in the current deployment: every group uses
      // the manual channel. Restore `value.groupNo % 2 === 1 ? "ai" : "manual"`
      // to bring back alternating AI/manual groups.
      value.mode = "manual";
      value.status = "idle"; value.version++;
      writeParticipant(value);
    });
    experiment.status = "running";
    experiment.startedAt = new Date().toISOString();
    writeExperiment(experiment);
    return experiment;
  })();
}

export function finishLiveExperiment(experimentId: string): LiveExperiment {
  const experiment = getLiveExperiment(experimentId);
  if (experiment.status !== "running") throw new Error("Only a running experiment can be finished");
  experiment.status = "finished";
  experiment.finishedAt = new Date().toISOString();
  writeExperiment(experiment);
  return experiment;
}

function change(id: string, version: unknown, update: (value: LiveParticipant) => void): LiveParticipantView {
  return db().transaction(() => {
    const value = participant(id);
    if (!Number.isInteger(version) || version !== value.version) throw new Error("The record has changed. Refresh and try again");
    update(value); value.version++;
    writeParticipant(value);
    return withScore(getLiveExperiment(value.experimentId), value);
  })();
}

function requireRunningPaper(experiment: LiveExperiment): void {
  if (experiment.status !== "running") throw new Error("The experiment is not running");
  if (!experiment.paperSourceId) throw new Error("The instructor has not uploaded the paper yet");
}

export function saveLiveDraft(id: string, input: { version: unknown; rows: unknown }): LiveParticipantView {
  return change(id, input.version, (value) => {
    if (value.status === "submitted" || value.status === "extracting" || (value.mode === "ai" && value.status !== "review")) throw new Error("Editing is not available in the current state");
    // Manual work is timed from the first saved edit; AI work times from extraction.
    value.startedAt ??= new Date().toISOString();
    value.rows = validateSimpleRows(input.rows);
  });
}

export function startLiveExtraction(id: string, version: unknown): LiveParticipantView {
  return change(id, version, (value) => {
    requireRunningPaper(getLiveExperiment(value.experimentId));
    const attempt = value.extractionAttemptAt ?? value.startedAt;
    const stale = value.status === "extracting" && attempt && Date.now() - Date.parse(attempt) >= 360_000;
    if (value.mode !== "ai" || (!["idle", "error"].includes(value.status) && !stale)) throw new Error("AI extraction is not available in the current state. Wait 6 minutes before retrying a running task");
    value.status = "extracting"; value.extractionAttemptAt = new Date().toISOString();
    value.startedAt ??= value.extractionAttemptAt; value.error = null;
  });
}

export function finishLiveExtraction(id: string, version: unknown, rows: unknown): LiveParticipantView {
  return change(id, version, (value) => {
    if (value.mode !== "ai" || value.status !== "extracting") throw new Error("The extraction task state has changed");
    value.rows = validateSimpleRows(rows); value.status = "review"; value.extractedAt = new Date().toISOString();
  });
}

export function failLiveExtraction(id: string, version: unknown, message: string): LiveParticipantView {
  return change(id, version, (value) => {
    if (value.mode !== "ai" || value.status !== "extracting") throw new Error("The extraction task state has changed");
    value.status = "idle"; value.error = message.slice(0, 500);
  });
}

export function submitLive(id: string, input: { version: unknown; rows: unknown }): LiveParticipantView {
  return change(id, input.version, (value) => {
    const experiment = getLiveExperiment(value.experimentId);
    requireRunningPaper(experiment);
    if (value.status === "submitted" || value.status === "extracting" || (value.mode === "ai" && value.status === "review" && (!value.startedAt || !value.extractedAt))) throw new Error("Complete extraction and review first");
    const rows = validateSimpleRows(input.rows), submittedAt = new Date().toISOString();
    if (rows.every((row) => Object.values(row).every((cell) => !cell))) throw new Error("Enter the extraction results");
    // Both channels are timed automatically: manual work starts at the first
    // saved edit (falling back to the experiment start), AI work at extraction.
    value.startedAt ??= experiment.startedAt ?? submittedAt;
    value.rows = rows; value.submittedAt = submittedAt; value.status = "submitted";
    value.elapsedSeconds = Math.max(0.001, (Date.parse(submittedAt) - Date.parse(value.startedAt)) / 1000);
  });
}

export function reviewLive(id: string, input: { version: unknown; overrides: unknown; note?: unknown }): LiveParticipantView {
  return change(id, input.version, (value) => {
    const experiment = getLiveExperiment(value.experimentId);
    if (value.status !== "submitted") throw new Error("Review requires a submission");
    if (!input.overrides || typeof input.overrides !== "object" || Array.isArray(input.overrides)) throw new Error("Invalid review format");
    const keys = new Set(scoreLive(experiment.gold, value.rows).cells.map((cell) => cell.key));
    const overrides: Record<string, LiveMark> = {};
    for (const [key, mark] of Object.entries(input.overrides as Record<string, unknown>)) {
      if (!keys.has(key) || !["correct", "incorrect", "uncertain"].includes(String(mark))) throw new Error("Invalid review field");
      overrides[key] = mark as LiveMark;
    }
    if (input.note !== undefined && (typeof input.note !== "string" || input.note.length > 2000)) throw new Error("Review notes must be at most 2,000 characters");
    value.overrides = overrides; value.reviewNote = typeof input.note === "string" ? input.note.trim() : ""; value.reviewedAt = new Date().toISOString();
  });
}

export function getLiveStudent(id: string): LiveStudentState {
  const value = participant(id);
  const experiment = getLiveExperiment(value.experimentId);
  return {
    participant: withScore(experiment, value),
    experiment: {
      id: experiment.id, name: experiment.name, status: experiment.status, groupCount: experiment.groupCount,
      paperTitle: experiment.paperTitle, hasPaper: Boolean(experiment.paperSourceId), hasAnswerKey: experiment.gold.length > 0,
    },
    joinedCount: participants(experiment.id).length,
  };
}
