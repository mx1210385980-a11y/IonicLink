import assert from "node:assert/strict";
import { AFM_CURVE_DATASET, validateAfmCurveDataset } from "./afmCurves";

const validation = validateAfmCurveDataset();
assert.equal(validation.valid, true, validation.errors.join("\n"));
assert.equal(AFM_CURVE_DATASET.schemaVersion, 4);
assert.equal(AFM_CURVE_DATASET.curationSchemaVersion, 3);
assert.equal(AFM_CURVE_DATASET.summary.totalCurves, 164);
assert.equal(AFM_CURVE_DATASET.summary.qualifiedNewCurves, 103);
assert.equal(AFM_CURVE_DATASET.summary.legacyCleanedCurves, 61);
assert.equal(AFM_CURVE_DATASET.summary.sourceVerifiedCurves, 108);
assert.equal(AFM_CURVE_DATASET.summary.metadataCompleteCurves, 25);
assert.equal(AFM_CURVE_DATASET.summary.modelEligibleCurves, 24);
assert.equal(AFM_CURVE_DATASET.summary.curvesWithLayerPositions, 8);
assert.equal(AFM_CURVE_DATASET.summary.paperLinkedCurves, 108);
assert.equal(AFM_CURVE_DATASET.summary.paperSuggestedCurves, 0);
assert.equal(AFM_CURVE_DATASET.summary.paperSuggestedFolderGroups, 0);
assert.equal(AFM_CURVE_DATASET.summary.paperUnmatchedCurves, 0);
assert.equal(AFM_CURVE_DATASET.summary.curvesWithIonicIdentity, 164);
assert.equal(AFM_CURVE_DATASET.summary.curvesWithPotential, 84);
assert.equal(AFM_CURVE_DATASET.summary.curvesWithCapacitance, 0);
assert.equal(AFM_CURVE_DATASET.summary.curvesWithRelatedCapacitance, 1);
assert.equal(AFM_CURVE_DATASET.summary.curvesWithElectricField, 0);

const automaticallyImported = AFM_CURVE_DATASET.curves.filter((curve) => curve.id.startsWith("AFM-AUTO-"));
assert.equal(automaticallyImported.length, 6);
assert.ok(automaticallyImported.every((curve) => curve.review.verifiedPercent === 100));
assert.ok(automaticallyImported.every((curve) => curve.digitization.modelEligible));
assert.equal(automaticallyImported.find((curve) => curve.id.endsWith("IJMS-2021-F6-C"))?.potentialV, 2);

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

const silverSeriesFirst = AFM_CURVE_DATASET.curves.find((curve) => curve.id === "AFM-26-07-28-07-C001");
assert.ok(silverSeriesFirst);
assert.equal(silverSeriesFirst.status, "source-verified");
assert.equal(silverSeriesFirst.source.imageFile, "QQ20260730-113643.png");
assert.equal(silverSeriesFirst.source.pdfFile, "7.pdf");
assert.equal(silverSeriesFirst.source.doi, "10.1039/c7cp08243f");
assert.deepEqual(silverSeriesFirst.source.figure, {
  label: "Figure 2 · row 1, column 1",
  pdfPage: 6,
  mappingStatus: "verified",
});
assert.equal(silverSeriesFirst.paperCandidate?.status, "verified");
assert.equal(silverSeriesFirst.paperCandidate?.requiresReview, false);
assert.equal(silverSeriesFirst.label, "10⁻⁴ M AgTFSA · +0.2 V vs OCP");
assert.equal(silverSeriesFirst.context.ionicLiquid.name.value, "[Py1,4][TFSA]");
assert.equal(silverSeriesFirst.context.ionicLiquid.cation.value, "1-butyl-1-methylpyrrolidinium");
assert.equal(silverSeriesFirst.context.ionicLiquid.anion.value, "bis(trifluoromethylsulfonyl)amide");
assert.equal(silverSeriesFirst.context.interface.substrate.value, "Au(111)");
assert.equal(silverSeriesFirst.context.electrochemistry.electrodePotential.value, 0.2);
assert.equal(silverSeriesFirst.xUnit, "nm");
assert.equal(silverSeriesFirst.yUnit, "nN");

const silverSeriesLast = AFM_CURVE_DATASET.curves.find((curve) => curve.id === "AFM-26-07-28-07-C024");
assert.ok(silverSeriesLast);
assert.equal(silverSeriesLast.source.imageFile, "24.png");
assert.equal(silverSeriesLast.source.figure?.label, "Figure 4 · row 2, column 3");
assert.equal(silverSeriesLast.source.figure?.pdfPage, 8);
assert.equal(silverSeriesLast.label, "50 µM AgTFSA · −0.3 V vs OCP (return scan)");

