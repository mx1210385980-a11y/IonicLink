import type { Quantity } from "../units";
import type { DomainDraft, DomainRecord } from "../domain";
import type { BBox, ExtractedFieldsBase, IonicLiquidCore } from "../schema";

/**
 * Conductivity domain model. Mirrors the tribology three-layer shape but for
 * ionic-liquid electrical and interfacial properties. The atomic unit is one
 * unique condition set, which may contain several compatible target properties.
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

export type ElectrochemicalCellConfiguration = "two-electrode" | "three-electrode";

/** A paper curve that supports the target value(s) in one conductivity record. */
export interface ConductivityCurveKeyPoint {
  /** Human-readable condition or landmark, e.g. "298 K" or "onset". */
  label: string;
  /** Value exactly as reported in the caption/text, e.g. "12.4 mS/cm". */
  value: string;
  /** Stable record field used by downstream modelling/export. */
  field?: string;
  /** Legend/series identity when several curves share one panel. */
  seriesLabel?: string;
  /** Printed subplot label when this reading belongs to one panel only. */
  panelLabel?: string;
  /** Structured measurement context, e.g. "298 K · 5 wt%". */
  condition?: string;
  /** Scientific landmark represented by this item. */
  kind?: "coordinate" | "slope" | "peak" | "onset" | "intercept" | "plateau" | "range" | "reported-value";
  /** Explicit coordinate components when the paper/figure provides them. */
  x?: string;
  y?: string;
  /** A fitted/local gradient, kept separately from point coordinates. */
  slope?: string;
  /** Whether the number came from paper text, printed graph annotation, or image estimation. */
  source?: "paper-text" | "figure-annotation" | "image-estimated";
  /** Confidence for image-derived readings; reported values normally use 1. */
  confidence?: number;
  note?: string;
  /** Platform-written explanation of this reading; not the original caption. */
  interpretation?: string;
  /** Exact supporting excerpt and its PDF page, retained for evidence/export. */
  evidence?: string;
  sourcePage?: number;
  /** Figure-wide comparisons must not be consumed as current-record measurements. */
  scope?: "record" | "figure-comparison";
}

/** A sparse, source-grounded Y=f(X) relationship recovered from a plot/table. */
export interface ConductivityPropertyDependency {
  /** Short label, e.g. "Conductivity vs temperature". */
  label: string;
  /** Stable target property consumed by export/modelling. */
  dependentField: string;
  /** Experimental variable that changes across the compared observations. */
  independentVariable: string;
  /** Human-readable axis names including units when available. */
  xAxis?: string;
  yAxis?: string;
  /** Descriptive direction only; it must not be presented as causation. */
  trend: "increases" | "decreases" | "non-monotonic" | "approximately-constant" | "comparison";
  /** Platform-written, evidence-grounded statement in Chinese. */
  statement: string;
  /** Sparse observations are sufficient; a complete digitized curve is not required. */
  observations: Array<{
    x: string;
    y: string;
    seriesLabel?: string;
    condition?: string;
  }>;
  /** Whether the relation applies to one series or compares several plotted series. */
  scope?: "record-series" | "figure-comparison";
  source?: "paper-text" | "figure-annotation" | "image-estimated" | "record-comparison";
  confidence?: number;
  evidence?: string;
  sourcePage?: number;
}

/** One plot inside a multi-panel paper figure. Boxes use source-page fractions. */
export interface ConductivityPerformancePanel {
  /** Panel label such as A, B, or C. */
  label: string;
  /** Short scientific description recovered from the caption. */
  title?: string;
  curveType?: string;
  xAxis?: string;
  yAxis?: string;
  /** Page-level crop for this panel. */
  figureBox?: BBox;
  /** Series labels represented by this panel. */
  seriesLabels?: string[];
  /** Panel-specific reported or image-estimated graph landmarks. */
  keyPoints?: ConductivityCurveKeyPoint[];
  /** How this panel and its readings were obtained. */
  source?: "paper-text" | "figure-annotation" | "image-estimated";
  confidence?: number;
}

