import assert from "node:assert/strict";
import { createRecords, getRecord, updateRecord } from "./db";
import { ingest } from "./ingest";

const [record] = createRecords("tribology", [
  ingest({
    paper: { title: "Crop persistence test" },
    cation: "[BMIM]",
    anion: "[I]",
    substrate: "Au(111)",
    temperature: "298 K",
    load: "5 nN",
    cof: 0.12,
    provenance: [{ field: "cof", quote: "friction coefficient 0.12" }],
  }),
]);

const figureBox = { x: 0.1, y: 0.2, w: 0.3, h: 0.4 };
assert.ok(
  updateRecord("tribology", record.id, {
    setProvenance: { field: "cof", prov: { figureBox } },
  }).record
);
assert.deepEqual(getRecord("tribology", record.id)?.provenance?.cof?.figureBox, figureBox);

assert.ok(
  updateRecord("tribology", record.id, {
    setProvenance: { field: "cof", prov: { figureBox: null } },
  }).record
);
const cleared = getRecord("tribology", record.id)?.provenance?.cof;
assert.equal(cleared?.figureBox, undefined);
assert.equal(cleared?.quote, "friction coefficient 0.12", "clearing the crop preserves other provenance");

console.log("Provenance crop removal tests passed");
