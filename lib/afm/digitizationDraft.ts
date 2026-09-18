import type { AfmDigitizationAnalysis, AfmPlotBox } from "./digitizeCurve";
import type { AfmPanelConditions } from "./multiPanel";
import type { AfmExperimentalMetadata } from "./experimentalMetadata";
import { curatedField, type FieldEvidence } from "./interfacialExperiment";
import type { AfmCurveRecord } from "./afmCurves";

export const AFM_DIGITIZATION_DRAFT_STORAGE_KEY = "ioniclink:afm-digitization-drafts:v1";

export interface AfmDigitizationDraft {
  schema: "ioniclink.afm-digitized-draft";
  schemaVersion: 3 | 4 | 5;
  id: string;
  createdAt: string;
  reviewState: "pending-metadata-review";
  digitizationBasis: "Digitized from figure";
  calibration: {
    status: "relative-pending" | "physical-auto" | "physical-reviewed";
    axes: { xMin: number; xMax: number; yMin: number; yMax: number; xUnit: string; yUnit: string } | null;
    confidence?: number;
    method?: string;
    evidence?: string[];
  };
  source: {
    file: string;
    page: number | null;
    figure: {
      kind: "pdf-panel-crop" | "pdf-figure-crop" | "pdf-page" | "uploaded-image";
      width: number;
      height: number;
      renderScale: number | null;
      crop: { left: number; top: number; right: number; bottom: number } | null;
      imageDataUrl: string | null;
    };
    panel: {
      figureLabel: string;
      label: string;
      row: number;
      column: number;
      rows: number;
      columns: number;
      suggestedLabel: string;
      conditions: AfmPanelConditions;
    } | null;
  };
  curve: { label: string; xUnit: string; yUnit: string; points: Array<[number, number]>; segmentStarts?: number[] };
  recognition: {
    confidence: number;
    quality: AfmDigitizationAnalysis["quality"];
    plotBox: AfmPlotBox;
    automaticallyDetectedPlotBox: AfmPlotBox;
    warnings: string[];
  };
  experimentalMetadata?: AfmExperimentalMetadata;
}

export function parseStoredAfmDrafts(raw: string | null): AfmDigitizationDraft[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isAfmDigitizationDraft);
  } catch {
    return [];
  }
}

export function mergeStoredAfmDrafts(existing: AfmDigitizationDraft[], incoming: AfmDigitizationDraft[], limit = 100) {
  const incomingKeys = new Set(incoming.map(draftIdentityKey));
  return [...incoming, ...existing.filter((draft) => !incomingKeys.has(draftIdentityKey(draft)))].slice(0, limit);
}

