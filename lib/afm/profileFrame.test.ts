import assert from "node:assert/strict";
import { reframeAfmAnalysis, sharedAfmHorizontalFrame } from "./profileFrame";
import type { AfmDigitizationAnalysis } from "./digitizeCurve";

const original = { plotBox: { left: 0, top: 0, right: 100, bottom: 100 }, normalizedPoints: [{ x: 0.1, y: 0.9 }, { x: 0.5, y: 0.5 }, { x: 0.9, y: 0.1 }], segmentStarts: [0, 2], warnings: [] } as unknown as AfmDigitizationAnalysis;
const changed = reframeAfmAnalysis(original, { left: 10, top: 10, right: 90, bottom: 90 });
assert.deepEqual(changed.normalizedPoints, [{ x: 0, y: 1 }, { x: 0.5, y: 0.5 }, { x: 1, y: 0 }]);
assert.deepEqual(changed.segmentStarts, [0, 2]);
assert.equal(original.plotBox.left, 0, "reframing does not mutate the raw analysis");
const clipped = reframeAfmAnalysis(original, { left: 20, top: 20, right: 80, bottom: 80 });
assert.equal(clipped.normalizedPoints.length, 1); assert.deepEqual(clipped.segmentStarts, [0]);
const pixels = new Uint8Array(100 * 100 * 4).fill(255);
for (let y = 10; y < 90; y++) { const p = (y * 100 + 6) * 4; pixels[p] = pixels[p + 1] = pixels[p + 2] = 20; }
assert.deepEqual(sharedAfmHorizontalFrame({ width: 100, height: 100, data: pixels }, 80), { left: 6, right: 86 });
assert.equal(sharedAfmHorizontalFrame({ width: 100, height: 100, data: new Uint8Array(40000).fill(255) }, 80), null, "empty panels cannot inherit a fake frame");
console.log("Tick-anchored AFM pixel reprojection preserves values, branches and source analysis");
