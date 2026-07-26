"use client";

import type { BBox, EvidenceBasis, FieldProvenance } from "@/lib/schema";

/** Shared form controls for the per-domain record editors. */

/* ------------------------------------------------------------------ */
/* Provenance rows — shared by every domain editor.                    */
/* ------------------------------------------------------------------ */

export interface ProvRow {
  field: string;
  page: string;
  figure: string;
  quote: string;
  basis: string; // "" | EvidenceBasis
  basisNote: string;
  figureBox?: BBox; // carried through edits, not directly editable here
  table?: string; // carried through edits (set by the extractor)
  section?: string;
  context?: string;
}

/** Record's provenance map → editable rows. */
export function provRowsFromRecord(provenance?: Record<string, FieldProvenance>): ProvRow[] {
  return Object.entries(provenance ?? {}).map(([field, p]) => ({
    field,
    page: p.page != null ? String(p.page) : "",
    figure: p.figure ?? "",
    quote: p.quote ?? "",
    basis: p.basis ?? "",
    basisNote: p.basisNote ?? "",
    figureBox: p.figureBox,
    table: p.table,
    section: p.section,
    context: p.context,
  }));
}

/** Editable rows → the flat provenance array the ingest layer expects. */
export function provRowsToFields(rows: ProvRow[]): (FieldProvenance & { field: string })[] {
  return rows
    .filter(
      (r) =>
        r.field.trim() &&
        (r.page.trim() || r.figure.trim() || r.quote.trim() || r.figureBox || r.basis.trim() || r.basisNote.trim())
    )
    .map((r) => ({
      field: r.field,
      page: r.page.trim() && !Number.isNaN(Number(r.page)) ? Number(r.page) : undefined,
      figure: r.figure.trim() || undefined,
      quote: r.quote.trim() || undefined,
      basis: (r.basis.trim() || undefined) as EvidenceBasis | undefined,
      basisNote: r.basisNote.trim() || undefined,
      figureBox: r.figureBox,
      table: r.table,
      section: r.section,
      context: r.context,
    }));
}

/**
 * The provenance card: one row per sourced field — location (page/figure/quote)
 * plus the evidence basis (direct / inferred / assumed) so weakly-supported
 * values are labeled instead of silently passing as located evidence.
 */
export function ProvenanceRows({
  rows,
  onChange,
  fields,
  defaultField,
}: {
  rows: ProvRow[];
  onChange: (rows: ProvRow[]) => void;
  fields: readonly string[];
  defaultField: string;
}) {
  const set = (i: number, key: keyof ProvRow, value: string) =>
    onChange(rows.map((r, idx) => (idx === i ? { ...r, [key]: value } : r)));
  return (
    <div className="mt-3 rounded-xl border border-cyan-200 bg-cyan-50/40 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="label-eyebrow text-cyan-600">Provenance · where each value came from</span>
        <button
          onClick={() =>
            onChange([...rows, { field: defaultField, page: "", figure: "", quote: "", basis: "", basisNote: "" }])
          }
          className="rounded-lg border border-cyan-200 px-2.5 py-1 text-xs font-medium text-cyan-700 hover:bg-cyan-100"
        >
          + Add source
        </button>
      </div>
      {rows.length === 0 && (
        <p className="text-xs text-ink-400">Attach a page / figure / quote to any field so every value is traceable to the paper.</p>
      )}
      <div className="space-y-2">
        {rows.map((r, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <select
              value={r.field}
              onChange={(ev) => set(i, "field", ev.target.value)}
              className="w-28 rounded-lg border border-cyan-200 bg-white px-2 py-1.5 text-sm outline-none focus:border-cyan-400"
            >
              {fields.map((f) => (
                <option key={f} value={f}>{f}</option>
              ))}
            </select>
            <input value={r.page} onChange={(ev) => set(i, "page", ev.target.value)} placeholder="page" inputMode="numeric"
              className="w-16 rounded-lg border border-cyan-200 px-2.5 py-1.5 text-sm outline-none focus:border-cyan-400" />
            <input value={r.figure} onChange={(ev) => set(i, "figure", ev.target.value)} placeholder="figure / table"
              className="w-28 rounded-lg border border-cyan-200 px-2.5 py-1.5 text-sm outline-none focus:border-cyan-400" />
            <input value={r.quote} onChange={(ev) => set(i, "quote", ev.target.value)} placeholder="supporting quote"
              className="min-w-[10rem] flex-1 rounded-lg border border-cyan-200 px-2.5 py-1.5 text-sm outline-none focus:border-cyan-400" />
            <select
              value={r.basis}
              onChange={(ev) => set(i, "basis", ev.target.value)}
              title="Evidence basis: direct = stated for this measurement; inferred = from general/methods context; assumed = convention, not in the paper"
              className={`w-28 rounded-lg border bg-white px-2 py-1.5 text-sm outline-none focus:border-cyan-400 ${
                r.basis === "inferred" || r.basis === "assumed"
                  ? "border-amber-300 text-amber-700"
                  : "border-cyan-200"
              }`}
            >
              <option value="">basis —</option>
              <option value="direct">direct</option>
              <option value="inferred">inferred</option>
              <option value="assumed">assumed</option>
            </select>
            {(r.basis === "inferred" || r.basis === "assumed") && (
              <input value={r.basisNote} onChange={(ev) => set(i, "basisNote", ev.target.value)}
                placeholder="what the inference rests on (e.g. stated for CV/methods, not this measurement)"
                className="min-w-[14rem] flex-1 rounded-lg border border-amber-300 bg-amber-50/40 px-2.5 py-1.5 text-sm outline-none focus:border-amber-400" />
            )}
            <button onClick={() => onChange(rows.filter((_, idx) => idx !== i))}
              className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs text-ink-400 hover:border-rose-200 hover:text-rose-600">✕</button>
          </div>
        ))}
      </div>
    </div>
  );
}

export function Layer({ name, tone, children }: { name: string; tone: "brand" | "slate"; children: React.ReactNode }) {
  const border = tone === "brand" ? "border-brand-200 bg-brand-50/40" : "border-slate-200 bg-slate-50/50";
  return (
    <div className={`mt-3 rounded-xl border p-3 ${border}`}>
      <div className="label-eyebrow mb-2">{name}</div>
      <div className="grid gap-2 sm:grid-cols-3">{children}</div>
    </div>
  );
}

export function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mt-3">
      <div className="label-eyebrow mb-1">{label}</div>
      <div className="grid gap-2 sm:grid-cols-3">{children}</div>
    </div>
  );
}

export function Field({
  label,
  value,
  onChange,
  placeholder,
  mono,
  std,
  req,
  missing,
  warn,
  className = "",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
  std?: string;
  req?: boolean;
  missing?: boolean;
  warn?: boolean;
  className?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-0.5 flex items-center gap-1 text-xs font-medium text-ink-600">
        {label}
        {req && <span className={missing ? "text-amber-600" : "text-brand-500"}>*</span>}
      </span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`w-full rounded-lg border px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-brand-100 ${
          missing ? "border-amber-300" : warn ? "border-amber-300" : "border-slate-200 focus:border-brand-300"
        } ${mono ? "font-mono" : ""}`}
      />
      {std && <span className={`mt-0.5 block text-[10px] ${warn ? "text-amber-600" : "text-ink-400"}`}>{std}</span>}
    </label>
  );
}

export function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
}) {
  return (
    <label className="block">
      <span className="mb-0.5 block text-xs font-medium text-ink-600">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm outline-none focus:border-brand-300"
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {o || "—"}
          </option>
        ))}
      </select>
    </label>
  );
}
