import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { GET as summaryGET } from "./route";
import { POST as replyPOST } from "../feedback/reply/route";
import { POST as feedbackPOST } from "../../feedback/route";
import { POST as trackPOST } from "../../usage/track/route";
import { createTestAdminSession, createTestAppSession } from "@/lib/auth.test-helpers";

function jsonRequest(url: string, body: unknown, cookie: string | null, method = "POST") {
  return new NextRequest(`http://localhost${url}`, {
    method,
    headers: {
      "content-type": "application/json",
      origin: "http://localhost",
      ...(cookie ? { cookie } : {}),
    },
    body: body === null ? undefined : JSON.stringify(body),
  });
}

async function main() {
  const admin = await createTestAdminSession();
  const student = await createTestAppSession();

  // Summary is administrator-only.
  assert.equal((await summaryGET(jsonRequest("/api/monitor/summary", null, null, "GET"))).status, 401);
  assert.equal((await summaryGET(jsonRequest("/api/monitor/summary", null, student.cookie, "GET"))).status, 403);
  assert.equal((await summaryGET(jsonRequest("/api/monitor/summary?period=week", null, admin.cookie, "GET"))).status, 200);

  // The page-view beacon records real visits under the signed-in user.
  assert.equal((await trackPOST(jsonRequest("/api/usage/track", { path: "api/evil" }, admin.cookie))).status, 400);
  assert.equal((await trackPOST(jsonRequest("/api/usage/track", { path: "/tribology/database" }, student.cookie))).status, 204);

  // Feedback requires a signed-in account.
  assert.equal((await feedbackPOST(jsonRequest("/api/feedback", { kind: "问题反馈", text: "x" }, null))).status, 401);
  assert.equal((await feedbackPOST(jsonRequest("/api/feedback", { kind: "不存在", text: "x" }, student.cookie))).status, 400);
  const created = await feedbackPOST(jsonRequest("/api/feedback", { kind: "问题反馈", text: "提取页面偶发超时。" }, student.cookie));
  assert.equal(created.status, 200);
  const createdPayload = (await created.json()) as { feedback: { id: string; user: string } };
  assert.ok(createdPayload.feedback.id, "the feedback entry gets an id");

  // The admin sees the pending feedback in the summary and replies to it.
  const summaryResponse = await summaryGET(jsonRequest("/api/monitor/summary", null, admin.cookie, "GET"));
  const summary = (await summaryResponse.json()) as {
    pendingFeedback: number;
    feedback: Array<{ id: string; text: string; reply: string }>;
    events: Array<{ user: string; message: string }>;
  };
  assert.ok(summary.pendingFeedback >= 1);
  assert.ok(summary.feedback.some((item) => item.id === createdPayload.feedback.id && item.text === "提取页面偶发超时。"));
  assert.ok(
    summary.events.some((event) => event.message === "访问了 Database"),
    "the beacon page view shows up in the admin event stream"
  );

  assert.equal((await replyPOST(jsonRequest("/api/monitor/feedback/reply", { id: createdPayload.feedback.id, reply: "已记录。" }, student.cookie))).status, 403);
  const replied = await replyPOST(jsonRequest("/api/monitor/feedback/reply", { id: createdPayload.feedback.id, reply: "已记录，会在下个版本修复。" }, admin.cookie));
  assert.equal(replied.status, 200);

  const after = (await (await summaryGET(jsonRequest("/api/monitor/summary", null, admin.cookie, "GET"))).json()) as {
    feedback: Array<{ id: string; reply: string }>;
  };
  assert.equal(after.feedback.find((item) => item.id === createdPayload.feedback.id)?.reply, "已记录，会在下个版本修复。");

  console.log("Monitor API route tests passed");
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
