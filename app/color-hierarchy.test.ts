import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import HomePage from "./page";
import DomainHome from "./[domain]/page";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const file = (path: string) => readFileSync(path, "utf8");

const globals = file("app/globals.css");
assert.match(globals, /\.label-eyebrow[\s\S]*text-ink-500/, "shared eyebrow labels should be readable by default");
assert.match(globals, /\.status-mini-muted[\s\S]*text-ink-500/, "muted status labels should not be too pale when actionable");
assert.match(globals, /\.btn[\s\S]*text-ink-800/, "secondary buttons should be readable before hover");

const homeSource = file("app/page.tsx");
assert.match(homeSource, /leading-8 text-ink-700/, "global landing supporting copy should be stronger than gray");
assert.match(homeSource, /text-sm font-semibold text-ink-700/, "workspace secondary links should be readable before hover");
assert.match(homeSource, /label="Review" tone="amber"/, "landing review metric should be amber");
assert.match(homeSource, /label="Official" tone="brand"/, "landing official metric should be brand teal");
assert.match(homeSource, /tone\?: "brand" \| "amber" \| "ink"/, "landing metrics should expose semantic tones");
assert.match(homeSource, /tone === "amber" \? "text-amber-700"/, "landing review count should use amber");
assert.match(homeSource, /Review queue[\s\S]*hover:text-amber-700|hover:text-amber-700[\s\S]*Review queue/, "review links should keep amber semantics");

const domainSource = file("app/[domain]/page.tsx");
assert.match(domainSource, /leading-7 text-ink-700/, "domain tagline should be readable");
assert.match(domainSource, /tone\?: "brand" \| "amber" \| "cyan" \| "violet"/, "domain action cards should expose semantic tones");
assert.match(domainSource, /text-ink-700/, "non-primary action-card body copy should be stronger than gray");

const navSource = file("components/TopNav.tsx");
assert.doesNotMatch(navSource, /text-ink-500 hover:bg-ink-50 hover:text-ink-900/, "domain nav inactive text should no longer be washed out");
assert.doesNotMatch(navSource, /text-ink-500 hover:bg-white\/80 hover:text-ink-900/, "section nav inactive text should no longer be washed out");

const designSource = file("components/design/DesignStudio.tsx") + file("components/design/PredictBench.tsx");
assert.match(designSource, /text-ink-700/, "Design Studio should promote important explanatory copy");
assert.match(designSource, /text-violet-700/, "Design Studio should retain model/result semantic violet");
assert.match(designSource, /text-brand-700/, "Design Studio should retain measured/official semantic teal");
assert.match(designSource, /Friction depends on the full operating point[\s\S]*text-ink-700|text-ink-700[\s\S]*Friction depends on the full operating point/, "Design operating-condition note should be readable");

const dbSource = file("components/DatabaseView.tsx");
assert.match(dbSource, /text-ink-700/, "Database decision copy should include stronger ink");
assert.match(dbSource, /text-amber-700/, "Database review/warning states should keep amber semantics");
assert.match(dbSource, /function Empty[\s\S]*text-ink-700/, "Database actionable empty-state copy should be readable");

const extractorSource = file("components/Extractor.tsx");
assert.match(extractorSource, /text-ink-700/, "Extractor instructions and queue context should be readable");
assert.match(extractorSource, /text-amber-700/, "Extractor active/warning states should keep amber semantics");
assert.match(extractorSource, /queued: "border-amber-200 bg-amber-50 text-amber-700"/, "Extractor queued status should use amber semantics");
assert.match(extractorSource, /— \{s\.reason\}<\/span>[\s\S]*text-ink-700|text-ink-700[\s\S]*— \{s\.reason\}<\/span>/, "Extractor skip reasons should stay readable");

const librarySource = file("app/[domain]/library/page.tsx");
assert.match(librarySource, /text-ink-700/, "Library summaries and empty-state instructions should be readable");
assert.match(librarySource, /panel flex min-w-0 flex-col gap-4 overflow-hidden/, "Library source rows should not overflow on mobile");

const homeHtml = renderToStaticMarkup(createElement(HomePage));
const domainHtml = renderToStaticMarkup(createElement(DomainHome, { params: { domain: "tribology" } }));
assert.match(homeHtml, /Add papers\. Get data\./);
assert.match(domainHtml, /Tribology workbench/);
assert.match(domainHtml, /Review Queue/);

console.log("Global color hierarchy tests passed");
