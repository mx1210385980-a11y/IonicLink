import assert from "node:assert/strict";
import { calibrateAfmPoints, digitizeAfmRgba } from "./digitizeCurve";

const width = 240;
const height = 160;
const data = new Uint8ClampedArray(width * height * 4);
for (let index = 0; index < width * height; index += 1) {
  data[index * 4] = 255;
  data[index * 4 + 1] = 255;
  data[index * 4 + 2] = 255;
  data[index * 4 + 3] = 255;
}

const paint = (x: number, y: number, r: number, g: number, b: number) => {
  if (x < 0 || x >= width || y < 0 || y >= height) return;
  const index = (y * width + x) * 4;
  data[index] = r; data[index + 1] = g; data[index + 2] = b; data[index + 3] = 255;
};

// Black plot axes.
for (let y = 18; y <= 132; y += 1) for (let dx = 0; dx < 2; dx += 1) paint(28 + dx, y, 20, 20, 20);
for (let x = 28; x <= 220; x += 1) for (let dy = 0; dy < 2; dy += 1) paint(x, 132 + dy, 20, 20, 20);

// Thick blue force trace: a high-force vertical region followed by a decaying tail.
for (let step = 0; step <= 150; step += 1) {
  const x = step < 42 ? 62 + Math.round(Math.sin(step / 4) * 2) : 62 + step;
  const y = step < 42 ? 24 + step * 2 : 108 + Math.round(Math.sin(step / 7) * 3);
  for (let dy = -2; dy <= 2; dy += 1) for (let dx = -2; dx <= 2; dx += 1) paint(x + dx, Math.min(126, y + dy), 28, 44, 128);
}

const analysis = digitizeAfmRgba({ width, height, data });
assert.ok(analysis.axisConfidence > 0.65, `axis confidence ${analysis.axisConfidence}`);
assert.ok(Math.abs(analysis.plotBox.left - 28) <= 3, `left ${analysis.plotBox.left}`);
assert.ok(Math.abs(analysis.plotBox.bottom - 133) <= 3, `bottom ${analysis.plotBox.bottom}`);
assert.ok(analysis.normalizedPoints.length > 30, JSON.stringify(analysis));
assert.ok(analysis.traceColor?.b && analysis.traceColor.b > analysis.traceColor.r);
assert.ok(analysis.normalizedPoints.length < 260, "the colour mask should be reduced to an ordered centreline");
assert.equal(analysis.segmentStarts[0], 0);
assert.equal(analysis.isLikelyCurve, true);
assert.ok(analysis.segmentStarts.length >= 2, "the intentionally disconnected synthetic contact branch and tail remain separate");

// Curve recognition is geometry-first, not blue-specific. Published AFM
// figures use many palettes and monochrome traces, so each representative
// colour must recover the same force-curve structure.
for (const variant of [
  { name: "red", rgb: [190, 44, 52] as const, channel: "r" as const },
  { name: "green", rgb: [24, 142, 83] as const, channel: "g" as const },
  { name: "purple", rgb: [126, 68, 196] as const, channel: "b" as const },
  { name: "black", rgb: [48, 48, 48] as const, channel: null },
]) {
  const recoloured = new Uint8ClampedArray(data);
  for (let offset = 0; offset < recoloured.length; offset += 4) {
    if (recoloured[offset] === 28 && recoloured[offset + 1] === 44 && recoloured[offset + 2] === 128) {
      recoloured[offset] = variant.rgb[0];
      recoloured[offset + 1] = variant.rgb[1];
      recoloured[offset + 2] = variant.rgb[2];
    }
  }
  const result = digitizeAfmRgba({ width, height, data: recoloured });
  assert.equal(result.isLikelyCurve, true, `${variant.name}: ${result.rejectionReasons.join("; ")}`);
  assert.ok(result.normalizedPoints.length > 30, `${variant.name}: only ${result.normalizedPoints.length} points`);
  if (variant.channel) {
    assert.ok(result.traceColor && result.traceColor[variant.channel] >= Math.max(result.traceColor.r, result.traceColor.g, result.traceColor.b), `${variant.name}: ${result.traceColor?.hex}`);
  } else {
    assert.ok(result.traceColor && Math.max(result.traceColor.r, result.traceColor.g, result.traceColor.b) - Math.min(result.traceColor.r, result.traceColor.g, result.traceColor.b) <= 3, `monochrome fallback colour: ${result.traceColor?.hex}`);
    assert.ok(result.warnings.some((warning) => /black\/grey trace fallback/i.test(warning)));
  }
}

// A red zoom rectangle and dashed connector may contain more coloured pixels
// than the real curve. The detector must compare colour candidates by curve
// geometry instead of blindly choosing the most common hue.
const annotatedData = new Uint8ClampedArray(data);
const paintAnnotation = (x: number, y: number) => {
  if (x < 0 || x >= width || y < 0 || y >= height) return;
  const offset = (y * width + x) * 4;
  annotatedData[offset] = 221; annotatedData[offset + 1] = 72; annotatedData[offset + 2] = 72; annotatedData[offset + 3] = 255;
};
for (let thickness = 0; thickness < 3; thickness += 1) {
  for (let x = 74; x <= 158; x += 1) {
    paintAnnotation(x, 82 + thickness); paintAnnotation(x, 124 + thickness);
  }
  for (let y = 82; y <= 126; y += 1) {
    paintAnnotation(74 + thickness, y); paintAnnotation(158 + thickness, y);
  }
}
for (let step = 0; step < 80; step += 1) {
  if (Math.floor(step / 8) % 2) continue;
  for (let thickness = 0; thickness < 3; thickness += 1) paintAnnotation(158 + step, 82 - Math.round(step * 0.65) + thickness);
}
const annotated = digitizeAfmRgba({ width, height, data: annotatedData });
assert.ok(annotated.traceColor && annotated.traceColor.b > annotated.traceColor.r, `annotation colour selected: ${annotated.traceColor?.hex}`);
assert.equal(annotated.isLikelyCurve, true);
assert.ok(annotated.normalizedPoints.length > 30);

