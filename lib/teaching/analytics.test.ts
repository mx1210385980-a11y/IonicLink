import assert from "node:assert/strict";
import type Database from "better-sqlite3";
import {
  addTeachingPaper,
  getDefaultTeachingDashboard,
  joinDefaultTeachingExperiment,
  joinTeachingProject,
  reviewTeachingSubmission,
} from "../teaching";
import { DEFAULT_EXPERIMENT, defaultExperimentChecksum } from "./config";
import { scoreSubmission } from "./scoring";
import { closeTeachingStoreForTests, getTeachingDb } from "./store";
import {
  bootstrapMedianCi,
  median,
  summarizeTeachingExperimentDiagnostics,
  summarizeTeachingExperiment,
  teachingParticipantQuality,
  wilcoxonSignedRank,
} from "./analytics";
import {
  TEACHING_FIELDS,
  type TeachingAiBehavior,
  type TeachingAutoScore,
  type TeachingExperimentAnalysisRow,
  type TeachingModeSummary,
  type TeachingRoundAnalysis,
  type TeachingSequence,
  type TeachingTimingQuality,
} from "../teachingShared";

type ApprovedModeSummaryKey =
  | "n"
  | "medianActiveSeconds"
  | "medianAccuracy"
  | "meanAccuracy"
  | "medianCoverage"
  | "medianEvidenceAccuracy"
  | "medianEvidenceCoverage";
type ModeSummaryHasOnlyApprovedKeys = Exclude<
  keyof TeachingModeSummary,
  ApprovedModeSummaryKey
> extends never
  ? true
  : false;
const modeSummaryHasOnlyApprovedKeys: ModeSummaryHasOnlyApprovedKeys = true;
assert.equal(modeSummaryHasOnlyApprovedKeys, true);

function autoScore(correctCount: number): TeachingAutoScore {
  assert.equal(Number.isInteger(correctCount) && correctCount >= 0 && correctCount <= 6, true);
  const scoreMap = Object.fromEntries(
    TEACHING_FIELDS.map((field, index) => [
      field.key,
      {
        correct: index < correctCount,
        normalized: `${field.key}-${index < correctCount ? "correct" : "incorrect"}`,
        reason: index < correctCount ? "fixture_correct" : "fixture_incorrect",
      },
    ])
  ) as TeachingAutoScore["values"];
  return {
    values: structuredClone(scoreMap),
    evidence: structuredClone(scoreMap),
    valueCorrect: correctCount,
    valueAccuracy: correctCount / 6,
    valueCoverage: 1,
    evidenceCorrect: correctCount,
    evidenceAccuracy: correctCount / 6,
    evidenceCoverage: 1,
  };
}

const correctedAiBehavior: TeachingAiBehavior = {
  suggested: 6,
  adopted: 5,
  modified: 1,
  initiallyIncorrect: 1,
  corrected: 1,
  incorrectlyAdopted: 0,
  adoptionRate: 5 / 6,
  modificationRate: 1 / 6,
  correctionRate: 1,
  incorrectAdoptionRate: 0,
};

const noErrorAiBehavior: TeachingAiBehavior = {
  suggested: 6,
  adopted: 6,
  modified: 0,
  initiallyIncorrect: 0,
  corrected: 0,
  incorrectlyAdopted: 0,
  adoptionRate: 1,
  modificationRate: 0,
  correctionRate: null,
  incorrectAdoptionRate: null,
};

function analysisRound(input: {
  submissionId: string;
  paperCode: "A" | "B";
  mode: "manual" | "ai_assisted";
  activeSeconds: number;
  wallSeconds?: number;
  correctCount: number;
  timingQuality?: TeachingTimingQuality;
  aiBehavior?: TeachingAiBehavior | null;
}): TeachingRoundAnalysis {
  return {
    submissionId: input.submissionId,
    paperCode: input.paperCode,
    mode: input.mode,
    activeSeconds: input.activeSeconds,
    wallSeconds: input.wallSeconds ?? input.activeSeconds,
    score: autoScore(input.correctCount),
    aiBehavior: input.aiBehavior ?? null,
    timingQuality: input.timingQuality ?? "valid",
  };
}

function pairedFixture(
  number: number,
  input: {
    sequence?: TeachingSequence;
    manualActive?: number;
    manualWall?: number;
    manualCorrect?: number;
    manualTiming?: TeachingTimingQuality;
    aiActive?: number;
    aiWall?: number;
    aiCorrect?: number;
    aiTiming?: TeachingTimingQuality;
    aiBehavior?: TeachingAiBehavior;
    completed?: boolean;
    exclusionReason?: string | null;
  } = {}
): TeachingExperimentAnalysisRow {
  const sequence = input.sequence ?? (number % 2 === 1 ? "manual_then_ai" : "ai_then_manual");
  const manualPaper = sequence === "manual_then_ai" ? "A" : "B";
  const aiPaper = sequence === "manual_then_ai" ? "B" : "A";
  return {
    participantId: `participant-${String(number).padStart(3, "0")}`,
    studentAlias: `Student ${String(number).padStart(3, "0")}`,
    sequence,
    completed: input.completed ?? true,
    exclusionReason: input.exclusionReason ?? null,
    manual: analysisRound({
      submissionId: `submission-${number}-manual`,
      paperCode: manualPaper,
      mode: "manual",
      activeSeconds: input.manualActive ?? 1_200,
      wallSeconds: input.manualWall,
      correctCount: input.manualCorrect ?? 4,
      timingQuality: input.manualTiming,
    }),
    aiAssisted: analysisRound({
      submissionId: `submission-${number}-ai`,
      paperCode: aiPaper,
      mode: "ai_assisted",
      activeSeconds: input.aiActive ?? 600,
      wallSeconds: input.aiWall,
      correctCount: input.aiCorrect ?? 5,
      timingQuality: input.aiTiming,
      aiBehavior: input.aiBehavior ?? correctedAiBehavior,
    }),
  };
}

