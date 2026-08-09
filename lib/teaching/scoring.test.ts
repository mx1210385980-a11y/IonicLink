import assert from "node:assert/strict";
import { DEFAULT_EXPERIMENT } from "./config";
import {
  normalizeTeachingText,
  scoreAiBehavior,
  scoreEvidence,
  scoreSubmission,
  scoreValue,
} from "./scoring";
import type { TeachingAnswers, TeachingGoldRule } from "../teachingShared";

const paperA = DEFAULT_EXPERIMENT.papers[0];
const paperB = DEFAULT_EXPERIMENT.papers[1];
const roomTemperatureRule: TeachingGoldRule = {
  value: {
    kind: "temperature",
    kelvin: 298.15,
    toleranceKelvin: 0.5,
    aliases: ["room temperature"],
  },
  evidence: { pages: [1], anyKeywordSets: [["temperature"]] },
};

assert.equal(normalizeTeachingText("  Ｍμ–N  "), "mu-n");
assert.equal(normalizeTeachingText("Μ = 0.04"), "u = 0.04");
assert.equal(scoreValue("[EMIM]", paperA.gold.cation).correct, true);
assert.equal(scoreValue("1-ethyl-3-methylimidazolium", paperA.gold.cation).correct, true);
assert.equal(scoreValue("25 C", roomTemperatureRule).correct, true);
assert.equal(scoreValue("298.5 K", roomTemperatureRule).correct, true);
assert.equal(scoreValue("25.4 C", roomTemperatureRule).correct, true);
assert.equal(scoreValue("25.6 C", roomTemperatureRule).correct, false);
assert.equal(scoreValue("25", roomTemperatureRule).reason, "unit_missing");
assert.equal(scoreValue("25 F", roomTemperatureRule).correct, false);
assert.equal(scoreValue("5 to 75 nN", paperA.gold.load).correct, true);
assert.equal(scoreValue("5 to 75 nN", paperA.gold.load).reason, "alias_match");
assert.equal(scoreValue("6 to 74 nN", paperA.gold.load).correct, true);
assert.equal(scoreValue("6.1 to 75 nN", paperA.gold.load).correct, false);
assert.equal(scoreValue("5 to 75", paperA.gold.load).reason, "unit_missing");
assert.equal(scoreValue("5 to 75 N", paperA.gold.load).correct, false);
assert.equal(scoreValue("5/75 nN", paperA.gold.load).correct, false);
assert.equal(scoreValue("15 to 75 nN", paperA.gold.load).correct, false);
assert.equal(scoreValue("[COF] = 0.04", paperA.gold.cof).correct, true);
assert.equal(scoreValue("0.045", paperA.gold.cof).correct, true);
assert.equal(scoreValue("0.046", paperA.gold.cof).correct, false);
assert.equal(scoreValue("0.04 N", paperA.gold.cof).correct, false);
assert.equal(scoreValue("COF 0-04", paperA.gold.cof).correct, false);
assert.equal(scoreValue("COF - 0.17", paperB.gold.cof).correct, false);
assert.equal(scoreValue("COF -(0.17)", paperB.gold.cof).correct, false);
assert.equal(scoreValue("", paperA.gold.cof).correct, false);
assert.equal(scoreValue("room temperature", paperB.gold.temperature).correct, true);
assert.equal(scoreValue("298.15 K", paperB.gold.temperature).correct, false);
assert.equal(scoreValue("未报告", paperB.gold.temperature).correct, false);
assert.equal(
  scoreEvidence({ value: "0.04", page: "5", evidence: "IL-44% μ = 0.04" }, paperA.gold.cof)
    .correct,
  true
);
assert.equal(
  scoreEvidence({ value: "0.04", page: "9", evidence: "0.04" }, paperA.gold.cof).correct,
  false
);
assert.equal(
  scoreEvidence({ value: "0.04", page: "5", evidence: "reported 0-04" }, paperA.gold.cof)
    .correct,
  false
);
assert.equal(
  scoreEvidence(
    { value: "5-75 nN", page: "14", evidence: "normal load 5-75 nN" },
    paperA.gold.load
  ).correct,
  true
);
assert.equal(
  scoreEvidence(
    { value: "5-75 nN", page: "14", evidence: "normal load 5/75 nN" },
    paperA.gold.load
  ).correct,
  false
);
assert.equal(
  scoreEvidence(
    { value: "5 N total load", page: "6", evidence: "normal force -5 N" },
    paperB.gold.load
  ).correct,
  false
);
assert.equal(
  scoreEvidence(
    { value: "5 N total load", page: "6", evidence: "normal force - 5 N" },
    paperB.gold.load
  ).correct,
  false
);
assert.equal(
  scoreEvidence(
    { value: "5 N total load", page: "6", evidence: "normal force -(5) N" },
    paperB.gold.load
  ).correct,
  false
);
assert.equal(
  scoreEvidence(
    { value: "5 N total load", page: "6", evidence: "normal force 5:0 N" },
    paperB.gold.load
  ).correct,
  false
);
assert.equal(
  scoreEvidence(
    { value: "not reported", page: "", evidence: "文中未报告温度" },
    paperA.gold.temperature
  ).correct,
  true
);
const noKeywordRule = structuredClone(paperA.gold.cof);
noKeywordRule.evidence.anyKeywordSets = [];
assert.equal(
  scoreEvidence({ value: "0.04", page: "5", evidence: "arbitrary text" }, noKeywordRule).correct,
  false
);
const emptyKeywordSetRule = structuredClone(paperA.gold.temperature);
emptyKeywordSetRule.evidence.anyKeywordSets = [[]];
assert.equal(
  scoreEvidence(
    { value: "not reported", page: "", evidence: "arbitrary text" },
    emptyKeywordSetRule
  ).correct,
  false
);
assert.equal(
  scoreSubmission({}, paperA).valueAccuracy,
  0,
  "blank answers count against all six fields"
);
assert.equal(scoreSubmission({}, paperA).valueCoverage, 0);
assert.equal(
  scoreSubmission({ cation: { value: "EMIM", evidence: "EMIM" } }, paperA).evidenceCoverage,
  0,
  "ordinary evidence needs both a page and evidence text to count as covered"
);
assert.equal(
  scoreSubmission(
    {
      temperature: {
        value: "not reported",
        page: "",
        evidence: "temperature not reported",
      },
    },
    paperA
  ).evidenceCoverage,
  1 / 6,
  "explicit not-reported evidence may be covered without a page"
);
assert.equal(
  scoreSubmission(
    { temperature: { value: "not reported", page: "", evidence: "arbitrary text" } },
    paperA
  ).evidenceCoverage,
  0,
  "an empty page is not covered when not-reported evidence is not explicit"
);
assert.equal(
  scoreSubmission(
    { cation: { value: "EMIM", page: "999", evidence: "EMIM" } },
    paperA
  ).evidenceCoverage,
  1 / 6,
  "coverage records a page-and-evidence attempt even when the page is wrong"
);
assert.equal(
  scoreSubmission({ cation: { value: "EMIM", page: "2", evidence: "" } }, paperA)
    .evidenceCoverage,
  0,
  "a page without evidence text is not covered"
);

