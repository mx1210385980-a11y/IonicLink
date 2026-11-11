"use client";
import { useState } from "react";
import { blankLiveRow, liveFieldGroups, liveFields, type LiveDomain, type LiveRow } from "@/lib/teaching/liveFields";
import { requestJson } from "@/components/request";
import { fieldInput } from "./SimpleTeachingParts";

export async function uploadLiveTable(file: File, domain: LiveDomain): Promise<LiveRow[]> {
  const form = new FormData(); form.set("file", file);
  return (await requestJson<{ rows: LiveRow[] }>(`/api/teaching/live/table?domain=${domain}`, { method: "POST", body: form }, "Could not read table")).rows;
}

export function LiveRows({ rows, domain, onChange, disabled = false, label = "Extraction records" }: {
  rows: LiveRow[]; domain: LiveDomain; onChange?: (rows: LiveRow[]) => void; disabled?: boolean; label?: string;
}) {
  const fields = liveFields(domain);
  const [selected, setSelected] = useState(0);
  const index = Math.min(selected, Math.max(0, rows.length - 1));
  const row = rows[index];
  return <div aria-label={label} className="space-y-3">
    <nav aria-label={`${label} pagination`} className="flex flex-wrap items-center justify-between gap-2 text-xs">
      <span>{rows.length ? `Record ${index + 1} of ${rows.length}` : "No records"}</span>
      <div className="flex gap-2"><button type="button" className="btn" disabled={index === 0} onClick={() => setSelected(index - 1)}>Previous record</button><button type="button" className="btn" disabled={index >= rows.length - 1} onClick={() => setSelected(index + 1)}>Next record</button></div>
    </nav>
    {row && <section key={index} className="rounded-xl border border-ink-200 bg-white p-4">
      <header className="mb-3 flex items-center justify-between gap-3">
        <h5 className="text-sm font-semibold text-ink-800">Record {index + 1}</h5>
        {onChange && <button type="button" className="text-xs text-ink-500 hover:text-rose-700 disabled:opacity-40" disabled={disabled || rows.length <= 1} onClick={() => onChange(rows.filter((_, i) => i !== index))}>Delete record</button>}
      </header>
      {liveFieldGroups(domain).map((group, groupIndex) => {
        const content = <div className="grid gap-x-5 gap-y-3 sm:grid-cols-2">{group.keys.map((key) => fields.find((field) => field.key === key)!).map((field) => <label key={field.key} className="min-w-0 text-xs font-medium text-ink-600">
          {field.label}
          {onChange ? <input aria-label={`Record ${index + 1} ${field.label}`} className={`${fieldInput} mt-1`} value={row[field.key] ?? ""} maxLength={2000} disabled={disabled}
            placeholder={field.example || "Value with unit, or NR"} onChange={(event) => onChange(rows.map((item, i) => i === index ? { ...item, [field.key]: event.target.value } : item))} />
            : <span className="mt-1 block break-words text-sm font-normal text-ink-950">{row[field.key] || "Missing"}</span>}
        </label>)}</div>;
        return groupIndex === 0 ? <div key={group.label}>{content}</div> : <details key={group.label} className="mt-4 border-t border-ink-100 pt-3"><summary className="mb-3 cursor-pointer text-sm font-medium text-ink-700">{group.label}</summary>{content}</details>;
      })}
    </section>}
    {!rows.length && <p className="text-sm text-ink-500">No records yet.</p>}
    {onChange && <button type="button" className="btn" disabled={disabled || rows.length >= 100} onClick={() => { onChange([...rows, blankLiveRow(domain)]); setSelected(rows.length); }}>+ Add record</button>}
  </div>;
}
