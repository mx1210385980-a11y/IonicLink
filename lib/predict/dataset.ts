import type { Domain } from "../domain";
import type { EvidenceBasis, FieldProvenance } from "../schema";
import { parseQuantity } from "../units";
import { normalizeIonKey } from "../ionStructures";
import { standardizeSubstrate } from "../substrates";
import { describeIon, type IonDescriptor } from "./descriptors";
import { fitArrhenius, medianEa, type ArrheniusFit } from "./arrhenius";

/**
 * Turns a domain's raw records into the prediction engine's training set.
 *
 * - Ion identity is canonicalized through normalizeIonKey, so the raw DB
 *   spellings ([BMIm] / [BMIM] / [C4C1Im]) collapse into one pair.
 * - Records that cannot be used (missing/non-positive value, unresolvable ion)
 *   are NEVER silently dropped — they land in the exclusion ledger.
 * - Collapse is per OPERATING-CONDITION fingerprint: for tribology that means
 *   pair + substrate + scale + method + potential + load + velocity +
 *   roughness + film thickness + concentration + water content. Only true
 *   replicates (identical fingerprint, temperatures within 1 K) merge to a
 *   median — distinct setpoints NEVER collapse, because friction varies (often
 *   non-monotonically, e.g. with applied potential for [BMIM][BF4]/HOPG)
 *   across conditions that a coarser grouping would average away.
 * - Outliers (modified z-score on log₁₀ y, |z| > 3.5) are flagged, not removed.
 */

/** Structured operating conditions carried by every tribology training point. */
export interface OperatingConditions {
  tempK: number | null;
  loadN: number | null;
  velocityMps: number | null;
  /** Applied potential (V). null = unreported / open circuit — kept distinct from 0 V, never assumed. */
  potentialV: number | null;
  roughnessM: number | null;
  /** Interfacial IL film thickness (m). Never imputed. */
  filmThicknessM: number | null;
  /** Interfacial layer count when reported as layers. Never converted to a length. */
  filmLayers: number | null;
  scale: string | null;
  method: string | null;
  waterContent: string | null;
  concentration: string | null;
  additives: string | null;
}

/** True when the point carries interfacial structure information (Dataset-B membership). */
export function hasFilmInfo(c: OperatingConditions): boolean {
  return c.filmThicknessM != null || c.filmLayers != null;
}

function flexLookup(rec: any, re: RegExp, exclude?: RegExp): string | null {
  for (const f of rec.flexible ?? []) {
    if (f?.key && re.test(f.key) && !(exclude && exclude.test(f.key))) return `${f.value}${f.unit ? " " + f.unit : ""}`;
  }
  return null;
}

/** An interfacial film thicker than 1 µm is a parse artifact, not a boundary film. */
const MAX_FILM_THICKNESS_M = 1e-6;

/** Extract structured conditions from a tribology record (flexible-layer fallbacks for legacy records). */
export function operatingConditions(rec: any): OperatingConditions {
  const e = rec.extended ?? {};
  let filmThicknessM: number | null = e.filmThickness?.std ?? null;
  let filmLayers: number | null = typeof e.filmLayers === "number" ? e.filmLayers : null;
  if (filmThicknessM == null && filmLayers == null) {
    // Key must denote the thickness itself — "film preparation" / "film
    // thickness transition" notes are prose, and parsing a length out of them
    // would silently promote the record into the Dataset-B film pool.
    const raw = flexLookup(rec, /film|interfacial.*thick/i, /preparation|prep\b|transition|procedure|deposit/i);
    if (raw) {
      if (/layer/i.test(raw)) filmLayers = Number(raw.match(/[\d.]+/)?.[0] ?? NaN) || null;
      else {
        const parsed = parseQuantity(raw, "length")?.std ?? null;
        filmThicknessM = parsed != null && parsed <= MAX_FILM_THICKNESS_M ? parsed : null;
      }
    }
    if (filmLayers == null) {
      const layersRaw = flexLookup(rec, /^layers?\b/i);
      if (layersRaw) filmLayers = Number(layersRaw.match(/[\d.]+/)?.[0] ?? NaN) || null;
    }
  }
  return {
    tempK: rec.core?.temperature?.std ?? null,
    loadN: rec.core?.load?.std ?? null,
    velocityMps: e.velocity?.std ?? null,
    potentialV: e.potential?.std ?? null,
    roughnessM: e.roughness?.std ?? null,
    filmThicknessM,
    filmLayers,
    scale: e.scale ?? null,
    method: e.method?.trim().toLowerCase() || null,
    waterContent: e.waterContent?.trim() || flexLookup(rec, /water|humidity/i),
    concentration: e.concentration?.trim() || flexLookup(rec, /concentration|mole\s*fraction|x_?il/i),
    additives: e.additives?.trim() || null,
  };
}

