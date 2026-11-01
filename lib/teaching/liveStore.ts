import { randomUUID } from "node:crypto";
import { getTeachingDb } from "./store";
import { validateSimpleRows } from "./simpleScoring";
import { blankLiveRow, LIVE_EXTRACTION_FIELDS, type LiveRow } from "./liveFields";
import {
  liveAssignment, scoreLive,
  type LiveDashboardParticipant, type LiveExperiment, type LiveMark, type LiveMode,
  type LiveParticipant, type LiveRoundResult, type LiveScore, type LiveStudentState, type LiveWorkStatus,
} from "./liveShared";

function now() { return new Date().toISOString(); }
function withLiveDb<T>(fn: (db: ReturnType<typeof getTeachingDb>) => T): T {
  const db = getTeachingDb();
  db.exec(`CREATE TABLE IF NOT EXISTS live_experiments (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS live_participants (id TEXT PRIMARY KEY, experiment_id TEXT NOT NULL, user_key TEXT NOT NULL, payload TEXT NOT NULL, UNIQUE(experiment_id, user_key));`);
  return db.transaction(() => fn(db))();
}

function normalizeExperiment(raw: LiveExperiment): LiveExperiment {
  const legacyPaper = { sourceId: raw.paperSourceId ?? "", paperTitle: raw.paperTitle ?? "", gold: raw.gold ?? [] };
  const papers = Array.from({ length: raw.groupCount }, (_, index) => ({
    sourceId: raw.papers?.[index]?.sourceId ?? (index === 0 ? legacyPaper.sourceId : ""),
    paperTitle: raw.papers?.[index]?.paperTitle ?? (index === 0 ? legacyPaper.paperTitle : ""),
    gold: raw.papers?.[index]?.gold ?? (index === 0 ? legacyPaper.gold : []),
  }));
  const currentRound = Math.max(0, Math.min(raw.groupCount - 1, raw.currentRound ?? 0));
  const current = papers[currentRound];
  return { ...raw, papers, currentRound, paperSourceId: current.sourceId, paperTitle: current.paperTitle, gold: current.gold };
}

function normalizeParticipant(raw: LiveParticipant): LiveParticipant {
  return {
    ...raw,
    round: raw.round ?? 0,
    paperIndex: raw.paperIndex ?? Math.max(0, raw.groupNo - 1),
    history: raw.history ?? [],
    overrides: raw.overrides ?? {},
    reviewNote: raw.reviewNote ?? "",
    reviewedAt: raw.reviewedAt ?? null,
    error: raw.error ?? "",
    exitedAt: raw.exitedAt ?? null,
    startedAt: raw.startedAt ?? null,
    submittedAt: raw.submittedAt ?? null,
    elapsedSeconds: raw.elapsedSeconds ?? null,
  };
}

function readExperiment(db: ReturnType<typeof getTeachingDb>, id: string): LiveExperiment {
  const row = db.prepare("SELECT payload FROM live_experiments WHERE id = ?").get(id) as { payload: string } | undefined;
  if (!row) throw new Error("Experiment not found");
  return normalizeExperiment(JSON.parse(row.payload));
}
function saveExperiment(db: ReturnType<typeof getTeachingDb>, experiment: LiveExperiment) {
  db.prepare("UPDATE live_experiments SET payload = ? WHERE id = ?").run(JSON.stringify(normalizeExperiment(experiment)), experiment.id);
}
function readParticipant(db: ReturnType<typeof getTeachingDb>, id: string): LiveParticipant {
  const row = db.prepare("SELECT payload FROM live_participants WHERE id = ?").get(id) as { payload: string } | undefined;
  if (!row) throw new Error("Student seat not found");
  return normalizeParticipant(JSON.parse(row.payload));
}
function saveParticipant(db: ReturnType<typeof getTeachingDb>, participant: LiveParticipant) {
  db.prepare("UPDATE live_participants SET payload = ? WHERE id = ?").run(JSON.stringify(participant), participant.id);
}
function participants(db: ReturnType<typeof getTeachingDb>, experimentId: string) {
  const rows = db.prepare("SELECT payload FROM live_participants WHERE experiment_id = ?").all(experimentId) as Array<{ payload: string }>;
  return rows.map((row) => normalizeParticipant(JSON.parse(row.payload))).sort((a, b) => a.joinedAt.localeCompare(b.joinedAt));
}
function withScore(participant: LiveParticipant, gold: LiveRow[]): LiveDashboardParticipant {
  return { ...participant, score: participant.status === "submitted" ? scoreLive(gold, participant.rows, participant.overrides) : null };
}
function currentWork(participant: LiveParticipant): LiveRoundResult {
  return {
    round: participant.round, paperIndex: participant.paperIndex, mode: participant.mode, status: participant.status,
    rows: participant.rows, startedAt: participant.startedAt, submittedAt: participant.submittedAt,
    elapsedSeconds: participant.elapsedSeconds, overrides: participant.overrides, reviewNote: participant.reviewNote,
    reviewedAt: participant.reviewedAt, error: participant.error,
  };
}
function workForRound(participant: LiveParticipant, round: number): LiveRoundResult {
  if (participant.round === round) return participant;
  const historical = participant.history.find((item) => item.round === round);
  if (!historical) throw new Error("This student has no result for the selected round");
  return historical;
}
function resetWork(participant: LiveParticipant, experiment: LiveExperiment, startedAt: string | null, waiting = false) {
  const assignment = liveAssignment(participant.groupNo, experiment.currentRound, experiment.groupCount);
  participant.round = experiment.currentRound;
  participant.paperIndex = assignment.paperIndex;
  participant.mode = assignment.mode;
  participant.status = waiting ? "waiting" : "idle";
  participant.rows = [];
  participant.startedAt = startedAt;
  participant.submittedAt = null;
  participant.elapsedSeconds = null;
  participant.overrides = {};
  participant.reviewNote = "";
  participant.reviewedAt = null;
  participant.error = "";
  participant.version += 1;
}

