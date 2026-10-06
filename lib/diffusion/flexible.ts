import type { FlexibleField } from "../schema";
import type { DiffusionExtended } from "./schema";

/**
 * Flexible-layer normalization for diffusion records.
 *
 * The extraction model is instructed to keep anything notable in flexible[],
 * which historically parked three kinds of noise there:
 *  1. values that belong to a formal extended field (polarizability details,
 *     composition ratios, evaluation method),
 *  2. entries that cannot influence the ion's self-diffusion or leak the
 *     target (bulk reference D, electrode potentials, qualitative notes),
 *  3. cryptic free-form keys a reader cannot decipher.
 *
 * normalizeFlexibleFields() applies a deterministic verdict table: MERGE
 * entries enrich the matching extended field, DROP entries are removed, and
 * KEEP entries may be renamed to a self-explanatory label. It runs inside
 * ingest(), so future extractions and record edits are cleaned automatically,
 * and the migration script reuses it for existing records.
 */

type FlexibleVerdict =
  | { action: "merge"; target: "polarizable" | "method" | "concentration"; format?: (value: string) => string }
  | { action: "drop" }
  | { action: "keep"; label?: string };

/** Keys are normalized (lowercase, parentheticals stripped) before lookup. */
const FLEXIBLE_VERDICTS: Record<string, FlexibleVerdict> = {
  // → polarizable: wall/environment polarizability details
  "surface polarizability": { action: "merge", target: "polarizable" },
  "surface treatment": { action: "merge", target: "polarizable" },
  // → method: how D was obtained
  "d evaluation": { action: "merge", target: "method" },
  // → concentration: mixture composition
  "il:pvdf weight ratio": {
    action: "merge",
    target: "concentration",
    format: (value) => `IL:PVDF = ${value} (w/w)`,
  },

  // drop: out-of-scope context, target leakage, or derivable from the records
  "bulk reference d": { action: "drop" },
  "potential of zero charge": { action: "drop" },
  "layer-resolved d": { action: "drop" },
  "note": { action: "drop" },
  "structural state": { action: "drop" },
  "gas permeation stage": { action: "drop" },
  "membrane thicknesses studied": { action: "drop" },
  // redundant with extended.geometry (a slit pore already implies in-plane 2D D)
  "dimensionality of d": { action: "drop" },
  "diffusion dimensionality": { action: "drop" },

  // keep, with a self-explanatory label
  "production run": { action: "keep", label: "production run length" },
  "membrane preparation stage": { action: "keep", label: "membrane preparation" },
  "system composition": { action: "keep", label: "simulation system composition" },
};

function normalizeFlexibleKey(key: string): string {
  return key
    .replace(/\([^)]*\)|（[^）]*）/g, " ")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/** Append a detail to an extended text field without duplicating it. */
function enrich(existing: string | undefined, addition: string): string {
  const detail = addition.trim();
  if (!detail) return existing ?? "";
  if (!existing) return detail;
  if (existing.toLowerCase().includes(detail.toLowerCase())) return existing;
  // Bare placeholders ("polarizable", "yes") become a prefix rather than a peer.
  if (/^(yes|no|polarizable|non-polarizable)$/i.test(existing.trim())) {
    return `${existing.trim()} (${detail})`;
  }
  return `${existing.trim()}; ${detail}`;
}

/**
 * Apply the verdict table: returns the cleaned flexible list; merged entries
 * are folded into `extended` in place. Unlisted keys pass through unchanged.
 */
export function normalizeFlexibleFields(
  flexible: FlexibleField[],
  extended: DiffusionExtended
): FlexibleField[] {
  const kept: FlexibleField[] = [];
  for (const field of flexible) {
    const verdict = FLEXIBLE_VERDICTS[normalizeFlexibleKey(field.key)];
    if (!verdict) {
      kept.push(field);
      continue;
    }
    if (verdict.action === "drop") continue;
    if (verdict.action === "keep") {
      kept.push(verdict.label && verdict.label !== field.key ? { ...field, key: verdict.label } : field);
      continue;
    }
    const value = verdict.format ? verdict.format(field.value) : field.value;
    extended[verdict.target] = enrich(extended[verdict.target], value);
  }
  return kept;
}
