import assert from "node:assert/strict";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import DomainHome from "./page";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const html = renderToStaticMarkup(createElement(DomainHome, { params: { domain: "tribology" } }));

assert.match(html, /TRIBOLOGY WORKSPACE/);
assert.match(html, /Tribology workbench/);
assert.match(html, /Upload papers/);
assert.match(html, /Start extraction/);
assert.match(html, /Database/);
assert.match(html, /Review Queue/);
assert.match(html, /Library/);
assert.match(html, /Needs review/);
assert.match(html, /Official records/);
assert.match(html, /Papers indexed/);
// links are domain-scoped
assert.match(html, /href="\/tribology\/extract"/);
assert.match(html, /href="\/tribology\/database"/);
assert.match(html, /href="\/tribology\/database\?status=review"/);
assert.match(html, /href="\/tribology\/library"/);
// the old oversized hero copy should be gone
assert.doesNotMatch(html, /Add papers\. Get data\./);
assert.doesNotMatch(html, /Start a clean extraction run\./);

console.log("DomainHome refined workbench tests passed");
