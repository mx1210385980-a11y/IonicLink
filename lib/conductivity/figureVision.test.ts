import assert from "node:assert/strict";
import { composeFigureBox } from "./figureVision.server";

assert.deepEqual(
  composeFigureBox(
    { x: 0.1, y: 0.2, w: 0.8, h: 0.6 },
    { x: 0.5, y: 0, w: 0.5, h: 0.5 },
  ),
  { x: 0.5, y: 0.2, w: 0.4, h: 0.3 },
);

console.log("Conductivity figure-vision helper tests passed");
