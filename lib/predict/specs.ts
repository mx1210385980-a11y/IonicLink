import type { Domain } from "../domain";
import { formatStdParts } from "../units";

/**
 * Per-domain display + behavior configuration for the Design Studio. All
 * prediction math is domain-generic (engine.ts); only the property identity,
 * formatting, and which condition controls exist differ.
 */

export interface DesignSpec {
  domain: Domain;
  symbol: string;
  propertyLabel: string;
  /** Eyebrow text on the instrument readout. */
  readoutLabel: string;
  /** SI ladder base ("" = dimensionless). */
  unitBase: string;
  /** Whether σ/D-style Arrhenius temperature translation applies. */
  hasTemperatureModel: boolean;
  conditionKind: "substrate" | "species" | null;
  objectiveDefault: "max" | "min";
  objectiveLabel: { max: string; min: string };
  /** Format a canonical value at 2 significant figures. */
  formatValue: (v: number) => string;
  /** The provenance field name carrying the verbatim quote for the property. */
  provenanceField: string;
}

/** "5.2×10⁻¹¹" — pretty scientific notation at 2 significant figures. */
export function sciNotation(v: number): string {
  if (!Number.isFinite(v) || v === 0) return String(v);
  const exp = Math.floor(Math.log10(Math.abs(v)));
  const mantissa = v / 10 ** exp;
  const m = Number(mantissa.toPrecision(2));
  const sup = String(exp).replace(/-/g, "⁻").replace(/\d/g, (d) => "⁰¹²³⁴⁵⁶⁷⁸⁹"[Number(d)]);
  return `${m}×10${sup}`;
}

function twoSig(v: number): number {
  return Number(v.toPrecision(2));
}

export const DESIGN_SPECS: Record<Domain, DesignSpec> = {
  tribology: {
    domain: "tribology",
    symbol: "μ",
    propertyLabel: "Nanoscale friction coefficient",
    readoutLabel: "Friction coefficient (COF)",
    unitBase: "",
    hasTemperatureModel: false,
    conditionKind: "substrate",
    objectiveDefault: "min",
    objectiveLabel: { max: "Maximize COF", min: "Minimize COF (lubricity)" },
    formatValue: (v) => String(twoSig(v)),
    provenanceField: "cof",
  },
  conductivity: {
    domain: "conductivity",
    symbol: "σ",
    propertyLabel: "Ionic conductivity",
    readoutLabel: "Ionic conductivity σ",
    unitBase: "S/m",
    hasTemperatureModel: true,
    conditionKind: null,
    objectiveDefault: "max",
    objectiveLabel: { max: "Maximize σ", min: "Minimize σ" },
    formatValue: (v) => {
      const p = formatStdParts(v, "S/m");
      return `${twoSig(Number(p.value))} ${p.unit}`;
    },
    provenanceField: "conductivity",
  },
  diffusion: {
    domain: "diffusion",
    symbol: "D",
    propertyLabel: "Self-diffusion coefficient",
    readoutLabel: "Self-diffusion coefficient D",
    unitBase: "m²/s",
    hasTemperatureModel: true,
    conditionKind: "species",
    objectiveDefault: "max",
    objectiveLabel: { max: "Maximize D", min: "Minimize D" },
    formatValue: (v) => `${sciNotation(v)} m²/s`,
    provenanceField: "diffusion",
  },
};
