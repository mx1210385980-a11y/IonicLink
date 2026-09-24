import { normalizeDoi } from "../doi";

export interface AfmPhysicalAxes {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  xUnit: string;
  yUnit: string;
}

export interface AfmAutomaticAxisCalibration {
  status: "auto-calibrated" | "relative-only";
  axes: AfmPhysicalAxes | null;
  /** Independently resolved components retained for shared-axis panel merging. */
  partialAxes?: Partial<AfmPhysicalAxes>;
  confidence: number;
  method: "verified-source-profile" | "explicit-document-range" | "figure-axis-ocr" | "relative-pixel-fallback";
  evidence: string[];
}

interface AxisProfile {
  axes: AfmPhysicalAxes;
  figureLabel?: string;
  evidence: string;
}

/**
 * Source-specific calibrations are keyed by DOI, never by a local filename.
 * They represent axis scales verified against the published source figure and
 * can therefore be inherited by every panel that shares the same axes.
 */
const VERIFIED_SOURCE_PROFILES = new Map<string, AxisProfile>([
  [
    "10.1039/c4cp04522j",
    {
      figureLabel: "1",
      axes: { xMin: -1, xMax: 3, yMin: -2, yMax: 12, xUnit: "nm", yUnit: "nN" },
      evidence: "Figure 1 uses shared apparent-separation (-1 to 3 nm) and normal-force (-2 to 12 nN) axes across panels A-T.",
    },
  ],
  [
    "10.5796/electrochemistry.23-69151",
    {
      figureLabel: "6",
      axes: { xMin: -1, xMax: 10, yMin: 0, yMax: 2, xUnit: "nm", yUnit: "nN" },
      evidence: "Figure 6a reports apparent separation from -1 to 10 nm and normal force from 0 to 2.0 nN.",
    },
  ],
  [
    "10.1002/admi.202202110",
    {
      figureLabel: "1B",
      axes: { xMin: 3.5, xMax: -0.5, yMin: -2, yMax: 14, xUnit: "nm", yUnit: "nN" },
      evidence: "Figure 1B plots force from -2 to 14 nN against separation from 3.5 nm at the left to -0.5 nm at the right.",
    },
  ],
  [
    "10.1039/c7cp06948k",
    {
      figureLabel: "1",
      axes: { xMin: 0, xMax: 5, yMin: -10, yMax: 30, xUnit: "nm", yUnit: "pN" },
      evidence: "Figure 1 reports distance from 0 to 5 nm and force from -10 to 30 pN for BMIM-TFSI on rubrene (001).",
    },
  ],
]);

export function inferAfmAxisCalibration(input: {
  doi: string | null;
  documentText: string;
  figureLabel: string | null;
}): AfmAutomaticAxisCalibration {
  const doi = input.doi ? normalizeDoi(input.doi) : null;
  const profile = doi ? VERIFIED_SOURCE_PROFILES.get(doi) : null;
  // A figure-specific source profile must never leak onto another curve merely
  // because that candidate lost its panel metadata. Unknown is not a match.
  if (profile && (!profile.figureLabel || profile.figureLabel === input.figureLabel)) {
    return {
      status: "auto-calibrated",
      axes: profile.axes,
      confidence: 0.99,
      method: "verified-source-profile",
      evidence: [`DOI ${doi}`, profile.evidence],
    };
  }

  const explicit = inferExplicitDocumentRanges(input.documentText);
  if (explicit) {
    return {
      status: "auto-calibrated",
      axes: explicit,
      confidence: 0.9,
      method: "explicit-document-range",
      evidence: ["Axis endpoints and units were explicitly reported in the PDF text layer."],
    };
  }

  return {
    status: "relative-only",
    axes: null,
    confidence: 0,
    method: "relative-pixel-fallback",
    evidence: ["The curve centreline was extracted automatically, but no trustworthy physical-axis endpoints were resolved."],
  };
}

/** Conservative parser: only accepts prose that explicitly states both ends. */
function inferExplicitDocumentRanges(text: string): AfmPhysicalAxes | null {
  const compact = text.replace(/[\u2212\u2013\u2014]/g, "-").replace(/\s+/g, " ");
  const x = compact.match(/(?:apparent\s+)?(?:separation|distance)[^.;]{0,50}?(?:from|range(?:d)?\s*(?:of|:)?)[\s]*(-?\d+(?:\.\d+)?)\s*(?:to|[-~])\s*(-?\d+(?:\.\d+)?)\s*(nm|(?:micro|\u00b5|u)m|angstrom|\u00c5)/i);
  const y = compact.match(/(?:normal\s+)?force[^.;]{0,50}?(?:from|range(?:d)?\s*(?:of|:)?)[\s]*(-?\d+(?:\.\d+)?)\s*(?:to|[-~])\s*(-?\d+(?:\.\d+)?)\s*(nN|\u00b5N|uN|mN|N)/i);
  if (!x || !y) return null;
  const axes = {
    xMin: Number(x[1]), xMax: Number(x[2]), yMin: Number(y[1]), yMax: Number(y[2]),
    xUnit: normalizeUnit(x[3]), yUnit: normalizeUnit(y[3]),
  };
  if (![axes.xMin, axes.xMax, axes.yMin, axes.yMax].every(Number.isFinite) || axes.xMin === axes.xMax || axes.yMin === axes.yMax) return null;
  return axes;
}

function normalizeUnit(unit: string) {
  return unit.replace(/^u(?=[mN])/i, "\u00b5").replace(/^micro(?=m$)/i, "\u00b5").replace(/^angstrom$/i, "\u00c5");
}
