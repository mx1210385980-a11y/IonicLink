import assert from "node:assert/strict";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { BatchJob } from "../lib/schema";
import { ExtractionWorkspaceView, type ExtractionWorkspaceViewProps } from "./ExtractionWorkspaceView";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const noop = () => {};
const candidate = {
  paper: { title: "Ready paper" },
  core: {
    ionicLiquid: { cation: "", anion: "" },
    substrate: "",
    temperature: null,
    load: null,
    cof: null,
  },
  extended: {},
  flexible: [],
};
const job: BatchJob = {
  id: "ready-job",
  sourceId: "11111111-1111-4111-8111-111111111111",
  filename: "ready-paper.pdf",
  status: "committed",
  createdAt: "2026-08-17T01:00:00.000Z",
  completedAt: "2026-08-17T01:01:00.000Z",
  recordCount: 2,
  candidates: [candidate, candidate],
  model: "kimi-k3",
  error: null,
};
const props: ExtractionWorkspaceViewProps = {
  domain: "tribology",
  jobs: [job],
  pageJobs: [job],
  filteredCount: 1,
  filterCounts: { all: 1, analyzing: 0, finished: 1, error: 0 },
  fileFilter: "all",
  onFilterChange: noop,
  query: "",
  onQueryChange: noop,
  busy: false,
  processing: null,
  over: false,
  onDragStateChange: noop,
  onUploadFiles: noop,
  onRetry: noop,
  onRefresh: noop,
  notices: null,
  committedNotice: null,
  sortDirection: "desc",
  onToggleSort: noop,
  onRemove: noop,
  renderStatus: (status) => status,
  renderFileIcon: () => "PDF",
  currentPage: 1,
  totalPages: 1,
  pageSize: 25,
  onPageChange: noop,
  onPageSizeChange: noop,
};

const html = renderToStaticMarkup(createElement(ExtractionWorkspaceView, props));
const checkedJob = { ...job, checked: true };
const checkedHtml = renderToStaticMarkup(createElement(ExtractionWorkspaceView, {
  ...props, jobs: [checkedJob], pageJobs: [checkedJob],
  renderStatus: (_status, _error, checked) => checked ? "Checked" : "Awaiting review",
}));
assert.match(checkedHtml, />Checked</);
assert.match(checkedHtml, /href="\/tribology\/database\?status=official"/);
assert.match(checkedHtml, /View checked records: ready-paper\.pdf/);
assert.doesNotMatch(checkedHtml, /Open review: ready-paper\.pdf/);
assert.match(html, /ready-paper\.pdf/);
assert.match(html, />2<\/td>/, "the extracted record count remains visible");
assert.doesNotMatch(html, /Commit ready|Commit to review/, "successful extraction requires no manual handoff");
assert.match(html, />Output</);
assert.match(html, />Failed</);
assert.doesNotMatch(html, />Needs attention</);
assert.match(html, /Delete document and all extracted data: ready-paper\.pdf/);
assert.doesNotMatch(html, /aria-label="Expand|aria-label="Collapse/);
assert.doesNotMatch(html, /type="checkbox"/);
assert.doesNotMatch(html, /Review 2|Hide review|job-stage-track/);
assert.doesNotMatch(html, /Extraction status legend/);
assert.doesNotMatch(html, /Live extraction|>More<|Structured dataset|Paste paper text|Queue analytics/);
assert.match(html, /accept="\.pdf,\.txt,\.xlsx,\.csv,\.tsv"/);

console.log("ExtractionWorkspaceView compact row tests passed");

const failed = { ...job, status: "done" as const, error: "Review storage unavailable" };
const failedHtml = renderToStaticMarkup(createElement(ExtractionWorkspaceView, { ...props, jobs: [failed], pageJobs: [failed] }));
assert.match(failedHtml, /Retry review transfer: ready-paper\.pdf/);
assert.match(failedHtml, /Review storage unavailable/);
assert.doesNotMatch(html, /Retry review transfer/);
const extractingFailure = { ...job, status: "error" as const, error: "Provider timeout" };
assert.match(renderToStaticMarkup(createElement(ExtractionWorkspaceView, { ...props, jobs: [extractingFailure], pageJobs: [extractingFailure] })), /Retry extraction: ready-paper\.pdf/);
