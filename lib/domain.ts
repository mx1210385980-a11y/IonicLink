import type { FlexibleField, Paper, ProvenanceMap, RecordStatus } from "./schema";

/**
 * A Domain is one measured property the platform curates. Each domain is a
 * fully isolated module: its records, batch jobs, and uploaded source PDFs live
 * in a SEPARATE SQLite file (`data/<domain>.db`) and a separate sources
 * directory (`data/<domain>/sources/`). There is no shared table, so the two
 * datasets can never cross-contaminate.
 *
 * The workflow (upload → queue → extract → review → approve → export) is the
 * same code for every domain; only the per-domain `Module` (lib/modules) differs.
 */
export type Domain = "tribology" | "conductivity" | "diffusion";

export const DOMAINS: Domain[] = ["tribology", "conductivity", "diffusion"];

/** The original module — also the implicit domain for legacy/un-namespaced calls. */
export const DEFAULT_DOMAIN: Domain = "tribology";

/** Provider that produced an extracted record candidate. */
export type ExtractionSource = "openai-compatible" | "anthropic" | "mock";

/** Extraction provenance retained after a batch candidate becomes a record. */
export interface ExtractionMetadata {
  source: ExtractionSource;
  model?: string;
}

const DOMAIN_ALIASES: Record<string, Domain> = {
  摩擦: "tribology",
  tribology: "tribology",
  导电: "conductivity",
  conductivity: "conductivity",
  扩散: "diffusion",
  diffusion: "diffusion",
};

export function isDomain(v: unknown): v is Domain {
  return v === "tribology" || v === "conductivity" || v === "diffusion";
}

export function resolveDomainAlias(v: unknown): Domain | null {
  if (typeof v !== "string") return null;
  let key = v;
  try {
    key = decodeURIComponent(v);
  } catch {
    key = v;
  }
  return DOMAIN_ALIASES[key] ?? null;
}

/**
 * Generic three-layer record. The `core` (required base) and `extended`
 * (optional middle) shapes are supplied per domain; everything else —
 * id/status/confidence/paper/flexible/provenance/source link — is identical
 * across domains. `IonicRecord` (tribology) is `DomainRecord<CoreFields, ExtendedFields>`.
 */
export interface DomainRecord<Core, Extended> {
  id: string;
  status: RecordStatus;
  confidence?: number | null;
  createdAt: string;
  paper: Paper;
  core: Core;
  extended: Extended;
  flexible: FlexibleField[];
  /** Where each field's value came from in the source paper. */
  provenance?: ProvenanceMap;
  /** Id of the stored source document (uploaded PDF) this record came from. */
  sourceId?: string;
  /** Extractor provenance; absent on legacy, seed, and manually created records. */
  extraction?: ExtractionMetadata;
}

/** A record before the store assigns id/status/createdAt. */
export type DomainDraft<Core, Extended> = Omit<
  DomainRecord<Core, Extended>,
  "id" | "status" | "createdAt"
>;
