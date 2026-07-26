"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { getClientModule } from "@/components/registry.client";
import { RequestError, requestErrorMessage, requestJson } from "@/components/request";
import { DEFAULT_DOMAIN, type Domain } from "@/lib/domain";
import type { BatchJob, JobHistorySummary, JobStatus, RecordDraft } from "@/lib/schema";

type QueuePayload = {
  jobs: BatchJob[];
  draining: boolean;
  concurrency: number;
  history?: JobHistorySummary | null;
};

const EMPTY_JOB_HISTORY: JobHistorySummary = {
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
};

export function jobHistoryFromPayload(history?: JobHistorySummary | null): JobHistorySummary {
  return history ?? EMPTY_JOB_HISTORY;
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "\u2014";
  if (ms < 1000) return `${Math.round(ms)} ms`;

  const seconds = ms / 1000;
  if (seconds < 60) {
    const rounded = seconds < 10 ? Math.round(seconds * 10) / 10 : Math.round(seconds);
    return `${rounded} s`;
  }

  const totalSeconds = Math.round(seconds);
  if (totalSeconds < 3600) {
    const minutes = Math.floor(totalSeconds / 60);
    const remainingSeconds = totalSeconds % 60;
    return remainingSeconds ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
  }

  const hours = Math.floor(totalSeconds / 3600);
  const remainingMinutes = Math.floor((totalSeconds % 3600) / 60);
  return remainingMinutes ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}

const HISTORY_STAGES: readonly {
  key: "receivedJobs" | "startedJobs" | "candidateJobs" | "committedJobs";
  label: string;
  tone: string;
}[] = [
  { key: "receivedJobs", label: "Received", tone: "border-slate-200 bg-white text-ink-700" },
  { key: "startedJobs", label: "Started", tone: "border-amber-200 bg-amber-50 text-amber-800" },
  { key: "candidateJobs", label: "Candidates", tone: "border-brand-200 bg-brand-50 text-brand-800" },
  { key: "committedJobs", label: "Sent to review", tone: "border-violet-200 bg-violet-50 text-violet-800" },
];

const HISTORY_DURATIONS: readonly {
  key: "queue" | "extraction" | "reviewWait";
  label: string;
}[] = [
  { key: "queue", label: "Queue wait" },
  { key: "extraction", label: "Extraction" },
  { key: "reviewWait", label: "Review wait" },
];

export function HistoryProgress({ history }: { history: JobHistorySummary }) {
  const trackedDate = history.trackedSince?.slice(0, 10) ?? null;

  return (
    <section
      aria-label="Extraction history"
      data-testid="history-progress"
      className="border-b border-slate-100 bg-white px-5 py-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <div className="flex items-baseline gap-2">
          <h3 className="text-xs font-semibold text-ink-900">History</h3>
          <span className="font-mono text-[9px] uppercase tracking-wide text-ink-400">exact events</span>
        </div>
        {trackedDate && (
          <p className="text-[10px] text-ink-500">
            Tracked since {trackedDate} · persists when finished jobs are cleared
          </p>
        )}
      </div>

      {!trackedDate ? (
        <p role="status" className="mt-2 text-xs text-ink-700">
          History starts with the next queued job. Legacy completion times are not backfilled.
        </p>
      ) : (
        <>
          <div className="mt-2 overflow-x-auto pb-1">
            <div className="flex min-w-[42rem] gap-2">
              <ol aria-label="Historical job stage counts" className="grid flex-1 grid-cols-4 gap-2">
                {HISTORY_STAGES.map((stage) => {
                  const jobs = history[stage.key];
                  const records =
                    stage.key === "candidateJobs"
                      ? `${history.candidateRecords} candidate records`
                      : stage.key === "committedJobs"
                        ? `${history.committedRecords} committed records`
                        : null;
                  return (
                    <li
                      key={stage.key}
                      aria-label={`${stage.label}: ${jobs} jobs${records ? `, ${records}` : ""}`}
                      data-history-stage={stage.key}
                      className={`min-w-0 rounded-lg border px-3 py-2 ${stage.tone}`}
                    >
                      <span className="block truncate text-[10px] font-semibold uppercase tracking-wide">{stage.label}</span>
                      <span className="mt-0.5 block font-mono text-lg font-semibold tnum">{jobs}</span>
                      <span className="block text-[9px] opacity-80">{records ?? "jobs"}</span>
                    </li>
                  );
                })}
              </ol>
              <aside
                aria-label={`Errors branch: ${history.failedJobs} jobs`}
                data-history-branch="errors"
                className="w-28 shrink-0 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-rose-800"
              >
                <span className="block text-[10px] font-semibold uppercase tracking-wide">Errors</span>
                <span className="mt-0.5 block font-mono text-lg font-semibold tnum">{history.failedJobs}</span>
                <span className="block text-[9px] opacity-80">jobs · branch</span>
              </aside>
            </div>
          </div>

          <dl aria-label="Historical median durations" className="mt-2 flex flex-wrap gap-x-5 gap-y-1">
            {HISTORY_DURATIONS.map((metric) => {
              const duration = history[metric.key];
              if (duration.sampleSize <= 0) return null;
              const formatted = duration.medianMs === null ? "\u2014" : formatDuration(duration.medianMs);
              return (
                <div
                  key={metric.key}
                  role="group"
                  aria-label={`Median ${metric.label}: ${formatted}, sample size ${duration.sampleSize}`}
                  className="flex items-baseline gap-1.5 text-[10px]"
                >
                  <dt className="text-ink-500">Median {metric.label}</dt>
                  <dd className="font-mono font-semibold text-ink-800 tnum">
                    {formatted} (n={duration.sampleSize})
                  </dd>
                </div>
              );
            })}
          </dl>
        </>
      )}
    </section>
  );
}

