import Database from "better-sqlite3";
import { existsSync } from "node:fs";
import path from "node:path";
import type { FieldProvenance, ProvenanceMap } from "../schema";
import type { Quantity } from "../units";
import {
  TEACHING_FIELDS,
  type TeachingAnswers,
  type TeachingEvidenceRule,
  type TeachingFieldKey,
  type TeachingGoldRule,
  type TeachingValueRule,
} from "../teachingShared";
import { teachingDataDir } from "./store";

/**
 * Group-crossover gold generation.
 *
 * The teacher picks papers from the checked tribology database
 * (`records WHERE status = 'official'`). Each picked record is ONE condition
 * point and becomes one group's paper. Its checked values become the frozen
 * gold standard and AI snapshot for the experiment — no runtime LLM calls.
 *
 * Caveat: evidence rules are derived from the record's provenance (page +
 * quote tokens) and are therefore approximate. Value scoring is exact;
 * evidence scoring is advisory and teachers can override per-field scores.
 */

export type CheckedTribologyRecord = {
  id: string;
  paper?: { title?: string; doi?: string; journal?: string };
  core?: {
    ionicLiquid?: { cation?: string; anion?: string };
    substrate?: string;
    temperature?: Quantity | null;
    load?: Quantity | null;
    cof?: number | null;
  };
  provenance?: ProvenanceMap;
  extraction?: { model?: string };
  createdAt?: string;
};

export type CheckedRecordOption = {
  recordId: string;
  title: string;
  doi: string;
  journal: string;
  cation: string;
  anion: string;
  substrate: string;
  temperatureRaw: string;
  loadRaw: string;
  cof: number;
};

function clean(value: unknown, max = 240): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function tribologyDbPath(): string {
  return path.join(teachingDataDir(), "tribology.db");
}

const NOT_REPORTED_PATTERN = /not stated|not reported|not given|unreported|未提及|未报告/iu;
const NOT_REPORTED_ALIASES = ["not stated", "not reported", "not given", "未提及", "未报告"];

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNotReportedQuantity(quantity: Quantity | null | undefined, prov?: FieldProvenance): boolean {
  if (prov?.basis === "assumed") return true;
  const raw = clean(quantity?.raw, 200);
  return Boolean(raw) && NOT_REPORTED_PATTERN.test(raw) && !/\d/u.test(raw);
}

/** A record is usable as a group paper when all six teaching fields can produce a gold rule. */
export function checkedRecordUsability(record: CheckedTribologyRecord): {
  usable: boolean;
  missing: string[];
} {
  const missing: string[] = [];
  const core = record.core;
  if (!clean(core?.ionicLiquid?.cation, 120)) missing.push("cation");
  if (!clean(core?.ionicLiquid?.anion, 120)) missing.push("anion");
  if (!clean(core?.substrate, 160)) missing.push("substrate");
  const temperatureOk =
    isNotReportedQuantity(core?.temperature, record.provenance?.temperature) ||
    isFiniteNumber(core?.temperature?.std);
  if (!temperatureOk) missing.push("temperature");
  const loadOk = isFiniteNumber(core?.load?.std) || Boolean(clean(core?.load?.raw, 120));
  if (!loadOk) missing.push("load");
  if (!isFiniteNumber(core?.cof)) missing.push("cof");
  return { usable: missing.length === 0, missing };
}

export function loadCheckedRecord(recordId: string): CheckedTribologyRecord {
  const id = clean(recordId, 80);
  if (!id) throw new Error("缺少记录编号。");
  const sourcePath = tribologyDbPath();
  if (!existsSync(sourcePath)) throw new Error("正式摩擦数据库尚不存在。");
  const source = new Database(sourcePath, { readonly: true, fileMustExist: true });
  try {
    const row = source
      .prepare("SELECT payload FROM records WHERE id = ? AND status = 'official'")
      .get(id) as { payload: string } | undefined;
    const record = row ? parseJson<CheckedTribologyRecord | null>(row.payload, null) : null;
    if (!record) throw new Error("没有找到这条已审核记录,请重新选择。");
    return { ...record, id };
  } finally {
    source.close();
  }
}

/**
 * Pool options for the teacher's paper picker. NOT deduplicated by paper —
 * each record is one condition point and the UI must say so. Only usable
 * records (all six teaching fields present) are returned.
 */
export function listCheckedTribologyRecords(limit = 500): CheckedRecordOption[] {
  const sourcePath = tribologyDbPath();
  if (!existsSync(sourcePath)) return [];
  const source = new Database(sourcePath, { readonly: true, fileMustExist: true });
  try {
    const rows = source
      .prepare(
        "SELECT id, payload FROM records WHERE status = 'official' ORDER BY created_at DESC, id DESC LIMIT ?"
      )
      .all(Math.max(1, Math.min(limit, 2000))) as { id: string; payload: string }[];
    return rows.flatMap((row) => {
      const record = parseJson<CheckedTribologyRecord | null>(row.payload, null);
      if (!record || !checkedRecordUsability(record).usable) return [];
      return [
        {
          recordId: row.id,
          title: clean(record.paper?.title, 300) || row.id,
          doi: clean(record.paper?.doi, 160),
          journal: clean(record.paper?.journal, 200),
          cation: clean(record.core?.ionicLiquid?.cation, 120),
          anion: clean(record.core?.ionicLiquid?.anion, 120),
          substrate: clean(record.core?.substrate, 160),
          temperatureRaw: clean(record.core?.temperature?.raw, 120),
          loadRaw: clean(record.core?.load?.raw, 120),
          cof: record.core!.cof as number,
        },
      ];
    });
  } finally {
    source.close();
  }
}

