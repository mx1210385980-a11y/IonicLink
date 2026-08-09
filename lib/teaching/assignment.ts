import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import {
  TEACHING_FIELDS,
  type TeachingAnswers,
  type TeachingAutoScore,
  type TeachingExperimentPaper,
  type TeachingGoldRule,
  type TeachingRoundTransition,
  type TeachingSequence,
  type TeachingStudentState,
} from "../teachingShared";
import {
  DEFAULT_EXPERIMENT,
  ensureDefaultTeachingExperiment,
  hasCurrentDefaultTeachingExperiment,
} from "./config";
import { scoreSubmission } from "./scoring";
import { getTeachingDb } from "./store";

type AssignedPaper = {
  id: string;
  code: "A" | "B";
  aiSnapshotJson: string;
};

type ScoringRow = {
  submissionId: string;
  answersJson: string;
  submittedAt: string | null;
  paperId: string;
  paperCode: string;
  title: string;
  doi: string | null;
  journal: string | null;
  sourceUrl: string | null;
  taskPrompt: string;
  aiModel: string | null;
  aiSnapshotJson: string;
  scoringRulesJson: string;
};

export type TeachingRoundExpectation = {
  roundNo: 1 | 2;
  version: number;
};

export class TeachingRoundConflictError extends Error {
  constructor(
    message: string,
    public readonly kind: "version" | "locked" | "stale_round"
  ) {
    super(message);
    this.name = "TeachingRoundConflictError";
  }
}

function now(): string {
  return new Date().toISOString();
}

function ensureCanonicalTeachingScoring(store: Database.Database): void {
  if (!hasCurrentDefaultTeachingExperiment(store)) {
    ensureDefaultTeachingExperiment(store);
  }
}