assert.equal(median([]), null);
assert.equal(median([3, 1, 2]), 2);
assert.equal(median([4, 1, 3, 2]), 2.5);
assert.equal(median([Number.NaN, 1, Number.POSITIVE_INFINITY, 3]), 2);
const medianInput = [3, 1, 2];
median(medianInput);
assert.deepEqual(medianInput, [3, 1, 2], "median must not mutate its input");

assert.deepEqual(bootstrapMedianCi([Number.NaN, 4, Number.POSITIVE_INFINITY]), {
  low: 4,
  high: 4,
});
const bootstrapInput = [9, 1, 3, 5, 7];
const firstBootstrap = bootstrapMedianCi(bootstrapInput, 12345, 500);
const repeatedBootstrap = bootstrapMedianCi(bootstrapInput, 12345, 500);
assert.deepEqual(firstBootstrap, repeatedBootstrap, "seeded bootstrap must be deterministic");
assert.deepEqual(bootstrapInput, [9, 1, 3, 5, 7], "bootstrap must not mutate its input");
assert.ok(firstBootstrap && firstBootstrap.low <= firstBootstrap.high);
assert.equal(bootstrapMedianCi([]), null);

assert.equal(wilcoxonSignedRank([1, -2, 3, -4]), null, "fewer than five nonzero pairs are not tested");
assert.equal(wilcoxonSignedRank([0, 0, Number.NaN, Number.POSITIVE_INFINITY]), null);
const tiedDifferences = [1, 1, -1, 2, -2, 0];
const tiedP = wilcoxonSignedRank(tiedDifferences);
assert.ok(tiedP !== null && tiedP >= 0 && tiedP <= 1);
assert.equal(
  tiedP,
  wilcoxonSignedRank(tiedDifferences.map((difference) => -difference)),
  "the two-sided signed-rank result must be symmetric"
);

const completeThirty = Array.from({ length: 30 }, (_, index) => pairedFixture(index + 1));
const untouchedThirty = structuredClone(completeThirty);
const completeSummary = summarizeTeachingExperiment(completeThirty);
const completeDiagnostics = summarizeTeachingExperimentDiagnostics(completeThirty);
assert.deepEqual(completeThirty, untouchedThirty, "summarization must not mutate analysis rows");
assert.deepEqual(completeSummary.completion, {
  total: 30,
  completed: 30,
  paired: 30,
  incomplete: 0,
  excluded: 0,
});
assert.deepEqual(completeSummary.sequenceCounts, {
  manual_then_ai: 15,
  ai_then_manual: 15,
});
assert.deepEqual(completeSummary.manual, {
  n: 30,
  medianActiveSeconds: 1_200,
  medianAccuracy: 4 / 6,
  meanAccuracy: 4 / 6,
  medianCoverage: 1,
  medianEvidenceAccuracy: 4 / 6,
  medianEvidenceCoverage: 1,
});
assert.deepEqual(completeSummary.aiAssisted, {
  n: 30,
  medianActiveSeconds: 600,
  medianAccuracy: 5 / 6,
  meanAccuracy: 5 / 6,
  medianCoverage: 1,
  medianEvidenceAccuracy: 5 / 6,
  medianEvidenceCoverage: 1,
});
assert.equal(completeSummary.timeSavedRate, 0.5);
assert.equal(completeSummary.accuracyDelta, 1 / 6);
assert.equal(completeSummary.fasterAndMoreAccurate, 30);
assert.deepEqual(completeSummary.timeDifference.ci95, { low: -600, high: -600 });
assert.equal(completeSummary.timeDifference.median, -600);
assert.ok(
  completeSummary.timeDifference.wilcoxonP !== null &&
    completeSummary.timeDifference.wilcoxonP < 0.001
);
assert.deepEqual(completeSummary.accuracyDifference.ci95, { low: 1 / 6, high: 1 / 6 });
assert.equal(completeSummary.accuracyDifference.median, 1 / 6);
assert.ok(
  completeSummary.accuracyDifference.wilcoxonP !== null &&
    completeSummary.accuracyDifference.wilcoxonP < 0.001
);
assert.deepEqual(completeSummary.aiBehavior, {
  suggested: 180,
  adopted: 150,
  modified: 30,
  initiallyIncorrect: 30,
  corrected: 30,
  incorrectlyAdopted: 0,
  adoptionRate: 5 / 6,
  modificationRate: 1 / 6,
  correctionRate: 1,
  incorrectAdoptionRate: 0,
});
assert.deepEqual(completeDiagnostics.timingQuality, {
  valid: 30,
  zero_active: 0,
  excessive_idle: 0,
  unavailable: 0,
});
assert.equal(completeDiagnostics.byPaper.A.manual.n, 15);
assert.equal(completeDiagnostics.byPaper.A.aiAssisted.n, 15);
assert.equal(completeDiagnostics.byPaper.B.manual.n, 15);
assert.equal(completeDiagnostics.byPaper.B.aiAssisted.n, 15);
assert.deepEqual(
  {
    manualThenAi: {
      total: completeDiagnostics.bySequence.manual_then_ai.total,
      completed: completeDiagnostics.bySequence.manual_then_ai.completed,
      paired: completeDiagnostics.bySequence.manual_then_ai.paired,
      manualN: completeDiagnostics.bySequence.manual_then_ai.manual.n,
      aiN: completeDiagnostics.bySequence.manual_then_ai.aiAssisted.n,
    },
    aiThenManual: {
      total: completeDiagnostics.bySequence.ai_then_manual.total,
      completed: completeDiagnostics.bySequence.ai_then_manual.completed,
      paired: completeDiagnostics.bySequence.ai_then_manual.paired,
      manualN: completeDiagnostics.bySequence.ai_then_manual.manual.n,
      aiN: completeDiagnostics.bySequence.ai_then_manual.aiAssisted.n,
    },
  },
  {
    manualThenAi: { total: 15, completed: 15, paired: 15, manualN: 15, aiN: 15 },
    aiThenManual: { total: 15, completed: 15, paired: 15, manualN: 15, aiN: 15 },
  }
);
assert.equal(
  completeDiagnostics.byPaper.A.manual.n + completeDiagnostics.byPaper.B.manual.n,
  completeSummary.manual.n,
  "paper-level manual n must reconcile to the headline paired sample"
);
assert.equal(
  completeDiagnostics.byPaper.A.aiAssisted.n + completeDiagnostics.byPaper.B.aiAssisted.n,
  completeSummary.aiAssisted.n,
  "paper-level AI n must reconcile to the headline paired sample"
);
assert.equal(
  completeDiagnostics.bySequence.manual_then_ai.paired +
    completeDiagnostics.bySequence.ai_then_manual.paired,
  completeSummary.completion.paired,
  "sequence paired counts must reconcile to the headline paired sample"
);
assert.equal(
  Object.values(completeDiagnostics.timingQuality).reduce((sum, count) => sum + count, 0),
  completeSummary.completion.total,
  "timing quality must classify every participant exactly once"
);