const blankScore = scoreSubmission({}, paperA);
const blankBehavior = scoreAiBehavior({}, {}, blankScore, blankScore);
assert.deepEqual(
  {
    adoptionRate: blankBehavior.adoptionRate,
    modificationRate: blankBehavior.modificationRate,
    correctionRate: blankBehavior.correctionRate,
    incorrectAdoptionRate: blankBehavior.incorrectAdoptionRate,
  },
  {
    adoptionRate: null,
    modificationRate: null,
    correctionRate: null,
    incorrectAdoptionRate: null,
  }
);

const wrongAi: TeachingAnswers = { load: structuredClone(paperA.aiInitial.load) };
const unchangedWrongFinal = structuredClone(wrongAi);
const wrongAiBehavior = scoreAiBehavior(
  wrongAi,
  unchangedWrongFinal,
  scoreSubmission(wrongAi, paperA),
  scoreSubmission(unchangedWrongFinal, paperA)
);
assert.equal(wrongAiBehavior.incorrectlyAdopted, 1);
assert.equal(wrongAiBehavior.incorrectAdoptionRate, 1);

const singleAi: TeachingAnswers = {
  cation: { value: "EMIM", page: "2", evidence: "[EMIM][TFSI]" },
};
const pageOnlyFinal = structuredClone(singleAi);
pageOnlyFinal.cation = { ...pageOnlyFinal.cation!, page: "3" };
const pageOnlyBehavior = scoreAiBehavior(
  singleAi,
  pageOnlyFinal,
  scoreSubmission(singleAi, paperA),
  scoreSubmission(pageOnlyFinal, paperA)
);
assert.equal(pageOnlyBehavior.modified, 1);

