import Anthropic from "@anthropic-ai/sdk";
import type {
  ConductivityCurveKeyPoint,
  ConductivityDraft,
  ConductivityPerformanceFigure,
  ConductivityPerformancePanel,
  ConductivityPropertyDependency,
} from "./schema";
import type { BBox } from "../schema";
import { renderSourceFigure } from "../sources";
import { locatePerformanceFigurePanels } from "./figureLayout.server";
import { extractCaptionCurveInsights } from "./performanceFigureMetadata";
import { pointInterpretation } from "./curveInsights";

interface VisionPanel {
  label: string;
  title?: string;
  curveType?: string;
  xAxis?: string;
  yAxis?: string;
  box?: BBox;
  seriesLabels?: string[];
  keyPoints?: ConductivityCurveKeyPoint[];
  confidence?: number;
}

interface VisionResult {
  panels: VisionPanel[];
  dependencies?: ConductivityPropertyDependency[];
}

export interface ConductivityFigureAnalysisSummary {
  mode: "caption-layout" | "vision-assisted" | "unavailable";
  figuresLocated: number;
  figuresVisionAnalysed: number;
  panelsCreated: number;
  estimatedLandmarks: number;
  warnings: string[];
}

const VISION_TOOL = {
  type: "object",
  properties: {
    panels: {
      type: "array",
      items: {
        type: "object",
        properties: {
          label: { type: "string", description: "A, B, C...; MAIN for a single-panel graph." },
          title: { type: "string" },
          curveType: { type: "string" },
          xAxis: { type: "string" },
          yAxis: { type: "string" },
          box: {
            type: "object",
            description: "Panel crop relative to the supplied image, each coordinate from 0 to 1.",
            properties: {
              x: { type: "number" }, y: { type: "number" }, w: { type: "number" }, h: { type: "number" },
            },
            required: ["x", "y", "w", "h"],
          },
          seriesLabels: { type: "array", items: { type: "string" } },
          keyPoints: {
            type: "array",
            items: {
              type: "object",
              properties: {
                label: { type: "string" },
                value: { type: "string" },
                field: { type: "string" },
                seriesLabel: { type: "string" },
                condition: { type: "string" },
                kind: { type: "string", enum: ["coordinate", "slope", "peak", "onset", "intercept", "plateau", "range", "reported-value"] },
                x: { type: "string" },
                y: { type: "string" },
                slope: { type: "string" },
                source: { type: "string", enum: ["figure-annotation", "image-estimated"] },
                confidence: { type: "number" },
                note: { type: "string" },
                interpretation: { type: "string" },
                evidence: { type: "string" },
                scope: { type: "string", enum: ["record", "figure-comparison"] },
              },
              required: ["label", "value", "source", "confidence"],
            },
          },
          confidence: { type: "number" },
        },
        required: ["label", "box"],
      },
    },
    dependencies: {
      type: "array",
      description: "Sparse graph-level Y=f(X) relationships across readable conditions or series; omit when fewer than two comparable observations are readable.",
      items: {
        type: "object",
        properties: {
          label: { type: "string" },
          dependentField: { type: "string" },
          independentVariable: { type: "string" },
          xAxis: { type: "string" },
          yAxis: { type: "string" },
          trend: { type: "string", enum: ["increases", "decreases", "non-monotonic", "approximately-constant", "comparison"] },
          statement: { type: "string" },
          observations: {
            type: "array",
            items: {
              type: "object",
              properties: {
                x: { type: "string" }, y: { type: "string" }, seriesLabel: { type: "string" }, condition: { type: "string" },
              },
              required: ["x", "y"],
            },
          },
          scope: { type: "string", enum: ["record-series", "figure-comparison"] },
          source: { type: "string", enum: ["figure-annotation", "image-estimated"] },
          confidence: { type: "number" },
          evidence: { type: "string" },
        },
        required: ["label", "dependentField", "independentVariable", "trend", "statement", "observations", "source", "confidence"],
      },
    },
  },
  required: ["panels"],
} as const;

function openAIConfig(): { apiKey: string; baseURL: string } | null {
  const apiKey = process.env.OPENAI_API_KEY || process.env.openai_api_key;
  const baseURL = process.env.OPENAI_BASE_URL || process.env.openai_base_url;
  return apiKey && baseURL ? { apiKey, baseURL: baseURL.replace(/\/+$/, "") } : null;
}

