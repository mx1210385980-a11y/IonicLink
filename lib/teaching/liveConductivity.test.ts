import assert from "node:assert/strict";
import { blankLiveRow, liveCsvCell, liveDomain, liveFields, liveRowsCsv, validateLiveRows } from "./liveFields";
import { liveCellMatches } from "./liveScoring";
import { scoreLive } from "./liveShared";
import { liveDraftConflicts, sameLiveRows } from "./liveDraft";
import { parseLiveTable } from "./liveTable";
import { ingest } from "../conductivity/ingest";
import { recordToLiveRows } from "./liveRecordRows.server";
import { createLiveExperiment, finishLiveExperiment, finishLiveExtraction, getLiveStudent, joinLiveExperiment, saveLiveDraft, setLiveGold, setLivePaper, startLiveExperiment, startLiveExtraction, submitLive } from "./liveStore";

async function main() {
  const row = { ...Object.fromEntries(liveFields("conductivity").map(({ key }) => [key, "NR"])), cation: "EMIM", anion: "TFSI", property: "conductivity", value: "12.4 mS/cm", temperature: "298.15 K", variedParameter: "temperature", variableValue: "298.15 K", trend: "increases", evidence: "p. 5; Fig. 3a" };
  assert.equal(liveFields("tribology").length, 6);
  assert.equal(liveFields("conductivity").length, 15);
  assert.deepEqual(validateLiveRows([row], "conductivity"), [row]);
  assert.throws(() => validateLiveRows([], "conductivity"), /1–100/);
  assert(liveCellMatches("value", "12.4 mS/cm", "1.24 S/m"));
  assert(!liveCellMatches("value", "12.4 mS/cm", "12.4 S/m"));
  assert(liveCellMatches("temperature", "25 °C", "298.15 K"));
  assert(liveCellMatches("scanRate", "100 mV/s", "0.1 V/s"));
  assert(!liveCellMatches("value", "2 F", "2 F/g"));
  assert(!liveCellMatches("value", "2 mA", "2 MA"));
  assert(!liveCellMatches("value", "NR", "0"));
  assert.equal(scoreLive([row], [{ ...row, value: "1.24 S/m" }], {}, "conductivity").accuracy, 1);
  const second = { ...row, value: "15 mS/cm", temperature: "308.15 K", variableValue: "308.15 K" };
  assert.equal(scoreLive([row, second], [second, row], {}, "conductivity").accuracy, 1);
  assert(scoreLive([row], [row, second], {}, "conductivity").accuracy < 1);
  assert.equal(liveCsvCell("-1.5"), '"-1.5"');
  assert.equal(liveCsvCell("-1+WEBSERVICE(\"x\")").slice(0, 2), '"\'');
  const negative = { ...row, potential: "-1 V", cation: '=HYPERLINK("x")' };
  assert.deepEqual(await parseLiveTable("roundtrip.csv", new TextEncoder().encode(liveRowsCsv([negative], "conductivity")), "conductivity"), [negative]);
  assert.throws(() => liveDomain("unsupported"), /supported teaching domain/);
}

async function lifecycle() {
  const rows = [{ ...Object.fromEntries(liveFields("conductivity").map(({ key }) => [key, "NR"])), cation: "EMIM", anion: "TFSI", property: "conductivity", value: "12 mS/cm", temperature: "298 K" }];
  assert(!liveDraftConflicts(rows, [{ ...rows[0], value: "13 mS/cm" }], rows), "gold-version updates must not erase a draft");
  assert(liveDraftConflicts(rows, [{ ...rows[0], value: "13 mS/cm" }], [{ ...rows[0], value: "14 mS/cm" }]), "concurrent edits require an explicit choice");
  assert(sameLiveRows(rows, rows));
  const experiment = createLiveExperiment({ name: "Conductivity lesson", domain: "conductivity", groupCount: 2 });
  const student = joinLiveExperiment(experiment.id, { userKey: "conductivity-student", alias: "Student" });
  assert.throws(() => saveLiveDraft(student.id, { version: 0, rows }), /not running/);
  setLivePaper(experiment.id, { sourceId: "22222222-2222-2222-2222-222222222222", paperTitle: "Conductivity paper" });
  startLiveExperiment(experiment.id);
  const saved = saveLiveDraft(student.id, { version: 1, rows });
  assert.equal(getLiveStudent(student.id).participant.rows[0].value, "12 mS/cm", "server draft survives a reload");
  assert.throws(() => saveLiveDraft(student.id, { version: 1, rows }), /changed/);
  setLiveGold(experiment.id, rows);
  const latest = getLiveStudent(student.id).participant;
  assert.equal(latest.startedAt, saved.startedAt, "gold updates do not reset timing");
  const submitted = submitLive(student.id, { version: latest.version, rows });
  assert.equal(submitted.score?.accuracy, 1);
  finishLiveExperiment(experiment.id);
  assert.equal(getLiveStudent(student.id).experiment.status, "finished");
  assert.throws(() => saveLiveDraft(student.id, { version: submitted.version, rows }), /not running/);
  const next = createLiveExperiment({ name: "Next lesson", domain: "conductivity", groupCount: 2 });
  assert.notEqual(joinLiveExperiment(next.id, { userKey: "conductivity-student", alias: "Student" }).id, student.id);
  assert.equal(blankLiveRow("conductivity").value, "");
  const ai = createLiveExperiment({ name: "AI concurrency test", domain: "conductivity", channel: "alternating", groupCount: 2 });
  setLivePaper(ai.id, { sourceId: "44444444-4444-4444-4444-444444444444", paperTitle: "Fixture" });
  const seat = joinLiveExperiment(ai.id, { userKey: "ai-concurrency", alias: "AI student" });
  startLiveExperiment(ai.id);
  assert.throws(() => submitLive(seat.id, { version: 1, rows }), /extraction and review/);
  const extracting = startLiveExtraction(seat.id, 1);
  setLiveGold(ai.id, rows);
  assert.equal(finishLiveExtraction(seat.id, extracting.version, rows).status, "review", "changing gold must not invalidate in-flight extraction");
}

function mapping() {
  const draft = ingest({ paper: { title: "Source" }, cation: "EMIM", anion: "TFSI", conductivity: "12 mS/cm", temperature: "not stated",
    provenance: [{ field: "temperature", basis: "assumed" }, { field: "conductivity", page: 5, figure: "Fig. 3" }],
    propertyDependencies: [{ label: "Conductivity vs temperature", dependentField: "conductivity", independentVariable: "temperature", trend: "increases", statement: "Reported increase", scope: "record-series", source: "paper-text", observations: [{ x: "298 K", y: "12 mS/cm" }, { x: "308 K", y: "15 mS/cm" }] }] });
  const rows = recordToLiveRows("conductivity", draft);
  assert.equal(rows[0].temperature, "NR");
  assert(rows.some((row) => row.temperature === "308 K" && row.value === "15 mS/cm" && row.variableValue === "308 K"));
  assert(rows.every((row) => !Object.hasOwn(row, "cof")));
}

main().then(lifecycle).then(mapping).then(() => console.log("Conductivity teaching: units, row matching, tables, drafts, lifecycle and source mapping passed"));
