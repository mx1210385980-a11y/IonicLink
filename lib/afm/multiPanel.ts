import type { AfmPlotBox } from "./digitizeCurve";

export type InheritedReviewStatus = "inferred";

export interface InheritedCondition<T> {
  value: T | null;
  unit: string | null;
  status: InheritedReviewStatus;
  confidence: number;
  evidence: string;
}

export interface AfmPanelConditions {
  ionicLiquid: InheritedCondition<string>;
  substrate: InheritedCondition<string>;
  electrodePotential: InheritedCondition<number>;
}

/** Build conservative panel context for ordinary A-D scientific figures. */
export function inferGenericAfmPanelConditions(
  captionText: string,
  documentText: string,
  panelLabel: string,
): AfmPanelConditions {
  const caption = normalizePdfText(captionText);
  const document = normalizePdfText(documentText);
  const figureLabel = caption.match(/\bFig(?:ure)?\.?\s*([0-9]+[A-Za-z]?)/i)?.[1] ?? "figure";
  const ionicLiquid = extractDocumentIonicLiquid(`${caption} ${document}`);
  const substrate = extractGenericPanelSubstrate(caption, panelLabel);
  const polarity = extractPotentialPolarity(caption, panelLabel);
  const explicitPotential = extractPanelPotential(caption, panelLabel);
  return {
    ionicLiquid: {
      value: ionicLiquid,
      unit: null,
      status: "inferred",
      confidence: ionicLiquid ? 0.94 : 0,
      evidence: ionicLiquid
        ? `The article identifies ${ionicLiquid} as the liquid used for Figure ${figureLabel}.`
        : "No complete ionic-liquid identity was recovered from the article text.",
    },
    substrate: {
      value: substrate,
      unit: null,
      status: "inferred",
      confidence: substrate ? 0.93 : 0,
      evidence: substrate
        ? `Figure ${figureLabel} caption maps panel ${panelLabel} to ${substrate}.`
        : `Figure ${figureLabel} caption does not unambiguously map panel ${panelLabel} to a substrate.`,
    },
    electrodePotential: {
      value: explicitPotential,
      unit: explicitPotential === null ? null : "V",
      status: "inferred",
      confidence: explicitPotential === null ? (polarity ? 0.62 : 0) : 0.9,
      evidence: explicitPotential !== null
        ? `Figure ${figureLabel} assigns panel ${panelLabel} to ${formatSigned(explicitPotential)} V.`
        : polarity
          ? `Figure ${figureLabel} assigns panel ${panelLabel} to a ${polarity} potential, but the numeric voltage is not stated in the caption.`
          : "No applied potential was assigned to this panel; do not infer zero volts from absence.",
    },
  };
}

export interface AfmPanelSpec {
  label: string;
  row: number;
  column: number;
  suggestedLabel: string;
  conditions: AfmPanelConditions;
}

export interface AfmMultiPanelLayout {
  figureLabel: string;
  caption: string;
  rows: number;
  columns: number;
  panels: AfmPanelSpec[];
}

export interface AfmDetectedPanel {
  spec: AfmPanelSpec;
  box: AfmPlotBox;
}

interface PixelSource {
  width: number;
  height: number;
  data: Uint8Array | Uint8ClampedArray;
}

interface HistogramCluster {
  start: number;
  end: number;
  center: number;
  weight: number;
}

interface PanelRange {
  start: string;
  end: string;
  labels: string[];
  substrate: string;
}

const PANEL_RANGE = /([A-Z])\s*[\u2013\u2014-]\s*([A-Z])/g;

/**
 * Parse a caption such as "... [Li(G4)] TFSI and [Li(G4)] NO3 on
 * HOPG (A-E, K-O) and Au(111) (F-J, P-T) as a function of potential."
 *
 * Conditions inherited here remain inferred until a reviewer confirms the
 * panel labels and row headings against the rendered figure.
 */
