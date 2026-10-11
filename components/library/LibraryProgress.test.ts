import assert from "node:assert/strict";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  SourceProgressTrack,
  sourceProgressState,
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
