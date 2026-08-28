import assert from "node:assert/strict";
import path from "node:path";
import Database from "better-sqlite3";
import {
  getCurrentTeachingRound,
  saveCurrentTeachingDraft,
  submitCurrentTeachingRound,
} from "./assignment";
import {
  createGroupCrossoverExperiment,
  deleteGroupRosterEntry,
  importGroupRoster,
  joinGroupCrossoverExperiment,
  listGroupCrossoverExperiments,
  listGroupRoster,
  TeachingRosterError,
} from "./groupCrossover";
import type { CheckedTribologyRecord } from "./groupGold";
import { getTeachingDb } from "./store";

// --- fixture tribology.db -------------------------------------------------------

function fixtureRecord(index: number): CheckedTribologyRecord {
  return {
    id: `rec-${index}`,
    paper: { title: `Fixture paper ${index}`, doi: `10.1000/f${index}`, journal: "Fixture J." },
    core: {
      ionicLiquid: { cation: `[C${index}]+`, anion: `[A${index}]-` },
      substrate: `substrate-${index}`,
      temperature: { raw: "25 °C", value: 25, unit: "°C", std: 298.15, stdUnit: "K" },
      load: { raw: `${index} nN`, value: index, unit: "nN", std: index * 1e-9, stdUnit: "N" },
      cof: 0.1 + index / 100,
    },
    provenance: {
      cof: { page: index, quote: `friction coefficient was ${0.1 + index / 100} throughout` },
    },
    extraction: { model: "fixture-model" },
  };
}

const tribologyPath = path.join(process.env.IONICLINK_DATA_DIR!, "tribology.db");
const tribo = new Database(tribologyPath);
tribo.exec(`
  CREATE TABLE records (
    id TEXT PRIMARY KEY,
    status TEXT NOT NULL,
    payload TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
`);
const insertRecord = tribo.prepare(
  "INSERT INTO records (id, status, payload, created_at) VALUES (?, ?, ?, ?)"
);
for (const index of [1, 2, 3, 4]) {
  insertRecord.run(`rec-${index}`, "official", JSON.stringify(fixtureRecord(index)), "2026-01-01T00:00:00.000Z");
}
insertRecord.run("rec-review", "review", JSON.stringify(fixtureRecord(9)), "2026-01-01T00:00:00.000Z");
insertRecord.run(
  "rec-incomplete",
  "official",
  JSON.stringify({ id: "rec-incomplete", core: { ionicLiquid: { cation: "X" } } }),
  "2026-01-01T00:00:00.000Z"
);
tribo.close();

// --- creation validation ---------------------------------------------------------

assert.throws(
  () =>
    createGroupCrossoverExperiment({
      name: "x",
      inviteCode: "ODDCOUNT",
      groupCount: 3,
      recordIds: ["rec-1", "rec-2", "rec-3"],
    }),
  /偶数/
);
assert.throws(
  () =>
    createGroupCrossoverExperiment({
      name: "x",
      inviteCode: "MISMATCH",
      groupCount: 4,
      recordIds: ["rec-1", "rec-2"],
    }),
  /恰好 4 条/
);
assert.throws(
  () =>
    createGroupCrossoverExperiment({
      name: "x",
      inviteCode: "DUPES",
      groupCount: 2,
      recordIds: ["rec-1", "rec-1"],
    }),
  /重复/
);
assert.throws(
  () =>
    createGroupCrossoverExperiment({
      name: "x",
      inviteCode: "REVIEWONLY",
      groupCount: 2,
      recordIds: ["rec-1", "rec-review"],
    }),
  /没有找到/
);
assert.throws(
  () =>
    createGroupCrossoverExperiment({
      name: "x",
      inviteCode: "INCOMPLETE",
      groupCount: 2,
      recordIds: ["rec-1", "rec-incomplete"],
    }),
  /缺少必需字段/
);

const { projectId } = createGroupCrossoverExperiment({
  name: "2026 春季分组交叉实验",
  inviteCode: "group-2026-a",
  groupCount: 4,
  recordIds: ["rec-1", "rec-2", "rec-3", "rec-4"],
});
assert.throws(
  () =>
    createGroupCrossoverExperiment({
      name: "y",
      inviteCode: "GROUP-2026-A",
      groupCount: 2,
      recordIds: ["rec-1", "rec-2"],
    }),
  /已被使用/
);

const store = getTeachingDb();
const projectRow = store
  .prepare(
    `SELECT experiment_kind AS kind, is_default AS isDefault, group_count AS groupCount,
            config_checksum AS checksum, invite_code AS inviteCode
     FROM teaching_projects WHERE id = ?`
  )
  .get(projectId) as {
  kind: string;
  isDefault: number;
  groupCount: number;
  checksum: string;
  inviteCode: string;
};
assert.equal(projectRow.kind, "group_crossover");
assert.equal(projectRow.isDefault, 0);
assert.equal(projectRow.groupCount, 4);
assert.equal(projectRow.inviteCode, "GROUP-2026-A");
assert.equal(projectRow.checksum.length, 64);

