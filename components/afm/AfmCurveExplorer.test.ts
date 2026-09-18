import assert from "node:assert/strict";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AFM_CURVE_DATASET } from "@/lib/afm/afmCurves";
import { AfmCurveExplorer, curveBrowserTitle, curveDisplaySeries, hasVerifiedSourceComparison } from "./AfmCurveExplorer";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const html = renderToStaticMarkup(createElement(AfmCurveExplorer, { dataset: AFM_CURVE_DATASET }));
assert.match(html, /Browsable curves/);
assert.match(html, />164</);
assert.match(html, /103 new \+ 61 legacy/);
assert.match(html, /Metadata verified/);
assert.match(html, /Model ready/);
assert.match(html, />24</);
assert.match(html, /Paper suggestions/);
assert.match(html, /0 folders await review/);
assert.match(html, /Fully metadata verified \(25\)/);
assert.match(html, /All review states \(164\)/);
assert.match(html, /Paper link suggested \(0\)/);
assert.match(html, /Needs metadata review \(139\)/);
assert.match(html, /Manual \/ legacy source \(61\)/);
assert.match(html, /Counts also respect collection, paper focus and search/);
assert.match(html, /Ionic identity/);
assert.match(html, />164</);
assert.match(html, /Applied potential/);
assert.match(html, />84</);
assert.match(html, /Direct capacitance: 0/);
assert.match(html, /Related capacitance: 1/);
assert.match(html, /Electric field: 0/);
assert.match(html, /AFM force curve: \[Py1,4\]\[FAP\] · −1\.0 V vs Pt/i);
assert.match(html, /Source-verified measurement/);
assert.match(html, /reconstructed experimental curve/);
assert.match(html, /CSV · points \+ conditions/);
assert.match(html, /JSON · full record/);
assert.match(html, /PNG · chart image/);
assert.match(html, /Experimental system summary/);
assert.match(html, /Ionic liquid/);
assert.match(html, /Probe/);
assert.match(html, /Substrate/);
assert.match(html, /Interface and measurement conditions/);
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
assert.match(html, /Cross-curve condition trends/);
assert.match(html, /compatible conditions/);

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

const sourcePairedCurve = AFM_CURVE_DATASET.curves.find((curve) => curve.id === "AFM-26-07-28-07-C001");
assert.ok(sourcePairedCurve);
const sourceComparisonHtml = renderToStaticMarkup(createElement(AfmCurveExplorer, {
  dataset: { ...AFM_CURVE_DATASET, curves: [sourcePairedCurve] },
}));
assert.match(sourceComparisonHtml, /Original paper curve and platform digitization/);
assert.match(sourceComparisonHtml, /Original AFM curve panel from the paper/);
assert.match(sourceComparisonHtml, /01 · Original paper figure/);
assert.match(sourceComparisonHtml, /02 · Platform extraction/);
assert.match(sourceComparisonHtml, /Coordinates digitized from the matching source panel/);
assert.match(sourceComparisonHtml, /Figure 2 · row 1, column 1/);
assert.match(sourceComparisonHtml, /PDF p\.6/);
assert.match(sourceComparisonHtml, /7\.pdf/);
assert.match(sourceComparisonHtml, /QQ20260730-113643\.png/);
assert.match(sourceComparisonHtml, /\/api\/afm\/source-image\?curveId=AFM-26-07-28-07-C001/);
assert.equal(curveBrowserTitle(sourcePairedCurve), "[Py1,4][TFSA] · Au(111)");
assert.equal(hasVerifiedSourceComparison(sourcePairedCurve), true);

const sourceVerifiedCurveWithoutExactPdfCrop = AFM_CURVE_DATASET.curves.find((curve) => curve.id === "AFM-26-07-27-016-C001");
assert.ok(sourceVerifiedCurveWithoutExactPdfCrop);
assert.equal(sourceVerifiedCurveWithoutExactPdfCrop.source.figure, null);
assert.equal(hasVerifiedSourceComparison(sourceVerifiedCurveWithoutExactPdfCrop), true);
const sourceVerifiedComparisonHtml = renderToStaticMarkup(createElement(AfmCurveExplorer, {
  dataset: { ...AFM_CURVE_DATASET, curves: [sourceVerifiedCurveWithoutExactPdfCrop] },
}));
assert.match(sourceVerifiedComparisonHtml, /Original paper curve and platform digitization/);
assert.match(sourceVerifiedComparisonHtml, /Figure 1A/);
assert.match(sourceVerifiedComparisonHtml, /source-verified pairing/);
assert.match(sourceVerifiedComparisonHtml, /\/api\/afm\/source-image\?curveId=AFM-26-07-27-016-C001/);
assert.equal(
  AFM_CURVE_DATASET.curves.filter(hasVerifiedSourceComparison).length,
  AFM_CURVE_DATASET.summary.sourceVerifiedCurves,
);

const renamedPaperCurve = AFM_CURVE_DATASET.curves.find((curve) => curve.id === "AFM-26-07-27-013-C003");
assert.ok(renamedPaperCurve);
assert.equal(curveBrowserTitle(renamedPaperCurve), "PAN · mica");

const legacyCurve = AFM_CURVE_DATASET.curves.find((curve) => curve.id === "legacy-001");
assert.ok(legacyCurve);
const legacySeries = curveDisplaySeries(legacyCurve);
assert.equal(legacySeries.points.length, 30);
assert.equal(legacySeries.hiddenPointCount, 20);
const legacyHtml = renderToStaticMarkup(createElement(AfmCurveExplorer, {
  dataset: { ...AFM_CURVE_DATASET, curves: [legacyCurve] },
}));
assert.match(legacyHtml, /Fixed-grid representative curve from the legacy prediction model/);
assert.match(legacyHtml, /20 extrapolated points hidden/);
assert.match(legacyHtml, /stored model series and exports are unchanged/i);
assert.equal(curveBrowserTitle(legacyCurve), "[C2MIM][FAP]");
assert.match(legacyHtml, /修改3\.csv/);
assert.match(legacyHtml, /rows 2/);
assert.doesNotMatch(legacyHtml, /Original paper curve and platform digitization/);
assert.equal(hasVerifiedSourceComparison(legacyCurve), false);

console.log("AFM curve explorer tests passed");
