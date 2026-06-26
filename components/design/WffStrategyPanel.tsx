"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  WFF_STRATEGY_DEFAULTS,
  WFF_STRATEGY_LABELS,
  WFF_REGION_PARAMETER_DEFAULTS,
  WFF_REGION_PARAMETER_PRESETS,
  WFF_REGION_PARAMETER_VALUES,
  WFF_STRATEGY_OPTIONS,
  normalizeStrategyRequest,
  type WffMetricBlock,
  type WffPlotPoint,
  type WffStrategy,
  type WffStrategyRequest,
  type WffStrategyResult,
} from "@/lib/predict/wffStrategy.shared";

function fmt(value: number | null | undefined, digits = 3) {
  return value == null || !Number.isFinite(value) ? "—" : value.toFixed(digits);
}

function label(value: string) {
  return WFF_STRATEGY_LABELS[value] ?? value;
}

function optionNameLabel(name: string) {
  return {
    base: "Base learners",
    meta: "Meta model",
  }[name] ?? name;
}

function dualWeightLabel(value: string | number) {
  const left = Math.round(Math.min(100, Math.max(0, Number(value))));
  const safeLeft = Number.isFinite(left) ? left : 50;
  return `${safeLeft}/${100 - safeLeft}`;
}

function configSummary(strategy: WffStrategy, options: Record<string, string>) {
  if (strategy === "single") return `${label(options.model)}`;
  if (strategy === "dual") return `${label(options.pair)} · ${dualWeightLabel(options.weight)}`;
  return `${label(options.base)} · Meta ${label(options.meta)} · ${label(options.region_profile)}`;
}

