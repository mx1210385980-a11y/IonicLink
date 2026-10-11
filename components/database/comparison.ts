import type { AnalysisField, AnalysisRecord, EvidenceFilter } from "./analysisTypes";
import type { UnitMode } from "@/components/recordCardParts";
import { formatProvenance } from "@/lib/schema";

export type FieldEvidence = Exclude<EvidenceFilter, "all">;
export type ComparisonState = "same" | "different" | "missing";

export function getFieldEvidence(record: AnalysisRecord, field: AnalysisField): FieldEvidence {
  const basis = record.provenance?.[field.provenanceKey ?? field.key]?.basis;
  return basis === "direct" || basis === "inferred" || basis === "assumed" ? basis : "unassessed";
}

export function getRecordEvidence(record: AnalysisRecord, fields: AnalysisField[]): FieldEvidence {
  const metric = fields.find((field) => field.key === "metric");
  return metric ? getFieldEvidence(record, metric) : "unassessed";
}

const MISSING_TEXT = /^(?:unknown|not\s+(?:stated|reported|specified|available)|n\/?a|nr|—|-)$/i;

export function hasFieldValue(record: AnalysisRecord, field: AnalysisField): boolean {
  const value = field.getValue(record);
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "string") return Boolean(value.trim() && !MISSING_TEXT.test(value.trim()));
  const quantity = field.getQuantity?.(record);
  return Boolean(quantity?.raw?.trim() && !MISSING_TEXT.test(quantity.raw.trim()));
}

function numericKey(value: number | null | undefined): number | string | null {
  // Remove binary conversion noise without hiding scientifically relevant digits.
  return typeof value === "number" && Number.isFinite(value) ? value.toPrecision(12) : null;
}

function comparisonKey(record: AnalysisRecord, field: AnalysisField): string | null {
  if (!hasFieldValue(record, field)) return null;
  const value = field.getValue(record);
  const quantity = field.getQuantity?.(record);
  const canonical = typeof value === "number" ? numericKey(value) : value?.trim() ?? quantity?.raw.trim();
  const range = quantity?.range;
  const bounds = range
    ? range.stdMin != null && range.stdMax != null
      ? [numericKey(range.stdMin), numericKey(range.stdMax)]
      : [range.min, range.max, range.unit]
    : null;
  const qualifier = quantity?.approx
    ? quantity.raw.match(/(?:<=|>=|[<>≤≥~≈≃]|\b(?:at\s+least|at\s+most|less\s+than|more\s+than)\b)/i)?.[0].toLowerCase() ?? "approximate"
    : "exact";
  return JSON.stringify([canonical, bounds, qualifier, getFieldEvidence(record, field)]);
}

export function compareField(records: AnalysisRecord[], field: AnalysisField): {
  state: ComparisonState;
  missing: number;
  different: boolean;
} {
  const values = records.map((record) => comparisonKey(record, field));
  const missing = values.filter((value) => value == null).length;
  const different = new Set(values.filter((value) => value != null)).size > 1;
  return { state: missing ? "missing" : different ? "different" : "same", missing, different };
}

export function comparisonWarnings(records: AnalysisRecord[], fields: AnalysisField[]): string[] {
  if (records.length < 2) return [];
  const warnings: string[] = [];
  for (const key of ["method", "scale"]) {
    const field = fields.find((entry) => entry.key === key);
    if (!field) continue;
    const values = new Set(records.filter((record) => hasFieldValue(record, field)).map((record) => field.getValue(record)));
    if (values.size > 1) warnings.push(`Multiple ${key === "method" ? "measurement methods" : "measurement scales"}; interpret results within their experimental context.`);
    if (records.some((record) => !hasFieldValue(record, field))) warnings.push(`${field.label} is missing for some records.`);
  }
  const water = fields.find((field) => field.key === "waterContent");
  if (water && records.some((record) => !hasFieldValue(record, water))) {
    warnings.push("Water content is unknown for some records; missing values do not establish equivalent conditions.");
  }
  return warnings;
}

/** Quoting alone does not prevent spreadsheet formula evaluation. */
export function comparisonCsvCell(value: unknown): string {
  const text = value == null ? "" : String(value);
  const protectedText = /^[\s\uFEFF]*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text) ? `'${text}` : text;
  return `"${protectedText.replace(/"/g, '""')}"`;
}

export function buildComparisonCsv(records: AnalysisRecord[], fields: AnalysisField[], units: UnitMode): string {
  const rows: unknown[][] = [
    ["Field", "Comparison", ...records.map((record) => record.id)],
    ["Paper", "", ...records.map((record) => record.paper.title)],
    ["DOI", "", ...records.map((record) => record.paper.doi ?? "")],
    ["Year", "", ...records.map((record) => record.paper.year ?? "")],
    ["Source ID", "", ...records.map((record) => record.sourceId ?? "")],
    ["Display units", "", ...records.map(() => units === "std" ? "canonical" : "as reported")],
  ];
  for (const field of fields) {
    const comparison = compareField(records, field);
    rows.push([field.label, comparison.state, ...records.map((record) => field.format(record, units))]);
    rows.push([`${field.label} — evidence`, "", ...records.map((record) => getFieldEvidence(record, field))]);
    rows.push([`${field.label} — source`, "", ...records.map((record) => formatProvenance(record.provenance?.[field.provenanceKey ?? field.key]))]);
  }
  return "\uFEFF" + rows.map((row) => row.map(comparisonCsvCell).join(",")).join("\r\n");
}

export function buildQualitySummary(records: AnalysisRecord[], fields: AnalysisField[]) {
  const evidence: Record<FieldEvidence, number> = { direct: 0, inferred: 0, assumed: 0, unassessed: 0 };
  for (const record of records) evidence[getRecordEvidence(record, fields)] += 1;
  const availability = fields.filter((field) => field.provenanceKey && !["id", "paper", "year"].includes(field.key)).map((field) => {
    let available = 0;
    let located = 0;
    for (const record of records) {
      if (hasFieldValue(record, field)) available += 1;
      const provenance = record.provenance?.[field.provenanceKey!];
      if (provenance && (provenance.page || provenance.figure || provenance.table || provenance.section || provenance.quote)) located += 1;
    }
    return { field, available, located, total: records.length };
  });
  return { evidence, availability };
}
