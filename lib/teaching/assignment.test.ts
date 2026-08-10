import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
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
  started_at: string;
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

assert.equal(normalizeStudentAlias("  Ｓ００１\tStudent  "), "Ｓ００１\tStudent");
assert.equal(normalizeStudentAlias(` ${"a".repeat(80)} `), "a".repeat(80));
assert.throws(() => normalizeStudentAlias(" x "), /2.*80|alias/i);
assert.throws(() => normalizeStudentAlias("a".repeat(81)), /2.*80|alias/i);
assert.throws(
  () => normalizeStudentAlias(`A${" ".repeat(80)}B`),
  /2.*80|alias/i,
  "display length must be checked before identity whitespace is collapsed"
);

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

const enteredAliceAlias = "Ａｌｉｃｅ\t  Smith";
const alice = joinDefaultTeachingExperiment(`  ${enteredAliceAlias}  `);
const aliceAgain = joinDefaultTeachingExperiment("alice smith");
assert.equal(aliceAgain.participantId, alice.participantId);
assert.deepEqual(
  db.prepare(
    "SELECT student_alias AS studentAlias, identity_key AS identityKey FROM teaching_participants WHERE id = ?"
  ).get(alice.participantId),
  { studentAlias: enteredAliceAlias, identityKey: "alice smith" }
);

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
const inactiveRoundStartedAt = "2000-01-01T00:00:00.000Z";
db.prepare(
  `UPDATE teaching_submissions SET started_at = ?, updated_at = ?
   WHERE participant_id = ? AND round_no = 2`
).run(inactiveRoundStartedAt, inactiveRoundStartedAt, first.participantId);
const roundTwoAnswersBeforeTransition = submission(db, first.participantId, 2).answers_json;
const transition = submitCurrentTeachingRound(first.participantId);
assert.deepEqual(transition, { status: "next_round", roundNo: 2 });
assert.throws(
  () => saveCurrentTeachingDraft(first.participantId, initialVersion, allValues("delayed-round-one")),
  /version|refresh|update|刷新/i,
  "a delayed round 1 save must not match the newly active round 2"
);
assert.equal(
  submission(db, first.participantId, 2).answers_json,
  roundTwoAnswersBeforeTransition,
  "a delayed round 1 save must leave round 2 answers unchanged"
);
assert.equal(
  submission(db, first.participantId, 2).version,
  secondSave.version + 1,
  "round 2 must activate above every version visible in round 1"
);
const scoredRoundOne = submission(db, first.participantId, 1);
assert.ok(scoredRoundOne.submitted_at);
const activatedRoundTwo = submission(db, first.participantId, 2);
const successfulActivation = {
  startedAt: activatedRoundTwo.started_at,
  updatedAt: activatedRoundTwo.updated_at,
  submittedAt: scoredRoundOne.submitted_at,
};
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
db.exec(`
  CREATE TRIGGER force_assignment_scoring_error
  AFTER UPDATE OF submitted_at ON teaching_submissions
  WHEN NEW.participant_id IN ('${errorParticipantIds.join("', '")}')
    AND NEW.round_no = 1
    AND OLD.submitted_at IS NULL
    AND NEW.submitted_at IS NOT NULL
  BEGIN
    UPDATE teaching_papers
    SET scoring_rules_json = '{broken json'
    WHERE id = NEW.paper_id;
  END;
`);

const erroredSnapshots = new Map<string, Pick<SubmissionRow, "answers_json" | "version" | "updated_at" | "submitted_at">>();
const scoringFailureActivations: Array<{
  startedAt: string;
  updatedAt: string;
  submittedAt: string | null;
}> = [];
for (const participantId of errorParticipantIds) {
  const state = getCurrentTeachingRound(participantId);
  assertActive(state);
  const saved = saveCurrentTeachingDraft(participantId, state.version, allValues("rescore"));
  db.prepare(
    `UPDATE teaching_submissions SET started_at = ?, updated_at = ?
     WHERE participant_id = ? AND round_no = 2`
  ).run(inactiveRoundStartedAt, inactiveRoundStartedAt, participantId);
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
  const nextRound = submission(db, participantId, 2);
  scoringFailureActivations.push({
    startedAt: nextRound.started_at,
    updatedAt: nextRound.updated_at,
    submittedAt: row.submitted_at,
  });
}
db.exec("DROP TRIGGER force_assignment_scoring_error");