function project(value: number, min: number, max: number, size: number, invert = false) {
  const t = (value - min) / (max - min || 1);
  const px = 34 + t * (size - 54);
  return +(invert ? size - px : px).toFixed(2);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function previewFactor(options: Record<string, string>) {
  const meta = { catboost: 0, forest: 0.025, xgboost: -0.015, "target-tuned": 0.04 }[options.meta ?? "catboost"] ?? 0;
  const profile = { "table-4-5": 0, smooth: -0.02, "high-focus": 0.03 }[options.region_profile ?? "table-4-5"] ?? 0;
  const q1 = (Number(options.q1 ?? 34) - 34) * 0.0025;
  const q2 = (Number(options.q2 ?? 84) - 84) * -0.0018;
  const region = Object.entries(WFF_REGION_PARAMETER_DEFAULTS).reduce((sum, [key, fallback]) => {
    const current = Number(options[key] ?? fallback);
    const base = Number(fallback);
    if (!Number.isFinite(current) || !Number.isFinite(base) || base === 0) return sum;
    return sum + clamp((current - base) / Math.abs(base), -1, 1) * 0.01;
  }, 0);
  return clamp(meta + profile + q1 + q2 + region, -0.18, 0.18);
}

function previewPoints(points: WffPlotPoint[], factor: number): WffPlotPoint[] {
  return points.map((point) => {
    const residual = point.predicted - point.measured;
    const predicted = Math.max(0, point.predicted + residual * factor + point.measured * factor * 0.035);
    return {
      ...point,
      predicted,
      absolute_error: Math.abs(predicted - point.measured),
    };
  });
}

function metricsFromPoints(points: WffPlotPoint[]): WffMetricBlock {
  const n = points.length;
  if (!n) return { n: 0, r2: null, mae: null, rmse: null };
  const measuredMean = points.reduce((sum, point) => sum + point.measured, 0) / n;
  const abs = points.reduce((sum, point) => sum + Math.abs(point.predicted - point.measured), 0);
  const sq = points.reduce((sum, point) => sum + (point.predicted - point.measured) ** 2, 0);
  const total = points.reduce((sum, point) => sum + (point.measured - measuredMean) ** 2, 0);
  return {
    n,
    r2: total > 0 ? 1 - sq / total : null,
    mae: abs / n,
    rmse: Math.sqrt(sq / n),
  };
}

function previewGateThresholds(source: WffStrategyResult, options: Record<string, string>) {
  const thresholds = source.config.gate_thresholds;
  if (!thresholds || typeof thresholds !== "object") return thresholds;
  const low = Number((thresholds as Record<string, unknown>).low_middle);
  const high = Number((thresholds as Record<string, unknown>).middle_high);
  if (!Number.isFinite(low) || !Number.isFinite(high)) return thresholds;
  const q1Shift = (Number(options.q1 ?? 34) - 34) / 100;
  const q2Shift = (Number(options.q2 ?? 84) - 84) / 100;
  return {
    low_middle: Math.max(0, low * (1 + q1Shift * 0.25)),
    middle_high: Math.max(low + 0.01, high * (1 + q2Shift * 0.2)),
  };
}

export function buildWffPreviewResult(source: WffStrategyResult, request: WffStrategyRequest): WffStrategyResult {
  const normalized = normalizeStrategyRequest(request);
  const factor = previewFactor(normalized.options);
  const points = {
    train: previewPoints(source.points.train, factor),
    test: previewPoints(source.points.test, factor),
    external_literature: previewPoints(source.points.external_literature, factor),
  };
  return {
    ...source,
    strategy: normalized.strategy,
    label: `${source.label} preview`,
    config: {
      ...source.config,
      preview: true,
      exact_status: "pending",
      preview_basis: source.label,
      requested_options: normalized.options,
      meta_model: normalized.options.meta ?? source.config.meta_model,
      gate_thresholds: previewGateThresholds(source, normalized.options),
    },
    metrics: {
      train: metricsFromPoints(points.train),
      test: metricsFromPoints(points.test),
      external_literature: metricsFromPoints(points.external_literature),
    },
    points,
  };
}

function roundTrendValue(value: number) {
  return Number(value.toFixed(4));
}

function makeTrendCloud(split: string, rowStart: number, count: number, maxMeasured: number, phase: number, sourcePrefix?: string): WffPlotPoint[] {
  return Array.from({ length: count }, (_, offset) => {
    const t = count <= 1 ? 0 : offset / (count - 1);
    const band = offset % 7;
    const measured = roundTrendValue(0.045 + maxMeasured * (t ** 1.32) + (band - 3) * 0.006 + Math.sin(offset * 0.41 + phase) * 0.012);
    const residual = Math.sin(offset * 1.17 + phase) * (0.018 + measured * 0.026) + Math.cos(offset * 0.29 + phase) * 0.018;
    const predicted = roundTrendValue(Math.max(0.01, measured + residual));
    return {
      split,
      index: offset + 1,
      row_index: rowStart + offset,
      measured,
      predicted,
      absolute_error: Math.abs(predicted - measured),
      ...(sourcePrefix ? { source_literature_key: `${sourcePrefix}-${offset + 1}` } : {}),
    };
  });
}

const TREND_BASE_POINTS: WffStrategyResult["points"] = {
  train: makeTrendCloud("train", 11, 160, 2.9, 0.15),
  test: makeTrendCloud("test", 301, 48, 2.85, 1.7),
  external_literature: makeTrendCloud("external_literature", 501, 28, 2.35, 3.1, "lit"),
};

const TREND_BASE_RESULT: WffStrategyResult = {
  strategy: "triple",
  label: "classroom trend baseline",
  config: {
    preview: true,
    exact_status: "trend-only",
    meta_model: "catboost",
    gate_thresholds: { low_middle: 0.1, middle_high: 1 },
  },
  metrics: {
    train: metricsFromPoints(TREND_BASE_POINTS.train),
    test: metricsFromPoints(TREND_BASE_POINTS.test),
    external_literature: metricsFromPoints(TREND_BASE_POINTS.external_literature),
  },
  points: TREND_BASE_POINTS,
};

const SIM_CONTROL_DEFAULTS = {
  bias: 50,
  spread: 45,
  low_response: 50,
  middle_response: 50,
  high_response: 50,
  nonlinearity: 50,
  outlier_pressure: 18,
  literature_drift: 50,
} as const;

type SimControlName = keyof typeof SIM_CONTROL_DEFAULTS;

const SIM_CONTROL_DEFINITIONS: Array<{ name: SimControlName; label: string; shortLabel: string }> = [
  { name: "bias", label: "Bias", shortLabel: "bias" },
  { name: "spread", label: "Spread", shortLabel: "spread" },
  { name: "low_response", label: "Low response", shortLabel: "low" },
  { name: "middle_response", label: "Mid response", shortLabel: "mid" },
  { name: "high_response", label: "High response", shortLabel: "high" },
  { name: "nonlinearity", label: "Curve", shortLabel: "curve" },
  { name: "outlier_pressure", label: "Outliers", shortLabel: "out" },
  { name: "literature_drift", label: "Literature drift", shortLabel: "lit" },
];

function simControlValue(options: Record<string, string>, name: SimControlName) {
  const raw = Number(options[name] ?? SIM_CONTROL_DEFAULTS[name]);
  return Number.isFinite(raw) ? clamp(raw, 0, 100) : SIM_CONTROL_DEFAULTS[name];
}

function normalizedSimOptions(options: Record<string, string> | undefined) {
  return Object.fromEntries(SIM_CONTROL_DEFINITIONS.map(({ name }) => [name, String(simControlValue(options ?? {}, name))]));
}

function normalizedContinuousRegionOptions(options: Record<string, string> | undefined) {
  return Object.fromEntries(Object.entries(WFF_REGION_PARAMETER_DEFAULTS).map(([name, fallback]) => {
    const range = WFF_REGION_PARAMETER_VALUES[name] ?? [fallback];
    const numericValues = range.map(Number).filter(Number.isFinite);
    const min = Math.min(...numericValues, Number(fallback));
    const max = Math.max(...numericValues, Number(fallback));
    const raw = Number(options?.[name] ?? fallback);
    const value = Number.isFinite(raw) ? clamp(raw, min, max) : Number(fallback);
    const formatted = name.endsWith("_max_depth") ? String(Math.round(value)) : value.toFixed(2);
    return [name, formatted];
  }));
}

function centeredControl(options: Record<string, string>, name: SimControlName) {
  return (simControlValue(options, name) - 50) / 50;
}

function smoothstep(edge0: number, edge1: number, value: number) {
  const t = clamp((value - edge0) / (edge1 - edge0 || 1), 0, 1);
  return t * t * (3 - 2 * t);
}

function pointRegionWeights(measured: number) {
  const low = 1 - smoothstep(0.18, 0.72, measured);
  const high = smoothstep(1.2, 2.18, measured);
  const middle = clamp(1 - Math.max(low, high), 0, 1);
  return { low, middle, high };
}

function deterministicOutlierSignal(rowIndex: number) {
  const wave = Math.sin(rowIndex * 12.9898) * 43758.5453;
  return wave - Math.floor(wave);
}

function relativeRegionParameter(options: Record<string, string>, key: string) {
  const current = Number(options[key] ?? WFF_REGION_PARAMETER_DEFAULTS[key]);
  const base = Number(WFF_REGION_PARAMETER_DEFAULTS[key]);
  if (!Number.isFinite(current) || !Number.isFinite(base) || base === 0) return 0;
  return clamp((current - base) / Math.abs(base), -1, 1);
}

function regionParameterEffect(options: Record<string, string>, region: "low" | "middle" | "high") {
  const catboostRate = relativeRegionParameter(options, `${region}_catboost_learning_rate`);
  const xgboostRate = relativeRegionParameter(options, `${region}_xgboost_learning_rate`);
  const forestDepth = relativeRegionParameter(options, `${region}_forest_max_depth`);
  return {
    slope: catboostRate * 1.1 + xgboostRate * 0.92 + forestDepth * 0.3,
    residual: Math.abs(catboostRate) * 0.7 + Math.abs(xgboostRate) * 0.78 + Math.abs(forestDepth) * 0.52,
    direction: catboostRate * 0.82 + xgboostRate * 0.72 + forestDepth * 0.32,
  };
}

function simulateTrendPoints(points: WffPlotPoint[], options: Record<string, string>): WffPlotPoint[] {
  const bias = centeredControl(options, "bias");
  const spread = simControlValue(options, "spread") / 50;
  const lowResponse = centeredControl(options, "low_response");
  const middleResponse = centeredControl(options, "middle_response");
  const highResponse = centeredControl(options, "high_response");
  const nonlinearity = centeredControl(options, "nonlinearity");
  const outlierPressure = simControlValue(options, "outlier_pressure") / 100;
  const literatureDrift = centeredControl(options, "literature_drift");
  const metaTilt = { catboost: -0.004, forest: 0.012, xgboost: -0.01, "target-tuned": 0.018 }[options.meta ?? "catboost"] ?? 0;
  const profileTilt = { "table-4-5": 0, smooth: -0.018, "high-focus": 0.024 }[options.region_profile ?? "table-4-5"] ?? 0;
  const q1 = (Number(options.q1 ?? 34) - 34) / 100;
  const q2 = (Number(options.q2 ?? 84) - 84) / 100;
  const lowParameterEffect = regionParameterEffect(options, "low");
  const middleParameterEffect = regionParameterEffect(options, "middle");
  const highParameterEffect = regionParameterEffect(options, "high");

  return points.map((point) => {
    const measured = point.measured;
    const baseResidual = point.predicted - measured;
    const weights = pointRegionWeights(measured);
    const zoneShift =
      weights.low * lowResponse * (0.018 + measured * 0.028 + q1 * 0.08) +
      weights.middle * middleResponse * (0.026 + measured * 0.02) +
      weights.high * highResponse * (0.035 + measured * 0.055 + q2 * 0.11);
    const activeRegionEffect = {
      slope:
        weights.low * lowParameterEffect.slope +
        weights.middle * middleParameterEffect.slope +
        weights.high * highParameterEffect.slope,
      residual:
        weights.low * lowParameterEffect.residual +
        weights.middle * middleParameterEffect.residual +
        weights.high * highParameterEffect.residual,
      direction:
        weights.low * lowParameterEffect.direction +
        weights.middle * middleParameterEffect.direction +
        weights.high * highParameterEffect.direction,
    };
    const regionVisibilityGain = weights.low * 1.35 + weights.middle * 1.08 + weights.high * 0.68;
    const localCurveResponse =
      (weights.low * lowParameterEffect.direction * (0.7 - measured) +
        weights.middle * middleParameterEffect.direction * Math.sin(measured * 2.1) * 0.28 +
        weights.high * highParameterEffect.direction * (measured - 1.15)) *
      (0.12 + measured * 0.11);
    const regionParameterShift =
      regionVisibilityGain *
      (activeRegionEffect.slope * (0.12 + measured * 0.28) +
        activeRegionEffect.direction * Math.tanh((measured - 0.8) * 1.1) * (0.045 + measured * 0.11) +
        localCurveResponse);
    const curveShift = nonlinearity * Math.tanh((measured - 1.08) * 1.25) * (0.018 + measured * 0.052);
    const biasShift = bias * (0.025 + measured * 0.055);
    const heteroscedasticResidual = baseResidual * (0.55 + spread * 0.62 + measured * 0.06 + activeRegionEffect.residual * (1.15 + measured * 0.24));
    const outlierSignal = deterministicOutlierSignal(point.row_index);
    const outlierDirection = deterministicOutlierSignal(point.row_index + 97) > 0.5 ? 1 : -1;
    const outlierMagnitude = outlierSignal > 0.86 ? outlierPressure * outlierDirection * (0.06 + measured * 0.11) : 0;
    const domainShift = point.split === "external_literature" ? literatureDrift * (0.035 + measured * 0.07) + Math.sin(point.row_index * 0.37) * 0.012 : 0;
    const predicted = roundTrendValue(
      Math.max(0.005, measured + heteroscedasticResidual + zoneShift + regionParameterShift + curveShift + biasShift + metaTilt + profileTilt + outlierMagnitude + domainShift)
    );
    return {
      ...point,
      predicted,
      absolute_error: Math.abs(predicted - measured),
    };
  });
}

export function buildWffTrendResult(request: WffStrategyRequest): WffStrategyResult {
  const baseRequest = normalizeStrategyRequest(request);
  const normalized = { ...baseRequest, options: { ...baseRequest.options, ...normalizedContinuousRegionOptions(request.options), ...normalizedSimOptions(request.options) } };
  const points = {
    train: simulateTrendPoints(TREND_BASE_RESULT.points.train, normalized.options),
    test: simulateTrendPoints(TREND_BASE_RESULT.points.test, normalized.options),
    external_literature: simulateTrendPoints(TREND_BASE_RESULT.points.external_literature, normalized.options),
  };
  return {
    ...TREND_BASE_RESULT,
    strategy: normalized.strategy,
    label: "classroom trend simulation",
    config: {
      ...TREND_BASE_RESULT.config,
      preview: true,
      exact_status: "trend-only",
      preview_basis: "classroom trend baseline",
      requested_options: normalized.options,
      simulation_controls: Object.fromEntries(SIM_CONTROL_DEFINITIONS.map(({ name }) => [name, simControlValue(normalized.options, name)])),
      meta_model: normalized.options.meta ?? TREND_BASE_RESULT.config.meta_model,
      gate_thresholds: previewGateThresholds(TREND_BASE_RESULT, normalized.options),
    },
    metrics: {
      train: metricsFromPoints(points.train),
      test: metricsFromPoints(points.test),
      external_literature: metricsFromPoints(points.external_literature),
    },
    points,
  };
}

function WeightSlider({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const numericValue = Math.min(100, Math.max(0, Number(value)));
  const safeValue = Number.isFinite(numericValue) ? Math.round(numericValue) : 50;
  return (
    <div className="min-w-[16rem] flex-[1.4]">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-eyebrow text-ink-500">{optionNameLabel("weight")}</span>
        <span className="font-mono text-xs font-semibold text-ink-950">{dualWeightLabel(safeValue)}</span>
      </div>
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={safeValue}
        aria-label={optionNameLabel("weight")}
        onChange={(event) => onChange(event.target.value)}
        className="mt-3 h-1.5 w-full cursor-grab appearance-none rounded-full bg-ink-200 accent-brand-600 active:cursor-grabbing"
      />
      <div className="mt-2 flex justify-center font-mono text-[11px] font-semibold">
        <button
          type="button"
          onClick={() => onChange("50")}
          className={`min-w-24 rounded-[6px] px-2 py-1 transition ${safeValue === 50 ? "bg-brand-50 text-brand-700" : "text-ink-500 hover:bg-ink-50 hover:text-ink-700"}`}
        >
          50/50
        </button>
      </div>
    </div>
  );
}

function OptionSelect({
  name,
  values,
  value,
  onChange,
}: {
  name: string;
  values: readonly string[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="min-w-[12rem] flex-1">
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={`wff-${name}`} className="text-[10px] font-semibold uppercase tracking-eyebrow text-ink-500">
          {optionNameLabel(name)}
        </label>
      </div>
      <select
        id={`wff-${name}`}
        value={value}
        aria-label={optionNameLabel(name)}
        onChange={(event) => onChange(event.target.value)}
        className="mt-2 h-11 w-full rounded-[8px] border border-brand-100 bg-white/90 px-3 font-serif text-base font-semibold text-ink-950 shadow-sm outline-none transition hover:border-brand-200 focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
      >
        {values.map((item) => (
          <option key={item} value={item}>
            {label(item)}
          </option>
        ))}
      </select>
    </div>
  );
}

function choicePosition(index: number, total: number) {
  if (total <= 1) return 50;
  return 8 + (index / (total - 1)) * 84;
}

function nearestChoiceIndexFromRail(value: number, total: number) {
  if (total <= 1) return 0;
  const normalized = (value - 8) / 84;
  return Math.min(total - 1, Math.max(0, Math.round(normalized * (total - 1))));
}

function DiscreteChoiceRail({
  choices,
  selectedIndex,
  ariaLabel,
  onChange,
  suffix = "",
  labelClassName = "text-ink-300",
}: {
  choices: readonly string[];
  selectedIndex: number;
  ariaLabel: string;
  onChange: (index: number) => void;
  suffix?: string;
  labelClassName?: string;
}) {
  const safeIndex = Math.min(Math.max(selectedIndex, 0), Math.max(choices.length - 1, 0));
  const railValue = choicePosition(safeIndex, choices.length);
  return (
    <div className="relative mt-1 h-11">
      <div className="absolute inset-x-0 top-3 h-1.5 rounded-full bg-ink-200" />
      {choices.map((choice, index) => {
        const left = `${choicePosition(index, choices.length)}%`;
        return (
          <span key={choice} className="absolute top-[0.65rem] h-2.5 w-px -translate-x-1/2 rounded-full bg-ink-300/70" style={{ left }} />
        );
      })}
      <span
        className="absolute top-0 h-5 w-5 -translate-x-1/2 rounded-full bg-brand-600 shadow-sm"
        style={{ left: `${choicePosition(safeIndex, choices.length)}%` }}
      />
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={railValue}
        aria-label={ariaLabel}
        onChange={(event) => onChange(nearestChoiceIndexFromRail(Number(event.target.value), choices.length))}
        className="absolute inset-x-0 top-0 h-7 w-full cursor-grab opacity-0 active:cursor-grabbing"
      />
      {choices.map((choice, index) => (
        <span
          key={`${choice}-label`}
          className={`absolute top-7 -translate-x-1/2 whitespace-nowrap font-mono text-[8px] ${labelClassName}`}
          style={{ left: `${choicePosition(index, choices.length)}%` }}
        >
          {choice}{suffix}
        </span>
      ))}
    </div>
  );
}

function EmptyChart({ title }: { title: string }) {
  return (
    <figure className="rounded-[8px] border border-ink-200 bg-white p-3">
      <figcaption className="text-sm font-semibold text-ink-950">{title}</figcaption>
      <div className="mt-2 flex aspect-[1.45] items-center justify-center rounded-[8px] bg-ink-50 text-xs font-semibold text-ink-400">waiting</div>
    </figure>
  );
}

function shortModelName(value: string) {
  if (value === "forest") return "RF";
  if (value === "catboost") return "CatBoost";
  if (value === "xgboost") return "XGBoost";
  return label(value);
}

function optionModels(value: string | undefined) {
  return String(value ?? "")
    .split("+")
    .filter(Boolean)
    .map(shortModelName)
    .join(" + ");
}

function chartModelSummary(result: WffStrategyResult | null, strategy: WffStrategy, options: Record<string, string>) {
  const config = result?.config ?? {};
  const baseFromConfig = Array.isArray(config.base_learners)
    ? (config.base_learners as string[]).map(shortModelName).join(" + ")
    : typeof config.model === "string"
      ? shortModelName(config.model)
      : typeof config.pair === "string"
        ? optionModels(config.pair)
        : "";
  const base =
    baseFromConfig ||
    (strategy === "single" ? shortModelName(options.model) : strategy === "dual" ? optionModels(options.pair) : optionModels(options.base));
  const metaFromConfig = typeof config.meta_model === "string" ? shortModelName(config.meta_model) : "";
  const meta = metaFromConfig || (strategy === "triple" ? shortModelName(options.meta) : strategy === "dual" ? "Weighted blend" : "None");
  return { base, meta };
}

function gateThresholds(result: WffStrategyResult | null) {
  const thresholds = result?.config?.gate_thresholds;
  if (!thresholds || typeof thresholds !== "object") return null;
  const low = Number((thresholds as Record<string, unknown>).low_middle);
  const high = Number((thresholds as Record<string, unknown>).middle_high);
  return Number.isFinite(low) && Number.isFinite(high) && low < high ? { low, high } : null;
}

function movementTrail(current: WffPlotPoint[], previous: WffPlotPoint[], stride: number) {
  const count = Math.min(current.length, previous.length);
  const trail: Array<{ key: string; measured: number; from: number; to: number; split: string }> = [];
  for (let index = 0; index < count; index += stride) {
    const next = current[index];
    const before = previous[index];
    if (!next || !before) continue;
    const shift = Math.abs(next.predicted - before.predicted);
    if (shift < 0.015) continue;
    trail.push({ key: `${next.split}-${next.row_index}`, measured: next.measured, from: before.predicted, to: next.predicted, split: next.split });
  }
  return trail;
}

function FitChart({
  result,
  previousResult,
  activeRegion,
  strategy,
  options,
}: {
  result: WffStrategyResult | null;
  previousResult?: WffStrategyResult | null;
  activeRegion?: "low" | "middle" | "high" | null;
  strategy: WffStrategy;
  options: Record<string, string>;
}) {
  const train = result?.points.train ?? [];
  const test = result?.points.test ?? [];
  const previousTrain = previousResult?.points.train ?? [];
  const previousTest = previousResult?.points.test ?? [];
  const points = [...train, ...test];
  const S = 300;
  const previousPoints = [...previousTrain, ...previousTest];
  const values = points.length ? [...points, ...previousPoints].flatMap((point) => [point.measured, point.predicted]) : [0, 3];
  const min = Math.min(0, ...values);
  const max = Math.max(1, ...values);
  const pad = (max - min) * 0.08 || 0.1;
  const lo = min - pad;
  const hi = max + pad;
  const left = 38;
  const right = S - 12;
  const top = 34;
  const bottom = S - 32;
  const X = (value: number) => left + ((value - lo) / (hi - lo || 1)) * (right - left);
  const Y = (value: number) => bottom - ((value - lo) / (hi - lo || 1)) * (bottom - top);
  const clampX = (value: number) => Math.max(left, Math.min(right, X(value)));
  const summary = chartModelSummary(result, strategy, options);
  const thresholds = gateThresholds(result);
  const lowX = thresholds ? clampX(thresholds.low) : null;
  const highX = thresholds ? clampX(thresholds.high) : null;
  const trail = [...movementTrail(train, previousTrain, 10), ...movementTrail(test, previousTest, 4)];
  const regionFill = (region: "low" | "middle" | "high") => (!activeRegion || activeRegion === region ? 1 : 0.34);
  return (
    <figure className="rounded-[8px] border border-ink-200 bg-white/95 p-3 shadow-card backdrop-blur">
      <figcaption className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold text-ink-950">True vs Predicted</span>
      </figcaption>
      <svg viewBox={`0 0 ${S} ${S}`} className="mt-2 w-full" role="img" aria-label="True versus predicted friction coefficient">
        <defs>
          <radialGradient id="wffTrainPoint" cx="35%" cy="28%" r="72%">
            <stop offset="0%" stopColor="#fecaca" />
            <stop offset="62%" stopColor="#ef4444" />
            <stop offset="100%" stopColor="#991b1b" />
          </radialGradient>
          <radialGradient id="wffTestPoint" cx="35%" cy="28%" r="72%">
            <stop offset="0%" stopColor="#bfdbfe" />
            <stop offset="62%" stopColor="#2563eb" />
            <stop offset="100%" stopColor="#1e3a8a" />
          </radialGradient>
        </defs>
        <rect width={S} height={S} rx="10" fill="#fff" />
        {thresholds && lowX != null && highX != null ? (
          <>
            <rect x={left} y={top} width={lowX - left} height={bottom - top} fill="#ecfeff" fillOpacity={regionFill("low")} />
            <rect x={lowX} y={top} width={highX - lowX} height={bottom - top} fill="#eff6ff" fillOpacity={regionFill("middle")} />
            <rect x={highX} y={top} width={right - highX} height={bottom - top} fill="#fdf2f8" fillOpacity={regionFill("high")} />
            <line x1={lowX} y1={top} x2={lowX} y2={bottom} stroke="#14b8a6" strokeDasharray="3 3" />
            <line x1={highX} y1={top} x2={highX} y2={bottom} stroke="#8b5cf6" strokeDasharray="3 3" />
            <text x={lowX} y="12" textAnchor="middle" fill="#111827" fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace" fontSize="9" fontWeight="700">
              {fmt(thresholds.low, 2)}
            </text>
            <text x={highX} y="12" textAnchor="middle" fill="#111827" fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace" fontSize="9" fontWeight="700">
              {fmt(thresholds.high, 2)}
            </text>
            <path d={`M${lowX - 3},15 L${lowX},22 L${lowX + 3},15`} fill="#111827" />
            <path d={`M${highX - 3},15 L${highX},22 L${highX + 3},15`} fill="#111827" />
          </>
        ) : (
          <rect x={left} y={top} width={right - left} height={bottom - top} fill="#f8fafc" />
        )}
        <rect x={left} y={top} width={right - left} height={bottom - top} fill="none" stroke="#111827" strokeWidth="1.2" />
        <text x={(left + right) / 2} y={top + 12} textAnchor="middle" fill="#111827" fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace" fontSize="11" fontWeight="800">
          Base model: {summary.base}
        </text>
        <text x={(left + right) / 2} y={top + 25} textAnchor="middle" fill="#111827" fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace" fontSize="11" fontWeight="800">
          Meta model: {summary.meta}
        </text>
        <line x1={X(lo)} y1={Y(lo)} x2={X(hi)} y2={Y(hi)} stroke="#475569" strokeDasharray="3 3" />
        <text x={right - 8} y={Y(hi) + 22} textAnchor="end" fill="#111827" fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace" fontSize="10" fontWeight="700">
          Y=X
        </text>
        {trail.map((item) => (
          <line
            key={`movementTrail-${item.key}`}
            data-movement-trail={item.key}
            x1={X(item.measured)}
            x2={X(item.measured)}
            y1={Y(item.from)}
            y2={Y(item.to)}
            stroke={item.split === "test" ? "#60a5fa" : "#f87171"}
            strokeWidth={item.split === "test" ? 1.05 : 0.85}
            strokeOpacity="0.38"
          />
        ))}
        {previousTrain.map((point) => (
          <circle key={`previous-train-${point.row_index}`} data-point-cloud="previous-train" cx={X(point.measured)} cy={Y(point.predicted)} r="1.7" fill="none" stroke="#fca5a5" strokeWidth="0.55" strokeOpacity="0.52" />
        ))}
        {previousTest.map((point) => (
          <circle key={`previous-test-${point.row_index}`} data-point-cloud="previous-test" cx={X(point.measured)} cy={Y(point.predicted)} r="2.25" fill="none" stroke="#93c5fd" strokeWidth="0.65" strokeOpacity="0.58" />
        ))}
        {train.map((point) => (
          <circle key={`train-${point.row_index}`} data-point-cloud="train" cx={X(point.measured)} cy={Y(point.predicted)} r="1.75" fill="url(#wffTrainPoint)" stroke="#fff" strokeWidth="0.45" fillOpacity="0.8" />
        ))}
        {test.map((point) => (
          <circle key={`test-${point.row_index}`} data-point-cloud="test" cx={X(point.measured)} cy={Y(point.predicted)} r="2.25" fill="url(#wffTestPoint)" stroke="#eff6ff" strokeWidth="0.55" fillOpacity="0.88" />
        ))}
        <g transform={`translate(${right - 140} ${bottom - 82})`}>
          <rect width="132" height="74" rx="4" fill="white" fillOpacity="0.92" stroke="#94a3b8" strokeWidth="0.9" />
          <line x1="66" y1="8" x2="66" y2="66" stroke="#e2e8f0" strokeWidth="0.8" />
          <circle cx="10" cy="14" r="2.7" fill="#ef4444" />
          <text x="16" y="17" fill="#ef4444" fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace" fontSize="8.2" fontWeight="800">
            Train
          </text>
          <text x="8" y="31" fill="#ef4444" fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace" fontSize="7.3" fontWeight="700">
            R² {fmt(result?.metrics.train.r2)}
          </text>
          <text x="8" y="43" fill="#ef4444" fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace" fontSize="7.3" fontWeight="700">
            MAE {fmt(result?.metrics.train.mae)}
          </text>
          <text x="8" y="54" fill="#ef4444" fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace" fontSize="7.3" fontWeight="700">
            RMSE {fmt(result?.metrics.train.rmse)}
          </text>
          <circle cx="74" cy="14" r="2.7" fill="#2563eb" />
          <text x="80" y="17" fill="#2563eb" fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace" fontSize="8.2" fontWeight="800">
            Test
          </text>
          <text x="72" y="31" fill="#2563eb" fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace" fontSize="7.3" fontWeight="700">
            R² {fmt(result?.metrics.test.r2)}
          </text>
          <text x="72" y="43" fill="#2563eb" fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace" fontSize="7.3" fontWeight="700">
            MAE {fmt(result?.metrics.test.mae)}
          </text>
          <text x="72" y="54" fill="#2563eb" fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace" fontSize="7.3" fontWeight="700">
            RMSE {fmt(result?.metrics.test.rmse)}
          </text>
          <circle cx="74" cy="64" r="2.6" fill="none" stroke="#94a3b8" strokeWidth="0.8" />
          <text x="80" y="67" fill="#64748b" fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace" fontSize="7.3" fontWeight="700">
            Previous
          </text>
        </g>
        <text x={(left + right) / 2} y={S - 7} textAnchor="middle" fill="#111827" fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace" fontSize="12" fontWeight="800">
          True
        </text>
        <text x="12" y={(top + bottom) / 2} textAnchor="middle" transform={`rotate(-90 12 ${(top + bottom) / 2})`} fill="#111827" fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace" fontSize="12" fontWeight="800">
          Predicted
        </text>
      </svg>
    </figure>
  );
}

function LiteratureChart({ result }: { result: WffStrategyResult | null }) {
  const points = result?.points.external_literature ?? [];
  if (!points.length) return <EmptyChart title="Literature validation" />;
  const W = 320;
  const H = 210;
  const values = points.flatMap((point) => [point.measured, point.predicted]);
  const min = Math.min(0, ...values);
  const max = Math.max(1, ...values);
  const pad = (max - min) * 0.1 || 0.05;
  const lo = min - pad;
  const hi = max + pad;
  const X = (i: number) => 34 + (i / Math.max(1, points.length - 1)) * (W - 54);
  const Y = (value: number) => project(value, lo, hi, H, true);
  const path = (key: "measured" | "predicted") => points.map((point, i) => `${i ? "L" : "M"}${X(i).toFixed(2)},${Y(point[key])}`).join(" ");
  return (
    <figure className="rounded-[8px] border border-ink-200 bg-white p-3">
      <figcaption className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold text-ink-950">Literature validation</span>
        <span className="font-mono text-[10px] text-ink-500">
          R² {fmt(result?.metrics.external_literature.r2)} · MAE {fmt(result?.metrics.external_literature.mae)}
        </span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 w-full" role="img" aria-label="Literature validation measured and predicted COF">
        <rect width={W} height={H} rx="10" fill="#f8fafc" />
        <path d={path("measured")} fill="none" stroke="#111827" strokeWidth="1.8" />
        <path d={path("predicted")} fill="none" stroke="#16a34a" strokeWidth="1.8" />
        {points.map((point, i) => (
          <circle key={`m-${point.row_index}`} cx={X(i)} cy={Y(point.measured)} r="2.7" fill="#111827" />
        ))}
        {points.map((point, i) => (
          <circle key={`p-${point.row_index}`} cx={X(i)} cy={Y(point.predicted)} r="2.7" fill="#16a34a" />
        ))}
        <text x={W / 2} y={H - 7} textAnchor="middle" fill="#64748b" fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace" fontSize="8">
          Data points
        </text>
      </svg>
      <div className="mt-1 flex gap-3 text-[11px] text-ink-600">
        <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-ink-950" />Measured</span>
        <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-green-600" />Predicted</span>
      </div>
    </figure>
  );
}

function MetricDelta({ value, lowerIsBetter = false }: { value: number | null; lowerIsBetter?: boolean }) {
  const improved = value != null && (lowerIsBetter ? value < 0 : value > 0);
  const changed = value != null && Math.abs(value) >= 0.0005;
  const tone = !changed ? "text-ink-500" : improved ? "text-brand-700" : "text-rose-600";
  return <span className={`font-mono text-sm font-semibold ${tone}`}>{value == null ? "—" : `${value >= 0 ? "+" : ""}${fmt(value)}`}</span>;
}

function averagePointShift(current: WffPlotPoint[] | undefined, previous: WffPlotPoint[] | undefined) {
  if (!current?.length || !previous?.length) return null;
  const count = Math.min(current.length, previous.length);
  if (!count) return null;
  let total = 0;
  for (let index = 0; index < count; index += 1) {
    total += Math.abs(current[index].predicted - previous[index].predicted);
  }
  return total / count;
}

function PointShift({ value }: { value: number | null }) {
  const tone = value == null || value < 0.02 ? "text-ink-500" : value < 0.25 ? "text-brand-700" : "text-rose-600";
  return <span className={`font-mono text-sm font-semibold ${tone}`}>{value == null ? "—" : fmt(value)}</span>;
}

function ResultComparison({
  result,
  previousRun,
}: {
  result: WffStrategyResult | null;
  previousRun: { result: WffStrategyResult; summary: string } | null;
}) {
  const previous = previousRun?.result ?? null;
  const testDelta = result && previous && result.metrics.test.r2 != null && previous.metrics.test.r2 != null ? result.metrics.test.r2 - previous.metrics.test.r2 : null;
  const validationDelta =
    result && previous && result.metrics.external_literature.r2 != null && previous.metrics.external_literature.r2 != null
      ? result.metrics.external_literature.r2 - previous.metrics.external_literature.r2
      : null;
  const maeDelta =
    result && previous && result.metrics.external_literature.mae != null && previous.metrics.external_literature.mae != null
      ? result.metrics.external_literature.mae - previous.metrics.external_literature.mae
      : null;
  const trainPointShift = result && previous ? averagePointShift(result.points.train, previous.points.train) : null;
  const testPointShift = result && previous ? averagePointShift(result.points.test, previous.points.test) : null;
  return (
    <section className="rounded-[8px] border border-ink-200 bg-white/95 p-3 shadow-card backdrop-blur">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-semibold uppercase tracking-eyebrow text-ink-500">Compared with previous run</div>
          <div className="mt-1 min-w-0 max-w-3xl truncate font-serif text-sm font-semibold text-ink-800">{previousRun?.summary ?? "Run a second setting to see before / after changes"}</div>
        </div>
        <span className="rounded-full bg-ink-50 px-2.5 py-1 font-mono text-[10px] font-semibold text-ink-500">{result ? "current ready" : "waiting"}</span>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        <div className="rounded-[7px] border border-ink-100 bg-gradient-to-br from-white to-ink-50 px-3 py-2 shadow-sm">
          <div className="text-[10px] font-semibold uppercase tracking-eyebrow text-ink-400">Test R² change</div>
          <MetricDelta value={testDelta} />
        </div>
        <div className="rounded-[7px] border border-ink-100 bg-gradient-to-br from-white to-ink-50 px-3 py-2 shadow-sm">
          <div className="text-[10px] font-semibold uppercase tracking-eyebrow text-ink-400">Train point shift</div>
          <PointShift value={trainPointShift} />
        </div>
        <div className="rounded-[7px] border border-ink-100 bg-gradient-to-br from-white to-ink-50 px-3 py-2 shadow-sm">
          <div className="text-[10px] font-semibold uppercase tracking-eyebrow text-ink-400">Test point shift</div>
          <PointShift value={testPointShift} />
        </div>
        <div className="rounded-[7px] border border-ink-100 bg-gradient-to-br from-white to-ink-50 px-3 py-2 shadow-sm">
          <div className="text-[10px] font-semibold uppercase tracking-eyebrow text-ink-400">Validation R² change</div>
          <MetricDelta value={validationDelta} />
        </div>
        <div className="rounded-[7px] border border-ink-100 bg-gradient-to-br from-white to-ink-50 px-3 py-2 shadow-sm">
          <div className="text-[10px] font-semibold uppercase tracking-eyebrow text-ink-400">Validation MAE change</div>
          <MetricDelta value={maeDelta} lowerIsBetter />
        </div>
      </div>
    </section>
  );
}

const BASE_MODEL_ORDER = ["catboost", "forest", "xgboost"] as const;
type BaseModelName = (typeof BASE_MODEL_ORDER)[number];

const REGION_PARAMETER_CARDS = [
  { id: "low", name: "Low friction", titleClass: "text-teal-700" },
  { id: "middle", name: "Middle", titleClass: "text-blue-700" },
  { id: "high", name: "High friction", titleClass: "text-pink-700" },
] as const;

const REGION_PARAMETER_ROWS = [
  { keySuffix: "catboost_learning_rate", label: "CB lr", ariaLabel: "CatBoost learning rate" },
  { keySuffix: "xgboost_learning_rate", label: "XGB lr", ariaLabel: "XGBoost learning rate" },
  { keySuffix: "forest_max_depth", label: "RF depth", ariaLabel: "RF depth" },
] as const;

type RegionId = keyof typeof WFF_REGION_PARAMETER_PRESETS;

function regionPresetIndex(region: RegionId, values: Record<string, string>) {
  const presets = WFF_REGION_PARAMETER_PRESETS[region];
  const index = presets.findIndex((preset) => Object.entries(preset).every(([key, value]) => values[key] === value));
  return index >= 0 ? index : 1;
}

function regionParameterRange(name: string) {
  const values = WFF_REGION_PARAMETER_VALUES[name] ?? [WFF_REGION_PARAMETER_DEFAULTS[name] ?? "0"];
  const numeric = values.map(Number).filter(Number.isFinite);
  const fallback = Number(WFF_REGION_PARAMETER_DEFAULTS[name] ?? numeric[0] ?? 0);
  return {
    min: Math.min(...numeric, fallback),
    max: Math.max(...numeric, fallback),
    step: name.endsWith("_max_depth") ? 1 : 0.01,
  };
}

function formatRegionParameterValue(name: string, value: number) {
  return name.endsWith("_max_depth") ? String(Math.round(value)) : value.toFixed(2);
}

function regionParameterDeviation(name: string, value: string) {
  const range = regionParameterRange(name);
  const current = Number(value);
  const fallback = Number(WFF_REGION_PARAMETER_DEFAULTS[name] ?? range.min);
  const safeCurrent = Number.isFinite(current) ? clamp(current, range.min, range.max) : fallback;
  const baseline = Number.isFinite(fallback) ? fallback : range.min;
  const denominator = Math.max(Math.abs(range.max - baseline), Math.abs(baseline - range.min), range.step);
  return clamp((safeCurrent - baseline) / denominator, -1, 1);
}

function regionImpactScore(region: RegionId, values: Record<string, string>) {
  const deviations = REGION_PARAMETER_ROWS.map((row) => {
    const name = `${region}_${row.keySuffix}`;
    return Math.abs(regionParameterDeviation(name, values[name] ?? WFF_REGION_PARAMETER_DEFAULTS[name] ?? "0"));
  });
  return Math.round((deviations.reduce((sum, value) => sum + value, 0) / deviations.length) * 100);
}

function regionDefaultPatch(region: RegionId) {
  return Object.fromEntries(REGION_PARAMETER_ROWS.map((row) => {
    const name = `${region}_${row.keySuffix}`;
    return [name, WFF_REGION_PARAMETER_DEFAULTS[name]];
  }));
}

function RegionParameterSlider({
  name,
  label: rowLabel,
  ariaLabel,
  value,
  onChange,
}: {
  name: string;
  label: string;
  ariaLabel: string;
  value: string;
  onChange: (name: string, value: string) => void;
}) {
  const range = regionParameterRange(name);
  const numericValue = Number(value);
  const safeValue = Number.isFinite(numericValue) ? clamp(numericValue, range.min, range.max) : Number(WFF_REGION_PARAMETER_DEFAULTS[name] ?? range.min);
  const displayValue = formatRegionParameterValue(name, safeValue);
  const handleInput = (nextValue: string) => onChange(name, formatRegionParameterValue(name, Number(nextValue)));
  return (
    <label className="block">
      <span className="flex items-baseline justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-eyebrow text-ink-500">{rowLabel}</span>
        <span className="font-mono text-xs font-semibold text-ink-950">{displayValue}</span>
      </span>
      <input
        type="range"
        min={range.min}
        max={range.max}
        step={range.step}
        value={safeValue}
        aria-label={ariaLabel}
        onInput={(event) => handleInput(event.currentTarget.value)}
        onChange={(event) => handleInput(event.currentTarget.value)}
        className="wff-range mt-2"
      />
      <span className="mt-1 flex justify-between font-mono text-[8px] text-ink-400">
        <span>{formatRegionParameterValue(name, range.min)}</span>
        <span>{formatRegionParameterValue(name, range.max)}</span>
      </span>
    </label>
  );
}

function RegionParameterGuide({
  values,
  activeRegion,
  onChange,
  onResetRegion,
  onResetAll,
  onActiveRegionChange,
}: {
  values: Record<string, string>;
  activeRegion: RegionId | null;
  onChange: (name: string, value: string) => void;
  onResetRegion: (region: RegionId) => void;
  onResetAll: () => void;
  onActiveRegionChange: (region: RegionId | null) => void;
}) {
  return (
    <div className="mt-3 border-t border-ink-100 pt-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-eyebrow text-ink-500">Region parameters</span>
          <span className="font-mono text-[10px] text-ink-400">continuous sliders</span>
        </div>
        <button
          type="button"
          onClick={onResetAll}
          className="rounded-[6px] border border-ink-200 bg-white px-2.5 py-1 text-[10px] font-semibold text-ink-500 shadow-sm transition hover:border-brand-200 hover:text-brand-700"
        >
          Reset all
        </button>
      </div>
      <div className="grid gap-2 md:grid-cols-3">
        {REGION_PARAMETER_CARDS.map((region) => {
          const regionId = region.id as RegionId;
          const impact = regionImpactScore(regionId, values);
          const isActive = activeRegion === regionId;
          return (
            <div
              key={region.id}
              onMouseEnter={() => onActiveRegionChange(regionId)}
              onMouseLeave={() => onActiveRegionChange(null)}
              onFocus={() => onActiveRegionChange(regionId)}
              onBlur={() => onActiveRegionChange(null)}
              className={`relative overflow-hidden rounded-[8px] border bg-white/90 px-3 py-2 shadow-sm transition hover:-translate-y-0.5 hover:shadow-card ${
                isActive ? "border-brand-200 ring-2 ring-brand-100" : "border-white/80 ring-1 ring-ink-100/70"
              }`}
            >
              <div className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-brand-300 via-sky-300 to-rose-300 opacity-70" />
              <div className="mb-2 flex items-start justify-between gap-2">
                <div>
                  <span className={`font-serif text-base font-semibold ${region.titleClass}`}>{region.name}</span>
                  <div className="mt-1 flex items-center gap-2">
                    <span className="text-[9px] font-semibold uppercase tracking-eyebrow text-ink-400">Impact</span>
                    <div className="h-1.5 w-16 overflow-hidden rounded-full bg-ink-100">
                      <div className="h-full rounded-full bg-brand-600 transition-all" style={{ width: `${impact}%` }} />
                    </div>
                    <span className="font-mono text-[9px] font-semibold text-ink-500">{impact}%</span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onResetRegion(regionId)}
                  className="rounded-[6px] border border-ink-200 bg-white px-2 py-1 text-[10px] font-semibold text-ink-500 transition hover:border-brand-200 hover:text-brand-700"
                >
                  Reset
                </button>
              </div>
              <div className="space-y-2">
                {REGION_PARAMETER_ROWS.map((row) => {
                  const name = `${region.id}_${row.keySuffix}`;
                  const currentValue = values[name] ?? WFF_REGION_PARAMETER_DEFAULTS[name] ?? "";
                  return (
                    <RegionParameterSlider
                      key={name}
                      name={name}
                      label={row.label}
                      ariaLabel={`${region.name} ${row.ariaLabel}`}
                      value={currentValue}
                      onChange={onChange}
                    />
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function strategyFromBaseCount(count: number): WffStrategy {
  if (count <= 1) return "single";
  if (count === 2) return "dual";
  return "triple";
}

function pairFromBaseSelection(selected: BaseModelName[]) {
  const key = selected.slice().sort().join("+");
  if (key === "catboost+forest") return "catboost+forest";
  if (key === "catboost+xgboost") return "catboost+xgboost";
  return "xgboost+forest";
}

function baseKeyFromSelection(selected: BaseModelName[]) {
  return BASE_MODEL_ORDER.filter((name) => selected.includes(name)).join("+");
}

export function WffStrategyPanel() {
  const [selectedBase, setSelectedBase] = useState<BaseModelName[]>(["catboost", "forest", "xgboost"]);
  const [dualControls, setDualControls] = useState({ weight: WFF_STRATEGY_DEFAULTS.dual.weight });
  const [activeRegion, setActiveRegion] = useState<RegionId | null>(null);
  const [tripleControls, setTripleControls] = useState({
    meta: WFF_STRATEGY_DEFAULTS.triple.meta,
    region_profile: WFF_STRATEGY_DEFAULTS.triple.region_profile,
    q1: Number(WFF_STRATEGY_DEFAULTS.triple.q1),
    q2: Number(WFF_STRATEGY_DEFAULTS.triple.q2),
    ...WFF_REGION_PARAMETER_DEFAULTS,
  });
  const strategy = strategyFromBaseCount(selectedBase.length);
  const activeOptions = useMemo<Record<string, string>>(() => {
    if (strategy === "single") {
      return { model: selectedBase[0] ?? "catboost" } as Record<string, string>;
    }
    if (strategy === "dual") {
      return { pair: pairFromBaseSelection(selectedBase), weight: dualControls.weight } as Record<string, string>;
    }
    return {
      base: baseKeyFromSelection(selectedBase),
      meta: tripleControls.meta,
      region_profile: tripleControls.region_profile,
      q1: String(tripleControls.q1),
      q2: String(tripleControls.q2),
      ...Object.fromEntries(Object.keys(WFF_REGION_PARAMETER_DEFAULTS).map((name) => [name, String(tripleControls[name as keyof typeof tripleControls])])),
    } as Record<string, string>;
  }, [dualControls, selectedBase, strategy, tripleControls]);
  const optionEntries = useMemo(() => {
    if (strategy === "single") return [] as const;
    if (strategy === "dual") {
      return [
        ["weight", WFF_STRATEGY_OPTIONS.dual.weight],
      ] as const;
    }
    return [
      ["meta", WFF_STRATEGY_OPTIONS.triple.meta],
    ] as const;
  }, [strategy]);

  const updateOption = (name: string, value: string) => {
    if (strategy === "dual") setDualControls((prev) => ({ ...prev, [name]: value }));
    if (strategy === "triple") setTripleControls((prev) => ({ ...prev, [name]: value }));
  };

  const toggleBaseModel = (name: BaseModelName) => {
    setSelectedBase((prev) => {
      const exists = prev.includes(name);
      if (exists && prev.length === 1) return prev;
      const next = exists ? prev.filter((item) => item !== name) : [...prev, name];
      return BASE_MODEL_ORDER.filter((item) => next.includes(item));
    });
  };

  const requestPayload = useMemo(() => {
    const normalized = normalizeStrategyRequest({ strategy, options: activeOptions });
    return { ...normalized, options: { ...normalized.options, ...normalizedContinuousRegionOptions(activeOptions), ...normalizedSimOptions(activeOptions) } };
  }, [activeOptions, strategy]);
  const requestKey = useMemo(() => JSON.stringify(requestPayload), [requestPayload]);
  const trendResult = useMemo(() => buildWffTrendResult(requestPayload), [requestPayload]);
  const [result, setResult] = useState<WffStrategyResult | null>(() => trendResult);
  const [previousRun, setPreviousRun] = useState<{ result: WffStrategyResult; summary: string } | null>(null);
  const [appliedSummary, setAppliedSummary] = useState(() => configSummary(requestPayload.strategy, requestPayload.options));
  const resultRef = useRef<WffStrategyResult | null>(null);
  const appliedSummaryRef = useRef("");
  const hasAppliedTrendRef = useRef(false);

  useEffect(() => {
    resultRef.current = result;
  }, [result]);

  useEffect(() => {
    appliedSummaryRef.current = appliedSummary;
  }, [appliedSummary]);

  useEffect(() => {
    const previousSnapshot = resultRef.current;
    const previousSummary = appliedSummaryRef.current;
    const summary = configSummary(requestPayload.strategy, requestPayload.options);
    setPreviousRun(hasAppliedTrendRef.current && previousSnapshot ? { result: previousSnapshot, summary: previousSummary || "Previous trend" } : null);
    setResult(trendResult);
    setAppliedSummary(summary);
    hasAppliedTrendRef.current = true;
  }, [requestKey, requestPayload, trendResult]);

  const visibleResult = result ?? trendResult;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="label-eyebrow text-brand-700">Model Evaluation</p>
          <h2 className="mt-1 font-serif text-2xl font-semibold text-ink-950">Instant strategy trend lab</h2>
        </div>
        <span className="rounded-full border border-brand-100 bg-white/80 px-2.5 py-1 font-mono text-[10px] font-semibold text-brand-700 shadow-sm">trend</span>
      </div>

      <section className="wff-config-panel rounded-[10px] border border-brand-100/80 bg-gradient-to-br from-white via-brand-50/40 to-ink-50 p-3 shadow-panel">
        <div className="rounded-[9px] border border-white/80 bg-white/70 p-2 shadow-sm backdrop-blur">
          <div className="flex items-center justify-between gap-2 px-1">
            <span className="text-[10px] font-semibold uppercase tracking-eyebrow text-ink-500">Base models</span>
            <span className="font-mono text-[10px] font-semibold text-brand-700">{selectedBase.length} selected · {label(strategy)}</span>
          </div>
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            {BASE_MODEL_ORDER.map((name) => {
              const checked = selectedBase.includes(name);
              return (
                <label
                  key={name}
                  className={`group relative flex min-h-16 cursor-pointer items-center justify-between gap-3 overflow-hidden rounded-[8px] border px-3 py-2 transition ${
                    checked ? "border-brand-200 bg-white text-ink-950 shadow-sm" : "border-transparent bg-white/35 text-ink-500 hover:bg-white/80"
                  }`}
                >
                  <span className={`absolute inset-y-2 left-0 w-1 rounded-r-full transition ${checked ? "bg-brand-500" : "bg-ink-200 group-hover:bg-brand-200"}`} />
                  <span>
                    <span className="block font-serif text-base font-semibold">{label(name)}</span>
                    <span className="font-mono text-[10px]">{name === "forest" ? "RF" : name}</span>
                  </span>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleBaseModel(name)}
                    className="h-4 w-4 rounded border-ink-300 accent-brand-600"
                    aria-label={label(name)}
                  />
                </label>
              );
            })}
          </div>
          {strategy === "triple" && (
            <RegionParameterGuide
              values={activeOptions}
              activeRegion={activeRegion}
              onChange={(name, value) => setTripleControls((prev) => ({ ...prev, [name]: value }))}
              onResetRegion={(region) => setTripleControls((prev) => ({ ...prev, ...regionDefaultPatch(region) }))}
              onResetAll={() => setTripleControls((prev) => ({ ...prev, ...WFF_REGION_PARAMETER_DEFAULTS }))}
              onActiveRegionChange={setActiveRegion}
            />
          )}
        </div>

        <div className="mt-3 flex flex-wrap gap-3">
          {optionEntries.map(([name, values]) =>
            name === "meta" ? (
              <OptionSelect key={name} name={name} values={values} value={activeOptions[name]} onChange={(value) => updateOption(name, value)} />
            ) : (
              <WeightSlider key={name} value={activeOptions[name]} onChange={(value) => updateOption(name, value)} />
            )
          )}
        </div>
      </section>

      <div className="grid gap-3 lg:grid-cols-2">
        <FitChart result={visibleResult} previousResult={previousRun?.result} activeRegion={activeRegion} strategy={strategy} options={activeOptions} />
        <LiteratureChart result={visibleResult} />
      </div>

      <ResultComparison result={visibleResult} previousRun={previousRun} />
    </section>
  );
}
