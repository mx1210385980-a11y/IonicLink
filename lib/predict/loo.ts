import type { Domain } from "../domain";
import type { FeatureNorm } from "./descriptors";
import { bandwidth, CALIBRATION_GATE, predict } from "./engine";
import type { DomainDataset, TrainingPoint } from "./dataset";
import { fitArrhenius, medianEa, type ArrheniusFit } from "./arrhenius";

/**
 * Leave-one-out calibration: predict every training point from the others with
 * the identical pipeline. The median absolute residual (log₁₀) becomes the
 * FLOOR of every prediction interval — the model can never claim more accuracy
 * than it has demonstrated on the data it holds. 10^σ is literally the median
 * fold error: half the held-out points were predicted within ×/÷ that factor.
 *
 * Gated below CALIBRATION_GATE usable points — and, for diffusion, the gate is
 * applied PER SPECIES facet: a fold is only attempted when the held-out point's
 * own species pool clears the gate, so a calibration number is never derived
 * from sub-gate pools (6 cation-D + 4 anion-D points calibrate nothing).
 */

export interface LooPair {
  groupLabel: string;
  /** Stable identity of the held-out point (groupKey + temperature) — lets two
   *  LOO runs be compared on the INTERSECTION of folds they both predicted. */
  pointKey: string;
  measuredLog: number;
  predictedLog: number;
}

/**
 * Study-grade goodness-of-fit metrics over the SAME held-out folds. All in
 * log₁₀ space — the space the model actually fits (COF/σ/D span decades; a
 * linear-space RMSE would be dominated by the largest values). These are
 * REPORTING metrics: the interval floor stays `sigmaCal` (the median), which
 * is robust where the mean-based RMSE/MAE are leverage-sensitive.
 */
export interface LooMetrics {
  /** Root-mean-square error of the log₁₀ predictions (log₁₀ units). */
  rmseLog: number;
  /** Mean absolute error of the log₁₀ predictions (log₁₀ units). */
  maeLog: number;
  /**
   * Coefficient of determination on log₁₀ values. Out-of-sample, so it CAN go
   * negative (worse than predicting the mean) — that is shown, not hidden.
   * Null when the measured values have no variance (R² undefined).
   */
  r2: number | null;
}

export function looMetrics(pairs: LooPair[]): LooMetrics {
  const n = pairs.length;
  const residuals = pairs.map((p) => p.predictedLog - p.measuredLog);
  const rmseLog = Math.sqrt(residuals.reduce((a, r) => a + r * r, 0) / n);
  const maeLog = residuals.reduce((a, r) => a + Math.abs(r), 0) / n;
  const meanMeasured = pairs.reduce((a, p) => a + p.measuredLog, 0) / n;
  const ssTot = pairs.reduce((a, p) => a + (p.measuredLog - meanMeasured) ** 2, 0);
  const ssRes = residuals.reduce((a, r) => a + r * r, 0);
  return { rmseLog, maeLog, r2: ssTot > 0 ? 1 - ssRes / ssTot : null };
}

export interface LooResult extends LooMetrics {
  n: number;
  /** Median |predicted − measured| in log₁₀. */
  sigmaCal: number;
  /** 10^sigmaCal — the human-readable "×/÷" median fold error. */
  foldError: number;
  pairs: LooPair[];
}

/**
 * Restrict several LOO runs to the folds ALL of them predicted, and return
 * each run's metrics over exactly that shared set. Comparing raw metrics
 * across runs is a selection artifact: a narrower bandwidth REFUSES the
 * hardest (most isolated) folds, so its metric over the surviving easy folds
 * looks spuriously better. Null when fewer than 5 folds are shared.
 */
export function intersectFoldMetrics(runs: LooResult[]): { metrics: LooMetrics[]; n: number } | null {
  if (runs.length === 0) return null;
  let keys = new Set(runs[0].pairs.map((p) => p.pointKey));
  for (const r of runs.slice(1)) {
    const other = new Set(r.pairs.map((p) => p.pointKey));
    keys = new Set([...keys].filter((k) => other.has(k)));
  }
  if (keys.size < 5) return null;
  return {
    metrics: runs.map((r) => looMetrics(r.pairs.filter((p) => keys.has(p.pointKey)))),
    n: keys.size,
  };
}

/** Re-derive per-group Arrhenius fits from a reduced point set (no leakage from the held-out point). */
function refit(domain: Domain, points: TrainingPoint[]): { fits: ArrheniusFit[]; medianEaJmol: number | null } {
  if (domain === "tribology") return { fits: [], medianEaJmol: null };
  const byGroup = new Map<string, TrainingPoint[]>();
  for (const p of points) {
    const list = byGroup.get(p.groupKey) ?? [];
    list.push(p);
    byGroup.set(p.groupKey, list);
  }
  const fits: ArrheniusFit[] = [];
  for (const [groupKey, list] of byGroup) {
    const pts = list
      .filter((p) => p.tempK != null)
      .map((p) => ({ tempK: p.tempK as number, y: p.y, ids: p.members.map((m) => m.id) }));
    const fit = fitArrhenius(pts, {
      groupKey,
      groupLabel: list[0].groupLabel,
      cationFamily: list[0].cation.family,
    });
    if (fit) fits.push(fit);
  }
  return { fits, medianEaJmol: medianEa(fits) };
}