const formerlyAmbiguous = AFM_CURVE_DATASET.curves.find((curve) => curve.id === "AFM-26-07-27-013-C003");
assert.ok(formerlyAmbiguous);
assert.equal(formerlyAmbiguous.context.ionicLiquid.name.value, "PAN");
assert.equal(formerlyAmbiguous.context.interface.substrate.value, "mica");
assert.equal(formerlyAmbiguous.source.pdfFile, "13.pdf");
assert.equal(formerlyAmbiguous.source.doi, "10.1021/jp067420g");
assert.equal(formerlyAmbiguous.paperCandidate?.status, "verified");

const waterSeries = AFM_CURVE_DATASET.curves.filter((curve) => curve.source.folder === "09" && curve.source.date === "26-07-28");
assert.equal(waterSeries.length, 15);
assert.ok(waterSeries.every((curve) => curve.context.ionicLiquid.name.value === "[EMIM][TfO]"));
assert.ok(waterSeries.every((curve) => curve.context.interface.substrate.value === "Au(111)"));

const legacy = AFM_CURVE_DATASET.curves.filter((curve) => curve.collection === "legacy-cleaned");
assert.equal(new Set(legacy.map((curve) => curve.ionicLiquid)).size, 17);
const redigitizedIds = new Set(["legacy-027", "legacy-028", "legacy-029", "legacy-030", "legacy-031"]);
assert.ok(legacy.filter((curve) => !redigitizedIds.has(curve.id)).every((curve) => curve.pointCount === 50));
assert.ok(legacy.filter((curve) => redigitizedIds.has(curve.id)).every((curve) => curve.pointCount > 250));
assert.ok(legacy.filter((curve) => !redigitizedIds.has(curve.id)).every((curve) => curve.review.qualityFlags.includes("legacy-endpoint-extrapolation")));
assert.ok(legacy.filter((curve) => redigitizedIds.has(curve.id)).every((curve) => !curve.review.qualityFlags.includes("legacy-endpoint-extrapolation")));
assert.ok(legacy.every((curve) => !curve.review.qualityFlags.includes("legacy-source-provenance-missing")));
assert.ok(legacy.every((curve) => curve.source.workbookFile === "修改3.csv"));
assert.ok(legacy.every((curve) => curve.source.range?.startsWith("rows ")));
assert.equal(legacy.reduce((sum, curve) => sum + (curve.source.rawReplicateCount ?? 0), 0), 136);
assert.ok(legacy.some((curve) => curve.review.qualityFlags.includes("legacy-smiles-need-chemical-validation")));

const emimTfsaHopg = ["legacy-027", "legacy-028", "legacy-029", "legacy-030", "legacy-031"].map((id) => {
  const curve = AFM_CURVE_DATASET.curves.find((candidate) => candidate.id === id);
  assert.ok(curve, `missing ${id}`);
  return curve;
});
assert.ok(emimTfsaHopg.every((curve) => curve.status === "source-verified"));
assert.ok(emimTfsaHopg.every((curve) => curve.source.pdfFile === "18.pdf"));
assert.ok(emimTfsaHopg.every((curve) => curve.source.doi === "10.1088/0953-8984/26/28/284115"));
assert.ok(emimTfsaHopg.every((curve) => curve.source.imageFile === "QQ20260729-113100.png"));
assert.ok(emimTfsaHopg.every((curve) => curve.context.interface.substrate.value === "HOPG"));
assert.ok(emimTfsaHopg.every((curve) => curve.context.thermodynamics.temperature.value === null));
assert.ok(emimTfsaHopg.every((curve) => curve.context.thermodynamics.temperature.status === "not-reported"));
assert.ok(emimTfsaHopg.every((curve) => curve.context.electrochemistry.potentialReference.value === "Pt quasi-reference"));
assert.ok(emimTfsaHopg.every((curve) => curve.digitization.quality === "complete"));
// A source-confirmed "not reported" temperature is a resolved review outcome:
// the digitized curve may be used as a response series, while downstream models
// can still decide whether their particular feature set requires temperature.
assert.ok(emimTfsaHopg.every((curve) => curve.digitization.modelEligible === true));
assert.ok(emimTfsaHopg.every((curve) => curve.source.imageCrop));
assert.ok(emimTfsaHopg.every((curve) => curve.segmentStarts && curve.segmentStarts.length >= 2));
assert.deepEqual(emimTfsaHopg[0].layering.layerPositions.value, [0.31, 1.2, 2.1]);
assert.deepEqual(emimTfsaHopg[4].layering.layerPositions.value, [0.47, 1.2, 2.0, 2.8, 3.5]);

console.log("AFM conductivity data snapshot tests passed");
