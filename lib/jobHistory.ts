import type { JobEvent, JobHistoryDuration, JobHistorySummary, JobStatus } from "./schema";

type FirstEvents = Partial<Record<JobStatus, JobEvent>>;

function timestamp(value: string): number | null {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function duration(start: JobEvent | undefined, end: JobEvent | undefined): number | null {
  if (!start || !end) return null;
  const startMs = timestamp(start.occurredAt);
  const endMs = timestamp(end.occurredAt);
  if (startMs == null || endMs == null || endMs < startMs) return null;
  return endMs - startMs;
}

function summarizeDurations(values: number[]): JobHistoryDuration {
  if (!values.length) return { medianMs: null, sampleSize: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const medianMs =
    sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  return { medianMs, sampleSize: sorted.length };
}

function eventRecordCount(event: JobEvent | undefined): number {
  return event && Number.isFinite(event.recordCount) ? Math.max(0, event.recordCount) : 0;
}

/**
 * Summarize the append-only job event stream without inventing legacy history.
 * Only jobs with a queued event belong to the tracked cohort. For every status,
 * the lowest event id is the canonical first transition, regardless of input
 * order or later duplicate events.
 */
export function summarizeJobEvents(events: JobEvent[]): JobHistorySummary {
  const byJob = new Map<string, FirstEvents>();
  const ordered = [...events].sort((a, b) => a.eventId - b.eventId);

  for (const event of ordered) {
    const first = byJob.get(event.jobId) ?? {};
    if (!first[event.status]) first[event.status] = event;
    byJob.set(event.jobId, first);
  }

  let receivedJobs = 0;
  let startedJobs = 0;
  let candidateJobs = 0;
  let failedJobs = 0;
  let committedJobs = 0;
  let candidateRecords = 0;
  let committedRecords = 0;
  let trackedSince: { value: string; ms: number } | null = null;
  const queueDurations: number[] = [];
  const extractionDurations: number[] = [];
  const reviewWaitDurations: number[] = [];

  for (const first of byJob.values()) {
    const queued = first.queued;
    if (!queued) continue;

    receivedJobs += 1;
    if (first.extracting) startedJobs += 1;
    if (first.done) candidateJobs += 1;
    if (first.error) failedJobs += 1;
    if (first.committed) committedJobs += 1;
    candidateRecords += eventRecordCount(first.done);
    committedRecords += eventRecordCount(first.committed);

    const queuedMs = timestamp(queued.occurredAt);
    if (queuedMs != null && (!trackedSince || queuedMs < trackedSince.ms)) {
      trackedSince = { value: queued.occurredAt, ms: queuedMs };
    }

    const queueMs = duration(queued, first.extracting);
    if (queueMs != null) queueDurations.push(queueMs);

    const terminal = [first.done, first.error]
      .filter((event): event is JobEvent => Boolean(event))
      .map((event) => ({ event, ms: timestamp(event.occurredAt) }))
      .filter((entry): entry is { event: JobEvent; ms: number } => entry.ms != null)
      .sort((a, b) => a.ms - b.ms)[0]?.event;
    const extractionMs = duration(first.extracting, terminal);
    if (extractionMs != null) extractionDurations.push(extractionMs);

    const reviewWaitMs = duration(first.done, first.committed);
    if (reviewWaitMs != null) reviewWaitDurations.push(reviewWaitMs);
  }

  return {
    trackedSince: trackedSince?.value ?? null,
    receivedJobs,
    startedJobs,
    candidateJobs,
    failedJobs,
    committedJobs,
    candidateRecords,
    committedRecords,
    queue: summarizeDurations(queueDurations),
    extraction: summarizeDurations(extractionDurations),
    reviewWait: summarizeDurations(reviewWaitDurations),
  };
}
