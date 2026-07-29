import assert from "node:assert/strict";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DesignStudio, summarizeDesignReadiness } from "./DesignStudio";
import { conditionEvidence, formatForceText, formatPotentialText, formatVelocityText } from "./PredictBench";
import { buildDataset, operatingConditions } from "../../lib/predict/dataset";
import { parseQuantity } from "../../lib/units";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

function quantity(value: number, stdUnit: string) {
  return { raw: `${value} ${stdUnit}`, value, unit: stdUnit, std: value, stdUnit };
}

let nextId = 0;
function tribologyRecord(
  cation: string,
  anion: string,
  cof: number,
  substrate = "mica",
  scale = "nano",
  basis?: "direct" | "inferred" | "assumed"
) {
  nextId += 1;
  return {
    id: `#t${String(nextId).padStart(3, "0")}`,
    status: nextId % 3 === 0 ? "review" : "official",
    createdAt: "2026-06-10",
    paper: { title: `Friction of ${cation}${anion}` },
    core: {
      ionicLiquid: { cation, anion },
      substrate,
      temperature: quantity(298.15, "K"),
      load: quantity(1e-7, "N"),
      cof,
    },
    extended: { scale },
    flexible: [],
    provenance: { cof: { page: 2, quote: `mu = ${cof}`, ...(basis ? { basis } : {}) } },
  };
}

