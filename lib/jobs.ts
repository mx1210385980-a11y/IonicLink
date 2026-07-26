import type { Domain } from "./domain";
import { claimNextJob, countQueuedJobs, updateJob } from "./db";
import { extractRecords } from "./extract";

/**
 * Concurrent processor for the per-domain PDF batch queue.
 *
 * Uploads land as `queued` job rows (with their extracted text) in the domain's
 * database. Up to EXTRACT_CONCURRENCY worker loops run in parallel PER DOMAIN,
 * each atomically claiming the next queued job (queued → extracting →
 * done/error) from that domain and extracting it with that domain's extractor.
 * Because `claimNextJob` is a synchronous SQLite transaction, concurrent workers
 * never grab the same job. The client polls job status.
 *
 * The active-worker count is tracked per domain, so a conductivity upload is
 * never processed by a worker draining the tribology queue (or vice versa).
 */

export function extractionConcurrency(): number {
  const n = Number(process.env.EXTRACT_CONCURRENCY);
  if (!Number.isFinite(n) || n < 1) return 4;
  return Math.min(16, Math.floor(n));
}

const activeWorkers = new Map<Domain, number>();

function setActive(domain: Domain, delta: number): number {
  const next = (activeWorkers.get(domain) ?? 0) + delta;
  activeWorkers.set(domain, next);
  return next;
}

/**
 * Spin up workers for one domain to match its pending work, bounded by the
 * concurrency cap. Sizing to (active + queued) avoids spawning workers that
 * would immediately find an empty queue and exit.
 */
export function kickDrain(domain: Domain): void {
  const cap = extractionConcurrency();
  const want = Math.min(cap, (activeWorkers.get(domain) ?? 0) + countQueuedJobs(domain));
  while ((activeWorkers.get(domain) ?? 0) < want) {
    setActive(domain, 1);
    void worker(domain).finally(() => {
      setActive(domain, -1);
    });
  }
}

export function isDraining(domain: Domain): boolean {
  return (activeWorkers.get(domain) ?? 0) > 0;
}

async function worker(domain: Domain): Promise<void> {
  for (;;) {
    const claimed = claimNextJob(domain);
    if (!claimed) return; // queue drained — this worker exits
    const { job, text } = claimed;
    try {
      const result = await extractRecords(domain, text, job.sourceId);
      updateJob(domain, job.id, {
        status: "done",
        candidates: result.records,
        recordCount: result.records.length,
        source: result.source,
        model: result.model,
        error: null,
      });
    } catch (err) {
      updateJob(domain, job.id, {
        status: "error",
        error: err instanceof Error ? err.message : "Extraction failed",
      });
    }
  }
}
