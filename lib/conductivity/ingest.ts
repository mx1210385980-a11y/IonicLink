import type { FlexibleField, ProvenanceMap } from "../schema";
import { parseQuantity, type Quantity } from "../units";
import { resolveIonSmiles } from "../ionStructures";
import { promoteElectrodeFields } from "./electrodes";
import type {
  ConductivityDraft,
  ConductivityExtended,
  ConductivityExtractedFields,
  ConductivityPerformanceFigure,
  ConductivityPropertyDependency,
} from "./schema";

/**
 * Conductivity ingestion: raw extracted fields → a standardized three-layer
 * draft. Parses σ → S/m and viscosity → Pa·s, resolves ion SMILES via the
 * shared resolver, and sorts the optional fields into extended/flexible. Unlike
 * the tribology ingest there is NO AFM/load/voltage logic.
 */
export function ingest(f: ConductivityExtractedFields): ConductivityDraft {
  const cation = (f.cation ?? "").trim();
  const anion = (f.anion ?? "").trim();

  const flexibleInput: FlexibleField[] = (f.flexible ?? [])
    .filter((x) => x && x.key && x.value)
    .map((x) => ({
      key: x.key.trim(),
      value: String(x.value).trim(),
      unit: x.unit?.trim() || undefined,
      note: x.note?.trim() || undefined,
    }));
  const pressureIndex = flexibleInput.findIndex((item) => /^(?:pressure|press\.?|压力|压强)$/i.test(item.key));
  const pressureField = pressureIndex >= 0 ? flexibleInput[pressureIndex] : undefined;
  const pressureRaw = f.pressure?.trim() || (pressureField ? `${pressureField.value}${pressureField.unit ? ` ${pressureField.unit}` : ""}` : "");
  const pressure = parseQuantity(pressureRaw, "pressure");
  const flexibleWithoutPressure = pressure && pressureIndex >= 0
    ? flexibleInput.filter((_, index) => index !== pressureIndex)
    : flexibleInput;
  const electrodeFields = promoteElectrodeFields(f, flexibleWithoutPressure);
  const flexible = electrodeFields.flexible;

  const temperature = parseConductivityTemperature(f.temperature);
  const conductivity = parseQuantity(f.conductivity, "conductivity");
  const capacitance = parseQuantity(f.capacitance, "capacitance");
  const electricField = parseQuantity(f.electricField, "electricField");
  const electrodePotential = parseQuantity(f.electrodePotential, "potential");
  const electrochemicalWindow = parseQuantity(f.electrochemicalWindow, "potential");
  const chargeTransferResistance = parseQuantity(f.chargeTransferResistance, "resistance");
  const extended: ConductivityExtended = {
    method: f.method?.trim() || undefined,
    potentialReference: f.potentialReference?.trim() || undefined,
    cellConfiguration: electrodeFields.cellConfiguration,
    cellSetup: electrodeFields.cellSetup,
    workingElectrode: electrodeFields.workingElectrode,
    counterElectrode: electrodeFields.counterElectrode,
    referenceElectrode: electrodeFields.referenceElectrode,
    positiveElectrode: electrodeFields.positiveElectrode,
    negativeElectrode: electrodeFields.negativeElectrode,
    pressure: pressure ?? undefined,
    viscosity: parseQuantity(f.viscosity, "viscosity") ?? undefined,
    waterContent: f.waterContent?.trim() || undefined,
    concentration: f.concentration?.trim() || undefined,
    density: f.density?.trim() || undefined,
    cellConstant: f.cellConstant?.trim() || undefined,
    performanceFigure: cleanPerformanceFigure(f.performanceFigure),
    propertyDependencies: cleanDependencies(f.propertyDependencies),
  };

  // Per-field provenance: array → map, keeping only entries with content.
  const provenance: ProvenanceMap = {};
  for (const p of f.provenance ?? []) {
    if (!p?.field) continue;
    const entry = {
      page: typeof p.page === "number" ? p.page : undefined,
      figure: p.figure?.trim() || undefined,
      table: p.table?.trim() || undefined,
      section: p.section?.trim() || undefined,
      quote: p.quote?.trim() || undefined,
      context: p.context?.trim() || undefined,
      figureBox: p.figureBox,
      basis: p.basis === "direct" || p.basis === "inferred" || p.basis === "assumed" ? p.basis : undefined,
      basisNote: p.basisNote?.trim() || undefined,
    };
    if (
      entry.page != null ||
      entry.figure ||
      entry.table ||
      entry.section ||
      entry.quote ||
      entry.context ||
      entry.figureBox ||
      entry.basis ||
      entry.basisNote
    ) {
      provenance[p.field] = entry;
    }
  }

  const confidence = typeof f.confidence === "number" ? clamp01(f.confidence) : null;

  return {
    paper: f.paper,
    provenance: Object.keys(provenance).length ? provenance : undefined,
    core: {
      ionicLiquid: {
        cation,
        anion,
        cationSmiles: resolveIonSmiles(cation, "cation") || f.cationSmiles?.trim() || undefined,
        anionSmiles: resolveIonSmiles(anion, "anion") || f.anionSmiles?.trim() || undefined,
      },
      surface: (f.surface ?? "").trim(),
      temperature,
      conductivity,
      capacitance,
      electricField,
      electrodePotential,
      electrochemicalWindow,
      chargeTransferResistance,
    },
    extended,
    flexible,
    confidence,
  };
}

