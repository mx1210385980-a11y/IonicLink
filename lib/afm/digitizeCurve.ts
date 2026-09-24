export interface AfmPlotBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface AfmNormalizedPoint {
  /** Fraction measured from the left edge of the detected plot. */
  x: number;
  /** Fraction measured upward from the bottom edge of the detected plot. */
  y: number;
}

export interface AfmDigitizationAnalysis {
  width: number;
  height: number;
  plotBox: AfmPlotBox;
  normalizedPoints: AfmNormalizedPoint[];
  /** Zero-based indices where a disconnected trace segment begins. */
  segmentStarts: number[];
  traceColor: { r: number; g: number; b: number; hex: string } | null;
  confidence: number;
  axisConfidence: number;
  traceConfidence: number;
  coverage: number;
  /** True only when the image contains enough axis and trace evidence to be treated as an AFM curve. */
  isLikelyCurve: boolean;
  rejectionReasons: string[];
  xSpan: number;
  ySpan: number;
  largestSegmentShare: number;
  quality: "high" | "medium" | "low";
  warnings: string[];
  traceMode?: "line-centreline" | "density-ridge" | "monochrome-fallback";
}

export interface AfmDigitizationOptions {
  /** 0 is strict and 1 is permissive. */
  sensitivity?: number;
  /** Optional plot rectangle supplied by a reviewer. */
  plotBox?: AfmPlotBox;
  /** Remove coloured subpixel antialiasing from regular panel frame lines. */
  frameArtifactGuard?: boolean;
  /** Density plots require the high-density ridge, not a low-density colour envelope. */
  traceMode?: "line" | "density-ridge";
  /** Caption-defined colour representing the greatest observation density. */
  densityPeakColor?: "yellow" | "bright";
}

interface PixelSource {
  width: number;
  height: number;
  data: Uint8ClampedArray | Uint8Array;
}

interface Run {
  start: number;
  end: number;
  hits: number;
}

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

/**
 * Deterministic, local-first AFM curve digitizer.
 *
 * It deliberately separates image recognition from physical calibration:
 * this function finds plot pixels and returns plot-relative coordinates only.
 * The UI must obtain axis limits and units from the paper or the reviewer before
 * converting these fractions into physical values.
 */
export function digitizeAfmRgba(source: PixelSource, options: AfmDigitizationOptions = {}): AfmDigitizationAnalysis {
  const { width, height, data } = source;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 24 || height < 24) {
    throw new Error("The uploaded figure is too small to digitize.");
  }
  if (data.length < width * height * 4) throw new Error("The image pixel buffer is incomplete.");

  const detectedAxes = detectPlotBox(source);
  let plotBox = normalizePlotBox(options.plotBox ?? detectedAxes.box, width, height);
  const sensitivity = clamp01(options.sensitivity ?? 0.48);
  const frameArtifactGuard = Boolean(options.frameArtifactGuard);
  const densityMode = options.traceMode === "density-ridge";
  let trace = densityMode
    ? detectDensityRidge(source, plotBox, sensitivity, options.densityPeakColor ?? "bright")
    : detectDominantTrace(source, plotBox, sensitivity, frameArtifactGuard);
  let plotBoxInferredFromTrace = false;
  if (!options.plotBox && detectedAxes.confidence < 0.55 && !trace.fallbackUsed && trace.points.length >= 30 && trace.maskDensity < 0.12) {
    const refined = inferPlotBoxFromTrace(plotBox, trace.points, width, height);
    if (refined) {
      plotBox = refined;
      trace = densityMode
        ? detectDensityRidge(source, plotBox, sensitivity, options.densityPeakColor ?? "bright")
        : detectDominantTrace(source, plotBox, sensitivity, frameArtifactGuard);
      plotBoxInferredFromTrace = true;
    }
  }
  if (trace.points.length < 10 && !densityMode) trace = detectDarkTrace(source, plotBox, sensitivity);
  const warnings: string[] = [];

  if (detectedAxes.confidence < 0.55 && !options.plotBox) {
    warnings.push("Plot axes were estimated. Confirm the crop before using the coordinates.");
  }
  if (plotBoxInferredFromTrace) warnings.push("The plot rectangle was tightened around the recognised trace and still requires visual confirmation.");
  if (!trace.color) warnings.push(densityMode ? "No stable high-density ridge was found." : "No sufficiently distinct coloured trace was found.");
  if (trace.fallbackUsed) warnings.push("A black/grey trace fallback was used; labels and arrows require close overlay review.");
  if (trace.coverage < 0.24) warnings.push("Only part of the plot contains a recognised trace; inspect the overlay for gaps.");
  if (trace.maskDensity > 0.16) warnings.push("A large coloured region was detected; this may be a heat map or multi-panel figure rather than a single curve.");
  if (trace.annotationRisk > 0.2) warnings.push("Coloured labels or arrows may be mixed with the extracted trace.");
  if (densityMode) warnings.push("A bivariate density plot was identified; the exported centreline follows the caption-defined high-density ridge, not the low-density envelope.");
  warnings.push("Physical axis values and units are resolved from the paper before export; unresolved axes keep the result out of the dataset.");

  const xs = trace.points.map((point) => point.x);
  const ys = trace.points.map((point) => point.y);
  const xSpan = xs.length ? Math.max(...xs) - Math.min(...xs) : 0;
  const ySpan = ys.length ? Math.max(...ys) - Math.min(...ys) : 0;
  const starts = trace.segmentStarts.length ? trace.segmentStarts : trace.points.length ? [0] : [];
  const segmentLengths = starts.map((start, index) => (starts[index + 1] ?? trace.points.length) - start);
  const largestSegmentShare = trace.points.length ? Math.max(0, ...segmentLengths) / trace.points.length : 0;
  const structuredMultiTrace = detectedAxes.confidence >= 0.82 && trace.coverage >= 0.6 && starts.length <= 4 && largestSegmentShare >= 0.42;
  const continuousMonochromeTrace = trace.fallbackUsed && trace.coverage >= 0.6 && largestSegmentShare >= 0.75 && xSpan >= 0.55 && ySpan >= 0.35;
  const rejectionReasons: string[] = [];
  if (trace.points.length < 24) rejectionReasons.push("Too few connected trace samples were found.");
  if (!options.plotBox && detectedAxes.confidence < 0.42 && !continuousMonochromeTrace) rejectionReasons.push("No reliable pair of plot axes was detected.");
  if (Math.max(xSpan, ySpan) < 0.3 || xSpan < 0.08 || ySpan < 0.08) rejectionReasons.push("The detected pixels do not span a plausible force-distance trace.");
  if (trace.coverage < 0.16) rejectionReasons.push("Trace coverage is too small for a publishable curve.");
  if (trace.maskDensity > 0.18) rejectionReasons.push("The coloured region is too dense to be a single curve.");
  // A density maximum is commonly rendered as disconnected islands at each
  // solvation layer.  Treating those islands like fragments from an ordinary
  // line plot incorrectly rejects a valid force profile after the annotation
  // colours have already been excluded by the peak-colour mask.
  if (!densityMode && starts.length > 10 && largestSegmentShare < 0.24) rejectionReasons.push("The result is dominated by disconnected text or annotation fragments.");
  if (trace.annotationRisk > 0.72 && !structuredMultiTrace) rejectionReasons.push("The detected colour is more consistent with labels or arrows than a continuous curve.");
  const isLikelyCurve = rejectionReasons.length === 0;
  if (!isLikelyCurve) warnings.unshift(...rejectionReasons);

  const traceConfidence = clamp01(
    trace.colorConfidence * 0.34 +
      Math.min(1, trace.coverage / 0.62) * 0.38 +
      Math.min(1, trace.points.length / 80) * 0.18 +
      (1 - Math.min(1, trace.maskDensity / 0.2)) * 0.1 -
      trace.annotationRisk * 0.24 -
      (trace.fallbackUsed ? 0.08 : 0),
  );
  const confidence = clamp01(detectedAxes.confidence * 0.42 + traceConfidence * 0.58);
  const quality = isLikelyCurve && !trace.fallbackUsed && confidence >= 0.78 ? "high" : isLikelyCurve && confidence >= 0.5 ? "medium" : "low";

  return {
    width,
    height,
    plotBox,
    normalizedPoints: trace.points,
    segmentStarts: trace.segmentStarts,
    traceColor: trace.color,
    confidence: round(confidence, 4),
    axisConfidence: round(detectedAxes.confidence, 4),
    traceConfidence: round(traceConfidence, 4),
    coverage: round(trace.coverage, 4),
    isLikelyCurve,
    rejectionReasons,
    xSpan: round(xSpan, 4),
    ySpan: round(ySpan, 4),
    largestSegmentShare: round(largestSegmentShare, 4),
    quality,
    warnings,
    traceMode: densityMode ? "density-ridge" : trace.fallbackUsed ? "monochrome-fallback" : "line-centreline",
  };
}

