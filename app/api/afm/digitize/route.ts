import { NextRequest, NextResponse } from "next/server";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { requireAppApiSession } from "@/lib/auth.server";
import { extractDoiFromPages, normalizeDoi } from "@/lib/doi";
import { AFM_CURVE_DATASET } from "@/lib/afm/afmCurves";
import { inferAfmAxisCalibration } from "@/lib/afm/axisCalibration";
import type { AfmAutomaticAxisCalibration } from "@/lib/afm/axisCalibration";
import { digitizeAfmRgba, type AfmDigitizationAnalysis } from "@/lib/afm/digitizeCurve";
import { extractAfmExperimentalMetadata } from "@/lib/afm/experimentalMetadata";
import { inferAfmAxisCalibrationFromImage } from "@/lib/afm/imageAxisOcr.server";
import {
  detectAfmPanelBoxes,
  inferGenericAfmPanelConditions,
  parseAfmMultiPanelLayout,
  type AfmMultiPanelLayout,
  type AfmPanelConditions,
} from "@/lib/afm/multiPanel";
import { pdfPageImageBoxes, pdfPageTextSpans, pdfToPages, renderPdfPage } from "@/lib/pdf";
import type { TextSpan } from "@/lib/evidence";

export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_UPLOAD_BYTES = 35 * 1024 * 1024;
const MAX_PDF_PAGES_TO_RENDER = 8;
const MAX_RETURNED_CANDIDATES = 32;
const PDF_FIGURE_RENDER_SCALE = 3;

interface DigitizationCandidate {
  id: string;
  page: number | null;
  pageLabel: string;
  /** Figure identifier from the caption, independent of panel metadata. */
  figureLabel: string | null;
  imageDataUrl: string;
  sourceFigure: {
    kind: "pdf-panel-crop" | "pdf-figure-crop" | "pdf-page" | "uploaded-image";
    width: number;
    height: number;
    renderScale: number | null;
    crop: FractionalCrop | null;
  };
  panel: {
    figureLabel: string;
    label: string;
    row: number;
    column: number;
    rows: number;
    columns: number;
    suggestedLabel: string;
    conditions: AfmPanelConditions;
  } | null;
  analysis: AfmDigitizationAnalysis;
  paperSignal: number;
  rankScore: number;
  axisCalibration?: AfmAutomaticAxisCalibration;
  experimentalMetadata?: ReturnType<typeof extractAfmExperimentalMetadata>;
}

