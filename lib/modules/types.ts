import type { Domain, DomainDraft, DomainRecord } from "../domain";
import type { ExtractedFieldsBase } from "../schema";

/**
 * The per-domain contract. The shared workflow engine (DB layer, jobs worker,
 * extractor, CSV exporter, API routes) is generic and touches a record ONLY
 * through its module — never reaching into domain-specific fields like `cof`.
 * Each domain supplies exactly the parts below; everything else is shared.
 *
 * Rendering (RecordCard / RecordEditor / the Design Studio) is intentionally
 * NOT here — those are client components, supplied separately by the client
 * registry (components/registry.client.tsx) or the design components
 * (components/design/), so this server-safe contract never drags React/client
 * code into the better-sqlite3 server bundle.
 */

/** A promoted SQLite column: its DDL plus how to read it off a record. */
export interface PromotedColumn<Rec> {
  /** Column name, e.g. "cof" or "sigma_si". */
  name: string;
  /** SQL type fragment, e.g. "REAL" or "TEXT". */
  type: string;
  /** Value to persist for this record. */
  get: (rec: Rec) => string | number | null;
}

/** An optional secondary list filter (tribology: scale; conductivity: method). */
export interface ListFacet {
  /** Query-param key, e.g. "scale" or "method". */
  key: string;
  /** Promoted column it filters on. */
  column: string;
  /** Allowed values; an incoming value must be one of these to apply. */
  values: readonly string[];
}

export interface Module<
  Rec extends DomainRecord<any, any> = DomainRecord<any, any>,
  Fields extends ExtractedFieldsBase = ExtractedFieldsBase,
> {
  domain: Domain;
  /** Display name, e.g. "Tribology" / "Conductivity". */
  label: string;
  /** One-line description shown under page headers. */
  tagline: string;

  /* ---- extraction ---- */
  systemPrompt: string;
  toolName: string;
  toolDescription: string;
  /** JSON Schema object for the extractor's forced tool-use input. */
  toolSchema: Record<string, unknown>;
  userPrompt: (body: string) => string;
  mockExtract: (text: string) => Fields[];

  /* ---- ingest / completeness ---- */
  ingest: (fields: Fields) => DomainDraft<any, any>;
  /**
   * Optional hard gate applied to freshly extracted drafts (LLM or mock)
   * before they enter the review queue. Return false to drop the draft —
   * e.g. diffusion drops records that carry no D value at all. NOT applied
   * to curator edits, which go through ingest directly.
   */
  acceptDraft?: (draft: DomainDraft<any, any>) => boolean;
  /** Reverse of ingest — flatten a record back to editable raw fields. */
  toFields: (rec: Rec) => Fields;
  coreCompleteness: (rec: any) => { complete: boolean; missing: string[] };
  /** Core field labels, drives the completeness UI. */
  coreFields: { key: string; label: string }[];

  /* ---- persistence ---- */
  promotedColumns: PromotedColumn<Rec>[];
  /** Columns the free-text search LIKEs against. */
  searchColumns: string[];
  facet?: ListFacet;

  /* ---- export + per-page display hooks ---- */
  csvHeaders: string[];
  csvRow: (rec: Rec) => (string | number)[];
  /** Headline metric for the Library list, e.g. "COF 0.12" / "σ 12 mS/cm". */
  recordHeadline: (rec: Rec) => string;
  /** At-a-glance stats for the Database header (domain-specific). */
  listStats?: (recs: Rec[]) => { label: string; value: string }[];
}
