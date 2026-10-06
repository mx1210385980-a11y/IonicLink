import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  backupDomainDatabase,
  getSource,
  listRecords,
  updateRecord,
} from "../lib/db";
import {
  curvePresentation,
  findPerformanceFigureCandidates,
  type FigureTextCandidate,
  type PerformanceFigureTarget,
  type PerformanceTargetField,
} from "../lib/conductivity/performanceFigureBackfill";
import {
  buildReportedCurveKeyPoints,
  extractFullFigureCaption,
} from "../lib/conductivity/performanceFigureMetadata";
import { toFields } from "../lib/conductivity/ingest";
import type {
  ConductivityExtractedFields,
  ConductivityPerformanceFigure,
  ConductivityRecord,
} from "../lib/conductivity/schema";
import { inferSourceFigureBox } from "../lib/sources";

const MIN_SCORE = 18;
const MIN_MARGIN = 3;
const PAGE_RADIUS = 2;

interface PlannedBackfill {
  id: string;
  title: string;
  sourceId: string;
  sourceFilename: string;
  target: PerformanceFigureTarget;
  candidate: FigureTextCandidate;
  runnerUp: Pick<FigureTextCandidate, "figure" | "page" | "score"> | null;
  crop: { x: number; y: number; w: number; h: number };
  performanceFigure: ConductivityPerformanceFigure;
}

interface SkippedBackfill {
  id: string;
  title: string;
  reason: string;
  target?: Pick<PerformanceFigureTarget, "field" | "rawValue" | "provenancePage">;
  topCandidates?: Array<Pick<FigureTextCandidate, "figure" | "page" | "score" | "captionLike" | "reasons">>;
}

function primaryTarget(record: ConductivityRecord): PerformanceFigureTarget | null {
  const choices: Array<[PerformanceTargetField, string | undefined]> = [
    ["conductivity", record.core.conductivity?.raw],
    ["electrochemicalWindow", record.core.electrochemicalWindow?.raw],
    ["chargeTransferResistance", record.core.chargeTransferResistance?.raw],
    ["capacitance", record.core.capacitance?.raw],
    ["viscosity", record.extended.viscosity?.raw],
    ["electricField", record.core.electricField?.raw],
  ];
  for (const [field, rawValue] of choices) {
    if (!rawValue) continue;
    const provenancePage = record.provenance?.[field]?.page;
    if (!provenancePage) continue;
    return {
      field,
      rawValue,
      provenancePage,
      method: record.extended.method,
      seriesTokens: seriesTokens(record),
    };
  }
  return null;
}

function seriesTokens(record: ConductivityRecord): string[] {
  const ion = record.core.ionicLiquid;
  const candidates = [
    ion.cation.replace(/[\[\]]/g, ""),
    ion.anion.replace(/[\[\]]/g, ""),
    record.core.surface,
    record.extended.concentration ?? "",
  ];
  return candidates.flatMap((value) => [
    value,
    ...value.split(/[\s/;,()+]+/).filter((token) => token.length >= 3),
  ]);
}

function targetCondition(record: ConductivityRecord): string {
  return record.core.temperature?.raw
    ?? record.extended.concentration
    ?? record.core.electrodePotential?.raw
    ?? "Reported condition";
}

function seriesLabel(record: ConductivityRecord): string {
  const ion = `${record.core.ionicLiquid.cation}${record.core.ionicLiquid.anion}`;
  const context = [record.extended.concentration, record.core.surface]
    .filter((value): value is string => Boolean(value && value !== "bulk liquid"));
  return [ion, ...context].join(" · ");
}

function buildPerformanceFigure(
  record: ConductivityRecord,
  target: PerformanceFigureTarget,
  candidate: FigureTextCandidate,
  pageText: string,
): ConductivityPerformanceFigure {
  const presentation = curvePresentation(target.field, target.method);
  return {
    figure: candidate.figure,
    page: candidate.page,
    ...presentation,
    seriesLabel: seriesLabel(record),
    caption: extractFullFigureCaption(pageText, candidate.figure) ?? candidate.line.slice(0, 500),
    primaryField: target.field,
    keyPoints: buildReportedCurveKeyPoints(record, target.field),
    dataStatus: "reported-key-points",
  };
}

function mergePerformanceFigureProvenance(
  record: ConductivityRecord,
  candidate: FigureTextCandidate,
): ConductivityExtractedFields["provenance"] {
  const current = new Map(
    Object.entries(record.provenance ?? {}).map(([field, provenance]) => [field, { field, ...provenance }]),
  );
  current.set("performanceFigure", {
    field: "performanceFigure",
    page: candidate.page,
    figure: candidate.figure,
    quote: candidate.line.slice(0, 700),
    context: candidate.context.slice(0, 1200),
    basis: "inferred",
    basisNote: "High-confidence automatic link: the source figure caption matches the approved target property and the PDF crop was located. Review before treating plotted pixels as numeric data.",
  });
  return [...current.values()];
}