/** Numeric fingerprint bucket: identical reported setpoints merge, distinct ones never do. */
function bucket(x: number | null): string {
  return x == null ? "·" : x.toExponential(2);
}

/** The operating-condition half of a tribology group key. */
export function conditionFingerprint(c: OperatingConditions): string {
  return [
    c.scale ?? "·",
    c.method ?? "·",
    bucket(c.potentialV),
    bucket(c.loadN),
    bucket(c.velocityMps),
    bucket(c.roughnessM),
    bucket(c.filmThicknessM),
    c.filmLayers != null ? `L${c.filmLayers}` : "·",
    (c.concentration ?? "·").toLowerCase().replace(/\s+/g, ""),
    (c.waterContent ?? "·").toLowerCase().replace(/\s+/g, ""),
    (c.additives ?? "·").toLowerCase().replace(/\s+/g, ""),
  ].join("|");
}

export interface EvidenceMember {
  id: string;
  value: number;
  tempK: number | null;
  status: "review" | "official";
  paperTitle: string;
  sourceId?: string;
  /** Provenance of the property field itself (verbatim quote etc.). */
  provenance?: FieldProvenance;
  basis?: EvidenceBasis;
}

export interface TrainingPoint {
  /** cationKey|anionKey — the canonical pair identity. */
  pairKey: string;
  /** pairKey plus the hard/soft condition (substrate or species), the collapse group. */
  groupKey: string;
  groupLabel: string;
  cation: IonDescriptor;
  anion: IonDescriptor;
  /** Property value in canonical units (COF dimensionless, σ S/m, D m²/s). Median of members. */
  y: number;
  logY: number;
  tempK: number | null;
  substrate?: string;
  substrateNorm?: string;
  species?: string;
  scale?: string;
  method?: string;
  /** Structured operating conditions (tribology points). */
  conditions?: OperatingConditions;
  officialCount: number;
  reviewCount: number;
  members: EvidenceMember[];
  outlier: boolean;
  outlierZ: number;
}

export interface DatasetExclusion {
  id: string;
  pair: string;
  reason: string;
}

export interface DomainDataset {
  domain: Domain;
  /** Usable, collapsed training points. */
  points: TrainingPoint[];
  exclusions: DatasetExclusion[];
  /** Raw record counts that entered the pool (pre-collapse). */
  recordCount: number;
  officialCount: number;
  reviewCount: number;
  /** Records hidden by the official-only toggle (not in `exclusions`). */
  reviewExcludedCount: number;
  /** Tribology nano-only model: macroscale (or unscaled) records kept out of scope (not in `exclusions`). */
  scaleExcludedCount: number;
  pairCount: number;
  tempRange: [number, number] | null;
  paperCount: number;
  fits: ArrheniusFit[];
  medianEaJmol: number | null;
  /** Distinct values available for the per-domain condition controls. */
  substrates: string[];
  species: string[];
  /** Tribology: points carrying film-thickness information (the Dataset-B pool). */
  filmPointCount: number;
}

export interface DatasetOptions {
  /** Include review-status records in the pool (default true, amber-flagged downstream). */
  includeReview?: boolean;
  /**
   * Tribology: admit nanoscale (AFM-class) records ONLY. Macroscopic friction
   * is a different physical regime (wear, ploughing, third bodies), not extra
   * evidence — macroscale records and records with no recorded scale are
   * excluded and counted in `scaleExcludedCount`. No effect on other domains.
   */
  nanoOnly?: boolean;
}

const PROPERTY_FIELD: Record<Domain, string> = {
  tribology: "cof",
  conductivity: "conductivity",
  diffusion: "diffusion",
};

function propertyValue(domain: Domain, rec: any): number | null {
  if (domain === "tribology") return rec.core?.cof ?? null;
  if (domain === "conductivity") return rec.core?.conductivity?.std ?? null;
  return rec.core?.diffusion?.std ?? null;
}

function tempK(rec: any): number | null {
  return rec.core?.temperature?.std ?? null;
}

export function normalizeSubstrateKey(raw: string | null | undefined): string {
  return standardizeSubstrate(raw).toLowerCase().replace(/[\s]/g, "");
}

