"use client";

import Link from "next/link";
import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { RequestError, requestErrorMessage, requestJson } from "@/components/request";
import type { DatasetImportResult } from "@/lib/datasets/types";
import type { Domain } from "@/lib/domain";

type CommitPayload = DatasetImportResult & {
  alreadyCommitted: boolean;
  recordIds: string[];
  recordCount: number;
};

const MAPPING_MODE_LABELS = {
  direct: "直接映射",
  expanded: "拆分映射",
  preserved: "保留在 flexible 层",
  ignored: "忽略（不入库）",
} as const;

const MAPPING_MODE_STYLES = {
  direct: "bg-emerald-100 text-emerald-800",
  expanded: "bg-brand-100 text-brand-800",
  preserved: "bg-amber-100 text-amber-800",
  ignored: "bg-red-100 text-red-700",
} as const;

const DATASET_EXTENSION = /\.(xlsx|csv|tsv)$/i;

export function isSupportedDataset(file: Pick<File, "name">) {
  return DATASET_EXTENSION.test(file.name.trim());
}

export function DatasetImporter({ domain, file, onClose }: { domain: Domain; file: File; onClose: () => void }) {
  const [paperTitle, setPaperTitle] = useState("");
  const [preview, setPreview] = useState<DatasetImportResult | null>(null);
  const [committed, setCommitted] = useState<CommitPayload | null>(null);
  const [busy, setBusy] = useState<"preview" | "commit" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  const supported = domain === "diffusion";

  useEffect(() => {
    setPortalTarget(document.body);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [busy, onClose]);

  const submit = async (mode: "preview" | "commit") => {
    if (busy) return;
    setBusy(mode);
    setError(null);
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("mode", mode);
      if (paperTitle.trim()) form.set("paperTitle", paperTitle.trim());
      const result = await requestJson<DatasetImportResult | CommitPayload>(
        `/api/${domain}/datasets`,
        { method: "POST", body: form },
        mode === "preview" ? "Could not preview dataset" : "Could not import dataset"
      );
      if (mode === "preview") {
        setPreview(result as DatasetImportResult);
        setCommitted(null);
      } else {
        setCommitted(result as CommitPayload);
      }
    } catch (requestError) {
      setError(requestErrorMessage(requestError, "Dataset import failed."));
    } finally {
      setBusy(null);
    }
  };

  const dialog = (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-ink-950/30 p-3 backdrop-blur-[2px] sm:p-6" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !busy) onClose();
    }}>
      <section role="dialog" aria-modal="true" aria-labelledby="dataset-import-title" className="flex max-h-[calc(100vh-1.5rem)] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-ink-200 bg-white shadow-2xl sm:max-h-[calc(100vh-3rem)]">
        <header className="flex items-start justify-between gap-6 border-b border-ink-100 px-5 py-5 sm:px-7">
          <div className="min-w-0">
            <h2 id="dataset-import-title" className="text-xl font-semibold tracking-tight text-ink-950">Import structured data</h2>
            <p className="mt-1 truncate text-sm text-ink-600" title={file.name}>{file.name}</p>
          </div>
          <button type="button" onClick={onClose} disabled={busy !== null} aria-label="Close structured data import" className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-ink-600 hover:bg-ink-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:opacity-40"><CloseIcon /></button>
        </header>

        <div className="min-h-0 flex-1 overflow-auto p-5 sm:p-7">
          {!supported ? (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">No tabular adapter is configured for {domain} yet. Structured data is currently available in the Diffusion workspace.</p>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
                <label className="block text-xs font-semibold text-ink-700">
                  Paper title / source label
                  <input value={paperTitle} onChange={(event) => { setPaperTitle(event.target.value); setPreview(null); setCommitted(null); }} placeholder="Optional; filename is the fallback" className="mt-1 w-full rounded-lg border border-ink-200 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-brand-600 focus:ring-2 focus:ring-brand-100" />
                </label>
                <button type="button" disabled={busy !== null} onClick={() => submit("preview")} className="h-10 rounded-lg bg-ink-900 px-4 text-sm font-semibold text-white hover:bg-ink-800 disabled:cursor-not-allowed disabled:opacity-40">{busy === "preview" ? "Reading…" : "Preview mapping"}</button>
              </div>
              <p className="mt-3 text-xs text-ink-500">The file was selected from the shared upload entry. Preview does not write to the database.</p>
            </>
          )}

          {error && <div className="mt-4"><RequestError>{error}</RequestError></div>}
          {preview && <div className="mt-5 space-y-4" data-testid="dataset-preview">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <PreviewStat label="Source rows" value={preview.inputRows} />
              <PreviewStat label="Review records" value={preview.outputRecords} />
              <PreviewStat label="Invalid rows" value={preview.invalidRows.length} tone={preview.invalidRows.length ? "amber" : "brand"} />
              <PreviewStat label="Mapped columns" value={preview.mappings.filter((item) => item.mode === "direct" || item.mode === "expanded").length} />
            </div>
            {preview.warnings.length > 0 && <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900"><div className="font-semibold">Review these assumptions</div><ul className="mt-1 list-disc space-y-1 pl-4">{preview.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></div>}
            <div className="overflow-x-auto rounded-lg border border-ink-200"><table className="min-w-full text-left text-xs"><thead className="bg-ink-50 text-ink-600"><tr>{["Row", "Species", "Ion pair", "Temperature", "Diffusion", "System"].map((label) => <th key={label} className="whitespace-nowrap px-3 py-2 font-semibold">{label}</th>)}</tr></thead><tbody className="divide-y divide-ink-100 bg-white">{preview.preview.slice(0, 8).map((record) => <tr key={`${record.sheet}-${record.row}-${record.species}`}><td className="whitespace-nowrap px-3 py-2 font-mono text-ink-500">{record.sheet}!{record.row}</td><td className="px-3 py-2 font-semibold text-ink-800">{record.species}</td><td className="whitespace-nowrap px-3 py-2">{record.cation}{record.anion}</td><td className="whitespace-nowrap px-3 py-2 font-mono">{record.temperature}</td><td className="whitespace-nowrap px-3 py-2 font-mono">{record.diffusion}</td><td className="max-w-64 truncate px-3 py-2" title={record.systemName}>{record.systemName || "—"}</td></tr>)}</tbody></table></div>
            <div>
              <p className="mb-1.5 text-xs font-semibold text-ink-700">Column mapping — check what happens to each column before importing</p>
              <div className="max-h-64 overflow-y-auto rounded-lg border border-ink-200">
                <table className="min-w-full text-left text-xs" data-testid="dataset-column-mappings">
                  <thead className="sticky top-0 bg-ink-50 text-ink-600">
                    <tr>
                      <th className="whitespace-nowrap px-3 py-2 font-semibold">Source column</th>
                      <th className="whitespace-nowrap px-3 py-2 font-semibold">Target</th>
                      <th className="whitespace-nowrap px-3 py-2 font-semibold">Handling</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink-100 bg-white">
                    {preview.mappings.map((mapping) => (
                      <tr key={mapping.source} className={mapping.mode === "ignored" ? "bg-red-50/50" : mapping.mode === "preserved" ? "bg-amber-50/40" : ""}>
                        <td className="max-w-56 truncate px-3 py-2 font-mono" title={mapping.source}>{mapping.source}</td>
                        <td className="max-w-64 truncate px-3 py-2 font-mono text-ink-600" title={mapping.target}>{mapping.target}</td>
                        <td className="whitespace-nowrap px-3 py-2">
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${MAPPING_MODE_STYLES[mapping.mode]}`}>
                            {MAPPING_MODE_LABELS[mapping.mode]}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {preview.invalidRows.length > 0 && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-900">
                <div className="font-semibold">These rows will NOT be imported ({preview.invalidRows.length})</div>
                <ul className="mt-1 max-h-32 list-disc space-y-1 overflow-y-auto pl-4">
                  {preview.invalidRows.map((row) => (
                    <li key={`${row.sheet}-${row.row}`}>{row.sheet}!row {row.row}: {row.reason}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-brand-200 bg-brand-50/60 px-3 py-3"><p className="text-xs leading-5 text-brand-900">Import all {preview.outputRecords} valid records to Review. Re-uploading the same file is idempotent.</p><button type="button" disabled={busy !== null || committed !== null} onClick={() => submit("commit")} className="rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-800 disabled:cursor-not-allowed disabled:opacity-50">{busy === "commit" ? "Importing…" : "Import to Review Queue"}</button></div>
          </div>}
          {committed && <div role="status" className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm text-emerald-900"><span>{committed.alreadyCommitted ? "This file was already imported." : "Import complete."} {committed.recordCount} records are in Review.</span><Link href={`/${domain}/database?status=review`} className="font-semibold underline underline-offset-2">Open Review Queue</Link></div>}
        </div>
      </section>
    </div>
  );

  return portalTarget ? createPortal(dialog, portalTarget) : dialog;
}

function PreviewStat({ label, value, tone = "brand" }: { label: string; value: number; tone?: "brand" | "amber" }) {
  return <div className="rounded-lg border border-ink-200 bg-white px-3 py-2"><div className="text-[10px] font-semibold uppercase tracking-wide text-ink-500">{label}</div><div className={`mt-1 font-mono text-xl font-semibold ${tone === "amber" ? "text-amber-700" : "text-brand-700"}`}>{value}</div></div>;
}

function CloseIcon() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden><path d="m6 6 12 12M18 6 6 18" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>;
}
