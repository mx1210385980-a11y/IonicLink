import path from "node:path";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { createWorker, OEM, PSM, type Worker } from "tesseract.js";
import type { AfmAutomaticAxisCalibration, AfmPhysicalAxes } from "./axisCalibration";
import type { AfmPlotBox } from "./digitizeCurve";

interface OcrWord {
  text: string;
  confidence: number;
  left: number;
  top: number;
  width: number;
  height: number;
}

interface AxisOcrInput {
  text: string;
  tsv: string;
  width: number;
  height: number;
  plotBox: AfmPlotBox;
}

interface AxisTick {
  value: number;
  position: number;
  confidence: number;
}

let workerPromise: Promise<Worker> | null = null;

function getWorker() {
  if (!workerPromise) {
    // The language model is installed with the application. Axis recognition
    // therefore works offline and never depends on a CDN during PDF upload.
    const languagePath = path.join(process.cwd(), "node_modules", "@tesseract.js-data", "eng", "4.0.0_best_int");
    workerPromise = createWorker("eng", OEM.LSTM_ONLY, {
      langPath: languagePath,
      gzip: true,
      cacheMethod: "none",
    }).then(async (worker) => {
      await worker.setParameters({
        // Plot panels contain sparse, disconnected tick labels rather than a
        // prose block. Sparse-text segmentation reliably retains labels such
        // as "s (nm)" and "F (nN)" that AUTO can discard entirely.
        tessedit_pageseg_mode: PSM.SPARSE_TEXT,
        preserve_interword_spaces: "1",
      });
      return worker;
    }).catch((error) => {
      workerPromise = null;
      throw error;
    });
  }
  return workerPromise;
}

/** OCR a cropped plot and recover physical axis endpoints from positioned ticks. */
export async function inferAfmAxisCalibrationFromImage(
  image: Buffer,
  input: { width: number; height: number; plotBox: AfmPlotBox },
): Promise<AfmAutomaticAxisCalibration> {
  try {
    const worker = await getWorker();
    const result = await worker.recognize(image, {}, { text: true, tsv: true });
    const initial = parseAfmAxisOcr({
      text: result.data.text ?? "",
      tsv: result.data.tsv ?? "",
      ...input,
    });
    if (initial.status === "auto-calibrated" || initial.partialAxes?.yUnit) return initial;
    const rotatedYAxisText = await recognizeRotatedYAxis(worker, image, input);
    return parseAfmAxisOcr({
      text: `${result.data.text ?? ""}\n${rotatedYAxisText}`,
      tsv: result.data.tsv ?? "",
      ...input,
    });
  } catch (error) {
    return {
      status: "relative-only",
      axes: null,
      confidence: 0,
      method: "relative-pixel-fallback",
      evidence: [`Axis OCR was unavailable: ${error instanceof Error ? error.message : String(error)}`],
    };
  }
}

async function recognizeRotatedYAxis(
  worker: Worker,
  image: Buffer,
  input: { width: number; height: number; plotBox: AfmPlotBox },
) {
  const source = await loadImage(image);
  const stripWidth = Math.max(1, Math.min(input.width, input.plotBox.left));
  const stripHeight = Math.max(1, Math.min(input.height, input.plotBox.bottom + Math.round(input.height * 0.03)));
  const canvas = createCanvas(stripHeight, stripWidth);
  const context = canvas.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.translate(stripHeight, 0);
  context.rotate(Math.PI / 2);
  context.drawImage(source, 0, 0, stripWidth, stripHeight, 0, 0, stripWidth, stripHeight);
  const result = await worker.recognize(canvas.toBuffer("image/png"), {}, { text: true });
  return result.data.text ?? "";
}

