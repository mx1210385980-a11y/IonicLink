import assert from "node:assert/strict";
import { buildVocabulary } from "./candidates";
import { buildDataset } from "./dataset";
import { describeIon, featureNorm } from "./descriptors";
import { predict } from "./engine";
import { intersectFoldMetrics, looMetrics, runLoo, type LooPair, type LooResult } from "./loo";

/**
 * Model-lab contract: study metrics (R²/RMSE/MAE in log₁₀ space) computed on
 * the leave-one-out folds, hyperparameter knobs (bandwidth ×, K, outlier
 * exclusion) plumbed through engine + LOO, and the tribology nanoscale-only
 * dataset gate.
 */

function quantity(value: number, stdUnit: string) {
  return { raw: `${value} ${stdUnit}`, value, unit: stdUnit, std: value, stdUnit };
}

let nextId = 0;
/** `scale: null` = no recorded scale (undefined would trigger the default parameter). */
function tribologyRecord(cation: string, anion: string, cof: number, substrate = "mica", scale: string | null = "nano") {
  nextId += 1;
  return {
    id: `#m${String(nextId).padStart(3, "0")}`,
    status: "official",
    createdAt: "2026-06-12",
    paper: { title: `Friction of ${cation}${anion} on ${substrate}` },
    core: {
      ionicLiquid: { cation, anion },
      substrate,
      temperature: quantity(298.15, "K"),
      load: quantity(1e-7, "N"),
      cof,
    },
    extended: scale == null ? {} : { scale },
    flexible: [],
  };
}

function conditionedTribologyRecord({
  cation,
  anion,
  cof,
  substrate = "HOPG",
  loadN = 2e-8,
  velocityMps = 6e-6,
  potentialV,
}: {
  cation: string;
  anion: string;
  cof: number;
  substrate?: string;
  loadN?: number;
  velocityMps?: number;
  potentialV: number;
}) {
  const rec = tribologyRecord(cation, anion, cof, substrate, "nano") as any;
  rec.core.load = quantity(loadN, "N");
  rec.extended = {
    ...rec.extended,
    velocity: quantity(velocityMps, "m/s"),
    potential: quantity(potentialV, "V"),
  };
  return rec;
}

/* ---- looMetrics: exact formulas in log₁₀ space ---- */
{
  const pairs: LooPair[] = [
    { groupLabel: "a", pointKey: "a@298", measuredLog: -1, predictedLog: -1.1 },
    { groupLabel: "b", pointKey: "b@298", measuredLog: -2, predictedLog: -1.8 },
    { groupLabel: "c", pointKey: "c@298", measuredLog: -1.5, predictedLog: -1.5 },
  ];
  const m = looMetrics(pairs);
  // MAE = (0.1 + 0.2 + 0) / 3
  assert.ok(Math.abs(m.maeLog - 0.1) < 1e-12, `MAE exact (got ${m.maeLog})`);
  // RMSE = sqrt((0.01 + 0.04 + 0) / 3)
  assert.ok(Math.abs(m.rmseLog - Math.sqrt(0.05 / 3)) < 1e-12, `RMSE exact (got ${m.rmseLog})`);
  // R² = 1 − SSres/SStot, mean(measured) = −1.5 → SStot = 0.5, SSres = 0.05
  assert.ok(m.r2 != null && Math.abs(m.r2 - 0.9) < 1e-12, `R² exact (got ${m.r2})`);
}

/* ---- R² undefined (null) when the measured values carry no variance ---- */
{
  const m = looMetrics([
    { groupLabel: "a", pointKey: "a@298", measuredLog: -1, predictedLog: -1.2 },
    { groupLabel: "b", pointKey: "b@298", measuredLog: -1, predictedLog: -0.8 },
  ]);
  assert.equal(m.r2, null, "zero-variance measured set → R² null, never ±Infinity");
  assert.ok(m.rmseLog > 0 && m.maeLog > 0);
}

/* ---- a perfect predictor scores R² = 1, RMSE = MAE = 0 ---- */
{
  const m = looMetrics([
    { groupLabel: "a", pointKey: "a@298", measuredLog: -1, predictedLog: -1 },
    { groupLabel: "b", pointKey: "b@298", measuredLog: -2, predictedLog: -2 },
  ]);
  assert.equal(m.r2, 1);
  assert.equal(m.rmseLog, 0);
  assert.equal(m.maeLog, 0);
}

