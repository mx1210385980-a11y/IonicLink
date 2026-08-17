import assert from "node:assert/strict";
import { deleteLiteratureConfirmation } from "./DeleteLiteratureButton";

const sourceMessage = deleteLiteratureConfirmation("problem.pdf", {
  kind: "source",
  sourceId: "source-1",
  jobCount: 2,
  recordCount: 7,
});
assert.match(sourceMessage, /stored PDF/);
assert.match(sourceMessage, /2 extraction jobs and their history/);
assert.match(sourceMessage, /7 Review\/Checked records/);
assert.match(sourceMessage, /upload it again/);

const unlinkedMessage = deleteLiteratureConfirmation("Imported paper", {
  kind: "records",
  recordIds: ["#1", "#2"],
});
assert.match(unlinkedMessage, /2 unlinked Review\/Checked records/);
assert.match(unlinkedMessage, /No indexed PDF is attached/);

console.log("Unified literature deletion confirmation tests passed");
