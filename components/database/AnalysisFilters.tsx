"use client";

import type { AnalysisState } from "./analysisState";
import type { AnalysisConstraint, AnalysisField, AnalysisRecord } from "./analysisTypes";

export function AnalysisFilters({ records, fields, state, onChange }: {
  records: AnalysisRecord[]; fields: AnalysisField[]; state: AnalysisState; onChange: (state: AnalysisState) => void;
}) {
  const numeric = fields.filter((field) => field.numeric);
  const methods = [...new Set(records.map((record) => record.extended?.method).filter((method): method is string => typeof method === "string" && Boolean(method)))].sort();
  if (state.method && !methods.includes(state.method)) methods.push(state.method);
  const count = state.constraints.filter((item) => item.min != null || item.max != null || item.missing !== "any").length + Number(Boolean(state.method)) + Number(Boolean(state.context.trim()));
  const updateConstraint = (index: number, patch: Partial<AnalysisConstraint>) => onChange({ ...state, plotIds: null, constraints: state.constraints.map((item, i) => i === index ? { ...item, ...patch } : item) });
  const parseNumber = (value: string) => value.trim() === "" || !Number.isFinite(Number(value)) ? null : Number(value);
  return <details className="border-b border-ink-200 bg-ink-50/60 px-4 py-2" data-testid="analysis-filters">
    <summary className="cursor-pointer py-1 text-sm font-semibold text-ink-700">Advanced filters{count ? ` · ${count} active` : ""}</summary>
    <div className="mt-2 flex flex-wrap gap-3">
      <label className="flex flex-col gap-1 text-sm">Measurement method
        <select aria-label="Measurement method" className="max-w-80 rounded border border-ink-300 bg-white p-2" value={state.method} onChange={(event) => onChange({ ...state, method: event.target.value, plotIds: null })}>
          <option value="">All methods</option>{methods.map((method) => <option key={method}>{method}</option>)}
        </select>
      </label>
      <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm">Composition / environment
        <input aria-label="Composition or environment" value={state.context} placeholder="Water content, concentration, additives…" className="min-w-0 rounded border border-ink-300 bg-white p-2" onChange={(event) => onChange({ ...state, context: event.target.value, plotIds: null })} />
      </label>
    </div>
    <div className="mt-3 space-y-2">
      {state.constraints.map((constraint, index) => {
        const field = numeric.find((candidate) => candidate.key === constraint.field);
        const invalid = constraint.min != null && constraint.max != null && constraint.min > constraint.max;
        return <div key={index} className="flex flex-wrap items-center gap-2 rounded border border-ink-200 bg-white p-2">
          <select aria-label={`Range field ${index + 1}`} value={constraint.field} className="max-w-64 rounded border border-ink-200 p-2 text-sm" onChange={(event) => updateConstraint(index, { field: event.target.value, min: null, max: null })}>
            {numeric.map((item) => <option key={item.key} value={item.key}>{item.label}{item.unit ? ` (${item.unit})` : ""}</option>)}
          </select>
          <input type="number" step="any" aria-label={`Minimum ${field?.label ?? constraint.field}`} placeholder="Min" disabled={constraint.missing === "missing"} value={constraint.min ?? ""} onChange={(event) => updateConstraint(index, { min: parseNumber(event.target.value) })} className="w-28 rounded border border-ink-200 p-2 text-sm disabled:opacity-40" />
          <span aria-hidden>–</span>
          <input type="number" step="any" aria-label={`Maximum ${field?.label ?? constraint.field}`} placeholder="Max" disabled={constraint.missing === "missing"} value={constraint.max ?? ""} onChange={(event) => updateConstraint(index, { max: parseNumber(event.target.value) })} className="w-28 rounded border border-ink-200 p-2 text-sm disabled:opacity-40" />
          <select aria-label={`Missing values for ${field?.label ?? constraint.field}`} value={constraint.missing} onChange={(event) => updateConstraint(index, { missing: event.target.value as AnalysisConstraint["missing"] })} className="rounded border border-ink-200 p-2 text-sm">
            <option value="any">Any availability</option><option value="present">Has numeric value</option><option value="missing">Missing numeric value</option>
          </select>
          <button type="button" aria-label={`Remove range ${index + 1}`} onClick={() => onChange({ ...state, plotIds: null, constraints: state.constraints.filter((_, i) => i !== index) })} className="rounded px-3 py-2 text-ink-500 hover:bg-ink-100">×</button>
          {invalid && <span role="status" className="text-sm text-amber-800">Minimum exceeds maximum.</span>}
        </div>;
      })}
    </div>
    <div className="mt-2 flex flex-wrap items-center gap-3 pb-2">
      <button type="button" disabled={state.constraints.length >= 8 || numeric.length === 0} className="btn disabled:opacity-40" onClick={() => onChange({ ...state, constraints: [...state.constraints, { field: "metric", min: null, max: null, missing: "any" }] })}>+ Numeric condition</button>
      <span className="text-xs text-ink-500">Bounds use the units shown above. Ranges must fit entirely; qualified single values are excluded from bounded queries.</span>
    </div>
  </details>;
}