const paperRows = store
  .prepare(
    `SELECT paper_no AS paperNo, group_no AS groupNo, source_record_id AS recordId,
            scoring_rules_json AS rules, ai_snapshot_json AS aiSnapshot, config_version AS version
     FROM teaching_papers WHERE project_id = ? ORDER BY group_no`
  )
  .all(projectId) as Array<{
  paperNo: string;
  groupNo: number;
  recordId: string;
  rules: string;
  aiSnapshot: string;
  version: string;
}>;
assert.equal(paperRows.length, 4);
assert.deepEqual(
  paperRows.map((row) => [row.paperNo, row.groupNo, row.recordId]),
  [
    ["1", 1, "rec-1"],
    ["2", 2, "rec-2"],
    ["3", 3, "rec-3"],
    ["4", 4, "rec-4"],
  ]
);
for (const row of paperRows) {
  assert.equal(row.version, "group-crossover-v1");
  assert.equal(Object.keys(JSON.parse(row.rules)).length, 6);
  assert.equal(Object.keys(JSON.parse(row.aiSnapshot)).length, 6);
}

const listed = listGroupCrossoverExperiments();
assert.equal(listed.length, 1);
assert.equal(listed[0].inviteCode, "GROUP-2026-A");
assert.equal(listed[0].paperCount, 4);

// --- roster import -----------------------------------------------------------------

const importResult = importGroupRoster(projectId, [
  { studentName: "张三", groupNo: 1 },
  { studentName: "李四", groupNo: 2 },
  { studentName: "王五", groupNo: 1 },
  { studentName: "赵六", groupNo: 4 },
  { studentName: "坏组号", groupNo: 7 },
  { studentName: " 张三 ", groupNo: 2 }, // duplicate identity after trim/normalization
  { studentName: "x", groupNo: 1 },
]);
assert.equal(importResult.added, 4);
assert.equal(importResult.rejected.length, 3);
assert.match(importResult.rejected[0].reason, /组号/);
assert.match(importResult.rejected[1].reason, /重复/);
assert.match(importResult.rejected[2].reason, /2-80/);

const rosterBeforeJoin = listGroupRoster(projectId);
assert.equal(rosterBeforeJoin.length, 4);
assert.equal(rosterBeforeJoin.every((entry) => !entry.claimed), true);

// re-import updates unclaimed rows
const updateResult = importGroupRoster(projectId, [{ studentName: "王五", groupNo: 3 }]);
assert.equal(updateResult.updated, 1);
assert.equal(listGroupRoster(projectId).find((entry) => entry.studentName === "王五")?.groupNo, 3);

// delete unclaimed row
const zhaoLiu = listGroupRoster(projectId).find((entry) => entry.studentName === "赵六")!;
deleteGroupRosterEntry(projectId, zhaoLiu.id);
assert.equal(listGroupRoster(projectId).length, 3);

// --- join: roster enforcement --------------------------------------------------------

assert.throws(
  () => joinGroupCrossoverExperiment("GROUP-2026-A", "不在名单"),
  (error) => error instanceof TeachingRosterError && /不在本次实验名单/.test(error.message)
);
assert.throws(
  () => joinGroupCrossoverExperiment("NO-SUCH-CODE", "张三"),
  (error) => error instanceof TeachingRosterError && /实验代码/.test(error.message)
);
assert.equal(
  store.prepare("SELECT COUNT(*) FROM teaching_participants WHERE project_id = ?").pluck().get(projectId),
  0,
  "rejected joins must not create participants"
);

// --- join: odd group (AI first) ------------------------------------------------------

const joinOdd = joinGroupCrossoverExperiment("group-2026-a", "张三");
const oddParticipant = store
  .prepare(
    `SELECT group_code AS groupCode, sequence_code AS sequenceCode
     FROM teaching_participants WHERE id = ?`
  )
  .get(joinOdd.participantId) as { groupCode: string; sequenceCode: string };
assert.equal(oddParticipant.groupCode, "1");
assert.equal(oddParticipant.sequenceCode, "ai_then_manual");

const oddRounds = store
  .prepare(
    `SELECT s.round_no AS roundNo, s.mode, s.ai_initial_json AS aiInitial,
            p.group_no AS paperGroup
     FROM teaching_submissions s JOIN teaching_papers p ON p.id = s.paper_id
     WHERE s.participant_id = ? ORDER BY s.round_no`
  )
  .all(joinOdd.participantId) as Array<{
  roundNo: number;
  mode: string;
  aiInitial: string;
  paperGroup: number;
}>;
assert.deepEqual(
  oddRounds.map((row) => [row.roundNo, row.mode, row.paperGroup]),
  [
    [1, "ai_assisted", 1],
    [2, "manual", 2],
  ],
  "group 1: AI on own paper (1), then manual on partner paper (2)"
);
assert.equal(JSON.parse(oddRounds[0].aiInitial).cation?.value, "[C1]+");
assert.equal(oddRounds[1].aiInitial, "{}");

