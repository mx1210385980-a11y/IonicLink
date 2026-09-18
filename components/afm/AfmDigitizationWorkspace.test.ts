import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  AfmSourceResultComparison,
  InheritedPanelContext,
  splitDisplaySegments,
  type AxisForm,
  type DigitizationCandidate,
} from "./AfmDigitizationWorkspace";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const candidate: DigitizationCandidate = {
  id: "page-5",
  page: 5,
  pageLabel: "PDF page 5 · figure crop",
  imageDataUrl: "data:image/png;base64,AA==",
  sourceFigure: {
    kind: "pdf-panel-crop",
    width: 305,
    height: 238,
    renderScale: 3,
    crop: { left: 0.05, top: 0.2, right: 0.95, bottom: 0.8 },
  },
  panel: {
    figureLabel: "1",
    label: "A",
    row: 0,
    column: 0,
    rows: 5,
    columns: 4,
    suggestedLabel: "[Li(G4)]TFSI · HOPG · +1 V",
    conditions: {
      ionicLiquid: { value: "[Li(G4)]TFSI", unit: null, status: "inferred", confidence: 0.96, evidence: "Figure 1 caption." },
      substrate: { value: "HOPG", unit: null, status: "inferred", confidence: 0.97, evidence: "Panels A-E." },
      electrodePotential: { value: 1, unit: "V", status: "inferred", confidence: 0.82, evidence: "Top row order." },
    },
  },
  analysis: {
    width: 1400,
    height: 760,
    plotBox: { left: 100, top: 60, right: 1300, bottom: 680 },
    normalizedPoints: [{ x: 0, y: 0.1 }, { x: 0.5, y: 0.8 }, { x: 1, y: 0.3 }],
    segmentStarts: [0],
    traceColor: { r: 15, g: 118, b: 110, hex: "#0f766e" },
    confidence: 0.9,
    axisConfidence: 0.9,
    traceConfidence: 0.9,
    coverage: 0.5,
    isLikelyCurve: true,
    rejectionReasons: [],
    xSpan: 1,
    ySpan: 0.7,
    largestSegmentShare: 1,
    quality: "high",
    warnings: [],
  },
  paperSignal: 42,
  rankScore: 1.1,
};
const axes: AxisForm = { xMin: "0", xMax: "5", yMin: "-2", yMax: "22", xUnit: "nm", yUnit: "nN" };
const points = candidate.analysis.normalizedPoints;
const calibrated: Array<[number, number]> = [[0, 0.4], [2.5, 17.2], [5, 5.2]];

const html = renderToStaticMarkup(createElement(AfmSourceResultComparison, {
  candidate,
  sourceName: "paper.pdf",
  normalizedPoints: points,
  calibrated,
  axes,
}));

assert.match(html, /data-testid="afm-source-result-comparison"/);
assert.match(html, /Original paper curve/);
assert.match(html, /Platform-digitized curve/);
assert.match(html, /paper\.pdf · page 5/);
assert.match(html, /305×238 px/);
assert.match(html, /PDF panel crop/);
assert.match(html, /physical axes/);
assert.match(html, /Separation \(nm\)/);
assert.match(html, /Force \(nN\)/);
assert.match(html, /data:image\/png;base64,AA==/);
assert.match(html, /<circle/, "digitized points remain visible even when disconnected segments are not joined");
assert.doesNotMatch(html, /red trace pixels/, "the clean source/result comparison must not contain the QA overlay markers");

const workspaceSource = readFileSync(new URL("./AfmDigitizationWorkspace.tsx", import.meta.url), "utf8");
assert.match(workspaceSource, /Export CSV points/);
assert.match(workspaceSource, /Export JSON record/);
assert.match(workspaceSource, /Export PNG chart/);
assert.match(workspaceSource, /RELATIVE COORDINATES · NOT MODEL-READY/);

const contextHtml = renderToStaticMarkup(createElement(InheritedPanelContext, { panel: candidate.panel! }));
assert.match(contextHtml, /Figure 1 · Panel A/);
assert.match(contextHtml, /\[Li\(G4\)\]TFSI/);
assert.match(contextHtml, /HOPG/);
assert.match(contextHtml, /\+1 V/);
assert.match(contextHtml, /INFERRED · REVIEW REQUIRED/);

const separated = splitDisplaySegments([{ x: 0, y: 0 }, { x: 5, y: 4 }, { x: 90, y: 90 }, { x: 94, y: 92 }], 100, 100);
assert.equal(separated.length, 2, "disconnected pixels must render as separate segments rather than a false diagonal");
const explicitlySeparated = splitDisplaySegments([{ x: 0, y: 0 }, { x: 5, y: 4 }, { x: 8, y: 5 }, { x: 12, y: 6 }], 100, 100, [0, 2]);
assert.equal(explicitlySeparated.length, 2, "recognition component boundaries must be preserved even when two fragments are visually close");

console.log("AFM source/result comparison tests passed");
