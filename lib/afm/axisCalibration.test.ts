import assert from "node:assert/strict";
import { inferAfmAxisCalibration } from "./axisCalibration";

const verified = inferAfmAxisCalibration({
  doi: "https://doi.org/10.1039/C4CP04522J",
  documentText: "",
  figureLabel: "1",
});
assert.equal(verified.status, "auto-calibrated");
assert.equal(verified.method, "verified-source-profile");
assert.deepEqual(verified.axes, { xMin: -1, xMax: 3, yMin: -2, yMax: 12, xUnit: "nm", yUnit: "nN" });

const externalVerified = inferAfmAxisCalibration({
  doi: "https://doi.org/10.5796/electrochemistry.23-69151",
  documentText: "Figure 6. Transformed force curve.",
  figureLabel: "6",
});
assert.equal(externalVerified.status, "auto-calibrated");
assert.equal(externalVerified.method, "verified-source-profile");
assert.deepEqual(externalVerified.axes, { xMin: -1, xMax: 10, yMin: 0, yMax: 2, xUnit: "nm", yUnit: "nN" });

const eanMica = inferAfmAxisCalibration({
  doi: "10.1002/admi.202202110",
  documentText: "",
  figureLabel: "1B",
});
assert.equal(eanMica.status, "auto-calibrated");
assert.deepEqual(eanMica.axes, { xMin: 3.5, xMax: -0.5, yMin: -2, yMax: 14, xUnit: "nm", yUnit: "nN" });

const bmimRubrene = inferAfmAxisCalibration({
  doi: "10.1039/c7cp06948k",
  documentText: "",
  figureLabel: "1",
});
assert.equal(bmimRubrene.status, "auto-calibrated");
assert.deepEqual(bmimRubrene.axes, { xMin: 0, xMax: 5, yMin: -10, yMax: 30, xUnit: "nm", yUnit: "pN" });

const unidentifiedFigure = inferAfmAxisCalibration({
  doi: "10.1039/c7cp06948k",
  documentText: "No explicit physical axis endpoints are stated here.",
  figureLabel: null,
});
assert.equal(unidentifiedFigure.status, "relative-only", "a figure-specific source profile must not match an unidentified figure");

const explicit = inferAfmAxisCalibration({
  doi: null,
  documentText: "Apparent separation ranged from -0.5 to 6 nm. Normal force ranged from -2 to 20 nN.",
  figureLabel: null,
});
assert.equal(explicit.status, "auto-calibrated");
assert.equal(explicit.method, "explicit-document-range");
assert.deepEqual(explicit.axes, { xMin: -0.5, xMax: 6, yMin: -2, yMax: 20, xUnit: "nm", yUnit: "nN" });

const fallback = inferAfmAxisCalibration({ doi: null, documentText: "Force curve shown in Fig. 2.", figureLabel: "2" });
assert.equal(fallback.status, "relative-only");
assert.equal(fallback.axes, null);

console.log("AFM automatic axis calibration tests passed");
