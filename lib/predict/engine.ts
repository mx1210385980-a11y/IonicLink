import type { Domain } from "../domain";
import {
  featureNorm,
  normalizedFeatureDelta,
  type FeatureNorm,
  type IonDescriptor,
} from "./descriptors";
import { medianEa, translateArrhenius, type ArrheniusFit } from "./arrhenius";
import {
  hasFilmInfo,
  normalizeSubstrateKey,
  substrateClass,
  type DomainDataset,
  type OperatingConditions,
  type TrainingPoint,
} from "./dataset";
import { surfaceDistance } from "./surfaces";

/**
 * The prediction core: similarity-weighted nearest neighbors (Nadaraya-Watson
 * kernel regression) in ion-descriptor space, in log₁₀ — COF, σ and D are all
 * strictly positive and span decades.
 *
 * Honesty rules baked in (not UI decoration):
 * - An exact pair+condition match returns the MEASUREMENT, never a model output.
 * - Below CALIBRATION_GATE usable points the result is `gated`: the engine
 *   still computes internally, but consumers must not render the number —
 *   only the cited nearest analogs.
 * - The Insufficient tier carries no value at all.
 * - Every temperature shift is labeled with the platform's evidence-basis
 *   vocabulary: own-pair fit = "inferred", borrowed median slope = "assumed".
 */

/** Statistical estimates (and LOO calibration) unlock at this many usable points. */
export const CALIBRATION_GATE = 8;

/** |ΔT| ≤ this counts as "the same temperature" for exact-match lookups. */
export const EXACT_TEMP_TOLERANCE_K = 2;

export type Tier = "measured" | "interpolated" | "extrapolated" | "insufficient";

export interface PredictQuery {
  cation: IonDescriptor;
  anion: IonDescriptor;
  tempK?: number | null;
  /** Tribology: soft conditioning; null/undefined = any substrate. */
  substrate?: string | null;
  /** Diffusion: HARD facet — cation / anion / tracer label, never mixed. */
  species?: string | null;

  /* ---- tribology operating conditions (null/undefined = unconditioned) ---- */
  loadN?: number | null;
  velocityMps?: number | null;
  potentialV?: number | null;
  roughnessM?: number | null;
  /** Specifying film thickness (or layers) selects the Dataset-B "interfacial
   *  structure-enhanced" pathway; otherwise the conservative Dataset-A model runs. */
  filmThicknessM?: number | null;
  filmLayers?: number | null;
  scale?: string | null;
  method?: string | null;
}

export type Pathway = "A" | "B";

export interface Translation {
  fromK: number;
  toK: number;
  eaJmol: number;
  source: "pair-fit" | "borrowed-median";
  basis: "inferred" | "assumed";
  fitLabel: string;
}

export interface NeighborEvidence {
  point: TrainingPoint;
  /** Descriptor distance including any temperature penalty. */
  distance: number;
  weight: number;
  /** Fraction of the estimate this neighbor contributes (Σ = 1). */
  share: number;
  /** Value actually used (after any temperature translation), canonical units. */
  yUsed: number;
  translation: Translation | null;
  /** Human-readable distance breakdown, e.g. "same anion · related cation family". */
  breakdown: string;
}

export interface PredictionFacts {
  usableN: number;
  /** Tribology model pathway: A = conservative (film thickness unused), B = interfacial structure-enhanced. */
  pathway: Pathway;
  /** Size of the film-thickness (Dataset-B) pool. */
  filmPoolN: number;
  k: number;
  nEff: number;
  d1: number | null;
  dbar: number | null;
  bandwidth: number;
  spreadLog: number;
  sigmaLog: number | null;
  borrowedSlope: boolean;
  borrowedCrossFamily: boolean;
  /** Kelvin beyond the evidence temperature range (0 = inside). */
  tBeyondK: number;
  officialFraction: number;
}

