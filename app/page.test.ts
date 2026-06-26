import assert from "node:assert/strict";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import HomePage from "./page";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const html = renderToStaticMarkup(createElement(HomePage));

assert.match(html, /IONICLINK/);
assert.match(html, /IONICLINK EXTRACT/);
assert.match(html, /Add papers\. Get data\./);
assert.match(html, /Upload PDF papers/);
assert.match(html, /Start a clean extraction run/);
assert.match(html, /href="\/tribology\/extract"/);
assert.match(html, /href="\/tribology\/database\?status=review"/);
assert.match(html, /href="\/tribology\/database\?status=official"/);
assert.match(html, /href="\/tribology\/library"/);
assert.match(html, /Needs review/);
assert.match(html, /Official database/);
assert.match(html, /Papers indexed/);
// the global landing still exposes the isolated property workspaces
assert.match(html, /Tribology/);
assert.match(html, /Conductivity/);
assert.match(html, /Diffusion/);
assert.match(html, /href="\/tribology"/);
assert.match(html, /href="\/conductivity"/);
assert.match(html, /href="\/diffusion"/);

console.log("Global landing focused extract tests passed");
