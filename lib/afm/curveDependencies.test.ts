import assert from "node:assert/strict";
import { AFM_CURVE_DATASET } from "./afmCurves";
import { deriveAfmCurveDependencies } from "./curveDependencies";

const curve = AFM_CURVE_DATASET.curves.find((record) => record.id === "AFM-26-07-27-15-C001");
assert.ok(curve);
const dependencies = deriveAfmCurveDependencies(curve, AFM_CURVE_DATASET.curves);
const maximumForceVsTemperature = dependencies.find((dependency) => dependency.descriptor === "maximum-force" && dependency.independentVariable === "temperature");
assert.ok(maximumForceVsTemperature);
assert.equal(maximumForceVsTemperature.observations.length, 5);
assert.equal(maximumForceVsTemperature.basis, "digitized-curve-comparison");
assert.match(maximumForceVsTemperature.statement, /not evidence of an interfacial mechanism or causality/);

const legacy = AFM_CURVE_DATASET.curves.find((record) => record.collection === "legacy-cleaned");
assert.ok(legacy);
assert.equal(deriveAfmCurveDependencies(legacy, AFM_CURVE_DATASET.curves).length, 0, "legacy resampled force extrema are not treated as physical dependencies");

console.log("AFM curve dependency tests passed");
