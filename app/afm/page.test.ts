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
assert.match(html, />164</);
assert.match(html, /AFM curve digitization/);
assert.match(html, /Digitize curves from papers or figure images/);
assert.match(html, /locates figure pages, separates panels, extracts curves/);
assert.match(html, /manual controls are reserved for low-confidence exceptions/);
assert.match(html, /Source comparison/);
assert.match(html, /PDF · PNG · JPG · WEBP/);
assert.match(html, /Curve browser/);
assert.doesNotMatch(html, /Conductivity · interfacial data asset/);

console.log("AFM top-level workspace tests passed");
