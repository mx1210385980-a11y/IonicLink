"use client";

import { useDeferredValue, useMemo } from "react";
import type { Domain } from "@/lib/domain";
import type { DomainDataset } from "@/lib/predict/dataset";
import type { FeatureNorm } from "@/lib/predict/descriptors";
import { bandwidth, CALIBRATION_GATE } from "@/lib/predict/engine";
import { intersectFoldMetrics, runLoo, type LooResult } from "@/lib/predict/loo";
import type { DesignSpec } from "@/lib/predict/specs";
import { SectionHeader } from "./studioParts";

/**
 * Zone 3.5 — the model lab, an educational calibration playground. The three
 * kernel hyperparameters are exposed as instruments; every move re-runs the
 * full leave-one-out validation and reports R² / RMSE / MAE in log₁₀ space —
 * the space the model actually fits. Settings are live: the bench, atlas and
 * every interval on the page recalibrate to them (and disclose it in their
 * reasons). Nanoscale scope: the lab — like the whole tribology studio — sees
 * AFM-class evidence only; macroscopic friction is a different regime, not
 * extra data. Honesty gates apply unchanged: below CALIBRATION_GATE usable
 * records (or <5 folds) no metric is rendered, and settings are only compared
 * on the INTERSECTION of folds both models actually predicted — a narrower
 * bandwidth refuses the hardest folds, and a metric over the surviving easy
 * ones would look spuriously better.
 */

export interface LabSettings {
  /** Kernel bandwidth multiplier (1 = calibrated default: median pairwise distance). */
  bandwidthScale: number;
  /** Kernel neighborhood size K (tribology engine default 1). */
  kNeighbors: number;
  /** Drop |z| > 3.5 flagged points from training AND validation. */
  excludeOutliers: boolean;
}

export const LAB_DEFAULTS: LabSettings = { bandwidthScale: 1, kNeighbors: 1, excludeOutliers: false };

export function isLabDefault(lab: LabSettings): boolean {
  return (
    lab.bandwidthScale === LAB_DEFAULTS.bandwidthScale &&
    lab.kNeighbors === LAB_DEFAULTS.kNeighbors &&
    lab.excludeOutliers === LAB_DEFAULTS.excludeOutliers
  );
}

/** Human-readable settings summary for disclosure surfaces (null at defaults). */
export function labSummary(lab: LabSettings): string | null {
  if (isLabDefault(lab)) return null;
  const parts = [`bandwidth ×${lab.bandwidthScale.toFixed(2)}`, `K = ${lab.kNeighbors}`];
  if (lab.excludeOutliers) parts.push("outliers excluded");
  return parts.join(" · ");
}

/** Bandwidth sweep grid for the validation curve (log-spaced around ×1). */
export const LAB_SWEEP_SCALES = [0.5, 0.63, 0.8, 1, 1.26, 1.59, 2];

const fmt3 = (v: number) => (Number.isFinite(v) ? v.toFixed(3) : "—");

/**
 * Δ chip vs the default-settings baseline, computed on the SHARED folds only.
 * `betterWhenLower` flips improvement semantics; the glyph encodes
 * improvement (▲ better / ▼ worse), never the raw sign — and the word is in
 * the accessible output, not only the color.
 */
function MetricDelta({
  current,
  baseline,
  betterWhenLower,
  foldNote,
}: {
  current: number | null;
  baseline: number | null;
  betterWhenLower: boolean;
  foldNote: string;
}) {
  if (current == null || baseline == null) return null;
  const d = current - baseline;
  if (!Number.isFinite(d)) return null;
  if (Math.abs(d) < 5e-4) {
    return <span className="text-[10px] font-medium text-ink-400">≈ default</span>;
  }
  const improved = betterWhenLower ? d < 0 : d > 0;
  return (
    <span
      className={`text-[10px] font-semibold tnum ${improved ? "text-violet-700" : "text-rose-600"}`}
      title={`${improved ? "better" : "worse"} than the default settings (${fmt3(baseline)}), compared ${foldNote}`}
    >
      {improved ? "▲" : "▼"} {Math.abs(d).toFixed(3)}
      <span className="sr-only">{improved ? " better than default" : " worse than default"}</span>
    </span>
  );
}

