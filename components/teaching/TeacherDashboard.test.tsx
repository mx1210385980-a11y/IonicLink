import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  summarizeTeachingExperiment,
  summarizeTeachingExperimentDiagnostics,
} from "../../lib/teaching/analytics";
import {
  TEACHING_FIELDS,
  type TeachingAiBehavior,
  type TeachingAnswers,
  type TeachingAutoScore,
  type TeachingDashboardParticipant,
  type TeachingExperimentDashboard,
  type TeachingTeacherAiRound,
  type TeachingTeacherManualRound,
} from "../../lib/teachingShared";
import {
  TeacherDashboard,
  TeacherParticipantDetail,
  teachingDialogTabTarget,
} from "./TeacherDashboard";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

function score(valueCorrect: number, evidenceCorrect = valueCorrect): TeachingAutoScore {
  const values = Object.fromEntries(
    TEACHING_FIELDS.map((field, index) => [
      field.key,
      {
        correct: index < valueCorrect,
        normalized: `${field.key}-normalized`,
        reason: index < valueCorrect ? "alias_match" : "value_mismatch",
      },
    ])
  ) as TeachingAutoScore["values"];
  const evidence = Object.fromEntries(
    TEACHING_FIELDS.map((field, index) => [
      field.key,
      {
        correct: index < evidenceCorrect,
        normalized: `${field.key}-evidence`,
        reason: index < evidenceCorrect ? "keyword_match" : "page_mismatch",
      },
    ])
  ) as TeachingAutoScore["evidence"];
  return {
    values,
    evidence,
    valueCorrect,
    valueAccuracy: valueCorrect / TEACHING_FIELDS.length,
    valueCoverage: 1,
    evidenceCorrect,
    evidenceAccuracy: evidenceCorrect / TEACHING_FIELDS.length,
    evidenceCoverage: 5 / 6,
  };
}

const aiBehavior: TeachingAiBehavior = {
  suggested: 6,
  adopted: 4,
  modified: 2,
  initiallyIncorrect: 2,
  corrected: 1,
  incorrectlyAdopted: 1,
  adoptionRate: 4 / 6,
  modificationRate: 2 / 6,
  correctionRate: 1 / 2,
  incorrectAdoptionRate: 1 / 2,
};

const finalAnswers: TeachingAnswers = Object.fromEntries(
  TEACHING_FIELDS.map((field, index) => [
    field.key,
    {
      value: `${field.label} 最终值 ${index + 1}`,
      page: String(index + 10),
      evidence: `${field.label} 证据摘录 ${index + 1}`,
    },
  ])
) as TeachingAnswers;

const aiInitial: TeachingAnswers = Object.fromEntries(
  TEACHING_FIELDS.map((field, index) => [
    field.key,
    {
      value: `${field.label} AI 初始建议 ${index + 1}`,
      page: String(index + 20),
      evidence: `${field.label} AI 初始证据 ${index + 1}`,
    },
  ])
) as TeachingAnswers;

function manualRound(
  participantNo: number,
  paperCode: "A" | "B"
): TeachingTeacherManualRound {
  return {
    submissionId: `manual-${participantNo}`,
    paperCode,
    mode: "manual",
    activeSeconds: 1_200,
    wallSeconds: 1_260,
    score: score(4, 3),
    aiBehavior: null,
    timingQuality: "valid",
    finalAnswers,
    review: null,
  };
}

function assistedRound(
  participantNo: number,
  paperCode: "A" | "B"
): TeachingTeacherAiRound {
  return {
    submissionId: `ai-${participantNo}`,
    paperCode,
    mode: "ai_assisted",
    activeSeconds: 600,
    wallSeconds: 660,
    score: score(5, 4),
    aiBehavior,
    timingQuality: "valid",
    finalAnswers,
    aiInitial,
    review: {
      reviewedAt: "2026-08-10T02:00:00.000Z",
      finalValueScores: { cation: "correct" },
      aiInitialValueScores: { cation: "incorrect" },
    },
  };
}

function participant(number: number): TeachingDashboardParticipant {
  const sequence = number % 2 === 1 ? "manual_then_ai" : "ai_then_manual";
  const manualPaper = sequence === "manual_then_ai" ? "A" : "B";
  const aiPaper = sequence === "manual_then_ai" ? "B" : "A";
  return {
    participantId: `participant-${number}`,
    studentAlias: `S${String(number).padStart(3, "0")}`,
    sequence,
    completed: true,
    exclusionReason: null,
    manual: manualRound(number, manualPaper),
    aiAssisted: assistedRound(number, aiPaper),
    activeTimeDifference: -600,
    accuracyDifference: 1 / 6,
    quality: {
      completion: "completed",
      timing: "valid",
      excluded: false,
      paired: true,
    },
  };
}

