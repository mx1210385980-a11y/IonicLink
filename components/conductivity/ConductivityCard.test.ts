import assert from "node:assert/strict";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildConductivityConditions, buildConductivityPerformance, buildConductivityPerformanceFigure, ConductivityCard } from "./ConductivityCard";
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
  cellConfiguration: "three-electrode",
  cellSetup: "three-electrode glass cell",
  workingElectrode: "Pt disk",
  counterElectrode: "Pt wire",
  referenceElectrode: "Ag/AgCl",
  pressure: "1 atm",
  electrochemicalWindow: "-2.0–2.5 V",
  chargeTransferResistance: "4.2 kΩ",
  method: "EIS",
  viscosity: "104 cP",
  performanceFigure: {
    figure: "Fig. 3b",
    page: 5,
    curveType: "conductivity-temperature",
    xAxis: "Temperature / K",
    yAxis: "Ionic conductivity / mS cm−1",
    seriesLabel: "[BMIM][BF4]",
    caption: "Fig. 3b. Ionic conductivity as a function of temperature.",
    primaryField: "conductivity",
    keyPoints: [{ label: "Ionic conductivity", field: "conductivity", condition: "298 K", value: "3.5 mS/cm", kind: "coordinate", x: "298 K", y: "3.5 mS/cm", source: "paper-text", confidence: 1 }],
    panels: [
      { label: "A", title: "conductivity data", figureBox: { x: 0.1, y: 0.2, w: 0.28, h: 0.4 }, source: "paper-text", confidence: 0.9 },
      { label: "B", title: "VTF fit", figureBox: { x: 0.42, y: 0.2, w: 0.28, h: 0.4 }, keyPoints: [{ label: "VTF slope", value: "−2.1", slope: "−2.1", kind: "slope", source: "image-estimated", confidence: 0.72 }] },
    ],
    dataStatus: "mixed-key-points",
    figureBox: { x: 0.1, y: 0.2, w: 0.6, h: 0.4 },
  },
});
const record = {
  ...draft,
  id: "#001",
  status: "official" as const,
  createdAt: "",
  sourceId: "11111111-1111-4111-8111-111111111111",
};
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
assert.match(html, /data-testid="ion-card-cation"/);
assert.match(html, /data-testid="ion-card-anion"/);
assert.match(html, /\[BMIM\][\s\S]*data-testid="ion-charge-cation"/, "cation charge follows the ion formula");
assert.match(html, /\[BF4\][\s\S]*data-testid="ion-charge-anion"/, "anion charge follows the ion formula");
assert.match(html, /SMILES/);
assert.match(html, /C8H15N2\+/);
assert.match(html, /Mᵣ/);
// the electrochemical zone shows surface + method
assert.match(html, /data-testid="cell-panel"/);
assert.match(html, /Pt/);
assert.match(html, /EIS/);
assert.match(html, /3-electrode/);
assert.match(html, /Pt disk/);
assert.match(html, /Pt wire/);
assert.match(html, /data-testid="electrode-cell-diagram"/);
assert.match(html, />WE<\/text>/, "three-electrode diagrams show electrode roles, not fixed polarity");
assert.match(html, />CE<\/text>/);
assert.match(html, />RE<\/text>/);
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
assert.match(html, /data-testid="performance-figure"/);
assert.match(html, /conductivity-temperature/);
assert.match(html, /Matching series/);
assert.doesNotMatch(html, /Figure caption \/ annotation/);
assert.doesNotMatch(html, /Ionic conductivity as a function of temperature/);
assert.match(html, /Curve insights/);
assert.match(html, /data-testid="curve-insight"/);
assert.match(html, /data-testid="performance-figure-pagination"/);
assert.match(html, /Panel A · 1\/2/);
assert.doesNotMatch(html, /Structured landmarks are ready for modelling/);
assert.match(html, /Sparse landmarks, not a full series/);
assert.match(html, /Temperature \/ K/);
assert.match(html, /298 K/);
assert.match(html, /3\.5 mS\/cm/);
assert.match(html, /format=figure/);
assert.match(html, /Fig\. 3 · A/);
assert.equal(buildConductivityPerformanceFigure(record)?.primaryField, "conductivity");

const warmerRecord = {
  ...record,
  id: "#002",
  core: { ...record.core, temperature: { ...record.core.temperature!, raw: "50 °C", value: 50, std: 323.15 }, conductivity: { ...record.core.conductivity!, raw: "7.0 mS/cm", value: 7, std: 0.7 } },
};
const dependencyHtml = renderToStaticMarkup(createElement(ConductivityCard, { record, comparisonRecords: [record, warmerRecord] }));
assert.match(dependencyHtml, /Property dependence/);
assert.match(dependencyHtml, /Ionic conductivity dependence on temperature/);
assert.match(dependencyHtml, /3\.5 mS\/cm/);
assert.match(dependencyHtml, /7\.0 mS\/cm/);
assert.match(dependencyHtml, /not a causal claim/);

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

const bulkDraft = ingest({
  paper: { title: "Bulk conductivity" },
  cation: "[EMIM]",
  anion: "[TFSI]",
  surface: "bulk liquid",
  conductivity: "1.2 S/m",
  method: "conductivity cell; viscometer",
});
const bulkHtml = renderToStaticMarkup(createElement(ConductivityCard, {
  record: { ...bulkDraft, id: "#bulk", status: "official" as const, createdAt: "" },
}));
assert.match(bulkHtml, /not applicable/i);
assert.match(bulkHtml, /BULK PROPERTY/);
assert.doesNotMatch(bulkHtml, />\?<\/text>/, "bulk records must not show invented unknown electrode signs");

console.log("ConductivityCard tests passed");
