import assert from "node:assert/strict";
import { AFM_CURVE_DATASET } from "./afmCurves";
import { afmCurveFileStem, buildAfmCurveCsv, buildAfmCurveJson } from "./exportCurve";

const curve = AFM_CURVE_DATASET.curves.find((record) => record.id === "AFM-26-07-28-05-C002");
assert.ok(curve);

const csv = buildAfmCurveCsv(curve);
assert.match(csv, /# IonicLink AFM force-curve export/);
assert.match(csv, /# ionic_liquid/);
assert.match(csv, /# digitization,Digitized from figure/);
assert.match(csv, new RegExp(`separation_${curve.xUnit},force_${curve.yUnit}`));
const numericRows = csv.split(`separation_${curve.xUnit},force_${curve.yUnit}\r\n`)[1].trim().split("\r\n");
assert.equal(numericRows.length, curve.pointCount);
for (const [x, y] of curve.points.slice(0, 3)) assert.match(csv, new RegExp(`${x},${y}`));

const json = JSON.parse(buildAfmCurveJson(curve));
assert.equal(json.schema, "ioniclink.afm-force-curve");
assert.equal(json.curve.id, curve.id);
assert.equal(json.points.length, curve.pointCount);
assert.deepEqual(json.points[0], { separation: curve.points[0][0], force: curve.points[0][1] });
assert.ok(json.conditions.ionicLiquid);
assert.ok(json.conditions.probe);
assert.ok(json.conditions.substrate);
assert.ok(json.conditions.contactInterface);
assert.ok(json.conditions.externalFactors);
assert.equal(json.digitization.quality, curve.digitization.quality);
assert.match(afmCurveFileStem(curve), /^ioniclink-afm-/);
assert.doesNotMatch(afmCurveFileStem(curve), /\s/);

console.log("AFM curve export tests passed");