const incomplete: TeachingExperimentAnalysisRow = {
  ...pairedFixture(31, { completed: false }),
  aiAssisted: null,
};
const zeroActive = pairedFixture(32, {
  manualActive: 0,
  manualTiming: "zero_active",
});
const excessiveIdle = pairedFixture(33, {
  manualActive: 100,
  manualWall: 1_200,
  manualTiming: "excessive_idle",
});
const excluded = pairedFixture(34, { exclusionReason: "teacher-marked invalid" });
const scoringOrModeNull: TeachingExperimentAnalysisRow = {
  ...pairedFixture(35),
  manual: null,
};
const noAiError = pairedFixture(36, { aiCorrect: 6, aiBehavior: noErrorAiBehavior });
assert.equal(zeroActive.exclusionReason, null);
assert.equal(excessiveIdle.exclusionReason, null);

assert.deepEqual(teachingParticipantQuality(completeThirty[0]), {
  completion: "completed",
  timing: "valid",
  excluded: false,
  paired: true,
});
assert.deepEqual(teachingParticipantQuality(incomplete), {
  completion: "incomplete",
  timing: "unavailable",
  excluded: false,
  paired: false,
});
assert.deepEqual(teachingParticipantQuality(zeroActive), {
  completion: "completed",
  timing: "zero_active",
  excluded: false,
  paired: false,
});
assert.deepEqual(teachingParticipantQuality(excessiveIdle), {
  completion: "completed",
  timing: "excessive_idle",
  excluded: false,
  paired: false,
});
assert.deepEqual(teachingParticipantQuality(excluded), {
  completion: "completed",
  timing: "valid",
  excluded: true,
  paired: false,
});
assert.deepEqual(teachingParticipantQuality(scoringOrModeNull), {
  completion: "completed",
  timing: "unavailable",
  excluded: false,
  paired: false,
});

const edgeRows = [
  ...completeThirty,
  incomplete,
  zeroActive,
  excessiveIdle,
  excluded,
  scoringOrModeNull,
  noAiError,
];
const edgeSummary = summarizeTeachingExperiment(edgeRows);
assert.deepEqual(edgeSummary.completion, {
  total: 36,
  completed: 35,
  paired: 31,
  incomplete: 1,
  excluded: 1,
});
assert.deepEqual(edgeSummary.sequenceCounts, {
  manual_then_ai: 18,
  ai_then_manual: 18,
});
assert.equal(edgeSummary.manual.n, 31);
assert.equal(edgeSummary.aiAssisted.n, 31);
assert.deepEqual(edgeSummary.aiBehavior, {
  suggested: 186,
  adopted: 156,
  modified: 30,
  initiallyIncorrect: 30,
  corrected: 30,
  incorrectlyAdopted: 0,
  adoptionRate: 156 / 186,
  modificationRate: 30 / 186,
  correctionRate: 1,
  incorrectAdoptionRate: 0,
});
assert.deepEqual(
  summarizeTeachingExperiment([noAiError]).aiBehavior,
  noErrorAiBehavior,
  "AI error rates use null when the aggregated error denominator is zero"
);
assert.equal(edgeRows.length, 36, "invalid and incomplete participants remain visible at row grain");

const divergent = [
  pairedFixture(101, { manualActive: 100, aiActive: 90, manualCorrect: 0, aiCorrect: 1 }),
  pairedFixture(102, { manualActive: 100, aiActive: 900, manualCorrect: 0, aiCorrect: 6 }),
  pairedFixture(103, { manualActive: 1_000, aiActive: 900, manualCorrect: 6, aiCorrect: 6 }),
];
const divergentSummary = summarizeTeachingExperiment(divergent);
assert.equal(divergentSummary.manual.medianActiveSeconds, 100);
assert.equal(divergentSummary.aiAssisted.medianActiveSeconds, 900);
assert.equal(divergentSummary.timeDifference.median, -10);
assert.notEqual(
  divergentSummary.timeDifference.median,
  divergentSummary.aiAssisted.medianActiveSeconds - divergentSummary.manual.medianActiveSeconds,
  "paired differences must not be replaced with a difference of unpaired mode medians"
);
assert.equal(divergentSummary.manual.medianAccuracy, 0);
assert.equal(divergentSummary.aiAssisted.medianAccuracy, 1);
assert.equal(divergentSummary.accuracyDelta, 1 / 6);
assert.notEqual(
  divergentSummary.accuracyDelta,
  divergentSummary.aiAssisted.medianAccuracy - divergentSummary.manual.medianAccuracy,
  "accuracy delta must be the median student-paired difference"
);