function hasVisionProvider(): boolean {
  return process.env.CONDUCTIVITY_FIGURE_VISION !== "off"
    && Boolean(openAIConfig() || process.env.ANTHROPIC_API_KEY);
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function validRelativeBox(box: BBox | null | undefined): BBox | undefined {
  if (!box || ![box.x, box.y, box.w, box.h].every(Number.isFinite)) return undefined;
  const x = clamp01(box.x);
  const y = clamp01(box.y);
  const w = Math.min(1 - x, Math.max(0, box.w));
  const h = Math.min(1 - y, Math.max(0, box.h));
  return w >= 0.05 && h >= 0.05 ? { x, y, w, h } : undefined;
}

export function composeFigureBox(parent: BBox, relative: BBox): BBox {
  return {
    x: parent.x + parent.w * relative.x,
    y: parent.y + parent.h * relative.y,
    w: parent.w * relative.w,
    h: parent.h * relative.h,
  };
}

function normalizeKeyPoint(point: ConductivityCurveKeyPoint): ConductivityCurveKeyPoint | null {
  if (!point?.label?.trim() || !point?.value?.trim()) return null;
  const source = point.source === "figure-annotation" ? "figure-annotation" : "image-estimated";
  return {
    label: point.label.trim(),
    value: point.value.trim(),
    field: point.field?.trim() || undefined,
    seriesLabel: point.seriesLabel?.trim() || undefined,
    condition: point.condition?.trim() || undefined,
    kind: point.kind,
    x: point.x?.trim() || undefined,
    y: point.y?.trim() || undefined,
    slope: point.slope?.trim() || undefined,
    source,
    confidence: clamp01(Number.isFinite(point.confidence) ? point.confidence as number : source === "figure-annotation" ? 0.96 : 0.65),
    note: point.note?.trim() || undefined,
    interpretation: point.interpretation?.trim() || undefined,
    evidence: point.evidence?.trim() || undefined,
    scope: point.scope === "figure-comparison" ? "figure-comparison" : "record",
  };
}

function normalizeVisionResult(raw: unknown): VisionResult {
  const value = raw as { panels?: VisionPanel[]; dependencies?: ConductivityPropertyDependency[] } | null;
  const panels = (value?.panels ?? []).slice(0, 12).flatMap((panel) => {
    const label = panel?.label?.trim().toUpperCase();
    const box = validRelativeBox(panel?.box);
    if (!label || !box) return [];
    const keyPoints = (panel.keyPoints ?? []).slice(0, 8)
      .map(normalizeKeyPoint)
      .filter((point): point is ConductivityCurveKeyPoint => Boolean(point));
    return [{
      label,
      title: panel.title?.trim() || undefined,
      curveType: panel.curveType?.trim() || undefined,
      xAxis: panel.xAxis?.trim() || undefined,
      yAxis: panel.yAxis?.trim() || undefined,
      box,
      seriesLabels: (panel.seriesLabels ?? []).map((item) => item.trim()).filter(Boolean).slice(0, 20),
      keyPoints,
      confidence: clamp01(Number.isFinite(panel.confidence) ? panel.confidence as number : 0.7),
    }];
  });
  const dependencies = (value?.dependencies ?? []).slice(0, 10).flatMap((dependency) => {
    const observations = (dependency.observations ?? []).filter((observation) => observation?.x?.trim() && observation?.y?.trim()).slice(0, 24);
    if (!dependency?.label?.trim() || !dependency.dependentField?.trim() || !dependency.independentVariable?.trim()
      || !dependency.statement?.trim() || observations.length < 2) return [];
    return [{
      ...dependency,
      label: dependency.label.trim(),
      dependentField: dependency.dependentField.trim(),
      independentVariable: dependency.independentVariable.trim(),
      statement: dependency.statement.trim(),
      observations: observations.map((observation) => ({
        x: observation.x.trim(), y: observation.y.trim(), seriesLabel: observation.seriesLabel?.trim() || undefined,
        condition: observation.condition?.trim() || undefined,
      })),
      scope: dependency.scope === "figure-comparison" ? "figure-comparison" as const : "record-series" as const,
      source: dependency.source === "figure-annotation" ? "figure-annotation" as const : "image-estimated" as const,
      confidence: clamp01(Number.isFinite(dependency.confidence) ? dependency.confidence as number : 0.65),
      evidence: dependency.evidence?.trim() || undefined,
    }];
  });
  return { panels, dependencies };
}

async function analyseWithVision(
  png: Uint8Array,
  figure: ConductivityPerformanceFigure,
  recordHints: string[],
): Promise<VisionResult> {
  const prompt = `Analyse this scientific electrochemistry figure for IonicLink.

Goal: extract a SMALL set of model-ready graph landmarks and property dependencies, not the complete curve. Identify relevant curve panels, split multi-panel layouts, and return at most 8 useful landmarks per panel: explicitly labelled coordinates, peaks, onsets, plateaus, ranges, fitted slopes/intercepts/equations, or visually estimated coordinates where necessary. When at least two comparable points/series are readable, return the observed Y=f(X) relation in dependencies.

Scientific context:
- figure: ${figure.figure}
- curve family: ${figure.curveType}
- primary property: ${figure.primaryField ?? "unknown"}
- expected x axis: ${figure.xAxis ?? "read from graph"}
- expected y axis: ${figure.yAxis ?? "read from graph"}
- record/series hints: ${recordHints.join(" | ") || "none"}
- caption: ${figure.caption ?? "not recovered"}

Rules:
1. Use source="figure-annotation" only when the number/equation is printed in the graph. Use source="image-estimated" when reading a coordinate from axes or estimating a landmark from the plotted line.
2. Preserve physical units. Never return 0–1 normalized coordinates as scientific x/y values.
3. Every image estimate needs an honest confidence. Skip unreadable axes rather than fabricate units.
4. In multi-series plots, assign the exact legend text in seriesLabel. Do not mix series.
5. Return panel boxes relative to this supplied image (x,y,w,h in 0–1). Exclude microscopy, photographs, and unrelated schematics. An equivalent circuit is context, not a curve panel.
6. A single graph uses label MAIN. Preserve printed multi-panel labels. Crop the actual plot WITH axes, units and legend; exclude surrounding prose and the original caption.
7. Write interpretation as one concise Chinese scientific annotation for each reading, grounded in the supplied paper context. Do not paste the caption. Preserve evidence separately. CV/LSV: distinguish scan limits from electrochemical stability thresholds, give the onset criterion and reference electrode if available. EIS: distinguish fitted Rct, high-frequency intercept Rs, and diffusion-related slopes; a Nyquist maximum is not Rct. Conductivity: retain temperature/composition, and the exact transformed axes for fitted slopes (ln vs log10, 1/T vs 1000/T); do not invent activation energies. Never estimate a slope without readable axes and units.
8. Return only panels relevant to the specified property and sample. A peak or intercept is optional unless it is scientifically useful and readable; missing data must remain missing.
9. A dependency needs at least two observations with physical units and matched series/conditions. X may be temperature, scan rate, potential, concentration, water content, cycle, frequency, ionic-liquid identity or electrode. Describe association only, never causation. Do not turn a multi-factor comparison into a clean one-variable dependence. For CV, distinguish peak-current scaling, peak-potential shift and onset/window. For EIS, keep frequency/potential and fitted-circuit context.`;
  const model = process.env.FIGURE_ANALYSIS_MODEL || process.env.EXTRACT_MODEL || "claude-sonnet-4-6";
  const base64 = Buffer.from(png).toString("base64");
  const config = openAIConfig();
  if (config) {
    const response = await fetch(`${config.baseURL}/chat/completions`, {
      method: "POST",
      signal: AbortSignal.timeout(90000),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 5000,
        messages: [{
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: `data:image/png;base64,${base64}` } },
          ],
        }],
        tools: [{ type: "function", function: { name: "submit_curve_landmarks", description: "Submit sparse graph landmarks and panel crops.", parameters: VISION_TOOL } }],
        tool_choice: { type: "function", function: { name: "submit_curve_landmarks" } },
      }),
    });
    if (!response.ok) throw new Error(`Figure vision request failed (${response.status}).`);
    const data = await response.json() as { choices?: Array<{ message?: { tool_calls?: Array<{ function?: { arguments?: string } }> } }> };
    const args = data.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    return normalizeVisionResult(args ? JSON.parse(args) : null);
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  const response = await client.messages.create({
    model,
    max_tokens: 5000,
    tools: [{
      name: "submit_curve_landmarks",
      description: "Submit sparse graph landmarks and panel crops.",
      input_schema: VISION_TOOL as unknown as Anthropic.Tool.InputSchema,
    }],
    tool_choice: { type: "tool", name: "submit_curve_landmarks" },
    messages: [{
      role: "user",
      content: [
        { type: "image", source: { type: "base64", media_type: "image/png", data: base64 } },
        { type: "text", text: prompt },
      ],
    }],
  });
  const tool = response.content.find((item): item is Anthropic.ToolUseBlock => item.type === "tool_use");
  return normalizeVisionResult(tool?.input);
}

