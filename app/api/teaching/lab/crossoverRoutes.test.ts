import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { GET, POST } from "./route";
import { POST as enter } from "./enter/route";
import { GET as readPaper, POST as uploadPaper } from "./paper/route";
import { POST as extract } from "./extract/route";
import { startSimpleExtraction, finishSimpleExtraction, getSimpleDashboard } from "@/lib/teaching/simpleStore";
import { closeTeachingDatabaseForTests, getTeachingSession } from "@/lib/teaching";
import type { SimpleStudentState } from "@/lib/teaching/simpleShared";

function request(cookie: string, body?: unknown, endpoint = "") {
  return new NextRequest(`http://localhost/api/teaching/lab${endpoint}`, { method: body === undefined ? "GET" : "POST",
    headers: { cookie, origin: "http://localhost", ...(body === undefined ? {} : { "content-type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
function paperRequest(cookie: string, state: SimpleStudentState, text: string, attemptId = state.id) {
  const stream = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>", `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
  let document = "%PDF-1.4\n"; const offsets: number[] = [];
  objects.forEach((object, i) => { offsets.push(document.length); document += `${i + 1} 0 obj\n${object}\nendobj\n`; });
  const start = document.length;
  document += `xref\n0 6\n0000000000 65535 f \n${offsets.map(offset => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;
  const form = new FormData(); form.set("file", new File([document], "paper.pdf", { type: "application/pdf" }));
  form.set("version", String(state.version)); form.set("attemptId", attemptId);
  return new NextRequest("http://localhost/api/teaching/lab/paper", { method: "POST", headers: { cookie, origin: "http://localhost" }, body: form });
}
async function state(cookie: string): Promise<SimpleStudentState> { const response = await GET(request(cookie)); assert.equal(response.status, 200); return response.json(); }
async function run() {
  const cookies: string[] = []; const initial: SimpleStudentState[] = [];
  for (let groupNo = 1; groupNo <= 4; groupNo++) {
    const response = await enter(request("", { groupNo, mode: "manual", taskId: "forged" }, "/enter"));
    assert.equal(response.status, 200, await response.clone().text());
    const token = response.cookies.get("ioniclink_teaching_session")!.value;
    const cookie = `ioniclink_teaching_session=${token}`; cookies.push(cookie);
    initial.push(await state(cookie));
    assert.equal(getTeachingSession(token)?.participantId, initial[groupNo - 1].id);
  }
  assert.deepEqual(initial.map(value => [value.groupNo, value.paperNo, value.mode, value.roundNo]), [[1, 1, "ai", 1], [2, 1, "manual", 1], [3, 2, "ai", 1], [4, 2, "manual", 1]]);
  assert.equal((await enter(request("", { groupNo: 9 }, "/enter"))).status, 400);
  assert.equal((await enter(request("", { mode: "ai" }, "/enter"))).status, 400);
  assert.equal((await POST(request(cookies[0], { action: "nextRound", attemptId: initial[0].id, version: 0 }))).status, 400);
  const uploaded = await uploadPaper(paperRequest(cookies[0], initial[0], "Paper one"));
  assert.equal(uploaded.status, 200, await uploaded.clone().text());
  let ai = await uploaded.json() as SimpleStudentState;
  const paired = await state(cookies[1]);
  assert.equal(paired.taskId, ai.taskId); assert.equal(paired.experiment.sourceId, ai.experiment.sourceId);
  assert.equal((await readPaper(request(cookies[1], undefined, "/paper?format=text"))).status, 200);
  assert.equal((await uploadPaper(paperRequest(cookies[1], paired, "Wrong paper"))).status, 400);
  const rows = [{ cation: "A", anion: "B", substrate: "steel", temperature: "25", load: "1", cof: "0.1" }];
  const forgedSave = await POST(request(cookies[1], { action: "save", attemptId: paired.id, version: paired.version, rows, mode: "ai", taskId: initial[2].taskId }));
  assert.equal(forgedSave.status, 200);
  const stillPaired = await forgedSave.json() as SimpleStudentState;
  assert.equal(stillPaired.mode, "manual"); assert.equal(stillPaired.taskId, paired.taskId);
  assert.equal((await POST(request(cookies[1], { action: "save", version: stillPaired.version, rows }))).status, 400);
  ai = startSimpleExtraction(ai.id, ai.version); ai = finishSimpleExtraction(ai.id, ai.version, rows);
  const submitted = await POST(request(cookies[0], { action: "submit", attemptId: ai.id, version: ai.version, rows, manualSeconds: 900 }));
  assert.equal(submitted.status, 200); ai = await submitted.json();
  const firstId = ai.id;
  const nextResponse = await POST(request(cookies[0], { action: "nextRound", attemptId: ai.id, version: ai.version }));
  assert.equal(nextResponse.status, 200, await nextResponse.clone().text());
  let second = await nextResponse.json() as SimpleStudentState;
  assert.equal(second.roundNo, 2); assert.equal(second.paperNo, 3); assert.equal(second.mode, "manual");
  assert.equal((await state(cookies[0])).id, second.id);
  assert.equal(getTeachingSession(cookies[0].split("=")[1])?.participantId, firstId);
  for (const action of ["save", "submit", "nextRound"]) assert.equal((await POST(request(cookies[0], { action, attemptId: firstId, version: second.version, rows, manualSeconds: 30 }))).status, 400);
  assert.equal((await extract(request(cookies[0], { attemptId: firstId, version: second.version }, "/extract"))).status, 400);
  assert.equal((await uploadPaper(paperRequest(cookies[0], second, "Paper three", firstId))).status, 400);
  const roundTwoUpload = await uploadPaper(paperRequest(cookies[0], second, "Paper three"));
  assert.equal(roundTwoUpload.status, 200); second = await roundTwoUpload.json();
  const roundTwoSubmit = await POST(request(cookies[0], { action: "submit", attemptId: second.id, version: second.version, rows, manualSeconds: 30 }));
  assert.equal(roundTwoSubmit.status, 200); second = await roundTwoSubmit.json();
  assert.equal(second.elapsedSeconds, 30); assert.equal(second.rounds?.length, 2);
  assert.deepEqual(second.rounds?.map(value => value.status), ["submitted", "submitted"]);
  assert.equal(JSON.stringify(second).includes('"gold"'), false);
  const resumed = await enter(request(cookies[0], { groupNo: 1 }, "/enter"));
  assert.equal(resumed.status, 200);
  assert.equal(getTeachingSession(resumed.cookies.get("ioniclink_teaching_session")!.value)?.participantId, second.id);
  assert.equal(getSimpleDashboard(second.experiment.id).students.length, 5);
  closeTeachingDatabaseForTests(); console.log("crossover API assignment, round switching and stale-tab protection tests passed");
}
run().catch(error => { console.error(error); process.exitCode = 1; });
