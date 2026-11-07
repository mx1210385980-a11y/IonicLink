import { TEACHING_FIELDS, type TeachingFieldKey } from "../teachingShared";
import type { SimpleScore } from "./simpleShared";

type FieldSpec<Key extends string> = { key: Key };

export function validateSimpleRows<FieldKey extends string = TeachingFieldKey>(
  value: unknown,
  fields: readonly FieldSpec<FieldKey>[] = TEACHING_FIELDS as unknown as readonly FieldSpec<FieldKey>[],
): Array<Record<FieldKey, string>> {
  if (!Array.isArray(value) || !value.length || value.length > 100) throw new Error("Provide 1–100 extracted records");
  return value.map(row => {
    if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error("Invalid table row format");
    return Object.fromEntries(fields.map(({ key }) => {
      const cell = (row as Record<string, unknown>)[key] ?? "";
      if (typeof cell !== "string" || cell.length > 2000) throw new Error("Fields must be text of at most 2,000 characters");
      return [key, cell.trim()];
    })) as Record<FieldKey, string>;
  });
}

function text(value: string) { return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase(); }
function nr(value: string) { return /^(\/|nr|n\/?a|not reported|未报告|未报道|未提供|未提及)$/.test(value); }
function numeric(field: string, value: string): number | null {
  const match = value.normalize("NFKC").trim().match(/^([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)\s*([^\d]*)$/i);
  if (!match) return null;
  const n = Number(match[1]), unit = match[2].trim();
  if (!Number.isFinite(n)) return null;
  if (field === "cof") return unit === "" ? n : null;
  if (field === "temperature") {
    if (["", "°C", "C", "℃", "c", "°c"].includes(unit)) return n;
    if (["K", "k"].includes(unit)) return n - 273.15;
  }
  if (field === "load") {
    const scales: Record<string, number> = { "": 1, N: 1, mN: 1e-3, "µN": 1e-6, "μN": 1e-6, uN: 1e-6, nN: 1e-9, kN: 1e3 };
    if (Object.hasOwn(scales, unit)) return n * scales[unit];
  }
  return null;
}

export function simpleCellMatches(field: string, expected: string, actual: string): boolean {
  const left = text(expected), right = text(actual);
  if (!left || !right) return false;
  if (nr(left) || nr(right)) return nr(left) && nr(right);
  const a = numeric(field, expected), b = numeric(field, actual);
  if (a !== null && b !== null) return Math.abs(a - b) <= Math.max(1e-12, Math.abs(a) * 1e-6);
  // Unit case carries meaning (mN versus MN), so numeric-field fallback stays case-sensitive.
  return ["temperature", "load", "cof"].includes(field)
    ? expected.normalize("NFKC").trim() === actual.normalize("NFKC").trim() : left === right;
}

// Hungarian assignment maximizes matching fields across rows, including duplicates.
function assign(weights: number[][], fieldCount: number): number[] {
  const n = weights.length, u = Array(n + 1).fill(0), v = [...u], p = [...u], way = [...u];
  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const min = Array(n + 1).fill(Infinity), used = Array(n + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0];
      let delta = Infinity, j1 = 0;
      for (let j = 1; j <= n; j++) if (!used[j]) {
        const cost = fieldCount - weights[i0 - 1][j - 1] - u[i0] - v[j];
        if (cost < min[j]) { min[j] = cost; way[j] = j0; }
        if (min[j] < delta) { delta = min[j]; j1 = j; }
      }
      for (let j = 0; j <= n; j++) { if (used[j]) { u[p[j]] += delta; v[j] -= delta; } else min[j] -= delta; }
      j0 = j1;
    } while (p[j0] !== 0);
    do { const j1 = way[j0]; p[j0] = p[j1]; j0 = j1; } while (j0 !== 0);
  }
  const result = Array(n).fill(0);
  for (let j = 1; j <= n; j++) result[p[j] - 1] = j - 1;
  return result;
}

export function scoreSimpleRows<FieldKey extends string = TeachingFieldKey>(
  gold: Array<Record<FieldKey, string>>,
  answers: Array<Record<FieldKey, string>>,
  overrides: Record<string, boolean> = {},
  fields: readonly FieldSpec<FieldKey>[] = TEACHING_FIELDS as unknown as readonly FieldSpec<FieldKey>[],
): SimpleScore<FieldKey> {
  const n = Math.max(gold.length, answers.length);
  const weights = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) =>
    gold[i] && answers[j] ? fields.filter(({ key }) => simpleCellMatches(key, gold[i][key], answers[j][key])).length : 0));
  const pairs = assign(weights, fields.length);
  const cells = pairs.flatMap((answerRow, goldRow) => fields.map(({ key: field }) => {
    const expected = gold[goldRow]?.[field] ?? "", actual = answers[answerRow]?.[field] ?? "";
    const key = `${goldRow}:${answerRow}:${field}`;
    const machineCorrect = Boolean(gold[goldRow] && answers[answerRow] && simpleCellMatches(field, expected, actual));
    return { key, goldRow: gold[goldRow] ? goldRow : null, answerRow: answers[answerRow] ? answerRow : null,
      field, expected, actual, machineCorrect, correct: overrides[key] ?? machineCorrect };
  }));
  const machineCorrect = cells.filter(cell => cell.machineCorrect).length, correct = cells.filter(cell => cell.correct).length;
  const denominator = n * fields.length;
  return { version: "field-overlap-v1", denominator, machineCorrect, correct,
    machineAccuracy: denominator ? machineCorrect / denominator : 0, accuracy: denominator ? correct / denominator : 0, cells };
}