function keyPointKey(point: ConductivityCurveKeyPoint): string {
  return [point.label, point.value, point.seriesLabel, point.x, point.y, point.slope].map((item) => item?.trim().toLowerCase() ?? "").join("|");
}

function mergeKeyPoints(
  original: ConductivityCurveKeyPoint[] | undefined,
  added: ConductivityCurveKeyPoint[] | undefined,
): ConductivityCurveKeyPoint[] | undefined {
  const unique = new Map<string, ConductivityCurveKeyPoint>();
  for (const point of [...(original ?? []), ...(added ?? [])]) unique.set(keyPointKey(point), point);
  const result = [...unique.values()].slice(0, 24);
  return result.length ? result : undefined;
}

function mergeDependencies(
  original: ConductivityPropertyDependency[] | undefined,
  added: ConductivityPropertyDependency[] | undefined,
): ConductivityPropertyDependency[] | undefined {
  const unique = new Map<string, ConductivityPropertyDependency>();
  for (const dependency of [...(original ?? []), ...(added ?? [])]) {
    const key = [dependency.dependentField, dependency.independentVariable, dependency.scope, dependency.label].join("|").toLowerCase();
    unique.set(key, dependency);
  }
  const result = [...unique.values()].slice(0, 12);
  return result.length ? result : undefined;
}

