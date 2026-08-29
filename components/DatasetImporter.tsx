"use client";

import Link from "next/link";
import React from "react";
import { useState } from "react";
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

export function DatasetImporter({ domain }: { domain: Domain }) {
  const [file, setFile] = useState<File | null>(null);
  const [paperTitle, setPaperTitle] = useState("");
  const [preview, setPreview] = useState<DatasetImportResult | null>(null);
  const [committed, setCommitted] = useState<CommitPayload | null>(null);
  const [busy, setBusy] = useState<"preview" | "commit" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const supported = domain === "diffusion";

  const submit = async (mode: "preview" | "commit") => {
    if (!file || busy) return;
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

  return (
    <section aria-labelledby="dataset-import-title" className="panel overflow-hidden">
      <div className="border-b border-ink-100 bg-gradient-to-r from-cyan-50/80 via-white to-white px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="label-eyebrow text-cyan-700">DIRECT DATA INGESTION</p>
            <h2 id="dataset-import-title" className="mt-1 text-lg font-semibold text-ink-950">Upload a paper dataset</h2>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-ink-600">
              Preview spreadsheet mappings before writing anything. Valid records are standardized and sent to the Review Queue with source row lineage.
            </p>
          </div>
          <span className="rounded-full border border-cyan-200 bg-cyan-50 px-2.5 py-1 font-mono text-[10px] font-semibold text-cyan-800">
            {supported ? "Diffusion adapter v1" : "Adapter pending"}
          </span>
        </div>
      </div>

      <div className="space-y-4 p-5">
        {!supported ? (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            The first tabular adapter is available in the Diffusion workspace. This entry is ready for additional domain adapters.
          </p>
        ) : (
          <>
            <div className="grid gap-3 md:grid-cols-[1.25fr_1fr_auto] md:items-end">
              <label className="block text-xs font-semibold text-ink-700">
                Dataset file
                <input
                  type="file"
                  accept=".xlsx,.csv,.tsv"
                  onChange={(event) => {
                    setFile(event.target.files?.[0] ?? null);
                    setPreview(null);
                    setCommitted(null);
                    setError(null);
                  }}
                  className="mt-1 block w-full rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-cyan-50 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-cyan-800"
                />
              </label>
              <label className="block text-xs font-semibold text-ink-700">
                Paper title / source label
                <input
                  value={paperTitle}
                  onChange={(event) => {
                    setPaperTitle(event.target.value);
                    setPreview(null);
                    setCommitted(null);
                  }}
                  placeholder="Optional; filename is the fallback"
                  className="mt-1 w-full rounded-lg border border-ink-200 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-cyan-400 focus:ring-2 focus:ring-cyan-100"
                />
              </label>
              <button
                type="button"
                disabled={!file || busy !== null}
                onClick={() => submit("preview")}
                className="rounded-lg bg-ink-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-ink-800 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {busy === "preview" ? "Reading…" : "Preview mapping"}
              </button>
            </div>
            <p className="text-xs text-ink-500">Accepted: .xlsx, .csv, .tsv · maximum 20 MB · no database write during preview.</p>
          </>
        )}

        {error && <RequestError>{error}</RequestError>}
        {preview && (
          <div className="space-y-4" data-testid="dataset-preview">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <PreviewStat label="Source rows" value={preview.inputRows} />
              <PreviewStat label="Review records" value={preview.outputRecords} />
              <PreviewStat label="Invalid rows" value={preview.invalidRows.length} tone={preview.invalidRows.length ? "amber" : "brand"} />
              <PreviewStat label="Mapped columns" value={preview.mappings.filter((item) => item.mode !== "preserved").length} />
            </div>

            {preview.warnings.length > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                <div className="font-semibold">Review these assumptions</div>
                <ul className="mt-1 list-disc space-y-1 pl-4">
                  {preview.warnings.map((warning) => <li key={warning}>{warning}</li>)}
                </ul>
              </div>
            )}

            <div className="overflow-x-auto rounded-lg border border-ink-200">
              <table className="min-w-full text-left text-xs">
                <thead className="bg-ink-50 text-ink-600">
                  <tr>
                    {['Row', 'Species', 'Ion pair', 'Temperature', 'Diffusion', 'System'].map((label) => (
                      <th key={label} className="whitespace-nowrap px-3 py-2 font-semibold">{label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-100 bg-white">
                  {preview.preview.slice(0, 8).map((record) => (
                    <tr key={`${record.sheet}-${record.row}-${record.species}`}>
                      <td className="whitespace-nowrap px-3 py-2 font-mono text-ink-500">{record.sheet}!{record.row}</td>
                      <td className="px-3 py-2 font-semibold text-ink-800">{record.species}</td>
                      <td className="whitespace-nowrap px-3 py-2">{record.cation}{record.anion}</td>
                      <td className="whitespace-nowrap px-3 py-2 font-mono">{record.temperature}</td>
                      <td className="whitespace-nowrap px-3 py-2 font-mono">{record.diffusion}</td>
                      <td className="max-w-64 truncate px-3 py-2" title={record.systemName}>{record.systemName || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

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

            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-brand-200 bg-brand-50/60 px-3 py-3">
              <p className="text-xs leading-5 text-brand-900">
                Commit all {preview.outputRecords} valid records to Review. Re-uploading the same file is idempotent.
              </p>
              <button
                type="button"
                disabled={busy !== null || committed !== null}
                onClick={() => submit("commit")}
                className="rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy === "commit" ? "Importing…" : "Import to Review Queue"}
              </button>
            </div>
          </div>
        )}

        {committed && (
          <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm text-emerald-900">
            <span>
              {committed.alreadyCommitted ? "This file was already imported." : "Import complete."} {committed.recordCount} records are in Review.
            </span>
            <Link href={`/${domain}/database?status=review`} className="font-semibold underline underline-offset-2">Open Review Queue</Link>
          </div>
        )}
      </div>
    </section>
  );
}

function PreviewStat({ label, value, tone = "brand" }: { label: string; value: number; tone?: "brand" | "amber" }) {
  const toneClass = tone === "amber" ? "text-amber-700" : "text-brand-700";
  return (
    <div className="rounded-lg border border-ink-200 bg-white px-3 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-ink-500">{label}</div>
      <div className={`mt-1 font-mono text-xl font-semibold ${toneClass}`}>{value}</div>
    </div>
  );
}