export function parseAfmMultiPanelLayout(captionText: string, documentText: string): AfmMultiPanelLayout | null {
  const caption = normalizePdfText(captionText);
  const figureLabel = caption.match(/\bFig(?:ure)?\.?\s*([0-9]+[A-Za-z]?)/i)?.[1] ?? "figure";
  const ionicLiquids = extractIonicLiquids(caption);
  const ranges = extractPanelRanges(caption);
  if (ionicLiquids.length < 1 || ranges.length < 2) return null;

  ranges.sort((a, b) => a.start.localeCompare(b.start));
  const rowCounts = new Set(ranges.map((range) => range.labels.length));
  if (rowCounts.size !== 1) return null;
  const rows = ranges[0].labels.length;
  const columns = ranges.length;
  if (rows < 2 || columns < 2 || rows * columns > 40) return null;
  if (columns % ionicLiquids.length !== 0) return null;

  const potentialSeries = extractPotentialSeries(documentText, rows);
  const columnsPerLiquid = columns / ionicLiquids.length;
  const panels: AfmPanelSpec[] = [];

  ranges.forEach((range, column) => {
    const ionicLiquid = ionicLiquids[Math.min(ionicLiquids.length - 1, Math.floor(column / columnsPerLiquid))];
    range.labels.forEach((label, row) => {
      const potential = potentialSeries?.[row] ?? null;
      const potentialLabel = potential === null ? "potential pending" : `${formatSigned(potential)} V`;
      panels.push({
        label,
        row,
        column,
        suggestedLabel: `${ionicLiquid} · ${range.substrate} · ${potentialLabel}`,
        conditions: {
          ionicLiquid: {
            value: ionicLiquid,
            unit: null,
            status: "inferred",
            confidence: 0.96,
            evidence: `Figure ${figureLabel} caption and panel range ${range.start}-${range.end}.`,
          },
          substrate: {
            value: range.substrate,
            unit: null,
            status: "inferred",
            confidence: 0.97,
            evidence: `Figure ${figureLabel} caption assigns panels ${range.start}-${range.end} to ${range.substrate}.`,
          },
          electrodePotential: {
            value: potential,
            unit: potential === null ? null : "V",
            status: "inferred",
            confidence: potential === null ? 0.35 : 0.82,
            evidence: potential === null
              ? "No complete signed potential series could be recovered automatically; review the row label."
              : "Signed potentials were extracted from the article text and assigned by the top-to-bottom figure row order; confirm against the row label.",
          },
        },
      });
    });
  });

  panels.sort((a, b) => a.label.localeCompare(b.label));
  return { figureLabel, caption, rows, columns, panels };
}

/** Detect a regular coloured-trace grid and map its cells to parsed A-T specs. */
export function detectAfmPanelBoxes(source: PixelSource, layout: AfmMultiPanelLayout): AfmDetectedPanel[] {
  if (source.width < 240 || source.height < 240 || source.data.length < source.width * source.height * 4) return [];
  const hue = dominantChromaticHue(source);
  if (hue === null) return [];

  const yHistogram = new Array<number>(source.height).fill(0);
  for (let y = 0; y < source.height; y += 1) {
    for (let x = 0; x < source.width; x += 1) {
      const offset = (y * source.width + x) * 4;
      const hsv = rgbToHsv(source.data[offset], source.data[offset + 1], source.data[offset + 2]);
      if (hsv.s < 0.28 || hsv.v < 0.1 || hsv.v > 0.96 || hueDistance(hsv.h, hue) > 22) continue;
      yHistogram[y] += 1;
    }
  }

  const rawYClusters = histogramClusters(yHistogram);
  const yClusters = selectDominantClusters(rawYClusters, layout.rows);
  if (yClusters.length !== layout.rows) return [];

  // Header molecular drawings and legends can share the trace colour and join
  // otherwise independent panel columns. Build the horizontal histogram only
  // inside the five dominant trace rows so that decoration above the grid is
  // excluded before column detection.
  const xHistogram = new Array<number>(source.width).fill(0);
  for (let y = 0; y < source.height; y += 1) {
    if (!yClusters.some((cluster) => y >= cluster.start && y <= cluster.end)) continue;
    for (let x = 0; x < source.width; x += 1) {
      const offset = (y * source.width + x) * 4;
      const hsv = rgbToHsv(source.data[offset], source.data[offset + 1], source.data[offset + 2]);
      if (hsv.s < 0.28 || hsv.v < 0.1 || hsv.v > 0.96 || hueDistance(hsv.h, hue) > 22) continue;
      xHistogram[x] += 1;
    }
  }
  const rawXClusters = histogramClusters(xHistogram);
  const xClusters = selectDominantClusters(rawXClusters, layout.columns);
  if (xClusters.length !== layout.columns || yClusters.length !== layout.rows) return [];

  const xBounds = expandedClusterBounds(xClusters, source.width, "x");
  const yBounds = expandedClusterBounds(yClusters, source.height, "y");
  const specs = new Map(layout.panels.map((panel) => [`${panel.row}:${panel.column}`, panel]));
  const detected: AfmDetectedPanel[] = [];
  for (let row = 0; row < layout.rows; row += 1) {
    for (let column = 0; column < layout.columns; column += 1) {
      const spec = specs.get(`${row}:${column}`);
      if (!spec) return [];
      detected.push({
        spec,
        box: {
          left: xBounds[column].start,
          right: xBounds[column].end,
          top: yBounds[row].start,
          bottom: yBounds[row].end,
        },
      });
    }
  }
  return detected.sort((a, b) => a.spec.label.localeCompare(b.spec.label));
}

