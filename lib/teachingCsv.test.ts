import assert from "node:assert/strict";
import { summarizeTeachingExperiment } from "./teaching/analytics";
import {
  TEACHING_FIELDS,
  type TeachingAiBehavior,
  type TeachingAutoScore,
  type TeachingDashboardRow,
  type TeachingExperimentDashboard,
  type TeachingPairedResult,
  type TeachingRoundAnalysis,
} from "./teachingShared";
import { teachingExperimentToCsv, teachingRowsToCsv } from "./teachingCsv";

const row: TeachingDashboardRow = {
  submissionId: "s1",
  projectId: "p1",
  projectName: "项目",
  groupCode: "=1+1",
  studentAlias: "@student",
  paperNo: "03",
  title: "标题,含逗号",
  doi: "10.0000/test",
  journal: '期刊"甲"',
  startedAt: "2026-01-01T00:00:00.000Z",
  submittedAt: "2026-01-01T00:10:00.000Z",
  elapsedSeconds: 600,
  answers: {},
  aiSnapshot: {},
  humanScores: {},
  aiScores: {},
  metrics: {
    expected: 6,
    humanFilled: 0,
    humanCorrect: 0,
    humanCoverage: 0,
    humanAccuracy: null,
    aiFilled: 0,
    aiCorrect: 0,
    aiCoverage: 0,
    aiAccuracy: null,
  },
  status: "pending",
};

const csv = teachingRowsToCsv([row]);
assert.ok(csv.startsWith("\uFEFF"));
assert.match(csv, /"'=1\+1"/);
assert.match(csv, /"'@student"/);
assert.match(csv, /"期刊""甲"""/);
assert.doesNotMatch(csv, /undefined|null/);

const whitespaceFormulaRow: TeachingDashboardRow = {
  ...row,
  submissionId: "s2",
  groupCode: "\t  =HYPERLINK(\"https://invalid.example\")",
  studentAlias: "\u000b@legacy-control",
};
const whitespaceFormulaCsv = teachingRowsToCsv([whitespaceFormulaRow]);
assert.ok(
  whitespaceFormulaCsv.includes(
    `"'${whitespaceFormulaRow.groupCode.replace(/"/g, '""')}"`
  ),
  "legacy CSV must neutralize formulas after leading whitespace"
);
assert.ok(
  whitespaceFormulaCsv.includes(`"'${whitespaceFormulaRow.studentAlias}"`),
  "legacy CSV must neutralize formulas after leading control characters"
);

function experimentScore(correctCount: number): TeachingAutoScore {
  const scores = Object.fromEntries(
    TEACHING_FIELDS.map((field, index) => [
      field.key,
      {
        correct: index < correctCount,
        normalized: `${field.key}-${index}`,
        reason: index < correctCount ? "correct" : "incorrect",
      },
    ])
  ) as TeachingAutoScore["values"];
  return {
    values: structuredClone(scores),
    evidence: structuredClone(scores),
    valueCorrect: correctCount,
    valueAccuracy: correctCount / 6,
    valueCoverage: 1,
    evidenceCorrect: correctCount,
    evidenceAccuracy: correctCount / 6,
    evidenceCoverage: 5 / 6,
  };
}

const csvAiBehavior: TeachingAiBehavior = {
  suggested: 6,
  adopted: 4,
  modified: 2,
  initiallyIncorrect: 0,
  corrected: 0,
  incorrectlyAdopted: 0,
  adoptionRate: 4 / 6,
  modificationRate: 2 / 6,
  correctionRate: null,
  incorrectAdoptionRate: null,
};

function experimentRound(input: {
  submissionId: string;
  paperCode: "A" | "B";
  mode: "manual" | "ai_assisted";
  activeSeconds: number;
  wallSeconds: number;
  correctCount: number;
  aiBehavior?: TeachingAiBehavior | null;
}): TeachingRoundAnalysis {
  return {
    submissionId: input.submissionId,
    paperCode: input.paperCode,
    mode: input.mode,
    activeSeconds: input.activeSeconds,
    wallSeconds: input.wallSeconds,
    score: experimentScore(input.correctCount),
    aiBehavior: input.aiBehavior ?? null,
    timingQuality: "valid",
  };
}

