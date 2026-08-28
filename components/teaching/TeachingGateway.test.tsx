import assert from "node:assert/strict";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TeachingGateway } from "./TeachingGateway";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const studentHtml = renderToStaticMarkup(
  createElement(TeachingGateway, { initialMode: "student" })
);
const teacherHtml = renderToStaticMarkup(
  createElement(TeachingGateway, { initialMode: "teacher" })
);

assert.equal((studentHtml.match(/<input/g) ?? []).length, 2);
assert.match(studentHtml, /name="studentAlias"/);
assert.match(studentHtml, /required/);
assert.match(studentHtml, /maxLength="80"/);
assert.match(studentHtml, /name="inviteCode"/);
assert.match(studentHtml, /分组实验代码/);
assert.match(studentHtml, /留空则进入默认/);
assert.match(studentHtml, /两轮/);
assert.match(studentHtml, /纯人工.*AI 辅助|AI 辅助.*纯人工/s);
assert.match(studentHtml, /有效时间/);
assert.match(studentHtml, /答案.*修改|修改.*答案/s);
assert.match(studentHtml, /不记录.*逐键|逐键.*不记录/s);
assert.match(studentHtml, /化名|姓名缩写/);
assert.doesNotMatch(studentHtml, /name="groupCode"|name="password"|课程邀请码|组别/);
assert.match(studentHtml, /aria-pressed="true"/);
assert.match(studentHtml, /lang="zh-CN"/);
assert.doesNotMatch(studentHtml, /<main[ >]/);

assert.equal((teacherHtml.match(/<input/g) ?? []).length, 1);
assert.match(teacherHtml, /name="password"/);
assert.doesNotMatch(teacherHtml, /name="studentAlias"|name="inviteCode"|name="groupCode"/);
assert.match(teacherHtml, /教师入口/);
assert.doesNotMatch(teacherHtml, /<main[ >]/);
