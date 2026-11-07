import {
  MODEL_PREVIEW_STRATEGY_LABELS,
  type ModelPreviewRequest,
} from "@/lib/modelPreview";

export const PREDICTION_MAX_IMAGE_DATA_URL_LENGTH = 2_500_000;
export const PREDICTION_MAX_REFLECTION_LENGTH = 2_000;

export type PredictionParameters = ModelPreviewRequest;

export type PredictionSubmission = {
  id: string;
  userKey: string;
  studentName: string;
  screenshot: string;
  parameters: PredictionParameters;
  reflection: string;
  createdAt: string;
};

export type PredictionSubmissionInput = {
  screenshot: unknown;
  reflection: unknown;
  parameters: unknown;
};

export type PredictionDashboard =
  | { role: "teacher"; submissions: PredictionSubmission[] }
  | { role: "student"; submissions: PredictionSubmission[] };

const PARAMETER_LABELS: Record<string, string> = {
  model: "Base model",
  pair: "Base learners",
  base: "Base learners",
  weight: "Blend weight",
  meta: "Meta model",
  region_profile: "Region profile",
  q1: "Low / middle threshold",
  q2: "Middle / high threshold",
  catboost_learning_rate: "CatBoost learning rate",
  xgboost_learning_rate: "XGBoost learning rate",
  forest_max_depth: "Random Forest maximum depth",
  svr_c: "SVR penalty C",
  mlp_hidden_units: "MLP hidden units",
};

function parameterLabel(key: string): string {
  if (PARAMETER_LABELS[key]) return PARAMETER_LABELS[key];
  const region = /^(low|middle|high)_(.+)$/.exec(key);
  if (region) {
    const regionName = region[1] === "low" ? "Low friction" : region[1] === "middle" ? "Middle friction" : "High friction";
    return `${regionName} · ${PARAMETER_LABELS[region[2]] ?? region[2].replaceAll("_", " ")}`;
  }
  return key.replaceAll("_", " ");
}

function parameterValue(key: string, value: string): string {
  if (key === "weight") {
    const left = Math.max(0, Math.min(100, Number(value) || 0));
    return `${left}% / ${100 - left}%`;
  }
  if (["model", "pair", "base"].includes(key)) {
    return value.split("+").map((item) => MODEL_PREVIEW_STRATEGY_LABELS[item] ?? item).join(" + ");
  }
  return MODEL_PREVIEW_STRATEGY_LABELS[value] ?? value;
}

export function predictionParameterRows(parameters: PredictionParameters): Array<{ key: string; label: string; value: string }> {
  return Object.entries(parameters.options).map(([key, value]) => ({
    key,
    label: parameterLabel(key),
    value: parameterValue(key, value),
  }));
}
