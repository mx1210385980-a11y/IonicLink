import { runWffStrategy } from "../lib/predict/wffStrategy";
import {
  WFF_MODEL_KNOB_DEFAULTS,
  WFF_Q1_VALUES,
  WFF_Q2_VALUES,
  WFF_REGION_PARAMETER_DEFAULTS,
  WFF_REGION_PARAMETER_PRESETS,
  WFF_REGION_PARAMETER_VALUES,
  WFF_STRATEGY_OPTIONS,
  type WffStrategyRequest,
} from "../lib/predict/wffStrategy.shared";

const root = process.cwd();
const argv = process.argv.slice(2);
const args = new Set(argv);
const valueArg = (name: string, fallback: string) => {
  const prefix = `${name}=`;
  const found = argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
};
const useStudentGrid = args.has("--student-grid");
const dryRun = args.has("--dry-run");
const showHelp = args.has("--help") || args.has("-h");

const knobDefaults = { ...WFF_MODEL_KNOB_DEFAULTS };
const regionParameterDefaults = { ...WFF_REGION_PARAMETER_DEFAULTS };

function request(strategy: WffStrategyRequest["strategy"], options: Record<string, string>): WffStrategyRequest {
  return { strategy, options: { ...knobDefaults, ...(strategy === "triple" ? regionParameterDefaults : {}), ...options } };
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
    return [[fixedQ1, fixedQ2] as const];
  }
  return WFF_Q1_VALUES.flatMap((q1) => WFF_Q2_VALUES.filter((q2) => Number(q1) < Number(q2)).map((q2) => [q1, q2] as const));
}

function regionProfilesForStudentGrid() {
  const fixedRegionProfile = valueArg("--fixed-region-profile", "");
  if (!fixedRegionProfile) return WFF_STRATEGY_OPTIONS.triple.region_profile;
  const profiles = WFF_STRATEGY_OPTIONS.triple.region_profile;
  if (!(profiles as readonly string[]).includes(fixedRegionProfile)) {
    throw new Error("--fixed-region-profile must be one of table-4-5, smooth, high-focus");
  }
  return [fixedRegionProfile as (typeof profiles)[number]] as const;
}

function presetRegionParameterSets() {
  const sets: Record<string, string>[] = [];
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
  return Object.keys(WFF_REGION_PARAMETER_DEFAULTS).reduce<Record<string, string>[]>(
    (sets, key) => sets.flatMap((set) => (WFF_REGION_PARAMETER_VALUES[key] ?? []).map((value) => ({ ...set, [key]: value }))),
    [{}]
  );
}

function uniqueRequests(requests: WffStrategyRequest[]) {
  const seen = new Set<string>();
  return requests.filter((item) => {
    const key = JSON.stringify(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function shardRequests(requests: WffStrategyRequest[]) {
  const shardCount = Number(valueArg("--shard-count", "1"));
  const shardIndex = Number(valueArg("--shard-index", "0"));
  if (!Number.isInteger(shardCount) || shardCount < 1) throw new Error("--shard-count must be a positive integer");
  if (!Number.isInteger(shardIndex) || shardIndex < 0 || shardIndex >= shardCount) {
    throw new Error("--shard-index must be an integer from 0 to shard-count - 1");
  }
  if (shardCount === 1) return requests;
  return requests.filter((_, index) => index % shardCount === shardIndex);
}

function formatDuration(ms: number) {
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

const requests: WffStrategyRequest[] = shardRequests(useStudentGrid ? studentGridRequests() : quickRequests());

async function main() {
  if (showHelp) {
    console.log("Usage: tsx scripts/prewarm-wff-strategy-cache.ts [--student-grid] [--independent-region-grid] [--fixed-q1=34 --fixed-q2=84] [--fixed-region-profile=table-4-5] [--shard-count=3 --shard-index=0] [--dry-run]");
    console.log("  default         Prewarm a compact smoke grid.");
    console.log("  --student-grid  Prewarm the finite classroom grid used by the sliders.");
    console.log("  --independent-region-grid  Prewarm all 9 region parameters independently.");
    console.log("  --fixed-q1/--fixed-q2      Use a single q1/q2 pair.");
    console.log("  --fixed-region-profile     Use a single region split profile.");
    console.log("  --shard-count/--shard-index Split work between machines.");
    console.log("  --dry-run       Print request count without training.");
    return;
  }
  console.log(`Prewarming ${requests.length} WFF strategy results into .cache/wff-model-evaluation${useStudentGrid ? " (student grid)" : ""}`);
  if (dryRun) return;
  let completed = 0;
  const startedAt = Date.now();
  for (const [index, item] of requests.entries()) {
    const label = `${item.strategy} ${JSON.stringify(item.options)}`;
    process.stdout.write(`[${index + 1}/${requests.length}] ${label} ... `);
    const start = Date.now();
    await runWffStrategy(item, root);
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

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
