import assert from "node:assert/strict";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { HomePageContent } from "../components/HomePageContent";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const html = renderToStaticMarkup(createElement(HomePageContent));

assert.match(html, /Data overview/);
assert.equal((html.match(/<h1 /g) ?? []).length, 1);
assert.match(html, /aria-label="All workspace totals"/);
assert.match(html, /href="\/teaching#prediction"/);
assert.match(html, /Prediction of μ/);

for (const [domain, label] of [
  ["tribology", "Tribology"],
  ["conductivity", "Conductivity"],
  ["diffusion", "Diffusion"],
] as const) {
  assert.match(html, new RegExp(`${label} workspace`));
  assert.match(html, new RegExp(`Extract ${label} papers`));
  assert.match(html, new RegExp(`href="/${domain}/extract"`));
  assert.match(html, new RegExp(`href="/${domain}/database"`));
  assert.match(html, new RegExp(`href="/${domain}/database\\?status=review"`));
  assert.match(html, new RegExp(`href="/${domain}/library"`));
}

assert.doesNotMatch(html, />Upload PDF papers</);
assert.doesNotMatch(html, /Start a clean extraction run/);
assert.match(html, /Review/);
assert.match(html, /Checked/);
assert.doesNotMatch(html, />Official</);
assert.match(html, /Papers/);

console.log("Data overview exposes each property workspace and its scoped actions");