const participants = Array.from({ length: 30 }, (_, index) => participant(index + 1));
const papers = [
  {
    id: "paper-a",
    code: "A" as const,
    title: "Paper A title",
    doi: "10.0000/a",
    journal: "Journal A",
    sourceUrl: "https://example.test/a.pdf",
  },
  {
    id: "paper-b",
    code: "B" as const,
    title: "Paper B title",
    doi: "10.0000/b",
    journal: "Journal B",
    sourceUrl: "https://example.test/b.pdf",
  },
];

const dashboard: TeachingExperimentDashboard = {
  experiment: {
    id: "teaching-v1",
    name: "人工提取与 AI 辅助提取对比实验",
    version: "2026.1",
    scoringVersion: "score-v1",
    papers,
  },
  summary: summarizeTeachingExperiment(participants),
  diagnostics: summarizeTeachingExperimentDiagnostics(participants),
  participants,
};

const excludedParticipant: TeachingDashboardParticipant = {
  ...participants[0],
  participantId: "participant-excluded",
  studentAlias: "S999",
  exclusionReason: "教师排除备注：重复提交 EXCLUSION_UI_SECRET",
  manual: {
    ...participants[0].manual!,
    submissionId: "manual-excluded",
    activeSeconds: 100,
    wallSeconds: 1_200,
    timingQuality: "excessive_idle",
  },
  aiAssisted: {
    ...participants[0].aiAssisted!,
    submissionId: "ai-excluded",
  },
  activeTimeDifference: null,
  accuracyDifference: null,
  quality: {
    completion: "completed",
    timing: "excessive_idle",
    excluded: true,
    paired: false,
  },
};

const html = renderToStaticMarkup(createElement(TeacherDashboard, { initial: dashboard }));
assert.match(html, /^<section\b/);
assert.doesNotMatch(html, /<main\b/);
assert.match(html, /人工提取与 AI 辅助提取对比实验/);
assert.match(html, /2026\.1/);
assert.match(html, /自动刷新|实时/);
assert.match(html, /上次更新/);
assert.match(html, /href="\/api\/teaching\/admin\/export"/);
assert.match(html, /href="\/api\/teaching\/admin\/export\?anonymize=1"/);
assert.match(html, />退出</);
assert.doesNotMatch(html, /新建项目|配置文献|邀请码|保存审核/);

assert.match(html, /30[\s\S]*30/);
assert.match(html, /配对样本|主分析/);
assert.match(html, /n=30|n = 30/);
assert.match(html, /4\/6/);
assert.match(html, /5\/6/);
assert.match(html, /50\.0%/);
assert.match(html, /证据准确率|证据覆盖率/);
assert.match(html, /更快且更准确/);
assert.match(html, /30 \/ 30[\s\S]*100\.0%/);

assert.match(html, /role="img"/);
assert.match(html, /aria-label="[^"]*AI[^"]*有效时间[^"]*准确率[^"]*"/);
assert.match(html, /有效时间（秒）/);
assert.match(html, /值准确率/);
assert.match(html, /人工模式/);
assert.match(html, /AI 辅助/);
assert.match(html, /95% CI/);
assert.match(html, /Wilcoxon/);
assert.match(html, /<caption[^>]*>模式对比精确数值/);

for (const label of ["建议数", "采纳数", "修改数", "初始错误", "已纠正", "错误照抄"]) {
  assert.match(html, new RegExp(label));
}
assert.match(html, /文献 A/);
assert.match(html, /文献 B/);
assert.match(html, /人工→AI/);
assert.match(html, /AI→人工/);
assert.match(html, /人工 \/ AI 准确率/);
assert.match(html, /计时质量/);

for (const label of ["学生搜索", "文献聚焦", "实验序列", "完成状态", "计时质量"]) {
  assert.match(html, new RegExp(`<label[^>]*>[\\s\\S]*?${label}|${label}`));
}
for (const option of ["A · 人工", "A · AI", "B · 人工", "B · AI"]) {
  assert.match(html, new RegExp(option.replace("·", "[\\s·]*")));
}
assert.match(html, /<caption[^>]*>参与者结果/);
assert.match(html, /scope="col"/);
assert.match(html, /aria-label="查看学生 S001 的结果"/);
assert.match(html, /主分析状态/);
assert.equal((html.match(/>AI 有效时间</g) ?? []).length, 1);
assert.match(
  html,
  /<th scope="row"[^>]*>有效<\/th><td[^>]*>30<\/td><\/tr>/,
  "timing quality rows must contain one label cell and one count cell"
);

