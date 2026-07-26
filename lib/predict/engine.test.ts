import assert from "node:assert/strict";
import { buildDataset, substrateClass } from "./dataset";
import { describeIon, featureNorm, ionVocabulary } from "./descriptors";
import { CALIBRATION_GATE, ionDistance, predict } from "./engine";
import { runLoo } from "./loo";

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

const NORM = featureNorm([...ionVocabulary("cation"), ...ionVocabulary("anion")]);

let nextId = 0;
function quantity(value: number, stdUnit: string) {
  return { raw: `${value} ${stdUnit}`, value, unit: stdUnit, std: value, stdUnit };
}

function conductivityRecord(opts: {
  cation: string;
  anion: string;
  sigma: number;
  tempK: number;
  status?: "review" | "official";
}) {
  nextId += 1;
  return {
    id: `#c${String(nextId).padStart(3, "0")}`,
    status: opts.status ?? "official",
    createdAt: "2026-06-10",
    paper: { title: `Paper ${opts.cation}${opts.anion}` },
    core: {
      ionicLiquid: { cation: opts.cation, anion: opts.anion },
      surface: "Pt",
      temperature: quantity(opts.tempK, "K"),
      conductivity: quantity(opts.sigma, "S/m"),
    },
    extended: { method: "EIS" },
    flexible: [],
    provenance: { conductivity: { page: 3, quote: `sigma = ${opts.sigma} S/m` } },
  };
}

function diffusionRecord(opts: { cation: string; anion: string; d: number | null; tempK: number; species: string }) {
  nextId += 1;
  return {
    id: `#d${String(nextId).padStart(3, "0")}`,
    status: "review",
    createdAt: "2026-06-10",
    paper: { title: `Paper D ${opts.cation}${opts.anion}` },
    core: {
      ionicLiquid: { cation: opts.cation, anion: opts.anion },
      species: opts.species,
      temperature: quantity(opts.tempK, "K"),
      diffusion: opts.d == null ? null : quantity(opts.d, "m²/s"),
    },
    extended: { method: "PFG-NMR" },
    flexible: [],
  };
}

/** 9 usable conductivity records — clears the calibration gate (8). */
const SIGMA_RECORDS = [
  conductivityRecord({ cation: "[C2MIM]", anion: "[BF4]", sigma: 1.0, tempK: 298.15 }),
  conductivityRecord({ cation: "[C4MIM]", anion: "[BF4]", sigma: 0.6, tempK: 298.15 }),
  conductivityRecord({ cation: "[C4MIM]", anion: "[BF4]", sigma: 2.0, tempK: 353.15 }),
  conductivityRecord({ cation: "[C6MIM]", anion: "[BF4]", sigma: 0.35, tempK: 298.15 }),
  conductivityRecord({ cation: "[C8MIM]", anion: "[BF4]", sigma: 0.2, tempK: 298.15 }),
  conductivityRecord({ cation: "[C2MIM]", anion: "[TFSI]", sigma: 0.9, tempK: 298.15 }),
  conductivityRecord({ cation: "[C4MIM]", anion: "[TFSI]", sigma: 0.55, tempK: 298.15, status: "review" }),
  conductivityRecord({ cation: "[C6MIM]", anion: "[TFSI]", sigma: 0.3, tempK: 298.15 }),
  conductivityRecord({ cation: "[PYR14]", anion: "[TFSI]", sigma: 0.25, tempK: 298.15 }),
];