/** Coarse substrate class for the soft substrate-distance term. */
export function substrateClass(raw: string | null | undefined): string {
  const s = (raw ?? "").toLowerCase();
  if (!s.trim()) return "other";
  if (/hopg|graphit|graphene|glassy\s*carbon|diamond|carbon/.test(s)) return "carbon";
  if (/mica|silica|sio2|alumina|al2o3|sapphire|glass|quartz|oxide|tio2|zro2|si3n4|nitride|ceramic/.test(s)) return "ceramic";
  if (/ptfe|pdms|peek|polymer|polyimide|nylon/.test(s)) return "polymer";
  if (/si\s*\(|silicon|\bsi\b/.test(s)) return "semiconductor";
  if (/au|gold|pt|platinum|ag|silver|cu|copper|steel|iron|nickel|\bni\b|titanium|\bti\b|chromium|tungsten|metal/.test(s)) return "metal";
  return "other";
}

export function buildDataset(domain: Domain, records: any[], opts: DatasetOptions = {}): DomainDataset {
  const includeReview = opts.includeReview !== false;
  const exclusions: DatasetExclusion[] = [];
  const propField = PROPERTY_FIELD[domain];

  interface RawPoint {
    rec: any;
    cation: IonDescriptor;
    anion: IonDescriptor;
    y: number;
    tempK: number | null;
    groupKey: string;
    groupLabel: string;
    substrate?: string;
    species?: string;
    conditions?: OperatingConditions;
  }

  let reviewExcludedCount = 0;
  let scaleExcludedCount = 0;
  const raws: RawPoint[] = [];
  for (const rec of records) {
    const pairText = `${rec.core?.ionicLiquid?.cation ?? "?"} ${rec.core?.ionicLiquid?.anion ?? "?"}`;
    if (rec.status === "review" && !includeReview) {
      reviewExcludedCount++;
      continue;
    }
    // Nanoscale-only scope gate: an unreported scale is never assumed nano —
    // unknown is an exclusion here, not a free pass.
    if (opts.nanoOnly && domain === "tribology" && rec.extended?.scale !== "nano") {
      scaleExcludedCount++;
      continue;
    }
    const y = propertyValue(domain, rec);
    if (y == null) {
      exclusions.push({ id: rec.id, pair: pairText, reason: `no ${propField} value` });
      continue;
    }
    if (y <= 0) {
      exclusions.push({ id: rec.id, pair: pairText, reason: `non-positive ${propField} (log-scale model)` });
      continue;
    }
    const cation = describeIon(rec.core?.ionicLiquid?.cation, "cation");
    const anion = describeIon(rec.core?.ionicLiquid?.anion, "anion");
    if (!cation.resolved) {
      exclusions.push({ id: rec.id, pair: pairText, reason: `unresolvable cation "${rec.core?.ionicLiquid?.cation}"` });
      continue;
    }
    if (!anion.resolved) {
      exclusions.push({ id: rec.id, pair: pairText, reason: `unresolvable anion "${rec.core?.ionicLiquid?.anion}"` });
      continue;
    }
    const pairKey = `${cation.key}|${anion.key}`;
    let groupKey = pairKey;
    let groupLabel = `${cation.label}${anion.label}`;
    let substrate: string | undefined;
    let species: string | undefined;
    let conditions: OperatingConditions | undefined;
    if (domain === "tribology") {
      substrate = standardizeSubstrate(rec.core?.substrate) || undefined;
      conditions = operatingConditions(rec);
      // Full operating-condition fingerprint: distinct potentials / loads /
      // speeds / films are distinct physical states and must stay distinct.
      groupKey += `|${normalizeSubstrateKey(rec.core?.substrate)}|${conditionFingerprint(conditions)}`;
      if (substrate) groupLabel += ` on ${substrate}`;
      if (conditions.potentialV != null) groupLabel += ` @ ${conditions.potentialV} V`;
      if (conditions.filmThicknessM != null) groupLabel += ` · h=${(conditions.filmThicknessM * 1e9).toPrecision(2)} nm`;
      else if (conditions.filmLayers != null) groupLabel += ` · ${conditions.filmLayers} layers`;
    } else if (domain === "diffusion") {
      species = (rec.core?.species ?? "").trim() || undefined;
      groupKey += `|${(species ?? "").toLowerCase()}`;
      if (species) groupLabel += ` · D(${species})`;
    }
    raws.push({ rec, cation, anion, y, tempK: tempK(rec), groupKey, groupLabel, substrate, species, conditions });
  }

  // Collapse: same group, temperatures within 1 K → one point (median y, members kept).
  const groups = new Map<string, RawPoint[]>();
  for (const r of raws) {
    const list = groups.get(r.groupKey) ?? [];
    list.push(r);
    groups.set(r.groupKey, list);
  }

  const points: TrainingPoint[] = [];
  for (const list of groups.values()) {
    const clusters: RawPoint[][] = [];
    for (const r of [...list].sort((a, b) => (a.tempK ?? -1) - (b.tempK ?? -1))) {
      const last = clusters[clusters.length - 1];
      // Compare against the cluster ANCHOR (its minimum, since the list is
      // sorted) — chaining off the last member would let a fine T-sweep
      // collapse into one point spanning far more than 1 K.
      const anchorT = last?.[0]?.tempK;
      if (last && ((r.tempK == null && anchorT == null) || (r.tempK != null && anchorT != null && Math.abs(r.tempK - anchorT) <= 1))) {
        last.push(r);
      } else {
        clusters.push([r]);
      }
    }
    for (const cluster of clusters) {
      const ys = cluster.map((c) => c.y).sort((a, b) => a - b);
      const mid = Math.floor(ys.length / 2);
      const y = ys.length % 2 ? ys[mid] : (ys[mid - 1] + ys[mid]) / 2;
      const first = cluster[0];
      const temps = cluster.map((c) => c.tempK).filter((t): t is number => t != null);
      const members: EvidenceMember[] = cluster.map((c) => ({
        id: c.rec.id,
        value: c.y,
        tempK: c.tempK,
        status: c.rec.status,
        paperTitle: c.rec.paper?.title ?? "",
        sourceId: c.rec.sourceId,
        provenance: c.rec.provenance?.[propField],
        basis: c.rec.provenance?.[propField]?.basis,
      }));
      points.push({
        pairKey: `${first.cation.key}|${first.anion.key}`,
        groupKey: first.groupKey,
        groupLabel: first.groupLabel,
        cation: first.cation,
        anion: first.anion,
        y,
        logY: Math.log10(y),
        tempK: temps.length ? temps.reduce((a, b) => a + b, 0) / temps.length : null,
        substrate: first.substrate,
        substrateNorm: first.substrate ? normalizeSubstrateKey(first.substrate) : undefined,
        species: first.species,
        scale: first.rec.extended?.scale,
        method: first.rec.extended?.method,
        conditions: first.conditions,
        officialCount: cluster.filter((c) => c.rec.status === "official").length,
        reviewCount: cluster.filter((c) => c.rec.status === "review").length,
        members,
        outlier: false,
        outlierZ: 0,
      });
    }
  }

  // Outlier flags: modified z-score on log10 y across the whole pool.
  if (points.length >= 4) {
    const logs = points.map((p) => p.logY).sort((a, b) => a - b);
    const mid = Math.floor(logs.length / 2);
    const med = logs.length % 2 ? logs[mid] : (logs[mid - 1] + logs[mid]) / 2;
    const absDev = points.map((p) => Math.abs(p.logY - med)).sort((a, b) => a - b);
    const dmid = Math.floor(absDev.length / 2);
    const mad = absDev.length % 2 ? absDev[dmid] : (absDev[dmid - 1] + absDev[dmid]) / 2;
    if (mad > 0) {
      for (const p of points) {
        p.outlierZ = (0.6745 * (p.logY - med)) / mad;
        p.outlier = Math.abs(p.outlierZ) > 3.5;
      }
    }
  }

  // Arrhenius fits per group (σ and D only — COF gets no temperature law).
  let fits: ArrheniusFit[] = [];
  if (domain !== "tribology") {
    for (const [groupKey, list] of groups) {
      const pts = list
        .filter((r) => r.tempK != null && r.y > 0)
        .map((r) => ({ tempK: r.tempK as number, y: r.y, ids: [r.rec.id] }));
      const fit = fitArrhenius(pts, {
        groupKey,
        groupLabel: list[0].groupLabel,
        cationFamily: list[0].cation.family,
        species: list[0].species,
      });
      if (fit) fits.push(fit);
    }
  }

  const temps = points.map((p) => p.tempK).filter((t): t is number => t != null);
  const papers = new Set<string>();
  for (const r of raws) papers.add(r.rec.paper?.title ?? r.rec.id);

  return {
    domain,
    points,
    exclusions,
    recordCount: raws.length,
    officialCount: raws.filter((r) => r.rec.status === "official").length,
    reviewCount: raws.filter((r) => r.rec.status === "review").length,
    reviewExcludedCount,
    scaleExcludedCount,
    pairCount: new Set(points.map((p) => p.pairKey)).size,
    tempRange: temps.length ? [Math.min(...temps), Math.max(...temps)] : null,
    paperCount: papers.size,
    fits,
    medianEaJmol: medianEa(fits),
    substrates: [...new Set(points.map((p) => p.substrate).filter((s): s is string => !!s))].sort(),
    species: [...new Set(points.map((p) => p.species).filter((s): s is string => !!s))].sort(),
    filmPointCount: points.filter((p) => p.conditions && hasFilmInfo(p.conditions)).length,
  };
}
