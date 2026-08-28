"use client";

import { formatProvenance, provenanceBadge, type FieldProvenance } from "@/lib/schema";
import { standardizeIonFormula, standardizeIonLabel, type IonKind } from "@/lib/ionStructures";
import { rawLabel, stdLabel, stdRangeParts, type Quantity } from "@/lib/units";
import { DEFAULT_DOMAIN, type Domain } from "@/lib/domain";

/**
 * Domain-neutral building blocks shared by every domain's RecordCard
 * (tribology's COF card and conductivity's σ card). Only the ionic-identity
 * section, the measured-value readout, and the condition set differ per domain.
 */

export type UnitMode = "raw" | "std";

export interface ConditionItem {
  label: string;
  value: string;
  title?: string;
  tone?: "default" | "accent" | "amber" | "violet";
  variant?: "range";
  range?: { min: string; max: string; unit: string };
  prov?: FieldProvenance;
  field?: string;
  fullWidth?: boolean;
}

export function openRecordEvidence({
  sourceId,
  recordId,
  field,
  value,
  prov,
  domain = DEFAULT_DOMAIN,
}: {
  sourceId?: string;
  recordId?: string;
  field: string;
  value?: string;
  prov: FieldProvenance;
  domain?: Domain;
}) {
  window.dispatchEvent(new CustomEvent("ioniclink:source", { detail: { sourceId, recordId, field, value, prov, domain } }));
}

export function quantityLabel(q: Quantity | null | undefined, units: UnitMode) {
  return units === "std" ? stdLabel(q) : rawLabel(q);
}

export function quantityTitle(q: Quantity | null | undefined, units: UnitMode) {
  return units === "std" ? `as reported: ${rawLabel(q)}` : `standardized: ${stdLabel(q)}`;
}

export function quantityRange(q: Quantity | null | undefined, units: UnitMode) {
  return units === "std" ? stdRangeParts(q) : null;
}

export function ionDisplayLabel(value: string, kind: IonKind, units: UnitMode): string {
  return units === "std" ? standardizeIonLabel(value, kind) : value;
}

export function ionDisplayFormula(value: string, kind: IonKind, units: UnitMode): string {
  return units === "std" ? standardizeIonFormula(value, kind) : value;
}