export function createLiveExperiment(input: { name: string; groupCount: number }): LiveExperiment {
  const name = input.name.trim();
  const groupCount = Number(input.groupCount);
  if (!name || name.length > 100) throw new Error("Enter an experiment name (up to 100 characters)");
  if (!Number.isInteger(groupCount) || groupCount < 2 || groupCount > 8 || groupCount % 2 !== 0) throw new Error("Choose an even number of groups: 2, 4, 6, or 8");
  return withLiveDb((db) => {
    const experiment = normalizeExperiment({
      id: randomUUID(), name, groupCount, status: "open", papers: [], currentRound: 0,
      paperSourceId: "", paperTitle: "", gold: [], createdAt: now(), startedAt: null, finishedAt: null,
    });
    db.prepare("INSERT INTO live_experiments (id, payload) VALUES (?, ?)").run(experiment.id, JSON.stringify(experiment));
    return experiment;
  });
}

export function listLiveExperiments() {
  return withLiveDb((db) => (db.prepare("SELECT payload FROM live_experiments").all() as Array<{ payload: string }>)
    .map((row) => normalizeExperiment(JSON.parse(row.payload))).sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
}
export function getLiveExperiment(id: string) { return withLiveDb((db) => readExperiment(db, id)); }

export function setLivePaper(id: string, input: { sourceId: string; paperTitle: string; paperIndex?: number }) {
  return withLiveDb((db) => {
    const experiment = readExperiment(db, id);
    if (experiment.status !== "open") throw new Error("Papers are fixed once the experiment starts");
    const paperIndex = input.paperIndex ?? 0;
    if (!Number.isInteger(paperIndex) || paperIndex < 0 || paperIndex >= experiment.groupCount) throw new Error("Invalid paper number");
    experiment.papers[paperIndex] = { sourceId: input.sourceId, paperTitle: input.paperTitle.slice(0, 300), gold: experiment.papers[paperIndex].gold };
    saveExperiment(db, experiment);
    return getLiveExperiment(id);
  });
}
export function setLiveGold(id: string, value: unknown, paperIndex?: number) {
  return withLiveDb((db) => {
    const experiment = readExperiment(db, id);
    if (experiment.status === "finished") throw new Error("The experiment has finished");
    const index = paperIndex ?? experiment.currentRound;
    if (!Number.isInteger(index) || index < 0 || index >= experiment.groupCount) throw new Error("Invalid paper number");
    experiment.papers[index].gold = validateSimpleRows(value, LIVE_EXTRACTION_FIELDS);
    saveExperiment(db, experiment);
    return getLiveExperiment(id);
  });
}

export function joinLiveExperiment(experimentId: string, input: { userKey: string; alias: string }) {
  return withLiveDb((db) => {
    const experiment = readExperiment(db, experimentId);
    const existing = db.prepare("SELECT payload FROM live_participants WHERE experiment_id = ? AND user_key = ?").get(experimentId, input.userKey) as { payload: string } | undefined;
    if (existing) return normalizeParticipant(JSON.parse(existing.payload));
    if (experiment.status !== "open") throw new Error("This experiment has already started");
    const alias = input.alias.trim();
    if (!alias || alias.length > 40) throw new Error("Enter a display name (up to 40 characters)");
    const participant = normalizeParticipant({
      id: randomUUID(), experimentId, userKey: input.userKey, alias, groupNo: 0, joinedAt: now(), version: 0,
      round: 0, paperIndex: 0, mode: "manual", status: "waiting", rows: [], startedAt: null, submittedAt: null,
      elapsedSeconds: null, overrides: {}, reviewNote: "", reviewedAt: null, error: "", exitedAt: null, history: [],
    });
    db.prepare("INSERT INTO live_participants (id, experiment_id, user_key, payload) VALUES (?, ?, ?, ?)")
      .run(participant.id, experimentId, input.userKey, JSON.stringify(participant));
    return participant;
  });
}

export function startLiveExperiment(id: string) {
  return withLiveDb((db) => {
    const experiment = readExperiment(db, id);
    if (experiment.status !== "open") throw new Error("Only an open experiment can start");
    if (experiment.papers.some((paper) => !paper.sourceId)) throw new Error(`Upload all ${experiment.groupCount} papers before starting`);
    const joined = participants(db, id);
    if (!joined.length) throw new Error("Wait for at least one student to join");
    const startedAt = now();
    experiment.status = "running"; experiment.startedAt = startedAt; experiment.currentRound = 0;
    joined.forEach((participant, index) => {
      participant.groupNo = (index % experiment.groupCount) + 1;
      resetWork(participant, experiment, startedAt);
      saveParticipant(db, participant);
    });
    saveExperiment(db, experiment);
    return getLiveDashboard(id);
  });
}

export function advanceLiveRound(id: string) {
  return withLiveDb((db) => {
    const experiment = readExperiment(db, id);
    if (experiment.status !== "running") throw new Error("The experiment is not running");
    if (experiment.currentRound >= experiment.groupCount - 1) throw new Error("This is the final round; finish the experiment instead");
    const joined = participants(db, id);
    if (!joined.length || joined.some((participant) => participant.status !== "submitted")) throw new Error("All students must submit before the next round");
    const startedAt = now();
    for (const participant of joined) {
      participant.history.push(currentWork(participant));
      resetWork(participant, experimentWithNextRound(experiment), startedAt);
      saveParticipant(db, participant);
    }
    experiment.currentRound += 1;
    saveExperiment(db, experiment);
    return getLiveDashboard(id);
  });
}

/** Produce the next-round assignment without mutating the experiment before every seat is archived. */
function experimentWithNextRound(experiment: LiveExperiment): LiveExperiment {
  return { ...experiment, currentRound: experiment.currentRound + 1 };
}

export function finishLiveExperiment(id: string) {
  return withLiveDb((db) => {
    const experiment = readExperiment(db, id);
    if (experiment.status !== "running") throw new Error("Only a running experiment can finish");
    experiment.status = "finished"; experiment.finishedAt = now(); saveExperiment(db, experiment);
    return getLiveDashboard(id);
  });
}

export function exitLiveExperiment(participantId: string) {
  return withLiveDb((db) => {
    const participant = readParticipant(db, participantId);
    const experiment = readExperiment(db, participant.experimentId);
    if (experiment.status !== "finished") throw new Error("You can exit after the experiment has finished");
    participant.exitedAt = now();
    participant.version += 1;
    saveParticipant(db, participant);
    return { ok: true };
  });
}

function editableParticipant(db: ReturnType<typeof getTeachingDb>, participantId: string, version: number) {
  const participant = readParticipant(db, participantId);
  if (participant.version !== version) throw new Error("This workspace changed. Refresh and try again.");
  const experiment = readExperiment(db, participant.experimentId);
  if (experiment.status !== "running") throw new Error("The experiment is not accepting work");
  if (participant.status === "submitted") throw new Error("This round was already submitted");
  return { participant, experiment };
}
export function saveLiveDraft(participantId: string, input: { version: number; rows: unknown }) {
  return withLiveDb((db) => {
    const { participant } = editableParticipant(db, participantId, input.version);
    participant.rows = validateSimpleRows(input.rows, LIVE_EXTRACTION_FIELDS);
    participant.version += 1; saveParticipant(db, participant);
    return withScore(participant, readExperiment(db, participant.experimentId).papers[participant.paperIndex]?.gold ?? []);
  });
}
export function submitLive(participantId: string, input: { version: number; rows: unknown }) {
  return withLiveDb((db) => {
    const { participant } = editableParticipant(db, participantId, input.version);
    participant.rows = validateSimpleRows(input.rows, LIVE_EXTRACTION_FIELDS);
    participant.status = "submitted"; participant.submittedAt = now();
    participant.elapsedSeconds = participant.startedAt ? Math.max(1, Math.round((Date.parse(participant.submittedAt) - Date.parse(participant.startedAt)) / 1000)) : null;
    participant.version += 1; saveParticipant(db, participant);
    return withScore(participant, readExperiment(db, participant.experimentId).papers[participant.paperIndex]?.gold ?? []);
  });
}

export function startLiveExtraction(participantId: string, version: number) {
  return withLiveDb((db) => {
    const { participant } = editableParticipant(db, participantId, version);
    if (participant.mode !== "ai") throw new Error("AI extraction is available only to AI groups");
    if (participant.status === "extracting") throw new Error("Extraction is already running");
    participant.status = "extracting";
    participant.error = "";
    participant.version += 1;
    saveParticipant(db, participant);
    return participant;
  });
}

export function finishLiveExtraction(participantId: string, version: number, rows: unknown) {
  return withLiveDb((db) => {
    const participant = readParticipant(db, participantId);
    if (participant.version !== version || participant.status !== "extracting") throw new Error("This extraction is no longer active");
    participant.rows = validateSimpleRows(rows, LIVE_EXTRACTION_FIELDS);
    participant.status = "review";
    participant.version += 1;
    saveParticipant(db, participant);
    return getLiveStudent(participantId).participant!;
  });
}

export function failLiveExtraction(participantId: string, version: number, note: string) {
  return withLiveDb((db) => {
    const participant = readParticipant(db, participantId);
    if (participant.version !== version || participant.status !== "extracting") throw new Error("This extraction is no longer active");
    participant.status = "idle";
    participant.error = note;
    participant.version += 1;
    saveParticipant(db, participant);
    return getLiveStudent(participantId).participant!;
  });
}

export function reviewLive(participantId: string, input: { version: number; overrides: Record<string, LiveMark>; note?: string; round?: number }) {
  return withLiveDb((db) => {
    const participant = readParticipant(db, participantId);
    if (participant.version !== input.version) throw new Error("This submission changed. Refresh and try again.");
    const experiment = readExperiment(db, participant.experimentId);
    const work = workForRound(participant, input.round ?? participant.round);
    if (work.status !== "submitted") throw new Error("Wait for the student to submit");
    const gold = experiment.papers[work.paperIndex]?.gold ?? [];
    const valid = new Set(scoreLive(gold, work.rows).cells.map((cell) => cell.key));
    for (const [key, mark] of Object.entries(input.overrides)) {
      if (!valid.has(key) || !["correct", "incorrect", "uncertain"].includes(mark)) throw new Error("Invalid review field or mark");
      work.overrides[key] = mark;
    }
    if (input.note !== undefined) {
      if (input.note.length > 2000) throw new Error("Review note is too long");
      work.reviewNote = input.note;
    }
    work.reviewedAt = now();
    participant.version += 1; saveParticipant(db, participant);
    return withScore({ ...participant, ...work }, gold);
  });
}

export function getLiveDashboard(experimentId: string, round?: number) {
  return withLiveDb((db) => {
    const experiment = readExperiment(db, experimentId);
    const selectedRound = round ?? experiment.currentRound;
    if (!Number.isInteger(selectedRound) || selectedRound < 0 || selectedRound > experiment.currentRound) throw new Error("Invalid round");
    const joined = participants(db, experimentId).map((participant) => {
      const work = workForRound(participant, selectedRound);
      const view = { ...participant, ...work, history: participant.history };
      return withScore(view, experiment.papers[work.paperIndex]?.gold ?? []);
    });
    return { experiment, participants: joined };
  });
}

export function findLiveParticipant(userKey: string) {
  return withLiveDb((db) => {
    const rows = db.prepare("SELECT payload FROM live_participants WHERE user_key = ?").all(userKey) as Array<{ payload: string }>;
    const joined = rows.map((row) => normalizeParticipant(JSON.parse(row.payload)))
      .filter((participant) => !participant.exitedAt)
      .sort((a, b) => b.joinedAt.localeCompare(a.joinedAt));
    return joined[0] ?? null;
  });
}

export function getLiveStudent(participantId: string): LiveStudentState {
  return withLiveDb((db) => {
    const participant = readParticipant(db, participantId);
    const experiment = readExperiment(db, participant.experimentId);
    const paper = experiment.papers[participant.paperIndex];
    const joinedCount = (db.prepare("SELECT COUNT(*) AS n FROM live_participants WHERE experiment_id = ?").get(experiment.id) as { n: number }).n;
    return {
      experiment: { id: experiment.id, name: experiment.name, groupCount: experiment.groupCount, status: experiment.status,
        currentRound: experiment.currentRound, totalRounds: experiment.groupCount,
        paperTitle: paper?.paperTitle ?? "", hasPaper: Boolean(paper?.sourceId), hasAnswerKey: Boolean(paper?.gold.length) },
      participant: withScore(participant, paper?.gold ?? []), joinedCount,
    };
  });
}

export function liveRowsTemplate() { return [blankLiveRow()]; }
export type { LiveMode, LiveScore, LiveWorkStatus };
