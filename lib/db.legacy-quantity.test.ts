import assert from "node:assert/strict";
import Database from "better-sqlite3";
import path from "node:path";
import { deleteRecords, getDataDir, getRecord, listRecords } from "./db";
import type { IonicRecord } from "./schema";
import { stdLabel } from "./units";

const MARK = "__LEGACY_QUANTITY_MARKER__";
const id = "#LEGACY-QUANTITY";
const createdAt = new Date().toISOString();
const close = (a: number | null | undefined, b: number) => a != null && Math.abs(a - b) < 1e-16;

listRecords("tribology", { search: "__ensure_schema__" });

const legacyRecord: IonicRecord = {
  id,
  status: "review",
  createdAt,
  paper: { title: MARK },
  core: {
    ionicLiquid: { cation: "[ZtestM]", anion: "[Ztest]" },
    substrate: "graphite",
    temperature: { raw: "293.15 K", value: 293.15, unit: "K", std: 293.15, stdUnit: "K" },
    load: {
      raw: "15-30n N",
      value: -30,
      unit: "nN",
      std: -30e-9,
      stdUnit: "N",
      approx: false,
    },
    cof: 0.1,
  },
  extended: {
    scale: "nano",
    velocity: {
      raw: "6.5 μm s−1",
      value: 6.5,
      unit: "",
      std: null,
      stdUnit: "m/s",
      approx: false,
    },
  },
  flexible: [],
};

const db = new Database(path.join(getDataDir(), "tribology.db"));
db.prepare(
  `INSERT OR REPLACE INTO records
    (id, status, paper_title, cation, anion, substrate, scale, cof, temp_k, load_n, created_at, payload)
   VALUES
    (@id, @status, @paper_title, @cation, @anion, @substrate, @scale, @cof, @temp_k, @load_n, @created_at, @payload)`
).run({
  id,
  status: legacyRecord.status,
  paper_title: MARK,
  cation: legacyRecord.core.ionicLiquid.cation,
  anion: legacyRecord.core.ionicLiquid.anion,
  substrate: legacyRecord.core.substrate,
  scale: legacyRecord.extended.scale,
  cof: legacyRecord.core.cof,
  temp_k: legacyRecord.core.temperature?.std,
  load_n: legacyRecord.core.load?.std,
  created_at: createdAt,
  payload: JSON.stringify(legacyRecord),
});

try {
  const listed = listRecords("tribology", { search: MARK })[0] as IonicRecord | undefined;
  assert.ok(listed, "legacy quantity record is listed");
  assert.equal(listed.core.load?.raw, "15-30n N");
  assert.equal(listed.core.load?.value, 30, "ASCII hyphen load ranges use the upper value on read");
  assert.equal(listed.core.load?.unit, "nN", "spaced n N is normalized to nN on read");
  assert.ok(close(listed.core.load?.std, 30e-9), "standard load is 30 nN in N");
  assert.equal(listed.core.load?.approx, true, "range loads are marked approximate on read");
  assert.deepEqual(listed.core.load?.range, { min: 15, max: 30, unit: "nN", stdMin: 15e-9, stdMax: 30e-9 });
  assert.equal(stdLabel(listed.core.load), "15-30 nN");
  assert.equal(listed.extended.velocity?.unit, "µm/s", "legacy reciprocal-second velocity unit is normalized");
  assert.ok(close(listed.extended.velocity?.std, 6.5e-6), "legacy μm s−1 velocity standardizes to m/s");
  assert.equal(stdLabel(listed.extended.velocity), "6.5 µm/s");

  const fetched = getRecord("tribology", id) as IonicRecord | null;
  assert.equal(fetched?.core.load?.value, 30, "getRecord also normalizes legacy quantities");
  assert.equal(stdLabel(fetched?.core.load), "15-30 nN");
  assert.equal(stdLabel(fetched?.extended.velocity), "6.5 µm/s");

  console.log("DB legacy quantity normalization tests passed");
} finally {
  deleteRecords("tribology", [id]);
  db.close();
}
