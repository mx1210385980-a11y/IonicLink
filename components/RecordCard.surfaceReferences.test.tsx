import assert from "node:assert/strict";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RecordCard } from "./RecordCard";
import { parseQuantity } from "../lib/units";
import type { IonicRecord } from "../lib/schema";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const record: IonicRecord = {
  id: "#REF",
  status: "review",
  createdAt: "2026-08-26T00:00:00.000Z",
  paper: { title: "Surface reference display" },
  core: {
    ionicLiquid: { cation: "[EtNH3]", anion: "[NO3]" },
    substrate: "silica (SiO2 wafer)",
    temperature: parseQuantity("not stated", "temperature"),
    load: parseQuantity("0-80 nN", "force"),
    cof: 0.15,
  },
  extended: { scale: "nano", method: "Colloid probe AFM", probe: "silica" },
  flexible: [{ key: "medium", value: "EAN" }],
};

const html = renderToStaticMarkup(createElement(RecordCard, { record }));
assert.doesNotMatch(html, /surface-reference-|External reference|310 ± 20|Surface energy|Contact angle/);

const reported = { ...record, extended: { ...record.extended, surface: { contactAngle: parseQuantity("42°", "angle")! } } };
const reportedHtml = renderToStaticMarkup(createElement(RecordCard, { record: reported }));
assert.match(reportedHtml, /Contact angle/);
assert.match(reportedHtml, /42/);
assert.doesNotMatch(reportedHtml, /External reference/);

const recordWithoutSurfaceData: IonicRecord = {
  ...record,
  id: "#NO-SURFACE-DATA",
  core: { ...record.core, substrate: "unmapped test surface" },
};
const emptySurfaceHtml = renderToStaticMarkup(createElement(RecordCard, { record: recordWithoutSurfaceData }));
assert.doesNotMatch(emptySurfaceHtml, /Surface energy/);
assert.doesNotMatch(emptySurfaceHtml, /Surface charge/);
assert.doesNotMatch(emptySurfaceHtml, /Contact angle/);
assert.doesNotMatch(emptySurfaceHtml, /data-testid="tribopair-inline-spec"/);

console.log("RecordCard surface reference tests passed");