function dataStatusFor(figure: ConductivityPerformanceFigure): ConductivityPerformanceFigure["dataStatus"] {
  const points = [
    ...(figure.keyPoints ?? []),
    ...(figure.panels ?? []).flatMap((panel) => panel.keyPoints ?? []),
  ];
  const estimated = points.some((point) => point.source === "image-estimated");
  const reported = points.some((point) => point.source !== "image-estimated");
  if (estimated && reported) return "mixed-key-points";
  if (estimated) return "estimated-key-points";
  return figure.dataStatus ?? (reported ? "reported-key-points" : undefined);
}

function panelsFromVision(base: BBox, result: VisionResult): ConductivityPerformancePanel[] {
  if (result.panels.length <= 1 && result.panels[0]?.label === "MAIN") return [];
  return result.panels.map((panel) => ({
    label: panel.label,
    title: panel.title,
    curveType: panel.curveType,
    xAxis: panel.xAxis,
    yAxis: panel.yAxis,
    figureBox: composeFigureBox(base, panel.box!),
    seriesLabels: panel.seriesLabels,
    keyPoints: panel.keyPoints,
    source: panel.keyPoints?.some((point) => point.source === "image-estimated") ? "image-estimated" : "figure-annotation",
    confidence: panel.confidence,
  }));
}

/**
 * Post-process newly uploaded conductivity records. Figure layout is always
 * resolved locally from the caption when possible; a configured multimodal
 * model adds only sparse, traceable landmarks and never a fabricated series.
 */
