import assert from "node:assert/strict";
import { trainWffModel, WFF_FEATURE_COLUMNS, WFF_MODEL_LABELS, type WffHybridConfig } from "./wffModel";

// Deterministic synthetic data: y is a smooth function of two features, plus
// two pure-noise features the model must learn to ignore.
function lcg(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function makeData(n: number, seed: number) {
  const rand = lcg(seed);
  const X: number[][] = [];
  const y: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = rand();
    const b = rand();
    const noise1 = rand();
    const noise2 = rand();
    X.push([a, b, noise1, noise2]);
    y.push(3 * a - 2 * b + a * b + 0.02 * (rand() - 0.5));
  }
  return { X, y };
}

function r2(yTrue: number[], yPred: number[]) {
  const n = yTrue.length;
  const mean = yTrue.reduce((s, v) => s + v, 0) / n;
  let ssRes = 0;
  let ssTot = 0;
  for (let i = 0; i < n; i++) {
    ssRes += (yTrue[i] - yPred[i]) ** 2;
    ssTot += (yTrue[i] - mean) ** 2;
  }
  return 1 - ssRes / ssTot;
}

// --- feature column contract --------------------------------------------
{
  assert.ok(WFF_FEATURE_COLUMNS.includes("r_cat"));
  assert.ok(WFF_FEATURE_COLUMNS.includes("h"));
  assert.equal(WFF_MODEL_LABELS.gradient_boosting, "Gradient boosting");
}

// --- out-of-sample generalization ---------------------------------------
for (const modelType of ["gradient_boosting", "random_forest", "blend", "gated_hybrid"] as const) {
  const train = makeData(220, 11);
  const test = makeData(80, 999); // disjoint seed → genuinely held-out
  const model = trainWffModel(modelType, train.X, train.y, 42);
  const preds = test.X.map((x) => model.predict(x));
  preds.forEach((p) => assert.ok(Number.isFinite(p), `${modelType} produced a non-finite prediction`));
  const score = r2(test.y, preds);
  assert.ok(score > 0.6, `${modelType} OOS R² too low: ${score.toFixed(3)}`);
}

// --- gated hybrid: determinism + small-data fallback ---------------------
{
  const { X, y } = makeData(90, 21);
  const a = trainWffModel("gated_hybrid", X, y, 4);
  const b = trainWffModel("gated_hybrid", X, y, 4);
  const probe = [0.4, 0.6, 0.2, 0.8];
  assert.equal(a.predict(probe), b.predict(probe), "gated hybrid is deterministic for a fixed seed");
  // a tiny region count must not crash or NaN
  const tiny = makeData(6, 2);
  const m = trainWffModel("gated_hybrid", tiny.X, tiny.y, 1);
  assert.ok(Number.isFinite(m.predict([0.5, 0.5, 0.5, 0.5])), "gated hybrid handles tiny data without NaN");
}

// --- gated hybrid: every base/meta/quantile configuration trains & generalizes
{
  const train = makeData(220, 33);
  const test = makeData(80, 7);
  const configs: WffHybridConfig[] = [
    { baseLearners: ["catboost", "forest"], gate: "catboost", metaModel: "ridge", q1: 0.2, q2: 0.6 }, // 2-base, ridge
    { baseLearners: ["catboost", "xgboost", "forest"], gate: "xgboost", metaModel: "boosting", q1: 0.33, q2: 0.66 }, // 3-base, boosting meta
    { baseLearners: ["xgboost"], gate: "forest", metaModel: "forest", q1: 0.5, q2: 0.8 }, // 1-base, forest meta, gate ≠ base
  ];
  for (const cfg of configs) {
    const model = trainWffModel("gated_hybrid", train.X, train.y, 9, cfg);
    const preds = test.X.map((x) => model.predict(x));
    preds.forEach((p) => assert.ok(Number.isFinite(p), `config ${JSON.stringify(cfg.baseLearners)} produced NaN`));
    const score = r2(test.y, preds);
    assert.ok(score > 0.5, `hybrid (${cfg.baseLearners.join("+")}/${cfg.metaModel}) OOS R² too low: ${score.toFixed(3)}`);
  }
}

// --- determinism ---------------------------------------------------------
{
  const { X, y } = makeData(120, 7);
  const a = trainWffModel("gradient_boosting", X, y, 5);
  const b = trainWffModel("gradient_boosting", X, y, 5);
  const probe = [0.3, 0.7, 0.1, 0.9];
  assert.equal(a.predict(probe), b.predict(probe), "same seed must give identical predictions");
  const c = trainWffModel("gradient_boosting", X, y, 6);
  assert.notEqual(a.predict(probe), c.predict(probe), "different seed should change the fit");
}

// --- missing-value (null) handling: imputed from train, never NaN --------
{
  const train = makeData(60, 3);
  // null out feature 2 (noise) in some rows and the target-driving feature 1 in others
  const withNulls = train.X.map((row, i): (number | null)[] => (i % 5 === 0 ? [row[0], null, row[2], row[3]] : row));
  const model = trainWffModel("random_forest", withNulls, train.y, 9);
  const p = model.predict([0.5, null, 0.5, 0.5]);
  assert.ok(Number.isFinite(p), "null features must be imputed, not produce NaN");
}

// --- degenerate inputs ---------------------------------------------------
{
  assert.equal(trainWffModel("gradient_boosting", [], [], 1).predict([1, 2]), 0, "empty training set predicts 0");
  const tiny = trainWffModel("random_forest", [[1], [2], [3]], [10, 20, 30], 1);
  assert.equal(tiny.predict([99]), 20, "fewer than 4 rows falls back to the training mean");
}

console.log("WFF model tests passed");
