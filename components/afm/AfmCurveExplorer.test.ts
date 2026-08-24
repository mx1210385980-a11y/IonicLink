import assert from "node:assert/strict";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AFM_CURVE_DATASET } from "@/lib/afm/afmCurves";
import { AfmCurveExplorer } from "./AfmCurveExplorer";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const html = renderToStaticMarkup(createElement(AfmCurveExplorer, { dataset: AFM_CURVE_DATASET }));
assert.match(html, /Browsable curves/);
assert.match(html, />158</);
assert.match(html, /97 new \+ 61 legacy/);
assert.match(html, /Metadata verified/);
assert.match(html, /Model ready/);
assert.match(html, />13</);
assert.match(html, /Paper suggestions/);
assert.match(html, />83</);
assert.match(html, /12 folders await review/);
assert.match(html, /Paper match suggested/);
assert.match(html, /Ionic identity/);
assert.match(html, />75</);
assert.match(html, /Applied potential/);
assert.match(html, />64</);
assert.match(html, /Direct capacitance: 0/);
assert.match(html, /Related capacitance: 1/);
assert.match(html, /Electric field: 0/);
assert.match(html, /AFM force curve: \[Py1,4\]\[FAP\] · −1\.0 V vs Pt/i);
assert.match(html, /Source-verified measurement/);
assert.match(html, /Digitized experimental points/);
assert.match(html, /CSV · points \+ conditions/);
assert.match(html, /JSON · full record/);
assert.match(html, /PNG · chart image/);
assert.match(html, /Five-part system summary/);
assert.match(html, /Ionic liquid/);
assert.match(html, /Probe/);
assert.match(html, /Substrate/);
assert.match(html, /Contact interface/);
assert.match(html, /External factors/);
assert.match(html, /data-testid="molecule-view-cation"/i);
assert.match(html, /data-testid="molecule-view-anion"/i);
assert.match(html, /data-ion-source="curated"/i);
assert.match(html, /Review, acquisition and provenance details/);
assert.match(html, /c0cp02846k\.pdf/);
assert.match(html, /9\/9 required fields present/);
assert.match(html, /all required metadata fields are source-verified/i);
assert.match(html, /Digital Instruments Nanoscope IIIa Multimode AFM/);
assert.match(html, /Not reported in reviewed paper/);
assert.doesNotMatch(html, /predicted force curve/i);

const relatedCurve = AFM_CURVE_DATASET.curves.find((curve) => curve.id === "AFM-26-07-28-05-C002");
assert.ok(relatedCurve);
const relatedHtml = renderToStaticMarkup(createElement(AfmCurveExplorer, {
  dataset: { ...AFM_CURVE_DATASET, curves: [relatedCurve] },
}));
assert.match(relatedHtml, /Solvation-layer structure/);
assert.match(relatedHtml, /6 layers/);
assert.match(relatedHtml, /Median spacing/);
assert.match(relatedHtml, /Related electrochemistry/);
assert.match(relatedHtml, /14\.9 µF\/cm²/);
assert.match(relatedHtml, /separate EIS experiment/i);
assert.match(relatedHtml, /Model ready/);

console.log("AFM curve explorer tests passed");
