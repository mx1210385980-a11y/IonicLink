import { createHash, randomUUID } from "node:crypto";
import {
  GROUP_CROSSOVER_SCORING_VERSION,
  TEACHING_FIELDS,
  type GroupCrossoverDashboard,
  type GroupCrossoverGroupProgress,
  type GroupCrossoverListItem,
  type GroupCrossoverRosterEntry,
  type TeachingAnswers,
  type TeachingAutoScore,
  type TeachingDashboardParticipant,
  type TeachingExperimentAnalysisRow,
  type TeachingExperimentPaper,
  type TeachingFieldKey,
  type TeachingFieldScore,
  type TeachingGoldRule,
  type TeachingMode,
  type TeachingScores,
  type TeachingSequence,
  type TeachingTeacherAiRound,
  type TeachingTeacherManualRound,
  type TeachingTeacherReview,
  type TeachingTeacherRound,
} from "../teachingShared";
import {
  isTeachingExperimentAnalysisEligible,
  summarizeGroupCrossoverDiagnostics,
  summarizeTeachingExperiment,
  teachingParticipantQuality,
  teachingPairedDifferences,
} from "./analytics";
import { teachingTimingQuality } from "./activity";
import { normalizeStudentAlias, studentIdentityKey } from "./assignment";
import {
  buildAiSnapshot,
  buildGoldRules,
  checkedRecordUsability,
  loadCheckedRecord,
} from "./groupGold";
import { scoreAiBehavior, scoreSubmission } from "./scoring";
import { getTeachingDb } from "./store";

/**
 * Group-crossover experiment (experiment_kind = "group_crossover").
 *
 * The teacher creates the experiment with an even number of groups and picks
 * one checked tribology record per group; the system assigns record i to
 * group i. Groups pair by number — (1,2), (3,4), … — into super-groups.
 * Within a super-group the odd group starts AI-assisted on its own paper and
 * the even group starts manual; round 2 swaps papers and flips modes.
 *
 * Students join with the experiment code plus their roster name; unknown
 * names are rejected. Papers and configuration freeze at creation time.
 */

export class TeachingRosterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TeachingRosterError";
  }
}

const GROUP_TASK_PROMPT =
  "请提取该文献摩擦学实验的六个关键字段:阳离子、阴离子、基底、温度、载荷、摩擦系数,并注明页码与原文依据。";

function now(): string {
  return new Date().toISOString();
}

