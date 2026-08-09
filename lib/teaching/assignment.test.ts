import assert from "node:assert/strict";
import type Database from "better-sqlite3";
import {
  getCurrentTeachingRound,
  joinDefaultTeachingExperiment,
  normalizeStudentAlias,
  rescoreErroredTeachingSubmissions,
  rescoreTeachingSubmission,
  saveCurrentTeachingDraft,
  submitCurrentTeachingRound,
} from "./assignment";
import { DEFAULT_EXPERIMENT } from "./config";
import { getTeachingDb, closeTeachingStoreForTests } from "./store";
import { participants, sequenceCounts, submissionsFor } from "./testFixtures";
import { TEACHING_FIELDS, type TeachingAnswers } from "../teachingShared";

type SubmissionRow = {
  id: string;
  round_no: number;
  mode: "manual" | "ai_assisted";
  answers_json: string;
  ai_initial_json: string;
  version: number;
  updated_at: string;
  submitted_at: string | null;
  scoring_status: string;
  scoring_version: string | null;
  auto_scored_at: string | null;
  auto_value_scores_json: string;
  auto_evidence_scores_json: string;
};

function submission(
  db: Database.Database,
  participantId: string,
  roundNo: 1 | 2
): SubmissionRow {
  const row = db
    .prepare("SELECT * FROM teaching_submissions WHERE participant_id = ? AND round_no = ?")
    .get(participantId, roundNo) as SubmissionRow | undefined;
  assert.ok(row, `round ${roundNo} should exist`);
  return row;
}

function allValues(prefix: string): TeachingAnswers {
  return Object.fromEntries(
    TEACHING_FIELDS.map((field) => [field.key, { value: `${prefix} ${field.key}` }])
  );
}

function assertActive(
  state: ReturnType<typeof getCurrentTeachingRound>
): asserts state is Exclude<NonNullable<typeof state>, { status: "complete" }> {
  assert.ok(state);
  assert.equal(state.status, "active");
}

assert.equal(normalizeStudentAlias("  Ｓ００１\tStudent  "), "S001 Student");
assert.equal(normalizeStudentAlias(` ${"a".repeat(80)} `), "a".repeat(80));
assert.throws(() => normalizeStudentAlias(" x "), /2.*80|alias/i);
assert.throws(() => normalizeStudentAlias("a".repeat(81)), /2.*80|alias/i);

const db = getTeachingDb();
const joinedByAlias = new Map<string, ReturnType<typeof joinDefaultTeachingExperiment>>();
for (let index = 1; index <= 30; index += 1) {
  const alias = `S${String(index).padStart(3, "0")}`;
  joinedByAlias.set(alias, joinDefaultTeachingExperiment(alias));
}

assert.deepEqual(sequenceCounts(db), { manual_then_ai: 15, ai_then_manual: 15 });
for (const participant of participants(db)) {
  const rounds = submissionsFor(db, participant.id) as unknown as SubmissionRow[];
  assert.equal(rounds.length, 2);
  assert.deepEqual(rounds.map((round) => round.round_no), [1, 2]);
  assert.deepEqual(new Set(rounds.map((round) => (round as unknown as { paper_id: string }).paper_id)).size, 2);
  for (const round of rounds) {
    const answers = JSON.parse(round.answers_json) as TeachingAnswers;
    const aiInitial = JSON.parse(round.ai_initial_json) as TeachingAnswers;
    if (round.mode === "manual") {
      assert.deepEqual(answers, {});
      assert.deepEqual(aiInitial, {});
    } else {
      assert.deepEqual(answers, aiInitial);
      assert.deepEqual(
        aiInitial,
        DEFAULT_EXPERIMENT.papers[round.round_no - 1].aiInitial
      );
    }
  }
}

const first = joinedByAlias.get("S001")!;
const again = joinDefaultTeachingExperiment("  ｓ００１  ");
assert.equal(again.participantId, first.participantId);
assert.equal(submissionsFor(db, first.participantId).length, 2);
assert.equal(
  db.prepare("SELECT student_alias FROM teaching_participants WHERE id = ?").pluck().get(first.participantId),
  "S001",
  "an identity-equivalent rejoin must preserve the originally entered display alias"
);

