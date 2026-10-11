import assert from "node:assert/strict";
import { createSimpleExperiment, getSimpleDashboard, getSimpleStudent, getSimpleTask, joinSimpleGroup, joinSimpleExperiment,
  attachSimpleStudentPaper, startSimpleExtraction, finishSimpleExtraction, submitSimpleStudent, nextSimpleRound,
  getCurrentSimpleStudentId, setSimpleTaskGold } from "./simpleStore";
import { simpleGroupAssignment, type SimpleStudentState } from "./simpleShared";
import { closeTeachingStoreForTests } from "./store";

const gold = [{ cation: "EMIM", anion: "BF4", substrate: "steel", temperature: "25", load: "1", cof: "0.1" }];
const experiment = createSimpleExperiment({ name: "Four group comparison", design: "crossover" });
assert.deepEqual(getSimpleDashboard(experiment.id).tasks.map(task => task.paperNo), [1, 2, 3, 4]);
assert.throws(() => joinSimpleExperiment(experiment.aiInviteCode, "Bypass"), /four experiment groups/);
assert.throws(() => joinSimpleGroup(experiment.id, 5, "Invalid"), /1–4/);
const students = [1, 2, 3, 4].map(group => getSimpleStudent(joinSimpleGroup(experiment.id, group, `Student ${group}`).participantId));
assert.deepEqual(students.map(student => [student.paperNo, student.mode]), [[1, "ai"], [1, "manual"], [2, "ai"], [2, "manual"]]);
assert.throws(() => nextSimpleRound(students[0].id, 0), /Submit round 1/);
assert.throws(() => startSimpleExtraction(students[0].id, 0), /Upload/);
assert.equal(getCurrentSimpleStudentId(students[0].id), students[0].id);
function attach(state: SimpleStudentState, paperNo: number, fingerprint = `content-${paperNo}`) {
  return attachSimpleStudentPaper(state.id, { version: state.version, sourceId: `${paperNo}${"0".repeat(7)}-1111-1111-1111-111111111111`, paperTitle: `paper-${paperNo}.pdf`, fingerprint });
}
students[0] = attach(students[0], 1);
assert.equal(getSimpleStudent(students[1].id).experiment.sourceId, students[0].experiment.sourceId);
assert.throws(() => attach(students[1], 1, "other-content"), /already bound/);
assert.throws(() => attach(students[2], 2, "content-1"), /different paper/);
students[2] = attach(students[2], 2);
// The matching group can use the shared paper without uploading its own copy.
function submit(state: SimpleStudentState): SimpleStudentState {
  if (state.mode === "ai") { state = startSimpleExtraction(state.id, state.version); state = finishSimpleExtraction(state.id, state.version, gold); }
  return submitSimpleStudent(state.id, { version: state.version, rows: gold, manualSeconds: 120 });
}
for (let i = 0; i < students.length; i++) students[i] = submit(getSimpleStudent(students[i].id));
const first = getSimpleTask(students[0].taskId!);
setSimpleTaskGold(first.id, { version: first.version, gold });
assert.equal(getSimpleStudent(students[1].id).result?.accuracy, 1);
assert.equal(getSimpleStudent(students[2].id).result, null);
const preservedFirstRound = getSimpleDashboard(experiment.id).students;
const next = students.map(student => {
  const current = getSimpleStudent(student.id);
  return nextSimpleRound(student.id, current.version);
});
assert.deepEqual(next.map(student => [student.paperNo, student.mode]), [[3, "manual"], [3, "ai"], [4, "manual"], [4, "ai"]]);
assert.equal(nextSimpleRound(students[0].id, students[0].version).id, next[0].id);
assert.equal(getSimpleDashboard(experiment.id).students.length, 8);
assert.throws(() => nextSimpleRound(next[0].id, next[0].version), /round 1/);
assert.equal(getCurrentSimpleStudentId(students[0].id), next[0].id);
assert.equal(getCurrentSimpleStudentId(next[0].id), next[0].id);
next[0] = attach(next[0], 3);
next[2] = attach(next[2], 4);
assert.equal(getSimpleStudent(next[1].id).experiment.sourceId, next[0].experiment.sourceId);
for (let i = 0; i < next.length; i++) next[i] = submit(getSimpleStudent(next[i].id));
for (const previous of preservedFirstRound) assert.deepEqual(getSimpleDashboard(experiment.id).students.find(student => student.id === previous.id), previous);
for (const current of next) {
  assert.equal(current.rounds?.length, 2);
  assert.deepEqual(current.rounds?.map(round => round.status), ["submitted", "submitted"]);
  assert.equal(JSON.stringify(current).includes('"gold"'), false);
  assert.equal(current.learnerId, students.find(student => student.groupNo === current.groupNo)!.learnerId);
}
for (const group of [1, 2, 3, 4]) for (const round of [1, 2]) assert.deepEqual(simpleGroupAssignment(group, round), { paperNo: (round === 1 ? students : next)[group - 1].paperNo, mode: (round === 1 ? students : next)[group - 1].mode });
closeTeachingStoreForTests();
console.log("simple four-group crossover tests passed");