function clean(value: unknown, max = 240): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function groupCrossoverChecksum(input: {
  groupCount: number;
  papers: Array<{ recordId: string; groupNo: number }>;
}): string {
  const canonical = {
    groupCount: input.groupCount,
    papers: [...input.papers].sort((a, b) => a.groupNo - b.groupNo),
    scoringVersion: GROUP_CROSSOVER_SCORING_VERSION,
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

function loadGroupProject(projectId: string):
  | { id: string; name: string; inviteCode: string; groupCount: number; status: string }
  | undefined {
  return getTeachingDb()
    .prepare(
      `SELECT id, name, invite_code AS inviteCode, group_count AS groupCount, status
       FROM teaching_projects
       WHERE id = ? AND experiment_kind = 'group_crossover'`
    )
    .get(projectId) as
    | { id: string; name: string; inviteCode: string; groupCount: number; status: string }
    | undefined;
}

export function createGroupCrossoverExperiment(input: {
  name: string;
  inviteCode: string;
  groupCount: number;
  recordIds: string[];
}): { projectId: string } {
  const name = clean(input.name, 160);
  const inviteCode = clean(input.inviteCode, 40).toUpperCase().replace(/\s+/g, "");
  const groupCount = Math.floor(Number(input.groupCount));
  const recordIds = Array.isArray(input.recordIds) ? input.recordIds.map((id) => clean(id, 80)) : [];

  if (!name) throw new Error("请填写实验名称。");
  if (inviteCode.length < 4) throw new Error("实验代码至少需要 4 位。");
  if (!Number.isFinite(groupCount) || groupCount < 2 || groupCount > 40 || groupCount % 2 !== 0) {
    throw new Error("小组数量必须是 2 到 40 之间的偶数。");
  }
  if (recordIds.length !== groupCount) {
    throw new Error(`文献池需要恰好 ${groupCount} 条已审核记录(当前 ${recordIds.length} 条)。`);
  }
  if (new Set(recordIds).size !== recordIds.length) {
    throw new Error("文献池中存在重复记录,请调整选择。");
  }

  const store = getTeachingDb();
  const inviteTaken = store
    .prepare("SELECT 1 FROM teaching_projects WHERE invite_code = ?")
    .get(inviteCode);
  if (inviteTaken) throw new Error("这个实验代码已被使用,请换一个。");

  const papers = recordIds.map((recordId, index) => {
    const record = loadCheckedRecord(recordId);
    const usability = checkedRecordUsability(record);
    if (!usability.usable) {
      throw new Error(
        `记录 ${recordId} 缺少必需字段(${usability.missing.join("、")}),不能作为实验文献。`
      );
    }
    return {
      groupNo: index + 1,
      recordId,
      record,
      gold: buildGoldRules(record),
      aiSnapshot: buildAiSnapshot(record),
    };
  });

  const projectId = randomUUID();
  const timestamp = now();
  const checksum = groupCrossoverChecksum({
    groupCount,
    papers: papers.map(({ recordId, groupNo }) => ({ recordId, groupNo })),
  });

  store.transaction(() => {
    store
      .prepare(
        `INSERT INTO teaching_projects
         (id, name, domain, invite_code, status, fields_json, created_at,
          experiment_kind, config_version, config_checksum, is_default, group_count)
         VALUES (?, ?, 'tribology', ?, 'open', ?, ?, 'group_crossover', ?, ?, 0, ?)`
      )
      .run(
        projectId,
        name,
        inviteCode,
        JSON.stringify(TEACHING_FIELDS),
        timestamp,
        GROUP_CROSSOVER_SCORING_VERSION,
        checksum,
        groupCount
      );

    const insertPaper = store.prepare(
      `INSERT INTO teaching_papers
       (id, project_id, paper_no, title, doi, journal, source_url, source_record_id,
        ai_snapshot_json, ai_model, ai_extracted_at, created_at,
        task_prompt, gold_snapshot_json, scoring_rules_json, config_version, group_no)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const paper of papers) {
      insertPaper.run(
        randomUUID(),
        projectId,
        String(paper.groupNo),
        clean(paper.record.paper?.title, 300) || paper.recordId,
        clean(paper.record.paper?.doi, 160) || null,
        clean(paper.record.paper?.journal, 200) || null,
        null,
        paper.recordId,
        JSON.stringify(paper.aiSnapshot),
        clean(paper.record.extraction?.model, 160) || null,
        clean(paper.record.createdAt, 80) || timestamp,
        timestamp,
        GROUP_TASK_PROMPT,
        JSON.stringify(
          Object.fromEntries(
            Object.entries(paper.gold).map(([key, rule]) => [key, rule.value])
          )
        ),
        JSON.stringify(paper.gold),
        GROUP_CROSSOVER_SCORING_VERSION,
        paper.groupNo
      );
    }
  }).immediate();

  return { projectId };
}

export function listGroupCrossoverExperiments(): GroupCrossoverListItem[] {
  const store = getTeachingDb();
  return store
    .prepare(
      `SELECT
         pr.id, pr.name, pr.invite_code AS inviteCode, pr.group_count AS groupCount,
         pr.status, pr.created_at AS createdAt,
         (SELECT COUNT(*) FROM teaching_papers p WHERE p.project_id = pr.id) AS paperCount,
         (SELECT COUNT(*) FROM teaching_roster r WHERE r.project_id = pr.id) AS rosterCount,
         (SELECT COUNT(*) FROM teaching_participants pt WHERE pt.project_id = pr.id) AS participantCount
       FROM teaching_projects pr
       WHERE pr.experiment_kind = 'group_crossover'
       ORDER BY pr.created_at DESC, pr.id DESC`
    )
    .all() as GroupCrossoverListItem[];
}

export type GroupRosterImportEntry = { studentName: string; groupNo: number };

export type GroupRosterImportResult = {
  added: number;
  updated: number;
  rejected: Array<{ line: number; studentName: string; reason: string }>;
};

export function importGroupRoster(
  projectId: string,
  entries: GroupRosterImportEntry[]
): GroupRosterImportResult {
  const store = getTeachingDb();
  const project = loadGroupProject(projectId);
  if (!project) throw new Error("没有找到这个分组交叉实验。");

  const result: GroupRosterImportResult = { added: 0, updated: 0, rejected: [] };
  const seen = new Set<string>();

  store.transaction(() => {
    entries.forEach((entry, index) => {
      const line = index + 1;
      let studentName: string;
      try {
        studentName = normalizeStudentAlias(entry.studentName ?? "");
      } catch {
        result.rejected.push({ line, studentName: String(entry.studentName ?? ""), reason: "姓名需为 2-80 个字符" });
        return;
      }
      const groupNo = Math.floor(Number(entry.groupNo));
      if (!Number.isFinite(groupNo) || groupNo < 1 || groupNo > project.groupCount) {
        result.rejected.push({ line, studentName, reason: `组号需在 1-${project.groupCount} 之间` });
        return;
      }
      const identityKey = studentIdentityKey(studentName);
      if (seen.has(identityKey)) {
        result.rejected.push({ line, studentName, reason: "本次导入中姓名重复" });
        return;
      }
      seen.add(identityKey);

      const existing = store
        .prepare(
          `SELECT id, participant_id AS participantId
           FROM teaching_roster WHERE project_id = ? AND identity_key = ?`
        )
        .get(projectId, identityKey) as { id: string; participantId: string | null } | undefined;

      if (existing?.participantId) {
        result.rejected.push({ line, studentName, reason: "该学生已加入实验,名单不可再修改" });
        return;
      }
      if (existing) {
        store
          .prepare(
            `UPDATE teaching_roster SET student_name = ?, group_no = ? WHERE id = ?`
          )
          .run(studentName, groupNo, existing.id);
        result.updated += 1;
        return;
      }
      store
        .prepare(
          `INSERT INTO teaching_roster
           (id, project_id, student_name, identity_key, group_no, participant_id, created_at)
           VALUES (?, ?, ?, ?, ?, NULL, ?)`
        )
        .run(randomUUID(), projectId, studentName, identityKey, groupNo, now());
      result.added += 1;
    });
  }).immediate();

  return result;
}

export function deleteGroupRosterEntry(projectId: string, rosterId: string): void {
  const store = getTeachingDb();
  const row = store
    .prepare(
      `SELECT participant_id AS participantId
       FROM teaching_roster WHERE id = ? AND project_id = ?`
    )
    .get(rosterId, projectId) as { participantId: string | null } | undefined;
  if (!row) throw new Error("没有找到这条名单记录。");
  if (row.participantId) throw new Error("该学生已加入实验,名单不可删除。");
  store.prepare("DELETE FROM teaching_roster WHERE id = ?").run(rosterId);
}

export function listGroupRoster(projectId: string): GroupCrossoverRosterEntry[] {
  return getTeachingDb()
    .prepare(
      `SELECT id, student_name AS studentName, group_no AS groupNo,
              participant_id IS NOT NULL AS claimed
       FROM teaching_roster WHERE project_id = ?
       ORDER BY group_no ASC, student_name ASC`
    )
    .all(projectId)
    .map((row) => {
      const entry = row as { id: string; studentName: string; groupNo: number; claimed: number };
      return { ...entry, claimed: entry.claimed === 1 };
    });
}

export function joinGroupCrossoverExperiment(
  inviteCode: string,
  studentName: string
): { projectId: string; participantId: string } {
  const displayAlias = normalizeStudentAlias(studentName);
  const identityKey = studentIdentityKey(displayAlias);
  const code = clean(inviteCode, 40).toUpperCase().replace(/\s+/g, "");
  const store = getTeachingDb();

  const project = store
    .prepare(
      `SELECT id, group_count AS groupCount
       FROM teaching_projects
       WHERE invite_code = ? AND experiment_kind = 'group_crossover' AND status = 'open'`
    )
    .get(code) as { id: string; groupCount: number } | undefined;
  if (!project) {
    throw new TeachingRosterError("没有找到这个分组实验,请核对实验代码。");
  }

  const rosterEntry = store
    .prepare(
      `SELECT id, group_no AS groupNo, participant_id AS participantId
       FROM teaching_roster WHERE project_id = ? AND identity_key = ?`
    )
    .get(project.id, identityKey) as
    | { id: string; groupNo: number; participantId: string | null }
    | undefined;
  if (!rosterEntry) {
    throw new TeachingRosterError("你的姓名/学号不在本次实验名单中,请核对或联系老师。");
  }
  if (rosterEntry.participantId) {
    return { projectId: project.id, participantId: rosterEntry.participantId };
  }

  return store.transaction(() => {
    const groupNo = rosterEntry.groupNo;
    const partnerGroupNo = groupNo % 2 === 1 ? groupNo + 1 : groupNo - 1;
    const paperRows = store
      .prepare(
        `SELECT id, group_no AS groupNo, ai_snapshot_json AS aiSnapshotJson
         FROM teaching_papers WHERE project_id = ? AND group_no IN (?, ?)`
      )
      .all(project.id, groupNo, partnerGroupNo) as Array<{
      id: string;
      groupNo: number;
      aiSnapshotJson: string;
    }>;
    const ownPaper = paperRows.find((paper) => paper.groupNo === groupNo);
    const partnerPaper = paperRows.find((paper) => paper.groupNo === partnerGroupNo);
    if (!ownPaper || !partnerPaper) {
      throw new Error("分组实验的文献分配不完整,请联系老师。");
    }

    // Odd groups start AI-assisted on their own paper; even groups start
    // manual. Round 2 swaps to the partner group's paper and flips the mode.
    const aiFirst = groupNo % 2 === 1;
    const sequence = aiFirst ? "ai_then_manual" : "manual_then_ai";
    const rounds = aiFirst
      ? [
          { round: 1 as const, paper: ownPaper, mode: "ai_assisted" as const },
          { round: 2 as const, paper: partnerPaper, mode: "manual" as const },
        ]
      : [
          { round: 1 as const, paper: ownPaper, mode: "manual" as const },
          { round: 2 as const, paper: partnerPaper, mode: "ai_assisted" as const },
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
        String(groupNo),
        displayAlias,
        ownPaper.id,
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

    const claimed = store
      .prepare(
        `UPDATE teaching_roster SET participant_id = ?
         WHERE id = ? AND participant_id IS NULL`
      )
      .run(participantId, rosterEntry.id);
    if (claimed.changes !== 1) {
      throw new Error("名单认领失败,请重试。");
    }

    return { projectId: project.id, participantId };
  }).immediate();
}

// ---------------------------------------------------------------------------
// Dashboard: per-group progress, override-aware scoring, paired analytics
// ---------------------------------------------------------------------------

type GroupSubmissionRow = {
  submissionId: string;
  participantId: string;
  roundNo: 1 | 2 | null;
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
  paperGroupNo: number | null;
  title: string;
  doi: string | null;
  journal: string | null;
  sourceUrl: string | null;
  taskPrompt: string;
  aiModel: string | null;
  scoringRulesJson: string;
  reviewedAt: string | null;
  finalValueScoresJson: string | null;
  aiInitialValueScoresJson: string | null;
};

function parsedObject<T extends object>(value: string): T | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as T)
      : null;
  } catch {
    return null;
  }
}

function parsedTeachingAnswers(value: string): TeachingAnswers | null {
  const parsed = parsedObject<Record<string, unknown>>(value);
  if (!parsed) return null;
  const answers: TeachingAnswers = {};
  for (const field of TEACHING_FIELDS) {
    const candidate = parsed[field.key];
    if (candidate === null || typeof candidate !== "object" || Array.isArray(candidate)) {
      continue;
    }
    const answer = candidate as Record<string, unknown>;
    if (typeof answer.value !== "string") continue;
    answers[field.key] = {
      value: answer.value,
      ...(typeof answer.page === "string" ? { page: answer.page } : {}),
      ...(typeof answer.evidence === "string" ? { evidence: answer.evidence } : {}),
    };
  }
  return answers;
}

function parsedFieldScores(value: string): TeachingAutoScore["values"] | null {
  const parsed = parsedObject<Record<string, unknown>>(value);
  if (!parsed) return null;
  const scores = {} as TeachingAutoScore["values"];
  for (const field of TEACHING_FIELDS) {
    const candidate = parsed[field.key];
    if (candidate === null || typeof candidate !== "object" || Array.isArray(candidate)) {
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

function parsedTeachingScores(value: string | null): TeachingScores {
  const parsed = value ? parsedObject<Record<string, unknown>>(value) : null;
  if (!parsed) return {};
  const scores: TeachingScores = {};
  for (const field of TEACHING_FIELDS) {
    const score = parsed[field.key];
    if (score === "correct" || score === "incorrect" || score === "pending") {
      scores[field.key] = score;
    }
  }
  return scores;
}

function groupTeachingReview(row: GroupSubmissionRow): TeachingTeacherReview | null {
  if (!row.reviewedAt) return null;
  return {
    reviewedAt: row.reviewedAt,
    finalValueScores: parsedTeachingScores(row.finalValueScoresJson),
    aiInitialValueScores: parsedTeachingScores(row.aiInitialValueScoresJson),
  };
}

/**
 * Teacher review overrides win over automatic value scores: fields marked
 * correct/incorrect by the teacher replace the automatic verdict, everything
 * else keeps the automatic result. Evidence subscores stay automatic.
 */
export function applyTeacherOverride(
  auto: TeachingAutoScore,
  override: TeachingScores
): TeachingAutoScore {
  const values = { ...auto.values };
  let valueCorrect = 0;
  for (const field of TEACHING_FIELDS) {
    const verdict = override[field.key];
    if (verdict === "correct" || verdict === "incorrect") {
      values[field.key] = {
        correct: verdict === "correct",
        normalized: auto.values[field.key].normalized,
        reason: "teacher_override",
      };
    }
    if (values[field.key].correct) valueCorrect += 1;
  }
  return {
    ...auto,
    values,
    valueCorrect,
    valueAccuracy: valueCorrect / TEACHING_FIELDS.length,
  };
}

function groupRoundAnalysis(
  row: GroupSubmissionRow,
  expected: { roundNo: 1 | 2; mode: TeachingMode; paperCode: string }
): TeachingTeacherRound | null {
  if (
    row.roundNo !== expected.roundNo ||
    row.mode !== expected.mode ||
    row.paperCode !== expected.paperCode ||
    row.submittedAt === null ||
    row.scoringStatus !== "scored" ||
    row.scoringVersion !== GROUP_CROSSOVER_SCORING_VERSION ||
    row.autoScoredAt === null ||
    !Number.isFinite(Date.parse(row.autoScoredAt)) ||
    !Number.isFinite(row.activeSeconds) ||
    row.activeSeconds < 0
  ) {
    return null;
  }
  const startedAt = Date.parse(row.startedAt);
  const submittedAt = Date.parse(row.submittedAt);
  if (!Number.isFinite(startedAt) || !Number.isFinite(submittedAt) || submittedAt < startedAt) {
    return null;
  }

  const answers = parsedTeachingAnswers(row.answersJson);
  const aiInitial = parsedTeachingAnswers(row.aiInitialJson);
  const gold = parsedObject<Record<TeachingFieldKey, TeachingGoldRule>>(row.scoringRulesJson);
  const values = parsedFieldScores(row.valueScoresJson);
  const evidence = parsedFieldScores(row.evidenceScoresJson);
  if (!answers || !aiInitial || !gold || !values || !evidence) return null;

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

  let coverage: TeachingAutoScore;
  try {
    coverage = scoreSubmission(answers, paper);
  } catch {
    return null;
  }
  const denominator = TEACHING_FIELDS.length;
  const valueCorrect = TEACHING_FIELDS.filter((field) => values[field.key].correct).length;
  const evidenceCorrect = TEACHING_FIELDS.filter((field) => evidence[field.key].correct).length;
  const automatic: TeachingAutoScore = {
    values,
    evidence,
    valueCorrect,
    valueAccuracy: valueCorrect / denominator,
    valueCoverage: coverage.valueCoverage,
    evidenceCorrect,
    evidenceAccuracy: evidenceCorrect / denominator,
    evidenceCoverage: coverage.evidenceCoverage,
  };

  const review = groupTeachingReview(row);
  const score = review ? applyTeacherOverride(automatic, review.finalValueScores) : automatic;

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
  const common = {
    submissionId: row.submissionId,
    paperCode: expected.paperCode,
    activeSeconds: row.activeSeconds,
    wallSeconds,
    score,
    aiBehavior,
    timingQuality: teachingTimingQuality(row.activeSeconds, wallSeconds),
    finalAnswers: answers,
    review,
  };
  return expected.mode === "manual"
    ? { ...common, mode: "manual" }
    : { ...common, mode: "ai_assisted", aiInitial };
}

function groupAssignments(
  sequence: TeachingSequence,
  groupNo: number
): Array<{ key: "manual" | "aiAssisted"; roundNo: 1 | 2; mode: TeachingMode; paperCode: string }> {
  const ownPaper = String(groupNo);
  const partnerPaper = String(groupNo % 2 === 1 ? groupNo + 1 : groupNo - 1);
  return sequence === "ai_then_manual"
    ? [
        { key: "aiAssisted", roundNo: 1, mode: "ai_assisted", paperCode: ownPaper },
        { key: "manual", roundNo: 2, mode: "manual", paperCode: partnerPaper },
      ]
    : [
        { key: "manual", roundNo: 1, mode: "manual", paperCode: ownPaper },
        { key: "aiAssisted", roundNo: 2, mode: "ai_assisted", paperCode: partnerPaper },
      ];
}

export function getGroupCrossoverDashboard(projectId: string): GroupCrossoverDashboard {
  const store = getTeachingDb();
  const project = store
    .prepare(
      `SELECT id, name, invite_code AS inviteCode, group_count AS groupCount
       FROM teaching_projects
       WHERE id = ? AND experiment_kind = 'group_crossover'`
    )
    .get(projectId) as
    | { id: string; name: string; inviteCode: string; groupCount: number }
    | undefined;
  if (!project) throw new Error("没有找到这个分组交叉实验。");

  const papers = store
    .prepare(
      `SELECT id, paper_no AS code, title, doi, journal, source_url AS sourceUrl,
              group_no AS groupNo
       FROM teaching_papers WHERE project_id = ? ORDER BY group_no ASC`
    )
    .all(projectId) as Array<{
    id: string;
    code: string;
    title: string;
    doi: string | null;
    journal: string | null;
    sourceUrl: string | null;
    groupNo: number;
  }>;

  const roster = listGroupRoster(projectId);

  const participants = store
    .prepare(
      `SELECT pt.id AS participantId, pt.student_alias AS studentAlias,
              pt.sequence_code AS sequenceCode, pt.completed_at AS completedAt,
              pt.exclusion_reason AS exclusionReason, pt.group_code AS groupCode
       FROM teaching_participants pt
       WHERE pt.project_id = ?
         AND pt.sequence_code IN ('manual_then_ai', 'ai_then_manual')
       ORDER BY pt.created_at ASC, pt.id ASC`
    )
    .all(projectId) as Array<{
    participantId: string;
    studentAlias: string;
    sequenceCode: string;
    completedAt: string | null;
    exclusionReason: string | null;
    groupCode: string;
  }>;

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
              p.id AS paperId, p.paper_no AS paperCode, p.group_no AS paperGroupNo,
              p.title, p.doi, p.journal,
              p.source_url AS sourceUrl, p.task_prompt AS taskPrompt,
              p.ai_model AS aiModel, p.scoring_rules_json AS scoringRulesJson,
              r.reviewed_at AS reviewedAt,
              r.human_scores_json AS finalValueScoresJson,
              r.ai_scores_json AS aiInitialValueScoresJson
       FROM teaching_submissions s
       JOIN teaching_papers p ON p.id = s.paper_id
       LEFT JOIN teaching_reviews r ON r.submission_id = s.id
       WHERE s.project_id = ?
       ORDER BY s.participant_id ASC, s.round_no ASC, s.id ASC`
    )
    .all(projectId) as GroupSubmissionRow[];
  const submissionsByParticipant = new Map<string, GroupSubmissionRow[]>();
  for (const submission of submissions) {
    const existing = submissionsByParticipant.get(submission.participantId);
    if (existing) existing.push(submission);
    else submissionsByParticipant.set(submission.participantId, [submission]);
  }

  const analysisRows = participants.map((participant) => {
    const sequence: TeachingSequence =
      participant.sequenceCode === "ai_then_manual" ? "ai_then_manual" : "manual_then_ai";
    const groupNo = Number.parseInt(participant.groupCode, 10);
    const participantSubmissions = submissionsByParticipant.get(participant.participantId) ?? [];
    const rounds: {
      manual: TeachingTeacherManualRound | null;
      aiAssisted: TeachingTeacherAiRound | null;
    } = { manual: null, aiAssisted: null };
    for (const assignment of groupAssignments(sequence, groupNo)) {
      const candidates = participantSubmissions.filter(
        (submission) =>
          submission.roundNo === assignment.roundNo &&
          submission.mode === assignment.mode &&
          submission.paperCode === assignment.paperCode
      );
      const round = candidates.length === 1 ? groupRoundAnalysis(candidates[0], assignment) : null;
      if (assignment.key === "manual") {
        rounds.manual = round?.mode === "manual" ? round : null;
      } else {
        rounds.aiAssisted = round?.mode === "ai_assisted" ? round : null;
      }
    }
    return {
      participantId: participant.participantId,
      studentAlias: participant.studentAlias,
      sequence,
      groupNo,
      completed: participant.completedAt !== null,
      exclusionReason: participant.exclusionReason,
      ...rounds,
    };
  });

  const summaryRows: TeachingExperimentAnalysisRow[] = analysisRows.map(
    ({ groupNo: _groupNo, ...row }) => row
  );
  const summary = summarizeTeachingExperiment(summaryRows);
  const diagnostics = summarizeGroupCrossoverDiagnostics(analysisRows);

  const results: TeachingDashboardParticipant[] = analysisRows.map((row) => {
    const differences = isTeachingExperimentAnalysisEligible(row)
      ? teachingPairedDifferences(row)
      : null;
    const { groupNo: _groupNo, ...participant } = row;
    return {
      ...participant,
      quality: teachingParticipantQuality(participant),
      activeTimeDifference: differences?.activeTimeDifference ?? null,
      accuracyDifference: differences?.accuracyDifference ?? null,
    };
  });

  const groupProgress: GroupCrossoverGroupProgress[] = papers.map((paper) => {
    const groupParticipants = analysisRows.filter((row) => row.groupNo === paper.groupNo);
    return {
      groupNo: paper.groupNo,
      paperCode: paper.code,
      paperTitle: paper.title,
      rosterSize: roster.filter((entry) => entry.groupNo === paper.groupNo).length,
      joined: groupParticipants.length,
      completed: groupParticipants.filter((row) => row.completed).length,
    };
  });

  return {
    experiment: {
      id: project.id,
      name: project.name,
      inviteCode: project.inviteCode,
      groupCount: project.groupCount,
      scoringVersion: GROUP_CROSSOVER_SCORING_VERSION,
      papers: papers.map(({ id, code, title, doi, journal, sourceUrl, groupNo }) => ({
        id,
        code,
        title,
        doi: doi ?? "",
        journal: journal ?? "",
        sourceUrl: sourceUrl ?? "",
        groupNo,
      })),
    },
    roster,
    groupProgress,
    summary,
    diagnostics,
    participants: results,
  };
}