export interface Prediction {
  kind: "measured" | "estimate" | "insufficient";
  /** True when usable pool < CALIBRATION_GATE — consumers must not render the value. */
  gated: boolean;
  tier: Tier;
  /** Canonical-unit estimate (geometric/kernel), null for insufficient. */
  value: number | null;
  /** Multiplicative ×/÷ interval factor (10^σ), null for measured/insufficient. */
  fold: number | null;
  low: number | null;
  high: number | null;
  /** Contributing evidence (estimate), the matched measurements (measured), or nearest analogs (insufficient/gated). */
  neighbors: NeighborEvidence[];
  facts: PredictionFacts;
  /** Plain-text reasons behind the tier/interval. */
  reasons: string[];
  /** Why no number is shown (insufficient only). */
  refusal: string | null;
}

export interface PredictOptions {
  /** LOO calibration σ (log₁₀) — the interval can never be tighter than this. */
  sigmaCal?: number | null;
  /** Skip the exact-match short-circuit (used by leave-one-out). */
  skipExactMatch?: boolean;
  /** Exclude MAD-flagged outliers from the pool. */
  excludeOutliers?: boolean;
  /**
   * Model-lab knob: multiply the auto kernel bandwidth (1 = calibrated
   * default). Non-default values are disclosed in `reasons` — callers must
   * recompute the LOO floor under the same setting so intervals stay honest.
   */
  bandwidthScale?: number;
  /** Model-lab knob: kernel neighborhood size K (tribology default 1, other domains default 5; ≥1). */
  kNeighbors?: number;
  /** Pool invariants hoisted by batch callers (the atlas) — values must match the same pool. */
  precomputed?: { bandwidth?: number; fitByGroup?: Map<string, ArrheniusFit> };
}

/* ------------------------------------------------------------------ */
/* Distance                                                            */
/* ------------------------------------------------------------------ */

/** Family groups considered chemically related (graded 0.5 instead of 1). */
const RELATED_FAMILY_GROUPS: string[][] = [
  ["imidazolium", "pyrrolidinium", "pyridinium"],
  ["ammonium", "phosphonium"],
  ["sulfonylimide", "fluoroborate", "fluorophosphate", "fluoroalkyl phosphate", "cyanoborate"],
  ["sulfonate", "sulfate", "sulfosuccinate", "carboxylate", "phosphate", "phosphinate", "alkyl bis(mandelato)borate"],
  ["halide", "pseudohalide"],
  ["cyanamide", "cyanocarbon", "cyanoborate"],
];

function familyTerm(a: IonDescriptor, b: IonDescriptor): number {
  if (a.family === b.family) return 0;
  if (a.family === "unknown" || b.family === "unknown") return 1;
  for (const group of RELATED_FAMILY_GROUPS) {
    if (group.includes(a.family) && group.includes(b.family)) return 0.5;
  }
  return 1;
}

export function ionDistance(a: IonDescriptor, b: IonDescriptor, norm: FeatureNorm): number {
  if (a.key === b.key) return 0;
  return 0.4 * familyTerm(a, b) + 0.6 * normalizedFeatureDelta(a, b, norm);
}

/** |Δlog₁₀| distance for decade-spanning condition values, capped at 1. */
function logDelta(a: number, b: number, decades: number): number {
  if (a <= 0 || b <= 0) return 0.5;
  return Math.min(1, Math.abs(Math.log10(a) - Math.log10(b)) / decades);
}

/**
 * Gower-style operating-condition distance (tribology). Components are
 * compared ONLY for conditions the query specifies (unspecified = wildcard,
 * like "any substrate"); a query-specified condition the evidence point never
 * recorded scores a fixed 0.5 — unknown is a penalty, never a free pass.
 * Friction varies non-monotonically with potential ([BMIM][BF4]/HOPG), so the
 * potential term is linear in ΔV, not a coarse match flag.
 */
