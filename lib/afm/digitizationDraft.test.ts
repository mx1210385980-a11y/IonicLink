import assert from "node:assert/strict";
import { afmDraftToCurveRecord, mergeStoredAfmDrafts, parseStoredAfmDrafts, type AfmDigitizationDraft } from "./digitizationDraft";

const draft: AfmDigitizationDraft = {
  schema: "ioniclink.afm-digitized-draft",
  schemaVersion: 3,
  id: "AFM-DRAFT-15-4-A",
  createdAt: "2026-08-31T00:00:00.000Z",
  reviewState: "pending-metadata-review",
  digitizationBasis: "Digitized from figure",
  calibration: { status: "relative-pending", axes: null },
  source: {
    file: "15.pdf",
    page: 4,
    figure: {
      kind: "pdf-panel-crop",
      width: 305,
      height: 238,
      renderScale: 3,
      crop: { left: 0.1, top: 0.2, right: 0.3, bottom: 0.4 },
      imageDataUrl: "data:image/png;base64,AA==",
    },
    panel: {
      figureLabel: "1",
      label: "A",
      row: 0,
      column: 0,
      rows: 5,
      columns: 4,
      suggestedLabel: "[Li(G4)]TFSI · HOPG · +1 V",
      conditions: {
        ionicLiquid: { value: "[Li(G4)]TFSI", unit: null, status: "inferred", confidence: 0.96, evidence: "caption" },
        substrate: { value: "HOPG", unit: null, status: "inferred", confidence: 0.97, evidence: "panel range" },
        electrodePotential: { value: 1, unit: "V", status: "inferred", confidence: 0.82, evidence: "row order" },
      },
    },
  },
  curve: { label: "[Li(G4)]TFSI · HOPG · +1 V", xUnit: "relative-x", yUnit: "relative-y", points: [[0, 1], [0.2, 0.5], [1, 0]] },
  recognition: {
    confidence: 0.8,
    quality: "medium",
    plotBox: { left: 1, top: 2, right: 300, bottom: 230 },
    automaticallyDetectedPlotBox: { left: 1, top: 2, right: 300, bottom: 230 },
    warnings: [],
  },
};

assert.deepEqual(parseStoredAfmDrafts(JSON.stringify([draft])), [draft]);
assert.deepEqual(parseStoredAfmDrafts("invalid"), []);
assert.equal(mergeStoredAfmDrafts([draft], [{ ...draft, createdAt: "2026-09-01T00:00:00.000Z" }]).length, 1);

const curve = afmDraftToCurveRecord(draft);
assert.equal(curve.context.ionicLiquid.name.value, "[Li(G4)]TFSI");
assert.equal(curve.context.ionicLiquid.cation.value, "[Li(G4)]");
assert.equal(curve.context.ionicLiquid.anion.value, "[TFSI]");
assert.equal(curve.context.interface.substrate.value, "HOPG");
assert.equal(curve.context.electrochemistry.electrodePotential.value, 1);
assert.equal(curve.source.figure?.mappingStatus, "inferred");
assert.equal(curve.source.previewImageDataUrl, "data:image/png;base64,AA==");
assert.equal(curve.review.state, "unreviewed");
assert.equal(curve.digitization.modelEligible, false);
assert.ok(curve.review.qualityFlags.includes("PHYSICAL_AXES_PENDING"));

const automaticDraft: AfmDigitizationDraft = {
  ...draft,
  schemaVersion: 4,
  calibration: {
    status: "physical-auto",
    axes: { xMin: -1, xMax: 3, yMin: -2, yMax: 12, xUnit: "nm", yUnit: "nN" },
    confidence: 0.99,
    method: "verified-source-profile",
    evidence: ["DOI 10.1039/c4cp04522j", "Figure 1 shared axes."],
  },
  curve: { ...draft.curve, xUnit: "nm", yUnit: "nN", points: [[-1, 12], [0, 4], [3, 0]] },
};
assert.deepEqual(parseStoredAfmDrafts(JSON.stringify([automaticDraft])), [automaticDraft]);
const automaticCurve = afmDraftToCurveRecord(automaticDraft);
assert.equal(automaticCurve.acquisition.separationUnit.status, "reported");
assert.ok(automaticCurve.review.qualityFlags.includes("AUTO_AXIS_CALIBRATED"));
assert.ok(!automaticCurve.review.qualityFlags.includes("PHYSICAL_AXES_PENDING"));
assert.match(automaticCurve.notes, /automatically digitized and physically calibrated/i);

console.log("AFM local digitization draft tests passed");
