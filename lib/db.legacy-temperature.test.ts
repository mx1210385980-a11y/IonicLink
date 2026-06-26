import assert from "node:assert/strict";
import Database from "better-sqlite3";
import path from "node:path";
import { coreCompleteness, type IonicRecord } from "./schema";
import { deleteRecords, getRecord, listRecords } from "./db";

const MARK = "__LEGACY_TEMP_MARKER__";
const id = "#LEGACY-TEMP";
const uncertainId = "#LEGACY-TEMP-UNCERTAIN";
const sourceId = "legacy-temp-source";
const createdAt = new Date().toISOString();

const legacyRecord: IonicRecord = {
  id,
  status: "review",
  createdAt,
  paper: { title: MARK },
  core: {
    ionicLiquid: { cation: "[ZtestM]", anion: "[Ztest]" },
    substrate: "graphite",
    temperature: {
      raw: "ambient conditions",
      value: null,
      unit: "",
      std: null,
      stdUnit: "K",
      approx: false,
    },
    load: { raw: "5 nN", value: 5, unit: "nN", std: 5e-9, stdUnit: "N" },
    cof: 0.1,
  },
  extended: { scale: "nano" },
  flexible: [{ key: "conditions", value: "ambient conditions" }],
};

const db = new Database(path.join(process.cwd(), "data", "tribology.db"));
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
  temp_k: null,
  load_n: legacyRecord.core.load?.std,
  created_at: createdAt,
  payload: JSON.stringify(legacyRecord),
});

const uncertainRecord: IonicRecord = {
  ...legacyRecord,
  id: uncertainId,
  paper: { title: MARK + "-uncertain" },
  core: {
    ...legacyRecord.core,
    temperature: {
      raw: "294 ± 1 K",
      value: 1,
      unit: "K",
      std: 1,
      stdUnit: "K",
      approx: false,
    },
  },
  provenance: undefined,
  sourceId,
};

db.prepare(
  `INSERT OR REPLACE INTO sources (id, filename, page_count, created_at, payload)
   VALUES (@id, @filename, @page_count, @created_at, @payload)`
).run({
  id: sourceId,
  filename: "legacy-temperature.pdf",
  page_count: 2,
  created_at: createdAt,
  payload: JSON.stringify({
    id: sourceId,
    filename: "legacy-temperature.pdf",
    pageCount: 2,
    createdAt,
    pages: [
      { page: 1, text: "Title page" },
      {
        page: 2,
        text: "Cyclic voltammetry was recorded using a potentiostat at 294 ± 1 K. The working electrode used in this study was stainless steel.",
      },
    ],
  }),
});

db.prepare(
  `INSERT OR REPLACE INTO records
    (id, status, paper_title, cation, anion, substrate, scale, cof, temp_k, load_n, created_at, payload)
   VALUES
    (@id, @status, @paper_title, @cation, @anion, @substrate, @scale, @cof, @temp_k, @load_n, @created_at, @payload)`
).run({
  id: uncertainId,
  status: uncertainRecord.status,
  paper_title: uncertainRecord.paper.title,
  cation: uncertainRecord.core.ionicLiquid.cation,
  anion: uncertainRecord.core.ionicLiquid.anion,
  substrate: uncertainRecord.core.substrate,
  scale: uncertainRecord.extended.scale,
  cof: uncertainRecord.core.cof,
  temp_k: 1,
  load_n: uncertainRecord.core.load?.std,
  created_at: createdAt,
  payload: JSON.stringify(uncertainRecord),
});

try {
  const listed = listRecords("tribology", { search: MARK })[0] as IonicRecord | undefined;
  assert.ok(listed, "legacy record is listed");
  assert.equal(listed.core.temperature?.raw, "ambient conditions");
  assert.equal(listed.core.temperature?.value, 293.15);
  assert.equal(listed.core.temperature?.std, 293.15);
  assert.ok(!coreCompleteness(listed).missing.includes("Temperature"), "ambient legacy temperature is complete");
  assert.equal(
    listed.provenance?.temperature?.basis,
    "assumed",
    "a digit-less temperature is labeled assumed (convention, not a reported value)"
  );

  const fetched = getRecord("tribology", id) as IonicRecord | null;
  assert.equal(fetched?.core.temperature?.std, 293.15, "getRecord also normalizes legacy temperature");

  const uncertain = getRecord("tribology", uncertainId) as IonicRecord | null;
  assert.equal(uncertain?.core.temperature?.raw, "294 ± 1 K");
  assert.equal(uncertain?.core.temperature?.value, 294);
  assert.equal(uncertain?.core.temperature?.std, 294);
  assert.equal(uncertain?.core.temperature?.approx, true);
  assert.equal(uncertain?.provenance?.temperature?.page, 2, "temperature provenance is inferred from the source");
  assert.match(uncertain?.provenance?.temperature?.quote ?? "", /294 ± 1 K/);
  assert.equal(
    uncertain?.provenance?.temperature?.basis,
    "inferred",
    "a text-search match is never stronger than inferred — it may cite another measurement's context (e.g. CV)"
  );
  assert.ok(uncertain?.provenance?.temperature?.basisNote, "inferred provenance carries an explanatory note");

  console.log("DB legacy temperature normalization tests passed");
} finally {
  deleteRecords("tribology", [id, uncertainId]);
  db.prepare("DELETE FROM sources WHERE id = ?").run(sourceId);
  db.close();
}