/**
 * Conductivity records must not turn a qualitative condition such as "room
 * temperature" into an unlabelled exact value.  Preserve the reported wording;
 * only temperatures with an explicit number can be standardized to kelvin.
 */
function parseConductivityTemperature(raw: string | null | undefined): Quantity | null {
  if (!raw?.trim()) return null;
  if (!/[-+]?\d/.test(raw)) {
    return {
      raw: raw.trim(),
      value: null,
      unit: "",
      std: null,
      stdUnit: "K",
      approx: true,
    };
  }
  return parseQuantity(raw, "temperature");
}

/** Reverse of ingest: flatten a record back to editable raw fields. */
export function toFields(r: ConductivityDraft): ConductivityExtractedFields {
  return {
    paper: r.paper,
    cation: r.core.ionicLiquid.cation,
    anion: r.core.ionicLiquid.anion,
    cationSmiles: r.core.ionicLiquid.cationSmiles,
    anionSmiles: r.core.ionicLiquid.anionSmiles,
    surface: r.core.surface,
    temperature: r.core.temperature?.raw,
    conductivity: r.core.conductivity?.raw,
    capacitance: r.core.capacitance?.raw,
    electricField: r.core.electricField?.raw,
    electrodePotential: r.core.electrodePotential?.raw,
    electrochemicalWindow: r.core.electrochemicalWindow?.raw,
    chargeTransferResistance: r.core.chargeTransferResistance?.raw,
    potentialReference: r.extended.potentialReference,
    cellConfiguration: r.extended.cellConfiguration,
    cellSetup: r.extended.cellSetup,
    workingElectrode: r.extended.workingElectrode,
    counterElectrode: r.extended.counterElectrode,
    referenceElectrode: r.extended.referenceElectrode,
    positiveElectrode: r.extended.positiveElectrode,
    negativeElectrode: r.extended.negativeElectrode,
    pressure: r.extended.pressure?.raw,
    method: r.extended.method,
    viscosity: r.extended.viscosity?.raw,
    waterContent: r.extended.waterContent,
    concentration: r.extended.concentration,
    density: r.extended.density,
    cellConstant: r.extended.cellConstant,
    performanceFigure: r.extended.performanceFigure,
    propertyDependencies: r.extended.propertyDependencies,
    flexible: r.flexible,
    provenance: r.provenance
      ? Object.entries(r.provenance).map(([field, p]) => ({ field, ...p }))
      : undefined,
    confidence: r.confidence,
  };
}

