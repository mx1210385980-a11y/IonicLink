import assert from "node:assert/strict";
import { AFM_CURVE_DATASET, validateAfmCurveDataset } from "./afmCurves";

const validation = validateAfmCurveDataset();
assert.equal(validation.valid, true, validation.errors.join("\n"));
assert.equal(AFM_CURVE_DATASET.schemaVersion, 3);
assert.equal(AFM_CURVE_DATASET.curationSchemaVersion, 2);
assert.equal(AFM_CURVE_DATASET.summary.totalCurves, 158);
assert.equal(AFM_CURVE_DATASET.summary.qualifiedNewCurves, 97);
assert.equal(AFM_CURVE_DATASET.summary.legacyCleanedCurves, 61);
assert.equal(AFM_CURVE_DATASET.summary.sourceVerifiedCurves, 14);
assert.equal(AFM_CURVE_DATASET.summary.metadataCompleteCurves, 14);
assert.equal(AFM_CURVE_DATASET.summary.modelEligibleCurves, 13);
assert.equal(AFM_CURVE_DATASET.summary.curvesWithLayerPositions, 3);
assert.equal(AFM_CURVE_DATASET.summary.paperLinkedCurves, 14);
assert.equal(AFM_CURVE_DATASET.summary.paperSuggestedCurves, 83);
assert.equal(AFM_CURVE_DATASET.summary.paperSuggestedFolderGroups, 12);
assert.equal(AFM_CURVE_DATASET.summary.paperUnmatchedCurves, 0);
assert.equal(AFM_CURVE_DATASET.summary.curvesWithIonicIdentity, 75);
assert.equal(AFM_CURVE_DATASET.summary.curvesWithPotential, 64);
assert.equal(AFM_CURVE_DATASET.summary.curvesWithCapacitance, 0);
assert.equal(AFM_CURVE_DATASET.summary.curvesWithRelatedCapacitance, 1);
assert.equal(AFM_CURVE_DATASET.summary.curvesWithElectricField, 0);

const sample = AFM_CURVE_DATASET.curves.find((curve) => curve.id === "AFM-26-07-27-15-C001");
assert.ok(sample);
assert.equal(sample.status, "source-verified");
assert.equal(sample.source.pdfFile, "jp900815q.pdf");
assert.equal(sample.source.range, "A2:B131");
assert.equal(sample.label.toLowerCase(), "14°c");
assert.equal(sample.pointCount, 130);
assert.equal(sample.context.interface.substrate.value, "mica");
assert.equal(sample.context.interface.probeMaterial.value, "Si3N4");
assert.equal(sample.acquisition.separationUnit.value, "nm");
assert.equal(sample.acquisition.forceUnit.value, "nN");
assert.equal(sample.review.state, "verified");
assert.equal(sample.review.verifiedPercent, 100);
assert.equal(sample.context.electrochemistry.capacitance.status, "not-reported");
assert.equal(sample.paperCandidate?.status, "verified");
assert.equal(sample.paperCandidate?.requiresReview, false);

const titleMatchedCandidate = AFM_CURVE_DATASET.curves.find(
  (curve) => curve.id === "AFM-26-07-27-06-Adsorbed-and-near-surface-structure-of-ionic-liquids-at-C001",
);
assert.ok(titleMatchedCandidate);
assert.equal(titleMatchedCandidate.status, "source-verified");
assert.equal(titleMatchedCandidate.source.pdfFile, "c3cp44163f.pdf");
assert.equal(titleMatchedCandidate.source.doi, "10.1039/c3cp44163f");
assert.equal(titleMatchedCandidate.paperCandidate?.status, "verified");
assert.equal(titleMatchedCandidate.paperCandidate?.requiresReview, false);
assert.equal(titleMatchedCandidate.paperCandidate?.confidence, 1);
assert.equal(titleMatchedCandidate.paperCandidate?.candidate?.pdfFile, "c3cp44163f.pdf");
assert.equal(titleMatchedCandidate.paperCandidate?.candidate?.doi, "10.1039/c3cp44163f");
assert.match(titleMatchedCandidate.paperCandidate?.candidate?.title ?? "", /Adsorbed and near surface structure/);
assert.equal(titleMatchedCandidate.label, "EAN · 25 °C");
assert.equal(titleMatchedCandidate.context.ionicLiquid.name.value, "EAN");
assert.equal(titleMatchedCandidate.context.interface.substrate.value, "mica");
assert.equal(titleMatchedCandidate.context.thermodynamics.temperature.value, 298.15);
assert.equal(titleMatchedCandidate.context.thermodynamics.waterContent.value, "<1 wt% for the presented data");
assert.equal(titleMatchedCandidate.acquisition.instrument.value, "Asylum Research Cypher AFM");
assert.equal(titleMatchedCandidate.acquisition.scanSize.value, "30–50");
assert.equal(titleMatchedCandidate.acquisition.scanRate.status, "not-reported");
assert.equal(titleMatchedCandidate.review.state, "verified");
assert.ok(!titleMatchedCandidate.review.qualityFlags.includes("paper-candidate-awaiting-review"));

