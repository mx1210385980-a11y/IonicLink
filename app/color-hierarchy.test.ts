import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { HomePageContent } from "../components/HomePageContent";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const file = (path: string) => readFileSync(path, "utf8");

const globals = file("app/globals.css");
assert.match(globals, /\.label-eyebrow[\s\S]*text-ink-500/, "shared eyebrow labels should be readable by default");
assert.match(globals, /\.status-mini-muted[\s\S]*text-ink-500/, "muted status labels should not be too pale when actionable");
assert.match(globals, /\.btn[\s\S]*text-ink-800/, "secondary buttons should be readable before hover");

const homeSource = file("components/HomePageContent.tsx");
assert.match(homeSource, /leading-5 text-ink-700/, "overview supporting copy stays readable");
assert.match(homeSource, /text-\[#00888a\]/, "database actions use the reference teal accent");
assert.match(homeSource, /tone=\{counts.review > 0 \? "amber" : "ink"\}/, "non-empty review queues receive amber emphasis");
assert.match(homeSource, /tone === "amber" \? "text-\[#d98700\]"/, "review numbers retain semantic amber");
assert.match(homeSource, /focus-visible:ring-2/, "overview links have visible keyboard focus");

const navSource = file("components/TopNav.tsx");
assert.doesNotMatch(navSource, /text-ink-500 hover:bg-ink-50 hover:text-ink-900/, "domain nav inactive text should no longer be washed out");
assert.doesNotMatch(navSource, /text-ink-500 hover:bg-white\/80 hover:text-ink-900/, "section nav inactive text should no longer be washed out");

const dbSource = file("components/DatabaseView.tsx");
assert.match(dbSource, /text-ink-700/, "Database decision copy should include stronger ink");
assert.match(dbSource, /text-amber-700/, "Database review/warning states should keep amber semantics");
assert.match(dbSource, /function Empty[\s\S]*text-ink-700/, "Database actionable empty-state copy should be readable");

const extractorSource = file("components/Extractor.tsx");
assert.match(extractorSource, /text-ink-700/, "Extractor instructions and queue context should be readable");
assert.match(extractorSource, /text-amber-700/, "Extractor active/warning states should keep amber semantics");
assert.match(extractorSource, /extracting: "text-amber-700"/, "active extraction retains amber semantics");
assert.match(extractorSource, /— \{s\.reason\}<\/span>[\s\S]*text-ink-700|text-ink-700[\s\S]*— \{s\.reason\}<\/span>/, "Extractor skip reasons should stay readable");

const librarySource = file("app/[domain]/library/page.tsx");
assert.match(librarySource, /text-ink-700/, "Library summaries and empty-state instructions should be readable");
assert.match(librarySource, /panel flex min-w-0 flex-col gap-4 overflow-hidden/, "Library source rows should not overflow on mobile");
assert.match(librarySource, /grid min-w-0 gap-3/, "Unlinked literature groups should constrain grid content on mobile");
assert.match(librarySource, /panel flex w-full min-w-0 flex-wrap/, "Unlinked literature rows should not expand beyond the mobile viewport");

const homeHtml = renderToStaticMarkup(createElement(HomePageContent));
assert.match(homeHtml, /Data overview/);

console.log("Global color hierarchy tests passed");
