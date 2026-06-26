"use client";

import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { Quantity } from "@/lib/units";
import { stdLabel } from "@/lib/units";
import type { Domain } from "@/lib/domain";
import type { IonDescriptor } from "@/lib/predict/descriptors";
import type { Prediction } from "@/lib/predict/engine";
import { CALIBRATION_GATE } from "@/lib/predict/engine";
import type { DomainDataset } from "@/lib/predict/dataset";
import type { DesignSpec } from "@/lib/predict/specs";
import { fmtK, TierBadge } from "./studioParts";

export interface ConditionText {
  load: string;
  velocity: string;
  potential: string;
  film: string;
}

export interface ParsedConditions {
  loadQ: Quantity | null;
  velocityQ: Quantity | null;
  potentialQ: Quantity | null;
  filmQ: Quantity | null;
  filmLayers: number | null;
}

/**
 * Zone 1 — the predict bench. Controls left, instrument readout right.
 * Readout color semantics are strict: teal glow = a database measurement,
 * violet glow = a model estimate, and the refusal state shows no number.
 *
 * Inputs are pick-first: ions come from a searchable evidence vocabulary and
 * operating conditions offer click-to-fill chips of measured values, so a
 * query never requires typing unit syntax by hand. Free text stays available
 * — the chips emit exactly the text the parser accepts.
 */

const num = (x: number) => String(Number(x.toPrecision(3)));

export function formatForceText(n: number): string {
  const a = Math.abs(n);
  if (a < 1e-6) return `${num(n * 1e9)} nN`;
  if (a < 1e-3) return `${num(n * 1e6)} µN`;
  if (a < 1) return `${num(n * 1e3)} mN`;
  return `${num(n)} N`;
}

export function formatVelocityText(v: number): string {
  const a = Math.abs(v);
  if (a < 1e-6) return `${num(v * 1e9)} nm/s`;
  if (a < 1e-3) return `${num(v * 1e6)} µm/s`;
  if (a < 1) return `${num(v * 1e3)} mm/s`;
  return `${num(v)} m/s`;
}

export function formatPotentialText(v: number): string {
  return `${v > 0 ? "+" : ""}${num(v)} V`;
}

export interface ConditionEvidence {
  load: string[];
  velocity: string[];
  potential: string[];
  film: string[];
}

/**
 * The distinct measured operating-condition values in this pool, as
 * parser-ready text chips — most frequent first, then shown ascending.
 */
export function conditionEvidence(dataset: DomainDataset, cap = 4): ConditionEvidence {
  const loads: number[] = [];
  const velocities: number[] = [];
  const potentials: number[] = [];
  const films: string[] = [];
  for (const p of dataset.points) {
    const c = p.conditions;
    if (!c) continue;
    if (c.loadN != null) loads.push(c.loadN);
    if (c.velocityMps != null) velocities.push(c.velocityMps);
    if (c.potentialV != null) potentials.push(c.potentialV);
    if (c.filmLayers != null) films.push(`${num(c.filmLayers)} layers`);
    else if (c.filmThicknessM != null) films.push(`${num(c.filmThicknessM * 1e9)} nm`);
  }
  const top = (texts: string[]) => {
    const freq = new Map<string, number>();
    for (const t of texts) freq.set(t, (freq.get(t) ?? 0) + 1);
    return [...freq.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, cap)
      .map(([t]) => t)
      .sort((a, b) => parseFloat(a) - parseFloat(b));
  };
  return {
    load: top(loads.map(formatForceText)),
    velocity: top(velocities.map(formatVelocityText)),
    potential: top(potentials.map(formatPotentialText)),
    film: top(films),
  };
}

