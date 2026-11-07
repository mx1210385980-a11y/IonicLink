import {
  MODEL_PREVIEW_MODEL_KNOB_VALUES,
  MODEL_PREVIEW_REGION_PARAMETER_DEFAULTS,
  type ModelPreviewStrategy,
} from "@/lib/modelPreview";
import {
  PREDICTION_MAX_IMAGE_DATA_URL_LENGTH,
  PREDICTION_MAX_REFLECTION_LENGTH,
  type PredictionParameters,
  type PredictionSubmissionInput,
} from "./predictionShared";

const STRATEGIES = new Set<ModelPreviewStrategy>(["single", "dual", "triple"]);
const PARAMETER_KEYS = new Set([
  "model", "pair", "base", "weight", "meta", "region_profile", "q1", "q2",
  ...Object.keys(MODEL_PREVIEW_REGION_PARAMETER_DEFAULTS),
  ...Object.keys(MODEL_PREVIEW_MODEL_KNOB_VALUES),
]);

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_END = Buffer.from([0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);

function validatePngDataUrl(value: unknown): string {
  if (typeof value !== "string" || value.length > PREDICTION_MAX_IMAGE_DATA_URL_LENGTH) {
    throw new Error("Screenshot must be a PNG data URL smaller than 1.9 MB.");
  }
  const match = /^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match || match[1].length % 4 !== 0) throw new Error("Screenshot must be a valid PNG data URL.");
  const bytes = Buffer.from(match[1], "base64");
  if (bytes.length < 45 || bytes.toString("base64") !== match[1]) throw new Error("Screenshot must be a valid PNG data URL.");
  if (!bytes.subarray(0, 8).equals(PNG_SIGNATURE) || bytes.toString("ascii", 12, 16) !== "IHDR") {
    throw new Error("Screenshot must be a valid PNG image.");
  }
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  if (!width || !height || width > 4096 || height > 4096 || !bytes.subarray(-8).equals(PNG_END)) {
    throw new Error("Screenshot has invalid PNG dimensions or an incomplete image.");
  }
  return value;
}

function validateParameters(value: unknown): PredictionParameters {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid model parameters.");
  const input = value as { strategy?: unknown; options?: unknown };
  if (typeof input.strategy !== "string" || !STRATEGIES.has(input.strategy as ModelPreviewStrategy)) {
    throw new Error("Invalid model strategy.");
  }
  if (!input.options || typeof input.options !== "object" || Array.isArray(input.options)) {
    throw new Error("Invalid model parameter values.");
  }
  const entries = Object.entries(input.options);
  if (!entries.length || entries.length > 64) throw new Error("Invalid model parameter count.");
  const options: Record<string, string> = {};
  for (const [key, option] of entries) {
    if (!PARAMETER_KEYS.has(key) || typeof option !== "string" || !option || option.length > 64) {
      throw new Error(`Invalid model parameter: ${key.slice(0, 80)}`);
    }
    options[key] = option;
  }
  const requiredKey = input.strategy === "single" ? "model" : input.strategy === "dual" ? "pair" : "base";
  if (!options[requiredKey]) throw new Error(`Missing model parameter: ${requiredKey}`);
  if (input.strategy === "dual" && (!/^\d{1,3}$/.test(options.weight ?? "") || Number(options.weight) > 100)) {
    throw new Error("Invalid blend weight.");
  }
  return { strategy: input.strategy as ModelPreviewStrategy, options };
}

export function validatePredictionSubmission(input: PredictionSubmissionInput): {
  screenshot: string;
  reflection: string;
  parameters: PredictionParameters;
} {
  if (typeof input.reflection !== "string" || !input.reflection.trim() || input.reflection.trim().length > PREDICTION_MAX_REFLECTION_LENGTH) {
    throw new Error(`Reflection is required and must be at most ${PREDICTION_MAX_REFLECTION_LENGTH} characters.`);
  }
  return {
    screenshot: validatePngDataUrl(input.screenshot),
    reflection: input.reflection.trim(),
    parameters: validateParameters(input.parameters),
  };
}
