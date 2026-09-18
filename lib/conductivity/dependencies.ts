import type { Quantity } from "../units";
import type { ConductivityPropertyDependency, ConductivityRecord } from "./schema";

type PropertySpec = {
  field: string;
  label: string;
  get: (record: ConductivityRecord) => Quantity | null | undefined;
};

const PROPERTIES: PropertySpec[] = [
  { field: "conductivity", label: "Ionic conductivity", get: (record) => record.core.conductivity },
  { field: "capacitance", label: "Capacitance", get: (record) => record.core.capacitance },
  { field: "chargeTransferResistance", label: "Charge-transfer resistance", get: (record) => record.core.chargeTransferResistance },
  { field: "electrochemicalWindow", label: "Electrochemical stability window", get: (record) => record.core.electrochemicalWindow },
  { field: "viscosity", label: "Viscosity", get: (record) => record.extended.viscosity },
];

type NumericVariable = {
  key: string;
  label: string;
  axis: string;
  get: (record: ConductivityRecord) => Quantity | null | undefined;
  stable: (record: ConductivityRecord) => string[];
};

const identity = (record: ConductivityRecord) => `${record.core.ionicLiquid.cation}${record.core.ionicLiquid.anion}`;
const raw = (quantity: Quantity | null | undefined) => quantity?.raw?.trim() || "";
const commonStable = (record: ConductivityRecord) => [
  identity(record), record.core.surface, record.extended.method ?? "", record.extended.concentration ?? "",
  record.extended.waterContent ?? "", record.extended.potentialReference ?? "", raw(record.extended.pressure),
];

const NUMERIC_VARIABLES: NumericVariable[] = [
  {
    key: "temperature",
    label: "temperature",
    axis: "Temperature / K",
    get: (record) => record.core.temperature,
    stable: (record) => [...commonStable(record), raw(record.core.electrodePotential)],
  },
  {
    key: "electrodePotential",
    label: "electrode potential",
    axis: "Electrode potential / V",
    get: (record) => record.core.electrodePotential,
    stable: (record) => [...commonStable(record), raw(record.core.temperature)],
  },
  {
    key: "pressure",
    label: "pressure",
    axis: "Pressure / Pa",
    get: (record) => record.extended.pressure,
    stable: (record) => [...commonStable(record), raw(record.core.temperature), raw(record.core.electrodePotential)],
  },
];

function sameContext(a: string[], b: string[]): boolean {
  return a.every((value, index) => value === b[index]);
}

function coefficient(xs: number[], ys: number[]): number {
  const n = xs.length;
  const meanX = xs.reduce((sum, value) => sum + value, 0) / n;
  const meanY = ys.reduce((sum, value) => sum + value, 0) / n;
  let covariance = 0;
  let varianceX = 0;
  let varianceY = 0;
  for (let index = 0; index < n; index += 1) {
    const dx = xs[index] - meanX;
    const dy = ys[index] - meanY;
    covariance += dx * dy;
    varianceX += dx * dx;
    varianceY += dy * dy;
  }
  if (!varianceX || !varianceY) return 0;
  return covariance / Math.sqrt(varianceX * varianceY);
}

function trendFor(xs: number[], ys: number[]): ConductivityPropertyDependency["trend"] {
  const spread = Math.max(...ys) - Math.min(...ys);
  const scale = Math.max(...ys.map(Math.abs), 1e-12);
  if (spread / scale < 0.03) return "approximately-constant";
  const correlation = coefficient(xs, ys);
  if (correlation >= 0.55) return "increases";
  if (correlation <= -0.55) return "decreases";
  return "non-monotonic";
}

const TREND_TEXT: Record<ConductivityPropertyDependency["trend"], string> = {
  increases: "increases overall",
  decreases: "decreases overall",
  "non-monotonic": "changes non-monotonically",
  "approximately-constant": "changes only slightly across the available readings",
  comparison: "varies by sample",
};

