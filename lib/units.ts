/**
 * Unit standardization layer.
 *
 * Every dimensional quantity is stored as BOTH the original (raw text + value +
 * unit) and a standardized value in a canonical SI-ish unit. This gives:
 *   - unified calculation / comparison (use `std`),
 *   - full traceability to the source text (use `raw`), so a bad conversion can
 *     always be caught and corrected.
 */

export type Dimension =
  | "temperature"
  | "force"
  | "velocity"
  | "potential"
  | "length"
  | "frequency"
  | "conductivity"
  | "viscosity"
  | "diffusion"
  | "surfaceEnergy"
  | "surfaceChargeDensity"
  | "angle";

export interface Quantity {
  /** Original text exactly as written, e.g. "25 °C", ">5 nN", "0–2 V". */
  raw: string;
  /** Numeric magnitude in the original unit (upper value for a range). */
  value: number | null;
  /** Original unit, normalized for display, e.g. "°C", "nN". */
  unit: string;
  /** Magnitude converted to the canonical unit (null if not convertible). */
  std: number | null;
  /** Canonical unit for this dimension. */
  stdUnit: string;
  /** True when the raw carried a qualifier/range (>, <, ~, "0–2"). */
  approx?: boolean;
  /** Original and standardized bounds when the raw value is a true range. */
  range?: {
    min: number;
    max: number;
    unit: string;
    stdMin: number | null;
    stdMax: number | null;
  };
}

export const ROOM_TEMPERATURE_K = 293.15;
export const ROOM_TEMPERATURE_RAW = "not stated";

export const CANONICAL_UNIT: Record<Dimension, string> = {
  temperature: "K",
  force: "N",
  velocity: "m/s",
  potential: "V",
  length: "m",
  frequency: "Hz",
  conductivity: "S/m",
  viscosity: "Pa·s",
  diffusion: "m²/s",
  surfaceEnergy: "mJ/m²",
  surfaceChargeDensity: "C/m²",
  angle: "°",
};

// Linear (multiplicative) conversion factors → canonical unit.
const LINEAR_FACTORS: Record<Exclude<Dimension, "temperature">, Record<string, number>> = {
  force: { kN: 1e3, N: 1, mN: 1e-3, cN: 1e-2, "µN": 1e-6, nN: 1e-9, pN: 1e-12 },
  velocity: { "m/s": 1, "cm/s": 1e-2, "mm/s": 1e-3, "µm/s": 1e-6, "nm/s": 1e-9 },
  potential: { kV: 1e3, V: 1, mV: 1e-3, "µV": 1e-6 },
  length: { m: 1, cm: 1e-2, mm: 1e-3, "µm": 1e-6, nm: 1e-9, "Å": 1e-10, pm: 1e-12 },
  frequency: { MHz: 1e6, kHz: 1e3, Hz: 1, mHz: 1e-3 },
  // 1 S/cm = 100 S/m; 1 mS/cm = 0.1 S/m; 1 µS/cm = 1e-4 S/m.
  conductivity: { "S/m": 1, "S/cm": 100, "mS/cm": 0.1, "µS/cm": 1e-4, "mS/m": 1e-3, "µS/m": 1e-6 },
  // 1 mPa·s = 1 cP = 1e-3 Pa·s; 1 P = 0.1 Pa·s.
  viscosity: { "Pa·s": 1, "mPa·s": 1e-3, cP: 1e-3, P: 0.1, mP: 1e-4 },
  // Parsing keys are ASCII — normalizeText folds superscripts ("m² s⁻¹" → "m2 s-1").
  // 1 cm²/s = 1e-4 m²/s; 1 µm²/s = 1e-12 m²/s.
  diffusion: { "m2/s": 1, "cm2/s": 1e-4, "mm2/s": 1e-6, "µm2/s": 1e-12, "nm2/s": 1e-18 },
  // Surface energy/free energy γ_s. mN/m is dimensionally equivalent to mJ/m².
  surfaceEnergy: { "mJ/m2": 1, "J/m2": 1000, "mN/m": 1, "N/m": 1000 },
  // Surface charge density σ_s.
  surfaceChargeDensity: { "C/m2": 1, "mC/m2": 1e-3, "µC/m2": 1e-6, "µC/cm2": 1e-2 },
  angle: { "°": 1, deg: 1, degree: 1, degrees: 1 },
};

