"use client";

import type { Domain } from "@/lib/domain";
import { formatStd } from "@/lib/units";
import { formatProvenance } from "@/lib/schema";
import type { NeighborEvidence, Prediction } from "@/lib/predict/engine";
import type { DomainDataset } from "@/lib/predict/dataset";
import type { DesignSpec } from "@/lib/predict/specs";
import { fmtK, openSourceEvidence, PairLabel, SectionHeader } from "./studioParts";

/**
 * Zone 2 — the evidence ledger. Predictions cite measurements the way records
 * cite papers: every contributing analog is a flat-divider row with its kernel
 * weight, a human-readable distance breakdown, any temperature translation
 * (labeled with the platform's inferred/assumed vocabulary), and the verbatim
 * provenance quote behind the measured value.
 */

function BasisChip({ n }: { n: NeighborEvidence }) {
  if (!n.translation) return null;
  const assumed = n.translation.basis === "assumed";
  return (
    <span
      className={`status-mini ${assumed ? "border-amber-200 bg-amber-50 text-amber-700" : "border-violet-200 bg-violet-50 text-violet-700"}`}
      title={`${n.translation.fitLabel} · Ea ${(n.translation.eaJmol / 1000).toFixed(1)} kJ/mol`}
    >
      {Math.round(n.translation.fromK)}→{Math.round(n.translation.toK)} K · {n.translation.basis}
    </span>
  );
}

function LedgerRow({ domain, spec, n, share }: { domain: Domain; spec: DesignSpec; n: NeighborEvidence; share: boolean }) {
  const p = n.point;
  const member = p.members[0];
  const quote = member?.provenance?.quote;
  return (
    <div className="border-b border-ink-100 px-5 py-3 last:border-0">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        {share && (
          <div className="flex w-24 shrink-0 items-center gap-1.5" title={`${(n.share * 100).toFixed(0)}% of the estimate`}>
            <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-ink-100">
              <span className="absolute inset-y-0 left-0 rounded-full bg-violet-500" style={{ width: `${Math.max(4, n.share * 100)}%` }} />
            </div>
            <span className="font-mono text-[10px] font-semibold text-violet-700 tnum">{(n.share * 100).toFixed(0)}%</span>
          </div>
        )}
        <PairLabel cation={p.cation} anion={p.anion} />
        <span className="font-mono text-sm font-semibold text-brand-700 tnum">{spec.formatValue(p.y)}</span>
        <span className="text-[11px] text-ink-500 tnum">
          {p.tempK != null && <>{fmtK(p.tempK)} · </>}
          {p.substrate && <>{p.substrate} · </>}
          {p.species && <>D({p.species}) · </>}
          {p.conditions?.loadN != null && <>{formatStd(p.conditions.loadN, "N")} · </>}
          {p.conditions?.velocityMps != null && <>{formatStd(p.conditions.velocityMps, "m/s")} · </>}
          {p.conditions?.potentialV != null && <>{p.conditions.potentialV} V · </>}
          {p.conditions?.filmThicknessM != null && (
            <span className="text-violet-700">h {formatStd(p.conditions.filmThicknessM, "m")} · </span>
          )}
          {p.conditions?.filmLayers != null && <span className="text-violet-700">{p.conditions.filmLayers} layers · </span>}
          {p.members.length} record{p.members.length === 1 ? "" : "s"}
        </span>
        <BasisChip n={n} />
        {p.reviewCount > 0 && <span className="status-mini status-mini-review">review ×{p.reviewCount}</span>}
        {p.outlier && (
          <span className="status-mini status-mini-warn" title={`modified z = ${p.outlierZ.toFixed(1)}`}>
            outlier |z| {Math.abs(p.outlierZ).toFixed(1)}
          </span>
        )}
      </div>
      <p className="mt-1 text-[11px] text-ink-700">{n.breakdown}</p>
      {quote ? (
        <button
          type="button"
          onClick={() =>
            member?.sourceId && member.provenance
              ? openSourceEvidence({
                  domain,
                  sourceId: member.sourceId,
                  recordId: member.id,
                  field: spec.provenanceField,
                  value: spec.formatValue(member.value),
                  prov: member.provenance,
                })
              : undefined
          }
          className="mt-1 block max-w-2xl text-left text-[11px] italic leading-snug text-ink-600 hover:text-brand-700"
          title={formatProvenance(member?.provenance)}
        >
          “{quote}” <span className="not-italic text-ink-400">— {member?.id}{member?.provenance?.page != null ? ` · p.${member.provenance.page}` : ""}</span>
        </button>
      ) : (
        <p className="mt-1 text-[11px] text-ink-400">
          <span className="status-mini status-mini-muted">no quote on file</span>
          <span className="ml-1.5">{member?.id} · {member?.paperTitle}</span>
        </p>
      )}
    </div>
  );
}