export function IonPill({
  kind,
  label,
  value,
  units = "raw",
}: {
  kind: "cation" | "anion";
  label: string;
  value: string;
  units?: UnitMode;
}) {
  const isCation = kind === "cation";
  const displayValue = ionDisplayLabel(value, kind, units);
  const displayFormula = ionDisplayFormula(value, kind, units);
  const title = units === "std" && displayValue !== value ? `${label}: ${displayValue} · as reported: ${value}` : `${label}: ${value}`;
  return (
    <div
      data-testid={`ion-pill-${kind}`}
      className={`flex min-w-0 items-center gap-1.5 rounded-lg border px-2 py-1.5 ${
        isCation ? "border-cyan-100 bg-cyan-50/55" : "border-emerald-100 bg-emerald-50/55"
      }`}
      title={title}
    >
      <span
        className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border text-xs font-black leading-none ${
          isCation ? "border-cyan-200 bg-white text-cyan-600" : "border-emerald-200 bg-white text-emerald-600"
        }`}
      >
        {isCation ? "+" : "−"}
      </span>
      <span className="min-w-0">
        <span className={`block text-[9px] font-bold uppercase tracking-eyebrow ${isCation ? "text-cyan-600" : "text-emerald-600"}`}>
          {label}
        </span>
        <span className="block max-w-full overflow-hidden text-ellipsis whitespace-nowrap font-sans text-[13px] font-bold leading-tight tracking-normal text-ink-900">
          <IonFormula value={displayFormula} subscript={units === "std"} />
        </span>
      </span>
    </div>
  );
}

function IonFormula({ value, subscript }: { value: string; subscript: boolean }) {
  if (!subscript) return <>{value}</>;
  const parts: { kind: "text" | "sub" | "sup"; value: string }[] = [];
  for (let i = 0; i < value.length; ) {
    if (value[i] === "i" && value[i + 1] === "C") {
      parts.push({ kind: "sup", value: "i" });
      i += 1;
      continue;
    }

    const digitRun = value.slice(i).match(/^\d+(?:,\d+)*/);
    if (digitRun) {
      parts.push({ kind: "sub", value: digitRun[0] });
      i += digitRun[0].length;
      continue;
    }

    parts.push({ kind: "text", value: value[i] });
    i += 1;
  }

  return (
    <>
      {parts.map((part, index) => {
        if (part.kind === "sup") {
          return (
            <sup key={`${part.value}-${index}`} className="relative -left-[0.05em] -mr-[0.04em] -top-[0.38em] text-[0.62em] leading-none tracking-normal">
              {part.value}
            </sup>
          );
        }
        if (part.kind === "sub") {
          return (
            <sub key={`${part.value}-${index}`} className="relative top-[0.22em] text-[0.72em] leading-none tracking-normal">
              {part.value}
            </sub>
          );
        }
        return part.value;
      })}
    </>
  );
}

export function ConditionChip({
  item,
  sourceId,
  recordId,
  domain,
}: {
  item: ConditionItem;
  sourceId?: string;
  recordId?: string;
  domain?: Domain;
}) {
  const tone =
    item.tone === "accent"
      ? "border-cyan-100 bg-cyan-50/40 text-ink-800"
      : item.tone === "amber"
        ? "border-amber-200 bg-amber-50 text-amber-700"
        : item.tone === "violet"
          ? "border-violet-200 bg-violet-50 text-violet-700"
          : "border-ink-200 bg-white text-ink-700";
  const className = `min-w-0 rounded-lg border px-2 py-1 text-left ${tone} ${item.fullWidth ? "col-span-2" : ""} ${
    item.prov ? "cursor-pointer transition hover:border-brand-300 hover:ring-1 hover:ring-brand-100 focus:outline-none focus:ring-2 focus:ring-brand-200" : ""
  }`;
  const content = (
    <>
      <span className="flex items-center justify-between gap-1">
        <span className="min-w-0 break-words text-[9px] font-semibold uppercase tracking-eyebrow opacity-60">{item.label}</span>
      </span>
      {item.variant === "range" && item.range ? (
        <span
          data-testid="condition-range-chip"
          aria-label={item.value}
          className="mt-1 flex min-w-0 items-center gap-1.5 rounded-md border border-cyan-200/80 bg-white/80 px-1.5 py-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]"
        >
          <span className="font-mono text-[11px] font-black leading-none tnum text-cyan-950">{item.range.min}</span>
          <span className="relative h-1 min-w-4 flex-1 overflow-hidden rounded-full bg-cyan-100">
            <span className="absolute inset-y-0 left-0 right-0 rounded-full bg-gradient-to-r from-cyan-400 via-teal-300 to-cyan-500" />
            <span className="absolute inset-0 grid place-items-center font-mono text-[9px] font-black leading-none text-cyan-900/70">-</span>
            <span className="absolute left-0 top-1/2 h-2 w-2 -translate-y-1/2 rounded-full border border-white bg-cyan-500 shadow-sm" />
            <span className="absolute right-0 top-1/2 h-2 w-2 -translate-y-1/2 rounded-full border border-white bg-cyan-600 shadow-sm" />
          </span>
          <span className="font-mono text-[11px] font-black leading-none tnum text-cyan-950">{item.range.max}</span>
          <span className="rounded-full bg-cyan-100 px-1.5 py-0.5 font-mono text-[9px] font-bold leading-none text-cyan-700">
            {item.range.unit}
          </span>
        </span>
      ) : (
        <span className="block truncate font-mono text-xs font-semibold tnum">{item.value}</span>
      )}
    </>
  );
  if (item.prov) {
    return (
      <button
        type="button"
        data-testid="evidence-click-target"
        onClick={() => openRecordEvidence({ sourceId, recordId, field: item.field ?? item.label, value: item.value, prov: item.prov!, domain })}
        className={className}
        title={`${item.title ?? item.value} · evidence available`}
        aria-label={`Open evidence for ${item.field ?? item.label}`}
      >
        {content}
      </button>
    );
  }
  return (
    <span className={className} title={item.title ?? item.value}>
      {content}
    </span>
  );
}

/** Clickable "p.3 / Fig. 4a" provenance pill — opens the source viewer for the record's domain. */
export function ProvBadge({
  p,
  sourceId,
  recordId,
  field,
  value,
  domain = DEFAULT_DOMAIN,
}: {
  p: FieldProvenance;
  sourceId?: string;
  recordId?: string;
  field: string;
  value?: string;
  domain?: Domain;
}) {
  const label = provenanceBadge(p);
  if (!label) return null;
  // Weak evidence (inferred/assumed) renders amber so it can't pass for a
  // directly-located value at a glance.
  const weak = p.basis === "inferred" || p.basis === "assumed";
  const preview = evidencePreview(p);
  const badgeTone = weak
    ? "border-amber-200/90 bg-amber-50/90 text-amber-700 hover:border-amber-300 hover:bg-amber-100/80"
    : "border-cyan-200/90 bg-white/95 text-cyan-700 hover:border-cyan-300 hover:bg-cyan-50";
  const dotTone = weak ? "bg-amber-400" : "bg-cyan-400";
  return (
    <span className="group/prov relative inline-flex shrink-0">
      <button
        data-testid="prov-badge"
        type="button"
        onClick={(ev) => {
          ev.stopPropagation();
          window.dispatchEvent(
            new CustomEvent("ioniclink:source", { detail: { sourceId, recordId, field, value, prov: p, domain } })
          );
        }}
        className={`inline-flex h-[18px] items-center gap-1 whitespace-nowrap rounded-md border px-1.5 font-mono text-[9px] font-black leading-none tracking-normal shadow-[0_1px_0_rgba(15,23,42,0.04)] transition hover:-translate-y-px hover:shadow-sm ${badgeTone}`}
        aria-label={`Open source ${label} for ${field}`}
      >
        <span className={`h-1 w-1 rounded-full ${dotTone}`} />
        {label}
      </button>
      <span
        data-testid="prov-badge-preview"
        className="pointer-events-none absolute left-1/2 top-full z-30 mt-1 hidden w-max max-w-[13rem] -translate-x-1/2 rounded-lg border border-ink-200 bg-white/95 px-2 py-1.5 text-left shadow-[0_10px_24px_rgba(15,23,42,0.16)] ring-1 ring-white/70 backdrop-blur group-hover/prov:block"
      >
        <span className="block font-sans text-[9px] font-bold uppercase tracking-eyebrow text-ink-400">
          source · {label}
        </span>
        {preview && <span className="mt-0.5 block font-sans text-[10px] font-medium leading-snug text-ink-700">{preview}</span>}
      </span>
    </span>
  );
}

function evidencePreview(p: FieldProvenance): string {
  const raw = p.quote || p.context || p.basisNote || formatProvenance(p);
  const text = raw.replace(/\s+/g, " ").trim();
  return text.length > 96 ? `${text.slice(0, 94)}…` : text;
}

export function MissingChip({ label }: { label: string }) {
  return (
    <span className="rounded-lg border border-dashed border-amber-300 bg-amber-50/60 px-2 py-1 text-xs font-semibold text-amber-600">
      {label}?
    </span>
  );
}