assert.throws(
  () => summarizeTeachingExperiment([completeThirty[0], structuredClone(completeThirty[0])]),
  /duplicate.*participant/i,
  "duplicate participant grain must be rejected instead of multiplied"
);

type StoredDashboardSubmission = {
  id: string;
  roundNo: 1 | 2;
  paperCode: "A" | "B";
};

function storedDashboardSubmissions(
  database: Database.Database,
  participantId: string
): StoredDashboardSubmission[] {
  return database
    .prepare(
      `SELECT s.id, s.round_no AS roundNo, p.paper_no AS paperCode
       FROM teaching_submissions s
       JOIN teaching_papers p ON p.id = s.paper_id
       WHERE s.participant_id = ?
       ORDER BY s.round_no, s.id`
    )
    .all(participantId) as StoredDashboardSubmission[];
}

function lockDashboardRound(
  database: Database.Database,
  participantId: string,
  roundNo: 1 | 2,
  input: {
    activeSeconds: number;
    wallSeconds: number;
    scoringStatus?: "scored" | "scoring_error";
  }
): string {
  const row = storedDashboardSubmissions(database, participantId).find(
    (submission) => submission.roundNo === roundNo
  );
  assert.ok(row);
  const paper = DEFAULT_EXPERIMENT.papers.find((candidate) => candidate.code === row.paperCode);
  assert.ok(paper);
  const answers = structuredClone(paper.aiInitial);
  const score = scoreSubmission(answers, paper);
  const startedAtMs = Date.parse(`2026-08-${roundNo === 1 ? "01" : "02"}T00:00:00.000Z`);
  const startedAt = new Date(startedAtMs).toISOString();
  const submittedAt = new Date(startedAtMs + input.wallSeconds * 1_000).toISOString();
  database
    .prepare(
      `UPDATE teaching_submissions
       SET started_at = ?, submitted_at = ?, updated_at = ?, answers_json = ?,
           active_seconds = ?, auto_value_scores_json = ?,
           auto_evidence_scores_json = ?, scoring_version = ?,
           scoring_status = ?, auto_scored_at = ?
       WHERE id = ?`
    )
    .run(
      startedAt,
      submittedAt,
      submittedAt,
      JSON.stringify(answers),
      input.activeSeconds,
      JSON.stringify(score.values),
      JSON.stringify(score.evidence),
      DEFAULT_EXPERIMENT.scoringVersion,
      input.scoringStatus ?? "scored",
      input.scoringStatus === "scoring_error" ? null : submittedAt,
      row.id
    );
  return row.id;
}

function completeDashboardParticipant(
  database: Database.Database,
  participantId: string,
  options: {
    manualActive?: number;
    manualWall?: number;
    aiActive?: number;
    aiWall?: number;
    scoringErrorMode?: "manual" | "ai_assisted";
  } = {}
): { manualSubmissionId: string; aiSubmissionId: string } {
  const modes = database
    .prepare(
      `SELECT id, round_no AS roundNo, mode
       FROM teaching_submissions
       WHERE participant_id = ?
       ORDER BY round_no`
    )
    .all(participantId) as Array<{
    id: string;
    roundNo: 1 | 2;
    mode: "manual" | "ai_assisted";
  }>;
  let manualSubmissionId = "";
  let aiSubmissionId = "";
  for (const mode of modes) {
    const manual = mode.mode === "manual";
    const submissionId = lockDashboardRound(database, participantId, mode.roundNo, {
      activeSeconds: manual ? options.manualActive ?? 1_200 : options.aiActive ?? 600,
      wallSeconds: manual ? options.manualWall ?? 1_200 : options.aiWall ?? 600,
      scoringStatus: options.scoringErrorMode === mode.mode ? "scoring_error" : "scored",
    });
    if (manual) manualSubmissionId = submissionId;
    else aiSubmissionId = submissionId;
  }
  database
    .prepare("UPDATE teaching_participants SET completed_at = ? WHERE id = ?")
    .run("2026-08-03T00:00:00.000Z", participantId);
  return { manualSubmissionId, aiSubmissionId };
}

const emptyDashboard = getDefaultTeachingDashboard();
assert.deepEqual(emptyDashboard.experiment, {
  id: DEFAULT_EXPERIMENT.id,
  name: DEFAULT_EXPERIMENT.name,
  version: DEFAULT_EXPERIMENT.version,
  scoringVersion: DEFAULT_EXPERIMENT.scoringVersion,
  papers: DEFAULT_EXPERIMENT.papers.map(({ id, code, title, doi, journal, sourceUrl }) => ({
    id,
    code,
    title,
    doi,
    journal,
    sourceUrl,
  })),
});
assert.deepEqual(emptyDashboard.summary.completion, {
  total: 0,
  completed: 0,
  paired: 0,
  incomplete: 0,
  excluded: 0,
});
assert.deepEqual(emptyDashboard.participants, []);
assert.deepEqual(emptyDashboard.diagnostics.timingQuality, {
  valid: 0,
  zero_active: 0,
  excessive_idle: 0,
  unavailable: 0,
});

