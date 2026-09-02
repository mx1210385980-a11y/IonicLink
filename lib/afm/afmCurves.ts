import snapshot from "@/data/afm/afm-curves.json";
import curationConfig from "@/data/afm/afm-curation.json";
import paperCandidates from "@/data/afm/afm-paper-candidates.json";
import {
  curatedField,
  isFieldPresent,
  isFieldVerified,
  type CuratedField,
  type FieldEvidence,
  type InterfacialExperimentContext,
  type RelatedElectrochemicalMeasurement,
} from "./interfacialExperiment";

export type AfmCurveCollection = "qualified-new" | "legacy-cleaned";
export type AfmCurveStatus = "source-verified" | "pairing-qualified" | "legacy-unverified";
export type AfmReviewState = "verified" | "partial" | "unreviewed";
export type AfmDigitizationQuality = "complete" | "partial" | "legacy-resampled" | "unreviewed";
export type AfmPaperCandidateStatus = "verified" | "order-suggested" | "order-and-title-suggested" | "unmatched";

export interface AfmPaperCandidate {
  folderKey: string;
  status: AfmPaperCandidateStatus;
  requiresReview: boolean;
  confidence: number;
  mappingRule: string;
  titleTokenOverlap: number;
  reasons: string[];
  candidate: {
    pdfFile: string;
    pdfPath: string;
    title: string | null;
    doi: string | null;
    pageCount: number | null;
    metadataStatus: string;
    metadataError: string | null;
  } | null;
}

export interface AfmCurveSource {
  date: string | null;
  folder: string;
  imageFile: string | null;
  imagePath: string | null;
  workbookFile: string;
  workbookPath: string;
  sheet: string;
  range: string | null;
  pdfFile: string | null;
  pdfPath: string | null;
  doi: string | null;
}

interface AfmCurveSnapshotRecord {
  id: string;
  collection: AfmCurveCollection;
  status: AfmCurveStatus;
  label: string;
  ionicLiquid: string | null;
  cation: string | null;
  anion: string | null;
  potentialV: number | null;
  temperatureK: number | null;
  xUnit: string;
  yUnit: string;
  pointCount: number;
  points: [number, number][];
  source: AfmCurveSource;
  notes: string;
}

export interface AfmAcquisitionContext {
  technique: CuratedField<string>;
  curveBranch: CuratedField<string>;
  instrument: CuratedField<string>;
  scanRate: CuratedField<number | string>;
  scanSize: CuratedField<number | string>;
  springConstant: CuratedField<number>;
  separationUnit: CuratedField<string>;
  forceUnit: CuratedField<string>;
}

export interface AfmLayeringContext {
  layerPositions: CuratedField<number[]>;
  detectedLayerCount: CuratedField<number>;
  innermostLayerThickness: CuratedField<number>;
  medianLayerSpacing: CuratedField<number>;
}

export interface AfmDigitizationReview {
  quality: AfmDigitizationQuality;
  modelEligible: boolean;
  note: string;
}

export interface AfmCurveReview {
  state: AfmReviewState;
  requiredFieldCount: number;
  presentFieldCount: number;
  verifiedFieldCount: number;
  completenessPercent: number;
  verifiedPercent: number;
  missingFields: string[];
  unverifiedFields: string[];
  qualityFlags: string[];
}

export interface AfmCurveRecord extends AfmCurveSnapshotRecord {
  context: InterfacialExperimentContext;
  acquisition: AfmAcquisitionContext;
  layering: AfmLayeringContext;
  digitization: AfmDigitizationReview;
  paperCandidate: AfmPaperCandidate | null;
  review: AfmCurveReview;
}

export interface AfmCurveDataset {
  schemaVersion: number;
  curationSchemaVersion: number;
  generatedAt: string;
  scope: string;
  summary: {
    totalCurves: number;
    qualifiedNewCurves: number;
    legacyCleanedCurves: number;
    sourceVerifiedCurves: number;
    distinctLegacyIonicLiquids: number;
    paperLinkedCurves: number;
    paperSuggestedCurves: number;
    paperSuggestedFolderGroups: number;
    paperUnmatchedCurves: number;
    metadataCompleteCurves: number;
    modelEligibleCurves: number;
    curvesWithLayerPositions: number;
    curvesWithIonicIdentity: number;
    curvesWithPotential: number;
    curvesWithCapacitance: number;
    curvesWithElectricField: number;
    curvesWithRelatedCapacitance: number;
    curvesWithLegacySmiles: number;
  };
  curves: AfmCurveRecord[];
}

