import Database from "better-sqlite3";
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { closeTeachingStoreForTests, getTeachingDb, teachingDataDir } from "./teaching/store";
import {
  isTeachingExperimentAnalysisEligible,
  summarizeTeachingExperiment,
  teachingPairedDifferences,
} from "./teaching/analytics";
import {
  DEFAULT_EXPERIMENT,
  ensureDefaultTeachingExperiment,
  hasCurrentDefaultTeachingExperiment,
} from "./teaching/config";
import { scoreAiBehavior, scoreSubmission } from "./teaching/scoring";
import { teachingTimingQuality as classifyTeachingTiming } from "./teaching/activity";
import {
  TEACHING_FIELDS,
  type TeachingAutoScore,
  type TeachingAnswers,
  type TeachingDashboardRow,
  type TeachingExperimentAnalysisRow,
  type TeachingExperimentDashboard,
  type TeachingExperimentPaper,
  type TeachingFieldScore,
  type TeachingFieldKey,
  type TeachingGoldRule,
  type TeachingMetrics,
  type TeachingMode,
  type TeachingPairedResult,
  type TeachingRole,
  type TeachingRoundAnalysis,
  type TeachingScores,
  type TeachingSequence,
} from "./teachingShared";
export {
  getCurrentTeachingRound,
  joinDefaultTeachingExperiment,
  normalizeStudentAlias,
  rescoreErroredTeachingSubmissions,
  rescoreTeachingSubmission,
  saveCurrentTeachingDraft,
  submitCurrentTeachingRound,
  TeachingRoundConflictError,
  type TeachingRoundExpectation,
} from "./teaching/assignment";
export {
  recordTeachingHeartbeat,
  teachingTimingQuality,
  TeachingHeartbeatValidationError,
  validateTeachingHeartbeatInput,
  type TeachingHeartbeatInput,
} from "./teaching/activity";
export {
  TEACHING_FIELDS,
  type TeachingAnswer,
  type TeachingAnswers,
  type TeachingDashboardRow,
  type TeachingDifferenceSummary,
  type TeachingExperimentAnalysisRow,
  type TeachingExperimentDashboard,
  type TeachingExperimentSummary,
  type TeachingFieldKey,
  type TeachingMetrics,
  type TeachingMode,
  type TeachingModeSummary,
  type TeachingPairedResult,
  type TeachingRole,
  type TeachingRoundAnalysis,
  type TeachingRoundTransition,
  type TeachingScore,
  type TeachingScores,
  type TeachingSequence,
  type TeachingStudentState,
  type TeachingTimingQuality,
} from "./teachingShared";

export interface TeachingSession {
  role: TeachingRole;
  projectId: string | null;
  participantId: string | null;
}

const db = getTeachingDb;
const DATA_DIR = teachingDataDir();
const SESSION_DAYS = 14;

function now(): string {
  return new Date().toISOString();
}

