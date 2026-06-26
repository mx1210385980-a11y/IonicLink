import type { Quantity } from "./units";
import type { DomainDraft, DomainRecord } from "./domain";
import type { SurfaceDescriptors } from "./surfaceDescriptors";

/**
 * Three-layer standardized record model.
 *
 *   BASE   (core)     — mandatory, strict. The parameters present in every
 *                       tribology experiment: cation, anion, substrate,
 *                       temperature, load, friction coefficient.
 *   MIDDLE (extended) — common-but-not-universal, semi-structured & optional:
 *                       sliding velocity, potential, roughness, additives, the
 *                       AFM acquisition params, probe/method context.
 *   OUTER  (flexible) — raw JSON catch-all for anything that doesn't have a
 *                       formal home yet, kept with a provenance note so it can
 *                       later be "promoted" to a real field.
 *
 * The atomic unit is one CONDITION-PERFORMANCE point: a friction coefficient
 * bound to its complete set of test conditions — never a bare material→number.
 */

export type Scale = "nano" | "macro";

export interface Paper {
  title: string;
  journal?: string;
  year?: number;
  doi?: string;
}

export interface IonicLiquidCore {
  cation: string;
  anion: string;
  cationSmiles?: string;
  anionSmiles?: string;
}

/** AFM acquisition parameters — inputs to the sliding-velocity derivation. */
export interface AfmParams {
  scanRate?: string;
  scanSize?: string;
}

/** BASE LAYER — required for a record to be approved into the official database. */
export interface CoreFields {
  ionicLiquid: IonicLiquidCore;
  substrate: string;
  temperature: Quantity | null; // → K
  load: Quantity | null; // → N
  cof: number | null; // dimensionless (standardized)
}

/** MIDDLE LAYER — standardized when present, but never mandatory. */
export interface ExtendedFields {
  scale?: Scale;
  method?: string; // AFM / Tribometer
  probe?: string;
  probeType?: string;
  velocity?: Quantity; // sliding speed → m/s
  velocitySource?: "reported" | "derived";
  potential?: Quantity; // → V
  roughness?: Quantity; // surface roughness → m (length)
  surface?: SurfaceDescriptors; // γ_s, σ_s, θ_s, crystal/material descriptors
  additives?: string;
  cofMethod?: string; // how the COF was measured
  afm?: AfmParams;
  /** Interfacial IL film / boundary-layer thickness → m (a core lubrication descriptor). */
  filmThickness?: Quantity;
  /** Interfacial layer count when the paper reports layers rather than a thickness. */
  filmLayers?: number;
  waterContent?: string; // ppm or wt% (kept raw — not a single clean dimension)
  concentration?: string; // mol/L, wt% or mole fraction x_IL for mixtures/solutions
}

/** OUTER LAYER — unstructured, kept verbatim with a source note. */
export interface FlexibleField {
  key: string;
  value: string;
  unit?: string;
  note?: string; // provenance / why it's here
}

/** A normalized bounding box (fractions 0–1 of the page) for a figure crop. */
export interface BBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * How strongly the cited text supports the value FOR THIS MEASUREMENT.
 *   direct   — explicitly stated for this measurement/data point.
 *   inferred — stated elsewhere in the paper (e.g. a methods/CV temperature)
 *              and presumed to apply; not restated for this measurement.
 *   assumed  — not in the paper at all (e.g. "not stated" recorded as
 *              293.15 K by convention).
 * Unset = unassessed (legacy entries).
 */
export type EvidenceBasis = "direct" | "inferred" | "assumed";

/** Per-field provenance: where in the paper a value came from. */
export interface FieldProvenance {
  page?: number;
  figure?: string; // e.g. "Fig. 4a"
  table?: string; // e.g. "Table 2"
  section?: string; // e.g. "3.2 Results"
  quote?: string; // short supporting snippet
  context?: string; // longer surrounding excerpt, so the value can be read in context
  figureBox?: BBox; // curator-drawn crop region on the cited page
  basis?: EvidenceBasis; // evidence strength for THIS measurement
  basisNote?: string; // what the inference/assumption rests on, e.g. "stated for CV, not AFM friction"
}

/** Provenance keyed by field name (cation, load, cof, …). */
export type ProvenanceMap = Record<string, FieldProvenance>;

