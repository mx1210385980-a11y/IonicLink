import assert from "node:assert/strict";
import { blankLiveRow, LIVE_EXTRACTION_FIELDS, recordToLiveRow } from "./liveFields";
import { parseSimpleTable, simpleTemplateCsv } from "./simpleTable";

const record = {
  core: {
    ionicLiquid: { cation: "[EMIM]", anion: "[BF4]" }, substrate: "Au(111)", cof: 0.08,
    temperature: { raw: "25 °C", value: 25, unit: "°C", std: 298.15, stdUnit: "K" },
    load: { raw: "10 nN", value: 10, unit: "nN", std: 1e-8, stdUnit: "N" },
  },
  extended: {
    method: "AFM", velocity: { raw: "2 μm/s", value: 2, unit: "μm/s", std: 2e-6, stdUnit: "m/s" },
    surface: { contactAngle: { raw: "75°", value: 75, unit: "°", std: 75, stdUnit: "°" } },
    afm: { scanRate: "1 Hz", scanSize: "5 μm" },
  },
};
const row = recordToLiveRow(record);
assert.equal(Object.keys(row).length, LIVE_EXTRACTION_FIELDS.length);
assert.equal(row.velocity, "2 μm/s");
assert.equal(row.contactAngle, "75°");
assert.equal(row.scanRate, "1 Hz");
assert.equal(row.surfaceEnergy, "/", "Unmentioned database fields use the same slash marker as manual work");
assert.equal(recordToLiveRow({ ...record, provenance: { temperature: { basis: "assumed" } } }).temperature, "/",
  "AI assumptions are not presented as values reported by the paper");
assert.deepEqual(Object.keys(blankLiveRow()).sort(), Object.keys(row).sort());

async function verifyTableRoundTrip() {
  const csv = simpleTemplateCsv(LIVE_EXTRACTION_FIELDS) + LIVE_EXTRACTION_FIELDS.map(({ key }) => row[key]).join(",") + "\r\n";
  const parsed = await parseSimpleTable("live.csv", new TextEncoder().encode(csv), LIVE_EXTRACTION_FIELDS);
  assert.deepEqual(parsed, [row], "The downloadable template round-trips every live field");
  console.log("Live complete-field mapping and table tests passed");
}
void verifyTableRoundTrip();
