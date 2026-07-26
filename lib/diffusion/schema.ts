import type { Quantity } from "../units";
import type { DomainDraft, DomainRecord } from "../domain";
import type { ExtractedFieldsBase, IonicLiquidCore } from "../schema";

/**
 * Diffusion domain model. Mirrors the three-layer shape for ionic-liquid
 * SELF-DIFFUSION IN CONFINEMENT: the atomic unit is one diffusion coefficient
 * (D) bound to the diffusing SPECIES (papers report D⁺ via ¹H-NMR and D⁻ via
 * ¹⁹F-NMR separately — a D without its species is ambiguous) and its
 * temperature. The confined system (the author's own name for it) and the pore
 * size live in the extended layer — every confinement paper has them, so they
 * are surfaced standalone rather than parked in flexible[]. Bulk (unconfined)
 * data is out of scope and rejected at extraction time.
 */

/** BASE LAYER — required to approve a diffusion record into the official DB. */
export interface DiffusionCore {
  ionicLiquid: IonicLiquidCore;
  /** Which species the D belongs to: "cation", "anion" (or a tracer label). */
  species: string;
  temperature: Quantity | null; // → K
  diffusion: Quantity | null; // self-diffusion coefficient D → m²/s
}

/** MIDDLE LAYER — standardized when present, but never mandatory. */
export interface DiffusionExtended {
  systemName?: string; // author's own name for the confined system, e.g. "MCM-41 pores"
  poreSize?: Quantity; // confinement scale (pore size / interlayer spacing) → m
  method?: string; // PFG-NMR / electrochemical / MD simulation
  nucleus?: string; // probed nucleus, e.g. ¹H, ¹⁹F
  surface?: string; // electrode surface, for electrochemical D only
  viscosity?: Quantity; // dynamic viscosity η → Pa·s (Stokes–Einstein context)
  waterContent?: string; // ppm or wt% (kept raw)
  concentration?: string; // mol/L or wt% for solutions / electrolytes
}

export type DiffusionRecord = DomainRecord<DiffusionCore, DiffusionExtended>;
export type DiffusionDraft = DomainDraft<DiffusionCore, DiffusionExtended>;

/** Flat shape the diffusion extractor (LLM or mock) emits — raw strings throughout. */
export interface DiffusionExtractedFields extends ExtractedFieldsBase {
  species?: string;
  temperature?: string;
  diffusion?: string; // e.g. "5.2 × 10⁻¹¹ m² s⁻¹"
  systemName?: string;
  poreSize?: string; // e.g. "2.5 nm", "38 Å"
  method?: string;
  nucleus?: string;
  surface?: string;
  viscosity?: string;
  waterContent?: string;
  concentration?: string;
}

export const DIFFUSION_CORE_FIELDS = [
  { key: "cation", label: "Cation" },
  { key: "anion", label: "Anion" },
  { key: "species", label: "Species" },
  { key: "temperature", label: "Temperature" },
  { key: "diffusion", label: "Diffusion D" },
] as const;

/** Fields that can carry provenance (for the editor's field picker). */
export const DIFFUSION_PROVENANCE_FIELDS = [
  "cation",
  "anion",
  "species",
  "temperature",
  "diffusion",
  "systemName",
  "poreSize",
  "method",
  "nucleus",
  "surface",
  "viscosity",
  "waterContent",
  "concentration",
] as const;

export function diffusionCoreCompleteness(
  r: DiffusionRecord | DiffusionDraft
): { complete: boolean; missing: string[] } {
  const c = r.core;
  const missing: string[] = [];
  if (!c.ionicLiquid.cation?.trim()) missing.push("Cation");
  if (!c.ionicLiquid.anion?.trim()) missing.push("Anion");
  if (!c.species?.trim()) missing.push("Species");
  if (!c.temperature || c.temperature.value == null) missing.push("Temperature");
  if (!c.diffusion || c.diffusion.value == null) missing.push("Diffusion D");
  return { complete: missing.length === 0, missing };
}

/** Diffusion coefficient for display — the reported (raw) label, or em-dash when null. */
export function formatD(q: Quantity | null | undefined): string {
  return q?.raw || "—";
}

/**
 * JSON Schema for diffusion extractor tool-use. Flat by design — the model
 * reports what it finds and ingestion standardizes + stratifies it.
 */
