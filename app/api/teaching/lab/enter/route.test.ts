import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { POST } from "./route";
import { getTeachingSession, closeTeachingDatabaseForTests } from "@/lib/teaching";
import { createSimpleExperiment, getSimpleDashboard, getSimpleStudent, listSimpleExperiments, saveSimpleDraft } from "@/lib/teaching/simpleStore";
import { createTestAdminSession, createTestAppSession } from "@/lib/auth.test-helpers";

let appStudent = "";
let appAdmin = "";

function request(mode: unknown, cookie = "", origin = "http://localhost", appCookie: string | null = appStudent) {
  const merged = [appCookie, cookie].filter(Boolean).join("; ");
  return new NextRequest("http://localhost/api/teaching/lab/enter", { method: "POST", headers: { "content-type": "application/json", cookie: merged, origin }, body: JSON.stringify(typeof mode === "object" ? mode : { mode }) });
}
async function run() {
  // App auth is enabled in tests: lab entry requires a platform session.
  appStudent = (await createTestAppSession()).cookie;
  appAdmin = (await createTestAdminSession()).cookie;
  assert.equal(listSimpleExperiments().length, 0);
  assert.equal((await POST(request({ groupNo: 1 }, "", "http://localhost", null))).status, 401, "lab entry requires a platform account");
  const automatic = await POST(request({ groupNo: 1 }));
  assert.equal(automatic.status, 200);
  const automaticSession = getTeachingSession(automatic.cookies.get("ioniclink_teaching_session")!.value)!;
  assert.equal(listSimpleExperiments().length, 1);
  const defaultExperiment = listSimpleExperiments()[0];
  assert.equal(automaticSession.projectId, defaultExperiment.id);
  assert.equal(defaultExperiment.design, "crossover");
  assert.equal(defaultExperiment.sourceId, ""); assert.deepEqual(defaultExperiment.gold, []);
  assert.equal(getSimpleStudent(automaticSession.participantId!).experiment.sourceId, "");
  assert.equal((await POST(request({ groupNo: 2 }))).status, 200);
  assert.equal(listSimpleExperiments().length, 1);
  assert.equal((await POST(request("invalid"))).status, 400);
  assert.equal((await POST(request("teacher", "", "https://other.example"))).status, 403);
  assert.equal((await POST(request("teacher"))).status, 403, "a platform student cannot take the instructor seat");
  const teacher = await POST(request("teacher", "", "http://localhost", appAdmin));
  assert.equal(teacher.status, 200); assert.equal((await teacher.json()).redirect, "/teaching/admin");
  assert.equal(getTeachingSession(teacher.cookies.get("ioniclink_teaching_session")!.value)?.role, "teacher");
  const gold = [{ cation: "A", anion: "B", substrate: "mica", temperature: "25 C", load: "1 N", cof: "0.1" }];
  createSimpleExperiment({ name: "Old", sourceId: "old", paperTitle: "Old paper", gold });
  const latest = createSimpleExperiment({ name: "Latest", sourceId: "latest", paperTitle: "Current paper", gold });
  const ai = await POST(request("ai")); assert.equal(ai.status, 200);
  const aiToken = ai.cookies.get("ioniclink_teaching_ai_session")!.value;
  const aiSession = getTeachingSession(aiToken)!;
  assert.equal(aiSession.projectId, latest.id); assert.equal(getSimpleStudent(aiSession.participantId!).mode, "ai");
  const manual = await POST(request("manual")); assert.equal(manual.status, 200);
  const manualToken = manual.cookies.get("ioniclink_teaching_manual_session")!.value;
  const manualSession = getTeachingSession(manualToken)!;
  assert.equal(getSimpleStudent(manualSession.participantId!).mode, "manual");
  saveSimpleDraft(manualSession.participantId!, { version: 0, rows: gold });
  const resumed = await POST(request("manual", `ioniclink_teaching_manual_session=${manualToken}; ioniclink_teaching_session=${aiToken}`));
  assert.equal(resumed.cookies.get("ioniclink_teaching_session")!.value, manualToken);
  assert.equal(getSimpleStudent(manualSession.participantId!).rows.length, 1);
  assert.equal(getSimpleDashboard(latest.id).students.length, 2);
  const next = createSimpleExperiment({ name: "Next", sourceId: "next", paperTitle: "Next paper", gold });
  const fresh = await POST(request("ai", `ioniclink_teaching_ai_session=${aiToken}`));
  assert.equal(getTeachingSession(fresh.cookies.get("ioniclink_teaching_session")!.value)!.projectId, next.id);
  closeTeachingDatabaseForTests(); console.log("Direct teaching entry and progress recovery tests passed");
}
run().catch(error => { console.error(error); process.exitCode = 1; });
