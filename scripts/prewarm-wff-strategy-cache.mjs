#!/usr/bin/env node

const args = new Set(process.argv.slice(2));
const valueArg = (name, fallback) => {
  const prefix = `${name}=`;
  const found = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
};

const WFF_STRATEGY_OPTIONS = {
  triple: {
    meta: ["catboost", "forest", "xgboost", "target-tuned"],
  },
};

const WFF_Q1_VALUES = ["30", "34", "45"];
const WFF_Q2_VALUES = ["70", "84", "90"];

const WFF_MODEL_KNOB_DEFAULTS = {
  catboost_learning_rate: "auto",
  catboost_depth: "auto",
  catboost_l2_leaf_reg: "auto",
  forest_n_estimators: "auto",
  forest_max_depth: "auto",
  forest_max_features: "auto",
  xgboost_learning_rate: "auto",
  xgboost_max_depth: "auto",
  xgboost_reg_lambda: "auto",
};

const WFF_REGION_PARAMETER_DEFAULTS = {
  low_catboost_learning_rate: "0.03",
  low_xgboost_learning_rate: "0.05",
  low_forest_max_depth: "9",
  middle_catboost_learning_rate: "0.58",
  middle_xgboost_learning_rate: "0.90",
  middle_forest_max_depth: "7",
  high_catboost_learning_rate: "0.12",
  high_xgboost_learning_rate: "0.20",
  high_forest_max_depth: "9",
};

const WFF_REGION_PARAMETER_PRESETS = {
  low: [
    { low_catboost_learning_rate: "0.01", low_xgboost_learning_rate: "0.01", low_forest_max_depth: "5" },
    { low_catboost_learning_rate: "0.03", low_xgboost_learning_rate: "0.05", low_forest_max_depth: "9" },
    { low_catboost_learning_rate: "0.12", low_xgboost_learning_rate: "0.20", low_forest_max_depth: "12" },
  ],
  middle: [
    { middle_catboost_learning_rate: "0.12", middle_xgboost_learning_rate: "0.50", middle_forest_max_depth: "3" },
    { middle_catboost_learning_rate: "0.58", middle_xgboost_learning_rate: "0.90", middle_forest_max_depth: "7" },
    { middle_catboost_learning_rate: "0.90", middle_xgboost_learning_rate: "0.99", middle_forest_max_depth: "11" },
  ],
  high: [
    { high_catboost_learning_rate: "0.03", high_xgboost_learning_rate: "0.05", high_forest_max_depth: "5" },
    { high_catboost_learning_rate: "0.12", high_xgboost_learning_rate: "0.20", high_forest_max_depth: "9" },
    { high_catboost_learning_rate: "0.30", high_xgboost_learning_rate: "0.70", high_forest_max_depth: "12" },
  ],
};

const WFF_REGION_PARAMETER_VALUES = Object.fromEntries(
  Object.keys(WFF_REGION_PARAMETER_DEFAULTS).map((key) => [
    key,
    [
      ...new Set(
        Object.values(WFF_REGION_PARAMETER_PRESETS)
          .flat()
          .map((preset) => preset[key])
          .filter(Boolean)
      ),
    ],
  ])
);

function request(strategy, options) {
  return {
    strategy,
    options: {
      ...WFF_MODEL_KNOB_DEFAULTS,
      ...(strategy === "triple" ? WFF_REGION_PARAMETER_DEFAULTS : {}),
      ...options,
    },
  };
}

function baseModelRequests() {
  return [
    request("single", { model: "catboost" }),
    request("single", { model: "forest" }),
    request("single", { model: "xgboost" }),
    ...["catboost+xgboost", "xgboost+forest", "catboost+forest"].flatMap((pair) =>
      ["0", "25", "50", "75", "100"].map((weight) => request("dual", { pair, weight }))
    ),
  ];
}

function smokeTripleRequests() {
  return [
    ...["table-4-5", "smooth", "high-focus"].flatMap((region_profile) =>
      [
        ["34", "84"],
        ["30", "84"],
        ["45", "84"],
        ["34", "70"],
      ].map(([q1, q2]) => request("triple", { base: "catboost+forest+xgboost", meta: "catboost", region_profile, q1, q2 }))
    ),
    ...["forest", "xgboost", "target-tuned"].flatMap((meta) =>
      [
        ["34", "84"],
        ["30", "84"],
        ["45", "84"],
        ["34", "70"],
      ].map(([q1, q2]) => request("triple", { base: "catboost+forest+xgboost", meta, region_profile: "table-4-5", q1, q2 }))
    ),
  ];
}

function quickRequests() {
  return [...baseModelRequests(), ...smokeTripleRequests()];
}

function qPairsForStudentGrid() {
  const fixedQ1 = valueArg("--fixed-q1", "");
  const fixedQ2 = valueArg("--fixed-q2", "");
  if (fixedQ1 || fixedQ2) {
    if (!fixedQ1 || !fixedQ2) throw new Error("--fixed-q1 and --fixed-q2 must be provided together");
    if (Number(fixedQ1) >= Number(fixedQ2)) throw new Error("--fixed-q1 must be lower than --fixed-q2");
    return [[fixedQ1, fixedQ2]];
  }
  return WFF_Q1_VALUES.flatMap((q1) => WFF_Q2_VALUES.filter((q2) => Number(q1) < Number(q2)).map((q2) => [q1, q2]));
}