export async function POST(request: NextRequest) {
  const access = await requireAppApiSession(request);
  if (!access.ok) return access.response;

  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "Choose a PDF or image first." }, { status: 400 });
    if (file.size <= 0) return NextResponse.json({ error: "The uploaded file is empty." }, { status: 400 });
    if (file.size > MAX_UPLOAD_BYTES) return NextResponse.json({ error: "Files larger than 35 MB are not supported." }, { status: 413 });

    const bytes = new Uint8Array(await file.arrayBuffer());
    const extension = file.name.toLowerCase().split(".").pop() ?? "";
    let candidates: DigitizationCandidate[];
    let totalPages: number | null = null;
    let detectedDoi: string | null = null;
    let matchedCurveIds: string[] = [];
    let documentText = "";

    if (extension === "pdf" || file.type === "application/pdf") {
      const pages = await pdfToPages(bytes);
      documentText = pages.map((page) => page.text).join("\n");
      totalPages = pages.length;
      detectedDoi = extractDoiFromPages(pages);
      matchedCurveIds = detectedDoi
        ? AFM_CURVE_DATASET.curves
            .filter((curve) => normalizeDoi(curve.source.doi ?? "") === detectedDoi)
            .map((curve) => curve.id)
        : [];
      const rankedPages = rankPdfPages(pages).slice(0, MAX_PDF_PAGES_TO_RENDER);
      candidates = [];
      for (const ranked of rankedPages) {
        try {
          const png = await renderPdfPage(bytes, ranked.page, PDF_FIGURE_RENDER_SCALE);
          const spans = await pdfPageTextSpans(bytes, ranked.page);
          const imageBoxes = await pdfPageImageBoxes(bytes, ranked.page);
          const locatedFigure = findAfmFigureContext(spans);
          const captionLayout = locatedFigure ? parseAfmMultiPanelLayout(locatedFigure.caption, documentText) : null;
          const pageLayout = parseAfmMultiPanelLayout(pages[ranked.page - 1]?.text ?? "", documentText);
          const layout = captionLayout ?? pageLayout;
          if (locatedFigure && layout) {
            const largestImage = [...imageBoxes].sort((a, b) => b.w * b.h - a.w * a.h)[0];
            const sharedFigureCrop: FractionalCrop = largestImage && largestImage.w * largestImage.h >= 0.2
              ? {
                  left: Math.max(0.025, largestImage.x - 0.055),
                  right: Math.min(0.975, largestImage.x + largestImage.w + 0.055),
                  top: Math.max(0.025, largestImage.y - 0.012),
                  bottom: Math.min(0.96, largestImage.y + largestImage.h + 0.015),
                }
              : {
                  left: 0.045,
                  right: 0.955,
                  bottom: locatedFigure.crop.bottom,
                  top: Math.max(0.025, locatedFigure.crop.bottom - 0.91 * 0.72),
                };
            const panelCandidates = await analyseMultiPanelImage(png, ranked.page, ranked.score, sharedFigureCrop, layout);
            if (panelCandidates.length === layout.rows * layout.columns) {
              candidates = panelCandidates;
              break;
            }
          }
          const figure = locatedFigure
            ? {
                ...locatedFigure,
                crop: /\(b\).*?(?:enlarged|magnified|zoom)/i.test(locatedFigure.caption)
                  ? locatedFigure.crop
                  : snapFigureCropToImageBox(locatedFigure.crop, imageBoxes),
              }
            : null;
          const crop = figure?.crop ?? null;
          const genericLayout = figure ? inferGenericPanelLayout(figure.caption) : null;
          let genericCandidates: DigitizationCandidate[] = [];
          if (figure && genericLayout) {
            genericCandidates = await analyseGenericFigurePanels(
              png,
              ranked.page,
              ranked.score,
              figure.crop,
              genericLayout,
              figure.caption,
              documentText,
            );
            candidates.push(...genericCandidates);
          }
          if (!genericCandidates.length) {
            const analysed = await analyseImage(png, `page-${ranked.page}`, {
              crop,
              sourceKind: crop ? "pdf-figure-crop" : "pdf-page",
              renderScale: PDF_FIGURE_RENDER_SCALE,
              caption: figure?.caption ?? "",
            });
            candidates.push({
              ...analysed,
              id: `page-${ranked.page}`,
              page: ranked.page,
              pageLabel: `PDF page ${ranked.page}${crop ? " · figure crop" : ""}`,
              figureLabel: figure ? extractFigureLabel(figure.caption) : null,
              panel: null,
              paperSignal: ranked.score,
              rankScore: analysed.analysis.confidence + Math.min(0.24, ranked.score / 70) + experimentalFigureScore(figure?.caption ?? ""),
            });
          }
        } catch (error) {
          // A malformed text span or an implausibly small inferred crop on one
          // page must not abort the complete PDF upload. Other signal-bearing
          // pages can still contain valid force curves.
          console.warn("[afm-digitize] skipped PDF page", {
            page: ranked.page,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      if (!candidates.some((candidate) => candidate.panel)) {
        // A caption-anchored figure crop is stronger evidence than colour found
        // on an entire page. Once a credible figure crop exists, discard raw
        // page fallbacks so journal logos, graphical abstracts and coloured
        // headings cannot appear as competing AFM curves.
        const credibleFigureCrops = candidates.filter((candidate) =>
          candidate.sourceFigure.kind === "pdf-figure-crop" && candidate.analysis.isLikelyCurve,
        );
        if (credibleFigureCrops.length) candidates = credibleFigureCrops;
        candidates.sort((a, b) => b.rankScore - a.rankScore);
        candidates = candidates.slice(0, MAX_RETURNED_CANDIDATES);
      }
    } else if (isSupportedImage(file, extension)) {
      const analysed = await analyseImage(bytes, "image", {
        crop: null,
        sourceKind: "uploaded-image",
        renderScale: null,
      });
      candidates = [{
        ...analysed,
        id: "image",
        page: null,
        pageLabel: "Uploaded figure",
        figureLabel: null,
        panel: null,
        paperSignal: 0,
        rankScore: analysed.analysis.confidence,
      }];
    } else {
      return NextResponse.json({ error: "Supported formats: PDF, PNG, JPG, JPEG and WebP." }, { status: 415 });
    }

    candidates = candidates.filter((candidate) =>
      candidate.analysis.isLikelyCurve && !isWholePageMonochromeFallback(candidate),
    );
    if (!candidates.length) {
      return NextResponse.json({
        error: "No credible AFM force-distance curve was detected. Pages containing only text, tables, annotations, or unrelated graphics are excluded automatically.",
      }, { status: 422 });
    }
    candidates.sort((a, b) => b.rankScore - a.rankScore || (a.page ?? 0) - (b.page ?? 0) || a.id.localeCompare(b.id));
    candidates = candidates.slice(0, MAX_RETURNED_CANDIDATES);
    for (const candidate of candidates) {
      let calibration = inferAfmAxisCalibration({
        doi: detectedDoi,
        documentText,
        figureLabel: candidate.figureLabel ?? candidate.panel?.figureLabel ?? null,
      });
      if (calibration.status !== "auto-calibrated") {
        calibration = await inferAfmAxisCalibrationFromImage(dataUrlBuffer(candidate.imageDataUrl), {
          width: candidate.sourceFigure.width,
          height: candidate.sourceFigure.height,
          plotBox: candidate.analysis.plotBox,
        });
      }
      candidate.axisCalibration = calibration;
      if (calibration.status === "auto-calibrated") {
        candidate.analysis.warnings = candidate.analysis.warnings.filter((warning) => !warning.startsWith("Physical axis values and units"));
      }
    }
    // Horizontal small-multiple strips conventionally share one pair of axes.
    // OCR may miss the y labels printed only on the left-most panel, so inherit
    // calibration within a one-row figure or a row containing 3+ panels. Do
    // not inherit across ordinary 2x2 panels, whose scales often differ.
    const oneRowGroups = new Map<string, DigitizationCandidate[]>();
    for (const candidate of candidates) {
      if (!candidate.panel || (
        candidate.panel.rows !== 1 &&
        candidate.panel.columns < 3 &&
        candidate.analysis.traceMode !== "density-ridge"
      )) continue;
      const key = `${candidate.page}:${candidate.panel.figureLabel}:${candidate.panel.row}`;
      const group = oneRowGroups.get(key) ?? [];
      group.push(candidate);
      oneRowGroups.set(key, group);
    }
    for (const group of oneRowGroups.values()) {
      let shared = group.find((candidate) => candidate.axisCalibration?.status === "auto-calibrated")?.axisCalibration;
      if (!shared) {
        const horizontal = group.map((candidate) => candidate.axisCalibration).find((calibration) =>
          calibration?.partialAxes?.xMin !== undefined &&
          calibration.partialAxes.xMax !== undefined &&
          calibration.partialAxes.xUnit,
        );
        const vertical = group.map((candidate) => candidate.axisCalibration).find((calibration) =>
          calibration?.partialAxes?.yMin !== undefined &&
          calibration.partialAxes.yMax !== undefined &&
          calibration.partialAxes.yUnit,
        );
        if (horizontal?.partialAxes && vertical?.partialAxes) {
          shared = {
            status: "auto-calibrated",
            axes: {
              xMin: horizontal.partialAxes.xMin!,
              xMax: horizontal.partialAxes.xMax!,
              yMin: vertical.partialAxes.yMin!,
              yMax: vertical.partialAxes.yMax!,
              xUnit: horizontal.partialAxes.xUnit!,
              yUnit: vertical.partialAxes.yUnit!,
            },
            confidence: 0.82,
            method: "figure-axis-ocr",
            evidence: [
              "Horizontal and vertical OCR components were merged across a shared-axis small-multiple row.",
              ...horizontal.evidence,
              ...vertical.evidence,
            ],
          };
        }
      }
      if (!shared) continue;
      for (const candidate of group) {
        if (candidate.axisCalibration?.status === "auto-calibrated") continue;
        candidate.axisCalibration = {
          ...shared,
          confidence: Math.max(0.75, shared.confidence - 0.04),
          evidence: [...shared.evidence, "Inherited across an explicitly shared horizontal small-multiple axis."],
        };
        candidate.analysis.warnings = candidate.analysis.warnings.filter((warning) => !warning.startsWith("Physical axis values and units"));
      }
    }
    const axisCalibration = candidates[0].axisCalibration!;
    if (axisCalibration.method === "verified-source-profile") {
      const calibratedFigure = candidates[0]?.figureLabel ?? candidates[0]?.panel?.figureLabel ?? null;
      if (calibratedFigure) {
        // The response currently exposes one shared calibration. Keep only the
        // panels belonging to that verified figure so a calculated curve from
        // another figure can never inherit the selected experiment's axes.
        candidates = candidates.filter((candidate) =>
          (candidate.figureLabel ?? candidate.panel?.figureLabel ?? null) === calibratedFigure,
        );
      }
    }
    return NextResponse.json({
      schema: "ioniclink.afm-digitization-preview",
      schemaVersion: 4,
      sourceName: file.name,
      sourceType: totalPages === null ? "image" : "pdf",
      totalPages,
      selectedCandidateId: candidates[0].id,
      candidates,
      matchedPaper: detectedDoi ? { doi: detectedDoi, curveIds: matchedCurveIds } : null,
      axisCalibration,
      experimentalMetadata: extractAfmExperimentalMetadata(documentText),
      reviewRequired: true,
      note: axisCalibration.status === "auto-calibrated"
        ? "Curve pixels and physical axes were resolved automatically. Results remain AI-extracted records pending metadata review, not human-verified measurements."
        : "Curve pixels were resolved automatically and retained in relative coordinates because physical-axis endpoints could not be established reliably.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "AFM curve recognition failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function analyseImage(
  bytes: Uint8Array,
  label: string,
  options: {
    crop: FractionalCrop | null;
    sourceKind: DigitizationCandidate["sourceFigure"]["kind"];
    renderScale: number | null;
    caption?: string;
    plotBox?: AfmDigitizationAnalysis["plotBox"];
  },
) {
  const { crop } = options;
  const image = await loadImage(Buffer.from(bytes));
  const sourceX = crop ? Math.round(image.width * crop.left) : 0;
  const sourceY = crop ? Math.round(image.height * crop.top) : 0;
  const sourceWidth = crop ? Math.max(1, Math.round(image.width * (crop.right - crop.left))) : image.width;
  const sourceHeight = crop ? Math.max(1, Math.round(image.height * (crop.bottom - crop.top))) : image.height;
  // Preserve enough pixels for side-by-side source/result review. The previous
  // 1800 px cap was adequate for trace detection but softened small axis text.
  const maxDimension = 2800;
  const scale = Math.min(1, maxDimension / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  const canvas = createCanvas(width, height);
  const context = canvas.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, width, height);
  const pixels = context.getImageData(0, 0, width, height);
  const captionScope = figureCaptionScope(options.caption ?? "");
  const densityCaption = /(?:bivariate|2D)\s+(?:histograms?|distributions?)|hexagonal\s+binning|density\s+(?:plot|map)/i.test(captionScope);
  // A page can mention an earlier density figure immediately above an ordinary
  // multi-series line plot. Require visual evidence of a continuous scientific
  // colour map as well as caption evidence so that red/blue line legends are
  // never routed through the density-ridge extractor.
  const densityPlot = densityCaption && hasDensityPaletteEvidence(pixels.data, width, height);
  // Published bivariate force histograms encode the most probable force as the
  // warm/yellow ridge.  Selecting every bright saturated pixel also captures
  // blue voltage labels (for example "+2.0 V") as disconnected fake curves.
  // The extractor remains colour-independent for ordinary line plots; this
  // yellow peak rule is used only after the figure has been classified as a
  // density histogram.
  const densityPeakColor = "yellow";
  const analysis = digitizeAfmRgba(
    { width, height, data: pixels.data },
    densityPlot
      ? { traceMode: "density-ridge", densityPeakColor, frameArtifactGuard: true, sensitivity: 0.68, plotBox: options.plotBox }
      : { plotBox: options.plotBox },
  );
  const preview = canvas.toBuffer("image/png");
  return {
    id: label,
    page: null,
    pageLabel: label,
    imageDataUrl: `data:image/png;base64,${preview.toString("base64")}`,
    sourceFigure: {
      kind: options.sourceKind,
      width,
      height,
      renderScale: options.renderScale,
      crop,
    },
    analysis,
    panel: null,
  };
}

async function analyseMultiPanelImage(
  bytes: Uint8Array,
  page: number,
  paperSignal: number,
  figureCrop: FractionalCrop,
  layout: AfmMultiPanelLayout,
): Promise<DigitizationCandidate[]> {
  const image = await loadImage(Buffer.from(bytes));
  const sourceX = Math.round(image.width * figureCrop.left);
  const sourceY = Math.round(image.height * figureCrop.top);
  const sourceWidth = Math.max(1, Math.round(image.width * (figureCrop.right - figureCrop.left)));
  const sourceHeight = Math.max(1, Math.round(image.height * (figureCrop.bottom - figureCrop.top)));
  const scale = Math.min(1, 2800 / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  const figureCanvas = createCanvas(width, height);
  const figureContext = figureCanvas.getContext("2d");
  figureContext.fillStyle = "#ffffff";
  figureContext.fillRect(0, 0, width, height);
  figureContext.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, width, height);
  const figurePixels = figureContext.getImageData(0, 0, width, height);
  const detected = detectAfmPanelBoxes({ width, height, data: figurePixels.data }, layout);
  if (detected.length !== layout.rows * layout.columns) return [];

  return detected.map(({ spec, box }) => {
    const panelWidth = Math.max(1, box.right - box.left + 1);
    const panelHeight = Math.max(1, box.bottom - box.top + 1);
    const panelCanvas = createCanvas(panelWidth, panelHeight);
    const panelContext = panelCanvas.getContext("2d");
    panelContext.fillStyle = "#ffffff";
    panelContext.fillRect(0, 0, panelWidth, panelHeight);
    panelContext.drawImage(figureCanvas, box.left, box.top, panelWidth, panelHeight, 0, 0, panelWidth, panelHeight);
    const pixels = panelContext.getImageData(0, 0, panelWidth, panelHeight);
    // A detected grid cell already represents one complete panel.  Do not let
    // the generic single-image heuristic tighten the plot rectangle around the
    // strongest blue fragment: weak long-distance tails would then be cropped
    // out and stretched across the reconstructed chart.  The panel borders are
    // the stable shared-axis frame for this class of figure.
    const analysis = digitizeAfmRgba(
      { width: panelWidth, height: panelHeight, data: pixels.data },
      { plotBox: multiPanelPlotBox(panelWidth, panelHeight, spec.row, layout.rows), sensitivity: 0.72, frameArtifactGuard: true },
    );
    const preview = panelCanvas.toBuffer("image/png");
    const crop = panelCropOnPage(figureCrop, box, width, height);
    return {
      id: `page-${page}-panel-${spec.label}`,
      page,
      pageLabel: `Figure ${layout.figureLabel} · panel ${spec.label}`,
      figureLabel: layout.figureLabel,
      imageDataUrl: `data:image/png;base64,${preview.toString("base64")}`,
      sourceFigure: {
        kind: "pdf-panel-crop" as const,
        width: panelWidth,
        height: panelHeight,
        renderScale: PDF_FIGURE_RENDER_SCALE,
        crop,
      },
      panel: {
        figureLabel: layout.figureLabel,
        label: spec.label,
        row: spec.row,
        column: spec.column,
        rows: layout.rows,
        columns: layout.columns,
        suggestedLabel: spec.suggestedLabel,
        conditions: spec.conditions,
      },
      analysis,
      paperSignal,
      rankScore: analysis.confidence + Math.min(0.24, paperSignal / 70),
    };
  });
}

function multiPanelPlotBox(width: number, height: number, row: number, rows: number): AfmDigitizationAnalysis["plotBox"] {
  const lastRow = row === rows - 1;
  return {
    left: Math.round(width * 0.025),
    top: Math.round(height * 0.065),
    right: Math.round(width * 0.97),
    // Bottom-row crops retain the shared x tick labels beneath the plotting
    // frame; the other grid cells end at their horizontal panel divider.
    bottom: Math.round(height * (lastRow ? 0.75 : 0.985)),
  };
}

function panelCropOnPage(figure: FractionalCrop, box: AfmDigitizationAnalysis["plotBox"], width: number, height: number): FractionalCrop {
  const figureWidth = figure.right - figure.left;
  const figureHeight = figure.bottom - figure.top;
  return {
    left: clamp01(figure.left + (box.left / width) * figureWidth),
    top: clamp01(figure.top + (box.top / height) * figureHeight),
    right: clamp01(figure.left + ((box.right + 1) / width) * figureWidth),
    bottom: clamp01(figure.top + ((box.bottom + 1) / height) * figureHeight),
  };
}

async function analyseGenericFigurePanels(
  bytes: Uint8Array,
  page: number,
  paperSignal: number,
  figure: FractionalCrop,
  layout: { rows: number; columns: number; wideFirst?: boolean },
  caption: string,
  documentText: string,
): Promise<DigitizationCandidate[]> {
  const provisional: DigitizationCandidate[] = [];
  const specs = layout.wideFirst
    ? [
        { row: 0, column: 0, rowSpan: 1, columnSpan: 2, panelLabel: "A" },
        { row: 1, column: 0, rowSpan: 1, columnSpan: 1, panelLabel: "B" },
        { row: 1, column: 1, rowSpan: 1, columnSpan: 1, panelLabel: "C" },
      ]
    : Array.from({ length: layout.rows * layout.columns }, (_, index) => ({
        row: Math.floor(index / layout.columns),
        column: index % layout.columns,
        rowSpan: 1,
        columnSpan: 1,
        panelLabel: String.fromCharCode(65 + index),
      }));
  for (const spec of specs) {
      const { row, column, rowSpan, columnSpan, panelLabel } = spec;
      const description = genericPanelDescription(caption, panelLabel);
      // A composite scientific figure can mix raw force curves with derived
      // histograms, stiffness plots and schematics. Only the raw force panels
      // are eligible for digitisation and later model ingestion.
      if (/(?:schematic|separation\s+histogram|peak\s+fitting|thickness\s+of\s+the\s+layers?|resulting\s+stiffness|stiffness\s+of\s+the\s+layers?)/i.test(description)) continue;
      const semanticScore = genericForcePanelScore(description, caption);
      // Captions frequently describe a panel range once ("Figure 1(A-C)")
      // rather than repeating the measurement noun after A, B, and C. The
      // complete caption has already passed the AFM force-curve gate, so an
      // empty per-letter fragment is not grounds to discard a real panel.
      const figureWidth = figure.right - figure.left;
      const figureHeight = figure.bottom - figure.top;
      const crop: FractionalCrop = {
        left: figure.left + figureWidth * (column / layout.columns),
        right: figure.left + figureWidth * ((column + columnSpan) / layout.columns),
        top: figure.top + figureHeight * (row / layout.rows),
        bottom: figure.top + figureHeight * ((row + rowSpan) / layout.rows),
      };
      const id = `page-${page}-grid-${layout.rows}x${layout.columns}-${row + 1}-${column + 1}`;
      let analysed = await analyseImage(bytes, id, {
        crop,
        sourceKind: "pdf-panel-crop",
        renderScale: PDF_FIGURE_RENDER_SCALE,
        caption,
      });
      const detectedPlotHeight = analysed.analysis.plotBox.bottom - analysed.analysis.plotBox.top;
      if (!analysed.analysis.isLikelyCurve || detectedPlotHeight / analysed.sourceFigure.height < 0.48) {
        analysed = await analyseImage(bytes, id, {
          crop,
          sourceKind: "pdf-panel-crop",
          renderScale: PDF_FIGURE_RENDER_SCALE,
          caption,
          plotBox: {
            left: Math.round(analysed.sourceFigure.width * 0.14),
            top: Math.round(analysed.sourceFigure.height * 0.025),
            right: Math.round(analysed.sourceFigure.width * 0.97),
            bottom: Math.round(analysed.sourceFigure.height * 0.86),
          },
        });
      }
      if (!analysed.analysis.isLikelyCurve) continue;
      provisional.push({
        ...analysed,
        id,
        page,
        pageLabel: `PDF page ${page} · detected panel ${panelLabel}`,
        figureLabel: extractFigureLabel(caption),
        panel: {
          figureLabel: extractFigureLabel(caption) ?? "figure",
          label: panelLabel,
          row,
          column,
          rows: layout.rows,
          columns: layout.columns,
          suggestedLabel: suggestedGenericPanelLabel(caption, documentText, panelLabel),
          conditions: inferGenericAfmPanelConditions(caption, documentText, panelLabel),
        },
        experimentalMetadata: extractAfmExperimentalMetadata(`${caption} ${documentText}`),
        paperSignal,
        rankScore: analysed.analysis.confidence + Math.min(0.24, paperSignal / 70) + semanticScore + experimentalFigureScore(caption) + (analysed.analysis.traceMode === "density-ridge" ? 0.34 : 0),
      });
  }

  provisional.sort((a, b) => b.rankScore - a.rankScore);
  const kept: DigitizationCandidate[] = [];
  for (const candidate of provisional) {
    const crop = candidate.sourceFigure.crop;
    if (!crop || kept.some((other) => other.sourceFigure.crop && cropOverlap(crop, other.sourceFigure.crop) > 0.46)) continue;
    kept.push(candidate);
    if (kept.length >= MAX_RETURNED_CANDIDATES) break;
  }
  return kept;
}

function inferGenericPanelLayout(caption: string): { rows: number; columns: number; wideFirst?: boolean } | null {
  const labels = genericPanelMarkers(caption).map((match) => match.label);
  for (const range of caption.matchAll(/\(([A-Z])\s*[-–—]\s*([A-Z])\)/g)) {
    const start = range[1].charCodeAt(0);
    const end = range[2].charCodeAt(0);
    for (let value = start; value <= end; value += 1) labels.push(String.fromCharCode(value));
  }
  const unique = [...new Set(labels.map((label) => label.toUpperCase()))];
  if (unique.length < 2) return null;
  const highest = Math.max(...unique.map((label) => label.charCodeAt(0) - 64));
  if (highest <= 3 && labels.every((label) => label === label.toLowerCase())) return { rows: 2, columns: 2, wideFirst: true };
  if (highest <= 3) return { rows: 1, columns: 3 };
  if (highest === 4) return { rows: 2, columns: 2 };
  return { rows: Math.min(4, Math.ceil(highest / 3)), columns: 3 };
}

function genericPanelDescription(caption: string, targetLabel: string) {
  const markers = genericPanelMarkers(caption);
  const index = markers.findIndex((match) => match.label.toUpperCase() === targetLabel);
  if (index < 0) return "";
  const start = markers[index].end;
  const end = markers[index + 1]?.start ?? caption.length;
  return caption.slice(start, end).trim();
}

function genericPanelMarkers(caption: string) {
  const markers: Array<{ label: string; start: number; end: number }> = [];
  for (const group of caption.matchAll(/\(\s*([A-Za-z](?:\s*,\s*[A-Za-z])+)\s*\)/g)) {
    const labels = group[1].split(",").map((value) => value.trim());
    for (const label of labels) markers.push({ label, start: group.index ?? 0, end: (group.index ?? 0) + group[0].length });
  }
  for (const match of caption.matchAll(/(?:^|[\s;])\(\s*([A-Za-z])\s*\)/g)) {
    markers.push({ label: match[1], start: match.index ?? 0, end: (match.index ?? 0) + match[0].length });
  }
  return markers.sort((a, b) => a.start - b.start || a.label.localeCompare(b.label));
}

function suggestedGenericPanelLabel(caption: string, documentText: string, panelLabel: string) {
  const conditions = inferGenericAfmPanelConditions(caption, documentText, panelLabel);
  const parts = [conditions.ionicLiquid.value, conditions.substrate.value];
  const polarity = extractPanelPolarityForLabel(caption, panelLabel);
  if (conditions.electrodePotential.value !== null) parts.push(`${conditions.electrodePotential.value > 0 ? "+" : ""}${conditions.electrodePotential.value} V`);
  else if (polarity) parts.push(`${polarity} potential`);
  return parts.filter(Boolean).join(" · ") || `Panel ${panelLabel}`;
}

function extractPanelPolarityForLabel(caption: string, panelLabel: string) {
  for (const polarity of ["negative", "positive"] as const) {
    const match = caption.match(new RegExp(`${polarity}\\s*\\(\\s*([A-Z](?:\\s*,\\s*[A-Z])*)\\s*\\)`, "i"));
    if (match?.[1].split(",").map((value) => value.trim().toUpperCase()).includes(panelLabel.toUpperCase())) return polarity;
  }
  return null;
}

function genericForcePanelScore(description: string, completeCaption: string) {
  if (!description) return 0;
  let score = /force\s+(?:versus|vs\.?)\s+(?:apparent\s+)?(?:distance|separation)|force[-–—\s]*(?:distance|separation)/i.test(completeCaption) ? 0.2 : 0;
  if (/force\s+(?:versus|vs\.?)\s+(?:apparent\s+)?(?:distance|separation)|force[-–—\s]*(?:distance|separation)/i.test(description)) score += 0.65;
  if (/\bforce\s+curve\b/i.test(description)) score += 0.25;
  if (/(?:amplitude|height|phase|topograph|schematic|histogram|image)/i.test(description)) score -= 0.45;
  return score;
}

function extractFigureLabel(caption: string) {
  return caption.match(/\bFig(?:ure)?\.?\s*([0-9]+[A-Za-z]?)/i)?.[1] ?? null;
}

function figureCaptionScope(caption: string) {
  const figureStart = caption.search(/\bFig(?:ure)?\.?\s*\d+/i);
  return (figureStart >= 0 ? caption.slice(figureStart) : caption).slice(0, 1100);
}

function hasDensityPaletteEvidence(data: Uint8ClampedArray, width: number, height: number) {
  const bins = new Array<number>(36).fill(0);
  let chromaticPixels = 0;
  for (let y = 0; y < height; y += 2) {
    for (let x = 0; x < width; x += 2) {
      const offset = (y * width + x) * 4;
      const red = data[offset] / 255;
      const green = data[offset + 1] / 255;
      const blue = data[offset + 2] / 255;
      const maximum = Math.max(red, green, blue);
      const minimum = Math.min(red, green, blue);
      const delta = maximum - minimum;
      const saturation = maximum ? delta / maximum : 0;
      if (!delta || saturation < 0.3 || maximum < 0.25 || maximum > 0.995) continue;
      let hue = maximum === red
        ? 60 * (((green - blue) / delta) % 6)
        : maximum === green
          ? 60 * ((blue - red) / delta + 2)
          : 60 * ((red - green) / delta + 4);
      if (hue < 0) hue += 360;
      bins[Math.floor(hue / 10) % bins.length] += 1;
      chromaticPixels += 1;
    }
  }
  if (chromaticPixels < Math.max(80, width * height * 0.003)) return false;
  const activeThreshold = Math.max(6, chromaticPixels * 0.004);
  const active = bins.map((count) => count >= activeThreshold);
  let longestRun = 0;
  let currentRun = 0;
  for (let index = 0; index < active.length * 2; index += 1) {
    if (active[index % active.length]) {
      currentRun += 1;
      longestRun = Math.max(longestRun, currentRun);
    } else {
      currentRun = 0;
    }
  }
  longestRun = Math.min(longestRun, active.length);
  const warmBridge = active[4] || active[5] || active[6];
  return longestRun >= 7 || (longestRun >= 5 && warmBridge);
}

/** Prefer primary measured data over calculated/model curves in the same PDF. */
function experimentalFigureScore(caption: string) {
  if (!caption) return 0;
  let score = 0;
  if (/\b(?:measured|experimental|representative)\b/i.test(caption)) score += 0.36;
  if (/\b(?:calculated|computed|simulated|model(?:led|ing)?|ideal\s+probe|theoretical)\b/i.test(caption)) score -= 0.32;
  return score;
}

function cropOverlap(a: FractionalCrop, b: FractionalCrop) {
  const width = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
  const height = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  const intersection = width * height;
  const union = (a.right - a.left) * (a.bottom - a.top) + (b.right - b.left) * (b.bottom - b.top) - intersection;
  return union > 0 ? intersection / union : 0;
}

interface FractionalCrop {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

function snapFigureCropToImageBox(crop: FractionalCrop, imageBoxes: Array<{ x: number; y: number; w: number; h: number }>): FractionalCrop {
  const cropCenterX = (crop.left + crop.right) / 2;
  const candidates = imageBoxes
    .map((box) => ({
      crop: { left: box.x, top: box.y, right: box.x + box.w, bottom: box.y + box.h },
      area: box.w * box.h,
      centerDistance: Math.abs(box.x + box.w / 2 - cropCenterX),
      captionGap: Math.abs(box.y + box.h - crop.bottom),
    }))
    .filter((item) => item.area >= 0.025 && item.captionGap <= 0.16 && item.centerDistance <= 0.3)
    .sort((a, b) => a.captionGap - b.captionGap || b.area - a.area);
  return candidates[0]?.crop ?? crop;
}

/** Locate a likely AFM figure and retain its complete caption for panel mapping. */
function findAfmFigureContext(spans: TextSpan[]): { crop: FractionalCrop; caption: string } | null {
  const lines: Array<{ y: number; x1: number; x2: number; text: string; spans: TextSpan[] }> = [];
  for (const span of spans) {
    const line = lines.find((candidate) =>
      Math.abs(candidate.y - span.y) < 0.0045 &&
      span.x <= candidate.x2 + 0.025 &&
      span.x + span.w >= candidate.x1 - 0.025 &&
      !(
        (candidate.x2 <= 0.5 && span.x >= 0.5) ||
        (candidate.x1 >= 0.5 && span.x + span.w <= 0.5)
      ),
    );
    if (line) {
      line.spans.push(span);
      line.x1 = Math.min(line.x1, span.x);
      line.x2 = Math.max(line.x2, span.x + span.w);
    } else {
      lines.push({ y: span.y, x1: span.x, x2: span.x + span.w, text: span.str, spans: [span] });
    }
  }
  for (const line of lines) {
    line.text = line.spans.sort((a, b) => a.x - b.x).map((span) => span.str).join(" ");
  }
  lines.sort((a, b) => a.y - b.y || a.x1 - b.x1);
  const forceCaptionPattern = /(?:normal\s+)?forces?\s+(?:versus|vs\.?|[-–—])\s+(?:apparent\s+)?(?:distance|separation)|(?:normal\s+)?forces?[^.;]{0,55}?(?:apparent\s+)?separation|force[-–—\s]*(?:distance|separation)|(?:relation|relationship)\s+between\s+(?:normal\s+)?force\s+and\s+(?:apparent\s+)?(?:distance|separation)|(?:transformed\s+)?force\s+curves?/i;
  const figureCaptionPattern = /^\s*(?:Fig(?:ure)?\.?\s*\d+|[A-Z]\s*[.)])/i;
  const captionScore = (text: string) =>
    Number(/force[-–—\s]*(?:distance|separation)|force\s+(?:versus|vs\.?)\s+(?:apparent\s+)?(?:distance|separation)/i.test(text)) * 12 +
    Number(/(?:normal\s+)?forces?[^.;]{0,55}?(?:apparent\s+)?separation/i.test(text)) * 12 +
    Number(/(?:relation|relationship)\s+between\s+(?:normal\s+)?force\s+and\s+(?:apparent\s+)?(?:distance|separation)/i.test(text)) * 14 +
    Number(/transformed\s+force\s+curve/i.test(text)) * 8 +
    Number(/\bAFM\b|atomic\s+force\s+microscop/i.test(text)) * 4 +
    Number(/enlarged|magnified|zoom/i.test(text)) * 2;
  const caption = lines
    .filter((line) => {
      if (!forceCaptionPattern.test(line.text)) return false;
      if (figureCaptionPattern.test(line.text)) return true;
      return lines.some((nearby) =>
        nearby.y <= line.y &&
        line.y - nearby.y <= 0.075 &&
        Math.abs(nearby.x1 - line.x1) <= 0.08 &&
        figureCaptionPattern.test(nearby.text),
      );
    })
    .sort((a, b) => captionScore(b.text) - captionScore(a.text) || a.y - b.y)[0];
  if (!caption) return null;

  // Keep the complete caption, not only its first two lines. Panel semantics
  // (for example A-G with the actual force curve identified as panel B) are
  // commonly described several wrapped lines below the "Figure" marker.
  const captionLines = lines.filter((line) => line.y >= caption.y - 0.045 && line.y <= caption.y + 0.14);
  const captionText = captionLines.map((line) => line.text).join(" ");

  let left = 0.045;
  let right = 0.955;
  const middle = (caption.x1 + caption.x2) / 2;
  const explicitFigureCaption = /\bFig(?:ure)?\.?\s*\d+/i.test(captionText);
  if (!explicitFigureCaption && (caption.x2 < 0.59 || (middle < 0.48 && caption.x2 - caption.x1 < 0.58))) {
    left = 0.045;
    right = 0.505;
  } else if (!explicitFigureCaption && (caption.x1 > 0.42 || (middle >= 0.52 && caption.x2 - caption.x1 < 0.58))) {
    left = 0.495;
    right = 0.955;
  }
  // When panel (b) is explicitly described as a magnified/enlarged view of
  // panel (a), it is supporting detail rather than a second measurement.
  // Retain the complete primary curve on the left and exclude zoom connectors
  // and boxes that otherwise dominate colour-based trace selection.
  if (left === 0.045 && right === 0.955 && /\(b\).*?(?:enlarged|magnified|zoom)/i.test(captionText)) {
    right = 0.505;
  }
  const bottom = Math.min(0.96, caption.y + 0.006);
  // Journal figures in a two-column layout are usually wider than they are
  // tall. Keeping the crop close to the caption avoids selecting table rules
  // from the preceding content as plot axes.
  const isMultiPanelCaption = /\([A-Z]\s*[-–—]\s*[A-Z]/.test(captionText);
  const plotAspectHeight = (right - left) * (right - left < 0.6 ? 0.48 : isMultiPanelCaption ? 0.72 : 0.55);
  const previousFigureCaptionY = Math.max(
    0,
    ...lines
      .filter((line) => line.y < caption.y - 0.01 && /^\s*Fig(?:ure)?\.?\s*\d+/i.test(line.text))
      .map((line) => line.y),
  );
  const naturalTop = Math.max(0.025, bottom - plotAspectHeight);
  const previousBoundary = previousFigureCaptionY ? previousFigureCaptionY + 0.018 : 0;
  // A nearby earlier caption is only a useful upper boundary when it still
  // leaves a realistically sized plot. Bibliographies and dense review pages
  // often contain two caption lines very close together; the old max() could
  // invert the crop and make the upload fail with a "too small" error.
  const minimumFigureHeight = Math.min(0.1, plotAspectHeight * 0.5);
  const top = previousBoundary > naturalTop && previousBoundary <= bottom - minimumFigureHeight
    ? previousBoundary
    : naturalTop;
  return { crop: { left, top, right, bottom }, caption: captionText };
}

/**
 * Black/grey extraction is intentionally supported inside a caption-anchored
 * plot, but never on an uncropped PDF page. At page scale, columns of body text
 * have the same connected-dark-pixel geometry as a line and were the source of
 * the previous false curves on title and methods pages.
 */
function isWholePageMonochromeFallback(candidate: DigitizationCandidate) {
  if (candidate.sourceFigure.kind !== "pdf-page") return false;
  const color = candidate.analysis.traceColor;
  if (!color) return true;
  return Math.max(color.r, color.g, color.b) - Math.min(color.r, color.g, color.b) < 20;
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function isSupportedImage(file: File, extension: string) {
  return file.type.startsWith("image/") || ["png", "jpg", "jpeg", "webp"].includes(extension);
}

function dataUrlBuffer(dataUrl: string) {
  return Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64");
}

function rankPdfPages(pages: Array<{ page: number; text: string }>) {
  const scored = pages.map(({ page, text }) => {
    const normalized = text.replace(/\s+/g, " ");
    let score = 0;
    if (/force[\s–—-]*(?:distance|separation)/i.test(normalized)) score += 28;
    if (/(?:transformed\s+)?force\s+curves?/i.test(normalized)) score += 16;
    if (/(?:relation|relationship)\s+between\s+(?:normal\s+)?force\s+and\s+(?:apparent\s+)?(?:distance|separation)/i.test(normalized)) score += 18;
    if (/(?:solvation|structural|oscillat\w*)[\s–—-]*force/i.test(normalized)) score += 24;
    if (/atomic force microscop|\bAFM\b/i.test(normalized)) score += 8;
    if (/separation\s*\/?\s*n?m|distance\s*\/?\s*n?m/i.test(normalized)) score += 12;
    if (/force\s*\/?\s*nN/i.test(normalized)) score += 12;
    if (/\bFig(?:ure)?\.?\s*\d+/i.test(normalized)) score += 8;
    if (/density profile|number density/i.test(normalized)) score -= 4;
    return { page, score };
  });

  scored.sort((a, b) => b.score - a.score || a.page - b.page);
  const hasExtractableText = pages.some((page) => page.text.trim().length > 40);
  if (!hasExtractableText) return scored.slice(0, MAX_PDF_PAGES_TO_RENDER);
  // A text-bearing PDF must provide an explicit AFM/force-curve signal. This
  // prevents ordinary method or reference pages from being raster-scanned for
  // coincidentally coloured words and citation links.
  return scored.filter((item) => item.score >= 24);
}
