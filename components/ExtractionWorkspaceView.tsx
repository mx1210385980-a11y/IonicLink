"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import type { Domain } from "@/lib/domain";
import type { BatchJob, JobStatus } from "@/lib/schema";

type WorkspaceFilter = "all" | "analyzing" | "finished" | "error";
type InputMode = "text" | "dataset" | null;

const FILTERS: readonly { key: WorkspaceFilter; label: string }[] = [
  { key: "all", label: "All files" },
  { key: "analyzing", label: "Analyzing" },
  { key: "finished", label: "Finished" },
  { key: "error", label: "Needs attention" },
];

const STATUS_LABELS: Record<JobStatus, string> = {
  queued: "Waiting",
  extracting: "Extracting",
  done: "Ready for review",
  error: "Extraction failed",
  committed: "Sent to review",
};

const STATUS_DOTS: Record<JobStatus, string> = {
  queued: "bg-slate-400",
  extracting: "bg-blue-500",
  done: "bg-emerald-500",
  error: "bg-rose-500",
  committed: "bg-violet-500",
};

export interface ExtractionWorkspaceViewProps {
  domain: Domain;
  live: boolean | null;
  jobs: BatchJob[];
  pageJobs: BatchJob[];
  filteredCount: number;
  counts: Record<JobStatus, number>;
  clearableCount: number;
  filterCounts: Record<WorkspaceFilter, number>;
  fileFilter: WorkspaceFilter;
  onFilterChange: (filter: WorkspaceFilter) => void;
  query: string;
  onQueryChange: (query: string) => void;
  inputMode: InputMode;
  onInputModeChange: (mode: InputMode) => void;
  showInsights: boolean;
  onToggleInsights: () => void;
  busy: boolean;
  processing: string | null;
  over: boolean;
  onDragStateChange: (over: boolean) => void;
  onUploadFiles: (files: FileList | File[]) => void;
  onCommitAll: () => void;
  onClearFinished: () => void;
  onRefresh: () => void;
  text: string;
  onTextChange: (value: string) => void;
  onSubmitText: () => void;
  datasetPanel: ReactNode;
  insightsPanel: ReactNode;
  notices: ReactNode;
  committedNotice: ReactNode;
  sortDirection: "asc" | "desc";
  onToggleSort: () => void;
  onRemove: (job: BatchJob) => void;
  renderStatus: (status: JobStatus) => ReactNode;
  renderFileIcon: () => ReactNode;
  currentPage: number;
  totalPages: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
}