/* ------------------------------------------------------------------ */
/* Dataset assembly                                                    */
/* ------------------------------------------------------------------ */
{
  const ds = buildDataset("conductivity", SIGMA_RECORDS);
  assert.equal(ds.points.length, 9);
  assert.equal(ds.pairCount, 8);
  assert.equal(ds.exclusions.length, 0);
  assert.equal(ds.fits.length, 1, "only [C4MIM][BF4] has two temperatures");
  assert.ok(ds.medianEaJmol != null && ds.medianEaJmol > 15000 && ds.medianEaJmol < 40000);
  assert.equal(ds.officialCount, 8);
  assert.equal(ds.reviewCount, 1);
  assert.deepEqual(ds.tempRange, [298.15, 353.15]);

  // official-only toggle removes review records without putting them in the exclusion ledger
  const officialOnly = buildDataset("conductivity", SIGMA_RECORDS, { includeReview: false });
  assert.equal(officialOnly.points.length, 8);
  assert.equal(officialOnly.reviewExcludedCount, 1);
  assert.equal(officialOnly.exclusions.length, 0);
}

/* ---- raw spellings collapse into one pair ---- */
{
  const ds = buildDataset("conductivity", [
    conductivityRecord({ cation: "[BMIm]", anion: "[TFSI]", sigma: 0.5, tempK: 298 }),
    conductivityRecord({ cation: "[C4C1Im]", anion: "[NTf2]", sigma: 0.7, tempK: 298.5 }),
  ]);
  assert.equal(ds.pairCount, 1, "[BMIm][TFSI] and [C4C1Im][NTf2] are the same pair");
  assert.equal(ds.points.length, 1, "same pair within 1 K collapses to one point");
  assert.equal(ds.points[0].y, 0.6, "collapsed value is the median");
  assert.equal(ds.points[0].members.length, 2);
}

/* ---- exclusions are itemized, never silent ---- */
{
  const ds = buildDataset("diffusion", [
    diffusionRecord({ cation: "[EMIM]", anion: "[TFSI]", d: 6.2e-11, tempK: 303, species: "cation" }),
    diffusionRecord({ cation: "[PYR14]", anion: "[TFSI]", d: null, tempK: 298, species: "Li+" }),
    diffusionRecord({ cation: "wat?", anion: "[TFSI]", d: 1e-11, tempK: 298, species: "cation" }),
  ]);
  assert.equal(ds.points.length, 1);
  assert.equal(ds.exclusions.length, 2);
  assert.ok(ds.exclusions.some((e) => e.reason.includes("no diffusion value")));
  assert.ok(ds.exclusions.some((e) => e.reason.includes("unresolvable cation")));
}

/* ------------------------------------------------------------------ */
/* Prediction                                                          */
/* ------------------------------------------------------------------ */

const DS = buildDataset("conductivity", SIGMA_RECORDS);
const query = (cation: string, anion: string, tempK: number) => ({
  cation: describeIon(cation, "cation"),
  anion: describeIon(anion, "anion"),
  tempK,
});

/* ---- exact match returns the MEASUREMENT, not a model output ---- */
{
  const p = predict("conductivity", DS, query("[BMIM]", "[BF4]", 298.15), NORM);
  assert.equal(p.kind, "measured");
  assert.equal(p.tier, "measured");
  assert.equal(p.value, 0.6);
  assert.equal(p.fold, null, "measured values carry no model interval");
  assert.equal(p.gated, false);
}

/* ---- estimate interpolates between chain-length neighbors, in log space ---- */
{
  const p = predict("conductivity", DS, query("[C3MIM]", "[BF4]", 298.15), NORM);
  assert.equal(p.kind, "estimate");
  assert.ok(p.value != null && p.value > 0.2 && p.value < 1.0, `σ estimate ${p.value}`);
  assert.equal(p.gated, false, "9 usable points clear the calibration gate");
  assert.ok(p.fold != null && p.fold > 1);
  assert.ok(p.low != null && p.high != null && p.low < (p.value as number) && (p.value as number) < p.high);
  assert.ok(p.neighbors.length >= 3);
  assert.ok(p.neighbors[0].point.pairKey.includes("bf4"), "nearest neighbors share the anion");
  const shares = p.neighbors.reduce((a, n) => a + n.share, 0);
  assert.ok(Math.abs(shares - 1) < 1e-9, "evidence shares sum to 1");
}

