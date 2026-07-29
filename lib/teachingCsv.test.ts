import assert from "node:assert/strict";
import type { TeachingDashboardRow } from "./teachingShared";
import { teachingRowsToCsv } from "./teachingCsv";

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
console.log("Teaching CSV safety tests passed");