const database = getTeachingDb();
assert.equal(
  database
    .prepare("SELECT COUNT(*) FROM teaching_projects WHERE id = ? AND is_default = 1")
    .pluck()
    .get(DEFAULT_EXPERIMENT.id),
  1,
  "the empty dashboard must bootstrap the default experiment"
);
assert.throws(
  () =>
    addTeachingPaper({
      projectId: DEFAULT_EXPERIMENT.id,
      recordId: "frozen-default-record",
      paperNo: "C",
    }),
  /frozen|default|cross|experiment|冻结|默认|交叉|实验/i,
  "the legacy paper-management path must not add papers to the frozen default experiment"
);
const participantCountBeforeLegacyJoin = Number(
  database.prepare("SELECT COUNT(*) FROM teaching_participants").pluck().get()
);
assert.throws(
  () =>
    joinTeachingProject({
      inviteCode: "AUTO-CROSSOVER-2026-V1",
      groupCode: "legacy-path",
      studentAlias: "Legacy Crossover Join",
    }),
  /invite|project|crossover|default|邀请码|项目/i,
  "the legacy one-paper join must not enter the default crossover experiment"
);
assert.equal(
  database.prepare("SELECT COUNT(*) FROM teaching_participants").pluck().get(),
  participantCountBeforeLegacyJoin
);
database
  .prepare(
    `UPDATE teaching_projects
     SET experiment_kind = 'legacy', config_version = 'stale', config_checksum = 'stale'
     WHERE id = ?`
  )
  .run(DEFAULT_EXPERIMENT.id);
assert.deepEqual(getDefaultTeachingDashboard().participants, []);
assert.deepEqual(
  database
    .prepare(
      `SELECT experiment_kind AS experimentKind, config_version AS configVersion,
              config_checksum AS configChecksum
       FROM teaching_projects WHERE id = ?`
    )
    .get(DEFAULT_EXPERIMENT.id),
  {
    experimentKind: "crossover",
    configVersion: DEFAULT_EXPERIMENT.version,
    configChecksum: defaultExperimentChecksum(),
  },
  "an empty dashboard must repair stale default experiment identity before querying it"
);

function storedPaperB(): {
  paperNo: string;
  taskPrompt: string;
  aiSnapshotJson: string;
  scoringRulesJson: string;
  configVersion: string | null;
} | undefined {
  return database
    .prepare(
      `SELECT paper_no AS paperNo, task_prompt AS taskPrompt,
              ai_snapshot_json AS aiSnapshotJson,
              scoring_rules_json AS scoringRulesJson,
              config_version AS configVersion
       FROM teaching_papers WHERE id = ?`
    )
    .get(DEFAULT_EXPERIMENT.papers[1].id) as ReturnType<typeof storedPaperB>;
}

function assertStoredPaperBIsDefault(): void {
  assert.equal(
    database
      .prepare("SELECT COUNT(*) FROM teaching_papers WHERE project_id = ?")
      .pluck()
      .get(DEFAULT_EXPERIMENT.id),
    2
  );
  assert.deepEqual(storedPaperB(), {
    paperNo: "B",
    taskPrompt: DEFAULT_EXPERIMENT.papers[1].taskPrompt,
    aiSnapshotJson: JSON.stringify(DEFAULT_EXPERIMENT.papers[1].aiInitial),
    scoringRulesJson: JSON.stringify(DEFAULT_EXPERIMENT.papers[1].gold),
    configVersion: DEFAULT_EXPERIMENT.version,
  });
}

function insertUnexpectedDefaultPaper(id: string, paperNo: string): void {
  database
    .prepare(
      `INSERT INTO teaching_papers
       (id, project_id, paper_no, title, doi, journal, source_url, source_record_id,
        ai_snapshot_json, ai_model, ai_extracted_at, created_at, task_prompt,
        gold_snapshot_json, scoring_rules_json, config_version)
       VALUES (?, ?, ?, 'Unexpected paper', NULL, NULL, NULL, NULL,
               '{}', NULL, NULL, '2026-08-01T00:00:00.000Z', '', '{}', '{}', NULL)`
    )
    .run(id, DEFAULT_EXPERIMENT.id, paperNo);
}

database
  .prepare("DELETE FROM teaching_papers WHERE id = ?")
  .run(DEFAULT_EXPERIMENT.papers[1].id);
getDefaultTeachingDashboard();
assertStoredPaperBIsDefault();

const changesBeforeHealthyDashboardRead = Number(
  database.prepare("SELECT total_changes()").pluck().get()
);
getDefaultTeachingDashboard();
assert.equal(
  Number(database.prepare("SELECT total_changes()").pluck().get()),
  changesBeforeHealthyDashboardRead,
  "a healthy dashboard read must not rewrite the frozen experiment rows"
);

database
  .prepare(
    `UPDATE teaching_papers
     SET task_prompt = 'damaged', ai_snapshot_json = '{}',
         scoring_rules_json = '{}', config_version = 'stale'
     WHERE id = ?`
  )
  .run(DEFAULT_EXPERIMENT.papers[1].id);
getDefaultTeachingDashboard();
assertStoredPaperBIsDefault();

insertUnexpectedDefaultPaper("unexpected-default-paper", "C");
getDefaultTeachingDashboard();
assertStoredPaperBIsDefault();
const changesAfterUnexpectedPaperRepair = Number(
  database.prepare("SELECT total_changes()").pluck().get()
);
getDefaultTeachingDashboard();
assert.equal(
  Number(database.prepare("SELECT total_changes()").pluck().get()),
  changesAfterUnexpectedPaperRepair,
  "repairing an unexpected unreferenced paper must restore the healthy read fast path"
);

insertUnexpectedDefaultPaper("linked-unexpected-paper", "D");
database
  .prepare(
    `INSERT INTO teaching_participants
     (id, project_id, group_code, student_alias, assigned_paper_id, created_at)
     VALUES ('linked-extra-participant', ?, 'linked-extra',
             'Linked Extra', 'linked-unexpected-paper', '2026-08-01T00:00:00.000Z')`
  )
  .run(DEFAULT_EXPERIMENT.id);
