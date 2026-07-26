import type { Domain } from "../domain";
import { ionVocabulary, type FeatureNorm, type IonDescriptor } from "./descriptors";
import { bandwidth, CALIBRATION_GATE, predict, type Prediction, type PredictQuery } from "./engine";
import type { ArrheniusFit } from "./arrhenius";
import { hasFilmInfo, type DomainDataset, type TrainingPoint } from "./dataset";

/**
 * The design space: every cation × anion combination over the enumerable ion
 * vocabulary (curated catalog + pattern ions + ions seen in the data). Each
 * cell is either measured (real records — shown as such), predicted (full
 * pipeline), or insufficient. Below CALIBRATION_GATE usable records the atlas
 * degrades to coverage-only: measured cells light up, nothing else is colored,
 * and ranking is disabled — it unlocks as records are approved.
 */

export interface DesignConstraints {
  halideFree?: boolean;
  fluorineFree?: boolean;
  /** Exclude these ion families entirely (cation or anion side). */
  familiesExcluded?: string[];
  maxChainLength?: number | null;
  maxHeavyMass?: number | null;
}

export type CellKind = "measured" | "predicted" | "insufficient";

export interface AtlasCell {
  cation: IonDescriptor;
  anion: IonDescriptor;
  pairKey: string;
  kind: CellKind;
  /** Training points measured for this pair (any condition/temperature). */
  measured: TrainingPoint[];
  /** Median measured value when kind=measured, predicted value when kind=predicted. */
  value: number | null;
  prediction: Prediction | null;
  /** True when every backing record is review-status (amber ring in the atlas). */
  reviewOnly: boolean;
}

export interface Atlas {
  cations: IonDescriptor[];
  anions: IonDescriptor[];
  /** cells[cationIndex][anionIndex] */
  cells: AtlasCell[][];
  /** True = coverage-only mode (no predictions rendered, ranking disabled). */
  gated: boolean;
  usableN: number;
}

export function passesConstraints(ion: IonDescriptor, c: DesignConstraints): boolean {
  if (c.halideFree && (ion.family === "halide" || ion.family === "pseudohalide")) return false;
  if (c.fluorineFree && ion.nF > 0) return false;
  if (c.familiesExcluded?.includes(ion.family)) return false;
  if (c.maxChainLength != null && ion.chainLength > c.maxChainLength) return false;
  if (c.maxHeavyMass != null && ion.heavyMass > c.maxHeavyMass) return false;
  return true;
}

export function buildVocabulary(kind: "cation" | "anion", dataset: DomainDataset): IonDescriptor[] {
  const seen = dataset.points.map((p) => (kind === "cation" ? p.cation.label : p.anion.label));
  return ionVocabulary(kind, seen);
}

