import assert from "node:assert/strict";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  enabledPendingPaperFiles,
  formatPaperFileSize,
  isSupportedPaper,
  mergePendingPaperUploads,
  PaperUploadDialog,
  type PendingPaperUpload,
} from "./PaperUploadDialog";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

function paper(name: string, size: number, lastModified = 1): File {
  return { name, size, lastModified } as File;
}

assert.equal(isSupportedPaper(paper("study.PDF", 1024)), true);
assert.equal(isSupportedPaper(paper("notes.txt", 1024)), true);
assert.equal(isSupportedPaper(paper("figure.png", 1024)), false);
assert.equal(formatPaperFileSize(1600), "2 KB");
assert.equal(formatPaperFileSize(1.6 * 1024 * 1024), "1.6 MB");

const first = paper("paper-a.pdf", 2048, 10);
const second = paper("paper-b.txt", 3072, 20);
const merged = mergePendingPaperUploads([], [first, first, second, paper("cover.jpg", 400, 30)]);
assert.equal(merged.length, 2, "duplicates and unsupported files are not staged");
assert.deepEqual(merged.map((item) => item.file.name), ["paper-a.pdf", "paper-b.txt"]);
assert.deepEqual(enabledPendingPaperFiles([{ ...merged[0], enabled: false }, merged[1]]), [second]);

const items: PendingPaperUpload[] = [merged[0]];
const noop = () => {};
const html = renderToStaticMarkup(
  createElement(PaperUploadDialog, {
    open: true,
    items,
    busy: false,
    onAddFiles: noop,
    onToggle: noop,
    onRemove: noop,
    onCancel: noop,
    onAnalyze: noop,
  })
);

assert.match(html, /role="dialog"/);
assert.match(html, /PDF upload/);
assert.match(html, /Extraction starts only after you click Analyze/);
assert.match(html, /paper-a\.pdf/);
assert.match(html, /Ready/);
assert.match(html, /role="switch" aria-checked="true"/);
assert.match(html, /aria-label="Preview paper-a\.pdf"/);
assert.match(html, /aria-label="Remove paper-a\.pdf"/);
assert.match(html, /data-testid="analyze-papers"/);

const closedHtml = renderToStaticMarkup(
  createElement(PaperUploadDialog, {
    open: false,
    items,
    busy: false,
    onAddFiles: noop,
    onToggle: noop,
    onRemove: noop,
    onCancel: noop,
    onAnalyze: noop,
  })
);
assert.equal(closedHtml, "");
