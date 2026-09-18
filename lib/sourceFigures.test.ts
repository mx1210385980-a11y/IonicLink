import assert from "node:assert/strict";
import { inferFigureBoxFromSpans, validFigureBox } from "./sourceFigures";

const fullWidth = inferFigureBoxFromSpans([
  { str: "Figure 4.", x: 0.08, y: 0.72, w: 0.12, h: 0.02 },
  { str: "Ionic conductivity as a function of temperature.", x: 0.21, y: 0.72, w: 0.61, h: 0.02 },
], "Fig. 4a");
assert.ok(fullWidth, "a numbered caption locates an automatic figure crop");
assert.equal(fullWidth?.x, 0.045);
assert.ok((fullWidth?.h ?? 0) > 0.4);

const rightColumn = inferFigureBoxFromSpans([
  { str: "Fig. 2b", x: 0.56, y: 0.61, w: 0.08, h: 0.018 },
  { str: "Nyquist plot.", x: 0.65, y: 0.61, w: 0.18, h: 0.018 },
], "Figure 2b");
assert.ok(rightColumn);
assert.equal(rightColumn?.x, 0.51, "narrow captions in the right column crop only that column");

const sharedBaseline = inferFigureBoxFromSpans([
  { str: "Unrelated body text in the left column", x: 0.06, y: 0.7, w: 0.38, h: 0.018 },
  { str: "Fig. 6.", x: 0.56, y: 0.7, w: 0.07, h: 0.018 },
  { str: "CV analyses of the electrolytes.", x: 0.64, y: 0.7, w: 0.27, h: 0.018 },
], "Fig. 6");
assert.equal(sharedBaseline?.x, 0.51, "same-height text in the other column does not widen the caption crop");

const sideCaption = inferFigureBoxFromSpans([
  { str: "Fig. 4.", x: 0.59, y: 0.5, w: 0.07, h: 0.018 },
  { str: "EIS spectra", x: 0.67, y: 0.5, w: 0.15, h: 0.018 },
  { str: "of the modified", x: 0.59, y: 0.53, w: 0.2, h: 0.018 },
  { str: "electrodes", x: 0.59, y: 0.56, w: 0.13, h: 0.018 },
  { str: "with an inset", x: 0.59, y: 0.59, w: 0.16, h: 0.018 },
  { str: "circuit diagram", x: 0.59, y: 0.62, w: 0.18, h: 0.018 },
], "Fig. 4a");
assert.equal(sideCaption?.x, 0.045, "a tall right-column caption crops the figure beside it on the left");
assert.ok((sideCaption?.w ?? 0) > 0.5, "side-caption crop reaches the caption gutter without clipping the plot");
assert.ok((sideCaption?.y ?? 1) >= 0.47, "side-caption crop aligns vertically with the figure block");

assert.equal(inferFigureBoxFromSpans([], "Fig. 8"), null);
assert.equal(validFigureBox({ x: 0.1, y: 0.1, w: 0.5, h: 0.5 })?.w, 0.5);
assert.equal(validFigureBox({ x: 0.9, y: 0.1, w: 0.5, h: 0.5 }), null);

console.log("Source figure crop tests passed");
