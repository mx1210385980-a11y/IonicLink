"use client";
import { TEACHING_FIELDS, type SimpleMode, type SimpleRow, type SimpleStudent } from "@/lib/teaching/simpleShared";
import { requestJson } from "@/components/request";

export const FIELD_LABELS = { cation: "Cation", anion: "Anion", substrate: "Substrate", temperature: "Temperature", load: "Load", cof: "Coefficient of friction" };
export const fieldInput = "min-h-10 w-full rounded-lg border border-ink-200 bg-white px-3 text-sm text-ink-950 focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-100";
export function blankRow(): SimpleRow { return { cation: "", anion: "", substrate: "", temperature: "", load: "", cof: "" }; }
export function accuracy(value: number | null | undefined): string { return value == null ? "—" : `${(value * 100).toFixed(1)}%`; }
export function minutes(seconds: number | null | undefined): string { return seconds == null ? "—" : `${(seconds / 60).toFixed(2)} minutes`; }
export function groupLabel(mode: SimpleMode): string { return mode === "ai" ? "AI Extraction group" : "Manual extraction group"; }
export const STATUS_LABELS = { idle: "Not started", extracting: "Extracting", review: "In review", submitted: "Submitted", error: "Extraction retry pending" };
export function groupSummary(students: SimpleStudent[]) {
  const complete = students.filter((student) => student.status === "submitted" && student.elapsedSeconds != null);
  const scored = complete.filter((student) => student.score);
  return { count: complete.length, scoredCount: scored.length, accuracy: scored.length ? scored.reduce((sum, student) => sum + student.score!.accuracy, 0) / scored.length : null,
    seconds: complete.length ? complete.reduce((sum, student) => sum + student.elapsedSeconds!, 0) / complete.length : null };
}
export function labPost<T>(body: object, url = "/api/teaching/lab"): Promise<T> {
  return requestJson<T>(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }, "Action failed");
}
export async function uploadTable(file: File): Promise<SimpleRow[]> {
  const form = new FormData(); form.set("file", file);
  const result = await requestJson<{ rows: SimpleRow[] }>("/api/teaching/lab/table", { method: "POST", body: form }, "Could not read table");
  return result.rows;
}
export async function signOutTeaching() {
  const response = await fetch("/api/teaching/session", { method: "DELETE" });
  if (!response.ok) throw new Error("Sign-out failed. Try again.");
  window.location.assign("/teaching");
}
export function SimpleRows({ rows, onChange, disabled = false, label = "Extraction table" }: {
  rows: SimpleRow[]; onChange?: (rows: SimpleRow[]) => void; disabled?: boolean; label?: string;
}) {
  return <div>
    <div className="overflow-x-auto rounded-lg border border-ink-200">
      <table aria-label={label} className="w-full text-left text-sm">
        <thead className="bg-ink-50 text-xs text-ink-600"><tr><th className="px-3 py-3">Record</th>
          {TEACHING_FIELDS.map(({ key }) => <th key={key} className="min-w-28 px-3 py-3">{FIELD_LABELS[key]}</th>)}
          {onChange && <th className="px-3 py-3"><span className="sr-only">Actions</span></th>}</tr></thead>
        <tbody>{rows.map((row, index) => <tr key={index} className="border-t border-ink-100">
          <td className="px-3 py-2 tabular-nums text-ink-500">{index + 1}</td>
          {TEACHING_FIELDS.map(({ key }) => <td key={key} className="px-2 py-2">{onChange
            ? <input aria-label={`Record ${index + 1} ${FIELD_LABELS[key]}`} value={row[key]} maxLength={500} disabled={disabled}
              className={`${fieldInput} min-w-24`} onChange={(event) => onChange(rows.map((item, i) => i === index ? { ...item, [key]: event.target.value } : item))} />
            : <span className="block max-w-64 break-words px-1">{row[key] || "Missing"}</span>}</td>)}
          {onChange && <td className="px-2"><button type="button" disabled={disabled || rows.length === 1} onClick={() => onChange(rows.filter((_, i) => i !== index))}
            aria-label={`Delete record ${index + 1}`} className="text-xs text-ink-500 hover:text-red-700 disabled:opacity-30">Delete</button></td>}
        </tr>)}</tbody>
      </table>
      {!rows.length && <p className="p-5 text-sm text-ink-500">No records yet.</p>}
    </div>
    {onChange && <button type="button" className="btn mt-3" disabled={disabled || rows.length >= 100} onClick={() => onChange([...rows, blankRow()])}>＋ Add record</button>}
  </div>;
}
