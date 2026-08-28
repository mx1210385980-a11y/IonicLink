import assert from "node:assert/strict";
import path from "node:path";
import Database from "better-sqlite3";
import { reviewTeachingSubmission } from "../teaching";
import {
  getCurrentTeachingRound,
  saveCurrentTeachingDraft,
  submitCurrentTeachingRound,
} from "./assignment";
import { recordTeachingHeartbeat } from "./activity";
import {
  applyTeacherOverride,
  createGroupCrossoverExperiment,
  getGroupCrossoverDashboard,
  importGroupRoster,
  joinGroupCrossoverExperiment,
} from "./groupCrossover";
import type { CheckedTribologyRecord } from "./groupGold";
import { getTeachingDb } from "./store";
import type { TeachingAnswers, TeachingAutoScore } from "../teachingShared";

// --- fixtures ------------------------------------------------------------------

function fixtureRecord(index: number): CheckedTribologyRecord {
  return {
    id: `rec-${index}`,
    paper: { title: `Dashboard paper ${index}`, doi: `10.1000/d${index}`, journal: "Fixture J." },
    core: {
      ionicLiquid: { cation: `[C${index}]+`, anion: `[A${index}]-` },
      substrate: `substrate-${index}`,
      temperature: { raw: "25 °C", value: 25, unit: "°C", std: 298.15, stdUnit: "K" },
      load: { raw: `${index} nN`, value: index, unit: "nN", std: index * 1e-9, stdUnit: "N" },
      cof: 0.1 + index / 100,
    },
    extraction: { model: "fixture-model" },
  };
}

const tribo = new Database(path.join(process.env.IONICLINK_DATA_DIR!, "tribology.db"));
tribo.exec(
  "CREATE TABLE records (id TEXT PRIMARY KEY, status TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL);"
);
for (const index of [1, 2]) {
  tribo
    .prepare("INSERT INTO records (id, status, payload, created_at) VALUES (?, 'official', ?, ?)")
    .run(`rec-${index}`, JSON.stringify(fixtureRecord(index)), "2026-01-01T00:00:00.000Z");
}
tribo.close();

const { projectId } = createGroupCrossoverExperiment({
  name: "看板测试实验",
  inviteCode: "DASH-2026",
  groupCount: 2,
  recordIds: ["rec-1", "rec-2"],
});
importGroupRoster(projectId, [
  { studentName: "甲组学生", groupNo: 1 },
  { studentName: "乙组学生", groupNo: 2 },
]);

// --- applyTeacherOverride unit checks ---------------------------------------------

const autoScore = {
  values: {
    cation: { correct: true, normalized: "a", reason: "alias_match" },
    anion: { correct: false, normalized: "b", reason: "value_mismatch" },
    substrate: { correct: true, normalized: "c", reason: "alias_match" },
    temperature: { correct: true, normalized: "d", reason: "within_tolerance" },
    load: { correct: false, normalized: "e", reason: "value_mismatch" },
    cof: { correct: true, normalized: "f", reason: "within_tolerance" },
  },
  evidence: {
    cation: { correct: false, normalized: "", reason: "blank" },
    anion: { correct: false, normalized: "", reason: "blank" },
    substrate: { correct: false, normalized: "", reason: "blank" },
    temperature: { correct: false, normalized: "", reason: "blank" },
    load: { correct: false, normalized: "", reason: "blank" },
    cof: { correct: false, normalized: "", reason: "blank" },
  },
  valueCorrect: 4,
  valueAccuracy: 4 / 6,
  valueCoverage: 1,
  evidenceCorrect: 0,
  evidenceAccuracy: 0,
  evidenceCoverage: 0,
} satisfies TeachingAutoScore;

const overridden = applyTeacherOverride(autoScore, { anion: "correct", cof: "incorrect" });
assert.equal(overridden.values.anion.correct, true);
assert.equal(overridden.values.anion.reason, "teacher_override");
assert.equal(overridden.values.cof.correct, false);
assert.equal(overridden.valueCorrect, 4); // 4 - cof + anion
assert.equal(overridden.evidenceAccuracy, 0, "evidence subscores stay automatic");
assert.deepEqual(applyTeacherOverride(autoScore, {}).values, autoScore.values);

// --- run two students through both rounds ------------------------------------------

function completeExperiment(participantId: string, ownIndex: number, partnerIndex: number) {
  const state1 = getCurrentTeachingRound(participantId);
  assert.equal(state1?.status, "active");
  if (state1?.status !== "active") throw new Error("unreachable");

  if (state1.mode === "manual") {
    const draft = saveCurrentTeachingDraft(participantId, state1.version, goldAnswers(ownIndex));
    heartbeat(participantId, 1, "hb-1-m");
    submitCurrentTeachingRound(participantId, { roundNo: 1, version: draft.version });
  } else {
    heartbeat(participantId, 1, "hb-1-a");
    submitCurrentTeachingRound(participantId, { roundNo: 1, version: state1.version });
  }

  const state2 = getCurrentTeachingRound(participantId);
  assert.equal(state2?.status, "active");
  if (state2?.status !== "active") throw new Error("unreachable");
  if (state2.mode === "manual") {
    const draft = saveCurrentTeachingDraft(participantId, state2.version, goldAnswers(partnerIndex));
    heartbeat(participantId, 2, "hb-2-m");
    submitCurrentTeachingRound(participantId, { roundNo: 2, version: draft.version });
  } else {
    heartbeat(participantId, 2, "hb-2-a");
    submitCurrentTeachingRound(participantId, { roundNo: 2, version: state2.version });
  }
}

