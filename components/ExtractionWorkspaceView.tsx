"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Domain } from "@/lib/domain";
import type { BatchJob, JobStatus } from "@/lib/schema";

type WorkspaceFilter = "all" | "analyzing" | "finished" | "error";
const FILTERS: readonly { key: WorkspaceFilter; label: string }[] = [
  { key: "all", label: "All files" },
  { key: "analyzing", label: "Analyzing" },
  { key: "finished", label: "Output" },
  { key: "error", label: "Failed" },
];

export interface ExtractionWorkspaceViewProps {
  domain: Domain;
  jobs: BatchJob[];
  pageJobs: BatchJob[];
  filteredCount: number;
  filterCounts: Record<WorkspaceFilter, number>;
  fileFilter: WorkspaceFilter;
  onFilterChange: (filter: WorkspaceFilter) => void;
  query: string;
  onQueryChange: (query: string) => void;
  busy: boolean;
  processing: string | null;
  over: boolean;
  onDragStateChange: (over: boolean) => void;
  onUploadFiles: (files: FileList | File[]) => void;
  onRetry: (job: BatchJob) => void;
  onRefresh: () => void;
  notices: ReactNode;
  committedNotice: ReactNode;
  sortDirection: "asc" | "desc";
  onToggleSort: () => void;
  onRemove: (job: BatchJob) => void;
  renderStatus: (status: JobStatus, error?: string | null, checked?: boolean) => ReactNode;
  renderFileIcon: () => ReactNode;
  currentPage: number;
  totalPages: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
}