// Alternate spellings → canonical key in LINEAR_FACTORS.
const ALIASES: Record<string, string> = {
  "k N": "kN",
  "m N": "mN",
  "c N": "cN",
  "u N": "µN",
  "µ N": "µN",
  "n N": "nN",
  "p N": "pN",
  "uN": "µN",
  "uV": "µV",
  "um": "µm",
  "um/s": "µm/s",
  "angstrom": "Å",
  // conductivity
  "uS/cm": "µS/cm",
  "uS/m": "µS/m",
  // viscosity — ASCII / spacing variants of Pa·s and mPa·s
  "mPa.s": "mPa·s",
  "mPa s": "mPa·s",
  "mPas": "mPa·s",
  "Pa.s": "Pa·s",
  "Pa s": "Pa·s",
  "Pas": "Pa·s",
  "cp": "cP",
  // diffusion — "m² s⁻¹" style (post-superscript-fold) and caret/ASCII variants
  "m2 s-1": "m2/s",
  "cm2 s-1": "cm2/s",
  "mm2 s-1": "mm2/s",
  "µm2 s-1": "µm2/s",
  "nm2 s-1": "nm2/s",
  "um2/s": "µm2/s",
  "um2 s-1": "µm2/s",
  "m^2/s": "m2/s",
  "cm^2/s": "cm2/s",
  // surface descriptors
  "mJ/m²": "mJ/m2",
  "J/m²": "J/m2",
  "C/m²": "C/m2",
  "mC/m²": "mC/m2",
  "uC/m2": "µC/m2",
  "µC/m²": "µC/m2",
  "uC/cm2": "µC/cm2",
  "µC/cm²": "µC/cm2",
  "degree": "degree",
  "degrees": "degrees",
};

const SUPERSCRIPTS: Record<string, string> = {
  "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4",
  "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9",
  "⁻": "-", "⁺": "+",
};

function normalizeText(raw: string): string {
  // unify micro signs (Greek mu → micro sign), the minus sign (U+2212 → -), and
  // middot variants (used in Pa·s) — while leaving en/em dashes intact so ranges
  // stay detectable. Superscripts fold to ASCII ("m² s⁻¹" → "m2 s-1"), and the
  // "× 10⁻¹¹" scientific form collapses to e-notation ("5.2 × 10⁻¹¹" → "5.2e-11";
  // the exponent sign is REQUIRED so "5 × 10 nN"-style products are untouched).
  return raw
    .replace(/s[\u0000-\u001f]+\s*1/g, "s-1")
    .replace(/[\u0000-\u001f]+/g, " ")
    .replace(/μ/g, "µ")
    .replace(/−/g, "-")
    .replace(/[⋅∙•]/g, "·")
    .replace(/◦\s*C/gi, "°C")
    .replace(/℃/g, "°C")
    .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁻⁺]/g, (ch) => SUPERSCRIPTS[ch])
    .replace(/\s*[×x·]\s*10\^?(?=[-+]\d)/g, "e")
    .replace(/\b(µm|um|cm|mm|nm|m)\s+s\s*\^?\s*-\s*1\b/gi, "$1/s");
}

