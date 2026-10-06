import assert from "node:assert/strict";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FilterBar } from "./FilterBar";
import { EMPTY_FILTERS } from "./recordFilters";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const tribologyHtml = renderToStaticMarkup(
  createElement(FilterBar, {
    domain: "tribology",
    records: [{ core: { ionicLiquid: {}, substrate: "mica" }, extended: {}, flexible: [] }],
    filters: { ...EMPTY_FILTERS, surfaceQuery: "mica" },
    shown: 1,
    onChange: () => {},
  })
);
assert.match(tribologyHtml, /data-testid="substrate-search-filter"/);
assert.match(tribologyHtml, /aria-label="Search substrate"/);
assert.match(tribologyHtml, /type="search"/);
assert.match(tribologyHtml, /value="mica"/);
assert.doesNotMatch(tribologyHtml, /aria-label="Filter by substrate"/);

console.log("FilterBar substrate search tests passed");
