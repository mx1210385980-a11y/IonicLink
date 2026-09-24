import type { AfmCurveRecord } from "./afmCurves";

export interface AfmCurveDependency {
  label: string;
  descriptor: "maximum-force" | "minimum-force" | "force-span" | "layer-count" | "innermost-layer" | "median-layer-spacing";
  independentVariable: "electrode-potential" | "temperature" | "ionic-liquid" | "substrate";
  trend: "increases" | "decreases" | "non-monotonic" | "approximately-constant" | "comparison";
  statement: string;
  observations: Array<{ x: string; y: string; curveId: string; condition?: string }>;
  confidence: number;
  basis: "verified-metadata" | "digitized-curve-comparison";
}

type Metric = {
  key: AfmCurveDependency["descriptor"];
  label: string;
  value: (curve: AfmCurveRecord) => { numeric: number; display: string; basis: AfmCurveDependency["basis"] } | null;
};

function physicalForceUnit(curve: AfmCurveRecord) {
  const unit = curve.yUnit?.trim();
  return unit && !/unverified|relative|pixel|normalised|normalized/i.test(unit) ? unit : null;
}

function curveMetric(curve: AfmCurveRecord, mode: "max" | "min" | "span") {
  const unit = physicalForceUnit(curve);
  if (!unit || (curve.collection === "legacy-cleaned" && curve.digitization.quality !== "complete") || !curve.points.length) return null;
  const values = curve.points.map((point) => point[1]).filter(Number.isFinite);
  if (!values.length) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const numeric = mode === "max" ? max : mode === "min" ? min : max - min;
  return { numeric, display: `${format(numeric)} ${unit}`, basis: "digitized-curve-comparison" as const };
}

const METRICS: Metric[] = [
  { key: "maximum-force", label: "Maximum recorded force", value: (curve) => curveMetric(curve, "max") },
  { key: "minimum-force", label: "Minimum recorded force", value: (curve) => curveMetric(curve, "min") },
  { key: "force-span", label: "Force span", value: (curve) => curveMetric(curve, "span") },
  {
    key: "layer-count", label: "Detected layer count", value: (curve) => {
      const value = curve.layering.detectedLayerCount.value;
      return value == null ? null : { numeric: value, display: `${format(value)} layers`, basis: "verified-metadata" };
    },
  },
  {
    key: "innermost-layer", label: "Innermost layer position", value: (curve) => {
      const value = curve.layering.innermostLayerThickness.value;
      return value == null ? null : { numeric: value, display: `${format(value)} ${curve.layering.innermostLayerThickness.unit ?? "nm"}`, basis: "verified-metadata" };
    },
  },
  {
    key: "median-layer-spacing", label: "Median layer spacing", value: (curve) => {
      const value = curve.layering.medianLayerSpacing.value;
      return value == null ? null : { numeric: value, display: `${format(value)} ${curve.layering.medianLayerSpacing.unit ?? "nm"}`, basis: "verified-metadata" };
    },
  },
];

function paperKey(curve: AfmCurveRecord) {
  return curve.source.doi || curve.source.pdfFile || `${curve.source.date ?? ""}/${curve.source.folder}`;
}

function ionicLiquid(curve: AfmCurveRecord) {
  return curve.context.ionicLiquid.name.value || curve.ionicLiquid || "";
}

function substrate(curve: AfmCurveRecord) {
  return curve.context.interface.substrate.value || "";
}

function correlation(xs: number[], ys: number[]) {
  const mx = xs.reduce((sum, value) => sum + value, 0) / xs.length;
  const my = ys.reduce((sum, value) => sum + value, 0) / ys.length;
  let cov = 0;
  let vx = 0;
  let vy = 0;
  for (let index = 0; index < xs.length; index += 1) {
    const dx = xs[index] - mx;
    const dy = ys[index] - my;
    cov += dx * dy;
    vx += dx * dx;
    vy += dy * dy;
  }
  return vx && vy ? cov / Math.sqrt(vx * vy) : 0;
}

function trend(xs: number[], ys: number[]): AfmCurveDependency["trend"] {
  const span = Math.max(...ys) - Math.min(...ys);
  const scale = Math.max(...ys.map(Math.abs), 1e-12);
  if (span / scale < 0.03) return "approximately-constant";
  const r = correlation(xs, ys);
  if (r >= 0.55) return "increases";
  if (r <= -0.55) return "decreases";
  return "non-monotonic";
}

const TREND_TEXT: Record<AfmCurveDependency["trend"], string> = {
  increases: "increases overall",
  decreases: "decreases overall",
  "non-monotonic": "changes non-monotonically",
  "approximately-constant": "changes only slightly",
  comparison: "differs across conditions",
};