function selectDominantClusters(clusters: HistogramCluster[], expected: number): HistogramCluster[] {
  if (clusters.length < expected) return [];
  return [...clusters]
    .sort((a, b) => {
      const widthA = a.end - a.start + 1;
      const widthB = b.end - b.start + 1;
      const scoreA = widthA * Math.log1p(a.weight);
      const scoreB = widthB * Math.log1p(b.weight);
      return scoreB - scoreA;
    })
    .slice(0, expected)
    .sort((a, b) => a.center - b.center);
}

function extractIonicLiquids(caption: string): string[] {
  const segment = caption.match(/\bdata\s+for\s+(.+?)\s+on\s+[A-Za-z]/i)?.[1] ?? caption;
  const matches = segment.match(/\[[^\]]+\]\s*(?:\[[^\]]+\]|[A-Za-z][A-Za-z0-9]*(?:\s*\d+)?)/g) ?? [];
  return [...new Set(matches.map((value) => value
    .replace(/\]\s+/g, "]")
    .replace(/([A-Za-z])\s+(\d)/g, "$1$2")
    // PDF text layers frequently detach the nitrate subscript and move the
    // glyph to the end of the caption. [Li(G4)]NO is not the reported salt;
    // restore the chemically valid nitrate abbreviation before inheritance.
    .replace(/(\[Li\(G4\)\])NO\b/i, "$1NO3")
    .trim()))];
}

function extractDocumentIonicLiquid(text: string): string | null {
  const bracketed = text.match(/\[([A-Za-z][A-Za-z0-9,._-]{1,14})\]\s*\[([A-Za-z][A-Za-z0-9,._-]{1,14})\]/);
  if (bracketed) return `[${bracketed[1]}][${bracketed[2]}]`;
  const expanded = text.match(/1-ethyl-3-methylimidazolium\s+bis\(trifluoromethylsulfonyl\)imide/i);
  return expanded ? "[EMIM][TFSI]" : null;
}

function extractGenericPanelSubstrate(caption: string, panelLabel: string): string | null {
  const label = panelLabel.toUpperCase();
  const mappings: Array<{ pattern: RegExp; value: string }> = [
    { pattern: /single-layer\s+graphene|\bSLG\b/i, value: "single-layer graphene on SiO2" },
    { pattern: /bilayer\s+graphene|\b2LG\b/i, value: "bilayer graphene" },
    { pattern: /silica\s+substrate|\bSiO2\b/i, value: "SiO2" },
    { pattern: /\bgold\b/i, value: "gold" },
    { pattern: /\bHOPG\b/i, value: "HOPG" },
    { pattern: /\bmica\b/i, value: "mica" },
  ];
  const groups = [...caption.matchAll(/([^.;()]{2,80})\(\s*([A-Z](?:\s*,\s*[A-Z])*)\s*\)/g)];
  for (const group of groups) {
    const labels = group[2].split(",").map((item) => item.trim().toUpperCase());
    if (!labels.includes(label)) continue;
    const description = group[1].replace(/^.*?\b(?:for|and)\s+/i, "").trim();
    for (const mapping of mappings) {
      if (mapping.pattern.test(description)) {
        if (/gold-supported\s+(?:bilayer\s+graphene|2LG)/i.test(description)) return "gold-supported bilayer graphene";
        if (mapping.value === "bilayer graphene" && /silica-supported/i.test(caption)) return "bilayer graphene on SiO2";
        return mapping.value;
      }
    }
  }
  const direct = caption.match(new RegExp(`([^.;()]{2,60})\\(\\s*${label}\\s*\\)`, "i"))?.[1] ?? "";
  for (const mapping of mappings) if (mapping.pattern.test(direct)) return mapping.value;
  return null;
}

