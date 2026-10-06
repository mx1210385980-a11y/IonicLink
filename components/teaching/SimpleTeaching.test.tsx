import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SimpleTeacherDashboard } from "./SimpleTeacherDashboard";
import { SimpleStudentWorkspace } from "./SimpleStudentWorkspace";
import { groupSummary } from "./SimpleTeachingParts";
import type { SimpleDashboard, SimpleStudent, SimpleStudentState } from "@/lib/teaching/simpleShared";
import { simpleExampleDashboard } from "@/lib/teaching/simpleExample";
import { scoreSimpleRows } from "@/lib/teaching/simpleScoring";
(globalThis as typeof globalThis & { React: typeof React }).React = React;
const gold = [{ cation: "EMIM", anion: "BF4", substrate: "mica", temperature: "25 C", load: "5 nN", cof: "0.1" }];
const student: SimpleStudent = { id: "s1", experimentId: "e1", taskId: "t1", studentAlias: "Student", mode: "ai", status: "submitted", rows: gold,
  version: 2, startedAt: "2026-09-11T08:00:00Z", extractionAttemptAt: "2026-09-11T08:00:00Z", extractedAt: "2026-09-11T08:01:00Z", submittedAt: "2026-09-11T08:02:00Z",
  elapsedSeconds: 120, error: null, score: scoreSimpleRows(gold, gold), overrides: {}, reviewNote: "", reviewedAt: null, resumeCode: "private-student-code" };
const dashboard: SimpleDashboard = { experiment: { id: "e1", name: "课堂实验", sourceId: "p1", paperTitle: "Paper", gold, aiInviteCode: "A-CODE", manualInviteCode: "M-CODE", createdAt: "2026-09-11" }, tasks: [{ id: "t1", experimentId: "e1", sourceId: "p1", paperTitle: "Paper", fingerprint: "fixture", gold, version: 0, createdAt: "2026-09-11" }], students: [student] };
const teacher = renderToStaticMarkup(<SimpleTeacherDashboard initial={{ experiments: [dashboard.experiment], papers: [], dashboard }} />);
assert.ok(teacher.indexOf('aria-label="AI Extraction group"') < teacher.indexOf('aria-label="Manual extraction group"'));
assert.match(teacher, /100.0%/); assert.match(teacher, /2.00 minutes/);
assert.match(teacher, /Student/); assert.match(teacher, /answer key/);
const safe: SimpleStudentState = { ...student, experiment: { id: "e1", name: "课堂实验", sourceId: "p1", paperTitle: "Paper" }, result: null };
const ai = renderToStaticMarkup(<SimpleStudentWorkspace initial={{ ...safe, rows: [], status: "idle", startedAt: null }} />);
assert.match(ai, /Start extraction/); assert.doesNotMatch(ai, /Upload extraction table|Manual experiment time \(minutes\)/);
const manual = renderToStaticMarkup(<SimpleStudentWorkspace initial={{ ...safe, rows: [], status: "idle", mode: "manual" }} />);
assert.match(manual, /Upload extraction table/); assert.match(manual, /Manual experiment time \(minutes\)/); assert.doesNotMatch(manual, /Start extraction/);
assert.deepEqual(groupSummary([{ ...student, status: "review", score: null, elapsedSeconds: null }, student]), { count: 1, scoredCount: 1, accuracy: 1, seconds: 120 });
assert.deepEqual(groupSummary([]), { count: 0, scoredCount: 0, accuracy: null, seconds: null });
console.log("simple teaching UI tests passed");

assert.deepEqual(groupSummary([{ ...student, score: null }]), { count: 1, scoredCount: 0, accuracy: null, seconds: 120 });
const emptyPaper = renderToStaticMarkup(<SimpleStudentWorkspace initial={{ ...safe, status: "idle", rows: [], experiment: { ...safe.experiment, sourceId: "", paperTitle: "" } }} />);
assert.match(emptyPaper, /Upload PDF/); assert.doesNotMatch(emptyPaper, /Start extraction|Compare with source/);
const awaiting = renderToStaticMarkup(<SimpleStudentWorkspace initial={{ ...safe, pendingGrade: true }} />);
assert.match(awaiting, /Awaiting answer key/);

const example = simpleExampleDashboard();
const preview = renderToStaticMarkup(<SimpleTeacherDashboard example initial={{ experiments: [example.experiment], papers: [], dashboard: example }} />);
assert.match(preview, /Simulated papers/);
assert.match(preview, /87.5%/);
assert.match(preview, /79.2%/);
assert.match(preview, /2.86 times/);
assert.match(preview, /G1-01/);
assert.doesNotMatch(preview, /G3-01|G4-01|Save key and score|New experiment|Refresh results/);
assert.equal(example.tasks.length, 4);
assert.equal(example.students.length, 16);
const secondAI = groupSummary(example.students.filter(student => student.taskId === "paper-b" && student.mode === "ai"));
const secondManual = groupSummary(example.students.filter(student => student.taskId === "paper-b" && student.mode === "manual"));
assert.equal(secondAI.seconds, 540); assert.equal(secondManual.seconds, 1620);
assert.ok(Math.abs(secondAI.accuracy! - 11/12) < 1e-10);
assert.ok(Math.abs(secondManual.accuracy! - 11/12) < 1e-10);

assert.match(preview, /Group round schedule/);
assert.equal(new Set(example.students.map(item => item.learnerId)).size, 8);
for (const learner of new Set(example.students.map(item => item.learnerId))) {
  const attempts = example.students.filter(item => item.learnerId === learner);
  assert.equal(attempts.length, 2); assert.notEqual(attempts[0].mode, attempts[1].mode);
}
const round1 = renderToStaticMarkup(<SimpleStudentWorkspace initial={{ ...safe, groupNo: 1, roundNo: 1, paperNo: 1 }} />);
assert.match(round1, /Continue to round 2/); assert.match(round1, /Group 1/);
const round2 = renderToStaticMarkup(<SimpleStudentWorkspace initial={{ ...safe, groupNo: 1, roundNo: 2, paperNo: 3 }} />);
assert.doesNotMatch(round2, /Continue to round 2/);
