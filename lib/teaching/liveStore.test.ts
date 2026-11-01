import assert from "node:assert/strict";
import {
  advanceLiveRound, createLiveExperiment, finishLiveExperiment, getLiveDashboard, getLiveStudent, joinLiveExperiment,
  reviewLive, setLiveGold, setLivePaper, startLiveExperiment, submitLive, findLiveParticipant, exitLiveExperiment,
} from "./liveStore";
import { liveAssignment, scoreLive } from "./liveShared";
import { LIVE_EXTRACTION_FIELDS, type LiveRow } from "./liveFields";

const gold: LiveRow[] = [{ ...Object.fromEntries(LIVE_EXTRACTION_FIELDS.map(({ key }) => [key, "/"])) as LiveRow,
  cation: "EMIM", anion: "BF4", substrate: "steel", temperature: "25", load: "1", cof: "0.1" }];
const paperId = "11111111-1111-1111-1111-111111111111";
const secondPaperId = "22222222-2222-2222-2222-222222222222";

const experiment = createLiveExperiment({ name: "Week 3", groupCount: 2 });
assert.equal(experiment.status, "open");
assert.equal(experiment.papers.length, 2);
assert.throws(() => createLiveExperiment({ name: "bad", groupCount: 1 }), /even/);
assert.throws(() => createLiveExperiment({ name: "bad", groupCount: 3 }), /even/);
assert.throws(() => startLiveExperiment(experiment.id), /all 2 papers/);

const alice = joinLiveExperiment(experiment.id, { userKey: "u-alice", alias: "Alice" });
const bob = joinLiveExperiment(experiment.id, { userKey: "u-bob", alias: "Bob" });
const carol = joinLiveExperiment(experiment.id, { userKey: "u-carol", alias: "Carol" });
assert.equal(joinLiveExperiment(experiment.id, { userKey: "u-alice", alias: "Alice" }).id, alice.id, "rejoining returns the same seat");
assert.equal(findLiveParticipant("u-bob")?.id, bob.id);
assert.equal(getLiveStudent(alice.id).joinedCount, 3);
assert.equal(getLiveStudent(alice.id).participant.status, "waiting");
assert.throws(() => startLiveExperiment(experiment.id), /all 2 papers/);

setLivePaper(experiment.id, { sourceId: paperId, paperTitle: "Paper one", paperIndex: 0 });
assert.throws(() => startLiveExperiment(experiment.id), /all 2 papers/);
setLivePaper(experiment.id, { sourceId: secondPaperId, paperTitle: "Paper two", paperIndex: 1 });
startLiveExperiment(experiment.id);
assert.throws(() => joinLiveExperiment(experiment.id, { userKey: "u-dave", alias: "Dave" }), /already started/);
assert.throws(() => setLivePaper(experiment.id, { sourceId: paperId, paperTitle: "other", paperIndex: 0 }), /fixed/);

const dashboard = getLiveDashboard(experiment.id);
assert.equal(dashboard.experiment.status, "running");
assert.deepEqual(dashboard.participants.map((item) => [item.alias, item.groupNo, item.mode, item.paperIndex]),
  [["Alice", 1, "manual", 0], ["Bob", 2, "ai", 1], ["Carol", 1, "manual", 0]], "Round 1 starts A manual / B AI");
assert.equal(getLiveStudent(alice.id).experiment.paperTitle, "Paper one");
assert.equal(getLiveStudent(alice.id).experiment.totalRounds, 2);
assert.throws(() => advanceLiveRound(experiment.id), /All students must submit/);

// AI participants can submit manual additions before extraction.
const aliceSubmitted = submitLive(alice.id, { version: 1, rows: gold });
assert.equal(aliceSubmitted.status, "submitted");
assert.ok(aliceSubmitted.elapsedSeconds! > 0);
submitLive(bob.id, { version: 1, rows: gold });
assert.throws(() => advanceLiveRound(experiment.id), /All students must submit/);
submitLive(carol.id, { version: 1, rows: gold });

