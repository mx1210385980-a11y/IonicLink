import assert from "node:assert/strict";
import { summarizeJobEvents } from "./jobHistory";
import type { JobEvent, JobStatus } from "./schema";

const event = (
  eventId: number,
  jobId: string,
  status: JobStatus,
  occurredAt: string,
  recordCount = 0
): JobEvent => ({ eventId, jobId, status, occurredAt, recordCount });

assert.deepEqual(summarizeJobEvents([]), {
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
});

const events = [
  event(1, "a", "queued", "2026-01-01T00:00:00.000Z"),
  event(2, "a", "extracting", "2026-01-01T00:00:01.000Z"),
  event(3, "a", "extracting", "2026-01-01T00:00:02.000Z"),
  event(4, "a", "done", "2026-01-01T00:00:05.000Z", 3),
  event(5, "a", "done", "2026-01-01T00:00:06.000Z", 99),
  event(6, "a", "committed", "2026-01-01T00:00:09.000Z", 2),
  event(10, "b", "queued", "2026-01-01T00:00:10.000Z"),
  event(11, "b", "extracting", "2026-01-01T00:00:14.000Z"),
  event(12, "b", "error", "2026-01-01T00:00:19.000Z"),
  // This cohort member has deliberately invalid negative elapsed times.
  event(20, "d", "queued", "2026-01-01T00:00:30.000Z"),
  event(21, "d", "extracting", "2026-01-01T00:00:29.000Z"),
  event(22, "d", "done", "2026-01-01T00:00:28.000Z", 1),
  event(23, "d", "committed", "2026-01-01T00:00:27.000Z", 1),
  // Both terminal events exist; extraction uses the earlier terminal event.
  event(40, "e", "queued", "2026-01-01T00:00:40.000Z"),
  event(41, "e", "extracting", "2026-01-01T00:00:41.000Z"),
  event(42, "e", "done", "2026-01-01T00:00:50.000Z", 5),
  event(43, "e", "error", "2026-01-01T00:00:43.000Z"),
  event(44, "e", "committed", "2026-01-01T00:00:52.000Z", 4),
  // No queued event: legacy/untracked history must not enter any metric.
  event(50, "legacy", "extracting", "2025-01-01T00:00:00.000Z"),
  event(51, "legacy", "done", "2025-01-01T00:00:01.000Z", 1000),
  // A later duplicate queued event cannot replace the first event for job a.
  event(60, "a", "queued", "2024-01-01T00:00:00.000Z"),
].reverse();

assert.deepEqual(summarizeJobEvents(events), {
  trackedSince: "2026-01-01T00:00:00.000Z",
  receivedJobs: 4,
  startedJobs: 4,
  candidateJobs: 3,
  failedJobs: 2,
  committedJobs: 3,
  candidateRecords: 9,
  committedRecords: 7,
  queue: { medianMs: 1000, sampleSize: 3 },
  extraction: { medianMs: 4000, sampleSize: 3 },
  reviewWait: { medianMs: 3000, sampleSize: 2 },
});

console.log("Job history summary tests passed");
