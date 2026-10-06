"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DatasetImporter, isSupportedDataset } from "@/components/DatasetImporter";
import { ExtractionWorkspaceView } from "@/components/ExtractionWorkspaceView";
import {
  isSupportedPaper,
  mergePendingPaperUploads,
  paperUploadId,
  PaperUploadDialog,
  type PendingPaperUpload,
} from "@/components/PaperUploadDialog";
import { RequestError, requestErrorMessage, requestJson } from "@/components/request";
import { DEFAULT_DOMAIN, type Domain } from "@/lib/domain";
import type { BatchJob, JobHistorySummary, JobStatus } from "@/lib/schema";

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
  { status: "done", label: "Sending to review", tone: "border-brand-200 bg-brand-50 text-brand-800" },
  { status: "error", label: "Errors", tone: "border-rose-200 bg-rose-50 text-rose-800" },
  { status: "committed", label: "Awaiting review", tone: "border-violet-200 bg-violet-50 text-violet-800" },
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

export type ExtractionFileFilter = "all" | "analyzing" | "finished" | "error";

export function jobMatchesFileFilter(status: JobStatus, filter: ExtractionFileFilter, hasError = false): boolean {
  if (filter === "analyzing") return status === "queued" || status === "extracting" || (status === "done" && !hasError);
  if (filter === "finished") return status === "committed";
  if (filter === "error") return status === "error" || (status === "done" && hasError);
  return true;
}

export function filterExtractionJobs(
  jobs: readonly BatchJob[],
  filter: ExtractionFileFilter,
  query: string
): BatchJob[] {
  const needle = query.trim().toLocaleLowerCase();
  return jobs.filter((job) => {
    if (!jobMatchesFileFilter(job.status, filter, Boolean(job.error))) return false;
    if (!needle) return true;
    return [job.filename, job.model, job.source, job.error]
      .filter((value): value is string => typeof value === "string")
      .some((value) => value.toLocaleLowerCase().includes(needle));
  });
}

const STATUS_LABELS: Record<JobStatus, string> = {
  queued: "Waiting",
  extracting: "Extracting",
  done: "Sending to review",
  error: "Extraction failed",
  committed: "Awaiting review",
};

const STATUS_DOTS: Record<JobStatus, string> = {
  queued: "bg-slate-400",
  extracting: "bg-blue-500",
  done: "bg-emerald-500",
  error: "bg-rose-500",
  committed: "bg-emerald-600",
};

