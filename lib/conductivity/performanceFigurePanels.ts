import type {
  ConductivityPerformanceFigure,
  ConductivityPerformancePanel,
} from "./schema";
import type { BBox } from "../schema";

interface CaptionPanel {
  label: string;
  title: string;
  start: number;
}

const FIELD_WORDS: Record<string, RegExp> = {
  conductivity: /conductiv|arrhenius|\bVTF\b/i,
  viscosity: /viscos|rheolog/i,
  electrochemicalWindow: /\bCV\b|\bLSV\b|voltam|stability|anodic|cathodic/i,
  chargeTransferResistance: /nyquist|bode|impedance|\bEIS\b|warburg|R\s*ct/i,
  capacitance: /capacit|bode|impedance|\bEIS\b/i,
  electricField: /electric\s+field|field\s+(?:strength|profile|distribution)/i,
};

const NON_CURVE_PANEL = /equivalent\s+circuit|schematic|microscop|micrograph|\bSEM\b|\bTEM\b|photograph|morpholog/i;

function expandPanelToken(start: string, end?: string): string[] {
  const first = start.toUpperCase().charCodeAt(0);
  const last = (end ?? start).toUpperCase().charCodeAt(0);
  if (first < 65 || last > 84 || last < first) return [];
  return Array.from({ length: last - first + 1 }, (_, index) => String.fromCharCode(first + index));
}

/** Extract ordered A–T panel labels and nearby caption descriptions. */
export function parseCaptionPanels(caption: string): CaptionPanel[] {
  const matches = [...caption.matchAll(/(?:\(([A-T])(?:\s*[–—-]\s*([A-T]))?\)|\b([A-T])\))/gi)];
  const panels: CaptionPanel[] = [];
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const markerStart = match.index ?? 0;
    const markerEnd = markerStart + match[0].length;
    const previousBoundary = Math.max(
      caption.lastIndexOf(";", markerStart - 1),
      caption.lastIndexOf(":", markerStart - 1),
      caption.lastIndexOf(".", markerStart - 1),
      caption.lastIndexOf(",", markerStart - 1),
      caption.lastIndexOf(" and ", markerStart - 1) + 4,
    );
    const nextMarker = matches[index + 1]?.index ?? caption.length;
    const nextBoundaryCandidates = [
      caption.indexOf(";", markerEnd),
      caption.indexOf(".", markerEnd),
      caption.indexOf(",", markerEnd),
      caption.indexOf(" and ", markerEnd),
    ].filter((value) => value >= 0 && value < nextMarker + 12);
    const nextBoundary = nextBoundaryCandidates.length ? Math.min(...nextBoundaryCandidates) : nextMarker;
    const before = caption.slice(Math.max(previousBoundary + 1, markerStart - 100), markerStart).trim();
    const after = caption.slice(markerEnd, Math.min(caption.length, Math.max(markerEnd, nextBoundary))).trim();
    const title = `${before}${before && after ? " — " : ""}${after}`
      .replace(/\s+/g, " ")
      .replace(/^[,;:\s]+|[,;:\s]+$/g, "")
      .slice(0, 240);
    for (const label of expandPanelToken(match[1] ?? match[3], match[2])) {
      if (!panels.some((panel) => panel.label === label)) panels.push({ label, title, start: markerStart });
    }
  }
  return panels;
}

function explicitPanelLabel(figureLabel: string): string | null {
  return figureLabel.match(/(?:fig(?:ure)?\.?\s*)?S?\d+\s*([A-T])\b/i)?.[1]?.toUpperCase() ?? null;
}


/**
 * Select relevant panels only after their boxes have been located in artwork.
 * Caption labels alone cannot determine the page geometry.
 */
export function buildRelevantFigurePanels(
  figure: ConductivityPerformanceFigure,
  locatedBoxes?: BBox[],
): ConductivityPerformancePanel[] {
  if (!figure.caption || !figure.figureBox) return [];
  const allPanels = parseCaptionPanels(figure.caption);
  if (allPanels.length < 2 || !locatedBoxes || locatedBoxes.length !== allPanels.length) return [];
  const explicit = explicitPanelLabel(figure.figure);
  const targetWords = FIELD_WORDS[figure.primaryField ?? ""];
  let selected = explicit
    ? allPanels.filter((panel) => panel.label === explicit)
    : allPanels.filter((panel) => !NON_CURVE_PANEL.test(panel.title) && (!targetWords || targetWords.test(panel.title)));

  // Captions such as "Voltammograms ... where Ln is (a) Er, (b) Gd..."
  // name the scientific plot family once, then use panel clauses only for
  // sample identities. In that case every non-schematic panel is relevant.
  if (!selected.length && targetWords?.test(figure.caption)) {
    selected = allPanels.filter((panel) => !NON_CURVE_PANEL.test(panel.title));
  }
  if (!selected.length) return [];

  return selected.map((panel) => {
    const index = allPanels.findIndex((candidate) => candidate.label === panel.label);
    return {
      label: panel.label,
      title: panel.title || undefined,
      figureBox: locatedBoxes[index],
      seriesLabels: figure.seriesLabel ? [figure.seriesLabel] : undefined,
      source: "paper-text" as const,
      confidence: 0.8,
    };
  });
}
