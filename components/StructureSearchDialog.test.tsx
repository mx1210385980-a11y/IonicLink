import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { StructureSearchDialog } from "./StructureSearchDialog";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const closed = renderToStaticMarkup(
  createElement(StructureSearchDialog, {
    open: false,
    value: null,
    onApply: () => {},
    onClose: () => {},
  })
);
assert.equal(closed, "", "the editor and its loading surface stay unmounted while closed");

const openOnServer = renderToStaticMarkup(
  createElement(StructureSearchDialog, {
    open: true,
    value: null,
    onApply: () => {},
    onClose: () => {},
  })
);
assert.equal(openOnServer, "", "the portal mounts only after a browser document is available");

const source = readFileSync(new URL("./StructureSearchDialog.tsx", import.meta.url), "utf8");
assert.match(source, /createPortal/);
assert.match(source, /data-testid="structure-search-dialog"/);
assert.match(source, /role="dialog"/);
assert.match(source, /aria-modal="true"/);
assert.match(source, /Search by structure/);
assert.doesNotMatch(source, /绘制离子结构，应用后筛选当前数据库/);
assert.doesNotMatch(source, /structure-search-description/);
assert.match(source, /Either ion/);
assert.match(source, /Cation/);
assert.match(source, /Anion/);
assert.match(source, /Exact structure/);
assert.match(source, /Substructure/);
assert.match(source, /Similarity/);
assert.match(source, /Apply structure search/);
assert.match(source, /Loading structure editor/);

console.log("StructureSearchDialog shell tests passed");
