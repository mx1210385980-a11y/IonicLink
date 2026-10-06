import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { createTeachingSession, closeTeachingDatabaseForTests } from "@/lib/teaching";
import { createSimpleExperiment, getSimpleDashboard, startSimpleExtraction, finishSimpleExtraction } from "@/lib/teaching/simpleStore";
import type { SimpleDashboard, SimpleRow, SimpleStudentState } from "@/lib/teaching/simpleShared";
import { GET, POST } from "./lab/route";
import { POST as join } from "./lab/join/route";
import { GET as template, POST as upload } from "./lab/table/route";
import { GET as paper, POST as uploadPaper } from "./lab/paper/route";
import { POST as extract } from "./lab/extract/route";

function request(endpoint = "", body?: unknown, cookie?: string, origin = "http://localhost") {
  return new NextRequest(`http://localhost/api/teaching/lab${endpoint}`, { method: body === undefined ? "GET" : "POST",
    headers: { origin, ...(cookie ? { cookie } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
function safe(state: unknown) {
  const encoded = JSON.stringify(state);
  for (const key of ["gold", "expected", "aiInviteCode", "manualInviteCode", "overrides", "cells"]) assert.equal(encoded.includes(`"${key}"`), false, key);
}
function fileRequest(cookie: string, origin = "http://localhost") {
  const form = new FormData();
  form.set("file", new File(["cation,anion,substrate,temperature,load,cof\nEMIM,BF4,steel,25,1,0.1"], "answer.csv", { type: "text/csv" }));
  return new NextRequest("http://localhost/api/teaching/lab/table", { method: "POST", headers: { cookie, origin }, body: form });
}
function pdfRequest(cookie: string, version: number, text: string, origin = "http://localhost", filename = "student-paper.pdf") {
  const stream = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>", `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
  let document = "%PDF-1.4\n"; const offsets: number[] = [];
  objects.forEach((object, i) => { offsets.push(document.length); document += `${i + 1} 0 obj\n${object}\nendobj\n`; });
  const start = document.length;
  document += `xref\n0 6\n0000000000 65535 f \n${offsets.map(offset => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;
  const form = new FormData();
  form.set("file", new File([document], filename, { type: "application/pdf" }));
  form.set("version", String(version));
  return new NextRequest("http://localhost/api/teaching/lab/paper", { method: "POST", headers: { cookie, origin }, body: form });
}
async function run() {
  assert.equal((await GET(request())).status, 401);
  assert.equal((await POST(request("", { action: "create" }))).status, 401);
  assert.equal((await template(request("/table"))).status, 401);
  assert.equal((await paper(request("/paper"))).status, 401);
  assert.equal((await uploadPaper(pdfRequest("", 0, "Paper"))).status, 401);
  assert.equal((await extract(request("/extract", {}))).status, 401);
  const teacher = `ioniclink_teaching_session=${createTeachingSession({ role: "teacher", projectId: null, participantId: null })}`;
  assert.equal((await extract(request("/extract", {}, teacher))).status, 403);
  assert.equal((await uploadPaper(pdfRequest(teacher, 0, "Teacher paper"))).status, 403);
  assert.equal((await POST(request("", { action: "create" }, teacher, "https://evil.example"))).status, 403);
  assert.equal((await join(request("/join", {}, undefined, "https://evil.example"))).status, 403);
  assert.equal((await upload(fileRequest(teacher, "https://evil.example"))).status, 403);
  const gold: SimpleRow[] = [{ cation: "EMIM", anion: "BF4", substrate: "steel", temperature: "25", load: "1", cof: "0.1" }];
  const created = await POST(request("", { action: "create", name: "Compare" }, teacher));
  assert.equal(created.status, 200, await created.clone().text());
  const crossover = await created.json() as SimpleDashboard;
  assert.equal(crossover.experiment.design, "crossover"); assert.equal(crossover.tasks.length, 4);
  const dashboard = getSimpleDashboard(createSimpleExperiment({ name: "Legacy comparison" }).id);
  assert.equal(dashboard.experiment.sourceId, ""); assert.deepEqual(dashboard.experiment.gold, []);
  async function enroll(inviteCode: string, studentAlias: string) {
    const response = await join(request("/join", { inviteCode, studentAlias }));
    assert.equal(response.status, 200);
    const setCookie = response.headers.get("set-cookie")!;
    assert.match(setCookie, /HttpOnly/i); assert.match(setCookie, /SameSite=Lax/i);
    return setCookie.split(";")[0];
  }
  const manual = await enroll(dashboard.experiment.manualInviteCode, "Manual");
  const ai = await enroll(dashboard.experiment.aiInviteCode, "AI");
  assert.equal((await join(request("/join", { inviteCode: dashboard.experiment.aiInviteCode, studentAlias: "Manual" }))).status, 400);
  let state = await (await GET(request("", undefined, manual))).json() as SimpleStudentState;
  safe(state); assert.equal(state.mode, "manual");
  assert.equal((await POST(request("", { action: "create", name: "Forbidden" }, manual))).status, 403);
  assert.equal((await POST(request("", { action: "review", studentId: state.id, version: 0, overrides: {} }, manual))).status, 403);
  assert.equal((await POST(request("", { action: "gold", studentId: state.id, version: 0, gold }, manual))).status, 403);
  assert.equal((await POST(request("", { action: "submit", version: state.version, rows: gold, manualSeconds: 60 }, manual))).status, 400);
  assert.equal((await uploadPaper(pdfRequest(manual, state.version, "Manual paper", "https://evil.example"))).status, 403);
  const manualUpload = await uploadPaper(pdfRequest(manual, state.version, "Manual paper"));
  assert.equal(manualUpload.status, 200, await manualUpload.clone().text());
  state = await manualUpload.json(); safe(state);
  const manualSourceId = state.experiment.sourceId;
  assert.ok(manualSourceId);
  assert.equal((await uploadPaper(pdfRequest(manual, 0, "Stale"))).status, 400);
  assert.equal((await upload(fileRequest(ai))).status, 403);
  const imported = await upload(fileRequest(manual));
  assert.equal(imported.status, 200, await imported.clone().text());
  assert.deepEqual((await imported.json()).rows, gold);
  const saved = await POST(request("", { action: "save", version: state.version, rows: gold, studentId: "someone-else" }, manual));
  assert.equal(saved.status, 200); state = await saved.json(); safe(state);
  const resumed = await join(request("/join", { inviteCode: dashboard.experiment.manualInviteCode,
    studentAlias: "Manual", resumeCode: state.resumeCode }));
  assert.equal(resumed.status, 200);
  const resumedCookie = resumed.headers.get("set-cookie")!.split(";")[0];
  const resumedState = await (await GET(request("", undefined, resumedCookie))).json() as SimpleStudentState;
  assert.equal(resumedState.id, state.id); assert.equal(resumedState.version, state.version);
  assert.deepEqual(resumedState.rows, gold);
  const otherStudent = await (await GET(request("", undefined, ai))).json() as SimpleStudentState;
  assert.equal(JSON.stringify(otherStudent).includes(state.resumeCode), false);
  assert.equal((await join(request("/join", { inviteCode: dashboard.experiment.manualInviteCode,
    studentAlias: "Manual", resumeCode: false }))).status, 400);
  assert.equal((await POST(request("", { action: "save", version: 0, rows: gold }, manual))).status, 400);
  const submitted = await POST(request("", { action: "submit", version: state.version, rows: gold, manualSeconds: 60 }, manual));
  assert.equal(submitted.status, 200); state = await submitted.json(); safe(state);
  assert.equal(state.elapsedSeconds, 60); assert.equal(state.result, null); assert.equal(state.pendingGrade, true);
  assert.equal((await uploadPaper(pdfRequest(manual, state.version, "Locked"))).status, 400);
  assert.equal((await upload(fileRequest(manual))).status, 403);
  assert.equal((await POST(request("", { action: "save", version: state.version, rows: gold }, manual))).status, 400);
  const studentPaper = await paper(request("/paper?format=text&sourceId=another-paper", undefined, manual));
  assert.equal(studentPaper.status, 200); assert.deepEqual((await studentPaper.json()).pages, [{ page: 1, text: "Manual paper" }]);
  const graded = await POST(request("", { action: "gold", studentId: state.id, version: state.version, gold }, teacher));
  assert.equal(graded.status, 200, await graded.clone().text());
  state = await (await GET(request("", undefined, manual))).json(); safe(state);
  assert.equal(state.pendingGrade, false); assert.equal(state.result!.accuracy, 1);
  const teacherStudent = getSimpleDashboard(dashboard.experiment.id).students.find(student => student.id === state.id)!;
  const reviewed = await POST(request("", { action: "review", studentId: state.id, version: state.version,
    overrides: { [teacherStudent.score!.cells[0].key]: false }, note: "checked" }, teacher));
  assert.equal(reviewed.status, 200);
  state = await (await GET(request("", undefined, manual))).json(); safe(state);
  assert.equal(state.result!.accuracy, 5 / 6); assert.equal(state.result!.machineAccuracy, 1);
  let aiState = await (await GET(request("", undefined, ai))).json() as SimpleStudentState;
  assert.equal(aiState.experiment.sourceId, "");
  assert.equal((await extract(request("/extract", { version: aiState.version }, ai))).status, 400);
  const aiUpload = await uploadPaper(pdfRequest(ai, aiState.version, "AI paper"));
  assert.equal(aiUpload.status, 200, await aiUpload.clone().text());
  aiState = await aiUpload.json(); safe(aiState);
  assert.notEqual(aiState.experiment.sourceId, manualSourceId);
  const isolatedPaper = await paper(request(`/paper?format=text&sourceId=${manualSourceId}`, undefined, ai));
  assert.deepEqual((await isolatedPaper.json()).pages, [{ page: 1, text: "AI paper" }]);
  assert.equal((await POST(request("", { action: "submit", version: aiState.version, rows: gold }, ai))).status, 400);
  aiState = startSimpleExtraction(aiState.id, aiState.version);
  aiState = finishSimpleExtraction(aiState.id, aiState.version, gold);
  const aiResponse = await POST(request("", { action: "submit", version: aiState.version, rows: gold, manualSeconds: 600 }, ai));
  assert.equal(aiResponse.status, 200); aiState = await aiResponse.json(); safe(aiState);
  assert.notEqual(aiState.elapsedSeconds, 600);
  assert.equal(aiState.result, null); assert.equal(aiState.pendingGrade, true);
  const teacherView = await (await GET(request(`?id=${dashboard.experiment.id}`, undefined, teacher))).json();
  assert.equal(teacherView.dashboard.students.length, 2);
  assert.deepEqual(teacherView.dashboard.students.find((student: { id: string }) => student.id === state.id).paper.gold, gold);
  assert.equal(teacherView.dashboard.tasks.length, 2);
  // A renamed copy joins the existing paper task across groups and inherits its key.
  const sameAi = await enroll(dashboard.experiment.aiInviteCode, "Same-paper AI");
  const sameUpload = await uploadPaper(pdfRequest(sameAi, 0, "Manual paper", "http://localhost", "renamed-copy.pdf"));
  assert.equal(sameUpload.status, 200, await sameUpload.clone().text());
  let sameState = await sameUpload.json() as SimpleStudentState; safe(sameState);
  assert.equal(sameState.taskId, state.taskId);
  assert.deepEqual(Object.keys(sameState.task!).sort(), ["id", "paperTitle"]);
  assert.notEqual(sameState.experiment.sourceId, manualSourceId);
  assert.equal((await POST(request("", { action: "taskGold", taskId: state.taskId, version: 1, gold }, sameAi))).status, 403);
  sameState = startSimpleExtraction(sameState.id, sameState.version);
  sameState = finishSimpleExtraction(sameState.id, sameState.version, gold);
  const sameSubmit = await POST(request("", { action: "submit", version: sameState.version, rows: gold }, sameAi));
  assert.equal(sameSubmit.status, 200);
  sameState = await sameSubmit.json(); safe(sameState);
  assert.equal(sameState.result?.accuracy, 1); assert.equal(sameState.pendingGrade, false);
  const beforeTaskUpdate = getSimpleDashboard(dashboard.experiment.id);
  const sharedTask = beforeTaskUpdate.tasks.find(task => task.id === state.taskId)!;
  const separateBefore = beforeTaskUpdate.students.find(student => student.id === aiState.id)!;
  const changedGold = [{ ...gold[0], cation: "Different", anion: "Different" }];
  const taskGraded = await POST(request("", { action: "taskGold", taskId: sharedTask.id, version: sharedTask.version, gold: changedGold }, teacher));
  assert.equal(taskGraded.status, 200, await taskGraded.clone().text());
  assert.equal((await POST(request("", { action: "taskGold", taskId: sharedTask.id, version: sharedTask.version, gold }, teacher))).status, 400);
  const afterTaskUpdate = getSimpleDashboard(dashboard.experiment.id);
  for (const participant of [state.id, sameState.id]) {
    const updated = afterTaskUpdate.students.find(student => student.id === participant)!;
    assert.equal(updated.score?.accuracy, 4 / 6);
    assert.equal(updated.score?.machineAccuracy, 4 / 6);
    assert.deepEqual(updated.overrides, {});
    assert.equal(updated.version, beforeTaskUpdate.students.find(student => student.id === participant)!.version + 1);
  }
  assert.deepEqual(afterTaskUpdate.students.find(student => student.id === aiState.id), separateBefore);
  safe(await (await GET(request("", undefined, sameAi))).json());
  safe(await (await GET(request("", undefined, manual))).json());
  closeTeachingDatabaseForTests();
  console.log("simple lab route tests passed");
}
run().catch(error => { console.error(error); process.exitCode = 1; });
