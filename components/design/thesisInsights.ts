export const THESIS_DATASETS = {
  datasetA: 256,
  datasetB: 212,
  lowMax: 0.1,
  highMin: 1.06,
} as const;

export type FrictionRegime = "low" | "middle" | "high";

export interface RegimeInsight {
  regime: FrictionRegime;
  label: string;
  range: string;
  rationale: string;
}

export function frictionRegimeInsight(mu: number | null | undefined): RegimeInsight | null {
  if (mu == null || !Number.isFinite(mu) || mu <= 0) return null;
  if (mu < THESIS_DATASETS.lowMax) {
    return {
      regime: "low",
      label: "low-friction",
      range: `mu < ${THESIS_DATASETS.lowMax.toFixed(2)}`,
      rationale:
        "surface energy/contact angle, film state and ion hydrophobicity carry the paper's strongest SHAP signal in this zone.",
    };
  }
  if (mu < THESIS_DATASETS.highMin) {
    return {
      regime: "middle",
      label: "mid-friction",
      range: `${THESIS_DATASETS.lowMax.toFixed(2)} <= mu < ${THESIS_DATASETS.highMin.toFixed(2)}`,
      rationale:
        "film thickness h, cation logP, surface class, cation mass, IL fraction and sliding speed jointly shape this zone.",
    };
  }
  return {
    regime: "high",
    label: "high-friction",
    range: `mu >= ${THESIS_DATASETS.highMin.toFixed(2)}`,
    rationale:
      "film thickness h and sliding speed dominate; cation size, surface class and hydrophobicity add secondary risk.",
  };
}
