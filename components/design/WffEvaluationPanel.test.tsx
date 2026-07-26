import assert from "node:assert/strict";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { parseWffCsv, type WffParsedRow } from "../../lib/predict/wffEvaluation";
import { WffEvaluationPanel } from "./WffEvaluationPanel";
import type { WffDatasetData, WffPaperReport } from "../../lib/predict/wffEvaluation.server";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const csv = `source_literature_key,source_literature_title,wff_dataset,Cation,anion,compound,surface,h,T,μ,friction_bin,cation_bin,stratify_label,original_index,friction_pred,friction_diff,error_flag
paper_a,Paper A,no_film,[A]+,[X]-,zero,mica,1.2,298,0.10,0,alpha,0_alpha,1,0.12,0.02,
paper_a,Paper A,no_film,[B]+,[X]-,zero,mica,1.3,298,0.20,0,alpha,0_alpha,2,0.18,-0.02,
paper_a,Paper A,no_film,[C]+,[X]-,zero,mica,1.4,298,0.30,0,alpha,0_alpha,3,0.33,0.03,
paper_b,Paper B,no_film,[G]+,[Y]-,zero,Au(111),2.1,339,0.70,1,beta,1_beta,7,0.73,0.03,
paper_b,Paper B,no_film,[H]+,[Y]-,zero,Au(111),2.2,339,0.80,1,beta,1_beta,8,0.76,-0.04,
paper_d,Paper D,no_film,[S]+,[Q]-,zero,silica,,298,1.30,3,single,3_single,13,-0.10,-1.40,high error
`;

function ds(datasetId: "dataset-a" | "dataset-b", label: string, rows: WffParsedRow[]): WffDatasetData {
  return { datasetId, label, rows, sourceRowCount: rows.length };
}

const rows = parseWffCsv(csv);
const paperReport: WffPaperReport = {
  config: { dataset: "Dataset B gated hybrid", seed: 42 },
  target_metrics: {
    test: { r2: 0.991, mae: 0.057, rmse: 0.089 },
    external_literature: { r2: 0.985, mae: 0.04, rmse: 0.046 },
  },
  metrics: {
    train: { n: 12, r2: 0.998, mae: 0.021, rmse: 0.032 },
    test: { n: 4, r2: 0.991, mae: 0.057, rmse: 0.089 },
    external_literature: { n: 3, r2: 0.985, mae: 0.04, rmse: 0.046 },
  },
  deltas: {
    test: { r2: 0, mae: 0, rmse: 0 },
    external_literature: { r2: 0, mae: 0, rmse: 0 },
  },
  region_counts: { low: 6, mid: 5, high: 4 },
  tolerances: { r2: 0.005, mae: 0.005, rmse: 0.005 },
  within_tolerance: true,
};
const data = { datasetA: ds("dataset-a", "Dataset A · baseline", rows), datasetB: ds("dataset-b", "Dataset B · film-aware", rows), paperReport };
const html = renderToStaticMarkup(createElement(WffEvaluationPanel, { data }));

assert.match(html, /Model Evaluation Lab/);
assert.match(html, /Teaching dataset/);
assert.match(html, /Evaluation Settings/);
assert.match(html, /Stratify by/);
assert.match(html, /Test size/);
assert.match(html, /Random seed/);
assert.match(html, /Drop flagged rows/);
assert.match(html, /Dataset A · baseline/);
assert.match(html, /Dataset B · film-aware/);
assert.match(html, /Dataset view/);
assert.doesNotMatch(html, /Dataset A · baseline <span/, "Dataset A is available in the switcher, but its full panel is not stacked by default");
assert.match(html, /Dataset B · film-aware <span/, "Dataset B is the default active detail panel");
assert.match(html, /Model/);
assert.match(html, /Gradient boosting/);
assert.match(html, /Training &amp; Testing Performance/);
assert.match(html, /Held-out literature/);
assert.match(html, /out-of-sample/);
assert.match(html, /External experiment/);
assert.match(html, /Experimental COF/);
assert.match(html, /Predicted COF/);
assert.match(html, /MAE\(M1\)/);
assert.match(html, /Y = X/);
assert.match(html, /Export CSV/);
assert.match(html, /PNG/);
assert.match(html, /Prediction Detail Table/);
assert.match(html, /singleton strata/);
assert.match(html, /Paper Reproduction/);
assert.match(html, /Target/);
assert.match(html, /Reproduced/);
assert.match(html, /0\.991/);
assert.match(html, /0\.057/);
assert.match(html, /within tolerance/);
// student-facing copy stays free of the thesis-author initials
assert.doesNotMatch(html, /WFF/);

const missingHtml = renderToStaticMarkup(createElement(WffEvaluationPanel, { data: { ...data, paperReport: null } }));
assert.match(missingHtml, /Paper Reproduction/);
assert.match(missingHtml, /npm run wff:reproduce/);
assert.doesNotMatch(missingHtml, /WFF/);

const bestCurrentReport: WffPaperReport = {
  ...paperReport,
  config: { model: "best_current_ensemble", profile: "balanced" },
  within_tolerance: false,
};
const bestCurrentHtml = renderToStaticMarkup(
  createElement(WffEvaluationPanel, { data: { ...data, paperReport: bestCurrentReport } })
);
assert.match(bestCurrentHtml, /Best Current Model/);
assert.match(bestCurrentHtml, /strongest current-data profile/);

console.log("WFF evaluation panel tests passed");
