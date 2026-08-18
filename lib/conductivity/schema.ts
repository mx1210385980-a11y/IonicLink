import type { Quantity } from "../units";
import type { DomainDraft, DomainRecord } from "../domain";
import type { ExtractedFieldsBase, IonicLiquidCore } from "../schema";

/**
 * Conductivity domain model. Mirrors the tribology three-layer shape but for
 * ionic-liquid CONDUCTIVITY: the atomic unit is one conductivity value (σ) bound
 * to its temperature, electrode surface, and composition.
 */

/** BASE LAYER — required to approve a conductivity record into the official DB. */
export interface ConductivityCore {
  ionicLiquid: IonicLiquidCore;
  surface: string; // 测量表面
  temperature: Quantity | null; // 温度 → K
  conductivity: Quantity | null; // 导电性 → S/m
  capacitance: Quantity | null; // capacitance → F
  electricField: Quantity | null; // electric field strength → V/m
  electrodePotential: Quantity | null; // applied/electrode potential → V
  electrochemicalWindow: Quantity | null; // electrochemical stability window → V
  chargeTransferResistance: Quantity | null; // Rct / polarization resistance → ohm
}

/** MIDDLE LAYER — standardized when present, but never mandatory. */
export interface ConductivityExtended {
  method?: string; // EIS / conductivity cell
  potentialReference?: string;
  viscosity?: Quantity; // dynamic viscosity η → Pa·s
  waterContent?: string; // ppm or wt% (kept raw — not a single clean dimension)
  concentration?: string; // mol/L or wt% for IL solutions / electrolytes
  density?: string; // kept raw
  cellConstant?: string; // conductivity-cell constant, if reported
}

export type ConductivityRecord = DomainRecord<ConductivityCore, ConductivityExtended>;
export type ConductivityDraft = DomainDraft<ConductivityCore, ConductivityExtended>;

/** Flat shape the conductivity extractor (LLM or mock) emits — raw strings throughout. */
export interface ConductivityExtractedFields extends ExtractedFieldsBase {
  surface?: string;
  temperature?: string;
  conductivity?: string; // e.g. "12 mS/cm"
  capacitance?: string; // e.g. "2 pF" 新增字段
  electricField?: string; // e.g. "1 kV/m" 新增字段
  electrodePotential?: string;
  electrochemicalWindow?: string;
  chargeTransferResistance?: string;
  potentialReference?: string;
  method?: string;
  viscosity?: string; // e.g. "45 cP"
  waterContent?: string; // e.g. "120 ppm"
  concentration?: string;
  density?: string;
  cellConstant?: string;
}

export const CONDUCTIVITY_CORE_FIELDS = [
  { key: "cation", label: "Cation" },
  { key: "anion", label: "Anion" },
  { key: "surface", label: "Surface" },
  { key: "temperature", label: "Temperature" },
  { key: "conductivity", label: "Conductivity" },
  { key: "capacitance", label: "Capacitance" }, // 新增字段
  { key: "electricField", label: "Electric Field" }, // 新增字段
  { key: "electrodePotential", label: "Electrode Potential" },
  { key: "electrochemicalWindow", label: "Electrochemical Window" },
  { key: "chargeTransferResistance", label: "Charge-transfer Resistance" },
] as const;

export const CONDUCTIVITY_PROVENANCE_FIELDS = [
  "cation",
  "anion",
  "surface",
  "temperature",
  "conductivity",
  "capacitance", // 新增字段
  "electricField", // 新增字段
  "electrodePotential",
  "electrochemicalWindow",
  "chargeTransferResistance",
  "potentialReference",
  "viscosity",
  "waterContent",
  "concentration",
  "density",
  "method",
] as const;

export function conductivityCoreCompleteness(
  r: ConductivityRecord | ConductivityDraft
): { complete: boolean; missing: string[] } {
  const c = r.core;
  const missing: string[] = [];
  if (!c.ionicLiquid.cation?.trim()) missing.push("Cation");
  if (!c.ionicLiquid.anion?.trim()) missing.push("Anion");
  if (!c.surface?.trim()) missing.push("Surface");
  if (!c.temperature || c.temperature.value == null) missing.push("Temperature");
  if (
    !c.conductivity &&
    !c.capacitance &&
    !c.electricField &&
    !c.electrochemicalWindow &&
    !c.chargeTransferResistance
  ) {
    missing.push("Target electrochemical property");
  }
  return { complete: missing.length === 0, missing };
}

/** Conductivity σ for display — the reported (raw) label, or em-dash when null. */
export function formatSigma(q: Quantity | null | undefined): string {
  return q?.raw || "—";
}

/**
 * JSON Schema for conductivity extractor tool-use. Flat by design — the model
 * reports what it finds and ingestion standardizes + stratifies it.
 */