/* ---- pure log-space check: equidistant neighbors → geometric mean ---- */
{
  const tiny = buildDataset("conductivity", [
    conductivityRecord({ cation: "[C2MIM]", anion: "[BF4]", sigma: 0.01, tempK: 298 }),
    conductivityRecord({ cation: "[C6MIM]", anion: "[BF4]", sigma: 1.0, tempK: 298 }),
  ]);
  const p = predict("conductivity", tiny, query("[C4MIM]", "[BF4]", 298), NORM);
  assert.equal(p.kind, "estimate");
  assert.ok(p.gated, "2 points are far below the calibration gate");
  assert.ok(Math.abs((p.value as number) - 0.1) < 0.005, `geometric mean expected ≈0.1, got ${p.value}`);
}

/* ---- temperature translation along the pair's own Arrhenius fit ---- */
{
  const p = predict("conductivity", DS, query("[BMIM]", "[BF4]", 330), NORM);
  assert.equal(p.kind, "estimate");
  const own = p.neighbors.filter((n) => n.point.pairKey === "c4mim|bf4");
  assert.ok(own.length > 0);
  assert.ok(own.every((n) => n.translation?.source === "pair-fit"));
  assert.ok(own.every((n) => n.translation?.basis === "inferred"));
  // value must land between the 298 K and 353 K measurements
  assert.ok((p.value as number) > 0.6 && (p.value as number) < 2.0, `σ(330 K) ${p.value}`);
}

/* ---- borrowed median slope is flagged and labeled "assumed" ---- */
{
  const p = predict("conductivity", DS, query("[C2MIM]", "[TFSI]", 320), NORM);
  assert.equal(p.kind, "estimate");
  assert.ok(p.facts.borrowedSlope);
  const borrowed = p.neighbors.find((n) => n.translation?.source === "borrowed-median");
  assert.ok(borrowed, "single-T neighbors must borrow the median Ea");
  assert.equal(borrowed?.translation?.basis, "assumed");
  assert.ok(p.reasons.some((r) => r.toLowerCase().includes("borrowed")));
}

/* ---- review-status evidence is called out ---- */
{
  const p = predict("conductivity", DS, query("[C5MIM]", "[TFSI]", 298.15), NORM);
  assert.equal(p.kind, "estimate");
  assert.ok(p.reasons.some((r) => r.includes("review-status")), "review evidence must be flagged");
  assert.ok(p.facts.officialFraction < 1);
}

/* ---- unresolved ions refuse, with the reason stated ---- */
{
  const p = predict("conductivity", DS, query("unobtainium", "[BF4]", 298), NORM);
  assert.equal(p.kind, "insufficient");
  assert.equal(p.value, null);
  assert.ok(p.refusal?.includes("Unrecognized"));
}

/* ---- diffusion species are hard-faceted: cation evidence never leaks into anion queries ---- */
{
  const ds = buildDataset("diffusion", [
    diffusionRecord({ cation: "[EMIM]", anion: "[TFSI]", d: 6.2e-11, tempK: 303, species: "cation" }),
    diffusionRecord({ cation: "[EMIM]", anion: "[TFSI]", d: 3.7e-11, tempK: 303, species: "anion" }),
    diffusionRecord({ cation: "[BMIM]", anion: "[TFSI]", d: 4.0e-11, tempK: 303, species: "cation" }),
  ]);
  const q = {
    cation: describeIon("[EMIM]", "cation"),
    anion: describeIon("[TFSI]", "anion"),
    tempK: 303,
    species: "anion",
  };
  const p = predict("diffusion", ds, q, NORM);
  assert.equal(p.kind, "measured");
  assert.equal(p.value, 3.7e-11, "anion query must return the anion D, never the cation D");
  const none = predict("diffusion", ds, { ...q, species: "Li+" }, NORM);
  assert.equal(none.kind, "insufficient", "an unmeasured tracer species refuses rather than borrowing");
}

