import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import {
  TEACHING_FIELDS,
  closeTeachingDatabaseForTests,
  getTeachingSession,
  type TeachingAnswers,
} from "@/lib/teaching";
import { DEFAULT_EXPERIMENT } from "@/lib/teaching/config";
import { getTeachingDb } from "@/lib/teaching/store";
import { GET as exportGet } from "./admin/export/route";
import { GET as adminGet, POST as adminPost } from "./admin/route";
import { POST as sessionPost } from "./session/route";
import {
  GET as studentGet,
  PATCH as studentPatch,
  POST as studentPost,
} from "./student/route";

type JsonRecord = Record<string, unknown>;

function request(
  path: string,
  method: string,
  body?: unknown,
  cookie?: string,
  extraHeaders: Record<string, string> = {}
): NextRequest {
  const headers = new Headers(extraHeaders);
  if (body !== undefined) headers.set("content-type", "application/json");
  if (cookie) headers.set("cookie", cookie);
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function cookieFrom(response: Response): string {
  const setCookie = response.headers.get("set-cookie") ?? "";
  assert.match(setCookie, /ioniclink_teaching_session=/);
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /SameSite=Lax/i);
  return setCookie.split(";")[0];
}

async function json(response: Response): Promise<JsonRecord> {
  return (await response.json()) as JsonRecord;
}

async function loginStudent(
  studentAlias: string,
  extra: Record<string, unknown> = {}
): Promise<{ cookie: string; participantId: string; projectId: string }> {
  const response = await sessionPost(
    request("/api/teaching/session", "POST", {
      role: "student",
      studentAlias,
      ...extra,
    })
  );
  assert.equal(response.status, 200, JSON.stringify(await json(response.clone())));
  const cookie = cookieFrom(response);
  const token = cookie.slice(cookie.indexOf("=") + 1);
  const session = getTeachingSession(token);
  assert.ok(session);
  assert.equal(session.role, "student");
  assert.ok(session.participantId);
  assert.ok(session.projectId);
  return {
    cookie,
    participantId: session.participantId,
    projectId: session.projectId,
  };
}

function completeAnswers(prefix: string): TeachingAnswers {
  return Object.fromEntries(
    TEACHING_FIELDS.map((field) => [
      field.key,
      { value: `${prefix}-${field.key}`, page: "1", evidence: `${prefix} evidence ${field.key}` },
    ])
  );
}

function assertNoConfidentialFields(payload: JsonRecord): void {
  const serialized = JSON.stringify(payload);
  assert.equal(serialized.includes("gold"), false);
  assert.equal(serialized.includes("scoringRules"), false);
  assert.equal(serialized.includes("scoring_rules"), false);
  assert.equal(serialized.includes("sequence"), false);
  assert.equal(serialized.includes("rounds"), false);
}

