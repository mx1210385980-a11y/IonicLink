import assert from "node:assert/strict";
import type Database from "better-sqlite3";
import {
  recordTeachingHeartbeat,
  teachingTimingQuality,
  type TeachingHeartbeatInput,
} from "../teaching";
import {
  getCurrentTeachingRound,
  joinDefaultTeachingExperiment,
  saveCurrentTeachingDraft,
  submitCurrentTeachingRound,
} from "./assignment";
import { closeTeachingStoreForTests, getTeachingDb } from "./store";
import {
  TEACHING_FIELDS,
  type TeachingAnswers,
  type TeachingFieldKey,
} from "../teachingShared";

type SubmissionRow = {
  id: string;
  roundNo: number;
  activeSeconds: number;
};

type ActivityRow = {
  id: string;
  submissionId: string;
  eventType: string;
  fieldKey: string | null;
  clientAt: string;
  receivedAt: string;
  activeDeltaSeconds: number;
  metadataJson: string;
};

function submissions(
  db: Database.Database,
  participantId: string
): SubmissionRow[] {
  return db
    .prepare(
      `SELECT id, round_no AS roundNo, active_seconds AS activeSeconds
       FROM teaching_submissions
       WHERE participant_id = ?
       ORDER BY round_no`
    )
    .all(participantId) as SubmissionRow[];
}

function activityRows(
  db: Database.Database,
  participantId: string
): ActivityRow[] {
  return db
    .prepare(
      `SELECT e.id, e.submission_id AS submissionId, e.event_type AS eventType,
              e.field_key AS fieldKey, e.client_at AS clientAt,
              e.received_at AS receivedAt,
              e.active_delta_seconds AS activeDeltaSeconds,
              e.metadata_json AS metadataJson
       FROM teaching_activity_events e
       JOIN teaching_submissions s ON s.id = e.submission_id
       WHERE s.participant_id = ?
       ORDER BY e.rowid`
    )
    .all(participantId) as ActivityRow[];
}

function allValues(prefix: string): TeachingAnswers {
  return Object.fromEntries(
    TEACHING_FIELDS.map((field) => [field.key, { value: `${prefix} ${field.key}` }])
  );
}

const db = getTeachingDb();
const { participantId, projectId } = joinDefaultTeachingExperiment("Activity Student");
const [roundOne, roundTwo] = submissions(db, participantId);

assert.deepEqual(recordTeachingHeartbeat(participantId, {
  eventId: "hb-1", roundNo: 1, clientAt: "2026-08-09T00:00:15.000Z", activeDeltaSeconds: 15, visible: true
}), { activeSeconds: 15 });
assert.deepEqual(recordTeachingHeartbeat(participantId, {
  eventId: "hb-1", roundNo: 1, clientAt: "2026-08-09T00:00:15.000Z", activeDeltaSeconds: 15, visible: true
}), { activeSeconds: 15 }, "duplicate heartbeat must not double count");
assert.equal(recordTeachingHeartbeat(participantId, {
  eventId: "hb-2", roundNo: 1, clientAt: "2026-08-09T00:00:30.000Z", activeDeltaSeconds: 99, visible: true
}).activeSeconds, 35, "server caps each heartbeat at 20 seconds");
assert.equal(recordTeachingHeartbeat(participantId, {
  eventId: "hb-3", roundNo: 1, clientAt: "2026-08-09T00:00:45.000Z", activeDeltaSeconds: 15, visible: false
}).activeSeconds, 35);

assert.deepEqual(
  submissions(db, participantId).map(({ id, activeSeconds }) => ({ id, activeSeconds })),
  [
    { id: roundOne.id, activeSeconds: 35 },
    { id: roundTwo.id, activeSeconds: 0 },
  ],
  "heartbeats must update only the earliest current round"
);

assert.equal(
  recordTeachingHeartbeat(participantId, {
    eventId: "edit-1",
    roundNo: 1,
    clientAt: "2026-08-09T00:01:00.000Z",
    activeDeltaSeconds: 4,
    visible: true,
    fieldKey: "cation",
  }).activeSeconds,
  39
);
assert.equal(
  recordTeachingHeartbeat(participantId, {
    eventId: "edit-1",
    roundNo: 1,
    clientAt: "2026-08-09T00:01:20.000Z",
    activeDeltaSeconds: 20,
    visible: true,
    fieldKey: "anion",
  }).activeSeconds,
  39,
  "duplicate edit events must not double count or replace the first event"
);

