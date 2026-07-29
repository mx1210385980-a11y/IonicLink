import assert from "node:assert/strict";
import {
  commitJob,
  createJobs,
  createRecords,
  deleteJob,
  deleteRecords,
  getRecord,
  listRecords,
  updateJob,
  updateRecord,
} from "./db";
import { ingest } from "./ingest";
import { coreCompleteness } from "./schema";

const MARK = "__OFFICIAL_GATE_MARKER__";

const base = {
  paper: { title: MARK },
  cation: "[BMIM]",
  anion: "[PF6]",
  substrate: "mica",
  temperature: "25 °C",
  cof: 0.1,
  scale: "nano" as const,
};

const zeroLoad = ingest({ ...base, load: "0 nN" });
assert.deepEqual(coreCompleteness(zeroLoad).missing, ["Load"], "zero normal load is not a complete core load");
assert.throws(
  () => createRecords("tribology", [zeroLoad], "official"),
  /Cannot create official records — missing core fields: #1: Load/,
  "bulk official creation is gated by core completeness"
);

const afterRejected = listRecords("tribology", { search: MARK });
assert.equal(afterRejected.length, 0, "rejected official draft is not inserted");

const valid = ingest({ ...base, load: "5 nN" });
assert.throws(
  () =>
    createRecords(
      "tribology",
      [{ ...valid, extraction: { source: "mock" } }],
      "official"
    ),
  /Cannot create official records from mock extraction: #1/,
  "direct official creation cannot bypass the mock extraction gate"
);

const created = createRecords("tribology", [valid], "official");
try {
  assert.equal(created.length, 1);
  assert.equal(created[0].status, "official");
  assert.equal(created[0].paper.title, MARK);
} finally {
  deleteRecords("tribology", created.map((record) => record.id));
}

const mockTitle = `${MARK}-MOCK`;
const mockDraft = ingest({ ...base, paper: { title: mockTitle }, load: "5 nN" });
const [mockJob] = createJobs("tribology", [{ filename: "mock-paper.pdf", text: "paper text" }]);
updateJob("tribology", mockJob.id, {
  status: "done",
  candidates: [mockDraft],
  recordCount: 1,
  source: "mock",
  model: "deterministic-test-mock",
});

const committed = commitJob("tribology", mockJob.id);
assert.ok("created" in committed, "a completed mock job can enter the review queue");
assert.equal("created" in committed && committed.created, 1);

const mockRecord = listRecords("tribology", { status: "review", search: mockTitle })[0];
assert.ok(mockRecord, "the committed mock candidate is stored for review");
assert.deepEqual(mockRecord.extraction, {
  source: "mock",
  model: "deterministic-test-mock",
});

const editedMock = updateRecord("tribology", mockRecord.id, {
  fields: { ...base, paper: { title: mockTitle }, load: "6 nN" },
});
assert.deepEqual(
  editedMock.record?.extraction,
  mockRecord.extraction,
  "curator field edits retain extraction provenance"
);

const mockApproval = updateRecord("tribology", mockRecord.id, { status: "official" });
assert.equal(mockApproval.status, 422);
assert.match(mockApproval.error ?? "", /Cannot approve a mock-extracted record/);
assert.equal(getRecord("tribology", mockRecord.id)?.status, "review", "rejected mock record stays in review");

const liveDraft = {
  ...ingest({ ...base, paper: { title: `${MARK}-LIVE` }, load: "5 nN" }),
  extraction: { source: "anthropic" as const, model: "test-live-model" },
};
const [liveRecord] = createRecords("tribology", [liveDraft], "review");
const liveApproval = updateRecord("tribology", liveRecord.id, { status: "official" });
assert.equal(liveApproval.record?.status, "official", "a live-model record can be approved");

const legacyDraft = ingest({ ...base, paper: { title: `${MARK}-LEGACY` }, load: "5 nN" });
const [legacyRecord] = createRecords("tribology", [legacyDraft], "review");
const legacyApproval = updateRecord("tribology", legacyRecord.id, { status: "official" });
assert.equal(legacyApproval.record?.status, "official", "a legacy record without metadata can be approved");

deleteRecords("tribology", [mockRecord.id, liveRecord.id, legacyRecord.id]);
deleteJob("tribology", mockJob.id);

console.log("DB official gate tests passed");
