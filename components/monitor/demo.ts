export const MODULES = ["Data extraction", "Prediction of μ", "Database", "Documents"] as const;
export type UsageModule = typeof MODULES[number];
export type UsageUser = { id: string; module: UsageModule; status: "在线" | "空闲"; minutes: number; operations: number };
export type UsageEvent = { id: string; time: string; user: string; module: UsageModule; message: string; success: boolean };
export type Feedback = { id: string; user: string; kind: "功能建议" | "问题反馈" | "使用建议"; text: string; time: string; reply: string };
export type DemoState = { tick: number; users: UsageUser[]; events: UsageEvent[]; moduleCounts: number[]; successful: number; feedback: Feedback[] };
export const TODAY_POINTS = [18, 32, 41, 56, 48, 61, 53, 46];
export const WEEK_POINTS = [132, 145, 157, 138, 174, 163, 186];
export const FEEDBACK_STORAGE = "ioniclink.usage-demo.feedback.v1";

export function createDemoState(): DemoState {
  return {
    tick: 0,
    users: MODULES.concat(["Prediction of μ"]).map((module, i) => ({
      id: `用户 ${String(i + 1).padStart(3, "0")}`, module, status: i === 2 ? "空闲" : "在线",
      minutes: [12, 8, 3, 25, 6, 14][i], operations: [12, 8, 3, 6, 5, 10][i],
    })),
    events: [
      { id: "seed-1", time: "16:03:21", user: "用户 002", module: "Prediction of μ", message: "打开了预测页面", success: true },
      { id: "seed-2", time: "16:02:17", user: "用户 001", module: "Data extraction", message: "完成数据提取（12 条）", success: true },
      { id: "seed-3", time: "16:01:05", user: "用户 004", module: "Documents", message: "查看了文献详情", success: true },
      { id: "seed-4", time: "15:58:42", user: "用户 003", module: "Database", message: "执行了数据筛选", success: true },
      { id: "seed-5", time: "15:56:11", user: "用户 005", module: "Prediction of μ", message: "提交了使用反馈", success: true },
    ],
    moduleCounts: [38, 24, 18, 12], successful: 90,
    feedback: [
      { id: "F-001", user: "用户 003", kind: "功能建议", text: "希望增加批量导出功能，便于数据对比分析。", time: "今天 15:56", reply: "" },
      { id: "F-002", user: "用户 001", kind: "问题反馈", text: "提取时遇到了文件格式提示，希望提示更明确。", time: "今天 14:20", reply: "" },
      { id: "F-003", user: "用户 004", kind: "使用建议", text: "建议在模型预测结果中增加参数说明。", time: "今天 11:08", reply: "" },
    ],
  };
}

export type DemoAction = { type: "tick" } | { type: "reply"; id: string; reply: string } | { type: "restore"; feedback: Feedback[] } | { type: "reset" };
export function demoReducer(state: DemoState, action: DemoAction): DemoState {
  if (action.type === "reset") return createDemoState();
  if (action.type === "restore") return { ...state, feedback: action.feedback };
  if (action.type === "reply") return { ...state, feedback: state.feedback.map(item => item.id === action.id ? { ...item, reply: action.reply.trim() } : item) };
  const tick = state.tick + 1;
  const userIndex = (tick - 1) % state.users.length;
  const user = state.users[userIndex];
  const moduleIndex = MODULES.indexOf(user.module);
  const success = tick % 7 !== 0;
  const message = success ? ["完成了一次数据提取", "调整了模型参数", "应用了数据筛选", "查看了文献详情"][moduleIndex] : "操作出现错误，等待重试";
  const time = new Date(Date.UTC(2026, 8, 30, 8, 3, 21) + tick * 4000).toLocaleTimeString("zh-CN", { hour12: false, timeZone: "Asia/Shanghai" });
  return { ...state, tick,
    users: state.users.map((item, i) => i === userIndex ? { ...item, status: "在线", operations: item.operations + 1, minutes: item.minutes + (tick % 15 === 0 ? 1 : 0) } : i === (userIndex + 2) % state.users.length && tick > 2 ? { ...item, status: "空闲" } : item),
    events: [{ id: `live-${tick}`, time, user: user.id, module: user.module, message, success }, ...state.events].slice(0, 5),
    moduleCounts: state.moduleCounts.map((count, i) => count + (i === moduleIndex ? 1 : 0)), successful: state.successful + Number(success),
  };
}

export function restoreFeedback(raw: string | null): Feedback[] {
  const initial = createDemoState().feedback;
  if (!raw) return initial;
  try {
    const saved: unknown = JSON.parse(raw);
    if (!saved || typeof saved !== "object" || !("version" in saved) || saved.version !== 1 || !("replies" in saved) || !Array.isArray(saved.replies)) return initial;
    const replies: unknown[] = saved.replies;
    return initial.map(item => {
      const reply = replies.find((value): value is { id: string; reply: string } => Boolean(value && typeof value === "object" && "id" in value && value.id === item.id && "reply" in value && typeof value.reply === "string"));
      return { ...item, reply: reply ? String(reply.reply).slice(0, 1000) : "" };
    });
  } catch { return initial; }
}

export function usersCsv(users: UsageUser[], period: string): string {
  const cell = (value: string | number) => `"${String(value).replaceAll('"', '""')}"`;
  return "\uFEFF" + [["数据来源", "期间", "用户", "模块", "状态", "本次停留（分钟）", "操作次数"], ...users.map(user => ["前端演示数据", period, user.id, user.module, user.status, user.minutes, user.operations])].map(row => row.map(cell).join(",")).join("\r\n");
}