function clean(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function normalizedAnswers(input: TeachingAnswers): TeachingAnswers {
  const answers: TeachingAnswers = {};
  for (const field of TEACHING_FIELDS) {
    const answer = input?.[field.key];
    if (!answer) continue;
    answers[field.key] = {
      value: clean(answer.value, 500),
      page: clean(answer.page, 40) || undefined,
      evidence: clean(answer.evidence, 2000) || undefined,
    };
  }
  return answers;
}

function scoringError(error: unknown): Error {
  const detail = error instanceof Error ? error.message : String(error);
  return new Error(`Teaching submission scoring failed: ${detail}`);
}

function assertPaperCode(value: string): "A" | "B" {
  if (value !== "A" && value !== "B") throw new Error(`Unsupported teaching paper code: ${value}`);
  return value;
}

function scoringPaper(row: ScoringRow): TeachingExperimentPaper {
  return {
    id: row.paperId,
    code: assertPaperCode(row.paperCode),
    title: row.title,
    doi: row.doi ?? "",
    journal: row.journal ?? "",
    sourceUrl: row.sourceUrl ?? "",
    taskPrompt: row.taskPrompt,
    aiModel: row.aiModel ?? "",
    aiInitial: JSON.parse(row.aiSnapshotJson) as TeachingAnswers,
    gold: JSON.parse(row.scoringRulesJson) as Record<
      (typeof TEACHING_FIELDS)[number]["key"],
      TeachingGoldRule
    >,
  };
}

function scoreStoredSubmission(row: ScoringRow): TeachingAutoScore {
  const answers = JSON.parse(row.answersJson) as TeachingAnswers;
  return scoreSubmission(answers, scoringPaper(row));
}

function saveAutomaticScore(
  store: Database.Database,
  submissionId: string,
  score: TeachingAutoScore,
  scoredAt: string
): void {
  store
    .prepare(
      `UPDATE teaching_submissions
       SET auto_value_scores_json = ?, auto_evidence_scores_json = ?,
           scoring_version = ?, scoring_status = 'scored', auto_scored_at = ?
       WHERE id = ?`
    )
    .run(
      JSON.stringify(score.values),
      JSON.stringify(score.evidence),
      DEFAULT_EXPERIMENT.scoringVersion,
      scoredAt,
      submissionId
    );
}

function loadScoringRow(store: Database.Database, submissionId: string): ScoringRow | undefined {
  return store
    .prepare(
      `SELECT
         s.id AS submissionId, s.answers_json AS answersJson, s.submitted_at AS submittedAt,
         p.id AS paperId, p.paper_no AS paperCode, p.title,
         p.doi, p.journal, p.source_url AS sourceUrl, p.task_prompt AS taskPrompt,
         p.ai_model AS aiModel, p.ai_snapshot_json AS aiSnapshotJson,
         p.scoring_rules_json AS scoringRulesJson
       FROM teaching_submissions s
       JOIN teaching_papers p ON p.id = s.paper_id
       JOIN teaching_participants pt ON pt.id = s.participant_id
       JOIN teaching_projects pr ON pr.id = s.project_id
       WHERE s.id = ? AND s.round_no IN (1, 2)
         AND pt.sequence_code IN ('manual_then_ai', 'ai_then_manual')
         AND pr.is_default = 1`
    )
    .get(submissionId) as ScoringRow | undefined;
}

export function normalizeStudentAlias(value: string): string {
  const alias = typeof value === "string" ? value.trim() : "";
  const length = Array.from(alias).length;
  if (length < 2 || length > 80) {
    throw new Error("Student alias must be between 2 and 80 characters.");
  }
  return alias;
}

function studentIdentityKey(displayAlias: string): string {
  return displayAlias.normalize("NFKC").replace(/\s+/gu, " ").trim().toLowerCase();
}

export function joinDefaultTeachingExperiment(
  studentAlias: string
): { projectId: string; participantId: string } {
  const displayAlias = normalizeStudentAlias(studentAlias);
  const identityKey = studentIdentityKey(displayAlias);
  const store = getTeachingDb();

  return store.transaction(() => {
    ensureDefaultTeachingExperiment(store);
    const project = store
      .prepare("SELECT id FROM teaching_projects WHERE id = ? AND is_default = 1 AND status = 'open'")
      .get(DEFAULT_EXPERIMENT.id) as { id: string } | undefined;
    if (!project) throw new Error("The default teaching experiment is not available.");

    const existing = store
      .prepare(
        `SELECT id FROM teaching_participants
         WHERE project_id = ? AND identity_key = ? AND sequence_code IS NOT NULL`
      )
      .get(project.id, identityKey) as { id: string } | undefined;
    if (existing) return { projectId: project.id, participantId: existing.id };

    const counts = store
      .prepare(
        `SELECT
           SUM(CASE WHEN sequence_code = 'manual_then_ai' THEN 1 ELSE 0 END) AS manualThenAi,
           SUM(CASE WHEN sequence_code = 'ai_then_manual' THEN 1 ELSE 0 END) AS aiThenManual
         FROM teaching_participants
         WHERE project_id = ? AND sequence_code IS NOT NULL`
      )
      .get(project.id) as { manualThenAi: number | null; aiThenManual: number | null };
    const sequence: TeachingSequence =
      Number(counts.manualThenAi ?? 0) <= Number(counts.aiThenManual ?? 0)
        ? "manual_then_ai"
        : "ai_then_manual";

    const paperRows = store
      .prepare(
        `SELECT id, paper_no AS code, ai_snapshot_json AS aiSnapshotJson
         FROM teaching_papers WHERE project_id = ? AND paper_no IN ('A', 'B')`
      )
      .all(project.id) as Array<{ id: string; code: string; aiSnapshotJson: string }>;
    const papers = new Map<"A" | "B", AssignedPaper>();
    for (const paper of paperRows) {
      const code = assertPaperCode(paper.code);
      papers.set(code, { ...paper, code });
    }
    const paperA = papers.get("A");
    const paperB = papers.get("B");
    if (!paperA || !paperB) throw new Error("The default teaching papers are not available.");

    const rounds = sequence === "manual_then_ai"
      ? [
          { round: 1 as const, paper: paperA, mode: "manual" as const },
          { round: 2 as const, paper: paperB, mode: "ai_assisted" as const },
        ]
      : [
          { round: 1 as const, paper: paperA, mode: "ai_assisted" as const },
          { round: 2 as const, paper: paperB, mode: "manual" as const },
        ];

    const participantId = randomUUID();
    const timestamp = now();
    store
      .prepare(
        `INSERT INTO teaching_participants
         (id, project_id, group_code, student_alias, assigned_paper_id, created_at,
          sequence_code, identity_key)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        participantId,
        project.id,
        sequence,
        displayAlias,
        paperA.id,
        timestamp,
        sequence,
        identityKey
      );

    const insertSubmission = store.prepare(
      `INSERT INTO teaching_submissions
       (id, project_id, paper_id, participant_id, started_at, answers_json, version,
        updated_at, round_no, mode, active_seconds, ai_initial_json, scoring_status)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, 0, ?, 'unscored')`
    );
    for (const assignment of rounds) {
      const initialJson = assignment.mode === "ai_assisted" ? assignment.paper.aiSnapshotJson : "{}";
      insertSubmission.run(
        randomUUID(),
        project.id,
        assignment.paper.id,
        participantId,
        timestamp,
        initialJson,
        timestamp,
        assignment.round,
        assignment.mode,
        initialJson
      );
    }

    return { projectId: project.id, participantId };
  }).immediate();
}

export function getCurrentTeachingRound(participantId: string): TeachingStudentState | null {
  const store = getTeachingDb();
  const participant = store
    .prepare(
      `SELECT pt.student_alias AS studentAlias, pt.completed_at AS completedAt,
              pr.id AS projectId, pr.name AS projectName, pr.fields_json AS fieldsJson
       FROM teaching_participants pt
       JOIN teaching_projects pr ON pr.id = pt.project_id
       WHERE pt.id = ?
         AND pt.sequence_code IN ('manual_then_ai', 'ai_then_manual')
         AND pr.is_default = 1`
    )
    .get(participantId) as
    | {
        studentAlias: string;
        completedAt: string | null;
        projectId: string;
        projectName: string;
        fieldsJson: string;
      }
    | undefined;
  if (!participant) return null;
  if (participant.completedAt) {
    return {
      status: "complete",
      participant: { studentAlias: participant.studentAlias },
      completedAt: participant.completedAt,
    };
  }

  const round = store
    .prepare(
      `SELECT
         s.round_no AS roundNo, s.mode, s.started_at AS startedAt,
         s.answers_json AS answersJson, s.active_seconds AS activeSeconds, s.version,
         s.ai_initial_json AS aiInitialJson,
         p.id AS paperId, p.paper_no AS paperCode, p.title, p.doi, p.journal,
         p.source_url AS sourceUrl, p.task_prompt AS taskPrompt
       FROM teaching_submissions s
       JOIN teaching_papers p ON p.id = s.paper_id
       WHERE s.participant_id = ? AND s.submitted_at IS NULL
       ORDER BY s.round_no ASC
       LIMIT 1`
    )
    .get(participantId) as
    | {
        roundNo: 1 | 2;
        mode: "manual" | "ai_assisted";
        startedAt: string;
        answersJson: string;
        activeSeconds: number;
        version: number;
        aiInitialJson: string;
        paperId: string;
        paperCode: string;
        title: string;
        doi: string | null;
        journal: string | null;
        sourceUrl: string | null;
        taskPrompt: string;
      }
    | undefined;
  if (!round) return null;

  const base = {
    status: "active" as const,
    project: {
      id: participant.projectId,
      name: participant.projectName,
      fields: parseJson(participant.fieldsJson, TEACHING_FIELDS) as typeof TEACHING_FIELDS,
    },
    participant: { studentAlias: participant.studentAlias },
    paper: {
      id: round.paperId,
      code: assertPaperCode(round.paperCode),
      title: round.title,
      doi: round.doi ?? "",
      journal: round.journal ?? "",
      sourceUrl: round.sourceUrl ?? "",
      taskPrompt: round.taskPrompt,
    },
    roundNo: round.roundNo,
    totalRounds: 2 as const,
    startedAt: round.startedAt,
    answers: parseJson<TeachingAnswers>(round.answersJson, {}),
    activeSeconds: round.activeSeconds,
    version: round.version,
  };
  if (round.mode === "ai_assisted") {
    return {
      ...base,
      mode: "ai_assisted",
      aiInitial: parseJson<TeachingAnswers>(round.aiInitialJson, {}),
    };
  }
  return { ...base, mode: "manual" };
}

export function saveCurrentTeachingDraft(
  participantId: string,
  expectedVersion: number,
  answers: TeachingAnswers
): { version: number; updatedAt: string } {
  const store = getTeachingDb();
  return store.transaction(() => {
    const participant = store
      .prepare(
        `SELECT pt.completed_at AS completedAt
         FROM teaching_participants pt
         JOIN teaching_projects pr ON pr.id = pt.project_id
         WHERE pt.id = ?
           AND pt.sequence_code IN ('manual_then_ai', 'ai_then_manual')
           AND pr.is_default = 1`
      )
      .get(participantId) as { completedAt: string | null } | undefined;
    if (!participant) throw new Error("Teaching participant was not found.");
    if (participant.completedAt) throw new Error("The teaching experiment is already complete and locked.");

    const current = store
      .prepare(
        `SELECT id, version FROM teaching_submissions
         WHERE participant_id = ? AND submitted_at IS NULL AND round_no IN (1, 2)
         ORDER BY round_no ASC LIMIT 1`
      )
      .get(participantId) as { id: string; version: number } | undefined;
    if (!current) throw new Error("No active teaching round is available; the answers are locked.");
    if (current.version !== expectedVersion) {
      throw new Error("Draft version mismatch; refresh before updating.");
    }

    const updatedAt = now();
    const result = store
      .prepare(
        `UPDATE teaching_submissions
         SET answers_json = ?, version = version + 1, updated_at = ?
         WHERE id = ? AND submitted_at IS NULL AND version = ?`
      )
      .run(JSON.stringify(normalizedAnswers(answers)), updatedAt, current.id, expectedVersion);
    if (result.changes !== 1) throw new Error("Draft version mismatch; refresh before updating.");
    return { version: expectedVersion + 1, updatedAt };
  }).immediate();
}

export function submitCurrentTeachingRound(
  participantId: string,
  expected?: TeachingRoundExpectation
): TeachingRoundTransition {
  const store = getTeachingDb();
  let failure: unknown;
  const transition = store.transaction((): TeachingRoundTransition => {
    ensureCanonicalTeachingScoring(store);
    const participant = store
      .prepare(
        `SELECT pt.completed_at AS completedAt
         FROM teaching_participants pt
         JOIN teaching_projects pr ON pr.id = pt.project_id
         WHERE pt.id = ?
           AND pt.sequence_code IN ('manual_then_ai', 'ai_then_manual')
           AND pr.is_default = 1`
      )
      .get(participantId) as { completedAt: string | null } | undefined;
    if (!participant) throw new Error("Teaching participant was not found.");
    if (participant.completedAt) {
      if (expected) {
        const completedRound = store
          .prepare(
            `SELECT round_no AS roundNo, version
             FROM teaching_submissions
             WHERE participant_id = ? AND submitted_at IS NOT NULL
               AND round_no IN (1, 2)
             ORDER BY round_no DESC LIMIT 1`
          )
          .get(participantId) as { roundNo: 1 | 2; version: number } | undefined;
        if (!completedRound || completedRound.roundNo !== expected.roundNo) {
          throw new TeachingRoundConflictError(
            "The submitted teaching round is stale.",
            "stale_round"
          );
        }
        if (completedRound.version !== expected.version + 1) {
          throw new TeachingRoundConflictError(
            "The submitted teaching draft version is stale.",
            "version"
          );
        }
      }
      return { status: "complete", completedAt: participant.completedAt };
    }

    const current = store
      .prepare(
        `SELECT id, round_no AS roundNo, answers_json AS answersJson, version
         FROM teaching_submissions
         WHERE participant_id = ? AND submitted_at IS NULL AND round_no IN (1, 2)
         ORDER BY round_no ASC LIMIT 1`
      )
      .get(participantId) as
      | { id: string; roundNo: 1 | 2; answersJson: string; version: number }
      | undefined;
    if (!current) throw new Error("No active teaching round is available.");
    if (expected?.roundNo !== undefined && current.roundNo !== expected.roundNo) {
      throw new TeachingRoundConflictError(
        "The submitted teaching round is stale.",
        "stale_round"
      );
    }
    if (expected?.version !== undefined && current.version !== expected.version) {
      throw new TeachingRoundConflictError(
        "The submitted teaching draft version is stale.",
        "version"
      );
    }

    const answers = JSON.parse(current.answersJson) as TeachingAnswers;
    const missing = TEACHING_FIELDS.filter(
      (field) => !answers[field.key]?.value?.trim()
    );
    if (missing.length) throw new Error("All six teaching values are required before submission.");

    const submittedAt = now();
    store
      .prepare(
        `UPDATE teaching_submissions
         SET submitted_at = ?, updated_at = ?, version = version + 1
         WHERE id = ? AND submitted_at IS NULL`
      )
      .run(submittedAt, submittedAt, current.id);

    try {
      const scoringRow = loadScoringRow(store, current.id);
      if (!scoringRow) throw new Error("Submitted teaching round was not found for scoring.");
      saveAutomaticScore(store, current.id, scoreStoredSubmission(scoringRow), submittedAt);
    } catch (error) {
      store
        .prepare(
          `UPDATE teaching_submissions
           SET scoring_version = ?, scoring_status = 'scoring_error', auto_scored_at = NULL
           WHERE id = ?`
        )
        .run(DEFAULT_EXPERIMENT.scoringVersion, current.id);
      failure = error;
    }

    if (current.roundNo === 1) {
      const activated = store
        .prepare(
          `UPDATE teaching_submissions
           SET version = ?, started_at = ?, updated_at = ?
           WHERE participant_id = ? AND round_no = 2 AND submitted_at IS NULL`
        )
        .run(current.version + 1, submittedAt, submittedAt, participantId);
      if (activated.changes !== 1) throw new Error("Round 2 could not be activated.");
      return { status: "next_round", roundNo: 2 };
    }
    store
      .prepare("UPDATE teaching_participants SET completed_at = ? WHERE id = ?")
      .run(submittedAt, participantId);
    return { status: "complete", completedAt: submittedAt };
  }).immediate();

  if (failure) throw scoringError(failure);
  return transition;
}

export function rescoreTeachingSubmission(submissionId: string): TeachingAutoScore {
  const store = getTeachingDb();
  let result: TeachingAutoScore | undefined;
  let failure: unknown;
  store.transaction(() => {
    ensureCanonicalTeachingScoring(store);
    const row = loadScoringRow(store, submissionId);
    if (!row) throw new Error("Teaching submission was not found.");
    if (!row.submittedAt) throw new Error("Teaching submission must be submitted and locked before rescoring.");
    try {
      result = scoreStoredSubmission(row);
      saveAutomaticScore(store, submissionId, result, now());
    } catch (error) {
      store
        .prepare(
          `UPDATE teaching_submissions
           SET scoring_version = ?, scoring_status = 'scoring_error', auto_scored_at = NULL
           WHERE id = ?`
        )
        .run(DEFAULT_EXPERIMENT.scoringVersion, submissionId);
      failure = error;
    }
  }).immediate();

  if (failure) throw scoringError(failure);
  if (!result) throw new Error("Teaching submission could not be rescored.");
  return result;
}

export function rescoreErroredTeachingSubmissions(limit = 20): number {
  const normalizedLimit = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 20;
  if (normalizedLimit === 0) return 0;
  const store = getTeachingDb();
  const ids = store.transaction(() => {
    ensureCanonicalTeachingScoring(store);
    return store
      .prepare(
        `SELECT s.id
         FROM teaching_submissions s
         JOIN teaching_participants pt ON pt.id = s.participant_id
         JOIN teaching_projects pr ON pr.id = s.project_id
         WHERE s.scoring_status = 'scoring_error' AND s.submitted_at IS NOT NULL
           AND s.round_no IN (1, 2)
           AND pt.sequence_code IN ('manual_then_ai', 'ai_then_manual')
           AND pr.is_default = 1
         ORDER BY s.submitted_at ASC, s.id ASC LIMIT ?`
      )
      .pluck()
      .all(normalizedLimit) as string[];
  }).immediate();
  let rescored = 0;
  for (const id of ids) {
    try {
      rescoreTeachingSubmission(id);
      rescored += 1;
    } catch {
      // Keep malformed rows in scoring_error so a later repair can retry them.
    }
  }
  return rescored;
}
