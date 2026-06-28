export type WffStrategy = "single" | "dual" | "triple";

export interface WffStrategyRequest {
  strategy: WffStrategy;
  options: Record<string, string>;
}

export interface WffMetricBlock {
  n: number;
  r2: number | null;
  mae: number | null;
  rmse: number | null;
}

export interface WffPlotPoint {
  split: string;
  index: number;
  row_index: number;
  measured: number;
  predicted: number;
  absolute_error: number;
  source_literature_key?: string;
  source_literature_title?: string;
  cation?: string;
  anion?: string;
  surface?: string;
}

export interface WffStrategyResult {
  strategy: WffStrategy;
  label: string;
  config: Record<string, unknown>;
  metrics: Record<"train" | "test" | "external_literature", WffMetricBlock>;
  points: Record<"train" | "test" | "external_literature", WffPlotPoint[]>;
  best_single?: {
    config: Record<string, unknown>;
    metrics: Record<"train" | "test" | "external_literature", WffMetricBlock>;
  };
  gate_advantage?: {
    test_r2_delta: number;
    external_r2_delta: number;
    balanced_r2_delta: number;
  };
}

export const WFF_BASE_MODEL_KEYS = ["catboost", "forest", "xgboost", "svr", "mlp"] as const;

function modelCombinations(size: number) {
  const result: string[] = [];
  const visit = (start: number, chosen: string[]) => {
    if (chosen.length === size) {
      result.push(chosen.join("+"));
      return;
    }
    for (let index = start; index < WFF_BASE_MODEL_KEYS.length; index += 1) {
      visit(index + 1, [...chosen, WFF_BASE_MODEL_KEYS[index]]);
    }
  };
  visit(0, []);
  return result;
}

const WFF_PAIR_OPTIONS = modelCombinations(2);
const WFF_MULTI_BASE_OPTIONS = modelCombinations(3);

export const WFF_STRATEGY_OPTIONS = {
  single: {
    model: WFF_BASE_MODEL_KEYS,
    complexity: ["compact", "balanced", "deep"],
    rate: ["steady", "normal", "aggressive"],
  },
  dual: {
    pair: WFF_PAIR_OPTIONS,
    weight: ["0", "100"],
    complexity: ["compact", "balanced", "deep"],
  },
  triple: {
    base: WFF_MULTI_BASE_OPTIONS,
    meta: ["catboost", "forest", "xgboost", "target-tuned"],
    region_profile: ["table-4-5", "smooth", "high-focus"],
  },
} as const;

export const WFF_MODEL_KNOB_VALUES: Record<string, readonly string[]> = {
  catboost_learning_rate: ["auto", "0.03", "0.12", "0.58"],
  catboost_depth: ["auto", "3", "5", "7"],
  catboost_l2_leaf_reg: ["auto", "0.5", "3", "10"],
  forest_n_estimators: ["auto", "60", "200", "500"],
  forest_max_depth: ["auto", "7", "9", "12"],
  forest_max_features: ["auto", "0.6", "0.8", "1.0"],
  xgboost_learning_rate: ["auto", "0.05", "0.20", "0.90"],
  xgboost_max_depth: ["auto", "3", "4", "5"],
  xgboost_reg_lambda: ["auto", "1", "7", "10"],
  svr_c: ["auto", "50", "80", "120"],
  svr_gamma: ["auto", "0.03", "0.12", "0.30"],
  mlp_hidden_units: ["auto", "16", "32", "64"],
  mlp_alpha: ["auto", "0.005", "0.10", "0.50"],
};

export const WFF_MODEL_KNOB_DEFAULTS = Object.fromEntries(Object.keys(WFF_MODEL_KNOB_VALUES).map((key) => [key, "auto"])) as Record<string, string>;