export type QueueSummary = Record<JobStatus, number>;

export function summarizeQueue(jobs: readonly Pick<BatchJob, "status">[]): QueueSummary {
  const summary: QueueSummary = { queued: 0, extracting: 0, done: 0, error: 0, committed: 0 };
  for (const job of jobs) summary[job.status] += 1;
  return summary;
}

const QUEUE_PROGRESS_STAGES: readonly {
  status: JobStatus;
  label: string;
  tone: string;
}[] = [
  { status: "queued", label: "Queued", tone: "border-slate-200 bg-slate-50 text-ink-700" },
  { status: "extracting", label: "Extracting", tone: "border-amber-200 bg-amber-50 text-amber-800" },
  { status: "done", label: "Ready to review", tone: "border-brand-200 bg-brand-50 text-brand-800" },
  { status: "error", label: "Errors", tone: "border-rose-200 bg-rose-50 text-rose-800" },
  { status: "committed", label: "Committed", tone: "border-violet-200 bg-violet-50 text-violet-800" },
];

export function QueueProgress({
  jobs,
  draining,
  concurrency,
}: {
  jobs: readonly Pick<BatchJob, "status">[];
  draining: boolean;
  concurrency: number;
}) {
  const summary = summarizeQueue(jobs);
  const total = jobs.length;

  return (
    <section
      aria-label="Extraction queue progress"
      data-testid="queue-progress"
      className="border-b border-slate-100 bg-slate-50/35 px-5 py-3"
    >
      <div className="overflow-x-auto pb-1">
        <ol aria-label="Queue status counts" className="grid min-w-[38rem] grid-cols-5 gap-2">
          {QUEUE_PROGRESS_STAGES.map((stage) => (
            <li
              key={stage.status}
              aria-label={`${stage.label}: ${summary[stage.status]}`}
              data-queue-status={stage.status}
              className={`min-w-0 rounded-lg border px-3 py-2 ${stage.tone}`}
            >
              <span className="block truncate text-[10px] font-semibold uppercase tracking-wide">{stage.label}</span>
              <span className="mt-1 block font-mono text-xl font-semibold tnum">{summary[stage.status]}</span>
            </li>
          ))}
        </ol>
      </div>
      {total === 0 && (
        <p role="status" className="mt-2 text-xs text-ink-700">
          Queue is clear. Add PDFs or paste text to begin.
        </p>
      )}
      {draining && (
        <p role="status" className="mt-2 text-xs text-amber-800">
          Extracting with up to {Math.max(1, concurrency)} job{Math.max(1, concurrency) === 1 ? "" : "s"} at once. Time varies by paper and model.
        </p>
      )}
    </section>
  );
}

export type JobStageState = "done" | "current" | "pending" | "error";