database
  .prepare(
    `INSERT INTO teaching_submissions
     (id, project_id, paper_id, participant_id, started_at, answers_json, version, updated_at)
     VALUES ('linked-extra-submission', ?, 'linked-unexpected-paper',
             'linked-extra-participant', '2026-08-01T00:00:00.000Z', '{}', 0,
             '2026-08-01T00:00:00.000Z')`
  )
  .run(DEFAULT_EXPERIMENT.id);
assert.throws(
  () => getDefaultTeachingDashboard(),
  /unexpected|linked|dependent|额外|关联|依赖/i,
  "repair must fail instead of deleting an unexpected paper with dependent data"
);
assert.equal(
  database.prepare("SELECT COUNT(*) FROM teaching_papers WHERE id = 'linked-unexpected-paper'").pluck().get(),
  1
);
assert.equal(
  database
    .prepare("SELECT COUNT(*) FROM teaching_participants WHERE id = 'linked-extra-participant'")
    .pluck()
    .get(),
  1
);
assert.equal(
  database
    .prepare("SELECT COUNT(*) FROM teaching_submissions WHERE id = 'linked-extra-submission'")
    .pluck()
    .get(),
  1
);
database.prepare("DELETE FROM teaching_participants WHERE id = 'linked-extra-participant'").run();
getDefaultTeachingDashboard();
assertStoredPaperBIsDefault();

database
  .prepare(
    `INSERT INTO teaching_participants
     (id, project_id, group_code, student_alias, assigned_paper_id, created_at)
     VALUES ('invalid-sequence-participant', ?, 'legacy-null-sequence',
             'Invalid Sequence', ?, '2026-08-01T00:00:00.000Z'),
            ('illegal-sequence-participant', ?, 'legacy-illegal-sequence',
             'Illegal Sequence', ?, '2026-08-01T00:00:01.000Z')`
  )
  .run(
    DEFAULT_EXPERIMENT.id,
    DEFAULT_EXPERIMENT.papers[0].id,
    DEFAULT_EXPERIMENT.id,
    DEFAULT_EXPERIMENT.papers[0].id
  );
database
  .prepare(
    "UPDATE teaching_participants SET sequence_code = 'manual_twice' WHERE id = 'illegal-sequence-participant'"
  )
  .run();
const dashboardWithInvalidSequence = getDefaultTeachingDashboard();
assert.deepEqual(dashboardWithInvalidSequence.participants, []);
assert.deepEqual(dashboardWithInvalidSequence.summary.completion, {
  total: 0,
  completed: 0,
  paired: 0,
  incomplete: 0,
  excluded: 0,
});

const completedDb = joinDefaultTeachingExperiment("Dashboard completed");
const completedSubmissionIds = completeDashboardParticipant(database, completedDb.participantId);
reviewTeachingSubmission(
  completedSubmissionIds.aiSubmissionId,
  { cation: "correct", load: "incorrect" },
  { cation: "incorrect", load: "correct" }
);
database
  .prepare(
    `INSERT INTO teaching_activity_events
     (id, submission_id, event_type, client_at, received_at, active_delta_seconds)
     VALUES (?, ?, 'heartbeat', ?, ?, 1), (?, ?, 'heartbeat', ?, ?, 1)`
  )
  .run(
    "dashboard-event-1",
    completedSubmissionIds.manualSubmissionId,
    "2026-08-01T00:00:01.000Z",
    "2026-08-01T00:00:01.000Z",
    "dashboard-event-2",
    completedSubmissionIds.manualSubmissionId,
    "2026-08-01T00:00:02.000Z",
    "2026-08-01T00:00:02.000Z"
  );

const storedAiLineage = database
  .prepare(
    `SELECT scoring_version AS scoringVersion, auto_scored_at AS autoScoredAt,
            auto_value_scores_json AS valueScoresJson,
            auto_evidence_scores_json AS evidenceScoresJson
     FROM teaching_submissions WHERE id = ?`
  )
  .get(completedSubmissionIds.aiSubmissionId) as {
  scoringVersion: string;
  autoScoredAt: string;
  valueScoresJson: string;
  evidenceScoresJson: string;
};
const distortedOldScore = autoScore(0);
database
  .prepare(
    `UPDATE teaching_submissions
     SET scoring_version = 'legacy-score-v0', auto_value_scores_json = ?,
         auto_evidence_scores_json = ?
     WHERE id = ?`
  )
  .run(
    JSON.stringify(distortedOldScore.values),
    JSON.stringify(distortedOldScore.evidence),
    completedSubmissionIds.aiSubmissionId
  );
const oldVersionDashboard = getDefaultTeachingDashboard();
const oldVersionParticipant = oldVersionDashboard.participants.find(
  (participant) => participant.participantId === completedDb.participantId
);
assert.ok(oldVersionParticipant?.manual);
assert.equal(oldVersionParticipant.aiAssisted, null);
assert.equal(oldVersionParticipant.activeTimeDifference, null);
assert.equal(oldVersionParticipant.quality.timing, "unavailable");
assert.equal(oldVersionParticipant.quality.paired, false);
assert.equal(oldVersionDashboard.summary.completion.paired, 0);

database
  .prepare(
    `UPDATE teaching_submissions
     SET scoring_version = ?, auto_scored_at = NULL,
         auto_value_scores_json = ?, auto_evidence_scores_json = ?
     WHERE id = ?`
  )
  .run(
    storedAiLineage.scoringVersion,
    storedAiLineage.valueScoresJson,
    storedAiLineage.evidenceScoresJson,
    completedSubmissionIds.aiSubmissionId
  );