function MetricTile({
  label,
  hint,
  value,
  delta,
}: {
  label: string;
  hint: string;
  value: string;
  delta: React.ReactNode;
}) {
  return (
    <div className="rounded-[9px] border border-violet-200/80 bg-violet-50/40 px-3 py-2" title={hint}>
      <span className="block text-[9px] font-semibold uppercase tracking-eyebrow text-violet-500">{label}</span>
      <span className="mt-0.5 flex items-baseline gap-2">
        <span className="font-mono text-lg font-semibold text-violet-700 tnum">{value}</span>
        {delta}
      </span>
    </div>
  );
}

interface CurvePoint {
  scale: number;
  rmse: number;
  mae: number;
}

/** Validation curve over the SHARED folds: error vs bandwidth multiplier, current and best settings marked. */
function ValidationCurve({ points, currentScale }: { points: CurvePoint[]; currentScale: number }) {
  const W = 260;
  const H = 150;
  const xs = points.map((s) => Math.log2(s.scale));
  const xLo = Math.min(...xs);
  const xHi = Math.max(...xs);
  const errs = points.flatMap((s) => [s.rmse, s.mae]);
  const yLo = Math.min(...errs);
  const yHi = Math.max(...errs);
  const pad = (yHi - yLo) * 0.15 || 0.01;
  // Coordinates rounded to 2 decimals: raw doubles can differ by 1 ulp between
  // Node SSR and the browser → hydration-mismatch warnings on SVG attributes.
  const X = (scale: number) => +(30 + ((Math.log2(scale) - xLo) / (xHi - xLo || 1)) * (W - 44)).toFixed(2);
  const Y = (e: number) => +(H - 26 - ((e - (yLo - pad)) / (yHi + pad - (yLo - pad))) * (H - 44)).toFixed(2);
  const path = (pick: (p: CurvePoint) => number) =>
    points.map((s, i) => `${i === 0 ? "M" : "L"}${X(s.scale)},${Y(pick(s))}`).join(" ");
  const best = points.reduce((a, b) => (b.rmse < a.rmse ? b : a));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-[300px]" role="img" aria-label="Held-out error vs kernel bandwidth — the bias–variance curve">
      <rect x="0" y="0" width={W} height={H} rx="10" className="fill-ink-50/60" />
      {/* current setting */}
      <line x1={X(currentScale)} y1={16} x2={X(currentScale)} y2={H - 26} className="stroke-violet-400" strokeWidth="1" strokeDasharray="3 3" />
      <path d={path((p) => p.rmse)} className="stroke-violet-500" strokeWidth="1.6" fill="none" />
      <path d={path((p) => p.mae)} className="stroke-violet-300" strokeWidth="1.3" fill="none" strokeDasharray="4 3" />
      {points.map((s) => (
        <circle key={s.scale} cx={X(s.scale)} cy={Y(s.rmse)} r="2.6" className="fill-violet-500" />
      ))}
      {/* sweet spot (lowest shared-fold RMSE on the sweep) */}
      <circle cx={X(best.scale)} cy={Y(best.rmse)} r="5" className="fill-none stroke-ink-900" strokeWidth="1.3" />
      <text x={X(best.scale)} y={Y(best.rmse) - 8} textAnchor="middle" className="fill-ink-700 font-mono" fontSize="7.5">
        best ×{best.scale}
      </text>
      {points.map((s) => (
        <text key={s.scale} x={X(s.scale)} y={H - 14} textAnchor="middle" className="fill-ink-400 font-mono" fontSize="7.5">
          {s.scale}
        </text>
      ))}
      <text x={W / 2} y={H - 4} textAnchor="middle" className="fill-ink-400 font-mono" fontSize="8">
        bandwidth × (log scale)
      </text>
      <text x="9" y={H / 2} textAnchor="middle" transform={`rotate(-90 9 ${H / 2})`} className="fill-ink-400 font-mono" fontSize="8">
        held-out error (log₁₀)
      </text>
      <g>
        <line x1={W - 92} y1={18} x2={W - 74} y2={18} className="stroke-violet-500" strokeWidth="1.6" />
        <text x={W - 70} y={21} className="fill-ink-500 font-mono" fontSize="7.5">RMSE</text>
        <line x1={W - 44} y1={18} x2={W - 26} y2={18} className="stroke-violet-300" strokeWidth="1.3" strokeDasharray="4 3" />
        <text x={W - 22} y={21} className="fill-ink-500 font-mono" fontSize="7.5">MAE</text>
      </g>
    </svg>
  );
}