interface BenchProps {
  domain: Domain;
  spec: DesignSpec;
  dataset: DomainDataset;
  prediction: Prediction;
  cationText: string;
  anionText: string;
  cation: IonDescriptor;
  anion: IonDescriptor;
  cationOptions: IonDescriptor[];
  anionOptions: IonDescriptor[];
  tempK: number;
  substrate: string;
  species: string;
  conditions: ConditionText;
  parsedConditions: ParsedConditions | null;
  onCation: (v: string) => void;
  onAnion: (v: string) => void;
  onTempK: (v: number) => void;
  onSubstrate: (v: string) => void;
  onSpecies: (v: string) => void;
  onConditions: (patch: Partial<ConditionText>) => void;
}

function ConditionField({
  label,
  value,
  placeholder,
  std,
  ticks = [],
  onChange,
}: {
  label: string;
  value: string;
  placeholder: string;
  std: string | null;
  ticks?: string[];
  onChange: (v: string) => void;
}) {
  const id = `studio-cond-${label.toLowerCase().replace(/\s+/g, "-")}`;
  const unparsed = value.trim() !== "" && std == null;
  return (
    <div>
      <label className="label-eyebrow" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        placeholder={placeholder}
        className="mt-1 min-h-[38px] w-full rounded-[8px] border border-ink-200 bg-white px-2.5 py-1.5 font-mono text-xs tnum outline-none transition focus:border-brand-300 focus:ring-2 focus:ring-brand-100"
      />
      <p className={`mt-0.5 text-[10px] ${unparsed ? "font-medium text-amber-600" : "text-ink-400"}`}>
        {value.trim() === "" ? "any" : unparsed ? "unparsed — add a unit" : std}
      </p>
      {ticks.length > 0 && (
        <p className="mt-0.5 flex flex-wrap items-center gap-x-0.5 gap-y-0.5 text-[10px] text-ink-400">
          <span className="mr-0.5">measured:</span>
          {ticks.map((t) => (
            <button
              key={t}
              type="button"
              aria-pressed={value === t}
              title={value === t ? "Clear — back to any" : `Use the measured value ${t}`}
              onClick={() => onChange(value === t ? "" : t)}
              className={`rounded px-1 font-mono tnum transition ${
                value === t ? "bg-brand-50 font-semibold text-brand-700" : "text-ink-600 hover:bg-ink-100"
              }`}
            >
              {t}
            </button>
          ))}
        </p>
      )}
    </div>
  );
}

/**
 * Pick-first ion input: a popover listing every ion that carries evidence in
 * this pool (sorted by data volume), searchable, with free-text entry kept as
 * an explicit "featurize a new ion" escape hatch.
 */
