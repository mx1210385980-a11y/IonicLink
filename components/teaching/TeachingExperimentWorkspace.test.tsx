import assert from "node:assert/strict";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TeachingExtractionExperiment, TeachingPredictionExperiment } from "./TeachingExperimentWorkspace";

(globalThis as typeof globalThis & { React: typeof React }).React = React;
const extractionHtml = renderToStaticMarkup(createElement(TeachingExtractionExperiment));
const teacherHtml = renderToStaticMarkup(createElement(TeachingExtractionExperiment, { isAdmin: true }));
const predictionHtml = renderToStaticMarkup(createElement(TeachingPredictionExperiment));
for (const html of [extractionHtml, predictionHtml]) {
  assert.equal((html.match(/<h1/g) ?? []).length, 1);
  assert.match(html, /id="ai-experiment-title"[^>]*>AI experiment</);
}
assert.match(extractionHtml, /id="data-extraction-title"[^>]*>Experiment Ⅰ- Data Extraction</);
assert.match(predictionHtml, /id="prediction-title"[^>]*>Experiment Ⅱ- Prediction of μ</);
assert.ok(!extractionHtml.includes('id="prediction"'), "Experiment Ⅰ no longer embeds the prediction panel");
assert.ok(!predictionHtml.includes('id="data-extraction"'), "Experiment Ⅱ no longer embeds the extraction panel");
assert.match(extractionHtml, /data-testid="live-student"/, "students get the join-and-extract live workspace");
assert.match(teacherHtml, /data-testid="live-teacher"/, "administrators get the experiment console");
assert.match(teacherHtml, /开展实验/, "teachers can open a new experiment session");
assert.match(predictionHtml, /True vs Predicted/);
assert.match(predictionHtml, /Literature validation/);
assert.match(predictionHtml, /type="checkbox"/);
console.log("AI experiment splits extraction and prediction into two full-width subpages");
