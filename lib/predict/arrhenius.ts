/**
 * Arrhenius temperature translation for conductivity (σ) and diffusion (D).
 *
 * Where one ionic-liquid pair has measurements at ≥2 distinct temperatures, an
 * OLS fit of ln y vs 1/T yields an activation energy Ea, letting that pair's
 * evidence be translated to the query temperature ("inferred" basis). Pairs
 * with a single temperature may borrow the domain-median fitted Ea ("assumed"
 * basis, flagged). With no fitted Ea at all, evidence is NEVER translated — a
 * temperature distance penalty is applied instead. Literature-prior activation
 * energies are deliberately not used: they would silently dress invented
 * physics in a tidy interval.
 *
 * VFT (the physically better law for ionic liquids) is intentionally locked
 * until a pair has ≥ VFT_UNLOCK.minTemps distinct temperatures spanning
 * ≥ VFT_UNLOCK.minSpanK — a 3-parameter fit below that is overfitting.
 */

export const GAS_CONSTANT = 8.314462618; // J/(mol·K)

export const VFT_UNLOCK = { minTemps: 4, minSpanK: 60 } as const;

export interface ArrheniusPoint {
  tempK: number;
  /** Property value in canonical units, strictly positive. */
  y: number;
  /** Record id(s) backing this point, for evidence citation. */
  ids: string[];
}

export interface ArrheniusFit {
  /** Group identity, e.g. "c4mim|bf4" (+condition suffix). */
  groupKey: string;
  /** Display label for the group, e.g. "[C₄MIM][BF₄]". */
  groupLabel: string;
  /** Cation family of the group — borrowed-slope checks compare against it. */
  cationFamily: string;
  /** Diffusing species (diffusion only) — borrowed slopes never cross species. */
  species?: string;
  eaJmol: number;
  lnA: number;
  nPoints: number;
  tempRange: [number, number];
  points: ArrheniusPoint[];
}

/** OLS fit of ln y = lnA − Ea/(R·T). Needs ≥2 distinct temperatures. */
export function fitArrhenius(
  points: ArrheniusPoint[],
  group: { groupKey: string; groupLabel: string; cationFamily: string; species?: string }
): ArrheniusFit | null {
  const usable = points.filter((p) => p.tempK > 0 && p.y > 0);
  const temps = new Set(usable.map((p) => p.tempK));
  if (temps.size < 2) return null;

  const xs = usable.map((p) => 1 / p.tempK);
  const ys = usable.map((p) => Math.log(p.y));
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let num = 0;
  let den = 0;
  for (let i = 0; i < xs.length; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  if (den === 0) return null;
  const slope = num / den; // = −Ea/R
  const eaJmol = -slope * GAS_CONSTANT;
  const lnA = my - slope * mx;
  const sorted = usable.map((p) => p.tempK).sort((a, b) => a - b);
  return {
    ...group,
    eaJmol,
    lnA,
    nPoints: usable.length,
    tempRange: [sorted[0], sorted[sorted.length - 1]],
    points: usable,
  };
}

/** Translate a value measured at fromK to toK along an Arrhenius law with the given Ea. */
export function translateArrhenius(y: number, fromK: number, toK: number, eaJmol: number): number {
  return y * Math.exp((-eaJmol / GAS_CONSTANT) * (1 / toK - 1 / fromK));
}

/** Median of fitted activation energies — the "borrowed slope" for single-T groups. */
export function medianEa(fits: ArrheniusFit[]): number | null {
  if (fits.length === 0) return null;
  const eas = fits.map((f) => f.eaJmol).sort((a, b) => a - b);
  const mid = Math.floor(eas.length / 2);
  return eas.length % 2 ? eas[mid] : (eas[mid - 1] + eas[mid]) / 2;
}

/** Whether a group's data unlocks a VFT fit (printed in the model card; never fit before then). */
export function vftUnlocked(points: ArrheniusPoint[]): boolean {
  const temps = [...new Set(points.map((p) => p.tempK))].sort((a, b) => a - b);
  return temps.length >= VFT_UNLOCK.minTemps && temps[temps.length - 1] - temps[0] >= VFT_UNLOCK.minSpanK;
}