export interface ConductivityPerformanceFigure {
  /** Paper label such as "Fig. 4a". */
  figure: string;
  page?: number;
  /** Scientific curve family, not an image-processing guess. */
  curveType: string;
  /** Axis labels including units where the paper supplies them. */
  xAxis?: string;
  yAxis?: string;
  /** The series in a multi-series plot that belongs to this record. */
  seriesLabel?: string;
  caption?: string;
  /** Target field chiefly supported by this figure. */
  primaryField?: string;
  /** Exact readings stated by the paper; never silently estimated from pixels. */
  keyPoints?: ConductivityCurveKeyPoint[];
  /** Explicit property-condition dependencies extracted without requiring a full curve. */
  dependencies?: ConductivityPropertyDependency[];
  /** Relevant subplots shown one at a time in the card carousel. */
  panels?: ConductivityPerformancePanel[];
  /** Distinguishes sparse reported values from an actually digitized curve. */
  dataStatus?: "reported-key-points" | "estimated-key-points" | "mixed-key-points" | "digitized-series" | "source-data-series";
  /** Exact or automatically inferred source-page crop. */
  figureBox?: BBox;
}

/** MIDDLE LAYER — standardized when present, but never mandatory. */
export interface ConductivityExtended {
  method?: string; // EIS / conductivity cell
  potentialReference?: string;
  cellConfiguration?: ElectrochemicalCellConfiguration;
  /** Original wording, e.g. "three-electrode Swagelok cell". */
  cellSetup?: string;
  workingElectrode?: string;
  counterElectrode?: string;
  referenceElectrode?: string;
  positiveElectrode?: string;
  negativeElectrode?: string;
  pressure?: Quantity; // measurement pressure → Pa
  viscosity?: Quantity; // dynamic viscosity η → Pa·s
  waterContent?: string; // ppm or wt% (kept raw — not a single clean dimension)
  concentration?: string; // mol/L or wt% for IL solutions / electrolytes
  density?: string; // kept raw
  cellConstant?: string; // conductivity-cell constant, if reported
  performanceFigure?: ConductivityPerformanceFigure;
  /** Curve-, table-, or text-derived relationships not tied to one image artifact. */
  propertyDependencies?: ConductivityPropertyDependency[];
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
  cellConfiguration?: string;
  cellSetup?: string;
  workingElectrode?: string;
  counterElectrode?: string;
  referenceElectrode?: string;
  positiveElectrode?: string;
  negativeElectrode?: string;
  pressure?: string; // e.g. "1 atm" or "250 kPa"
  method?: string;
  viscosity?: string; // e.g. "45 cP"
  waterContent?: string; // e.g. "120 ppm"
  concentration?: string;
  density?: string;
  cellConstant?: string;
  performanceFigure?: ConductivityPerformanceFigure;
  propertyDependencies?: ConductivityPropertyDependency[];
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
  "cellConfiguration",
  "cellSetup",
  "workingElectrode",
  "counterElectrode",
  "referenceElectrode",
  "positiveElectrode",
  "negativeElectrode",
  "pressure",
  "viscosity",
  "waterContent",
  "concentration",
  "density",
  "method",
  "performanceFigure",
  "propertyDependencies",
] as const;

