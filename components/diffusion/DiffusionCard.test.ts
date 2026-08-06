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
assert.match(html, /Self-diffusion/);
assert.match(html, />checked</);
assert.doesNotMatch(html, />official</);
assert.match(html, /record-card-unified-text/);
// standardized line uses the µm²/s ladder
assert.match(html, /62 µm²\/s/);
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
assert.match(html1D, /one-dimensional confined channel/);

const record2D = { ...record, extended: { ...record.extended, geometry: "slit pore" } };
const html2D = renderToStaticMarkup(createElement(DiffusionCard, { record: record2D }));
assert.match(html2D, /two-dimensional slit channel/);

const record3D = { ...record, extended: { ...record.extended, geometry: "mesoporous carbon network" } };
const html3D = renderToStaticMarkup(createElement(DiffusionCard, { record: record3D }));
assert.match(html3D, /three-dimensional porous network/);

console.log("DiffusionCard tests passed");
