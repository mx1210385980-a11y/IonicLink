"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Domain } from "@/lib/domain";
import { formatStd, parseQuantity } from "@/lib/units";
import {
  countActiveFilters,
  confinedSystemOptions,
  ionOptions,
  numericExtent,
  recordLoadN,
  recordTempK,
  surfaceOptions,
  type FilterOption,
  type RecordFilters,
} from "./recordFilters";

/**
 * Compact filter strip for the Database view: ion (cation/anion) and
 * substrate multi-select pills plus load/temperature range pills, all as
 * small popovers in the established SourceFilter idiom. Filters apply
 * instantly client-side; an active pill glows brand and carries its count.
 */

function usePopover(open: boolean, close: () => void) {
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (ev: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(ev.target as Node)) close();
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") close();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);
  return rootRef;
}

function PillShell({
  label,
  summary,
  active,
  dotClass,
  open,
  onToggle,
  onClear,
  children,
  rootRef,
}: {
  label: string;
  summary: string;
  active: boolean;
  dotClass?: string;
  open: boolean;
  onToggle: () => void;
  onClear: () => void;
  children: React.ReactNode;
  rootRef: React.RefObject<HTMLDivElement>;
}) {
  return (
    <div ref={rootRef} className="relative">
      <div
        className={`flex items-center gap-1 rounded-lg border bg-white py-1 pl-2.5 pr-1.5 text-xs shadow-sm transition ${
          active ? "border-brand-300 ring-2 ring-brand-100" : "border-ink-200"
        }`}
      >
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-haspopup="true"
          aria-label={`Filter by ${label.toLowerCase()}`}
          className="flex min-w-0 items-center gap-1.5 py-0.5 font-semibold text-ink-700 outline-none"
        >
          {dotClass && <span className={`h-2 w-2 shrink-0 rounded-full ${dotClass}`} />}
          <span className="text-ink-500">{label}</span>
          <span className={`max-w-[10rem] truncate font-mono tnum ${active ? "text-brand-700" : "text-ink-400"}`}>{summary}</span>
          <svg width="10" height="10" viewBox="0 0 10 10" className={`shrink-0 text-ink-400 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden>
            <path d="M2 3.5l3 3 3-3" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        {active && (
          <button
            onClick={onClear}
            aria-label={`Clear ${label.toLowerCase()} filter`}
            className="grid h-5 w-5 shrink-0 place-items-center rounded text-ink-400 transition hover:bg-ink-100 hover:text-ink-700"
          >
            ✕
          </button>
        )}
      </div>
      {open && (
        <div className="absolute left-0 top-full z-30 mt-1.5 w-64 max-w-[88vw] overflow-hidden rounded-xl border border-ink-200 bg-white shadow-[0_16px_40px_rgba(15,23,42,0.16)] animate-[home-rise_180ms_ease-out_both]">
          {children}
        </div>
      )}
    </div>
  );
}

function MultiPill({
  label,
  options,
  selected,
  dotClass,
  onChange,
}: {
  label: string;
  options: FilterOption[];
  selected: string[];
  dotClass?: string;
  onChange: (keys: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = usePopover(open, () => setOpen(false));
  const active = selected.length > 0;
  const summary = active
    ? selected.length === 1
      ? options.find((o) => o.key === selected[0])?.label ?? "1"
      : `${selected.length} selected`
    : "any";
  const toggle = (key: string) =>
    onChange(selected.includes(key) ? selected.filter((k) => k !== key) : [...selected, key]);

  return (
    <PillShell
      label={label}
      summary={summary}
      active={active}
      dotClass={dotClass}
      open={open}
      onToggle={() => setOpen((o) => !o)}
      onClear={() => onChange([])}
      rootRef={rootRef}
    >
      <ul role="listbox" aria-label={`${label} options`} aria-multiselectable className="max-h-64 overflow-y-auto p-1.5">
        {options.map((o) => {
          const isSelected = selected.includes(o.key);
          return (
            <li key={o.key}>
              <button
                type="button"
                role="option"
                aria-selected={isSelected}
                onClick={() => toggle(o.key)}
                className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition hover:bg-brand-50/70 ${
                  isSelected ? "font-semibold text-brand-700" : "font-medium text-ink-700"
                }`}
              >
                <span
                  className={`grid h-3.5 w-3.5 shrink-0 place-items-center rounded border text-[9px] leading-none transition ${
                    isSelected ? "border-brand-500 bg-brand-600 text-white" : "border-ink-300 bg-white text-transparent"
                  }`}
                  aria-hidden
                >
                  ✓
                </span>
                <span className="min-w-0 flex-1 truncate font-mono">{o.label}</span>
                <span className="shrink-0 rounded-full border border-ink-100 bg-ink-50 px-1.5 py-0.5 font-mono text-[10px] font-semibold leading-none text-ink-500">
                  {o.count}
                </span>
              </button>
            </li>
          );
        })}
        {options.length === 0 && <li className="px-3 py-4 text-center text-xs text-ink-400">No values on file</li>}
      </ul>
      {active && (
        <div className="border-t border-ink-100 bg-ink-50/40 px-2 py-1.5">
          <button onClick={() => onChange([])} className="rounded px-1.5 py-0.5 text-[11px] font-medium text-ink-500 transition hover:text-brand-700">
            Clear {label.toLowerCase()}
          </button>
        </div>
      )}
    </PillShell>
  );
}

