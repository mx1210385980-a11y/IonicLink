import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { extractRecords, isLiveExtractionEnabled } from "../lib/extract";
import { getModule } from "../lib/modules/registry.server";
import type { ExtractedFields, RecordDraft } from "../lib/schema";
import {
  buildFieldMetrics,
  buildGoldEvaluationReport,
  type FieldMetric,
  type GoldAnnotationDocument,
  type GoldEvaluationMetrics,
} from "../lib/tribologyGoldEvaluation";

const DEFAULT_GOLD_PATH = "data/tribology/gold-standard/literature-annotations.json";
const DEFAULT_REPORT_DIR = "reports/tribology-gold-evaluation";

interface GoldAnnotationFile {
  version: number;
  domain: "tribology";
  description?: string;
  documents: GoldAnnotationDocument[];
}

interface CliOptions {
  goldPath: string;
  reportDir: string;
  source: "mock" | "live";
}

function parseArgs(argv: string[]): CliOptions {
  let goldPath = DEFAULT_GOLD_PATH;
  let reportDir = DEFAULT_REPORT_DIR;
  let source: CliOptions["source"] = "mock";

  for (const arg of argv) {
    if (arg.startsWith("--gold=")) goldPath = arg.slice("--gold=".length);
    else if (arg.startsWith("--report-dir=")) reportDir = arg.slice("--report-dir=".length);
    else if (arg === "--live" || arg === "--source=live") source = "live";
    else if (arg === "--mock" || arg === "--source=mock") source = "mock";
  }

  return { goldPath, reportDir, source };
}

function loadGoldFile(goldPath: string): GoldAnnotationFile {
  const parsed = JSON.parse(readFileSync(goldPath, "utf8")) as GoldAnnotationFile;
  if (parsed.domain !== "tribology") throw new Error(`Expected tribology gold file, got ${parsed.domain}`);
  if (!Array.isArray(parsed.documents) || parsed.documents.length === 0) {
    throw new Error("Gold file must contain at least one document");
  }
  return parsed;
}

async function buildPredictions(
  documents: GoldAnnotationDocument[],
  source: CliOptions["source"]
): Promise<{ predictions: Record<string, ExtractedFields[]>; model?: string }> {
  const mod = getModule("tribology");
  const predictions: Record<string, ExtractedFields[]> = {};
  let model: string | undefined;

  if (source === "live" && !isLiveExtractionEnabled()) {
    throw new Error(
      "Live extraction requested but no live extractor is configured. Set OPENAI_API_KEY + OPENAI_BASE_URL, or ANTHROPIC_API_KEY, or rerun with --mock."
    );
  }

  for (const document of documents) {
    if (source === "mock") {
      predictions[document.id] = mod.mockExtract(document.text) as ExtractedFields[];
      continue;
    }

    const result = await extractRecords("tribology", document.text);
    model = result.model;
    predictions[document.id] = (result.records as RecordDraft[]).map((record) => mod.toFields(record));
  }

  return { predictions, model };
}

function timestampForFilename(date: Date): string {
  return date.toISOString().replace(/[:.]/g, "-");
}

function metricRow(metric: FieldMetric): string[] {
  return [
    metric.field,
    String(metric.truePositive),
    String(metric.falsePositive),
    String(metric.falseNegative),
    formatMetric(metric.precision),
    formatMetric(metric.recall),
    formatMetric(metric.f1),
  ];
}

function metricsToCsv(metrics: GoldEvaluationMetrics): string {
  const rows = [
    ["field", "true_positive", "false_positive", "false_negative", "precision", "recall", "f1"],
    metricRow(metrics.micro),
    metricRow(metrics.macro),
    ...Object.values(metrics.byField).map(metricRow),
  ];
  return rows.map((row) => row.map(escapeCsvCell).join(",")).join("\n");
}

function buildMarkdownSummary(opts: {
  generatedAt: string;
  source: CliOptions["source"];
  model?: string;
  goldPath: string;
  documents: number;
  goldRecords: number;
  predictedRecords: number;
  metrics: GoldEvaluationMetrics;
}): string {
  const fieldRows = Object.values(opts.metrics.byField)
    .map(
      (metric) =>
        `| ${metric.field} | ${metric.truePositive} | ${metric.falsePositive} | ${metric.falseNegative} | ${formatMetric(metric.precision)} | ${formatMetric(metric.recall)} | ${formatMetric(metric.f1)} |`
    )
    .join("\n");

  return `# Tribology Gold Evaluation

Generated: ${opts.generatedAt}

- Gold file: \`${opts.goldPath}\`
- Source: \`${opts.source}\`${opts.model ? ` / \`${opts.model}\`` : ""}
- Documents: ${opts.documents}
- Gold records: ${opts.goldRecords}
- Predicted records: ${opts.predictedRecords}

## Overall

| metric | TP | FP | FN | precision | recall | F1 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| micro | ${opts.metrics.micro.truePositive} | ${opts.metrics.micro.falsePositive} | ${opts.metrics.micro.falseNegative} | ${formatMetric(opts.metrics.micro.precision)} | ${formatMetric(opts.metrics.micro.recall)} | ${formatMetric(opts.metrics.micro.f1)} |
| macro | ${formatMetric(opts.metrics.macro.truePositive)} | ${formatMetric(opts.metrics.macro.falsePositive)} | ${formatMetric(opts.metrics.macro.falseNegative)} | ${formatMetric(opts.metrics.macro.precision)} | ${formatMetric(opts.metrics.macro.recall)} | ${formatMetric(opts.metrics.macro.f1)} |

## By Field

| field | TP | FP | FN | precision | recall | F1 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
${fieldRows}
`;
}

function writeReports(reportDir: string, basename: string, payload: unknown, markdown: string, csv: string) {
  mkdirSync(reportDir, { recursive: true });
  const jsonPath = path.join(reportDir, `${basename}.json`);
  const markdownPath = path.join(reportDir, `${basename}.md`);
  const csvPath = path.join(reportDir, `${basename}.csv`);
  writeFileSync(jsonPath, `${JSON.stringify(payload, null, 2)}\n`);
  writeFileSync(markdownPath, markdown);
  writeFileSync(csvPath, `${csv}\n`);
  return { jsonPath, markdownPath, csvPath };
}

function formatMetric(value: number): string {
  return value.toFixed(4);
}

function escapeCsvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const goldPath = path.resolve(options.goldPath);
  const reportDir = path.resolve(options.reportDir);
  const goldFile = loadGoldFile(goldPath);
  const { predictions, model } = await buildPredictions(goldFile.documents, options.source);
  const report = buildGoldEvaluationReport(goldFile.documents, predictions);
  const metrics = buildFieldMetrics(report);
  const generatedAt = new Date().toISOString();
  const basename = `tribology-gold-${options.source}-${timestampForFilename(new Date(generatedAt))}`;

  const payload = {
    generatedAt,
    goldPath,
    source: options.source,
    model,
    description: goldFile.description,
    report,
    metrics,
  };
  const markdown = buildMarkdownSummary({
    generatedAt,
    source: options.source,
    model,
    goldPath,
    documents: report.documents,
    goldRecords: report.goldRecords,
    predictedRecords: report.predictedRecords,
    metrics,
  });
  const paths = writeReports(reportDir, basename, payload, markdown, metricsToCsv(metrics));

  console.log(
    JSON.stringify(
      {
        source: options.source,
        model,
        documents: report.documents,
        goldRecords: report.goldRecords,
        predictedRecords: report.predictedRecords,
        micro: metrics.micro,
        macro: metrics.macro,
        ...paths,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
