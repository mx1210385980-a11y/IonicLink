import assert from "node:assert/strict";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildConductivityConditions, buildConductivityPerformance, ConductivityCard } from "./ConductivityCard";
import { ingest } from "@/lib/conductivity/ingest";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const draft = ingest({
  paper: { title: "Test conductivity paper" },
  cation: "[BMIM]",
  anion: "[BF4]",
  surface: "Pt",
  temperature: "25 °C",
  conductivity: "3.5 mS/cm",
  capacitance: "120 pF",
  electricField: "2 kV/cm",
  electrodePotential: "-1.0 V",
  potentialReference: "Ag/AgCl",
  pressure: "1 atm",
  electrochemicalWindow: "-2.0–2.5 V",
  chargeTransferResistance: "4.2 kΩ",
  method: "EIS",
  viscosity: "104 cP",
});
const record = { ...draft, id: "#001", status: "official" as const, createdAt: "" };
record.flexible = [{ key: "instrument note", value: "kept as flexible context" }];

const html = renderToStaticMarkup(createElement(ConductivityCard, { record }));
const standardizedHtml = renderToStaticMarkup(createElement(ConductivityCard, { record, units: "std" }));
const actionsHtml = renderToStaticMarkup(
  createElement(ConductivityCard, {
    record,
    actions: createElement("button", null, "Edit"),
  }),
);

// σ readout renders the reported value + label
assert.match(html, /3\.5 mS\/cm/);
assert.match(html, /Ionic conductivity/);
assert.match(standardizedHtml, /298\.1 K/, "standardized cards convert reported temperatures to kelvin");
assert.doesNotMatch(standardizedHtml, />25 °C</);
assert.match(html, />checked</);
assert.doesNotMatch(html, />official</);
assert.match(html, /record-card-unified-text/);
// the ionic-identity section is reused from the shared parts
assert.match(html, /data-testid="ionic-liquid-panel"/);
assert.match(html, /\[BMIM\]/);
// the electrochemical zone shows surface + method
assert.match(html, /data-testid="cell-panel"/);
assert.match(html, /Pt/);
assert.match(html, /EIS/);
// optional electrical measurements render in the condition area
assert.match(html, /Capacitance/);
assert.match(html, /120 pF/);
assert.match(html, /Electric field/);
assert.match(html, /2 kV\/cm/);
assert.match(html, /Potential/);
assert.match(html, /Ag\/AgCl/);
assert.match(html, /Charge-transfer resistance/);
assert.match(html, /Electrochemical performance/);
assert.match(html, /Electrochemical window/);
assert.match(html, /Viscosity/);
assert.match(html, /Pressure/);
assert.match(html, /1 atm/);

const performance = buildConductivityPerformance(record, "std");
assert.deepEqual(
  performance.map((item) => item.field),
  ["conductivity", "capacitance", "electricField", "viscosity", "electrochemicalWindow", "chargeTransferResistance"],
);
const conditionFields = buildConductivityConditions(record, "std").map((item) => item.field);
assert.ok(conditionFields.includes("temperature"));
assert.ok(conditionFields.includes("pressure"));
assert.ok(!conditionFields.includes("electricField"));
assert.ok(conditionFields.includes("electrodePotential"));
assert.ok(!conditionFields.includes("capacitance"));
assert.ok(!conditionFields.includes("viscosity"));
assert.ok(!conditionFields.includes("electrochemicalWindow"));
assert.ok(!conditionFields.includes("chargeTransferResistance"));
// friction visuals must NOT leak into the conductivity card
assert.doesNotMatch(html, /afm-probe-illustration/);
assert.doesNotMatch(html, /Coefficient of friction/);
// flexible experimental context remains visible under reported conditions
assert.doesNotMatch(html, /data-testid="raw-flexible-panel"/);
assert.match(html, /kept as flexible context/);
assert.match(html, /Reported conditions/);
assert.doesNotMatch(actionsHtml, /core complete/);
assert.match(actionsHtml, />Edit<\/button>/);

console.log("ConductivityCard tests passed");