for (const activation of [successfulActivation, ...scoringFailureActivations]) {
  assert.ok(activation.submittedAt);
  assert.notEqual(
    activation.startedAt,
    inactiveRoundStartedAt,
    "round 2 must stop using its join-time placeholder when it activates"
  );
  assert.equal(activation.startedAt, activation.updatedAt);
  assert.ok(
    Date.parse(activation.startedAt) >= Date.parse(activation.submittedAt),
    "round 2 timing must begin no earlier than the round 1 transition"
  );
}

assert.equal(rescoreErroredTeachingSubmissions(1), 1);
assert.equal(
  db.prepare("SELECT scoring_rules_json FROM teaching_papers WHERE id = ?").pluck().get(
    DEFAULT_EXPERIMENT.papers[0].id
  ),
  paperARules,
  "batch rescoring must repair canonical rules before selecting errored submissions"
);
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

let testedDirectCanonicalRepair = false;
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
  const expectedValueCorrect = Object.values(
    JSON.parse(rescored.auto_value_scores_json) as Record<string, { correct: boolean }>
  ).filter((field) => field.correct).length;
  if (!testedDirectCanonicalRepair) {
    const answers = JSON.parse(rescored.answers_json) as TeachingAnswers;
    const permissiveRules = Object.fromEntries(
      TEACHING_FIELDS.map((field) => [
        field.key,
        {
          value: {
            kind: "text",
            expected: answers[field.key]?.value ?? "",
            aliases: [],
          },
          evidence: { pages: [], anyKeywordSets: [], notReported: true },
        },
      ])
    );
    db.prepare("UPDATE teaching_papers SET scoring_rules_json = ? WHERE id = ?").run(
      JSON.stringify(permissiveRules),
      DEFAULT_EXPERIMENT.papers[0].id
    );
    testedDirectCanonicalRepair = true;
  }
  const score = rescoreTeachingSubmission(submissionId);
  assert.equal(score.valueCorrect, expectedValueCorrect);
  assert.equal(
    db.prepare("SELECT scoring_rules_json FROM teaching_papers WHERE id = ?").pluck().get(
      DEFAULT_EXPERIMENT.papers[0].id
    ),
    paperARules,
    "direct rescoring must repair valid semantic rule drift before scoring"
  );
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

const concurrentDataDir = path.join(
  process.env.IONICLINK_DATA_DIR!,
  "concurrent-default-assignment"
);
mkdirSync(concurrentDataDir, { recursive: true });
const tsxCli = path.join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
const initializer = spawnSync(
  process.execPath,
  [
    tsxCli,
    "--eval",
    `import { getTeachingDb, closeTeachingStoreForTests } from "./lib/teaching/store.ts";
     getTeachingDb();
     closeTeachingStoreForTests();`,
  ],
  {
    cwd: process.cwd(),
    env: { ...process.env, IONICLINK_DATA_DIR: concurrentDataDir },
    encoding: "utf8",
    timeout: 10_000,
  }
);
assert.equal(
  initializer.status,
  0,
  initializer.stderr || initializer.error?.message || "concurrency database initialization failed"
);