/** Fields that can carry provenance (for the editor's field picker). */
export const PROVENANCE_FIELDS = [
  "cation",
  "anion",
  "substrate",
  "probe",
  "temperature",
  "load",
  "cof",
  "velocity",
  "potential",
  "roughness",
  "surfaceEnergy",
  "surfaceChargeDensity",
  "contactAngle",
  "crystalPlane",
  "materialClass",
  "additives",
  "scanRate",
  "scanSize",
  "filmThickness",
  "waterContent",
  "concentration",
] as const;

export type RecordStatus = "review" | "official";

/**
 * One measured friction result (the tribology domain). The generic three-layer
 * record shape lives in lib/domain; this binds it to the friction core/extended.
 */
export type IonicRecord = DomainRecord<CoreFields, ExtendedFields>;

/** A stored source document: the uploaded PDF + its per-page text. */
export interface SourceDoc {
  id: string;
  filename: string;
  pageCount: number;
  createdAt: string;
  pages: { page: number; text: string }[];
  /** The paper's DOI (detected on upload) — the key for duplicate detection. */
  doi?: string;
}

/** A record before the store assigns id/status/createdAt. */
export type RecordDraft = DomainDraft<CoreFields, ExtendedFields>;

/**
 * Fields common to every domain's flat extractor output: the ionic-liquid
 * identity, the flexible catch-all, provenance, and confidence. Each domain's
 * own ExtractedFields extends this with its measured + condition fields.
 */
export interface ExtractedFieldsBase {
  paper: Paper;
  cation: string;
  anion: string;
  cationSmiles?: string;
  anionSmiles?: string;
  flexible?: FlexibleField[];
  /** Per-field provenance entries (field name + page/figure/quote). */
  provenance?: (FieldProvenance & { field: string })[];
  confidence?: number | null;
}

/**
 * Flat shape the tribology extractor (LLM or mock) emits. Raw strings
 * throughout — the ingestion step standardizes units and sorts fields into the
 * three layers.
 */
export interface ExtractedFields extends ExtractedFieldsBase {
  substrate?: string;
  temperature?: string;
  load?: string;
  cof?: number | null;
  cofMethod?: string;
  scale?: Scale;
  method?: string;
  probe?: string;
  probeType?: string;
  velocity?: string;
  potential?: string;
  roughness?: string;
  surfaceEnergy?: string;
  surfaceChargeDensity?: string;
  contactAngle?: string;
  crystalPlane?: string;
  materialClass?: string;
  additives?: string;
  afm?: AfmParams;
  /** Raw film thickness, e.g. "2.5 nm" — or a layer count like "3 layers". */
  filmThickness?: string;
  waterContent?: string;
  concentration?: string;
}

/* ------------------------------------------------------------------ */
/* Completeness — the base layer is mandatory for official approval.  */
/* ------------------------------------------------------------------ */

export const CORE_FIELDS = [
  { key: "cation", label: "Cation" },
  { key: "anion", label: "Anion" },
  { key: "substrate", label: "Substrate" },
  { key: "temperature", label: "Temperature" },
  { key: "load", label: "Load" },
  { key: "cof", label: "COF" },
] as const;

export function coreCompleteness(r: IonicRecord | RecordDraft): {
  complete: boolean;
  missing: string[];
} {
  const c = r.core;
  const missing: string[] = [];
  if (!c.ionicLiquid.cation?.trim()) missing.push("Cation");
  if (!c.ionicLiquid.anion?.trim()) missing.push("Anion");
  if (!c.substrate?.trim()) missing.push("Substrate");
  if (!c.temperature || c.temperature.std == null || !Number.isFinite(c.temperature.std)) missing.push("Temperature");
  if (!c.load || c.load.std == null || !Number.isFinite(c.load.std) || c.load.std <= 0) missing.push("Load");
  if (c.cof == null) missing.push("COF");
  return { complete: missing.length === 0, missing };
}

/** Format a COF for display (4 dp), or em-dash when null. */
export function formatCof(cof: number | null | undefined): string {
  return cof === null || cof === undefined ? "—" : cof.toFixed(4);
}