// --- join: even group (manual first) ---------------------------------------------------

const joinEven = joinGroupCrossoverExperiment("GROUP-2026-A", "李四");
const evenParticipant = store
  .prepare(
    `SELECT group_code AS groupCode, sequence_code AS sequenceCode
     FROM teaching_participants WHERE id = ?`
  )
  .get(joinEven.participantId) as { groupCode: string; sequenceCode: string };
assert.equal(evenParticipant.groupCode, "2");
assert.equal(evenParticipant.sequenceCode, "manual_then_ai");
const evenRounds = store
  .prepare(
    `SELECT s.round_no AS roundNo, s.mode, p.group_no AS paperGroup
     FROM teaching_submissions s JOIN teaching_papers p ON p.id = s.paper_id
     WHERE s.participant_id = ? ORDER BY s.round_no`
  )
  .all(joinEven.participantId) as Array<{ roundNo: number; mode: string; paperGroup: number }>;
assert.deepEqual(
  evenRounds.map((row) => [row.roundNo, row.mode, row.paperGroup]),
  [
    [1, "manual", 2],
    [2, "ai_assisted", 1],
  ],
  "group 2: manual on own paper (2), then AI on partner paper (1)"
);

// --- resume + claimed-roster protection --------------------------------------------------

const resumed = joinGroupCrossoverExperiment("GROUP-2026-A", " 张三 ");
assert.equal(resumed.participantId, joinOdd.participantId, "rejoin resumes the same participant");

const claimedImport = importGroupRoster(projectId, [{ studentName: "张三", groupNo: 3 }]);
assert.equal(claimedImport.rejected.length, 1);
assert.match(claimedImport.rejected[0].reason, /已加入实验/);
assert.throws(
  () =>
    deleteGroupRosterEntry(
      projectId,
      listGroupRoster(projectId).find((entry) => entry.studentName === "张三")!.id
    ),
  /不可删除/
);
assert.equal(listGroupRoster(projectId).filter((entry) => entry.claimed).length, 2);

// --- shared machinery: round flow + group scoring -------------------------------------------

const state1 = getCurrentTeachingRound(joinOdd.participantId);
assert.equal(state1?.status, "active");
if (state1?.status === "active") {
  assert.equal(state1.mode, "ai_assisted");
  assert.equal(state1.paper.code, "1");
  assert.equal(state1.totalRounds, 2);
  if (state1.mode === "ai_assisted") {
    assert.equal(state1.aiInitial.cation?.value, "[C1]+");
  }

  // AI-assisted round: answers are prefilled from the snapshot; submit as-is.
  const submitted1 = submitCurrentTeachingRound(joinOdd.participantId, {
    roundNo: 1,
    version: state1.version,
  });
  assert.deepEqual(submitted1, { status: "next_round", roundNo: 2 });
}

const state2 = getCurrentTeachingRound(joinOdd.participantId);
assert.equal(state2?.status, "active");
if (state2?.status === "active") {
  assert.equal(state2.mode, "manual");
  assert.equal(state2.paper.code, "2");

  const draft = saveCurrentTeachingDraft(joinOdd.participantId, state2.version, {
    cation: { value: "[C2]+" },
    anion: { value: "[A2]-" },
    substrate: { value: "substrate-2" },
    temperature: { value: "25 °C" },
    load: { value: "2 nN" },
    cof: { value: "0.12" },
  });
  const submitted2 = submitCurrentTeachingRound(joinOdd.participantId, {
    roundNo: 2,
    version: draft.version,
  });
  assert.equal(submitted2.status, "complete");
}

const scoredRows = store
  .prepare(
    `SELECT round_no AS roundNo, mode, scoring_status AS status, scoring_version AS version,
            auto_value_scores_json AS valueScores
     FROM teaching_submissions WHERE participant_id = ? ORDER BY round_no`
  )
  .all(joinOdd.participantId) as Array<{
  roundNo: number;
  mode: string;
  status: string;
  version: string;
  valueScores: string;
}>;
for (const row of scoredRows) {
  assert.equal(row.status, "scored");
  assert.equal(row.version, "group-crossover-v1");
}
const round1Values = JSON.parse(scoredRows[0].valueScores) as Record<string, { correct: boolean }>;
assert.equal(
  Object.values(round1Values).every((score) => score.correct),
  true,
  "submitting the AI snapshot unchanged scores all six values correct"
);
const round2Values = JSON.parse(scoredRows[1].valueScores) as Record<string, { correct: boolean }>;
assert.equal(Object.values(round2Values).every((score) => score.correct), true);

assert.equal(getCurrentTeachingRound(joinOdd.participantId)?.status, "complete");

console.log("Group-crossover creation, roster, and join tests passed");
