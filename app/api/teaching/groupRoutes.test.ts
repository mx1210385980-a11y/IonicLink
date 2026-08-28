import assert from "node:assert/strict";
import path from "node:path";
import Database from "better-sqlite3";
import { NextRequest } from "next/server";
import {
  closeTeachingDatabaseForTests,
  getTeachingSession,
} from "@/lib/teaching";
import { DEFAULT_EXPERIMENT } from "@/lib/teaching/config";
import { getTeachingDb } from "@/lib/teaching/store";
import {
  GET as groupAdminGet,
  POST as groupAdminPost,
} from "./admin/group/route";
import { GET as groupExportGet } from "./admin/group/export/route";
import { GET as adminGet } from "./admin/route";
import { POST as sessionPost } from "./session/route";

type JsonRecord = Record<string, unknown>;

// --- fixture tribology.db with two official records --------------------------

function fixtureRecord(index: number) {
  return {
    id: `route-rec-${index}`,
    paper: { title: `Route paper ${index}`, doi: `10.1000/r${index}`, journal: "Route J." },
    core: {
      ionicLiquid: { cation: `[C${index}]+`, anion: `[A${index}]-` },
      substrate: `route-substrate-${index}`,
      temperature: { raw: "25 °C", value: 25, unit: "°C", std: 298.15, stdUnit: "K" },
      load: { raw: `${index} nN`, value: index, unit: "nN", std: index * 1e-9, stdUnit: "N" },
      cof: 0.1 + index / 100,
    },
    extraction: { model: "fixture-model" },
  };
}

const tribo = new Database(path.join(process.env.IONICLINK_DATA_DIR!, "tribology.db"));
tribo.exec(
  "CREATE TABLE records (id TEXT PRIMARY KEY, status TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL);"
);
for (const index of [1, 2]) {
  tribo
    .prepare("INSERT INTO records (id, status, payload, created_at) VALUES (?, 'official', ?, ?)")
    .run(`route-rec-${index}`, JSON.stringify(fixtureRecord(index)), "2026-01-01T00:00:00.000Z");
}
tribo.close();

// --- helpers ------------------------------------------------------------------

function request(
  path: string,
  method: string,
  body?: unknown,
  cookie?: string
): NextRequest {
  const headers = new Headers();
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
  return setCookie.split(";")[0];
}

async function json(response: Response): Promise<JsonRecord> {
  return (await response.json()) as JsonRecord;
}

