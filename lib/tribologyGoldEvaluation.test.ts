import assert from "node:assert/strict";
import {
  buildFieldMetrics,
  buildGoldEvaluationReport,
  TRIBOLOGY_GOLD_FIELDS,
  type GoldAnnotationDocument,
} from "./tribologyGoldEvaluation";
import type { ExtractedFields } from "./schema";

const paper = { title: "Gold Fixture Paper", doi: "10.0000/gold" };

function extracted(fields: Partial<ExtractedFields>): ExtractedFields {
  return {
    paper,
    cation: "[BMIM]",
    anion: "[BF4]",
    substrate: "mica",
    temperature: "25 C",
    load: "5 nN",
    cof: 0.12,
    scale: "nano",
    method: "AFM",
    ...fields,
  };
}

const goldDocs: GoldAnnotationDocument[] = [
  {
    id: "doc-a",
    title: paper.title,
    doi: paper.doi,
    text: "[PAGE 1]\nGold fixture text",
    goldRecords: [
      extracted({
        potential: "0.5 V",
        velocity: "2 um/s",
        roughness: "1 nm",
        filmThickness: "3 layers",
        concentration: "neat",
      }),
      extracted({
        cation: "[EMIM]",
        anion: "[TFSI]",
        substrate: "HOPG",
        load: "10 nN",
        cof: 0.08,
        potential: "-0.2 V",
        velocity: "4 um/s",
      }),
    ],
  },
];

const predictions = {
  "doc-a": [
    extracted({
      potential: "0.50 V",
      velocity: "2 µm/s",
      roughness: "1 nm",
      filmThickness: "3 layers",
      concentration: "neat",
    }),
    extracted({
      cation: "[EMIM]",
      anion: "[TFSI]",
      substrate: "graphite",
      load: "10 nN",
      cof: 0.09,
      potential: "-0.2 V",
      velocity: "4 um/s",
    }),
    extracted({
      cation: "[PYR14]",
      anion: "[FAP]",
      substrate: "Au(111)",
      load: "2 nN",
      cof: 0.04,
    }),
  ],
};

const report = buildGoldEvaluationReport(goldDocs, predictions);

assert.equal(report.domain, "tribology");
assert.equal(report.documents, 1);
assert.equal(report.goldRecords, 2);
assert.equal(report.predictedRecords, 3);
assert.ok(TRIBOLOGY_GOLD_FIELDS.includes("cof"));

const metrics = buildFieldMetrics(report);

assert.deepEqual(metrics.byField.cation, {
  field: "cation",
  truePositive: 2,
  falsePositive: 1,
  falseNegative: 0,
  precision: 2 / 3,
  recall: 1,
  f1: 0.8,
});
assert.deepEqual(metrics.byField.substrate, {
  field: "substrate",
  truePositive: 1,
  falsePositive: 2,
  falseNegative: 1,
  precision: 1 / 3,
  recall: 0.5,
  f1: 0.4,
});
assert.deepEqual(metrics.byField.cof, {
  field: "cof",
  truePositive: 1,
  falsePositive: 2,
  falseNegative: 1,
  precision: 1 / 3,
  recall: 0.5,
  f1: 0.4,
});
assert.equal(metrics.micro.truePositive, 25);
assert.equal(metrics.micro.falsePositive, 12);
assert.equal(metrics.micro.falseNegative, 2);
assert.equal(Number(metrics.micro.precision.toFixed(4)), 0.6757);
assert.equal(Number(metrics.micro.recall.toFixed(4)), 0.9259);
assert.equal(Number(metrics.micro.f1.toFixed(4)), 0.7813);
assert.ok(metrics.macro.f1 > 0.63 && metrics.macro.f1 < 0.65);

console.log("Tribology gold evaluation tests passed");