type SnapshotDataset = Omit<AfmCurveDataset, "schemaVersion" | "curationSchemaVersion" | "summary" | "curves"> & {
  schemaVersion: number;
  summary: {
    totalCurves: number;
    qualifiedNewCurves: number;
    legacyCleanedCurves: number;
    sourceVerifiedCurves: number;
    distinctLegacyIonicLiquids: number;
  };
  curves: AfmCurveSnapshotRecord[];
};

type VerifiedProfile = {
  paperFile: string;
  substrate: string;
  probeMaterial: string;
  surfaceState: string;
  technique: string;
  instrument: string;
  scanRateHz: number | string | null;
  scanSizeNm: number | string;
  springConstantNPerM: number;
  separationUnit: string;
  forceUnit: string;
  curveBranch: string;
  methodLocator: string;
  axisLocator: string;
  atmosphere?: string;
  waterContent?: string;
};

type CurveOverride = {
  ionicLiquid: string;
  cation: string;
  anion: string;
  temperatureK: number;
  figure: string;
  potentialV?: number;
  potentialReference?: string;
  displayLabel?: string;
  layerRange?: string;
  layerPositionsNm?: number[];
  digitizationQuality?: AfmDigitizationQuality;
  digitizationNote?: string;
  relatedElectrochemistry?: Array<{
    quantity: "capacitance" | "electric-field";
    kind: string;
    value: number;
    unit: string;
    electrodePotentialV: number | null;
    potentialReference: string | null;
    temperatureK: number | null;
    relation: string;
    confidence: number;
    figure: string;
  }>;
};

type CurationConfig = {
  schemaVersion: number;
  requiredReviewFields: string[];
  legacySmiles: {
    cations: Record<string, string>;
    anions: Record<string, string>;
    warning: string;
  };
  verifiedPaperProfiles: Record<string, VerifiedProfile>;
  sourceOverrides: Record<string, Pick<AfmCurveSource, "pdfFile" | "pdfPath" | "doi">>;
  curveOverrides: Record<string, CurveOverride>;
};

type PaperCandidateDataset = {
  records: Array<AfmPaperCandidate & { curveIds: string[]; curveCount: number }>;
};

const rawDataset = snapshot as SnapshotDataset;
const config = curationConfig as CurationConfig;
const candidateDataset = paperCandidates as PaperCandidateDataset;
const candidateByCurveId = new Map(
  candidateDataset.records.flatMap((record) => record.curveIds.map((curveId) => [curveId, record] as const)),
);
const curves = rawDataset.curves.map(enrichCurve);

export const AFM_CURVE_DATASET: AfmCurveDataset = {
  schemaVersion: 3,
  curationSchemaVersion: config.schemaVersion,
  generatedAt: rawDataset.generatedAt,
  scope: rawDataset.scope,
  summary: {
    ...rawDataset.summary,
    sourceVerifiedCurves: curves.filter((curve) => curve.status === "source-verified").length,
    paperLinkedCurves: curves.filter((curve) => Boolean(curve.source.doi)).length,
    paperSuggestedCurves: curves.filter((curve) => curve.paperCandidate?.status.includes("suggested")).length,
    paperSuggestedFolderGroups: candidateDataset.records.filter((record) => record.status.includes("suggested")).length,
    paperUnmatchedCurves: curves.filter((curve) => curve.paperCandidate?.status === "unmatched").length,
    metadataCompleteCurves: curves.filter((curve) => curve.review.state === "verified").length,
    modelEligibleCurves: curves.filter((curve) => curve.digitization.modelEligible).length,
    curvesWithLayerPositions: curves.filter((curve) => isFieldPresent(curve.layering.layerPositions)).length,
    curvesWithIonicIdentity: curves.filter(
      (curve) =>
        isFieldPresent(curve.context.ionicLiquid.name) &&
        isFieldPresent(curve.context.ionicLiquid.cation) &&
        isFieldPresent(curve.context.ionicLiquid.anion),
    ).length,
    curvesWithPotential: curves.filter((curve) => isFieldPresent(curve.context.electrochemistry.electrodePotential)).length,
    curvesWithCapacitance: curves.filter((curve) => isFieldPresent(curve.context.electrochemistry.capacitance)).length,
    curvesWithElectricField: curves.filter((curve) => isFieldPresent(curve.context.electrochemistry.electricField)).length,
    curvesWithRelatedCapacitance: curves.filter((curve) =>
      curve.context.electrochemistry.relatedMeasurements.some((measurement) => measurement.quantity === "capacitance"),
    ).length,
    curvesWithLegacySmiles: curves.filter(
      (curve) =>
        curve.context.ionicLiquid.cationSmiles.status === "legacy-import" &&
        curve.context.ionicLiquid.anionSmiles.status === "legacy-import",
    ).length,
  },
  curves,
};

