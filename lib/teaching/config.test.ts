import assert from "node:assert/strict";
import { DEFAULT_EXPERIMENT, defaultExperimentChecksum, validateExperimentConfig } from "./config";
import { TEACHING_FIELDS, type TeachingExperimentConfig } from "../teachingShared";

assert.deepEqual(validateExperimentConfig(DEFAULT_EXPERIMENT), []);
assert.equal(DEFAULT_EXPERIMENT.id, "tribology-crossover-2026-v1");
assert.equal(DEFAULT_EXPERIMENT.papers.length, 2);
assert.equal(DEFAULT_EXPERIMENT.papers[0].code, "A");
assert.equal(DEFAULT_EXPERIMENT.papers[1].code, "B");
assert.deepEqual(DEFAULT_EXPERIMENT.papers[0].gold.load.value, {
  kind: "force-range",
  min: 5,
  max: 75,
  unit: "nN",
  tolerance: 1,
  aliases: ["5-75 nN", "5 to 75 nN"],
});
assert.deepEqual(DEFAULT_EXPERIMENT.papers[0].gold.load.evidence.pages, [14]);
assert.deepEqual(DEFAULT_EXPERIMENT.papers[0].gold.load.evidence.anyKeywordSets, [["load", "5", "75", "nN"]]);
assert.deepEqual(DEFAULT_EXPERIMENT.papers[1].gold.temperature.value, {
  kind: "text",
  expected: "room temperature",
  aliases: ["at room temperature", "ambient temperature", "室温"],
});
assert.deepEqual(DEFAULT_EXPERIMENT.papers[1].gold.temperature.evidence.pages, [6, 11]);
assert.deepEqual(DEFAULT_EXPERIMENT.papers[1].gold.temperature.evidence.anyKeywordSets, [["room", "temperature"]]);
assert.deepEqual(DEFAULT_EXPERIMENT.papers[1].gold.load.evidence.pages, [6, 11]);
assert.deepEqual(DEFAULT_EXPERIMENT.papers[1].gold.load.evidence.anyKeywordSets, [["5", "N", "normal force"]]);
assert.deepEqual(DEFAULT_EXPERIMENT.papers[1].gold.cof.evidence.pages, [11, 12]);
for (const paper of DEFAULT_EXPERIMENT.papers) {
  assert.match(paper.sourceUrl, /^https:\/\/www\.mdpi\.com\//);
  assert.ok(paper.taskPrompt.length >= 40);
  assert.deepEqual(Object.keys(paper.aiInitial).sort(), TEACHING_FIELDS.map((field) => field.key).sort());
  assert.deepEqual(Object.keys(paper.gold).sort(), TEACHING_FIELDS.map((field) => field.key).sort());
}
assert.match(defaultExperimentChecksum(), /^[a-f0-9]{64}$/);
assert.equal(defaultExperimentChecksum(), defaultExperimentChecksum(), "checksum must be stable");

const invalid = structuredClone(DEFAULT_EXPERIMENT);
delete (invalid.papers[0].gold as Partial<typeof invalid.papers[0]["gold"]>).cof;
assert.match(validateExperimentConfig(invalid as TeachingExperimentConfig).join("\n"), /paper A.*cof/i);
console.log("Teaching default experiment config tests passed");
