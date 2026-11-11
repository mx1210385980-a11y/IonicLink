import { liveFields, type LiveDomain, type LiveRow } from "./liveFields";
import { scoreSimpleRows } from "./simpleScoring";
import type { SimpleRow } from "./simpleShared";
import { normalizeIonKey, standardizeIonFormula } from "../ionStructures";
import type { LiveAssessmentPolicy } from "./liveShared";

const normalized = (value: string) => value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
const nr = (value: string) => /^(nr|n\/?a|not reported)$/.test(normalized(value));

function measured(value: string, field: string): { value: number; unit: string } | null {
  const match = value.normalize("NFKC").replace(/−/g, "-").trim().match(/^([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)\s*(.+)$/i);
  if (!match || !Number.isFinite(Number(match[1]))) return null;
  let number = Number(match[1]);
  const unit = match[2].replace(/\s+/g, "").replace(/μ/g, "µ").replace(/\^/g, "");
  if (field === "temperature") {
    if (/^(°C|℃|C)$/i.test(unit)) return { value: number + 273.15, unit: "K" };
    if (unit === "K") return { value: number, unit: "K" };
  }
  // Deliberately do not conflate absolute, mass-normalized and area-normalized quantities.
  const units: Record<string, [number, string]> = {
    "S/m": [1, "S/m"], "mS/cm": [0.1, "S/m"], "S/cm": [100, "S/m"], "µS/cm": [0.0001, "S/m"],
    V: [1, "V"], mV: [1e-3, "V"], "V/s": [1, "V/s"], "mV/s": [1e-3, "V/s"],
    A: [1, "A"], mA: [1e-3, "A"], "µA": [1e-6, "A"], F: [1, "F"], mF: [1e-3, "F"], "µF": [1e-6, "F"],
    "Ω": [1, "ohm"], ohm: [1, "ohm"], "kΩ": [1000, "ohm"],
    N: [1, "N"], mN: [1e-3, "N"], "µN": [1e-6, "N"], nN: [1e-9, "N"], pN: [1e-12, "N"],
    m: [1, "m"], mm: [1e-3, "m"], "µm": [1e-6, "m"], nm: [1e-9, "m"],
    "N/m": [1, "N/m"], "nN/nm": [1, "N/m"],
    "A/m2": [1, "A/m2"], "A/cm2": [1e4, "A/m2"], "mA/cm2": [10, "A/m2"], "µA/cm2": [0.01, "A/m2"],
    "F/m2": [1, "F/m2"], "F/cm2": [1e4, "F/m2"], "mF/cm2": [10, "F/m2"], "µF/cm2": [0.01, "F/m2"],
    "Ωm2": [1, "ohm m2"], "Ωcm2": [1e-4, "ohm m2"], "ohmcm2": [1e-4, "ohm m2"],
  };
  if (units[unit]) { number *= units[unit][0]; return { value: number, unit: units[unit][1] }; }
  return { value: number, unit }; // Unknown units only match exactly, including case.
}

export function liveCellMatches(field: string, expected: string, actual: string, policy?: LiveAssessmentPolicy): boolean {
  if (!expected.trim() || !actual.trim()) return false;
  if (nr(expected) || nr(actual)) return nr(expected) && nr(actual);
  if (field === "cation" || field === "anion") {
    const canonical = (value: string) => standardizeIonFormula(field === "anion" && normalizeIonKey(value) === "tfsa" ? "TFSI" : value, field);
    return normalizeIonKey(canonical(expected)) === normalizeIonKey(canonical(actual));
  }
  if (field === "trend") {
    const direction = (s: string) => ({ increase: "increases", increasing: "increases", decrease: "decreases", decreasing: "decreases", "non monotonic": "non-monotonic" }[normalized(s)] || normalized(s));
    return direction(expected) === direction(actual);
  }
  if (["value", "separation", "potential", "scanRate", "temperature", "concentration", "tipRadius", "springConstant", "variableValue"].includes(field)) {
    const a = measured(expected, field), b = measured(actual, field);
    if (a && b) {
      const tolerant = field === "value" || field === "separation";
      const relative = tolerant ? (policy?.relativeTolerancePercent ?? 0) / 100 : 0;
      const absolute = tolerant && policy?.absoluteTolerance ? measured(policy.absoluteTolerance, field) : null;
      // Scale-independent floating precision: never use a fixed 1e-12 floor for forces in N.
      const epsilon = Math.max(Number.MIN_VALUE, Math.abs(a.value) * 1e-6);
      return a.unit === b.unit && Math.abs(a.value - b.value) <= Math.max(epsilon, Math.abs(a.value) * relative, absolute?.unit === a.unit ? Math.abs(absolute.value) : 0);
    }
    return expected.normalize("NFKC").trim() === actual.normalize("NFKC").trim();
  }
  return normalized(expected) === normalized(actual);
}

// Maximum-weight bipartite assignment. Row order never changes a student's score.
function assign(weights: number[][], fields: number): number[] {
  const n = weights.length, u = Array(n + 1).fill(0), v = [...u], p = [...u], way = [...u];
  for (let i = 1; i <= n; i++) {
    p[0] = i; let j0 = 0;
    const min = Array(n + 1).fill(Infinity), used = Array(n + 1).fill(false);
    do {
      used[j0] = true; const i0 = p[j0]; let delta = Infinity, j1 = 0;
      for (let j = 1; j <= n; j++) if (!used[j]) {
        const cost = fields - weights[i0 - 1][j - 1] - u[i0] - v[j];
        if (cost < min[j]) { min[j] = cost; way[j] = j0; }
        if (min[j] < delta) { delta = min[j]; j1 = j; }
      }
      for (let j = 0; j <= n; j++) { if (used[j]) { u[p[j]] += delta; v[j] -= delta; } else min[j] -= delta; }
      j0 = j1;
    } while (p[j0] !== 0);
    do { const j1 = way[j0]; p[j0] = p[j1]; j0 = j1; } while (j0 !== 0);
  }
  const pairs = Array(n).fill(0);
  for (let j = 1; j <= n; j++) pairs[p[j] - 1] = j - 1;
  return pairs;
}

export function compareLiveRows(gold: LiveRow[], rows: LiveRow[], domain: LiveDomain, policy?: LiveAssessmentPolicy) {
  if (domain === "tribology") return scoreSimpleRows(gold as SimpleRow[], rows as SimpleRow[]);
  const fields = liveFields(domain), n = Math.max(gold.length, rows.length);
  const weights = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => gold[i] && rows[j]
    ? fields.filter(({ key }) => liveCellMatches(key, gold[i][key] ?? "", rows[j][key] ?? "", policy)).length : 0));
  const cells = assign(weights, fields.length).flatMap((answerRow, goldRow) => fields.map(({ key: field }) => {
    const expected = gold[goldRow]?.[field] ?? "", actual = rows[answerRow]?.[field] ?? "";
    return { key: `${goldRow}:${answerRow}:${field}`, goldRow: gold[goldRow] ? goldRow : null, answerRow: rows[answerRow] ? answerRow : null,
      field, expected, actual, machineCorrect: Boolean(gold[goldRow] && rows[answerRow] && liveCellMatches(field, expected, actual, policy)) };
  }));
  const denominator = n * fields.length;
  return { cells, denominator, machineAccuracy: denominator ? cells.filter((cell) => cell.machineCorrect).length / denominator : 0 };
}
