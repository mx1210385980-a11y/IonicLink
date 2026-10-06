"use client";

import React, { useMemo } from "react";
import type { Domain } from "@/lib/domain";
import type { AnalysisField, AnalysisRecord, EvidenceFilter } from "./analysisTypes";
import { buildQualitySummary, type FieldEvidence } from "./comparison";

interface DatabaseQualityProps {
  domain: Domain;
  records: AnalysisRecord[];
  fields: AnalysisField[];
  evidenceFilter: EvidenceFilter;
  onEvidenceFilterChange: (filter: EvidenceFilter) => void;
}

const EVIDENCE_LABELS: Record<FieldEvidence, string> = { direct: "Direct", inferred: "Inferred", assumed: "Assumed", unassessed: "Unassessed" };

export default function DatabaseQuality({ domain, records, fields, evidenceFilter, onEvidenceFilterChange }: DatabaseQualityProps) {
  const summary = useMemo(() => buildQualitySummary(records, fields), [records, fields]);
  const metric = fields.find((field) => field.key === "metric");
  return (
    <details className="min-w-0 rounded-xl border border-ink-200 bg-white" data-testid="database-quality">
      <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-ink-800">Data & evidence coverage <span className="ml-2 text-xs font-normal text-ink-500">{records.length} records{evidenceFilter !== "all" ? ` · ${EVIDENCE_LABELS[evidenceFilter]} selected` : ""}</span></summary>
      <div className="space-y-4 border-t border-ink-100 p-4">
        <div>
          <p className="mb-2 text-xs font-medium text-ink-700">{metric?.label ?? domain} evidence · select to filter</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" aria-pressed={evidenceFilter === "all"} onClick={() => onEvidenceFilterChange("all")} className={`rounded-lg border px-3 py-2 text-xs ${evidenceFilter === "all" ? "border-brand-300 bg-brand-50 text-brand-800" : "border-ink-200 text-ink-600 hover:bg-ink-50"}`}>All {records.length}</button>
            {(Object.keys(EVIDENCE_LABELS) as FieldEvidence[]).map((basis) => <button key={basis} type="button" aria-pressed={evidenceFilter === basis} onClick={() => onEvidenceFilterChange(basis)} className={`rounded-lg border px-3 py-2 text-xs ${evidenceFilter === basis ? "border-brand-300 bg-brand-50 text-brand-800" : "border-ink-200 text-ink-600 hover:bg-ink-50"}`}>{EVIDENCE_LABELS[basis]} <span className="ml-1 font-semibold tabular-nums">{summary.evidence[basis]}</span></button>)}
          </div>
        </div>
        <p className="text-xs leading-relaxed text-ink-500">Coverage describes stored fields and source locations. Direct, inferred and assumed labels reflect the saved evidence basis; absent labels remain unassessed. Extraction confidence is not measurement uncertainty. Coverage does not establish accuracy or comparability.</p>
        {records.length ? <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2 xl:grid-cols-3">
          {summary.availability.map(({ field, available, located, total }) => <div key={field.key} className="min-w-0">
            <div className="mb-1 flex justify-between gap-2 text-xs"><span className="truncate text-ink-700">{field.label}</span><span className="shrink-0 tabular-nums text-ink-500">{available}/{total} available</span></div>
            <div role="meter" aria-label={`${field.label} availability`} aria-valuemin={0} aria-valuemax={total} aria-valuenow={available} className="h-1.5 overflow-hidden rounded-full bg-ink-100"><div className="h-full rounded-full bg-cyan-600" style={{ width: `${available / total * 100}%` }} /></div>
            <p className="mt-1 text-[10px] text-ink-500">{total - available} missing · {located} with source location or quote</p>
          </div>)}
        </div> : <p className="text-xs text-ink-500">No records in the current scope.</p>}
      </div>
    </details>
  );
}
