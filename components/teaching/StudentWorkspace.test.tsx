import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  buildTeachingHeartbeat,
  buildTeachingSubmitPayload,
  hasTeachingAnswerChanged,
  isTeachingInteractionLocked,
  normalizeTeachingDraftText,
} from "./studentWorkspaceModel";
import { StudentWorkspace } from "./StudentWorkspace";
import {
  TEACHING_FIELDS,
  type TeachingAnswers,
  type TeachingStudentState,
} from "../../lib/teachingShared";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const aiInitial: TeachingAnswers = {
  cation: { value: "EMIM", page: "2", evidence: "[EMIM][TFSI]" },
  anion: { value: "TFSI", page: "2", evidence: "[EMIM][TFSI]" },
  substrate: { value: "mica", page: "14", evidence: "mica surface" },
  temperature: { value: "not reported", page: "", evidence: "not reported" },
  load: { value: "15–75 nN", page: "5", evidence: "15 to 75 nN" },
  cof: { value: "0.04", page: "5", evidence: "mu = 0.04" },
};
const editedAnswers: TeachingAnswers = {
  ...aiInitial,
  load: { value: "5–75 nN", page: "14", evidence: "5 to 75 nN" },
};
const activeBase = {
  status: "active" as const,
  project: {
    id: "teaching-v1",
    name: "人工提取与 AI 辅助提取交叉教学实验",
    fields: TEACHING_FIELDS,
  },
  participant: { studentAlias: "S001" },
  paper: {
    id: "paper-a",
    code: "A" as const,
    title: "Paper A: Ionic liquid friction",
    doi: "10.0000/example-a",
    journal: "Journal of Tribology",
    sourceUrl: "https://example.test/paper-a.pdf",
    taskPrompt: "只提取 Figure 3 中指定体系的数据。",
  },
  totalRounds: 2 as const,
  startedAt: "2026-08-09T00:00:00.000Z",
  activeSeconds: 30,
  version: 3,
};
const manual: TeachingStudentState & {
  gold: string;
  scoringRules: string;
  futureRound: string;
} = {
  ...activeBase,
  roundNo: 1,
  mode: "manual",
  answers: {},
  gold: "CONFIDENTIAL_GOLD_VALUE",
  scoringRules: "CONFIDENTIAL_SCORING_RULE",
  futureRound: "CONFIDENTIAL_FUTURE_ROUND",
};
const assisted: TeachingStudentState & { gold: string; scoringVersion: string } = {
  ...activeBase,
  roundNo: 2,
  mode: "ai_assisted",
  answers: editedAnswers,
  aiInitial,
  gold: "CONFIDENTIAL_AI_GOLD_VALUE",
  scoringVersion: "CONFIDENTIAL_SCORING_VERSION",
};
const complete: TeachingStudentState = {
  status: "complete",
  participant: { studentAlias: "S001" },
  completedAt: "2026-08-09T01:00:00.000Z",
};

const manualHtml = renderToStaticMarkup(createElement(StudentWorkspace, { initial: manual }));
const aiHtml = renderToStaticMarkup(createElement(StudentWorkspace, { initial: assisted }));
const completeHtml = renderToStaticMarkup(createElement(StudentWorkspace, { initial: complete }));

