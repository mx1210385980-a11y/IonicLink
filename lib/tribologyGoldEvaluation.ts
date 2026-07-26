import { ingest } from "./ingest";
import type { ExtractedFields, RecordDraft } from "./schema";

export const TRIBOLOGY_GOLD_FIELDS = [
  "paperTitle",
  "paperDoi",
  "cation",
  "anion",
  "substrate",
  "temperature",
  "load",
  "cof",
  "scale",
  "method",
  "probe",
  "probeType",
  "velocity",
  "potential",
  "roughness",
  "filmThickness",
  "waterContent",
  "concentration",
  "additives",
] as const;

export type TribologyGoldField = (typeof TRIBOLOGY_GOLD_FIELDS)[number];

export interface GoldAnnotationDocument {
  id: string;
  title: string;
  doi?: string;
  text: string;
  goldRecords: ExtractedFields[];
  notes?: string;
}

export interface FieldComparison {
  documentId: string;
  field: TribologyGoldField;
  goldRecordIndex?: number;
  predictedRecordIndex?: number;
  expected: string | null;
  actual: string | null;
  outcome: "tp" | "fp" | "fn" | "mismatch" | "tn";
}

export interface FieldMetric {
  field: TribologyGoldField | "micro" | "macro";
  truePositive: number;
  falsePositive: number;
  falseNegative: number;
  precision: number;
  recall: number;
  f1: number;
}

export interface GoldEvaluationReport {
  domain: "tribology";
  fields: TribologyGoldField[];
  documents: number;
  goldRecords: number;
  predictedRecords: number;
  comparisons: FieldComparison[];
  recordMatches: {
    documentId: string;
    goldRecordIndex: number;
    predictedRecordIndex: number;
    score: number;
  }[];
  unmatchedGoldRecords: { documentId: string; goldRecordIndex: number }[];
  unmatchedPredictedRecords: { documentId: string; predictedRecordIndex: number }[];
}

export interface GoldEvaluationMetrics {
  byField: Record<TribologyGoldField, FieldMetric>;
  micro: FieldMetric;
  macro: FieldMetric;
}

interface RecordMatch {
  goldIndex: number;
  predictedIndex: number;
  score: number;
}

export function buildGoldEvaluationReport(
  documents: GoldAnnotationDocument[],
  predictionsByDocument: Record<string, ExtractedFields[]>
): GoldEvaluationReport {
  const comparisons: FieldComparison[] = [];
  const recordMatches: GoldEvaluationReport["recordMatches"] = [];
  const unmatchedGoldRecords: GoldEvaluationReport["unmatchedGoldRecords"] = [];
  const unmatchedPredictedRecords: GoldEvaluationReport["unmatchedPredictedRecords"] = [];

  for (const document of documents) {
    const gold = document.goldRecords;
    const predictions = predictionsByDocument[document.id] ?? [];
    const matches = matchRecords(gold, predictions);
    const matchedGold = new Set(matches.map((match) => match.goldIndex));
    const matchedPredictions = new Set(matches.map((match) => match.predictedIndex));

    for (const match of matches) {
      recordMatches.push({
        documentId: document.id,
        goldRecordIndex: match.goldIndex,
        predictedRecordIndex: match.predictedIndex,
        score: match.score,
      });
      comparisons.push(
        ...compareRecordFields({
          documentId: document.id,
          goldRecordIndex: match.goldIndex,
          predictedRecordIndex: match.predictedIndex,
          gold: gold[match.goldIndex],
          predicted: predictions[match.predictedIndex],
        })
      );
    }

    gold.forEach((record, goldRecordIndex) => {
      if (matchedGold.has(goldRecordIndex)) return;
      unmatchedGoldRecords.push({ documentId: document.id, goldRecordIndex });
      comparisons.push(
        ...compareRecordFields({
          documentId: document.id,
          goldRecordIndex,
          gold: record,
          predicted: null,
        })
      );
    });

    predictions.forEach((record, predictedRecordIndex) => {
      if (matchedPredictions.has(predictedRecordIndex)) return;
      unmatchedPredictedRecords.push({ documentId: document.id, predictedRecordIndex });
      comparisons.push(
        ...compareRecordFields({
          documentId: document.id,
          predictedRecordIndex,
          gold: null,
          predicted: record,
        })
      );
    });
  }

  return {
    domain: "tribology",
    fields: [...TRIBOLOGY_GOLD_FIELDS],
    documents: documents.length,
    goldRecords: documents.reduce((count, document) => count + document.goldRecords.length, 0),
    predictedRecords: Object.values(predictionsByDocument).reduce((count, records) => count + records.length, 0),
    comparisons,
    recordMatches,
    unmatchedGoldRecords,
    unmatchedPredictedRecords,
  };
}