function inferPlotBoxFromTrace(box: AfmPlotBox, points: AfmNormalizedPoint[], width: number, height: number): AfmPlotBox | null {
  const plotWidth = box.right - box.left;
  const plotHeight = box.bottom - box.top;
  const xs = points.map((point) => box.left + point.x * plotWidth).sort((a, b) => a - b);
  const ys = points.map((point) => box.bottom - point.y * plotHeight).sort((a, b) => a - b);
  const minX = percentile(xs, 0.02); const maxX = percentile(xs, 0.98);
  const minY = percentile(ys, 0.02); const maxY = percentile(ys, 0.98);
  const spanX = maxX - minX; const spanY = maxY - minY;
  if (spanX < width * 0.12 || spanY < height * 0.12) return null;
  return normalizePlotBox({
    left: minX - spanX * 0.2,
    right: maxX + spanX * 0.04,
    top: minY - spanY * 0.03,
    bottom: maxY + spanY * 0.23,
  }, width, height);
}

/** Convert reviewed plot-relative coordinates to physical x/y values. */
export function calibrateAfmPoints(
  points: AfmNormalizedPoint[],
  axes: { xMin: number; xMax: number; yMin: number; yMax: number },
): Array<[number, number]> {
  const values = [axes.xMin, axes.xMax, axes.yMin, axes.yMax];
  if (values.some((value) => !Number.isFinite(value))) throw new Error("All four axis limits must be finite numbers.");
  if (axes.xMin === axes.xMax || axes.yMin === axes.yMax) throw new Error("Axis minimum and maximum must be different.");
  return points.map((point) => [
    round(axes.xMin + clamp01(point.x) * (axes.xMax - axes.xMin), 8),
    round(axes.yMin + clamp01(point.y) * (axes.yMax - axes.yMin), 8),
  ]);
}

