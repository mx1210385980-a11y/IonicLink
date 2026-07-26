import { normalizeSurfaceKey, surfaceDescriptorDefaults, surfaceMaterialClass } from "../surfaceDescriptors";

/**
 * Curated solid-surface descriptors for the tribology distance metric:
 * surface free energy γ_s, water contact angle θ_s, characteristic surface
 * charge density σ_s, and indicator variables (conductor, layered, crystal
 * plane / material class).
 *
 * Values are the same WFF-calibrated defaults used by the record layer. They
 * feed a similarity metric, not a thermodynamic model. Unknown substrates fall
 * back to the coarse material-class term only — nothing is imputed.
 */

export interface SurfaceProps {
  /** Canonical display name. */
  name: string;
  /** Surface free energy, mJ/m² (ambient effective). */
  gammaMJm2: number | null;
  /** Water contact angle, degrees. */
  thetaDeg: number | null;
  /** Characteristic surface charge density, C/m² (null = potential-controlled / unknown). */
  sigmaCm2: number | null;
  /** Electronically conducting surface. */
  conductor: boolean;
  /** Layered (cleavable 2D) material. */
  layered: boolean;
  /** Crystal plane / material indicator, e.g. "(111)", "(0001)", "amorphous". */
  plane: string;
}

/** Look up a substrate's curated descriptors; null when unknown (class term only). */
export function surfaceProps(raw: string | null | undefined): SurfaceProps | null {
  const d = surfaceDescriptorDefaults(raw);
  if (!d) return null;
  const hasDescriptor =
    d.surfaceEnergy || d.contactAngle || d.surfaceChargeDensity || d.conductor != null || d.layered != null || d.plane;
  if (!hasDescriptor) return null;
  return {
    name: raw?.trim() || d.materialClass || "surface",
    gammaMJm2: d.surfaceEnergy?.std ?? null,
    thetaDeg: d.contactAngle?.std ?? null,
    sigmaCm2: d.surfaceChargeDensity?.std ?? null,
    conductor: !!d.conductor,
    layered: !!d.layered,
    plane: d.plane ?? "",
  };
}

const GAMMA_SPAN = 1800; // mJ/m² across the WFF-calibrated table
const THETA_SPAN = 110; // degrees
const SIGMA_SPAN = 0.35; // C/m²

/**
 * Gower-style surface distance in [0,1]: identity → 0; otherwise the mean of
 * the comparable components (class, γ_s, θ_s, σ_s, conductor, layered, plane).
 * Missing components are skipped, never imputed.
 *
 * Memoized: the descriptor lookup re-parses raw substrate strings, and the
 * kernel calls this for every (query, point) pair — 35k+ times per LOO run,
 * where it dominated the whole profile. The domain has ~tens of distinct
 * substrate strings, so a bounded cache makes it O(1) after warm-up.
 */
const distanceCache = new Map<string, number>();

export function surfaceDistance(a: string | null | undefined, b: string | null | undefined): number {
  if (!a || !b) return 0.5;
  const key = `${a}::${b}`;
  const hit = distanceCache.get(key);
  if (hit !== undefined) return hit;
  const d = computeSurfaceDistance(a, b);
  if (distanceCache.size < 5000) distanceCache.set(key, d);
  return d;
}

function computeSurfaceDistance(a: string, b: string): number {
  if (normalizeSurfaceKey(a) === normalizeSurfaceKey(b)) return 0;
  const pa = surfaceProps(a);
  const pb = surfaceProps(b);
  const comps: number[] = [];
  comps.push(surfaceMaterialClass(a) === surfaceMaterialClass(b) ? 0.3 : 1); // coarse class always comparable
  if (pa && pb) {
    if (pa.gammaMJm2 != null && pb.gammaMJm2 != null)
      comps.push(Math.min(1, Math.abs(pa.gammaMJm2 - pb.gammaMJm2) / GAMMA_SPAN));
    if (pa.thetaDeg != null && pb.thetaDeg != null)
      comps.push(Math.min(1, Math.abs(pa.thetaDeg - pb.thetaDeg) / THETA_SPAN));
    if (pa.sigmaCm2 != null && pb.sigmaCm2 != null)
      comps.push(Math.min(1, Math.abs(pa.sigmaCm2 - pb.sigmaCm2) / SIGMA_SPAN));
    comps.push(pa.conductor === pb.conductor ? 0 : 1);
    comps.push(pa.layered === pb.layered ? 0 : 1);
    comps.push(pa.plane === pb.plane ? 0 : 0.5);
  }
  return comps.reduce((x, y) => x + y, 0) / comps.length;
}