/* ---- a record with NO temperature must never read as "measured at" the query T ---- */
{
  const noTemp = conductivityRecord({ cation: "[OMIM]", anion: "[BF4]", sigma: 0.5, tempK: 298 });
  (noTemp.core as any).temperature = null;
  const ds = buildDataset("conductivity", [...SIGMA_RECORDS, noTemp]);
  const p = predict("conductivity", ds, query("[OMIM]", "[BF4]", 400), NORM);
  assert.notEqual(p.kind, "measured", "null-temperature evidence cannot satisfy an exact temperature match");
  if (p.kind === "estimate") {
    const n = p.neighbors.find((x) => x.point.pairKey === "c8mim|bf4" && x.point.tempK == null);
    if (n) assert.ok(n.breakdown.includes("temperature not recorded"), "unknown-T evidence must carry its caveat");
  }
}

/* ---- non-physical query temperatures are treated as absent (no NaN cascade) ---- */
{
  const p = predict("conductivity", DS, query("[C3MIM]", "[BF4]", 0), NORM);
  assert.equal(p.kind, "estimate");
  assert.ok(Number.isFinite(p.value as number) && (p.value as number) > 0, `value ${p.value}`);
  assert.ok(Number.isFinite(p.fold as number), `fold ${p.fold}`);
}

/* ---- borrowed Ea never crosses diffusion species ---- */
{
  const ds = buildDataset("diffusion", [
    // D(cation) has a two-temperature pair → the domain's only fit.
    diffusionRecord({ cation: "[EMIM]", anion: "[TFSI]", d: 6.2e-11, tempK: 303, species: "cation" }),
    diffusionRecord({ cation: "[EMIM]", anion: "[TFSI]", d: 1.5e-10, tempK: 333, species: "cation" }),
    // D(anion) only has a single temperature.
    diffusionRecord({ cation: "[EMIM]", anion: "[TFSI]", d: 3.7e-11, tempK: 303, species: "anion" }),
    diffusionRecord({ cation: "[BMIM]", anion: "[TFSI]", d: 2.0e-11, tempK: 303, species: "anion" }),
  ]);
  assert.equal(ds.fits.length, 1);
  const p = predict(
    "diffusion",
    ds,
    { cation: describeIon("[C3MIM]", "cation"), anion: describeIon("[TFSI]", "anion"), tempK: 330, species: "anion" },
    NORM
  );
  assert.equal(p.kind, "estimate");
  assert.ok(
    p.neighbors.every((n) => n.translation == null),
    "anion-D evidence must not be shifted with the cation-D activation energy"
  );
  assert.ok(
    p.neighbors.every((n) => n.breakdown.includes("untranslated")),
    "the untranslated ΔT penalty path must apply instead"
  );
}

/* ---- 1 K collapse clusters are anchored, not chained ---- */
{
  const sweep = [300, 300.8, 301.6, 302.4].map((tempK, i) =>
    conductivityRecord({ cation: "[BMIM]", anion: "[BF4]", sigma: 0.1 * (i + 1), tempK })
  );
  const ds = buildDataset("conductivity", sweep);
  assert.equal(ds.points.length, 2, "a 2.4 K sweep must not collapse into one point");
}

/* ------------------------------------------------------------------ */
/* Tribology: condition-resolved points + the Dataset-A/B dual pathway */
/* ------------------------------------------------------------------ */