/** Unified upload queue. Successful extractions are sent to review by the server. */
export function Extractor({ domain = DEFAULT_DOMAIN }: { domain?: Domain }) {
  const [jobs, setJobs] = useState<BatchJob[]>([]);
  const [busy, setBusy] = useState(false);
  const [processing, setProcessing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const [skipped, setSkipped] = useState<SkippedFile[] | null>(null);
  const [fileFilter, setFileFilter] = useState<ExtractionFileFilter>("all");
  const [query, setQuery] = useState("");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(5);
  const [pendingUploads, setPendingUploads] = useState<PendingPaperUpload[]>([]);
  const [pendingDatasetFiles, setPendingDatasetFiles] = useState<File[]>([]);
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
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
    setFileFilter("all");
    setQuery("");
    setPage(1);
    setPendingUploads([]);
    setPendingDatasetFiles([]);
    setUploadDialogOpen(false);
    setError(null);
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

  const stagePaperFiles = (files: FileList | File[]) => {
    const list = Array.from(files);
    if (list.length === 0 || busy || processing) return;
    const supported = list.filter(isSupportedPaper);
    if (supported.length === 0) {
      setError("Choose a PDF or TXT file to prepare an extraction.");
      return;
    }
    setError(null);
    setPendingUploads((current) => mergePendingPaperUploads(current, supported));
    setUploadDialogOpen(true);
  };

  const stageExtractionFiles = (files: FileList | File[]) => {
    const list = Array.from(files);
    if (list.length === 0 || busy || processing) return;
    const papers = list.filter(isSupportedPaper);
    const datasets = list.filter(isSupportedDataset);
    if (papers.length > 0 && datasets.length > 0) {
      setError("Upload paper files and structured datasets separately so each can follow its own extraction flow.");
      return;
    }
    if (papers.length > 0) {
      stagePaperFiles(papers);
      return;
    }
    if (datasets.length > 0) {
      setError(null);
      setPendingDatasetFiles((current) => {
        const known = new Set(current.map((file) => paperUploadId(file)));
        return [...current, ...datasets.filter((file) => {
          const id = paperUploadId(file);
          if (known.has(id)) return false;
          known.add(id);
          return true;
        })];
      });
      return;
    }
    setError("Choose a PDF, TXT, XLSX, CSV, or TSV file.");
  };

  const analyzePendingFiles = async () => {
    const list = pendingUploads.map((item) => item.file);
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
      setPendingUploads([]);
      setUploadDialogOpen(false);
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

  const cancelPendingUploads = useCallback(() => {
    if (busy) return;
    setPendingUploads([]);
    setUploadDialogOpen(false);
    setError(null);
  }, [busy]);

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

  const retry = async (job: BatchJob) => {
    await runQueueAction(
      `retry:${job.id}`,
      "Could not retry this job. Please try again.",
      "The retry was accepted",
      async () => {
        await requestJson(
          `/api/${domain}/batch/${encodeURIComponent(job.id)}`,
          { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "retry" }) },
          "Could not retry this job"
        );
      }
    );
  };

  const remove = async (job: BatchJob) => {
    if (job.sourceId) {
      const confirmed = window.confirm(
        `Delete "${job.filename}" and all related data?\n\nThis permanently removes the stored PDF, extraction history, Review records, and Checked database records. You can upload the document again afterward.`
      );
      if (!confirmed) return;

      let storedFilesRemoved = true;
      await runQueueAction(
        `remove:${job.id}`,
        "Could not delete this document. Please try again.",
        "The document and all extracted data were deleted",
        async () => {
          const payload = await requestJson<{
            deleted: { storedFilesRemoved: boolean };
          }>(
            `/api/${domain}/source/${encodeURIComponent(job.sourceId!)}`,
            { method: "DELETE" },
            "Could not delete this document"
          );
          storedFilesRemoved = payload.deleted.storedFilesRemoved;
        },
        () => {
          if (!storedFilesRemoved) {
            setError("The document data was deleted, but its stored PDF could not be removed. Please check server file permissions before uploading it again.");
          }
        }
      );
      return;
    }

    await runQueueAction(
      `remove:${job.id}`,
      "Could not remove this job. Please try again.",
      "The job was removed",
      async () => {
        await requestJson(
          `/api/${domain}/batch/${encodeURIComponent(job.id)}`,
          { method: "DELETE" },
          "Could not remove this job"
        );
      }
    );
  };
  const manualRefresh = async () => {
    if (processing || busy) return;
    setProcessing("refresh");
    setError(null);
    try {
      await refresh();
    } catch (refreshError) {
      setError(requestErrorMessage(refreshError, "Could not refresh the extraction queue."));
    } finally {
      setProcessing(null);
    }
  };

  const counts = summarizeQueue(jobs);
  const filterCounts: Record<ExtractionFileFilter, number> = {
    all: jobs.length,
    analyzing: jobs.filter((job) => jobMatchesFileFilter(job.status, "analyzing", Boolean(job.error))).length,
    finished: counts.committed,
    error: jobs.filter((job) => jobMatchesFileFilter(job.status, "error", Boolean(job.error))).length,
  };
  const filteredJobs = useMemo(() => {
    const matches = filterExtractionJobs(jobs, fileFilter, query);
    return matches.sort((left, right) => {
      const comparison = left.createdAt.localeCompare(right.createdAt);
      return sortDirection === "asc" ? comparison : -comparison;
    });
  }, [fileFilter, jobs, query, sortDirection]);
  const totalPages = Math.max(1, Math.ceil(filteredJobs.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageJobs = filteredJobs.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  return (
    <>
      <ExtractionWorkspaceView
        domain={domain}
        jobs={jobs}
        pageJobs={pageJobs}
        filteredCount={filteredJobs.length}
        filterCounts={filterCounts}
        fileFilter={fileFilter}
        onFilterChange={(filter) => {
          setFileFilter(filter);
          setPage(1);
        }}
        query={query}
        onQueryChange={(value) => {
          setQuery(value);
          setPage(1);
        }}
        busy={busy}
        processing={processing}
        over={over}
        onDragStateChange={setOver}
        onUploadFiles={stageExtractionFiles}
        onRetry={retry}
        onRefresh={manualRefresh}
        notices={
          error || skipped ? (
            <>
              {error && <RequestError>{error}</RequestError>}
              {skipped && <SkipNotice skipped={skipped} onDismiss={dismissSkipped} />}
            </>
          ) : null
        }
        committedNotice={counts.committed > 0 ? <CommittedJobsNotice domain={domain} /> : null}
        sortDirection={sortDirection}
        onToggleSort={() => setSortDirection((current) => current === "asc" ? "desc" : "asc")}
        onRemove={remove}
        renderStatus={(status, error, checked) => <StatusPill status={status} error={error} checked={checked} />}
        renderFileIcon={() => <FileIcon />}
        currentPage={currentPage}
        totalPages={totalPages}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPage(1);
        }}
      />
      <PaperUploadDialog
        open={uploadDialogOpen}
        items={pendingUploads}
        busy={busy}
        error={uploadDialogOpen ? error : null}
        onAddFiles={stagePaperFiles}
        onRemove={(id) => {
          setPendingUploads((current) => current.filter((item) => item.id !== id));
        }}
        onCancel={cancelPendingUploads}
        onAnalyze={analyzePendingFiles}
      />
      {pendingDatasetFiles[0] && <DatasetImporter domain={domain} file={pendingDatasetFiles[0]} onClose={() => setPendingDatasetFiles((current) => current.slice(1))} />}
    </>
  );
}

