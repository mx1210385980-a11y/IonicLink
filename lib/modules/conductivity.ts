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
  tagline: "Ionic-liquid transport and interfacial electrochemistry — one property point per condition.",

  systemPrompt: CONDUCTIVITY_SYSTEM_PROMPT,
  toolName: "submit_conductivity_records",
  toolDescription: "Submit source-grounded ionic-liquid conductivity and interfacial electrochemical property records.",
  toolSchema: CONDUCTIVITY_EXTRACTION_TOOL_SCHEMA,
  userPrompt: (body) =>
    `Extract only the in-scope ionic-liquid electrical/interfacial target properties from this paper text. Return an empty records array when none is reported.\n\n<paper>\n${body}\n</paper>`,
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
    { name: "capacitance_f", type: "REAL", get: (r) => r.core.capacitance?.std ?? null },
    { name: "electric_field_v_m", type: "REAL", get: (r) => r.core.electricField?.std ?? null },
    { name: "electrode_potential_v", type: "REAL", get: (r) => r.core.electrodePotential?.std ?? null },
    { name: "electrochemical_window_v", type: "REAL", get: (r) => r.core.electrochemicalWindow?.std ?? null },
    { name: "charge_transfer_resistance_ohm", type: "REAL", get: (r) => r.core.chargeTransferResistance?.std ?? null },
    { name: "pressure_pa", type: "REAL", get: (r) => r.extended.pressure?.std ?? null },
    { name: "viscosity_pa_s", type: "REAL", get: (r) => r.extended.viscosity?.std ?? null },
  ],
  searchColumns: ["paper_title", "cation", "anion", "surface"],
  facet: { key: "method", column: "method", values: ["EIS", "conductivity cell", "CV", "chronoamperometry", "galvanostatic charge-discharge", "MD simulation"] },

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
    "capacitance_raw",
    "capacitance_F",
    "electric_field_raw",
    "electric_field_V_m",
    "electrode_potential_raw",
    "electrode_potential_V",
    "potential_reference",
    "pressure_raw",
    "pressure_Pa",
    "electrochemical_window_raw",
    "electrochemical_window_V",
    "charge_transfer_resistance_raw",
    "charge_transfer_resistance_ohm",
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
      rawCell(c.capacitance),
      stdCell(c.capacitance),
      rawCell(c.electricField),
      stdCell(c.electricField),
      rawCell(c.electrodePotential),
      stdCell(c.electrodePotential),
      e.potentialReference ?? "",
      rawCell(e.pressure),
      stdCell(e.pressure),
      rawCell(c.electrochemicalWindow),
      stdCell(c.electrochemicalWindow),
      rawCell(c.chargeTransferResistance),
      stdCell(c.chargeTransferResistance),
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
  acceptDraft: (r) => Boolean(
    r.core.conductivity ||
    r.core.capacitance ||
    r.core.electricField ||
    r.core.electrochemicalWindow ||
    r.core.chargeTransferResistance ||
    r.extended.viscosity
  ),
  recordHeadline: (r) => {
    if (r.core.conductivity) return `σ ${formatSigma(r.core.conductivity)}`;
    if (r.core.capacitance) return `C ${rawCell(r.core.capacitance)}`;
    if (r.core.electricField) return `E ${rawCell(r.core.electricField)}`;
    if (r.core.electrochemicalWindow) return `Window ${rawCell(r.core.electrochemicalWindow)}`;
    if (r.core.chargeTransferResistance) return `Rct ${rawCell(r.core.chargeTransferResistance)}`;
    return `η ${rawCell(r.extended.viscosity)}`;
  },
};