const missingScoredAtParticipant = getDefaultTeachingDashboard().participants.find(
  (participant) => participant.participantId === completedDb.participantId
);
assert.ok(missingScoredAtParticipant?.manual);
assert.equal(missingScoredAtParticipant.aiAssisted, null);
assert.equal(missingScoredAtParticipant.activeTimeDifference, null);
database
  .prepare("UPDATE teaching_submissions SET auto_scored_at = 'invalid-date' WHERE id = ?")
  .run(completedSubmissionIds.aiSubmissionId);
const malformedScoredAtParticipant = getDefaultTeachingDashboard().participants.find(
  (participant) => participant.participantId === completedDb.participantId
);
assert.ok(malformedScoredAtParticipant?.manual);
assert.equal(malformedScoredAtParticipant.aiAssisted, null);
assert.equal(malformedScoredAtParticipant.activeTimeDifference, null);
database
  .prepare("UPDATE teaching_submissions SET auto_scored_at = ? WHERE id = ?")
  .run(storedAiLineage.autoScoredAt, completedSubmissionIds.aiSubmissionId);

const incompleteDb = joinDefaultTeachingExperiment("Dashboard incomplete");
const excludedDb = joinDefaultTeachingExperiment("Dashboard excluded");
completeDashboardParticipant(database, excludedDb.participantId);
database
  .prepare(
    `UPDATE teaching_participants
     SET excluded_at = ?, exclusion_reason = ?
     WHERE id = ?`
  )
  .run("2026-08-03T00:00:00.000Z", "manual exclusion", excludedDb.participantId);

const zeroDb = joinDefaultTeachingExperiment("Dashboard zero active");
completeDashboardParticipant(database, zeroDb.participantId, { manualActive: 0 });

const idleDb = joinDefaultTeachingExperiment("Dashboard excessive idle");
completeDashboardParticipant(database, idleDb.participantId, {
  manualActive: 100,
  manualWall: 1_200,
});

const scoringErrorDb = joinDefaultTeachingExperiment("Dashboard scoring error");
completeDashboardParticipant(database, scoringErrorDb.participantId, {
  scoringErrorMode: "ai_assisted",
});

const modeNullDb = joinDefaultTeachingExperiment("Dashboard mode null");
const modeNullIds = completeDashboardParticipant(database, modeNullDb.participantId);
database
  .prepare("UPDATE teaching_submissions SET mode = NULL WHERE id = ?")
  .run(modeNullIds.manualSubmissionId);

const reverseTimestampDb = joinDefaultTeachingExperiment("Dashboard reverse timestamp");
completeDashboardParticipant(database, reverseTimestampDb.participantId, { manualWall: -30 });

const dbDashboard = getDefaultTeachingDashboard();
assert.deepEqual(dbDashboard, getDefaultTeachingDashboard(), "dashboard ordering must be deterministic");
assert.equal(dbDashboard.participants.length, 8);
assert.equal(
  new Set(dbDashboard.participants.map((participant) => participant.participantId)).size,
  8,
  "submission activity joins must not multiply participant rows"
);
assert.deepEqual(dbDashboard.summary.completion, {
  total: 8,
  completed: 7,
  paired: 1,
  incomplete: 1,
  excluded: 1,
});
assert.deepEqual(dbDashboard.summary.sequenceCounts, {
  manual_then_ai: 4,
  ai_then_manual: 4,
});
assert.deepEqual(dbDashboard.summary.manual, {
  n: 1,
  medianActiveSeconds: 1_200,
  medianAccuracy: 4 / 6,
  meanAccuracy: 4 / 6,
  medianCoverage: 1,
  medianEvidenceAccuracy: 4 / 6,
  medianEvidenceCoverage: 5 / 6,
});
assert.deepEqual(dbDashboard.summary.aiAssisted, {
  n: 1,
  medianActiveSeconds: 600,
  medianAccuracy: 5 / 6,
  meanAccuracy: 5 / 6,
  medianCoverage: 1,
  medianEvidenceAccuracy: 4 / 6,
  medianEvidenceCoverage: 5 / 6,
});
assert.equal(dbDashboard.summary.timeSavedRate, 0.5);
assert.equal(dbDashboard.summary.accuracyDelta, 1 / 6);
assert.equal(dbDashboard.summary.fasterAndMoreAccurate, 1);
assert.deepEqual(dbDashboard.summary.timeDifference, {
  median: -600,
  ci95: { low: -600, high: -600 },
  wilcoxonP: null,
});
assert.deepEqual(dbDashboard.summary.accuracyDifference, {
  median: 1 / 6,
  ci95: { low: 1 / 6, high: 1 / 6 },
  wilcoxonP: null,
});
assert.deepEqual(dbDashboard.summary.aiBehavior, {
  suggested: 6,
  adopted: 6,
  modified: 0,
  initiallyIncorrect: 1,
  corrected: 0,
  incorrectlyAdopted: 1,
  adoptionRate: 1,
  modificationRate: 0,
  correctionRate: 0,
  incorrectAdoptionRate: 1,
});