export function CommittedJobsNotice({ domain }: { domain: Domain }) {
  return (
    <div className="text-xs text-ink-600">
      <Link href={`/${domain}/database?status=review`} className="inline-flex items-center gap-2 rounded font-medium text-brand-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
        Open review queue
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden><path d="M5 12h14m-5-5 5 5-5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </Link>
    </div>
  );
}

export function StatusPill({ status, error, checked }: { status: JobStatus; error?: string | null; checked?: boolean }) {
  const isChecked = status === "committed" && checked;
  const map: Record<JobStatus, string> = {
    queued: "text-ink-600",
    extracting: "text-amber-700",
    done: "text-brand-700",
    error: "text-rose-700",
    committed: "text-yellow-700",
  };
  return (
    <span className={`inline-flex max-w-full items-center gap-1.5 text-xs font-medium ${isChecked ? "text-emerald-700" : status === "done" && error ? "text-rose-700" : map[status]}`}>
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${status === "committed" && !isChecked ? "bg-yellow-500" : status === "done" && error ? "bg-rose-500" : STATUS_DOTS[status]} ${status === "extracting" ? "motion-safe:animate-pulse" : ""}`} />
      <span className="truncate">{isChecked ? "Checked" : status === "done" && error ? "Review transfer failed" : STATUS_LABELS[status]}</span>
    </span>
  );
}

function FileIcon() {
  return (
    <span className="grid h-8 w-7 shrink-0 place-items-center text-ink-500">
      <svg width="21" height="21" viewBox="0 0 24 24" fill="none" aria-hidden>
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