function extractValue(norm: string): { value: number | null; approx: boolean; range?: { min: number; max: number } } {
  const rangeNorm = norm.replace(/(\d)\s*-\s*(\d)/g, "$1–$2");
  const nums = rangeNorm.match(/[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?/g);
  const approx = /[<>≤≥~≈±]/.test(rangeNorm) || /\+\/-|\+-/.test(rangeNorm) || /[–—]/.test(rangeNorm) || /\bto\b/i.test(rangeNorm);
  const hasRange = /[–—]/.test(rangeNorm) || /\bto\b/i.test(rangeNorm);
  const range = hasRange ? extractRange(rangeNorm) : undefined;
  // Ranges ("0–2") use the upper value; uncertainty ("25 ± 1 °C") uses the
  // measured value before ±, otherwise a temperature can collapse to "1 K".
  const value = range ? range.max : nums && nums.length ? parseFloat(nums[0]) : null;
  return { value, approx, range };
}

function extractRange(norm: string): { min: number; max: number } | undefined {
  const match = norm.match(/([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)\s*(?:[–—]|\bto\b)\s*([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)/i);
  if (!match) return undefined;

  const minToken = match[1];
  const maxToken = match[2];
  let min = parseFloat(minToken);
  const max = parseFloat(maxToken);
  const inheritedExponent = maxToken.match(/[eE]([-+]?\d+)$/);
  if (inheritedExponent && !/[eE]/.test(minToken)) {
    min *= Math.pow(10, Number(inheritedExponent[1]));
  }

  if (!Number.isFinite(min) || !Number.isFinite(max)) return undefined;
  return min <= max ? { min, max } : { min: max, max: min };
}

function normalizeConverted(n: number | null): number | null {
  return n == null || !Number.isFinite(n) ? n : Number(n.toPrecision(12));
}

function convertTemperatureValue(value: number, unit: string): number {
  if (unit === "°F") return ((value - 32) * 5) / 9 + 273.15;
  if (unit === "°C") return value + 273.15;
  return value;
}

function detectLinearUnit(
  norm: string,
  dim: Exclude<Dimension, "temperature">
): { key: string; literal: string } | null {
  const factors = LINEAR_FACTORS[dim];
  const candidates = [
    ...Object.keys(factors),
    ...Object.keys(ALIASES).filter((a) => factors[ALIASES[a]] !== undefined),
  ].sort((a, b) => b.length - a.length); // longest first: match "nN" before "N"
  for (const c of candidates) {
    if (norm.includes(c)) {
      // `literal` is the spelling found in the text — stripped before value
      // extraction so digit-bearing units ("m2 s-1") can't pollute the number.
      return { key: factors[c] !== undefined ? c : ALIASES[c], literal: c };
    }
  }
  return null;
}

function parseTemperature(raw: string): Quantity {
  const norm = normalizeText(raw);
  const roomTemperature = /\b(room\s*temp(?:erature)?|ambient(?:\s+conditions)?|rt|not\s+stated|not\s+reported|not\s+specified)\b/i.test(norm);
  if (roomTemperature) {
    return {
      raw: raw.trim(),
      value: ROOM_TEMPERATURE_K,
      unit: "K",
      std: ROOM_TEMPERATURE_K,
      stdUnit: "K",
      approx: true,
    };
  }

  const { value, approx, range: rawRange } = extractValue(norm);
  let unit = "";
  let std: number | null = null;
  const unitWindow = norm.slice(norm.search(/[-+]?\d/));
  const firstTemperatureUnit = unitWindow.match(/(?:°\s*C|C\b|°\s*F|F\b|K\b|摄氏度|摄氏)/i)?.[0] ?? "";
  if (/^(?:°?\s*C|摄氏度|摄氏)$/i.test(firstTemperatureUnit)) {
    unit = "°C";
    std = value != null ? value + 273.15 : null;
  } else if (/^°?\s*F$/i.test(firstTemperatureUnit)) {
    unit = "°F";
    std = value != null ? ((value - 32) * 5) / 9 + 273.15 : null;
  } else if (/^K$/i.test(firstTemperatureUnit)) {
    unit = "K";
    std = value;
  } else if (value != null) {
    // Bare number — assume already Kelvin (most tribology reports use K).
    unit = "";
    std = value;
  }
  const range = rawRange
    ? {
        min: rawRange.min,
        max: rawRange.max,
        unit,
        stdMin: normalizeConverted(convertTemperatureValue(rawRange.min, unit)),
        stdMax: normalizeConverted(convertTemperatureValue(rawRange.max, unit)),
      }
    : undefined;
  return { raw: raw.trim(), value, unit, std, stdUnit: "K", approx, range };
}

/** Parse a raw quantity string into a standardized Quantity, or null if empty. */
export function parseQuantity(raw: string | null | undefined, dim: Dimension): Quantity | null {
  if (!raw || !raw.trim()) return null;
  if (dim === "temperature") return parseTemperature(raw);

  const norm = normalizeText(raw);
  const found = detectLinearUnit(norm, dim);
  const { value, approx, range: rawRange } = extractValue(found ? norm.replace(found.literal, " ") : norm);
  const factor = found ? LINEAR_FACTORS[dim][found.key] : null;
  const std = value != null && factor != null ? value * factor : null;
  const range =
    rawRange && found && factor != null
      ? {
          min: rawRange.min,
          max: rawRange.max,
          unit: found.key,
          stdMin: normalizeConverted(rawRange.min * factor),
          stdMax: normalizeConverted(rawRange.max * factor),
        }
      : undefined;
  return { raw: raw.trim(), value, unit: found?.key ?? "", std, stdUnit: CANONICAL_UNIT[dim], approx, range };
}

/** Compact numeric formatter (4 sig figs, no trailing zeros). */
export function fmtNum(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return String(Number(n.toPrecision(4)));
}

// SI sub-unit ladders (descending) for dimensions whose canonical value is often
// tiny — so the standardized view reads "5 nN" / "2 µm/s", not "5e-9 N".
const SI_LADDERS: Record<string, { unit: string; factor: number }[]> = {
  N: [
    { unit: "kN", factor: 1e3 },
    { unit: "N", factor: 1 },
    { unit: "mN", factor: 1e-3 },
    { unit: "µN", factor: 1e-6 },
    { unit: "nN", factor: 1e-9 },
  ],
  "m/s": [
    { unit: "m/s", factor: 1 },
    { unit: "mm/s", factor: 1e-3 },
    { unit: "µm/s", factor: 1e-6 },
    { unit: "nm/s", factor: 1e-9 },
  ],
  m: [
    { unit: "m", factor: 1 },
    { unit: "mm", factor: 1e-3 },
    { unit: "µm", factor: 1e-6 },
    { unit: "nm", factor: 1e-9 },
  ],
  "Pa·s": [
    { unit: "Pa·s", factor: 1 },
    { unit: "mPa·s", factor: 1e-3 },
  ],
  "S/m": [
    { unit: "S/m", factor: 1 },
    { unit: "mS/m", factor: 1e-3 },
    { unit: "µS/m", factor: 1e-6 },
  ],
  "m²/s": [
    { unit: "m²/s", factor: 1 },
    { unit: "mm²/s", factor: 1e-6 },
    { unit: "µm²/s", factor: 1e-12 },
    { unit: "nm²/s", factor: 1e-18 },
  ],
};

/**
 * Format a canonical value into the tidiest SI sub-unit (value ≥ 1 where
 * possible, falling back to the smallest unit for very small magnitudes). A
 * single, consistent system — just auto-scaled for readability. Dimensions
 * without a ladder (K, V, Hz) render in their canonical unit unchanged.
 */
export function formatStd(value: number, base: string): string {
  const parts = formatStdParts(value, base);
  return `${parts.value} ${parts.unit}`;
}

function pickStdStep(value: number, base: string): { unit: string; factor: number } | null {
  const ladder = SI_LADDERS[base];
  if (!ladder) return null;
  const abs = Math.abs(value);
  let chosen = ladder[ladder.length - 1];
  for (const step of ladder) {
    if (abs >= step.factor) {
      chosen = step;
      break;
    }
  }
  return chosen;
}

export function formatStdParts(value: number, base: string): { value: string; unit: string } {
  if (value === 0) return { value: "0", unit: base };
  const step = pickStdStep(value, base);
  if (!step) return { value: fmtNum(value), unit: base };
  return { value: fmtNum(value / step.factor), unit: step.unit };
}

export function formatStdRangeParts(min: number, max: number, base: string): { min: string; max: string; unit: string } {
  const step = pickStdStep(Math.max(Math.abs(min), Math.abs(max)), base);
  if (!step) return { min: fmtNum(min), max: fmtNum(max), unit: base };
  return { min: fmtNum(min / step.factor), max: fmtNum(max / step.factor), unit: step.unit };
}

export function stdRangeParts(q: Quantity | null | undefined): { min: string; max: string; unit: string } | null {
  if (!q?.range || q.range.stdMin == null || q.range.stdMax == null) return null;
  return formatStdRangeParts(q.range.stdMin, q.range.stdMax, q.stdUnit);
}

export function stdRangeLabel(q: Quantity | null | undefined): string | null {
  const parts = stdRangeParts(q);
  return parts ? `${parts.min}-${parts.max} ${parts.unit}` : null;
}

type RelationPrefix = ">" | "≥" | "<" | "≤";

function firstNumberIndex(raw: string): number {
  return raw.search(/[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?/);
}

function relationPrefix(raw: string): RelationPrefix | "" {
  const norm = normalizeText(raw).replace(/\s+/g, " ").trim().toLowerCase();
  const index = firstNumberIndex(norm);
  const lead = index >= 0 ? norm.slice(0, index) : norm;

  if (
    /≥|>=|=>/.test(lead) ||
    /\b(?:greater|higher|more|larger)\s+than\s+or\s+equal(?:\s+to)?\b/.test(lead) ||
    /\bat\s+least\b|\bno\s+less\s+than\b|\bnot\s+less\s+than\b/.test(lead)
  ) {
    return "≥";
  }
  if (
    /≤|<=|=</.test(lead) ||
    /\b(?:less|lower|smaller)\s+than\s+or\s+equal(?:\s+to)?\b/.test(lead) ||
    /\bat\s+most\b|\bno\s+more\s+than\b|\bnot\s+more\s+than\b|\bup\s+to\b/.test(lead)
  ) {
    return "≤";
  }
  if (
    />/.test(lead) ||
    /\b(?:greater|higher|more|larger)\s+than\b|\babove\b|\bexceed(?:s|ed|ing)?\b|\bbeyond\b|\bover\b/.test(lead)
  ) {
    return ">";
  }
  if (/<|\b(?:less|lower|smaller)\s+than\b|\bbelow\b|\bunder\b/.test(lead)) {
    return "<";
  }
  return "";
}

function hasApproxCue(raw: string): boolean {
  const norm = normalizeText(raw).replace(/\s+/g, " ").trim().toLowerCase();
  return (
    /[~≈∼±]/.test(norm) ||
    /\+\/-|\+-/.test(norm) ||
    /\b(?:approx(?:\.|imately)?|about|around|ca\.?|circa)\b/.test(norm) ||
    /(^|[^a-z0-9])b(?=\d)/i.test(norm)
  );
}

/** "5 nN", "298.2 K" — the standardized label, or the raw if not convertible. */
export function stdLabel(q: Quantity | null | undefined): string {
  if (!q) return "—";
  if (q.std == null) return q.raw || "—";
  const range = stdRangeLabel(q);
  if (range) return range;
  const relation = relationPrefix(q.raw);
  if (relation) return `${relation}${hasApproxCue(q.raw) ? "≈" : ""}${formatStd(q.std, q.stdUnit)}`;
  return `${q.approx ? "≈" : ""}${formatStd(q.std, q.stdUnit)}`;
}

/** The readable original ("25 °C", ">5 nN") for primary display. */
export function rawLabel(q: Quantity | null | undefined): string {
  return q?.raw || "—";
}
