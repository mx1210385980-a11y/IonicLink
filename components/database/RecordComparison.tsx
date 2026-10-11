"use client";

import React, { useState } from "react";
import type { Domain } from "@/lib/domain";
import { formatProvenance } from "@/lib/schema";
import { openRecordEvidence, type UnitMode } from "@/components/recordCardParts";
import type { AnalysisField, AnalysisRecord } from "./analysisTypes";
import { buildComparisonCsv, compareField, comparisonWarnings, getFieldEvidence, hasFieldValue } from "./comparison";

interface RecordComparisonProps {
  domain: Domain;
  records: AnalysisRecord[];
  fields: AnalysisField[];
  units: UnitMode;
  onRemove: (id: string) => void;
  onClear: () => void;
  onOpenRecord: (record: AnalysisRecord) => void;
}

export default function RecordComparison({ domain, records, fields, units, onRemove, onClear, onOpenRecord }: RecordComparisonProps) {
  const [differencesOnly, setDifferencesOnly] = useState(false);
  if (!records.length) return null;
  const warnings = comparisonWarnings(records, fields);
  const rows = fields.filter((field) => !["id", "paper", "year"].includes(field.key)).map((field) => ({ field, ...compareField(records, field) }));
  const visibleRows = differencesOnly ? rows.filter((row) => row.state !== "same") : rows;

  function exportCsv() {
    const url = URL.createObjectURL(new Blob([buildComparisonCsv(records, fields, units)], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `ioniclink-${domain}-comparison.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <details open className="min-w-0 rounded-xl border border-brand-200 bg-white" data-testid="record-comparison">
      <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-ink-900">Compare records <span className="ml-1 font-normal text-ink-500">{records.length} / 6</span></summary>
      <div className="space-y-3 border-t border-ink-100 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <label className="flex items-center gap-2 text-xs text-ink-700"><input type="checkbox" checked={differencesOnly} onChange={(event) => setDifferencesOnly(event.target.checked)} className="accent-cyan-700" />Only differences and missing values</label>
          <div className="flex gap-2">
            <button type="button" onClick={exportCsv} className="rounded-lg border border-ink-200 px-3 py-1.5 text-xs text-ink-700 hover:bg-ink-50">Export comparison CSV</button>
            <button type="button" onClick={onClear} className="rounded-lg border border-ink-200 px-3 py-1.5 text-xs text-ink-700 hover:bg-ink-50">Clear comparison</button>
          </div>
        </div>
        <p className="text-xs leading-relaxed text-ink-500">Check methods, scales, surfaces and experimental conditions before interpreting performance differences. “Same” compares stored values in canonical units, including ranges, qualifiers and evidence basis; it does not establish scientific comparability.</p>
        {records.length === 1 ? <p className="text-xs text-brand-700">Select another record to compare conditions across papers.</p> : null}
        {warnings.length ? <ul className="space-y-1 rounded-lg bg-amber-50 p-3 text-xs text-amber-800">{warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul> : null}
        <div className="max-w-full overflow-x-auto rounded-lg border border-ink-200" tabIndex={0} role="region" aria-label="Record comparison table">
          <table className="w-full border-collapse text-left text-xs">
            <caption className="sr-only">Selected records, experimental conditions, differences and field evidence</caption>
            <thead>
              <tr className="border-b border-ink-200 bg-ink-50">
                <th scope="col" className="sticky left-0 z-10 min-w-40 bg-ink-50 p-3 align-top font-semibold text-ink-700">Field / difference</th>
                {records.map((record) => <th key={record.id} scope="col" className="min-w-52 max-w-72 p-3 align-top font-normal">
                  <div className="flex items-start justify-between gap-2"><button type="button" onClick={() => onOpenRecord(record)} className="break-all text-left font-semibold text-brand-700 hover:underline">{record.id}</button><button type="button" onClick={() => onRemove(record.id)} aria-label={`Remove ${record.id} from comparison`} className="rounded px-1 text-ink-500 hover:bg-ink-100">×</button></div>
                  <p className="mt-1 line-clamp-3 leading-relaxed text-ink-700" title={record.paper.title}>{record.paper.title || "Untitled paper"}</p>
                  <p className="mt-1 text-ink-500">{record.paper.year ?? "Year not reported"}</p>
                  {record.paper.doi ? <a href={`https://doi.org/${encodeURIComponent(record.paper.doi)}`} target="_blank" rel="noreferrer" className="mt-1 block break-all text-brand-700 hover:underline">DOI: {record.paper.doi}</a> : null}
                </th>)}
              </tr>
            </thead>
            <tbody>
              {visibleRows.map(({ field, state, missing, different }) => <tr key={field.key} className="border-b border-ink-100 last:border-0">
                <th scope="row" className="sticky left-0 z-10 min-w-40 bg-white p-3 align-top font-medium text-ink-800">
                  {field.label}<span className={`mt-1 block text-[10px] font-normal ${state === "same" ? "text-ink-500" : state === "missing" ? "text-amber-700" : "text-brand-700"}`}>{state === "same" ? "Same" : state === "missing" ? `${missing} missing${different ? " · others differ" : ""}` : "Different"}</span>
                </th>
                {records.map((record) => {
                  const provenance = record.provenance?.[field.provenanceKey ?? field.key];
                  const present = hasFieldValue(record, field);
                  const value = field.format(record, units);
                  return <td key={record.id} className={`p-3 align-top ${!present ? "bg-amber-50/50" : different ? "bg-cyan-50/40" : ""}`}>
                    {provenance ? <button type="button" onClick={() => openRecordEvidence({ domain, sourceId: record.sourceId, recordId: record.id, field: field.provenanceKey ?? field.key, value, prov: provenance })} title={formatProvenance(provenance)} className="text-left text-brand-700 underline decoration-dotted underline-offset-4">{value}</button> : <span className="text-ink-800">{value}</span>}
                    {!present ? <span className="mt-1 block text-[10px] text-amber-700">Not reported / unknown</span> : null}
                    {field.provenanceKey ? <span className="mt-1 block text-[10px] capitalize text-ink-500">{getFieldEvidence(record, field)} evidence</span> : null}
                  </td>;
                })}
              </tr>)}
              {!visibleRows.length ? <tr><td colSpan={records.length + 1} className="p-4 text-ink-500">All available fields match, including evidence basis.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </div>
    </details>
  );
}
