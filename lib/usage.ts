import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { getAppSession, isAppAuthEnabled } from "./auth.server";

/**
 * Real usage monitoring: page views + key write operations are recorded into
 * data/usage.db (gitignored, survives code syncs like auth.db). The monitor
 * page aggregates this table; nothing here is demo data.
 */

export const FEEDBACK_KINDS = ["问题反馈", "功能建议", "使用建议"] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];

type UsageGlobals = typeof globalThis & { __ionicLinkUsageDatabase?: Database.Database };

function openUsageDatabase(): Database.Database {
  const dataDir = path.resolve(process.env.IONICLINK_DATA_DIR?.trim() || path.join(process.cwd(), "data"));
  mkdirSync(dataDir, { recursive: true });
  const database = new Database(path.join(dataDir, "usage.db"));
  database.pragma("journal_mode = WAL");
  database.pragma("busy_timeout = 30000");
  database.exec(`
    CREATE TABLE IF NOT EXISTS usage_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at TEXT NOT NULL,
      user_id TEXT,
      user_name TEXT NOT NULL DEFAULT '游客',
      kind TEXT NOT NULL,
      module TEXT NOT NULL,
      action TEXT,
      ok INTEGER NOT NULL DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS idx_usage_events_at ON usage_events (at);
    CREATE INDEX IF NOT EXISTS idx_usage_events_user ON usage_events (user_id, at);
    CREATE TABLE IF NOT EXISTS feedback (
      id TEXT PRIMARY KEY,
      at TEXT NOT NULL,
      user_id TEXT NOT NULL,
      user_name TEXT NOT NULL,
      kind TEXT NOT NULL,
      text TEXT NOT NULL,
      reply TEXT NOT NULL DEFAULT '',
      replied_at TEXT,
      replied_by TEXT
    );
  `);
  return database;
}

const usageGlobals = globalThis as UsageGlobals;
const usageDatabase = usageGlobals.__ionicLinkUsageDatabase ?? openUsageDatabase();
if (process.env.NODE_ENV !== "production") usageGlobals.__ionicLinkUsageDatabase = usageDatabase;

export type UsageActor = { id: string; name: string } | null;

/** Display module for a page path; stored on the event so aggregation is a plain GROUP BY. */
export function moduleFromPath(pagePath: string): string {
  const segments = pagePath.split("?")[0].split("/").filter(Boolean);
  if (!segments.length) return "Home";
  const [first, second] = segments;
  if (first === "tribology" || first === "conductivity" || first === "diffusion") {
    switch (second) {
      case "extract": return "Data extraction";
      case "library": return "Documents";
      case "knowledge": return "Knowledge";
      case "design": return "Design";
      default: return "Database";
    }
  }
  switch (first) {
    case "afm": return "AFM";
    case "teaching": return "AI experiment";
    case "monitor": return "Usage monitor";
    case "admin": return "Account management";
    case "account": return "Account settings";
    case "login": return "Sign in";
    default: return "Other";
  }
}

export function recordPageView(actor: UsageActor, pagePath: string): void {
  usageDatabase
    .prepare("INSERT INTO usage_events (at, user_id, user_name, kind, module, ok) VALUES (?, ?, ?, 'page', ?, 1)")
    .run(new Date().toISOString(), actor?.id ?? null, actor?.name ?? "游客", moduleFromPath(pagePath));
}

export function recordAction(actor: UsageActor, modulePath: string, action: string, ok: boolean): void {
  usageDatabase
    .prepare("INSERT INTO usage_events (at, user_id, user_name, kind, module, action, ok) VALUES (?, ?, ?, 'action', ?, ?, ?)")
    .run(new Date().toISOString(), actor?.id ?? null, actor?.name ?? "游客", moduleFromPath(modulePath), action, ok ? 1 : 0);
}

function actorFromSession(session: Awaited<ReturnType<typeof getAppSession>>): UsageActor {
  const user = session?.user as { id?: string; name?: string | null; displayUsername?: string | null; username?: string | null; email?: string | null } | undefined;
  if (!user?.id) return null;
  return { id: user.id, name: user.name || user.displayUsername || user.username || user.email || "用户" };
}

/**
 * Wrap an API handler for a key write operation: records who did what and
 * whether it succeeded (HTTP < 400) into the usage log.
 */
export function withUsageAction<A extends unknown[]>(
  request: Request,
  action: string,
  handler: (...args: A) => Promise<Response>,
  ...args: A
): Promise<Response> {
  return (async () => {
    const session = isAppAuthEnabled() ? await getAppSession(request.headers).catch(() => null) : null;
    const response = await handler(...args);
    try {
      recordAction(actorFromSession(session), new URL(request.url).pathname, action, response.status < 400);
    } catch (error) {
      console.error("[usage] failed to record action", error);
    }
    return response;
  })();
}

