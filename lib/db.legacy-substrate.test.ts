import assert from "node:assert/strict";
import Database from "better-sqlite3";
import path from "node:path";
import { deleteRecords, getDataDir, getRecord, listRecords } from "./db";
import type { IonicRecord } from "./schema";

const MARK = "__LEGACY_SUBSTRATE_MARKER__";
const id = "#LEGACY-SUBSTRATE";
const createdAt = new Date().toISOString();

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
    load: { raw: "5 nN", value: 5, unit: "nN", std: 5e-9, stdUnit: "N" },
    cof: 0.1,
  },
  extended: { scale: "nano" },
  flexible: [],
  provenance: {
    substrate: {
      page: 2,
      quote: "The highly oriented pyrolytic graphite (HOPG) was purchased from Mikromasch as the supporting substrate.",
    },
  },
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
  assert.equal(listed?.core.substrate, "HOPG", "listRecords normalizes HOPG ahead of generic graphite");

  const fetched = getRecord("tribology", id) as IonicRecord | null;
  assert.equal(fetched?.core.substrate, "HOPG", "getRecord also normalizes legacy HOPG substrate");

  console.log("DB legacy substrate normalization tests passed");
} finally {
  deleteRecords("tribology", [id]);
  db.close();
}