export function conditionDistance(
  query: PredictQuery,
  c: OperatingConditions | undefined
): { d: number; parts: string[]; compared: number } {
  const comps: number[] = [];
  const parts: string[] = [];
  const push = (
    label: string,
    queryV: number | null | undefined,
    pointV: number | null | undefined,
    dist: (a: number, b: number) => number,
    show: (a: number, b: number) => string
  ) => {
    if (queryV == null) return;
    if (pointV == null || !c) {
      comps.push(0.5);
      parts.push(`${label} not recorded`);
      return;
    }
    const d = dist(queryV, pointV);
    comps.push(d);
    if (d > 0.02) parts.push(show(queryV, pointV));
  };

  push("load", query.loadN, c?.loadN, (a, b) => logDelta(a, b, 4), (a, b) => `load Δ${Math.abs(Math.log10(a / b)).toFixed(1)} decades`);
  push("velocity", query.velocityMps, c?.velocityMps, (a, b) => logDelta(a, b, 4), (a, b) => `speed Δ${Math.abs(Math.log10(a / b)).toFixed(1)} decades`);
  push(
    "potential",
    query.potentialV,
    c?.potentialV,
    (a, b) => Math.min(1, Math.abs(a - b) / 2),
    (a, b) => `ΔU ${Math.abs(a - b).toFixed(2)} V`
  );
  push("roughness", query.roughnessM, c?.roughnessM, (a, b) => logDelta(a, b, 3), () => "roughness differs");

  if (query.scale) {
    comps.push(c?.scale === query.scale ? 0 : 1);
    if (c?.scale !== query.scale) parts.push(`scale ${c?.scale ?? "unknown"} vs ${query.scale}`);
  }
  if (query.method) {
    const same = (c?.method ?? "") === query.method.trim().toLowerCase();
    comps.push(same ? 0 : 1);
    if (!same) parts.push("different method");
  }

  if (comps.length === 0) return { d: 0, parts, compared: 0 };
  return { d: comps.reduce((a, b) => a + b, 0) / comps.length, parts, compared: comps.length };
}

/**
 * Film-thickness distance (Dataset-B pathway only). A reported thickness and
 * a reported layer count are never converted into each other (no imputation);
 * comparing across the two representations scores a fixed 0.5.
 */
export function filmDistance(query: PredictQuery, c: OperatingConditions | undefined): number {
  if (query.filmThicknessM != null) {
    if (c?.filmThicknessM != null) return logDelta(query.filmThicknessM, c.filmThicknessM, 2);
    if (c?.filmLayers != null) return 0.5;
    return 1;
  }
  if (query.filmLayers != null) {
    if (c?.filmLayers != null) return Math.min(1, Math.abs(query.filmLayers - c.filmLayers) / 5);
    if (c?.filmThicknessM != null) return 0.5;
    return 1;
  }
  return 0;
}

const RADIUS_RATIO_SPAN = 2.5;

function radiusRatioDelta(qc: IonDescriptor, qa: IonDescriptor, pc: IonDescriptor, pa: IonDescriptor): number {
  if (!qc.radiusA || !qa.radiusA || !pc.radiusA || !pa.radiusA) return 0;
  return Math.min(1, Math.abs(qc.radiusA / qa.radiusA - pc.radiusA / pa.radiusA) / RADIUS_RATIO_SPAN);
}

function pairDistance(domain: Domain, query: PredictQuery, point: TrainingPoint, norm: FeatureNorm, pathway: Pathway): number {
  const dc = ionDistance(query.cation, point.cation, norm);
  const da = ionDistance(query.anion, point.anion, norm);
  if (domain !== "tribology") return 0.5 * dc + 0.5 * da;

  // Ion structure: cation + anion + the r_cat/r_an packing ratio.
  const dIons = 0.45 * dc + 0.45 * da + 0.1 * radiusRatioDelta(query.cation, query.anion, point.cation, point.anion);
  // Surface: identity → class → γ_s / θ_s / σ_s / conductor / layered / plane.
  const dSurf = query.substrate ? surfaceDistance(query.substrate, point.substrate) : 0;
  const dCond = conditionDistance(query, point.conditions).d;
  if (pathway === "B") {
    return 0.35 * dIons + 0.12 * dSurf + 0.33 * dCond + 0.2 * filmDistance(query, point.conditions);
  }
  // Pathway A — the conservative model: the film-thickness column is never consulted.
  return 0.4 * dIons + 0.15 * dSurf + 0.45 * dCond;
}

function hasTribologyRegimeSignal(query: PredictQuery): boolean {
  return (
    !!query.substrate ||
    query.loadN != null ||
    query.velocityMps != null ||
    query.potentialV != null ||
    query.roughnessM != null ||
    query.filmThicknessM != null ||
    query.filmLayers != null ||
    !!query.scale ||
    !!query.method
  );
}

