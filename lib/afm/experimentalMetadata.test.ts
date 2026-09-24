import assert from "node:assert/strict";
import { extractAfmExperimentalMetadata } from "./experimentalMetadata";

const text = `We scrutinized 1-ethyl-3-methylimidazolium bis(trifluoromethylsulfonyl)imide
(abbreviated as [EMIM][TFSI]) at graphene. Curves were measured on single-layer
and bilayer graphene supported on gold and silica at a constant approach speed
of 10 nm/s, all measured with a silicon tip. Spring constant of cantilever =
0.3507 N/m and Si-tip with radius = 35 nm.`;

const result = extractAfmExperimentalMetadata(text);
assert.equal(result.ionicLiquids[0].value, "[EMIM][TFSI]");
assert.ok(result.substrates.some((field) => field.value === "bilayer graphene"));
assert.equal(result.probe.material.value, "silicon");
assert.equal(result.probe.tipRadius.value, 35);
assert.equal(result.probe.tipRadius.unit, "nm");
assert.equal(result.probe.cantileverSpringConstant.value, 0.3507);
assert.equal(result.acquisition.approachSpeed.value, 10);
assert.equal(result.externalFactors.temperature.status, "not-reported");

const protic = extractAfmExperimentalMetadata(`Atomic force spectroscopy was performed using a Cypher AFM.
An epi-polished Pt (100) single crystal served as the working electrode. Au-coated Si tips were used
to perform force spectroscopy. The typical force constant was in the range of 5 N/m. Force-distance
curves were performed at an approach speed of 30 nm/s. The initial water content of neat [Dema][TfO]
was in the range of 0.2 to 0.25 wt%, as determined by Karl Fischer titration.`);
assert.equal(protic.substrates[0]?.value, "Pt(100)");
assert.equal(protic.probe.material.value, "gold-coated silicon");
assert.equal(protic.probe.cantileverSpringConstant.value, 5);
assert.equal(protic.acquisition.technique.value, "atomic force spectroscopy");
assert.equal(protic.externalFactors.waterContent.value, "0.2 to 0.25 wt%");

console.log("AFM experimental metadata tests passed");