/** Full human-readable provenance, e.g. "p.3 · Fig. 4a — '…μ = 0.12…' · inferred (…)". */
export function formatProvenance(p?: FieldProvenance): string {
  if (!p) return "";
  const parts: string[] = [];
  if (p.page != null) parts.push(`p.${p.page}`);
  if (p.figure) parts.push(p.figure);
  if (p.table) parts.push(p.table);
  if (p.section) parts.push(p.section);
  let s = parts.join(" · ");
  if (p.quote) s += (s ? " — " : "") + `"${p.quote}"`;
  if (p.basis) {
    const note = p.basisNote ? ` (${p.basisNote})` : "";
    s += (s ? " · " : "") + `${p.basis} evidence${note}`;
  } else if (p.basisNote) {
    s += (s ? " · " : "") + p.basisNote;
  }
  return s;
}

/**
 * Short badge label for a provenance entry, e.g. "p.3" / "Fig. 4a" / "src".
 * Inferred/assumed evidence is prefixed "~" so weak support is visible at a
 * glance ("~p.2"); a pure assumption with no location reads "assumed".
 */
export function provenanceBadge(p?: FieldProvenance): string {
  if (!p) return "";
  const loc =
    p.page != null ? `p.${p.page}` : p.figure || p.table || (p.section || p.quote ? "src" : "");
  if (p.basis === "inferred" || p.basis === "assumed") return loc ? `~${loc}` : p.basis;
  return loc;
}

/* ------------------------------------------------------------------ */
/* Batch jobs — server-side PDF upload queue.                         */
/* ------------------------------------------------------------------ */

export type JobStatus = "queued" | "extracting" | "done" | "error" | "committed";

export interface BatchJob {
  id: string;
  filename: string;
  status: JobStatus;
  createdAt: string;
  sourceId?: string;
  source?: string; // "anthropic" | "openai-compatible" | "mock"
  model?: string;
  chars?: number;
  recordCount: number;
  error?: string | null;
  /** Extracted candidates (present once status is done/committed). */
  candidates: RecordDraft[];
}

/**
 * JSON Schema for extractor tool-use. Flat by design — the model reports what
 * it finds and our ingestion layer standardizes + stratifies it.
 */
