import assert from "node:assert/strict";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ModelLab, LAB_DEFAULTS, isLabDefault } from "./ModelLab";
import { buildVocabulary } from "../../lib/predict/candidates";
import { buildDataset } from "../../lib/predict/dataset";
import { featureNorm } from "../../lib/predict/descriptors";
import { runLoo } from "../../lib/predict/loo";
import { DESIGN_SPECS } from "../../lib/predict/specs";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

function quantity(value: number, stdUnit: string) {
  return { raw: `${value} ${stdUnit}`, value, unit: stdUnit, std: value, stdUnit };
}

let nextId = 0;
function tribologyRecord(cation: string, anion: string, cof: number, substrate = "mica", scale = "nano") {
  nextId += 1;
  return {
    id: `#l${String(nextId).padStart(3, "0")}`,
    status: "official",
    createdAt: "2026-06-12",
    paper: { title: `Friction of ${cation}${anion}` },
    core: {
      ionicLiquid: { cation, anion },
      substrate,
      temperature: quantity(298.15, "K"),
      load: quantity(1e-7, "N"),
      cof,
    },
    extended: { scale },
    flexible: [],
  };
}

function labProps(records: any[]) {
  const dataset = buildDataset("tribology", records, { includeReview: true, nanoOnly: true });
  const norm = featureNorm([...buildVocabulary("cation", dataset), ...buildVocabulary("anion", dataset)]);
  const loo = runLoo("tribology", dataset, norm);
  return {
    domain: "tribology" as const,
    spec: DESIGN_SPECS.tribology,
    dataset,
    norm,
    lab: { ...LAB_DEFAULTS },
    onLab: () => {},
    loo,
  };
}

const NINE = () => [
  tribologyRecord("[EMIM]", "[TFSI]", 0.02),
  tribologyRecord("[BMIM]", "[TFSI]", 0.03),
  tribologyRecord("[C6C1Im]", "[TFSI]", 0.05),
  tribologyRecord("[C8MIM]", "[TFSI]", 0.08),
  tribologyRecord("[EMIM]", "[BF4]", 0.025),
  tribologyRecord("[BMIM]", "[BF4]", 0.04),
  tribologyRecord("[PYR14]", "[TFSI]", 0.06),
  tribologyRecord("[EMIM]", "[EtSO4]", 0.01),
  tribologyRecord("[C6C1Im]", "[BF4]", 0.024),
];

/* ---- full lab at 9 nano records: knobs + validated study metrics ---- */
{
  const props = labProps([...NINE(), tribologyRecord("[EMIM]", "[FAP]", 0.45, "steel", "macro")]);
  assert.ok(props.loo, "9 usable nano records unlock LOO");
  const html = renderToStaticMarkup(createElement(ModelLab, props));
  assert.match(html, /Model lab — tune the estimator/);
  assert.match(html, /R²/, "the study's R² metric is shown");
  assert.match(html, /RMSE/, "the study's RMSE metric is shown");
  assert.match(html, /MAE/, "the study's MAE metric is shown");
  assert.match(html, /leave-one-out/, "metrics are explicitly held-out, not in-sample");
  assert.match(html, /log₁₀/, "the metric space is stated");
  assert.match(html, /Kernel bandwidth/);
  assert.match(html, /Neighborhood size K/);
  assert.match(html, /exclude flagged outliers/);
  assert.match(html, /bias/i, "the bias–variance lesson is on the page");
  assert.match(html, /Validation curve/);
  assert.match(html, /Held-out fit/);
  assert.match(html, /nanoscale \(AFM-class\) friction/, "the nanoscale scope is stated");
  assert.match(html, /1 macroscale \(or unscaled\) record is excluded/, "the excluded macro record is counted, not hidden — and not asserted to be macro when merely unscaled");
  assert.doesNotMatch(html, /NaN/, "no unguarded math leaks into the markup");
  // settings are live for the whole studio — that must be disclosed
  assert.match(html, /Settings are live for the whole studio/);
}

/* ---- gated state: below the gate the lab shows no metric it cannot back ---- */
{
  nextId = 0;
  const props = labProps(NINE().slice(0, 3));
  assert.equal(props.loo, null, "3 records are below the calibration gate");
  const html = renderToStaticMarkup(createElement(ModelLab, props));
  assert.match(html, /Insufficient data for validation/);
  assert.match(html, /unlock at 8 usable records/);
  assert.doesNotMatch(html, /Validation curve/, "no curve without validation");
  assert.doesNotMatch(html, /▲|▼/, "no delta chips without metrics");
  assert.doesNotMatch(html, /NaN/);
}

/* ---- isLabDefault guards the baseline comparison ---- */
{
  assert.equal(isLabDefault({ ...LAB_DEFAULTS }), true);
  assert.equal(isLabDefault({ ...LAB_DEFAULTS, bandwidthScale: 1.2 }), false);
  assert.equal(isLabDefault({ ...LAB_DEFAULTS, kNeighbors: 3 }), false);
  assert.equal(isLabDefault({ ...LAB_DEFAULTS, excludeOutliers: true }), false);
}

console.log("ModelLab tests passed");
