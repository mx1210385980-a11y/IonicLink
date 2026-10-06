import type { ConductivityPerformanceFigure } from "./schema";

export type PerformanceTargetField =
  | "conductivity"
  | "electrochemicalWindow"
  | "chargeTransferResistance"
  | "capacitance"
  | "viscosity"
  | "electricField";

export interface PerformanceFigureTarget {
  field: PerformanceTargetField;
  rawValue: string;
  provenancePage: number;
  method?: string;
  seriesTokens?: string[];
}

export interface FigureTextCandidate {
  figure: string;
  page: number;
  score: number;
  captionLike: boolean;
  keywordHits: string[];
  valueMatched: boolean;
  seriesHits: string[];
  line: string;
  context: string;
  reasons: string[];
}

export interface SourceTextPage {
  page: number;
  text: string;
}

const FIELD_KEYWORDS: Record<PerformanceTargetField, RegExp[]> = {
  conductivity: [
    /ionic\s+conductiv/i,
    /conductivity/i,
    /specific\s+conductance/i,
    /arrhenius/i,
    /vogel[–-]?tammann[–-]?fulcher|\bVTF\b/i,
  ],
  electrochemicalWindow: [
    /electrochemical\s+(?:stability\s+)?window/i,
    /cyclic\s+voltam|\bCV\b/i,
    /linear\s+sweep|\bLSV\b/i,
    /voltammogram/i,
    /anodic|cathodic/i,
  ],
  chargeTransferResistance: [
    /charge[–-]?transfer\s+resistance/i,
    /\bR\s*ct\b|\bRct\b/i,
    /nyquist/i,
    /electrochemical\s+impedance|\bEIS\b/i,
    /impedance\s+spectr/i,
    /impedance/i,
  ],
  capacitance: [
    /capacitance/i,
    /double[–-]?layer|\bC\s*dl\b|\bCdl\b/i,
    /bode/i,
    /electrochemical\s+impedance|\bEIS\b/i,
  ],
  viscosity: [
    /viscosity|viscosities/i,
    /rheolog/i,
    /viscomet/i,
  ],
  electricField: [
    /electric\s+field/i,
    /field\s+(?:strength|distribution|profile)/i,
    /line\s+profile/i,
  ],
};

const UNRELATED_VISUAL =
  /\b(?:SEM|TEM|XRD|XPS|FTIR|AFM|Raman|microscop|micrograph|morpholog|spectrum)\b/i;

function compact(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[−–—]/g, "-")
    .replace(/ω/g, "ohm")
    .replace(/\s+/g, "");
}

function numericToken(raw: string): string | null {
  return raw.replace(/,/g, "").match(/[+-]?(?:\d+(?:\.\d+)?|\.\d+)/)?.[0] ?? null;
}

function valueAppears(context: string, raw: string): boolean {
  const number = numericToken(raw);
  if (!number) return false;
  return compact(context).includes(compact(number));
}

function normalizeFigure(number: string, panel?: string): string {
  return `Fig. ${number.toUpperCase()}${panel?.toLowerCase() ?? ""}`;
}

function panelImmediatelyAfter(text: string, end: number): string | undefined {
  return text.slice(end, end + 16).match(/^\s*[.,:]?\s*\(?\s*([A-T])\s*\)/i)?.[1];
}

function targetPanelFromCaption(
  line: string,
  initialPanel: string | undefined,
  field: PerformanceTargetField,
): string | undefined {
  const figureEnd = line.match(/\bfig(?:ure)?\.?\s*S?\d+(?:\s*[A-T])?/i)?.[0].length ?? 0;
  const tail = line.slice(figureEnd);
  const markerPattern = /(?:^|[;,:]|\band\b)\s*\(?\s*([A-T])\s*\)?\s+/gi;
  const markers = [...tail.matchAll(markerPattern)].map((match) => ({
    panel: match[1],
    start: match.index ?? 0,
    contentStart: (match.index ?? 0) + match[0].length,
  }));
  for (let index = 0; index < markers.length; index += 1) {
    const marker = markers[index];
    const segment = tail.slice(marker.contentStart, markers[index + 1]?.start ?? tail.length);
    if (FIELD_KEYWORDS[field].some((pattern) => pattern.test(segment))) return marker.panel;
  }
  return initialPanel;
}

function lineBounds(text: string, index: number): [number, number] {
  const start = Math.max(0, text.lastIndexOf("\n", index - 1) + 1);
  const next = text.indexOf("\n", index);
  return [start, next < 0 ? text.length : next];
}

function safeSeriesTokens(tokens: string[] | undefined): string[] {
  return [...new Set((tokens ?? [])
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !/^(?:bulk|liquid|electrode|surface)$/i.test(token)))]
    .slice(0, 8);
}

/**
 * Find and rank source-text figure mentions for one approved target value.
 * This deliberately requires target-specific scientific wording; a nearby
 * figure number by itself is never enough to become a database link.
 */