function detectPlotBox(source: PixelSource): { box: AfmPlotBox; confidence: number } {
  const { width, height } = source;
  const xStart = Math.floor(width * 0.025);
  const xEnd = Math.floor(width * 0.56);
  const yStart = Math.floor(height * 0.025);
  const yEnd = Math.floor(height * 0.94);
  let bestVertical = { x: -1, run: { start: 0, end: 0, hits: 0 }, score: 0 };

  for (let x = xStart; x <= xEnd; x += 1) {
    const run = longestRun(yStart, yEnd, (y) => isAxisPixel(source, x, y), 2);
    const length = run.end - run.start + 1;
    const score = length * (run.hits / Math.max(1, length));
    if (score > bestVertical.score) bestVertical = { x, run, score };
  }

  const horizontalYStart = Math.floor(height * 0.34);
  let bestHorizontal = { y: -1, run: { start: 0, end: 0, hits: 0 }, score: 0 };
  for (let y = horizontalYStart; y <= yEnd; y += 1) {
    const run = longestRun(xStart, Math.floor(width * 0.97), (x) => isAxisPixel(source, x, y), 2);
    const length = run.end - run.start + 1;
    const score = length * (run.hits / Math.max(1, length));
    if (score > bestHorizontal.score) bestHorizontal = { y, run, score };
  }

  const verticalLength = bestVertical.run.end - bestVertical.run.start + 1;
  const horizontalLength = bestHorizontal.run.end - bestHorizontal.run.start + 1;
  const verticalConfidence = clamp01((verticalLength / height - 0.12) / 0.48);
  const horizontalConfidence = clamp01((horizontalLength / width - 0.14) / 0.66);
  const intersectionDistance =
    bestVertical.x < 0 || bestHorizontal.y < 0
      ? 1
      : Math.hypot(
          (bestVertical.x - bestHorizontal.run.start) / width,
          (bestHorizontal.y - bestVertical.run.end) / height,
        );
  const intersectionConfidence = clamp01(1 - intersectionDistance / 0.12);
  const confidence = verticalConfidence * 0.36 + horizontalConfidence * 0.42 + intersectionConfidence * 0.22;

  if (confidence < 0.28) {
    if (verticalConfidence >= 0.38) {
      return {
        box: {
          left: bestVertical.x,
          top: bestVertical.run.start,
          right: Math.round(width * 0.94),
          bottom: bestVertical.run.end,
        },
        confidence: clamp01(0.3 + verticalConfidence * 0.34),
      };
    }
    return {
      box: {
        left: Math.round(width * 0.1),
        top: Math.round(height * 0.06),
        right: Math.round(width * 0.94),
        bottom: Math.round(height * 0.86),
      },
      confidence: 0.18,
    };
  }

  const left = Math.min(bestVertical.x, bestHorizontal.run.start);
  const bottom = Math.max(bestHorizontal.y, bestVertical.run.end);
  return {
    box: {
      left,
      top: bestVertical.run.start,
      right: bestHorizontal.run.end,
      bottom,
    },
    confidence: clamp01(confidence),
  };
}