/**
 * Range pill: min/max accepted as text WITH units (the platform's quantity
 * parser), so "10 nN" and "0.5 mN" both work; temperature takes plain kelvin.
 */
function RangePill({
  label,
  dim,
  unitHint,
  extent,
  extentLabel,
  min,
  max,
  onChange,
}: {
  label: string;
  dim: "force" | "temperature";
  unitHint: string;
  extent: [number, number] | null;
  extentLabel: (v: number) => string;
  min: number | null;
  max: number | null;
  onChange: (min: number | null, max: number | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = usePopover(open, () => setOpen(false));
  const [minText, setMinText] = useState("");
  const [maxText, setMaxText] = useState("");
  const active = min != null || max != null;
  const summary = active ? `${min != null ? extentLabel(min) : "…"} – ${max != null ? extentLabel(max) : "…"}` : "any";

  const parseBound = (text: string): number | null | undefined => {
    const t = text.trim();
    if (!t) return null; // empty = unbounded
    const q = parseQuantity(t, dim);
    return q?.std ?? undefined; // undefined = unparseable, keep previous
  };
  const commit = (minT: string, maxT: string) => {
    const lo = parseBound(minT);
    const hi = parseBound(maxT);
    onChange(lo === undefined ? min : lo, hi === undefined ? max : hi);
  };

  const bound = (side: "min" | "max", text: string, set: (v: string) => void) => (
    <label className="flex min-w-0 flex-1 flex-col gap-0.5">
      <span className="label-eyebrow">{side}</span>
      <input
        value={text}
        onChange={(e) => {
          set(e.target.value);
          commit(side === "min" ? e.target.value : minText, side === "max" ? e.target.value : maxText);
        }}
        placeholder={unitHint}
        spellCheck={false}
        aria-label={`${label} ${side}imum`}
        className="w-full rounded-lg border border-ink-200 bg-white px-2 py-1.5 font-mono text-xs tnum shadow-sm outline-none transition focus:border-brand-300 focus:ring-2 focus:ring-brand-100"
      />
    </label>
  );

  return (
    <PillShell
      label={label}
      summary={summary}
      active={active}
      open={open}
      onToggle={() => setOpen((o) => !o)}
      onClear={() => {
        setMinText("");
        setMaxText("");
        onChange(null, null);
      }}
      rootRef={rootRef}
    >
      <div className="space-y-2 p-2.5">
        <div className="flex gap-2">
          {bound("min", minText, setMinText)}
          {bound("max", maxText, setMaxText)}
        </div>
        <p className="text-[10px] leading-relaxed text-ink-400">
          {extent ? (
            <>
              data spans <span className="font-mono text-ink-600 tnum">{extentLabel(extent[0])}</span> –{" "}
              <span className="font-mono text-ink-600 tnum">{extentLabel(extent[1])}</span>
            </>
          ) : (
            "no values on file"
          )}
          {" · "}empty = unbounded · records without a value are excluded while a window is set
        </p>
        {active && (
          <button
            onClick={() => {
              setMinText("");
              setMaxText("");
              onChange(null, null);
            }}
            className="rounded px-1 py-0.5 text-[11px] font-medium text-ink-500 transition hover:text-brand-700"
          >
            Clear {label.toLowerCase()}
          </button>
        )}
      </div>
    </PillShell>
  );
}

export function FilterBar({
  domain,
  records,
  filters,
  shown,
  onChange,
}: {
  domain: Domain;
  records: any[];
  filters: RecordFilters;
  /** Visible record count after filtering (for the live tally). */
  shown: number;
  onChange: (next: RecordFilters) => void;
}) {
  const cationOpts = useMemo(() => ionOptions(records, "cation"), [records]);
  const anionOpts = useMemo(() => ionOptions(records, "anion"), [records]);
  const surfaceOpts = useMemo(() => surfaceOptions(domain, records), [domain, records]);
  const confinedSystemOpts = useMemo(() => (domain === "diffusion" ? confinedSystemOptions(records) : []), [domain, records]);
  const loadExtent = useMemo(() => numericExtent(records, recordLoadN), [records]);
  const tempExtent = useMemo(() => numericExtent(records, recordTempK), [records]);
  const activeCount = countActiveFilters(filters);

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-ink-200/70 bg-ink-50/30 px-5 py-2.5">
      <span className="label-eyebrow mr-0.5">Filter</span>
      <MultiPill
        label="Cation"
        dotClass="bg-cyan-500"
        options={cationOpts}
        selected={filters.cations}
        onChange={(cations) => onChange({ ...filters, cations })}
      />
      <MultiPill
        label="Anion"
        dotClass="bg-emerald-500"
        options={anionOpts}
        selected={filters.anions}
        onChange={(anions) => onChange({ ...filters, anions })}
      />
      {surfaceOpts.length > 0 && (
        <MultiPill
          label={domain === "conductivity" ? "Surface" : "Substrate"}
          options={surfaceOpts}
          selected={filters.surfaces}
          onChange={(surfaces) => onChange({ ...filters, surfaces })}
        />
      )}
      {domain === "diffusion" && (
        <MultiPill
          label="Confined system"
          options={confinedSystemOpts}
          selected={filters.confinedSystems}
          onChange={(confinedSystems) => onChange({ ...filters, confinedSystems: confinedSystems as RecordFilters["confinedSystems"] })}
        />
      )}
      {domain === "tribology" && (
        <RangePill
          label="Load"
          dim="force"
          unitHint="10 nN"
          extent={loadExtent}
          extentLabel={(v) => formatStd(v, "N")}
          min={filters.loadMinN}
          max={filters.loadMaxN}
          onChange={(loadMinN, loadMaxN) => onChange({ ...filters, loadMinN, loadMaxN })}
        />
      )}
      <RangePill
        label="Temp"
        dim="temperature"
        unitHint="298 K"
        extent={tempExtent}
        extentLabel={(v) => `${Number(v.toPrecision(4))} K`}
        min={filters.tempMinK}
        max={filters.tempMaxK}
        onChange={(tempMinK, tempMaxK) => onChange({ ...filters, tempMinK, tempMaxK })}
      />
      {activeCount > 0 && (
        <>
          <button
            onClick={() =>
              onChange({ cations: [], anions: [], surfaces: [], confinedSystems: [], loadMinN: null, loadMaxN: null, tempMinK: null, tempMaxK: null })
            }
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-ink-500 transition hover:bg-ink-100 hover:text-ink-900"
          >
            ✕ Reset ({activeCount})
          </button>
          <span className="ml-auto font-mono text-[11px] text-ink-400 tnum">
            {shown} of {records.length} shown
          </span>
        </>
      )}
    </div>
  );
}