// ---------------------------------------------------------------------------
// Aggregates for the monitor page

export type MonitorPeriod = "today" | "week";

export type MonitorUser = { id: string; name: string; module: string; status: "在线" | "空闲"; minutes: number; operations: number };
export type MonitorEvent = { id: number; at: string; user: string; module: string; message: string; success: boolean };
export type MonitorFeedback = { id: string; at: string; user: string; kind: string; text: string; reply: string; repliedBy: string | null };
export type MonitorSummary = {
  online: number;
  activeUsers: number;
  actionTotal: number;
  actionOk: number;
  pendingFeedback: number;
  modules: Array<{ module: string; count: number }>;
  trend: { labels: string[]; points: number[] };
  events: MonitorEvent[];
  users: MonitorUser[];
  feedback: MonitorFeedback[];
};

const ONLINE_WINDOW_MS = 5 * 60 * 1000;
const ACTIVITY_WINDOW_MS = 30 * 60 * 1000;
const SESSION_GAP_MS = 15 * 60 * 1000;

function periodStart(period: MonitorPeriod): string {
  if (period === "week") return new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  return start.toISOString();
}

function trendForPeriod(period: MonitorPeriod): { labels: string[]; points: number[] } {
  const rows = usageDatabase
    .prepare(
      `SELECT strftime('%Y-%m-%dT%H:00', datetime(at, 'localtime')) AS hour,
              strftime('%Y-%m-%d', datetime(at, 'localtime')) AS day,
              COUNT(DISTINCT COALESCE(user_id, 'anon')) AS users
       FROM usage_events WHERE at >= ? GROUP BY 1`
    )
    .all(periodStart("week")) as Array<{ hour: string; day: string; users: number }>;
  const byHour = new Map(rows.map((row) => [row.hour, row.users]));
  const byDay = new Map<string, number>();
  for (const row of rows) byDay.set(row.day, Math.max(byDay.get(row.day) ?? 0, row.users) + 0);
  // Daily buckets must count distinct users per day, not sum hourly distincts;
  // recompute with a dedicated query to avoid double counting across hours.
  const dayRows = usageDatabase
    .prepare(
      `SELECT strftime('%Y-%m-%d', datetime(at, 'localtime')) AS day, COUNT(DISTINCT COALESCE(user_id, 'anon')) AS users
       FROM usage_events WHERE at >= ? GROUP BY 1`
    )
    .all(periodStart("week")) as Array<{ day: string; users: number }>;
  for (const row of dayRows) byDay.set(row.day, row.users);

  if (period === "week") {
    const labels: string[] = [];
    const points: number[] = [];
    for (let i = 6; i >= 0; i--) {
      const day = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
      const key = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
      labels.push(`${String(day.getMonth() + 1).padStart(2, "0")}/${String(day.getDate()).padStart(2, "0")}`);
      points.push(byDay.get(key) ?? 0);
    }
    return { labels, points };
  }

  const labels: string[] = [];
  const points: number[] = [];
  const now = new Date();
  for (let i = 7; i >= 0; i--) {
    const hour = new Date(now.getTime() - i * 60 * 60 * 1000);
    const key = `${hour.getFullYear()}-${String(hour.getMonth() + 1).padStart(2, "0")}-${String(hour.getDate()).padStart(2, "0")}T${String(hour.getHours()).padStart(2, "0")}:00`;
    labels.push(`${String(hour.getHours()).padStart(2, "0")}:00`);
    points.push(byHour.get(key) ?? 0);
  }
  return { labels, points };
}