function detectDominantTrace(source: PixelSource, box: AfmPlotBox, sensitivity: number, frameArtifactGuard: boolean) {
  const bins = new Array<number>(36).fill(0);
  let chromaticPixels = 0;
  for (let y = box.top + 2; y < box.bottom - 1; y += 2) {
    for (let x = box.left + 2; x < box.right - 1; x += 2) {
      const rgb = pixel(source, x, y);
      const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
      if (hsv.s < 0.24 || hsv.v < 0.12 || hsv.v > 0.94) continue;
      bins[Math.floor(hsv.h / 10) % bins.length] += hsv.s * (1.05 - hsv.v * 0.25);
      chromaticPixels += 1;
    }
  }

  const dominantBin = bins.reduce((best, value, index) => (value > bins[best] ? index : best), 0);
  const dominantWeight = bins[dominantBin] || 0;
  const totalWeight = bins.reduce((sum, value) => sum + value, 0);
  if (!chromaticPixels || dominantWeight < 2) {
    return { points: [] as AfmNormalizedPoint[], segmentStarts: [] as number[], color: null, coverage: 0, maskDensity: 0, annotationRisk: 0, colorConfidence: 0, fallbackUsed: false };
  }

  const plotWidth = Math.max(1, box.right - box.left);
  const plotHeight = Math.max(1, box.bottom - box.top);
  const candidateBins = bins
    .map((weight, index) => ({ index, weight }))
    .filter(({ weight }) => weight >= Math.max(2, dominantWeight * 0.045))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 8);

  const traces = candidateBins.map(({ index, weight }) => {
    const hueCenter = index * 10 + 5;
    const hueTolerance = 12 + sensitivity * 18;
    const saturationFloor = 0.34 - sensitivity * 0.16;
    const chromaFloor = 0.18 + (1 - sensitivity) * 0.08;
    const candidates: Array<{ x: number; y: number; r: number; g: number; b: number; density: number }> = [];
    for (let y = box.top + 1; y < box.bottom; y += 1) {
      for (let x = box.left + 1; x < box.right; x += 1) {
        const rgb = pixel(source, x, y);
        const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
        if (hsv.s < saturationFloor || hsv.s * hsv.v < chromaFloor || hsv.v < 0.1 || hsv.v > 0.96 || hueDistance(hsv.h, hueCenter) > hueTolerance) continue;
        const density = coloredNeighbourDensity(source, x, y, hueCenter, hueTolerance, saturationFloor);
        if (density < 0.15 + (1 - sensitivity) * 0.08) continue;
        candidates.push({ x, y, ...rgb, density });
      }
    }

    const maskDensity = candidates.length / Math.max(1, plotWidth * plotHeight);
    const rowHits = new Map<number, number>();
    const columnHits = new Map<number, number>();
    for (const candidate of candidates) {
      rowHits.set(candidate.y, (rowHits.get(candidate.y) ?? 0) + 1);
      columnHits.set(candidate.x, (columnHits.get(candidate.x) ?? 0) + 1);
    }
    const strongRowBands = countCoordinateBands([...rowHits.entries()].filter(([, hits]) => hits >= plotWidth * 0.16).map(([coordinate]) => coordinate));
    const strongColumnBands = countCoordinateBands([...columnHits.entries()].filter(([, hits]) => hits >= plotHeight * 0.16).map(([coordinate]) => coordinate));
    const rectangularFrameRisk = strongRowBands >= 2 && strongColumnBands >= 2 ? 1 : strongRowBands >= 2 || strongColumnBands >= 2 ? 0.34 : 0;
    const gridX = Math.max(1, Math.round(plotWidth / 420));
    const gridY = Math.max(1, Math.round(plotHeight / 360));
    const cells = new Map<string, { x: number; y: number; r: number; g: number; b: number; weight: number; count: number }>();
    for (const candidate of candidates) {
      const key = `${Math.floor((candidate.x - box.left) / gridX)}:${Math.floor((candidate.y - box.top) / gridY)}`;
      const current = cells.get(key) ?? { x: 0, y: 0, r: 0, g: 0, b: 0, weight: 0, count: 0 };
      const cellWeight = 0.4 + candidate.density;
      current.x += candidate.x * cellWeight;
      current.y += candidate.y * cellWeight;
      current.r += candidate.r;
      current.g += candidate.g;
      current.b += candidate.b;
      current.weight += cellWeight;
      current.count += 1;
      cells.set(key, current);
    }

    let samples = [...cells.values()].map((cell) => ({
      x: cell.x / cell.weight,
      y: cell.y / cell.weight,
      count: cell.count,
    }));
    const segmented = buildForceCurveSegments(samples, plotWidth, plotHeight, gridX, gridY, box.left, box.top, frameArtifactGuard);
    samples = segmented.points;
    const points = samples.map((sample) => ({
      x: clamp01((sample.x - box.left) / plotWidth),
      y: clamp01(1 - (sample.y - box.top) / plotHeight),
    }));
    const occupiedColumns = new Set(samples.map((sample) => Math.floor(((sample.x - box.left) / plotWidth) * 80))).size;
    const occupiedRows = new Set(samples.map((sample) => Math.floor(((sample.y - box.top) / plotHeight) * 60))).size;
    const coverage = clamp01(Math.max(occupiedColumns / 80, occupiedRows / 60));
    const colorTotals = candidates.reduce(
      (sum, candidate) => ({ r: sum.r + candidate.r, g: sum.g + candidate.g, b: sum.b + candidate.b }),
      { r: 0, g: 0, b: 0 },
    );
    const count = Math.max(1, candidates.length);
    const color = { r: Math.round(colorTotals.r / count), g: Math.round(colorTotals.g / count), b: Math.round(colorTotals.b / count), hex: "" };
    color.hex = `#${[color.r, color.g, color.b].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
    const componentEstimate = estimateSparseComponents(samples, plotWidth, plotHeight);
    const annotationRisk = Math.max(clamp01((componentEstimate - 0.18) / 0.55), rectangularFrameRisk);
    const colorConfidence = clamp01((weight / Math.max(1, totalWeight) - 0.035) / 0.42);
    const starts = segmented.segmentStarts;
    const lengths = starts.map((start, item) => (starts[item + 1] ?? points.length) - start);
    const largestSegmentShare = points.length ? Math.max(0, ...lengths) / points.length : 0;
    const segmentPenalty = Math.min(0.58, Math.max(0, starts.length - 5) * 0.035);
    const selectionScore =
      coverage * 0.34 +
      Math.min(1, points.length / 100) * 0.12 +
      largestSegmentShare * 0.25 +
      (1 - annotationRisk) * 0.18 +
      colorConfidence * 0.11 -
      segmentPenalty -
      rectangularFrameRisk * 0.62;
    return { points, segmentStarts: starts, color, coverage, maskDensity, annotationRisk, colorConfidence, fallbackUsed: false, selectionScore };
  });

  const selected = traces.sort((a, b) => b.selectionScore - a.selectionScore)[0];
  if (!selected) {
    return { points: [] as AfmNormalizedPoint[], segmentStarts: [] as number[], color: null, coverage: 0, maskDensity: 0, annotationRisk: 0, colorConfidence: 0, fallbackUsed: false };
  }
  const { selectionScore: _selectionScore, ...trace } = selected;
  return trace;
}

/**
 * Extract the most probable force at each separation from a bivariate density
 * rendering.  Warm palettes often devote far more pixels to the red
 * low-density halo than to the narrow yellow maximum; ordinary dominant-hue
 * selection therefore follows the wrong boundary.  This pass weights the
 * caption-defined density maximum and follows its connected ridge.
 */
function detectDensityRidge(
  source: PixelSource,
  box: AfmPlotBox,
  sensitivity: number,
  peakColor: "yellow" | "bright",
) {
  const plotWidth = Math.max(1, box.right - box.left);
  const plotHeight = Math.max(1, box.bottom - box.top);
  const candidates: Array<{ x: number; y: number; r: number; g: number; b: number; weight: number }> = [];
  for (let y = box.top + 1; y < box.bottom; y += 1) {
    for (let x = box.left + 1; x < box.right; x += 1) {
      const rgb = pixel(source, x, y);
      const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
      if (hsv.s < 0.32 || hsv.v < 0.28 || hsv.v > 0.995) continue;
      // Density figures in the papers currently handled by IonicLink use a
      // warm-to-green/cyan peak band.  Restricting this to a very narrow yellow
      // hue follows the two outer edges of the band and produces broken double
      // traces.  A continuous 28-195 degree band retains its centre while
      // excluding the blue voltage annotations (normally > 200 degrees) and
      // the red low-density halo (< 25 degrees).
      const densityPeakHue = hsv.h >= 28 && hsv.h <= 195;
      const yellowScore = densityPeakHue ? hsv.s * Math.min(1, hsv.v * 1.35) : 0;
      const brightnessScore = hsv.s * hsv.v;
      const score = peakColor === "yellow" ? yellowScore : brightnessScore;
      if (score < 0.34 - sensitivity * 0.08) continue;
      const local = colouredNeighbourDensityAnyHue(source, x, y);
      if (local < 0.13) continue;
      candidates.push({ x, y, ...rgb, weight: score * (0.55 + local) });
    }
  }

  const gridX = Math.max(1, Math.round(plotWidth / 420));
  const gridY = Math.max(1, Math.round(plotHeight / 360));
  const cells = new Map<string, typeof candidates>();
  for (const sample of candidates) {
    const key = `${Math.floor((sample.x - box.left) / gridX)}:${Math.floor((sample.y - box.top) / gridY)}`;
    const group = cells.get(key) ?? [];
    group.push(sample);
    cells.set(key, group);
  }
  const ridgeSamples = [...cells.values()].map((group) => {
    const total = group.reduce((sum, item) => sum + item.weight, 0);
    const targetX = group.reduce((sum, item) => sum + item.x * item.weight, 0) / total;
    const targetY = group.reduce((sum, item) => sum + item.y * item.weight, 0) / total;
    return nearestSample(group, targetX, targetY);
  });

  const segmented = buildForceCurveSegments(ridgeSamples, plotWidth, plotHeight, gridX, gridY, box.left, box.top, true);
  const points = segmented.points.map((sample) => ({
    x: clamp01((sample.x - box.left) / plotWidth),
    y: clamp01(1 - (sample.y - box.top) / plotHeight),
  }));
  const occupiedColumns = new Set(segmented.points.map((sample) => Math.floor(((sample.x - box.left) / plotWidth) * 80))).size;
  const occupiedRows = new Set(segmented.points.map((sample) => Math.floor(((sample.y - box.top) / plotHeight) * 60))).size;
  const coverage = clamp01(Math.max(occupiedColumns / 80, occupiedRows / 60));
  const maskDensity = candidates.length / Math.max(1, plotWidth * plotHeight);
  const totals = candidates.reduce((sum, sample) => ({ r: sum.r + sample.r, g: sum.g + sample.g, b: sum.b + sample.b }), { r: 0, g: 0, b: 0 });
  const count = Math.max(1, candidates.length);
  const color = candidates.length ? {
    r: Math.round(totals.r / count),
    g: Math.round(totals.g / count),
    b: Math.round(totals.b / count),
    hex: "",
  } : null;
  if (color) color.hex = `#${[color.r, color.g, color.b].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
  return {
    points,
    segmentStarts: segmented.segmentStarts,
    color,
    coverage,
    maskDensity,
    annotationRisk: 0.05,
    colorConfidence: candidates.length ? Math.min(1, candidates.length / Math.max(40, plotWidth * 0.12)) : 0,
    fallbackUsed: false,
  };
}

function colouredNeighbourDensityAnyHue(source: PixelSource, x: number, y: number) {
  let hits = 0;
  let total = 0;
  for (let dy = -2; dy <= 2; dy += 1) {
    for (let dx = -2; dx <= 2; dx += 1) {
      const px = x + dx; const py = y + dy;
      if (px < 0 || py < 0 || px >= source.width || py >= source.height) continue;
      total += 1;
      const rgb = pixel(source, px, py);
      const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
      if (hsv.s >= 0.25 && hsv.v >= 0.2 && hsv.v <= 0.995) hits += 1;
    }
  }
  return total ? hits / total : 0;
}

function countCoordinateBands(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  let bands = 1;
  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index] - sorted[index - 1] > 2) bands += 1;
  }
  return bands;
}