function extractPotentialPolarity(caption: string, panelLabel: string): "negative" | "positive" | null {
  for (const polarity of ["negative", "positive"] as const) {
    const match = caption.match(new RegExp(`${polarity}\\s*\\(\\s*([A-Z](?:\\s*,\\s*[A-Z])*)\\s*\\)`, "i"));
    const labels = match?.[1].split(",").map((item) => item.trim().toUpperCase()) ?? [];
    if (labels.includes(panelLabel.toUpperCase())) return polarity;
  }
  return null;
}

function extractPanelPotential(caption: string, panelLabel: string): number | null {
  const label = panelLabel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`\\(\\s*${label}\\s*\\)\\s*(?:at|=|:)?\\s*([+-]?\\s*\\d+(?:\\.\\d+)?)\\s*V`, "i"),
    new RegExp(`(?:panel\\s+${label}|${label}\\s*:)\\s*(?:at|=|:)?\\s*([+-]?\\s*\\d+(?:\\.\\d+)?)\\s*V`, "i"),
    new RegExp(`([+-]?\\s*\\d+(?:\\.\\d+)?)\\s*V\\s*\\(\\s*${label}\\s*\\)`, "i"),
  ];
  for (const pattern of patterns) {
    const match = caption.match(pattern);
    if (!match) continue;
    const value = Number(match[1].replace(/\s+/g, ""));
    if (Number.isFinite(value) && Math.abs(value) <= 5) return value;
  }
  return null;
}

function extractPanelRanges(caption: string): PanelRange[] {
  const ranges: PanelRange[] = [];
  const substratePattern = /([A-Za-z][A-Za-z0-9]*(?:\(\d+(?:,\d+)*\))?)\s*\(((?:\s*[A-Z]\s*[\u2013\u2014-]\s*[A-Z]\s*,?)+)\)/g;
  for (const match of caption.matchAll(substratePattern)) {
    const substrate = match[1];
    for (const rangeMatch of match[2].matchAll(PANEL_RANGE)) {
      const labels = expandPanelRange(rangeMatch[1], rangeMatch[2]);
      if (labels.length) ranges.push({ start: rangeMatch[1], end: rangeMatch[2], labels, substrate });
    }
  }
  return ranges;
}

function expandPanelRange(start: string, end: string): string[] {
  const first = start.charCodeAt(0);
  const last = end.charCodeAt(0);
  if (last < first || last - first > 25) return [];
  return Array.from({ length: last - first + 1 }, (_, index) => String.fromCharCode(first + index));
}

function extractPotentialSeries(documentText: string, expectedCount: number): number[] | null {
  const normalized = normalizePdfText(documentText);
  const signed = new Set<number>();
  for (const match of normalized.matchAll(/([+-])\s*(\d+(?:\.\d+)?)\s*V\b/gi)) {
    const value = Number(match[2]) * (match[1] === "-" ? -1 : 1);
    if (Number.isFinite(value) && Math.abs(value) <= 5) signed.add(value);
  }
  const values = [...signed];
  if (/\b0(?:\.0+)?\s*V\b/i.test(normalized)) values.push(0);
  const unique = [...new Set(values)].sort((a, b) => b - a);
  if (unique.length === expectedCount) return unique;

  // Prefer the smallest symmetric signed series when unrelated voltages occur elsewhere in the paper.
  const symmetric = unique.filter((value) => value === 0 || unique.includes(-value));
  if (symmetric.length === expectedCount) return symmetric.sort((a, b) => b - a);
  return null;
}

function normalizePdfText(value: string): string {
  return value
    .replace(/\u0002\s*(?=\d)/g, "-")
    .replace(/[\u2212\u2013\u2014]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/NO\s+3\b/g, "NO3")
    .trim();
}

