import assert from "node:assert/strict";
import { commitJob, createJobs, deleteRecords, getJob, listJobs, updateJob, updateRecord } from "./db";
import { ingest } from "./ingest";

const draft = ingest({ paper: { title: "Review completion" }, cation: "[BMIM]", anion: "[PF6]",
  substrate: "mica", temperature: "25 °C", load: "5 nN", cof: 0.1, scale: "nano" });

for (const sourceId of [undefined, "11111111-1111-4111-8111-111111111111"]) {
  const [job] = createJobs("tribology", [{ filename: sourceId ? "paper.pdf" : "paper.txt", text: "paper", sourceId }]);
  updateJob("tribology", job.id, { status: "done", candidates: [{ ...draft, sourceId }, { ...draft, sourceId }] });
  const result = commitJob("tribology", job.id);
  assert.ok("created" in result && result.created === 2);
  const ids = getJob("tribology", job.id)!.recordIds!;
  assert.equal(ids.length, 2);
  // Older PDF jobs have no saved record IDs; their source relationship still works.
  if (sourceId) updateJob("tribology", job.id, { recordIds: undefined });
  const checked = () => listJobs("tribology").find((item) => item.id === job.id)?.checked;
  assert.equal(checked(), false);
  assert.equal(updateRecord("tribology", ids[0], { status: "official" }).record?.status, "official");
  assert.equal(checked(), false, "partial approval is still awaiting review");
  assert.equal(updateRecord("tribology", ids[1], { status: "official" }).record?.status, "official");
  assert.equal(checked(), true, "all surviving records must be approved");
  updateRecord("tribology", ids[0], { status: "review" });
  assert.equal(checked(), false, "reopening a record immediately clears Checked");
  deleteRecords("tribology", [ids[0]]);
  assert.equal(checked(), true, "removed candidates do not leave review permanently pending");
  deleteRecords("tribology", [ids[1]]);
  assert.equal(checked(), false, "an empty result is not an approved paper");
}
assert.equal(listJobs("conductivity").length, 0, "domains remain isolated");
console.log("Document Checked status tests passed");