export function ExtractionWorkspaceView({
  domain,
  live,
  jobs,
  pageJobs,
  filteredCount,
  counts,
  clearableCount,
  filterCounts,
  fileFilter,
  onFilterChange,
  query,
  onQueryChange,
  inputMode,
  onInputModeChange,
  showInsights,
  onToggleInsights,
  busy,
  processing,
  over,
  onDragStateChange,
  onUploadFiles,
  onCommitAll,
  onClearFinished,
  onRefresh,
  text,
  onTextChange,
  onSubmitText,
  datasetPanel,
  insightsPanel,
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

  return (
    <section
      aria-label="Extraction file workspace"
      data-testid="extract-workspace"
      className="grid min-h-[calc(100dvh-4.25rem)] overflow-hidden border-y border-[#e9edf5] bg-white font-sans lg:h-dvh lg:min-h-[44rem] lg:grid-cols-[270px_minmax(0,1fr)]"
    >
      <aside className="flex min-h-0 flex-col border-b border-[#e9edf5] bg-white lg:border-b-0 lg:border-r">
        <div className="px-5 pb-3 pt-4 lg:pb-4 lg:pt-6">
          <div className="flex items-center gap-3 text-[#082453]">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-[#edf3ff] text-[#2456d6]"><FolderIcon /></span>
            <div>
              <h2 className="text-lg font-semibold tracking-tight">Extraction files</h2>
              <p className="mt-0.5 text-[11px] capitalize text-[#8a94ae]">{domain} workspace</p>
            </div>
          </div>
        </div>

        <nav aria-label="Extraction file filters" className="grid grid-cols-2 gap-1 px-3 lg:grid-cols-1">
          {FILTERS.map((item) => {
            const active = fileFilter === item.key;
            return (
              <button
                key={item.key}
                type="button"
                aria-pressed={active}
                onClick={() => onFilterChange(item.key)}
                className={`flex min-h-10 items-center justify-between rounded-xl px-4 text-left text-sm transition focus:outline-none focus:ring-2 focus:ring-[#b9cbff] ${
                  active
                    ? "bg-[#f1f5fd] font-semibold text-[#2456d6]"
                    : "font-medium text-[#7d89aa] hover:bg-[#f8faff] hover:text-[#25406f]"
                }`}
              >
                <span>{item.label}</span>
                <span className={`font-mono text-[11px] ${active ? "text-[#2456d6]" : "text-[#a2abc1]"}`}>{filterCounts[item.key]}</span>
              </button>
            );
          })}
        </nav>

        <div className="mx-5 my-3 border-t border-[#edf0f6] lg:my-5" />

        <div className="px-3">
          <p className="px-4 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#9aa4bb]">Input methods</p>
          <div className="mt-2 grid grid-cols-3 gap-1 lg:grid-cols-1">
            <SidebarAction
              active={inputMode === "text"}
              icon={<TextInputIcon />}
              label="Paste paper text"
              onClick={() => onInputModeChange(inputMode === "text" ? null : "text")}
            />
            <SidebarAction
              active={inputMode === "dataset"}
              icon={<DatasetIcon />}
              label="Structured dataset"
              onClick={() => onInputModeChange(inputMode === "dataset" ? null : "dataset")}
            />
            <SidebarAction active={showInsights} icon={<ActivityIcon />} label="Queue analytics" onClick={onToggleInsights} />
          </div>
        </div>

        <div className="mt-auto p-3 lg:p-4">
          <div className="rounded-2xl border border-[#edf0f6] bg-white p-2 shadow-[0_8px_28px_rgba(18,52,112,0.08)] lg:p-3">
            <label
              onDragOver={(event) => {
                event.preventDefault();
                onDragStateChange(true);
              }}
              onDragLeave={() => onDragStateChange(false)}
              onDrop={(event) => {
                event.preventDefault();
                onDragStateChange(false);
                onUploadFiles(event.dataTransfer.files);
              }}
              className={`flex min-h-20 cursor-pointer flex-row items-center justify-center gap-3 rounded-2xl border border-dashed px-3 py-3 text-left transition lg:min-h-44 lg:flex-col lg:gap-0 lg:px-5 lg:py-6 lg:text-center ${
                over
                  ? "border-[#2456d6] bg-[#edf3ff]"
                  : "border-[#c9d5f3] bg-[#f6f8fe] hover:border-[#8fa9ed] hover:bg-[#f2f6ff]"
              }`}
            >
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white text-[#173b78] shadow-sm lg:h-12 lg:w-12"><UploadCloudIcon /></span>
              <span className="text-xs font-semibold leading-5 text-[#0a2b62] lg:mt-4 lg:text-sm">{busy ? "Uploading…" : "Click or drag files here to upload"}</span>
              <span className="hidden text-[11px] text-[#93a0bd] lg:mt-3 lg:block">PDF or TXT · multiple files</span>
              <input
                type="file"
                accept=".pdf,.txt"
                multiple
                className="hidden"
                disabled={controlsDisabled}
                onChange={(event) => event.target.files && onUploadFiles(event.target.files)}
              />
            </label>
          </div>
        </div>
      </aside>

      <div className="flex min-h-0 min-w-0 flex-col bg-white">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-[#edf0f6] px-5 py-4 lg:min-h-[82px] lg:px-7">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-semibold tracking-tight text-[#082453]">All files</h1>
              {live !== null && (
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${
                    live ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-800"
                  }`}
                  title={live ? "Records can be reviewed and published after extraction." : "Offline demo candidates can be reviewed, but cannot be published as Checked records."}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${live ? "bg-emerald-500" : "bg-amber-400"}`} />
                  {live ? "Live extraction" : "Demo mode"}
                </span>
              )}
            </div>
            <p className="mt-1 text-xs text-[#8b96af]">{filteredCount} shown · {jobs.length} total</p>
          </div>

          <div className="flex w-full flex-wrap items-center justify-end gap-2 md:w-auto">
            {jobs.length > 0 && (
              <>
                <button
                  type="button"
                  onClick={onCommitAll}
                  disabled={counts.done === 0 || controlsDisabled}
                  className="inline-flex min-h-10 items-center rounded-xl bg-[#2456d6] px-3.5 text-xs font-semibold text-white transition hover:bg-[#1847c2] focus:outline-none focus:ring-2 focus:ring-[#b9cbff] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Commit ready
                </button>
                <button
                  type="button"
                  onClick={onClearFinished}
                  disabled={clearableCount === 0 || controlsDisabled}
                  className="inline-flex min-h-10 items-center rounded-xl border border-[#dde3ee] bg-white px-3 text-xs font-semibold text-[#52617f] transition hover:border-[#b9c8e6] hover:text-[#2456d6] focus:outline-none focus:ring-2 focus:ring-[#b9cbff] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Clear finished
                </button>
              </>
            )}
            <label className="relative min-w-0 flex-1 md:w-64 md:flex-none">
              <span className="sr-only">Search extraction files</span>
              <SearchIcon />
              <input
                type="search"
                value={query}
                onChange={(event) => onQueryChange(event.target.value)}
                placeholder="Search files"
                className="min-h-11 w-full rounded-2xl border border-[#dfe4ee] bg-white pl-10 pr-4 text-sm text-[#273653] outline-none transition placeholder:text-[#a1a9ba] focus:border-[#8ba7ef] focus:ring-2 focus:ring-[#dce6ff]"
              />
            </label>
            <button
              type="button"
              onClick={onRefresh}
              disabled={controlsDisabled}
              className="inline-flex min-h-11 items-center gap-2 rounded-2xl border border-[#dfe4ee] bg-white px-4 text-sm font-semibold text-[#243451] transition hover:border-[#b9c8e6] hover:text-[#2456d6] focus:outline-none focus:ring-2 focus:ring-[#dce6ff] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <RefreshIcon spinning={processing === "refresh"} />
              Refresh
            </button>
          </div>
        </header>

        {inputMode === "text" && (
          <section aria-labelledby="paste-paper-title" className="border-b border-[#e9edf5] bg-[#fbfcff] px-5 py-4 lg:px-7">
            <div className="flex flex-wrap items-end gap-3">
              <label className="min-w-[16rem] flex-1">
                <span id="paste-paper-title" className="text-xs font-semibold text-[#304363]">Paste paper text</span>
                <textarea
                  value={text}
                  onChange={(event) => onTextChange(event.target.value)}
                  placeholder="Paste an abstract, results section, or full paper text…"
                  className="mt-2 h-24 w-full resize-none rounded-xl border border-[#dfe4ee] bg-white px-3 py-2.5 text-sm text-[#273653] outline-none transition placeholder:text-[#a1a9ba] focus:border-[#8ba7ef] focus:ring-2 focus:ring-[#dce6ff]"
                />
              </label>
              <div className="flex gap-2">
                <button type="button" onClick={() => onInputModeChange(null)} className="inline-flex min-h-10 items-center rounded-xl border border-[#dfe4ee] bg-white px-4 text-xs font-semibold text-[#66738e] hover:text-[#2456d6]">Cancel</button>
                <button
                  type="button"
                  onClick={onSubmitText}
                  disabled={controlsDisabled || !text.trim()}
                  className="inline-flex min-h-10 items-center rounded-xl bg-[#2456d6] px-4 text-xs font-semibold text-white hover:bg-[#1847c2] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Add to queue
                </button>
              </div>
            </div>
          </section>
        )}

        {inputMode === "dataset" && <div className="max-h-[26rem] overflow-auto border-b border-[#e9edf5] bg-[#fbfcff] p-4 lg:px-7">{datasetPanel}</div>}
        {showInsights && <div className="max-h-[25rem] overflow-auto border-b border-[#e9edf5]">{insightsPanel}</div>}
        {notices && <div className="space-y-2 border-b border-[#e9edf5] px-5 py-3 lg:px-7">{notices}</div>}

        <div className="min-h-[28rem] flex-1 overflow-auto">
          <table className="w-full min-w-[1100px] table-fixed border-separate border-spacing-0 text-left">
            <colgroup>
              <col className="w-[305px]" /><col className="w-[185px]" /><col className="w-[105px]" />
              <col className="w-[190px]" /><col className="w-[170px]" /><col className="w-[170px]" /><col className="w-[165px]" />
            </colgroup>
            <thead className="sticky top-0 z-10 bg-[#f5f7fd] text-[#818baa]">
              <tr>
                <th scope="col" className="h-14 border-b border-[#e9edf5] px-3 text-xs font-medium">File name</th>
                <th scope="col" className="h-14 border-b border-[#e9edf5] px-3 text-xs font-medium">Extraction status</th>
                <th scope="col" className="h-14 border-b border-[#e9edf5] px-3 text-center text-xs font-medium">Records</th>
                <th scope="col" className="h-14 border-b border-[#e9edf5] px-3 text-xs font-medium">Source / model</th>
                <th scope="col" aria-sort={sortDirection === "asc" ? "ascending" : "descending"} className="h-14 border-b border-[#e9edf5] px-3 text-xs font-medium">
                  <button type="button" onClick={onToggleSort} className="inline-flex items-center gap-1.5 rounded-md focus:outline-none focus:ring-2 focus:ring-[#b9cbff]">
                    Created <SortIcon direction={sortDirection} />
                  </button>
                </th>
                <th scope="col" className="h-14 border-b border-[#e9edf5] px-3 text-xs font-medium">Finished</th>
                <th scope="col" className="h-14 border-b border-[#e9edf5] px-3 text-right text-xs font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-white">
              {pageJobs.map((job) => (
                    <tr key={job.id} className="group h-24 transition hover:bg-[#fbfcff]">
                      <td className="border-b border-[#edf0f6] px-3">
                        <div className="flex min-w-0 items-center gap-3">
                          {renderFileIcon()}
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-[#2c3650]" title={job.filename}>{job.filename}</p>
                            <p className="mt-1 text-[11px] text-[#98a2b8]">{fileKind(job.filename)}</p>
                            {job.status === "error" && job.error && <p className="mt-1 truncate text-[11px] text-rose-600" title={job.error}>{job.error}</p>}
                          </div>
                        </div>
                      </td>
                      <td className="border-b border-[#edf0f6] px-3">{renderStatus(job.status)}</td>
                      <td className="border-b border-[#edf0f6] px-3 text-center font-mono text-sm text-[#3e4961] tnum">{job.recordCount || "—"}</td>
                      <td className="border-b border-[#edf0f6] px-3"><span className="block truncate text-xs text-[#56627c]" title={jobSourceLabel(job)}>{jobSourceLabel(job)}</span></td>
                      <td className="border-b border-[#edf0f6] px-3 font-mono text-[11px] text-[#4a566e] tnum">{formatJobTime(job.createdAt)}</td>
                      <td className="border-b border-[#edf0f6] px-3 font-mono text-[11px] text-[#4a566e] tnum">{formatJobTime(job.completedAt ?? job.committedAt)}</td>
                      <td className="border-b border-[#edf0f6] px-3">
                        <div className="flex items-center justify-end gap-2">
                          {job.status === "committed" && <Link href={`/${domain}/database?status=review`} className="min-h-9 rounded-xl border border-[#dbe3f2] bg-white px-3 py-2 text-[11px] font-semibold text-[#2456d6] transition hover:border-[#9eb4eb] hover:bg-[#f4f7ff]">Open review</Link>}
                          <button
                            type="button"
                            onClick={() => onRemove(job)}
                            disabled={controlsDisabled}
                            className="grid h-9 w-9 place-items-center rounded-xl border border-[#e1e6ef] text-[#9aa5ba] transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600 focus:outline-none focus:ring-2 focus:ring-rose-100 disabled:cursor-not-allowed disabled:opacity-40"
                            aria-label={job.sourceId
                              ? `Delete document and all extracted data: ${job.filename}`
                              : `Remove extraction job: ${job.filename}`}
                            title={job.sourceId
                              ? "Delete document and all extracted data"
                              : "Remove extraction job"}
                          >
                            <TrashIcon />
                          </button>
                        </div>
                      </td>
                    </tr>
              ))}

              {pageJobs.length === 0 && (
                <tr>
                  <td colSpan={7} className="h-[28rem] border-b border-[#edf0f6] px-6 text-center">
                    <div className="mx-auto flex max-w-sm flex-col items-center">
                      <span className="grid h-14 w-14 place-items-center rounded-2xl bg-[#f2f5fb] text-[#8ea0c1]"><EmptyFilesIcon /></span>
                      <h2 className="mt-4 text-base font-semibold text-[#263653]">{jobs.length === 0 ? "No extraction files yet" : "No files in this view"}</h2>
                      <p className="mt-2 text-sm leading-6 text-[#8a95ad]">
                        {jobs.length === 0 ? "Upload a PDF or TXT file from the left panel to begin extracting candidate records." : "Try another status filter or clear the current search."}
                      </p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {committedNotice}

        <footer className="flex min-h-16 flex-wrap items-center justify-between gap-4 border-t border-[#e9edf5] bg-white px-5 py-3 lg:px-7">
          <div aria-label="Extraction status legend" className="flex flex-wrap items-center gap-x-4 gap-y-2">
            {(Object.keys(STATUS_LABELS) as JobStatus[]).map((status) => (
              <span key={status} className="inline-flex items-center gap-1.5 whitespace-nowrap text-[11px] font-medium text-[#66738e]">
                <span className={`h-2.5 w-2.5 rounded-full ${STATUS_DOTS[status]}`} />{STATUS_LABELS[status]}
              </span>
            ))}
          </div>
          <div className="flex items-center gap-3 text-xs text-[#52617f]">
            <span className="whitespace-nowrap">Total {filteredCount}</span>
            <button type="button" onClick={() => onPageChange(Math.max(1, currentPage - 1))} disabled={currentPage <= 1} aria-label="Previous page" className="grid h-9 w-9 place-items-center rounded-full border border-transparent text-[#8590aa] hover:border-[#dfe4ee] hover:text-[#2456d6] disabled:opacity-30"><PaginationIcon direction="previous" /></button>
            <span className="grid h-9 min-w-9 place-items-center rounded-full bg-[#2456d6] px-2 font-semibold text-white">{currentPage}</span>
            <button type="button" onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))} disabled={currentPage >= totalPages} aria-label="Next page" className="grid h-9 w-9 place-items-center rounded-full border border-transparent text-[#8590aa] hover:border-[#dfe4ee] hover:text-[#2456d6] disabled:opacity-30"><PaginationIcon direction="next" /></button>
            <label>
              <span className="sr-only">Rows per page</span>
              <select value={pageSize} onChange={(event) => onPageSizeChange(Number(event.target.value))} className="min-h-10 rounded-xl border border-[#dfe4ee] bg-white px-3 text-xs font-medium text-[#52617f] outline-none focus:border-[#8ba7ef] focus:ring-2 focus:ring-[#dce6ff]">
                {[10, 25, 50].map((size) => <option key={size} value={size}>{size}/page</option>)}
              </select>
            </label>
          </div>
        </footer>
      </div>
    </section>
  );
}

function fileKind(filename: string): string {
  if (filename === "Pasted text") return "Text input";
  if (filename.toLocaleLowerCase().endsWith(".txt")) return "TXT file";
  return "PDF document";
}

function formatJobTime(value?: string): string {
  if (!value) return "—";
  const [date, time = ""] = value.replace("Z", "").split("T");
  return `${date} ${time.slice(0, 8)}`.trim();
}

function jobSourceLabel(job: BatchJob): string {
  if (job.model) return job.model;
  if (job.source === "mock") return "Demo extractor";
  if (job.source) return job.source;
  return job.filename === "Pasted text" ? "Pasted text" : "PDF / text";
}

function SidebarAction({ active, icon, label, onClick }: { active: boolean; icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button type="button" aria-pressed={active} onClick={onClick} className={`flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl px-2 text-center text-[11px] font-medium transition focus:outline-none focus:ring-2 focus:ring-[#b9cbff] lg:min-h-10 lg:flex-row lg:justify-start lg:gap-3 lg:px-4 lg:text-left lg:text-sm ${active ? "bg-[#edf3ff] text-[#2456d6]" : "text-[#53617d] hover:bg-[#f8faff] hover:text-[#2456d6]"}`}>
      <span className="grid h-6 w-6 place-items-center text-current">{icon}</span><span>{label}</span>
    </button>
  );
}

function FolderIcon() {
  return <svg width="19" height="19" viewBox="0 0 24 24" fill="none" aria-hidden><path d="M3.5 6.75A1.75 1.75 0 015.25 5h4l2 2h7.5a1.75 1.75 0 011.75 1.75v8.5A1.75 1.75 0 0118.75 19H5.25a1.75 1.75 0 01-1.75-1.75V6.75z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" /></svg>;
}

function UploadCloudIcon() {
  return <svg width="25" height="25" viewBox="0 0 24 24" fill="none" aria-hidden><path d="M7.5 18.5H6a4 4 0 01-.65-7.95A6.5 6.5 0 0117.9 9.1 4.75 4.75 0 0118.25 18.5H16.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /><path d="M12 19V11m0 0l-3 3m3-3l3 3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function TextInputIcon() {
  return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden><path d="M5 5h14M5 10h14M5 15h8M5 19h5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>;
}

function DatasetIcon() {
  return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden><ellipse cx="12" cy="5.5" rx="7" ry="3" stroke="currentColor" strokeWidth="1.7" /><path d="M5 5.5v6c0 1.66 3.13 3 7 3s7-1.34 7-3v-6M5 11.5v6c0 1.66 3.13 3 7 3s7-1.34 7-3v-6" stroke="currentColor" strokeWidth="1.7" /></svg>;
}

function ActivityIcon() {
  return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden><path d="M4 17l4.25-4.25 3 3L19.5 7.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /><path d="M15 7.5h4.5V12" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>;
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