function ionBreakdown(kind: "cation" | "anion", q: IonDescriptor, p: IonDescriptor): string {
  if (q.key === p.key) return `same ${kind}`;
  if (q.family === p.family) {
    const dn = Math.abs(q.chainLength - p.chainLength);
    return dn > 0 ? `same ${kind} family · Δchain ${dn}` : `same ${kind} family`;
  }
  return familyTerm(q, p) === 0.5 ? `related ${kind} family` : `different ${kind} family`;
}

/** Median pairwise descriptor distance among distinct pairs — the kernel bandwidth. */
export function bandwidth(domain: Domain, points: TrainingPoint[], norm: FeatureNorm): number {
  const byPair = new Map<string, TrainingPoint>();
  for (const p of points) if (!byPair.has(p.pairKey)) byPair.set(p.pairKey, p);
  const pairs = [...byPair.values()];
  const dists: number[] = [];
  for (let i = 0; i < pairs.length; i++) {
    for (let j = i + 1; j < pairs.length; j++) {
      dists.push(
        0.5 * ionDistance(pairs[i].cation, pairs[j].cation, norm) +
          0.5 * ionDistance(pairs[i].anion, pairs[j].anion, norm)
      );
    }
  }
  if (dists.length === 0) return 0.5;
  dists.sort((a, b) => a - b);
  const mid = Math.floor(dists.length / 2);
  const med = dists.length % 2 ? dists[mid] : (dists[mid - 1] + dists[mid]) / 2;
  return med > 0.05 ? med : 0.5;
}

/* ------------------------------------------------------------------ */
/* Prediction                                                          */
/* ------------------------------------------------------------------ */

function emptyFacts(usableN: number, h: number): PredictionFacts {
  return {
    usableN,
    pathway: "A",
    filmPoolN: 0,
    k: 0,
    nEff: 0,
    d1: null,
    dbar: null,
    bandwidth: h,
    spreadLog: 0,
    sigmaLog: null,
    borrowedSlope: false,
    borrowedCrossFamily: false,
    tBeyondK: 0,
    officialFraction: 0,
  };
}

function insufficient(
  refusal: string,
  usableN: number,
  h: number,
  gated: boolean,
  analogs: NeighborEvidence[] = [],
  pathway: Pathway = "A",
  filmPoolN = 0
): Prediction {
  return {
    kind: "insufficient",
    gated,
    tier: "insufficient",
    value: null,
    fold: null,
    low: null,
    high: null,
    neighbors: analogs,
    facts: { ...emptyFacts(usableN, h), pathway, filmPoolN },
    reasons: [refusal],
    refusal,
  };
}

/** Tolerances under which a query-specified condition counts as "the same setpoint". */
function conditionsMatch(query: PredictQuery, p: TrainingPoint): boolean {
  const c = p.conditions;
  const relSame = (q: number | null | undefined, v: number | null | undefined) =>
    q == null || (v != null && v > 0 && q > 0 && Math.abs(Math.log10(q / v)) <= 0.022); // ≈ ±5%
  if (!relSame(query.loadN, c?.loadN)) return false;
  if (!relSame(query.velocityMps, c?.velocityMps)) return false;
  if (!relSame(query.roughnessM, c?.roughnessM)) return false;
  if (!relSame(query.filmThicknessM, c?.filmThicknessM)) return false;
  if (query.filmLayers != null && c?.filmLayers !== query.filmLayers) return false;
  if (query.potentialV != null && (c?.potentialV == null || Math.abs(c.potentialV - query.potentialV) > 0.05)) return false;
  if (query.scale && c?.scale !== query.scale) return false;
  if (query.method && (c?.method ?? "") !== query.method.trim().toLowerCase()) return false;
  return true;
}