const sensitivePayload: TeachingHeartbeatInput & {
  answerText: string;
  clipboard: string;
  evidence: string;
  pdfContent: string;
} = {
  eventId: "hb-safe-metadata",
  roundNo: 1 as const,
  clientAt: "2026-08-09T00:01:25.000Z",
  activeDeltaSeconds: 0,
  visible: true,
  answerText: "SECRET_ANSWER_TEXT",
  clipboard: "SECRET_CLIPBOARD_TEXT",
  evidence: "SECRET_EVIDENCE_TEXT",
  pdfContent: "SECRET_PDF_CONTENT",
};
assert.equal(
  recordTeachingHeartbeat(participantId, sensitivePayload).activeSeconds,
  39
);

const storedEvents = activityRows(db, participantId);
assert.deepEqual(
  storedEvents.map((event) => ({
    id: event.id,
    submissionId: event.submissionId,
    eventType: event.eventType,
    fieldKey: event.fieldKey,
    clientAt: event.clientAt,
    activeDeltaSeconds: event.activeDeltaSeconds,
  })),
  [
    {
      id: "hb-1",
      submissionId: roundOne.id,
      eventType: "heartbeat",
      fieldKey: null,
      clientAt: "2026-08-09T00:00:15.000Z",
      activeDeltaSeconds: 15,
    },
    {
      id: "hb-2",
      submissionId: roundOne.id,
      eventType: "heartbeat",
      fieldKey: null,
      clientAt: "2026-08-09T00:00:30.000Z",
      activeDeltaSeconds: 20,
    },
    {
      id: "hb-3",
      submissionId: roundOne.id,
      eventType: "heartbeat",
      fieldKey: null,
      clientAt: "2026-08-09T00:00:45.000Z",
      activeDeltaSeconds: 0,
    },
    {
      id: "edit-1",
      submissionId: roundOne.id,
      eventType: "edit",
      fieldKey: "cation",
      clientAt: "2026-08-09T00:01:00.000Z",
      activeDeltaSeconds: 4,
    },
    {
      id: "hb-safe-metadata",
      submissionId: roundOne.id,
      eventType: "heartbeat",
      fieldKey: null,
      clientAt: "2026-08-09T00:01:25.000Z",
      activeDeltaSeconds: 0,
    },
  ]
);
assert.equal(storedEvents.every((event) => Number.isFinite(Date.parse(event.receivedAt))), true);
for (const event of storedEvents) {
  const metadata = JSON.parse(event.metadataJson) as Record<string, unknown>;
  assert.equal(
    Object.keys(metadata).every((key) => key === "visible"),
    true,
    "activity metadata may contain only safe mechanics"
  );
  assert.equal(typeof metadata.visible, "boolean");
  assert.doesNotMatch(
    event.metadataJson,
    /SECRET_(?:ANSWER|CLIPBOARD|EVIDENCE|PDF)/,
    "activity metadata must never contain answers, clipboard, evidence, or PDF content"
  );
}

const validEventCount = storedEvents.length;
const activeSecondsBeforeInvalidInput = submissions(db, participantId)[0].activeSeconds;
for (const eventId of ["", "contains space", "unsafe/slash", "x".repeat(129)]) {
  assert.throws(
    () => recordTeachingHeartbeat(participantId, {
      eventId,
      roundNo: 1,
      clientAt: "2026-08-09T00:02:00.000Z",
      activeDeltaSeconds: 1,
      visible: true,
    }),
    /event|id|invalid/i
  );
}
for (const clientAt of ["", "not-a-date", "2026-02-30T00:00:00.000Z"]) {
  assert.throws(
    () => recordTeachingHeartbeat(participantId, {
      eventId: `bad-date-${clientAt.length}`,
      roundNo: 1,
      clientAt,
      activeDeltaSeconds: 1,
      visible: true,
    }),
    /client|timestamp|date|invalid/i
  );
}
for (const activeDeltaSeconds of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
  assert.throws(
    () => recordTeachingHeartbeat(participantId, {
      eventId: `bad-delta-${String(activeDeltaSeconds)}`,
      roundNo: 1,
      clientAt: "2026-08-09T00:02:00.000Z",
      activeDeltaSeconds,
      visible: true,
    }),
    /delta|seconds|integer|invalid/i
  );
}
for (const [index, roundNo] of [0, 3, 1.5, "1", undefined, null].entries()) {
  assert.throws(
    () => recordTeachingHeartbeat(participantId, {
      eventId: `bad-round-${index}`,
      roundNo: roundNo as TeachingHeartbeatInput["roundNo"],
      clientAt: "2026-08-09T00:02:00.000Z",
      activeDeltaSeconds: 1,
      visible: true,
    }),
    /round number must be 1 or 2/i
  );
}
assert.throws(
  () => recordTeachingHeartbeat(participantId, {
    eventId: "bad-visible",
    roundNo: 1,
    clientAt: "2026-08-09T00:02:00.000Z",
    activeDeltaSeconds: 1,
    visible: "true" as unknown as boolean,
  }),
  /visible|boolean|invalid/i
);
assert.throws(
  () => recordTeachingHeartbeat(participantId, {
    eventId: "bad-field",
    roundNo: 1,
    clientAt: "2026-08-09T00:02:00.000Z",
    activeDeltaSeconds: 1,
    visible: true,
    fieldKey: "clipboard" as TeachingFieldKey,
  }),
  /field|invalid/i
);
assert.equal(activityRows(db, participantId).length, validEventCount);
assert.equal(submissions(db, participantId)[0].activeSeconds, activeSecondsBeforeInvalidInput);

