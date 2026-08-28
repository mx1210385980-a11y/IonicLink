import assert from "node:assert/strict";
import path from "node:path";
import Database from "better-sqlite3";
import type { TeachingExperimentPaper } from "../teachingShared";
import {
  buildAiSnapshot,
  buildFlatSnapshot,
  buildGoldRules,
  checkedRecordUsability,
  listCheckedTribologyRecords,
  loadCheckedRecord,
  type CheckedTribologyRecord,
} from "./groupGold";
import { scoreSubmission } from "./scoring";

const baseRecord: CheckedTribologyRecord = {
  id: "rec-1",
  paper: { title: "Ionic lubrication study", doi: "10.1000/xyz", journal: "Tribol. Lett." },
  core: {
    ionicLiquid: { cation: "[EMIM]+", anion: "[TFSI]-" },
    substrate: "mica",
    temperature: { raw: "25 °C", value: 25, unit: "°C", std: 298.15, stdUnit: "K" },
    load: { raw: "5 nN", value: 5, unit: "nN", std: 5e-9, stdUnit: "N" },
    cof: 0.12,
  },
  provenance: {
    cof: { page: 4, quote: "The friction coefficient remained at 0.12 throughout the test" },
    temperature: { page: 2, quote: "All measurements were performed at 25 °C in a dry chamber" },
  },
  extraction: { model: "kimi-k3" },
};

// --- usability ----------------------------------------------------------------

assert.equal(checkedRecordUsability(baseRecord).usable, true);
assert.deepEqual(
  checkedRecordUsability({ id: "x", core: { ionicLiquid: { cation: "A" } } }).missing.sort(),
  ["anion", "cof", "load", "substrate", "temperature"].sort()
);

// --- gold rules ---------------------------------------------------------------

const gold = buildGoldRules(baseRecord);

assert.deepEqual(gold.cation.value, { kind: "text", expected: "[EMIM]+", aliases: ["[EMIM]+"] });
assert.deepEqual(gold.substrate.value, { kind: "text", expected: "mica", aliases: ["mica"] });

const temperatureRule = gold.temperature.value;
assert.equal(temperatureRule.kind, "temperature");
if (temperatureRule.kind === "temperature") {
  assert.equal(temperatureRule.kelvin, 298.15);
  assert.equal(temperatureRule.toleranceKelvin, 2);
  assert.deepEqual(temperatureRule.aliases, ["25 °C"]);
}

const loadRule = gold.load.value;
assert.equal(loadRule.kind, "number");
if (loadRule.kind === "number") {
  assert.equal(loadRule.expected, 5e-9);
  assert.equal(loadRule.tolerance, 5e-9 * 0.05);
  assert.deepEqual(loadRule.aliases, ["5 nN", "5e-9 N"]);
}

const cofRule = gold.cof.value;
assert.equal(cofRule.kind, "number");
if (cofRule.kind === "number") {
  assert.equal(cofRule.expected, 0.12);
  assert.equal(cofRule.tolerance, 0.012);
}

assert.deepEqual(gold.cof.evidence.pages, [4]);
assert.equal(gold.cof.evidence.anyKeywordSets.length > 0, true);
assert.equal(gold.temperature.evidence.notReported, undefined);

// not-reported temperature mapping
const notReportedRecord: CheckedTribologyRecord = {
  ...baseRecord,
  core: {
    ...baseRecord.core!,
    temperature: { raw: "not stated", value: null, unit: "", std: null, stdUnit: "K" },
  },
  provenance: {
    temperature: { basis: "assumed", basisNote: "no explicit value" },
  },
};
const notReportedGold = buildGoldRules(notReportedRecord);
assert.equal(notReportedGold.temperature.value.kind, "not_reported");
assert.equal(notReportedGold.temperature.evidence.notReported, true);

// --- AI snapshot ----------------------------------------------------------------

const snapshot = buildAiSnapshot(baseRecord);
assert.equal(snapshot.cation?.value, "[EMIM]+");
assert.equal(snapshot.temperature?.value, "25 °C");
assert.equal(snapshot.load?.value, "5 nN");
assert.equal(snapshot.cof?.value, "0.12");
assert.equal(snapshot.cof?.page, "4");
assert.match(snapshot.cof?.evidence ?? "", /friction coefficient/);
assert.equal(snapshot.anion?.page, undefined);

