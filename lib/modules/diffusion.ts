import {
  DIFFUSION_CORE_FIELDS,
  DIFFUSION_EXTRACTION_TOOL_SCHEMA,
  diffusionCoreCompleteness,
  formatD,
  type DiffusionExtractedFields,
  type DiffusionRecord,
} from "../diffusion/schema";
import { ingest, toFields } from "../diffusion/ingest";
import { DIFFUSION_SYSTEM_PROMPT, diffusionMockExtract } from "../diffusion/extract";
import { fmtNum, type Quantity } from "../units";
import type { Module } from "./types";

/**
 * The diffusion module — domain #3. Same workflow as the others, different
 * measured property: a CONFINED self-diffusion coefficient D bound to its
 * diffusing SPECIES (cation vs anion — papers report them separately via
 * ¹H/¹⁹F NMR) instead of a COF or σ. Scope is nanoconfinement: bulk data is
 * rejected at the prompt, and drafts without any D value are dropped by
 * acceptDraft before they reach the review queue.
 */

const rawCell = (q: Quantity | null | undefined) => q?.raw ?? "";
const stdCell = (q: Quantity | null | undefined) => (q && q.std != null ? fmtNum(q.std) : "");

export const diffusionModule: Module<DiffusionRecord, DiffusionExtractedFields> = {
  domain: "diffusion",
  label: "Diffusion",
  tagline: "Confined ionic-liquid self-diffusion — one D per species & condition.",

  systemPrompt: DIFFUSION_SYSTEM_PROMPT,
  toolName: "submit_diffusion_records",
  toolDescription: "Submit the standardized self-diffusion records extracted from the paper.",
  toolSchema: DIFFUSION_EXTRACTION_TOOL_SCHEMA,
  userPrompt: (body) =>
    `Extract all self-diffusion records from this paper text:\n\n<paper>\n${body}\n</paper>`,
  mockExtract: diffusionMockExtract,

  ingest,
  toFields,
  // No-D-no-record gate (无数据拒收): a freshly extracted draft whose D is
  // entirely absent is noise, not a record — drop it before review.
  acceptDraft: (r) => r.core.diffusion != null,
  coreCompleteness: diffusionCoreCompleteness,
  coreFields: DIFFUSION_CORE_FIELDS.map((f) => ({ key: f.key, label: f.label })),

  promotedColumns: [
    { name: "species", type: "TEXT", get: (r) => r.core.species || null },
    { name: "system_name", type: "TEXT", get: (r) => r.extended.systemName || null },
    { name: "material", type: "TEXT", get: (r) => r.extended.material || null },
    { name: "geometry", type: "TEXT", get: (r) => r.extended.geometry || null },
    { name: "functional_groups", type: "TEXT", get: (r) => r.extended.functionalGroups || null },
    { name: "polarizable", type: "TEXT", get: (r) => r.extended.polarizable || null },
    { name: "pore_size_m", type: "REAL", get: (r) => r.extended.poreSize?.std ?? null },
    { name: "method", type: "TEXT", get: (r) => r.extended.method || null },
    { name: "temp_k", type: "REAL", get: (r) => r.core.temperature?.std ?? null },
    { name: "d_m2_s", type: "REAL", get: (r) => r.core.diffusion?.std ?? null },
    { name: "viscosity_pa_s", type: "REAL", get: (r) => r.extended.viscosity?.std ?? null },
  ],
  searchColumns: ["paper_title", "cation", "anion", "species", "system_name", "material", "geometry", "functional_groups", "polarizable"],
  facet: { key: "species", column: "species", values: ["cation", "anion", "overall"] },

  csvHeaders: [
    "id",
    "paper_title",
    "journal",
    "year",
    "doi",
    "cation",
    "anion",
    "species",
    "system_name",
    "material",
    "geometry",
    "functional_groups",
    "polarizable",
    "pore_size_raw",
    "pore_size_m",
    "temperature_raw",
    "temperature_K",
    "diffusion_raw",
    "diffusion_m2_s",
    "method",
    "nucleus",
    "surface",
    "viscosity_raw",
    "viscosity_Pa_s",
    "water_content",
    "concentration",
    "flexible_json",
    "provenance_json",
    "status",
  ],
  csvRow: (r) => {
    const c = r.core;
    const e = r.extended;
    return [
      r.id,
      r.paper.title,
      r.paper.journal ?? "",
      r.paper.year ?? "",
      r.paper.doi ?? "",
      c.ionicLiquid.cation,
      c.ionicLiquid.anion,
      c.species,
      e.systemName ?? "",
      e.material ?? "",
      e.geometry ?? "",
      e.functionalGroups ?? "",
      e.polarizable ?? "",
      rawCell(e.poreSize),
      stdCell(e.poreSize),
      rawCell(c.temperature),
      stdCell(c.temperature),
      rawCell(c.diffusion),
      stdCell(c.diffusion),
      e.method ?? "",
      e.nucleus ?? "",
      e.surface ?? "",
      rawCell(e.viscosity),
      stdCell(e.viscosity),
      e.waterContent ?? "",
      e.concentration ?? "",
      r.flexible.length ? JSON.stringify(r.flexible) : "",
      r.provenance && Object.keys(r.provenance).length ? JSON.stringify(r.provenance) : "",
      r.status,
    ];
  },
  recordHeadline: (r) => `D ${formatD(r.core.diffusion)}`,
};