export const CONDUCTIVITY_EXTRACTION_TOOL_SCHEMA = {
  type: "object" as const,
  properties: {
    records: {
      type: "array",
      description:
        "One entry per CONDITION-PROPERTY point: an ionic conductivity bound to its temperature, electrode surface, and composition. Sweeping a variable (e.g. temperature) → one record per reported point.",
      items: {
        type: "object",
        properties: {
          paper: {
            type: "object",
            properties: {
              title: { type: "string" },
              journal: { type: "string" },
              year: { type: "integer" },
              doi: { type: "string" },
            },
            required: ["title"],
          },
          cation: { type: "string", description: "Cation shorthand, e.g. [BMIM]. REQUIRED." },
          anion: { type: "string", description: "Anion shorthand, e.g. [BF4]. REQUIRED." },
          cationSmiles: { type: "string" },
          anionSmiles: { type: "string" },
          surface: {
            type: "string",
            description:
              "Electrode / contact surface used in the measurement, e.g. Pt, glassy carbon, stainless steel, Au. REQUIRED.",
          },
          temperature: {
            type: "string",
            description: "Temperature WITH unit, e.g. '298.15 K' or '25 °C'. REQUIRED.",
          },
          conductivity: {
            type: ["string", "null"],
            description:
              "Ionic conductivity σ WITH unit, e.g. '12 mS/cm', '1.2 S/m', or '120 µS/cm'. Keep the reported unit exactly. REQUIRED if reported.",
          },
          capacitance: {
            type: ["string", "null"],
            description: "Capacitance WITH unit, e.g. '120 pF', '2 nF', or '1 µF', if reported.",
          },
          electricField: {
            type: ["string", "null"],
            description: "Electric field strength WITH unit, e.g. '1 kV/m', '500 V/m', or '2 kV/cm', if reported. Do not infer it.",
          },
          electrodePotential: {
            type: ["string", "null"],
            description: "Applied or electrode potential WITH unit and reference when reported, e.g. '-1.0 V vs Ag/AgCl'. Do not convert a voltage window into a single electrode potential.",
          },
          electrochemicalWindow: {
            type: ["string", "null"],
            description: "Electrochemical/stability window as a reported range WITH unit, e.g. '-2.0 to 2.5 V' or '4.5 V'.",
          },
          chargeTransferResistance: {
            type: ["string", "null"],
            description: "Charge-transfer or polarization resistance WITH unit, e.g. '255.5 ohm cm2' or '4.2 kOhm'. Only when explicitly assigned to Rct/Rp.",
          },
          potentialReference: {
            type: ["string", "null"],
            description: "Reference electrode or potential scale, e.g. 'Ag/AgCl', 'Pt quasi-reference', or 'Na+/Na'.",
          },
          method: {
            type: "string",
            description: "How σ was measured: 'EIS' (impedance spectroscopy) or 'conductivity cell'.",
          },
          viscosity: {
            type: "string",
            description: "Dynamic viscosity WITH unit, e.g. '45 cP' or '0.045 Pa·s', if reported.",
          },
          waterContent: {
            type: "string",
            description: "Water content, e.g. '120 ppm' or '0.5 wt%' — water strongly affects conductivity.",
          },
          concentration: {
            type: "string",
            description: "Concentration for IL solutions / electrolytes, e.g. '0.5 mol/L' or '10 wt%', if applicable.",
          },
          density: { type: "string", description: "Density with unit, e.g. '1.21 g/cm3', if reported." },
          cellConstant: { type: "string", description: "Conductivity-cell constant, if stated." },
          flexible: {
            type: "array",
            description:
              "Anything notable that has no formal field yet (pressure, atmosphere, purity, unusual cell setup). Keep it rather than discard it.",
            items: {
              type: "object",
              properties: {
                key: { type: "string", description: "Short label, e.g. 'pressure'." },
                value: { type: "string" },
                unit: { type: "string" },
                note: { type: "string", description: "Why it's here / source context." },
              },
              required: ["key", "value"],
            },
          },
          provenance: {
            type: "array",
            description:
              "Per-field provenance. For each value you can locate, record the field name and where it came from: the page (use the [PAGE n] markers), figure, table, section, and a short VERBATIM supporting quote. Include at least conductivity and temperature when locatable.",
            items: {
              type: "object",
              properties: {
                field: {
                  type: "string",
                  description:
                    "Field name: cation, anion, surface, temperature, conductivity, capacitance, electricField, electrodePotential, electrochemicalWindow, chargeTransferResistance, potentialReference, viscosity, waterContent, concentration, density, or method.",
                },
                page: { type: "integer", description: "Page number from the [PAGE n] markers." },
                figure: { type: "string", description: "e.g. 'Fig. 4a'." },
                table: { type: "string", description: "e.g. 'Table 2'." },
                section: { type: "string", description: "e.g. '3.2 Results'." },
                quote: {
                  type: "string",
                  description:
                    "Short supporting snippet copied CHARACTER-FOR-CHARACTER from the paper text. Quotes are verified by exact search against the source PDF, so NEVER paraphrase, reword, reorder, or elide with '...'. For a table value, quote one contiguous run of the row as printed — do not stitch header cells and value cells from different places. If no contiguous snippet states the value (e.g. it is read off a figure), omit quote and cite the figure/table instead.",
                },
                context: { type: "string", description: "A longer surrounding excerpt (1-3 contiguous sentences, also copied verbatim)." },
                basis: {
                  type: "string",
                  enum: ["direct", "inferred"],
                  description:
                    "\"direct\" if the text states this value FOR THIS measurement; \"inferred\" if it appears only in general/methods context and is presumed to apply.",
                },
                basisNote: {
                  type: "string",
                  description: "For inferred values: what the inference rests on.",
                },
              },
              required: ["field"],
            },
          },
          confidence: { type: "number", description: "0–1 confidence in this record." },
        },
        required: ["paper"],
      },
    },
  },
  required: ["records"],
};
