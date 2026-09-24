export type FieldReviewStatus =
  | "verified"
  | "reported"
  | "inferred"
  | "legacy-import"
  | "not-reported"
  | "unreviewed";

export type EvidenceSourceKind = "paper" | "figure" | "workbook" | "legacy-dataset" | "system";

export interface FieldEvidence {
  sourceKind: EvidenceSourceKind;
  sourceFile: string | null;
  locator: string | null;
  note: string;
}

export interface CuratedField<T> {
  value: T | null;
  unit: string | null;
  status: FieldReviewStatus;
  confidence: number | null;
  evidence: FieldEvidence[];
}

export interface IonicLiquidIdentityContext {
  name: CuratedField<string>;
  cation: CuratedField<string>;
  anion: CuratedField<string>;
  cationSmiles: CuratedField<string>;
  anionSmiles: CuratedField<string>;
}

export interface InterfaceContext {
  substrate: CuratedField<string>;
  probeMaterial: CuratedField<string>;
  surfaceState: CuratedField<string>;
}

export interface ThermodynamicContext {
  temperature: CuratedField<number>;
  pressure: CuratedField<number>;
  atmosphere: CuratedField<string>;
  waterContent: CuratedField<string>;
}

export interface ElectrochemicalContext {
  electrodePotential: CuratedField<number>;
  potentialReference: CuratedField<string>;
  capacitance: CuratedField<number>;
  electricField: CuratedField<number>;
  relatedMeasurements: RelatedElectrochemicalMeasurement[];
  linkedConductivityRecordIds: string[];
}

export interface RelatedElectrochemicalMeasurement {
  quantity: "capacitance" | "electric-field";
  kind: string;
  value: number;
  unit: string;
  electrodePotentialV: number | null;
  potentialReference: string | null;
  temperatureK: number | null;
  relation: string;
  confidence: number;
  evidence: FieldEvidence[];
}

export interface InterfacialExperimentContext {
  ionicLiquid: IonicLiquidIdentityContext;
  interface: InterfaceContext;
  thermodynamics: ThermodynamicContext;
  electrochemistry: ElectrochemicalContext;
}

export function curatedField<T>(
  value: T | null,
  options: {
    unit?: string | null;
    status?: FieldReviewStatus;
    confidence?: number | null;
    evidence?: FieldEvidence[];
  } = {},
): CuratedField<T> {
  return {
    value,
    unit: options.unit ?? null,
    status: options.status ?? "unreviewed",
    confidence: options.confidence ?? null,
    evidence: options.evidence ?? [],
  };
}

export function isFieldPresent(field: CuratedField<unknown>): boolean {
  return field.value !== null && field.value !== "";
}

export function isFieldVerified(field: CuratedField<unknown>): boolean {
  return field.status === "verified" || field.status === "not-reported";
}