/** ln-y vs 1000/T inset: evidence points, fitted lines, and the query marker. */
function ArrheniusInset({ prediction, dataset, tempK }: { prediction: Prediction; dataset: DomainDataset; tempK: number | null }) {
  const pts: { x: number; y: number; official: boolean }[] = [];
  for (const n of prediction.neighbors) {
    if (n.point.tempK != null) pts.push({ x: 1000 / n.point.tempK, y: Math.log10(n.point.y), official: n.point.reviewCount === 0 });
  }
  // A gated estimate's value must not be rendered anywhere — including as a
  // marker position on a labeled log axis.
  const showValue = prediction.value != null && !prediction.gated;
  const query = showValue && tempK != null ? { x: 1000 / tempK, y: Math.log10(prediction.value as number) } : null;
  if (pts.length === 0) return null;

  const xs = pts.map((p) => p.x).concat(query ? [query.x] : []);
  const ys = pts.map((p) => p.y).concat(query ? [query.y] : []);
  const x0 = Math.min(...xs) - 0.15;
  const x1 = Math.max(...xs) + 0.15;
  const y0 = Math.min(...ys) - 0.4;
  const y1 = Math.max(...ys) + 0.4;
  const W = 250;
  const H = 170;
  const PX = (x: number) => 34 + ((x - x0) / (x1 - x0)) * (W - 46);
  const PY = (y: number) => H - 26 - ((y - y0) / (y1 - y0)) * (H - 44);

  const usedGroups = new Set(prediction.neighbors.map((n) => n.point.groupKey));
  const lines = dataset.fits
    .filter((f) => usedGroups.has(f.groupKey))
    .map((f) => {
      const lnToLog = (T: number) => (f.lnA - f.eaJmol / (8.314462618 * T)) / Math.LN10;
      const Ta = 1000 / (x1 - 0.05);
      const Tb = 1000 / (x0 + 0.05);
      return { key: f.groupKey, x0: 1000 / Ta, y0: lnToLog(Ta), x1: 1000 / Tb, y1: lnToLog(Tb) };
    });

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Arrhenius plot of the evidence">
      <rect x="0" y="0" width={W} height={H} rx="10" className="fill-ink-50/60" />
      <line x1="34" y1={H - 26} x2={W - 10} y2={H - 26} className="stroke-ink-200" strokeWidth="1" />
      <line x1="34" y1="14" x2="34" y2={H - 26} className="stroke-ink-200" strokeWidth="1" />
      <text x={(W + 24) / 2} y={H - 8} textAnchor="middle" className="fill-ink-400 font-mono" fontSize="8">
        1000 / T (K⁻¹)
      </text>
      <text x="12" y={H / 2} textAnchor="middle" transform={`rotate(-90 12 ${H / 2})`} className="fill-ink-400 font-mono" fontSize="8">
        log₁₀ value
      </text>
      {lines.map((l) => (
        <line key={l.key} x1={PX(l.x0)} y1={PY(l.y0)} x2={PX(l.x1)} y2={PY(l.y1)} className="stroke-brand-400" strokeWidth="1.2" strokeDasharray="4 3" />
      ))}
      {pts.map((p, i) => (
        <circle key={i} cx={PX(p.x)} cy={PY(p.y)} r="3.4" className={p.official ? "fill-brand-500" : "fill-amber-400"} />
      ))}
      {query && (
        <g>
          <circle cx={PX(query.x)} cy={PY(query.y)} r="4.6" className="fill-violet-500/25 stroke-violet-600" strokeWidth="1.4" />
          <circle cx={PX(query.x)} cy={PY(query.y)} r="1.6" className="fill-violet-600" />
        </g>
      )}
    </svg>
  );
}

