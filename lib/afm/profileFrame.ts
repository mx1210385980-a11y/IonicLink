import type { AfmDigitizationAnalysis, AfmPlotBox } from "./digitizeCurve";

/** Locate a solid left axis when this explicitly shared grid omits x tick labels. */
export function sharedAfmHorizontalFrame(source: { width: number; height: number; data: Uint8Array | Uint8ClampedArray }, sharedSpan: number): Pick<AfmPlotBox, "left" | "right"> | null {
  const y0 = Math.round(source.height * 0.17), y1 = Math.round(source.height * 0.78);
  const scores: Array<{ x: number; hits: number }> = [];
  for (let x = 2; x < source.width * 0.15; x++) {
    let hits = 0;
    for (let y = y0; y < y1; y++) { const p = (y * source.width + x) * 4; if (Math.max(source.data[p], source.data[p + 1], source.data[p + 2]) < 150) hits++; }
    scores.push({ x, hits });
  }
  const best = Math.max(0, ...scores.map((s) => s.hits));
  if (best < (y1 - y0) * 0.7) return null;
  const strong = scores.filter((s) => s.hits >= best * 0.95);
  const left = strong.reduce((sum, s) => sum + s.x, 0) / strong.length, right = left + sharedSpan;
  return right < source.width && sharedSpan > source.width * 0.5 ? { left, right } : null;
}

/** Reproject existing trace pixels into a tick-anchored frame, without smoothing or filling gaps. */
export function reframeAfmAnalysis(analysis: AfmDigitizationAnalysis, frame: AfmPlotBox): AfmDigitizationAnalysis {
  const before = analysis.plotBox, points = analysis.normalizedPoints;
  const starts = new Set(analysis.segmentStarts);
  const normalizedPoints: typeof points = [], segmentStarts: number[] = [];
  let pendingBreak = true;
  points.forEach((point, i) => {
    pendingBreak ||= starts.has(i);
    const x = before.left + point.x * (before.right - before.left), y = before.bottom - point.y * (before.bottom - before.top);
    if (x < frame.left - 1e-6 || x > frame.right + 1e-6 || y < frame.top - 1e-6 || y > frame.bottom + 1e-6) { pendingBreak = true; return; }
    if (pendingBreak) segmentStarts.push(normalizedPoints.length);
    normalizedPoints.push({ x: Math.max(0, Math.min(1, (x - frame.left) / (frame.right - frame.left))), y: Math.max(0, Math.min(1, (frame.bottom - y) / (frame.bottom - frame.top))) });
    pendingBreak = false;
  });
  return { ...analysis, plotBox: frame, normalizedPoints, segmentStarts, warnings: [...analysis.warnings, "Plot frame aligned to positioned tick labels; original trace pixels and gaps retained."] };
}
