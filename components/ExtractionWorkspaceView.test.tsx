import assert from "node:assert/strict";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { BatchJob, JobStatus } from "../lib/schema";
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
  status: "done",
  createdAt: "2026-08-17T01:00:00.000Z",
  completedAt: "2026-08-17T01:01:00.000Z",
  recordCount: 2,
  candidates: [candidate, candidate],
  model: "kimi-k3",
  error: null,
};
const counts: Record<JobStatus, number> = {
  queued: 0,
  extracting: 0,
  done: 1,
  error: 0,
  committed: 0,
};
const props: ExtractionWorkspaceViewProps = {
  domain: "tribology",
  live: true,
  jobs: [job],
  pageJobs: [job],
  filteredCount: 1,
  counts,
  clearableCount: 1,
  filterCounts: { all: 1, analyzing: 0, finished: 1, error: 0 },
  fileFilter: "all",
  onFilterChange: noop,
  query: "",
  onQueryChange: noop,
  inputMode: null,
  onInputModeChange: noop,
  showInsights: false,
  onToggleInsights: noop,
  busy: false,
  processing: null,
  over: false,
  onDragStateChange: noop,
  onUploadFiles: noop,
  onCommitAll: noop,
  onClearFinished: noop,
  onRefresh: noop,
  text: "",
  onTextChange: noop,
  onSubmitText: noop,
  datasetPanel: null,
  insightsPanel: null,
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
assert.match(html, /ready-paper\.pdf/);
assert.match(html, />2<\/td>/, "the extracted record count remains visible");
assert.match(html, /Commit ready/, "the single bulk handoff remains available");
assert.match(html, /Delete document and all extracted data: ready-paper\.pdf/);
assert.doesNotMatch(html, /aria-label="Expand|aria-label="Collapse/);
assert.doesNotMatch(html, /type="checkbox"/);
assert.doesNotMatch(html, /Review 2|Hide review|job-stage-track/);

console.log("ExtractionWorkspaceView compact row tests passed");
