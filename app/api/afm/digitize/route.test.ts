import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createCanvas } from "@napi-rs/canvas";
import { NextRequest } from "next/server";
import { createTestAppSession } from "@/lib/auth.test-helpers";
import { POST } from "./route";

async function main() {
  const { cookie } = await createTestAppSession();
  const canvas = createCanvas(360, 240);
  const context = canvas.getContext("2d");
  context.fillStyle = "white";
  context.fillRect(0, 0, 360, 240);
  context.strokeStyle = "#111827";
  context.lineWidth = 2;
  context.beginPath(); context.moveTo(42, 20); context.lineTo(42, 205); context.lineTo(335, 205); context.stroke();
  context.strokeStyle = "#28377f";
  context.lineWidth = 5;
  context.beginPath();
  for (let index = 0; index <= 220; index += 1) {
    const x = index < 55 ? 88 + Math.sin(index / 5) * 2 : 88 + index;
    const y = index < 55 ? 32 + index * 2.4 : 165 + Math.sin(index / 8) * 4;
    if (index === 0) context.moveTo(x, y); else context.lineTo(x, y);
  }
  context.stroke();

  const form = new FormData();
  const png = canvas.toBuffer("image/png");
  const pngArrayBuffer = png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength) as ArrayBuffer;
  form.set("file", new File([pngArrayBuffer], "synthetic-afm.png", { type: "image/png" }));
  const response = await POST(new NextRequest("http://localhost/api/afm/digitize", {
    method: "POST",
    headers: { cookie, origin: "http://localhost" },
    body: form,
  }));
  assert.equal(response.status, 200);
  const payload = await response.json() as {
    sourceName: string;
    sourceType: string;
    schemaVersion: number;
    candidates: Array<{
      imageDataUrl: string;
      sourceFigure: { kind: string; width: number; height: number; renderScale: number | null };
      panel: unknown;
      analysis: { normalizedPoints: unknown[]; axisConfidence: number };
    }>;
    matchedPaper: { doi: string; curveIds: string[] } | null;
    axisCalibration: { status: string; axes: unknown };
    reviewRequired: boolean;
  };
  assert.equal(payload.sourceName, "synthetic-afm.png");
  assert.equal(payload.sourceType, "image");
  assert.equal(payload.schemaVersion, 4);
  assert.equal(payload.reviewRequired, true);
  assert.equal(payload.matchedPaper, null);
  assert.equal(payload.axisCalibration.status, "relative-only");
  assert.match(payload.candidates[0].imageDataUrl, /^data:image\/png;base64,/);
  assert.equal(payload.candidates[0].sourceFigure.kind, "uploaded-image");
  assert.equal(payload.candidates[0].sourceFigure.width, 360);
  assert.equal(payload.candidates[0].sourceFigure.height, 240);
  assert.equal(payload.candidates[0].sourceFigure.renderScale, null);
  assert.equal(payload.candidates[0].panel, null);
  assert.ok(payload.candidates[0].analysis.normalizedPoints.length > 20);
  assert.ok(payload.candidates[0].analysis.axisConfidence > 0.5);

  const benchmarkPdf = process.env.AFM_MULTIPANEL_PDF;
  if (benchmarkPdf) {
    const pdf = await readFile(benchmarkPdf);
    const pdfArrayBuffer = pdf.buffer.slice(pdf.byteOffset, pdf.byteOffset + pdf.byteLength) as ArrayBuffer;
    const pdfForm = new FormData();
    pdfForm.set("file", new File([pdfArrayBuffer], "15.pdf", { type: "application/pdf" }));
    const pdfResponse = await POST(new NextRequest("http://localhost/api/afm/digitize", {
      method: "POST",
      headers: { cookie, origin: "http://localhost" },
      body: pdfForm,
    }));
    assert.equal(pdfResponse.status, 200);
    const pdfPayload = await pdfResponse.json() as {
      schemaVersion: number;
      totalPages: number;
      axisCalibration: {
        status: string;
        confidence: number;
        method: string;
        axes: { xMin: number; xMax: number; yMin: number; yMax: number; xUnit: string; yUnit: string } | null;
      };
      candidates: Array<{
        sourceFigure: { kind: string };
        panel: {
          label: string;
          conditions: {
            ionicLiquid: { value: string; status: string };
            substrate: { value: string; status: string };
            electrodePotential: { value: number; unit: string; status: string };
          };
        } | null;
        analysis: {
          width: number;
          height: number;
          plotBox: { left: number; right: number; top: number; bottom: number };
          normalizedPoints: Array<{ x: number; y: number }>;
          segmentStarts: number[];
        };
      }>;
    };
    assert.equal(pdfPayload.schemaVersion, 4);
    assert.equal(pdfPayload.totalPages, 9);
    assert.equal(pdfPayload.candidates.length, 20);
    assert.equal(pdfPayload.axisCalibration.status, "auto-calibrated");
    assert.equal(pdfPayload.axisCalibration.method, "verified-source-profile");
    assert.ok(pdfPayload.axisCalibration.confidence >= 0.98);
    assert.deepEqual(pdfPayload.axisCalibration.axes, { xMin: -1, xMax: 3, yMin: -2, yMax: 12, xUnit: "nm", yUnit: "nN" });
    assert.deepEqual(pdfPayload.candidates.map((item) => item.panel?.label), "ABCDEFGHIJKLMNOPQRST".split(""));
    assert.ok(pdfPayload.candidates.every((item) => item.sourceFigure.kind === "pdf-panel-crop"));
    const pointCounts = pdfPayload.candidates.map((item) => item.analysis.normalizedPoints.length);
    assert.ok(pointCounts.every((count) => count > 20), `centreline point counts: ${pointCounts.join(",")}`);
    assert.ok(pointCounts.reduce((sum, count) => sum + count, 0) / pointCounts.length > 70, `centreline density: ${pointCounts.join(",")}`);
    assert.ok(pdfPayload.candidates.every((item) => (
      (item.analysis.plotBox.right - item.analysis.plotBox.left) / item.analysis.width > 0.9
    )), "multi-panel plot boxes must retain the complete shared x axis instead of tightening around the strongest trace fragment");
    assert.ok(pdfPayload.candidates.every((item) => item.analysis.segmentStarts[0] === 0));
    assert.ok(pdfPayload.candidates.every((item) => Math.max(...item.analysis.normalizedPoints.map((point) => point.x)) > 0.72), "long-distance tails must remain inside the digitized panel");
    assert.ok(pdfPayload.candidates.every((item) => Math.min(...item.analysis.normalizedPoints.map((point) => point.x)) > 0.055), "coloured antialiasing on the left plot frame must not become a curve segment");
    assert.ok(pdfPayload.candidates.every((item) => Math.min(...item.analysis.normalizedPoints.map((point) => point.y)) > 0.03), "bottom axes and tick-label antialiasing must not become a curve segment");
    assert.ok(pdfPayload.candidates[1].analysis.segmentStarts.length >= 3, "panel B should preserve its disconnected published trace fragments");
    assert.ok(pdfPayload.candidates[3].analysis.segmentStarts.length >= 3, "panel D should preserve its disconnected published trace fragments");
    assert.equal(pdfPayload.candidates[2].analysis.segmentStarts.length, 1, "panel C is one continuous published trace and must not acquire an artificial loop or break");
    const panelA = pdfPayload.candidates[0].panel!;
    assert.deepEqual(
      [panelA.conditions.ionicLiquid.value, panelA.conditions.substrate.value, panelA.conditions.electrodePotential.value],
      ["[Li(G4)]TFSI", "HOPG", 1],
    );
    const panelT = pdfPayload.candidates[19].panel!;
    assert.deepEqual(
      [panelT.conditions.ionicLiquid.value, panelT.conditions.substrate.value, panelT.conditions.electrodePotential.value],
      ["[Li(G4)]NO3", "Au(111)", -1],
    );
    assert.ok(pdfPayload.candidates.every((item) => item.panel?.conditions.ionicLiquid.status === "inferred"));
  }

  const externalSingleFigurePdf = process.env.AFM_EXTERNAL_SINGLEFIGURE_PDF;
  if (externalSingleFigurePdf) {
    const pdf = await readFile(externalSingleFigurePdf);
    const pdfArrayBuffer = pdf.buffer.slice(pdf.byteOffset, pdf.byteOffset + pdf.byteLength) as ArrayBuffer;
    const pdfForm = new FormData();
    pdfForm.set("file", new File([pdfArrayBuffer], "jstage-2024-alcl3-emimcl-hopg-afm.pdf", { type: "application/pdf" }));
    const pdfResponse = await POST(new NextRequest("http://localhost/api/afm/digitize", {
      method: "POST",
      headers: { cookie, origin: "http://localhost" },
      body: pdfForm,
    }));
    assert.equal(pdfResponse.status, 200);
    const pdfPayload = await pdfResponse.json() as {
      axisCalibration: {
        status: string;
        axes: { xMin: number; xMax: number; yMin: number; yMax: number; xUnit: string; yUnit: string } | null;
      };
      candidates: Array<{
        page: number | null;
        sourceFigure: { kind: string; crop: { left: number; right: number; top: number; bottom: number } | null };
        analysis: { normalizedPoints: unknown[]; traceColor: { r: number; g: number; b: number } | null; isLikelyCurve: boolean };
      }>;
    };
    assert.ok(pdfPayload.candidates.some((item) => item.page === 4), "the external paper's Figure 6 page must be retained");
    const figure6 = pdfPayload.candidates.find((item) => item.page === 4)!;
    assert.equal(pdfPayload.candidates.length, 1, "caption-anchored Figure 6 must suppress whole-page colour false positives");
    assert.equal(figure6.sourceFigure.kind, "pdf-figure-crop");
    assert.ok(figure6.sourceFigure.crop && figure6.sourceFigure.crop.left < 0.1 && figure6.sourceFigure.crop.right < 0.55, "the primary panel must exclude the enlarged panel and red zoom connector");
    assert.ok(figure6.analysis.normalizedPoints.length > 40);
    assert.equal(figure6.analysis.isLikelyCurve, true);
    assert.ok(figure6.analysis.traceColor && figure6.analysis.traceColor.b > figure6.analysis.traceColor.r, "the blue AFM measurement must outrank red annotations");
    assert.equal(pdfPayload.axisCalibration.status, "auto-calibrated");
    assert.deepEqual(pdfPayload.axisCalibration.axes, { xMin: -1, xMax: 10, yMin: 0, yMax: 2, xUnit: "nm", yUnit: "nN" });
  }

  console.log("AFM digitize API tests passed");
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
