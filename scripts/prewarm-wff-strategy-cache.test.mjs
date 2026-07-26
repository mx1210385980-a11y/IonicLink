import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

function dryRun(args) {
  return execFileSync("node", ["scripts/prewarm-wff-strategy-cache.mjs", ...args, "--dry-run"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
}

assert.match(dryRun(["--student-grid"]), /Prewarming 2934 WFF strategy results/);
assert.match(
  dryRun(["--student-grid", "--independent-region-grid", "--fixed-q1=34", "--fixed-q2=84"]),
  /Prewarming 236214 WFF strategy results/
);
assert.match(
  dryRun(["--student-grid", "--independent-region-grid", "--fixed-q1=34", "--fixed-q2=84", "--shard-count=3", "--shard-index=1"]),
  /Prewarming 78738 WFF strategy results/
);
assert.match(
  dryRun(["--student-grid", "--independent-region-grid", "--fixed-q1=34", "--fixed-q2=84", "--fixed-region-profile=table-4-5"]),
  /Prewarming 78750 WFF strategy results/
);

console.log("WFF prewarm shard tests passed");
