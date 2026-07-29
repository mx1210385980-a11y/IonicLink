import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadWffPaperReport } from "./wffEvaluation.server";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wff-report-"));
const reports = path.join(dir, "reports", "wff");
fs.mkdirSync(reports, { recursive: true });
fs.writeFileSync(
  path.join(reports, "dataset-b-hybrid-metrics.json"),
  JSON.stringify({
    config: { dataset: "dataset-b", model: "gated_hybrid" },
    target_metrics: { test: { r2: 0.991, mae: 0.057, rmse: 0.089 }, external_literature: { r2: 0.985, mae: 0.04, rmse: 0.046 } },
    metrics: { train: { n: 10, r2: 0.95, mae: 0.1, rmse: 0.2 }, test: { n: 7, r2: 0.99, mae: 0.06, rmse: 0.09 }, external_literature: { n: 20, r2: 0.98, mae: 0.04, rmse: 0.05 } },
    deltas: { test: { r2: -0.001, mae: 0.003, rmse: 0.001 }, external_literature: { r2: -0.005, mae: 0, rmse: 0.004 } },
    region_counts: { low: 3, middle: 2, high: 2 },
    tolerances: { r2: 0.01, mae: 0.02, rmse: 0.02 },
    within_tolerance: true,
  }),
  "utf8"
);

const report = loadWffPaperReport(dir);
assert.ok(report);
assert.equal(report.within_tolerance, true);
assert.equal(report.metrics.train.n, 10);
assert.equal(report.metrics.test.n, 7);
assert.equal(loadWffPaperReport(path.join(dir, "missing")), null);

console.log("WFF paper report server tests passed");