function regionProfilesForStudentGrid() {
  const fixedRegionProfile = valueArg("--fixed-region-profile", "");
  if (!fixedRegionProfile) return ["table-4-5", "smooth", "high-focus"];
  if (!["table-4-5", "smooth", "high-focus"].includes(fixedRegionProfile)) {
    throw new Error("--fixed-region-profile must be one of table-4-5, smooth, high-focus");
  }
  return [fixedRegionProfile];
}

function presetRegionParameterSets() {
  const sets = [];
  for (const low of WFF_REGION_PARAMETER_PRESETS.low) {
    for (const middle of WFF_REGION_PARAMETER_PRESETS.middle) {
      for (const high of WFF_REGION_PARAMETER_PRESETS.high) {
        sets.push({ ...low, ...middle, ...high });
      }
    }
  }
  return sets;
}

function independentRegionParameterSets() {
  const keys = Object.keys(WFF_REGION_PARAMETER_DEFAULTS);
  return keys.reduce(
    (sets, key) => sets.flatMap((set) => WFF_REGION_PARAMETER_VALUES[key].map((value) => ({ ...set, [key]: value }))),
    [{}]
  );
}

function uniqueRequests(requests) {
  const seen = new Set();
  return requests.filter((item) => {
    const key = JSON.stringify(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function shardRequests(requests) {
  const shardCount = Number(valueArg("--shard-count", "1"));
  const shardIndex = Number(valueArg("--shard-index", "0"));
  if (!Number.isInteger(shardCount) || shardCount < 1) throw new Error("--shard-count must be a positive integer");
  if (!Number.isInteger(shardIndex) || shardIndex < 0 || shardIndex >= shardCount) {
    throw new Error("--shard-index must be an integer from 0 to shard-count - 1");
  }
  if (shardCount === 1) return requests;
  return requests.filter((_, index) => index % shardCount === shardIndex);
}

function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "unknown";
  const totalMinutes = Math.max(0, Math.round(ms / 60000));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days) return `${days}d ${hours}h ${minutes}m`;
  if (hours) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function studentGridRequests() {
  const qPairs = qPairsForStudentGrid();
  const regionProfiles = regionProfilesForStudentGrid();
  const regionParameterSets = args.has("--independent-region-grid") ? independentRegionParameterSets() : presetRegionParameterSets();
  const requests = [...baseModelRequests()];
  for (const meta of WFF_STRATEGY_OPTIONS.triple.meta) {
    for (const region_profile of regionProfiles) {
      for (const [q1, q2] of qPairs) {
        for (const regionParameters of regionParameterSets) {
          requests.push(request("triple", { base: "catboost+forest+xgboost", meta, region_profile, q1, q2, ...regionParameters }));
        }
      }
    }
  }
  return uniqueRequests(requests);
}

async function runOne(serverUrl, item) {
  const response = await fetch(`${serverUrl.replace(/\/$/, "")}/api/wff/model-evaluation`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(item),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  return response.json();
}

async function main() {
  if (args.has("--help") || args.has("-h")) {
    console.log("Usage: node scripts/prewarm-wff-strategy-cache.mjs [--student-grid] [--independent-region-grid] [--fixed-q1=34 --fixed-q2=84] [--fixed-region-profile=table-4-5] [--shard-count=3 --shard-index=0] [--dry-run] [--server-url=http://127.0.0.1:3000] [--concurrency=1]");
    return;
  }
  const requests = shardRequests(args.has("--student-grid") ? studentGridRequests() : quickRequests());
  const dryRun = args.has("--dry-run");
  const serverUrl = valueArg("--server-url", process.env.WFF_PREWARM_SERVER_URL ?? "http://127.0.0.1:3000");
  const concurrency = Math.max(1, Math.min(4, Number(valueArg("--concurrency", process.env.WFF_PREWARM_CONCURRENCY ?? "1")) || 1));
  console.log(`Prewarming ${requests.length} WFF strategy results via ${serverUrl}${args.has("--student-grid") ? " (student grid)" : ""}`);
  if (dryRun) return;

  let index = 0;
  let completed = 0;
  const startedAt = Date.now();
  async function worker() {
    while (index < requests.length) {
      const current = index++;
      const item = requests[current];
      const start = Date.now();
      process.stdout.write(`[${current + 1}/${requests.length}] ${item.strategy} ${JSON.stringify(item.options)} ... `);
      await runOne(serverUrl, item);
      completed++;
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      const totalElapsedMs = Date.now() - startedAt;
      const totalElapsed = (totalElapsedMs / 1000 / 60).toFixed(1);
      const percent = ((completed / requests.length) * 100).toFixed(2);
      const averageSeconds = (totalElapsedMs / completed / 1000).toFixed(1);
      const eta = formatDuration((totalElapsedMs / completed) * (requests.length - completed));
      console.log(`${elapsed}s (${completed}/${requests.length}, ${percent}%, avg ${averageSeconds}s, elapsed ${totalElapsed}m, ETA ${eta})`);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