export async function enrichConductivityDraftsWithFigureAnalysis(
  records: ConductivityDraft[],
  sourceId: string,
): Promise<{ records: ConductivityDraft[]; summary: ConductivityFigureAnalysisSummary }> {
  const summary: ConductivityFigureAnalysisSummary = {
    mode: hasVisionProvider() ? "vision-assisted" : "caption-layout",
    figuresLocated: 0,
    figuresVisionAnalysed: 0,
    panelsCreated: 0,
    estimatedLandmarks: 0,
    warnings: [],
  };
  const candidates = records.filter((record) => record.extended.performanceFigure?.page);
  const groups = new Map<string, ConductivityDraft[]>();
  for (const record of candidates) {
    const figure = record.extended.performanceFigure!;
    const main = figure.figure.toLowerCase().replace(/([0-9])\s*[a-t]\b/i, "$1");
    const key = `${figure.page}:${main}`;
    groups.set(key, [...(groups.get(key) ?? []), record]);
  }

  for (const group of [...groups.values()].slice(0, 8)) {
    const representative = group[0];
    const seed = representative.extended.performanceFigure!;
    const rendered = await renderSourceFigure("conductivity", sourceId, seed.page!, seed.figure, seed.figureBox);
    if (!rendered) {
      summary.warnings.push(`${seed.figure}: source crop could not be located.`);
      continue;
    }
    summary.figuresLocated += 1;
    let vision: VisionResult | null = null;
    if (hasVisionProvider()) {
      try {
        vision = await analyseWithVision(
          rendered.png,
          { ...seed, figureBox: rendered.box },
          group.map((record) => record.extended.performanceFigure?.seriesLabel ?? `${record.core.ionicLiquid.cation}${record.core.ionicLiquid.anion}`),
        );
        summary.figuresVisionAnalysed += 1;
      } catch (error) {
        summary.warnings.push(`${seed.figure}: ${error instanceof Error ? error.message : "vision analysis failed"}`);
      }
    }

    for (const record of group) {
      const current = record.extended.performanceFigure!;
      const baseFigure: ConductivityPerformanceFigure = { ...current, figureBox: rendered.box,
        keyPoints: mergeKeyPoints(current.keyPoints?.map(p=>({...p,interpretation:pointInterpretation(p)})),extractCaptionCurveInsights(current.caption??"",current.curveType,current.page)),
      };
      const deterministicPanels = await locatePerformanceFigurePanels(sourceId, baseFigure);
      const visualPanels = vision ? panelsFromVision(rendered.box, vision) : [];
      const explicit = current.figure.match(/\d+\s*([a-t])\b/i)?.[1]?.toUpperCase();
      const relevantVisualPanels = explicit ? visualPanels.filter(panel=>panel.label===explicit) : visualPanels;
      const expectedSeries = current.seriesLabel?.trim().toLowerCase();
      const ambiguousSeries = group.filter(candidate=>candidate.extended.performanceFigure?.seriesLabel?.trim().toLowerCase()===expectedSeries).length > 1;
      // Identical legend labels at different potentials/temperatures are not unique matches.
      const ownsPoint = (point: ConductivityCurveKeyPoint) => point.scope === "figure-comparison" || group.length === 1 || !!(!ambiguousSeries && expectedSeries && point.seriesLabel?.trim().toLowerCase() === expectedSeries);
      const ownsDependency = (dependency: ConductivityPropertyDependency) => dependency.scope === "figure-comparison" || group.length === 1
        || !!(!ambiguousSeries && expectedSeries && dependency.observations.some((observation) => observation.seriesLabel?.trim().toLowerCase() === expectedSeries));
      const panels = relevantVisualPanels.length ? relevantVisualPanels.map(panel=>({...panel,keyPoints:panel.keyPoints?.filter(ownsPoint)})) : deterministicPanels;
      const mainPoints = vision?.panels.length === 1 && vision.panels[0].label === "MAIN"
        ? vision.panels[0].keyPoints?.filter(ownsPoint)
        : undefined;
      const next: ConductivityPerformanceFigure = {
        ...baseFigure,
        keyPoints: mergeKeyPoints(baseFigure.keyPoints, mainPoints),
        dependencies: mergeDependencies(baseFigure.dependencies, vision?.dependencies?.filter(ownsDependency).map((dependency) => ({ ...dependency, sourcePage: seed.page }))),
        panels: panels.length ? panels : undefined,
      };
      next.dataStatus = dataStatusFor(next);
      record.extended.performanceFigure = next;
      summary.panelsCreated += panels.length;
      summary.estimatedLandmarks += [
        ...(next.keyPoints ?? []),
        ...(next.panels ?? []).flatMap((panel) => panel.keyPoints ?? []),
      ].filter((point) => point.source === "image-estimated").length;
    }
  }
  if (!groups.size) summary.mode = "unavailable";
  return { records, summary };
}
