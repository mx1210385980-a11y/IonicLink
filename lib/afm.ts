import type { ExtendedFields } from "./schema";
import { parseQuantity, fmtNum, type Quantity } from "./units";

/**
 * AFM domain knowledge — sliding-velocity derivation.
 *
 * The tip rasters back and forth along a line of length L (scan size) at a
 * frequency f (scan rate, Hz). Each line is traversed twice per cycle (trace +
 * retrace), so the mean sliding speed is:
 *
 *        v = 2 · f · L
 *
 * Single source of truth: extraction, storage, the editor, and the Design
 * Studio's model card all call in here, so raw scan params are retained while
 * velocity derives consistently. All math runs in SI (Hz, m → m/s) via the
 * units layer.
 */

export const SLIDE_VELOCITY_FORMULA = "v = 2 · ḟ · L";
export const SLIDE_VELOCITY_FACTOR = 2;

export interface VelocityDerivation {
  ok: boolean;
  scanRate: Quantity | null;
  scanSize: Quantity | null;
  /** Derived velocity in m/s (canonical). */
  mps: number | null;
  /** Pretty velocity in the most readable unit, e.g. "4 µm/s". */
  velocityLabel: string | null;
  formula: string;
  steps: string | null;
}

/** Format a velocity given in m/s into the most readable sub-unit. */
export function formatVelocityMps(mps: number): { label: string; unit: string; value: number } {
  let value = mps;
  let unit = "m/s";
  if (mps !== 0 && Math.abs(mps) < 1e-6) {
    value = mps * 1e9;
    unit = "nm/s";
  } else if (Math.abs(mps) < 1e-3) {
    value = mps * 1e6;
    unit = "µm/s";
  } else if (Math.abs(mps) < 1) {
    value = mps * 1e3;
    unit = "mm/s";
  }
  return { label: `${fmtNum(value)} ${unit}`, unit, value };
}

/** The core rule: v = 2 · f · L, units carried for transparency. */
export function deriveSlideVelocity(
  scanRate?: string | null,
  scanSize?: string | null
): VelocityDerivation {
  const rate = parseQuantity(scanRate, "frequency"); // → Hz
  const size = parseQuantity(scanSize, "length"); // → m
  const base: VelocityDerivation = {
    ok: false,
    scanRate: rate,
    scanSize: size,
    mps: null,
    velocityLabel: null,
    formula: SLIDE_VELOCITY_FORMULA,
    steps: null,
  };
  if (!rate || rate.std == null || !size || size.std == null) return base;

  const mps = SLIDE_VELOCITY_FACTOR * rate.std * size.std;
  const v = formatVelocityMps(mps);
  return {
    ...base,
    ok: true,
    mps,
    velocityLabel: v.label,
    steps: `2 × ${rate.raw} × ${size.raw} = ${v.label}`,
  };
}

/**
 * Fill the sliding velocity (a middle-layer field) from the AFM scan params
 * when it wasn't directly reported. Idempotent — a previously derived velocity
 * is recomputed, a reported one is preserved.
 */
export function deriveExtendedVelocity(ext: ExtendedFields): ExtendedFields {
  const out: ExtendedFields = { ...ext };
  const reportedRaw = ext.velocitySource === "derived" ? undefined : ext.velocity?.raw;
  const d = deriveSlideVelocity(out.afm?.scanRate, out.afm?.scanSize);

  if (reportedRaw && reportedRaw.trim()) {
    const reported = parseQuantity(reportedRaw, "velocity") ?? ext.velocity;
    out.velocity = reported;
    out.velocitySource = "reported";

    const repairedRaw = reported ? afmMicronVelocityRepair(out, reported, d) : null;
    if (repairedRaw) {
      out.velocity = parseQuantity(repairedRaw, "velocity") ?? reported;
      out.velocitySource = "derived";
    }
  } else {
    if (d.ok && d.velocityLabel) {
      out.velocity = parseQuantity(d.velocityLabel, "velocity") ?? undefined;
      out.velocitySource = "derived";
    } else {
      out.velocitySource = out.velocity ? "reported" : undefined;
    }
  }
  return out;
}

function afmMicronVelocityRepair(ext: ExtendedFields, reported: Quantity, d: VelocityDerivation): string | null {
  if (reported.value == null || reported.std == null) return null;
  if (!/afm|ffm|nano/i.test(`${ext.method ?? ""} ${ext.scale ?? ""}`)) return null;

  if (reported.unit === "mm/s" && d.ok && d.mps != null) {
    const ratio = reported.std / d.mps;
    if (ratio > 900 && ratio < 1100 && d.velocityLabel) return d.velocityLabel;
  }

  if (reported.unit === "mm/s" && reported.value > 0 && reported.value <= 100) return `${reported.value} µm/s`;
  if (reported.unit === "m/s" && /[\u0000-\u001f]/.test(reported.raw) && reported.value > 0 && reported.value <= 100) {
    return `${reported.value} µm/s`;
  }
  return null;
}

/**
 * Consistency check for records that report BOTH a velocity and AFM scan
 * rate/size: does the rule reproduce the reported value? Null when N/A.
 */
export function velocityConsistency(ext: ExtendedFields): {
  reported: number;
  derived: number;
  ratio: number;
  agrees: boolean;
} | null {
  if (ext.velocitySource !== "reported" || ext.velocity?.std == null) return null;
  const d = deriveSlideVelocity(ext.afm?.scanRate, ext.afm?.scanSize);
  if (!d.ok || d.mps == null) return null;
  const ratio = d.mps / ext.velocity.std;
  return { reported: ext.velocity.std, derived: d.mps, ratio, agrees: ratio > 0.9 && ratio < 1.1 };
}

// Unit classifiers keeping a load (force) distinct from a potential (voltage).
const FORCE_UNIT_RE = /\d\s*(nN|µN|μN|uN|cN|mN|kN|N)\b/i;
const VOLTAGE_UNIT_RE = /\d\s*(mV|kV|µV|μV|uV|V)\b/i;

/**
 * True when a "load" string is really a voltage (an AFM bias / deflection
 * setpoint, e.g. "0–2 V") rather than a normal force — such values must never be
 * stored as the load.
 */
export function isVoltageLoad(load?: string | null): boolean {
  if (!load) return false;
  return VOLTAGE_UNIT_RE.test(load) && !FORCE_UNIT_RE.test(load);
}
