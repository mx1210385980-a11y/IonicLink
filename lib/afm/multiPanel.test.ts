import assert from "node:assert/strict";
import { createCanvas } from "@napi-rs/canvas";
import { detectAfmPanelBoxes, inferGenericAfmPanelConditions, parseAfmMultiPanelLayout } from "./multiPanel";

const caption = "Fig. 1 Typical normal forces versus apparent separation data for [Li(G4)] TFSI and [Li(G4)] NO3 on HOPG (A-E, K-O) and Au(111) (F-J, P-T) as a function of potential.";
const documentText = "At +0.5 V and +1 V the layers strengthen. At \u00020.5 V and \u00021 V a thin final layer is measured. The 0 V profile is the reference.";
const layout = parseAfmMultiPanelLayout(caption, documentText);
assert.ok(layout);
assert.equal(layout.figureLabel, "1");
assert.equal(layout.rows, 5);
assert.equal(layout.columns, 4);
assert.equal(layout.panels.length, 20);
assert.deepEqual(
  layout.panels.map((panel) => panel.label),
  "ABCDEFGHIJKLMNOPQRST".split(""),
);
assert.equal(layout.panels.find((panel) => panel.label === "A")?.conditions.ionicLiquid.value, "[Li(G4)]TFSI");
assert.equal(layout.panels.find((panel) => panel.label === "A")?.conditions.substrate.value, "HOPG");
assert.equal(layout.panels.find((panel) => panel.label === "A")?.conditions.electrodePotential.value, 1);
assert.equal(layout.panels.find((panel) => panel.label === "F")?.conditions.substrate.value, "Au(111)");
assert.equal(layout.panels.find((panel) => panel.label === "K")?.conditions.ionicLiquid.value, "[Li(G4)]NO3");
assert.equal(layout.panels.find((panel) => panel.label === "T")?.conditions.electrodePotential.value, -1);
assert.equal(layout.panels.find((panel) => panel.label === "T")?.conditions.electrodePotential.status, "inferred");

const detachedSubscriptLayout = parseAfmMultiPanelLayout(
  "Fig. 1 Typical normal forces versus apparent separation data for [Li(G4)] TFSI and [Li(G4)] NO on HOPG (A-E, K-O) and Au(111) (F-J, P-T) as a function 3 of potential.",
  documentText,
);
assert.equal(detachedSubscriptLayout?.panels.find((panel) => panel.label === "K")?.conditions.ionicLiquid.value, "[Li(G4)]NO3");

const demaCaption = "Figure 6. Influence of voltage on Pt and neat [Dema][TfO]. 2D histograms measured at voltages of (a) -1.5 V, (b) +0.5 V, (c) +2.0 V; (d) schematic; (e) separation histograms.";
assert.equal(inferGenericAfmPanelConditions(demaCaption, demaCaption, "A").electrodePotential.value, -1.5);
assert.equal(inferGenericAfmPanelConditions(demaCaption, demaCaption, "B").electrodePotential.value, 0.5);
assert.equal(inferGenericAfmPanelConditions(demaCaption, demaCaption, "C").electrodePotential.value, 2);

const width = 1200;
const height = 1000;
const canvas = createCanvas(width, height);
const context = canvas.getContext("2d");
context.fillStyle = "white";
context.fillRect(0, 0, width, height);
context.strokeStyle = "#1582b5";
context.lineWidth = 5;
for (let row = 0; row < 5; row += 1) {
  for (let column = 0; column < 4; column += 1) {
    const left = 65 + column * 285;
    const top = 60 + row * 180;
    context.beginPath();
    for (let point = 0; point <= 180; point += 1) {
      const x = left + point;
      const y = top + 25 + (point < 45 ? point * 2.2 : 105 + Math.sin(point / 11) * 5);
      if (point === 0) context.moveTo(x, y); else context.lineTo(x, y);
    }
    context.stroke();
  }
}
// Coloured figure decoration above the grid must not become a sixth panel row.
context.fillStyle = "#1582b5";
context.fillRect(200, 8, 160, 15);

const pixels = context.getImageData(0, 0, width, height);
const detected = detectAfmPanelBoxes({ width, height, data: pixels.data }, layout);
assert.equal(detected.length, 20);
assert.equal(detected[0].spec.label, "A");
assert.equal(detected[19].spec.label, "T");
assert.ok(detected.every((panel) => panel.box.right > panel.box.left && panel.box.bottom > panel.box.top));
assert.ok(detected[0].box.right < detected[5].box.right);
assert.ok(detected[0].box.bottom < detected[1].box.bottom);

console.log("AFM multi-panel parser and grid tests passed");
