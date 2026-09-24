import snapshot from "@/data/afm/afm-curves.json";
import curationConfig from "@/data/afm/afm-curation.json";
import figureLinks from "@/data/afm/afm-figure-links.json";
import redigitizedSeries from "@/data/afm/afm-redigitized-series.json";
import autoImportedSeries from "@/data/afm/afm-auto-imported-series.json";
import legacySourceAudit from "@/data/afm/legacy-afm-source-audit.json";
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
  rawRowNumbers?: number[];
  rawReplicateCount?: number;
  figure?: {
    label: string;
    pdfPage: number;
    mappingStatus: "verified" | "inferred";
  } | null;
  /** Fractional crop selecting this curve's individual panel in a shared source figure. */
  imageCrop?: { left: number; top: number; right: number; bottom: number } | null;
  /** Browser-local preview retained for pending digitization drafts only. */
  previewImageDataUrl?: string | null;
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
  /** Optional zero-based indices where disconnected digitized segments begin. */
  segmentStarts?: number[];
  source: AfmCurveSource;
  notes: string;
}

export interface AfmAcquisitionContext {
  technique: CuratedField<string>;
  curveBranch: CuratedField<string>;
  instrument: CuratedField<string>;
  scanRate: CuratedField<number | string>;
  scanSize: CuratedField<number | string>;
  springConstant: CuratedField<number | string>;
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
  springConstantNPerM: number | string;
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
  /** Null means the source paper was checked and did not report a temperature. */
  temperatureK: number | null;
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

type VerifiedFigureSystem = {
  ionicLiquid: string;
  cation: string;
  anion: string;
  substrate: string;
  evidence: string;
};

type VerifiedCurveSystem = {
  curveIds: string[];
  ionicLiquid: string;
  cation: string;
  anion: string;
  substrate: string;
  pdfFile: string;
  pdfPath: string;
  doi: string;
  figureLocator: string;
  note: string;
};

type CurationConfig = {
  schemaVersion: number;
  requiredReviewFields: string[];
  legacySmiles: {
    cations: Record<string, string>;
    anions: Record<string, string>;
    warning: string;
  };
  verifiedFigureSystems: Record<string, VerifiedFigureSystem>;
  verifiedCurveSystems: VerifiedCurveSystem[];
  verifiedPaperProfiles: Record<string, VerifiedProfile>;
  sourceOverrides: Record<string, Pick<AfmCurveSource, "pdfFile" | "pdfPath" | "doi">>;
  curveOverrides: Record<string, CurveOverride>;
};

type PaperCandidateDataset = {
  records: Array<AfmPaperCandidate & { curveIds: string[]; curveCount: number }>;
};

type AfmFigureLink = {
  curveId: string;
  imageFile: string;
  imagePath: string;
  pdfFile: string;
  pdfPath: string;
  doi: string;
  pdfPage: number;
  figureLabel: string;
  displayLabel: string;
  potentialV: number | null;
  potentialReference: string;
  xUnit: string;
  yUnit: string;
  imageCrop?: { left: number; top: number; right: number; bottom: number };
  status: "verified";
};

type AfmFigureLinkDataset = {
  schemaVersion: number;
  records: AfmFigureLink[];
};

type AfmRedigitizedSeriesDataset = {
  records: Array<{
    curveId: string;
    sourceCrop: { left: number; top: number; right: number; bottom: number };
    points: [number, number][];
    segmentStarts: number[];
  }>;
};

type LegacySourceAuditRecord = {
  curveId: string;
  sourceCsv: {
    file: string;
    path: string;
    rows: number[];
    replicateCount: number;
  };
  rawCurves: {
    pointCounts: number[];
    allCoordinateLengthsMatch: boolean;
  };
  legacySmiles: {
    cationCandidates: string[];
    anionCandidates: string[];
    status: "legacy-unverified";
    warning: string;
  };
};

type LegacySourceAuditDataset = {
  records: LegacySourceAuditRecord[];
};

type AutoImportedAfmDataset = {
  schemaVersion: number;
  generatedAt: string;
  records: Array<{
    curve: AfmCurveSnapshotRecord;
    profile: VerifiedProfile;
    system: VerifiedCurveSystem;
    override: CurveOverride;
    figureLink: AfmFigureLink;
  }>;
};

const rawDataset = snapshot as SnapshotDataset;
const config = curationConfig as CurationConfig;
const autoImportedDataset = autoImportedSeries as unknown as AutoImportedAfmDataset;
const autoImportedByCurveId = new Map(autoImportedDataset.records.map((record) => [record.curve.id, record] as const));
const candidateDataset = paperCandidates as PaperCandidateDataset;
const figureLinkDataset = figureLinks as AfmFigureLinkDataset;
const figureLinkByCurveId = new Map([
  ...figureLinkDataset.records.map((record) => [record.curveId, record] as const),
  ...autoImportedDataset.records.map((record) => [record.curve.id, record.figureLink] as const),
]);
const redigitizedByCurveId = new Map(
  (redigitizedSeries as unknown as AfmRedigitizedSeriesDataset).records.map((record) => [record.curveId, record] as const),
);
const legacyAuditDataset = legacySourceAudit as LegacySourceAuditDataset;
const legacyAuditByCurveId = new Map(legacyAuditDataset.records.map((record) => [record.curveId, record] as const));
const verifiedSystemByCurveId = new Map(
  [
    ...config.verifiedCurveSystems,
    ...autoImportedDataset.records.map((record) => record.system),
  ].flatMap((system) => system.curveIds.map((curveId) => [curveId, system] as const)),
);
const candidateByCurveId = new Map(
  candidateDataset.records.flatMap((record) => record.curveIds.map((curveId) => [curveId, record] as const)),
);
const curves = [...rawDataset.curves, ...autoImportedDataset.records.map((record) => record.curve)].map(enrichCurve);

export const AFM_CURVE_DATASET: AfmCurveDataset = {
  schemaVersion: 4,
  curationSchemaVersion: config.schemaVersion,
  generatedAt: rawDataset.generatedAt,
  scope: rawDataset.scope,
  summary: {
    ...rawDataset.summary,
    totalCurves: curves.length,
    qualifiedNewCurves: curves.filter((curve) => curve.collection === "qualified-new").length,
    legacyCleanedCurves: curves.filter((curve) => curve.collection === "legacy-cleaned").length,
    sourceVerifiedCurves: curves.filter((curve) => curve.status === "source-verified").length,
    paperLinkedCurves: curves.filter((curve) => Boolean(curve.source.doi)).length,
    paperSuggestedCurves: curves.filter((curve) => curve.paperCandidate?.status.includes("suggested")).length,
    paperSuggestedFolderGroups: new Set(
      curves.filter((curve) => curve.paperCandidate?.status.includes("suggested")).map((curve) => curve.paperCandidate!.folderKey),
    ).size,
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
  const autoImported = autoImportedByCurveId.get(raw.id) ?? null;
  const figureLink = figureLinkByCurveId.get(raw.id) ?? null;
  const redigitized = redigitizedByCurveId.get(raw.id) ?? null;
  const legacy = raw.collection === "legacy-cleaned";
  const legacyAudit = legacyAuditByCurveId.get(raw.id) ?? null;
  const verifiedSystem = verifiedSystemByCurveId.get(raw.id);
  const source = {
    ...raw.source,
    ...(legacyAudit ? {
      workbookFile: legacyAudit.sourceCsv.file,
      workbookPath: legacyAudit.sourceCsv.path,
      sheet: "CSV",
      range: `rows ${legacyAudit.sourceCsv.rows.join(", ")}`,
      rawRowNumbers: legacyAudit.sourceCsv.rows,
      rawReplicateCount: legacyAudit.sourceCsv.replicateCount,
    } : {}),
    ...(config.sourceOverrides[raw.id] ?? {}),
    ...(verifiedSystem ? {
      pdfFile: verifiedSystem.pdfFile,
      pdfPath: verifiedSystem.pdfPath,
      doi: verifiedSystem.doi,
    } : {}),
    ...(figureLink ? {
      imageFile: figureLink.imageFile,
      imagePath: figureLink.imagePath,
      pdfFile: figureLink.pdfFile,
      pdfPath: figureLink.pdfPath,
      doi: figureLink.doi,
      figure: { label: figureLink.figureLabel, pdfPage: figureLink.pdfPage, mappingStatus: figureLink.status },
      imageCrop: figureLink.imageCrop ?? redigitized?.sourceCrop ?? null,
    } : { figure: raw.source.figure ?? null }),
  };
  const doi = source.doi?.toLowerCase() ?? "";
  const profile = autoImported?.profile ?? config.verifiedPaperProfiles[doi];
  const figureSystem = figureLink ? config.verifiedFigureSystems[doi] : undefined;
  const mappedCandidate = candidateByCurveId.get(raw.id) ?? null;
  const paperCandidate: AfmPaperCandidate | null = figureLink
    ? {
        folderKey: mappedCandidate?.folderKey ?? `${source.date}/${source.folder}`,
        status: "verified",
        requiresReview: false,
        confidence: 1,
        mappingRule: "human-confirmed-pdf-figure-workbook-order",
        titleTokenOverlap: mappedCandidate?.titleTokenOverlap ?? 0,
        reasons: ["The source PDF, cropped figures and workbook curve order were confirmed together."],
        candidate: {
          pdfFile: figureLink.pdfFile,
          pdfPath: figureLink.pdfPath,
          title: mappedCandidate?.candidate?.title ?? null,
          doi: figureLink.doi,
          pageCount: mappedCandidate?.candidate?.pageCount ?? null,
          metadataStatus: "verified",
          metadataError: null,
        },
      }
    : verifiedSystem
      ? {
          folderKey: mappedCandidate?.folderKey ?? `${source.date}/${source.folder}`,
          status: "verified",
          requiresReview: false,
          confidence: 1,
          mappingRule: "human-reviewed-pdf-figure-and-curve-folder",
          titleTokenOverlap: mappedCandidate?.titleTokenOverlap ?? 0,
          reasons: [verifiedSystem.note],
          candidate: {
            pdfFile: verifiedSystem.pdfFile,
            pdfPath: verifiedSystem.pdfPath,
            title: mappedCandidate?.candidate?.title ?? null,
            doi: verifiedSystem.doi,
            pageCount: mappedCandidate?.candidate?.pageCount ?? null,
            metadataStatus: "verified",
            metadataError: null,
          },
        }
      : mappedCandidate;
  const override = autoImported?.override ?? config.curveOverrides[raw.id];
  const legacyEvidence = evidence(
    "legacy-dataset",
    source.workbookFile,
    source.range,
    legacyAudit
      ? `Mapped to ${legacyAudit.sourceCsv.replicateCount} raw curve row(s) in the original prediction-platform CSV; paper metadata remains unverified.`
      : "Imported from the old prediction platform and not checked against its source paper.",
  );
  const paperEvidence = profile
    ? evidence("paper", profile.paperFile, profile.methodLocator, "Directly reported in the paper's experimental methods.")
    : null;
  const figureEvidence = figureLink || verifiedSystem || (profile && override)
    ? evidence(
        "figure",
        source.imageFile ?? profile?.paperFile ?? source.pdfFile,
        figureLink?.figureLabel ?? verifiedSystem?.figureLocator ?? override?.figure ?? null,
        verifiedSystem?.note ?? "Read from the verified figure/image mapping.",
      )
    : null;
  const layerEvidence = override?.layerPositionsNm
    ? [
        ...(figureEvidence ? [figureEvidence] : []),
        ...(override.layerRange
          ? [evidence("workbook", source.workbookFile, override.layerRange, "Layer positions copied from the dedicated annotation column beside this X/Y curve group.")]
          : []),
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

  const identityStatus = override || figureSystem || verifiedSystem ? "verified" : legacy && raw.ionicLiquid ? "legacy-import" : "unreviewed";
  const identityConfidence = override || figureSystem || verifiedSystem ? 1 : legacy && raw.ionicLiquid ? 0.6 : null;
  const identityEvidence = (override || figureSystem || verifiedSystem) && figureEvidence ? [figureEvidence] : legacy ? [legacyEvidence] : [];
  const ionicLiquid = override?.ionicLiquid ?? figureSystem?.ionicLiquid ?? verifiedSystem?.ionicLiquid ?? raw.ionicLiquid;
  const cation = override?.cation ?? figureSystem?.cation ?? verifiedSystem?.cation ?? raw.cation;
  const anion = override?.anion ?? figureSystem?.anion ?? verifiedSystem?.anion ?? raw.anion;
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
      substrate: curatedField(verifiedSystem?.substrate ?? figureSystem?.substrate ?? profile?.substrate ?? null, {
        status: profile || figureSystem || verifiedSystem ? "verified" : "unreviewed",
        confidence: profile || figureSystem || verifiedSystem ? 1 : null,
        evidence: paperEvidence ? [paperEvidence] : (figureSystem || verifiedSystem) && figureEvidence ? [figureEvidence] : [],
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
      temperature: curatedField(override ? override.temperatureK : raw.temperatureK, {
        unit: "K",
        status: override
          ? override.temperatureK === null
            ? "not-reported"
            : "verified"
          : legacy && raw.temperatureK !== null
            ? "legacy-import"
            : "unreviewed",
        confidence: override ? 1 : legacy && raw.temperatureK !== null ? 0.6 : null,
        evidence: override
          ? [override.temperatureK === null ? paperEvidence : figureEvidence].filter((item): item is FieldEvidence => Boolean(item))
          : legacy && raw.temperatureK !== null
            ? [legacyEvidence]
            : [],
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
      electrodePotential: curatedField(override?.potentialV ?? figureLink?.potentialV ?? raw.potentialV, {
        unit: "V",
        status: override?.potentialV !== undefined ? "verified" : figureLink ? (figureLink.potentialV === null ? "reported" : "verified") : legacy && raw.potentialV !== null ? "legacy-import" : profile ? "not-reported" : "unreviewed",
        confidence: override?.potentialV !== undefined || figureLink ? 1 : legacy && raw.potentialV !== null ? 0.6 : profile ? 1 : null,
        evidence: (override?.potentialV !== undefined || figureLink) && figureEvidence ? [figureEvidence] : legacy && raw.potentialV !== null ? [legacyEvidence] : paperEvidence ? [paperEvidence] : [],
      }),
      potentialReference: curatedField(override?.potentialReference ?? figureLink?.potentialReference ?? null, {
        status: override?.potentialReference || figureLink?.potentialReference ? "verified" : profile ? "not-reported" : "unreviewed",
        confidence: override?.potentialReference || figureLink?.potentialReference ? 1 : profile ? 1 : null,
        evidence: (override?.potentialReference || figureLink?.potentialReference) && figureEvidence ? [figureEvidence] : paperEvidence ? [paperEvidence] : [],
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
    separationUnit: curatedField(profile?.separationUnit ?? figureLink?.xUnit ?? (legacy ? "nm" : null), {
      status: profile || figureLink ? "verified" : legacy ? "legacy-import" : "unreviewed",
      confidence: profile || figureLink ? 1 : legacy ? 0.4 : null,
      evidence: figureEvidence ? [figureEvidence] : legacy ? [legacyEvidence] : [],
    }),
    forceUnit: curatedField(profile?.forceUnit ?? figureLink?.yUnit ?? null, {
      status: profile || figureLink ? "verified" : "unreviewed",
      confidence: profile || figureLink ? 1 : null,
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

  const reviewedRaw = {
    ...raw,
    source,
    ...(redigitized ? {
      points: redigitized.points,
      pointCount: redigitized.points.length,
      segmentStarts: redigitized.segmentStarts,
    } : {}),
  };
  const digitizationQuality: AfmDigitizationQuality = override?.digitizationQuality ?? (profile && override ? "complete" : legacy ? "legacy-resampled" : "unreviewed");
  const paperIdentityVerified = Boolean(source.doi && (profile || paperCandidate?.status === "verified"));
  const review = buildReview(reviewedRaw, context, acquisition, paperCandidate, digitizationQuality, paperIdentityVerified, Boolean(cationSmiles || anionSmiles));
  const digitization: AfmDigitizationReview = {
    quality: digitizationQuality,
    modelEligible: digitizationQuality === "complete" && review.state === "verified",
    note: override?.digitizationNote ?? (legacy ? "Legacy representative curve was resampled to 50 points and must not be treated as raw digitization." : "Digitization fidelity has not yet been checked against the source figure."),
  };
  const temperatureC = override?.temperatureK != null ? Math.round((override.temperatureK - 273.15) * 100) / 100 : null;
  const label = override?.displayLabel ?? figureLink?.displayLabel ?? (override && /^-?\d+(?:\.\d+)?$/.test(raw.label.trim()) ? `${override.ionicLiquid} · ${formatTemperatureC(temperatureC)}` : raw.label);
  const legacyAuditNote = legacyAudit
    ? ` Original CSV provenance: ${legacyAudit.sourceCsv.file} rows ${legacyAudit.sourceCsv.rows.join(", ")} (${legacyAudit.sourceCsv.replicateCount} raw replicate${legacyAudit.sourceCsv.replicateCount === 1 ? "" : "s"}; ${legacyAudit.rawCurves.pointCounts.join("/")} points). Legacy SMILES remain chemically unverified.`
    : "";

  return {
    ...reviewedRaw,
    status: paperIdentityVerified ? "source-verified" : raw.status,
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
    notes: redigitized
      ? `${override?.digitizationNote ?? "Source figure re-digitized."}${legacyAuditNote}`
      : `${override?.digitizationNote ? `${raw.notes} ${override.digitizationNote}` : raw.notes}${legacyAuditNote}`,
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
  // A source-confirmed absence (for example, measurement temperature was not
  // reported) is a completed review outcome, not an unresolved missing field.
  // This keeps the verification percentage honest without fabricating a value.
  const isResolved = (field: CuratedField<unknown>) => isFieldPresent(field) || field.status === "not-reported";
  const missingFields = required.filter((key) => !isResolved(fields[key]));
  const unverifiedFields = required.filter((key) => isResolved(fields[key]) && !isFieldVerified(fields[key]));
  const presentFieldCount = required.length - missingFields.length;
  const verifiedFieldCount = required.filter((key) => isResolved(fields[key]) && isFieldVerified(fields[key])).length;
  const qualityFlags: string[] = [];
  if (!raw.source.doi) qualityFlags.push("source-paper-not-linked");
  if (paperCandidate?.requiresReview && paperCandidate.candidate) qualityFlags.push("paper-candidate-awaiting-review");
  if (!isFieldPresent(acquisition.separationUnit) || !isFieldPresent(acquisition.forceUnit)) qualityFlags.push("axis-units-need-review");
  if (!isFieldPresent(acquisition.curveBranch)) qualityFlags.push("curve-branch-need-review");
  if (raw.collection === "legacy-cleaned" && digitizationQuality !== "complete") {
    qualityFlags.push("legacy-endpoint-extrapolation");
    if (!raw.source.range) qualityFlags.push("legacy-source-provenance-missing");
  }
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