/* ---- intersectFoldMetrics: settings are only compared on shared folds ---- */
{
  const mk = (pairs: LooPair[]): LooResult => ({
    n: pairs.length,
    sigmaCal: 0,
    foldError: 1,
    pairs,
    ...looMetrics(pairs),
  });
  const pt = (k: string, m: number, p: number): LooPair => ({ groupLabel: k, pointKey: `${k}@298`, measuredLog: m, predictedLog: p });
  // Run A predicted 6 folds; run B refused the hardest one ("f") and looks
  // spuriously better on its raw metric — the intersection must drop "f"
  // from BOTH sides before comparing.
  const a = mk([pt("a", -1, -1), pt("b", -1.2, -1.2), pt("c", -1.4, -1.4), pt("d", -1.6, -1.6), pt("e", -1.8, -1.8), pt("f", -2, -0.5)]);
  const b = mk([pt("a", -1, -1.1), pt("b", -1.2, -1.3), pt("c", -1.4, -1.5), pt("d", -1.6, -1.7), pt("e", -1.8, -1.9)]);
  assert.ok(a.rmseLog > b.rmseLog, "raw metrics flatter the run that refused the hard fold");
  const inter = intersectFoldMetrics([a, b]);
  assert.ok(inter, "5 shared folds clear the comparison gate");
  assert.equal(inter!.n, 5);
  assert.equal(inter!.metrics[0].rmseLog, 0, "on shared folds, run A is actually perfect");
  assert.ok(inter!.metrics[1].rmseLog > 0, "and run B is the worse one — the raw comparison inverted the truth");
  // below 5 shared folds the comparison refuses
  const tiny = mk([pt("a", -1, -1), pt("b", -1.2, -1.2)]);
  assert.equal(intersectFoldMetrics([a, tiny]), null, "fewer than 5 shared folds → no comparison");
}

/* ---- nanoscale-only gate: macro and unscaled records are out of scope ---- */
{
  nextId = 0;
  const records = [
    tribologyRecord("[EMIM]", "[TFSI]", 0.02),
    tribologyRecord("[BMIM]", "[BF4]", 0.04),
    tribologyRecord("[EMIM]", "[FAP]", 0.45, "steel", "macro"),
    tribologyRecord("[PYR14]", "[TFSI]", 0.5, "steel", null), // no recorded scale
  ];
  const nano = buildDataset("tribology", records, { nanoOnly: true });
  assert.equal(nano.points.length, 2, "only the two nano records train the model");
  assert.equal(nano.scaleExcludedCount, 2, "macro + unscaled records are counted out");
  assert.ok(
    nano.points.every((p) => p.scale === "nano"),
    "no macroscale point survives the gate"
  );

  const all = buildDataset("tribology", records);
  assert.equal(all.points.length, 4, "without the option the gate is off (engine tests unaffected)");
  assert.equal(all.scaleExcludedCount, 0);

  // The option is tribology semantics only — other domains ignore it.
  const cond = buildDataset("conductivity", [], { nanoOnly: true });
  assert.equal(cond.scaleExcludedCount, 0);
}