export function afmDraftToCurveRecord(draft: AfmDigitizationDraft): AfmCurveRecord {
  const panel = draft.source.panel;
  const ionicLiquid = panel?.conditions.ionicLiquid.value ?? null;
  const substrate = panel?.conditions.substrate.value ?? null;
  const potential = panel?.conditions.electrodePotential.value ?? null;
  const metadata = draft.experimentalMetadata;
  const probeMaterial = metadata?.probe.material.value ?? null;
  const temperature = toKelvin(metadata?.externalFactors.temperature.value ?? null, metadata?.externalFactors.temperature.unit ?? null);
  const technique = metadata?.acquisition.technique.value ?? null;
  const springConstant = metadata?.probe.cantileverSpringConstant.value ?? null;
  const approachSpeed = metadata?.acquisition.approachSpeed.value ?? null;
  const [cation, anion] = splitIonicLiquid(ionicLiquid);
  const inferredEvidence = (note: string): FieldEvidence[] => [{
    sourceKind: "figure",
    sourceFile: draft.source.file,
    locator: panel ? `Figure ${panel.figureLabel}, panel ${panel.label}` : `PDF page ${draft.source.page ?? "unresolved"}`,
    note,
  }];
  const relative = draft.calibration.status === "relative-pending";
  const presentFieldCount = [ionicLiquid, substrate, potential, probeMaterial, temperature, technique].filter((value) => value !== null).length;
  const requiredFieldCount = 9;
  const missingFields = [
    !ionicLiquid ? "ionicLiquid" : null,
    !cation ? "cation" : null,
    !anion ? "anion" : null,
    !substrate ? "substrate" : null,
    !probeMaterial ? "probeMaterial" : null,
    temperature === null ? "temperature" : null,
    !technique ? "technique" : null,
    "curveBranch",
    relative ? "physicalAxisCalibration" : null,
  ].filter((value): value is string => Boolean(value));

  return {
    id: draft.id,
    collection: "qualified-new",
    status: "pairing-qualified",
    label: draft.curve.label,
    ionicLiquid,
    cation,
    anion,
    potentialV: potential,
    temperatureK: null,
    xUnit: draft.curve.xUnit,
    yUnit: draft.curve.yUnit,
    pointCount: draft.curve.points.length,
    points: draft.curve.points,
    segmentStarts: draft.curve.segmentStarts,
    source: {
      date: draft.createdAt.slice(0, 10),
      folder: "Local AFM review queue",
      imageFile: panel ? `Figure ${panel.figureLabel} · panel ${panel.label}` : draft.source.file,
      imagePath: null,
      workbookFile: "Browser digitization draft",
      workbookPath: "localStorage",
      sheet: "Digitized from figure",
      range: null,
      pdfFile: draft.source.file,
      pdfPath: null,
      doi: null,
      figure: panel ? { label: `Figure ${panel.figureLabel} · panel ${panel.label}`, pdfPage: draft.source.page ?? 0, mappingStatus: "inferred" } : null,
      previewImageDataUrl: draft.source.figure.imageDataUrl,
    },
    notes: relative
      ? "Automatically digitized from a PDF panel and saved locally for review. Points remain in relative pixel space; physical axes must be calibrated before approval or modelling."
      : draft.calibration.status === "physical-auto"
        ? "Automatically digitized and physically calibrated from the source figure. Axis provenance and AI confidence are retained; metadata review is still required before approval."
        : "Automatically digitized from a PDF panel. Physical axes were entered and confirmed locally, but the record still requires metadata review before approval.",
    context: {
      ionicLiquid: {
        name: curatedField(ionicLiquid, { status: ionicLiquid ? "inferred" : "unreviewed", confidence: panel?.conditions.ionicLiquid.confidence ?? null, evidence: inferredEvidence(panel?.conditions.ionicLiquid.evidence ?? "Panel identity requires review.") }),
        cation: curatedField(cation, { status: cation ? "inferred" : "unreviewed", confidence: cation ? 0.8 : null, evidence: inferredEvidence("Parsed from the inferred ionic-liquid abbreviation; confirm the ion assignment.") }),
        anion: curatedField(anion, { status: anion ? "inferred" : "unreviewed", confidence: anion ? 0.8 : null, evidence: inferredEvidence("Parsed from the inferred ionic-liquid abbreviation; confirm the ion assignment.") }),
        cationSmiles: curatedField<string>(null),
        anionSmiles: curatedField<string>(null),
      },
      interface: {
        substrate: curatedField(substrate, { status: substrate ? "inferred" : "unreviewed", confidence: panel?.conditions.substrate.confidence ?? null, evidence: inferredEvidence(panel?.conditions.substrate.evidence ?? "Substrate requires review.") }),
        probeMaterial: curatedField(probeMaterial, { status: probeMaterial ? "inferred" : "unreviewed", confidence: metadata?.probe.material.confidence ?? null, evidence: inferredEvidence(metadata?.probe.material.evidence ?? "Probe material requires review.") }),
        surfaceState: curatedField<string>(null),
      },
      thermodynamics: {
        temperature: curatedField(temperature, { unit: "K", status: temperature === null ? "unreviewed" : "inferred", confidence: metadata?.externalFactors.temperature.confidence ?? null, evidence: inferredEvidence(metadata?.externalFactors.temperature.evidence ?? "Temperature was not reported.") }),
        pressure: curatedField<number>(null, { unit: "Pa" }),
        atmosphere: curatedField(metadata?.externalFactors.atmosphere.value ?? null, { status: metadata?.externalFactors.atmosphere.value ? "inferred" : "unreviewed", confidence: metadata?.externalFactors.atmosphere.confidence ?? null, evidence: inferredEvidence(metadata?.externalFactors.atmosphere.evidence ?? "Atmosphere was not reported.") }),
        waterContent: curatedField(metadata?.externalFactors.waterContent.value ?? null, { status: metadata?.externalFactors.waterContent.value ? "inferred" : "unreviewed", confidence: metadata?.externalFactors.waterContent.confidence ?? null, evidence: inferredEvidence(metadata?.externalFactors.waterContent.evidence ?? "Water content was not reported.") }),
      },
      electrochemistry: {
        electrodePotential: curatedField(potential, { unit: potential === null ? null : "V", status: potential === null ? "unreviewed" : "inferred", confidence: panel?.conditions.electrodePotential.confidence ?? null, evidence: inferredEvidence(panel?.conditions.electrodePotential.evidence ?? "Potential requires review.") }),
        potentialReference: curatedField<string>(null),
        capacitance: curatedField<number>(null),
        electricField: curatedField<number>(null),
        relatedMeasurements: [],
        linkedConductivityRecordIds: [],
      },
    },
    acquisition: {
      technique: curatedField(technique, { status: technique ? "inferred" : "unreviewed", confidence: metadata?.acquisition.technique.confidence ?? null, evidence: inferredEvidence(metadata?.acquisition.technique.evidence ?? "Technique requires review.") }),
      curveBranch: curatedField<string>(null),
      instrument: curatedField<string>(null),
      scanRate: curatedField<number | string>(approachSpeed === null ? null : `${approachSpeed} ${metadata?.acquisition.approachSpeed.unit ?? ""}`.trim(), { status: approachSpeed === null ? "unreviewed" : "inferred", confidence: metadata?.acquisition.approachSpeed.confidence ?? null, evidence: inferredEvidence(metadata?.acquisition.approachSpeed.evidence ?? "Approach speed was not reported.") }),
      scanSize: curatedField<number | string>(null),
      springConstant: curatedField(springConstant, { unit: metadata?.probe.cantileverSpringConstant.unit ?? "N/m", status: springConstant === null ? "unreviewed" : "inferred", confidence: metadata?.probe.cantileverSpringConstant.confidence ?? null, evidence: inferredEvidence(metadata?.probe.cantileverSpringConstant.evidence ?? "Spring constant was not reported.") }),
      separationUnit: curatedField(draft.curve.xUnit, { status: relative ? "unreviewed" : "reported" }),
      forceUnit: curatedField(draft.curve.yUnit, { status: relative ? "unreviewed" : "reported" }),
    },
    layering: {
      layerPositions: curatedField<number[]>(null, { unit: "nm" }),
      detectedLayerCount: curatedField<number>(null),
      innermostLayerThickness: curatedField<number>(null, { unit: "nm" }),
      medianLayerSpacing: curatedField<number>(null, { unit: "nm" }),
    },
    digitization: {
      quality: relative ? "unreviewed" : "partial",
      modelEligible: false,
      note: relative
        ? "Relative-pixel centreline; physical axes pending."
        : draft.calibration.status === "physical-auto"
          ? "Physical axes automatically inherited from a traceable source calibration; metadata review pending."
          : "Physical axes locally confirmed; source and metadata review pending.",
    },
    paperCandidate: null,
    review: {
      state: "unreviewed",
      requiredFieldCount,
      presentFieldCount,
      verifiedFieldCount: 0,
      completenessPercent: Math.round((presentFieldCount / requiredFieldCount) * 100),
      verifiedPercent: 0,
      missingFields,
      unverifiedFields: ["ionicLiquid", "cation", "anion", "substrate", "electrodePotential", "digitization"],
      qualityFlags: [
        "LOCAL_REVIEW_DRAFT",
        relative ? "PHYSICAL_AXES_PENDING" : "METADATA_REVIEW_PENDING",
        ...(draft.calibration.status === "physical-auto" ? ["AUTO_AXIS_CALIBRATED"] : []),
      ],
    },
  };
}