/** 1-D similarity strip: neighbors positioned by distance, bar height = weight. */
function SimilarityStrip({ prediction }: { prediction: Prediction }) {
  const ns = prediction.neighbors;
  if (ns.length === 0) return null;
  const h = prediction.facts.bandwidth;
  const dMax = Math.max(2 * h, ...ns.map((n) => n.distance)) * 1.08;
  const W = 250;
  const H = 120;
  const PX = (d: number) => 18 + (d / dMax) * (W - 32);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Evidence similarity strip">
      <rect x="0" y="0" width={W} height={H} rx="10" className="fill-ink-50/60" />
      <line x1="18" y1={H - 28} x2={W - 14} y2={H - 28} className="stroke-ink-200" strokeWidth="1" />
      {/* bandwidth marker */}
      <line x1={PX(h)} y1="16" x2={PX(h)} y2={H - 28} className="stroke-ink-300" strokeWidth="1" strokeDasharray="3 3" />
      <text x={PX(h)} y="12" textAnchor="middle" className="fill-ink-400 font-mono" fontSize="7.5">
        h = {h.toFixed(2)}
      </text>
      {/* query at the origin */}
      <circle cx={PX(0)} cy={H - 28} r="4" className="fill-violet-600" />
      <text x={PX(0)} y={H - 12} textAnchor="middle" className="fill-violet-700 font-mono" fontSize="7.5">
        query
      </text>
      {ns.map((n, i) => {
        const x = PX(n.distance);
        const barH = 8 + n.weight * (H - 64);
        return (
          <g key={i}>
            <rect x={x - 3} y={H - 28 - barH} width="6" height={barH} rx="2" className={n.point.reviewCount > 0 ? "fill-amber-400/80" : "fill-brand-500/85"} />
          </g>
        );
      })}
      <text x={W - 14} y={H - 12} textAnchor="end" className="fill-ink-400 font-mono" fontSize="7.5">
        distance →
      </text>
    </svg>
  );
}

export function EvidenceLedger({
  domain,
  spec,
  dataset,
  prediction,
  tempK,
}: {
  domain: Domain;
  spec: DesignSpec;
  dataset: DomainDataset;
  prediction: Prediction;
  tempK: number | null;
}) {
  const p = prediction;
  if (p.neighbors.length === 0) return null;
  const isEstimate = p.kind === "estimate" && !p.gated;
  const usedFit = p.neighbors.some((n) => n.translation);

  const title =
    p.kind === "measured"
      ? "Evidence — the measurement itself"
      : isEstimate
        ? "Evidence — this estimate rests on"
        : "Nearest measured analogs";

  return (
    <section className="panel overflow-hidden">
      <SectionHeader
        title={title}
        hint={
          p.kind === "measured"
            ? "Exact pair and condition match in the curated database."
            : "Read these as the prediction's provenance — weighted analogs, each traceable to its verbatim quote."
        }
      />
      <div className="grid lg:grid-cols-[minmax(0,1fr)_280px]">
        <div>
          {p.neighbors.map((n, i) => (
            <LedgerRow key={`${n.point.groupKey}-${n.point.tempK ?? "x"}-${i}`} domain={domain} spec={spec} n={n} share={isEstimate} />
          ))}
          {isEstimate && (
            <p className="px-5 py-3 text-[11px] font-medium text-ink-700">
              This number is a weighted combination of {p.neighbors.length} measured record
              {p.neighbors.length === 1 ? "" : "s"}; it has no other source.
            </p>
          )}
        </div>
        <div className="border-t border-ink-100 px-4 py-4 lg:border-l lg:border-t-0">
          <span className="label-eyebrow">{spec.hasTemperatureModel && usedFit ? "Temperature picture" : "Similarity picture"}</span>
          <div className="mt-2">
            {spec.hasTemperatureModel && usedFit ? (
              <ArrheniusInset prediction={p} dataset={dataset} tempK={tempK} />
            ) : (
              <SimilarityStrip prediction={p} />
            )}
          </div>
          <p className="mt-2 text-[10px] leading-relaxed text-ink-400">
            {spec.hasTemperatureModel && usedFit
              ? "Teal points = official evidence, amber = review; dashed lines = per-pair Arrhenius fits; violet ring = this query."
              : "Bars are evidence weights at their descriptor distance from the query (violet dot). The dashed line is the kernel bandwidth."}
          </p>
        </div>
      </div>
    </section>
  );
}
