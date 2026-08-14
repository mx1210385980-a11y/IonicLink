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
assert.match(source, /按结构搜索/);
assert.doesNotMatch(source, /绘制离子结构，应用后筛选当前数据库/);
assert.doesNotMatch(source, /structure-search-description/);
assert.match(source, /任意离子/);
assert.match(source, /阳离子/);
assert.match(source, /阴离子/);
assert.match(source, /精确结构/);
assert.match(source, /子结构/);
assert.match(source, /相似结构/);
assert.match(source, /应用结构搜索/);
assert.match(source, /正在载入结构编辑器/);

console.log("StructureSearchDialog shell tests passed");
