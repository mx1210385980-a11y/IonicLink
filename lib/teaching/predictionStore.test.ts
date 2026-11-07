import assert from "node:assert/strict";
import { createPredictionSubmission, listPredictionSubmissions } from "./predictionStore";
import { validatePredictionSubmission } from "./predictionValidation";
import { PREDICTION_MAX_IMAGE_DATA_URL_LENGTH } from "./predictionShared";
import { closeTeachingStoreForTests } from "./store";

const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const parameters = {
  strategy: "triple",
  options: { base: "catboost+forest+xgboost", meta: "catboost", low_catboost_learning_rate: "0.07" },
};
const input = { screenshot: png, reflection: "  Increasing the low-region rate reduced the visible bias.  ", parameters };

const alice = createPredictionSubmission({ userKey: "student-alice", studentName: "Alice" }, input);
assert.equal(alice.reflection, "Increasing the low-region rate reduced the visible bias.");
assert.equal(alice.parameters.strategy, "triple");
const bob = createPredictionSubmission({ userKey: "student-bob", studentName: "Bob" }, {
  ...input,
  parameters: { strategy: "dual", options: { pair: "catboost+xgboost", weight: "65" } },
  reflection: "The 65/35 blend looks more stable on the test points.",
});
assert.equal(listPredictionSubmissions()[0].id, bob.id, "teacher dashboard is newest first");
assert.deepEqual(listPredictionSubmissions("student-alice").map((item) => item.id), [alice.id], "students only receive their own submissions");
assert.equal(listPredictionSubmissions("student-bob")[0].parameters.options.weight, "65");

assert.throws(() => validatePredictionSubmission({ ...input, screenshot: png.replace("image/png", "image/jpeg") }), /PNG/);
assert.throws(() => validatePredictionSubmission({ ...input, screenshot: "data:image/png;base64,AAAA" }), /PNG/);
assert.throws(() => validatePredictionSubmission({ ...input, screenshot: `data:image/png;base64,${"A".repeat(PREDICTION_MAX_IMAGE_DATA_URL_LENGTH)}` }), /smaller/);
assert.throws(() => validatePredictionSubmission({ ...input, reflection: "   " }), /Reflection/);
assert.throws(() => validatePredictionSubmission({ ...input, reflection: "x".repeat(2001) }), /2000/);
assert.throws(() => validatePredictionSubmission({ ...input, parameters: { strategy: "other", options: {} } }), /strategy/);
assert.throws(() => validatePredictionSubmission({ ...input, parameters: { strategy: "single", options: { model: "catboost", unexpected: "1" } } }), /unexpected/);
assert.throws(() => validatePredictionSubmission({ ...input, parameters: { strategy: "dual", options: { pair: "catboost+xgboost", weight: "101" } } }), /weight/);

// The teaching database, rather than browser storage, is the durable source.
closeTeachingStoreForTests();
assert.equal(listPredictionSubmissions().length, 2);
assert.equal(listPredictionSubmissions("student-alice")[0].screenshot, png);

console.log("Prediction submission PNG validation, persistence, ownership and dashboard tests passed");
