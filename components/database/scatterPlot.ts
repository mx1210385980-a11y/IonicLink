import type { AnalysisField, AnalysisRecord, PlotConfig } from "./analysisTypes";

export type ScatterPoint = { record: AnalysisRecord; x: number; y: number; group: string };
export type ExclusionReason = "Missing or non-numeric" | "Range or inequality" | "Approximate or uncertain" | "Assumed value" | "Non-positive on log axis";
export type AxisDomain = [number, number];
export const MAX_PLOT_POINTS = 3000;

export function scatterGroup(record: AnalysisRecord, groupBy: PlotConfig["groupBy"]): string {
  if (groupBy === "paper") return record.paper?.title?.trim() || record.paper?.doi || "Unknown paper";
  if (groupBy === "cation") return record.core?.ionicLiquid?.cation?.trim() || "Unknown cation";
  const method = String(record.extended?.method || record.core?.method || "Unknown method").trim();
  const scale = record.extended?.scale;
  return `${method.toUpperCase()}${scale ? ` · ${scale}` : ""}`;
}

export function pointValue(record: AnalysisRecord, field: AnalysisField, logarithmic: boolean): { value: number; reason?: never } | { value?: never; reason: ExclusionReason } {
  const quantity = field.getQuantity?.(record);
  const basis = record.provenance?.[field.provenanceKey || field.key]?.basis;
  if (basis === "assumed" || (field.key === "temperature" && quantity && /not\s+(?:stated|reported)|room\s+temp|ambient|assum/i.test(quantity.raw))) {
    return { reason: "Assumed value" };
  }
  // A stored upper bound is not a measured point. Raw checks also cover legacy quantities.
  const raw = quantity?.raw || "";
  if (quantity?.range || /[<>≤≥]|\d\s*[–—]\s*[-+]?\d|\d\s+to\s+[-+]?\d|\d\s*-\s*\d/i.test(raw)) {
    return { reason: "Range or inequality" };
  }
  if (quantity?.approx || /[~≈±]|\+\/-|\b(?:about|approx(?:imately)?|circa)\b/i.test(raw)) {
    return { reason: "Approximate or uncertain" };
  }
  const value = field.getValue(record);
  if (typeof value !== "number" || !Number.isFinite(value)) return { reason: "Missing or non-numeric" };
  if (logarithmic && value <= 0) return { reason: "Non-positive on log axis" };
  return { value };
}

export function buildScatterPoints(records: AnalysisRecord[], x: AnalysisField, y: AnalysisField, config: PlotConfig) {
  const points: ScatterPoint[] = [];
  const excluded: Partial<Record<ExclusionReason, number>> = {};
  let excludedCount = 0;
  for (const record of records) {
    const xv = pointValue(record, x, config.logX);
    const yv = pointValue(record, y, config.logY);
    const reasons = new Set([xv.reason, yv.reason].filter((reason): reason is ExclusionReason => !!reason));
    if (reasons.size) {
      excludedCount++;
      for (const reason of reasons) excluded[reason] = (excluded[reason] || 0) + 1;
    } else {
      points.push({ record, x: xv.value!, y: yv.value!, group: scatterGroup(record, config.groupBy) });
    }
  }
  return { points, excluded, excludedCount };
}

export function axisDomain(values: number[], logarithmic = false): AxisDomain {
  let min = Infinity;
  let max = -Infinity;
  for (const value of values) {
    if (!Number.isFinite(value) || (logarithmic && value <= 0)) continue;
    const transformed = logarithmic ? Math.log10(value) : value;
    min = Math.min(min, transformed);
    max = Math.max(max, transformed);
  }
  if (min === Infinity) return logarithmic ? [0, 1] : [0, 1];
  if (min === max) {
    const padding = logarithmic ? 0.5 : Math.max(Math.abs(min) * 0.1, min === 0 ? 1 : Number.MIN_VALUE);
    return [min - padding, max + padding];
  }
  const padding = (max - min) * 0.06;
  return [min - padding, max + padding];
}

/** Domain coordinates are log10 values for a logarithmic axis. */
export function axisPosition(value: number, domain: AxisDomain, start: number, end: number, logarithmic = false): number {
  const transformed = logarithmic ? Math.log10(value) : value;
  return start + ((transformed - domain[0]) / (domain[1] - domain[0])) * (end - start);
}

export function axisTicks(domain: AxisDomain, logarithmic = false) {
  return Array.from({ length: 5 }, (_, index) => {
    const transformed = domain[0] + ((domain[1] - domain[0]) * index) / 4;
    return { value: logarithmic ? 10 ** transformed : transformed, fraction: index / 4 };
  });
}

export function formatAxisNumber(value: number): string {
  if (value === 0) return "0";
  if (Math.abs(value) < 0.001 || Math.abs(value) >= 10000) return value.toExponential(2).replace(/\.00e/, "e");
  return Number(value.toPrecision(4)).toString();
}

export function selectPointsInBox(points: ScatterPoint[], box: { x1: number; y1: number; x2: number; y2: number }, project: (point: ScatterPoint) => { x: number; y: number }): string[] {
  const left = Math.min(box.x1, box.x2), right = Math.max(box.x1, box.x2);
  const top = Math.min(box.y1, box.y2), bottom = Math.max(box.y1, box.y2);
  return points.filter((point) => {
    const position = project(point);
    return position.x >= left && position.x <= right && position.y >= top && position.y <= bottom;
  }).map((point) => point.record.id);
}

const COLORS = ["#0284c7", "#7c3aed", "#059669", "#d97706", "#db2777", "#475569", "#0891b2", "#b45309"];
export function scatterColor(group: string): string {
  let hash = 0;
  for (let i = 0; i < group.length; i++) hash = ((hash << 5) - hash + group.charCodeAt(i)) | 0;
  return COLORS[(hash >>> 0) % COLORS.length];
}
