import assert from "node:assert/strict";
import { commitDatasetImport, createRecords, getRecord, listRecords, resetAll, updateRecord } from "./db";
import { ingest } from "./ingest";

resetAll("tribology");

const base = {
  cation: "[BMIM]",
  anion: "[PF6]",
  substrate: "mica",
  temperature: "298 K",
  load: "5 nN",
  scale: "nano" as const,
};

const admitted = ingest({ ...base, paper: { title: "Admission fixture" }, cof: 0.12 });
const withoutMetric = ingest({ ...base, paper: { title: "Incomplete fixture" }, cof: null });
const created = createRecords("tribology", [withoutMetric, admitted], "review");

assert.equal(created.length, 1);
assert.equal(created[0].core.cof, 0.12);
assert.deepEqual(listRecords("tribology").map((record) => record.paper.title), ["Admission fixture"]);

const rejectedEdit = updateRecord("tribology", created[0].id, {
  fields: { ...base, paper: { title: "Admission fixture" }, cof: null },
});
assert.equal(rejectedEdit.status, 422);
assert.match(rejectedEdit.error ?? "", /missing required value: COF/);
assert.equal(getRecord("tribology", created[0].id)?.core.cof, 0.12);

const imported = commitDatasetImport("tribology", {
  fingerprint: "admission-fixture",
  filename: "admission-fixture.xlsx",
  adapter: "test",
  drafts: [withoutMetric, admitted],
});
assert.equal(imported.recordCount, 1);
assert.equal(imported.recordIds.length, 1);
assert.equal(listRecords("tribology").length, 2);

console.log("Database admission tests passed");
