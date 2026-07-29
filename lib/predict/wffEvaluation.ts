import { DEFAULT_HYBRID_CONFIG, WFF_FEATURE_COLUMNS, WFF_MODEL_LABELS, trainWffModel, type WffHybridConfig, type WffModelType } from "./wffModel";

export type { WffModelType, WffHybridConfig } from "./wffModel";
export type WffDatasetId = "dataset-a" | "dataset-b";
export type WffSplitName = "train" | "test" | "externalLiterature" | "externalExperiment";
/**
 * Stratification axis for the train/test split. The plan's joint label is
 * (cation_type, bin(COF)); the single-axis modes are offered so students can
 * see how a coarser label changes which strata become singletons (and so the
 * external-literature holdout).
 */
export type WffStratifyMode = "joint" | "friction" | "cation";

export interface WffParsedRow {
  id: string;
  datasetId: WffDatasetId;
  cation: string;
  anion: string;
  compound: string;
  surface: string;
  sourceLiteratureKey: string;
  sourceLiteratureTitle: string;
  sourceLiteratureDoi: string;
  wffRowNumber: string;
  wffDataset: string;
  filmThickness: number | null;
  temperature: number | null;
  measured: number;
  predicted: number;
  absoluteError: number;
  squaredError: number;
  frictionBin: string;
  cationBin: string;
  jointLabel: string;
  originalIndex: string;
  errorFlag: string;
  flaggedHighError: boolean;
  physicallyInvalidPrediction: boolean;
  /** Snapshot prediction from the CSV's friction_pred column (kept for the "snapshot" reference mode). */
  snapshotPredicted: number | null;
  /** Descriptor feature vector (aligned to WFF_FEATURE_COLUMNS) used to train the in-lab model. */
  features: (number | null)[];
}

export interface WffMetrics {
  n: number;
  r2: number | null;
  mae: number | null;
  mse: number | null;
  rmse: number | null;
  r2Note?: string;
}

export interface WffPoint extends WffParsedRow {
  split: WffSplitName;
  source: "wff-dataset" | "external-literature" | "external-experiment";
  /** 1-based index used by the point-wise external-validation chart. */
  sampleIndex: number;
}

