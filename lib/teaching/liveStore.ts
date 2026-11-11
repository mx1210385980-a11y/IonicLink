import { randomUUID } from "node:crypto";
import { getTeachingDb } from "./store";
import { liveDomain, validateLiveRows } from "./liveFields";
import { scoreLive, type LiveAssessmentPolicy, type LiveDashboard, type LiveExperiment, type LiveMark, type LiveParticipant, type LiveParticipantView, type LiveStudentState } from "./liveShared";

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

export function createLiveExperiment(input: { name: unknown; groupCount: unknown; domain?: unknown; channel?: unknown; classroomVersion?: 2 }): LiveExperiment {
  const name = required(input.name, "Experiment name", 100);
  const groupCount = Number(input.groupCount);
  if (!Number.isInteger(groupCount) || groupCount < 2 || groupCount > 8) throw new Error("Choose 2–8 groups");
  const domain = liveDomain(input.domain);
  const channel = input.channel ?? "manual";
  if (channel !== "manual" && channel !== "alternating") throw new Error("Choose a supported extraction channel.");
  const value: LiveExperiment = {
    id: randomUUID(), name, domain, channel, groupCount, status: "open",
    paperSourceId: "", paperTitle: "", gold: [],
    ...(input.classroomVersion ? { classroomVersion: input.classroomVersion, keyVersion: 0, round: 1 as const } : {}),
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
  return { ...value, score: value.status === "submitted" ? scoreLive(experiment.gold, value.rows, value.overrides, experiment.domain, experiment.assessmentPolicy) : null };
}

export function getLiveDashboard(experimentId: string): LiveDashboard {
  const experiment = getLiveExperiment(experimentId);
  const previous = experiment.previousRoundId ? getLiveExperiment(experiment.previousRoundId) : null;
  return { experiment, participants: participants(experimentId).map((value) => withScore(experiment, value)),
    ...(previous ? { previousRound: { experiment: previous, participants: participants(previous.id).map((value) => withScore(previous, value)) } } : {}) };
}

export function joinLiveExperiment(experimentId: string, input: { userKey: unknown; alias: unknown }): LiveParticipant {
  const userKey = required(input.userKey, "Account", 120);
  const alias = required(input.alias, "Student name", 80);
  return db().transaction(() => {
    const experiment = getLiveExperiment(experimentId);
    const existing = read<LiveParticipant>(db().prepare("SELECT payload FROM live_participants WHERE experiment_id = ? AND user_key = ?").get(experimentId, userKey));
    if (existing) return existing;
    const active = findLiveParticipant(userKey);
    if (active && getLiveExperiment(active.experimentId).status !== "finished") throw new Error("Finish your current classroom before joining another one");
    if (experiment.status !== "open") throw new Error("This experiment has already started. Ask your instructor about the next session");
    if (experiment.previousRoundId) throw new Error("Round 2 keeps the original roster; ask your instructor about the next session");
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
  if (experiment.previousRoundId && getLiveExperiment(experiment.previousRoundId).paperSourceId === sourceId) throw new Error("Use a different paper for round 2");
  experiment.paperSourceId = sourceId;
  experiment.paperTitle = paperTitle;
  // A replacement paper must never retain an answer key for another source.
  experiment.gold = []; experiment.assessmentPolicy = undefined; experiment.taskInstructions = undefined; experiment.keyVersion = (experiment.keyVersion ?? 0) + 1;
  writeExperiment(experiment);
  return experiment;
}

export function setLiveGold(experimentId: string, input: unknown, options?: { keyVersion?: unknown; assessmentPolicy?: unknown; taskInstructions?: unknown }): LiveExperiment {
  return db().transaction(() => {
    const experiment = getLiveExperiment(experimentId);
    if (options?.keyVersion !== undefined && options.keyVersion !== (experiment.keyVersion ?? 0)) throw Object.assign(new Error("The answer key changed in another session. Reopen the classroom before saving."), { status: 409 });
    const gold = validateLiveRows(input, experiment.domain);
    if (gold.some((row) => Object.values(row).some((cell) => !cell))) throw new Error("Complete all answer-key fields. Enter NR for unreported values");
    experiment.gold = gold;
    if (options?.assessmentPolicy !== undefined) {
      const policy = options.assessmentPolicy as LiveAssessmentPolicy;
      const absolute = typeof policy?.absoluteTolerance === "string" ? policy.absoluteTolerance.trim().match(/^(\d+(?:\.\d+)?(?:e[+-]?\d+)?)\s*([A-Za-zµμΩÅ°%][A-Za-z0-9µμΩÅ°%/^*.\s-]*)$/i) : null;
      if (!policy || typeof policy.relativeTolerancePercent !== "number" || !Number.isFinite(policy.relativeTolerancePercent) || policy.relativeTolerancePercent < 0 || policy.relativeTolerancePercent > 20 || typeof policy.absoluteTolerance !== "string" || policy.absoluteTolerance.length > 80 || (policy.absoluteTolerance.trim() && (!absolute || !Number.isFinite(Number(absolute[1]))))) throw new Error("Use a tolerance from 0 to 20 percent and an optional finite non-negative absolute tolerance with unit");
      experiment.assessmentPolicy = { relativeTolerancePercent: policy.relativeTolerancePercent, absoluteTolerance: policy.absoluteTolerance.trim() };
    }
    if (options?.taskInstructions !== undefined) {
      if (typeof options.taskInstructions !== "string" || options.taskInstructions.length > 3000) throw new Error("Keep the lesson instructions within 3,000 characters");
      experiment.taskInstructions = options.taskInstructions.trim();
    }
    experiment.keyVersion = (experiment.keyVersion ?? 0) + 1;
    writeExperiment(experiment);
    // Only submissions carry marks. Never invalidate an in-flight AI attempt
    // or a student's unsaved draft just because the instructor changed gold.
    for (const value of participants(experimentId).filter((item) => item.status === "submitted")) {
      value.overrides = {}; value.reviewNote = ""; value.reviewedAt = null; value.version++;
      writeParticipant(value);
    }
    return experiment;
  })();
}

export function startLiveExperiment(experimentId: string): LiveExperiment {
  return db().transaction(() => {
    const experiment = getLiveExperiment(experimentId);
    if (experiment.status !== "open") throw new Error("This experiment has already started");
    if (!experiment.paperSourceId) throw new Error("Upload the experiment paper first");
    if (experiment.classroomVersion === 2 && !experiment.gold.length) throw new Error("Save the answer key before starting this classroom");
    const joined = participants(experimentId);
    if (!joined.length) throw new Error("Wait for at least one student to join");
    joined.forEach((value, index) => {
      if (!experiment.previousRoundId) {
        value.groupNo = (index % experiment.groupCount) + 1;
        value.mode = experiment.channel === "alternating" && value.groupNo % 2 === 1 ? "ai" : "manual";
      }
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
    if (!Number.isInteger(version) || version !== value.version) throw Object.assign(new Error("The record has changed. Your draft is kept locally; refresh and retry."), { status: 409 });
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
    const experiment = getLiveExperiment(value.experimentId);
    requireRunningPaper(experiment);
    if (value.status === "submitted" || value.status === "extracting" || (value.mode === "ai" && value.status !== "review")) throw new Error("Editing is not available in the current state");
    // Manual work is timed from the first saved edit; AI work times from extraction.
    value.startedAt ??= new Date().toISOString();
    value.rows = validateLiveRows(input.rows, experiment.domain);
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

export function finishLiveExtraction(id: string, version: unknown, rows: unknown, afmArtifactId?: string): LiveParticipantView {
  return change(id, version, (value) => {
    if (value.mode !== "ai" || value.status !== "extracting") throw new Error("The extraction task state has changed");
    requireRunningPaper(getLiveExperiment(value.experimentId));
    value.rows = validateLiveRows(rows, getLiveExperiment(value.experimentId).domain); value.status = "review"; value.extractedAt = new Date().toISOString();
    if (afmArtifactId) value.afmArtifactId = afmArtifactId;
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
    if (value.status === "submitted" || value.status === "extracting" || (value.mode === "ai" && (value.status !== "review" || !value.startedAt || !value.extractedAt))) throw new Error("Complete extraction and review first");
    const rows = validateLiveRows(input.rows, experiment.domain), submittedAt = new Date().toISOString();
    if (rows.every((row) => Object.values(row).every((cell) => !cell))) throw new Error("Enter the extraction results");
    if (experiment.classroomVersion === 2 && rows.some((row) => Object.values(row).some((cell) => !cell))) throw new Error("Complete all observation fields. Use NR for unreported information");
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
    const keys = new Set(scoreLive(experiment.gold, value.rows, {}, experiment.domain, experiment.assessmentPolicy).cells.map((cell) => cell.key));
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
      id: experiment.id, name: experiment.name, domain: experiment.domain, channel: experiment.channel, status: experiment.status, groupCount: experiment.groupCount,
      paperTitle: experiment.paperTitle, round: experiment.round, assessmentPolicy: experiment.assessmentPolicy, classroomVersion: experiment.classroomVersion, taskInstructions: experiment.taskInstructions, hasPaper: Boolean(experiment.paperSourceId), hasAnswerKey: experiment.gold.length > 0,
    },
    joinedCount: participants(experiment.id).length,
  };
}

/** Optional crossover: a new paper/key, the same roster/groups and opposite methods. */
export function prepareLiveSecondRound(experimentId: string): LiveExperiment {
  return db().transaction(() => {
    const previous = getLiveExperiment(experimentId);
    if (previous.nextRoundId) return getLiveExperiment(previous.nextRoundId);
    if (previous.status !== "finished" || previous.channel !== "alternating" || previous.previousRoundId) throw new Error("Finish round 1 of an alternating-method classroom first");
    const roster = participants(previous.id);
    if (!roster.length || roster.some((p) => p.status !== "submitted")) throw new Error("Every participant must submit round 1 before creating the crossover round");
    const next = createLiveExperiment({ name: `${previous.name.slice(0, 85)} — Round 2`, domain: previous.domain, groupCount: previous.groupCount, channel: "alternating", classroomVersion: 2 });
    next.round = 2; next.previousRoundId = previous.id; writeExperiment(next);
    for (const p of roster) {
      const seat: LiveParticipant = { ...p, id: randomUUID(), experimentId: next.id, mode: p.mode === "ai" ? "manual" : "ai", status: "waiting", rows: [], version: 0,
        startedAt: null, extractionAttemptAt: null, extractedAt: null, submittedAt: null, elapsedSeconds: null, error: null,
        overrides: {}, reviewNote: "", reviewedAt: null, afmArtifactId: undefined };
      db().prepare("INSERT INTO live_participants VALUES (?, ?, ?, ?)").run(seat.id, next.id, seat.userKey, JSON.stringify(seat));
    }
    previous.nextRoundId = next.id; writeExperiment(previous);
    return next;
  })();
}