/**
 * Preserve separate raster components before centreline thinning.  Published
 * AFM profiles frequently contain real gaps between solvation-force lobes.
 * Flattening every coloured cell into one series makes those gaps look like
 * artificial vertical spikes or diagonal measurements.
 */
function buildForceCurveSegments<T extends { x: number; y: number }>(
  samples: T[],
  plotWidth: number,
  plotHeight: number,
  gridX: number,
  gridY: number,
  plotLeft: number,
  plotTop: number,
  frameArtifactGuard: boolean,
): { points: T[]; segmentStarts: number[] } {
  if (!samples.length) return { points: [], segmentStarts: [] };
  const usableSamples = frameArtifactGuard
    ? samples.filter((sample) => sample.x > plotLeft + plotWidth * 0.055 && sample.y < plotTop + plotHeight * 0.955)
    : samples;
  if (!usableSamples.length) return { points: [], segmentStarts: [] };
  const joinRadius = Math.max(4.5, Math.hypot(gridX, gridY) * 2.35);
  const unvisited = new Set(usableSamples.map((_, index) => index));
  const components: T[][] = [];

  while (unvisited.size) {
    const first = unvisited.values().next().value as number;
    const queue = [first];
    const component: T[] = [];
    unvisited.delete(first);
    while (queue.length) {
      const index = queue.pop()!;
      const sample = usableSamples[index];
      component.push(sample);
      for (const candidateIndex of [...unvisited]) {
        const candidate = usableSamples[candidateIndex];
        if (Math.hypot(candidate.x - sample.x, candidate.y - sample.y) <= joinRadius) {
          unvisited.delete(candidateIndex);
          queue.push(candidateIndex);
        }
      }
    }
    components.push(component);
  }

  const minimumComponentSize = Math.max(2, Math.round(usableSamples.length * 0.008));
  const retained = components
    .filter((component) => component.length >= minimumComponentSize)
    .filter((component) => !isFrameEdgeArtifact(component, plotWidth, plotHeight, plotLeft, plotTop))
    // A ridge centreline retains one sample per source-pixel row/column. A
    // shortest-path pass used here previously skipped several real samples at
    // each step and turned sharp solvation features into sparse straight lines.
    .map((component) => buildForceCurveCenterline(component, plotWidth, plotHeight))
    .filter((component) => component.length >= 2)
    .sort((a, b) => Math.min(...a.map((sample) => sample.x)) - Math.min(...b.map((sample) => sample.x)));
  if (!retained.length) {
    const points = buildForceCurveCenterline(usableSamples, plotWidth, plotHeight);
    return { points, segmentStarts: points.length ? [0] : [] };
  }

  const points: T[] = [];
  const segmentStarts: number[] = [];
  for (const component of retained) {
    segmentStarts.push(points.length);
    points.push(...component);
  }
  return { points, segmentStarts };
}

function isFrameEdgeArtifact<T extends { x: number; y: number }>(component: T[], plotWidth: number, plotHeight: number, plotLeft: number, plotTop: number) {
  const xs = component.map((sample) => sample.x);
  const ys = component.map((sample) => sample.y);
  const minX = Math.min(...xs); const maxX = Math.max(...xs);
  const minY = Math.min(...ys); const maxY = Math.max(...ys);
  const narrowVerticalAtFrame = maxX <= plotLeft + plotWidth * 0.055 && maxX - minX <= plotWidth * 0.035;
  const narrowHorizontalAtFrame = minY >= plotTop + plotHeight * 0.955 && maxY - minY <= plotHeight * 0.035;
  const frameEdgeShare = component.filter((sample) => sample.x <= plotLeft + plotWidth * 0.055 || sample.y >= plotTop + plotHeight * 0.955).length / component.length;
  return narrowVerticalAtFrame || narrowHorizontalAtFrame || frameEdgeShare >= 0.72;
}

