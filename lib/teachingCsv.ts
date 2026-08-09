import {
  TEACHING_FIELDS,
  type TeachingDashboardRow,
  type TeachingExperimentDashboard,
  type TeachingRoundAnalysis,
} from "./teachingShared";

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
  if (/^[\s\p{Cc}]*[=+\-@]/u.test(text)) text = `'${text}`;
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

const EXPERIMENT_HEADERS = [
  "实验ID",
  "实验名称",
  "实验版本",
  "评分版本",
  "学生标识",
  "序列",
  "完成状态",
  "主分析配对状态",
  "排除原因",
  "人工文献代码",
  "人工活跃时间(s)",
  "人工墙钟时间(s)",
  "人工计时质量",
  "人工正确数/6",
  "人工值准确率",
  "人工值覆盖率",
  "人工证据准确率",
  "人工证据覆盖率",
  "AI文献代码",
  "AI活跃时间(s)",
  "AI墙钟时间(s)",
  "AI计时质量",
  "AI正确数/6",
  "AI值准确率",
  "AI值覆盖率",
  "AI证据准确率",
  "AI证据覆盖率",
  "AI建议数",
  "AI采纳数",
  "AI修改数",
  "AI初始错误数",
  "AI纠正数",
  "AI错误照抄数",
  "AI采纳率",
  "AI修改率",
  "AI纠错率",
  "AI错误照抄率",
  "AI-人工活跃时间差(s)",
  "AI-人工准确率差",
] as const;

function roundCells(round: TeachingRoundAnalysis | null): unknown[] {
  if (!round) return Array.from({ length: 9 }, () => "");
  return [
    round.paperCode,
    round.activeSeconds,
    round.wallSeconds,
    round.timingQuality,
    `${round.score.valueCorrect}/${TEACHING_FIELDS.length}`,
    percentage(round.score.valueAccuracy),
    percentage(round.score.valueCoverage),
    percentage(round.score.evidenceAccuracy),
    percentage(round.score.evidenceCoverage),
  ];
}

function replaceAliases(
  value: unknown,
  replacements: ReadonlyArray<{ raw: string; anonymized: string }>
): unknown {
  if (typeof value !== "string" || replacements.length === 0) return value;
  const anonymizedByRaw = new Map<string, string>();
  for (const replacement of replacements) {
    if (!anonymizedByRaw.has(replacement.raw)) {
      anonymizedByRaw.set(replacement.raw, replacement.anonymized);
    }
  }
  const pattern = new RegExp(
    [...anonymizedByRaw.keys()]
      .map((raw) => raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("|"),
    "gu"
  );
  return value.replace(pattern, (raw) => anonymizedByRaw.get(raw)!);
}

export function teachingExperimentToCsv(
  dashboard: TeachingExperimentDashboard,
  options: { anonymize?: boolean } = {}
): string {
  const labels = dashboard.participants.map(
    (_, index) => `S${String(index + 1).padStart(3, "0")}`
  );
  const replacements = options.anonymize
    ? dashboard.participants
        .flatMap((participant, index) => [
          { raw: participant.studentAlias, anonymized: labels[index] },
          { raw: participant.participantId, anonymized: labels[index] },
        ])
        .filter(({ raw }) => raw.length > 0)
        .sort((left, right) => right.raw.length - left.raw.length)
    : [];
  const lines = [EXPERIMENT_HEADERS.map(safeCell).join(",")];

  for (const [index, participant] of dashboard.participants.entries()) {
    const behavior = participant.aiAssisted?.aiBehavior;
    const paired =
      participant.activeTimeDifference !== null && participant.accuracyDifference !== null;
    const values: unknown[] = [
      dashboard.experiment.id,
      dashboard.experiment.name,
      dashboard.experiment.version,
      dashboard.experiment.scoringVersion,
      options.anonymize ? labels[index] : participant.studentAlias,
      participant.sequence,
      participant.completed ? "completed" : "incomplete",
      paired ? "paired" : "not_paired",
      participant.exclusionReason ?? "",
      ...roundCells(participant.manual),
      ...roundCells(participant.aiAssisted),
      behavior?.suggested ?? "",
      behavior?.adopted ?? "",
      behavior?.modified ?? "",
      behavior?.initiallyIncorrect ?? "",
      behavior?.corrected ?? "",
      behavior?.incorrectlyAdopted ?? "",
      behavior ? percentage(behavior.adoptionRate) : "",
      behavior ? percentage(behavior.modificationRate) : "",
      behavior ? percentage(behavior.correctionRate) : "",
      behavior ? percentage(behavior.incorrectAdoptionRate) : "",
      participant.activeTimeDifference ?? "",
      participant.accuracyDifference === null
        ? ""
        : percentage(participant.accuracyDifference),
    ];
    lines.push(
      values
        .map((value, columnIndex) =>
          options.anonymize && columnIndex === 4
            ? value
            : replaceAliases(value, replacements)
        )
        .map(safeCell)
        .join(",")
    );
  }
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}