assert.deepEqual(buildFlatSnapshot(baseRecord), {
  cation: "[EMIM]+",
  anion: "[TFSI]-",
  substrate: "mica",
  temperature: "25 °C",
  load: "5 nN",
  cof: "0.12",
});

// --- end-to-end scoring against generated gold ----------------------------------

const paper = {
  id: "p1",
  code: "1",
  title: "t",
  doi: "",
  journal: "",
  sourceUrl: "",
  taskPrompt: "",
  aiModel: "kimi-k3",
  aiInitial: snapshot,
  gold,
} satisfies TeachingExperimentPaper;

const perfect = scoreSubmission(
  {
    cation: { value: "[EMIM]+", page: "1", evidence: "EMIM cation" },
    anion: { value: "[TFSI]-", page: "1", evidence: "TFSI anion" },
    substrate: { value: "mica", page: "1", evidence: "mica sheet" },
    temperature: {
      value: "25 °C",
      page: "2",
      evidence: "All measurements were performed at 25 °C in a dry chamber",
    },
    load: { value: "5 nN", page: "3", evidence: "applied load of 5 nN" },
    cof: {
      value: "0.12",
      page: "4",
      evidence: "The friction coefficient remained at 0.12 throughout the test",
    },
  },
  paper
);
// cation/anion/substrate have no provenance pages in the fixture, so their
// evidence scores fail by design (advisory). Values must all be correct.
assert.equal(perfect.valueCorrect, 6);
assert.equal(perfect.valueAccuracy, 1);
assert.equal(perfect.values.load.reason, "alias_match");
assert.equal(perfect.evidence.cof.correct, true);
assert.equal(perfect.evidence.temperature.correct, true);

const wrong = scoreSubmission(
  {
    cation: { value: "[BMIM]+" },
    anion: { value: "[TFSI]-" },
    substrate: { value: "mica" },
    temperature: { value: "80 °C" },
    load: { value: "100" },
    cof: { value: "0.9" },
  },
  paper
);
assert.equal(wrong.values.cation.correct, false);
assert.equal(wrong.values.temperature.correct, false);
assert.equal(wrong.values.cof.correct, false);
assert.equal(wrong.valueCorrect, 2);

// --- DB-backed readers ------------------------------------------------------------

const tribologyPath = path.join(process.env.IONICLINK_DATA_DIR!, "tribology.db");
const tribo = new Database(tribologyPath);
tribo.exec(`
  CREATE TABLE IF NOT EXISTS records (
    id TEXT PRIMARY KEY,
    status TEXT NOT NULL,
    payload TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
`);
tribo
  .prepare("INSERT INTO records (id, status, payload, created_at) VALUES (?, ?, ?, ?)")
  .run("rec-official", "official", JSON.stringify({ ...baseRecord, id: "rec-official" }), "2026-01-02T00:00:00.000Z");
tribo
  .prepare("INSERT INTO records (id, status, payload, created_at) VALUES (?, ?, ?, ?)")
  .run("rec-review", "review", JSON.stringify({ ...baseRecord, id: "rec-review" }), "2026-01-01T00:00:00.000Z");
tribo
  .prepare("INSERT INTO records (id, status, payload, created_at) VALUES (?, ?, ?, ?)")
  .run(
    "rec-incomplete",
    "official",
    JSON.stringify({ id: "rec-incomplete", core: { ionicLiquid: { cation: "A" } } }),
    "2026-01-03T00:00:00.000Z"
  );
tribo.close();

const options = listCheckedTribologyRecords();
assert.equal(options.length, 1, "only usable official records are listed");
assert.equal(options[0].recordId, "rec-official");
assert.equal(options[0].cation, "[EMIM]+");
assert.equal(options[0].cof, 0.12);

const loaded = loadCheckedRecord("rec-official");
assert.equal(loaded.paper?.title, "Ionic lubrication study");
assert.throws(() => loadCheckedRecord("rec-review"), /没有找到/);
assert.throws(() => loadCheckedRecord("missing"), /没有找到/);

console.log("Group-crossover gold generation tests passed");
