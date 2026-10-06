import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { getTeachingDb } from "./store";
import { scoreSimpleRows, validateSimpleRows } from "./simpleScoring";
import type { SimpleDashboard, SimpleExperiment, SimplePaperTask, SimpleRow, SimpleStudent, SimpleStudentState } from "./simpleShared";
import { simpleGroupAssignment } from "./simpleShared";

function db() {
  const store = getTeachingDb();
  store.exec(`CREATE TABLE IF NOT EXISTS simple_experiments (
    id TEXT PRIMARY KEY, ai_code TEXT NOT NULL UNIQUE, manual_code TEXT NOT NULL UNIQUE, payload TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS simple_students (
    id TEXT PRIMARY KEY, experiment_id TEXT NOT NULL REFERENCES simple_experiments(id),
    alias_key TEXT NOT NULL, payload TEXT NOT NULL, UNIQUE(experiment_id, alias_key));
    CREATE TABLE IF NOT EXISTS simple_paper_tasks (
    id TEXT PRIMARY KEY, experiment_id TEXT NOT NULL REFERENCES simple_experiments(id),
    fingerprint TEXT NOT NULL, payload TEXT NOT NULL, UNIQUE(experiment_id, fingerprint));`);
  // Legacy answers may conflict for the same paper. Preserve each answer-key cohort
  // and every existing score/version instead of silently choosing one answer key.
  store.transaction(() => {
    const pending = store.prepare("SELECT payload FROM simple_students WHERE json_extract(payload, '$.taskId') IS NULL").all();
    for (const row of pending) {
      const value = read<SimpleStudent>(row)!;
      const experiment = read<SimpleExperiment>(store.prepare("SELECT payload FROM simple_experiments WHERE id = ?").get(value.experimentId));
      const paper = value.paper ?? experiment;
      if (!paper?.sourceId) continue;
      const fingerprint = `legacy:${createHash("sha256").update(JSON.stringify([paper.sourceId, paper.gold])).digest("hex")}`;
      const task = findOrCreateTask(store, value.experimentId, paper.sourceId, paper.paperTitle, fingerprint, paper.gold);
      value.taskId = task.id;
      store.prepare("UPDATE simple_students SET payload = ? WHERE id = ?").run(JSON.stringify(value), value.id);
    }
  })();
  return store;
}
function findOrCreateTask(store: ReturnType<typeof getTeachingDb>, experimentId: string, sourceId: string, paperTitle: string, fingerprint: string, gold: SimpleRow[] = []): SimplePaperTask {
  const existing = read<SimplePaperTask>(store.prepare("SELECT payload FROM simple_paper_tasks WHERE experiment_id = ? AND fingerprint = ?").get(experimentId, fingerprint));
  if (existing) return existing;
  const value: SimplePaperTask = { id: randomUUID(), experimentId, sourceId, paperTitle, fingerprint, gold, version: 0, createdAt: new Date().toISOString() };
  store.prepare("INSERT INTO simple_paper_tasks VALUES (?, ?, ?, ?)").run(value.id, experimentId, fingerprint, JSON.stringify(value));
  return value;
}
export function getSimpleTask(id: string): SimplePaperTask {
  const value = read<SimplePaperTask>(db().prepare("SELECT payload FROM simple_paper_tasks WHERE id = ?").get(id));
  if (!value) throw new Error("Paper task not found");
  return value;
}
function required(value: string, label: string, max = 200): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max) throw new Error(`Invalid ${label}`);
  return value.trim();
}
function read<T>(row: unknown): T | null { return row ? JSON.parse((row as { payload: string }).payload) as T : null; }
export function getSimpleExperiment(id: string): SimpleExperiment {
  const value = read<SimpleExperiment>(db().prepare("SELECT payload FROM simple_experiments WHERE id = ?").get(id));
  if (!value) throw new Error("Experiment not found");
  return value;
}
export function listSimpleExperiments(): SimpleExperiment[] {
  return db().prepare("SELECT payload FROM simple_experiments ORDER BY rowid DESC").all().map(row => read<SimpleExperiment>(row)!);
}
export function createSimpleExperiment(input: { name: string; sourceId?: string; paperTitle?: string; gold?: SimpleRow[]; design?: "crossover" }): SimpleExperiment {
  const gold = input.gold?.length ? validateSimpleRows(input.gold) : [];
  if (gold.some(row => Object.values(row).some(cell => !cell))) throw new Error("Complete all six answer-key fields. Enter NR for unreported values");
  const value: SimpleExperiment = { id: randomUUID(), name: required(input.name, "Experiment name"),
    ...(input.design === "crossover" ? { design: input.design } : {}),
    sourceId: input.sourceId ? required(input.sourceId, "Paper") : "", paperTitle: input.paperTitle ? required(input.paperTitle, "Paper title", 1000) : "", gold,
    aiInviteCode: `A${randomBytes(6).toString("hex").toUpperCase()}`,
    manualInviteCode: `M${randomBytes(6).toString("hex").toUpperCase()}`, createdAt: new Date().toISOString() };
  const store = db();
  store.transaction(() => {
    store.prepare("INSERT INTO simple_experiments VALUES (?, ?, ?, ?)").run(value.id, value.aiInviteCode, value.manualInviteCode, JSON.stringify(value));
    if (value.design === "crossover") for (let paperNo = 1; paperNo <= 4; paperNo++) {
      const task = findOrCreateTask(store, value.id, "", `Paper ${paperNo}`, `slot:${paperNo}`);
      task.paperNo = paperNo;
      store.prepare("UPDATE simple_paper_tasks SET payload = ? WHERE id = ?").run(JSON.stringify(task), task.id);
    }
  })();
  return value;
}
export function joinSimpleExperiment(code: string, alias: string, resumeCode?: string): { experimentId: string; participantId: string } {
  const invite = required(code, "Invite code", 40).toUpperCase();
  const studentAlias = required(alias, "Student name / ID", 80);
  if (resumeCode !== undefined && (typeof resumeCode !== "string" || resumeCode.length > 80)) throw new Error("Invalid recovery code");
  const store = db();
  return store.transaction(() => {
    const experiment = read<SimpleExperiment>(store.prepare("SELECT payload FROM simple_experiments WHERE ai_code = ? OR manual_code = ?").get(invite, invite));
    if (!experiment) throw new Error("Invalid invite code");
    if (experiment.design === "crossover") throw new Error("Choose one of the four experiment groups");
    // The private recovery credential proves ownership; the group remains fixed.
    const aliasKey = studentAlias.normalize("NFKC").toLowerCase().replace(/\s+/g, " ");
    const invitedMode = invite === experiment.aiInviteCode ? "ai" : "manual";
    const existing = store.prepare("SELECT id FROM simple_students WHERE experiment_id = ? AND alias_key = ?").get(experiment.id, aliasKey) as { id: string } | undefined;
    if (existing) {
      const value = student(existing.id);
      const digest = (code: string) => createHash("sha256").update(code).digest();
      const valid = timingSafeEqual(digest(value.resumeCode), digest(resumeCode?.trim() ?? ""));
      if (!valid || value.mode !== invitedMode) throw new Error("This student has already joined. Check the original group invite code and personal recovery code");
      return { experimentId: experiment.id, participantId: value.id };
    }
    const value: SimpleStudent = { id: randomUUID(), experimentId: experiment.id, studentAlias, resumeCode: randomBytes(16).toString("base64url"),
      mode: invite === experiment.aiInviteCode ? "ai" : "manual", status: "idle", rows: [], version: 0,
      startedAt: null, extractedAt: null, extractionAttemptAt: null, submittedAt: null, elapsedSeconds: null, error: null,
      score: null, overrides: {}, reviewNote: "", reviewedAt: null };
    store.prepare("INSERT INTO simple_students VALUES (?, ?, ?, ?)").run(value.id, experiment.id, aliasKey, JSON.stringify(value));
    return { experimentId: experiment.id, participantId: value.id };
  })();
}
function insertGroupAttempt(experimentId: string, groupNo: number, alias: string, learnerId: string, roundNo: number): SimpleStudent {
  const store = db();
  const { paperNo, mode } = simpleGroupAssignment(groupNo, roundNo);
  const task = read<SimplePaperTask>(store.prepare("SELECT payload FROM simple_paper_tasks WHERE experiment_id = ? AND fingerprint = ?").get(experimentId, `slot:${paperNo}`));
  if (!task) throw new Error("Paper task not found");
  const value: SimpleStudent = { id: randomUUID(), experimentId, studentAlias: alias, learnerId, groupNo, roundNo, paperNo, taskId: task.id,
    resumeCode: randomBytes(16).toString("base64url"), mode, status: "idle", rows: [], version: 0,
    startedAt: null, extractedAt: null, extractionAttemptAt: null, submittedAt: null, elapsedSeconds: null, error: null,
    score: null, overrides: {}, reviewNote: "", reviewedAt: null };
  store.prepare("INSERT INTO simple_students VALUES (?, ?, ?, ?)").run(value.id, experimentId, `learner:${learnerId}:${roundNo}`, JSON.stringify(value));
  return value;
}
export function joinSimpleGroup(experimentId: string, groupNo: number, alias: string): { experimentId: string; participantId: string } {
  if (!Number.isInteger(groupNo) || groupNo < 1 || groupNo > 4) throw new Error("Choose group 1–4");
  if (getSimpleExperiment(experimentId).design !== "crossover") throw new Error("This experiment does not use four groups");
  const studentAlias = required(alias, "Student name / ID", 80);
  return db().transaction(() => {
    const value = insertGroupAttempt(experimentId, groupNo, studentAlias, randomUUID(), 1);
    return { experimentId, participantId: value.id };
  })();
}
function learnerAttempts(value: SimpleStudent): SimpleStudent[] {
  if (!value.learnerId) return [value];
  return db().prepare("SELECT payload FROM simple_students WHERE experiment_id = ? AND json_extract(payload, '$.learnerId') = ? ORDER BY json_extract(payload, '$.roundNo')").all(value.experimentId, value.learnerId).map(row => read<SimpleStudent>(row)!);
}
export function getCurrentSimpleStudentId(id: string): string {
  return learnerAttempts(student(id)).at(-1)!.id;
}
export function nextSimpleRound(id: string, version: number): SimpleStudentState {
  return db().transaction(() => {
    const value = student(id);
    if (!value.learnerId || value.roundNo !== 1 || value.status !== "submitted") throw new Error("Submit round 1 before starting round 2");
    const existing = learnerAttempts(value).find(attempt => attempt.roundNo === 2);
    if (existing) return getSimpleStudent(existing.id);
    if (!Number.isInteger(version) || version !== value.version) throw new Error("The record has changed. Refresh and try again");
    const next = insertGroupAttempt(value.experimentId, value.groupNo!, value.studentAlias, value.learnerId, 2);
    return getSimpleStudent(next.id);
  })();
}
function student(id: string): SimpleStudent {
  const value = read<SimpleStudent>(db().prepare("SELECT payload FROM simple_students WHERE id = ?").get(id));
  if (!value) throw new Error("Student record not found");
  // Populate credentials for records created before recovery was introduced.
  if (!value.resumeCode) {
    value.resumeCode = randomBytes(16).toString("base64url");
    db().prepare("UPDATE simple_students SET payload = ? WHERE id = ?").run(JSON.stringify(value), id);
  }
  return value;
}
export function getSimpleStudent(id: string): SimpleStudentState {
  const value = student(id), experiment = getSimpleExperiment(value.experimentId);
  const { score, paper, overrides: _overrides, reviewNote: _note, reviewedAt: _reviewedAt, ...safe } = value;
  const visiblePaper = paper ? { sourceId: paper.sourceId, paperTitle: paper.paperTitle } : undefined;
  const task = value.taskId ? getSimpleTask(value.taskId) : undefined;
  return { ...safe, ...(visiblePaper ? { paper: visiblePaper } : {}), pendingGrade: value.status === "submitted" && !score,
    ...(task ? { task: { id: task.id, paperTitle: task.paperTitle } } : {}),
    ...(value.learnerId ? { rounds: learnerAttempts(value).map(attempt => ({ id: attempt.id, roundNo: attempt.roundNo!, paperNo: attempt.paperNo!, mode: attempt.mode, status: attempt.status, elapsedSeconds: attempt.elapsedSeconds, result: attempt.score ? { machineAccuracy: attempt.score.machineAccuracy, accuracy: attempt.score.accuracy } : null })) } : {}),
    experiment: { id: experiment.id, name: experiment.name, sourceId: paper?.sourceId ?? task?.sourceId ?? experiment.sourceId, paperTitle: paper?.paperTitle ?? task?.paperTitle ?? experiment.paperTitle },
    result: score ? { machineAccuracy: score.machineAccuracy, accuracy: score.accuracy } : null };
}
export function getSimpleDashboard(experimentId: string): SimpleDashboard {
  return { experiment: getSimpleExperiment(experimentId), students: db().prepare("SELECT id FROM simple_students WHERE experiment_id = ? ORDER BY rowid").all(experimentId).map(row => student((row as { id: string }).id)),
    tasks: db().prepare("SELECT payload FROM simple_paper_tasks WHERE experiment_id = ? ORDER BY rowid").all(experimentId).map(row => read<SimplePaperTask>(row)!) };
}
function change(id: string, version: number, update: (value: SimpleStudent) => void): SimpleStudentState {
  const store = db();
  return store.transaction(() => {
    const value = student(id);
    if (!Number.isInteger(version) || version !== value.version) throw new Error("The record has changed. Refresh and try again");
    update(value); value.version++;
    store.prepare("UPDATE simple_students SET payload = ? WHERE id = ?").run(JSON.stringify(value), id);
    return getSimpleStudent(id);
  })();
}
export function saveSimpleDraft(id: string, input: { version: number; rows: SimpleRow[] }): SimpleStudentState {
  return change(id, input.version, value => {
    if (value.status === "submitted" || value.status === "extracting" || (value.mode === "ai" && value.status !== "review")) throw new Error("Editing is not available in the current state");
    value.rows = validateSimpleRows(input.rows);
  });
}
function studentGold(value: SimpleStudent): SimpleRow[] {
  if (value.taskId) return getSimpleTask(value.taskId).gold;
  return value.paper?.gold ?? getSimpleExperiment(value.experimentId).gold;
}
function requireStudentPaper(value: SimpleStudent): void {
  if (!(value.paper?.sourceId ?? (value.taskId ? getSimpleTask(value.taskId).sourceId : getSimpleExperiment(value.experimentId).sourceId))) throw new Error("Upload your paper PDF first");
}
export function attachSimpleStudentPaper(id: string, input: { version: number; sourceId: string; paperTitle: string; fingerprint?: string }): SimpleStudentState {
  return change(id, input.version, value => {
    if (value.status === "extracting" || value.status === "submitted") throw new Error("Paper replacement is not available in the current state");
    const sourceId = required(input.sourceId, "Paper");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sourceId)) throw new Error("Invalid paper ID");
    const paperTitle = required(input.paperTitle, "Paper title", 1000);
    const fingerprint = input.fingerprint ? required(input.fingerprint, "Paper fingerprint") : `source:${sourceId}`;
    let task: SimplePaperTask;
    if (value.paperNo && value.taskId) {
      if (!input.fingerprint) throw new Error("Paper content fingerprint is required");
      task = getSimpleTask(value.taskId);
      if (task.contentFingerprint && task.contentFingerprint !== fingerprint) throw new Error("This paper slot is already bound to a different document");
      const otherTasks = getSimpleDashboard(value.experimentId).tasks;
      if (otherTasks.some(other => other.id !== task.id && other.contentFingerprint === fingerprint)) throw new Error("Use a different paper for each paper number");
      if (!task.sourceId) {
        task.sourceId = sourceId; task.paperTitle = paperTitle; task.contentFingerprint = fingerprint; task.version++;
        db().prepare("UPDATE simple_paper_tasks SET payload = ? WHERE id = ?").run(JSON.stringify(task), task.id);
      }
    } else task = findOrCreateTask(db(), value.experimentId, sourceId, paperTitle, fingerprint);
    value.taskId = task.id;
    value.paper = { sourceId, paperTitle, gold: task.gold };
    value.status = "idle"; value.rows = []; value.startedAt = null; value.extractedAt = null;
    value.extractionAttemptAt = null; value.submittedAt = null; value.elapsedSeconds = null; value.error = null;
    value.score = null; value.overrides = {}; value.reviewNote = ""; value.reviewedAt = null;
  });
}
export function setSimpleStudentGold(id: string, input: { version: number; gold: SimpleRow[] }): SimpleStudentState {
  return db().transaction(() => {
    const value = student(id);
    if (!Number.isInteger(input.version) || input.version !== value.version) throw new Error("The record has changed. Refresh and try again");
    if (!value.taskId) throw new Error("The student must upload a paper first");
    const task = getSimpleTask(value.taskId);
    setSimpleTaskGold(task.id, { version: task.version, gold: input.gold });
    return getSimpleStudent(id);
  })();
}
export function setSimpleTaskGold(id: string, input: { version: number; gold: SimpleRow[] }): SimplePaperTask {
  const store = db();
  return store.transaction(() => {
    const task = getSimpleTask(id);
    if (!Number.isInteger(input.version) || input.version !== task.version) throw new Error("The task has changed. Refresh and try again");
    const gold = validateSimpleRows(input.gold);
    if (gold.some(row => Object.values(row).some(cell => !cell))) throw new Error("Complete all six answer-key fields. Enter NR for unreported values");
    task.gold = gold; task.version++;
    store.prepare("UPDATE simple_paper_tasks SET payload = ? WHERE id = ?").run(JSON.stringify(task), id);
    for (const row of store.prepare("SELECT payload FROM simple_students WHERE experiment_id = ?").all(task.experimentId)) {
      const value = read<SimpleStudent>(row)!;
      if (value.taskId !== task.id) continue;
      if (value.paper) value.paper.gold = gold;
      value.overrides = {}; value.reviewNote = ""; value.reviewedAt = null;
      if (value.status === "submitted") { value.score = scoreSimpleRows(gold, value.rows); value.version++; }
      store.prepare("UPDATE simple_students SET payload = ? WHERE id = ?").run(JSON.stringify(value), value.id);
    }
    return task;
  })();
}
export function startSimpleExtraction(id: string, version: number): SimpleStudentState {
  return change(id, version, value => {
    requireStudentPaper(value);
    const attempt = value.extractionAttemptAt ?? value.startedAt;
    const stale = value.status === "extracting" && attempt && Date.now() - Date.parse(attempt) >= 360_000;
    if (value.mode !== "ai" || (!["idle", "error"].includes(value.status) && !stale)) throw new Error("AI extraction is not available in the current state. Wait 6 minutes before retrying a running task");
    value.status = "extracting"; value.extractionAttemptAt = new Date().toISOString();
    value.startedAt ??= value.extractionAttemptAt; value.error = null;
  });
}
export function finishSimpleExtraction(id: string, version: number, rows: SimpleRow[]): SimpleStudentState {
  return change(id, version, value => {
    if (value.mode !== "ai" || value.status !== "extracting") throw new Error("The extraction task state has changed");
    value.rows = validateSimpleRows(rows); value.status = "review"; value.extractedAt = new Date().toISOString();
  });
}
export function failSimpleExtraction(id: string, version: number, message: string): SimpleStudentState {
  return change(id, version, value => {
    if (value.mode !== "ai" || value.status !== "extracting") throw new Error("The extraction task state has changed");
    value.status = "error"; value.error = message.slice(0, 500);
  });
}
export function submitSimpleStudent(id: string, input: { version: number; rows: SimpleRow[]; manualSeconds?: number }): SimpleStudentState {
  return change(id, input.version, value => {
    requireStudentPaper(value);
    if (value.status === "submitted" || (value.mode === "ai" && (value.status !== "review" || !value.startedAt || !value.extractedAt))) throw new Error("Complete extraction and review first");
    const rows = validateSimpleRows(input.rows), submittedAt = new Date().toISOString();
    if (rows.every(row => Object.values(row).every(cell => !cell))) throw new Error("Enter the extraction results");
    if (value.mode === "manual" && (typeof input.manualSeconds !== "number" || !Number.isFinite(input.manualSeconds) || input.manualSeconds <= 0 || input.manualSeconds > 604800)) throw new Error("Manual experiment time must be greater than 0 seconds and at most 7 days");
    value.rows = rows; value.submittedAt = submittedAt; value.status = "submitted";
    value.elapsedSeconds = value.mode === "ai" ? Math.max(0.001, (Date.parse(submittedAt) - Date.parse(value.startedAt!)) / 1000) : input.manualSeconds!;
    const gold = studentGold(value);
    value.score = gold.length ? scoreSimpleRows(gold, rows) : null;
  });
}
export function reviewSimpleStudent(id: string, input: { version: number; overrides: Record<string, boolean>; note?: string }): SimpleStudentState {
  return change(id, input.version, value => {
    if (value.status !== "submitted" || !value.score) throw new Error("Review is available after the student submits");
    if (!input.overrides || typeof input.overrides !== "object" || Array.isArray(input.overrides)) throw new Error("Invalid review format");
    const keys = new Set(value.score.cells.map(cell => cell.key));
    for (const [key, correct] of Object.entries(input.overrides)) if (!keys.has(key) || typeof correct !== "boolean") throw new Error("Invalid review field");
    if (input.note !== undefined && (typeof input.note !== "string" || input.note.length > 2000)) throw new Error("Review notes must be at most 2,000 characters");
    value.overrides = { ...input.overrides }; value.reviewNote = input.note?.trim() ?? ""; value.reviewedAt = new Date().toISOString();
    value.score = scoreSimpleRows(studentGold(value), value.rows, value.overrides);
  });
}
