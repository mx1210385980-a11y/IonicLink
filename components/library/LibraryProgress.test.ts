import assert from "node:assert/strict";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  LibraryProgress,
  SourceProgressTrack,
  sourceProgressState,
  summarizeSourceProgress,
  type SourceProgressRecord,
} from "./LibraryProgress";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const review = (sourceId?: string, mock = false): SourceProgressRecord => ({
  status: "review",
  sourceId,
  extraction: mock ? { source: "mock" } : { source: "anthropic" },
});
const official = (sourceId?: string): SourceProgressRecord => ({ status: "official", sourceId });

assert.equal(sourceProgressState([]), "empty");
assert.equal(sourceProgressState([review("review")]), "reviewOnly");
assert.equal(sourceProgressState([review("mixed"), official("mixed")]), "mixed");
assert.equal(sourceProgressState([official("official")]), "officialOnly");

const sources = [{ id: "empty" }, { id: "review" }, { id: "mixed" }, { id: "official" }];
const records = [
  review("review", true),
  review("review"),
  review("mixed"),
  official("mixed"),
  official("official"),
  official(),
  official("missing-source"),
];

assert.deepEqual(summarizeSourceProgress(sources, records), {
  sourceTotal: 4,
  withRecords: 3,
  pendingReviewSources: 2,
  publishedSources: 2,
  unlinkedRecords: 2,
  linkedOfficial: 2,
  linkedReview: 3,
  mockLocked: 1,
});

const emptyFirstHtml = renderToStaticMarkup(
  createElement(LibraryProgress, { domain: "tribology", sources, records })
);
assert.match(emptyFirstHtml, /Source pipeline/);
assert.match(emptyFirstHtml, /Indexed/);
assert.match(emptyFirstHtml, />4</);
assert.match(emptyFirstHtml, /With records/);
assert.match(emptyFirstHtml, /Pending review/);
assert.match(emptyFirstHtml, /Published sources/);
assert.match(emptyFirstHtml, /2 without indexed PDF/);
assert.match(emptyFirstHtml, /1 mock locked/);
assert.match(emptyFirstHtml, /href="\/tribology\/extract"/);
assert.match(emptyFirstHtml, /Extract 1 source/);

const reviewNextHtml = renderToStaticMarkup(
  createElement(LibraryProgress, {
    domain: "conductivity",
    sources: [{ id: "review" }],
    records: [review("review")],
  })
);
assert.match(reviewNextHtml, /href="\/conductivity\/database\?status=review"/);
assert.match(reviewNextHtml, /Review 1 record/);

const unlinkedNextHtml = renderToStaticMarkup(
  createElement(LibraryProgress, {
    domain: "diffusion",
    sources: [{ id: "official" }],
    records: [official("official"), official()],
  })
);
assert.match(unlinkedNextHtml, /Resolve source links/);
assert.match(unlinkedNextHtml, /indexed-PDF provenance link/);
assert.match(unlinkedNextHtml, /href="\/diffusion\/database"/);

const officialNextHtml = renderToStaticMarkup(
  createElement(LibraryProgress, {
    domain: "tribology",
    sources: [{ id: "official" }],
    records: [official("official")],
  })
);
assert.match(officialNextHtml, /href="\/tribology\/database\?status=official"/);
assert.match(officialNextHtml, /Open official database/);

const firstSourceHtml = renderToStaticMarkup(
  createElement(LibraryProgress, { domain: "diffusion", sources: [], records: [] })
);
assert.match(firstSourceHtml, /href="\/diffusion\/extract"/);
assert.match(firstSourceHtml, /Index a source/);

const trackStates: Array<[SourceProgressRecord[], string, RegExp]> = [
  [[], "empty", /No records/],
  [[review("review")], "reviewOnly", /1 pending review/],
  [[review("mixed"), official("mixed")], "mixed", /Partially published/],
  [[official("official")], "officialOnly", /Published/],
];
for (const [stateRecords, state, label] of trackStates) {
  const html = renderToStaticMarkup(createElement(SourceProgressTrack, { records: stateRecords }));
  assert.match(html, new RegExp(`data-source-state="${state}"`));
  assert.match(html, label);
  assert.match(html, /Source progress: Indexed to Records to Published/);
}

console.log("Library source progress tests passed");