export function buildFieldMetrics(report: GoldEvaluationReport): GoldEvaluationMetrics {
  const byField = Object.fromEntries(
    TRIBOLOGY_GOLD_FIELDS.map((field) => [field, tallyMetric(field, report.comparisons)])
  ) as Record<TribologyGoldField, FieldMetric>;
  const fieldMetrics = Object.values(byField);
  const microCounts = fieldMetrics.reduce(
    (acc, metric) => ({
      tp: acc.tp + metric.truePositive,
      fp: acc.fp + metric.falsePositive,
      fn: acc.fn + metric.falseNegative,
    }),
    { tp: 0, fp: 0, fn: 0 }
  );
  const micro = metricFromCounts("micro", microCounts.tp, microCounts.fp, microCounts.fn);
  const macro = metricFromCounts(
    "macro",
    mean(fieldMetrics.map((metric) => metric.truePositive)),
    mean(fieldMetrics.map((metric) => metric.falsePositive)),
    mean(fieldMetrics.map((metric) => metric.falseNegative))
  );
  macro.precision = mean(fieldMetrics.map((metric) => metric.precision));
  macro.recall = mean(fieldMetrics.map((metric) => metric.recall));
  macro.f1 = mean(fieldMetrics.map((metric) => metric.f1));
  return { byField, micro, macro };
}

function matchRecords(gold: ExtractedFields[], predictions: ExtractedFields[]): RecordMatch[] {
  const candidates: RecordMatch[] = [];
  gold.forEach((goldRecord, goldIndex) => {
    predictions.forEach((predictedRecord, predictedIndex) => {
      candidates.push({ goldIndex, predictedIndex, score: recordSimilarity(goldRecord, predictedRecord) });
    });
  });

  candidates.sort((a, b) => b.score - a.score || a.goldIndex - b.goldIndex || a.predictedIndex - b.predictedIndex);
  const usedGold = new Set<number>();
  const usedPredictions = new Set<number>();
  const matches: RecordMatch[] = [];
  for (const candidate of candidates) {
    if (candidate.score <= 0 || usedGold.has(candidate.goldIndex) || usedPredictions.has(candidate.predictedIndex)) {
      continue;
    }
    usedGold.add(candidate.goldIndex);
    usedPredictions.add(candidate.predictedIndex);
    matches.push(candidate);
  }
  return matches.sort((a, b) => a.goldIndex - b.goldIndex);
}

function recordSimilarity(gold: ExtractedFields, predicted: ExtractedFields): number {
  const identityFields: TribologyGoldField[] = [
    "paperDoi",
    "cation",
    "anion",
    "substrate",
    "temperature",
    "load",
    "cof",
    "potential",
    "velocity",
  ];
  let score = 0;
  for (const field of identityFields) {
    const expected = normalizedFieldValue(gold, field);
    const actual = normalizedFieldValue(predicted, field);
    if (expected != null && actual != null && expected === actual) score += field === "cof" ? 2 : 1;
  }
  return score;
}

function compareRecordFields(opts: {
  documentId: string;
  goldRecordIndex?: number;
  predictedRecordIndex?: number;
  gold: ExtractedFields | null;
  predicted: ExtractedFields | null;
}): FieldComparison[] {
  return TRIBOLOGY_GOLD_FIELDS.map((field) => {
    const expected = opts.gold ? normalizedFieldValue(opts.gold, field) : null;
    const actual = opts.predicted ? normalizedFieldValue(opts.predicted, field) : null;
    return {
      documentId: opts.documentId,
      goldRecordIndex: opts.goldRecordIndex,
      predictedRecordIndex: opts.predictedRecordIndex,
      field,
      expected,
      actual,
      outcome: compareValues(expected, actual),
    };
  });
}