function tribologyRecord(opts: {
  cation: string;
  anion: string;
  cof: number;
  substrate?: string;
  potentialV?: number;
  loadN?: number;
  velocityMps?: number;
  filmThickness?: string;
  filmLayers?: number;
}) {
  nextId += 1;
  return {
    id: `#t${String(nextId).padStart(3, "0")}`,
    status: "official",
    createdAt: "2026-06-10",
    paper: { title: `Friction ${opts.cation}${opts.anion}` },
    core: {
      ionicLiquid: { cation: opts.cation, anion: opts.anion },
      substrate: opts.substrate ?? "HOPG",
      temperature: quantity(298.15, "K"),
      load: quantity(opts.loadN ?? 1e-7, "N"),
      cof: opts.cof,
    },
    extended: {
      scale: "nano",
      potential: opts.potentialV != null ? quantity(opts.potentialV, "V") : undefined,
      velocity: opts.velocityMps != null ? quantity(opts.velocityMps, "m/s") : undefined,
      filmThickness: opts.filmThickness
        ? { raw: opts.filmThickness, value: parseFloat(opts.filmThickness), unit: "nm", std: parseFloat(opts.filmThickness) * 1e-9, stdUnit: "m" }
        : undefined,
      filmLayers: opts.filmLayers,
    },
    flexible: [],
  };
}

/* ---- distinct operating conditions NEVER collapse (non-monotonic μ(U) survives) ---- */
{
  const records = [
    tribologyRecord({ cation: "[BMIM]", anion: "[BF4]", cof: 0.02, potentialV: 0 }),
    tribologyRecord({ cation: "[BMIM]", anion: "[BF4]", cof: 0.08, potentialV: 1 }),
    tribologyRecord({ cation: "[BMIM]", anion: "[BF4]", cof: 0.03, potentialV: 2 }),
    // true replicate of the 0 V point — identical fingerprint, must collapse
    tribologyRecord({ cation: "[BMIM]", anion: "[BF4]", cof: 0.022, potentialV: 0 }),
    // same pair at a very different load — its own point
    tribologyRecord({ cation: "[BMIM]", anion: "[BF4]", cof: 0.3, potentialV: 0, loadN: 1e-3 }),
  ];
  const ds = buildDataset("tribology", records);
  assert.equal(ds.points.length, 4, "3 potentials + 1 load setpoint; the 0 V replicate collapses");

  const q = (potentialV: number) => ({
    cation: describeIon("[BMIM]", "cation"),
    anion: describeIon("[BF4]", "anion"),
    substrate: "HOPG",
    potentialV,
    loadN: 1e-7,
  });
  const at0 = predict("tribology", ds, q(0), NORM);
  assert.equal(at0.kind, "measured");
  assert.ok(Math.abs((at0.value as number) - 0.021) < 1e-9, "0 V returns the 0 V replicates' median, never an average across potentials");
  const at1 = predict("tribology", ds, q(1), NORM);
  assert.equal(at1.kind, "measured");
  assert.equal(at1.value, 0.08, "the non-monotonic 1 V maximum survives grouping");
  const at05 = predict("tribology", ds, q(0.5), NORM);
  assert.notEqual(at05.kind, "measured", "an unmeasured potential is an estimate, not a measurement");
}

/* ---- dual pathway: Dataset-B only when the query specifies h AND records carry it ---- */
{
  const records = [
    tribologyRecord({ cation: "[EMIM]", anion: "[TFSI]", cof: 0.02 }),
    tribologyRecord({ cation: "[BMIM]", anion: "[TFSI]", cof: 0.03 }),
    tribologyRecord({ cation: "[C6MIM]", anion: "[TFSI]", cof: 0.05 }),
    tribologyRecord({ cation: "[EMIM]", anion: "[FAP]", cof: 0.01, filmThickness: "2.5" }),
    tribologyRecord({ cation: "[BMIM]", anion: "[FAP]", cof: 0.015, filmThickness: "1.8" }),
    tribologyRecord({ cation: "[PYR14]", anion: "[TFSI]", cof: 0.06, filmLayers: 3 }),
  ];
  const ds = buildDataset("tribology", records);
  assert.equal(ds.filmPointCount, 3);

  const base = {
    cation: describeIon("[C3MIM]", "cation"),
    anion: describeIon("[TFSI]", "anion"),
    substrate: "HOPG" as string | null,
  };
  const conservative = predict("tribology", ds, base, NORM);
  assert.equal(conservative.facts.pathway, "A");
  assert.equal(conservative.facts.usableN, 6, "pathway A uses every record (h column simply unused)");
  assert.ok(conservative.reasons.some((r) => r.includes("Conservative pathway")));

  const enhanced = predict("tribology", ds, { ...base, filmThicknessM: 2e-9 }, NORM);
  assert.equal(enhanced.facts.pathway, "B");
  assert.equal(enhanced.facts.usableN, 3, "pathway B trains ONLY on film-bearing records");
  assert.ok(
    enhanced.neighbors.every((n) => n.point.conditions && (n.point.conditions.filmThicknessM != null || n.point.conditions.filmLayers != null)),
    "no h-less evidence inside the enhanced pathway"
  );
  assert.ok(enhanced.reasons.some((r) => r.includes("Dataset-B")));

  // h requested but NO film records anywhere → conservative, explicitly no imputation
  const noFilm = buildDataset("tribology", records.slice(0, 3));
  const fallback = predict("tribology", noFilm, { ...base, filmThicknessM: 2e-9 }, NORM);
  assert.equal(fallback.facts.pathway, "A");
  assert.ok(fallback.reasons.some((r) => r.includes("never imputed")));
}