export function predict(
  domain: Domain,
  dataset: DomainDataset,
  query: PredictQuery,
  norm: FeatureNorm,
  opts: PredictOptions = {}
): Prediction {
  // Hard facets first: species (diffusion) is never mixed; outliers optional.
  let pool = dataset.points;
  if (domain === "diffusion") {
    const sp = (query.species ?? "").trim().toLowerCase();
    pool = sp ? pool.filter((p) => (p.species ?? "").toLowerCase() === sp) : [];
  }
  if (opts.excludeOutliers) pool = pool.filter((p) => !p.outlier);

  // Dual pathway (tribology): when the query specifies an interfacial film
  // thickness (or layer count) AND film-bearing records exist, the
  // "interfacial structure-enhanced" Dataset-B model runs on exactly those
  // records; otherwise the conservative Dataset-A model runs and the film
  // column is never consulted. Missing h is NEVER imputed in either pathway.
  const filmPool = domain === "tribology" ? pool.filter((p) => p.conditions && hasFilmInfo(p.conditions)) : [];
  const wantFilm = domain === "tribology" && (query.filmThicknessM != null || query.filmLayers != null);
  const pathway: Pathway = wantFilm && filmPool.length > 0 ? "B" : "A";
  if (pathway === "B") pool = filmPool;

  const usableN = pool.length;
  const gated = usableN < CALIBRATION_GATE;
  // Model-lab knobs, sanitized: a hostile/garbage value falls back to default.
  const hScale =
    opts.bandwidthScale != null && Number.isFinite(opts.bandwidthScale) && opts.bandwidthScale > 0
      ? opts.bandwidthScale
      : 1;
  const defaultK = domain === "tribology" ? 1 : 5;
  const kWant =
    opts.kNeighbors != null && Number.isFinite(opts.kNeighbors) && opts.kNeighbors >= 1
      ? Math.round(opts.kNeighbors)
      : defaultK;
  const h = (opts.precomputed?.bandwidth ?? bandwidth(domain, pool, norm)) * hScale;

  // Non-physical query temperatures (cleared inputs, 0 K) are treated as absent
  // — translateArrhenius must never see toK ≤ 0.
  const queryTempK =
    query.tempK != null && Number.isFinite(query.tempK) && query.tempK > 0 ? query.tempK : null;

  if (!query.cation.resolved || !query.anion.resolved) {
    const which = !query.cation.resolved ? `cation "${query.cation.label}"` : `anion "${query.anion.label}"`;
    return insufficient(
      `Unrecognized ${which} — it cannot be featurized, so no analog search is possible.`,
      usableN,
      h,
      gated,
      [],
      pathway,
      filmPool.length
    );
  }
  if (usableN === 0) {
    const why =
      domain === "diffusion" && query.species
        ? `No usable records for species "${query.species}".`
        : "No usable records in the training pool.";
    return insufficient(why, usableN, h, gated, [], pathway, filmPool.length);
  }

  const pairKey = `${query.cation.key}|${query.anion.key}`;

  // 1 — exact-match short-circuit: same pair (+condition), same temperature → the measurement.
  if (!opts.skipExactMatch) {
    const matches = pool.filter((p) => {
      if (p.pairKey !== pairKey) return false;
      if (domain === "tribology" && query.substrate && p.substrateNorm !== normalizeSubstrateKey(query.substrate)) return false;
      // Conditions are part of a tribology system's identity: a [BMIM][BF4]/HOPG
      // record at +2 V is NOT a measurement of the 0 V query.
      if (domain === "tribology" && !conditionsMatch(query, p)) return false;
      if (queryTempK != null && domain !== "tribology") {
        // σ/D span decades over T: a record with no recorded temperature must
        // never be presented as "measured at" the query temperature.
        if (p.tempK == null || Math.abs(p.tempK - queryTempK) > EXACT_TEMP_TOLERANCE_K) return false;
      } else if (queryTempK != null && p.tempK != null && Math.abs(p.tempK - queryTempK) > EXACT_TEMP_TOLERANCE_K) {
        return false;
      }
      return true;
    });
    if (matches.length > 0) {
      const ys = matches.map((m) => m.y).sort((a, b) => a - b);
      const mid = Math.floor(ys.length / 2);
      const value = ys.length % 2 ? ys[mid] : (ys[mid - 1] + ys[mid]) / 2;
      const neighbors: NeighborEvidence[] = matches.map((p) => ({
        point: p,
        distance: 0,
        weight: 1,
        share: 1 / matches.length,
        yUsed: p.y,
        translation: null,
        breakdown: "exact pair + condition match",
      }));
      const officialFraction = matches.filter((m) => m.reviewCount === 0).length / matches.length;
      return {
        kind: "measured",
        gated: false,
        tier: "measured",
        value,
        fold: null,
        low: null,
        high: null,
        neighbors,
        facts: { ...emptyFacts(usableN, h), pathway, filmPoolN: filmPool.length, k: matches.length, nEff: matches.length, d1: 0, dbar: 0, officialFraction },
        reasons: [`Measured — ${matches.length === 1 ? "this exact system is" : `${matches.length} matching measurements are`} in the database. Not a prediction.`],
        refusal: null,
      };
    }
  }

  // Per-group Arrhenius fits (used to translate each pair's own evidence).
  let fitByGroup = opts.precomputed?.fitByGroup;
  if (!fitByGroup) {
    fitByGroup = new Map<string, ArrheniusFit>();
    for (const f of dataset.fits) fitByGroup.set(f.groupKey, f);
  }

  // Borrowable slopes: for diffusion, only fits of the SAME species — a D(Li+)
  // estimate must never be shifted by a D(cation)-derived activation energy.
  const borrowFits =
    domain === "diffusion"
      ? dataset.fits.filter((f) => (f.species ?? "").toLowerCase() === (query.species ?? "").trim().toLowerCase())
      : dataset.fits;
  const borrowEaJmol = medianEa(borrowFits);

  // 2 — score every point: descriptor distance + temperature handling.
  interface Scored {
    point: TrainingPoint;
    distance: number;
    yUsed: number;
    translation: Translation | null;
    breakdown: string;
  }
  const wantT = domain !== "tribology" && queryTempK != null;
  const scored: Scored[] = pool.map((point) => {
    let d = pairDistance(domain, query, point, norm, pathway);
    let yUsed = point.y;
    let translation: Translation | null = null;
    const parts = [ionBreakdown("cation", query.cation, point.cation), ionBreakdown("anion", query.anion, point.anion)];
    if (domain === "tribology") {
      if (query.substrate) {
        const ds = surfaceDistance(query.substrate, point.substrate);
        parts.push(ds === 0 ? "same substrate" : ds < 0.45 ? "similar surface" : "different surface");
      }
      const cond = conditionDistance(query, point.conditions);
      if (cond.compared > 0) parts.push(cond.parts.length ? cond.parts.join(" · ") : "conditions match");
      if (pathway === "B") {
        const df = filmDistance(query, point.conditions);
        parts.push(df === 0 ? "film thickness match" : df <= 0.5 ? "film differs" : "film representation differs");
      }
    }
    if (wantT && point.tempK == null) {
      // Unknown-temperature evidence must never outrank distant-but-known-T
      // evidence: penalize like an unverifiable ~25 K mismatch.
      d += 0.5;
      parts.push("temperature not recorded — penalized");
    }
    if (wantT && point.tempK != null) {
      const dT = (queryTempK as number) - point.tempK;
      if (Math.abs(dT) > EXACT_TEMP_TOLERANCE_K) {
        const fit = fitByGroup.get(point.groupKey);
        if (fit) {
          yUsed = translateArrhenius(point.y, point.tempK, queryTempK as number, fit.eaJmol);
          translation = {
            fromK: point.tempK,
            toK: queryTempK as number,
            eaJmol: fit.eaJmol,
            source: "pair-fit",
            basis: "inferred",
            fitLabel: `${fit.groupLabel} fit (${fit.nPoints} pts)`,
          };
          parts.push(`translated ${Math.round(point.tempK)}→${Math.round(queryTempK as number)} K along own fit`);
        } else if (borrowEaJmol != null) {
          yUsed = translateArrhenius(point.y, point.tempK, queryTempK as number, borrowEaJmol);
          translation = {
            fromK: point.tempK,
            toK: queryTempK as number,
            eaJmol: borrowEaJmol,
            source: "borrowed-median",
            basis: "assumed",
            fitLabel: `median Ea of ${borrowFits.length} fitted ${domain === "diffusion" ? "same-species " : ""}pair${borrowFits.length === 1 ? "" : "s"}`,
          };
          parts.push(`translated ${Math.round(point.tempK)}→${Math.round(queryTempK as number)} K with a borrowed slope`);
        } else {
          d += Math.abs(dT) / 50; // no Ea anywhere — penalize distance instead of inventing physics
          parts.push(`ΔT ${Math.round(Math.abs(dT))} K untranslated (no fitted Ea)`);
        }
      }
    }
    return { point, distance: d, yUsed, translation, breakdown: parts.join(" · ") };
  });

  scored.sort((a, b) => a.distance - b.distance);

  // 3 — insufficient: nothing within 2 bandwidths. Show nearest analogs, no number.
  const within = scored.filter((s) => s.distance < 2 * h);
  if (within.length === 0) {
    const analogs = scored.slice(0, 3).map((s) => ({
      point: s.point,
      distance: s.distance,
      weight: 0,
      share: 0,
      yUsed: s.point.y,
      translation: null,
      breakdown: s.breakdown,
    }));
    return insufficient(
      `No defensible estimate — the nearest measured analog is too dissimilar (d = ${scored[0].distance.toFixed(2)}, threshold ${(2 * h).toFixed(2)}).`,
      usableN,
      h,
      gated,
      analogs,
      pathway,
      filmPool.length
    );
  }

  // 4 — kernel estimate over the top-K neighbors.
  const capped = within.slice(0, Math.min(kWant, within.length));
  let top = capped;
  let localRegimeLimited = false;
  if (domain === "tribology" && kWant > 1 && hasTribologyRegimeSignal(query) && capped.length > 1) {
    const localLimit = capped[0].distance + Math.max(0.02, 0.05 * h);
    const local = capped.filter((s) => s.distance <= localLimit);
    if (local.length > 0 && local.length < capped.length) {
      top = local;
      localRegimeLimited = true;
    }
  }
  const k = top.length;
  const weightsRaw = top.map((s) => Math.exp(-((s.distance / h) ** 2)));
  const wSum = weightsRaw.reduce((a, b) => a + b, 0);
  const weights = weightsRaw.map((w) => (wSum > 0 ? w / wSum : 1 / k));
  const logs = top.map((s) => Math.log10(s.yUsed));
  const yLog = logs.reduce((acc, l, i) => acc + weights[i] * l, 0);
  const spreadLog = Math.sqrt(logs.reduce((acc, l, i) => acc + weights[i] * (l - yLog) ** 2, 0));
  const dbar = top.reduce((a, s) => a + s.distance, 0) / k;
  const d1 = top[0].distance;
  const nEff = (weights.reduce((a, b) => a + b, 0) ** 2) / weights.reduce((a, b) => a + b * b, 0);
  const borrowed = top.some((s) => s.translation?.source === "borrowed-median");
  const borrowedCrossFamily =
    borrowed &&
    top.some(
      (s) =>
        s.translation?.source === "borrowed-median" &&
        !borrowFits.some((f) => f.cationFamily === s.point.cation.family)
    );

  // Temperature extrapolation beyond the evidence range (+25 K grace).
  let tBeyondK = 0;
  if (wantT) {
    const temps = top.map((s) => s.point.tempK).filter((t): t is number => t != null);
    if (temps.length) {
      const lo = Math.min(...temps) - 25;
      const hi = Math.max(...temps) + 25;
      const t = queryTempK as number;
      tBeyondK = t < lo ? lo - t : t > hi ? t - hi : 0;
    }
  }

  // 5 — interval: floored by LOO calibration, inflated by distance / borrowed slope / T extrapolation.
  const sigmaCal = opts.sigmaCal ?? null;
  const sigmaLog =
    Math.max(spreadLog, sigmaCal ?? 0, 0.05) *
    (1 + dbar / h) *
    (borrowed ? 1.5 : 1) *
    (1 + tBeyondK / 100);
  const value = 10 ** yLog;
  const fold = 10 ** sigmaLog;

  // 6 — tier.
  const closeCount = top.filter((s) => s.distance < h).length;
  let tier: Tier = "extrapolated";
  if (closeCount >= 3 && tBeyondK === 0 && !borrowedCrossFamily) tier = "interpolated";

  const officialFraction =
    top.reduce((acc, s, i) => acc + weights[i] * (s.point.reviewCount === 0 ? 1 : 0), 0);

  const reasons: string[] = [];
  if (domain === "tribology") {
    if (pathway === "B") {
      reasons.push(`Interfacial structure-enhanced pathway (Dataset-B): trained on the ${usableN} records reporting film thickness.`);
    } else if (wantFilm) {
      reasons.push("Film thickness was specified but no records report it yet — conservative pathway used; h is never imputed.");
    } else {
      reasons.push("Conservative pathway (Dataset-A): the film-thickness column is not consulted.");
    }
  }
  reasons.push(
    `Nearest analog ${top[0].point.cation.label}${top[0].point.anion.label} at d = ${d1.toFixed(2)} (bandwidth ${h.toFixed(2)}).`
  );
  if (localRegimeLimited)
    reasons.push(
      `A local tribology regime window kept ${k} of ${capped.length} candidate analogs; farther neighbors were close enough chemically but not in the same operating regime.`
    );
  if (closeCount < 3)
    reasons.push(
      kWant < 3
        ? `K = ${kWant} caps the close-analog count below the 3 the Interpolated tier requires — Extrapolated by construction, not by distance.`
        : localRegimeLimited
          ? `Only ${closeCount} local-regime evidence row${closeCount === 1 ? "" : "s"} sit within one bandwidth — extrapolating.`
        : `Only ${closeCount} of ${k} evidence rows are within one bandwidth — extrapolating.`
    );
  const translatedCount = top.filter((s) => s.translation).length;
  if (translatedCount > 0)
    reasons.push(
      `${translatedCount} of ${k} evidence rows temperature-shifted (${top.some((s) => s.translation?.source === "pair-fit") ? "own-pair fit" : "borrowed slope"}).`
    );
  if (borrowed) reasons.push("A borrowed median activation energy was used — interval inflated ×1.5.");
  if (borrowedCrossFamily) reasons.push("Borrowed slope crosses cation families — tier capped at Extrapolated.");
  if (tBeyondK > 0) reasons.push(`Query temperature is ${Math.round(tBeyondK)} K beyond the evidence range (+25 K grace).`);
  const reviewRows = top.filter((s) => s.point.reviewCount > 0).length;
  if (reviewRows > 0) reasons.push(`${reviewRows} of ${k} evidence rows rest on review-status (unapproved) records.`);
  if (sigmaCal != null) reasons.push(`Interval floored at the model's leave-one-out error (×/÷ ${(10 ** sigmaCal).toFixed(2)}).`);
  if (top.some((s) => s.point.outlier)) reasons.push("An evidence row is a flagged statistical outlier (|z| > 3.5) — inspect it.");
  if (hScale !== 1)
    reasons.push(`Model-lab bandwidth ×${hScale} — neighborhoods ${hScale < 1 ? "narrowed" : "widened"} from the calibrated default.`);
  if (kWant !== defaultK) reasons.push(`Model-lab neighborhood K = ${kWant} (default ${defaultK}).`);

  return {
    kind: "estimate",
    gated,
    tier,
    value,
    fold,
    low: value / fold,
    high: value * fold,
    neighbors: top.map((s, i) => ({
      point: s.point,
      distance: s.distance,
      weight: weights[i],
      share: weights[i],
      yUsed: s.yUsed,
      translation: s.translation,
      breakdown: s.breakdown,
    })),
    facts: {
      usableN,
      pathway,
      filmPoolN: filmPool.length,
      k,
      nEff,
      d1,
      dbar,
      bandwidth: h,
      spreadLog,
      sigmaLog,
      borrowedSlope: borrowed,
      borrowedCrossFamily,
      tBeyondK,
      officialFraction,
    },
    reasons,
    refusal: null,
  };
}

/** Build the feature normalization for a dataset's prediction context. */
export function datasetNorm(vocabulary: IonDescriptor[]): FeatureNorm {
  return featureNorm(vocabulary);
}