function uniqueAliases(values: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const alias = clean(value, 200);
    if (!alias || seen.has(alias)) continue;
    seen.add(alias);
    out.push(alias);
  }
  return out;
}

function quantityRaw(quantity: Quantity | null | undefined): string {
  const raw = clean(quantity?.raw, 120);
  if (raw) return raw;
  if (isFiniteNumber(quantity?.value)) {
    return `${quantity.value}${quantity.unit ? ` ${quantity.unit}` : ""}`;
  }
  return "";
}

/** Split a provenance quote into up to two keyword sets of ≤3 tokens each. */
function keywordSetsFromQuote(quote: string | undefined): string[][] {
  const tokens = clean(quote, 500)
    .split(/[^A-Za-z0-9一-鿿]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length >= 4)
    .slice(0, 6);
  const sets: string[][] = [];
  if (tokens.length > 0) sets.push(tokens.slice(0, 3));
  if (tokens.length > 3) sets.push(tokens.slice(3, 6));
  return sets;
}

function evidenceRule(prov: FieldProvenance | undefined, notReported: boolean): TeachingEvidenceRule {
  const pages = typeof prov?.page === "number" && Number.isInteger(prov.page) ? [prov.page] : [];
  return {
    pages,
    anyKeywordSets: keywordSetsFromQuote(prov?.quote),
    ...(notReported ? { notReported: true } : {}),
  };
}

function textValueRule(expected: string): TeachingValueRule {
  return { kind: "text", expected, aliases: [expected] };
}

function temperatureValueRule(record: CheckedTribologyRecord): TeachingValueRule {
  const quantity = record.core?.temperature;
  const prov = record.provenance?.temperature;
  if (isNotReportedQuantity(quantity, prov)) {
    return { kind: "not_reported", aliases: [...NOT_REPORTED_ALIASES] };
  }
  const kelvin = quantity?.std;
  if (!isFiniteNumber(kelvin)) {
    // Usability gates this path, but keep a deterministic fallback.
    return textValueRule(quantityRaw(quantity));
  }
  return {
    kind: "temperature",
    kelvin,
    toleranceKelvin: 2,
    aliases: uniqueAliases([quantityRaw(quantity)]),
  };
}

function loadValueRule(record: CheckedTribologyRecord): TeachingValueRule {
  const quantity = record.core?.load;
  const std = quantity?.std;
  if (!isFiniteNumber(std)) {
    return textValueRule(quantityRaw(quantity));
  }
  return {
    kind: "number",
    expected: std,
    tolerance: Math.max(1e-12, Math.abs(std) * 0.05),
    aliases: uniqueAliases([quantityRaw(quantity), `${std} N`]),
  };
}

function cofValueRule(record: CheckedTribologyRecord): TeachingValueRule {
  const cof = record.core?.cof;
  if (!isFiniteNumber(cof)) return textValueRule("");
  return {
    kind: "number",
    expected: cof,
    tolerance: Math.max(0.005, Math.abs(cof) * 0.1),
    aliases: [String(cof)],
  };
}

export function buildGoldRules(record: CheckedTribologyRecord): Record<TeachingFieldKey, TeachingGoldRule> {
  const provenance = record.provenance ?? {};
  const temperatureNotReported = isNotReportedQuantity(record.core?.temperature, provenance.temperature);
  const valueRules: Record<TeachingFieldKey, TeachingValueRule> = {
    cation: textValueRule(clean(record.core?.ionicLiquid?.cation, 120)),
    anion: textValueRule(clean(record.core?.ionicLiquid?.anion, 120)),
    substrate: textValueRule(clean(record.core?.substrate, 160)),
    temperature: temperatureValueRule(record),
    load: loadValueRule(record),
    cof: cofValueRule(record),
  };
  return Object.fromEntries(
    TEACHING_FIELDS.map((field) => [
      field.key,
      {
        value: valueRules[field.key],
        evidence: evidenceRule(provenance[field.key], field.key === "temperature" && temperatureNotReported),
      },
    ])
  ) as Record<TeachingFieldKey, TeachingGoldRule>;
}

/** Frozen AI-assisted starting answers derived from the checked record. */
export function buildAiSnapshot(record: CheckedTribologyRecord): TeachingAnswers {
  const provenance = record.provenance ?? {};
  const values: Record<TeachingFieldKey, string> = {
    cation: clean(record.core?.ionicLiquid?.cation, 120),
    anion: clean(record.core?.ionicLiquid?.anion, 120),
    substrate: clean(record.core?.substrate, 160),
    temperature: quantityRaw(record.core?.temperature),
    load: quantityRaw(record.core?.load),
    cof: isFiniteNumber(record.core?.cof) ? String(record.core.cof) : "",
  };
  const snapshot: TeachingAnswers = {};
  for (const field of TEACHING_FIELDS) {
    const prov: FieldProvenance | undefined = provenance[field.key];
    snapshot[field.key] = {
      value: values[field.key],
      ...(typeof prov?.page === "number" && Number.isInteger(prov.page)
        ? { page: String(prov.page) }
        : {}),
      ...(clean(prov?.quote, 2000) ? { evidence: clean(prov?.quote, 2000) } : {}),
    };
  }
  return snapshot;
}

/** Flat string snapshot used by legacy teaching dashboards and CSV exports. */
export function buildFlatSnapshot(record: CheckedTribologyRecord): Record<string, string> {
  return {
    cation: clean(record.core?.ionicLiquid?.cation, 120),
    anion: clean(record.core?.ionicLiquid?.anion, 120),
    substrate: clean(record.core?.substrate, 160),
    temperature: quantityRaw(record.core?.temperature),
    load: quantityRaw(record.core?.load),
    cof: isFiniteNumber(record.core?.cof) ? String(record.core.cof) : "",
  };
}
