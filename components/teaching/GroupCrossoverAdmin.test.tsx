import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { GroupCrossoverAdmin } from "./GroupCrossoverAdmin";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

// SSR smoke render: effects (data fetching) do not run, so the component shows
// its initial loading state with the usage guidance visible.
const html = renderToStaticMarkup(createElement(GroupCrossoverAdmin));
assert.match(html, /^<section\b/);
assert.match(html, /lang="en-US"/);
assert.match(html, /Group experiment/);
assert.match(html, /Create an experiment, import the roster, and invite students with the experiment code/);
assert.match(html, /Loading experiment…/);
assert.doesNotMatch(html, /<main\b/);
assert.doesNotMatch(html, /默认实验|新建项目|邀请码/);

const source = readFileSync("components/teaching/GroupCrossoverAdmin.tsx", "utf8");

// Guided step flow: create (kept form), roster, results.
assert.match(source, /Step 1/);
assert.match(source, /Step 2/);
assert.match(source, /Step 3/);
assert.match(source, /Student join code/);
assert.match(source, /Copy code/);
assert.match(source, /navigator\.clipboard\.writeText/);

// Group progress and per-group accuracy are merged into one table.
assert.match(source, /Group overview/);
assert.match(source, /diagnostics\.byGroup\[String\(group\.groupNo\)\]/);
assert.doesNotMatch(source, /查看分组统计/);

// Review happens in an accessible modal dialog, not an inline panel.
assert.match(source, /role="dialog"/);
assert.match(source, /aria-modal="true"/);
assert.match(source, /aria-labelledby="group-review-dialog-title"/);
assert.match(source, /event\.key === "Escape"/);
assert.match(source, /Review score adjustment/);

// Roster import and export affordances stay available.
assert.match(source, /Import roster/);
assert.match(source, /Export CSV/);
assert.match(source, /Export anonymized/);
assert.match(source, /parseRosterLines/);

console.log("Group crossover admin component tests passed");
