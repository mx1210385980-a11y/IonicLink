import assert from "node:assert/strict";
import { parseAfmAxisOcr } from "./imageAxisOcr.server";

const header = "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext";
const words = [
  [64, 208, 12, 12, 95, "0"], [134, 208, 12, 12, 95, "2"], [204, 208, 12, 12, 95, "4"], [274, 208, 12, 12, 95, "6"],
  [38, 194, 24, 12, 95, "-1.0"], [44, 139, 18, 12, 95, "0.0"], [44, 83, 18, 12, 95, "1.0"], [44, 28, 18, 12, 95, "2.0"],
].map(([left, top, width, height, confidence, text], index) => `5\t1\t1\t1\t1\t${index + 1}\t${left}\t${top}\t${width}\t${height}\t${confidence}\t${text}`);
const result = parseAfmAxisOcr({
  text: "Normal Force [nN] Separation [nm]",
  tsv: [header, ...words].join("\n"),
  width: 320,
  height: 240,
  plotBox: { left: 70, top: 34, right: 280, bottom: 200 },
});
assert.equal(result.status, "auto-calibrated");
assert.deepEqual(result.axes, { xMin: 0, xMax: 6, yMin: -1, yMax: 2, xUnit: "nm", yUnit: "nN" });

const shorthand = parseAfmAxisOcr({
  text: "F (nN) s (nm)",
  tsv: [header, ...words].join("\n"),
  width: 320,
  height: 240,
  plotBox: { left: 70, top: 34, right: 280, bottom: 200 },
});
assert.equal(shorthand.status, "auto-calibrated");
assert.equal(shorthand.axes?.xUnit, "nm");
assert.equal(shorthand.axes?.yUnit, "nN");

const partial = parseAfmAxisOcr({
  text: "s (nm)",
  tsv: [header, ...words.slice(0, 4)].join("\n"),
  width: 320,
  height: 240,
  plotBox: { left: 70, top: 34, right: 280, bottom: 200 },
});
assert.equal(partial.status, "relative-only");
assert.equal(partial.partialAxes?.xMin, 0);
assert.equal(partial.partialAxes?.xMax, 6);
assert.equal(partial.partialAxes?.xUnit, "nm");

console.log("AFM figure-axis OCR parser tests passed");
