import assert from "node:assert/strict";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SkipNotice, type SkippedFile } from "./Extractor";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const noop = () => {};
const one: SkippedFile[] = [
  { filename: "renamed-reupload.pdf", reason: 'already uploaded as "original.pdf" on 2026-06-09 (DOI 10.1021/x)' },
];

const html = renderToStaticMarkup(createElement(SkipNotice, { skipped: one, onDismiss: noop }));
assert.match(html, /role="status"/, "announced politely to assistive tech");
assert.match(html, /data-testid="skip-notice"/);
assert.match(html, /1 file skipped/);
assert.match(html, /renamed-reupload\.pdf/);
assert.match(html, /already uploaded as/);
assert.match(html, /opacity-100/, "renders visible before the countdown elapses");
assert.match(html, /transition-opacity/, "fade-out is a CSS opacity transition");
assert.match(html, /aria-label="Dismiss"/, "manually dismissible");
assert.match(html, /title="renamed-reupload\.pdf — already uploaded as/, "full detail available on hover");

const many: SkippedFile[] = Array.from({ length: 5 }, (_, i) => ({
  filename: `paper-${i}.pdf`,
  reason: "no readable text",
}));
const manyHtml = renderToStaticMarkup(createElement(SkipNotice, { skipped: many, onDismiss: noop }));
assert.match(manyHtml, /5 files skipped/);
assert.match(manyHtml, /paper-2\.pdf/, "first rows listed");
assert.doesNotMatch(manyHtml, /paper-4\.pdf/, "long lists are capped");
assert.match(manyHtml, /\+2 more/, "overflow is summarized");

console.log("Extractor skip-notice tests passed");