// No answer key yet → cells are reviewable, but accuracy stays at zero until gold exists.
const unscored = getLiveDashboard(experiment.id).participants[0].score;
assert.equal(unscored!.cells.length, LIVE_EXTRACTION_FIELDS.length);
assert.equal(unscored!.accuracy, 0);
reviewLive(alice.id, { version: aliceSubmitted.version, overrides: { "0:0:cation": "correct" } });
setLiveGold(experiment.id, gold, 0);
setLiveGold(experiment.id, gold, 1);
const scored = getLiveDashboard(experiment.id).participants[0];
assert.equal(scored.score!.accuracy, 1);

// Tri-state teacher review: ✓ / × / ⭕.
const firstCell = scored.score!.cells[0];
const reviewed = reviewLive(alice.id, { version: scored.version, overrides: { [firstCell.key]: "incorrect" }, note: "Check units" });
assert.equal(reviewed.score!.accuracy, (LIVE_EXTRACTION_FIELDS.length - 1) / LIVE_EXTRACTION_FIELDS.length);
assert.equal(reviewed.reviewNote, "Check units");
const uncertain = reviewLive(alice.id, { version: reviewed.version, overrides: { [firstCell.key]: "uncertain" } });
assert.equal(uncertain.score!.uncertain, 1);
assert.equal(uncertain.score!.correct, LIVE_EXTRACTION_FIELDS.length - 1);
assert.throws(() => reviewLive(alice.id, { version: uncertain.version, overrides: { bogus: "correct" } }), /field/);
assert.throws(() => reviewLive(alice.id, { version: uncertain.version, overrides: { [firstCell.key]: "maybe" } as never }), /field/);
assert.equal(getLiveStudent(alice.id).participant.score!.cells[0].mark, "uncertain");

advanceLiveRound(experiment.id);
const second = getLiveDashboard(experiment.id);
assert.equal(second.experiment.currentRound, 1);
assert.deepEqual(second.participants.map((item) => [item.alias, item.mode, item.paperIndex, item.status]),
  [["Alice", "ai", 1, "idle"], ["Bob", "manual", 0, "idle"], ["Carol", "ai", 1, "idle"]], "Round 2 swaps both paper and method");
assert.equal(getLiveStudent(alice.id).experiment.paperTitle, "Paper two");
assert.equal(getLiveStudent(alice.id).participant.rows.length, 0, "A new round starts with an empty workspace");
assert.throws(() => advanceLiveRound(experiment.id), /final round/);

const firstAgain = getLiveDashboard(experiment.id, 0);
assert.equal(firstAgain.participants[0].score!.cells[0].mark, "uncertain", "Historical review remains attached to round 1");
const historicalReview = reviewLive(alice.id, { version: second.participants[0].version, round: 0, overrides: { [firstCell.key]: "correct" }, note: "Checked after round 2" });
assert.equal(historicalReview.round, 0);
assert.equal(historicalReview.score!.accuracy, 1);

for (const participant of getLiveDashboard(experiment.id).participants) submitLive(participant.id, { version: participant.version, rows: gold });
assert.equal(getLiveDashboard(experiment.id).participants.every((item) => item.status === "submitted"), true);
assert.throws(() => exitLiveExperiment(alice.id), /after the experiment has finished/);
finishLiveExperiment(experiment.id);
assert.equal(getLiveDashboard(experiment.id).experiment.status, "finished");
assert.throws(() => finishLiveExperiment(experiment.id), /running/);

// Exiting archives only the student's current association; teacher results remain intact.
assert.deepEqual(exitLiveExperiment(alice.id), { ok: true });
assert.equal(findLiveParticipant("u-alice"), null);
assert.equal(getLiveDashboard(experiment.id).participants.length, 3);
const nextExperiment = createLiveExperiment({ name: "Week 4", groupCount: 2 });
const nextSeat = joinLiveExperiment(nextExperiment.id, { userKey: "u-alice", alias: "Alice" });
assert.notEqual(nextSeat.id, alice.id);
assert.equal(findLiveParticipant("u-alice")?.experimentId, nextExperiment.id);

// scoreLive defaults to the automatic comparison when no override exists.
const auto = scoreLive(gold, gold);
assert.equal(auto.accuracy, 1);
assert.equal(auto.uncertain, 0);
assert.deepEqual(liveAssignment(1, 0, 4), { paperIndex: 0, mode: "manual" });
assert.deepEqual(liveAssignment(4, 3, 4), { paperIndex: 2, mode: "manual" });

console.log("Live multi-round crossover, history, scoring and review tests passed");
