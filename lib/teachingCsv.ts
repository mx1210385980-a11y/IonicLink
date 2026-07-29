import type { TeachingDashboardRow } from "./teachingShared";

const HEADERS = [
  "组别",
  "学生标识",
  "文献编号",
  "DOI/链接",
  "来源/期刊",
  "应填字段数",
  "人工耗时(min)",
  "人工已填字段数",
  "人工正确字段数",
  "人工覆盖率",
  "人工准确率",
  "AI已填字段数",
  "AI正确字段数",
  "AI覆盖率",
  "AI准确率",
  "状态",
] as const;

function safeCell(value: unknown): string {
  let text = value == null ? "" : String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function percentage(value: number | null): string {
  return value == null ? "" : `${(value * 100).toFixed(1)}%`;
}

function status(row: TeachingDashboardRow): string {
  if (row.status === "reviewed") return "已完成";
  if (row.status === "pending") return "待审核";
  return "填写中";
}

export function teachingRowsToCsv(rows: TeachingDashboardRow[]): string {
  const lines = [HEADERS.map(safeCell).join(",")];
  for (const row of rows) {
    const m = row.metrics;
    lines.push(
      [
        row.groupCode,
        row.studentAlias,
        row.paperNo,
        row.doi,
        row.journal,
        m.expected,
        row.elapsedSeconds == null ? "" : (row.elapsedSeconds / 60).toFixed(2),
        m.humanFilled,
        m.humanCorrect,
        percentage(m.humanCoverage),
        percentage(m.humanAccuracy),
        m.aiFilled,
        m.aiCorrect,
        percentage(m.aiCoverage),
        percentage(m.aiAccuracy),
        status(row),
      ]
        .map(safeCell)
        .join(",")
    );
  }
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}
