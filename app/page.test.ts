import assert from "node:assert/strict";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { HomePageContent } from "../components/HomePageContent";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const html = renderToStaticMarkup(createElement(HomePageContent));

assert.match(html, /IONICLINK EXTRACT/);
assert.match(html, /Add papers\. Get data\./);
assert.match(html, /Choose a data workspace/);

for (const [domain, label] of [
  ["tribology", "Tribology"],
  ["conductivity", "Conductivity"],
  ["diffusion", "Diffusion"],
] as const) {
  assert.match(html, new RegExp(`${label} workspace`));
  assert.match(html, new RegExp(`Upload ${label} papers`));
  assert.match(html, new RegExp(`href="/${domain}/extract"`));
  assert.match(html, new RegExp(`href="/${domain}/database"`));
  assert.match(html, new RegExp(`href="/${domain}/database\\?status=review"`));
  assert.match(html, new RegExp(`href="/${domain}/library"`));
}

assert.match(html, /AFM workspace/);
assert.match(html, /Open AFM workspace/);
assert.match(html, /href="\/afm"/);
assert.match(html, /158 Curves/);
assert.match(html, /14 Verified/);
assert.match(html, /13 Model ready/);

assert.doesNotMatch(html, />Upload PDF papers</);
assert.doesNotMatch(html, /Start a clean extraction run/);
assert.match(html, /Review/);
assert.match(html, /Checked/);
assert.doesNotMatch(html, />Official</);
assert.match(html, /Papers/);

console.log("Global landing requires an explicit property workspace");