export interface LooOptions {
  /** Tribology: calibrate the conservative model "A" (default — film column unused) or the
   *  film-thickness pathway "B" (held-out points restricted to the Dataset-B pool). */
  tribologyPathway?: "A" | "B";
  /** Model-lab knob: bandwidth multiplier, forwarded to every fold's predict(). */
  bandwidthScale?: number;
  /** Model-lab knob: kernel neighborhood size K, forwarded to every fold's predict(). */
  kNeighbors?: number;
  /** Exclude MAD-flagged outliers — from training (via predict) AND from the
   *  held-out set, so the calibration describes the same cleaned pool the
   *  estimates are drawn from. */
  excludeOutliers?: boolean;
}

export function runLoo(domain: Domain, dataset: DomainDataset, norm: FeatureNorm, opts: LooOptions = {}): LooResult | null {
  const pathway = opts.tribologyPathway ?? "A";
  let eligible =
    domain === "tribology" && pathway === "B"
      ? dataset.points.filter((p) => p.conditions && (p.conditions.filmThicknessM != null || p.conditions.filmLayers != null))
      : dataset.points;
  // Excluded outliers are out of the model entirely — predicting them as
  // held-out points would charge the calibration for points it refuses to fit.
  if (opts.excludeOutliers) eligible = eligible.filter((p) => !p.outlier);
  if (eligible.length < CALIBRATION_GATE) return null;

  // Pool bandwidth hoisted ONCE for all folds (like the atlas does): the
  // engine otherwise recomputes the O(pairs²) median pairwise distance inside
  // every fold's predict(), which made LOO — and the model lab's bandwidth
  // sweep — quadratic and unusably slow at production size. A fold's n−1 pool
  // moves that median by at most one rank; the documented approximation is the
  // full eligible pool. The engine still applies bandwidthScale on top.
  const hoistedBandwidth = bandwidth(domain, eligible, norm);

  const facetSize = (p: TrainingPoint): number =>
    domain === "diffusion"
      ? eligible.filter((q) => (q.species ?? "").toLowerCase() === (p.species ?? "").toLowerCase()).length
      : eligible.length;

  const pairs: LooPair[] = [];
  for (const held of eligible) {
    if (facetSize(held) < CALIBRATION_GATE) continue;
    const rest = dataset.points.filter((q) => q !== held);
    const reduced: DomainDataset = { ...dataset, points: rest, ...refit(domain, rest) };
    const c = held.conditions;
    const p = predict(
      domain,
      reduced,
      {
        cation: held.cation,
        anion: held.anion,
        tempK: held.tempK,
        substrate: held.substrate ?? null,
        species: held.species ?? null,
        // the held-out point's own operating conditions are the query — folds
        // calibrate the same condition-aware distance the bench uses
        loadN: c?.loadN ?? null,
        velocityMps: c?.velocityMps ?? null,
        potentialV: c?.potentialV ?? null,
        roughnessM: c?.roughnessM ?? null,
        scale: c?.scale ?? null,
        method: c?.method ?? null,
        // film fields only when calibrating pathway B — pathway A must never see h
        filmThicknessM: pathway === "B" ? c?.filmThicknessM ?? null : null,
        filmLayers: pathway === "B" ? c?.filmLayers ?? null : null,
      },
      norm,
      {
        skipExactMatch: true,
        bandwidthScale: opts.bandwidthScale,
        kNeighbors: opts.kNeighbors,
        excludeOutliers: opts.excludeOutliers,
        precomputed: { bandwidth: hoistedBandwidth },
      }
    );
    if (p.kind === "estimate" && p.value != null) {
      pairs.push({
        groupLabel: held.groupLabel,
        pointKey: `${held.groupKey}@${held.tempK ?? "?"}`,
        measuredLog: held.logY,
        predictedLog: Math.log10(p.value),
      });
    }
  }
  // Some folds may rightly refuse (a held-out point with no near analog). The
  // gate above is on dataset size; here we only need enough residuals for a
  // meaningful median.
  if (pairs.length < 5) return null;

  // Median absolute log-error — NOT a MAD-about-median (so no 1.4826 factor):
  // 10^sigmaCal is then exactly the "median fold error" the UI advertises.
  const absRes = pairs.map((p) => Math.abs(p.predictedLog - p.measuredLog)).sort((a, b) => a - b);
  const mid = Math.floor(absRes.length / 2);
  const sigmaCal = absRes.length % 2 ? absRes[mid] : (absRes[mid - 1] + absRes[mid]) / 2;
  return { n: pairs.length, sigmaCal, foldError: 10 ** sigmaCal, pairs, ...looMetrics(pairs) };
}