const JOB_STAGE_LABELS = ["Received", "Extracting", "Candidates", "Review"] as const;
const JOB_STAGE_BY_STATUS: Record<JobStatus, readonly JobStageState[]> = {
  queued: ["current", "pending", "pending", "pending"],
  extracting: ["done", "current", "pending", "pending"],
  done: ["done", "done", "current", "pending"],
  committed: ["done", "done", "done", "current"],
  error: ["done", "error", "pending", "pending"],
};

export function jobStageStates(status: JobStatus): readonly JobStageState[] {
  return JOB_STAGE_BY_STATUS[status];
}

const JOB_STAGE_TONE: Record<JobStageState, string> = {
  done: "border-brand-300 bg-brand-100 text-brand-800",
  current: "border-amber-300 bg-amber-100 text-amber-900",
  pending: "border-slate-200 bg-white text-ink-400",
  error: "border-rose-300 bg-rose-100 text-rose-800",
};

const JOB_STAGE_A11Y: Record<JobStageState, string> = {
  done: "complete",
  current: "current",
  pending: "pending",
  error: "failed",
};

export function JobStageTrack({ status, filename }: { status: JobStatus; filename: string }) {
  const states = jobStageStates(status);
  return (
    <div
      role="group"
      aria-label={`${filename} progress`}
      data-testid="job-stage-track"
      className="px-5 pb-3"
    >
      <ol className="grid grid-cols-4 gap-1.5">
        {JOB_STAGE_LABELS.map((label, index) => {
          const state = states[index];
          return (
            <li
              key={label}
              aria-current={state === "current" ? "step" : undefined}
              aria-label={`${label}: ${JOB_STAGE_A11Y[state]}`}
              data-stage={label.toLowerCase()}
              data-state={state}
              className={`min-w-0 rounded-md border px-2 py-1 text-[10px] font-semibold ${JOB_STAGE_TONE[state]}`}
            >
              <span className="block truncate">{label}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export function queueRefreshIsCurrent(
  generation: number,
  currentGeneration: number,
  aborted: boolean,
  requestDomain: Domain,
  currentDomain: Domain
): boolean {
  return generation === currentGeneration && !aborted && requestDomain === currentDomain;
}

export function mutationRefreshFailureMessage(successDescription: string, error: unknown): string {
  const detail = requestErrorMessage(error, "Could not refresh the extraction queue.");
  return `${successDescription}, but the queue could not be refreshed. The write already succeeded; do not repeat it. ${detail}`;
}

export function commitAllIssueMessage({
  committed,
  failed,
  failureDetail,
  refreshError,
}: {
  committed: number;
  failed: number;
  failureDetail?: string;
  refreshError?: unknown;
}): string | null {
  const parts: string[] = [];
  if (failed > 0) {
    parts.push(
      `${committed} committed; ${failed} failed.${failureDetail ? ` ${failureDetail}` : ""}`
    );
  }
  if (refreshError) {
    const detail = requestErrorMessage(refreshError, "Could not refresh the extraction queue.");
    parts.push(
      committed > 0
        ? `${committed} successful commit${committed === 1 ? " is" : "s are"} already complete, but the queue could not be refreshed. Do not repeat successful commits. ${detail}`
        : `The queue also could not be refreshed. ${detail}`
    );
  }
  return parts.length ? parts.join(" ") : null;
}

/**
 * Unified extraction surface. Drop one or many PDFs (or paste text) — every
 * input becomes a background job in one queue. When a job finishes, its
 * candidates are individually reviewable: deselect any you don't want, then
 * commit just the selected ones to the Review Queue.
 */
export function Extractor({ domain = DEFAULT_DOMAIN }: { domain?: Domain }) {
  const Card = getClientModule(domain).Card;
  const [jobs, setJobs] = useState<BatchJob[]>([]);
  const [history, setHistory] = useState<JobHistorySummary>(EMPTY_JOB_HISTORY);
  const [draining, setDraining] = useState(false);
  const [concurrency, setConcurrency] = useState(1);
  const [busy, setBusy] = useState(false);
  const [processing, setProcessing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const [text, setText] = useState("");
  const [skipped, setSkipped] = useState<SkippedFile[] | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selection, setSelection] = useState<Record<string, Set<number>>>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshGenerationRef = useRef(0);
  const refreshRequestRef = useRef<AbortController | null>(null);
  const currentDomainRef = useRef(domain);
  currentDomainRef.current = domain;
  const dismissSkipped = useCallback(() => setSkipped(null), []);

  const refresh = useCallback(async () => {
    if (currentDomainRef.current !== domain) return null;
    const generation = refreshGenerationRef.current + 1;
    refreshGenerationRef.current = generation;
    refreshRequestRef.current?.abort();
    const controller = new AbortController();
    refreshRequestRef.current = controller;
    try {
      const data = await requestJson<QueuePayload>(
        `/api/${domain}/batch`,
        { signal: controller.signal },
        "Could not refresh the extraction queue"
      );
      if (
        !queueRefreshIsCurrent(
          generation,
          refreshGenerationRef.current,
          controller.signal.aborted,
          domain,
          currentDomainRef.current
        )
      ) return null;
      setJobs(data.jobs);
      setHistory(jobHistoryFromPayload(data.history));
      setDraining(data.draining);
      if (data.concurrency) setConcurrency(data.concurrency);
      return data;
    } catch (requestError) {
      if (
        !queueRefreshIsCurrent(
          generation,
          refreshGenerationRef.current,
          controller.signal.aborted,
          domain,
          currentDomainRef.current
        )
      ) return null;
      throw requestError;
    } finally {
      if (refreshRequestRef.current === controller) refreshRequestRef.current = null;
    }
  }, [domain]);

  useEffect(() => {
    refreshGenerationRef.current += 1;
    refreshRequestRef.current?.abort();
    refreshRequestRef.current = null;
    setJobs([]);
    setHistory(EMPTY_JOB_HISTORY);
    setDraining(false);
    setExpanded(new Set());
    setSelection({});
    return () => {
      refreshGenerationRef.current += 1;
      refreshRequestRef.current?.abort();
      refreshRequestRef.current = null;
    };
  }, [domain]);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      const data = await refresh().catch(() => null);
      if (!alive) return;
      const active =
        data && (data.draining || data.jobs.some((j) => j.status === "queued" || j.status === "extracting"));
      timer.current = setTimeout(tick, active ? 1200 : 5000);
    };
    tick();
    return () => {
      alive = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [refresh]);

  const uploadFiles = async (files: FileList | File[]) => {
    const list = Array.from(files);
    if (list.length === 0 || busy || processing) return;
    setBusy(true);
    setError(null);
    setSkipped(null);
    try {
      const form = new FormData();
      list.forEach((f) => form.append("files", f));
      const data = await requestJson<{ skipped?: SkippedFile[] }>(
        `/api/${domain}/batch`,
        { method: "POST", body: form },
        "Could not upload files"
      );
      setSkipped(data.skipped?.length ? data.skipped : null);
      try {
        await refresh();
      } catch (refreshError) {
        setError(mutationRefreshFailureMessage("The files were uploaded", refreshError));
      }
    } catch (requestError) {
      setError(requestErrorMessage(requestError, "Could not upload files. Please try again."));
    } finally {
      setBusy(false);
    }
  };

  const submitText = async () => {
    if (!text.trim() || busy || processing) return;
    setBusy(true);
    setError(null);
    setSkipped(null);
    try {
      const form = new FormData();
      form.append("text", text);
      await requestJson(
        `/api/${domain}/batch`,
        { method: "POST", body: form },
        "Could not add the text to the queue"
      );
      setText("");
      try {
        await refresh();
      } catch (refreshError) {
        setError(mutationRefreshFailureMessage("The text was added to the queue", refreshError));
      }
    } catch (requestError) {
      setError(requestErrorMessage(requestError, "Could not add the text to the queue. Please try again."));
    } finally {
      setBusy(false);
    }
  };

  const toggleExpand = (job: BatchJob) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(job.id)) {
        next.delete(job.id);
      } else {
        next.add(job.id);
        setSelection((s) =>
          s[job.id] ? s : { ...s, [job.id]: new Set(job.candidates.map((_, i) => i)) }
        );
      }
      return next;
    });

  const toggleCandidate = (jobId: string, idx: number, total: number) =>
    setSelection((prev) => {
      const cur = new Set(prev[jobId] ?? Array.from({ length: total }, (_, i) => i));
      cur.has(idx) ? cur.delete(idx) : cur.add(idx);
      return { ...prev, [jobId]: cur };
    });

  const setAll = (jobId: string, total: number, all: boolean) =>
    setSelection((prev) => ({ ...prev, [jobId]: new Set(all ? Array.from({ length: total }, (_, i) => i) : []) }));

  const runQueueAction = async (
    key: string,
    fallback: string,
    successDescription: string,
    action: () => Promise<void>,
    onSuccess?: () => void
  ) => {
    if (processing || busy) return;
    setProcessing(key);
    setError(null);
    try {
      try {
        await action();
      } catch (requestError) {
        setError(requestErrorMessage(requestError, fallback));
        return;
      }
      onSuccess?.();
      try {
        await refresh();
      } catch (refreshError) {
        setError(mutationRefreshFailureMessage(successDescription, refreshError));
      }
    } finally {
      setProcessing(null);
    }
  };

  const commit = async (job: BatchJob) => {
    const sel = selection[job.id] ?? new Set(job.candidates.map((_, i) => i));
    if (sel.size === 0) return;
    await runQueueAction(
      `commit:${job.id}`,
      "Could not commit this job. Please try again.",
      "The selected candidates were committed",
      async () => {
        await requestJson(
          `/api/${domain}/batch/${encodeURIComponent(job.id)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "commit", indices: [...sel] }),
          },
          "Could not commit this job"
        );
      },
      () => setExpanded((prev) => {
        const next = new Set(prev);
        next.delete(job.id);
        return next;
      })
    );
  };

  const commitAll = async () => {
    const done = jobs.filter((j) => j.status === "done");
    if (done.length === 0 || processing || busy) return;
    setProcessing("commit-all");
    setError(null);
    try {
      const results = await Promise.allSettled(
        done.map((job) =>
          requestJson(
            `/api/${domain}/batch/${encodeURIComponent(job.id)}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "commit" }),
            },
            `Could not commit ${job.filename}`
          )
        )
      );
      const failures = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
      const committed = results.length - failures.length;
      let refreshError: unknown;
      try {
        await refresh();
      } catch (error) {
        refreshError = error;
      }
      setError(
        commitAllIssueMessage({
          committed,
          failed: failures.length,
          failureDetail: failures.length
            ? requestErrorMessage(failures[0].reason, "One or more jobs failed.")
            : undefined,
          refreshError,
        })
      );
    } finally {
      setProcessing(null);
    }
  };

  const remove = async (id: string) => {
    await runQueueAction(
      `remove:${id}`,
      "Could not remove this job. Please try again.",
      "The job was removed",
      async () => {
        await requestJson(
          `/api/${domain}/batch/${encodeURIComponent(id)}`,
          { method: "DELETE" },
          "Could not remove this job"
        );
      }
    );
  };
  const clearFinished = async () => {
    await runQueueAction(
      "clear",
      "Could not clear finished jobs. Please try again.",
      "Finished jobs were cleared",
      async () => {
        await requestJson(`/api/${domain}/batch`, { method: "DELETE" }, "Could not clear finished jobs");
      }
    );
  };

  const counts = summarizeQueue(jobs);
  const clearableCount = counts.done + counts.error + counts.committed;

  return (
    <div className="space-y-6">
      {/* one input surface: files + text */}
      <div className="grid gap-6 lg:grid-cols-2">
        <label
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            uploadFiles(e.dataTransfer.files);
          }}
          className={`panel flex cursor-pointer flex-col items-center justify-center gap-3 p-10 text-center transition ${
            over ? "border-brand-400 bg-brand-50/50" : ""
          }`}
        >
          <span className="grid h-14 w-14 place-items-center rounded-2xl bg-brand-50 text-brand-600">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
              <path d="M12 16V4m0 0L8 8m4-4l4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </span>
          <div>
            <p className="font-medium text-ink-900">{busy ? "Uploading…" : "Drop one or many PDFs"}</p>
            <p className="text-xs text-ink-700">or click to browse · each is queued and processed in the background</p>
          </div>
          <input type="file" accept=".pdf,.txt" multiple className="hidden" disabled={busy || !!processing} onChange={(e) => e.target.files && uploadFiles(e.target.files)} />
        </label>

        <div className="panel flex flex-col p-4">
          <span className="label-eyebrow mb-2">Or paste paper text</span>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Paste an abstract, results section, or full text…"
            className="h-40 w-full resize-none rounded-xl border border-slate-200 bg-white p-3 text-sm outline-none focus:border-brand-300 focus:ring-2 focus:ring-brand-100"
          />
          <button onClick={submitText} disabled={busy || !!processing || !text.trim()} className="btn-primary mt-3 self-start">
            Add to queue
          </button>
        </div>
      </div>

      {error && <RequestError>{error}</RequestError>}
      {skipped && <SkipNotice skipped={skipped} onDismiss={dismissSkipped} />}

      <div className="panel overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-3">
          <div className="flex items-center gap-2 text-sm">
            <span className="font-semibold">Queue</span>
            <span className="font-mono text-[10px] text-ink-500">{jobs.length} current job{jobs.length === 1 ? "" : "s"}</span>
          </div>
          {jobs.length > 0 && (
            <div className="flex items-center gap-2">
              <button onClick={commitAll} disabled={counts.done === 0 || busy || !!processing} className="btn-primary px-3 py-1.5 text-xs">
                Commit all ready
              </button>
              <button onClick={clearFinished} disabled={clearableCount === 0 || busy || !!processing} className="btn px-3 py-1.5 text-xs">
                Clear finished
              </button>
            </div>
          )}
        </div>

        <QueueProgress jobs={jobs} draining={draining} concurrency={concurrency} />
        <HistoryProgress history={history} />

        {jobs.length > 0 && (
          <ul className="divide-y divide-slate-100">
            {jobs.map((job) => {
              const isOpen = expanded.has(job.id);
              const sel = selection[job.id];
              const selCount = sel ? sel.size : job.recordCount;
              return (
                <li key={job.id}>
                  <div className="flex flex-wrap items-center gap-3 px-5 py-3">
                    <FileIcon />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink-800">{job.filename}</span>
                    <StatusPill status={job.status} />
                    {job.status === "done" && (
                      <button
                        onClick={() => toggleExpand(job)}
                        className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-ink-700 hover:border-brand-300 hover:text-brand-700"
                      >
                        {isOpen ? "Hide" : `Review ${job.recordCount} candidate${job.recordCount === 1 ? "" : "s"}`}
                      </button>
                    )}
                    {job.status === "committed" && (
                      <span className="text-xs text-ink-700">{job.recordCount} sent to review</span>
                    )}
                    {job.status === "error" && (
                      <span className="max-w-xs truncate text-xs text-rose-600" title={job.error ?? ""}>
                        {job.error}
                      </span>
                    )}
                    <button
                      onClick={() => remove(job.id)}
                      disabled={busy || !!processing}
                      className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs text-ink-400 hover:border-rose-200 hover:text-rose-600"
                      aria-label="Remove job"
                    >
                      ✕
                    </button>
                  </div>

                  <JobStageTrack status={job.status} filename={job.filename} />

                  {isOpen && job.status === "done" && (
                    <div className="border-t border-slate-100 bg-slate-50/40 px-5 py-4">
                      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                        <span className="text-xs text-ink-700">
                          {selCount} of {job.candidates.length} selected
                          {job.model ? ` · ${job.model}` : ""}
                        </span>
                        {job.source === "mock" && (
                          <span
                            role="status"
                            className="rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-800"
                          >
                            Mock demo · review only
                          </span>
                        )}
                        <div className="flex items-center gap-2">
                          <button onClick={() => setAll(job.id, job.candidates.length, true)} className="text-xs font-medium text-ink-700 hover:text-brand-700">
                            Select all
                          </button>
                          <button onClick={() => setAll(job.id, job.candidates.length, false)} className="text-xs font-medium text-ink-700 hover:text-brand-700">
                            None
                          </button>
                          <button
                            onClick={() => commit(job)}
                            disabled={selCount === 0 || busy || !!processing}
                            title={job.source === "mock" ? "Mock candidates can be reviewed, but cannot be published as Official records." : undefined}
                            className="btn-primary px-3 py-1.5 text-xs"
                          >
                            Commit {selCount} to Review →
                          </button>
                        </div>
                      </div>
                      <div className="space-y-3">
                        {job.candidates.map((c, i) => (
                          <Card
                            key={i}
                            record={toPreview(c, i)}
                            domain={domain}
                            selected={(sel ?? new Set(job.candidates.map((_, k) => k))).has(i)}
                            onToggle={() => toggleCandidate(job.id, i, job.candidates.length)}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {counts.committed > 0 && (
          <CommittedJobsNotice domain={domain} />
        )}
      </div>
    </div>
  );
}

export function CommittedJobsNotice({ domain }: { domain: Domain }) {
  return (
    <div className="border-t border-slate-100 px-5 py-3 text-xs text-ink-700">
      Committed candidates are in the{" "}
      <Link href={`/${domain}/database?status=review`} className="font-semibold text-brand-600 underline">
        Review Queue
      </Link>
      .
    </div>
  );
}

function toPreview(c: RecordDraft, i: number): any {
  return { ...c, id: `~${String(i + 1).padStart(3, "0")}`, status: "review", createdAt: "" };
}

function StatusPill({ status }: { status: JobStatus }) {
  const map: Record<JobStatus, string> = {
    queued: "border-amber-200 bg-amber-50 text-amber-700",
    extracting: "border-amber-200 bg-amber-50 text-amber-700 animate-pulse",
    done: "border-brand-200 bg-brand-50 text-brand-700",
    error: "border-rose-200 bg-rose-50 text-rose-700",
    committed: "border-violet-200 bg-violet-50 text-violet-700",
  };
  return <span className={`status-mini ${map[status]}`}>{status}</span>;
}

function FileIcon() {
  return (
    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-slate-100 text-ink-400">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
        <path d="M7 3h7l5 5v13H7a2 2 0 01-2-2V5a2 2 0 012-2z" stroke="currentColor" strokeWidth="1.6" />
        <path d="M14 3v5h5" stroke="currentColor" strokeWidth="1.6" />
      </svg>
    </span>
  );
}

export interface SkippedFile {
  filename: string;
  reason: string;
}

const SKIP_NOTICE_VISIBLE_MS = 7000;
const SKIP_NOTICE_REARM_MS = 2500;
const SKIP_NOTICE_FADE_MS = 600;
const SKIP_NOTICE_MAX_ROWS = 3;

/**
 * Compact, transient notice for files the upload skipped (duplicates, no
 * readable text). One truncated row per file — full detail on hover — and it
 * fades itself out after a few seconds; hovering pauses the countdown so a
 * long filename can be read.
 */
export function SkipNotice({ skipped, onDismiss }: { skipped: SkippedFile[]; onDismiss: () => void }) {
  const [fading, setFading] = useState(false);
  const timers = useRef<{ fade?: ReturnType<typeof setTimeout>; gone?: ReturnType<typeof setTimeout> }>({});

  const clear = useCallback(() => {
    clearTimeout(timers.current.fade);
    clearTimeout(timers.current.gone);
  }, []);
  const arm = useCallback(
    (delay: number) => {
      clear();
      timers.current.fade = setTimeout(() => {
        setFading(true);
        timers.current.gone = setTimeout(onDismiss, SKIP_NOTICE_FADE_MS);
      }, delay);
    },
    [clear, onDismiss]
  );

  useEffect(() => {
    setFading(false);
    arm(SKIP_NOTICE_VISIBLE_MS);
    return clear;
  }, [skipped, arm, clear]);

  return (
    <div
      role="status"
      data-testid="skip-notice"
      onMouseEnter={() => {
        clear();
        setFading(false);
      }}
      onMouseLeave={() => arm(SKIP_NOTICE_REARM_MS)}
      className={`flex items-start gap-2.5 rounded-xl border border-amber-200/80 bg-gradient-to-r from-amber-50/90 to-white px-3.5 py-2.5 shadow-sm transition-opacity duration-[600ms] ease-out ${
        fading ? "opacity-0" : "opacity-100"
      }`}
    >
      <span className="mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />
      <div className="min-w-0 flex-1">
        <div className="text-[10px] font-bold uppercase tracking-eyebrow text-amber-600">
          {skipped.length === 1 ? "1 file skipped" : `${skipped.length} files skipped`}
        </div>
        {skipped.slice(0, SKIP_NOTICE_MAX_ROWS).map((s) => (
          <div key={s.filename} className="truncate text-xs leading-5 text-ink-700" title={`${s.filename} — ${s.reason}`}>
            <span className="font-semibold text-ink-900">{s.filename}</span>
            <span className="text-ink-700"> — {s.reason}</span>
          </div>
        ))}
        {skipped.length > SKIP_NOTICE_MAX_ROWS && (
          <div className="text-[11px] text-ink-400">+{skipped.length - SKIP_NOTICE_MAX_ROWS} more</div>
        )}
      </div>
      <button
        onClick={onDismiss}
        aria-label="Dismiss"
        className="grid h-5 w-5 shrink-0 place-items-center rounded-md text-ink-300 transition hover:bg-amber-100 hover:text-amber-700"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
          <path d="M1.5 1.5l7 7m0-7l-7 7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}