const dmeaf = AFM_CURVE_DATASET.curves.find((curve) => curve.id === "AFM-26-07-27-15-C010");
assert.ok(dmeaf);
assert.equal(dmeaf.label, "DMEAF · 21 °C");
assert.equal(dmeaf.ionicLiquid, "DMEAF");
assert.equal(dmeaf.cation, "dimethylethylammonium");
assert.equal(dmeaf.anion, "formate");
assert.equal(dmeaf.temperatureK, 294.15);

const ocpCurve = AFM_CURVE_DATASET.curves.find((curve) => curve.id === "AFM-26-07-28-05-C001");
assert.ok(ocpCurve);
assert.equal(ocpCurve.status, "source-verified");
assert.equal(ocpCurve.source.doi, "10.1039/c0cp02846k");
assert.equal(ocpCurve.context.ionicLiquid.name.value, "[Py1,4][FAP]");
assert.equal(ocpCurve.context.electrochemistry.electrodePotential.value, -0.2);
assert.equal(ocpCurve.layering.detectedLayerCount.value, 5);
assert.equal(ocpCurve.layering.medianLayerSpacing.value, 0.9);
assert.equal(ocpCurve.digitization.quality, "partial");
assert.equal(ocpCurve.digitization.modelEligible, false);
assert.ok(ocpCurve.review.qualityFlags.includes("digitization-incomplete"));
assert.ok(ocpCurve.review.qualityFlags.includes("exclude-from-modeling"));

const minusOneVoltCurve = AFM_CURVE_DATASET.curves.find((curve) => curve.id === "AFM-26-07-28-05-C002");
assert.ok(minusOneVoltCurve);
assert.equal(minusOneVoltCurve.label, "[Py1,4][FAP] · −1.0 V vs Pt");
assert.equal(minusOneVoltCurve.context.electrochemistry.electrodePotential.value, -1);
assert.equal(minusOneVoltCurve.context.electrochemistry.potentialReference.value, "Pt quasi-reference");
assert.equal(minusOneVoltCurve.layering.detectedLayerCount.value, 6);
assert.equal(minusOneVoltCurve.digitization.modelEligible, true);
assert.equal(minusOneVoltCurve.context.electrochemistry.capacitance.status, "not-reported");
assert.equal(minusOneVoltCurve.context.electrochemistry.relatedMeasurements.length, 1);
assert.equal(minusOneVoltCurve.context.electrochemistry.relatedMeasurements[0].value, 14.9);
assert.equal(minusOneVoltCurve.context.electrochemistry.relatedMeasurements[0].temperatureK, 303.15);

const minusTwoVoltCurve = AFM_CURVE_DATASET.curves.find((curve) => curve.id === "AFM-26-07-28-05-C003");
assert.ok(minusTwoVoltCurve);
assert.equal(minusTwoVoltCurve.context.electrochemistry.electrodePotential.value, -2);
assert.equal(minusTwoVoltCurve.layering.detectedLayerCount.value, 8);
assert.deepEqual(minusTwoVoltCurve.layering.layerPositions.value, [0.55, 1.4, 2.3, 3.2, 4.1, 5, 5.9, 6.8]);

const legacy = AFM_CURVE_DATASET.curves.filter((curve) => curve.collection === "legacy-cleaned");
assert.equal(new Set(legacy.map((curve) => curve.ionicLiquid)).size, 17);
assert.ok(legacy.every((curve) => curve.pointCount === 50));
assert.ok(legacy.every((curve) => curve.review.qualityFlags.includes("legacy-endpoint-extrapolation")));
assert.ok(legacy.some((curve) => curve.review.qualityFlags.includes("legacy-smiles-need-chemical-validation")));

console.log("AFM conductivity data snapshot tests passed");
