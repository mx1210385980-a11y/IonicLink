import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { WorkspacePageFrame } from "./WorkspacePageFrame";
import { SCHOOL_PAGE_TITLE, SCHOOL_PANEL, SCHOOL_WORKSPACE_PAGE } from "./workspaceStyles";
import { TeachingExtractionExperiment, TeachingPredictionExperiment } from "./teaching/TeachingExperimentWorkspace";
import AfmWorkspacePage from "../app/afm/page";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const standard = renderToStaticMarkup(React.createElement(WorkspacePageFrame, { "aria-label": "Existing extractor" }, "Content"));
const school = renderToStaticMarkup(React.createElement(WorkspacePageFrame, { variant: "school", "aria-label": "School workspace" }, "Content"));
assert.match(standard, /max-w-\[1240px\]/, "existing shared extractor width is unchanged");
assert.doesNotMatch(standard, /data-workspace-theme=/, "other domains are not silently rethemed");
assert.match(school, /max-w-\[1264px\]/);
assert.match(school, /data-workspace-theme="school"/);
assert.match(school, /aria-label="School workspace"/);
assert.match(SCHOOL_WORKSPACE_PAGE, /lg:px-16/);
assert.match(SCHOOL_WORKSPACE_PAGE, /lg:pt-14/);
assert.match(SCHOOL_PAGE_TITLE, /lg:text-\[36px\]/);
assert.match(SCHOOL_PANEL, /rounded-xl/);

const home = readFileSync("components/HomePageContent.tsx", "utf8");
assert.match(home, /max-w-\[1264px\]/, "the school variant follows the deployed overview geometry");
assert.match(home, /#00888a/);
const css = readFileSync("app/school-workspace.css", "utf8");
assert.match(css, /--school-accent: #00888a/);
assert.match(css, /--school-border: #dce0e4/);
assert.match(css, /:focus-visible/);
assert.doesNotMatch(css, /!important|(^|\n)\s*(?:body|:root|svg|canvas|img)\s*[{,]/, "the theme cannot override global chrome or scientific graphics");

for (const element of [React.createElement(TeachingExtractionExperiment, { isAdmin: true }), React.createElement(TeachingPredictionExperiment), React.createElement(AfmWorkspacePage)]) {
  const html = renderToStaticMarkup(element);
  assert.match(html, /data-workspace-theme="school"/);
  assert.match(html, /max-w-\[1264px\]/);
  assert.equal((html.match(/<h1\b/g) || []).length, 1);
}
const afm = renderToStaticMarkup(React.createElement(AfmWorkspacePage));
assert.match(afm, /Export/);
assert.match(afm, /Original paper|Curve browser/);
assert.doesNotMatch(afm, /bg-gradient-to-br|blur-3xl/, "AFM presentation chrome follows the quiet white-card style");
const teaching = renderToStaticMarkup(React.createElement(TeachingExtractionExperiment, { isAdmin: true }));
assert.match(teaching, /Create experiment/);
assert.match(teaching, /conductivity \/ electrochemistry/);
assert.doesNotMatch(teaching, /NIST search and import/, "NIST remains an independent project");
console.log("School workspace style alignment, scoping, shared layout and retained teaching/AFM content tests passed");