function cleanPerformanceFigure(
  figure: ConductivityPerformanceFigure | null | undefined,
): ConductivityPerformanceFigure | undefined {
  const figureLabel = figure?.figure?.trim();
  const curveType = figure?.curveType?.trim();
  if (!figure || !figureLabel || !curveType) return undefined;

  const box = figure.figureBox;
  const figureBox = box && [box.x, box.y, box.w, box.h].every(Number.isFinite)
    && box.x >= 0 && box.y >= 0 && box.w > 0 && box.h > 0
    && box.x + box.w <= 1.001 && box.y + box.h <= 1.001
    ? { x: box.x, y: box.y, w: box.w, h: box.h }
    : undefined;
  const cleanKeyPoint = (point: NonNullable<ConductivityPerformanceFigure["keyPoints"]>[number]) => ({
    label: point.label.trim(),
    value: point.value.trim(),
    field: point.field?.trim() || undefined,
    seriesLabel: point.seriesLabel?.trim() || undefined,
    panelLabel: point.panelLabel?.trim().toUpperCase() || undefined,
    condition: point.condition?.trim() || undefined,
    kind:
      point.kind === "coordinate"
      || point.kind === "slope"
      || point.kind === "peak"
      || point.kind === "onset"
      || point.kind === "intercept"
      || point.kind === "plateau"
      || point.kind === "range"
      || point.kind === "reported-value"
        ? point.kind
        : undefined,
    x: point.x?.trim() || undefined,
    y: point.y?.trim() || undefined,
    slope: point.slope?.trim() || undefined,
    source:
      point.source === "paper-text"
      || point.source === "figure-annotation"
      || point.source === "image-estimated"
        ? point.source
        : undefined,
    confidence: Number.isFinite(point.confidence) ? clamp01(point.confidence as number) : undefined,
    note: point.note?.trim() || undefined,
    interpretation: point.interpretation?.trim().slice(0, 600) || undefined,
    evidence: point.evidence?.trim().slice(0, 1600) || undefined,
    sourcePage: Number.isInteger(point.sourcePage) && point.sourcePage! > 0 ? point.sourcePage : undefined,
    scope: point.scope === "figure-comparison" ? "figure-comparison" as const : point.scope === "record" ? "record" as const : undefined,
  });
  const keyPoints = (figure.keyPoints ?? [])
    .filter((point) => point?.label?.trim() && point?.value?.trim())
    .slice(0, 24)
    .map(cleanKeyPoint);
  const dependencies = cleanDependencies(figure.dependencies) ?? [];
  const panels = (figure.panels ?? [])
    .filter((panel) => panel?.label?.trim())
    .slice(0, 20)
    .map((panel) => {
      const panelBox = panel.figureBox;
      const validPanelBox = panelBox && [panelBox.x, panelBox.y, panelBox.w, panelBox.h].every(Number.isFinite)
        && panelBox.x >= 0 && panelBox.y >= 0 && panelBox.w > 0 && panelBox.h > 0
        && panelBox.x + panelBox.w <= 1.001 && panelBox.y + panelBox.h <= 1.001
        ? { x: panelBox.x, y: panelBox.y, w: panelBox.w, h: panelBox.h }
        : undefined;
      const panelKeyPoints = (panel.keyPoints ?? [])
        .filter((point) => point?.label?.trim() && point?.value?.trim())
        .slice(0, 12)
        .map(cleanKeyPoint);
      return {
        label: panel.label.trim().toUpperCase(),
        title: panel.title?.trim() || undefined,
        figureBox: validPanelBox,
        seriesLabels: (panel.seriesLabels ?? []).map((value) => value.trim()).filter(Boolean).slice(0, 20),
        keyPoints: panelKeyPoints.length ? panelKeyPoints : undefined,
        curveType: panel.curveType?.trim() || undefined,
        xAxis: panel.xAxis?.trim() || undefined,
        yAxis: panel.yAxis?.trim() || undefined,
        source:
          panel.source === "paper-text"
          || panel.source === "figure-annotation"
          || panel.source === "image-estimated"
            ? panel.source
            : undefined,
        confidence: Number.isFinite(panel.confidence) ? clamp01(panel.confidence as number) : undefined,
      };
    });

  return {
    figure: figureLabel,
    curveType,
    page: Number.isInteger(figure.page) && (figure.page as number) > 0 ? figure.page : undefined,
    xAxis: figure.xAxis?.trim() || undefined,
    yAxis: figure.yAxis?.trim() || undefined,
    seriesLabel: figure.seriesLabel?.trim() || undefined,
    caption: figure.caption?.trim() || undefined,
    primaryField: figure.primaryField?.trim() || undefined,
    keyPoints: keyPoints.length ? keyPoints : undefined,
    dependencies: dependencies.length ? dependencies : undefined,
    panels: panels.length ? panels : undefined,
    dataStatus:
      figure.dataStatus === "reported-key-points"
      || figure.dataStatus === "estimated-key-points"
      || figure.dataStatus === "mixed-key-points"
      || figure.dataStatus === "digitized-series"
      || figure.dataStatus === "source-data-series"
        ? figure.dataStatus
        : keyPoints.length
          ? "reported-key-points"
          : undefined,
    figureBox,
  };
}

function cleanDependencies(
  dependencies: ConductivityPropertyDependency[] | null | undefined,
): ConductivityPropertyDependency[] | undefined {
  const cleaned = (dependencies ?? [])
    .filter((dependency) => dependency?.label?.trim() && dependency?.dependentField?.trim()
      && dependency?.independentVariable?.trim() && dependency?.statement?.trim())
    .slice(0, 12)
    .flatMap((dependency) => {
      const observations = (dependency.observations ?? [])
        .filter((observation) => observation?.x?.trim() && observation?.y?.trim())
        .slice(0, 24)
        .map((observation) => ({
          x: observation.x.trim(),
          y: observation.y.trim(),
          seriesLabel: observation.seriesLabel?.trim() || undefined,
          condition: observation.condition?.trim() || undefined,
        }));
      if (observations.length < 2) return [];
      const allowedTrends: ConductivityPropertyDependency["trend"][] = ["increases", "decreases", "non-monotonic", "approximately-constant", "comparison"];
      return [{
        label: dependency.label.trim(),
        dependentField: dependency.dependentField.trim(),
        independentVariable: dependency.independentVariable.trim(),
        xAxis: dependency.xAxis?.trim() || undefined,
        yAxis: dependency.yAxis?.trim() || undefined,
        trend: allowedTrends.includes(dependency.trend) ? dependency.trend : "comparison",
        statement: dependency.statement.trim().slice(0, 800),
        observations,
        scope: dependency.scope === "figure-comparison" ? "figure-comparison" as const : "record-series" as const,
        source:
          dependency.source === "paper-text"
          || dependency.source === "figure-annotation"
          || dependency.source === "image-estimated"
          || dependency.source === "record-comparison"
            ? dependency.source
            : undefined,
        confidence: Number.isFinite(dependency.confidence) ? clamp01(dependency.confidence as number) : undefined,
        evidence: dependency.evidence?.trim().slice(0, 1600) || undefined,
        sourcePage: Number.isInteger(dependency.sourcePage) && dependency.sourcePage! > 0 ? dependency.sourcePage : undefined,
      }];
    });
  return cleaned.length ? cleaned : undefined;
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}