const detailHtml = renderToStaticMarkup(
  createElement(TeacherParticipantDetail, {
    participant: excludedParticipant,
    papers,
    onClose: () => undefined,
  })
);
assert.match(detailHtml, /role="dialog"/);
assert.match(detailHtml, /aria-modal="true"/);
assert.match(detailHtml, /aria-labelledby="[^"]+"/);
for (const field of TEACHING_FIELDS) {
  assert.match(detailHtml, new RegExp(field.label));
  assert.match(detailHtml, new RegExp(`${field.label} 最终值`));
  assert.match(detailHtml, new RegExp(`${field.label} 证据摘录`));
  assert.match(detailHtml, new RegExp(`${field.label} AI 初始建议`));
}
assert.match(detailHtml, /页码/);
assert.match(detailHtml, /值判定/);
assert.match(detailHtml, /证据判定/);
assert.match(detailHtml, /alias_match/);
assert.match(detailHtml, /page_mismatch/);
assert.match(detailHtml, /历史教师判定/);
assert.match(detailHtml, /最终值 正确/);
assert.match(detailHtml, /AI 初始值 不正确/);
assert.match(detailHtml, /08\/10/);
assert.match(detailHtml, /完成状态[\s\S]*已完成/);
assert.match(detailHtml, /计时质量[\s\S]*空闲过多/);
assert.match(detailHtml, /排除状态[\s\S]*已排除/);
assert.match(detailHtml, /主分析配对[\s\S]*未纳入/);
assert.match(detailHtml, /教师排除备注：重复提交 EXCLUSION_UI_SECRET/);
assert.match(detailHtml, /有效时间[\s\S]*100 s/);
assert.match(detailHtml, /墙钟时间[\s\S]*1,200 s/);
assert.doesNotMatch(detailHtml, /<input\b|<select\b|<textarea\b|保存审核|>保存</);

const excludedDashboardHtml = renderToStaticMarkup(
  createElement(TeacherDashboard, {
    initial: { ...dashboard, participants: [excludedParticipant] },
  })
);
assert.match(excludedDashboardHtml, /S999[\s\S]*已排除/);

const emptyDashboard: TeachingExperimentDashboard = {
  ...dashboard,
  summary: summarizeTeachingExperiment([]),
  diagnostics: summarizeTeachingExperimentDiagnostics([]),
  participants: [],
};
const emptyHtml = renderToStaticMarkup(
  createElement(TeacherDashboard, { initial: emptyDashboard })
);
assert.match(emptyHtml, /样本不足/);
assert.match(emptyHtml, />—</);
assert.doesNotMatch(emptyHtml, />0\.0%</);
assert.match(emptyHtml, /更快且更准确[\s\S]*>—<[\s\S]*样本不足/);

assert.equal(teachingDialogTabTarget(0, 2, true), 1);
assert.equal(teachingDialogTabTarget(1, 2, false), 0);
assert.equal(teachingDialogTabTarget(-1, 2, false), 0);
assert.equal(teachingDialogTabTarget(0, 2, false), null);
assert.equal(teachingDialogTabTarget(0, 0, false), null);

const source = readFileSync("components/teaching/TeacherDashboard.tsx", "utf8");
assert.match(source, /30_000/);
assert.match(source, /visibilitychange/);
assert.match(source, /document\.visibilityState\s*===\s*["']visible["']/);
assert.match(source, /selectedParticipantId/);
assert.match(source, /data\.participants\.find/);
assert.match(
  source,
  /selectedParticipantId[\s\S]*data\.participants\.some[\s\S]*setSelectedParticipantId\(null\)/,
  "a selected participant id must be cleared if the refreshed record disappears"
);
assert.doesNotMatch(source, /useState<TeachingDashboardParticipant\s*\|\s*null>/);
assert.match(source, /querySelectorAll<HTMLElement>/);
assert.match(source, /event\.key\s*!==\s*["']Tab["']/);
assert.match(source, /event\.preventDefault\(\)/);
assert.match(source, /detailReturnFocusRef/);
assert.match(source, /event\.currentTarget/);
assert.match(source, /detailReturnFocusRef\.current[\s\S]*\.focus\(\)/);
assert.match(source, /aria-hidden=\{selectedParticipant\s*\?\s*true\s*:\s*undefined\}/);
assert.match(source, /setAttribute\(["']inert["'],\s*["']["']\)/);
assert.match(source, /removeAttribute\(["']inert["']\)/);
assert.match(source, /overflow-x-auto/);
assert.match(source, /min-h-(?:11|\[44px\])/);
assert.doesNotMatch(source, /w-screen|min-w-screen/);
assert.equal((source.match(/["']AI 有效时间["']/g) ?? []).length, 1);
assert.match(source, /colSpan=\{14\}/);

const pageSource = readFileSync("app/teaching/admin/page.tsx", "utf8");
assert.match(pageSource, /getDefaultTeachingDashboard/);
assert.doesNotMatch(pageSource, /getTeachingAdminDashboard/);

console.log("Teaching zero-operation teacher dashboard component tests passed");