const submitted = joinDefaultTeachingExperiment("Submitted Activity Student");
db.prepare(
  `UPDATE teaching_submissions
   SET submitted_at = '2026-08-09T00:03:00.000Z'
   WHERE participant_id = ?`
).run(submitted.participantId);
assert.throws(
  () => recordTeachingHeartbeat(submitted.participantId, {
    eventId: "submitted-heartbeat",
    roundNo: 1,
    clientAt: "2026-08-09T00:03:01.000Z",
    activeDeltaSeconds: 1,
    visible: true,
  }),
  /active|locked|submitted|round/i
);

const completed = joinDefaultTeachingExperiment("Completed Activity Student");
db.prepare(
  `UPDATE teaching_participants
   SET completed_at = '2026-08-09T00:04:00.000Z'
   WHERE id = ?`
).run(completed.participantId);
assert.throws(
  () => recordTeachingHeartbeat(completed.participantId, {
    eventId: "completed-heartbeat",
    roundNo: 1,
    clientAt: "2026-08-09T00:04:01.000Z",
    activeDeltaSeconds: 1,
    visible: true,
  }),
  /complete|locked/i
);
assert.throws(
  () => recordTeachingHeartbeat("unknown-participant", {
    eventId: "unknown-heartbeat",
    roundNo: 1,
    clientAt: "2026-08-09T00:05:00.000Z",
    activeDeltaSeconds: 1,
    visible: true,
  }),
  /participant|found/i
);

const legacyTimestamp = "2026-08-09T00:06:00.000Z";
db.prepare(
  `INSERT INTO teaching_projects
   (id, name, invite_code, fields_json, created_at)
   VALUES ('legacy-activity-project', 'Legacy activity', 'LEGACY-ACTIVITY', '[]', ?)`
).run(legacyTimestamp);
db.prepare(
  `INSERT INTO teaching_papers
   (id, project_id, paper_no, title, ai_snapshot_json, created_at)
   VALUES ('legacy-activity-paper', 'legacy-activity-project', 'L', 'Legacy paper', '{}', ?)`
).run(legacyTimestamp);
db.prepare(
  `INSERT INTO teaching_participants
   (id, project_id, group_code, student_alias, assigned_paper_id, created_at)
   VALUES ('legacy-activity-participant', 'legacy-activity-project', 'legacy',
           'Legacy activity student', 'legacy-activity-paper', ?)`
).run(legacyTimestamp);
db.prepare(
  `INSERT INTO teaching_submissions
   (id, project_id, paper_id, participant_id, started_at, answers_json, updated_at)
   VALUES ('legacy-activity-submission', 'legacy-activity-project', 'legacy-activity-paper',
           'legacy-activity-participant', ?, '{}', ?)`
).run(legacyTimestamp, legacyTimestamp);
assert.throws(
  () => recordTeachingHeartbeat("legacy-activity-participant", {
    eventId: "legacy-heartbeat",
    roundNo: 1,
    clientAt: "2026-08-09T00:06:01.000Z",
    activeDeltaSeconds: 20,
    visible: true,
  }),
  /participant|default|legacy|found/i
);
assert.equal(
  db.prepare(
    "SELECT active_seconds FROM teaching_submissions WHERE id = 'legacy-activity-submission'"
  ).pluck().get(),
  0
);
assert.equal(
  db.prepare(
    "SELECT COUNT(*) FROM teaching_activity_events WHERE submission_id = 'legacy-activity-submission'"
  ).pluck().get(),
  0
);