/* ---- substrate conditioning (tribology) prefers same-substrate evidence ---- */
{
  assert.equal(substrateClass("Au(1 1 1)"), "metal");
  assert.equal(substrateClass("HOPG"), "carbon");
  assert.equal(substrateClass("mica"), "ceramic");
  assert.equal(substrateClass("stainless steel"), "metal");
}

/* ---- ion distance: same family is closer than cross family ---- */
{
  const c2 = describeIon("[C2MIM]", "cation");
  const c4 = describeIon("[C4MIM]", "cation");
  const pyr = describeIon("[PYR14]", "cation");
  const p66614 = describeIon("P6,6,6,14", "cation");
  assert.ok(ionDistance(c2, c4, NORM) < ionDistance(c2, pyr, NORM), "same family beats related family");
  assert.ok(ionDistance(c4, pyr, NORM) < ionDistance(c4, p66614, NORM), "related family beats unrelated");
}

/* ------------------------------------------------------------------ */
/* Leave-one-out calibration                                           */
/* ------------------------------------------------------------------ */
{
  const loo = runLoo("conductivity", DS, NORM);
  assert.ok(loo, "9 points unlock LOO");
  assert.ok(loo.n >= CALIBRATION_GATE);
  assert.ok(loo.sigmaCal > 0);
  assert.ok(loo.foldError > 1);

  const tiny = buildDataset("conductivity", SIGMA_RECORDS.slice(0, 3));
  assert.equal(runLoo("conductivity", tiny, NORM), null, "LOO is gated below 8 points");

  // For diffusion the gate is per species: 6 + 4 mixed-species points calibrate nothing.
  // NB: [EMIM] would canonicalize to [C2MIM] and collapse — use distinct keys.
  const cations = ["[C2MIM]", "[C3MIM]", "[C4MIM]", "[C6MIM]", "[C8MIM]", "[PYR14]"];
  const split = buildDataset("diffusion", [
    ...cations.map((c, i) => diffusionRecord({ cation: c, anion: "[TFSI]", d: (i + 1) * 1e-11, tempK: 303, species: "cation" })),
    ...cations.slice(0, 4).map((c, i) => diffusionRecord({ cation: c, anion: "[TFSI]", d: (i + 1) * 2e-11, tempK: 303, species: "anion" })),
  ]);
  assert.equal(split.points.length, 10);
  assert.equal(runLoo("diffusion", split, NORM), null, "no species facet clears the gate → no LOO statistic");

  // calibrated predictions can never be tighter than the LOO floor
  const p = predict("conductivity", DS, query("[C3MIM]", "[BF4]", 298.15), NORM, { sigmaCal: loo.sigmaCal });
  assert.ok((p.facts.sigmaLog as number) >= loo.sigmaCal);
}

console.log("predict/engine tests passed");
