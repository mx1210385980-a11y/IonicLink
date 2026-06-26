"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { getClientModule } from "@/components/registry.client";
import { DEFAULT_DOMAIN, type Domain } from "@/lib/domain";
import type { BatchJob, JobStatus, RecordDraft } from "@/lib/schema";

/**
 * Unified extraction surface. Drop one or many PDFs (or paste text) — every
 * input becomes a background job in one queue. When a job finishes, its
 * candidates are individually reviewable: deselect any you don't want, then
 * commit just the selected ones to the Review Queue.
 */
export function Extractor({ domain = DEFAULT_DOMAIN }: { domain?: Domain }) {
  const Card = getClientModule(domain).Card;
  const [jobs, setJobs] = useState<BatchJob[]>([]);
  const [draining, setDraining] = useState(false);
  const [concurrency, setConcurrency] = useState(1);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [text, setText] = useState("");
  const [skipped, setSkipped] = useState<SkippedFile[] | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selection, setSelection] = useState<Record<string, Set<number>>>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dismissSkipped = useCallback(() => setSkipped(null), []);

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/${domain}/batch`);
    const data = (await res.json()) as { jobs: BatchJob[]; draining: boolean; concurrency: number };
    setJobs(data.jobs);
    setDraining(data.draining);
    if (data.concurrency) setConcurrency(data.concurrency);
    return data;
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
    if (list.length === 0) return;
    setBusy(true);
    setSkipped(null);
    const form = new FormData();
    list.forEach((f) => form.append("files", f));
    const res = await fetch(`/api/${domain}/batch`, { method: "POST", body: form });
    const data = await res.json();
    setBusy(false);
    setSkipped(data.skipped?.length ? data.skipped : null);
    refresh();
  };

  const submitText = async () => {
    if (!text.trim()) return;
    setBusy(true);
    setSkipped(null);
    const form = new FormData();
    form.append("text", text);
    await fetch(`/api/${domain}/batch`, { method: "POST", body: form });
    setText("");
    setBusy(false);
    refresh();
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

  const commit = async (job: BatchJob) => {
    const sel = selection[job.id] ?? new Set(job.candidates.map((_, i) => i));
    if (sel.size === 0) return;
    await fetch(`/api/${domain}/batch/${encodeURIComponent(job.id)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "commit", indices: [...sel] }),
    });
    setExpanded((prev) => {
      const n = new Set(prev);
      n.delete(job.id);
      return n;
    });
    refresh();
  };

  const commitAll = async () => {
    const done = jobs.filter((j) => j.status === "done");
    await Promise.all(
      done.map((j) =>
        fetch(`/api/${domain}/batch/${encodeURIComponent(j.id)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "commit" }),
        })
      )
    );
    refresh();
  };

  const remove = async (id: string) => {
    await fetch(`/api/${domain}/batch/${encodeURIComponent(id)}`, { method: "DELETE" });
    refresh();
  };
  const clearFinished = async () => {
    await fetch(`/api/${domain}/batch`, { method: "DELETE" });
    refresh();
  };

  const counts = {
    active: jobs.filter((j) => j.status === "queued" || j.status === "extracting").length,
    done: jobs.filter((j) => j.status === "done").length,
    committed: jobs.filter((j) => j.status === "committed").length,
  };

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
          <input type="file" accept=".pdf,.txt" multiple className="hidden" disabled={busy} onChange={(e) => e.target.files && uploadFiles(e.target.files)} />
        </label>

        <div className="panel flex flex-col p-4">
          <span className="label-eyebrow mb-2">Or paste paper text</span>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Paste an abstract, results section, or full text…"
            className="h-40 w-full resize-none rounded-xl border border-slate-200 bg-white p-3 text-sm outline-none focus:border-brand-300 focus:ring-2 focus:ring-brand-100"
          />
          <button onClick={submitText} disabled={busy || !text.trim()} className="btn-primary mt-3 self-start">
            Add to queue
          </button>
        </div>
      </div>

      {skipped && <SkipNotice skipped={skipped} onDismiss={dismissSkipped} />}

      {jobs.length > 0 && (
        <div className="panel overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-3">
            <div className="flex items-center gap-2 text-sm">
              <span className="font-semibold">Queue</span>
              <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                <span className="text-amber-700">{counts.active} processing</span>
                <span className="text-ink-400">·</span>
                <span className="text-brand-700">{counts.done} to review</span>
                <span className="text-ink-400">·</span>
                <span className="text-violet-700">{counts.committed} committed</span>
                {draining && <span className="ml-1 text-amber-700">● working (up to {concurrency} at once)</span>}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={commitAll} disabled={counts.done === 0} className="btn-primary px-3 py-1.5 text-xs">
                Commit all ready
              </button>
              <button onClick={clearFinished} className="btn px-3 py-1.5 text-xs">
                Clear finished
              </button>
            </div>
          </div>

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
                      className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs text-ink-400 hover:border-rose-200 hover:text-rose-600"
                      aria-label="Remove job"
                    >
                      ✕
                    </button>
                  </div>

                  {isOpen && job.status === "done" && (
                    <div className="border-t border-slate-100 bg-slate-50/40 px-5 py-4">
                      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                        <span className="text-xs text-ink-700">
                          {selCount} of {job.candidates.length} selected
                          {job.source === "mock" ? " · mock" : job.model ? ` · ${job.model}` : ""}
                        </span>
                        <div className="flex items-center gap-2">
                          <button onClick={() => setAll(job.id, job.candidates.length, true)} className="text-xs font-medium text-ink-700 hover:text-brand-700">
                            Select all
                          </button>
                          <button onClick={() => setAll(job.id, job.candidates.length, false)} className="text-xs font-medium text-ink-700 hover:text-brand-700">
                            None
                          </button>
                          <button onClick={() => commit(job)} disabled={selCount === 0} className="btn-primary px-3 py-1.5 text-xs">
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

          {counts.committed > 0 && (
            <div className="border-t border-slate-100 px-5 py-3 text-xs text-ink-700">
              Committed candidates are in the{" "}
              <Link href={`/${domain}/database`} className="font-semibold text-brand-600 underline">
                Review Queue
              </Link>
              .
            </div>
          )}
        </div>
      )}
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
