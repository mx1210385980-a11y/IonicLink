import assert from "node:assert/strict";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DiffusionCard } from "./DiffusionCard";
import { ingest } from "@/lib/diffusion/ingest";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const draft = ingest({
  paper: { title: "Test diffusion paper" },
  cation: "[EMIM]",
  anion: "[TFSI]",
  species: "cation",
  temperature: "303 K",
  diffusion: "6.2 × 10⁻¹¹ m² s⁻¹",
  method: "PFG-NMR",
  nucleus: "¹H",
  viscosity: "28 cP",
});
const record = { ...draft, id: "#001", status: "official" as const, createdAt: "" };
record.flexible = [{ key: "sequence note", value: "kept as flexible diffusion context" }];

const html = renderToStaticMarkup(createElement(DiffusionCard, { record }));
const actionsHtml = renderToStaticMarkup(
  createElement(DiffusionCard, {
    record,
    actions: createElement("button", null, "Edit"),
  }),
);

// D readout renders the reported value + label
assert.match(html, /6\.2 × 10⁻¹¹ m² s⁻¹/);
assert.match(html, /Diffusion coefficient/);
// title reflects the diffusing species, and the Species chip is gone from conditions
assert.match(html, /Diffusion coefficient of cation/);
assert.doesNotMatch(html, /Species/);
const anionRecord = { ...record, core: { ...record.core, species: "anion" } };
const anionHtml = renderToStaticMarkup(createElement(DiffusionCard, { record: anionRecord }));
assert.match(anionHtml, /Diffusion coefficient of anion/);
const overallRecord = { ...record, core: { ...record.core, species: "overall" } };
const overallHtml = renderToStaticMarkup(createElement(DiffusionCard, { record: overallRecord }));
assert.match(overallHtml, /Diffusion coefficient of all species/);
assert.match(html, />checked</);
assert.doesNotMatch(html, />official</);
assert.match(html, /record-card-unified-text/);
// standardized line is hidden for checked records
assert.doesNotMatch(html, /62 µm²\/s/);
// the ionic-identity section is reused from the shared parts
assert.match(html, /data-testid="ionic-liquid-panel"/);
assert.match(html, /\[EMIM\]/);
assert.match(html, /data-testid="confined-system-panel"/);
assert.match(html, /cation/);
// other domains' visuals must NOT leak into the diffusion card
assert.doesNotMatch(html, /afm-probe-illustration/);
assert.doesNotMatch(html, /Coefficient of friction/);
assert.doesNotMatch(html, /Ionic conductivity/);
// flexible/raw context stays in the record model but is omitted from the reading card
assert.doesNotMatch(html, /data-testid="raw-flexible-panel"/);
assert.doesNotMatch(html, /kept as flexible diffusion context/);
assert.match(html, /Reported Conditions/);
assert.doesNotMatch(actionsHtml, /core complete/);
assert.match(actionsHtml, />Edit<\/button>/);

const record1D = { ...record, extended: { ...record.extended, geometry: "carbon nanotube" } };
const html1D = renderToStaticMarkup(createElement(DiffusionCard, { record: record1D }));
assert.match(html1D, /one-dimensional cylindrical channel/);

const record2D = { ...record, extended: { ...record.extended, geometry: "slit pore" } };
const html2D = renderToStaticMarkup(createElement(DiffusionCard, { record: record2D }));
assert.match(html2D, /two-dimensional slit pore/);

const recordMembrane = { ...record, extended: { ...record.extended, geometry: "mesoporous carbon network" } };
const htmlMembrane = renderToStaticMarkup(createElement(DiffusionCard, { record: recordMembrane }));
assert.match(htmlMembrane, /tortuous porous membrane/);

const record3D = { ...record, extended: { ...record.extended, geometry: "MOF cage" } };
const html3D = renderToStaticMarkup(createElement(DiffusionCard, { record: record3D }));
assert.match(html3D, /three-dimensional framework cage/);

const reviewRecord = { ...record, status: "review" as const, confidence: 0.81 };
const htmlReview = renderToStaticMarkup(createElement(DiffusionCard, { record: reviewRecord }));
assert.match(htmlReview, /standardized · 6\.2 × 10⁻¹¹ m²\/s/);

console.log("DiffusionCard tests passed");