const evidenceOnlyFinal = structuredClone(singleAi);
evidenceOnlyFinal.cation = { ...evidenceOnlyFinal.cation!, evidence: "EMIM cation" };
const evidenceOnlyBehavior = scoreAiBehavior(
  singleAi,
  evidenceOnlyFinal,
  scoreSubmission(singleAi, paperA),
  scoreSubmission(evidenceOnlyFinal, paperA)
);
assert.equal(evidenceOnlyBehavior.modified, 1);

const punctuationAi: TeachingAnswers = {
  cof: { value: "0.17", page: "11", evidence: "mean value was COF = 0.17" },
};
const punctuationFinal = structuredClone(punctuationAi);
punctuationFinal.cof = { ...punctuationFinal.cof!, evidence: "mean value was COF = 0-17" };
const punctuationBehavior = scoreAiBehavior(
  punctuationAi,
  punctuationFinal,
  scoreSubmission(punctuationAi, paperB),
  scoreSubmission(punctuationFinal, paperB)
);
assert.equal(punctuationBehavior.adopted, 0);
assert.equal(punctuationBehavior.modified, 1);

const spacedSignFinal = structuredClone(punctuationAi);
spacedSignFinal.cof = {
  ...spacedSignFinal.cof!,
  evidence: "mean value was COF = - 0.17",
};
const spacedSignBehavior = scoreAiBehavior(
  punctuationAi,
  spacedSignFinal,
  scoreSubmission(punctuationAi, paperB),
  scoreSubmission(spacedSignFinal, paperB)
);
assert.equal(spacedSignBehavior.adopted, 0);
assert.equal(spacedSignBehavior.modified, 1);

const parenthesizedSignFinal = structuredClone(punctuationAi);
parenthesizedSignFinal.cof = {
  ...parenthesizedSignFinal.cof!,
  evidence: "mean value was COF = -(0.17)",
};
const parenthesizedSignBehavior = scoreAiBehavior(
  punctuationAi,
  parenthesizedSignFinal,
  scoreSubmission(punctuationAi, paperB),
  scoreSubmission(parenthesizedSignFinal, paperB)
);
assert.equal(parenthesizedSignBehavior.adopted, 0);
assert.equal(parenthesizedSignBehavior.modified, 1);

const correctedFinalAnswers = structuredClone(paperA.aiInitial);
correctedFinalAnswers.temperature = {
  value: "not reported",
  page: "",
  evidence: "temperature not reported",
};
correctedFinalAnswers.load = {
  value: "5–75 nN",
  page: "14",
  evidence: "load from 5 to 75 nN",
};
const behavior = scoreAiBehavior(
  paperA.aiInitial,
  correctedFinalAnswers,
  scoreSubmission(paperA.aiInitial, paperA),
  scoreSubmission(correctedFinalAnswers, paperA)
);
assert.equal(behavior.initiallyIncorrect, 2);
assert.equal(behavior.corrected, 2);
assert.equal(behavior.correctionRate, 1);

console.log("Teaching deterministic scoring tests passed");