const dangerousAlias = `\t =2+2,"student"`;
const pairedParticipant: TeachingPairedResult = {
  participantId: "participant-dangerous-alias",
  studentAlias: dangerousAlias,
  sequence: "manual_then_ai",
  completed: true,
  exclusionReason: null,
  manual: experimentRound({
    submissionId: "manual-csv",
    paperCode: "A",
    mode: "manual",
    activeSeconds: 1_200,
    wallSeconds: 1_300,
    correctCount: 4,
  }),
  aiAssisted: experimentRound({
    submissionId: "ai-csv",
    paperCode: "B",
    mode: "ai_assisted",
    activeSeconds: 600,
    wallSeconds: 650,
    correctCount: 5,
    aiBehavior: csvAiBehavior,
  }),
  activeTimeDifference: -600,
  accuracyDifference: 1 / 6,
};

const rawAlias = "Raw Alias";
const incompleteParticipant: TeachingPairedResult = {
  participantId: "participant-incomplete",
  studentAlias: rawAlias,
  sequence: "ai_then_manual",
  completed: false,
  exclusionReason:
    "\u000b@external-review participant-dangerous-alias participant-incomplete Raw Alias Alice ALICE Ａｌｉｃｅ alice@example.com",
  manual: null,
  aiAssisted: null,
  activeTimeDifference: null,
  accuracyDifference: null,
};

const experimentParticipants = [pairedParticipant, incompleteParticipant];
const experimentDashboard: TeachingExperimentDashboard = {
  experiment: {
    id: "experiment-id",
    name: "Experiment, with quote \"A\"",
    version: "v-test",
    scoringVersion: "score-test",
  },
  summary: summarizeTeachingExperiment(experimentParticipants),
  participants: experimentParticipants,
};

const experimentCsv = teachingExperimentToCsv(experimentDashboard);
assert.ok(experimentCsv.startsWith("\uFEFF"));
assert.ok(experimentCsv.endsWith("\r\n"));
assert.equal(experimentCsv.replace(/\r\n/g, "").includes("\n"), false);
assert.match(experimentCsv, /"实验版本","评分版本","学生标识"/);
assert.match(experimentCsv, /"人工活跃时间\(s\)"/);
assert.match(experimentCsv, /"AI墙钟时间\(s\)"/);
assert.ok(
  experimentCsv.includes(`"'${dangerousAlias.replace(/"/g, '""')}"`),
  "experiment aliases with whitespace before a formula must be neutralized"
);
assert.ok(experimentCsv.includes(`"'${incompleteParticipant.exclusionReason}"`));
assert.match(experimentCsv, /"A","1200","1300","valid","4\/6"/);
assert.match(experimentCsv, /"B","600","650","valid","5\/6"/);
assert.match(experimentCsv, /"66\.7%"/);
assert.match(experimentCsv, /"completed","paired"/);
assert.match(experimentCsv, /"incomplete","not_paired"/);
assert.doesNotMatch(experimentCsv, /undefined|null/);
assert.equal(experimentCsv.split("\r\n").filter(Boolean).length, 3);