function distinctFigureCandidates(candidates: FigureTextCandidate[]): FigureTextCandidate[] {
  const best = new Map<string, FigureTextCandidate>();
  for (const candidate of candidates) {
    const key = candidate.figure.toLowerCase();
    const current = best.get(key);
    if (!current || candidate.score > current.score) best.set(key, candidate);
  }
  return [...best.values()].sort((a, b) => b.score - a.score);
}

async function selectCandidate(
  sourceId: string,
  candidates: FigureTextCandidate[],
): Promise<{
  selected?: FigureTextCandidate;
  crop?: { x: number; y: number; w: number; h: number };
  runnerUp?: FigureTextCandidate;
  reason?: string;
}> {
  const captionCandidates = distinctFigureCandidates(candidates.filter((candidate) => candidate.captionLike));
  const viable: Array<{ candidate: FigureTextCandidate; crop: { x: number; y: number; w: number; h: number } }> = [];
  for (const candidate of captionCandidates) {
    if (candidate.score < MIN_SCORE) continue;
    const crop = await inferSourceFigureBox("conductivity", sourceId, candidate.page, candidate.figure);
    if (crop) viable.push({ candidate, crop });
  }
  if (!viable.length) {
    return { reason: captionCandidates.length ? "No caption candidate met the score and crop requirements." : "No caption-like target figure was found." };
  }
  viable.sort((a, b) => b.candidate.score - a.candidate.score);
  const top = viable[0];
  const runnerUp = viable[1]?.candidate;
  if (runnerUp && top.candidate.score - runnerUp.score < MIN_MARGIN) {
    return { runnerUp, reason: `Ambiguous figure match: score margin is below ${MIN_MARGIN}.` };
  }
  return { selected: top.candidate, crop: top.crop, runnerUp };
}

async function main() {
  const commit = process.argv.includes("--commit") || process.argv.includes("--write") || process.argv.includes("--apply");
  const records = listRecords("conductivity", { status: "official" }) as ConductivityRecord[];
  const planned: PlannedBackfill[] = [];
  const skipped: SkippedBackfill[] = [];

  for (const record of records) {
    if (record.extended.performanceFigure) {
      skipped.push({ id: record.id, title: record.paper.title, reason: "A performance figure is already stored." });
      continue;
    }
    if (!record.sourceId) {
      skipped.push({ id: record.id, title: record.paper.title, reason: "No linked source PDF." });
      continue;
    }
    const target = primaryTarget(record);
    if (!target) {
      skipped.push({ id: record.id, title: record.paper.title, reason: "No target value with page-level provenance." });
      continue;
    }
    const source = getSource("conductivity", record.sourceId);
    if (!source) {
      skipped.push({ id: record.id, title: record.paper.title, target, reason: "Linked source metadata is missing." });
      continue;
    }
    const candidates = findPerformanceFigureCandidates(source.pages, target, PAGE_RADIUS);
    const result = await selectCandidate(record.sourceId, candidates);
    if (!result.selected || !result.crop) {
      skipped.push({
        id: record.id,
        title: record.paper.title,
        target,
        reason: result.reason ?? "No high-confidence figure match.",
        topCandidates: candidates.slice(0, 4).map(({ figure, page, score, captionLike, reasons }) => ({ figure, page, score, captionLike, reasons })),
      });
      continue;
    }
    planned.push({
      id: record.id,
      title: record.paper.title,
      sourceId: record.sourceId,
      sourceFilename: source.filename,
      target,
      candidate: result.selected,
      runnerUp: result.runnerUp ? {
        figure: result.runnerUp.figure,
        page: result.runnerUp.page,
        score: result.runnerUp.score,
      } : null,
      crop: result.crop,
      performanceFigure: buildPerformanceFigure(
        record,
        target,
        result.selected,
        source.pages.find((page) => page.page === result.selected!.page)?.text ?? "",
      ),
    });
  }

  let backup: string | null = null;
  let updated = 0;
  if (commit && planned.length) {
    backup = backupDomainDatabase("conductivity");
    if (!backup) throw new Error("Could not create the required conductivity database backup.");
    for (const item of planned) {
      const record = records.find((candidate) => candidate.id === item.id);
      if (!record) throw new Error(`Record disappeared before update: ${item.id}`);
      const fields = {
        ...toFields(record),
        performanceFigure: item.performanceFigure,
        provenance: mergePerformanceFigureProvenance(record, item.candidate),
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
    policy: {
      recordValues: "Existing approved record values are preserved; curve pixels are not used to invent or replace numbers.",
      acceptance: `Caption-like target figure, score >= ${MIN_SCORE}, locatable PDF crop, and >= ${MIN_MARGIN}-point margin over a different viable figure.`,
      scope: `Search is limited to ±${PAGE_RADIUS} pages around the approved target provenance page.`,
      review: "The source-to-record link is marked inferred. Numeric curve digitization remains a separate review task.",
    },
    summary: {
      officialRecords: records.length,
      plannedHighConfidence: planned.length,
      updatedThisRun: updated,
      skipped: skipped.length,
      backup,
    },
    matched: planned,
    skipped,
  };
  const output = path.resolve("data/conductivity/performance-figure-backfill-audit.json");
  mkdirSync(path.dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ output, ...report.summary }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
