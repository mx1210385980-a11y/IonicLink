import fs from "node:fs";
import path from "node:path";
import { parseWffCsv, type WffDatasetId, type WffParsedRow } from "./wffEvaluation";

export interface WffDatasetData {
  datasetId: WffDatasetId;
  label: string;
  rows: WffParsedRow[];
  sourceRowCount: number;
}

export interface WffPaperMetricBlock {
  n: number;
  r2: number | null;
  mae: number | null;
  rmse: number | null;
}

export interface WffPaperReport {
  config: Record<string, unknown>;
  target_metrics: Record<"test" | "external_literature", Omit<WffPaperMetricBlock, "n">>;
  metrics: Record<"train" | "test" | "external_literature", WffPaperMetricBlock>;
  deltas: Record<"test" | "external_literature", Omit<WffPaperMetricBlock, "n">>;
  region_counts: Record<string, number>;
  tolerances: Record<string, number>;
  within_tolerance: boolean;
}

export interface WffEvaluationData {
  datasetA: WffDatasetData;
  datasetB: WffDatasetData;
  paperReport: WffPaperReport | null;
}

function buildDatasetData(
  datasetId: WffDatasetId,
  label: string,
  csvText: string,
  wffDataset?: "film" | "no_film"
): WffDatasetData {
  const rows = parseWffCsv(csvText, datasetId).filter((row) => !wffDataset || row.wffDataset === wffDataset);
  return { datasetId, label, rows, sourceRowCount: rows.length };
}

export function loadWffPaperReport(root = process.cwd()): WffPaperReport | null {
  const reportPath = path.join(root, "reports", "wff", "dataset-b-hybrid-metrics.json");
  if (!fs.existsSync(reportPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(reportPath, "utf8")) as WffPaperReport;
  } catch {
    return null;
  }
}

/**
 * Parse the WFF teaching CSVs server-side and hand the predicted rows to the
 * client, which re-runs the split/metrics live as the evaluation settings
 * change. Returns null when the data files are not present.
 */
export function loadWffEvaluationData(): WffEvaluationData | null {
  const dir = path.join(process.cwd(), "data", "wff");
  const combinedPath = path.join(dir, "wff_lubrication_source_annotations.combined.csv");
  const datasetAPath = path.join(dir, "no+film+dataset+0312.csv");
  const datasetBPath = path.join(dir, "film+dataset0312.csv");

  if (fs.existsSync(combinedPath)) {
    const csvText = fs.readFileSync(combinedPath, "utf8");
    return {
      datasetA: buildDatasetData("dataset-a", "Dataset A · baseline", csvText, "no_film"),
      datasetB: buildDatasetData("dataset-b", "Dataset B · film-aware", csvText, "film"),
      paperReport: loadWffPaperReport(),
    };
  }
  if (!fs.existsSync(datasetAPath) || !fs.existsSync(datasetBPath)) return null;
  return {
    datasetA: buildDatasetData("dataset-a", "Dataset A · baseline", fs.readFileSync(datasetAPath, "utf8")),
    datasetB: buildDatasetData("dataset-b", "Dataset B · film-aware", fs.readFileSync(datasetBPath, "utf8")),
    paperReport: loadWffPaperReport(),
  };
}
