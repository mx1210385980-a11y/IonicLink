import assert from "node:assert/strict";
import {
  createLiveExperiment, finishLiveExperiment, getLiveDashboard, getLiveStudent, joinLiveExperiment,
  reviewLive, saveLiveDraft, setLiveGold, setLivePaper, startLiveExperiment, submitLive, findLiveParticipant,
} from "./liveStore";
import { scoreLive } from "./liveShared";
import type { SimpleRow } from "./simpleShared";

const gold: SimpleRow[] = [{ cation: "EMIM", anion: "BF4", substrate: "steel", temperature: "25", load: "1", cof: "0.1" }];
const paperId = "11111111-1111-1111-1111-111111111111";

const experiment = createLiveExperiment({ name: "Week 3", groupCount: 2 });
assert.equal(experiment.status, "open");
assert.throws(() => createLiveExperiment({ name: "bad", groupCount: 1 }), /2–8/);
assert.throws(() => startLiveExperiment(experiment.id), /paper/);

const alice = joinLiveExperiment(experiment.id, { userKey: "u-alice", alias: "Alice" });
const bob = joinLiveExperiment(experiment.id, { userKey: "u-bob", alias: "Bob" });
const carol = joinLiveExperiment(experiment.id, { userKey: "u-carol", alias: "Carol" });
assert.equal(joinLiveExperiment(experiment.id, { userKey: "u-alice", alias: "Alice" }).id, alice.id, "rejoining returns the same seat");
assert.equal(findLiveParticipant("u-bob")?.id, bob.id);
assert.equal(getLiveStudent(alice.id).joinedCount, 3);
assert.equal(getLiveStudent(alice.id).participant.status, "waiting");
assert.throws(() => startLiveExperiment(experiment.id), /paper/);

setLivePaper(experiment.id, { sourceId: paperId, paperTitle: "IL friction study" });
startLiveExperiment(experiment.id);
assert.throws(() => joinLiveExperiment(experiment.id, { userKey: "u-dave", alias: "Dave" }), /already started/);
assert.throws(() => setLivePaper(experiment.id, { sourceId: paperId, paperTitle: "other" }), /fixed/);

const dashboard = getLiveDashboard(experiment.id);
assert.equal(dashboard.experiment.status, "running");
// Round-robin grouping; all groups currently use the manual channel (no AI model connected).
assert.deepEqual(dashboard.participants.map((item) => [item.alias, item.groupNo, item.mode]),
  [["Alice", 1, "manual"], ["Bob", 2, "manual"], ["Carol", 1, "manual"]]);
assert.equal(getLiveStudent(alice.id).experiment.hasPaper, true);

// Manual flow for every group: same row format, automatic timing from the first edit.
saveLiveDraft(alice.id, { version: 1, rows: gold });
const aliceSubmitted = submitLive(alice.id, { version: 2, rows: gold });
assert.equal(aliceSubmitted.status, "submitted");
assert.ok(aliceSubmitted.elapsedSeconds! > 0);
saveLiveDraft(bob.id, { version: 1, rows: gold });
const manualState = submitLive(bob.id, { version: 2, rows: gold });
assert.ok(manualState.elapsedSeconds! > 0);

// No answer key yet → cells are reviewable, but accuracy stays at zero until gold exists.
const unscored = getLiveDashboard(experiment.id).participants[0].score;
assert.equal(unscored!.cells.length, 6);
assert.equal(unscored!.accuracy, 0);
reviewLive(alice.id, { version: aliceSubmitted.version, overrides: { "0:0:cation": "correct" } });
setLiveGold(experiment.id, gold);
const scored = getLiveDashboard(experiment.id).participants[0];
assert.equal(scored.score!.accuracy, 1);

// Tri-state teacher review: ✓ / × / ⭕.
const firstCell = scored.score!.cells[0];
const reviewed = reviewLive(alice.id, { version: scored.version, overrides: { [firstCell.key]: "incorrect" }, note: "Check units" });
assert.equal(reviewed.score!.accuracy, 5 / 6);
assert.equal(reviewed.reviewNote, "Check units");
const uncertain = reviewLive(alice.id, { version: reviewed.version, overrides: { [firstCell.key]: "uncertain" } });
assert.equal(uncertain.score!.uncertain, 1);
assert.equal(uncertain.score!.correct, 5);
assert.throws(() => reviewLive(alice.id, { version: uncertain.version, overrides: { bogus: "correct" } }), /field/);
assert.throws(() => reviewLive(alice.id, { version: uncertain.version, overrides: { [firstCell.key]: "maybe" } }), /field/);
// Students see exactly the same reviewed marks.
const studentView = getLiveStudent(alice.id);
assert.equal(studentView.participant.score!.cells[0].mark, "uncertain");

// scoreLive defaults to the automatic comparison when no override exists.
const auto = scoreLive(gold, gold);
assert.equal(auto.accuracy, 1);
assert.equal(auto.uncertain, 0);

finishLiveExperiment(experiment.id);
assert.equal(getLiveDashboard(experiment.id).experiment.status, "finished");
assert.throws(() => finishLiveExperiment(experiment.id), /running/);

console.log("Live experiment lifecycle, grouping, scoring and review tests passed");
