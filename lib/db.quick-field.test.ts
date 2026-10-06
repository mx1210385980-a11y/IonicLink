import assert from "node:assert/strict";
import { createRecords, deleteRecords, getRecord, updateRecord } from "./db";
import { ingest } from "./ingest";
import { ingest as ingestConductivity } from "./conductivity/ingest";

const [record] = createRecords("tribology", [ingest({
  paper: { title: "Quick field patch fixture" },
  cation: "[BMIM]",
  anion: "[PF6]",
  substrate: "HOPG",
  temperature: "25 °C",
  load: "5 nN",
  cof: 0.1,
  velocity: "6 μm/s",
  provenance: [{ field: "cof", page: 3, quote: "μ = 0.1", basis: "direct" }],
})], "review");

try {
  const result = updateRecord("tribology", record.id, { setField: { field: "cof", value: "0.125" } });
  assert.equal(result.record?.core.cof, 0.125);
  assert.equal(result.record?.core.load?.raw, "5 nN", "quick edit preserves every unrelated field");
  assert.equal(result.record?.provenance?.cof?.quote, "μ = 0.1", "quick edit preserves field provenance");
  assert.equal(getRecord("tribology", record.id)?.core.cof, 0.125, "quick edit is persisted");

  const quantityResult = updateRecord("tribology", record.id, { setField: { field: "load", value: "12 nN" } });
  assert.equal(quantityResult.record?.core.load?.raw, "12 nN");
  assert.ok(Math.abs((quantityResult.record?.core.load?.std ?? 0) - 12e-9) < 1e-18);

  const invalidNumber = updateRecord("tribology", record.id, { setField: { field: "cof", value: "not-a-number" } });
  assert.equal(invalidNumber.status, 422);
  assert.match(invalidNumber.error ?? "", /non-negative number/);

  const unsupported = updateRecord("tribology", record.id, { setField: { field: "paper", value: "Changed" } });
  assert.equal(unsupported.status, 400);
  assert.match(unsupported.error ?? "", /not available for quick editing/);
} finally {
  deleteRecords("tribology", [record.id]);
}

console.log("DB quick field editing tests passed");

const [electrical] = createRecords("conductivity", [ingestConductivity({
  paper: { title: "Capacitance-only quick editing" }, cation: "[EMIM]", anion: "[TFSI]",
  capacitance: "120 pF", chargeTransferResistance: "4.2 kΩ", surface: "Pt",
  provenance: [{ field: "capacitance", page: 2, quote: "C = 120 pF", basis: "direct" }],
})], "review");
try {
  const updated = updateRecord("conductivity", electrical.id, { setField: { field: "capacitance", value: "240 pF" } });
  assert.equal(updated.error, undefined);
  assert.equal(updated.record?.core.capacitance.std, 2.4e-10);
  assert.equal(updated.record?.core.chargeTransferResistance.std, 4200);
  assert.equal(updated.record?.provenance?.capacitance?.page, 2);
  assert.equal(updateRecord("conductivity", electrical.id, { setField: { field: "pressure", value: "1 atm" } }).record?.extended.pressure.std, 101325);
} finally {
  deleteRecords("conductivity", [electrical.id]);
}
