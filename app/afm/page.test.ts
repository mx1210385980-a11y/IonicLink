import assert from "node:assert/strict";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import AfmWorkspacePage from "./page";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const html = renderToStaticMarkup(createElement(AfmWorkspacePage));

assert.match(html, /AFM · interfacial structure workspace/);
assert.match(html, /AFM solvation-force curves/);
assert.match(html, /independent workspace/);
assert.match(html, /Presentation snapshot/);
assert.match(html, />158</);
assert.match(html, /Curve browser/);
assert.doesNotMatch(html, /Conductivity · interfacial data asset/);

console.log("AFM top-level workspace tests passed");
