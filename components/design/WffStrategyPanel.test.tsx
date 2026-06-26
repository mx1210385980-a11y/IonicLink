import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { WffStrategyPanel, buildWffPreviewResult, buildWffTrendResult } from "./WffStrategyPanel";
import { WFF_REGION_PARAMETER_PRESETS } from "@/lib/predict/wffStrategy.shared";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const html = renderToStaticMarkup(createElement(WffStrategyPanel));
const panelSource = readFileSync("components/design/WffStrategyPanel.tsx", "utf8");

assert.match(html, /Model Evaluation/);
assert.match(html, /Instant strategy trend lab/);
assert.match(html, /wff-config-panel/);
assert.match(html, /font-serif/);
assert.match(html, /CatBoost/);
assert.match(html, /XGBoost/);
assert.match(html, /Random Forest/);
assert.match(html, /Base models/);
assert.match(html, /3 selected/);
assert.match(html, /Region parameters/);
assert.match(html, /continuous sliders/);
assert.match(html, /Impact/);
assert.match(html, /Reset/);
assert.match(html, /Reset all/);
assert.match(html, /Low friction/);
assert.match(html, /Middle/);
assert.match(html, /High friction/);
assert.match(html, />CB lr</);
assert.match(html, />XGB lr</);
assert.match(html, />RF depth</);
assert.match(html, />0\.03</);
assert.match(html, />0\.58</);
assert.match(html, />0\.12</);
assert.match(html, />0\.05</);
assert.match(html, />0\.90</);
assert.match(html, />0\.20</);
assert.match(html, />9</);
assert.match(html, />7</);
assert.match(html, /0\.01/);
assert.match(html, /0\.70/);
assert.match(html, /aria-label="Low friction CatBoost learning rate"/);
assert.match(html, /aria-label="Low friction XGBoost learning rate"/);
assert.match(html, /aria-label="Low friction RF depth"/);
assert.match(html, /aria-label="Middle CatBoost learning rate"/);
assert.match(html, /aria-label="High friction RF depth"/);
assert.doesNotMatch(panelSource, /Math\.max\(1,\s*5,/);
assert.match(panelSource, /previousResult/);
assert.match(panelSource, /activeRegion/);
assert.match(panelSource, /movementTrail/);
assert.match(panelSource, /radialGradient/);
assert.match(panelSource, /data-point-cloud/);
assert.match(panelSource, /wff-range/);
assert.match(html, /aria-label="Low friction CatBoost learning rate"[^>]*value="0\.03"/);
assert.match(html, /aria-label="Middle XGBoost learning rate"[^>]*value="0\.9"/);
assert.match(html, /aria-label="High friction RF depth"[^>]*value="9"/);
assert.match(html, /Meta model/);
assert.match(html, /Target tuned/);
assert.match(html, /Train/);
assert.match(html, /Test/);
assert.match(html, /Validation/);
assert.match(html, /Compared with previous run/);
assert.match(html, /Test R² change/);
assert.match(html, /Train point shift/);
assert.match(html, /Test point shift/);
assert.match(html, /Validation R² change/);
assert.match(html, /Validation MAE change/);
assert.match(html, /True vs Predicted/);
assert.match(html, /Previous/);
assert.match(html, /Base model:/);
assert.match(html, /Meta model:/);
assert.match(html, />Train</);
assert.match(html, />Test</);
assert.match(html, />R² /);
assert.match(html, /Literature validation/);
assert.match(html, /type="checkbox"/);
assert.match(html, /type="range"/);
assert.match(html, /<select/);
assert.ok(html.indexOf("True vs Predicted") < html.indexOf("Compared with previous run"));
assert.doesNotMatch(html, /Run real model/);
assert.doesNotMatch(html, /Simulator controls/);
assert.doesNotMatch(html, /front-end response model/);
assert.doesNotMatch(html, /Bias/);
assert.doesNotMatch(html, /Spread/);
assert.doesNotMatch(html, /Low response/);
assert.doesNotMatch(html, /Mid response/);
assert.doesNotMatch(html, /High response/);
assert.doesNotMatch(html, /Outliers/);
assert.doesNotMatch(html, /Literature drift/);
assert.doesNotMatch(html, /Trend simulator/);
assert.doesNotMatch(html, /Trend model/);
assert.doesNotMatch(html, /Instant trend estimate/);
assert.doesNotMatch(html, /aria-label="q1"/);
assert.doesNotMatch(html, /aria-label="q2"/);
assert.doesNotMatch(html, /\bq1\b/);
assert.doesNotMatch(html, /\bq2\b/);
assert.doesNotMatch(html, /Training progress/);
assert.doesNotMatch(html, /Waiting for run/);
assert.doesNotMatch(html, /Exact model/);
assert.doesNotMatch(html, /Joint-label stratified split/);
assert.doesNotMatch(html, /Prediction Detail Table/);
assert.doesNotMatch(html, /Paper fixed/);
assert.doesNotMatch(html, /Region boundary/);
assert.doesNotMatch(html, /boundary/i);
assert.doesNotMatch(html, /endpoint/i);
assert.doesNotMatch(html, /saved points/);
assert.doesNotMatch(html, /Gate edge/);
assert.doesNotMatch(html, /Balanced Δ/);
assert.doesNotMatch(html, /Region split/);
assert.doesNotMatch(html, /Low 34% · Mid 50% · High 16%/);
assert.doesNotMatch(html, /Auto status/);
assert.doesNotMatch(html, /Run now/);
assert.doesNotMatch(html, /Paper start/);
assert.doesNotMatch(html, /Table 4\.5 start/);
assert.doesNotMatch(html, /Wider middle/);
assert.doesNotMatch(html, /More low/);
assert.doesNotMatch(html, /More high/);
assert.doesNotMatch(html, /Selected/);
assert.doesNotMatch(html, /Applied/);
assert.doesNotMatch(html, /Model knobs/);
assert.doesNotMatch(html, /auto keeps defaults/);
assert.doesNotMatch(html, /paper profile/);
assert.doesNotMatch(html, /gentler shifts/);
assert.doesNotMatch(html, /more high-region detail/);
assert.doesNotMatch(html, /μ=0.10/);
assert.doesNotMatch(html, />Wide</);
assert.doesNotMatch(html, />Even</);
assert.doesNotMatch(html, />Compact</);
assert.doesNotMatch(html, />Balanced</);
assert.doesNotMatch(html, />Deep</);
assert.doesNotMatch(html, /role="tab"/);
assert.doesNotMatch(html, /undefined/);
assert.doesNotMatch(panelSource, /model-evaluation/);

assert.equal(WFF_REGION_PARAMETER_PRESETS.low.length, 3);
assert.equal(WFF_REGION_PARAMETER_PRESETS.middle.length, 3);
assert.equal(WFF_REGION_PARAMETER_PRESETS.high.length, 3);

const exactFixture = {
  strategy: "triple" as const,
  label: "paper fixed gated triple",
  config: {
    gate_thresholds: { low_middle: 0.1, middle_high: 1.0 },
    meta_model: "catboost",
  },
  metrics: {
    train: { n: 2, r2: 0.9, mae: 0.05, rmse: 0.06 },
    test: { n: 1, r2: 0.8, mae: 0.1, rmse: 0.1 },
    external_literature: { n: 1, r2: 0.7, mae: 0.2, rmse: 0.2 },
  },
  points: {
    train: [
      { split: "train", index: 1, row_index: 1, measured: 0.2, predicted: 0.22, absolute_error: 0.02 },
      { split: "train", index: 2, row_index: 2, measured: 1.1, predicted: 1.0, absolute_error: 0.1 },
    ],
    test: [{ split: "test", index: 1, row_index: 3, measured: 0.5, predicted: 0.6, absolute_error: 0.1 }],
    external_literature: [{ split: "external_literature", index: 1, row_index: 4, measured: 0.7, predicted: 0.9, absolute_error: 0.2 }],
  },
};
const preview = buildWffPreviewResult(exactFixture, {
  strategy: "triple",
  options: {
    base: "catboost+forest+xgboost",
    meta: "target-tuned",
    region_profile: "high-focus",
    q1: "45",
    q2: "90",
    low_catboost_learning_rate: "0.12",
    low_xgboost_learning_rate: "0.20",
    low_forest_max_depth: "12",
    middle_catboost_learning_rate: "0.90",
    middle_xgboost_learning_rate: "0.99",
    middle_forest_max_depth: "11",
    high_catboost_learning_rate: "0.30",
    high_xgboost_learning_rate: "0.70",
    high_forest_max_depth: "12",
  },
});
assert.equal(preview.config.preview, true);
assert.equal(preview.config.exact_status, "pending");
assert.notEqual(preview.points.train[0].predicted, exactFixture.points.train[0].predicted);
assert.equal(preview.metrics.train.n, exactFixture.metrics.train.n);
assert.notDeepEqual(preview.config.gate_thresholds, exactFixture.config.gate_thresholds);

const defaultTrend = buildWffTrendResult({
  strategy: "triple",
  options: {
    base: "catboost+forest+xgboost",
    meta: "catboost",
    region_profile: "table-4-5",
    q1: "34",
    q2: "84",
  },
});
const adjustedTrend = buildWffTrendResult({
  strategy: "triple",
  options: {
    base: "catboost+forest+xgboost",
    meta: "target-tuned",
    region_profile: "high-focus",
    q1: "45",
    q2: "90",
  },
});
const continuousRegionTrend = buildWffTrendResult({
  strategy: "triple",
  options: {
    base: "catboost+forest+xgboost",
    meta: "catboost",
    region_profile: "table-4-5",
    q1: "34",
    q2: "84",
    low_catboost_learning_rate: "0.07",
    middle_xgboost_learning_rate: "0.73",
    high_forest_max_depth: "10",
  },
});
const highRegionTrend = buildWffTrendResult({
  strategy: "triple",
  options: {
    base: "catboost+forest+xgboost",
    meta: "catboost",
    region_profile: "table-4-5",
    q1: "34",
    q2: "84",
    high_xgboost_learning_rate: "0.55",
    high_catboost_learning_rate: "0.24",
  },
});
const lowRegionTrend = buildWffTrendResult({
  strategy: "triple",
  options: {
    base: "catboost+forest+xgboost",
    meta: "catboost",
    region_profile: "table-4-5",
    q1: "34",
    q2: "84",
    low_xgboost_learning_rate: "0.16",
    low_catboost_learning_rate: "0.09",
  },
});
assert.equal(defaultTrend.config.exact_status, "trend-only");
assert.equal(adjustedTrend.config.exact_status, "trend-only");
assert.ok(defaultTrend.points.train.length >= 150);
assert.ok(defaultTrend.points.test.length >= 40);
assert.ok(defaultTrend.points.external_literature.length >= 20);
assert.ok(defaultTrend.metrics.train.n + defaultTrend.metrics.test.n + defaultTrend.metrics.external_literature.n >= 210);
const changedTestPoints = adjustedTrend.points.test.filter((point, index) => Math.abs(point.predicted - defaultTrend.points.test[index].predicted) > 0.0001);
const changedTrainPoints = adjustedTrend.points.train.filter((point, index) => Math.abs(point.predicted - defaultTrend.points.train[index].predicted) > 0.0001);
assert.ok(changedTestPoints.length >= 40);
assert.ok(changedTrainPoints.length >= 150);
assert.notEqual(adjustedTrend.points.test[0].predicted, defaultTrend.points.test[0].predicted);
assert.notEqual(adjustedTrend.metrics.test.mae, defaultTrend.metrics.test.mae);

function averagePredictionDelta(
  before: typeof defaultTrend.points.train,
  after: typeof defaultTrend.points.train,
  predicate: (measured: number) => boolean
) {
  const deltas = before
    .map((point, index) => ({ measured: point.measured, delta: Math.abs(after[index].predicted - point.predicted) }))
    .filter((item) => predicate(item.measured))
    .map((item) => item.delta);
  return deltas.reduce((sum, value) => sum + value, 0) / deltas.length;
}

assert.equal((continuousRegionTrend.config.requested_options as Record<string, string>).low_catboost_learning_rate, "0.07");
assert.equal((continuousRegionTrend.config.requested_options as Record<string, string>).middle_xgboost_learning_rate, "0.73");
assert.equal((continuousRegionTrend.config.requested_options as Record<string, string>).high_forest_max_depth, "10");

const lowShiftFromHighRegion = averagePredictionDelta(defaultTrend.points.train, highRegionTrend.points.train, (measured) => measured < 0.45);
const highShiftFromHighRegion = averagePredictionDelta(defaultTrend.points.train, highRegionTrend.points.train, (measured) => measured > 1.8);
assert.ok(highShiftFromHighRegion > lowShiftFromHighRegion * 1.8);
assert.ok(highShiftFromHighRegion > 1.2);

const lowShiftFromLowRegion = averagePredictionDelta(defaultTrend.points.train, lowRegionTrend.points.train, (measured) => measured < 0.45);
const highShiftFromLowRegion = averagePredictionDelta(defaultTrend.points.train, lowRegionTrend.points.train, (measured) => measured > 1.8);
assert.ok(lowShiftFromLowRegion > highShiftFromLowRegion * 1.8);
assert.ok(lowShiftFromLowRegion > 0.25);

const lowTestShiftFromLowRegion = averagePredictionDelta(defaultTrend.points.test, lowRegionTrend.points.test, (measured) => measured < 0.45);
const highTestShiftFromHighRegion = averagePredictionDelta(defaultTrend.points.test, highRegionTrend.points.test, (measured) => measured > 1.8);
assert.ok(lowTestShiftFromLowRegion > 0.22);
assert.ok(highTestShiftFromHighRegion > 1.05);

console.log("WFF compact strategy panel tests passed");
