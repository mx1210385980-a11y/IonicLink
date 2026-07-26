import type { Domain } from "@/lib/domain";
import { normalizeIonKey, resolveIonStructure, standardizeIonLabel, type IonKind } from "@/lib/ionStructures";
import { standardizeSubstrate } from "@/lib/substrates";

/**
 * Client-side record filtering for the Database view: ions (canonicalized, so
 * [BMIm] / [BMIM] / [C4C1Im] are ONE option), substrate/surface, and SI-value
 * ranges for load and temperature. Pure functions — the FilterBar renders
 * them, DatabaseView applies them to the loaded record list.
 */

export interface RecordFilters {
  /** Canonical cation keys (normalizeIonKey of the resolved label). Empty = any. */
  cations: string[];
  anions: string[];
  /** Normalized substrate/surface keys. Empty = any. */
  surfaces: string[];
  /** Load window in N (canonical SI). null = unbounded. */
  loadMinN: number | null;
  loadMaxN: number | null;
  /** Temperature window in K. null = unbounded. */
  tempMinK: number | null;
  tempMaxK: number | null;
}

export const EMPTY_FILTERS: RecordFilters = {
  cations: [],
  anions: [],
  surfaces: [],
  loadMinN: null,
  loadMaxN: null,
  tempMinK: null,
  tempMaxK: null,
};

export function hasActiveFilters(f: RecordFilters): boolean {
  return countActiveFilters(f) > 0;
}

/** Number of active filter groups (each range counts once). */
export function countActiveFilters(f: RecordFilters): number {
  let n = 0;
  if (f.cations.length) n++;
  if (f.anions.length) n++;
  if (f.surfaces.length) n++;
  if (f.loadMinN != null || f.loadMaxN != null) n++;
  if (f.tempMinK != null || f.tempMaxK != null) n++;
  return n;
}

/** Canonical identity key for an ion label — raw DB spellings collapse. */
export function ionKeyOf(label: string | null | undefined, kind: IonKind): string {
  const ion = resolveIonStructure(label, kind);
  return normalizeIonKey(ion ? ion.label : (label ?? ""));
}

/** Display label for an ion (standardized when resolvable, verbatim otherwise). */
export function ionDisplayOf(label: string | null | undefined, kind: IonKind): string {
  const raw = label?.trim() ?? "";
  if (!raw) return "—";
  return resolveIonStructure(raw, kind) ? standardizeIonLabel(raw, kind) : raw;
}

/** Normalized key for a substrate / electrode surface. */
export function surfaceKeyOf(raw: string | null | undefined): string {
  return standardizeSubstrate(raw).toLowerCase().replace(/\s+/g, "");
}

/** The record field acting as the solid surface for this domain (none for diffusion). */
export function surfaceOf(domain: Domain, rec: any): string | null {
  const raw = domain === "conductivity" ? rec.core?.surface : domain === "tribology" ? rec.core?.substrate : null;
  const s = (raw ?? "").trim();
  return s || null;
}

export function recordLoadN(rec: any): number | null {
  return rec.core?.load?.std ?? null;
}

export function recordTempK(rec: any): number | null {
  return rec.core?.temperature?.std ?? null;
}

export interface FilterOption {
  key: string;
  label: string;
  count: number;
}

function collectOptions(entries: { key: string; label: string }[]): FilterOption[] {
  const byKey = new Map<string, FilterOption>();
  for (const e of entries) {
    if (!e.key) continue;
    const existing = byKey.get(e.key);
    if (existing) existing.count++;
    else byKey.set(e.key, { key: e.key, label: e.label, count: 1 });
  }
  return [...byKey.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/** Distinct ions present in the records, canonicalized, most frequent first. */
export function ionOptions(records: any[], kind: IonKind): FilterOption[] {
  return collectOptions(
    records.map((r) => {
      const raw = kind === "cation" ? r.core?.ionicLiquid?.cation : r.core?.ionicLiquid?.anion;
      return { key: ionKeyOf(raw, kind), label: ionDisplayOf(raw, kind) };
    })
  );
}

/** Distinct substrates/surfaces present in the records. */
export function surfaceOptions(domain: Domain, records: any[]): FilterOption[] {
  return collectOptions(
    records
      .map((r) => surfaceOf(domain, r))
      .filter((s): s is string => !!s)
      .map((s) => ({ key: surfaceKeyOf(s), label: standardizeSubstrate(s) }))
  );
}

/** [min, max] of a numeric field across the records, or null when absent. */
export function numericExtent(records: any[], get: (rec: any) => number | null): [number, number] | null {
  const values = records.map(get).filter((v): v is number => v != null && Number.isFinite(v));
  if (values.length === 0) return null;
  return [Math.min(...values), Math.max(...values)];
}

function inRange(v: number | null, min: number | null, max: number | null): boolean {
  if (min == null && max == null) return true;
  // A bounded window is a constraint — a record with no value cannot satisfy it.
  if (v == null) return false;
  if (min != null && v < min * (1 - 1e-9)) return false;
  if (max != null && v > max * (1 + 1e-9)) return false;
  return true;
}

/** AND-combine every active filter over the loaded records. */
export function applyRecordFilters(domain: Domain, records: any[], f: RecordFilters): any[] {
  if (!hasActiveFilters(f)) return records;
  return records.filter((r) => {
    if (f.cations.length && !f.cations.includes(ionKeyOf(r.core?.ionicLiquid?.cation, "cation"))) return false;
    if (f.anions.length && !f.anions.includes(ionKeyOf(r.core?.ionicLiquid?.anion, "anion"))) return false;
    if (f.surfaces.length) {
      const s = surfaceOf(domain, r);
      if (!s || !f.surfaces.includes(surfaceKeyOf(s))) return false;
    }
    if (!inRange(recordLoadN(r), f.loadMinN, f.loadMaxN)) return false;
    if (!inRange(recordTempK(r), f.tempMinK, f.tempMaxK)) return false;
    return true;
  });
}
