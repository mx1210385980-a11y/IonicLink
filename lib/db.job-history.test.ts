import assert from "node:assert/strict";
import {
  claimNextJob,
  clearFinishedJobs,
  commitJob,
  createJobs,
  deleteJob,
  deleteRecords,
  getJob,
  getJobHistorySummary,
  listRecords,
  updateJob,
} from "./db";
import { ingest } from "./ingest";

const draft = ingest({
  paper: { title: "__JOB_HISTORY_TEST__" },
  cation: "[BMIM]",
  anion: "[PF6]",
  substrate: "mica",
  temperature: "25 °C",
  load: "5 nN",
  cof: 0.1,
  scale: "nano",
});

const [queued] = createJobs("tribology", [
  { filename: "history-test.pdf", text: "test source text" },
]);
assert.equal(queued.status, "queued");
assert.equal(queued.startedAt, undefined);
assert.equal(queued.completedAt, undefined);
assert.equal(queued.committedAt, undefined);

const claimed = claimNextJob("tribology");
assert.ok(claimed);
assert.equal(claimed.job.id, queued.id);
assert.equal(claimed.job.status, "extracting");
assert.match(claimed.job.startedAt ?? "", /^\d{4}-\d{2}-\d{2}T/);

const done = updateJob("tribology", queued.id, {
  status: "done",
  candidates: [draft],
  recordCount: 1,
  source: "anthropic",
  model: "history-test-model",
});
assert.ok(done);
assert.equal(done.status, "done");
assert.equal(done.startedAt, claimed.job.startedAt);
assert.match(done.completedAt ?? "", /^\d{4}-\d{2}-\d{2}T/);

const committed = commitJob("tribology", queued.id);
if (!("created" in committed)) throw new Error(committed.error);
assert.ok("created" in committed);
assert.equal(committed.created, 1);
assert.equal(committed.job.status, "committed");
assert.equal(committed.job.startedAt, claimed.job.startedAt);
assert.equal(committed.job.completedAt, done.completedAt);
assert.match(committed.job.committedAt ?? "", /^\d{4}-\d{2}-\d{2}T/);

const history = getJobHistorySummary("tribology");
assert.equal(history.trackedSince, queued.createdAt);
assert.deepEqual(
  {
    receivedJobs: history.receivedJobs,
    startedJobs: history.startedJobs,
    candidateJobs: history.candidateJobs,
    failedJobs: history.failedJobs,
    committedJobs: history.committedJobs,
    candidateRecords: history.candidateRecords,
    committedRecords: history.committedRecords,
  },
  {
    receivedJobs: 1,
    startedJobs: 1,
    candidateJobs: 1,
    failedJobs: 0,
    committedJobs: 1,
    candidateRecords: 1,
    committedRecords: 1,
  }
);
for (const metric of [history.queue, history.extraction, history.reviewWait]) {
  assert.equal(metric.sampleSize, 1);
  assert.ok(metric.medianMs != null && metric.medianMs >= 0);
}

assert.equal(clearFinishedJobs("tribology"), 1);
assert.equal(getJob("tribology", queued.id), null);
assert.deepEqual(
  getJobHistorySummary("tribology"),
  history,
  "clearing finished jobs must preserve the append-only history"
);

const [deletedQueued] = createJobs("tribology", [
  { filename: "deleted-history-test.pdf", text: "test source text" },
]);
const beforeDelete = getJobHistorySummary("tribology");
assert.equal(deleteJob("tribology", deletedQueued.id), 1);
assert.deepEqual(
  getJobHistorySummary("tribology"),
  beforeDelete,
  "deleting a job must preserve its append-only events"
);

deleteRecords(
  "tribology",
  listRecords("tribology", { search: "__JOB_HISTORY_TEST__" }).map((record) => record.id)
);

console.log("DB job history tests passed");
