import assert from "node:assert/strict";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { BatchJob, JobHistorySummary, JobStatus } from "../lib/schema";
import {
  commitAllIssueMessage,
  CommittedJobsNotice,
  filterExtractionJobs,
  formatDuration,
  HistoryProgress,
  jobHistoryFromPayload,
  jobMatchesFileFilter,
  mutationRefreshFailureMessage,
  QueueProgress,
  queueRefreshIsCurrent,
  SkipNotice,
  summarizeQueue,
  type SkippedFile,
} from "./Extractor";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const noop = () => {};
const one: SkippedFile[] = [
  { filename: "renamed-reupload.pdf", reason: 'already uploaded as "original.pdf" on 2026-06-09 (DOI 10.1021/x)' },
];

const html = renderToStaticMarkup(createElement(SkipNotice, { skipped: one, onDismiss: noop }));
assert.match(html, /role="status"/, "announced politely to assistive tech");
assert.match(html, /data-testid="skip-notice"/);
assert.match(html, /1 file skipped/);
assert.match(html, /renamed-reupload\.pdf/);
assert.match(html, /already uploaded as/);
assert.match(html, /opacity-100/, "renders visible before the countdown elapses");
assert.match(html, /transition-opacity/, "fade-out is a CSS opacity transition");
assert.match(html, /aria-label="Dismiss"/, "manually dismissible");
assert.match(html, /title="renamed-reupload\.pdf — already uploaded as/, "full detail available on hover");

const many: SkippedFile[] = Array.from({ length: 5 }, (_, i) => ({
  filename: `paper-${i}.pdf`,
  reason: "no readable text",
}));
const manyHtml = renderToStaticMarkup(createElement(SkipNotice, { skipped: many, onDismiss: noop }));
assert.match(manyHtml, /5 files skipped/);
assert.match(manyHtml, /paper-2\.pdf/, "first rows listed");
assert.doesNotMatch(manyHtml, /paper-4\.pdf/, "long lists are capped");
assert.match(manyHtml, /\+2 more/, "overflow is summarized");

const committedHtml = renderToStaticMarkup(createElement(CommittedJobsNotice, { domain: "tribology" }));
assert.match(committedHtml, /Review Queue/);
assert.match(
  committedHtml,
  /href="\/tribology\/database\?status=review"/,
  "committed candidates link directly to the review queue rather than the default official tab"
);

assert.equal(queueRefreshIsCurrent(4, 4, false, "tribology", "tribology"), true);
assert.equal(queueRefreshIsCurrent(3, 4, false, "tribology", "tribology"), false, "older responses are stale");
assert.equal(queueRefreshIsCurrent(4, 4, true, "tribology", "tribology"), false, "aborted responses are stale");
assert.equal(queueRefreshIsCurrent(4, 4, false, "tribology", "diffusion"), false, "domain changes invalidate responses");

const refreshFailure = mutationRefreshFailureMessage("The text was added to the queue", new Error("offline"));
assert.match(refreshFailure, /text was added to the queue/);
assert.match(refreshFailure, /write already succeeded/);
assert.match(refreshFailure, /do not repeat it/);
assert.doesNotMatch(refreshFailure, /Could not add the text/);

const partialAndStale = commitAllIssueMessage({
  committed: 2,
  failed: 1,
  failureDetail: "paper-c.pdf was rejected",
  refreshError: new Error("offline"),
});
assert.match(partialAndStale ?? "", /2 committed; 1 failed/);
assert.match(partialAndStale ?? "", /paper-c\.pdf was rejected/);
assert.match(partialAndStale ?? "", /2 successful commits are already complete/);
assert.match(partialAndStale ?? "", /Do not repeat successful commits/);
assert.equal(commitAllIssueMessage({ committed: 3, failed: 0 }), null);

function job(status: JobStatus, id: string = status): BatchJob {
  return {
    id,
    filename: `${id}.pdf`,
    status,
    createdAt: "2026-07-11T00:00:00.000Z",
    recordCount: 0,
    candidates: [],
    error: status === "error" ? "model unavailable" : null,
  };
}

const statuses: JobStatus[] = ["queued", "extracting", "done", "error", "committed"];
for (const status of statuses) {
  const oneStatus = summarizeQueue([job(status)]);
  assert.equal(oneStatus[status], 1, `${status} is counted in its exact queue bucket`);
  assert.equal(Object.values(oneStatus).reduce((sum, count) => sum + count, 0), 1, `${status} is counted once`);
}

const queueSummary = summarizeQueue([
  job("queued"),
  job("extracting"),
  job("done"),
  job("error", "error-1"),
  job("error", "error-2"),
  job("committed"),
]);
assert.deepEqual(queueSummary, { queued: 1, extracting: 1, done: 1, error: 2, committed: 1 });

assert.equal(jobMatchesFileFilter("queued", "analyzing"), true);
assert.equal(jobMatchesFileFilter("extracting", "analyzing"), true);
assert.equal(jobMatchesFileFilter("done", "finished"), true);
assert.equal(jobMatchesFileFilter("committed", "finished"), true);
assert.equal(jobMatchesFileFilter("error", "error"), true);
assert.equal(jobMatchesFileFilter("error", "finished"), false);
const searchableJobs = [
  { ...job("done", "alpha-paper"), filename: "Alpha friction.pdf", model: "model-one" },
  { ...job("error", "beta-paper"), filename: "Beta conductivity.pdf", error: "provider timeout" },
];
assert.deepEqual(filterExtractionJobs(searchableJobs, "all", "friction").map((item) => item.id), ["alpha-paper"]);
assert.deepEqual(filterExtractionJobs(searchableJobs, "all", "TIMEOUT").map((item) => item.id), ["beta-paper"]);
assert.deepEqual(filterExtractionJobs(searchableJobs, "finished", "model-one").map((item) => item.id), ["alpha-paper"]);

const emptyQueueHtml = renderToStaticMarkup(
  createElement(QueueProgress, { jobs: [], draining: false, concurrency: 2 })
);
assert.match(emptyQueueHtml, /data-testid="queue-progress"/);
for (const label of ["Queued", "Extracting", "Ready to review", "Errors", "Committed"]) {
  assert.match(emptyQueueHtml, new RegExp(`aria-label="${label}: 0"`), `${label} remains visible at zero`);
}
assert.match(emptyQueueHtml, /Queue is clear/);

const activeQueueHtml = renderToStaticMarkup(
  createElement(QueueProgress, {
    jobs: [job("queued"), job("extracting"), job("error", "error-1"), job("error", "error-2")],
    draining: true,
    concurrency: 3,
  })
);
assert.match(activeQueueHtml, /aria-label="Queued: 1"/);
assert.match(activeQueueHtml, /aria-label="Extracting: 1"/);
assert.match(activeQueueHtml, /aria-label="Errors: 2"/, "error count is visible in the queue progress view");
assert.match(activeQueueHtml, /up to 3 jobs at once/);
assert.doesNotMatch(activeQueueHtml, /%|ETA/i, "queue progress does not invent percentages or an ETA");

assert.equal(formatDuration(420), "420 ms", "sub-second durations stay in milliseconds");
assert.equal(formatDuration(2500), "2.5 s", "short durations use seconds");
assert.equal(formatDuration(65_000), "1m 5s", "minute durations retain useful seconds");
assert.equal(formatDuration(3_900_000), "1h 5m", "long durations use hours and minutes");
assert.equal(formatDuration(Number.NaN), "—", "invalid durations are not presented as measurements");

const emptyHistory = jobHistoryFromPayload(undefined);
assert.deepEqual(
  emptyHistory,
  {
    trackedSince: null,
    receivedJobs: 0,
    startedJobs: 0,
    candidateJobs: 0,
    failedJobs: 0,
    committedJobs: 0,
    candidateRecords: 0,
    committedRecords: 0,
    queue: { medianMs: null, sampleSize: 0 },
    extraction: { medianMs: null, sampleSize: 0 },
    reviewWait: { medianMs: null, sampleSize: 0 },
  },
  "an API payload without history falls back to an explicit empty summary"
);
assert.equal(jobHistoryFromPayload(null), emptyHistory, "an explicit null history uses the same compatibility fallback");
const emptyHistoryHtml = renderToStaticMarkup(createElement(HistoryProgress, { history: emptyHistory }));
assert.match(emptyHistoryHtml, /aria-label="Extraction history"/);
assert.match(emptyHistoryHtml, /History starts with the next queued job/);
assert.match(emptyHistoryHtml, /Legacy completion times are not backfilled/);
assert.doesNotMatch(emptyHistoryHtml, /Tracked since/);

const fullHistory: JobHistorySummary = {
  trackedSince: "2026-07-11T04:05:06.000Z",
  receivedJobs: 12,
  startedJobs: 10,
  candidateJobs: 8,
  failedJobs: 2,
  committedJobs: 6,
  candidateRecords: 21,
  committedRecords: 15,
  queue: { medianMs: 420, sampleSize: 10 },
  extraction: { medianMs: 65_000, sampleSize: 8 },
  reviewWait: { medianMs: 3_900_000, sampleSize: 6 },
};
assert.equal(jobHistoryFromPayload(fullHistory), fullHistory, "an API history summary is preserved");
const fullHistoryHtml = renderToStaticMarkup(createElement(HistoryProgress, { history: fullHistory }));
assert.match(fullHistoryHtml, /Tracked since 2026-07-11/);
assert.match(fullHistoryHtml, /persists when finished jobs are cleared/);
assert.match(fullHistoryHtml, /aria-label="Historical job stage counts"/);
assert.match(fullHistoryHtml, /aria-label="Received: 12 jobs"/);
assert.match(fullHistoryHtml, /aria-label="Started: 10 jobs"/);
assert.match(fullHistoryHtml, /aria-label="Candidates: 8 jobs, 21 candidate records"/);
assert.match(fullHistoryHtml, /aria-label="Sent to review: 6 jobs, 15 committed records"/);
assert.match(fullHistoryHtml, /aria-label="Errors branch: 2 jobs"/, "errors are a distinct branch");
assert.match(fullHistoryHtml, /Median Queue wait/);
assert.match(fullHistoryHtml, /420 ms \(n=10\)/);
assert.match(fullHistoryHtml, /1m 5s \(n=8\)/);
assert.match(fullHistoryHtml, /1h 5m \(n=6\)/);
assert.doesNotMatch(fullHistoryHtml, /%|ETA/i, "history uses exact events and observed durations only");

const sparseHistoryHtml = renderToStaticMarkup(
  createElement(HistoryProgress, {
    history: {
      ...fullHistory,
      queue: { medianMs: null, sampleSize: 0 },
      extraction: { medianMs: null, sampleSize: 0 },
      reviewWait: { medianMs: null, sampleSize: 0 },
    },
  })
);
assert.doesNotMatch(sparseHistoryHtml, /Median Queue wait|Median Extraction|Median Review wait/);
const sampledWithoutMedianHtml = renderToStaticMarkup(
  createElement(HistoryProgress, {
    history: { ...fullHistory, queue: { medianMs: null, sampleSize: 2 } },
  })
);
assert.match(sampledWithoutMedianHtml, /Median Queue wait/);
assert.match(sampledWithoutMedianHtml, /— \(n=2\)/, "sample-size gating remains explicit when a median is unavailable");

console.log("Extractor tests passed");
