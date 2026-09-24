import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { backupDomainDatabase, getSource, listRecords, updateRecord } from "../lib/db";
import { toFields } from "../lib/conductivity/ingest";
import type { PerformanceTargetField } from "../lib/conductivity/performanceFigureBackfill";
import {
  buildReportedCurveKeyPoints,
  extractFullFigureCaption,
} from "../lib/conductivity/performanceFigureMetadata";
import { buildRelevantFigurePanels } from "../lib/conductivity/performanceFigurePanels";
import type { ConductivityRecord } from "../lib/conductivity/schema";
import type { ConductivityPerformancePanel } from "../lib/conductivity/schema";
import type { BBox } from "../lib/schema";
import { inferSourceFigureBox } from "../lib/sources";

const TARGET_FIELDS = new Set<PerformanceTargetField>([
  "conductivity",
  "electrochemicalWindow",
  "chargeTransferResistance",
  "capacitance",
  "viscosity",
  "electricField",
]);

async function main() {
  const commit = process.argv.includes("--commit") || process.argv.includes("--write");
  const records = listRecords("conductivity", { status: "official" }) as ConductivityRecord[];
  const planned: Array<{
    id: string;
    figure: string;
    page: number;
    primaryField: PerformanceTargetField;
    caption: string;
    keyPointCount: number;
    panelCount: number;
    figureBox?: BBox;
    panels?: ConductivityPerformancePanel[];
  }> = [];
  const skipped: Array<{ id: string; reason: string }> = [];

  for (const record of records) {
    const figure = record.extended.performanceFigure;
    if (!figure) continue;
    const primaryField = figure.primaryField as PerformanceTargetField | undefined;
    if (!primaryField || !TARGET_FIELDS.has(primaryField)) {
      skipped.push({ id: record.id, reason: "Missing or unsupported primary curve field." });
      continue;
    }
    if (!record.sourceId || !figure.page) {
      skipped.push({ id: record.id, reason: "Missing linked source or figure page." });
      continue;
    }
    const source = getSource("conductivity", record.sourceId);
    const pageText = source?.pages.find((page) => page.page === figure.page)?.text;
    if (!pageText) {
      skipped.push({ id: record.id, reason: "Stored source page text is unavailable." });
      continue;
    }
    const caption = extractFullFigureCaption(pageText, figure.figure) ?? figure.caption;
    if (!caption) {
      skipped.push({ id: record.id, reason: "Full caption could not be recovered." });
      continue;
    }
    const keyPoints = buildReportedCurveKeyPoints(record, primaryField);
    if (!keyPoints.length) {
      skipped.push({ id: record.id, reason: "No approved record value can be attached as a key point." });
      continue;
    }
    const figureBox = figure.figureBox
      ?? record.provenance?.performanceFigure?.figureBox
      ?? await inferSourceFigureBox("conductivity", record.sourceId, figure.page, figure.figure)
      ?? undefined;
    const panelCandidate = {
      ...figure,
      figureBox,
      caption,
      keyPoints,
    };
    const panels = figure.panels?.length ? figure.panels : buildRelevantFigurePanels(panelCandidate);
    const nextFigure = {
      ...figure,
      caption,
      keyPoints,
      figureBox,
      panels: panels.length ? panels : undefined,
      dataStatus: figure.dataStatus ?? "reported-key-points" as const,
    };
    const changed = JSON.stringify(nextFigure) !== JSON.stringify(figure);
    if (!changed) continue;
    planned.push({
      id: record.id,
      figure: figure.figure,
      page: figure.page,
      primaryField,
      caption,
      keyPointCount: keyPoints.length,
      panelCount: panels.length,
      figureBox,
      panels: panels.length ? panels : undefined,
    });
  }

  let backup: string | null = null;
  let updated = 0;
  if (commit && planned.length) {
    backup = backupDomainDatabase("conductivity");
    if (!backup) throw new Error("Could not create the required conductivity database backup.");
    for (const item of planned) {
      const record = records.find((candidate) => candidate.id === item.id)!;
      const figure = record.extended.performanceFigure!;
      const keyPoints = buildReportedCurveKeyPoints(record, item.primaryField);
      const panels = item.panels ?? [];
      const provenance = new Map(
        Object.entries(record.provenance ?? {}).map(([field, value]) => [field, { field, ...value }]),
      );
      const previous = provenance.get("performanceFigure");
      provenance.set("performanceFigure", {
        ...previous,
        field: "performanceFigure",
        page: item.page,
        figure: item.figure,
        figureBox: item.figureBox,
        quote: item.caption.slice(0, 1200),
        basis: previous?.basis ?? "inferred",
        basisNote: previous?.basisNote
          ?? "The full source caption and approved record readings are stored as structured curve metadata; plotted pixels are not treated as numeric data.",
      });
      const fields = {
        ...toFields(record),
        performanceFigure: {
          ...figure,
          caption: item.caption,
          keyPoints,
          figureBox: item.figureBox,
          panels: panels.length ? panels : undefined,
          dataStatus: figure.dataStatus ?? "reported-key-points" as const,
        },
        provenance: [...provenance.values()],
      };
      const result = updateRecord("conductivity", item.id, { fields });
      if (result.error) throw new Error(`Could not update ${item.id}: ${result.error}`);
      updated += 1;
    }
  }

  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    mode: commit ? "applied" : "dry-run",
    summary: {
      officialRecords: records.length,
      existingPerformanceFigures: records.filter((record) => record.extended.performanceFigure).length,
      planned: planned.length,
      updatedThisRun: updated,
      skipped: skipped.length,
      backup,
    },
    policy: {
      captions: "Recovered from stored PDF text; no image OCR or paraphrase is used.",
      keyPoints: "Only already-approved record values are linked to the curve; no plotted value is guessed.",
      panels: "Caption-declared curve panels are cropped into page-level boxes and displayed one at a time; unrelated microscopy and circuit schematics are excluded.",
      readiness: "Image-only curves remain reported-key-points until a complete numeric series is genuinely digitized or supplied.",
    },
    enriched: planned,
    skipped,
  };
  const output = path.resolve("data/conductivity/performance-figure-metadata-audit.json");
  mkdirSync(path.dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ output, ...report.summary }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