/** Held-out predicted-vs-measured scatter at the current settings. */
function FitScatter({ loo }: { loo: LooResult }) {
  const all = loo.pairs.flatMap((p) => [p.measuredLog, p.predictedLog]);
  const lo = Math.min(...all) - 0.3;
  const hi = Math.max(...all) + 0.3;
  const S = 170;
  // Rounded for deterministic SSR/client hydration (1-ulp Math differences).
  const P = (v: number) => +(26 + ((v - lo) / (hi - lo)) * (S - 40)).toFixed(2);
  const PY = (v: number) => +(S - P(v)).toFixed(2);
  return (
    <svg viewBox={`0 0 ${S} ${S}`} className="w-full max-w-[200px]" role="img" aria-label="Held-out predictions vs measurements">
      <rect x="0" y="0" width={S} height={S} rx="10" className="fill-ink-50/60" />
      <line x1={P(lo + 0.3)} y1={PY(lo + 0.3)} x2={P(hi - 0.3)} y2={PY(hi - 0.3)} className="stroke-ink-300" strokeWidth="1" strokeDasharray="4 3" />
      {loo.pairs.map((p, i) => (
        <circle key={i} cx={P(p.measuredLog)} cy={PY(p.predictedLog)} r="2.8" className="fill-violet-500/85" />
      ))}
      <text x={S / 2} y={S - 5} textAnchor="middle" className="fill-ink-400 font-mono" fontSize="8">
        measured log₁₀
      </text>
      <text x="9" y={S / 2} textAnchor="middle" transform={`rotate(-90 9 ${S / 2})`} className="fill-ink-400 font-mono" fontSize="8">
        predicted log₁₀
      </text>
    </svg>
  );
}

