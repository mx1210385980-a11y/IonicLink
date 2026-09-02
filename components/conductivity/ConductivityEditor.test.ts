import assert from "node:assert/strict";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ingest } from "@/lib/conductivity/ingest";
import { ConductivityEditor } from "./ConductivityEditor";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const draft = ingest({
  paper: { title: "Electrical measurements" },
  cation: "[EMIM]",
  anion: "[BF4]",
  surface: "Pt",
  temperature: "298 K",
  conductivity: "3.5 mS/cm",
  capacitance: "120 pF",
  electricField: "2 kV/cm",
  electrodePotential: "-1.0 V",
  potentialReference: "Ag/AgCl",
  pressure: "1 atm",
  electrochemicalWindow: "-2.0–2.5 V",
  chargeTransferResistance: "4.2 kΩ",
});
const record = { ...draft, id: "#001", status: "review" as const, createdAt: "" };
const html = renderToStaticMarkup(
  createElement(ConductivityEditor, { record, onSaved: () => undefined, onCancel: () => undefined }),
);

assert.match(html, /Electrical measurements · optional/);
assert.match(html, /Capacitance/);
assert.match(html, /value="120 pF"/);
assert.match(html, /Electric field/);
assert.match(html, /value="2 kV\/cm"/);
assert.match(html, /1\.2e-10 F/);
assert.match(html, /200000 V\/m/);
assert.match(html, /Electrode potential/);
assert.match(html, /Potential reference/);
assert.match(html, /Pressure/);
assert.match(html, /101\.3 kPa/);
assert.match(html, /Electrochemical window/);
assert.match(html, /Charge-transfer resistance/);

console.log("ConductivityEditor tests passed");