function numericDependency(
  current: AfmCurveRecord,
  records: AfmCurveRecord[],
  metric: Metric,
  variable: "electrode-potential" | "temperature",
): AfmCurveDependency | null {
  const xOf = variable === "electrode-potential"
    ? (curve: AfmCurveRecord) => curve.context.electrochemistry.electrodePotential.value
    : (curve: AfmCurveRecord) => curve.context.thermodynamics.temperature.value;
  const sameFixedContext = (curve: AfmCurveRecord) => paperKey(curve) === paperKey(current)
    && ionicLiquid(curve) === ionicLiquid(current)
    && substrate(curve) === substrate(current)
    && (variable === "temperature"
      ? curve.context.electrochemistry.electrodePotential.value === current.context.electrochemistry.electrodePotential.value
      : curve.context.thermodynamics.temperature.value === current.context.thermodynamics.temperature.value);
  const observations = records.flatMap((curve) => {
    if (!sameFixedContext(curve)) return [];
    const x = xOf(curve);
    const y = metric.value(curve);
    if (x == null || !y) return [];
    return [{ curve, x, y }];
  });
  const unique = new Map(observations.map((item) => [`${item.x}|${item.y.numeric}`, item]));
  const sorted = [...unique.values()].sort((a, b) => a.x - b.x);
  if (new Set(sorted.map((item) => item.x)).size < 2) return null;
  const direction = trend(sorted.map((item) => item.x), sorted.map((item) => item.y.numeric));
  const variableLabel = variable === "electrode-potential" ? "electrode potential" : "temperature";
  const xUnit = variable === "electrode-potential" ? "V" : "K";
  return {
    label: `${metric.label} dependence on ${variableLabel}`,
    descriptor: metric.key,
    independentVariable: variable,
    trend: direction,
    statement: `Across ${sorted.length} AFM curves from the same paper with the same ionic liquid and substrate, ${metric.label.toLowerCase()} ${TREND_TEXT[direction]} with ${variableLabel}. This is a descriptor association, not evidence of an interfacial mechanism or causality.`,
    observations: sorted.slice(0, 8).map((item) => ({
      x: `${format(item.x)} ${xUnit}`,
      y: item.y.display,
      curveId: item.curve.id,
      condition: item.curve.context.electrochemistry.potentialReference.value || undefined,
    })),
    confidence: Math.min(...sorted.map((item) => item.curve.digitization.modelEligible ? 0.95 : item.curve.status === "source-verified" ? 0.82 : 0.65)),
    basis: sorted.every((item) => item.y.basis === "verified-metadata") ? "verified-metadata" : "digitized-curve-comparison",
  };
}

function categoricalDependency(
  current: AfmCurveRecord,
  records: AfmCurveRecord[],
  metric: Metric,
  variable: "ionic-liquid" | "substrate",
): AfmCurveDependency | null {
  const sameFixedContext = (curve: AfmCurveRecord) => paperKey(curve) === paperKey(current)
    && (variable === "ionic-liquid" ? substrate(curve) === substrate(current) : ionicLiquid(curve) === ionicLiquid(current))
    && curve.context.electrochemistry.electrodePotential.value === current.context.electrochemistry.electrodePotential.value
    && curve.context.thermodynamics.temperature.value === current.context.thermodynamics.temperature.value;
  const observations = records.flatMap((curve) => {
    if (!sameFixedContext(curve)) return [];
    const x = variable === "ionic-liquid" ? ionicLiquid(curve) : substrate(curve);
    const y = metric.value(curve);
    return x && y ? [{ curve, x, y }] : [];
  });
  const unique = new Map(observations.map((item) => [item.x, item]));
  const sorted = [...unique.values()].sort((a, b) => b.y.numeric - a.y.numeric);
  if (sorted.length < 2) return null;
  const variableLabel = variable === "ionic-liquid" ? "ionic-liquid composition" : "substrate";
  return {
    label: `${metric.label} by ${variableLabel}`,
    descriptor: metric.key,
    independentVariable: variable,
    trend: "comparison",
    statement: `For ${sorted.length} ${variableLabel} values from the same paper with other reported conditions held constant, ${metric.label.toLowerCase()} ${TREND_TEXT.comparison}. Values are ordered from highest to lowest.`,
    observations: sorted.slice(0, 8).map((item) => ({ x: item.x, y: item.y.display, curveId: item.curve.id })),
    confidence: Math.min(...sorted.map((item) => item.curve.digitization.modelEligible ? 0.95 : item.curve.status === "source-verified" ? 0.82 : 0.65)),
    basis: sorted.every((item) => item.y.basis === "verified-metadata") ? "verified-metadata" : "digitized-curve-comparison",
  };
}

export function deriveAfmCurveDependencies(current: AfmCurveRecord, allCurves: AfmCurveRecord[]): AfmCurveDependency[] {
  const relationships: AfmCurveDependency[] = [];
  for (const metric of METRICS) {
    if (!metric.value(current)) continue;
    for (const variable of ["electrode-potential", "temperature"] as const) {
      const dependency = numericDependency(current, allCurves, metric, variable);
      if (dependency) relationships.push(dependency);
    }
    for (const variable of ["ionic-liquid", "substrate"] as const) {
      const dependency = categoricalDependency(current, allCurves, metric, variable);
      if (dependency) relationships.push(dependency);
    }
  }
  return relationships.slice(0, 4);
}

function format(value: number) {
  const magnitude = Math.abs(value);
  if ((magnitude > 0 && magnitude < 0.01) || magnitude >= 1000) return value.toExponential(2);
  return Number(value.toPrecision(4)).toString();
}
