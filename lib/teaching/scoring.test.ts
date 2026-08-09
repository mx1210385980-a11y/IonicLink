import assert from "node:assert/strict";
import { DEFAULT_EXPERIMENT } from "./config";
import {
  normalizeTeachingText,
  scoreAiBehavior,
  scoreEvidence,
  scoreSubmission,
  scoreValue,
} from "./scoring";
import type { TeachingGoldRule } from "../teachingShared";

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
assert.equal(scoreValue("[EMIM]", paperA.gold.cation).correct, true);
assert.equal(scoreValue("1-ethyl-3-methylimidazolium", paperA.gold.cation).correct, true);
assert.equal(scoreValue("25 C", roomTemperatureRule).correct, true);
assert.equal(scoreValue("5 to 75 nN", paperA.gold.load).correct, true);
assert.equal(scoreValue("5 to 75 nN", paperA.gold.load).reason, "alias_match");
assert.equal(scoreValue("15 to 75 nN", paperA.gold.load).correct, false);
assert.equal(scoreValue("0.045", paperA.gold.cof).correct, true);
assert.equal(scoreValue("", paperA.gold.cof).correct, false);
assert.equal(scoreValue("room temperature", paperB.gold.temperature).correct, true);
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