function enrichCurve(raw: AfmCurveSnapshotRecord): AfmCurveRecord {
  const source = { ...raw.source, ...(config.sourceOverrides[raw.id] ?? {}) };
  const doi = source.doi?.toLowerCase() ?? "";
  const profile = config.verifiedPaperProfiles[doi];
  const paperCandidate = candidateByCurveId.get(raw.id) ?? null;
  const override = config.curveOverrides[raw.id];
  const legacy = raw.collection === "legacy-cleaned";
  const legacyEvidence = evidence("legacy-dataset", raw.source.workbookFile, raw.source.range, "Imported from the old prediction platform and not checked against its source paper.");
  const paperEvidence = profile
    ? evidence("paper", profile.paperFile, profile.methodLocator, "Directly reported in the paper's experimental methods.")
    : null;
  const figureEvidence = profile && override
    ? evidence("figure", source.imageFile ?? profile.paperFile, override.figure, "Read from the verified figure/image mapping.")
    : null;
  const layerEvidence = override?.layerPositionsNm
    ? [
        ...(figureEvidence ? [figureEvidence] : []),
        evidence("workbook", source.workbookFile, override.layerRange ?? null, "Layer positions copied from the dedicated annotation column beside this X/Y curve group."),
      ]
    : [];
  const relatedMeasurements: RelatedElectrochemicalMeasurement[] = (override?.relatedElectrochemistry ?? []).map((measurement) => ({
    quantity: measurement.quantity,
    kind: measurement.kind,
    value: measurement.value,
    unit: measurement.unit,
    electrodePotentialV: measurement.electrodePotentialV,
    potentialReference: measurement.potentialReference,
    temperatureK: measurement.temperatureK,
    relation: measurement.relation,
    confidence: measurement.confidence,
    evidence: [evidence("figure", profile?.paperFile ?? source.pdfFile, measurement.figure, "Approximate value digitized from the paper; this is a related measurement, not a simultaneous AFM condition.")],
  }));

  const identityStatus = override ? "verified" : legacy && raw.ionicLiquid ? "legacy-import" : "unreviewed";
  const identityConfidence = override ? 1 : legacy && raw.ionicLiquid ? 0.6 : null;
  const identityEvidence = override && figureEvidence ? [figureEvidence] : legacy ? [legacyEvidence] : [];
  const ionicLiquid = override?.ionicLiquid ?? raw.ionicLiquid;
  const cation = override?.cation ?? raw.cation;
  const anion = override?.anion ?? raw.anion;
  const cationSmiles = legacy && raw.cation ? config.legacySmiles.cations[raw.cation] ?? null : null;
  const anionSmiles = legacy && raw.anion ? config.legacySmiles.anions[raw.anion] ?? null : null;

  const context: InterfacialExperimentContext = {
    ionicLiquid: {
      name: curatedField(ionicLiquid, { status: identityStatus, confidence: identityConfidence, evidence: identityEvidence }),
      cation: curatedField(cation, { status: identityStatus, confidence: identityConfidence, evidence: identityEvidence }),
      anion: curatedField(anion, { status: identityStatus, confidence: identityConfidence, evidence: identityEvidence }),
      cationSmiles: curatedField(cationSmiles, {
        status: cationSmiles ? "legacy-import" : "unreviewed",
        confidence: cationSmiles ? 0.25 : null,
        evidence: cationSmiles ? [legacyEvidence] : [],
      }),
      anionSmiles: curatedField(anionSmiles, {
        status: anionSmiles ? "legacy-import" : "unreviewed",
        confidence: anionSmiles ? 0.25 : null,
        evidence: anionSmiles ? [legacyEvidence] : [],
      }),
    },
    interface: {
      substrate: curatedField(profile?.substrate ?? null, {
        status: profile ? "verified" : "unreviewed",
        confidence: profile ? 1 : null,
        evidence: paperEvidence ? [paperEvidence] : [],
      }),
      probeMaterial: curatedField(profile?.probeMaterial ?? null, {
        status: profile ? "verified" : "unreviewed",
        confidence: profile ? 1 : null,
        evidence: paperEvidence ? [paperEvidence] : [],
      }),
      surfaceState: curatedField(profile?.surfaceState ?? null, {
        status: profile ? "verified" : "unreviewed",
        confidence: profile ? 1 : null,
        evidence: paperEvidence ? [paperEvidence] : [],
      }),
    },
    thermodynamics: {
      temperature: curatedField(override?.temperatureK ?? raw.temperatureK, {
        unit: "K",
        status: override ? "verified" : legacy && raw.temperatureK !== null ? "legacy-import" : "unreviewed",
        confidence: override ? 1 : legacy && raw.temperatureK !== null ? 0.6 : null,
        evidence: override && figureEvidence ? [figureEvidence] : legacy && raw.temperatureK !== null ? [legacyEvidence] : [],
      }),
      pressure: curatedField<number>(null, { unit: "Pa" }),
      atmosphere: curatedField(profile?.atmosphere ?? null, {
        status: profile?.atmosphere ? "verified" : profile ? "not-reported" : "unreviewed",
        confidence: profile ? 1 : null,
        evidence: paperEvidence ? [paperEvidence] : [],
      }),
      waterContent: curatedField(profile?.waterContent ?? null, {
        status: profile?.waterContent ? "verified" : profile ? "not-reported" : "unreviewed",
        confidence: profile ? 1 : null,
        evidence: paperEvidence ? [paperEvidence] : [],
      }),
    },
    electrochemistry: {
      electrodePotential: curatedField(override?.potentialV ?? raw.potentialV, {
        unit: "V",
        status: override?.potentialV !== undefined ? "verified" : legacy && raw.potentialV !== null ? "legacy-import" : profile ? "not-reported" : "unreviewed",
        confidence: override?.potentialV !== undefined ? 1 : legacy && raw.potentialV !== null ? 0.6 : profile ? 1 : null,
        evidence: override?.potentialV !== undefined && figureEvidence ? [figureEvidence] : legacy && raw.potentialV !== null ? [legacyEvidence] : paperEvidence ? [paperEvidence] : [],
      }),
      potentialReference: curatedField(override?.potentialReference ?? null, {
        status: override?.potentialReference ? "verified" : profile ? "not-reported" : "unreviewed",
        confidence: profile ? 1 : null,
        evidence: override?.potentialReference && figureEvidence ? [figureEvidence] : paperEvidence ? [paperEvidence] : [],
      }),
      capacitance: curatedField<number>(null, {
        unit: "F",
        status: profile ? "not-reported" : "unreviewed",
        confidence: profile ? 1 : null,
        evidence: paperEvidence ? [paperEvidence] : [],
      }),
      electricField: curatedField<number>(null, {
        unit: "V/m",
        status: profile ? "not-reported" : "unreviewed",
        confidence: profile ? 1 : null,
        evidence: paperEvidence ? [paperEvidence] : [],
      }),
      relatedMeasurements,
      linkedConductivityRecordIds: [],
    },
  };

  const acquisition: AfmAcquisitionContext = {
    technique: curatedField(profile?.technique ?? "AFM force curve", {
      status: profile ? "verified" : legacy ? "legacy-import" : "inferred",
      confidence: profile ? 1 : legacy ? 0.6 : 0.75,
      evidence: paperEvidence ? [paperEvidence] : legacy ? [legacyEvidence] : [],
    }),
    curveBranch: curatedField(profile?.curveBranch ?? null, {
      status: profile ? "verified" : "unreviewed",
      confidence: profile ? 0.95 : null,
      evidence: figureEvidence ? [figureEvidence] : [],
    }),
    instrument: curatedField(profile?.instrument ?? null, {
      status: profile ? "verified" : "unreviewed",
      confidence: profile ? 1 : null,
      evidence: paperEvidence ? [paperEvidence] : [],
    }),
    scanRate: curatedField(profile?.scanRateHz ?? null, {
      unit: "Hz",
      status: profile ? (profile.scanRateHz === null ? "not-reported" : "verified") : "unreviewed",
      confidence: profile ? 1 : null,
      evidence: paperEvidence ? [paperEvidence] : [],
    }),
    scanSize: curatedField(profile?.scanSizeNm ?? null, {
      unit: "nm",
      status: profile ? "verified" : "unreviewed",
      confidence: profile ? 1 : null,
      evidence: paperEvidence ? [paperEvidence] : [],
    }),
    springConstant: curatedField(profile?.springConstantNPerM ?? null, {
      unit: "N/m",
      status: profile ? "verified" : "unreviewed",
      confidence: profile ? 1 : null,
      evidence: paperEvidence ? [paperEvidence] : [],
    }),
    separationUnit: curatedField(profile?.separationUnit ?? (legacy ? "nm" : null), {
      status: profile ? "verified" : legacy ? "legacy-import" : "unreviewed",
      confidence: profile ? 1 : legacy ? 0.4 : null,
      evidence: figureEvidence ? [figureEvidence] : legacy ? [legacyEvidence] : [],
    }),
    forceUnit: curatedField(profile?.forceUnit ?? null, {
      status: profile ? "verified" : "unreviewed",
      confidence: profile ? 1 : null,
      evidence: figureEvidence ? [figureEvidence] : [],
    }),
  };

  const layerPositions = override?.layerPositionsNm ?? null;
  const layerStatus = layerPositions ? "verified" : "unreviewed";
  const layerConfidence = layerPositions ? 1 : null;
  const layering: AfmLayeringContext = {
    layerPositions: curatedField(layerPositions, { unit: "nm", status: layerStatus, confidence: layerConfidence, evidence: layerEvidence }),
    detectedLayerCount: curatedField(layerPositions?.length ?? null, { status: layerStatus, confidence: layerConfidence, evidence: layerEvidence }),
    innermostLayerThickness: curatedField(layerPositions?.[0] ?? null, { unit: "nm", status: layerStatus, confidence: layerConfidence, evidence: layerEvidence }),
    medianLayerSpacing: curatedField(layerPositions && layerPositions.length > 1 ? medianSpacing(layerPositions) : null, {
      unit: "nm",
      status: layerStatus,
      confidence: layerConfidence,
      evidence: layerEvidence,
    }),
  };

  const reviewedRaw = { ...raw, source };
  const digitizationQuality: AfmDigitizationQuality = override?.digitizationQuality ?? (profile && override ? "complete" : legacy ? "legacy-resampled" : "unreviewed");
  const review = buildReview(reviewedRaw, context, acquisition, paperCandidate, digitizationQuality, Boolean(profile), Boolean(cationSmiles || anionSmiles));
  const digitization: AfmDigitizationReview = {
    quality: digitizationQuality,
    modelEligible: digitizationQuality === "complete" && review.state === "verified",
    note: override?.digitizationNote ?? (legacy ? "Legacy representative curve was resampled to 50 points and must not be treated as raw digitization." : "Digitization fidelity has not yet been checked against the source figure."),
  };
  const temperatureC = override ? Math.round((override.temperatureK - 273.15) * 100) / 100 : null;
  const label = override?.displayLabel ?? (override && /^-?\d+(?:\.\d+)?$/.test(raw.label.trim()) ? `${override.ionicLiquid} · ${formatTemperatureC(temperatureC)}` : raw.label);

  return {
    ...raw,
    status: profile && source.doi ? "source-verified" : raw.status,
    source,
    label,
    ionicLiquid,
    cation,
    anion,
    potentialV: context.electrochemistry.electrodePotential.value,
    temperatureK: context.thermodynamics.temperature.value,
    xUnit: acquisition.separationUnit.value ?? "unverified",
    yUnit: acquisition.forceUnit.value ?? "unverified",
    context,
    acquisition,
    layering,
    digitization,
    paperCandidate,
    review,
    notes: override?.digitizationNote ? `${raw.notes} ${override.digitizationNote}` : raw.notes,
  };
}

