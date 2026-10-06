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
import { TeachingAdminConsole } from "./TeachingAdminConsole";

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
    name: "Manual extraction与 AI assisted提取对比实验",
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
assert.match(html, /Manual extraction与 AI assisted提取对比实验/);
assert.match(html, /Auto-refresh|实时/);
assert.match(html, /Last updated/);
assert.match(html, /href="\/api\/teaching\/admin\/export"/);
assert.match(html, /href="\/api\/teaching\/admin\/export\?anonymize=1"/);
assert.doesNotMatch(html, />Sign out</);
assert.doesNotMatch(html, /新建项目|配置Paper|邀请码|保存审核/);
assert.match(html, /Student progress/);
assert.match(html, /More filters/);
assert.match(html, /Advanced statistical analysis/);

assert.match(html, /30[\s\S]*30/);
assert.match(html, /Primary analysis pairs|Primary analysis/);
assert.match(html, /n=30|n = 30/);
assert.match(html, /4\/6/);
assert.match(html, /5\/6/);
assert.match(html, /50\.0%/);
assert.match(html, /Evidence accuracy|Evidence coverage/);

assert.match(html, /role="img"/);
assert.match(html, /aria-label="[^"]*AI[^"]*active time[^"]*accuracy[^"]*"/);
assert.match(html, /Active time \(seconds\)/);
assert.match(html, /Value accuracy/);
assert.match(html, /Manual mode/);
assert.match(html, /AI assisted/);
assert.match(html, /95% CI/);
assert.match(html, /Wilcoxon/);
assert.match(html, /<caption[^>]*>Mode comparison details/);

for (const label of ["Suggestions", "Adopted", "Modified", "Initially incorrect", "Corrected", "Incorrectly adopted"]) {
  assert.match(html, new RegExp(label));
}
assert.match(html, /Paper A/);
assert.match(html, /Paper B/);
assert.match(html, /Manual→AI/);
assert.match(html, /AI→Manual/);
assert.match(html, /Manual \/ AI Accuracy/);
assert.match(html, /Timing quality/);

for (const label of ["Search students", "Paper and mode", "Experiment sequence", "Completion status", "Timing quality"]) {
  assert.match(html, new RegExp(`<label[^>]*>[\\s\\S]*?${label}|${label}`));
}
for (const option of ["A · Manual", "A · AI", "B · Manual", "B · AI"]) {
  assert.match(html, new RegExp(option.replace("·", "[\\s·]*")));
}
assert.match(html, /<caption[^>]*>Participant results/);
assert.match(html, /scope="col"/);
assert.match(html, /aria-label="View student S001  results"/);
assert.match(html, /Manual results/);
assert.match(html, /AI Results/);
assert.match(
  html,
  /<th scope="row"[^>]*>Valid<\/th><td[^>]*>30<\/td><\/tr>/,
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
assert.match(detailHtml, /Page/);
assert.match(detailHtml, /Value assessment/);
assert.match(detailHtml, /Evidence assessment/);
assert.match(detailHtml, /alias_match/);
assert.match(detailHtml, /page_mismatch/);
assert.match(detailHtml, /Previous instructor review/);
assert.match(detailHtml, /final value Correct/);
assert.match(detailHtml, /AI Initial value Incorrect/);
assert.match(detailHtml, /08\/10/);
assert.match(detailHtml, /Completion status[\s\S]*Completed/);
assert.match(detailHtml, /Timing quality[\s\S]*Excessive idle time/);
assert.match(detailHtml, /Exclusion status[\s\S]*Excluded/);
assert.match(detailHtml, /Primary analysis pairing[\s\S]*Not included/);
assert.match(detailHtml, /教师排除备注：重复提交 EXCLUSION_UI_SECRET/);
assert.match(detailHtml, /Active time[\s\S]*100 s/);
assert.match(detailHtml, /Elapsed time[\s\S]*1,200 s/);
assert.doesNotMatch(detailHtml, /<input\b|<select\b|<textarea\b|保存审核|>保存</);

const excludedDashboardHtml = renderToStaticMarkup(
  createElement(TeacherDashboard, {
    initial: { ...dashboard, participants: [excludedParticipant] },
  })
);
assert.match(excludedDashboardHtml, /S999[\s\S]*Excluded/);

const emptyDashboard: TeachingExperimentDashboard = {
  ...dashboard,
  summary: summarizeTeachingExperiment([]),
  diagnostics: summarizeTeachingExperimentDiagnostics([]),
  participants: [],
};
const emptyHtml = renderToStaticMarkup(
  createElement(TeacherDashboard, { initial: emptyDashboard })
);
assert.match(emptyHtml, /Insufficient data/);
assert.match(emptyHtml, />—</);
assert.doesNotMatch(emptyHtml, />0\.0%</);

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
assert.match(source, /colSpan=\{7\}/);

const pageSource = readFileSync("app/teaching/admin/page.tsx", "utf8");
assert.match(pageSource, /getSimpleDashboard/);
assert.match(pageSource, /SimpleTeacherDashboard/);
assert.doesNotMatch(pageSource, /getTeachingAdminDashboard/);

const consoleHtml = renderToStaticMarkup(
  createElement(TeachingAdminConsole, { initial: dashboard })
);
assert.match(consoleHtml, /Teaching lab/);
assert.match(consoleHtml, /Group experiment/);
assert.match(consoleHtml, /Open experiment/);
assert.match(consoleHtml, /Students join with a code/);
assert.match(consoleHtml, /Students join with an alias/);
assert.match(consoleHtml, /Create experiment → Import roster → Students join → View results/);
assert.match(consoleHtml, /aria-pressed="true"/);
assert.match(consoleHtml, />Sign out</);
assert.doesNotMatch(consoleHtml, /默认实验/);
assert.doesNotMatch(consoleHtml, /Manual extraction与 AI assisted提取对比实验/);

console.log("Teaching zero-operation teacher dashboard component tests passed");