function isAfmDigitizationDraft(value: unknown): value is AfmDigitizationDraft {
  if (!value || typeof value !== "object") return false;
  const draft = value as Partial<AfmDigitizationDraft>;
  return draft.schema === "ioniclink.afm-digitized-draft"
    && (draft.schemaVersion === 3 || draft.schemaVersion === 4 || draft.schemaVersion === 5)
    && typeof draft.id === "string"
    && Array.isArray(draft.curve?.points);
}

function draftIdentityKey(draft: AfmDigitizationDraft) {
  return [draft.source.file, draft.source.page ?? "image", draft.source.panel?.figureLabel ?? "figure", draft.source.panel?.label ?? draft.curve.label].join("::");
}

function splitIonicLiquid(value: string | null): [string | null, string | null] {
  if (!value) return [null, null];
  const cation = value.match(/^(\[[^\]]+\])/i)?.[1] ?? null;
  if (!cation) return [null, null];
  const remainder = value.slice(cation.length).trim();
  if (!remainder) return [cation, null];
  return [cation, remainder.startsWith("[") ? remainder : `[${remainder}]`];
}

function toKelvin(value: number | null, unit: string | null) {
  if (value === null) return null;
  if (/°?C/i.test(unit ?? "")) return Math.round((value + 273.15) * 100) / 100;
  return value;
}