export interface WffFitLine {
  slope: number;
  intercept: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface WffSplitResult {
  name: WffSplitName;
  label: string;
  points: WffPoint[];
  metrics: WffMetrics;
  note?: string;
}

export interface WffSplitSettings {
  testSize?: number;
  randomSeed?: number;
  stratifyMode?: WffStratifyMode;
  excludeFlagged?: boolean;
  modelType?: WffModelType;
  hybridConfig?: WffHybridConfig;
}

export interface WffEvaluationResult {
  datasetId: WffDatasetId;
  label: string;
  sourceRowCount: number;
  evaluatedRowCount: number;
  droppedFlaggedCount: number;
  invalidCount: number;
  singletonStrataCount: number;
  /**
   * The raw evaluated input rows. `predicted` here is always the snapshot
   * (friction_pred) value — the trained-model predictions live ONLY on
   * `splits.*.points`. Read those, not this, for model output.
   */
  rows: WffParsedRow[];
  settings: {
    splitStrategy: "joint_label_stratified";
    stratifyMode: WffStratifyMode;
    testSize: number;
    randomSeed: number;
    excludeFlagged: boolean;
    singletonPolicy: "routed_to_external_literature";
    modelType: WffModelType;
    modelLabel: string;
    trained: boolean;
  };
  splits: Record<WffSplitName, WffSplitResult>;
  fitLines: Partial<Record<WffSplitName, WffFitLine>>;
  chartBounds: { xMin: number; xMax: number; yMin: number; yMax: number };
}

export interface BuildWffEvaluationFromRowsOptions extends WffSplitSettings {
  datasetId: WffDatasetId;
  label: string;
  sourceRowCount?: number;
}

export interface BuildWffEvaluationOptions extends WffSplitSettings {
  datasetId: WffDatasetId;
  label: string;
  csvText: string;
  wffDataset?: "film" | "no_film";
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        quoted = !quoted;
      }
    } else if (ch === "," && !quoted) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function num(v: string | undefined): number | null {
  if (v == null || v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function parseWffCsv(csvText: string, datasetId: WffDatasetId = "dataset-b"): WffParsedRow[] {
  const lines = csvText.replace(/^﻿/, "").split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) return [];
  const headers = parseCsvLine(lines[0]).map((h) => h.replace(/^﻿/, ""));
  const cationIndex = headers.indexOf("Cation");
  return lines.slice(1).flatMap((line, rowIndex) => {
    const parsed = parseCsvLine(line);
    const extra = parsed.length - headers.length;
    // WFF cation labels like "[N8,8,8,12]+" are unquoted and carry commas, so a
    // raw row has more fields than the header — merge the overflow back into
    // the actual Cation column, which is not always the first column in the
    // combined source-annotated CSV.
    const values =
      extra > 0 && cationIndex >= 0
        ? [
            ...parsed.slice(0, cationIndex),
            parsed.slice(cationIndex, cationIndex + extra + 1).join(","),
            ...parsed.slice(cationIndex + extra + 1),
          ]
        : parsed;
    const raw = Object.fromEntries(headers.map((h, i) => [h, values[i] ?? ""]));
    const measured = num(raw["μ"]);
    const predicted = num(raw.friction_pred);
    if (measured == null) return [];
    const frictionBin = (raw.friction_bin ?? "").trim();
    const cationBin = (raw.cation_bin ?? "").trim();
    const jointLabel = (raw.stratify_label || `${frictionBin}_${cationBin}`).trim();
    const errorFlag = (raw.error_flag ?? "").trim();
    return [
      {
        // Line position, not original_index — the latter is not unique across
        // the combined CSV and would collide as a React key / sort tiebreak.
        id: `${datasetId}-r${rowIndex + 1}`,
        datasetId,
        cation: raw.Cation ?? "",
        anion: raw.anion ?? "",
        compound: raw.compound ?? "",
        surface: raw.surface ?? "",
        sourceLiteratureKey: raw.source_literature_key ?? "",
        sourceLiteratureTitle: raw.source_literature_title ?? "",
        sourceLiteratureDoi: raw.source_literature_doi ?? "",
        wffRowNumber: raw.wff_row_number ?? "",
        wffDataset: raw.wff_dataset ?? "",
        filmThickness: num(raw.h),
        temperature: num(raw.T),
        measured,
        predicted: predicted ?? measured,
        absoluteError: predicted == null ? 0 : Math.abs(predicted - measured),
        squaredError: predicted == null ? 0 : (predicted - measured) ** 2,
        frictionBin,
        cationBin,
        jointLabel,
        originalIndex: raw.original_index || String(rowIndex + 1),
        errorFlag,
        flaggedHighError: errorFlag !== "",
        physicallyInvalidPrediction: predicted != null && predicted < 0,
        snapshotPredicted: predicted,
        features: WFF_FEATURE_COLUMNS.map((col) => num(raw[col])),
      },
    ];
  });
}

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function shuffled<T>(items: T[], seed: number): T[] {
  const rand = rng(seed);
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function stratumKey(row: WffParsedRow, mode: WffStratifyMode): string {
  if (mode === "friction") return row.frictionBin || "∅";
  if (mode === "cation") return row.cationBin || "∅";
  return row.jointLabel || `${row.frictionBin}_${row.cationBin}`;
}

/**
 * Joint-label stratified split (WFF §2.2.1). Singleton strata — a label seen
 * exactly once — never enter train/test; they are routed to the external
 * literature validation set, since there is no second sample to stratify
 * against. The remaining strata are split test:train at `testSize`.
 */
export function splitWffRows(rows: WffParsedRow[], opts: WffSplitSettings = {}) {
  const testSize = opts.testSize ?? 0.2;
  const randomSeed = opts.randomSeed ?? 42;
  const mode = opts.stratifyMode ?? "joint";

  const byLabel = new Map<string, WffParsedRow[]>();
  for (const row of rows) {
    const key = stratumKey(row, mode);
    const list = byLabel.get(key) ?? [];
    list.push(row);
    byLabel.set(key, list);
  }

  const train: WffParsedRow[] = [];
  const test: WffParsedRow[] = [];
  const externalLiterature: WffParsedRow[] = [];

  // Raw code-unit order (NOT localeCompare): this ordering drives labelIndex
  // and therefore the per-stratum split seed, so it must be identical on the
  // server and the client regardless of host locale, or the SSR'd trained model
  // would desync from the hydrating one.
  let labelIndex = 0;
  for (const [, list] of [...byLabel.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (list.length === 1) {
      externalLiterature.push(list[0]);
      continue;
    }
    const ordered = shuffled(list, randomSeed + labelIndex * 997);
    const testN = Math.max(1, Math.round(ordered.length * testSize));
    test.push(...ordered.slice(0, testN));
    train.push(...ordered.slice(testN));
    labelIndex++;
  }

  return { train, test, externalLiterature, externalExperiment: [] as WffParsedRow[] };
}

const DATASET_B_PAPER_EXTERNAL_ROW_NUMBERS = new Set(["207", "208", "209", "210", "211", "212"]);

function shouldUseDatasetBPaperSplit(rows: WffParsedRow[], opts: BuildWffEvaluationFromRowsOptions): boolean {
  if (opts.datasetId !== "dataset-b") return false;
  if (rows.length < 100) return false;
  let hits = 0;
  for (const row of rows) {
    if (DATASET_B_PAPER_EXTERNAL_ROW_NUMBERS.has(row.wffRowNumber)) hits += 1;
  }
  return hits === DATASET_B_PAPER_EXTERNAL_ROW_NUMBERS.size;
}

function splitDatasetBPaperRows(rows: WffParsedRow[], opts: WffSplitSettings = {}) {
  const testSize = opts.testSize ?? 0.2;
  const randomSeed = opts.randomSeed ?? 42;

  const externalLiterature = rows.filter((row) => DATASET_B_PAPER_EXTERNAL_ROW_NUMBERS.has(row.wffRowNumber));
  const remaining = rows.filter((row) => !DATASET_B_PAPER_EXTERNAL_ROW_NUMBERS.has(row.wffRowNumber));

  const byLabel = new Map<string, WffParsedRow[]>();
  for (const row of remaining) {
    const key = row.jointLabel || `${row.frictionBin}_${row.cationBin}`;
    const list = byLabel.get(key) ?? [];
    list.push(row);
    byLabel.set(key, list);
  }

  const train: WffParsedRow[] = [];
  const test: WffParsedRow[] = [];
  const singletonTrain: WffParsedRow[] = [];
  let labelIndex = 0;
  for (const [, list] of [...byLabel.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (list.length === 1) {
      singletonTrain.push(list[0]);
      continue;
    }
    const ordered = shuffled(list, randomSeed + labelIndex * 997);
    const testN = Math.min(ordered.length - 1, Math.max(1, Math.round(ordered.length * testSize)));
    test.push(...ordered.slice(0, testN));
    train.push(...ordered.slice(testN));
    labelIndex++;
  }
  train.push(...shuffled(singletonTrain, randomSeed + 100_003));

  return { train, test, externalLiterature, externalExperiment: [] as WffParsedRow[] };
}

export function computeWffMetrics(rows: Pick<WffParsedRow, "measured" | "predicted">[]): WffMetrics {
  const n = rows.length;
  if (n === 0) return { n, r2: null, mae: null, mse: null, rmse: null };
  const residuals = rows.map((r) => r.predicted - r.measured);
  const squared = residuals.map((r) => r * r);
  const mae = residuals.reduce((a, r) => a + Math.abs(r), 0) / n;
  const mse = squared.reduce((a, b) => a + b, 0) / n;
  const rmse = Math.sqrt(mse);
  const mean = rows.reduce((a, r) => a + r.measured, 0) / n;
  const ssTot = rows.reduce((a, r) => a + (r.measured - mean) ** 2, 0);
  const ssRes = squared.reduce((a, b) => a + b, 0);
  return { n, r2: ssTot > 0 ? 1 - ssRes / ssTot : null, mae, mse, rmse };
}

export function fitWffLine(rows: Pick<WffParsedRow, "measured" | "predicted">[]): WffFitLine | null {
  if (rows.length < 2) return null;
  const n = rows.length;
  const meanX = rows.reduce((a, r) => a + r.measured, 0) / n;
  const meanY = rows.reduce((a, r) => a + r.predicted, 0) / n;
  const sxx = rows.reduce((a, r) => a + (r.measured - meanX) ** 2, 0);
  if (sxx === 0) return null;
  const sxy = rows.reduce((a, r) => a + (r.measured - meanX) * (r.predicted - meanY), 0);
  const slope = sxy / sxx;
  const intercept = meanY - slope * meanX;
  const x1 = Math.min(...rows.map((r) => r.measured));
  const x2 = Math.max(...rows.map((r) => r.measured));
  return { slope, intercept, x1, y1: slope * x1 + intercept, x2, y2: slope * x2 + intercept };
}

const SOURCE_BY_SPLIT: Record<WffSplitName, WffPoint["source"]> = {
  train: "wff-dataset",
  test: "wff-dataset",
  externalLiterature: "external-literature",
  externalExperiment: "external-experiment",
};

function toPoint(row: WffParsedRow, split: WffSplitName, sampleIndex: number, predicted: number): WffPoint {
  return {
    ...row,
    predicted,
    absoluteError: Math.abs(predicted - row.measured),
    squaredError: (predicted - row.measured) ** 2,
    physicallyInvalidPrediction: predicted < 0,
    split,
    source: SOURCE_BY_SPLIT[split],
    sampleIndex,
  };
}

// Derive a deterministic model seed distinct from the split seed so the two
// random processes don't share a stream (but stay reproducible per settings).
function modelSeed(randomSeed: number): number {
  return (Math.imul(randomSeed + 1, 2654435761) ^ 0x9e3779b9) >>> 0;
}

/** R² is unreliable when the validation set is tiny or its measured range is narrow. */
function r2Note(split: WffSplitName, points: WffPoint[]): string | undefined {
  if (!points.length) return undefined;
  if (split === "externalExperiment") {
    return "R² may be unstable for small, narrow-range validation sets — read MAE(M1)/RMSE.";
  }
  if (split === "externalLiterature" && points.length < 10) {
    return "Small validation set (n<10) — R² is noisy here; weight MAE(M1)/RMSE.";
  }
  return undefined;
}

function bounds(points: WffPoint[]): WffEvaluationResult["chartBounds"] {
  const vals = points.flatMap((p) => [p.measured, p.predicted]);
  if (!vals.length) return { xMin: 0, xMax: 1, yMin: 0, yMax: 1 };
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const pad = (max - min) * 0.08 || 0.1;
  // Floor at 0 only when all values are non-negative; when a kept "physically
  // invalid" negative prediction is present, let the domain go negative so the
  // red point plots at its true position instead of collapsing into the margin.
  const lo = min < 0 ? min - pad : Math.max(0, min - pad);
  return { xMin: lo, xMax: max + pad, yMin: lo, yMax: max + pad };
}

export function buildWffEvaluationFromRows(
  rows: WffParsedRow[],
  opts: BuildWffEvaluationFromRowsOptions
): WffEvaluationResult {
  const testSize = opts.testSize ?? 0.2;
  const randomSeed = opts.randomSeed ?? 42;
  const stratifyMode = opts.stratifyMode ?? "joint";
  const excludeFlagged = opts.excludeFlagged ?? false;
  const modelType = opts.modelType ?? "snapshot";
  const trained = modelType !== "snapshot";

  const evaluatedBase = excludeFlagged ? rows.filter((r) => !r.flaggedHighError) : rows;
  const evaluated = modelType === "snapshot" ? evaluatedBase.filter((r) => r.snapshotPredicted != null) : evaluatedBase;
  const droppedFlaggedCount = rows.length - (excludeFlagged ? evaluatedBase.length : rows.length);
  const split = shouldUseDatasetBPaperSplit(evaluated, opts)
    ? splitDatasetBPaperRows(evaluated, { testSize, randomSeed, stratifyMode })
    : splitWffRows(evaluated, { testSize, randomSeed, stratifyMode });

  // "snapshot" re-scores the baked-in friction_pred column; any other mode
  // trains a tree ensemble on the TRAIN split only, then predicts every split
  // out-of-sample — so test/external metrics reflect genuine generalization.
  let predictOf: (row: WffParsedRow) => number;
  if (modelType === "snapshot") {
    predictOf = (row) => row.snapshotPredicted ?? row.measured;
  } else {
    const model = trainWffModel(
      modelType,
      split.train.map((r) => r.features),
      split.train.map((r) => r.measured),
      modelSeed(randomSeed),
      opts.hybridConfig ?? DEFAULT_HYBRID_CONFIG
    );
    predictOf = (row) => model.predict(row.features);
  }

  const trainPoints = split.train.map((r, i) => toPoint(r, "train", i + 1, predictOf(r)));
  const testPoints = split.test.map((r, i) => toPoint(r, "test", i + 1, predictOf(r)));
  // The point-wise external-validation chart reads cleanest when the measured
  // line is monotonic, so order the external literature set by measured COF.
  const externalLiteraturePoints = [...split.externalLiterature]
    .sort((a, b) => a.measured - b.measured || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((r, i) => toPoint(r, "externalLiterature", i + 1, predictOf(r)));
  const externalExperimentPoints: WffPoint[] = [];
  const allPoints = [...trainPoints, ...testPoints, ...externalLiteraturePoints];

  const splitResult = (name: WffSplitName, label: string, points: WffPoint[], note?: string): WffSplitResult => ({
    name,
    label,
    points,
    metrics: { ...computeWffMetrics(points), r2Note: r2Note(name, points) },
    note,
  });

  return {
    datasetId: opts.datasetId,
    label: opts.label,
    sourceRowCount: opts.sourceRowCount ?? rows.length,
    evaluatedRowCount: evaluated.length,
    droppedFlaggedCount,
    invalidCount: allPoints.filter((p) => p.physicallyInvalidPrediction).length,
    singletonStrataCount: externalLiteraturePoints.length,
    rows: evaluated,
    settings: {
      splitStrategy: "joint_label_stratified",
      stratifyMode,
      testSize,
      randomSeed,
      excludeFlagged,
      singletonPolicy: "routed_to_external_literature",
      modelType,
      modelLabel: WFF_MODEL_LABELS[modelType],
      trained,
    },
    splits: {
      train: splitResult("train", "Training", trainPoints),
      test: splitResult("test", "Internal testing", testPoints),
      externalLiterature: splitResult(
        "externalLiterature",
        "External literature",
        externalLiteraturePoints,
        externalLiteraturePoints.length
          ? trained
            ? "Singleton strata (a joint label seen once) are held out of train/test and predicted out-of-sample here — a genuine external check the model never trained on."
            : "Singleton strata (a joint label seen once) are held out of train/test and scored here on the snapshot prediction column."
          : "No singleton strata under this stratification — coarser labels produce no external-literature holdout."
      ),
      externalExperiment: splitResult(
        "externalExperiment",
        "External experiment",
        externalExperimentPoints,
        "No external-experiment rows in this teaching snapshot — the point-wise view is applied to the external literature set instead."
      ),
    },
    fitLines: {
      train: fitWffLine(trainPoints) ?? undefined,
      test: fitWffLine(testPoints) ?? undefined,
      externalLiterature: fitWffLine(externalLiteraturePoints) ?? undefined,
    },
    chartBounds: bounds(allPoints),
  };
}

export function buildWffEvaluation(opts: BuildWffEvaluationOptions): WffEvaluationResult {
  const allRows = parseWffCsv(opts.csvText, opts.datasetId);
  const rows = allRows.filter((row) => !opts.wffDataset || row.wffDataset === opts.wffDataset);
  return buildWffEvaluationFromRows(rows, {
    datasetId: opts.datasetId,
    label: opts.label,
    sourceRowCount: rows.length,
    testSize: opts.testSize,
    randomSeed: opts.randomSeed,
    stratifyMode: opts.stratifyMode,
    excludeFlagged: opts.excludeFlagged,
    modelType: opts.modelType,
    hybridConfig: opts.hybridConfig,
  });
}

function csvEscape(v: string | number | null | undefined): string {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function wffPointsToCsv(points: WffPoint[]): string {
  const headers = [
    "cation",
    "anion",
    "surface",
    "temperatureK",
    "measured",
    "predicted",
    "snapshotPredicted",
    "absoluteError",
    "squaredError",
    "split",
    "source",
    "dataset",
    "sourceLiteratureKey",
    "errorFlag",
    "physicallyInvalidPrediction",
    "originalIndex",
  ];
  const lines = points.map((p) =>
    [
      p.cation,
      p.anion,
      p.surface,
      p.temperature,
      p.measured,
      p.predicted,
      p.snapshotPredicted,
      p.absoluteError,
      p.squaredError,
      p.split,
      p.source,
      p.datasetId,
      p.sourceLiteratureKey,
      p.errorFlag,
      p.physicallyInvalidPrediction ? "yes" : "",
      p.originalIndex,
    ]
      .map(csvEscape)
      .join(",")
  );
  return [headers.join(","), ...lines].join("\n");
}
