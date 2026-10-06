"use client";

import React, { useMemo } from "react";
import type { Domain } from "@/lib/domain";
import { openRecordEvidence, type UnitMode } from "@/components/recordCardParts";
import { provenanceBadge } from "@/lib/schema";
import type { AnalysisDensity, AnalysisField, AnalysisRecord, AnalysisSort } from "./analysisTypes";

export interface DatabaseTableProps {
  domain: Domain;
  records: AnalysisRecord[];
  fields: AnalysisField[];
  columns: string[];
  onColumnsChange: (keys: string[]) => void;
  sort: AnalysisSort;
  onSortChange: (sort: AnalysisSort) => void;
  units: UnitMode;
  density: AnalysisDensity;
  compareIds: ReadonlySet<string>;
  onToggleCompare: (record: AnalysisRecord) => void;
  onOpenRecord: (record: AnalysisRecord) => void;
  disabled: boolean;
}

export function DatabaseTable({ domain, records, fields, columns, onColumnsChange, sort, onSortChange, units, density, compareIds, onToggleCompare, onOpenRecord, disabled }: DatabaseTableProps) {
  const visibleFields = useMemo(() => {
    const byKey = new Map(fields.map((field) => [field.key, field]));
    return [...new Set(["id", ...columns])].map((key) => byKey.get(key)).filter((field): field is AnalysisField => Boolean(field));
  }, [fields, columns]);
  const compact = density === "compact";
  const spacing = compact ? "px-3 py-2 text-sm" : "px-4 py-3 text-base";

  return <section aria-label="Database table" className="min-w-0 rounded-lg border border-ink-200 bg-white">
    <div className="flex items-center justify-between gap-3 border-b border-ink-200 px-4 py-3">
      <p className="text-sm text-ink-600">{records.length} displayed · Select a value to inspect its evidence.</p>
      <details className="relative shrink-0">
        <summary className="cursor-pointer rounded border border-ink-300 px-3 py-2 text-sm font-semibold text-ink-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600">Columns ({visibleFields.length})</summary>
        <fieldset className="absolute right-0 z-40 mt-2 max-h-80 w-64 overflow-y-auto rounded-lg border border-ink-200 bg-white p-3 shadow-lg">
          <legend className="sr-only">Visible columns</legend>
          {fields.map((field) => <label key={field.key} className="flex min-h-10 cursor-pointer items-center gap-2 px-2 text-sm text-ink-800">
            <input type="checkbox" checked={field.key === "id" || columns.includes(field.key)} disabled={disabled || field.key === "id"} onChange={(event) => onColumnsChange(event.target.checked ? [...new Set(["id", ...columns, field.key])] : ["id", ...columns.filter((key) => key !== field.key && key !== "id")])} className="h-4 w-4 accent-brand-700" />
            {field.label}{field.key === "id" ? " (fixed)" : ""}
          </label>)}
        </fieldset>
      </details>
    </div>
    <div className="max-h-[70vh] overflow-auto" role="region" aria-label="Scrollable database records" tabIndex={0}>
      <table className="w-full border-collapse text-left">
        <caption className="sr-only">{domain} records. Sort by column; open a record for details or add it to comparison.</caption>
        <thead className="sticky top-0 z-20 bg-ink-50">
          <tr>{visibleFields.map((field) => <th key={field.key} scope="col" aria-sort={sort.key === field.key ? sort.direction === "asc" ? "ascending" : "descending" : "none"} className={`${spacing} whitespace-nowrap border-b border-ink-200 ${field.key === "id" ? "sticky left-0 z-30 bg-ink-50" : ""}`}>
            <button type="button" disabled={disabled} onClick={() => onSortChange({ key: field.key, direction: sort.key === field.key && sort.direction === "asc" ? "desc" : "asc" })} className="inline-flex min-h-9 items-center gap-2 rounded font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600 disabled:opacity-50" aria-label={`Sort by ${field.label}`}>
              {field.label}<span aria-hidden className="text-ink-500">{sort.key === field.key ? sort.direction === "asc" ? "↑" : "↓" : "↕"}</span>
            </button>
          </th>)}<th scope="col" className={`${spacing} sticky right-0 z-30 border-b border-l border-ink-200 bg-ink-50`}>Actions</th></tr>
        </thead>
        <tbody>{records.map((record) => <tr key={record.id} className="group border-b border-ink-100 last:border-b-0 hover:bg-brand-50/40">
          {visibleFields.map((field) => {
            const value = field.format(record, units);
            const provenanceKey = field.provenanceKey ?? field.key;
            const evidence = record.provenance?.[provenanceKey];
            const quantity = field.getQuantity?.(record);
            const basis = evidence?.basis;
            const sourceLabel = evidence ? provenanceBadge(evidence) : "";
            const title = quantity?.raw ? `${value}\nAs reported: ${quantity.raw}` : value;
            const width = compact ? field.key === "paper" ? "max-w-64" : "max-w-48" : "max-w-80";
            const valueClass = compact
              ? field.numeric ? "block min-w-16 truncate leading-5" : "line-clamp-2 min-w-16 whitespace-normal break-words leading-5"
              : "block min-w-16 whitespace-normal break-words";
            const evidenceLabel = [basis ? basis[0].toUpperCase() + basis.slice(1) : "Unassessed", sourceLabel].filter(Boolean).join(" · ");
            return <td key={field.key} className={`${spacing} align-top ${field.key === "id" ? "sticky left-0 z-10 bg-white group-hover:bg-brand-50" : ""} ${field.numeric ? "font-mono tabular-nums" : ""}`}>
              {field.key === "id" ? <button type="button" onClick={() => onOpenRecord(record)} disabled={disabled} className="whitespace-nowrap rounded font-mono font-semibold text-brand-800 underline decoration-brand-200 underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600">{value}</button>
                : evidence ? <button type="button" disabled={disabled} title={title} aria-label={`Open evidence for ${field.label} in ${record.id}`} onClick={() => openRecordEvidence({ domain, sourceId: record.sourceId, recordId: record.id, field: provenanceKey, value, prov: evidence })} className={`${width} rounded text-left underline decoration-dotted underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600 ${basis === "inferred" || basis === "assumed" ? "text-amber-800 decoration-amber-400" : "text-ink-900 decoration-brand-300"}`}>
                  <span className={valueClass}>{value}</span>
                  <span title={evidenceLabel} className={`mt-1 block font-sans text-xs leading-4 text-ink-600 ${compact ? "truncate" : ""}`}>{evidenceLabel}</span>
                </button> : <span title={title} className={`${width} ${valueClass} text-ink-800`}>{value}</span>}
            </td>;
          })}
          <td className={`${spacing} sticky right-0 z-10 border-l border-ink-200 bg-white align-top group-hover:bg-brand-50`}><div className="flex items-center gap-2">
            <button type="button" disabled={disabled} onClick={() => onOpenRecord(record)} aria-label={`Open record ${record.id}`} className="hidden min-h-9 items-center rounded border border-ink-300 px-2 text-sm font-semibold text-ink-700 hover:border-brand-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600 sm:inline-flex">Details</button>
            <button type="button" disabled={disabled} aria-pressed={compareIds.has(record.id)} aria-label={`${compareIds.has(record.id) ? "Remove" : "Add"} ${record.id} ${compareIds.has(record.id) ? "from" : "to"} comparison`} onClick={() => onToggleCompare(record)} className={`min-h-9 whitespace-nowrap rounded border px-2 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600 ${compareIds.has(record.id) ? "border-brand-500 bg-brand-50 text-brand-800" : "border-ink-300 text-ink-700 hover:border-brand-400"}`}>{compareIds.has(record.id) ? "✓ Compare" : "+ Compare"}</button>
          </div></td>
        </tr>)}</tbody>
      </table>
      {records.length === 0 ? <p className="p-8 text-center text-sm text-ink-500">No records in this view.</p> : null}
    </div>
  </section>;
}
