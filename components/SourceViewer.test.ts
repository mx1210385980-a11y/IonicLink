import assert from "node:assert/strict";
import type { SourceEventDetail } from "./SourceViewer";
import { sourceOperationIsCurrent } from "./SourceViewer";

const first: SourceEventDetail = { field: "cof", prov: {}, recordId: "#001" };
const second: SourceEventDetail = { field: "cof", prov: {}, recordId: "#002" };

assert.equal(sourceOperationIsCurrent(3, 3, first, first), true, "the current viewer operation may settle");
assert.equal(sourceOperationIsCurrent(2, 3, first, first), false, "a prior open generation is stale");
assert.equal(sourceOperationIsCurrent(3, 3, first, second), false, "a response for record A cannot update record B");
assert.equal(sourceOperationIsCurrent(3, 3, first, null), false, "closing the viewer invalidates pending work");

console.log("SourceViewer stale-operation guard tests passed");