export function parseAfmAxisOcr(input: AxisOcrInput): AfmAutomaticAxisCalibration {
  const words = parseTsvWords(input.tsv);
  const xTicks = collectXTicks(words, input.plotBox, input.width, input.height);
  const yTicks = collectYTicks(words, input.plotBox, input.width, input.height);
  const xRange = fitAxisTicks(xTicks, input.plotBox.left, input.plotBox.right);
  const yRange = fitAxisTicks(yTicks, input.plotBox.top, input.plotBox.bottom);
  const units = extractAxisUnits(input.text);

  if (!xRange || !yRange || !units.xUnit || !units.yUnit) {
    const missing = [
      !xRange ? "horizontal tick endpoints" : null,
      !yRange ? "vertical tick endpoints" : null,
      !units.xUnit ? "horizontal unit" : null,
      !units.yUnit ? "vertical unit" : null,
    ].filter(Boolean).join(", ");
    return {
      status: "relative-only",
      axes: null,
      partialAxes: {
        ...(xRange ? { xMin: round(xRange.start, 6), xMax: round(xRange.end, 6) } : {}),
        ...(yRange ? { yMin: round(yRange.end, 6), yMax: round(yRange.start, 6) } : {}),
        ...(units.xUnit ? { xUnit: units.xUnit } : {}),
        ...(units.yUnit ? { yUnit: units.yUnit } : {}),
      },
      confidence: 0,
      method: "relative-pixel-fallback",
      evidence: [`OCR did not resolve ${missing}.`],
    };
  }

  const axes: AfmPhysicalAxes = {
    xMin: round(xRange.start, 6),
    xMax: round(xRange.end, 6),
    yMin: round(yRange.end, 6),
    yMax: round(yRange.start, 6),
    xUnit: units.xUnit,
    yUnit: units.yUnit,
  };
  if (axes.xMin === axes.xMax || axes.yMin === axes.yMax) {
    return {
      status: "relative-only",
      axes: null,
      confidence: 0,
      method: "relative-pixel-fallback",
      evidence: ["OCR tick labels did not define non-zero physical axis ranges."],
    };
  }

  const confidence = Math.min(0.97, 0.78 + Math.min(0.1, (xTicks.length + yTicks.length - 4) * 0.015));
  return {
    status: "auto-calibrated",
    axes,
    confidence: round(confidence, 4),
    method: "figure-axis-ocr",
    evidence: [
      `Positioned OCR resolved ${xTicks.length} horizontal and ${yTicks.length} vertical tick label(s).`,
      `Axis labels identify ${units.xLabel ?? "separation"} (${units.xUnit}) and ${units.yLabel ?? "force"} (${units.yUnit}).`,
    ],
  };
}

function parseTsvWords(tsv: string): OcrWord[] {
  return tsv.split(/\r?\n/).slice(1).flatMap((line) => {
    const columns = line.split("\t");
    if (columns.length < 12 || columns[0] !== "5") return [];
    const [left, top, width, height, confidence] = columns.slice(6, 11).map(Number);
    const text = columns.slice(11).join("\t").trim();
    if (!text || ![left, top, width, height, confidence].every(Number.isFinite) || confidence < 12) return [];
    return [{ text, confidence, left, top, width, height }];
  });
}

function collectXTicks(words: OcrWord[], box: AfmPlotBox, width: number, height: number): AxisTick[] {
  const tolerance = Math.max(18, height * 0.09);
  return deduplicateTicks(words.flatMap((word) => {
    const value = parseTickNumber(word.text);
    const x = word.left + word.width / 2;
    const y = word.top + word.height / 2;
    if (value === null || x < box.left - width * 0.025 || x > box.right + width * 0.025) return [];
    if (y < box.bottom - height * 0.025 || y > box.bottom + tolerance) return [];
    return [{ value, position: x, confidence: word.confidence }];
  }), Math.max(4, width * 0.012));
}

