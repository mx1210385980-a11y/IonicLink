import assert from "node:assert/strict";
import { adaptDiffusionDataset } from "./datasets/diffusion";
import type { TabularSheet } from "./datasets/types";
import { commitDatasetImport, listRecords, resetAll } from "./db";

resetAll("diffusion");
const sheet: TabularSheet = {
  name: "Sheet1",
  headerRow: 1,
  headers: ["ionic_liquid", "D_cation", "D_anion", "D_unit", "temperature_value", "system_name"],
  rows: [{ rowNumber: 2, values: ["[EMIM][TFSI]", 5.2, 4.1, "10^-11 m2/s", 303, "MCM-41"] }],
};
const adaptation = adaptDiffusionDataset([sheet], {
  filename: "fixture.xlsx",
  fingerprint: "same-file",
  paperTitle: "Fixture paper",
});

const first = commitDatasetImport("diffusion", {
  fingerprint: "same-file",
  filename: "fixture.xlsx",
  adapter: adaptation.adapter,
  drafts: adaptation.drafts,
});
const second = commitDatasetImport("diffusion", {
  fingerprint: "same-file",
  filename: "fixture.xlsx",
  adapter: adaptation.adapter,
  drafts: adaptation.drafts,
});

assert.equal(first.alreadyCommitted, false);
assert.equal(first.recordCount, 2);
assert.equal(second.alreadyCommitted, true);
assert.deepEqual(second.recordIds, first.recordIds);
assert.equal(listRecords("diffusion").length, 2, "retry does not duplicate records");

console.log("dataset import idempotency tests passed");