const projectCountBeforeValidation = Number(
  db.prepare("SELECT COUNT(*) FROM teaching_participants").pluck().get()
);
assert.throws(() => joinDefaultTeachingExperiment("x"), /2.*80|alias/i);
assert.throws(() => joinDefaultTeachingExperiment("z".repeat(81)), /2.*80|alias/i);
assert.equal(
  db.prepare("SELECT COUNT(*) FROM teaching_participants").pluck().get(),
  projectCountBeforeValidation
);

let firstState = getCurrentTeachingRound(first.participantId);
assertActive(firstState);
assert.equal(firstState.roundNo, 1);
assert.equal(firstState.totalRounds, 2);
assert.equal(firstState.mode, "manual");
assert.equal("aiInitial" in firstState, false);
assert.deepEqual(firstState.answers, {});
assert.equal(firstState.project.id, first.projectId);
assert.equal(firstState.project.name, DEFAULT_EXPERIMENT.name);
assert.deepEqual(firstState.project.fields, TEACHING_FIELDS);
assert.deepEqual(
  {
    id: firstState.paper.id,
    code: firstState.paper.code,
    title: firstState.paper.title,
    doi: firstState.paper.doi,
    journal: firstState.paper.journal,
    sourceUrl: firstState.paper.sourceUrl,
    taskPrompt: firstState.paper.taskPrompt,
  },
  {
    id: DEFAULT_EXPERIMENT.papers[0].id,
    code: DEFAULT_EXPERIMENT.papers[0].code,
    title: DEFAULT_EXPERIMENT.papers[0].title,
    doi: DEFAULT_EXPERIMENT.papers[0].doi,
    journal: DEFAULT_EXPERIMENT.papers[0].journal,
    sourceUrl: DEFAULT_EXPERIMENT.papers[0].sourceUrl,
    taskPrompt: DEFAULT_EXPERIMENT.papers[0].taskPrompt,
  }
);

const incomplete = allValues("round-one");
delete incomplete.cof;
const initialVersion = firstState.version;
const firstSave = saveCurrentTeachingDraft(first.participantId, initialVersion, incomplete);
assert.equal(firstSave.version, initialVersion + 1);
assert.match(firstSave.updatedAt, /^20/);
assert.throws(
  () => saveCurrentTeachingDraft(first.participantId, initialVersion, allValues("stale")),
  /version|refresh|update|刷新/i
);
assert.deepEqual(
  {
    version: submission(db, first.participantId, 2).version,
    answers: JSON.parse(submission(db, first.participantId, 2).answers_json),
    submittedAt: submission(db, first.participantId, 2).submitted_at,
  },
  {
    version: 0,
    answers: DEFAULT_EXPERIMENT.papers[1].aiInitial,
    submittedAt: null,
  },
  "saving round 1 must not mutate round 2"
);
assert.throws(() => submitCurrentTeachingRound(first.participantId), /all|six|6|required|complete|必填|完成/i);
assert.equal(submission(db, first.participantId, 1).submitted_at, null);
assert.equal(submission(db, first.participantId, 2).submitted_at, null);

const completeRoundOne = allValues("round-one-complete");
const secondSave = saveCurrentTeachingDraft(first.participantId, firstSave.version, completeRoundOne);
const transition = submitCurrentTeachingRound(first.participantId);
assert.deepEqual(transition, { status: "next_round", roundNo: 2 });
const scoredRoundOne = submission(db, first.participantId, 1);
assert.ok(scoredRoundOne.submitted_at);
assert.equal(scoredRoundOne.version, secondSave.version + 1);
assert.equal(scoredRoundOne.scoring_status, "scored");
assert.equal(scoredRoundOne.scoring_version, DEFAULT_EXPERIMENT.scoringVersion);
assert.ok(scoredRoundOne.auto_scored_at);
assert.deepEqual(Object.keys(JSON.parse(scoredRoundOne.auto_value_scores_json)).sort(),
  TEACHING_FIELDS.map((field) => field.key).sort());
assert.deepEqual(Object.keys(JSON.parse(scoredRoundOne.auto_evidence_scores_json)).sort(),
  TEACHING_FIELDS.map((field) => field.key).sort());

firstState = getCurrentTeachingRound(first.participantId);
assertActive(firstState);
assert.equal(firstState.roundNo, 2);
assert.equal(firstState.mode, "ai_assisted");
assert.deepEqual(firstState.answers, DEFAULT_EXPERIMENT.papers[1].aiInitial);
assert.deepEqual(firstState.aiInitial, DEFAULT_EXPERIMENT.papers[1].aiInitial);
assert.equal(submission(db, first.participantId, 2).submitted_at, null);

