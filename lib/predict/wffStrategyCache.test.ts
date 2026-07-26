import assert from "node:assert/strict";
import path from "node:path";
import { getWffStrategyCacheDir } from "./wffStrategy";

const previous = process.env.WFF_STRATEGY_CACHE_DIR;

delete process.env.WFF_STRATEGY_CACHE_DIR;
assert.equal(getWffStrategyCacheDir("/app"), path.join("/app", "data", "wff-strategy-cache"));

process.env.WFF_STRATEGY_CACHE_DIR = "/srv/ioniclink-cache";
assert.equal(getWffStrategyCacheDir("/app"), "/srv/ioniclink-cache");

if (previous == null) {
  delete process.env.WFF_STRATEGY_CACHE_DIR;
} else {
  process.env.WFF_STRATEGY_CACHE_DIR = previous;
}

console.log("WFF strategy cache path tests passed");
