import assert from "node:assert/strict";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { chooseNextAction, deriveWorkspaceProgress } from "../../lib/workspaceProgress";
import DomainHome from "./page";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

type ProgressInput = Parameters<typeof deriveWorkspaceProgress>[0];

function reviewRecord(kind: "ready" | "incomplete" | "mock", index = 0) {
  return {
    id: `#review-${kind}-${index}`,
    status: "review" as const,
    createdAt: "2026-07-11",
    paper: { title: `Review ${kind}` },
    extraction: kind === "mock" ? { source: "mock" as const } : undefined,
    testComplete: kind === "ready",
  };
}

function quantity(value: number, unit: string) {
  return { raw: `${value} ${unit}`, value, unit, std: value, stdUnit: unit };
}

function tribologyRecord(index: number) {
  return {
    id: `#official-${index}`,
    status: "official" as const,
    createdAt: "2026-07-11",
    paper: { title: `Nano friction ${index}` },
    core: {
      ionicLiquid: { cation: "[BMIM]", anion: "[BF4]" },
      substrate: "mica",
      temperature: quantity(298.15, "K"),
      load: quantity((index + 1) * 1e-8, "N"),
      cof: 0.03 + index * 0.001,
    },
    extended: { scale: "nano" },
    flexible: [],
  };
}

function progressFor(records: any[] = [], jobs: ProgressInput["jobs"] = []) {
  return deriveWorkspaceProgress({
    domain: "tribology",
    records,
    counts: {
      official: records.filter((record) => record.status === "official").length,
      review: records.filter((record) => record.status === "review").length,
    },
    jobs,
    sourceCount: new Set(records.map((record) => record.paper?.title)).size,
    coreCompleteness: (record) => ({
      complete: record.testComplete === true,
      missing: record.testComplete === true ? [] : ["core"],
    }),
  });
}

// Empty workspace: zero model-usable points and an extraction-scoped next step.
const emptyProgress = progressFor();
assert.deepEqual(emptyProgress.review, { ready: 0, incomplete: 0, mockLocked: 0 });
assert.deepEqual(emptyProgress.design, { usable: 0, gate: 8, gap: 8, ready: false });
assert.deepEqual(chooseNextAction(emptyProgress), {
  key: "calibration",
  eyebrow: "No curated evidence yet",
  title: "Start extraction",
  body: "Design has 0 / 8 usable points. Add a paper and curate the first evidence point.",
  href: "/tribology/extract",
  tone: "violet",
});

// Review readiness is mutually exclusive: mock wins before completeness.
const readinessProgress = progressFor([
  reviewRecord("ready"),
  reviewRecord("incomplete"),
  { ...reviewRecord("mock"), testComplete: true },
]);
assert.deepEqual(readinessProgress.review, { ready: 1, incomplete: 1, mockLocked: 1 });
const reviewAction = chooseNextAction(readinessProgress);
assert.equal(reviewAction.key, "ready-review");
assert.equal(reviewAction.href, "/tribology/database?status=review");
assert.match(reviewAction.title, /Approve 1 ready record/);

// A failed job outranks active jobs, done candidates, and ready review records.
const failureProgress = progressFor([reviewRecord("ready")], [
  { status: "error", recordCount: 0 },
  { status: "queued", recordCount: 0 },
  { status: "extracting", recordCount: 0 },
  { status: "done", recordCount: 4 },
  { status: "committed", recordCount: 2 },
]);
assert.deepEqual(failureProgress.jobs, {
  total: 5,
  queued: 1,
  extracting: 1,
  done: 1,
  error: 1,
  committed: 1,
  doneCandidates: 4,
});
const failureAction = chooseNextAction(failureProgress);
assert.equal(failureAction.key, "errors");
assert.equal(failureAction.href, "/tribology/extract");
assert.match(failureAction.title, /Resolve 1 failed job/);

const activeAction = chooseNextAction(
  progressFor([reviewRecord("ready")], [
    { status: "queued", recordCount: 0 },
    { status: "done", recordCount: 2 },
  ])
);
assert.equal(activeAction.key, "active", "active jobs outrank done candidates and review");

const doneAction = chooseNextAction(progressFor([reviewRecord("ready")], [{ status: "done", recordCount: 2 }]));
assert.equal(doneAction.key, "done", "done candidates outrank review");

const incompleteAction = chooseNextAction(progressFor([reviewRecord("incomplete"), reviewRecord("mock")]));
assert.equal(incompleteAction.key, "incomplete-review", "incomplete live records outrank mock-locked records");
assert.equal(incompleteAction.href, "/tribology/database?status=review");

const mockAction = chooseNextAction(progressFor([reviewRecord("mock")]));
assert.equal(mockAction.key, "mock-locked");
assert.equal(mockAction.href, "/tribology/extract");

// The calibration gate uses collapsed, model-usable points rather than raw Checked count.
const calibrationGap = progressFor(Array.from({ length: 3 }, (_, index) => tribologyRecord(index)));
assert.equal(calibrationGap.design.usable, 3);
assert.equal(calibrationGap.design.gap, 5);
assert.equal(calibrationGap.design.ready, false);
const calibrationAction = chooseNextAction(calibrationGap);
assert.equal(calibrationAction.key, "calibration");
assert.equal(calibrationAction.href, "/tribology/extract");
assert.match(calibrationAction.title, /Add 5 model-usable points/);
assert.match(calibrationAction.body, /differ from the raw Checked count/);

const calibrationReady = progressFor(Array.from({ length: 8 }, (_, index) => tribologyRecord(index)));
assert.equal(calibrationReady.design.usable, 8);
assert.equal(calibrationReady.design.gap, 0);
assert.equal(calibrationReady.design.ready, true);
const designAction = chooseNextAction(calibrationReady);
assert.equal(designAction.key, "design-ready");
assert.equal(designAction.href, "/tribology/design");
assert.equal(designAction.title, "Open Design Studio");

// Empty-db render: one prominent next action, scoped shortcuts, and the exact-count workflow rail.
const html = renderToStaticMarkup(createElement(DomainHome, { params: { domain: "tribology" } }));

assert.match(html, /TRIBOLOGY WORKSPACE/);
assert.match(html, /Tribology workbench/);
assert.equal((html.match(/Next action ·/g) ?? []).length, 1);
assert.match(html, /Start extraction/);
assert.match(html, /Upload papers/);
assert.match(html, /Database/);
assert.match(html, /Review Queue/);
assert.match(html, /Library/);
assert.match(html, /Design Studio/);
assert.match(html, /Workflow/);
assert.match(html, /Papers/);
assert.match(html, /Extraction/);
assert.match(html, /Checked/);
assert.doesNotMatch(html, />Official</);
assert.match(html, /0 queued · 0 extracting · 0 done · 0 error · 0 committed/);
assert.match(html, /0 ready · 0 incomplete · 0 mock locked/);
assert.match(html, /0 \/ 8/);

assert.match(html, /href="\/tribology\/extract"/);
assert.match(html, /href="\/tribology\/database"/);
assert.match(html, /href="\/tribology\/database\?status=review"/);
assert.match(html, /href="\/tribology\/database\?status=official"/);
assert.match(html, /href="\/tribology\/library"/);
assert.match(html, /href="\/tribology\/design"/);
assert.doesNotMatch(html, /completion rate|ETA/);
assert.doesNotMatch(html, /Add papers\. Get data\.|Start a clean extraction run\./);

console.log("DomainHome workspace progress tests passed");
