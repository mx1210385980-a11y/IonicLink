import assert from "node:assert/strict";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import benchmark from "@/data/conductivity/electrochem-extractor-benchmark.json";
import { AFM_CURVE_DATASET } from "@/lib/afm/afmCurves";
import { AfmPresentationBriefing } from "./AfmPresentationBriefing";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const html = renderToStaticMarkup(createElement(AfmPresentationBriefing, {
  dataset: AFM_CURVE_DATASET,
  benchmark: benchmark.summary,
}));

assert.match(html, /Presentation snapshot/);
assert.match(html, /From paper figures to a model-ready interfacial dataset/);
assert.match(html, /158/);
assert.match(html, /14/);
assert.match(html, /13/);
assert.match(html, /23/);
assert.match(html, /\[Py1,4\]\[FAP\] on Au\(111\)/);
assert.match(html, /14\.9 µF\/cm²/);
assert.match(html, new RegExp(`${benchmark.summary.textValuePapersDetected}/${benchmark.summary.textValuePapers}`));
assert.match(html, new RegExp(`${benchmark.summary.nonTextPapersCorrectlyEmpty}/${benchmark.summary.nonTextPapers}`));
assert.match(html, /False positives/);
assert.match(html, /No MD in current scope/);

console.log("AFM presentation briefing tests passed");