function IonPicker({
  kind,
  text,
  ion,
  options,
  counts,
  onChange,
}: {
  kind: "cation" | "anion";
  text: string;
  ion: IonDescriptor;
  options: IonDescriptor[];
  counts: Map<string, number>;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const isCation = kind === "cation";
  const tone = isCation ? "text-cyan-700" : "text-emerald-700";

  const sorted = useMemo(
    () =>
      [...options].sort(
        (a, b) => (counts.get(b.key) ?? 0) - (counts.get(a.key) ?? 0) || a.label.localeCompare(b.label)
      ),
    [options, counts]
  );
  const q = query.trim().toLowerCase();
  const matches = q ? sorted.filter((o) => `${o.label} ${o.name} ${o.family}`.toLowerCase().includes(q)) : sorted;
  // Anything typed can still go to the featurizer verbatim — as a deliberate row, not a silent fallback.
  const custom = q && !matches.some((o) => o.label.toLowerCase() === q) ? query.trim() : null;
  const itemCount = matches.length + (custom ? 1 : 0);

  useEffect(() => {
    if (!open) return;
    const onDown = (ev: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(ev.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  useEffect(() => {
    listRef.current?.querySelector('[data-highlighted="true"]')?.scrollIntoView({ block: "nearest" });
  }, [highlight]);

  const choose = (v: string) => {
    onChange(v);
    setOpen(false);
  };

  const onKeyDown = (ev: React.KeyboardEvent) => {
    if (ev.key === "Escape") return setOpen(false);
    if (ev.key === "ArrowDown") {
      ev.preventDefault();
      setHighlight((h) => Math.min(h + 1, itemCount - 1));
    } else if (ev.key === "ArrowUp") {
      ev.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (ev.key === "Enter") {
      ev.preventDefault();
      if (highlight < matches.length) choose(matches[highlight].label);
      else if (custom) choose(custom);
    }
  };

  return (
    <div ref={rootRef} data-testid={`ion-picker-${kind}`} className="relative">
      <span className="label-eyebrow">{isCation ? "Cation +" : "Anion −"}</span>
      <button
        type="button"
        onClick={() => {
          setQuery("");
          setHighlight(0);
          setOpen((o) => !o);
        }}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={`Choose ${kind}`}
        className="mt-1 flex min-h-[40px] w-full items-center gap-2 rounded-[8px] border border-ink-200 bg-white px-2.5 py-1.5 text-left outline-none transition hover:border-brand-300 focus:border-brand-300 focus:ring-2 focus:ring-brand-100"
      >
        <span
          className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border text-xs font-black leading-none ${
            isCation ? "border-cyan-200 bg-cyan-50 text-cyan-600" : "border-emerald-200 bg-emerald-50 text-emerald-600"
          }`}
        >
          {isCation ? "+" : "−"}
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-sm font-semibold text-ink-900">{text || "—"}</span>
        <ChevronGlyph open={open} />
      </button>
      {ion.resolved ? (
        <p className="mt-1 text-[11px] text-ink-700">
          <span className={`font-mono font-semibold ${tone}`}>{ion.label}</span> · {ion.name} · {ion.family}
          {ion.chainLength > 0 && <> · C{ion.chainLength} chain</>}
        </p>
      ) : (
        <p className="mt-1 text-[11px] font-medium text-amber-600">unrecognized — cannot featurize this ion</p>
      )}

      {open && (
        <div
          data-testid={`ion-picker-popover-${kind}`}
          className="absolute left-0 top-full z-30 mt-1 w-full min-w-[18rem] overflow-hidden rounded-xl border border-ink-200 bg-white shadow-[0_16px_40px_rgba(15,23,42,0.16)]"
        >
          <div className="relative border-b border-ink-100 p-2">
            <SearchGlyph />
            <input
              autoFocus
              value={query}
              onChange={(ev) => {
                setQuery(ev.target.value);
                setHighlight(0);
              }}
              onKeyDown={onKeyDown}
              spellCheck={false}
              placeholder={`Search ${kind}s — or type a new one…`}
              aria-label={`Search ${kind} list`}
              className="w-full rounded-lg border border-ink-200 bg-ink-50/50 py-1.5 pl-8 pr-3 font-mono text-xs outline-none transition focus:border-brand-300 focus:bg-white focus:ring-2 focus:ring-brand-100"
            />
          </div>
          <ul ref={listRef} role="listbox" aria-label={`${kind} options`} className="max-h-64 overflow-y-auto p-1.5">
            {matches.map((o, i) => {
              const isSelected = ion.resolved && o.key === ion.key;
              const n = counts.get(o.key) ?? 0;
              return (
                <li key={o.key}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    data-highlighted={i === highlight || undefined}
                    onClick={() => choose(o.label)}
                    onMouseEnter={() => setHighlight(i)}
                    title={`${o.name} · ${o.family}`}
                    className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition ${
                      i === highlight ? "bg-brand-50/70" : ""
                    }`}
                  >
                    <span className={`shrink-0 font-mono text-xs font-semibold ${isSelected ? "text-brand-700" : tone}`}>
                      {o.label}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[11px] text-ink-500">{o.name}</span>
                    <span className="shrink-0 rounded-full border border-ink-100 bg-ink-50 px-1.5 py-0.5 font-mono text-[9px] font-semibold leading-none text-ink-500">
                      {n} pt{n === 1 ? "" : "s"}
                    </span>
                  </button>
                </li>
              );
            })}
            {custom && (
              <li>
                <button
                  type="button"
                  role="option"
                  aria-selected={false}
                  data-highlighted={highlight === matches.length || undefined}
                  onClick={() => choose(custom)}
                  onMouseEnter={() => setHighlight(matches.length)}
                  className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[11px] transition ${
                    highlight === matches.length ? "bg-brand-50/70" : ""
                  }`}
                >
                  <span className="text-ink-500">
                    Use <span className={`font-mono font-semibold ${tone}`}>{custom}</span> — featurize a new ion (no measured data)
                  </span>
                </button>
              </li>
            )}
            {itemCount === 0 && <li className="px-3 py-5 text-center text-xs text-ink-400">No ion matches “{query}”</li>}
          </ul>
          <div className="whitespace-nowrap border-t border-ink-100 bg-ink-50/40 px-3 py-1.5 font-mono text-[10px] font-medium text-ink-400">
            {options.length} {kind}s · most data first
          </div>
        </div>
      )}
    </div>
  );
}

function ChevronGlyph({ open }: { open: boolean }) {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" className={`shrink-0 text-ink-400 transition-transform ${open ? "rotate-180" : ""}`}>
      <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SearchGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink-400">
      <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.8" />
      <path d="M20 20l-3.2-3.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function PathwayChip({ domain, prediction }: { domain: Domain; prediction: Prediction }) {
  if (domain !== "tribology") return null;
  const b = prediction.facts.pathway === "B";
  return (
    <span
      className={`whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
        b ? "border-violet-200 bg-violet-50 text-violet-700" : "border-ink-200 bg-ink-50 text-ink-600"
      }`}
      title={
        b
          ? `Interfacial structure-enhanced model — trained only on the ${prediction.facts.usableN} records reporting film thickness`
          : "Conservative model — the film-thickness column is not consulted (and never imputed)"
      }
    >
      {b ? `Dataset-B · interfacial (${prediction.facts.usableN} pts)` : "Dataset-A · conservative"}
    </span>
  );
}

function ResultFact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-[7px] border border-ink-100 bg-white px-2.5 py-1.5">
      <div className="label-eyebrow text-ink-400">{label}</div>
      <div className="mt-0.5 text-xs leading-relaxed text-ink-700">{children}</div>
    </div>
  );
}

function Readout({ domain, spec, prediction, dataset }: { domain: Domain; spec: DesignSpec; prediction: Prediction; dataset: DomainDataset }) {
  const p = prediction;

  if (p.kind === "measured" && p.value != null) {
    return (
      <div className="rounded-[8px] border border-brand-100 bg-white p-3">
        <div className="label-eyebrow text-brand-700">Measured record</div>
        <div className="mt-1 font-mono text-[2.1rem] font-semibold leading-none text-ink-950 tnum">{spec.formatValue(p.value)}</div>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-ink-700">
          <span className="rounded-full border border-brand-100 bg-brand-50 px-2 py-0.5 font-semibold text-brand-700">
            not a prediction
          </span>
          <span>
            {p.neighbors.length} matching record{p.neighbors.length === 1 ? "" : "s"} at these conditions
          </span>
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <ResultFact label="Readout">{spec.readoutLabel}</ResultFact>
          <ResultFact label="Evidence">
            {p.neighbors.length} matching record{p.neighbors.length === 1 ? "" : "s"}
          </ResultFact>
        </div>
      </div>
    );
  }

  if (p.kind === "estimate" && !p.gated && p.value != null) {
    return (
      <div className="rounded-[8px] border border-violet-100 bg-white p-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="label-eyebrow text-violet-700">Estimated</div>
            <div className="mt-1 font-mono text-[2.1rem] font-semibold leading-none text-ink-950 tnum">
              {spec.formatValue(p.value)}
            </div>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <TierBadge tier={p.tier} />
            <PathwayChip domain={domain} prediction={p} />
          </div>
        </div>
        <div className="mt-2 font-mono text-xs text-ink-700 tnum">
          ×/÷ {p.fold?.toFixed(2)}{" "}
          <span className="text-ink-600">
            → {spec.formatValue(p.low as number)} … {spec.formatValue(p.high as number)}
          </span>
        </div>
        <p className="mt-1 text-[10px] text-ink-600">evidence spread (×/÷), not a calibrated CI · 2 significant figures</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <ResultFact label="Readout">{spec.readoutLabel}</ResultFact>
          <ResultFact label="Result kind">Estimated</ResultFact>
          <ResultFact label="Evidence">
            {p.neighbors.length} weighted analog{p.neighbors.length === 1 ? "" : "s"}
          </ResultFact>
          {p.fold != null && <ResultFact label="Calibration">×/÷ {p.fold.toFixed(2)}</ResultFact>}
          <ResultFact label="Pathway">{domain === "tribology" ? `Dataset-${p.facts.pathway}` : "Similarity model"}</ResultFact>
          <ResultFact label="Details">
            n_eff {p.facts.nEff.toFixed(1)} · {p.facts.usableN} usable records
          </ResultFact>
        </div>
        <details className="mt-2 text-[11px] text-ink-600">
          <summary className="cursor-pointer select-none font-medium text-ink-800">Why this tier</summary>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            {p.reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
            <li>
              n_eff {p.facts.nEff.toFixed(1)} · d₁ {p.facts.d1?.toFixed(2)} · bandwidth {p.facts.bandwidth.toFixed(2)} ·
              official fraction {(p.facts.officialFraction * 100).toFixed(0)}%
            </li>
          </ul>
        </details>
      </div>
    );
  }

  // Refusal panel — the designed state, not an error.
  const gatedMsg =
    p.kind === "estimate" && p.gated
      ? `Statistical estimates unlock at ${CALIBRATION_GATE} usable records — this pool has ${p.facts.usableN}.`
      : null;
  return (
    <div className="rounded-[8px] border border-dashed border-ink-300 bg-white p-3">
      <div className="label-eyebrow">No number — by design</div>
      <div className="mt-1 font-mono text-[2.1rem] font-semibold leading-none text-ink-300">—</div>
      <p className="mt-2 max-w-md text-xs leading-relaxed text-ink-700">
        {gatedMsg ?? p.refusal ?? "No defensible estimate for this query."}{" "}
        {p.neighbors.length > 0
          ? "The nearest measured analogs are cited below — read them as evidence, not as a prediction."
          : null}
      </p>
      <p className="mt-2 text-[11px] text-ink-500">
        Every approved extraction improves this instrument.{" "}
        <Link href={`/${domain}/extract`} className="font-medium text-brand-600 underline">
          Extract a paper →
        </Link>
      </p>
    </div>
  );
}

export function PredictBench(props: BenchProps) {
  const { domain, spec, dataset, prediction } = props;
  // The number input keeps a local draft so half-typed values ("3" on the way
  // to "310") and cleared fields never reach the engine as bogus temperatures.
  const [tempDraft, setTempDraft] = useState<string | null>(null);
  useEffect(() => setTempDraft(null), [props.tempK]);
  const tempTicks = [...new Set(dataset.points.map((p) => (p.tempK == null ? null : Math.round(p.tempK))))].filter(
    (t): t is number => t != null
  );
  tempTicks.sort((a, b) => a - b);
  const tMin = tempTicks.length ? Math.min(263, tempTicks[0] - 20) : 263;
  const tMax = tempTicks.length ? Math.max(423, tempTicks[tempTicks.length - 1] + 40) : 423;
  const speciesOptions = [...new Set(["cation", "anion", ...dataset.species])];
  // Evidence volume per ion — orders the pickers and labels each row honestly.
  const ionPointCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of dataset.points) {
      m.set(p.cation.key, (m.get(p.cation.key) ?? 0) + 1);
      m.set(p.anion.key, (m.get(p.anion.key) ?? 0) + 1);
    }
    return m;
  }, [dataset]);
  const evidence = useMemo(() => conditionEvidence(dataset), [dataset]);

  return (
    <section className="overflow-hidden rounded-[8px] border border-ink-200/80 bg-white/90">
      <div className="grid gap-0 lg:grid-cols-[minmax(0,0.96fr)_minmax(20rem,1fr)]">
        <div className="space-y-3.5 border-b border-ink-100 px-4 py-3.5 lg:border-b-0 lg:border-r">
          <div>
            <p className="label-eyebrow text-brand-700">Query</p>
            <h2 className="mt-0.5 text-base font-semibold tracking-tight text-ink-950">Ion pair and conditions</h2>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <IonPicker
              kind="cation"
              text={props.cationText}
              ion={props.cation}
              options={props.cationOptions}
              counts={ionPointCounts}
              onChange={props.onCation}
            />
            <IonPicker
              kind="anion"
              text={props.anionText}
              ion={props.anion}
              options={props.anionOptions}
              counts={ionPointCounts}
              onChange={props.onAnion}
            />
          </div>

          {spec.hasTemperatureModel ? (
            <div>
              <label className="label-eyebrow" htmlFor="studio-temp">
                Temperature
              </label>
              <div className="mt-1 flex items-center gap-3">
                <input
                  id="studio-temp"
                  type="number"
                  value={tempDraft ?? String(props.tempK)}
                  min={tMin}
                  max={tMax}
                  step={1}
                  onChange={(e) => {
                    const text = e.target.value;
                    setTempDraft(text);
                    const v = Number(text);
                    if (text !== "" && Number.isFinite(v) && v >= tMin && v <= tMax) props.onTempK(v);
                  }}
                  onBlur={() => setTempDraft(null)}
                  className="w-24 rounded-lg border border-ink-200 bg-white px-2.5 py-1.5 font-mono text-sm tnum shadow-sm outline-none focus:border-brand-300 focus:ring-2 focus:ring-brand-100"
                />
                <span className="text-xs text-ink-500">K</span>
                <input
                  type="range"
                  min={tMin}
                  max={tMax}
                  step={1}
                  value={props.tempK}
                  onChange={(e) => props.onTempK(Number(e.target.value))}
                  list="studio-temp-ticks"
                  className="flex-1 accent-brand-600"
                  aria-label="Temperature slider"
                />
                <datalist id="studio-temp-ticks">
                  {tempTicks.map((t) => (
                    <option key={t} value={t} />
                  ))}
                </datalist>
              </div>
              <p className="mt-1 text-[11px] text-ink-700">
                evidence measured at:{" "}
                {tempTicks.length ? (
                  tempTicks.map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => props.onTempK(t)}
                      aria-pressed={Math.abs(props.tempK - t) <= 2}
                      className={`mr-1 rounded px-1 font-mono tnum ${
                        Math.abs(props.tempK - t) <= 2 ? "bg-brand-50 text-brand-700" : "text-ink-600 hover:bg-ink-100"
                      }`}
                    >
                      {t} K
                    </button>
                  ))
                ) : (
                  <span>no temperatures on file</span>
                )}
              </p>
            </div>
          ) : (
            <p className="rounded-lg bg-ink-50/70 px-3 py-2 text-[11px] leading-relaxed text-ink-700">
              COF gets no temperature law — all current evidence sits at {dataset.tempRange ? `${fmtK(dataset.tempRange[0])}–${fmtK(dataset.tempRange[1])}` : "room temperature"}.
              Temperature is a match criterion only.
            </p>
          )}

          {spec.conditionKind === "substrate" && (
            <>
              <div>
                <label className="label-eyebrow" htmlFor="studio-substrate">
                  Substrate
                </label>
                <select
                  id="studio-substrate"
                  value={props.substrate}
                  onChange={(e) => props.onSubstrate(e.target.value)}
                className="mt-1 min-h-[40px] w-full rounded-[8px] border border-ink-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand-300 focus:ring-2 focus:ring-brand-100"
                >
                  <option value="">Any substrate (no conditioning)</option>
                  {dataset.substrates.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <span className="label-eyebrow">Operating conditions</span>
                <div className="mt-1 grid grid-cols-2 gap-2">
                  <ConditionField
                    label="Load"
                    value={props.conditions.load}
                    placeholder="10 nN"
                    std={props.parsedConditions?.loadQ?.std != null ? stdLabel(props.parsedConditions.loadQ) : null}
                    ticks={evidence.load}
                    onChange={(v) => props.onConditions({ load: v })}
                  />
                  <ConditionField
                    label="Sliding speed"
                    value={props.conditions.velocity}
                    placeholder="1 µm/s"
                    std={props.parsedConditions?.velocityQ?.std != null ? stdLabel(props.parsedConditions.velocityQ) : null}
                    ticks={evidence.velocity}
                    onChange={(v) => props.onConditions({ velocity: v })}
                  />
                  <ConditionField
                    label="Potential"
                    value={props.conditions.potential}
                    placeholder="+1 V"
                    std={props.parsedConditions?.potentialQ?.std != null ? stdLabel(props.parsedConditions.potentialQ) : null}
                    ticks={evidence.potential}
                    onChange={(v) => props.onConditions({ potential: v })}
                  />
                  <ConditionField
                    label="Film thickness h"
                    value={props.conditions.film}
                    placeholder="2.5 nm or 3 layers"
                    std={
                      props.parsedConditions?.filmLayers != null
                        ? `${props.parsedConditions.filmLayers} layers`
                        : props.parsedConditions?.filmQ?.std != null
                          ? stdLabel(props.parsedConditions.filmQ)
                          : null
                    }
                    ticks={evidence.film}
                    onChange={(v) => props.onConditions({ film: v })}
                  />
                </div>
                <p className="mt-1 text-[10px] leading-relaxed text-ink-700">
                  Friction depends on the full operating point — e.g. μ varies non-monotonically with potential. Specifying h
                  switches to the interfacial structure-enhanced model (Dataset-B); h is never imputed.
                </p>
              </div>
            </>
          )}

          {spec.conditionKind === "species" && (
            <div>
              <span className="label-eyebrow">Diffusing species</span>
              <div className="mt-1 flex flex-wrap gap-1.5" role="radiogroup" aria-label="Diffusing species">
                {speciesOptions.map((s) => (
                  <button
                    key={s}
                    type="button"
                    role="radio"
                    aria-checked={props.species === s}
                    onClick={() => props.onSpecies(s)}
                    className={`rounded-lg border px-2.5 py-1 text-xs font-semibold transition ${
                      props.species === s
                        ? "border-ink-900 bg-ink-900 text-white"
                        : "border-ink-200 bg-white text-ink-600 hover:border-brand-300 hover:text-brand-700"
                    }`}
                  >
                    D({s})
                  </button>
                ))}
              </div>
              <p className="mt-1 text-[11px] text-ink-700">Species never mix — D⁺ evidence is never used for a D⁻ query.</p>
            </div>
          )}
        </div>

        <div className="bg-ink-50/35 px-4 py-3.5">
          <div className="mb-2.5">
            <p className="label-eyebrow text-violet-700">Result</p>
            <h2 className="mt-0.5 text-base font-semibold tracking-tight text-ink-950">{spec.propertyLabel}</h2>
          </div>
          <Readout domain={domain} spec={spec} prediction={prediction} dataset={dataset} />
        </div>
      </div>
    </section>
  );
}
