import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LiveTeacher, type TeacherData } from "./LiveTeacher";
import { LiveRows } from "./LiveRows";
import { LiveLessonGuide } from "./LiveLessonGuide";
import { LiveAfmChart } from "./LiveAfmResults";
import { LiveWorkspace } from "./LiveStudent";
import { liveFieldGroups, liveFields } from "@/lib/teaching/liveFields";
import { createLiveExperiment, getLiveDashboard, getLiveStudent, joinLiveExperiment, setLiveGold, setLivePaper, startLiveExperiment } from "@/lib/teaching/liveStore";

(globalThis as typeof globalThis & { React: typeof React }).React = React;
for (const domain of ["tribology", "conductivity", "afm"] as const) {
  const row = Object.fromEntries(liveFields(domain).map((field) => [field.key, "NR"]));
  const keys = liveFieldGroups(domain).flatMap((group) => group.keys);
  assert.equal(new Set(keys).size, liveFields(domain).length, "no field is duplicated or lost in collapsed groups");
  const lesson = createLiveExperiment({ name: `${domain} acceptance fixture`, domain, groupCount: 2, classroomVersion: 2 });
  const seat = joinLiveExperiment(lesson.id, { userKey: `student-${domain}`, alias: "Fixture student" });
  const initialData: TeacherData = { experiments: [lesson], dashboard: getLiveDashboard(lesson.id), canUseAi: false, automaticDomains: ["afm"] };
  const html = renderToStaticMarkup(React.createElement(LiveTeacher, { initialData }));
  assert.match(html, /1\. Prepare lesson/); assert.match(html, /2\. Run classroom/); assert.match(html, /3\. Review and export/);
  assert.doesNotMatch(html, /Combined group results|Classroom roster/, "preparation is not mixed with classroom / assessment tables");
  assert.doesNotMatch(html, /[\u3400-\u9fff]/);
  const rows = renderToStaticMarkup(React.createElement(LiveRows, { rows: [row, { ...row, cation: "ONLY_SECOND_RECORD" }], domain, onChange: () => {} }));
  assert.match(rows, /Record 1 of 2/); assert.doesNotMatch(rows, /ONLY_SECOND_RECORD/, "only one observation is displayed at a time");
  if (domain !== "tribology") { assert.match(rows, /Conditions/); assert.match(rows, /Dependence and source/); }
  const guide = renderToStaticMarkup(React.createElement(LiveLessonGuide, { domain, instructor: true }));
  assert.match(guide, /<details/); assert.match(guide, /research database automatically/);
  setLivePaper(lesson.id, { sourceId: "11111111-1111-1111-1111-111111111111", paperTitle: "Source fixture" });
  setLiveGold(lesson.id, [row], { taskInstructions: "Extract only the assigned figure and preserve its conditions." });
  startLiveExperiment(lesson.id);
  const student = renderToStaticMarkup(React.createElement(LiveWorkspace, { initial: getLiveStudent(seat.id) }));
  assert.match(student, /Assigned lesson task/); assert.match(student, /Extract only the assigned figure/);
  assert.match(student, /Submit results/); assert.doesNotMatch(student, /[\u3400-\u9fff]/);
}
const curve = { id: "fixture", label: "Fixture", page: 2, figure: "1", imageDataUrl: "", axes: { xMin: 0, xMax: 2, yMin: -1, yMax: 4, xUnit: "nm", yUnit: "nN" }, points: [[0, 4], [1, 0], [2, -1]] as Array<[number, number]>, segmentStarts: [2], warnings: [] };
const chart = renderToStaticMarkup(React.createElement(LiveAfmChart, { curve }));
assert.match(chart, /Separation \(nm\)/); assert.match(chart, /Force \(nN\)/);
assert.match(chart, /M70\.00,45\.00 L340\.00,237\.00 M610\.00,285\.00/, "separate trace segments must not be joined");
const relative = renderToStaticMarkup(React.createElement(LiveAfmChart, { curve: { ...curve, axes: null, points: [[0, 1], [1, 0]] } }));
assert.match(relative, /not a physical axis/); assert.doesNotMatch(relative, /Force \(nN\)/);
const shell = readFileSync("components/teaching/TeachingExperimentWorkspace.tsx", "utf8");
assert.doesNotMatch(shell, /TeachingGateway|SimpleTeacherDashboard|GroupCrossoverAdmin/, "new lesson domains do not add duplicate classroom consoles");
console.log("Shared classroom stages, compact paginated records, domain briefs, English UI and AFM chart rendering passed");