function visibleText(html: string) {
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function conductivityRecord(cation: string, anion: string, sigma: number, tempK: number) {
  nextId += 1;
  return {
    id: `#c${String(nextId).padStart(3, "0")}`,
    status: "review",
    createdAt: "2026-06-10",
    paper: { title: `Conductivity of ${cation}${anion}` },
    core: {
      ionicLiquid: { cation, anion },
      surface: "Pt",
      temperature: quantity(tempK, "K"),
      conductivity: quantity(sigma, "S/m"),
    },
    extended: {},
    flexible: [],
  };
}

/* ---- tribology: 9 usable records → full instrument, measured readout for the default pair ---- */
{
  const records = [
    tribologyRecord("[EMIM]", "[TFSI]", 0.02),
    tribologyRecord("[EMIM]", "[TFSI]", 0.04),
    tribologyRecord("[C4C1Im]", "[TFSI]", 0.03),
    tribologyRecord("[C6C1Im]", "[TFSI]", 0.05),
    tribologyRecord("[BMIm]", "[EtSO4]", 0.004),
    tribologyRecord("[EMIM]", "[FAP]", 0.01, "Au(111)"),
    tribologyRecord("[PYR14]", "[TFSI]", 0.06),
    tribologyRecord("[C8MIM]", "[TFSI]", 0.08),
    tribologyRecord("[C2MIM]", "[EtSO4]", 0.005),
    // a macroscale tribometer record — must be excluded, visibly, not trained on
    tribologyRecord("[EMIM]", "[TFSI]", 0.45, "steel", "macro"),
  ];
  for (const r of records) r.status = "official";
  const html = renderToStaticMarkup(createElement(DesignStudio, { domain: "tribology", records }));
  assert.match(html, /Design Studio/);
  assert.match(html, /data-testid="studio-workbench-header"/);
  assert.match(html, /data-testid="model-ribbon"/);
  assert.match(html, /grid-cols-\[auto_minmax\(0,1fr\)_auto\]/);
  assert.match(
    html,
    /<input[^>]*type="checkbox"[^>]*checked=""[^>]*\/>checked records only/,
    "the studio opens on approved evidence; review records are opt-in for model training"
  );
  assert.match(html, /usable points/);
  assert.match(html, /data-testid="data-readiness"/);
  assert.match(visibleText(html), /8 \/ 8 usable points Calibration gate reached\./);
  assert.match(visibleText(html), /Statistical estimates and candidate ranking are available\./);
  assert.match(visibleText(html), /scope excluded 1/);
  assert.match(visibleText(html), /property evidence direct 0 inferred 0 assumed 0 unlabeled 9/);
  assert.doesNotMatch(visibleText(html), /review hidden|model unusable/, "zero-count exclusions stay out of the compact card");
  assert.match(html, /href="#candidate-atlas"[^>]*>Open candidate atlas</);
  assert.match(html, /id="candidate-atlas"/);
  assert.match(html, /Model ribbon/, "the live model facts are grouped in the refined ribbon");
  assert.match(html, /Query/, "the prediction bench has a named query column");
  assert.match(html, /Result/, "the prediction bench has a named result column");
  assert.match(html, /Measured record/, "the default bench pair is measured — the readout must say so");
  assert.match(html, /not a prediction/);
  assert.match(html, /LOO/, "9 usable records unlock leave-one-out calibration");
  assert.match(html, /Design explorer/);
  assert.match(html, /Calibration certificate/);
  assert.match(html, /checked records only/);
  assert.doesNotMatch(html, /Knowledge Consolidation/, "the old knowledge page is gone");
  // the condition-resolved lubrication model surfaces
  assert.match(html, /Operating conditions/, "tribology bench exposes load/speed/potential/film inputs");
  assert.match(html, /Film thickness h/);
  assert.match(html, /h on file/, "census reports the Dataset-B pool size");
  assert.match(html, /Dual pathway — film thickness h/, "the model card documents Dataset-A\\/B");
  assert.match(html, /never (consulted|imputed)/, "the no-imputation contract is stated");
  assert.match(html, /Thesis research basis/, "the design module carries the paper's research contribution");
  assert.match(html, /Dataset-A\s*256/, "the paper's no-film dataset size is visible");
  assert.match(html, /Dataset-B\s*212/, "the paper's film-enhanced dataset size is visible");
  assert.match(html, /Gate regime/, "ranked candidates show the paper's low\\/mid\\/high friction gate");
  assert.match(html, /Paper-derived rationale/, "candidate advice is tied to the paper's SHAP findings");
  // nanoscale-only scope: the macro record is out of the model and says so
  assert.match(html, /nano-only/, "the model ribbon declares the nanoscale scope");
  assert.match(html, /Nanoscale friction coefficient/, "the studio is framed as a nanoscale friction model");
  assert.match(html, /1 macroscale \(or unscaled\) record excluded/, "the exclusion ledger counts the macro record");
  // the educational model lab with the study's metrics
  assert.match(html, /Model lab — tune the estimator/, "the educational lab renders for tribology");
  assert.match(html, /R²/);
  assert.match(html, /RMSE/);
  assert.match(html, /MAE/);
  assert.match(html, /Kernel bandwidth/);
}

/* ---- readiness summary: every included property member lands in exactly one evidence bucket ---- */
{
  const included = [
    tribologyRecord("[EMIM]", "[TFSI]", 0.02, "mica", "nano", "direct"),
    tribologyRecord("[C4C1Im]", "[TFSI]", 0.03, "mica", "nano", "inferred"),
    tribologyRecord("[PYR14]", "[TFSI]", 0.06, "mica", "nano", "assumed"),
    tribologyRecord("[BMIm]", "[EtSO4]", 0.004),
  ];
  for (const record of included) record.status = "official";

  const hiddenReview = tribologyRecord("[C6C1Im]", "[TFSI]", 0.05);
  hiddenReview.status = "review";
  const outOfScope = tribologyRecord("[C8MIM]", "[TFSI]", 0.08, "steel", "macro");
  outOfScope.status = "official";
  const unusable = tribologyRecord("[C2MIM]", "[EtSO4]", 0.005);
  unusable.status = "official";
  (unusable.core as { cof?: number }).cof = undefined;

  const dataset = buildDataset("tribology", [...included, hiddenReview, outOfScope, unusable], {
    includeReview: false,
    nanoOnly: true,
  });
  const summary = summarizeDesignReadiness(dataset);
  assert.deepEqual(summary, {
    usable: 4,
    gate: 8,
    gap: 4,
    ready: false,
    recordCount: 4,
    reviewExcludedCount: 1,
    scaleExcludedCount: 1,
    modelExclusions: 1,
    evidenceBasis: { direct: 1, inferred: 1, assumed: 1, unlabeled: 1 },
  });
  assert.equal(
    Object.values(summary.evidenceBasis).reduce((total, count) => total + count, 0),
    summary.recordCount,
    "evidence buckets are mutually exclusive and exhaustive over included members"
  );

  const html = renderToStaticMarkup(
    createElement(DesignStudio, { domain: "tribology", records: [...included, hiddenReview, outOfScope, unusable] })
  );
  const text = visibleText(html);
  assert.match(text, /included records 4/);
  assert.match(text, /scope excluded 1/);
  assert.match(text, /review hidden 1/);
  assert.match(text, /model unusable 1/);
  assert.match(text, /property evidence direct 1 inferred 1 assumed 1 unlabeled 1/);
}

/* ---- evaluation lab is a small link-out, not a heavy panel on the Design page ---- */
{
  const records = [
    tribologyRecord("[EMIM]", "[TFSI]", 0.02),
    tribologyRecord("[EMIM]", "[TFSI]", 0.04),
    tribologyRecord("[C4C1Im]", "[TFSI]", 0.03),
    tribologyRecord("[C6C1Im]", "[TFSI]", 0.05),
    tribologyRecord("[BMIm]", "[EtSO4]", 0.004),
    tribologyRecord("[EMIM]", "[FAP]", 0.01, "Au(111)"),
    tribologyRecord("[PYR14]", "[TFSI]", 0.06),
    tribologyRecord("[C8MIM]", "[TFSI]", 0.08),
    tribologyRecord("[C2MIM]", "[EtSO4]", 0.005),
  ];
  for (const r of records) r.status = "official";
  const html = renderToStaticMarkup(createElement(DesignStudio, { domain: "tribology", records, evaluationLabHref: "/tribology/design/evaluation" }));
  assert.match(html, /Model Evaluation Lab/);
  assert.match(html, /Open lab/);
  assert.match(html, /href="\/tribology\/design\/evaluation"/);
  assert.doesNotMatch(html, /Training &amp; Testing Performance/, "full evaluation charts are not on the Design page");
  assert.doesNotMatch(html, /WFF/, "student-facing entry should not expose source acronym");
}

/* ---- conductivity at n=3 (today's real scale): gated, honest, no invented numbers ---- */
{
  const records = [
    conductivityRecord("[BMIM]", "[BF4]", 0.35, 298.15),
    conductivityRecord("[BMIM]", "[BF4]", 1.2, 353.15),
    conductivityRecord("[PYR14]", "[TFSI]", 0.26, 298.15),
  ];
  const html = renderToStaticMarkup(createElement(DesignStudio, { domain: "conductivity", records }));
  assert.match(html, /Design Studio/);
  assert.match(visibleText(html), /3 \/ 8 usable points 5 more usable points needed\./);
  assert.match(visibleText(html), /Cited analog \/ coverage mode\. Statistical estimates and ranking unlock at 8 usable points\./);
  assert.match(html, /href="\/conductivity\/database\?status=review"[^>]*>Review evidence</);
  assert.match(html, /calibration unavailable — outputs are cited analog lookups/);
  assert.match(html, /Coverage mode/, "the atlas degrades to coverage-only below the gate");
  assert.match(html, /Measured record/, "exact matches still show the measurement when gated");
  assert.match(html, /Insufficient data for validation/);
}

/* ---- a locked workspace with no Review work routes to extraction, not an empty queue ---- */
{
  const html = renderToStaticMarkup(createElement(DesignStudio, { domain: "conductivity", records: [] }));
  assert.match(html, /href="\/conductivity\/extract"[^>]*>Add evidence</);
  assert.doesNotMatch(html, /href="\/conductivity\/database\?status=review"[^>]*>Review evidence</);
}

/* ---- pick-first bench inputs: evidence chips must round-trip the platform's own parser ---- */
{
  assert.equal(formatForceText(1e-8), "10 nN");
  assert.equal(formatForceText(2.5e-4), "250 µN");
  assert.equal(formatForceText(3), "3 N");
  assert.equal(formatVelocityText(6e-6), "6 µm/s");
  assert.equal(formatVelocityText(0.02), "20 mm/s");
  assert.equal(formatPotentialText(1), "+1 V");
  assert.equal(formatPotentialText(-0.5), "-0.5 V");
  // every chip the bench offers must parse back to the std value it came from
  for (const [text, dim, std] of [
    ["10 nN", "force", 1e-8],
    ["250 µN", "force", 2.5e-4],
    ["6 µm/s", "velocity", 6e-6],
    ["+1 V", "potential", 1],
    ["-0.5 V", "potential", -0.5],
    ["2.5 nm", "length", 2.5e-9],
  ] as const) {
    const q = parseQuantity(text, dim);
    assert.ok(q?.std != null, `chip text "${text}" must parse`);
    assert.ok(Math.abs((q!.std as number) - std) <= Math.abs(std) * 1e-6, `chip "${text}" round-trips to ${std}`);
  }

  const records = [
    tribologyRecord("[EMIM]", "[TFSI]", 0.02),
    tribologyRecord("[EMIM]", "[TFSI]", 0.04),
    tribologyRecord("[BMIm]", "[EtSO4]", 0.004),
  ];
  const dataset = buildDataset("tribology", records, { includeReview: true });
  const ev = conditionEvidence(dataset);
  assert.deepEqual(ev.load, ["100 nN"], "the fixtures' shared 1e-7 N load surfaces as one chip");
  assert.deepEqual(ev.velocity, []);
  assert.deepEqual(ev.film, []);

  const html = renderToStaticMarkup(createElement(DesignStudio, { domain: "tribology", records }));
  assert.match(html, /data-testid="ion-picker-cation"/);
  assert.match(html, /data-testid="ion-picker-anion"/);
  // popovers are closed by default
  assert.doesNotMatch(html, /data-testid="ion-picker-popover-cation"/);
  assert.match(html, /measured:/, "condition fields surface click-to-fill measured chips");
  assert.match(html, /100 nN/);
}

/* ---- film fallback hygiene: prose flexible fields never become a film thickness ---- */
{
  const flex = (key: string, value: string, unit = "") => ({
    core: {},
    extended: {},
    flexible: [{ key, value, unit }],
  });
  assert.equal(
    operatingConditions(flex("film preparation", "IL film on graphite from 10−3 mL ILs/mL acetone; 1 μL deposited on 1 cm2 graphite")).filmThicknessM,
    null,
    "a 'film preparation' note is prose, not a thickness — it must not enter the Dataset-B pool"
  );
  assert.equal(operatingConditions(flex("film thickness transition", "D+Δ = 4 nm to D+Δ = 3 nm", "nm")).filmThicknessM, null);
  const good = operatingConditions(flex("film thickness", "2.5", "nm")).filmThicknessM;
  assert.ok(good != null && Math.abs(good - 2.5e-9) < 1e-15, "a genuine film-thickness field still parses");
}

/* ---- empty domain: the refusal state is designed, not broken ---- */
{
  const html = renderToStaticMarkup(createElement(DesignStudio, { domain: "diffusion", records: [] }));
  assert.match(html, /Design Studio/);
  assert.match(html, /No number — by design/);
  assert.match(html, /Extract a paper/);
}

console.log("DesignStudio tests passed");