function compareValues(expected: string | null, actual: string | null): FieldComparison["outcome"] {
  if (expected == null && actual == null) return "tn";
  if (expected != null && actual != null && expected === actual) return "tp";
  if (expected != null && actual != null) return "mismatch";
  if (expected == null) return "fp";
  return "fn";
}

function normalizedFieldValue(fields: ExtractedFields, field: TribologyGoldField): string | null {
  const record = safeIngest(fields);
  switch (field) {
    case "paperTitle":
      return normalizeText(fields.paper.title);
    case "paperDoi":
      return normalizeText(fields.paper.doi);
    case "cation":
      return normalizeIon(record.core.ionicLiquid.cation);
    case "anion":
      return normalizeIon(record.core.ionicLiquid.anion);
    case "substrate":
      return normalizeText(record.core.substrate);
    case "temperature":
      if (!hasRaw(fields.temperature)) return null;
      return normalizeNumber(record.core.temperature?.std, 0.01);
    case "load":
      if (!hasRaw(fields.load)) return null;
      return normalizeNumber(record.core.load?.std, 1e-12);
    case "cof":
      return normalizeNumber(record.core.cof, 0.001);
    case "scale":
      return normalizeText(record.extended.scale);
    case "method":
      return normalizeText(record.extended.method);
    case "probe":
      return normalizeText(record.extended.probe);
    case "probeType":
      return normalizeText(record.extended.probeType);
    case "velocity":
      if (!hasRaw(fields.velocity)) return null;
      return normalizeNumber(record.extended.velocity?.std, 1e-9);
    case "potential":
      if (!hasRaw(fields.potential)) return null;
      return normalizeNumber(record.extended.potential?.std, 0.001);
    case "roughness":
      if (!hasRaw(fields.roughness)) return null;
      return normalizeNumber(record.extended.roughness?.std, 1e-12);
    case "filmThickness":
      if (!hasRaw(fields.filmThickness)) return null;
      if (record.extended.filmLayers != null) return `layers:${record.extended.filmLayers}`;
      return normalizeNumber(record.extended.filmThickness?.std, 1e-12);
    case "waterContent":
      return normalizeText(record.extended.waterContent);
    case "concentration":
      return normalizeText(record.extended.concentration);
    case "additives":
      return normalizeText(record.extended.additives);
  }
}

function safeIngest(fields: ExtractedFields): RecordDraft {
  return ingest(fields);
}

function tallyMetric(field: TribologyGoldField, comparisons: FieldComparison[]): FieldMetric {
  const subset = comparisons.filter((comparison) => comparison.field === field);
  const tp = subset.filter((comparison) => comparison.outcome === "tp").length;
  const fp = subset.filter((comparison) => comparison.outcome === "fp" || comparison.outcome === "mismatch").length;
  const fn = subset.filter((comparison) => comparison.outcome === "fn" || comparison.outcome === "mismatch").length;
  return metricFromCounts(field, tp, fp, fn);
}

function metricFromCounts(field: FieldMetric["field"], tp: number, fp: number, fn: number): FieldMetric {
  const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 0 : tp / (tp + fn);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return {
    field,
    truePositive: tp,
    falsePositive: fp,
    falseNegative: fn,
    precision,
    recall,
    f1,
  };
}

function mean(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function normalizeText(value: string | null | undefined): string | null {
  const text = String(value ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  return text || null;
}

function normalizeIon(value: string | null | undefined): string | null {
  const text = normalizeText(value)?.replace(/[\[\]{}()+\-_,\s]/g, "").replace(/[^a-z0-9]/g, "");
  return text || null;
}

function normalizeNumber(value: number | null | undefined, tolerance: number): string | null {
  if (value == null || !Number.isFinite(value)) return null;
  return String(Math.round(value / tolerance));
}

function hasRaw(value: string | null | undefined): boolean {
  return Boolean(value?.trim());
}