function clean(value: unknown, max = 240): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function nonEmpty(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizedAnswers(input: TeachingAnswers): TeachingAnswers {
  const out: TeachingAnswers = {};
  for (const field of TEACHING_FIELDS) {
    const answer = input?.[field.key];
    if (!answer) continue;
    out[field.key] = {
      value: clean(answer.value, 500),
      page: clean(answer.page, 40) || undefined,
      evidence: clean(answer.evidence, 2000) || undefined,
    };
  }
  return out;
}

function normalizedScores(input: TeachingScores): TeachingScores {
  const out: TeachingScores = {};
  for (const field of TEACHING_FIELDS) {
    const value = input?.[field.key];
    if (value === "correct" || value === "incorrect" || value === "pending") out[field.key] = value;
  }
  return out;
}

export function calculateTeachingMetrics(
  fields: readonly { key: string }[],
  answers: TeachingAnswers,
  aiSnapshot: Record<string, string>,
  humanScores: TeachingScores = {},
  aiScores: TeachingScores = {}
): TeachingMetrics {
  const keys = fields.map((field) => field.key);
  const expected = keys.length;
  const humanFilled = keys.filter((key) => nonEmpty(answers[key as TeachingFieldKey]?.value)).length;
  const humanCorrect = keys.filter((key) => humanScores[key as TeachingFieldKey] === "correct").length;
  const aiFilled = keys.filter((key) => nonEmpty(aiSnapshot[key])).length;
  const aiCorrect = keys.filter((key) => aiScores[key as TeachingFieldKey] === "correct").length;
  return {
    expected,
    humanFilled,
    humanCorrect,
    humanCoverage: expected ? humanFilled / expected : null,
    humanAccuracy: humanFilled ? humanCorrect / humanFilled : null,
    aiFilled,
    aiCorrect,
    aiCoverage: expected ? aiFilled / expected : null,
    aiAccuracy: aiFilled ? aiCorrect / aiFilled : null,
  };
}

export function verifyTeacherPassword(candidate: string): boolean {
  const configured = process.env.TEACHING_TEACHER_PASSWORD;
  if (!configured) return false;
  const left = Buffer.from(candidate);
  const right = Buffer.from(configured);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function teacherLoginConfigured(): boolean {
  return Boolean(process.env.TEACHING_TEACHER_PASSWORD);
}

export function createTeachingSession(session: TeachingSession): string {
  const token = randomBytes(32).toString("base64url");
  const createdAt = now();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000).toISOString();
  const store = db();
  store.prepare("DELETE FROM teaching_sessions WHERE expires_at <= ?").run(createdAt);
  store
    .prepare(
      `INSERT INTO teaching_sessions
       (token_hash, role, project_id, participant_id, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(hashToken(token), session.role, session.projectId, session.participantId, createdAt, expiresAt);
  return token;
}

export function getTeachingSession(token: string | undefined): TeachingSession | null {
  if (!token) return null;
  const row = db()
    .prepare(
      `SELECT role, project_id AS projectId, participant_id AS participantId
       FROM teaching_sessions WHERE token_hash = ? AND expires_at > ?`
    )
    .get(hashToken(token), now()) as TeachingSession | undefined;
  if (!row || (row.role !== "teacher" && row.role !== "student")) return null;
  return row;
}

export function deleteTeachingSession(token: string | undefined): void {
  if (token) db().prepare("DELETE FROM teaching_sessions WHERE token_hash = ?").run(hashToken(token));
}

export function createTeachingProject(input: { name: string; inviteCode: string }): string {
  const name = clean(input.name, 160);
  const inviteCode = clean(input.inviteCode, 40).toUpperCase().replace(/\s+/g, "");
  if (!name || inviteCode.length < 4) throw new Error("项目名称和至少 4 位邀请码为必填项。");
  const id = randomUUID();
  db()
    .prepare(
      `INSERT INTO teaching_projects
       (id, name, domain, invite_code, status, fields_json, created_at)
       VALUES (?, ?, 'tribology', ?, 'open', ?, ?)`
    )
    .run(id, name, inviteCode, JSON.stringify(TEACHING_FIELDS), now());
  return id;
}

type OfficialRecordRow = {
  id: string;
  paper: { title?: string; doi?: string; journal?: string };
  core: {
    ionicLiquid?: { cation?: string; anion?: string };
    substrate?: string;
    temperature?: { raw?: string; value?: number; unit?: string };
    load?: { raw?: string; value?: number; unit?: string };
    cof?: number | null;
  };
  extraction?: { model?: string };
  createdAt?: string;
};

function officialSnapshot(record: OfficialRecordRow): Record<string, string> {
  const quantity = (value: { raw?: string; value?: number; unit?: string } | undefined) =>
    clean(value?.raw, 120) ||
    (typeof value?.value === "number" ? `${value.value}${value.unit ? ` ${value.unit}` : ""}` : "");
  return {
    cation: clean(record.core?.ionicLiquid?.cation, 120),
    anion: clean(record.core?.ionicLiquid?.anion, 120),
    substrate: clean(record.core?.substrate, 160),
    temperature: quantity(record.core?.temperature),
    load: quantity(record.core?.load),
    cof: typeof record.core?.cof === "number" ? String(record.core.cof) : "",
  };
}

export function listOfficialTeachingRecords(limit = 300): Array<{
  id: string;
  title: string;
  doi: string;
  journal: string;
}> {
  const sourcePath = path.join(DATA_DIR, "tribology.db");
  if (!existsSync(sourcePath)) return [];
  const source = new Database(sourcePath, { readonly: true, fileMustExist: true });
  try {
    const rows = source
      .prepare("SELECT id, payload FROM records WHERE status = 'official' ORDER BY created_at DESC, id DESC LIMIT ?")
      .all(Math.max(1, Math.min(limit, 500))) as { id: string; payload: string }[];
    const seen = new Set<string>();
    return rows.flatMap((row) => {
      const record = parseJson<OfficialRecordRow | null>(row.payload, null);
      if (!record) return [];
      const title = clean(record.paper?.title, 300) || row.id;
      const doi = clean(record.paper?.doi, 160);
      const paperKey = (doi || title).trim().toLowerCase();
      if (seen.has(paperKey)) return [];
      seen.add(paperKey);
      return [
        {
          id: row.id,
          title,
          doi,
          journal: clean(record.paper?.journal, 200),
        },
      ];
    });
  } finally {
    source.close();
  }
}

export function addTeachingPaper(input: {
  projectId: string;
  recordId: string;
  paperNo: string;
  sourceUrl?: string;
}): string {
  const projectId = clean(input.projectId, 80);
  const recordId = clean(input.recordId, 80);
  const paperNo = clean(input.paperNo, 40);
  if (!paperNo) throw new Error("请填写文献编号。");
  if (!recordId) throw new Error("请选择一篇文献。");

  const store = db();
  const projectKind = store
    .prepare(
      `SELECT experiment_kind AS experimentKind, is_default AS isDefault
       FROM teaching_projects WHERE id = ?`
    )
    .get(projectId) as { experimentKind: string; isDefault: number } | undefined;
  if (
    projectId === DEFAULT_EXPERIMENT.id ||
    projectKind?.experimentKind === "crossover" ||
    projectKind?.isDefault === 1
  ) {
    throw new Error("默认交叉实验的冻结文献不能通过普通教学项目修改。");
  }
  const existing = store
    .prepare(
      `SELECT id, source_record_id AS sourceRecordId
       FROM teaching_papers WHERE project_id = ? AND paper_no = ?`
    )
    .get(projectId, paperNo) as { id: string; sourceRecordId: string } | undefined;
  if (existing) {
    if (existing.sourceRecordId === recordId) return existing.id;
    throw new Error(`文献编号 ${paperNo} 已经使用，请换一个编号。`);
  }

  const sourcePath = path.join(DATA_DIR, "tribology.db");
  if (!existsSync(sourcePath)) throw new Error("正式摩擦数据库尚不存在。");
  const source = new Database(sourcePath, { readonly: true, fileMustExist: true });
  let record: OfficialRecordRow | null = null;
  try {
    const row = source
      .prepare("SELECT payload FROM records WHERE id = ? AND status = 'official'")
      .get(recordId) as { payload: string } | undefined;
    record = row ? parseJson<OfficialRecordRow | null>(row.payload, null) : null;
  } finally {
    source.close();
  }
  if (!record) throw new Error("没有找到这篇文献，请重新选择。");

  const id = randomUUID();
  const inserted = store
    .prepare(
      `INSERT OR IGNORE INTO teaching_papers
       (id, project_id, paper_no, title, doi, journal, source_url, source_record_id,
        ai_snapshot_json, ai_model, ai_extracted_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      projectId,
      paperNo,
      clean(record.paper?.title, 300) || recordId,
      clean(record.paper?.doi, 160) || null,
      clean(record.paper?.journal, 200) || null,
      clean(input.sourceUrl, 500) || null,
      recordId,
      JSON.stringify(officialSnapshot(record)),
      clean(record.extraction?.model, 160) || null,
      clean(record.createdAt, 80) || now(),
      now()
    );
  if (!inserted.changes) {
    const concurrent = store
      .prepare(
        `SELECT id, source_record_id AS sourceRecordId
         FROM teaching_papers WHERE project_id = ? AND paper_no = ?`
      )
      .get(projectId, paperNo) as { id: string; sourceRecordId: string } | undefined;
    if (concurrent?.sourceRecordId === recordId) return concurrent.id;
    if (concurrent) throw new Error(`文献编号 ${paperNo} 已经使用，请换一个编号。`);
    throw new Error("文献添加失败，请重新操作。");
  }
  return id;
}

export function joinTeachingProject(input: {
  inviteCode: string;
  groupCode: string;
  studentAlias: string;
}): { projectId: string; participantId: string } {
  const store = db();
  const project = store
    .prepare(
      `SELECT id FROM teaching_projects
       WHERE invite_code = ? AND status = 'open'
         AND experiment_kind = 'legacy' AND is_default = 0`
    )
    .get(clean(input.inviteCode, 40).toUpperCase().replace(/\s+/g, "")) as { id: string } | undefined;
  if (!project) throw new Error("邀请码不存在或项目尚未开放。");
  const groupCode = clean(input.groupCode, 80);
  const studentAlias = clean(input.studentAlias, 80);
  if (!groupCode || !studentAlias) throw new Error("组别和学号/姓名缩写为必填项。");

  const existing = store
    .prepare(
      `SELECT id FROM teaching_participants
       WHERE project_id = ? AND group_code = ? AND student_alias = ?`
    )
    .get(project.id, groupCode, studentAlias) as { id: string } | undefined;
  if (existing) return { projectId: project.id, participantId: existing.id };

  const paper = store
    .prepare(
      `SELECT p.id
       FROM teaching_papers p
       LEFT JOIN teaching_participants t ON t.assigned_paper_id = p.id
       WHERE p.project_id = ?
       GROUP BY p.id
       ORDER BY COUNT(t.id) ASC, p.paper_no ASC, p.id ASC
       LIMIT 1`
    )
    .get(project.id) as { id: string } | undefined;
  if (!paper) throw new Error("老师尚未为该项目添加文献。");

  const participantId = randomUUID();
  const submissionId = randomUUID();
  const timestamp = now();
  store.transaction(() => {
    store
      .prepare(
        `INSERT INTO teaching_participants
         (id, project_id, group_code, student_alias, assigned_paper_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(participantId, project.id, groupCode, studentAlias, paper.id, timestamp);
    store
      .prepare(
        `INSERT INTO teaching_submissions
         (id, project_id, paper_id, participant_id, started_at, answers_json, version, updated_at)
         VALUES (?, ?, ?, ?, ?, '{}', 0, ?)`
      )
      .run(submissionId, project.id, paper.id, participantId, timestamp, timestamp);
  })();
  return { projectId: project.id, participantId };
}

export function getStudentWorkspace(participantId: string): {
  project: { id: string; name: string; fields: typeof TEACHING_FIELDS };
  participant: { groupCode: string; studentAlias: string };
  paper: { paperNo: string; title: string; doi: string; journal: string; sourceUrl: string };
  submission: {
    startedAt: string;
    submittedAt: string | null;
    answers: TeachingAnswers;
    version: number;
  };
} | null {
  const row = db()
    .prepare(
      `SELECT
         pr.id AS project_id, pr.name AS project_name, pr.fields_json,
         pt.group_code, pt.student_alias,
         p.paper_no, p.title, p.doi, p.journal, p.source_url,
         s.started_at, s.submitted_at, s.answers_json, s.version
       FROM teaching_participants pt
       JOIN teaching_projects pr ON pr.id = pt.project_id
       JOIN teaching_papers p ON p.id = pt.assigned_paper_id
       JOIN teaching_submissions s ON s.participant_id = pt.id AND s.paper_id = p.id
       WHERE pt.id = ?`
    )
    .get(participantId) as
    | {
        project_id: string;
        project_name: string;
        fields_json: string;
        group_code: string;
        student_alias: string;
        paper_no: string;
        title: string;
        doi: string | null;
        journal: string | null;
        source_url: string | null;
        started_at: string;
        submitted_at: string | null;
        answers_json: string;
        version: number;
      }
    | undefined;
  if (!row) return null;
  return {
    project: {
      id: row.project_id,
      name: row.project_name,
      fields: parseJson(row.fields_json, TEACHING_FIELDS) as typeof TEACHING_FIELDS,
    },
    participant: { groupCode: row.group_code, studentAlias: row.student_alias },
    paper: {
      paperNo: row.paper_no,
      title: row.title,
      doi: row.doi ?? "",
      journal: row.journal ?? "",
      sourceUrl: row.source_url ?? "",
    },
    submission: {
      startedAt: row.started_at,
      submittedAt: row.submitted_at,
      answers: parseJson(row.answers_json, {}),
      version: row.version,
    },
  };
}

export function saveStudentDraft(
  participantId: string,
  expectedVersion: number,
  answers: TeachingAnswers
): { version: number; updatedAt: string } {
  const store = db();
  const timestamp = now();
  const result = store
    .prepare(
      `UPDATE teaching_submissions
       SET answers_json = ?, version = version + 1, updated_at = ?
       WHERE participant_id = ? AND submitted_at IS NULL AND version = ?`
    )
    .run(JSON.stringify(normalizedAnswers(answers)), timestamp, participantId, expectedVersion);
  if (result.changes !== 1) {
    const locked = store
      .prepare("SELECT submitted_at FROM teaching_submissions WHERE participant_id = ?")
      .get(participantId) as { submitted_at: string | null } | undefined;
    if (locked?.submitted_at) throw new TeachingConflictError("结果已提交，答案已锁定。", "locked");
    throw new TeachingConflictError("草稿已有更新，请刷新后继续。", "version");
  }
  return { version: expectedVersion + 1, updatedAt: timestamp };
}

export function submitStudentWork(participantId: string): { submittedAt: string } {
  const store = db();
  const row = store
    .prepare(
      `SELECT s.submitted_at, s.answers_json, pr.fields_json
       FROM teaching_submissions s
       JOIN teaching_projects pr ON pr.id = s.project_id
       WHERE s.participant_id = ?`
    )
    .get(participantId) as
    | { submitted_at: string | null; answers_json: string; fields_json: string }
    | undefined;
  if (!row) throw new Error("未找到学生提交记录。");
  if (row.submitted_at) return { submittedAt: row.submitted_at };
  const answers = parseJson<TeachingAnswers>(row.answers_json, {});
  const fields = parseJson<Array<{ key: string }>>(row.fields_json, []);
  const missing = fields.filter((field) => !nonEmpty(answers[field.key as TeachingFieldKey]?.value));
  if (missing.length) throw new Error(`请先完成全部 ${fields.length} 个必填字段。`);
  const submittedAt = now();
  store
    .prepare(
      `UPDATE teaching_submissions
       SET submitted_at = ?, updated_at = ?, version = version + 1
       WHERE participant_id = ? AND submitted_at IS NULL`
    )
    .run(submittedAt, submittedAt, participantId);
  return { submittedAt };
}

export class TeachingConflictError extends Error {
  constructor(
    message: string,
    public readonly kind: "version" | "locked"
  ) {
    super(message);
  }
}

type DefaultTeachingParticipantRow = {
  participantId: string;
  studentAlias: string;
  sequenceCode: string | null;
  completedAt: string | null;
  exclusionReason: string | null;
};

type DefaultTeachingSubmissionRow = {
  submissionId: string;
  participantId: string;
  roundNo: number | null;
  mode: string | null;
  activeSeconds: number;
  startedAt: string;
  submittedAt: string | null;
  answersJson: string;
  aiInitialJson: string;
  valueScoresJson: string;
  evidenceScoresJson: string;
  scoringStatus: string;
  scoringVersion: string | null;
  autoScoredAt: string | null;
  paperId: string;
  paperCode: string;
  title: string;
  doi: string | null;
  journal: string | null;
  sourceUrl: string | null;
  taskPrompt: string;
  aiModel: string | null;
  scoringRulesJson: string;
};

function defaultTeachingSequence(value: string | null, participantId: string): TeachingSequence {
  if (value === "manual_then_ai" || value === "ai_then_manual") return value;
  throw new Error(`Invalid teaching sequence for participant ${participantId}.`);
}

function parsedObject<T extends object>(value: string): T | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as T
      : null;
  } catch {
    return null;
  }
}

function parsedFieldScores(value: string): TeachingAutoScore["values"] | null {
  const parsed = parsedObject<Record<string, unknown>>(value);
  if (!parsed) return null;
  const scores = {} as TeachingAutoScore["values"];
  for (const field of TEACHING_FIELDS) {
    const candidate = parsed[field.key];
    if (
      candidate === null ||
      typeof candidate !== "object" ||
      Array.isArray(candidate)
    ) {
      return null;
    }
    const score = candidate as Partial<TeachingFieldScore>;
    if (
      typeof score.correct !== "boolean" ||
      typeof score.normalized !== "string" ||
      typeof score.reason !== "string"
    ) {
      return null;
    }
    scores[field.key] = {
      correct: score.correct,
      normalized: score.normalized,
      reason: score.reason,
    };
  }
  return scores;
}

function reconstructedAutomaticScore(
  row: DefaultTeachingSubmissionRow,
  answers: TeachingAnswers,
  paper: TeachingExperimentPaper
): TeachingAutoScore | null {
  const values = parsedFieldScores(row.valueScoresJson);
  const evidence = parsedFieldScores(row.evidenceScoresJson);
  if (!values || !evidence) return null;

  let coverage: TeachingAutoScore;
  try {
    coverage = scoreSubmission(answers, paper);
  } catch {
    return null;
  }
  const valueCorrect = TEACHING_FIELDS.filter((field) => values[field.key].correct).length;
  const evidenceCorrect = TEACHING_FIELDS.filter((field) => evidence[field.key].correct).length;
  const denominator = TEACHING_FIELDS.length;
  return {
    values,
    evidence,
    valueCorrect,
    valueAccuracy: valueCorrect / denominator,
    valueCoverage: coverage.valueCoverage,
    evidenceCorrect,
    evidenceAccuracy: evidenceCorrect / denominator,
    evidenceCoverage: coverage.evidenceCoverage,
  };
}

function defaultTeachingRoundAnalysis(
  row: DefaultTeachingSubmissionRow,
  expected: { roundNo: 1 | 2; mode: TeachingMode; paperCode: "A" | "B" }
): TeachingRoundAnalysis | null {
  if (
    row.roundNo !== expected.roundNo ||
    row.mode !== expected.mode ||
    row.paperCode !== expected.paperCode ||
    row.submittedAt === null ||
    row.scoringStatus !== "scored" ||
    row.scoringVersion !== DEFAULT_EXPERIMENT.scoringVersion ||
    row.autoScoredAt === null ||
    !Number.isFinite(Date.parse(row.autoScoredAt)) ||
    !Number.isFinite(row.activeSeconds) ||
    row.activeSeconds < 0
  ) {
    return null;
  }
  const startedAt = Date.parse(row.startedAt);
  const submittedAt = Date.parse(row.submittedAt);
  if (
    !Number.isFinite(startedAt) ||
    !Number.isFinite(submittedAt) ||
    submittedAt < startedAt
  ) {
    return null;
  }

  const answers = parsedObject<TeachingAnswers>(row.answersJson);
  const aiInitial = parsedObject<TeachingAnswers>(row.aiInitialJson);
  const gold = parsedObject<Record<TeachingFieldKey, TeachingGoldRule>>(row.scoringRulesJson);
  if (!answers || !aiInitial || !gold) return null;
  const paper: TeachingExperimentPaper = {
    id: row.paperId,
    code: expected.paperCode,
    title: row.title,
    doi: row.doi ?? "",
    journal: row.journal ?? "",
    sourceUrl: row.sourceUrl ?? "",
    taskPrompt: row.taskPrompt,
    aiModel: row.aiModel ?? "",
    aiInitial,
    gold,
  };
  const score = reconstructedAutomaticScore(row, answers, paper);
  if (!score) return null;

  let aiBehavior = null;
  if (expected.mode === "ai_assisted") {
    try {
      const initialScore = scoreSubmission(aiInitial, paper);
      aiBehavior = scoreAiBehavior(aiInitial, answers, initialScore, score);
    } catch {
      return null;
    }
  }
  const wallSeconds = (submittedAt - startedAt) / 1_000;
  return {
    submissionId: row.submissionId,
    paperCode: expected.paperCode,
    mode: expected.mode,
    activeSeconds: row.activeSeconds,
    wallSeconds,
    score,
    aiBehavior,
    timingQuality: classifyTeachingTiming(row.activeSeconds, wallSeconds),
  };
}

function defaultTeachingAssignments(sequence: TeachingSequence): Array<{
  key: "manual" | "aiAssisted";
  roundNo: 1 | 2;
  mode: TeachingMode;
  paperCode: "A" | "B";
}> {
  return sequence === "manual_then_ai"
    ? [
        { key: "manual", roundNo: 1, mode: "manual", paperCode: "A" },
        { key: "aiAssisted", roundNo: 2, mode: "ai_assisted", paperCode: "B" },
      ]
    : [
        { key: "aiAssisted", roundNo: 1, mode: "ai_assisted", paperCode: "A" },
        { key: "manual", roundNo: 2, mode: "manual", paperCode: "B" },
      ];
}

export function getDefaultTeachingDashboard(): TeachingExperimentDashboard {
  const store = db();
  if (!hasCurrentDefaultTeachingExperiment(store)) {
    ensureDefaultTeachingExperiment(store);
  }

  const participants = store
    .prepare(
      `SELECT pt.id AS participantId, pt.student_alias AS studentAlias,
              pt.sequence_code AS sequenceCode, pt.completed_at AS completedAt,
              pt.exclusion_reason AS exclusionReason
       FROM teaching_participants pt
       WHERE pt.project_id = ?
         AND pt.sequence_code IN ('manual_then_ai', 'ai_then_manual')
       ORDER BY pt.created_at ASC, pt.id ASC`
    )
    .all(DEFAULT_EXPERIMENT.id) as DefaultTeachingParticipantRow[];
  const submissions = store
    .prepare(
      `SELECT s.id AS submissionId, s.participant_id AS participantId,
              s.round_no AS roundNo, s.mode, s.active_seconds AS activeSeconds,
              s.started_at AS startedAt, s.submitted_at AS submittedAt,
              s.answers_json AS answersJson, s.ai_initial_json AS aiInitialJson,
              s.auto_value_scores_json AS valueScoresJson,
              s.auto_evidence_scores_json AS evidenceScoresJson,
              s.scoring_status AS scoringStatus, s.scoring_version AS scoringVersion,
              s.auto_scored_at AS autoScoredAt,
              p.id AS paperId, p.paper_no AS paperCode, p.title, p.doi, p.journal,
              p.source_url AS sourceUrl, p.task_prompt AS taskPrompt,
              p.ai_model AS aiModel, p.scoring_rules_json AS scoringRulesJson
       FROM teaching_submissions s
       JOIN teaching_papers p ON p.id = s.paper_id
       WHERE s.project_id = ?
       ORDER BY s.participant_id ASC, s.round_no ASC, s.id ASC`
    )
    .all(DEFAULT_EXPERIMENT.id) as DefaultTeachingSubmissionRow[];
  const submissionsByParticipant = new Map<string, DefaultTeachingSubmissionRow[]>();
  for (const submission of submissions) {
    const existing = submissionsByParticipant.get(submission.participantId);
    if (existing) existing.push(submission);
    else submissionsByParticipant.set(submission.participantId, [submission]);
  }

  const analysisRows = participants.map((participant): TeachingExperimentAnalysisRow => {
    const sequence = defaultTeachingSequence(participant.sequenceCode, participant.participantId);
    const participantSubmissions = submissionsByParticipant.get(participant.participantId) ?? [];
    const rounds: Pick<TeachingExperimentAnalysisRow, "manual" | "aiAssisted"> = {
      manual: null,
      aiAssisted: null,
    };
    for (const assignment of defaultTeachingAssignments(sequence)) {
      const candidates = participantSubmissions.filter(
        (submission) =>
          submission.roundNo === assignment.roundNo &&
          submission.mode === assignment.mode &&
          submission.paperCode === assignment.paperCode
      );
      rounds[assignment.key] = candidates.length === 1
        ? defaultTeachingRoundAnalysis(candidates[0], assignment)
        : null;
    }
    return {
      participantId: participant.participantId,
      studentAlias: participant.studentAlias,
      sequence,
      completed: participant.completedAt !== null,
      exclusionReason: participant.exclusionReason,
      ...rounds,
    };
  });
  const summary = summarizeTeachingExperiment(analysisRows);
  const results = analysisRows.map((row): TeachingPairedResult => {
    const differences = isTeachingExperimentAnalysisEligible(row)
      ? teachingPairedDifferences(row)
      : null;
    return {
      ...row,
      activeTimeDifference: differences?.activeTimeDifference ?? null,
      accuracyDifference: differences?.accuracyDifference ?? null,
    };
  });

  return {
    experiment: {
      id: DEFAULT_EXPERIMENT.id,
      name: DEFAULT_EXPERIMENT.name,
      version: DEFAULT_EXPERIMENT.version,
      scoringVersion: DEFAULT_EXPERIMENT.scoringVersion,
    },
    summary,
    participants: results,
  };
}

export function getTeachingAdminDashboard(requestedProjectId?: string | null): {
  configured: boolean;
  projects: Array<{ id: string; name: string; inviteCode: string; status: string; paperCount: number }>;
  selectedProjectId: string | null;
  papers: Array<{ id: string; paperNo: string; title: string; doi: string; journal: string }>;
  rows: TeachingDashboardRow[];
  summary: { submitted: number; total: number; pending: number; averageElapsedSeconds: number | null };
  officialRecords: ReturnType<typeof listOfficialTeachingRecords>;
} {
  const store = db();
  const projects = store
    .prepare(
      `SELECT pr.id, pr.name, pr.invite_code AS inviteCode, pr.status, COUNT(p.id) AS paperCount
       FROM teaching_projects pr
       LEFT JOIN teaching_papers p ON p.project_id = pr.id
       GROUP BY pr.id
       ORDER BY pr.created_at DESC`
    )
    .all() as Array<{ id: string; name: string; inviteCode: string; status: string; paperCount: number }>;
  const selectedProjectId =
    (requestedProjectId && projects.some((project) => project.id === requestedProjectId)
      ? requestedProjectId
      : projects[0]?.id) ?? null;
  if (!selectedProjectId) {
    return {
      configured: teacherLoginConfigured(),
      projects,
      selectedProjectId: null,
      papers: [],
      rows: [],
      summary: { submitted: 0, total: 0, pending: 0, averageElapsedSeconds: null },
      officialRecords: listOfficialTeachingRecords(),
    };
  }

  const projectRow = store
    .prepare("SELECT fields_json FROM teaching_projects WHERE id = ?")
    .get(selectedProjectId) as { fields_json: string };
  const fields = parseJson<Array<{ key: string; label: string }>>(projectRow.fields_json, [...TEACHING_FIELDS]);
  const papers = store
    .prepare(
      `SELECT id, paper_no AS paperNo, title, COALESCE(doi, '') AS doi,
              COALESCE(journal, '') AS journal
       FROM teaching_papers WHERE project_id = ? ORDER BY paper_no ASC`
    )
    .all(selectedProjectId) as Array<{
    id: string;
    paperNo: string;
    title: string;
    doi: string;
    journal: string;
  }>;
  const rawRows = store
    .prepare(
      `SELECT
         s.id AS submission_id, s.project_id, pr.name AS project_name,
         pt.group_code, pt.student_alias,
         p.paper_no, p.title, COALESCE(p.doi, '') AS doi, COALESCE(p.journal, '') AS journal,
         p.ai_snapshot_json, s.started_at, s.submitted_at, s.answers_json,
         COALESCE(r.human_scores_json, '{}') AS human_scores_json,
         COALESCE(r.ai_scores_json, '{}') AS ai_scores_json,
         r.reviewed_at
       FROM teaching_submissions s
       JOIN teaching_projects pr ON pr.id = s.project_id
       JOIN teaching_participants pt ON pt.id = s.participant_id
       JOIN teaching_papers p ON p.id = s.paper_id
       LEFT JOIN teaching_reviews r ON r.submission_id = s.id
       WHERE s.project_id = ?
       ORDER BY s.submitted_at IS NULL, s.submitted_at DESC, pt.group_code ASC`
    )
    .all(selectedProjectId) as Array<Record<string, string | null>>;
  const rows = rawRows.map((row): TeachingDashboardRow => {
    const answers = parseJson<TeachingAnswers>(row.answers_json, {});
    const aiSnapshot = parseJson<Record<string, string>>(row.ai_snapshot_json, {});
    const humanScores = parseJson<TeachingScores>(row.human_scores_json, {});
    const aiScores = parseJson<TeachingScores>(row.ai_scores_json, {});
    const startedAt = String(row.started_at);
    const submittedAt = row.submitted_at ? String(row.submitted_at) : null;
    return {
      submissionId: String(row.submission_id),
      projectId: String(row.project_id),
      projectName: String(row.project_name),
      groupCode: String(row.group_code),
      studentAlias: String(row.student_alias),
      paperNo: String(row.paper_no),
      title: String(row.title),
      doi: String(row.doi ?? ""),
      journal: String(row.journal ?? ""),
      startedAt,
      submittedAt,
      elapsedSeconds: submittedAt
        ? Math.max(0, Math.round((Date.parse(submittedAt) - Date.parse(startedAt)) / 1000))
        : null,
      answers,
      aiSnapshot,
      humanScores,
      aiScores,
      metrics: calculateTeachingMetrics(fields, answers, aiSnapshot, humanScores, aiScores),
      status: !submittedAt ? "draft" : row.reviewed_at ? "reviewed" : "pending",
    };
  });
  const completed = rows.filter((row) => row.elapsedSeconds != null);
  return {
    configured: teacherLoginConfigured(),
    projects,
    selectedProjectId,
    papers,
    rows,
    summary: {
      submitted: rows.filter((row) => row.submittedAt).length,
      total: rows.length,
      pending: rows.filter((row) => row.status === "pending").length,
      averageElapsedSeconds: completed.length
        ? Math.round(completed.reduce((sum, row) => sum + (row.elapsedSeconds ?? 0), 0) / completed.length)
        : null,
    },
    officialRecords: listOfficialTeachingRecords(),
  };
}

export class TeachingReviewValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TeachingReviewValidationError";
  }
}

export function reviewTeachingSubmission(
  submissionId: string,
  humanScores: TeachingScores,
  aiScores: TeachingScores
): void {
  const store = db();
  const submission = store
    .prepare("SELECT submitted_at FROM teaching_submissions WHERE id = ?")
    .get(submissionId) as { submitted_at: string | null } | undefined;
  if (!submission?.submitted_at) {
    throw new TeachingReviewValidationError("学生尚未提交，暂时不能审核。");
  }
  store
    .prepare(
      `INSERT INTO teaching_reviews
       (submission_id, human_scores_json, ai_scores_json, reviewed_at, reviewer_id)
       VALUES (?, ?, ?, ?, 'teacher')
       ON CONFLICT(submission_id) DO UPDATE SET
         human_scores_json = excluded.human_scores_json,
         ai_scores_json = excluded.ai_scores_json,
         reviewed_at = excluded.reviewed_at`
    )
    .run(
      submissionId,
      JSON.stringify(normalizedScores(humanScores)),
      JSON.stringify(normalizedScores(aiScores)),
      now()
    );
}

export function closeTeachingDatabaseForTests(): void {
  closeTeachingStoreForTests();
}