async function main(): Promise<void> {
  const previousTeacherPassword = process.env.TEACHING_TEACHER_PASSWORD;
  process.env.TEACHING_TEACHER_PASSWORD = "group-route-test-password";

  try {
    // --- auth -----------------------------------------------------------------
    const noAuth = await groupAdminGet(request("/api/teaching/admin/group?action=list", "GET"));
    assert.equal(noAuth.status, 401);

    const studentLogin = await sessionPost(
      request("/api/teaching/session", "POST", { role: "student", studentAlias: "Group Route S0" })
    );
    assert.equal(studentLogin.status, 200);
    const studentCookie = cookieFrom(studentLogin);
    const studentOnGroupAdmin = await groupAdminGet(
      request("/api/teaching/admin/group?action=list", "GET", undefined, studentCookie)
    );
    assert.equal(studentOnGroupAdmin.status, 403);

    const teacherLogin = await sessionPost(
      request("/api/teaching/session", "POST", {
        role: "teacher",
        password: "group-route-test-password",
      })
    );
    assert.equal(teacherLogin.status, 200);
    const teacherCookie = cookieFrom(teacherLogin);

    // --- checked records pool ---------------------------------------------------
    const pool = await groupAdminGet(
      request("/api/teaching/admin/group?action=checkedRecords", "GET", undefined, teacherCookie)
    );
    assert.equal(pool.status, 200);
    const poolRecords = (await json(pool)).records as Array<{ recordId: string }>;
    assert.deepEqual(
      poolRecords.map((record) => record.recordId).sort(),
      ["route-rec-1", "route-rec-2"]
    );

    // --- create -----------------------------------------------------------------
    const invalidCreate = await groupAdminPost(
      request(
        "/api/teaching/admin/group",
        "POST",
        { action: "create", name: "坏实验", inviteCode: "BAD1", groupCount: 3, recordIds: ["route-rec-1"] },
        teacherCookie
      )
    );
    assert.equal(invalidCreate.status, 400, "odd group count must be rejected");

    const create = await groupAdminPost(
      request(
        "/api/teaching/admin/group",
        "POST",
        {
          action: "create",
          name: "路由测试分组实验",
          inviteCode: "route-xp-2026",
          groupCount: 2,
          recordIds: ["route-rec-1", "route-rec-2"],
        },
        teacherCookie
      )
    );
    assert.equal(create.status, 200, JSON.stringify(await json(create.clone())));
    const projectId = (await json(create)).projectId as string;
    assert.ok(projectId);

    const list = await groupAdminGet(
      request("/api/teaching/admin/group?action=list", "GET", undefined, teacherCookie)
    );
    const experiments = (await json(list)).experiments as Array<JsonRecord>;
    assert.equal(experiments.length, 1);
    assert.equal(experiments[0].inviteCode, "ROUTE-XP-2026", "invite code is uppercased");
    assert.equal(experiments[0].groupCount, 2);

    // --- roster import ------------------------------------------------------------
    const importResponse = await groupAdminPost(
      request(
        "/api/teaching/admin/group",
        "POST",
        {
          action: "importRoster",
          projectId,
          entries: [
            { studentName: "路由甲", groupNo: 1 },
            { studentName: "路由乙", groupNo: 2 },
            { studentName: "组号越界", groupNo: 9 },
          ],
        },
        teacherCookie
      )
    );
    assert.equal(importResponse.status, 200);
    const importResult = await json(importResponse);
    assert.equal(importResult.added, 2);
    assert.equal((importResult.rejected as unknown[]).length, 1);

    const rosterResponse = await groupAdminGet(
      request(
        `/api/teaching/admin/group?action=roster&projectId=${encodeURIComponent(projectId)}`,
        "GET",
        undefined,
        teacherCookie
      )
    );
    assert.equal(rosterResponse.status, 200);
    const roster = (await json(rosterResponse)).roster as Array<JsonRecord>;
    assert.equal(roster.length, 2);

    // --- session join with invite code --------------------------------------------
    const badCode = await sessionPost(
      request("/api/teaching/session", "POST", {
        role: "student",
        studentAlias: "路由甲",
        inviteCode: "NO-SUCH-CODE",
      })
    );
    assert.equal(badCode.status, 403);
    assert.match(String((await json(badCode)).error), /实验代码/);

    const notInRoster = await sessionPost(
      request("/api/teaching/session", "POST", {
        role: "student",
        studentAlias: "名单外学生",
        inviteCode: "route-xp-2026",
      })
    );
    assert.equal(notInRoster.status, 403);
    assert.match(String((await json(notInRoster)).error), /名单/);

    const joined = await sessionPost(
      request("/api/teaching/session", "POST", {
        role: "student",
        studentAlias: "路由甲",
        inviteCode: " route-xp-2026 ",
      })
    );
    assert.equal(joined.status, 200, JSON.stringify(await json(joined.clone())));
    const joinedCookie = cookieFrom(joined);
    const joinedToken = joinedCookie.slice(joinedCookie.indexOf("=") + 1);
    const joinedSession = getTeachingSession(joinedToken);
    assert.equal(joinedSession?.projectId, projectId);
    assert.ok(joinedSession?.participantId);

    const store = getTeachingDb();
    const participantRow = store
      .prepare(
        `SELECT group_code AS groupCode, sequence_code AS sequence
         FROM teaching_participants WHERE id = ?`
      )
      .get(joinedSession!.participantId!) as { groupCode: string; sequence: string };
    assert.equal(participantRow.groupCode, "1");
    assert.equal(participantRow.sequence, "ai_then_manual", "odd group starts with AI");

    // resume: same name + code returns the same participant
    const resumed = await sessionPost(
      request("/api/teaching/session", "POST", {
        role: "student",
        studentAlias: " 路由甲 ",
        inviteCode: "ROUTE-XP-2026",
      })
    );
    assert.equal(resumed.status, 200);
    const resumedToken = cookieFrom(resumed).slice("ioniclink_teaching_session=".length);
    assert.equal(getTeachingSession(resumedToken)?.participantId, joinedSession!.participantId);

    // claimed roster row cannot be deleted
    const claimedRow = roster.find((entry) => entry.studentName === "路由甲")!;
    const deleteClaimed = await groupAdminPost(
      request(
        "/api/teaching/admin/group",
        "POST",
        { action: "deleteRosterEntry", projectId, rosterId: claimedRow.id },
        teacherCookie
      )
    );
    assert.equal(deleteClaimed.status, 400);

    const unclaimedRow = roster.find((entry) => entry.studentName === "路由乙")!;
    const deleteUnclaimed = await groupAdminPost(
      request(
        "/api/teaching/admin/group",
        "POST",
        { action: "deleteRosterEntry", projectId, rosterId: unclaimedRow.id },
        teacherCookie
      )
    );
    assert.equal(deleteUnclaimed.status, 200);

    // --- cross-kind isolation ------------------------------------------------------
    const defaultDashboard = await adminGet(
      request("/api/teaching/admin", "GET", undefined, teacherCookie)
    );
    assert.equal(defaultDashboard.status, 200);
    const defaultPayload = await json(defaultDashboard);
    assert.equal((defaultPayload.experiment as JsonRecord).id, DEFAULT_EXPERIMENT.id);
    const defaultAliases = JSON.stringify(defaultPayload.participants);
    assert.equal(defaultAliases.includes("路由甲"), false, "group students stay out of the default dashboard");
    assert.equal(defaultAliases.includes("Group Route S0"), true, "default student stays in the default dashboard");

    // --- dashboard + review + export ----------------------------------------------
    const dashboardResponse = await groupAdminGet(
      request(
        `/api/teaching/admin/group?action=dashboard&projectId=${encodeURIComponent(projectId)}`,
        "GET",
        undefined,
        teacherCookie
      )
    );
    assert.equal(dashboardResponse.status, 200);
    const dashboard = (await json(dashboardResponse)) as {
      experiment: JsonRecord;
      groupProgress: Array<JsonRecord>;
      participants: Array<{ studentAlias: string }>;
    };
    assert.equal(dashboard.experiment.inviteCode, "ROUTE-XP-2026");
    assert.equal(dashboard.groupProgress.length, 2);
    assert.deepEqual(
      dashboard.participants.map((participant) => participant.studentAlias),
      ["路由甲"]
    );

    // review on an unsubmitted round is rejected with a 400
    const submissionId = store
      .prepare(
        "SELECT id FROM teaching_submissions WHERE participant_id = ? AND round_no = 1"
      )
      .pluck()
      .get(joinedSession!.participantId!) as string;
    const prematureReview = await groupAdminPost(
      request(
        "/api/teaching/admin/group",
        "POST",
        { action: "review", submissionId, humanScores: { cation: "correct" } },
        teacherCookie
      )
    );
    assert.equal(prematureReview.status, 400);

    const exportResponse = await groupExportGet(
      request(
        `/api/teaching/admin/group/export?projectId=${encodeURIComponent(projectId)}`,
        "GET",
        undefined,
        teacherCookie
      )
    );
    assert.equal(exportResponse.status, 200);
    assert.equal(exportResponse.headers.get("content-type"), "text/csv; charset=utf-8");
    assert.match(
      exportResponse.headers.get("content-disposition") ?? "",
      /^attachment; filename="group-crossover-\d{4}-\d{2}-\d{2}\.csv"$/
    );
    const exportBytes = new Uint8Array(await exportResponse.arrayBuffer());
    assert.deepEqual([...exportBytes.slice(0, 3)], [0xef, 0xbb, 0xbf]);
    const exportCsv = new TextDecoder().decode(exportBytes);
    assert.match(exportCsv, /路由甲/);
    assert.match(exportCsv, /ROUTE-XP-2026/);

    const anonymousExport = await groupExportGet(
      request(
        `/api/teaching/admin/group/export?projectId=${encodeURIComponent(projectId)}&anonymize=1`,
        "GET",
        undefined,
        teacherCookie
      )
    );
    const anonymousCsv = new TextDecoder().decode(await anonymousExport.arrayBuffer());
    assert.doesNotMatch(anonymousCsv, /路由甲/);
    assert.match(anonymousCsv, /"S001"/);

    const unknownAction = await groupAdminPost(
      request("/api/teaching/admin/group", "POST", { action: "drop-everything" }, teacherCookie)
    );
    assert.equal(unknownAction.status, 400);
  } finally {
    if (previousTeacherPassword === undefined) delete process.env.TEACHING_TEACHER_PASSWORD;
    else process.env.TEACHING_TEACHER_PASSWORD = previousTeacherPassword;
    closeTeachingDatabaseForTests();
  }

  console.log("Group-crossover API route tests passed");
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
