import assert from "node:assert/strict";
import {
  commitJob,
  createJobs,
  createSource,
  deleteSourceCascadeData,
  findSourceByDoi,
  getJob,
  getSource,
  listRecords,
  updateJob,
  updateRecord,
} from "./db";
import { ingest } from "./ingest";

const sourceId = "11111111-1111-4111-8111-111111111111";
const otherSourceId = "22222222-2222-4222-8222-222222222222";
const marker = "__SOURCE_CASCADE_DELETE__";
const otherMarker = "__SOURCE_CASCADE_KEEP__";

createSource("tribology", {
  id: sourceId,
  filename: "problem-paper.pdf",
  pageCount: 1,
  createdAt: "2026-08-17T00:00:00.000Z",
  doi: "10.1000/problem-paper",
  pages: [{ page: 1, text: "doi: 10.1000/problem-paper" }],
});
createSource("tribology", {
  id: otherSourceId,
  filename: "keep-paper.pdf",
  pageCount: 1,
  createdAt: "2026-08-17T00:00:00.000Z",
  doi: "10.1000/keep-paper",
  pages: [{ page: 1, text: "doi: 10.1000/keep-paper" }],
});

const draft = {
  ...ingest({
    paper: { title: marker },
    cation: "[BMIM]",
    anion: "[PF6]",
    substrate: "mica",
    temperature: "25 °C",
    load: "5 nN",
    cof: 0.1,
    scale: "nano",
  }),
  sourceId,
};
const otherDraft = {
  ...ingest({
    paper: { title: otherMarker },
    cation: "[EMIM]",
    anion: "[BF4]",
    substrate: "silica",
    temperature: "25 °C",
    load: "6 nN",
    cof: 0.2,
    scale: "nano",
  }),
  sourceId: otherSourceId,
};

const [job] = createJobs("tribology", [{ filename: "problem-paper.pdf", text: "paper", sourceId }]);
updateJob("tribology", job.id, {
  status: "done",
  candidates: [draft],
  recordCount: 1,
  source: "openai-compatible",
  model: "test-model",
});
const committed = commitJob("tribology", job.id);
if (!("created" in committed)) throw new Error(committed.error);
const createdRecord = listRecords("tribology", { search: marker })[0];
assert.ok(createdRecord);
assert.equal(updateRecord("tribology", createdRecord.id, { status: "official" }).record?.status, "official");

const [otherJob] = createJobs("tribology", [{ filename: "keep-paper.pdf", text: "paper", sourceId: otherSourceId }]);
updateJob("tribology", otherJob.id, { status: "done", candidates: [otherDraft], recordCount: 1 });
const otherCommitted = commitJob("tribology", otherJob.id);
if (!("created" in otherCommitted)) throw new Error(otherCommitted.error);

const result = deleteSourceCascadeData("tribology", sourceId);
assert.deepEqual(result, {
  sourceId,
  filename: "problem-paper.pdf",
  deletedJobs: 1,
  deletedJobEvents: 3,
  deletedRecords: 1,
});
assert.equal(getSource("tribology", sourceId), null);
assert.equal(getJob("tribology", job.id), null);
assert.equal(listRecords("tribology", { search: marker }).length, 0);
assert.equal(findSourceByDoi("tribology", "10.1000/problem-paper"), null, "the DOI can be uploaded again");

assert.ok(getSource("tribology", otherSourceId), "another source is preserved");
assert.ok(getJob("tribology", otherJob.id), "another source's job is preserved");
assert.equal(listRecords("tribology", { search: otherMarker }).length, 1, "another source's records are preserved");
assert.equal(deleteSourceCascadeData("tribology", sourceId), null, "repeating a delete is a not-found result");

deleteSourceCascadeData("tribology", otherSourceId);
console.log("Source cascade deletion tests passed");