export function conductivityCoreCompleteness(
  r: ConductivityRecord | ConductivityDraft
): { complete: boolean; missing: string[] } {
  const c = r.core;
  const missing: string[] = [];
  if (!c.ionicLiquid.cation?.trim()) missing.push("Cation");
  if (!c.ionicLiquid.anion?.trim()) missing.push("Anion");
  if (!c.surface?.trim()) missing.push("Surface");
  if (
    !c.conductivity &&
    !c.capacitance &&
    !c.electricField &&
    !c.electrochemicalWindow &&
    !c.chargeTransferResistance &&
    !r.extended.viscosity
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
        "One entry per UNIQUE IONIC-LIQUID SERIES AND CONDITION SET. A paper or figure containing different cation/anion pairs, formulations, concentrations, surfaces, temperatures, potentials, or methods MUST produce separate records. Never combine several ionic liquids into slash-separated identity fields. Merge only compatible target properties for the same series and condition set.",
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
            description: "Temperature WITH unit, e.g. '298.15 K' or '25 °C', only when the paper reports or clearly identifies it. Never invent a missing temperature.",
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
          cellConfiguration: {
            type: ["string", "null"],
            enum: ["two-electrode", "three-electrode", null],
            description: "Electrochemical cell configuration. Use only when the paper explicitly identifies a two- or three-electrode setup.",
          },
          cellSetup: {
            type: ["string", "null"],
            description: "Original reported cell wording, e.g. 'three-electrode Swagelok cell'.",
          },
          workingElectrode: { type: ["string", "null"], description: "Working-electrode material or named assembly, if reported." },
          counterElectrode: { type: ["string", "null"], description: "Counter/auxiliary-electrode material, if reported." },
          referenceElectrode: { type: ["string", "null"], description: "Reference-electrode material/type, e.g. SCE or Ag/AgCl, if reported." },
          positiveElectrode: { type: ["string", "null"], description: "Positive-electrode material in a two-electrode cell, only when explicitly identified." },
          negativeElectrode: { type: ["string", "null"], description: "Negative-electrode material in a two-electrode cell, only when explicitly identified." },
          pressure: {
            type: ["string", "null"],
            description: "Measurement pressure WITH unit, e.g. '1 atm', '250 kPa', or '20 MPa', if explicitly reported.",
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
          performanceFigure: {
            type: ["object", "null"],
            description:
              "The source-paper curve that supports this record. Use only when the paper contains a relevant conductivity/viscosity/CV/LSV/EIS/capacitance curve and bind the record to its matching plotted series. Do not invent graph readings.",
            properties: {
              figure: { type: "string", description: "Exact paper label, e.g. 'Fig. 4a'." },
              page: { type: "integer", description: "PDF page from the [PAGE n] marker." },
              curveType: {
                type: "string",
                description:
                  "Scientific curve type, e.g. 'conductivity-temperature', 'conductivity-concentration', 'viscosity-temperature', 'CV', 'LSV', 'EIS Nyquist', 'EIS Bode', or 'capacitance-cycle'.",
              },
              xAxis: { type: "string", description: "Reported x-axis quantity and unit." },
              yAxis: { type: "string", description: "Reported y-axis quantity and unit." },
              seriesLabel: {
                type: "string",
                description: "Exact legend/series label that corresponds to THIS record's ionic liquid or formulation.",
              },
              caption: { type: "string", description: "Short exact caption or caption fragment." },
              primaryField: {
                type: "string",
                enum: ["conductivity", "capacitance", "viscosity", "electrochemicalWindow", "chargeTransferResistance", "electricField"],
              },
              keyPoints: {
                type: "array",
                description:
                  "Important coordinates, slopes, peaks, onsets, plateaus, ranges, or fitted values only when explicitly printed in the caption, body text, table, or point annotation. Pixel estimates are added later by the image-analysis stage, never by this text-only stage.",
                items: {
                  type: "object",
                  properties: {
                    label: { type: "string" },
                    value: { type: "string" },
                    field: {
                      type: "string",
                      description: "Stable target field name, e.g. conductivity or chargeTransferResistance.",
                    },
                    seriesLabel: { type: "string", description: "Exact legend label for this reading in a multi-series graph." },
                    panelLabel: { type: "string", description: "Printed subplot label (A, B, ...) for this reading; omit for genuinely shared figure conditions." },
                    condition: {
                      type: "string",
                      description: "Reported condition applying to the reading, e.g. '298 K · 5 wt%'.",
                    },
                    kind: {
                      type: "string",
                      enum: ["coordinate", "slope", "peak", "onset", "intercept", "plateau", "range", "reported-value"],
                    },
                    x: { type: "string", description: "Exact reported x coordinate with unit, when available." },
                    y: { type: "string", description: "Exact reported y coordinate with unit, when available." },
                    slope: { type: "string", description: "Exact reported slope/gradient with unit, when available." },
                    source: {
                      type: "string",
                      enum: ["paper-text", "figure-annotation"],
                      description: "paper-text for caption/body/table values; figure-annotation for a value printed inside the plot.",
                    },
                    confidence: { type: "number", minimum: 0, maximum: 1 },
                    note: { type: "string" },
                    interpretation: { type: "string", description: "Concise platform-written scientific meaning of this specific reading, grounded in the paper. Do not paste the Figure caption or infer causation without support." },
                    evidence: { type: "string", description: "Exact short supporting source excerpt." },
                    sourcePage: { type: "integer", minimum: 1 },
                    scope: { type: "string", enum: ["record", "figure-comparison"] },
                  },
                  required: ["label", "value"],
                },
              },
              dependencies: {
                type: "array",
                description:
                  "Sparse, model-ready Y=f(X) relationships explicitly supported by a curve, table, caption, or result paragraph. Use this for temperature, scan-rate, potential, concentration, water-content, cycle, frequency, or ionic-liquid identity dependence. Never infer causation and never require a complete digitized curve.",
                items: {
                  type: "object",
                  properties: {
                    label: { type: "string" },
                    dependentField: { type: "string" },
                    independentVariable: { type: "string" },
                    xAxis: { type: "string" },
                    yAxis: { type: "string" },
                    trend: { type: "string", enum: ["increases", "decreases", "non-monotonic", "approximately-constant", "comparison"] },
                    statement: { type: "string", description: "Concise Chinese description of the observed dependence, not a causal claim." },
                    observations: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          x: { type: "string" },
                          y: { type: "string" },
                          seriesLabel: { type: "string" },
                          condition: { type: "string" },
                        },
                        required: ["x", "y"],
                      },
                    },
                    scope: { type: "string", enum: ["record-series", "figure-comparison"] },
                    source: { type: "string", enum: ["paper-text", "figure-annotation"] },
                    confidence: { type: "number", minimum: 0, maximum: 1 },
                    evidence: { type: "string" },
                    sourcePage: { type: "integer", minimum: 1 },
                  },
                  required: ["label", "dependentField", "independentVariable", "trend", "statement", "observations"],
                },
              },
              panels: {
                type: "array",
                description:
                  "Relevant subplots in a multi-panel figure. Include one item per relevant curve panel (A, B, C...) so the platform can crop and paginate them; omit microscopy and unrelated schematics.",
                items: {
                  type: "object",
                  properties: {
                    label: { type: "string", description: "Panel label, e.g. A." },
                    title: { type: "string", description: "Short exact scientific description from the caption." },
                    curveType: { type: "string" },
                    xAxis: { type: "string" },
                    yAxis: { type: "string" },
                    seriesLabels: { type: "array", items: { type: "string" } },
                    source: { type: "string", enum: ["paper-text", "figure-annotation"] },
                    confidence: { type: "number", minimum: 0, maximum: 1 },
                  },
                  required: ["label"],
                },
              },
              dataStatus: {
                type: "string",
                enum: ["reported-key-points", "estimated-key-points", "mixed-key-points", "digitized-series", "source-data-series"],
                description:
                  "Use reported-key-points in this text stage. estimated-key-points and mixed-key-points are reserved for the later image-analysis stage. Never label an image-only curve as a digitized series.",
              },
            },
            required: ["figure", "curveType"],
          },
          propertyDependencies: {
            type: "array",
            description:
              "Source-grounded Y=f(X) relationships from a table, curve, caption, or result paragraph. Use this when the relation is not tied to one performanceFigure image. At least two comparable observations are required.",
            items: {
              type: "object",
              properties: {
                label: { type: "string" },
                dependentField: { type: "string" },
                independentVariable: { type: "string" },
                xAxis: { type: "string" },
                yAxis: { type: "string" },
                trend: { type: "string", enum: ["increases", "decreases", "non-monotonic", "approximately-constant", "comparison"] },
                statement: { type: "string" },
                observations: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: { x: { type: "string" }, y: { type: "string" }, seriesLabel: { type: "string" }, condition: { type: "string" } },
                    required: ["x", "y"],
                  },
                },
                scope: { type: "string", enum: ["record-series", "figure-comparison"] },
                source: { type: "string", enum: ["paper-text", "figure-annotation"] },
                confidence: { type: "number", minimum: 0, maximum: 1 },
                evidence: { type: "string" },
                sourcePage: { type: "integer", minimum: 1 },
              },
              required: ["label", "dependentField", "independentVariable", "trend", "statement", "observations"],
            },
          },
          flexible: {
            type: "array",
            description:
              "Anything notable that has no formal field yet (atmosphere, purity, humidity). Cell/electrode details belong in their dedicated fields. Keep other context rather than discard it.",
            items: {
              type: "object",
              properties: {
                key: { type: "string", description: "Short label, e.g. 'atmosphere'." },
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
                    "Field name: cation, anion, surface, temperature, conductivity, capacitance, electricField, electrodePotential, electrochemicalWindow, chargeTransferResistance, potentialReference, cellConfiguration, cellSetup, workingElectrode, counterElectrode, referenceElectrode, positiveElectrode, negativeElectrode, pressure, viscosity, waterContent, concentration, density, or method.",
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
