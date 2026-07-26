"use client";

import type { Domain } from "@/lib/domain";
import type { FieldProvenance } from "@/lib/schema";
import type { IonDescriptor } from "@/lib/predict/descriptors";
import type { Tier } from "@/lib/predict/engine";

/** Shared atoms for the Design Studio. Color semantics are load-bearing:
 *  teal = measured, violet = derived/predicted, amber = review/assumed. */

export const TIER_STYLE: Record<Tier, { label: string; cls: string }> = {
  measured: { label: "Measured", cls: "border-brand-200 bg-brand-50 text-brand-700" },
  interpolated: { label: "Interpolated", cls: "border-violet-200 bg-violet-50 text-violet-700" },
  extrapolated: { label: "Extrapolated", cls: "border-violet-300 bg-white text-violet-700" },
  insufficient: { label: "Insufficient", cls: "border-ink-200 bg-ink-50 text-ink-500" },
};

export function TierBadge({ tier }: { tier: Tier }) {
  const t = TIER_STYLE[tier];
  return <span className={`status-mini ${t.cls}`}>{t.label}</span>;
}

export function PairLabel({ cation, anion, size = "sm" }: { cation: IonDescriptor; anion: IonDescriptor; size?: "sm" | "lg" }) {
  const text = size === "lg" ? "text-base" : "text-xs";
  return (
    <span className={`inline-flex items-baseline gap-0.5 font-mono font-semibold ${text}`}>
      <span className="text-cyan-700">{cation.label}</span>
      <span className="text-emerald-700">{anion.label}</span>
    </span>
  );
}

export function fmtK(t: number | null | undefined): string {
  return t == null ? "—" : `${Math.round(t * 10) / 10} K`;
}

/** Deterministic short hash of the model's inputs — stamped on the page and on exports. */
export function modelHash(parts: (string | number | boolean)[]): string {
  let h = 0x811c9dc5;
  const s = parts.join("§");
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** Open the globally-mounted SourceViewer on a cited field (same event RecordCard uses). */
export function openSourceEvidence(opts: {
  domain: Domain;
  sourceId: string;
  recordId: string;
  field: string;
  value: string;
  prov: FieldProvenance;
}) {
  window.dispatchEvent(
    new CustomEvent("ioniclink:source", {
      detail: { sourceId: opts.sourceId, recordId: opts.recordId, field: opts.field, value: opts.value, prov: opts.prov, domain: opts.domain },
    })
  );
}

export function SectionHeader({ title, hint, right }: { title: string; hint?: string; right?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-ink-100 px-4 py-3">
      <div>
        <h2 className="text-sm font-semibold tracking-tight text-ink-900">{title}</h2>
        {hint && <p className="mt-0.5 text-[11px] leading-4 text-ink-600">{hint}</p>}
      </div>
      {right}
    </div>
  );
}