export const DIFFUSION_EXTRACTION_TOOL_SCHEMA = {
  type: "object" as const,
  properties: {
    records: {
      type: "array",
      description:
        "One entry per CONDITION-PROPERTY point: a CONFINED self-diffusion coefficient bound to its diffusing species and temperature. A paper reporting D⁺ and D⁻ (or a temperature sweep) → one record per species per reported point. NEVER emit a record for bulk (unconfined) data, for layer-resolved values when an overall value exists, or for a point with no explicit D value.",
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
          cation: { type: "string", description: "Cation shorthand, e.g. [EMIM]. REQUIRED." },
          anion: { type: "string", description: "Anion shorthand, e.g. [TFSI]. REQUIRED." },
          cationSmiles: { type: "string" },
          anionSmiles: { type: "string" },
          species: {
            type: "string",
            description:
              "Which species the D belongs to: \"cation\" (e.g. measured via ¹H NMR), \"anion\" (e.g. via ¹⁹F), or \"overall\" when the paper gives one D for the IL as a whole. ONLY the ionic liquid's own native ions — NEVER foreign/doped species (Li⁺, Na⁺, Cl⁻, OH⁻) or molecules (CO₂, H₂O); discard those measurements. REQUIRED — never merge D⁺ and D⁻ into one record.",
          },
          temperature: {
            type: "string",
            description: "Temperature WITH unit, e.g. '303 K' or '30 °C'. Diffusion is strongly temperature-dependent. REQUIRED.",
          },
          diffusion: {
            type: "string",
            description:
              "Self-diffusion coefficient D WITH unit, exactly as reported, e.g. '5.2 × 10⁻¹¹ m² s⁻¹', '5.2e-11 m2/s', or '1.0 × 10⁻⁶ cm²/s'. REQUIRED — if a condition point has no explicit D value, DISCARD the point entirely instead of emitting a record.",
          },
          systemName: {
            type: "string",
            description:
              "The author's own name for the confined system, e.g. 'MCM-41 pores', 'silica nanochannel', 'PEM with bicontinuous morphology'. Every confinement paper has one. REQUIRED.",
          },
          poreSize: {
            type: "string",
            description:
              "Confinement scale (pore diameter / slit width / interlayer spacing) WITH unit, exactly as reported, e.g. '2.5 nm', '38 Å', '1.0 to 5.0 nm'.",
          },
          method: {
            type: "string",
            description: "How D was measured: 'PFG-NMR' (pulsed-field-gradient NMR), 'electrochemical', or 'MD simulation'.",
          },
          nucleus: { type: "string", description: "Probed nucleus for NMR, e.g. '¹H', '¹⁹F', '⁷Li'." },
          surface: {
            type: "string",
            description: "Electrode surface, ONLY for electrochemical D measurements (e.g. Pt microelectrode). Bulk PFG-NMR has none.",
          },
          viscosity: {
            type: "string",
            description: "Dynamic viscosity WITH unit, e.g. '28 cP' — often co-reported for Stokes–Einstein analysis.",
          },
          waterContent: { type: "string", description: "Water content, e.g. '20 ppm' — water strongly affects D." },
          concentration: { type: "string", description: "Concentration for solutions / electrolytes, e.g. '0.5 mol/L', if applicable." },
          flexible: {
            type: "array",
            description:
              "Anything notable that has no formal field yet (pressure, gradient strength, diffusion time Δ, unusual setup). Keep it rather than discard it.",
            items: {
              type: "object",
              properties: {
                key: { type: "string", description: "Short label, e.g. 'diffusion time'." },
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
              "Per-field provenance. For each value you can locate, record the field name and where it came from: the page (use the [PAGE n] markers), figure, table, section, and a short VERBATIM supporting quote. Include at least diffusion and temperature when locatable.",
            items: {
              type: "object",
              properties: {
                field: {
                  type: "string",
                  description:
                    "Field name: cation, anion, species, temperature, diffusion, systemName, poreSize, method, nucleus, surface, viscosity, waterContent, or concentration.",
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
        required: ["paper", "cation", "anion", "species", "temperature", "diffusion", "systemName"],
      },
    },
  },
  required: ["records"],
};
