import assert from "node:assert/strict";
import {
  createFeedback,
  moduleFromPath,
  monitorSummary,
  recordAction,
  recordPageView,
  replyFeedback,
} from "./usage";

function main() {
  // Path → display module mapping drives the module distribution panel.
  assert.equal(moduleFromPath("/"), "Home");
  assert.equal(moduleFromPath("/tribology/extract"), "Data extraction");
  assert.equal(moduleFromPath("/conductivity/database"), "Database");
  assert.equal(moduleFromPath("/diffusion/library"), "Documents");
  assert.equal(moduleFromPath("/teaching"), "AI experiment");
  assert.equal(moduleFromPath("/afm"), "AFM");
  assert.equal(moduleFromPath("/admin/users"), "Account management");

  const alice = { id: "user-alice", name: "alice01" };
  const bob = { id: "user-bob", name: "bob02" };

  // Page views and actions land in the summary with the real user names.
  recordPageView(alice, "/tribology/database");
  recordPageView(alice, "/tribology/extract");
  recordPageView(bob, "/teaching");
  recordPageView(null, "/conductivity/database"); // anonymous visitor
  recordAction(alice, "/api/tribology/extract", "提取数据", true);
  recordAction(alice, "/api/tribology/export", "导出数据", false);

  const summary = monitorSummary("today");
  assert.ok(summary.online >= 3, "alice, bob and the anonymous visitor are all online right now");
  assert.ok(summary.activeUsers >= 3, "active users today counts everyone above");
  assert.equal(summary.actionTotal, 2, "two actions were recorded");
  assert.equal(summary.actionOk, 1, "one action failed");
  assert.ok(summary.modules.some((item) => item.module === "Database" && item.count >= 2), "module distribution groups page views");
  assert.equal(summary.trend.labels.length, 8, "today trend has eight hourly points");
  assert.equal(monitorSummary("week").trend.labels.length, 7, "week trend has seven daily points");

  const eventMessages = summary.events.map((event) => `${event.user}:${event.message}:${event.success}`);
  assert.ok(eventMessages.some((line) => line === "alice01:导出数据（失败）:false"), "failed actions are flagged in the event stream");
  assert.ok(eventMessages.some((line) => line === "bob02:访问了 AI experiment:true"), "page views appear in the event stream");

  const tableAlice = summary.users.find((user) => user.id === "user-alice");
  assert.ok(tableAlice, "named users appear in the activity table");
  assert.equal(tableAlice.status, "在线");
  assert.equal(tableAlice.module, "Data extraction", "the table shows the module of the latest page view");
  assert.equal(tableAlice.operations, 2, "operations count actions in the activity window");
  assert.ok(!summary.users.some((user) => user.name === "游客"), "anonymous visitors stay out of the named-user table");

  // Feedback lifecycle: create → pending → reply → replied.
  const entry = createFeedback(bob, "功能建议", "希望支持批量导出。 ");
  assert.equal(entry.user, "bob02");
  let withFeedback = monitorSummary("today");
  assert.ok(withFeedback.pendingFeedback >= 1, "new feedback is pending");
  assert.ok(withFeedback.feedback.some((item) => item.id === entry.id && !item.reply));

  assert.equal(replyFeedback(entry.id, "已在计划中。", "admin01"), true);
  assert.equal(replyFeedback("NO-SUCH-ID", "x", "admin01"), false, "replying to a missing entry reports failure");
  withFeedback = monitorSummary("today");
  const replied = withFeedback.feedback.find((item) => item.id === entry.id);
  assert.equal(replied?.reply, "已在计划中。");
  assert.equal(replied?.repliedBy, "admin01");

  console.log("Usage monitoring data layer tests passed");
}

main();