function buildReview(
  raw: AfmCurveSnapshotRecord,
  context: InterfacialExperimentContext,
  acquisition: AfmAcquisitionContext,
  paperCandidate: AfmPaperCandidate | null,
  digitizationQuality: AfmDigitizationQuality,
  paperVerified: boolean,
  hasLegacySmiles: boolean,
): AfmCurveReview {
  const fields: Record<string, CuratedField<unknown>> = {
    ionicLiquid: context.ionicLiquid.name,
    cation: context.ionicLiquid.cation,
    anion: context.ionicLiquid.anion,
    substrate: context.interface.substrate,
    temperature: context.thermodynamics.temperature,
    separationUnit: acquisition.separationUnit,
    forceUnit: acquisition.forceUnit,
    curveBranch: acquisition.curveBranch,
    sourcePaper: curatedField(raw.source.doi, {
      status: paperVerified ? "verified" : "unreviewed",
      confidence: paperVerified ? 1 : null,
      evidence: raw.source.pdfFile ? [evidence("paper", raw.source.pdfFile, null, "Paper identity linked to this curve.")] : [],
    }),
  };
  const required = config.requiredReviewFields;
  const missingFields = required.filter((key) => !isFieldPresent(fields[key]));
  const unverifiedFields = required.filter((key) => isFieldPresent(fields[key]) && !isFieldVerified(fields[key]));
  const presentFieldCount = required.length - missingFields.length;
  const verifiedFieldCount = required.filter((key) => isFieldPresent(fields[key]) && isFieldVerified(fields[key])).length;
  const qualityFlags: string[] = [];
  if (!raw.source.doi) qualityFlags.push("source-paper-not-linked");
  if (paperCandidate?.requiresReview && paperCandidate.candidate) qualityFlags.push("paper-candidate-awaiting-review");
  if (!isFieldPresent(acquisition.separationUnit) || !isFieldPresent(acquisition.forceUnit)) qualityFlags.push("axis-units-need-review");
  if (!isFieldPresent(acquisition.curveBranch)) qualityFlags.push("curve-branch-need-review");
  if (raw.collection === "legacy-cleaned") qualityFlags.push("legacy-endpoint-extrapolation", "legacy-source-provenance-missing");
  if (digitizationQuality === "partial") qualityFlags.push("digitization-incomplete", "exclude-from-modeling");
  if (digitizationQuality === "unreviewed") qualityFlags.push("digitization-fidelity-unreviewed");
  if (hasLegacySmiles) qualityFlags.push("legacy-smiles-need-chemical-validation");
  if (
    !isFieldPresent(context.electrochemistry.electrodePotential) &&
    !isFieldPresent(context.electrochemistry.capacitance) &&
    !isFieldPresent(context.electrochemistry.electricField) &&
    !paperVerified
  ) {
    qualityFlags.push("electrochemical-context-not-curated");
  }
  const state: AfmReviewState = verifiedFieldCount === required.length ? "verified" : presentFieldCount > 0 ? "partial" : "unreviewed";
  return {
    state,
    requiredFieldCount: required.length,
    presentFieldCount,
    verifiedFieldCount,
    completenessPercent: Math.round((presentFieldCount / required.length) * 100),
    verifiedPercent: Math.round((verifiedFieldCount / required.length) * 100),
    missingFields,
    unverifiedFields,
    qualityFlags,
  };
}

