"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export interface PendingPaperUpload {
  id: string;
  file: File;
  enabled: boolean;
}

const SUPPORTED_PAPER_EXTENSION = /\.(pdf|txt)$/i;

export function isSupportedPaper(file: Pick<File, "name">) {
  return SUPPORTED_PAPER_EXTENSION.test(file.name.trim());
}

export function paperUploadId(file: Pick<File, "name" | "size" | "lastModified">) {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

export function mergePendingPaperUploads(
  current: PendingPaperUpload[],
  incoming: File[]
): PendingPaperUpload[] {
  const next = [...current];
  const known = new Set(current.map((item) => item.id));

  for (const file of incoming) {
    if (!isSupportedPaper(file)) continue;
    const id = paperUploadId(file);
    if (known.has(id)) continue;
    known.add(id);
    next.push({ id, file, enabled: true });
  }

  return next;
}

export function enabledPendingPaperFiles(items: PendingPaperUpload[]) {
  return items.filter((item) => item.enabled).map((item) => item.file);
}

export function formatPaperFileSize(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  const megabytes = bytes / (1024 * 1024);
  return `${megabytes >= 10 ? megabytes.toFixed(0) : megabytes.toFixed(1)} MB`;
}

function UploadIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 16V7m0 0-3.5 3.5M12 7l3.5 3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M7.5 18.5H6a4 4 0 0 1-.45-7.97A6.5 6.5 0 0 1 18 9.25a4.5 4.5 0 0 1 .5 8.97H16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-emerald-500 text-white" aria-hidden="true">
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
        <path d="m3 6.2 1.8 1.9L9 3.9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

function PreviewIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M2.8 12s3.2-5.5 9.2-5.5 9.2 5.5 9.2 5.5-3.2 5.5-9.2 5.5S2.8 12 2.8 12Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <circle cx="12" cy="12" r="2.4" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4.5 7h15M9 3.8h6M7 7l.7 13h8.6L17 7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="m6 6 12 12M18 6 6 18" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

export function PaperUploadDialog({
  open,
  items,
  busy,
  error = null,
  onAddFiles,
  onToggle,
  onRemove,
  onCancel,
  onAnalyze,
}: {
  open: boolean;
  items: PendingPaperUpload[];
  busy: boolean;
  error?: string | null;
  onAddFiles: (files: FileList | File[]) => void;
  onToggle: (id: string) => void;
  onRemove: (id: string) => void;
  onCancel: () => void;
  onAnalyze: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  const enabledCount = items.filter((item) => item.enabled).length;

  useEffect(() => {
    setPortalTarget(document.body);
  }, []);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [busy, onCancel, open]);

  if (!open) return null;

  const previewFile = (file: File) => {
    const url = URL.createObjectURL(file);
    window.open(url, "_blank", "noopener,noreferrer");
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  const dialog = (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-[#0b1e46]/30 p-3 backdrop-blur-[2px] sm:p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onCancel();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="paper-upload-title"
        aria-describedby="paper-upload-description"
        data-testid="paper-upload-dialog"
        className="flex max-h-[calc(100vh-1.5rem)] w-full max-w-[1180px] flex-col overflow-hidden rounded-[24px] border border-[#e6ebf4] bg-white shadow-[0_30px_90px_-25px_rgba(8,36,83,0.35)] sm:max-h-[calc(100vh-3rem)]"
      >
        <header className="flex items-start justify-between gap-6 px-5 pb-5 pt-5 sm:px-8 sm:pt-7">
          <div>
            <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.18em] text-[#6681bd]">Prepare extraction</p>
            <h2 id="paper-upload-title" className="text-2xl font-semibold tracking-[-0.025em] text-[#082453] sm:text-[28px]">
              PDF upload
            </h2>
            <p id="paper-upload-description" className="mt-2 max-w-2xl text-sm leading-6 text-[#7182a6]">
              Review your files first. Extraction starts only after you click Analyze.
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            aria-label="Close upload dialog"
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#f4f7fd] text-[#315ba8] transition hover:bg-[#e9effa] focus:outline-none focus:ring-2 focus:ring-[#2456d6]/30 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <CloseIcon />
          </button>
        </header>

        <div className="flex items-center justify-between gap-4 border-t border-[#edf1f7] px-5 py-4 sm:px-8">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={busy}
            className="inline-flex h-11 items-center gap-2 rounded-xl border border-[#2456d6] px-4 text-sm font-semibold text-[#2456d6] transition hover:bg-[#f3f7ff] focus:outline-none focus:ring-2 focus:ring-[#2456d6]/25 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <UploadIcon />
            Add files
          </button>
          <p className="hidden text-xs font-medium text-[#8a98b5] sm:block">PDF or TXT · duplicate files are ignored</p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.txt,application/pdf,text/plain"
            multiple
            className="sr-only"
            aria-label="Add PDF or text files"
            onChange={(event) => {
              if (event.target.files) onAddFiles(event.target.files);
              event.target.value = "";
            }}
          />
        </div>

        <div className="min-h-0 flex-1 overflow-auto border-y border-[#e9eef6]">
          <div className="sm:min-w-[760px]">
            <div className="hidden grid-cols-[minmax(280px,1.8fr)_120px_190px_170px_110px] bg-[#f2f5fc] px-8 py-3 text-[12px] font-semibold uppercase tracking-[0.08em] text-[#7a8db7] sm:grid">
              <span>File name</span>
              <span>Size</span>
              <span>Upload status</span>
              <span>Data extraction</span>
              <span className="text-right">Operation</span>
            </div>

            <div className="divide-y divide-[#e9eef6]">
              {items.map((item) => (
                <div
                  key={item.id}
                  data-testid="pending-paper-row"
                  className="grid grid-cols-2 items-center gap-x-4 gap-y-4 px-5 py-5 text-sm text-[#263958] sm:min-h-[84px] sm:grid-cols-[minmax(280px,1.8fr)_120px_190px_170px_110px] sm:gap-0 sm:px-8 sm:py-0"
                >
                  <div className="col-span-2 flex min-w-0 items-center gap-3 sm:col-span-1 sm:pr-7">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#edf3ff] text-xs font-bold text-[#3166dd]">
                      {item.file.name.toLowerCase().endsWith(".txt") ? "TXT" : "PDF"}
                    </span>
                    <span className="truncate font-medium" title={item.file.name}>{item.file.name}</span>
                  </div>
                  <span className="text-[#687a9d]"><span className="mr-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#91a0bd] sm:hidden">Size</span>{formatPaperFileSize(item.file.size)}</span>
                  <span className="inline-flex items-center justify-self-end gap-2 font-medium text-emerald-600 sm:justify-self-auto">
                    <CheckIcon /> Ready
                  </span>
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-medium text-[#7182a6] sm:hidden">Extract data</span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={item.enabled}
                      aria-label={`Extract data from ${item.file.name}`}
                      disabled={busy}
                      onClick={() => onToggle(item.id)}
                      className={`relative h-7 w-12 shrink-0 rounded-full transition focus:outline-none focus:ring-2 focus:ring-[#2456d6]/30 disabled:cursor-not-allowed disabled:opacity-50 ${item.enabled ? "bg-[#2456d6]" : "bg-[#d9e0ec]"}`}
                    >
                      <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${item.enabled ? "translate-x-5" : "translate-x-1"}`} />
                    </button>
                  </div>
                  <div className="flex items-center justify-end gap-1">
                    <button
                      type="button"
                      onClick={() => previewFile(item.file)}
                      aria-label={`Preview ${item.file.name}`}
                      className="grid h-9 w-9 place-items-center rounded-lg text-[#2456d6] transition hover:bg-[#edf3ff] focus:outline-none focus:ring-2 focus:ring-[#2456d6]/25"
                    >
                      <PreviewIcon />
                    </button>
                    <button
                      type="button"
                      onClick={() => onRemove(item.id)}
                      disabled={busy}
                      aria-label={`Remove ${item.file.name}`}
                      className="grid h-9 w-9 place-items-center rounded-lg text-rose-500 transition hover:bg-rose-50 focus:outline-none focus:ring-2 focus:ring-rose-200 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <TrashIcon />
                    </button>
                  </div>
                </div>
              ))}
              {items.length === 0 && (
                <div className="grid min-h-[112px] place-items-center px-8 text-sm text-[#8391ad]">
                  Add a PDF or TXT file to prepare an extraction.
                </div>
              )}
            </div>
          </div>
        </div>

        {error && (
          <div role="alert" className="mx-5 mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 sm:mx-8">
            {error}
          </div>
        )}

        <footer className="flex flex-col-reverse items-stretch justify-between gap-3 px-5 py-5 sm:flex-row sm:items-center sm:px-8 sm:py-6">
          <p className="text-center text-xs text-[#7f8da8] sm:text-left">
            {enabledCount} of {items.length} {items.length === 1 ? "file" : "files"} selected
          </p>
          <div className="flex items-center justify-center gap-3 sm:justify-end">
            <button
              type="button"
              onClick={onCancel}
              disabled={busy}
              className="h-11 min-w-[110px] rounded-xl px-5 text-sm font-semibold text-[#7a89a7] transition hover:bg-[#f3f6fa] hover:text-[#415678] focus:outline-none focus:ring-2 focus:ring-slate-200 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              data-testid="analyze-papers"
              onClick={onAnalyze}
              disabled={busy || enabledCount === 0}
              className="h-11 min-w-[190px] rounded-xl bg-[#2456d6] px-7 text-sm font-semibold text-white shadow-[0_10px_24px_-12px_rgba(36,86,214,0.8)] transition hover:bg-[#1849c5] focus:outline-none focus:ring-2 focus:ring-[#2456d6]/30 focus:ring-offset-2 disabled:cursor-not-allowed disabled:bg-[#aab8d7] disabled:shadow-none"
            >
              {busy ? "Adding to queue…" : `Analyze ${enabledCount || ""}`.trim()}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );

  return portalTarget ? createPortal(dialog, portalTarget) : dialog;
}