async function main(): Promise<void> {
  const previousTeacherPassword = process.env.TEACHING_TEACHER_PASSWORD;
  process.env.TEACHING_TEACHER_PASSWORD = "route-test-password";

  try {
  const invalidRole = await sessionPost(
    request("/api/teaching/session", "POST", { role: "administrator", studentAlias: "S000" })
  );
  assert.equal(invalidRole.status, 400);

  const crossOriginLogin = await sessionPost(
    request(
      "/api/teaching/session",
      "POST",
      { role: "student", studentAlias: "S000" },
      undefined,
      { origin: "https://attacker.example" }
    )
  );
  assert.equal(crossOriginLogin.status, 403);

  const emptyAlias = await sessionPost(
    request("/api/teaching/session", "POST", { role: "student", studentAlias: " " })
  );
  assert.equal(emptyAlias.status, 400);

  const first = await loginStudent("Route S001", {
    inviteCode: "WRONG-LEGACY-INVITE",
    groupCode: "obsolete group",
  });
  assert.equal(first.projectId, DEFAULT_EXPERIMENT.id);

  const firstAgain = await loginStudent("  route s001  ");
  assert.equal(firstAgain.participantId, first.participantId);
  assert.notEqual(firstAgain.cookie, first.cookie, "rejoining creates a fresh session token");

  const second = await loginStudent("Route S002");
  assert.equal(second.projectId, DEFAULT_EXPERIMENT.id);
  assert.notEqual(second.participantId, first.participantId);

  const store = getTeachingDb();
  assert.deepEqual(
    store
      .prepare(
        `SELECT sequence_code AS sequence, COUNT(*) AS count
         FROM teaching_participants WHERE project_id = ?
         GROUP BY sequence_code ORDER BY sequence_code`
      )
      .all(DEFAULT_EXPERIMENT.id),
    [
      { sequence: "ai_then_manual", count: 1 },
      { sequence: "manual_then_ai", count: 1 },
    ]
  );

  const noAuth = await studentGet(request("/api/teaching/student", "GET"));
  assert.equal(noAuth.status, 401);

  const teacherLogin = await sessionPost(
    request("/api/teaching/session", "POST", {
      role: "teacher",
      password: "route-test-password",
    })
  );
  assert.equal(teacherLogin.status, 200);
  const teacherCookie = cookieFrom(teacherLogin);
  const teacherOnStudent = await studentGet(
    request("/api/teaching/student", "GET", undefined, teacherCookie)
  );
  assert.equal(teacherOnStudent.status, 403);
  const studentOnAdmin = await adminGet(
    request("/api/teaching/admin", "GET", undefined, first.cookie)
  );
  assert.equal(studentOnAdmin.status, 403);

  const manualResponse = await studentGet(
    request("/api/teaching/student", "GET", undefined, first.cookie)
  );
  assert.equal(manualResponse.status, 200);
  const manualPayload = await json(manualResponse);
  assert.equal(manualPayload.status, "active");
  assert.equal(manualPayload.mode, "manual");
  assert.equal(manualPayload.roundNo, 1);
  assert.equal("aiInitial" in manualPayload, false);
  assertNoConfidentialFields(manualPayload);
  assert.equal(
    JSON.stringify(manualPayload).includes(DEFAULT_EXPERIMENT.papers[1].title),
    false,
    "a response exposes only the current round paper"
  );

  const aiResponse = await studentGet(
    request("/api/teaching/student", "GET", undefined, second.cookie)
  );
  assert.equal(aiResponse.status, 200);
  const aiPayload = await json(aiResponse);
  assert.equal(aiPayload.status, "active");
  assert.equal(aiPayload.mode, "ai_assisted");
  assert.equal(aiPayload.roundNo, 1);
  assert.ok(aiPayload.aiInitial);
  assertNoConfidentialFields(aiPayload);
  assert.equal(
    JSON.stringify(aiPayload).includes(DEFAULT_EXPERIMENT.papers[1].title),
    false,
    "an AI-assisted response exposes no future round"
  );

  const malformedAction = await studentPost(
    request("/api/teaching/student", "POST", {}, first.cookie)
  );
  assert.equal(malformedAction.status, 400);
  const missingHeartbeatRound = await studentPost(
    request(
      "/api/teaching/student",
      "POST",
      {
        action: "heartbeat",
        eventId: "route-hb-missing-round",
        clientAt: new Date().toISOString(),
        activeDeltaSeconds: 15,
        visible: true,
      },
      first.cookie
    )
  );
  assert.equal(missingHeartbeatRound.status, 400);

  const heartbeatBody = {
    action: "heartbeat",
    eventId: "route-hb-1",
    roundNo: 1,
    clientAt: new Date().toISOString(),
    activeDeltaSeconds: 15,
    visible: true,
    fieldKey: "cation",
  };
  const heartbeat = await studentPost(
    request("/api/teaching/student", "POST", heartbeatBody, first.cookie)
  );
  assert.equal(heartbeat.status, 200);
  assert.deepEqual(await json(heartbeat), { activeSeconds: 15 });
  const duplicateHeartbeat = await studentPost(
    request("/api/teaching/student", "POST", heartbeatBody, first.cookie)
  );
  assert.equal(duplicateHeartbeat.status, 200);
  assert.deepEqual(await json(duplicateHeartbeat), { activeSeconds: 15 });

  const crossOriginPatch = await studentPatch(
    request(
      "/api/teaching/student",
      "PATCH",
      { version: manualPayload.version, answers: completeAnswers("blocked") },
      first.cookie,
      { origin: "https://attacker.example" }
    )
  );
  assert.equal(crossOriginPatch.status, 403);

  const firstSave = await studentPatch(
    request(
      "/api/teaching/student",
      "PATCH",
      { version: manualPayload.version, answers: completeAnswers("manual") },
      first.cookie
    )
  );
  assert.equal(firstSave.status, 200);
  const firstSavePayload = await json(firstSave);
  assert.equal(firstSavePayload.version, Number(manualPayload.version) + 1);

  const staleSave = await studentPatch(
    request(
      "/api/teaching/student",
      "PATCH",
      { version: manualPayload.version, answers: completeAnswers("stale") },
      first.cookie
    )
  );
  assert.equal(staleSave.status, 409);
  assert.equal((await json(staleSave)).kind, "version");

  const unboundSubmit = await studentPost(
    request("/api/teaching/student", "POST", { action: "submit" }, first.cookie)
  );
  assert.equal(
    unboundSubmit.status,
    400,
    "submit must bind both the round and version visible to the student"
  );
  const firstSubmitBody = {
    action: "submit",
    roundNo: 1,
    version: Number(firstSavePayload.version),
  };
  const firstTransition = await studentPost(
    request("/api/teaching/student", "POST", firstSubmitBody, first.cookie)
  );
  assert.equal(firstTransition.status, 200);
  assert.deepEqual(await json(firstTransition), { status: "next_round", roundNo: 2 });

  const delayedSubmit = await studentPost(
    request("/api/teaching/student", "POST", firstSubmitBody, first.cookie)
  );
  assert.equal(delayedSubmit.status, 409);
  assert.equal((await json(delayedSubmit)).kind, "stale_round");
  assert.equal(
    store
      .prepare(
        "SELECT submitted_at FROM teaching_submissions WHERE participant_id = ? AND round_no = 2"
      )
      .pluck()
      .get(first.participantId),
    null,
    "retrying a round 1 request must never submit the prefilled AI round 2"
  );

  const delayedHeartbeat = await studentPost(
    request(
      "/api/teaching/student",
      "POST",
      {
        ...heartbeatBody,
        eventId: "route-hb-delayed-round-1",
        roundNo: 1,
      },
      first.cookie
    )
  );
  assert.equal(delayedHeartbeat.status, 409);
  assert.equal((await json(delayedHeartbeat)).kind, "stale_round");

  const roundTwoResponse = await studentGet(
    request("/api/teaching/student", "GET", undefined, first.cookie)
  );
  const roundTwoPayload = await json(roundTwoResponse);
  assert.equal(roundTwoPayload.status, "active");
  assert.equal(roundTwoPayload.roundNo, 2);
  assert.equal(roundTwoPayload.mode, "ai_assisted");
  assert.ok(roundTwoPayload.aiInitial);
  assertNoConfidentialFields(roundTwoPayload);

  const completion = await studentPost(
    request(
      "/api/teaching/student",
      "POST",
      { action: "submit", roundNo: 2, version: Number(roundTwoPayload.version) },
      first.cookie
    )
  );
  assert.equal(completion.status, 200);
  const completionPayload = await json(completion);
  assert.equal(completionPayload.status, "complete");
  assert.match(String(completionPayload.completedAt), /^20/);

  const completedGet = await studentGet(
    request("/api/teaching/student", "GET", undefined, first.cookie)
  );
  assert.equal((await json(completedGet)).status, "complete");
  const repeatedCompletion = await studentPost(
    request(
      "/api/teaching/student",
      "POST",
      { action: "submit", roundNo: 2, version: Number(roundTwoPayload.version) },
      first.cookie
    )
  );
  assert.equal(repeatedCompletion.status, 200);
  assert.equal((await json(repeatedCompletion)).status, "complete");
  const lockedSave = await studentPatch(
    request(
      "/api/teaching/student",
      "PATCH",
      { version: Number(roundTwoPayload.version), answers: completeAnswers("late") },
      first.cookie
    )
  );
  assert.equal(lockedSave.status, 409);
  assert.equal((await json(lockedSave)).kind, "locked");

  const paperARules = store
    .prepare("SELECT scoring_rules_json FROM teaching_papers WHERE id = ?")
    .pluck()
    .get(DEFAULT_EXPERIMENT.papers[0].id) as string;
  store
    .prepare("UPDATE teaching_papers SET scoring_rules_json = '{broken json' WHERE id = ?")
    .run(DEFAULT_EXPERIMENT.papers[0].id);

  const erroredSubmit = await studentPost(
    request(
      "/api/teaching/student",
      "POST",
      { action: "submit", roundNo: 1, version: Number(aiPayload.version) },
      second.cookie
    )
  );
  assert.equal(
    erroredSubmit.status,
    200,
    "a round that locked and advanced before scoring failed must return its committed transition"
  );
  assert.deepEqual(await json(erroredSubmit), { status: "next_round", roundNo: 2 });

  const erroredRound = store
    .prepare(
      `SELECT id, answers_json, version, updated_at, submitted_at, scoring_status
       FROM teaching_submissions WHERE participant_id = ? AND round_no = 1`
    )
    .get(second.participantId) as {
    id: string;
    answers_json: string;
    version: number;
    updated_at: string;
    submitted_at: string;
    scoring_status: string;
  };
  assert.equal(erroredRound.scoring_status, "scoring_error");
  const immutableErroredRound = {
    answers_json: erroredRound.answers_json,
    version: erroredRound.version,
    updated_at: erroredRound.updated_at,
    submitted_at: erroredRound.submitted_at,
  };
  assert.equal(
    store
      .prepare(
        "SELECT submitted_at FROM teaching_submissions WHERE participant_id = ? AND round_no = 2"
      )
      .pluck()
      .get(second.participantId),
    null,
    "handling a scoring error must not submit the newly activated round"
  );
  store
    .prepare("UPDATE teaching_papers SET scoring_rules_json = ? WHERE id = ?")
    .run(paperARules, DEFAULT_EXPERIMENT.papers[0].id);

  const adminResponse = await adminGet(
    request("/api/teaching/admin", "GET", undefined, teacherCookie)
  );
  assert.equal(adminResponse.status, 200);
  const adminPayload = await json(adminResponse);
  assert.equal((adminPayload.experiment as JsonRecord).id, DEFAULT_EXPERIMENT.id);
  assert.equal((adminPayload.summary as JsonRecord).completion instanceof Object, true);
  assert.ok(Array.isArray(adminPayload.participants));
  assert.equal(
    store
      .prepare("SELECT scoring_status FROM teaching_submissions WHERE id = ?")
      .pluck()
      .get(erroredRound.id),
    "scored"
  );
  assert.deepEqual(
    store
      .prepare(
        `SELECT answers_json, version, updated_at, submitted_at
         FROM teaching_submissions WHERE id = ?`
      )
      .get(erroredRound.id),
    immutableErroredRound,
    "admin recovery may not mutate locked student answers or submission version"
  );

  const crossOriginAdmin = await adminPost(
    request(
      "/api/teaching/admin",
      "POST",
      { action: "review", submissionId: erroredRound.id },
      teacherCookie,
      { origin: "https://attacker.example" }
    )
  );
  assert.equal(crossOriginAdmin.status, 403);
  const removedSetupAction = await adminPost(
    request(
      "/api/teaching/admin",
      "POST",
      { action: "create-project", name: "not allowed", inviteCode: "NOPE" },
      teacherCookie
    )
  );
  assert.equal(removedSetupAction.status, 400);
  const review = await adminPost(
    request(
      "/api/teaching/admin",
      "POST",
      { action: "review", submissionId: erroredRound.id, humanScores: {}, aiScores: {} },
      teacherCookie
    )
  );
  assert.equal(review.status, 200);

  store
    .prepare(
      `UPDATE teaching_submissions
       SET scoring_status = 'scoring_error', auto_scored_at = NULL
       WHERE id = ?`
    )
    .run(erroredRound.id);
  const exportResponse = await exportGet(
    request("/api/teaching/admin/export", "GET", undefined, teacherCookie)
  );
  assert.equal(exportResponse.status, 200);
  assert.equal(exportResponse.headers.get("content-type"), "text/csv; charset=utf-8");
  assert.match(
    exportResponse.headers.get("content-disposition") ?? "",
    /^attachment; filename="teaching-experiment-\d{4}-\d{2}-\d{2}\.csv"$/
  );
  const exportBytes = new Uint8Array(await exportResponse.arrayBuffer());
  assert.deepEqual([...exportBytes.slice(0, 3)], [0xef, 0xbb, 0xbf]);
  const exportCsv = new TextDecoder().decode(exportBytes);
  assert.match(exportCsv, /"\u5b9e\u9a8c\u7248\u672c","\u8bc4\u5206\u7248\u672c","\u5b66\u751f\u6807\u8bc6"/);
  assert.match(exportCsv, /Route S001/);
  assert.match(exportCsv, /Route S002/);
  assert.equal(
    store
      .prepare("SELECT scoring_status FROM teaching_submissions WHERE id = ?")
      .pluck()
      .get(erroredRound.id),
    "scored",
    "direct CSV export must perform the same bounded scoring recovery as the dashboard"
  );

  const anonymousResponse = await exportGet(
    request("/api/teaching/admin/export?anonymize=1", "GET", undefined, teacherCookie)
  );
  const anonymousBytes = new Uint8Array(await anonymousResponse.arrayBuffer());
  assert.deepEqual([...anonymousBytes.slice(0, 3)], [0xef, 0xbb, 0xbf]);
  const anonymousCsv = new TextDecoder().decode(anonymousBytes);
  assert.doesNotMatch(anonymousCsv, /Route S001|Route S002/);
  assert.match(anonymousCsv, /"S001"/);
  assert.match(anonymousCsv, /"S002"/);
  } finally {
    if (previousTeacherPassword === undefined) delete process.env.TEACHING_TEACHER_PASSWORD;
    else process.env.TEACHING_TEACHER_PASSWORD = previousTeacherPassword;
    closeTeachingDatabaseForTests();
  }

  console.log("Zero-configuration teaching API route tests passed");
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