function evidence(
  sourceKind: FieldEvidence["sourceKind"],
  sourceFile: string | null,
  locator: string | null,
  note: string,
): FieldEvidence {
  return { sourceKind, sourceFile, locator, note };
}

function formatTemperatureC(value: number | null) {
  return value == null ? "temperature pending" : `${Number(value.toFixed(2))} °C`;
}

function medianSpacing(positions: number[]) {
  const spacings = positions.slice(1).map((value, index) => value - positions[index]).sort((a, b) => a - b);
  const middle = Math.floor(spacings.length / 2);
  const median = spacings.length % 2 ? spacings[middle] : (spacings[middle - 1] + spacings[middle]) / 2;
  return Number(median.toFixed(3));
}

export function validateAfmCurveDataset(dataset: AfmCurveDataset = AFM_CURVE_DATASET) {
  const ids = new Set<string>();
  const errors: string[] = [];

  for (const curve of dataset.curves) {
    if (!curve.id || ids.has(curve.id)) errors.push(`Duplicate or empty curve id: ${curve.id || "<empty>"}`);
    ids.add(curve.id);
    if (curve.points.length !== curve.pointCount) errors.push(`${curve.id}: pointCount does not match points`);
    if (curve.points.some(([x, y]) => !Number.isFinite(x) || !Number.isFinite(y))) errors.push(`${curve.id}: non-finite coordinate`);
    if (curve.review.presentFieldCount > curve.review.requiredFieldCount) errors.push(`${curve.id}: invalid review field counts`);
    if (curve.review.verifiedFieldCount > curve.review.presentFieldCount) errors.push(`${curve.id}: verified fields exceed present fields`);
    if (curve.review.completenessPercent < 0 || curve.review.completenessPercent > 100) errors.push(`${curve.id}: invalid completeness percentage`);
    if (curve.review.verifiedPercent < 0 || curve.review.verifiedPercent > 100) errors.push(`${curve.id}: invalid verified percentage`);
    if (curve.collection === "qualified-new" && !curve.paperCandidate) errors.push(`${curve.id}: qualified curve has no paper mapping record`);
    if (curve.paperCandidate && (curve.paperCandidate.confidence < 0 || curve.paperCandidate.confidence > 1)) errors.push(`${curve.id}: invalid paper candidate confidence`);
    if (curve.paperCandidate?.requiresReview && curve.source.doi) errors.push(`${curve.id}: review-only paper candidate was promoted into verified source`);
    if (curve.digitization.modelEligible && (curve.digitization.quality !== "complete" || curve.review.state !== "verified")) errors.push(`${curve.id}: invalid model eligibility`);
    if (curve.digitization.quality === "partial" && !curve.review.qualityFlags.includes("exclude-from-modeling")) errors.push(`${curve.id}: partial digitization lacks model exclusion flag`);
  }

  const summaryChecks: Array<[string, number, number]> = [
    ["totalCurves", dataset.summary.totalCurves, dataset.curves.length],
    ["qualifiedNewCurves", dataset.summary.qualifiedNewCurves, dataset.curves.filter((curve) => curve.collection === "qualified-new").length],
    ["legacyCleanedCurves", dataset.summary.legacyCleanedCurves, dataset.curves.filter((curve) => curve.collection === "legacy-cleaned").length],
    ["sourceVerifiedCurves", dataset.summary.sourceVerifiedCurves, dataset.curves.filter((curve) => curve.status === "source-verified").length],
    ["paperLinkedCurves", dataset.summary.paperLinkedCurves, dataset.curves.filter((curve) => Boolean(curve.source.doi)).length],
    ["paperSuggestedCurves", dataset.summary.paperSuggestedCurves, dataset.curves.filter((curve) => curve.paperCandidate?.status.includes("suggested")).length],
    ["paperUnmatchedCurves", dataset.summary.paperUnmatchedCurves, dataset.curves.filter((curve) => curve.paperCandidate?.status === "unmatched").length],
    ["metadataCompleteCurves", dataset.summary.metadataCompleteCurves, dataset.curves.filter((curve) => curve.review.state === "verified").length],
    ["modelEligibleCurves", dataset.summary.modelEligibleCurves, dataset.curves.filter((curve) => curve.digitization.modelEligible).length],
    ["curvesWithLayerPositions", dataset.summary.curvesWithLayerPositions, dataset.curves.filter((curve) => isFieldPresent(curve.layering.layerPositions)).length],
    ["curvesWithPotential", dataset.summary.curvesWithPotential, dataset.curves.filter((curve) => isFieldPresent(curve.context.electrochemistry.electrodePotential)).length],
    ["curvesWithCapacitance", dataset.summary.curvesWithCapacitance, dataset.curves.filter((curve) => isFieldPresent(curve.context.electrochemistry.capacitance)).length],
    ["curvesWithElectricField", dataset.summary.curvesWithElectricField, dataset.curves.filter((curve) => isFieldPresent(curve.context.electrochemistry.electricField)).length],
    ["curvesWithRelatedCapacitance", dataset.summary.curvesWithRelatedCapacitance, dataset.curves.filter((curve) => curve.context.electrochemistry.relatedMeasurements.some((measurement) => measurement.quantity === "capacitance")).length],
  ];
  for (const [name, actual, expected] of summaryChecks) if (actual !== expected) errors.push(`Summary ${name} does not match curve array`);

  return { valid: errors.length === 0, errors };
}