export const WFF_REGION_PARAMETER_DEFAULTS: Record<string, string> = {
  low_catboost_learning_rate: "0.03",
  low_xgboost_learning_rate: "0.05",
  low_forest_max_depth: "9",
  low_svr_c: "50",
  low_mlp_hidden_units: "16",
  middle_catboost_learning_rate: "0.58",
  middle_xgboost_learning_rate: "0.90",
  middle_forest_max_depth: "7",
  middle_svr_c: "80",
  middle_mlp_hidden_units: "32",
  high_catboost_learning_rate: "0.12",
  high_xgboost_learning_rate: "0.20",
  high_forest_max_depth: "9",
  high_svr_c: "80",
  high_mlp_hidden_units: "16",
};

export const WFF_REGION_PARAMETER_VALUES: Record<string, readonly string[]> = {
  low_catboost_learning_rate: ["0.01", "0.03", "0.12"],
  middle_catboost_learning_rate: ["0.12", "0.58", "0.90"],
  high_catboost_learning_rate: ["0.03", "0.12", "0.30"],
  low_xgboost_learning_rate: ["0.01", "0.05", "0.20"],
  middle_xgboost_learning_rate: ["0.50", "0.90", "0.99"],
  high_xgboost_learning_rate: ["0.05", "0.20", "0.70"],
  low_forest_max_depth: ["5", "9", "12"],
  middle_forest_max_depth: ["3", "7", "11"],
  high_forest_max_depth: ["5", "9", "12"],
  low_svr_c: ["20", "50", "80"],
  middle_svr_c: ["50", "80", "120"],
  high_svr_c: ["30", "80", "120"],
  low_mlp_hidden_units: ["8", "16", "32"],
  middle_mlp_hidden_units: ["16", "32", "64"],
  high_mlp_hidden_units: ["8", "16", "32"],
};

export const WFF_REGION_PARAMETER_PRESETS = {
  low: [
    { low_catboost_learning_rate: "0.01", low_xgboost_learning_rate: "0.01", low_forest_max_depth: "5", low_svr_c: "20", low_mlp_hidden_units: "8" },
    { low_catboost_learning_rate: "0.03", low_xgboost_learning_rate: "0.05", low_forest_max_depth: "9", low_svr_c: "50", low_mlp_hidden_units: "16" },
    { low_catboost_learning_rate: "0.12", low_xgboost_learning_rate: "0.20", low_forest_max_depth: "12", low_svr_c: "80", low_mlp_hidden_units: "32" },
  ],
  middle: [
    { middle_catboost_learning_rate: "0.12", middle_xgboost_learning_rate: "0.50", middle_forest_max_depth: "3", middle_svr_c: "50", middle_mlp_hidden_units: "16" },
    { middle_catboost_learning_rate: "0.58", middle_xgboost_learning_rate: "0.90", middle_forest_max_depth: "7", middle_svr_c: "80", middle_mlp_hidden_units: "32" },
    { middle_catboost_learning_rate: "0.90", middle_xgboost_learning_rate: "0.99", middle_forest_max_depth: "11", middle_svr_c: "120", middle_mlp_hidden_units: "64" },
  ],
  high: [
    { high_catboost_learning_rate: "0.03", high_xgboost_learning_rate: "0.05", high_forest_max_depth: "5", high_svr_c: "30", high_mlp_hidden_units: "8" },
    { high_catboost_learning_rate: "0.12", high_xgboost_learning_rate: "0.20", high_forest_max_depth: "9", high_svr_c: "80", high_mlp_hidden_units: "16" },
    { high_catboost_learning_rate: "0.30", high_xgboost_learning_rate: "0.70", high_forest_max_depth: "12", high_svr_c: "120", high_mlp_hidden_units: "32" },
  ],
} as const;

export const WFF_Q1_VALUES = ["30", "34", "45"] as const;
export const WFF_Q2_VALUES = ["70", "84", "90"] as const;