/** Follow the connected coloured ridge from one physical endpoint to the other. */
function traceComponentPath<T extends { x: number; y: number }>(component: T[], joinRadius: number, plotWidth: number, plotHeight: number): T[] {
  if (component.length < 4) return [...component].sort((a, b) => a.x - b.x || a.y - b.y);
  const xs = component.map((sample) => sample.x);
  const ys = component.map((sample) => sample.y);
  const spanX = Math.max(...xs) - Math.min(...xs);
  const spanY = Math.max(...ys) - Math.min(...ys);
  const start = spanY > spanX * 1.2
    ? extremeIndex(component, (sample) => sample.y, "min")
    : spanX > spanY * 1.2
      ? extremeIndex(component, (sample) => sample.x, "min")
      : extremeIndex(component, (sample) => sample.y, "min");
  const end = spanY > spanX * 1.2
    ? extremeIndex(component, (sample) => sample.y, "max")
    : extremeIndex(component, (sample) => sample.x, "max");
  if (start === end) return buildForceCurveCenterline(component, plotWidth, plotHeight);

  const distances = new Array<number>(component.length).fill(Number.POSITIVE_INFINITY);
  const previous = new Array<number>(component.length).fill(-1);
  const visited = new Array<boolean>(component.length).fill(false);
  distances[start] = 0;
  for (let iteration = 0; iteration < component.length; iteration += 1) {
    let current = -1;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let index = 0; index < component.length; index += 1) {
      if (!visited[index] && distances[index] < bestDistance) {
        current = index;
        bestDistance = distances[index];
      }
    }
    if (current < 0 || current === end) break;
    visited[current] = true;
    for (let candidate = 0; candidate < component.length; candidate += 1) {
      if (visited[candidate] || candidate === current) continue;
      const edge = Math.hypot(component[candidate].x - component[current].x, component[candidate].y - component[current].y);
      // The larger radius above is useful for deciding whether raster cells
      // belong to the same published fragment.  Following the centreline uses
      // a tighter neighbourhood so the shortest path cannot skip several real
      // curve pixels at every step.
      const pathRadius = Math.max(4.7, Math.min(5.1, joinRadius * 0.78));
      if (edge > pathRadius) continue;
      const nextDistance = distances[current] + edge;
      if (nextDistance < distances[candidate]) {
        distances[candidate] = nextDistance;
        previous[candidate] = current;
      }
    }
  }
  if (!Number.isFinite(distances[end])) return buildForceCurveCenterline(component, plotWidth, plotHeight);
  const indices: number[] = [];
  for (let current = end; current >= 0; current = previous[current]) {
    indices.push(current);
    if (current === start) break;
  }
  indices.reverse();
  const rawPath = indices.map((index) => component[index]);
  const smoothed = rawPath.map((sample, index) => {
    const nearby = rawPath.slice(Math.max(0, index - 1), Math.min(rawPath.length, index + 2));
    const x = nearby.reduce((sum, point) => sum + point.x, 0) / nearby.length;
    const y = nearby.reduce((sum, point) => sum + point.y, 0) / nearby.length;
    return nearestSample(nearby, x, y);
  });
  const reduced = deduplicateNearby(smoothed, 0.72);
  if (reduced.length <= 520) return reduced;
  const stride = Math.ceil(reduced.length / 520);
  return reduced.filter((_, index) => index === 0 || index === reduced.length - 1 || index % stride === 0);
}

function extremeIndex<T>(samples: T[], value: (sample: T) => number, direction: "min" | "max") {
  return samples.reduce((best, sample, index) => (
    direction === "min" ? value(sample) < value(samples[best]) : value(sample) > value(samples[best])
  ) ? index : best, 0);
}

/**
 * Convert a thick colour mask into one ordered force-curve centreline.
 *
 * AFM force profiles often contain a near-vertical contact branch followed by
 * a mostly x-monotonic solvation tail. Raster-order or x+y sorting connects
 * unrelated mask cells and creates the false diagonals visible in previews.
 * This routine treats the contact branch and tail separately, then joins them
 * at the physical elbow. The exported series therefore represents the trace
 * centre rather than every coloured pixel in the line thickness.
 */
function buildForceCurveCenterline<T extends { x: number; y: number }>(samples: T[], plotWidth: number, plotHeight: number): T[] {
  if (samples.length < 12) return [...samples].sort((a, b) => a.x - b.x || a.y - b.y);
  const xBin = Math.max(1, Math.round(plotWidth / 300));
  const yBin = Math.max(1, Math.round(plotHeight / 240));
  const xGroups = groupSamples(samples, (sample) => Math.round(sample.x / xBin));
  const profiles = [...xGroups.values()]
    .map((group) => {
      const ys = group.map((sample) => sample.y).sort((a, b) => a - b);
      return {
        group,
        x: median(group.map((sample) => sample.x)),
        y: median(ys),
        low: percentile(ys, 0.08),
        high: percentile(ys, 0.92),
      };
    })
    .sort((a, b) => a.x - b.x);
  if (!profiles.length) return [];

  const leftEdge = profiles[0].x;
  const rightEdge = profiles[profiles.length - 1].x;
  // Some source figures draw separation in descending order, which places the
  // contact branch at the right edge.  Search both sides and let the vertical
  // span identify contact instead of assuming an increasing x axis.
  const contact = [...profiles]
    .sort((a, b) => (b.high - b.low) - (a.high - a.low))[0];
  // A genuine contact branch spans a substantial fraction of the force axis.
  // A lower threshold mistakes the finite thickness of a noisy baseline ridge
  // for contact and folds that horizontal segment back over itself.
  const hasContactBranch = Boolean(contact && contact.high - contact.low >= Math.max(16, plotHeight * 0.24));

  if (!hasContactBranch || !contact) {
    return profiles.map((profile) => nearestSample(profile.group, profile.x, profile.y));
  }

  const band = Math.max(5, plotWidth * 0.035);
  const elbowY = contact.high;
  const verticalCandidates = samples.filter((sample) => Math.abs(sample.x - contact.x) <= band && sample.y <= elbowY + yBin);
  const vertical = [...groupSamples(verticalCandidates, (sample) => Math.round(sample.y / yBin)).values()]
    .map((group) => {
      const x = median(group.map((sample) => sample.x));
      const y = median(group.map((sample) => sample.y));
      return nearestSample(group, x, y);
    })
    .sort((a, b) => a.y - b.y);

  const contactAtLeft = contact.x <= (leftEdge + rightEdge) / 2;
  const tail = profiles
    .filter((profile) => contactAtLeft ? profile.x >= contact.x - xBin : profile.x <= contact.x + xBin)
    .map((profile) => {
      const plausible = profile.group.filter((sample) => sample.y >= elbowY - plotHeight * 0.13);
      const group = plausible.length ? plausible : profile.group;
      const targetY = profile.x <= contact.x + band ? percentile(group.map((sample) => sample.y).sort((a, b) => a - b), 0.82) : median(group.map((sample) => sample.y));
      return nearestSample(group, profile.x, targetY);
    })
    .sort((a, b) => contactAtLeft ? a.x - b.x : b.x - a.x);

  const joined = deduplicateNearby([...vertical, ...tail], Math.max(0.72, Math.min(xBin, yBin) * 0.62));
  if (joined.length <= 520) return joined;
  const stride = Math.ceil(joined.length / 520);
  return joined.filter((_, index) => index === 0 || index === joined.length - 1 || index % stride === 0);
}