const fragmentedData = new Uint8ClampedArray(width * height * 4);
for (let index = 0; index < width * height; index += 1) {
  fragmentedData[index * 4] = 255;
  fragmentedData[index * 4 + 1] = 255;
  fragmentedData[index * 4 + 2] = 255;
  fragmentedData[index * 4 + 3] = 255;
}
const paintFragment = (x: number, y: number) => {
  for (let dy = -2; dy <= 2; dy += 1) for (let dx = -2; dx <= 2; dx += 1) {
    const px = x + dx; const py = y + dy;
    if (px < 0 || px >= width || py < 0 || py >= height) continue;
    const offset = (py * width + px) * 4;
    fragmentedData[offset] = 28; fragmentedData[offset + 1] = 120; fragmentedData[offset + 2] = 190; fragmentedData[offset + 3] = 255;
  }
};
for (let y = 22; y <= 92; y += 2) paintFragment(60, y);
for (let x = 76; x <= 108; x += 2) paintFragment(x, 104 + Math.round(Math.sin(x / 7) * 3));
for (let x = 148; x <= 212; x += 2) paintFragment(x, 119 + Math.round(Math.sin(x / 9) * 2));
const fragmented = digitizeAfmRgba(
  { width, height, data: fragmentedData },
  { plotBox: { left: 20, top: 12, right: 225, bottom: 140 }, sensitivity: 0.72 },
);
assert.ok(fragmented.segmentStarts.length >= 3, `fragment starts: ${fragmented.segmentStarts.join(",")}`);
assert.equal(fragmented.segmentStarts[0], 0);
assert.equal(fragmented.isLikelyCurve, true);

// Coloured text-like fragments without a credible pair of axes must be
// rejected instead of entering the AFM review queue as a fabricated curve.
const textOnly = new Uint8ClampedArray(width * height * 4).fill(255);
for (let block = 0; block < 9; block += 1) {
  const y = 20 + block * 13;
  for (let x = 24 + (block % 3) * 58; x < 52 + (block % 3) * 58; x += 1) {
    for (let dy = 0; dy < 2; dy += 1) {
      const offset = ((y + dy) * width + x) * 4;
      textOnly[offset] = 20; textOnly[offset + 1] = 130; textOnly[offset + 2] = 155; textOnly[offset + 3] = 255;
    }
  }
}
const rejected = digitizeAfmRgba({ width, height, data: textOnly });
assert.equal(rejected.isLikelyCurve, false);
assert.ok(rejected.rejectionReasons.some((reason) => /axes|fragments|coverage|span/i.test(reason)));

// Bivariate force histograms encode the most probable curve as a narrow
// yellow ridge inside a much broader red low-density envelope. Density mode
// must follow the yellow centre rather than selecting red simply because it
// occupies more pixels.
const heatmap = new Uint8ClampedArray(width * height * 4).fill(255);
const heatPaint = (x: number, y: number, rgb: readonly [number, number, number]) => {
  if (x < 0 || y < 0 || x >= width || y >= height) return;
  const offset = (y * width + x) * 4;
  heatmap[offset] = rgb[0]; heatmap[offset + 1] = rgb[1]; heatmap[offset + 2] = rgb[2]; heatmap[offset + 3] = 255;
};
for (let x = 30; x <= 220; x += 1) {
  const centre = 42 + Math.round((x - 30) * 0.4 + Math.sin(x / 14) * 4);
  for (let dy = -8; dy <= 8; dy += 1) heatPaint(x, centre + dy, [205, 54, 52]);
  for (let dy = -2; dy <= 2; dy += 1) heatPaint(x, centre + dy, [244, 202, 42]);
}
const density = digitizeAfmRgba(
  { width, height, data: heatmap },
  { plotBox: { left: 24, top: 12, right: 228, bottom: 145 }, traceMode: "density-ridge", densityPeakColor: "yellow", sensitivity: 0.7 },
);
assert.equal(density.isLikelyCurve, true, density.rejectionReasons.join("; "));
assert.equal(density.traceMode, "density-ridge");
assert.ok(density.traceColor && density.traceColor.g > density.traceColor.b && density.traceColor.r > 220, density.traceColor?.hex);
const middleDensityPoint = density.normalizedPoints[Math.floor(density.normalizedPoints.length / 2)];
const expectedMiddleY = 1 - (42 + (125 - 30) * 0.4 - 12) / (145 - 12);
assert.ok(Math.abs(middleDensityPoint.y - expectedMiddleY) < 0.12, `density ridge y=${middleDensityPoint.y}`);

const calibrated = calibrateAfmPoints(
  [{ x: 0, y: 0 }, { x: 0.5, y: 0.5 }, { x: 1, y: 1 }],
  { xMin: -1, xMax: 5, yMin: -2, yMax: 22 },
);
assert.deepEqual(calibrated, [[-1, -2], [2, 10], [5, 22]]);
assert.throws(() => calibrateAfmPoints([], { xMin: 0, xMax: 0, yMin: 0, yMax: 1 }), /different/);

console.log("AFM digitization tests passed");
