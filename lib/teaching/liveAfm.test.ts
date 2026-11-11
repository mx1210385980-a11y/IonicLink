import assert from "node:assert/strict";
import type { digitizeAfmUpload, DigitizationCandidate } from "../afm/digitizeUpload.server";
import { extractAfmExperimentalMetadata } from "../afm/experimentalMetadata";
import { classroomAfmResult, liveAfmCurveCsv, liveAfmCurvePng, readLiveAfmArtifact, saveLiveAfmArtifact } from "./liveAfm.server";

async function main() {
  const metadata = extractAfmExperimentalMetadata("AFM force-distance curves in [EMIM][TFSI] were measured. All measurements were performed in argon.");
  const candidate: DigitizationCandidate = { id: "panel-A", page: 4, pageLabel: "Panel A", figureLabel: "1", imageDataUrl: "data:image/png;base64,fixture", sourceFigure: { kind: "pdf-panel-crop", width: 300, height: 200, renderScale: 3, crop: null }, panel: null, paperSignal: 1, rankScore: 1,
    analysis: { width: 300, height: 200, plotBox: { left: 0, right: 1, top: 0, bottom: 1 }, normalizedPoints: [{ x: 0, y: 1 }, { x: 0.3, y: 0 }, { x: 0.7, y: 0.1 }], segmentStarts: [2], traceColor: null, confidence: 1, axisConfidence: 1, traceConfidence: 1, coverage: 1, isLikelyCurve: true, rejectionReasons: [], xSpan: 1, ySpan: 1, largestSegmentShare: 1, quality: "high", warnings: [] },
    axisCalibration: { status: "auto-calibrated", axes: { xMin: 3, xMax: -1, yMin: -2, yMax: 10, xUnit: "nm", yUnit: "nN" }, confidence: 0.9, method: "figure-axis-ocr", evidence: [] } };
  const input = { sourceName: "classroom-fixture.pdf", experimentalMetadata: metadata, candidates: [candidate] } as Awaited<ReturnType<typeof digitizeAfmUpload>>;
  const result = classroomAfmResult(input);
  assert.equal(result.rows.length, 2);
  assert.equal(result.rows[0].value, "-2.00000 nN");
  assert.equal(result.rows[0].separation, "1.80000 nm");
  assert.equal(result.rows[0].potential, "NR", "missing potential must not become zero");
  assert.equal(result.rows[0].temperature, "NR", "missing temperature must not become room temperature");
  assert.match(result.rows[0].evidence, /image-estimated/);
  assert.deepEqual(result.artifact.curves[0].segmentStarts, [2]);
  const id = await saveLiveAfmArtifact(result.artifact);
  assert.deepEqual(await readLiveAfmArtifact(id), result.artifact, "saved curves survive a server reload without browser storage");
  await assert.rejects(readLiveAfmArtifact("../../secret"), /Invalid/);
  assert.match(liveAfmCurveCsv(result.artifact.curves[0]), /Separation \(nm\)/);
  assert.match(liveAfmCurveCsv(result.artifact.curves[0]), /not a verified research/);
  assert.equal(liveAfmCurvePng(result.artifact.curves[0]).subarray(1, 4).toString(), "PNG");
  candidate.axisCalibration = { status: "relative-only", axes: null, confidence: 0, method: "relative-pixel-fallback", evidence: [] };
  const relative = classroomAfmResult(input);
  assert.equal(relative.rows.length, 1); assert.equal(relative.rows[0].value, "NR");
  assert.equal(relative.artifact.curves[0].axes, null);
  assert.match(liveAfmCurveCsv(relative.artifact.curves[0]), /not physical/);
  console.log("AFM classroom artifact persistence, reversed axes, physical / relative exports and conservative landmarks passed");
}
main();