assert.match(manualHtml, /第 1 \/ 2 轮/);
assert.match(manualHtml, /纯人工提取/);
assert.match(manualHtml, /论文 A/);
assert.match(manualHtml, /只提取 Figure 3 中指定体系的数据/);
assert.match(manualHtml, /Paper A: Ionic liquid friction/);
assert.match(manualHtml, /10\.0000\/example-a/);
assert.match(manualHtml, /Journal of Tribology/);
assert.match(manualHtml, /打开论文.*PDF|论文来源.*PDF/s);
assert.match(manualHtml, /DOI 备用链接/);
assert.equal((manualHtml.match(/name="value-/g) ?? []).length, 6);
assert.equal((manualHtml.match(/name="page-/g) ?? []).length, 6);
assert.equal((manualHtml.match(/name="evidence-/g) ?? []).length, 6);
assert.equal((manualHtml.match(/required/g) ?? []).length, 6);
assert.match(manualHtml, /maxLength="500"/);
assert.match(manualHtml, /maxLength="40"/);
assert.match(manualHtml, /maxLength="2000"/);
assert.match(manualHtml, /页码.*证据.*证据覆盖率|证据覆盖率.*页码.*证据/s);
assert.match(manualHtml, /role="progressbar"/);
assert.match(manualHtml, /实验轮次进度[^>]+aria-valuenow="1"/);
assert.match(manualHtml, /有效用时/);
assert.match(manualHtml, /00:00:30/);
assert.doesNotMatch(
  manualHtml,
  /AI|aiInitial|初始建议|建议采纳|未修改|已编辑|已核对全部字段|gold|标准答案|评分/
);
assert.doesNotMatch(manualHtml, /CONFIDENTIAL_/);
assert.doesNotMatch(manualHtml, /<main[ >]/);

assert.match(aiHtml, /第 2 \/ 2 轮/);
assert.match(aiHtml, /AI 辅助提取/);
assert.match(aiHtml, /逐项核对 AI 初始建议/);
assert.match(aiHtml, /未修改/);
assert.match(aiHtml, /已编辑/);
assert.match(aiHtml, /已核对全部字段/);
assert.match(aiHtml, /type="checkbox"/);
assert.match(aiHtml, /<button[^>]+disabled=""[^>]*>提交第 2 轮<\/button>/);
assert.doesNotMatch(aiHtml, /gold|标准答案|评分规则|scoring/i);
assert.doesNotMatch(aiHtml, /CONFIDENTIAL_/);
assert.match(aiHtml, /实验轮次进度[^>]+aria-valuenow="2"/);

assert.match(completeHtml, /两轮实验已完成/);
assert.match(completeHtml, /S001/);
assert.match(completeHtml, /完成时间/);
assert.match(completeHtml, /2026\/8\/9 09:00:00/);
assert.doesNotMatch(completeHtml, /gold|标准答案|正确率|得分|AI 初始建议|scoring/i);
assert.doesNotMatch(completeHtml, /<main[ >]/);

assert.equal(normalizeTeachingDraftText("  ＥＭＩＭ\n salt  "), "emim salt");
assert.equal(
  hasTeachingAnswerChanged(
    { value: " EMIM ", page: "２", evidence: "Ionic\n Liquid" },
    { value: "emim", page: "2", evidence: "ionic liquid" }
  ),
  false
);
assert.equal(
  hasTeachingAnswerChanged(
    { value: "EMIM", page: "3", evidence: "ionic liquid" },
    { value: "EMIM", page: "2", evidence: "ionic liquid" }
  ),
  true
);

const heartbeat = buildTeachingHeartbeat({
  enabled: true,
  visible: true,
  now: 130_000,
  lastActivityAt: 120_000,
  lastHeartbeatAt: 100_000,
  eventId: "hb-round-2",
  roundNo: 2,
  fieldKey: "load",
});
assert.deepEqual(heartbeat, {
  action: "heartbeat",
  eventId: "hb-round-2",
  roundNo: 2,
  clientAt: new Date(130_000).toISOString(),
  activeDeltaSeconds: 15,
  visible: true,
  fieldKey: "load",
});
assert.equal(
  buildTeachingHeartbeat({
    enabled: true,
    visible: false,
    now: 130_000,
    lastActivityAt: 120_000,
    lastHeartbeatAt: 115_000,
    eventId: "hidden",
    roundNo: 1,
  }),
  null
);
assert.equal(
  buildTeachingHeartbeat({
    enabled: true,
    visible: true,
    now: 241_001,
    lastActivityAt: 120_000,
    lastHeartbeatAt: 226_001,
    eventId: "idle",
    roundNo: 1,
  }),
  null
);
assert.equal(
  buildTeachingHeartbeat({
    enabled: false,
    visible: true,
    now: 130_000,
    lastActivityAt: 120_000,
    lastHeartbeatAt: 115_000,
    eventId: "locked",
    roundNo: 1,
  }),
  null
);
assert.deepEqual(buildTeachingSubmitPayload(2, 7), {
  action: "submit",
  roundNo: 2,
  version: 7,
});
assert.equal(isTeachingInteractionLocked(false, false), false);
assert.equal(isTeachingInteractionLocked(true, false), true);
assert.equal(isTeachingInteractionLocked(false, true), true);

const workspaceSource = readFileSync("components/teaching/StudentWorkspace.tsx", "utf8");
assert.match(workspaceSource, /\["pointerdown", "keydown", "input", "scroll", "touchstart"\]/);
assert.match(workspaceSource, /passive: true/);
assert.match(workspaceSource, /15_000/);
assert.match(workspaceSource, /闲置，计时已暂停/);
assert.match(workspaceSource, /setConfirmed\(false\)/);
assert.match(workspaceSource, /submittingRef\.current/);
assert.match(workspaceSource, /window\.location\.reload\(\)/);