export function ExtractionWorkspaceView({
  domain,
  jobs,
  pageJobs,
  filteredCount,
  filterCounts,
  fileFilter,
  onFilterChange,
  query,
  onQueryChange,
  busy,
  processing,
  over,
  onDragStateChange,
  onUploadFiles,
  onRetry,
  onRefresh,
  notices,
  committedNotice,
  sortDirection,
  onToggleSort,
  onRemove,
  renderStatus,
  renderFileIcon,
  currentPage,
  totalPages,
  pageSize,
  onPageChange,
  onPageSizeChange,
}: ExtractionWorkspaceViewProps) {
  const controlsDisabled = busy || processing !== null;
  const fileInput = useRef<HTMLInputElement>(null);
  const openFilePicker = () => fileInput.current?.click();

  return (
    <section aria-label="Extraction file workspace" data-testid="extract-workspace" className="min-h-dvh bg-[#fafafa] px-4 py-6 font-sans text-ink-900 sm:px-8 lg:px-10 lg:py-8">
      <div className="mx-auto w-full max-w-[1240px]">
        <header>
          <div>
            <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.035em]">Extraction files</h1>
            <p className="mt-1.5 text-[13px] capitalize text-ink-600">{domain} workspace</p>
          </div>
        </header>

        <input ref={fileInput} aria-label="Upload extraction files" type="file" accept=".pdf,.txt,.xlsx,.csv,.tsv" multiple className="hidden" disabled={controlsDisabled} onChange={(event) => {
          if (event.target.files?.length) onUploadFiles(event.target.files);
          event.target.value = "";
        }} />
        <button type="button" aria-label="Upload files to extract" disabled={controlsDisabled} onClick={openFilePicker}
          onDragOver={(event) => { event.preventDefault(); if (!controlsDisabled) onDragStateChange(true); }}
          onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onDragStateChange(false); }}
          onDrop={(event) => { event.preventDefault(); onDragStateChange(false); if (!controlsDisabled) onUploadFiles(event.dataTransfer.files); }}
          className={`group mt-5 flex min-h-[176px] w-full flex-col items-center justify-center gap-5 rounded-xl border-2 border-dashed px-6 py-6 text-center transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-50 sm:flex-row sm:justify-start sm:text-left ${over ? "border-brand-600 bg-brand-100" : "border-brand-600/60 bg-brand-50 hover:border-brand-700 hover:bg-brand-100/60"}`}>
          <span className="grid h-14 w-14 shrink-0 place-items-center rounded-xl bg-white text-brand-700 ring-1 ring-brand-200"><UploadCloudIcon /></span>
          <span className="min-w-0 flex-1">
            <span className="block text-xl font-semibold tracking-tight text-brand-900">Extract records</span>
            <span className="mt-1.5 block text-sm text-brand-800">{busy ? "Uploading…" : over ? "Drop to add files" : "Drop files here to extract"}</span>
            <span className="mt-2 block text-xs text-[#526a67]">PDF, TXT, XLSX, CSV or TSV · multiple files</span>
          </span>
          <span className={`${PRIMARY_BUTTON} shrink-0 group-hover:bg-brand-800`}><PlusIcon />{busy ? "Uploading…" : "Upload files"}</span>
        </button>
        {notices && <div role="status" className="mt-4 space-y-2">{notices}</div>}

        <div className="mt-7 flex items-baseline gap-2.5">
          <h2 className="text-sm font-semibold">File history</h2>
          <span className="text-xs text-[#617080]">{jobs.length} {jobs.length === 1 ? "file" : "files"}</span>
        </div>
        <div className="mb-3 mt-2 flex flex-wrap items-center justify-between gap-x-5 gap-y-3">
          <nav aria-label="Extraction file filters" className="flex max-w-full gap-1 overflow-x-auto">
            {FILTERS.map((item) => <button key={item.key} type="button" aria-pressed={fileFilter === item.key} onClick={() => onFilterChange(item.key)} className={`flex min-h-10 shrink-0 items-center gap-1.5 border-b-2 px-2.5 text-xs transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500 sm:gap-2 sm:px-3 sm:text-[13px] ${fileFilter === item.key ? "border-brand-700 font-medium text-ink-950" : "border-transparent text-ink-600 hover:text-ink-950"}`}>
              <span>{item.label}</span><span className="rounded bg-ink-100 px-1 text-[11px] tabular-nums text-ink-600">{filterCounts[item.key]}</span>
            </button>)}
          </nav>
          <div className="flex w-full items-center gap-2 sm:w-auto">
            <label className="relative min-w-0 flex-1 sm:w-56">
              <span className="sr-only">Search extraction files</span><SearchIcon />
              <input type="search" value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="Search files" className="h-9 w-full rounded-lg border border-ink-200 bg-white pl-9 pr-3 text-xs outline-none placeholder:text-ink-600 focus:border-brand-600 focus:ring-2 focus:ring-brand-100" />
            </label>
            <button type="button" aria-label="Refresh" title="Refresh" onClick={onRefresh} disabled={controlsDisabled} className={`${SECONDARY_BUTTON} !w-9 !px-0`}><RefreshIcon spinning={processing === "refresh"} /></button>
          </div>
        </div>

        <div className="rounded-xl border border-ink-200/80 bg-white">
          <table aria-label="Extraction files" className="w-full table-fixed border-separate border-spacing-0 text-left">
            <colgroup><col /><col className="hidden w-[20%] md:table-column" /><col className="hidden w-[8%] md:table-column" /><col className="hidden w-[14%] md:table-column" /><col className="w-14 md:w-32" /></colgroup>
            <thead className="text-[11px] text-ink-600">
              <tr>
                <th scope="col" className="h-9 rounded-tl-xl border-b border-ink-200/70 bg-ink-50/60 px-4 !text-xs !font-medium !text-[#617080]">File name</th>
                <th scope="col" className="hidden h-9 border-b border-ink-200/70 bg-ink-50/60 px-3 !text-xs !font-medium !text-[#617080] md:table-cell">Status</th>
                <th scope="col" className="hidden h-9 border-b border-ink-200/70 bg-ink-50/60 px-3 text-center !text-xs !font-medium !text-[#617080] md:table-cell">Records</th>
                <th scope="col" aria-sort={sortDirection === "asc" ? "ascending" : "descending"} className="hidden h-9 border-b border-ink-200/70 bg-ink-50/60 px-3 !text-xs !font-medium !text-[#617080] md:table-cell">
                  <button type="button" onClick={onToggleSort} className="inline-flex items-center gap-1.5 rounded !text-xs !font-medium !text-[#617080] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">Created <SortIcon direction={sortDirection} /></button>
                </th>
                <th scope="col" className="rounded-tr-xl border-b border-ink-200/70 bg-ink-50/60 px-3 text-right !text-xs !font-medium !text-[#617080]"><span className="hidden md:inline">Actions</span><span className="sr-only md:hidden">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {pageJobs.map((job, index) => <tr key={job.id} className="group md:h-[52px] hover:bg-ink-50/70">
                <td className="border-b border-ink-100 px-4 py-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="hidden shrink-0 sm:block">{renderFileIcon()}</span>
                    <div className="min-w-0">
                      <div className="flex min-w-0 items-center gap-2">
                        <p className="truncate text-xs font-medium leading-5 text-ink-900" title={job.filename}>{job.filename}</p>
                        <span className="hidden shrink-0 rounded bg-ink-100 px-1.5 py-0.5 text-[0.6875rem] leading-4 text-[#617080] md:inline">{fileKind(job.filename)}</span>
                      </div>
                      <p className="mt-0.5 truncate text-xs text-[#617080] md:hidden">{fileKind(job.filename)}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 md:hidden">{renderStatus(job.status, job.error, job.checked)}<span className="text-[11px] text-ink-600">{job.recordCount} records</span></div>
                      {job.error && <p className="mt-1 truncate text-xs text-rose-700" title={job.error}>{job.error}</p>}
                    </div>
                  </div>
                </td>
                <td className="hidden border-b border-ink-100 px-3 md:table-cell">{renderStatus(job.status, job.error, job.checked)}</td>
                <td className="hidden border-b border-ink-100 px-3 text-center text-xs tabular-nums text-ink-700 md:table-cell">{job.recordCount}</td>
                <td className="hidden border-b border-ink-100 px-3 text-xs tabular-nums text-ink-600 md:table-cell"><time dateTime={job.createdAt} title={formatJobTime(job.createdAt)}>{formatJobDate(job.createdAt)}</time></td>
                <td className="border-b border-ink-100 px-2 md:px-3">
                  <div className="flex flex-col items-center justify-end gap-1 md:flex-row md:gap-2">
                    {(job.status === "error" || (job.status === "done" && job.error)) && <button type="button" onClick={() => onRetry(job)} disabled={controlsDisabled} aria-label={`Retry ${job.status === "done" ? "review transfer" : "extraction"}: ${job.filename}`} className="rounded px-1 py-2 text-xs font-medium text-brand-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:opacity-40">Retry</button>}
                    {job.status === "committed" && <Link aria-label={`${job.checked ? "View checked records" : "Open review"}: ${job.filename}`} href={`/${domain}/database?status=${job.checked ? "official" : "review"}`} className="hidden rounded px-1 py-2 text-xs font-medium text-brand-700 hover:text-brand-900 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 md:inline-flex">{job.checked ? "View" : "Review"}</Link>}
                    <WorkspaceMenu label={`File actions: ${job.filename}`} trigger={<MoreIcon />} compact upward={pageJobs.length >= 5 && index >= pageJobs.length - 2}>
                      <div className="border-b border-ink-100 px-3 pb-3 pt-2">
                        <p className="break-words text-xs font-medium leading-5 text-ink-900">{job.filename}</p>
                        <p className="mt-2 text-[11px] leading-5 text-ink-600">Created · {formatJobTime(job.createdAt)}<br />Finished · {formatJobTime(job.completedAt ?? job.committedAt)}</p>
                      </div>
                      {job.status === "committed" && <Link href={`/${domain}/database?status=${job.checked ? "official" : "review"}`} className="mt-1 flex rounded-md px-3 py-2 text-xs font-medium text-brand-700 hover:bg-brand-50">{job.checked ? "View checked records" : "Open review"}</Link>}
                      <button type="button" onClick={() => onRemove(job)} disabled={controlsDisabled} aria-label={job.sourceId ? `Delete document and all extracted data: ${job.filename}` : `Remove extraction job: ${job.filename}`} className="mt-1 flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-xs text-rose-700 hover:bg-rose-50 disabled:opacity-40"><TrashIcon />{job.sourceId ? "Delete document and data" : "Remove extraction job"}</button>
                    </WorkspaceMenu>
                  </div>
                </td>
              </tr>)}
              {pageJobs.length === 0 && <tr><td colSpan={5} className="h-36 px-6 text-center">
                <div className="mx-auto flex max-w-sm flex-col items-center"><span className="text-ink-400"><EmptyFilesIcon /></span>
                  <h2 className="mt-4 text-sm font-medium">{jobs.length === 0 ? "No extraction files yet" : "No files in this view"}</h2>
                  <p className="mt-2 text-xs leading-5 text-ink-600">{jobs.length === 0 ? "Upload a paper or structured data file to start extracting records." : "Try another status filter or clear the current search."}</p>
                </div>
              </td></tr>}
            </tbody>
          </table>
          <footer className="flex min-h-12 flex-wrap items-center justify-between gap-3 px-4 py-2 text-xs text-[#617080]">
            <span aria-live="polite">{filteredCount === 0 ? "0 files" : `${(currentPage - 1) * pageSize + 1}–${Math.min(currentPage * pageSize, filteredCount)} of ${filteredCount} files`}</span>
            <div className="flex items-center gap-1.5 sm:gap-3">
              <button type="button" onClick={() => onPageChange(Math.max(1, currentPage - 1))} disabled={currentPage <= 1} aria-label="Previous page" className={ICON_BUTTON}><PaginationIcon direction="previous" /></button>
              <span className="tabular-nums">{currentPage} / {totalPages}</span>
              <button type="button" onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))} disabled={currentPage >= totalPages} aria-label="Next page" className={ICON_BUTTON}><PaginationIcon direction="next" /></button>
              <label><span className="sr-only">Rows per page</span><select value={pageSize} onChange={(event) => onPageSizeChange(Number(event.target.value))} className="h-8 rounded-md border border-ink-200 bg-white px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-brand-500">{[5, 10, 25, 50].map((size) => <option key={size} value={size}>{size} / page</option>)}</select></label>
            </div>
          </footer>
        </div>
        {committedNotice && <div className="mt-5 flex justify-end">{committedNotice}</div>}
      </div>
    </section>
  );
}