const roundTwoSave = saveCurrentTeachingDraft(
  first.participantId,
  firstState.version,
  firstState.answers
);
assert.equal(roundTwoSave.version, firstState.version + 1);
const completed = submitCurrentTeachingRound(first.participantId);
assert.equal(completed.status, "complete");
assert.match(completed.completedAt, /^20/);
const completedState = getCurrentTeachingRound(first.participantId);
assert.deepEqual(completedState, {
  status: "complete",
  participant: { studentAlias: "S001" },
  completedAt: completed.completedAt,
});
assert.throws(
  () => saveCurrentTeachingDraft(first.participantId, roundTwoSave.version + 1, allValues("late")),
  /complete|completed|round|locked|完成|锁定/i
);

const second = joinedByAlias.get("S002")!;
let secondState = getCurrentTeachingRound(second.participantId);
assertActive(secondState);
assert.equal(secondState.mode, "ai_assisted");
assert.deepEqual(secondState.aiInitial, DEFAULT_EXPERIMENT.papers[0].aiInitial);
saveCurrentTeachingDraft(second.participantId, secondState.version, secondState.answers);
assert.deepEqual(submitCurrentTeachingRound(second.participantId), { status: "next_round", roundNo: 2 });
secondState = getCurrentTeachingRound(second.participantId);
assertActive(secondState);
assert.equal(secondState.roundNo, 2);
assert.equal(secondState.mode, "manual");
assert.equal("aiInitial" in secondState, false);
assert.deepEqual(secondState.answers, {});

const errorParticipantIds = ["S003", "S004"].map(
  (alias) => joinedByAlias.get(alias)!.participantId
);
const paperARules = db
  .prepare("SELECT scoring_rules_json FROM teaching_papers WHERE id = ?")
  .pluck()
  .get(DEFAULT_EXPERIMENT.papers[0].id) as string;
db.prepare("UPDATE teaching_papers SET scoring_rules_json = '{broken json' WHERE id = ?").run(
  DEFAULT_EXPERIMENT.papers[0].id
);

const erroredSnapshots = new Map<string, Pick<SubmissionRow, "answers_json" | "version" | "updated_at" | "submitted_at">>();
for (const participantId of errorParticipantIds) {
  const state = getCurrentTeachingRound(participantId);
  assertActive(state);
  const saved = saveCurrentTeachingDraft(participantId, state.version, allValues("rescore"));
  assert.throws(() => submitCurrentTeachingRound(participantId), /score|scoring|json|评分/i);
  const row = submission(db, participantId, 1);
  assert.ok(row.submitted_at, "a scoring failure must still lock the submitted answers");
  assert.equal(row.scoring_status, "scoring_error");
  assert.equal(row.version, saved.version + 1);
  erroredSnapshots.set(row.id, {
    answers_json: row.answers_json,
    version: row.version,
    updated_at: row.updated_at,
    submitted_at: row.submitted_at,
  });
}

db.prepare("UPDATE teaching_papers SET scoring_rules_json = ? WHERE id = ?").run(
  paperARules,
  DEFAULT_EXPERIMENT.papers[0].id
);
assert.equal(rescoreErroredTeachingSubmissions(1), 1);
assert.equal(
  db.prepare("SELECT COUNT(*) FROM teaching_submissions WHERE scoring_status = 'scoring_error'").pluck().get(),
  1,
  "the batch limit must bound retry work"
);
assert.equal(rescoreErroredTeachingSubmissions(), 1);
assert.equal(
  db.prepare("SELECT COUNT(*) FROM teaching_submissions WHERE scoring_status = 'scoring_error'").pluck().get(),
  0
);

for (const [submissionId, immutable] of erroredSnapshots) {
  const rescored = db.prepare("SELECT * FROM teaching_submissions WHERE id = ?").get(submissionId) as SubmissionRow;
  assert.equal(rescored.scoring_status, "scored");
  assert.deepEqual(
    {
      answers_json: rescored.answers_json,
      version: rescored.version,
      updated_at: rescored.updated_at,
      submitted_at: rescored.submitted_at,
    },
    immutable,
    "rescoring may overwrite automatic score columns only"
  );
  const score = rescoreTeachingSubmission(submissionId);
  assert.equal(score.valueCorrect >= 0, true);
  const repeated = db.prepare("SELECT * FROM teaching_submissions WHERE id = ?").get(submissionId) as SubmissionRow;
  assert.deepEqual(
    {
      answers_json: repeated.answers_json,
      version: repeated.version,
      updated_at: repeated.updated_at,
      submitted_at: repeated.submitted_at,
    },
    immutable
  );
}