/* ---- engine knobs: bandwidthScale stretches h, kNeighbors resizes the kernel ---- */
{
  nextId = 0;
  const records = [
    tribologyRecord("[EMIM]", "[TFSI]", 0.02),
    tribologyRecord("[BMIM]", "[TFSI]", 0.03),
    tribologyRecord("[C6C1Im]", "[TFSI]", 0.05),
    tribologyRecord("[C8MIM]", "[TFSI]", 0.08),
    tribologyRecord("[EMIM]", "[BF4]", 0.025),
    tribologyRecord("[BMIM]", "[BF4]", 0.04),
    tribologyRecord("[PYR14]", "[TFSI]", 0.06),
    tribologyRecord("[EMIM]", "[EtSO4]", 0.01),
  ];
  const dataset = buildDataset("tribology", records, { nanoOnly: true });
  const norm = featureNorm([...buildVocabulary("cation", dataset), ...buildVocabulary("anion", dataset)]);
  const query = { cation: describeIon("[C2MIM]", "cation"), anion: describeIon("[NTf2]", "anion") };

  // [C2MIM][NTf2] canonicalizes to the measured [EMIM][TFSI] — skip the
  // exact-match short-circuit so the kernel itself is exercised.
  const base = predict("tribology", dataset, query, norm, { skipExactMatch: true });
  const wide = predict("tribology", dataset, query, norm, { skipExactMatch: true, bandwidthScale: 2 });
  assert.equal(base.kind, "estimate");
  assert.ok(
    Math.abs(wide.facts.bandwidth - 2 * base.facts.bandwidth) < 1e-12,
    `bandwidthScale 2 doubles h (${base.facts.bandwidth} → ${wide.facts.bandwidth})`
  );
  assert.ok(wide.reasons.some((r) => r.includes("Model-lab bandwidth ×2")), "non-default bandwidth is disclosed");

  const k2 = predict("tribology", dataset, query, norm, { skipExactMatch: true, bandwidthScale: 2, kNeighbors: 2 });
  assert.equal(k2.facts.k, 2, "kNeighbors caps the kernel at K = 2");
  assert.ok(k2.reasons.some((r) => r.includes("K = 2")), "non-default K is disclosed");
  // At K ≤ 2 the Interpolated tier is unreachable BY CONSTRUCTION — the
  // disclosed reason must say so instead of misattributing it to distance.
  assert.equal(k2.tier, "extrapolated");
  assert.ok(
    k2.reasons.some((r) => r.includes("by construction")),
    "the K-cap tier downgrade is attributed to K, not to distance"
  );
  assert.ok(
    !k2.reasons.some((r) => /Only \d+ of \d+ evidence rows/.test(r)),
    "the distance-phrased downgrade reason is suppressed when K causes it"
  );

  // Garbage knob values fall back to the defaults instead of poisoning h.
  const garbage = predict("tribology", dataset, query, norm, { skipExactMatch: true, bandwidthScale: NaN, kNeighbors: 0 });
  assert.ok(Math.abs(garbage.facts.bandwidth - base.facts.bandwidth) < 1e-12, "NaN scale → default bandwidth");
  assert.equal(garbage.facts.k, base.facts.k, "K < 1 → default K");
}

/* ---- tribology local regime: K is a cap, not an obligation to blur incompatible regimes ---- */
{
  nextId = 0;
  const records = [
    conditionedTribologyRecord({ cation: "[BMIM]", anion: "[BF4]", cof: 0.002, potentialV: 1 }),
    conditionedTribologyRecord({ cation: "[BMIM]", anion: "[BF4]", cof: 0.3, potentialV: -1 }),
    conditionedTribologyRecord({ cation: "[EMIM]", anion: "[BF4]", cof: 0.28, potentialV: -1 }),
    conditionedTribologyRecord({ cation: "[C6MIM]", anion: "[BF4]", cof: 0.26, potentialV: -1 }),
    conditionedTribologyRecord({ cation: "[C8MIM]", anion: "[BF4]", cof: 0.24, potentialV: -1 }),
    conditionedTribologyRecord({ cation: "[PYR14]", anion: "[TFSI]", cof: 0.22, potentialV: -1 }),
    conditionedTribologyRecord({ cation: "[EMIM]", anion: "[EtSO4]", cof: 0.2, potentialV: -1 }),
    conditionedTribologyRecord({ cation: "[C2MIM]", anion: "[TFSI]", cof: 0.18, potentialV: -1 }),
  ];
  const dataset = buildDataset("tribology", records, { nanoOnly: true });
  const norm = featureNorm([...buildVocabulary("cation", dataset), ...buildVocabulary("anion", dataset)]);
  const p = predict(
    "tribology",
    dataset,
    {
      cation: describeIon("[BMIM]", "cation"),
      anion: describeIon("[BF4]", "anion"),
      substrate: "HOPG",
      loadN: 2e-8,
      velocityMps: 6e-6,
      potentialV: 1,
    },
    norm,
    { skipExactMatch: true, kNeighbors: 5 }
  );

  assert.equal(p.kind, "estimate");
  assert.ok(p.facts.k < 5, `local electrochemical regime should shrink requested K (got ${p.facts.k})`);
  assert.ok(p.value != null && p.value < 0.01, `local superlubricity analog should not be blurred away (got ${p.value})`);
  assert.ok(p.reasons.some((r) => r.includes("local tribology regime")), "local regime shrinkage is disclosed");
}