export function ModelLab({
  domain,
  spec,
  dataset,
  norm,
  lab,
  onLab,
  loo,
}: {
  domain: Domain;
  spec: DesignSpec;
  dataset: DomainDataset;
  norm: FeatureNorm;
  lab: LabSettings;
  onLab: (patch: Partial<LabSettings>) => void;
  /** Pathway-A LOO at the CURRENT lab settings (shared with the studio). */
  loo: LooResult | null;
}) {
  const isDefault = isLabDefault(lab);
  const outlierCount = dataset.points.filter((p) => p.outlier).length;

  // Effective bandwidth readout: auto h on the lab's Dataset-A pool × the
  // multiplier. A film-conditioned bench query runs Dataset-B, whose own pool
  // bandwidth differs — hence the explicit (A) label.
  const autoH = useMemo(() => {
    const pool = lab.excludeOutliers ? dataset.points.filter((p) => !p.outlier) : dataset.points;
    return bandwidth(domain, pool, norm);
  }, [domain, dataset, norm, lab.excludeOutliers]);

  // Baseline = default-settings LOO, for the Δ chips. Memoized on its REAL
  // inputs only (domain/dataset/norm) — listing `loo` would re-run this on
  // every knob tick for a bit-identical result.
  const defaultLoo = useMemo(
    () =>
      runLoo(domain, dataset, norm, {
        bandwidthScale: LAB_DEFAULTS.bandwidthScale,
        kNeighbors: LAB_DEFAULTS.kNeighbors,
        excludeOutliers: LAB_DEFAULTS.excludeOutliers,
      }),
    [domain, dataset, norm]
  );
  const baseline = isDefault ? loo : defaultLoo;

  // Δ comparison restricted to the folds BOTH models predicted (fold
  // attrition otherwise flatters whichever setting refuses the hard points).
  const cmp = useMemo(() => {
    if (isDefault || !loo || !baseline) return null;
    const inter = intersectFoldMetrics([loo, baseline]);
    return inter ? { current: inter.metrics[0], base: inter.metrics[1], n: inter.n } : null;
  }, [isDefault, loo, baseline]);
  const foldNote = cmp ? `on the ${cmp.n} folds both models predicted` : "";

  // Bandwidth validation curve. Deliberately NOT a function of bandwidthScale
  // (the sweep IS over it), so dragging the bandwidth slider never recomputes
  // it; K / outlier changes are deferred to keep the slider responsive.
  const sweepK = useDeferredValue(lab.kNeighbors);
  const sweepOutliers = useDeferredValue(lab.excludeOutliers);
  const curve = useMemo(() => {
    const runs = LAB_SWEEP_SCALES.map((scale) => ({
      scale,
      loo: runLoo(domain, dataset, norm, { bandwidthScale: scale, kNeighbors: sweepK, excludeOutliers: sweepOutliers }),
    })).filter((s): s is { scale: number; loo: LooResult } => s.loo != null);
    if (runs.length < 3) return null;
    // Commensurable errors only: every scale evaluated on the SAME shared folds.
    const inter = intersectFoldMetrics(runs.map((s) => s.loo));
    if (!inter) return null;
    return {
      points: runs.map((s, i) => ({ scale: s.scale, rmse: inter.metrics[i].rmseLog, mae: inter.metrics[i].maeLog })),
      n: inter.n,
    };
  }, [domain, dataset, norm, sweepK, sweepOutliers]);

  return (
    <section className="panel overflow-hidden" data-testid="model-lab">
      <SectionHeader
        title="Model lab — tune the estimator"
        hint={`An educational sandbox: adjust the kernel hyperparameters and watch the held-out accuracy of the ${spec.propertyLabel.toLowerCase()} model respond.`}
        right={
          !isDefault && (
            <button
              onClick={() => onLab({ ...LAB_DEFAULTS })}
              className="btn px-3 py-1.5 text-xs"
              title="Return every knob to the calibrated default"
            >
              Reset to defaults
            </button>
          )
        }
      />

      <div className="grid lg:grid-cols-[0.95fr_1.05fr]">
        {/* ── knobs ── */}
        <div className="border-b border-ink-100 lg:border-b-0 lg:border-r">
          <div className="border-b border-ink-100 px-5 py-4">
            <div className="flex items-baseline justify-between gap-2">
              <span className="label-eyebrow">Kernel bandwidth</span>
              <span
                className="font-mono text-xs font-semibold text-ink-900 tnum"
                title="Effective bandwidth of the conservative Dataset-A pool. A film-conditioned bench query runs Dataset-B, whose own pool bandwidth differs."
              >
                ×{lab.bandwidthScale.toFixed(2)} · h(A) = {(autoH * lab.bandwidthScale).toFixed(2)}
              </span>
            </div>
            <input
              type="range"
              min={0.5}
              max={2}
              step={0.05}
              value={lab.bandwidthScale}
              onChange={(e) => onLab({ bandwidthScale: Number(e.target.value) })}
              className="mt-2 w-full accent-violet-600"
              aria-label="Kernel bandwidth multiplier"
            />
            <p className="mt-1.5 text-xs leading-5 text-ink-700">
              How far the kernel trusts an analog. Narrow it and the model listens only to the closest chemistry —
              flexible but jumpy (variance). Widen it and distant analogs vote too — stable but blurred (bias). The
              auto default (×1.00) is the median pairwise distance between measured pairs.
            </p>
          </div>

          <div className="border-b border-ink-100 px-5 py-4">
            <div className="flex items-baseline justify-between gap-2">
              <span className="label-eyebrow">Neighborhood size K</span>
              <span className="font-mono text-xs font-semibold text-ink-900 tnum">{lab.kNeighbors} analogs</span>
            </div>
            <input
              type="range"
              min={1}
              max={10}
              step={1}
              value={lab.kNeighbors}
              onChange={(e) => onLab({ kNeighbors: Number(e.target.value) })}
              className="mt-2 w-full accent-violet-600"
              aria-label="Kernel neighborhood size K"
            />
            <p className="mt-1.5 text-xs leading-5 text-ink-700">
              How many nearest analogs are averaged. K = 1 copies the single closest measurement (noisy); large K
              smooths over chemistry that may no longer be comparable. Below K = 3 the Interpolated tier is
              unreachable by construction — estimates cap at Extrapolated and the ranked shortlist shows measured
              pairs only.
            </p>
          </div>

          <div className="px-5 py-4">
            <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-semibold text-ink-700">
              <input
                type="checkbox"
                checked={lab.excludeOutliers}
                onChange={(e) => onLab({ excludeOutliers: e.target.checked })}
                className="h-3.5 w-3.5 accent-violet-600"
              />
              exclude flagged outliers ({outlierCount})
            </label>
            <p className="mt-1.5 text-xs leading-5 text-ink-700">
              Drops points whose log₁₀ {spec.symbol} sits beyond |z| &gt; 3.5 (modified z-score) from training and
              validation alike. Robustness against leverage points — at the cost of discarding evidence.
            </p>
            <p className="mt-3 rounded-[9px] border border-ink-200/70 bg-ink-50/60 px-3 py-2 text-[11px] leading-4 text-ink-500">
              Settings are live for the whole studio: the bench, the atlas, the ranked shortlist, the calibration
              certificate and every interval recalibrate to these hyperparameters. Each estimate discloses
              non-default settings in its reasons, and exports carry a settings line.
            </p>
          </div>
        </div>

        {/* ── validated metrics ── */}
        <div className="px-5 py-4">
          {loo ? (
            <>
              <div className="grid grid-cols-3 gap-2">
                <MetricTile
                  label="R²"
                  hint="Coefficient of determination on log₁₀ values, leave-one-out. Negative = worse than predicting the mean."
                  value={loo.r2 == null ? "—" : fmt3(loo.r2)}
                  delta={
                    <MetricDelta current={cmp?.current.r2 ?? null} baseline={cmp?.base.r2 ?? null} betterWhenLower={false} foldNote={foldNote} />
                  }
                />
                <MetricTile
                  label="RMSE"
                  hint="Root-mean-square error of held-out log₁₀ predictions (log₁₀ units)."
                  value={fmt3(loo.rmseLog)}
                  delta={
                    <MetricDelta current={cmp?.current.rmseLog ?? null} baseline={cmp?.base.rmseLog ?? null} betterWhenLower foldNote={foldNote} />
                  }
                />
                <MetricTile
                  label="MAE"
                  hint="Mean absolute error of held-out log₁₀ predictions (log₁₀ units)."
                  value={fmt3(loo.maeLog)}
                  delta={
                    <MetricDelta current={cmp?.current.maeLog ?? null} baseline={cmp?.base.maeLog ?? null} betterWhenLower foldNote={foldNote} />
                  }
                />
              </div>
              <p className="mt-2 text-[11px] leading-4 text-ink-500">
                All metrics are leave-one-out — every point predicted by a model that never saw it — and live in
                log₁₀({spec.symbol}) space, the space the kernel fits. {loo.n} folds · median fold error ×/÷{" "}
                {loo.foldError.toFixed(2)}.{cmp ? ` Δ chips compare ${foldNote}.` : ""}
              </p>

              <div className="mt-4 grid items-start gap-4 sm:grid-cols-[1.3fr_1fr]">
                {curve && (
                  <div>
                    <span className="label-eyebrow">Validation curve — bias ↔ variance</span>
                    <div className="mt-1.5">
                      <ValidationCurve points={curve.points} currentScale={lab.bandwidthScale} />
                    </div>
                    <p className="mt-1 text-[11px] leading-4 text-ink-500">
                      Held-out error across the bandwidth sweep at K = {sweepK}, every point scored on the same{" "}
                      {curve.n} shared folds (settings that refuse hard folds get no free pass). The U-shape is the
                      bias–variance trade-off; the ring marks the sweep&apos;s lowest RMSE.
                    </p>
                  </div>
                )}
                <div>
                  <span className="label-eyebrow">Held-out fit</span>
                  <div className="mt-1.5">
                    <FitScatter loo={loo} />
                  </div>
                  <p className="mt-1 text-[11px] leading-4 text-ink-500">
                    Points on the dashed line were predicted exactly. R² {loo.r2 == null ? "—" : fmt3(loo.r2)} at the
                    current settings.
                  </p>
                </div>
              </div>
            </>
          ) : (
            <p className="rounded-[9px] border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs font-medium text-amber-800">
              Insufficient data for validation — R², RMSE and MAE unlock at {CALIBRATION_GATE} usable records (and at
              least 5 leave-one-out folds). Until then every output is a cited analog lookup, and this lab shows no
              numbers it cannot back.
            </p>
          )}

          <p className="mt-4 text-[11px] leading-4 text-ink-500">
            Scope: trained exclusively on nanoscale (AFM-class) friction —{" "}
            {dataset.scaleExcludedCount > 0
              ? `${dataset.scaleExcludedCount} macroscale (or unscaled) record${dataset.scaleExcludedCount === 1 ? " is" : "s are"} excluded from this model.`
              : "macroscopic friction is out of scope by design."}
          </p>
        </div>
      </div>
    </section>
  );
}