function numericDependency(
  current: ConductivityRecord,
  records: ConductivityRecord[],
  property: PropertySpec,
  variable: NumericVariable,
): ConductivityPropertyDependency | null {
  if (property.field === variable.key) return null;
  const stable = variable.stable(current);
  const samples = records.flatMap((record) => {
    if (!sameContext(stable, variable.stable(record))) return [];
    const x = variable.get(record);
    const y = property.get(record);
    if (x?.std == null || y?.std == null) return [];
    return [{ record, x, y }];
  });
  const unique = new Map(samples.map((sample) => [`${sample.x.std}|${sample.y.std}`, sample]));
  const sorted = [...unique.values()].sort((a, b) => a.x.std! - b.x.std!);
  if (new Set(sorted.map((sample) => sample.x.std)).size < 2 || sorted.length < 2) return null;
  const xs = sorted.map((sample) => sample.x.std!);
  const ys = sorted.map((sample) => sample.y.std!);
  const trend = trendFor(xs, ys);
  return {
    label: `${property.label} dependence on ${variable.label}`,
    dependentField: property.field,
    independentVariable: variable.key,
    xAxis: variable.axis,
    yAxis: sorted[0].y.stdUnit,
    trend,
    statement: `Across ${sorted.length} points from the same paper and ionic liquid with other reported conditions held constant, ${property.label.toLowerCase()} ${TREND_TEXT[trend]} with ${variable.label}. This is a descriptive relationship between records, not a causal claim.`,
    observations: sorted.slice(0, 8).map(({ record, x, y }) => ({
      x: x.raw,
      y: y.raw,
      seriesLabel: identity(record),
      condition: [record.extended.concentration, record.extended.waterContent].filter(Boolean).join(" · ") || undefined,
    })),
    scope: "record-series",
    source: "record-comparison",
    confidence: sorted.length >= 4 ? 0.9 : sorted.length === 3 ? 0.82 : 0.72,
  };
}

function categoricalDependency(
  current: ConductivityRecord,
  records: ConductivityRecord[],
  property: PropertySpec,
  variable: "ionicLiquid" | "surface",
): ConductivityPropertyDependency | null {
  const stableFor = (record: ConductivityRecord) => variable === "ionicLiquid"
    ? [record.core.surface, record.extended.method ?? "", raw(record.core.temperature), raw(record.core.electrodePotential), record.extended.concentration ?? "", record.extended.waterContent ?? ""]
    : [identity(record), record.extended.method ?? "", raw(record.core.temperature), raw(record.core.electrodePotential), record.extended.concentration ?? "", record.extended.waterContent ?? ""];
  const stable = stableFor(current);
  const samples = records.flatMap((record) => {
    if (!sameContext(stable, stableFor(record))) return [];
    const y = property.get(record);
    if (y?.std == null) return [];
    const x = variable === "ionicLiquid" ? identity(record) : record.core.surface;
    return x ? [{ record, x, y }] : [];
  });
  const unique = new Map(samples.map((sample) => [sample.x, sample]));
  const sorted = [...unique.values()].sort((a, b) => b.y.std! - a.y.std!);
  if (sorted.length < 2) return null;
  const variableLabel = variable === "ionicLiquid" ? "ionic-liquid composition" : "electrode / substrate";
  return {
    label: `${property.label} by ${variableLabel}`,
    dependentField: property.field,
    independentVariable: variable,
    xAxis: variableLabel,
    yAxis: sorted[0].y.stdUnit,
    trend: "comparison",
    statement: `Across ${sorted.length} samples from the same paper with other reported conditions held constant, ${property.label.toLowerCase()} varies with ${variableLabel}. Reported values are ordered from highest to lowest. This conditional comparison does not infer a molecular mechanism.`,
    observations: sorted.slice(0, 8).map(({ record, x, y }) => ({
      x,
      y: y.raw,
      seriesLabel: identity(record),
      condition: [record.core.surface, raw(record.core.temperature), record.extended.concentration].filter(Boolean).join(" · ") || undefined,
    })),
    scope: "figure-comparison",
    source: "record-comparison",
    confidence: 0.88,
  };
}

/**
 * Build conservative dependencies from already extracted records in one paper.
 * Only one variable is allowed to change in a numeric series; otherwise no
 * relationship is shown, preventing mixed temperature/composition sweeps from
 * being mistaken for a clean dependence.
 */
export function deriveConductivityDependencies(
  current: ConductivityRecord,
  paperRecords: ConductivityRecord[],
): ConductivityPropertyDependency[] {
  const explicit = [
    ...(current.extended.propertyDependencies ?? []),
    ...(current.extended.performanceFigure?.dependencies ?? []),
  ];
  const comparable = paperRecords.filter((record) => record.paper.title === current.paper.title);
  const derived: ConductivityPropertyDependency[] = [];
  for (const property of PROPERTIES) {
    if (!property.get(current)) continue;
    for (const variable of NUMERIC_VARIABLES) {
      const dependency = numericDependency(current, comparable, property, variable);
      if (dependency) derived.push(dependency);
    }
    for (const variable of ["ionicLiquid", "surface"] as const) {
      const dependency = categoricalDependency(current, comparable, property, variable);
      if (dependency) derived.push(dependency);
    }
  }
  const seen = new Set<string>();
  return [...explicit, ...derived].filter((dependency) => {
    const key = `${dependency.dependentField}|${dependency.independentVariable}|${dependency.scope ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 4);
}
