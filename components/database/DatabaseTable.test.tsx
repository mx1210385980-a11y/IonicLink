import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DatabaseTable, type DatabaseTableProps } from "./DatabaseTable";
import { defaultColumns, getAnalysisFields } from "./analysisFields";
import type { AnalysisRecord } from "./analysisTypes";

const sample: AnalysisRecord = {
  id: "r1", status: "official", createdAt: "2026-09-12", paper: { title: "Paper A" },
  core: { ionicLiquid: { cation: "[BMIM]", anion: "[BF4]" }, cof: 0.1, temperature: { raw: "not stated", value: null, unit: "", std: 293.15, stdUnit: "K", approx: true } },
  extended: {}, flexible: [], sourceId: "source-1",
  provenance: { cof: { page: 3, quote: "COF = 0.1", basis: "direct" }, temperature: { basis: "assumed", basisNote: "Room-temperature convention" } },
};
const base: DatabaseTableProps = {
  domain: "tribology", records: [sample], fields: getAnalysisFields("tribology"), columns: defaultColumns("tribology"),
  onColumnsChange: () => {}, sort: { key: "metric", direction: "asc" }, onSortChange: () => {},
  units: "std", density: "compact", compareIds: new Set(["r1"]), onToggleCompare: () => {}, onOpenRecord: () => {}, disabled: false,
};
const html = renderToStaticMarkup(createElement(DatabaseTable, base));
assert.match(html, /<table/);
assert.match(html, /aria-sort="ascending"/);
assert.match(html, /Open evidence for COF in r1/);
assert.match(html, /Direct/);
assert.match(html, /Assumed/);
assert.match(html, /As reported: not stated/);
assert.match(html, /aria-pressed="true"/);
assert.match(html, /Open record r1/);
assert.match(html, /Record \(fixed\)/);
assert.match(html, /sticky left-0/);
assert.match(html, /sticky right-0 z-30/, "Action headers remain visible during horizontal scrolling");
assert.match(html, /sticky right-0 z-10/, "Row actions remain reachable during horizontal scrolling");
const longPaper = "Temperature and load dependence of ionic-liquid lubrication between graphite and metal surfaces across multiple experimental conditions";
const longContent = renderToStaticMarkup(createElement(DatabaseTable, { ...base, records: [{ ...sample, paper: { title: longPaper }, extended: { method: "Atomic force microscopy with a colloidal probe under controlled atmosphere" } }] }));
assert.ok(longContent.includes(`title="${longPaper}"`), "The complete paper title remains available when its visible text is clamped");
assert.match(longContent, /max-w-64 line-clamp-2/);
assert.match(longContent, /max-w-48 line-clamp-2/);
assert.match(longContent, /sm:inline-flex">Details/, "Narrow screens can use the fixed record ID to open details");
const minimal = renderToStaticMarkup(createElement(DatabaseTable, { ...base, columns: ["metric"], density: "comfortable", disabled: true }));
assert.match(minimal, /Sort by Record/, "The record identifier remains visible even if absent from column state");
assert.doesNotMatch(minimal, /Sort by Cation/);
assert.match(minimal, /disabled=""/);
assert.match(minimal, /px-4 py-3 text-base/);
const empty = renderToStaticMarkup(createElement(DatabaseTable, { ...base, records: [] }));
assert.match(empty, /No records in this view/);
for (const domain of ["conductivity", "diffusion"] as const) {
  const primaryKey = domain === "conductivity" ? "conductivity" : "diffusion";
  const record = { ...sample, core: { [primaryKey]: { raw: "12 unit", value: 12, std: 12, unit: "unit", stdUnit: "unit" } }, provenance: { [primaryKey]: { page: 2, basis: "direct" as const } } };
  const markup = renderToStaticMarkup(createElement(DatabaseTable, { ...base, domain, records: [record], fields: getAnalysisFields(domain), columns: defaultColumns(domain) }));
  assert.match(markup, new RegExp(`Open evidence for ${domain === "conductivity" ? "Conductivity" : "Diffusion D"} in r1`));
}
console.log("Database table rendering, provenance, density and domain tests passed");
