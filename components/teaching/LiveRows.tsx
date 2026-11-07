"use client";

import { blankLiveRow, LIVE_EXTRACTION_FIELDS, type LiveRow } from "@/lib/teaching/liveFields";
import { fieldInput } from "./SimpleTeachingParts";

/** Complete-field table shared by the answer key and submitted-record preview. */
export function LiveRows({ rows, onChange, disabled = false, label = "Live extraction table" }: {
  rows: LiveRow[]; onChange?: (rows: LiveRow[]) => void; disabled?: boolean; label?: string;
}) {
  return <div>
    <div className="overflow-x-auto rounded-lg border border-ink-200">
      <table aria-label={label} className="w-full text-left text-sm">
        <thead className="bg-ink-50 text-xs text-ink-600"><tr><th className="sticky left-0 bg-ink-50 px-3 py-3">Record</th>
          {LIVE_EXTRACTION_FIELDS.map(({ key, label: fieldLabel }) => <th key={key} className="min-w-32 whitespace-nowrap px-3 py-3">{fieldLabel}</th>)}
          {onChange && <th className="px-3 py-3"><span className="sr-only">Actions</span></th>}</tr></thead>
        <tbody>{rows.map((row, index) => <tr key={index} className="border-t border-ink-100">
          <td className="sticky left-0 bg-white px-3 py-2 tabular-nums text-ink-500">{index + 1}</td>
          {LIVE_EXTRACTION_FIELDS.map(({ key, label: fieldLabel }) => <td key={key} className="px-2 py-2">{onChange
            ? <input aria-label={`Record ${index + 1} ${fieldLabel}`} value={row[key] ?? ""} maxLength={500} disabled={disabled} placeholder="/"
              className={`${fieldInput} min-w-28`} onChange={(event) => onChange(rows.map((item, i) => i === index ? { ...item, [key]: event.target.value } : item))} />
            : <span className="block max-w-64 break-words px-1">{row[key] || "Missing"}</span>}</td>)}
          {onChange && <td className="px-2"><button type="button" disabled={disabled || rows.length === 1} onClick={() => onChange(rows.filter((_, i) => i !== index))}
            aria-label={`Delete record ${index + 1}`} className="text-xs text-ink-500 hover:text-red-700 disabled:opacity-30">Delete</button></td>}
        </tr>)}</tbody>
      </table>
      {!rows.length && <p className="p-5 text-sm text-ink-500">No records yet.</p>}
    </div>
    {onChange && <button type="button" className="btn mt-3" disabled={disabled || rows.length >= 100} onClick={() => onChange([...rows, blankLiveRow()])}>＋ Add record</button>}
  </div>;
}