const workerSource = `
  import { existsSync } from "node:fs";
  import { joinDefaultTeachingExperiment } from "./lib/teaching/assignment.ts";
  import { closeTeachingStoreForTests, getTeachingDb } from "./lib/teaching/store.ts";

  const bootStartPath = process.env.IONICLINK_CONCURRENT_BOOT_START;
  const joinStartPath = process.env.IONICLINK_CONCURRENT_JOIN_START;
  const aliasesJson = process.env.IONICLINK_CONCURRENT_ALIASES;
  const workerName = process.env.IONICLINK_CONCURRENT_WORKER;
  const waitArray = new Int32Array(new SharedArrayBuffer(4));
  const emit = (event, details = {}) => {
    process.stdout.write(JSON.stringify({ event, workerName, ...details }) + "\\n");
  };
  const waitForBarrier = (file, label) => {
    const deadline = Date.now() + 10_000;
    while (!existsSync(file)) {
      if (Date.now() >= deadline) throw new Error(label + " barrier timed out");
      Atomics.wait(waitArray, 0, 0, 10);
    }
  };
  let result;
  try {
    if (!bootStartPath || !joinStartPath || !aliasesJson || !workerName) {
      throw new Error("worker environment is incomplete");
    }
    const aliases = JSON.parse(aliasesJson);
    if (!Array.isArray(aliases) || aliases.some((alias) => typeof alias !== "string")) {
      throw new Error("worker aliases are invalid");
    }
    emit("boot_ready");
    waitForBarrier(bootStartPath, "store-open");
    getTeachingDb();
    emit("join_ready");
    waitForBarrier(joinStartPath, "join");
    result = {
      ok: true,
      aliases,
      joined: aliases.map((alias) => joinDefaultTeachingExperiment(alias)),
    };
  } catch (error) {
    result = {
      ok: false,
      aliasesJson,
      message: error instanceof Error ? error.message : String(error),
      code: error && typeof error === "object" && "code" in error ? String(error.code) : null,
    };
  } finally {
    closeTeachingStoreForTests();
    emit("result", { result });
  }
`;
const coordinatorSource = `
  import { spawn } from "node:child_process";
  import { writeFileSync } from "node:fs";
  import path from "node:path";

  (async () => {
  const dataDir = process.env.IONICLINK_DATA_DIR;
  const tsxCli = process.env.IONICLINK_CONCURRENT_TSX;
  const workerSource = process.env.IONICLINK_CONCURRENT_SOURCE;
  if (!dataDir || !tsxCli || !workerSource) throw new Error("coordinator environment is incomplete");

  const bootStartPath = path.join(dataDir, "boot-start");
  const joinStartPath = path.join(dataDir, "join-start");
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const states = Array.from({ length: 6 }, (_, workerIndex) => {
    const workerName = "worker-" + String(workerIndex + 1).padStart(2, "0");
    const aliases = Array.from({ length: 5 }, (_, aliasIndex) => {
      const sequence = workerIndex * 5 + aliasIndex + 1;
      return "C" + String(sequence).padStart(3, "0");
    });
    const child = spawn(process.execPath, [tsxCli, "--eval", workerSource], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        IONICLINK_DATA_DIR: dataDir,
        IONICLINK_CONCURRENT_BOOT_START: bootStartPath,
        IONICLINK_CONCURRENT_JOIN_START: joinStartPath,
        IONICLINK_CONCURRENT_ALIASES: JSON.stringify(aliases),
        IONICLINK_CONCURRENT_WORKER: workerName,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const state = {
      workerName,
      aliases,
      child,
      events: [],
      stderr: "",
      stdoutRemainder: "",
      spawnError: null,
      closed: false,
      exitCode: null,
      signal: null,
      closePromise: null,
    };
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      state.stdoutRemainder += chunk;
      let newline = state.stdoutRemainder.indexOf("\\n");
      while (newline !== -1) {
        const line = state.stdoutRemainder.slice(0, newline).trim();
        state.stdoutRemainder = state.stdoutRemainder.slice(newline + 1);
        if (line) {
          try {
            state.events.push(JSON.parse(line));
          } catch (error) {
            state.events.push({ event: "protocol_error", line, message: String(error) });
          }
        }
        newline = state.stdoutRemainder.indexOf("\\n");
      }
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => { state.stderr += chunk; });
    state.closePromise = new Promise((resolve) => {
      child.on("error", (error) => { state.spawnError = error.message; });
      child.on("close", (code, signal) => {
        state.closed = true;
        state.exitCode = code;
        state.signal = signal;
        resolve();
      });
    });
    return state;
  });

  const resultEvent = (state) => state.events.find((event) => event.event === "result");
  const hasEvent = (state, name) => state.events.some((event) => event.event === name);
  const snapshot = () => states.map((state) => ({
    workerName: state.workerName,
    aliases: state.aliases,
    events: state.events,
    stderr: state.stderr,
    stdoutRemainder: state.stdoutRemainder,
    spawnError: state.spawnError,
    closed: state.closed,
    exitCode: state.exitCode,
    signal: state.signal,
  }));
  const waitForPhase = async (eventName, timeoutMs) => {
    const deadline = Date.now() + timeoutMs;
    while (!states.every((state) => hasEvent(state, eventName))) {
      const early = states.find((state) => {
        const result = resultEvent(state);
        return state.spawnError || (result && !result.result?.ok) || (state.closed && !hasEvent(state, eventName));
      });
      if (early) throw new Error(early.workerName + " failed before " + eventName);
      if (Date.now() >= deadline) throw new Error("timed out waiting for " + eventName);
      await delay(10);
    }
  };
  const waitForClose = async (timeoutMs) => {
    const deadline = Date.now() + timeoutMs;
    while (!states.every((state) => state.closed)) {
      const early = states.find((state) => {
        const result = resultEvent(state);
        return state.spawnError || (result && !result.result?.ok) ||
          (state.closed && (!result || state.exitCode !== 0));
      });
      if (early) throw new Error(early.workerName + " failed while joining");
      if (Date.now() >= deadline) throw new Error("timed out waiting for workers to close");
      await delay(10);
    }
  };

  let failure = null;
  try {
    await waitForPhase("boot_ready", 10_000);
    writeFileSync(bootStartPath, "start");
    await waitForPhase("join_ready", 10_000);
    writeFileSync(joinStartPath, "start");
    await waitForClose(10_000);
    const failed = states.find((state) => {
      const result = resultEvent(state);
      return !result || !result.result?.ok || state.exitCode !== 0;
    });
    if (failed) throw new Error(failed.workerName + " did not complete its joins");
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
  } finally {
    for (const state of states) {
      if (!state.closed) state.child.kill("SIGTERM");
    }
    await delay(100);
    for (const state of states) {
      if (!state.closed) state.child.kill("SIGKILL");
    }
    await Promise.all(states.map((state) => state.closePromise));
  }

  if (failure) {
    process.stderr.write(JSON.stringify({ failure, workers: snapshot() }, null, 2) + "\\n");
    process.exitCode = 1;
  } else {
    const joined = states.flatMap((state) => resultEvent(state).result.joined);
    process.stdout.write(JSON.stringify({ ok: true, joined, workers: snapshot() }) + "\\n");
  }
  })().catch((error) => {
    process.stderr.write(
      JSON.stringify(
        { failure: error instanceof Error ? error.message : String(error) },
        null,
        2
      ) + "\\n"
    );
    process.exitCode = 1;
  });
`;
const coordinator = spawnSync(process.execPath, [tsxCli, "--eval", coordinatorSource], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    IONICLINK_DATA_DIR: concurrentDataDir,
    IONICLINK_CONCURRENT_TSX: tsxCli,
    IONICLINK_CONCURRENT_SOURCE: workerSource,
  },
  encoding: "utf8",
  timeout: 35_000,
});
assert.equal(
  coordinator.status,
  0,
  coordinator.stderr || coordinator.stdout || coordinator.error?.message || "concurrency coordinator failed"
);
const coordinatorResult = JSON.parse(coordinator.stdout.trim()) as {
  ok: boolean;
  joined: Array<{ projectId: string; participantId: string }>;
};
assert.equal(coordinatorResult.ok, true);
const concurrentJoins = coordinatorResult.joined;
assert.equal(concurrentJoins.length, 30);
assert.equal(new Set(concurrentJoins.map((result) => result.participantId)).size, 30);

const concurrentDb = new Database(path.join(concurrentDataDir, "teaching.db"), {
  readonly: true,
  fileMustExist: true,
});
try {
  assert.equal(
    concurrentDb.prepare("SELECT COUNT(*) FROM teaching_participants").pluck().get(),
    30
  );
  assert.equal(
    concurrentDb.prepare("SELECT COUNT(*) FROM teaching_submissions").pluck().get(),
    60
  );
  assert.deepEqual(sequenceCounts(concurrentDb), { manual_then_ai: 15, ai_then_manual: 15 });
  assert.equal(concurrentDb.pragma("quick_check", { simple: true }), "ok");
} finally {
  concurrentDb.close();
}

closeTeachingStoreForTests();
console.log("Teaching balanced assignment and two-round transition tests passed");
