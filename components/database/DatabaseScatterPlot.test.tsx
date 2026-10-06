import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DatabaseScatterPlot, type DatabaseScatterPlotProps } from "./DatabaseScatterPlot";

const props: DatabaseScatterPlotProps = {
  records: [{ id: "#001", createdAt: "", status: "official", core: { load: 1e-9, cof: 0.12 }, extended: { method: "AFM", scale: "nano" }, paper: { title: "A measured result" }, flexible: [] }],
  fields: [{ key: "load", label: "Load", unit: "N", numeric: true, getValue: (r) => r.core.load, format: (r) => `${r.core.load} N` }, { key: "cof", label: "COF", numeric: true, getValue: (r) => r.core.cof, format: (r) => `${r.core.cof}` }],
  config: { x: "load", y: "cof", logX: true, logY: false, groupBy: "method" },
  selectedIds: new Set(), compareIds: new Set(), disabled: false,
  onConfigChange: () => {}, onSelectRecords: () => {}, onOpenRecord: () => {}, onToggleCompare: () => {},
};
const html = renderToStaticMarkup(<DatabaseScatterPlot {...props} />);
assert.match(html, /AFM · nano/);
assert.match(html, /1 plotted/);
assert.match(html, /Inspect a plotted record/);
assert.match(html, /aria-label="#001: Load \(N\) 1e-9, COF 0.12/);
assert.match(html, /role="button" tabindex="0"/);
assert.match(html, /Clear point selection/);
assert.doesNotMatch(html, /NaN|Infinity/);
const empty = renderToStaticMarkup(<DatabaseScatterPlot {...props} records={[]} />);
assert.match(empty, /No eligible points/);
const excluded = renderToStaticMarkup(<DatabaseScatterPlot {...props} records={[{ ...props.records[0], core: { load: 0, cof: 0.12 } }]} />);
assert.match(excluded, /Non-positive on log axis: 1/);
console.log("DatabaseScatterPlot tests passed");
