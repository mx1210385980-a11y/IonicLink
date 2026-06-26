import assert from "node:assert/strict";
import { createRecords, deleteRecords, listRecords } from "./db";
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
const created = createRecords("tribology", [valid], "official");
try {
  assert.equal(created.length, 1);
  assert.equal(created[0].status, "official");
  assert.equal(created[0].paper.title, MARK);
} finally {
  deleteRecords("tribology", created.map((record) => record.id));
}

console.log("DB official gate tests passed");