export const WFF_STRATEGY_DEFAULTS: Record<WffStrategy, Record<string, string>> = {
  single: { model: "xgboost", complexity: "balanced", rate: "normal" },
  dual: { pair: "catboost+xgboost", weight: "50", complexity: "balanced" },
  triple: { base: "catboost+forest+xgboost", meta: "catboost", region_profile: "table-4-5", q1: "34", q2: "84", ...WFF_REGION_PARAMETER_DEFAULTS },
};

export const WFF_STRATEGY_LABELS: Record<string, string> = {
  single: "Single",
  dual: "Dual",
  triple: "Triple",
  catboost: "CatBoost",
  xgboost: "XGBoost",
  forest: "Random Forest",
  svr: "SVR",
  mlp: "MLP",
  ridge: "Ridge",
  "target-tuned": "Target tuned",
  compact: "Compact",
  balanced: "Balanced",
  deep: "Deep",
  steady: "Steady",
  normal: "Normal",
  aggressive: "Fast",
  "catboost+forest+xgboost": "CatBoost + RF + XGBoost",
  "catboost+xgboost": "CatBoost + XGBoost",
  "xgboost+forest": "XGBoost + RF",
  "catboost+forest": "CatBoost + RF",
  "table-4-5": "Table 4.5",
  smooth: "Smooth",
  "high-focus": "High focus",
};

function snapToAllowedValue(value: number, allowed: readonly string[], fallback: string, digits?: number) {
  if (!Number.isFinite(value)) return fallback;
  const best = allowed.reduce((current, option) =>
    Math.abs(Number(option) - value) < Math.abs(Number(current) - value) ? option : current
  , fallback);
  return digits == null ? best : Number(best).toFixed(digits);
}

export function normalizeStrategyRequest(input: Partial<WffStrategyRequest>): WffStrategyRequest {
  const strategy = input.strategy && input.strategy in WFF_STRATEGY_OPTIONS ? input.strategy : "triple";
  const defaults = WFF_STRATEGY_DEFAULTS[strategy];
  const allowed = WFF_STRATEGY_OPTIONS[strategy] as Record<string, readonly string[]>;
  const options: Record<string, string> = {};
  for (const [name, values] of Object.entries(allowed)) {
    if (strategy === "dual" && name === "weight") continue;
    const requested = input.options?.[name] ?? defaults[name];
    options[name] = values.includes(requested) ? requested : defaults[name];
  }
  if (strategy === "dual") {
    const weight = Number(input.options?.weight ?? defaults.weight);
    const safeWeight = Number.isFinite(weight) ? Math.min(100, Math.max(0, weight)) : Number(defaults.weight);
    options.weight = String(Math.round(safeWeight));
  }
  if (strategy === "triple") {
    const q1 = Number(input.options?.q1 ?? defaults.q1);
    const q2 = Number(input.options?.q2 ?? defaults.q2);
    options.q1 = snapToAllowedValue(q1, WFF_Q1_VALUES, defaults.q1);
    options.q2 = snapToAllowedValue(q2, WFF_Q2_VALUES, defaults.q2);
  }
  for (const [name, values] of Object.entries(WFF_MODEL_KNOB_VALUES)) {
    const requested = input.options?.[name] ?? WFF_MODEL_KNOB_DEFAULTS[name];
    options[name] = values.includes(requested) ? requested : WFF_MODEL_KNOB_DEFAULTS[name];
  }
  if (strategy === "triple") {
    for (const [name, fallback] of Object.entries(WFF_REGION_PARAMETER_DEFAULTS)) {
      const requested = Number(input.options?.[name] ?? fallback);
      const allowed = WFF_REGION_PARAMETER_VALUES[name] ?? [fallback];
      const integerParameter = name.endsWith("_max_depth") || name.endsWith("_svr_c") || name.endsWith("_mlp_hidden_units");
      options[name] = integerParameter
        ? snapToAllowedValue(requested, allowed, fallback)
        : snapToAllowedValue(requested, allowed, fallback, 2);
    }
  }
  return { strategy, options };
}
