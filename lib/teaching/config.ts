import { createHash } from "node:crypto";
import rawConfig from "../../config/teaching/default-experiment.v1.json";
import { TEACHING_FIELDS, type TeachingExperimentConfig } from "../teachingShared";

export const DEFAULT_EXPERIMENT = rawConfig as unknown as TeachingExperimentConfig;

export function validateExperimentConfig(config: TeachingExperimentConfig): string[] {
  const errors: string[] = [];
  if (!config.id.trim()) errors.push("experiment id is required");
  if (config.papers.length !== 2) errors.push("exactly two papers are required");
  const keys = TEACHING_FIELDS.map((field) => field.key);
  for (const paper of config.papers) {
    if (!/^https:\/\//.test(paper.sourceUrl)) errors.push(`paper ${paper.code} requires an HTTPS source URL`);
    if (!paper.taskPrompt.trim()) errors.push(`paper ${paper.code} requires a task prompt`);
    for (const key of keys) {
      if (!paper.aiInitial[key]) errors.push(`paper ${paper.code} is missing AI field ${key}`);
      if (!paper.gold[key]) errors.push(`paper ${paper.code} is missing gold field ${key}`);
    }
  }
  return errors;
}

export function defaultExperimentChecksum(): string {
  return createHash("sha256").update(JSON.stringify(DEFAULT_EXPERIMENT)).digest("hex");
}
