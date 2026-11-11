import { TEACHING_FIELDS } from "../teachingShared";

// Live lessons evolve independently of the original six-field tribology lab.
export type LiveDomain = "tribology" | "conductivity" | "afm";
export type LiveRow = Record<string, string>;
export type LiveField = { key: string; label: string; example?: string };

export const LIVE_DOMAINS: Array<{ key: LiveDomain; label: string }> = [
  { key: "tribology", label: "Tribology" },
  { key: "conductivity", label: "Conductivity & electrochemistry" },
  { key: "afm", label: "AFM force spectroscopy" },
];

const AFM_FIELDS: LiveField[] = [
  { key: "cation", label: "Cation", example: "[EMIM]" },
  { key: "anion", label: "Anion", example: "[TFSI]" },
  { key: "surface", label: "Substrate", example: "HOPG" },
  { key: "property", label: "Property / landmark", example: "Layer spacing, adhesion force, digitized minimum force" },
  { key: "value", label: "Value and unit", example: "0.7 nm, -1.2 nN" },
  { key: "separation", label: "Separation at landmark", example: "1.2 nm, or NR" },
  { key: "potential", label: "Applied / electrode potential", example: "-1 V, or NR (not zero)" },
  { key: "reference", label: "Reference electrode", example: "Pt, or NR" },
  { key: "temperature", label: "Temperature", example: "298 K, or NR" },
  { key: "probe", label: "Probe material", example: "Silicon nitride, or NR" },
  { key: "tipRadius", label: "Tip radius", example: "10 nm, or NR" },
  { key: "springConstant", label: "Cantilever spring constant", example: "0.2 N/m, or NR" },
  { key: "variedParameter", label: "Varied parameter", example: "Potential, temperature, IL identity, or NR" },
  { key: "variableValue", label: "Varied parameter value", example: "-1 V, or NR" },
  { key: "trend", label: "Reported dependence", example: "Increases, decreases, non-monotonic, or NR" },
  { key: "evidence", label: "Source locator", example: "p. 7; Fig. 3b; image-estimated" },
];

export function liveDomainLabel(domain: LiveDomain = "tribology"): string {
  return LIVE_DOMAINS.find((item) => item.key === domain)!.label;
}

export function liveMethodLabel(domain: LiveDomain, mode: string | null): string {
  return mode === "ai" ? (domain === "afm" ? "Automatic extraction" : "AI-assisted extraction") : "Manual extraction";
}

export function liveInstructions(domain: LiveDomain): string {
  if (domain === "conductivity") return "One observation per property, ionic liquid and condition. Retain temperature, scan rate, reference electrode and the changing variable. Extract supported key points, not an invented full curve.";
  if (domain === "afm") return "One observation per panel, condition and landmark. Preserve physical axes, probe and substrate. Digitized extrema are image estimates, not automatically identified layer spacings or rupture forces.";
  return "One observation per reported friction measurement and its conditions.";
}

export function liveFieldGroups(domain: LiveDomain): Array<{ label: string; keys: string[] }> {
  if (domain === "tribology") return [{ label: "Measurement", keys: liveFields(domain).map((field) => field.key) }];
  return [
    { label: "Measurement", keys: ["cation", "anion", "surface", "property", "value", ...(domain === "afm" ? ["separation"] : [])] },
    { label: "Conditions", keys: domain === "afm" ? ["potential", "reference", "temperature", "probe", "tipRadius", "springConstant"] : ["temperature", "concentration", "scanRate", "potential", "reference", "method"] },
    { label: "Dependence and source", keys: ["variedParameter", "variableValue", "trend", "evidence"] },
  ];
}

const CONDUCTIVITY_FIELDS: LiveField[] = [
  { key: "cation", label: "Cation", example: "[EMIM]" },
  { key: "anion", label: "Anion", example: "[TFSI]" },
  { key: "surface", label: "Surface / working electrode", example: "Au(111), or NR for bulk measurements" },
  { key: "property", label: "Property / landmark", example: "Conductivity, Rct, anodic peak current" },
  { key: "value", label: "Value and unit", example: "12.4 mS/cm" },
  { key: "temperature", label: "Temperature", example: "298.15 K" },
  { key: "concentration", label: "Composition / concentration", example: "Neat IL, 0.1 mol/L, or NR" },
  { key: "scanRate", label: "Scan rate", example: "100 mV/s" },
  { key: "potential", label: "Applied / electrode potential", example: "0.5 V" },
  { key: "reference", label: "Reference electrode", example: "Ag/AgCl" },
  { key: "method", label: "Measurement method", example: "CV, EIS, conductivity cell" },
  { key: "variedParameter", label: "Varied parameter", example: "Temperature, scan rate, IL identity, or NR" },
  { key: "variableValue", label: "Varied parameter value", example: "298.15 K, 100 mV/s, or NR" },
  { key: "trend", label: "Reported dependence", example: "Increases, decreases, non-monotonic, or NR" },
  { key: "evidence", label: "Source locator", example: "p. 5; Fig. 3a; Table 2" },
];

export function liveDomain(value: unknown): LiveDomain {
  if (value === undefined || value === null || value === "tribology") return "tribology";
  if (value === "conductivity" || value === "afm") return value;
  throw new Error("Choose a supported teaching domain.");
}

export function liveFields(domain: LiveDomain = "tribology"): readonly LiveField[] {
  return domain === "afm" ? AFM_FIELDS : domain === "conductivity" ? CONDUCTIVITY_FIELDS : TEACHING_FIELDS;
}

export function blankLiveRow(domain: LiveDomain = "tribology"): LiveRow {
  return Object.fromEntries(liveFields(domain).map(({ key }) => [key, ""]));
}

export function validateLiveRows(value: unknown, domain: LiveDomain = "tribology"): LiveRow[] {
  if (!Array.isArray(value) || !value.length || value.length > 100) throw new Error("Provide 1–100 extracted records.");
  return value.map((row) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error("Invalid table row format.");
    return Object.fromEntries(liveFields(domain).map(({ key }) => {
      const cell = (row as Record<string, unknown>)[key] ?? "";
      if (typeof cell !== "string" || cell.length > 2000) throw new Error("Fields must be text of at most 2,000 characters.");
      return [key, cell.trim()];
    }));
  });
}

/** Spreadsheet-safe text cells; scientific numeric values retain their sign. */
export function liveCsvCell(value: unknown): string {
  const text = String(value ?? "");
  const number = /^\s*[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?\s*$/i.test(text);
  const safe = /^\s*[=+@-]/.test(text) && !number ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function liveRowsCsv(rows: LiveRow[], domain: LiveDomain): string {
  const keys = liveFields(domain).map(({ key }) => key);
  return "\uFEFF" + [keys, ...rows.map((row) => keys.map((key) => row[key] ?? ""))].map((row) => row.map(liveCsvCell).join(",")).join("\r\n") + "\r\n";
}