const PRIMARY_BUTTON = "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-brand-700 px-5 text-sm font-semibold text-white transition";
const SECONDARY_BUTTON = "inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border border-ink-200 bg-white px-3 text-xs font-medium text-ink-800 transition hover:bg-ink-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:cursor-not-allowed disabled:opacity-40";
const ICON_BUTTON = "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-ink-600 hover:bg-ink-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:opacity-30";

function WorkspaceMenu({ label, trigger, compact = false, upward = false, children }: { label: string; trigger: ReactNode; compact?: boolean; upward?: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => { if (ref.current && !ref.current.contains(event.target as Node)) ref.current.open = false; };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);
  return <details ref={ref} className="relative" onToggle={(event) => setOpen(event.currentTarget.open)} onKeyDown={(event) => {
    if (event.key === "Escape" && ref.current) { ref.current.open = false; ref.current.querySelector("summary")?.focus(); }
  }} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) event.currentTarget.open = false; }}>
    <summary aria-label={label} className={`list-none cursor-pointer [&::-webkit-details-marker]:hidden ${compact ? ICON_BUTTON : SECONDARY_BUTTON}`}>{trigger}</summary>
    <div className={`absolute z-20 w-64 max-w-[calc(100vw-3rem)] rounded-xl border border-ink-200 bg-white p-1.5 shadow-lg ${compact ? "right-0" : "left-1/2 -translate-x-1/2 sm:left-auto sm:right-0 sm:translate-x-0"} ${upward ? "bottom-full mb-2" : "top-full mt-2"}`} onClick={(event) => {
      if ((event.target as Element).closest("button, a") && ref.current) { ref.current.open = false; ref.current.querySelector("summary")?.focus(); }
    }}>{children}</div>
  </details>;
}

function formatJobDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

function PlusIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden><path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>;
}

function MoreIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden><circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" /></svg>;
}

function fileKind(filename: string): string {
  if (filename === "Pasted text") return "Text input";
  if (filename.toLocaleLowerCase().endsWith(".txt")) return "TXT";
  return "PDF";
}

function formatJobTime(value?: string): string {
  if (!value) return "—";
  const [date, time = ""] = value.replace("Z", "").split("T");
  return `${date} ${time.slice(0, 8)}`.trim();
}

function UploadCloudIcon() {
  return <svg width="25" height="25" viewBox="0 0 24 24" fill="none" aria-hidden><path d="M7.5 18.5H6a4 4 0 01-.65-7.95A6.5 6.5 0 0117.9 9.1 4.75 4.75 0 0118.25 18.5H16.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /><path d="M12 19V11m0 0l-3 3m3-3l3 3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function SearchIcon() {
  return <svg className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[#9ca6ba]" width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden><circle cx="10.75" cy="10.75" r="6.25" stroke="currentColor" strokeWidth="1.7" /><path d="M15.5 15.5L20 20" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>;
}

function RefreshIcon({ spinning }: { spinning: boolean }) {
  return <svg className={spinning ? "animate-spin" : ""} width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden><path d="M19 8a7.5 7.5 0 10.2 7.6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /><path d="M19 4.5V8h-3.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function SortIcon({ direction }: { direction: "asc" | "desc" }) {
  return <svg className={direction === "asc" ? "rotate-180" : ""} width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden><path d="M2.5 4.5L6 8l3.5-3.5" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function TrashIcon() {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden><path d="M5 7h14M9 7V4.5h6V7m2 0l-.75 12.5h-8.5L7 7m3 4v5m4-5v5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function EmptyFilesIcon() {
  return <svg width="25" height="25" viewBox="0 0 24 24" fill="none" aria-hidden><path d="M7 3.5h7l4.5 4.5v11A1.5 1.5 0 0117 20.5H7A1.5 1.5 0 015.5 19V5A1.5 1.5 0 017 3.5z" stroke="currentColor" strokeWidth="1.6" /><path d="M14 3.5V8h4.5M9 13h6M9 16h4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>;
}

function PaginationIcon({ direction }: { direction: "previous" | "next" }) {
  return <svg className={direction === "previous" ? "rotate-180" : ""} width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden><path d="M5 2.5L9.5 7 5 11.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