export function findPerformanceFigureCandidates(
  pages: SourceTextPage[],
  target: PerformanceFigureTarget,
  pageRadius = 2,
): FigureTextCandidate[] {
  const candidates: FigureTextCandidate[] = [];
  const seriesTokens = safeSeriesTokens(target.seriesTokens);
  const figurePattern = /\bfig(?:ure)?\.?\s*(S?\d+)(?:\s*([A-T]))?(?![A-Za-z])/gi;

  for (const page of pages) {
    const distance = Math.abs(page.page - target.provenancePage);
    if (distance > pageRadius) continue;
    for (const match of page.text.matchAll(figurePattern)) {
      if (match.index == null) continue;
      const immediatePanel = match[2] ?? panelImmediatelyAfter(page.text, match.index + match[0].length);
      const [lineStart, lineEnd] = lineBounds(page.text, match.index);
      const line = page.text.slice(lineStart, lineEnd).trim();
      const panel = targetPanelFromCaption(line, immediatePanel, target.field);
      const figure = normalizeFigure(match[1], panel);
      const captionLike = /^(?:fig(?:ure)?\.?)\s*S?\d+/i.test(line);
      const contextStart = Math.max(0, match.index - 220);
      const contextEnd = Math.min(page.text.length, match.index + match[0].length + 620);
      const context = page.text.slice(contextStart, contextEnd).replace(/\s+/g, " ").trim();
      const lineKeywordHits = FIELD_KEYWORDS[target.field]
        .filter((pattern) => pattern.test(line))
        .map((pattern) => pattern.source);
      // The property must be named by the caption/figure line itself. Without
      // this guard, a nearby SEM or schematic can inherit performance words
      // from the surrounding paragraph and look deceptively high-confidence.
      if (!lineKeywordHits.length && !valueAppears(line, target.rawValue)) continue;
      const keywordHits = FIELD_KEYWORDS[target.field]
        .filter((pattern) => pattern.test(context))
        .map((pattern) => pattern.source);
      if (!keywordHits.length) continue;

      const valueMatched = valueAppears(context, target.rawValue);
      const seriesHits = seriesTokens.filter((token) => compact(context).includes(compact(token)));
      const reasons: string[] = [];
      let score = 0;
      if (captionLike) {
        score += 11;
        reasons.push("caption-like figure label");
      }
      const keywordScore = Math.min(12, 7 + (keywordHits.length - 1) * 2);
      score += keywordScore;
      reasons.push(`${keywordHits.length} target keyword match(es)`);
      if (valueMatched) {
        score += 6;
        reasons.push("approved target value appears nearby");
      }
      if (seriesHits.length) {
        const seriesScore = Math.min(4, seriesHits.length * 2);
        score += seriesScore;
        reasons.push(`${seriesHits.length} record-series token match(es)`);
      }
      const proximity = distance === 0 ? 4 : distance === 1 ? 2 : 0;
      score += proximity;
      if (proximity) reasons.push(`within ${distance} page(s) of target provenance`);
      if (UNRELATED_VISUAL.test(line)) {
        score -= 14;
        reasons.push("unrelated visual terminology in caption");
      }

      candidates.push({
        figure,
        page: page.page,
        score,
        captionLike,
        keywordHits,
        valueMatched,
        seriesHits,
        line,
        context,
        reasons,
      });
    }
  }

  const deduplicated = new Map<string, FigureTextCandidate>();
  for (const candidate of candidates) {
    const key = `${candidate.page}:${candidate.figure.toLowerCase()}`;
    const current = deduplicated.get(key);
    if (!current || candidate.score > current.score) deduplicated.set(key, candidate);
  }
  return [...deduplicated.values()].sort(
    (a, b) => b.score - a.score || Number(b.captionLike) - Number(a.captionLike) || a.page - b.page,
  );
}

export function curvePresentation(field: PerformanceTargetField, method?: string): Pick<
  ConductivityPerformanceFigure,
  "curveType" | "xAxis" | "yAxis"
> {
  const methodText = method ?? "";
  if (field === "chargeTransferResistance") {
    return { curveType: "EIS Nyquist plot", xAxis: "Z′", yAxis: "−Z″" };
  }
  if (field === "capacitance") {
    return /bode/i.test(methodText)
      ? { curveType: "EIS Bode plot", xAxis: "Frequency", yAxis: "Impedance / phase" }
      : { curveType: "Capacitance curve", xAxis: "Reported condition", yAxis: "Capacitance" };
  }
  if (field === "electrochemicalWindow") {
    const curveType = /lsv|linear\s+sweep/i.test(methodText) ? "Linear sweep voltammogram" : "Cyclic voltammogram";
    return { curveType, xAxis: "Potential", yAxis: "Current / current density" };
  }
  if (field === "conductivity") {
    return { curveType: "Ionic-conductivity curve", xAxis: "Temperature / composition", yAxis: "Ionic conductivity" };
  }
  if (field === "viscosity") {
    return { curveType: "Viscosity curve", xAxis: "Temperature / composition", yAxis: "Dynamic viscosity" };
  }
  return { curveType: "Electric-field profile", xAxis: "Position", yAxis: "Electric field strength" };
}