const completedResult = dbDashboard.participants.find(
  (participant) => participant.participantId === completedDb.participantId
);
assert.ok(completedResult?.manual && completedResult.aiAssisted);
assert.equal(completedResult.manual.paperCode, "A");
assert.equal(completedResult.aiAssisted.paperCode, "B");
assert.equal(completedResult.manual.timingQuality, "valid");
assert.equal(completedResult.aiAssisted.timingQuality, "valid");
assert.equal(completedResult.activeTimeDifference, -600);
assert.equal(completedResult.accuracyDifference, 1 / 6);
assert.deepEqual(completedResult.quality, {
  completion: "completed",
  timing: "valid",
  excluded: false,
  paired: true,
});
const completedManualPaper = DEFAULT_EXPERIMENT.papers.find(
  (paper) => paper.code === completedResult.manual?.paperCode
);
const completedAiPaper = DEFAULT_EXPERIMENT.papers.find(
  (paper) => paper.code === completedResult.aiAssisted?.paperCode
);
assert.ok(completedManualPaper && completedAiPaper);
assert.deepEqual(completedResult.manual.finalAnswers, completedManualPaper.aiInitial);
assert.equal(
  Object.prototype.hasOwnProperty.call(completedResult.manual, "aiInitial"),
  false,
  "manual round payload must not contain an aiInitial key"
);
assert.deepEqual(completedResult.aiAssisted.finalAnswers, completedAiPaper.aiInitial);
assert.deepEqual(completedResult.aiAssisted.aiInitial, completedAiPaper.aiInitial);
assert.equal(typeof completedResult.aiAssisted.score.values.cation.reason, "string");
assert.equal(typeof completedResult.aiAssisted.score.evidence.cation.reason, "string");
assert.deepEqual(completedResult.aiAssisted.review, {
  reviewedAt: completedResult.aiAssisted.review?.reviewedAt,
  finalValueScores: { cation: "correct", load: "incorrect" },
  aiInitialValueScores: { cation: "incorrect", load: "correct" },
});
assert.ok(
  Number.isFinite(Date.parse(completedResult.aiAssisted.review?.reviewedAt ?? "")),
  "review timestamp must be returned with its display-only score metadata"
);

const incompleteResult = dbDashboard.participants.find(
  (participant) => participant.participantId === incompleteDb.participantId
);
assert.ok(incompleteResult);
assert.equal(incompleteResult.completed, false);
assert.equal(incompleteResult.manual, null);
assert.equal(incompleteResult.aiAssisted, null);
assert.equal(incompleteResult.activeTimeDifference, null);
assert.equal(incompleteResult.accuracyDifference, null);
assert.deepEqual(incompleteResult.quality, {
  completion: "incomplete",
  timing: "unavailable",
  excluded: false,
  paired: false,
});

const excludedResult = dbDashboard.participants.find(
  (participant) => participant.participantId === excludedDb.participantId
);
assert.ok(excludedResult?.manual && excludedResult.aiAssisted);
assert.equal(excludedResult.exclusionReason, "manual exclusion");
assert.equal(excludedResult.activeTimeDifference, null);
assert.deepEqual(excludedResult.quality, {
  completion: "completed",
  timing: "valid",
  excluded: true,
  paired: false,
});

const zeroResult = dbDashboard.participants.find(
  (participant) => participant.participantId === zeroDb.participantId
);
assert.ok(zeroResult?.manual && zeroResult.aiAssisted);
assert.equal(zeroResult.exclusionReason, null);
assert.equal(zeroResult.manual.timingQuality, "zero_active");
assert.equal(zeroResult.activeTimeDifference, null);
assert.equal(zeroResult.quality.timing, "zero_active");

const idleResult = dbDashboard.participants.find(
  (participant) => participant.participantId === idleDb.participantId
);
assert.ok(idleResult?.manual && idleResult.aiAssisted);
assert.equal(idleResult.exclusionReason, null);
assert.equal(idleResult.manual.timingQuality, "excessive_idle");
assert.equal(idleResult.activeTimeDifference, null);
assert.equal(idleResult.quality.timing, "excessive_idle");

const scoringErrorResult = dbDashboard.participants.find(
  (participant) => participant.participantId === scoringErrorDb.participantId
);
assert.ok(scoringErrorResult?.manual);
assert.equal(scoringErrorResult.aiAssisted, null);
assert.equal(scoringErrorResult.activeTimeDifference, null);
assert.equal(scoringErrorResult.quality.timing, "unavailable");

const modeNullResult = dbDashboard.participants.find(
  (participant) => participant.participantId === modeNullDb.participantId
);
assert.ok(modeNullResult?.aiAssisted);
assert.equal(modeNullResult.manual, null);
assert.equal(modeNullResult.activeTimeDifference, null);
assert.equal(modeNullResult.quality.timing, "unavailable");

const reverseTimestampResult = dbDashboard.participants.find(
  (participant) => participant.participantId === reverseTimestampDb.participantId
);
assert.ok(reverseTimestampResult?.aiAssisted);
assert.equal(reverseTimestampResult.manual, null);
assert.equal(reverseTimestampResult.activeTimeDifference, null);
assert.equal(reverseTimestampResult.accuracyDifference, null);
assert.equal(reverseTimestampResult.quality.timing, "unavailable");

assert.equal(
  dbDashboard.diagnostics.byPaper.A.manual.n +
    dbDashboard.diagnostics.byPaper.B.manual.n,
  dbDashboard.summary.manual.n
);
assert.equal(
  dbDashboard.diagnostics.byPaper.A.aiAssisted.n +
    dbDashboard.diagnostics.byPaper.B.aiAssisted.n,
  dbDashboard.summary.aiAssisted.n
);
assert.equal(
  dbDashboard.diagnostics.bySequence.manual_then_ai.paired +
    dbDashboard.diagnostics.bySequence.ai_then_manual.paired,
  dbDashboard.summary.completion.paired
);
assert.equal(
  Object.values(dbDashboard.diagnostics.timingQuality).reduce(
    (sum, count) => sum + count,
    0
  ),
  dbDashboard.summary.completion.total
);

assert.doesNotMatch(
  JSON.stringify(dbDashboard),
  /"gold"|"scoringRules"|scoring_rules|"aliases"|"tolerance"|"anyKeywordSets"|"taskPrompt"|"aiModel"/i,
  "public dashboard objects must not expose gold answers, rules, prompts, or AI model secrets"
);

closeTeachingStoreForTests();
console.log("Teaching paired analytics and dashboard tests passed");
