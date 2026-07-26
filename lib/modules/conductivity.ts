import {
  CONDUCTIVITY_CORE_FIELDS,
  CONDUCTIVITY_EXTRACTION_TOOL_SCHEMA,
  conductivityCoreCompleteness,
  formatSigma,
  type ConductivityExtractedFields,
  type ConductivityRecord,
} from "../conductivity/schema";
import { ingest, toFields } from "../conductivity/ingest";
import { CONDUCTIVITY_SYSTEM_PROMPT, conductivityMockExtract } from "../conductivity/extract";
import { fmtNum, type Quantity } from "../units";
import type { Module } from "./types";

/**
 * The conductivity module — domain #2. Same workflow as tribology, different
 * measured property: σ instead of COF, an electrode `surface` instead of a
 * tribopair, and viscosity / water content instead of load / AFM params.
 */

const rawCell = (q: Quantity | null | undefined) => q?.raw ?? "";
const stdCell = (q: Quantity | null | undefined) => (q && q.std != null ? fmtNum(q.std) : "");

export const conductivityModule: Module<ConductivityRecord, ConductivityExtractedFields> = {
  domain: "conductivity",
  label: "Conductivity",
  tagline: "Ionic-liquid conductivity — one σ per temperature & surface.",

  systemPrompt: CONDUCTIVITY_SYSTEM_PROMPT,
  toolName: "submit_conductivity_records",
  toolDescription: "Submit the standardized conductivity records extracted from the paper.",
  toolSchema: CONDUCTIVITY_EXTRACTION_TOOL_SCHEMA,
  userPrompt: (body) =>
    `Extract all conductivity records from this paper text:\n\n<paper>\n${body}\n</paper>`,
  mockExtract: conductivityMockExtract,

  ingest,
  toFields,
  coreCompleteness: conductivityCoreCompleteness,
  coreFields: CONDUCTIVITY_CORE_FIELDS.map((f) => ({ key: f.key, label: f.label })),

  promotedColumns: [
    { name: "surface", type: "TEXT", get: (r) => r.core.surface || null },
    { name: "method", type: "TEXT", get: (r) => r.extended.method || null },
    { name: "temp_k", type: "REAL", get: (r) => r.core.temperature?.std ?? null },
    { name: "sigma_si", type: "REAL", get: (r) => r.core.conductivity?.std ?? null },
    { name: "viscosity_pa_s", type: "REAL", get: (r) => r.extended.viscosity?.std ?? null },
  ],
  searchColumns: ["paper_title", "cation", "anion", "surface"],
  facet: { key: "method", column: "method", values: ["EIS", "conductivity cell"] },

  csvHeaders: [
    "id",
    "paper_title",
    "journal",
    "year",
    "doi",
    "cation",
    "anion",
    "surface",
    "temperature_raw",
    "temperature_K",
    "conductivity_raw",
    "conductivity_S_m",
    "method",
    "viscosity_raw",
    "viscosity_Pa_s",
    "water_content",
    "concentration",
    "density",
    "cell_constant",
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
      c.surface,
      rawCell(c.temperature),
      stdCell(c.temperature),
      rawCell(c.conductivity),
      stdCell(c.conductivity),
      e.method ?? "",
      rawCell(e.viscosity),
      stdCell(e.viscosity),
      e.waterContent ?? "",
      e.concentration ?? "",
      e.density ?? "",
      e.cellConstant ?? "",
      r.flexible.length ? JSON.stringify(r.flexible) : "",
      r.provenance && Object.keys(r.provenance).length ? JSON.stringify(r.provenance) : "",
      r.status,
    ];
  },
  recordHeadline: (r) => `σ ${formatSigma(r.core.conductivity)}`,
};
