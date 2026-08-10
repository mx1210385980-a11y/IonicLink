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

interface TrustedCsvCell {
  readonly kind: "trusted_csv_cell";
  readonly value: string | number;
}

function trustedCell(value: string | number): TrustedCsvCell {
  return { kind: "trusted_csv_cell", value };
}

function trustedNumber(value: number): TrustedCsvCell | "" {
  return Number.isFinite(value) ? trustedCell(value) : "";
}

function trustedPercentage(value: number | null): TrustedCsvCell | "" {
  return value !== null && Number.isFinite(value)
    ? trustedCell(`${(value * 100).toFixed(1)}%`)
    : "";
}

function safeCell(value: unknown): string {
  const trusted =
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    value.kind === "trusted_csv_cell";
  const raw = trusted ? (value as TrustedCsvCell).value : value;
  let text = raw == null ? "" : String(raw);
  if (!trusted && /^[\s\p{Cc}]*[=+\-@]/u.test(text)) text = `'${text}`;
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
    trustedNumber(round.activeSeconds),
    trustedNumber(round.wallSeconds),
    round.timingQuality,
    `${round.score.valueCorrect}/${TEACHING_FIELDS.length}`,
    trustedPercentage(round.score.valueAccuracy),
    trustedPercentage(round.score.valueCoverage),
    trustedPercentage(round.score.evidenceAccuracy),
    trustedPercentage(round.score.evidenceCoverage),
  ];
}

function createAliasReplacer(
  replacements: ReadonlyArray<{ raw: string; anonymized: string }>
): (value: unknown) => unknown {
  if (replacements.length === 0) return (value) => value;
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
  return (value) =>
    typeof value === "string"
      ? value.replace(pattern, (raw) => anonymizedByRaw.get(raw)!)
      : value;
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
  const replaceAliases = createAliasReplacer(replacements);
  const lines = [EXPERIMENT_HEADERS.map(safeCell).join(",")];

  for (const [index, participant] of dashboard.participants.entries()) {
    const behavior = participant.aiAssisted?.aiBehavior;
    const values: unknown[] = [
      dashboard.experiment.id,
      dashboard.experiment.name,
      dashboard.experiment.version,
      dashboard.experiment.scoringVersion,
      options.anonymize ? labels[index] : participant.studentAlias,
      participant.sequence,
      participant.quality.completion,
      participant.quality.paired ? "paired" : "not_paired",
      options.anonymize
        ? participant.quality.excluded ? "excluded" : ""
        : participant.exclusionReason ?? "",
      ...roundCells(participant.manual),
      ...roundCells(participant.aiAssisted),
      behavior ? trustedNumber(behavior.suggested) : "",
      behavior ? trustedNumber(behavior.adopted) : "",
      behavior ? trustedNumber(behavior.modified) : "",
      behavior ? trustedNumber(behavior.initiallyIncorrect) : "",
      behavior ? trustedNumber(behavior.corrected) : "",
      behavior ? trustedNumber(behavior.incorrectlyAdopted) : "",
      behavior ? trustedPercentage(behavior.adoptionRate) : "",
      behavior ? trustedPercentage(behavior.modificationRate) : "",
      behavior ? trustedPercentage(behavior.correctionRate) : "",
      behavior ? trustedPercentage(behavior.incorrectAdoptionRate) : "",
      participant.activeTimeDifference === null
        ? ""
        : trustedNumber(participant.activeTimeDifference),
      trustedPercentage(participant.accuracyDifference),
    ];
    lines.push(
      values
        .map((value, columnIndex) =>
          options.anonymize && columnIndex === 4
            ? value
            : replaceAliases(value)
        )
        .map(safeCell)
        .join(",")
    );
  }
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}