export function buildAtlas(
  domain: Domain,
  dataset: DomainDataset,
  norm: FeatureNorm,
  baseQuery: Omit<PredictQuery, "cation" | "anion">,
  constraints: DesignConstraints = {},
  opts: { sigmaCal?: number | null; bandwidthScale?: number; kNeighbors?: number; excludeOutliers?: boolean } = {}
): Atlas {
  const cations = buildVocabulary("cation", dataset).filter((i) => passesConstraints(i, constraints));
  const anions = buildVocabulary("anion", dataset).filter((i) => passesConstraints(i, constraints));

  // Apply the SAME hard facet the engine applies: a diffusion atlas at one
  // species must neither count, color, nor present as "measured" any evidence
  // from another species. (Mirrors predict() — empty species → empty pool.)
  let pool = dataset.points;
  if (domain === "diffusion") {
    const sp = (baseQuery.species ?? "").trim().toLowerCase();
    pool = sp ? pool.filter((p) => (p.species ?? "").toLowerCase() === sp) : [];
  }
  // Mirror the engine's optional outlier exclusion (same order as predict()).
  if (opts.excludeOutliers) pool = pool.filter((p) => !p.outlier);
  // Mirror the engine's dual pathway: a film-conditioned atlas runs Dataset-B,
  // so its gate and bandwidth come from the same pool the engine will use.
  if (domain === "tribology" && (baseQuery.filmThicknessM != null || baseQuery.filmLayers != null)) {
    const filmPool = pool.filter((p) => p.conditions && hasFilmInfo(p.conditions));
    if (filmPool.length > 0) pool = filmPool;
  }

  const byPair = new Map<string, TrainingPoint[]>();
  for (const p of pool) {
    const list = byPair.get(p.pairKey) ?? [];
    list.push(p);
    byPair.set(p.pairKey, list);
  }

  const usableN = pool.length;
  const gated = usableN < CALIBRATION_GATE;

  // Pool invariants are identical for every cell — hoist them out of the loop
  // (bandwidth is O(pairs²); recomputing it per cell made the atlas quadratic).
  const fitByGroup = new Map<string, ArrheniusFit>();
  for (const f of dataset.fits) fitByGroup.set(f.groupKey, f);
  const precomputed = { bandwidth: bandwidth(domain, pool, norm), fitByGroup };

  const cells: AtlasCell[][] = cations.map((cation) =>
    anions.map((anion) => {
      const pairKey = `${cation.key}|${anion.key}`;
      const measured = byPair.get(pairKey) ?? [];
      if (measured.length > 0) {
        const ys = measured.map((m) => m.y).sort((a, b) => a - b);
        const mid = Math.floor(ys.length / 2);
        return {
          cation,
          anion,
          pairKey,
          kind: "measured" as const,
          measured,
          value: ys.length % 2 ? ys[mid] : (ys[mid - 1] + ys[mid]) / 2,
          prediction: null,
          reviewOnly: measured.every((m) => m.officialCount === 0),
        };
      }
      if (gated) {
        return { cation, anion, pairKey, kind: "insufficient" as const, measured, value: null, prediction: null, reviewOnly: false };
      }
      const prediction = predict(domain, dataset, { ...baseQuery, cation, anion }, norm, {
        sigmaCal: opts.sigmaCal,
        bandwidthScale: opts.bandwidthScale,
        kNeighbors: opts.kNeighbors,
        excludeOutliers: opts.excludeOutliers,
        precomputed,
      });
      // A gated estimate must never be colored/ranked/exported, even if the
      // atlas itself cleared its gate (defense in depth — the engine's facet
      // and the atlas facet are kept identical above).
      const ok = prediction.kind === "estimate" && !prediction.gated;
      return {
        cation,
        anion,
        pairKey,
        kind: ok ? ("predicted" as const) : ("insufficient" as const),
        measured,
        value: ok ? prediction.value : null,
        prediction,
        reviewOnly: false,
      };
    })
  );

  return { cations, anions, cells, gated, usableN };
}

export interface RankedCandidate {
  cell: AtlasCell;
  rank: number;
  novel: boolean;
}

/**
 * Ranked shortlist at the atlas conditions. Measured + Interpolated cells by
 * default; Extrapolated joins only when explicitly asked. Returns [] when the
 * atlas is gated — ranking at n<8 would be noise theater.
 */
export function rankCandidates(
  atlas: Atlas,
  objective: "max" | "min",
  opts: { includeExtrapolated?: boolean; limit?: number } = {}
): RankedCandidate[] {
  if (atlas.gated) return [];
  const eligible: AtlasCell[] = [];
  for (const row of atlas.cells) {
    for (const cell of row) {
      if (cell.value == null) continue;
      if (cell.kind === "measured") eligible.push(cell);
      else if (cell.prediction?.tier === "interpolated") eligible.push(cell);
      else if (opts.includeExtrapolated && cell.prediction?.tier === "extrapolated") eligible.push(cell);
    }
  }
  eligible.sort((a, b) => (objective === "max" ? (b.value ?? 0) - (a.value ?? 0) : (a.value ?? 0) - (b.value ?? 0)));
  return eligible.slice(0, opts.limit ?? 10).map((cell, i) => ({ cell, rank: i + 1, novel: cell.kind !== "measured" }));
}