const anonymized = teachingExperimentToCsv(experimentDashboard, { anonymize: true });
assert.equal(
  anonymized,
  teachingExperimentToCsv(experimentDashboard, { anonymize: true }),
  "anonymized labels must be deterministic for dashboard order"
);
assert.match(anonymized, /"S001"/);
assert.match(anonymized, /"S002"/);
assert.doesNotMatch(anonymized, new RegExp(dangerousAlias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
assert.doesNotMatch(anonymized, /Raw Alias/);
assert.doesNotMatch(anonymized, /participant-dangerous-alias|participant-incomplete/);
assert.doesNotMatch(anonymized, /Alice|ALICE|Ａｌｉｃｅ|alice@example\.com/);
assert.match(anonymized, /"incomplete","not_paired","excluded"/);

const aliasVariants = ["Alice", "ALICE", "Ａｌｉｃｅ", "alice@example.com"];
const aliasVariantParticipants = aliasVariants.map((studentAlias, index) => ({
  ...incompleteParticipant,
  participantId: `alias-variant-${index + 1}`,
  studentAlias,
  exclusionReason: null,
}));
const aliasVariantCsv = teachingExperimentToCsv(
  {
    experiment: {
      id: "alias-variant-experiment",
      name: "Alias variant export",
      version: "v-alias",
      scoringVersion: "score-alias",
    },
    summary: summarizeTeachingExperiment(aliasVariantParticipants),
    participants: aliasVariantParticipants,
  },
  { anonymize: true }
);
for (const alias of aliasVariants) {
  assert.equal(
    aliasVariantCsv.includes(alias),
    false,
    `anonymized exports must remove the real participant alias ${alias}`
  );
}
assert.match(aliasVariantCsv, /"S001"/);
assert.match(aliasVariantCsv, /"S004"/);

const negativeComputedParticipant: TeachingPairedResult = {
  ...pairedParticipant,
  participantId: "negative-computed-id",
  studentAlias: "-600 user alias",
  activeTimeDifference: -600,
  accuracyDifference: -1 / 6,
};
const negativeComputedCsv = teachingExperimentToCsv({
  ...experimentDashboard,
  summary: summarizeTeachingExperiment([negativeComputedParticipant]),
  participants: [negativeComputedParticipant],
});
assert.match(
  negativeComputedCsv,
  /,"-600","-16\.7%"\r\n$/,
  "trusted computed negatives must remain numeric CSV cells"
);
assert.match(
  negativeComputedCsv,
  /"'-600 user alias"/,
  "untrusted user strings that begin with a minus must remain formula-safe"
);
assert.doesNotMatch(negativeComputedCsv, /"'-600"|"'-16\.7%"/);

const collisionParticipants: TeachingPairedResult[] = [
  {
    ...pairedParticipant,
    participantId: "collision-alice-id",
    studentAlias: "Alice",
    exclusionReason: "Alice",
  },
  {
    ...incompleteParticipant,
    participantId: "collision-s001-id",
    studentAlias: "S001",
    exclusionReason: null,
  },
];
const collisionDashboard: TeachingExperimentDashboard = {
  experiment: {
    id: "collision-experiment",
    name: "Alice",
    version: "v-collision",
    scoringVersion: "score-collision",
  },
  summary: summarizeTeachingExperiment(collisionParticipants),
  participants: collisionParticipants,
};
const collisionCsv = teachingExperimentToCsv(collisionDashboard, { anonymize: true });
const collisionLabels = collisionCsv
  .split("\r\n")
  .filter(Boolean)
  .slice(1)
  .map((line) => line.split(",")[4]);
const collisionExclusions = collisionCsv
  .split("\r\n")
  .filter(Boolean)
  .slice(1)
  .map((line) => line.split(",")[8]);
const collisionNames = collisionCsv
  .split("\r\n")
  .filter(Boolean)
  .slice(1)
  .map((line) => line.split(",")[1]);
assert.deepEqual(
  collisionLabels,
  ['"S001"', '"S002"'],
  "generated label cells must not be rewritten by raw-alias redaction"
);
assert.deepEqual(
  collisionExclusions,
  ['"excluded"', '""'],
  "anonymized exports must replace free-text exclusion reasons with a safe marker"
);
assert.deepEqual(
  collisionNames,
  ['"S001"', '"S001"'],
  "raw values must be replaced once without rescanning generated labels"
);

console.log("Teaching legacy and paired experiment CSV safety tests passed");