/* ---- runLoo: metrics ride along and respond to the knobs ---- */
{
  nextId = 0;
  const records = [
    tribologyRecord("[EMIM]", "[TFSI]", 0.02),
    tribologyRecord("[BMIM]", "[TFSI]", 0.03),
    tribologyRecord("[C6C1Im]", "[TFSI]", 0.05),
    tribologyRecord("[C8MIM]", "[TFSI]", 0.08),
    tribologyRecord("[EMIM]", "[BF4]", 0.025),
    tribologyRecord("[BMIM]", "[BF4]", 0.04),
    tribologyRecord("[PYR14]", "[TFSI]", 0.06),
    tribologyRecord("[EMIM]", "[EtSO4]", 0.01),
    tribologyRecord("[C2MIM]", "[EtSO4]", 0.012),
  ];
  const dataset = buildDataset("tribology", records, { nanoOnly: true });
  const norm = featureNorm([...buildVocabulary("cation", dataset), ...buildVocabulary("anion", dataset)]);

  const loo = runLoo("tribology", dataset, norm);
  assert.ok(loo, "9 points unlock LOO");
  assert.ok(loo!.pairs.every((p) => p.pointKey.includes("@")), "every fold carries a stable point identity");
  assert.equal(new Set(loo!.pairs.map((p) => p.pointKey)).size, loo!.n, "pointKeys are unique across folds");
  assert.ok(Number.isFinite(loo!.rmseLog) && loo!.rmseLog >= 0);
  assert.ok(Number.isFinite(loo!.maeLog) && loo!.maeLog >= 0);
  assert.ok(loo!.maeLog <= loo!.rmseLog + 1e-12, "MAE never exceeds RMSE");
  const recomputed = looMetrics(loo!.pairs);
  assert.equal(loo!.rmseLog, recomputed.rmseLog, "result metrics are exactly the metrics of its own folds");
  assert.equal(loo!.maeLog, recomputed.maeLog);
  assert.equal(loo!.r2, recomputed.r2);
  assert.ok(Math.abs(loo!.foldError - 10 ** loo!.sigmaCal) < 1e-12, "fold error stays the median-based readout");

  const looK3 = runLoo("tribology", dataset, norm, { kNeighbors: 3 });
  assert.ok(looK3, "knob-adjusted LOO still runs");
  assert.equal(looK3!.n, loo!.n, "same folds, different model");
  assert.notEqual(looK3!.rmseLog, loo!.rmseLog, "K = 3 is a genuinely different model than the tribology default K = 1");
}

/* ---- outlier exclusion removes the leverage point from training AND folds ---- */
{
  nextId = 0;
  const records = [
    tribologyRecord("[EMIM]", "[TFSI]", 0.02),
    tribologyRecord("[BMIM]", "[TFSI]", 0.0224),
    tribologyRecord("[C6C1Im]", "[TFSI]", 0.0178),
    tribologyRecord("[C8MIM]", "[TFSI]", 0.025),
    tribologyRecord("[EMIM]", "[BF4]", 0.016),
    tribologyRecord("[BMIM]", "[BF4]", 0.021),
    tribologyRecord("[PYR14]", "[TFSI]", 0.019),
    tribologyRecord("[EMIM]", "[EtSO4]", 0.023),
    tribologyRecord("[C6C1Im]", "[BF4]", 0.024),
    tribologyRecord("[C10MIM]", "[TFSI]", 5.0), // ~2.4 decades above the rest
  ];
  const dataset = buildDataset("tribology", records, { nanoOnly: true });
  assert.equal(dataset.points.length, 10, "ten distinct operating points (no canonical-key collapse)");
  const flagged = dataset.points.filter((p) => p.outlier);
  assert.equal(flagged.length, 1, "the 5.0 COF point is MAD-flagged");

  const norm = featureNorm([...buildVocabulary("cation", dataset), ...buildVocabulary("anion", dataset)]);
  const withOutlier = runLoo("tribology", dataset, norm);
  const without = runLoo("tribology", dataset, norm, { excludeOutliers: true });
  assert.ok(withOutlier && without);
  assert.ok(without!.n < withOutlier!.n, "the excluded point is not a held-out fold either");
}

console.log("Model-lab predict/LOO tests passed");
