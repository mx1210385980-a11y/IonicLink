import assert from "node:assert/strict";
import { buildRelevantFigurePanels, parseCaptionPanels } from "./performanceFigurePanels";

const caption = "Fig. 4. (a) EIS spectra of several electrodes, (b) CV curves, (c) CV curves at different scan rates and (d) the relationships of Ip vs. v.";
const located=Array.from({length:4},(_,i)=>({x:0.05+(i%2)*0.4,y:0.1+Math.floor(i/2)*0.4,w:0.35,h:0.35}));
assert.deepEqual(parseCaptionPanels(caption).map((panel) => panel.label), ["A", "B", "C", "D"]);

const eis = buildRelevantFigurePanels({
  figure: "Fig. 4a",
  page: 4,
  curveType: "EIS Nyquist plot",
  primaryField: "chargeTransferResistance",
  caption,
  figureBox: { x: 0.05, y: 0.45, w: 0.66, h: 0.34 },
},located);
assert.equal(eis.length, 1);
assert.equal(eis[0].label, "A");
assert.ok((eis[0].figureBox?.w ?? 1) < 0.4, "a four-panel figure is cropped to one cell");

const electrochem = buildRelevantFigurePanels({
  figure: "Fig. 2",
  curveType: "EIS Nyquist plot",
  primaryField: "chargeTransferResistance",
  caption: "Figure 2. Impedance analysis: the Nyquist plots (a); the Bode plots (b) and the equivalent circuit (c).",
  figureBox: { x: 0.05, y: 0.2, w: 0.9, h: 0.5 },
},located.slice(0,3));
assert.deepEqual(electrochem.map((panel) => panel.label), ["A", "B"]);

const range = buildRelevantFigurePanels({
  figure: "Fig. 5",
  curveType: "EIS Nyquist plot",
  primaryField: "chargeTransferResistance",
  caption: "Fig. 5. (a–c): Nyquist and Bode frequency plots for three ionic liquids; (d): Equivalent circuit.",
  figureBox: { x: 0.05, y: 0.2, w: 0.9, h: 0.5 },
},located);
assert.deepEqual(range.map((panel) => panel.label), ["A", "B", "C"]);
assert.deepEqual(parseCaptionPanels("Figure 3. a) Nyquist plots. b) Warburg coefficients. c) capacitance. d) phase angle.").map(p=>p.label),["A","B","C","D"]);
assert.deepEqual(buildRelevantFigurePanels({figure:"Fig. 4a",curveType:"EIS",caption,figureBox:{x:0.1,y:0.2,w:0.8,h:0.7}}),[],"caption labels alone cannot justify a crop grid");

console.log("Conductivity performance-figure panel tests passed");