db.prepare("UPDATE teaching_projects SET experiment_kind = 'legacy' WHERE id = ?").run(projectId);
assert.throws(
  () => recordTeachingHeartbeat(participantId, {
    eventId: "wrong-experiment-kind",
    roundNo: 1,
    clientAt: "2026-08-09T00:07:00.000Z",
    activeDeltaSeconds: 7,
    visible: true,
  }),
  /participant|crossover|default|found/i,
  "only the default crossover experiment may receive activity"
);
assert.equal(activityRows(db, participantId).length, validEventCount);
assert.equal(submissions(db, participantId)[0].activeSeconds, activeSecondsBeforeInvalidInput);
db.prepare("UPDATE teaching_projects SET experiment_kind = 'crossover' WHERE id = ?").run(projectId);

const future = joinDefaultTeachingExperiment("Future Round Activity Student");
assert.throws(
  () => recordTeachingHeartbeat(future.participantId, {
    eventId: "future-round-two-heartbeat",
    roundNo: 2,
    clientAt: "2026-08-09T00:07:30.000Z",
    activeDeltaSeconds: 7,
    visible: true,
  }),
  /active|locked|round/i,
  "round 2 must not receive activity while round 1 is still active"
);
assert.deepEqual(
  submissions(db, future.participantId).map(({ roundNo, activeSeconds }) => ({
    roundNo,
    activeSeconds,
  })),
  [
    { roundNo: 1, activeSeconds: 0 },
    { roundNo: 2, activeSeconds: 0 },
  ]
);
assert.equal(activityRows(db, future.participantId).length, 0);

const delayed = joinDefaultTeachingExperiment("Delayed Round One Activity Student");
const delayedRoundOneState = getCurrentTeachingRound(delayed.participantId);
assert.ok(delayedRoundOneState && delayedRoundOneState.status === "active");
assert.equal(delayedRoundOneState.roundNo, 1);
const delayedRoundOneClientAt = new Date(Date.now() - 60_000).toISOString();
saveCurrentTeachingDraft(
  delayed.participantId,
  delayedRoundOneState.version,
  allValues("delayed-round-one")
);
assert.deepEqual(
  submitCurrentTeachingRound(delayed.participantId),
  { status: "next_round", roundNo: 2 }
);
assert.deepEqual(
  submissions(db, delayed.participantId).map(({ roundNo, activeSeconds }) => ({
    roundNo,
    activeSeconds,
  })),
  [
    { roundNo: 1, activeSeconds: 0 },
    { roundNo: 2, activeSeconds: 0 },
  ]
);
assert.throws(
  () => recordTeachingHeartbeat(delayed.participantId, {
    eventId: "late-round-one-heartbeat",
    roundNo: 1,
    clientAt: delayedRoundOneClientAt,
    activeDeltaSeconds: 6,
    visible: true,
  }),
  /active|locked|submitted|round/i,
  "a delayed round 1 heartbeat must not drift into active round 2"
);
assert.equal(submissions(db, delayed.participantId)[1].activeSeconds, 0);
assert.equal(activityRows(db, delayed.participantId).length, 0);
assert.deepEqual(
  recordTeachingHeartbeat(delayed.participantId, {
    eventId: "round-two-heartbeat",
    roundNo: 2,
    clientAt: "2026-08-09T00:08:00.000Z",
    activeDeltaSeconds: 6,
    visible: true,
  }),
  { activeSeconds: 6 }
);
assert.deepEqual(
  submissions(db, delayed.participantId).map(({ roundNo, activeSeconds }) => ({
    roundNo,
    activeSeconds,
  })),
  [
    { roundNo: 1, activeSeconds: 0 },
    { roundNo: 2, activeSeconds: 6 },
  ]
);

assert.equal(teachingTimingQuality(0, 0), "zero_active");
assert.equal(teachingTimingQuality(0, 3_600), "zero_active");
assert.equal(teachingTimingQuality(239, 1_199), "valid");
assert.equal(teachingTimingQuality(240, 1_200), "valid");
assert.equal(teachingTimingQuality(239, 1_200), "excessive_idle");
assert.equal(teachingTimingQuality(1, 1_200), "excessive_idle");
assert.equal(teachingTimingQuality(300, 1_499), "valid");

closeTeachingStoreForTests();
console.log("Teaching active-time heartbeat tests passed");