function groupSamples<T>(samples: T[], key: (sample: T) => number) {
  const groups = new Map<number, T[]>();
  for (const sample of samples) {
    const value = key(sample);
    const group = groups.get(value) ?? [];
    group.push(sample);
    groups.set(value, group);
  }
  return groups;
}

function nearestSample<T extends { x: number; y: number }>(samples: T[], x: number, y: number): T {
  return samples.reduce((best, sample) => (
    Math.hypot(sample.x - x, sample.y - y) < Math.hypot(best.x - x, best.y - y) ? sample : best
  ), samples[0]);
}

function deduplicateNearby<T extends { x: number; y: number }>(samples: T[], minimumDistance: number): T[] {
  const kept: T[] = [];
  for (const sample of samples) {
    const previous = kept[kept.length - 1];
    if (!previous || Math.hypot(sample.x - previous.x, sample.y - previous.y) >= minimumDistance) kept.push(sample);
  }
  return kept;
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * Fallback for monochrome paper figures. It follows a locally continuous dark
 * ridge from the long-distance/baseline side towards the high-force side while
 * suppressing long horizontal/vertical reference lines. It is intentionally
 * scored below colour extraction because black annotations can be ambiguous.
 */
function detectDarkTrace(source: PixelSource, box: AfmPlotBox, sensitivity: number) {
  const plotWidth = Math.max(1, box.right - box.left);
  const plotHeight = Math.max(1, box.bottom - box.top);
  const isDark = (x: number, y: number) => {
    const { r, g, b } = pixel(source, x, y);
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    return max < 118 + sensitivity * 35 && max - min < 48;
  };
  const strongRows = new Set<number>();
  const strongColumns = new Set<number>();
  for (let y = box.top + 3; y < box.bottom - 3; y += 1) {
    let hits = 0;
    for (let x = box.left + 3; x < box.right - 3; x += 2) if (isDark(x, y)) hits += 1;
    if (hits > (plotWidth / 2) * 0.7) strongRows.add(y);
  }
  for (let x = box.left + 3; x < box.right - 3; x += 1) {
    let hits = 0;
    for (let y = box.top + 3; y < box.bottom - 3; y += 2) if (isDark(x, y)) hits += 1;
    if (hits > (plotHeight / 2) * 0.7) strongColumns.add(x);
  }
  const nearStrong = (values: Set<number>, position: number) => values.has(position);
  const binWidth = Math.max(2, Math.round(plotWidth / 210));
  const bins: Array<{ x: number; groups: Array<{ y: number; top: number; bottom: number; hits: number }> }> = [];
  for (let startX = box.left + 4; startX < box.right - 3; startX += binWidth) {
    const ys: number[] = [];
    for (let y = box.top + 4; y < box.bottom - 3; y += 1) {
      if (nearStrong(strongRows, y)) continue;
      let hits = 0;
      for (let x = startX; x < Math.min(box.right - 3, startX + binWidth); x += 1) {
        if (!nearStrong(strongColumns, x) && isDark(x, y)) hits += 1;
      }
      if (hits) ys.push(y);
    }
    const groups: Array<{ y: number; top: number; bottom: number; hits: number }> = [];
    let start = 0;
    while (start < ys.length) {
      let end = start;
      while (end + 1 < ys.length && ys[end + 1] - ys[end] <= 2) end += 1;
      const top = ys[start];
      const bottom = ys[end];
      const length = end - start + 1;
      if (length >= 1) groups.push({ y: (top + bottom) / 2, top, bottom, hits: length });
      start = end + 1;
    }
    bins.push({ x: startX + binWidth / 2, groups });
  }

  let startIndex = -1;
  let currentY = 0;
  for (let index = bins.length - 1; index >= 0; index -= 1) {
    const candidates = bins[index].groups.filter((group) => group.y > box.top + plotHeight * 0.34 && group.y < box.bottom - 3);
    if (!candidates.length) continue;
    const chosen = candidates.sort((a, b) => b.y + b.hits * 1.5 - (a.y + a.hits * 1.5))[0];
    startIndex = index;
    currentY = chosen.y;
    break;
  }
  if (startIndex < 0) {
    return { points: [] as AfmNormalizedPoint[], segmentStarts: [] as number[], color: null, coverage: 0, maskDensity: 0, annotationRisk: 0.5, colorConfidence: 0, fallbackUsed: true };
  }

  const traced: Array<{ x: number; y: number }> = [];
  let gaps = 0;
  let visitedBins = 0;
  for (let index = startIndex; index >= 0; index -= 1) {
    const bin = bins[index];
    const maxJump = plotHeight * Math.min(0.4, 0.08 + gaps * 0.022 + sensitivity * 0.05);
    const ranked = bin.groups
      .map((group) => ({
        group,
        cost: Math.abs(group.y - currentY) + Math.max(0, group.y - currentY) * 1.4 - Math.min(10, group.hits) * 0.45,
      }))
      .filter(({ group }) => Math.abs(group.y - currentY) <= maxJump)
      .sort((a, b) => a.cost - b.cost);
    if (!ranked.length) {
      gaps += 1;
      if (gaps > Math.max(18, Math.round(plotWidth / binWidth * 0.16))) break;
      continue;
    }
    const chosen = ranked[0].group;
    currentY = chosen.y;
    gaps = 0;
    visitedBins += 1;
    traced.push({ x: bin.x, y: chosen.y });
    if (chosen.bottom - chosen.top >= 5) {
      traced.push({ x: bin.x, y: chosen.top }, { x: bin.x, y: chosen.bottom });
    }
  }
  traced.sort((a, b) => (a.x - box.left) / plotWidth + (a.y - box.top) / plotHeight - ((b.x - box.left) / plotWidth + (b.y - box.top) / plotHeight));
  const points = traced.map((point) => ({ x: clamp01((point.x - box.left) / plotWidth), y: clamp01(1 - (point.y - box.top) / plotHeight) }));
  const coverage = clamp01(visitedBins / Math.max(1, bins.length));
  const annotationRisk = clamp01(0.18 + strongRows.size / Math.max(1, plotHeight) + strongColumns.size / Math.max(1, plotWidth));
  return {
    points,
    segmentStarts: points.length ? [0] : [],
    color: { r: 45, g: 45, b: 45, hex: "#2d2d2d" },
    coverage,
    maskDensity: points.length / Math.max(1, plotWidth * plotHeight),
    annotationRisk,
    colorConfidence: 0.48,
    fallbackUsed: true,
  };
}

function estimateSparseComponents(samples: Array<{ x: number; y: number }>, width: number, height: number) {
  if (!samples.length) return 1;
  const radius = Math.max(4, Math.min(width, height) * 0.025);
  let isolated = 0;
  for (let i = 0; i < samples.length; i += Math.max(1, Math.floor(samples.length / 180))) {
    const point = samples[i];
    let neighbours = 0;
    for (let j = 0; j < samples.length; j += 1) {
      if (i === j) continue;
      if (Math.hypot(point.x - samples[j].x, point.y - samples[j].y) <= radius) neighbours += 1;
      if (neighbours >= 3) break;
    }
    if (neighbours < 2) isolated += 1;
  }
  return isolated / Math.max(1, Math.ceil(samples.length / Math.max(1, Math.floor(samples.length / 180))));
}

function normalizePlotBox(box: AfmPlotBox, width: number, height: number): AfmPlotBox {
  const left = Math.max(0, Math.min(width - 3, Math.round(box.left)));
  const top = Math.max(0, Math.min(height - 3, Math.round(box.top)));
  const right = Math.max(left + 2, Math.min(width - 1, Math.round(box.right)));
  const bottom = Math.max(top + 2, Math.min(height - 1, Math.round(box.bottom)));
  return { left, top, right, bottom };
}

function longestRun(start: number, end: number, predicate: (position: number) => boolean, maxGap: number): Run {
  let best: Run = { start, end: start, hits: 0 };
  let currentStart = start;
  let currentHits = 0;
  let gap = 0;
  for (let position = start; position <= end; position += 1) {
    if (predicate(position)) {
      currentHits += 1;
      gap = 0;
    } else if (currentHits) {
      gap += 1;
      if (gap > maxGap) {
        const currentEnd = position - gap;
        if (currentHits > best.hits || (currentHits === best.hits && currentEnd - currentStart > best.end - best.start)) {
          best = { start: currentStart, end: currentEnd, hits: currentHits };
        }
        currentStart = position + 1;
        currentHits = 0;
        gap = 0;
      }
    } else {
      currentStart = position + 1;
    }
  }
  if (currentHits > best.hits) best = { start: currentStart, end: end - gap, hits: currentHits };
  return best;
}

function isAxisPixel(source: PixelSource, x: number, y: number) {
  const { r, g, b } = pixel(source, x, y);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max < 135 && max - min < 34;
}

function coloredNeighbourDensity(source: PixelSource, x: number, y: number, hue: number, tolerance: number, saturationFloor: number) {
  let hits = 0;
  let total = 0;
  for (let dy = -2; dy <= 2; dy += 1) {
    for (let dx = -2; dx <= 2; dx += 1) {
      const px = x + dx;
      const py = y + dy;
      if (px < 0 || py < 0 || px >= source.width || py >= source.height) continue;
      total += 1;
      const rgb = pixel(source, px, py);
      const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
      if (hsv.s >= saturationFloor && hsv.v >= 0.1 && hsv.v <= 0.96 && hueDistance(hsv.h, hue) <= tolerance) hits += 1;
    }
  }
  return hits / Math.max(1, total);
}

function pixel(source: PixelSource, x: number, y: number) {
  const index = (Math.round(y) * source.width + Math.round(x)) * 4;
  return { r: source.data[index], g: source.data[index + 1], b: source.data[index + 2] };
}

function rgbToHsv(rByte: number, gByte: number, bByte: number) {
  const r = rByte / 255;
  const g = gByte / 255;
  const b = bByte / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let h = 0;
  if (delta) {
    if (max === r) h = 60 * (((g - b) / delta) % 6);
    else if (max === g) h = 60 * ((b - r) / delta + 2);
    else h = 60 * ((r - g) / delta + 4);
  }
  if (h < 0) h += 360;
  return { h, s: max === 0 ? 0 : delta / max, v: max };
}

function hueDistance(a: number, b: number) {
  const distance = Math.abs(a - b) % 360;
  return Math.min(distance, 360 - distance);
}

function percentile(values: number[], fraction: number) {
  if (!values.length) return 0;
  const position = (values.length - 1) * clamp01(fraction);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return values[lower];
  return values[lower] + (values[upper] - values[lower]) * (position - lower);
}

function round(value: number, digits: number) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