function heartbeat(participantId: string, roundNo: 1 | 2, eventId: string) {
  recordTeachingHeartbeat(participantId, {
    eventId,
    roundNo,
    clientAt: new Date().toISOString(),
    activeDeltaSeconds: 15,
    visible: true,
  });
}

function goldAnswers(index: number): TeachingAnswers {
  return {
    cation: { value: `[C${index}]+` },
    anion: { value: `[A${index}]-` },
    substrate: { value: `substrate-${index}` },
    temperature: { value: "25 °C" },
    load: { value: `${index} nN` },
    cof: { value: (0.1 + index / 100).toFixed(2) },
  };
}

const odd = joinGroupCrossoverExperiment("DASH-2026", "甲组学生");
const even = joinGroupCrossoverExperiment("DASH-2026", "乙组学生");
completeExperiment(odd.participantId, 1, 2);
completeExperiment(even.participantId, 2, 1);

// --- dashboard before review ---------------------------------------------------

let dashboard = getGroupCrossoverDashboard(projectId);
assert.equal(dashboard.experiment.inviteCode, "DASH-2026");
assert.equal(dashboard.experiment.groupCount, 2);
assert.equal(dashboard.experiment.papers.length, 2);
assert.equal(dashboard.roster.length, 2);
assert.equal(dashboard.roster.every((entry) => entry.claimed), true);

assert.deepEqual(
  dashboard.groupProgress.map((group) => [group.groupNo, group.rosterSize, group.joined, group.completed]),
  [
    [1, 1, 1, 1],
    [2, 1, 1, 1],
  ]
);

assert.equal(dashboard.summary.completion.completed, 2);
assert.equal(dashboard.summary.completion.paired, 2);
assert.deepEqual(dashboard.summary.sequenceCounts, { manual_then_ai: 1, ai_then_manual: 1 });

// every round scored perfectly against the checked-record gold
const oddRow = dashboard.participants.find((row) => row.studentAlias === "甲组学生")!;
assert.equal(oddRow.manual?.paperCode, "2");
assert.equal(oddRow.aiAssisted?.paperCode, "1");
assert.equal(oddRow.manual?.score.valueCorrect, 6);
assert.equal(oddRow.aiAssisted?.score.valueCorrect, 6);
assert.equal(oddRow.aiAssisted?.aiBehavior?.suggested, 6);
assert.equal(oddRow.quality.paired, true);
assert.equal(typeof oddRow.activeTimeDifference, "number");

// diagnostics keyed dynamically
assert.deepEqual(Object.keys(dashboard.diagnostics.byPaper).sort(), ["1", "2"]);
assert.deepEqual(Object.keys(dashboard.diagnostics.byGroup).sort(), ["1", "2"]);
assert.equal(dashboard.diagnostics.byGroup["1"].completed, 1);
assert.equal(dashboard.diagnostics.byParity.aiFirst.completed, 1);
assert.equal(dashboard.diagnostics.byParity.manualFirst.completed, 1);
assert.equal(dashboard.diagnostics.byPaper["1"].manual.n, 0, "paper 1 is AI-extracted by both groups");
assert.equal(dashboard.diagnostics.byPaper["1"].aiAssisted.n, 2);
assert.equal(dashboard.diagnostics.byPaper["2"].manual.n, 2, "paper 2 is manually extracted by both groups");
assert.equal(dashboard.diagnostics.byPaper["2"].aiAssisted.n, 0);

// --- teacher override flows into analytics -------------------------------------

const manualSubmissionId = oddRow.manual!.submissionId;
reviewTeachingSubmission(manualSubmissionId, { cof: "incorrect" }, {});

dashboard = getGroupCrossoverDashboard(projectId);
const reviewedRow = dashboard.participants.find((row) => row.studentAlias === "甲组学生")!;
assert.equal(reviewedRow.manual?.review?.finalValueScores.cof, "incorrect");
assert.equal(reviewedRow.manual?.score.valueCorrect, 5, "override recomputes the round score");
assert.equal(reviewedRow.manual?.score.values.cof.reason, "teacher_override");
assert.equal(
  reviewedRow.manual?.score.values.cation.reason,
  "alias_match",
  "unreviewed fields keep the automatic verdict"
);
assert.equal(reviewedRow.accuracyDifference !== null, true, "paired stats still computed");
assert.equal(
  dashboard.diagnostics.byPaper["2"].manual.medianAccuracy,
  (5 / 6 + 1) / 2,
  "diagnostics reflect the overridden score (median of 5/6 and 6/6)"
);

// unknown project
assert.throws(() => getGroupCrossoverDashboard("no-such-project"), /没有找到/);

console.log("Group-crossover dashboard and override tests passed");