function dominantChromaticHue(source: PixelSource): number | null {
  const bins = new Array<number>(36).fill(0);
  for (let y = 0; y < source.height; y += 2) {
    for (let x = 0; x < source.width; x += 2) {
      const offset = (y * source.width + x) * 4;
      const hsv = rgbToHsv(source.data[offset], source.data[offset + 1], source.data[offset + 2]);
      if (hsv.s < 0.28 || hsv.v < 0.12 || hsv.v > 0.95) continue;
      bins[Math.floor(hsv.h / 10) % bins.length] += hsv.s * (1.05 - hsv.v * 0.2);
    }
  }
  const best = bins.reduce((index, value, candidate) => value > bins[index] ? candidate : index, 0);
  return bins[best] > 4 ? best * 10 + 5 : null;
}

function histogramClusters(histogram: number[]): HistogramCluster[] {
  const radius = Math.max(2, Math.round(histogram.length / 360));
  const smoothed = histogram.map((_, index) => {
    let sum = 0;
    for (let offset = -radius; offset <= radius; offset += 1) {
      const position = index + offset;
      if (position >= 0 && position < histogram.length) sum += histogram[position];
    }
    return sum;
  });
  const positive = smoothed.filter((value) => value > 0).sort((a, b) => a - b);
  if (!positive.length) return [];
  const threshold = Math.max(2, percentile(positive, 0.25));
  const maxGap = Math.max(3, Math.round(histogram.length * 0.0035));
  const clusters: HistogramCluster[] = [];
  let start = -1;
  let last = -1;
  for (let index = 0; index < smoothed.length; index += 1) {
    if (smoothed[index] > threshold) {
      if (start < 0) start = index;
      last = index;
      continue;
    }
    if (start >= 0 && index - last > maxGap) {
      clusters.push(toCluster(smoothed, start, last));
      start = -1;
      last = -1;
    }
  }
  if (start >= 0) clusters.push(toCluster(smoothed, start, last));
  const minimumWidth = Math.max(5, Math.round(histogram.length * 0.006));
  return clusters.filter((cluster) => cluster.end - cluster.start + 1 >= minimumWidth);
}

function toCluster(histogram: number[], start: number, end: number): HistogramCluster {
  let weight = 0;
  let weightedPosition = 0;
  for (let index = start; index <= end; index += 1) {
    weight += histogram[index];
    weightedPosition += histogram[index] * index;
  }
  return { start, end, center: weight ? weightedPosition / weight : (start + end) / 2, weight };
}

function expandedClusterBounds(clusters: HistogramCluster[], dimension: number, axis: "x" | "y") {
  return clusters.map((cluster, index) => {
    const width = cluster.end - cluster.start + 1;
    const previous = clusters[index - 1];
    const next = clusters[index + 1];
    const before = previous ? Math.floor((previous.end + cluster.start) / 2) : Math.floor(cluster.start - width * (axis === "x" ? 0.3 : 0.2));
    const after = next ? Math.ceil((cluster.end + next.start) / 2) : Math.ceil(cluster.end + width * (axis === "x" ? 0.2 : 0.35));
    return { start: Math.max(0, before), end: Math.min(dimension - 1, after) };
  });
}

function percentile(values: number[], fraction: number): number {
  if (!values.length) return 0;
  const position = Math.max(0, Math.min(values.length - 1, (values.length - 1) * fraction));
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return lower === upper ? values[lower] : values[lower] + (values[upper] - values[lower]) * (position - lower);
}

function rgbToHsv(r: number, g: number, b: number) {
  const red = r / 255; const green = g / 255; const blue = b / 255;
  const max = Math.max(red, green, blue); const min = Math.min(red, green, blue); const delta = max - min;
  let h = 0;
  if (delta) {
    if (max === red) h = 60 * (((green - blue) / delta) % 6);
    else if (max === green) h = 60 * ((blue - red) / delta + 2);
    else h = 60 * ((red - green) / delta + 4);
  }
  if (h < 0) h += 360;
  return { h, s: max ? delta / max : 0, v: max };
}

function hueDistance(a: number, b: number) {
  const difference = Math.abs(a - b) % 360;
  return Math.min(difference, 360 - difference);
}

function formatSigned(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}