assert.equal(getCurrentTeachingRound("missing-participant"), null);
assert.throws(
  () => rescoreTeachingSubmission(submission(db, second.participantId, 2).id),
  /submitted|locked|提交|锁定/i
);

const legacyTimestamp = "2026-08-09T00:00:00.000Z";
db.prepare(
  `INSERT INTO teaching_projects
   (id, name, domain, invite_code, status, fields_json, created_at)
   VALUES ('legacy-assignment-project', 'Legacy assignment', 'tribology',
           'LEGACY-ASSIGNMENT', 'open', ?, ?)`
).run(JSON.stringify(TEACHING_FIELDS), legacyTimestamp);
db.prepare(
  `INSERT INTO teaching_papers
   (id, project_id, paper_no, title, ai_snapshot_json, created_at)
   VALUES ('legacy-assignment-paper', 'legacy-assignment-project', 'legacy',
           'Legacy paper', '{}', ?)`
).run(legacyTimestamp);
const insertLegacyParticipant = db.prepare(
  `INSERT INTO teaching_participants
   (id, project_id, group_code, student_alias, assigned_paper_id, created_at)
   VALUES (?, 'legacy-assignment-project', 'legacy-group', ?,
           'legacy-assignment-paper', ?)`
);
insertLegacyParticipant.run("legacy-draft-participant", "Legacy draft", legacyTimestamp);
insertLegacyParticipant.run("legacy-submitted-participant", "Legacy submitted", legacyTimestamp);
db.prepare(
  `INSERT INTO teaching_submissions
   (id, project_id, paper_id, participant_id, started_at, answers_json, version, updated_at)
   VALUES ('legacy-draft-submission', 'legacy-assignment-project', 'legacy-assignment-paper',
           'legacy-draft-participant', ?, ?, 0, ?)`
).run(legacyTimestamp, JSON.stringify(allValues("legacy-draft")), legacyTimestamp);
db.prepare(
  `INSERT INTO teaching_submissions
   (id, project_id, paper_id, participant_id, started_at, submitted_at,
    answers_json, version, updated_at, scoring_status)
   VALUES ('legacy-submitted-submission', 'legacy-assignment-project',
           'legacy-assignment-paper', 'legacy-submitted-participant', ?, ?, ?, 1, ?, 'legacy')`
).run(
  legacyTimestamp,
  legacyTimestamp,
  JSON.stringify(allValues("legacy-submitted")),
  legacyTimestamp
);
const legacyBefore = db
  .prepare(
    `SELECT id, answers_json, version, updated_at, submitted_at, scoring_status,
            scoring_version, auto_scored_at, auto_value_scores_json,
            auto_evidence_scores_json
     FROM teaching_submissions
     WHERE project_id = 'legacy-assignment-project'
     ORDER BY id`
  )
  .all();
assert.equal(getCurrentTeachingRound("legacy-draft-participant"), null);
assert.throws(
  () => saveCurrentTeachingDraft("legacy-draft-participant", 0, allValues("must-not-save")),
  /not found|default|crossover/i
);
assert.throws(
  () => submitCurrentTeachingRound("legacy-draft-participant"),
  /not found|default|crossover/i
);
assert.throws(
  () => rescoreTeachingSubmission("legacy-submitted-submission"),
  /not found|default|crossover/i
);
assert.deepEqual(
  db.prepare(
    `SELECT id, answers_json, version, updated_at, submitted_at, scoring_status,
            scoring_version, auto_scored_at, auto_value_scores_json,
            auto_evidence_scores_json
     FROM teaching_submissions
     WHERE project_id = 'legacy-assignment-project'
     ORDER BY id`
  ).all(),
  legacyBefore,
  "default two-round APIs must never mutate legacy teaching rows"
);

closeTeachingStoreForTests();
console.log("Teaching balanced assignment and two-round transition tests passed");