export const EXTRACTION_TOOL_SCHEMA = {
  type: "object" as const,
  properties: {
    records: {
      type: "array",
      description:
        "One entry per CONDITION-PERFORMANCE point: a friction result bound to its full set of test conditions. Sweeping a variable → one record per reported point.",
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
          // base layer
          cation: { type: "string", description: "Cation shorthand, e.g. [BMIM]. REQUIRED." },
          anion: { type: "string", description: "Anion shorthand, e.g. [I]. REQUIRED." },
          cationSmiles: { type: "string" },
          anionSmiles: { type: "string" },
          substrate: { type: "string", description: "Counter-surface, e.g. Au(111). REQUIRED." },
          temperature: { type: "string", description: "Temperature WITH unit, e.g. '293.15 K' or '25 °C'. If the paper does not state temperature, use 'not stated'." },
          load: {
            type: "string",
            description:
              "Normal FORCE with unit (nN, µN, mN, N), e.g. '>5 nN'. REQUIRED. NEVER a voltage — an AFM bias/setpoint voltage is not a load.",
          },
          cof: { type: ["number", "null"], description: "Friction coefficient (dimensionless). REQUIRED if reported." },
          cofMethod: { type: "string", description: "How the COF was measured, e.g. 'Ff/FN slope', if stated." },
          // middle layer
          scale: { type: "string", enum: ["nano", "macro"] },
          method: { type: "string", description: "e.g. AFM or Tribometer." },
          probe: {
            type: "string",
            description:
              'Probe MATERIAL, plus model/maker in parentheses when stated — e.g. "silicon nitride (SNL, Bruker)" or "silica". KEY DATA ONLY, never the paper\'s describing sentence (that sentence belongs in a provenance entry for field "probe").',
          },
          probeType: {
            type: "string",
            description:
              'Probe geometry + size as stated, e.g. "Tip · 2 nm" (tip radius), "Colloid · Ø 5 μm" (sphere diameter), "SFA surface". Omit the size when the paper does not state one — never guess.',
          },
          velocity: {
            type: "string",
            description:
              "Sliding velocity WITH unit, only if stated directly. If only AFM scan rate/size are given, leave null — the platform derives it.",
          },
          potential: {
            type: "string",
            description: "Applied bias / surface / electrochemical potential in volts, e.g. '+0.5 V' or '0–2 V'. AFM tip/surface voltages belong here, not in load.",
          },
          roughness: { type: "string", description: "Surface roughness with unit, e.g. '2 nm' (Ra)." },
          surfaceEnergy: { type: "string", description: "Solid surface free energy γ_s WITH unit, e.g. '55 mJ/m2' or '0.055 J/m2'. Omit if not stated." },
          surfaceChargeDensity: { type: "string", description: "Solid surface charge density σ_s WITH unit, e.g. '-0.02 C/m2'. Omit if not stated." },
          contactAngle: { type: "string", description: "Substrate water contact angle θ_s WITH unit/degree sign, e.g. '75°'. Omit if not stated." },
          crystalPlane: { type: "string", description: "Crystal plane or surface structure indicator, e.g. '(111)', '(0001)', 'polycrystalline', or 'amorphous'." },
          materialClass: { type: "string", description: "Coarse substrate material class if explicitly stated, e.g. metal, carbon, ceramic, polymer, semiconductor." },
          additives: { type: "string", description: "Additives / dopants, if any." },
          filmThickness: {
            type: "string",
            description:
              "Interfacial IL film / boundary-layer thickness WITH unit, e.g. '2.5 nm' — or a layer count exactly as stated, e.g. '3 layers'. A core lubrication descriptor: report it whenever the paper states or measures it (squeeze-out steps, force-distance layering, ellipsometry). NEVER estimate it yourself.",
          },
          waterContent: {
            type: "string",
            description: "Water content / humidity, e.g. '120 ppm' or '40 %RH' — water strongly affects IL friction.",
          },
          concentration: {
            type: "string",
            description: "IL concentration for mixtures/solutions, e.g. '0.5 mol/L', '10 wt%', or a mole fraction 'x_IL = 0.3'. Omit for neat ionic liquids.",
          },
          afm: {
            type: "object",
            description: "AFM acquisition parameters (nano/AFM only).",
            properties: {
              scanRate: { type: "string", description: "e.g. '1 Hz'." },
              scanSize: { type: "string", description: "Line length, e.g. '2 µm'." },
            },
          },
          // outer layer
          flexible: {
            type: "array",
            description:
              "Anything notable that has no formal field yet (unusual conditions, paper-specific methods). Keep it rather than discard it.",
            items: {
              type: "object",
              properties: {
                key: { type: "string", description: "Short label, e.g. 'humidity'." },
                value: { type: "string" },
                unit: { type: "string" },
                note: { type: "string", description: "Why it's here / source context." },
              },
              required: ["key", "value"],
            },
          },
          // provenance — where each value came from
          provenance: {
            type: "array",
            description:
              "Per-field provenance. For each value you can locate, record the field name and where it came from: the page (use the [PAGE n] markers in the text), figure, table, section, and a short VERBATIM supporting quote. Include at least the cof and load when locatable.",
            items: {
              type: "object",
              properties: {
                field: {
                  type: "string",
                  description: "Field name: cation, anion, substrate, probe, temperature, load, cof, velocity, potential, roughness, surfaceEnergy, surfaceChargeDensity, contactAngle, crystalPlane, materialClass, additives, filmThickness, waterContent, concentration, scanRate, or scanSize.",
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
                context: { type: "string", description: "A longer surrounding excerpt (1-3 contiguous sentences, also copied verbatim) so the value can be read in context." },
                basis: {
                  type: "string",
                  enum: ["direct", "inferred"],
                  description:
                    "\"direct\" if the text states this value FOR THIS measurement; \"inferred\" if it appears only in general/methods context and is presumed to apply (e.g. a temperature stated for CV measurements applied to AFM friction data).",
                },
                basisNote: {
                  type: "string",
                  description: "For inferred values: what the inference rests on, e.g. 'stated for the CV measurements, not restated for AFM friction'.",
                },
              },
              required: ["field"],
            },
          },
          confidence: { type: "number", description: "0–1 confidence in this record." },
        },
        required: ["paper", "cation", "anion", "substrate", "temperature", "load", "cof"],
      },
    },
  },
  required: ["records"],
};