function activeUsers(nowMs: number): MonitorUser[] {
  const since = new Date(nowMs - 12 * 60 * 60 * 1000).toISOString();
  const rows = usageDatabase
    .prepare(
      `SELECT user_id, user_name, module, kind, at FROM usage_events
       WHERE user_id IS NOT NULL AND at >= ? ORDER BY user_id, at DESC`
    )
    .all(since) as Array<{ user_id: string; user_name: string; module: string; kind: string; at: string }>;

  const users: MonitorUser[] = [];
  let current: { id: string; name: string; events: typeof rows } | null = null;
  const flush = () => {
    if (!current || !current.events.length) return;
    const latest = current.events[0];
    const lastMs = Date.parse(latest.at);
    if (nowMs - lastMs > ACTIVITY_WINDOW_MS) return; // gone quiet: not shown in the table
    // Walk backwards while gaps stay under SESSION_GAP_MS to find this
    // continuous activity window's start.
    let windowStart = lastMs;
    let operations = 0;
    for (let i = 0; i < current.events.length; i++) {
      const eventMs = Date.parse(current.events[i].at);
      if (i > 0 && Date.parse(current.events[i - 1].at) - eventMs > SESSION_GAP_MS) break;
      windowStart = eventMs;
      if (current.events[i].kind === "action") operations += 1;
    }
    users.push({
      id: current.id,
      name: current.name,
      module: latest.module,
      status: nowMs - lastMs <= ONLINE_WINDOW_MS ? "在线" : "空闲",
      minutes: Math.max(1, Math.round((nowMs - windowStart) / 60000)),
      operations,
    });
  };

  for (const row of rows) {
    if (!current || current.id !== row.user_id) {
      flush();
      current = { id: row.user_id, name: row.user_name, events: [] };
    }
    current.events.push(row);
  }
  flush();
  return users.sort((a, b) => (a.status === b.status ? b.minutes - a.minutes : a.status === "在线" ? -1 : 1));
}

export function monitorSummary(period: MonitorPeriod): MonitorSummary {
  const nowMs = Date.now();
  const since = periodStart(period);

  const online = (
    usageDatabase
      .prepare("SELECT COUNT(DISTINCT COALESCE(user_id, 'anon')) AS count FROM usage_events WHERE at >= ?")
      .get(new Date(nowMs - ONLINE_WINDOW_MS).toISOString()) as { count: number }
  ).count;
  const active = (
    usageDatabase
      .prepare("SELECT COUNT(DISTINCT COALESCE(user_id, 'anon')) AS count FROM usage_events WHERE at >= ?")
      .get(since) as { count: number }
  ).count;
  const actions = usageDatabase
    .prepare("SELECT COUNT(*) AS total, COALESCE(SUM(ok), 0) AS ok FROM usage_events WHERE kind = 'action' AND at >= ?")
    .get(since) as { total: number; ok: number };
  const modules = usageDatabase
    .prepare("SELECT module, COUNT(*) AS count FROM usage_events WHERE at >= ? GROUP BY module ORDER BY count DESC LIMIT 8")
    .all(since) as Array<{ module: string; count: number }>;
  const events = (
    usageDatabase
      .prepare("SELECT id, at, user_name, module, kind, action, ok FROM usage_events ORDER BY id DESC LIMIT 25")
      .all() as Array<{ id: number; at: string; user_name: string; module: string; kind: string; action: string | null; ok: number }>
  ).map((row) => ({
    id: row.id,
    at: row.at,
    user: row.user_name,
    module: row.module,
    message: row.kind === "page" ? `访问了 ${row.module}` : `${row.action ?? "执行了操作"}${row.ok ? "" : "（失败）"}`,
    success: Boolean(row.ok),
  }));
  const feedback = (
    usageDatabase.prepare("SELECT * FROM feedback ORDER BY at DESC LIMIT 200").all() as Array<{
      id: string; at: string; user_name: string; kind: string; text: string; reply: string; replied_by: string | null;
    }>
  ).map((row) => ({ id: row.id, at: row.at, user: row.user_name, kind: row.kind, text: row.text, reply: row.reply, repliedBy: row.replied_by }));

  return {
    online,
    activeUsers: active,
    actionTotal: actions.total,
    actionOk: actions.ok,
    pendingFeedback: feedback.filter((item) => !item.reply).length,
    modules,
    trend: trendForPeriod(period),
    events,
    users: activeUsers(nowMs),
    feedback,
  };
}

// ---------------------------------------------------------------------------
// Feedback

export function createFeedback(actor: UsageActor, kind: FeedbackKind, text: string): MonitorFeedback {
  const id = randomUUID().slice(0, 8).toUpperCase();
  const at = new Date().toISOString();
  usageDatabase
    .prepare("INSERT INTO feedback (id, at, user_id, user_name, kind, text) VALUES (?, ?, ?, ?, ?, ?)")
    .run(id, at, actor?.id ?? "anonymous", actor?.name ?? "匿名", kind, text);
  return { id, at, user: actor?.name ?? "匿名", kind, text, reply: "", repliedBy: null };
}

export function replyFeedback(id: string, reply: string, repliedBy: string): boolean {
  const result = usageDatabase
    .prepare("UPDATE feedback SET reply = ?, replied_at = ?, replied_by = ? WHERE id = ?")
    .run(reply, new Date().toISOString(), repliedBy, id);
  return result.changes > 0;
}
