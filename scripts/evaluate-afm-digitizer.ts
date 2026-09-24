import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { AFM_CURVE_DATASET } from "../lib/afm/afmCurves";
import { digitizeAfmRgba, type AfmNormalizedPoint } from "../lib/afm/digitizeCurve";

interface EvaluationRow {
  id: string;
  source: string;
  confidence: number;
  axisConfidence: number;
  traceConfidence: number;
  quality: string;
  points: number;
  referencePoints: number;
  precisionAt006: number;
  recallAt006: number;
  shapeF1At006: number;
  warnings: string[];
}

const args = process.argv.slice(2);
void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

async function main() {
  const root = option("--root") ?? process.env.AFM_CURVE_ROOT ?? "";
  const output = option("--out");
  const limit = Number(option("--limit") ?? "0");
  if (!root) throw new Error("Pass --root <curve-data-folder> or set AFM_CURVE_ROOT.");

  const eligible = AFM_CURVE_DATASET.curves.filter((curve) => curve.collection === "qualified-new" && curve.source.imagePath);
  const rows: EvaluationRow[] = [];
  let missing = 0;

  for (const curve of eligible) {
  if (limit > 0 && rows.length >= limit) break;
  const relative = curve.source.imagePath!.replace(/^external:\/\/curve-data\//, "").replace(/\//g, path.sep);
  const imagePath = path.join(root, relative);
  if (!existsSync(imagePath)) {
    missing += 1;
    continue;
  }
  const image = await loadImage(imagePath);
  const scale = Math.min(1, 1600 / Math.max(image.width, image.height));
  const width = Math.round(image.width * scale);
  const height = Math.round(image.height * scale);
  const canvas = createCanvas(width, height);
  const context = canvas.getContext("2d");
  context.fillStyle = "white";
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);
  const pixels = context.getImageData(0, 0, width, height);
  const analysis = digitizeAfmRgba({ width, height, data: pixels.data });
  const prediction = normalizeCloud(analysis.normalizedPoints);
  const reference = normalizeCloud(curve.points.map(([x, y]) => ({ x, y })));
  const precision = withinDistanceFraction(prediction, reference, 0.06);
  const recall = withinDistanceFraction(reference, prediction, 0.06);
  const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
  rows.push({
    id: curve.id,
    source: relative.replace(/\\/g, "/"),
    confidence: analysis.confidence,
    axisConfidence: analysis.axisConfidence,
    traceConfidence: analysis.traceConfidence,
    quality: analysis.quality,
    points: analysis.normalizedPoints.length,
    referencePoints: curve.points.length,
    precisionAt006: round(precision),
    recallAt006: round(recall),
    shapeF1At006: round(f1),
    warnings: analysis.warnings,
  });
  process.stdout.write(`\rEvaluated ${rows.length}/${Math.min(eligible.length, limit > 0 ? limit : eligible.length)} curves`);
  }
  process.stdout.write("\n");

  const f1Values = rows.map((row) => row.shapeF1At006).sort((a, b) => a - b);
  const report = {
  schema: "ioniclink.afm-digitizer-benchmark",
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  corpus: "qualified AFM curve/image pairs from the manually digitized local corpus",
  method: {
    note: "Reference and detected point clouds are independently min-max normalized. This measures curve-shape pixel recovery, not physical-axis OCR accuracy.",
    matchRadius: 0.06,
    requiredReview: "Axis limits and units are always confirmed by a reviewer.",
  },
  summary: {
    eligible: eligible.length,
    evaluated: rows.length,
    missing,
    highConfidence: rows.filter((row) => row.quality === "high").length,
    mediumConfidence: rows.filter((row) => row.quality === "medium").length,
    lowConfidence: rows.filter((row) => row.quality === "low").length,
    medianShapeF1At006: round(percentile(f1Values, 0.5)),
    p25ShapeF1At006: round(percentile(f1Values, 0.25)),
    p75ShapeF1At006: round(percentile(f1Values, 0.75)),
    meanShapeF1At006: round(rows.reduce((sum, row) => sum + row.shapeF1At006, 0) / Math.max(1, rows.length)),
  },
  lowestScoring: [...rows].sort((a, b) => a.shapeF1At006 - b.shapeF1At006).slice(0, 12),
  rows,
  };

  console.log(JSON.stringify(report.summary, null, 2));
  if (output) {
    const outputPath = path.resolve(output);
    mkdirSync(path.dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    console.log(`Wrote ${outputPath}`);
  }
}

function option(name: string) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function normalizeCloud(points: AfmNormalizedPoint[]) {
  if (!points.length) return [];
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs); const maxX = Math.max(...xs); const minY = Math.min(...ys); const maxY = Math.max(...ys);
  const xRange = Math.max(1e-9, maxX - minX); const yRange = Math.max(1e-9, maxY - minY);
  const stride = Math.max(1, Math.floor(points.length / 450));
  return points.filter((_, index) => index % stride === 0).map((point) => ({ x: (point.x - minX) / xRange, y: (point.y - minY) / yRange }));
}

function withinDistanceFraction(source: AfmNormalizedPoint[], target: AfmNormalizedPoint[], radius: number) {
  if (!source.length || !target.length) return 0;
  const radiusSquared = radius ** 2;
  let matched = 0;
  for (const point of source) {
    let nearest = Number.POSITIVE_INFINITY;
    for (const other of target) {
      const distance = (point.x - other.x) ** 2 + (point.y - other.y) ** 2;
      if (distance < nearest) nearest = distance;
      if (nearest <= radiusSquared) break;
    }
    if (nearest <= radiusSquared) matched += 1;
  }
  return matched / source.length;
}

function percentile(values: number[], fraction: number) {
  if (!values.length) return 0;
  const position = (values.length - 1) * fraction;
  const lower = Math.floor(position); const upper = Math.ceil(position);
  if (lower === upper) return values[lower];
  return values[lower] + (values[upper] - values[lower]) * (position - lower);
}

function round(value: number) {
  return Number((Number.isFinite(value) ? value : 0).toFixed(4));
}