function collectYTicks(words: OcrWord[], box: AfmPlotBox, width: number, height: number): AxisTick[] {
  const tolerance = Math.max(18, width * 0.1);
  return deduplicateTicks(words.flatMap((word) => {
    const value = parseTickNumber(word.text);
    const x2 = word.left + word.width;
    const y = word.top + word.height / 2;
    if (value === null || y < box.top - height * 0.025 || y > box.bottom + height * 0.025) return [];
    if (x2 < box.left - tolerance || x2 > box.left + width * 0.025) return [];
    return [{ value, position: y, confidence: word.confidence }];
  }), Math.max(4, height * 0.012));
}

function deduplicateTicks(ticks: AxisTick[], positionTolerance: number) {
  const kept: AxisTick[] = [];
  for (const tick of [...ticks].sort((a, b) => b.confidence - a.confidence)) {
    if (kept.some((item) => Math.abs(item.position - tick.position) <= positionTolerance)) continue;
    kept.push(tick);
  }
  return kept.sort((a, b) => a.position - b.position);
}

function fitAxisTicks(ticks: AxisTick[], axisStart: number, axisEnd: number): { start: number; end: number } | null {
  if (ticks.length < 2) return null;
  let best: { score: number; start: number; end: number } | null = null;
  for (let first = 0; first < ticks.length - 1; first += 1) {
    for (let last = first + 1; last < ticks.length; last += 1) {
      const a = ticks[first];
      const b = ticks[last];
      const positionSpan = b.position - a.position;
      const valueSpan = b.value - a.value;
      if (Math.abs(positionSpan) < 12 || valueSpan === 0) continue;
      const slope = valueSpan / positionSpan;
      const inliers = ticks.filter((tick) => {
        const predicted = a.value + (tick.position - a.position) * slope;
        const tolerance = Math.max(0.08, Math.abs(valueSpan) * 0.035);
        return Math.abs(predicted - tick.value) <= tolerance;
      });
      if (inliers.length < 2) continue;
      const positionCoverage = (Math.max(...inliers.map((item) => item.position)) - Math.min(...inliers.map((item) => item.position))) /
        Math.max(1, Math.max(...ticks.map((item) => item.position)) - Math.min(...ticks.map((item) => item.position)));
      const score = inliers.length * 2 + positionCoverage + inliers.reduce((sum, item) => sum + item.confidence / 100, 0) * 0.12;
      if (!best || score > best.score) {
        const sorted = [...inliers].sort((left, right) => left.position - right.position);
        const firstInlier = sorted[0];
        const lastInlier = sorted[sorted.length - 1];
        const fittedSlope = (lastInlier.value - firstInlier.value) / (lastInlier.position - firstInlier.position);
        best = {
          score,
          start: firstInlier.value + (axisStart - firstInlier.position) * fittedSlope,
          end: firstInlier.value + (axisEnd - firstInlier.position) * fittedSlope,
        };
      }
    }
  }
  return best ? { start: best.start, end: best.end } : null;
}

function parseTickNumber(value: string): number | null {
  const normalized = value
    .replace(/[−–—]/g, "-")
    .replace(/(?<=^|-)O(?=\d|$)/gi, "0")
    .replace(/,/g, ".")
    .replace(/[^0-9.+-]/g, "");
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && Math.abs(parsed) <= 1e5 ? parsed : null;
}

function extractAxisUnits(text: string) {
  const compact = text.replace(/\s+/g, " ");
  const x = compact.match(/((?:apparent\s+)?(?:separation|distance)|\bs)\s*[\[(]\s*(nm|Å|angstrom|µm|um)\s*[\])]/i);
  const y = compact.match(/((?:normal\s+)?force|\bF)\s*[\[(]\s*(pN|nN|µN|uN|mN|N)\s*[\])]/i);
  return {
    xLabel: x?.[1] ?? null,
    yLabel: y?.[1] ?? null,
    xUnit: x ? normalizeUnit(x[2]) : null,
    yUnit: y ? normalizeUnit(y[2]) : null,
  };
}

function normalizeUnit(value: string) {
  return value.replace(/^u/i, "µ").replace(/^angstrom$/i, "Å");
}

function round(value: number, digits: number) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
