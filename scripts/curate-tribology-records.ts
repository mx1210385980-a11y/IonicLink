import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { listRecords, updateRecord } from "../lib/db";
import type { IonicRecord } from "../lib/schema";
import {
  buildCoverageSummary,
  classifyRecordIssues,
  planOfficialCuration,
  type OfficialCurationPlan,
} from "../lib/tribologyCuration";

const DEFAULT_REPORT_DIR = "reports/tribology-curation";

interface CliOptions {
  write: boolean;
  reportDir: string;
}

function parseArgs(argv: string[]): CliOptions {
  let reportDir = DEFAULT_REPORT_DIR;

  for (const arg of argv) {
    if (arg.startsWith("--report-dir=")) {
      reportDir = arg.slice("--report-dir=".length);
    }
  }

  return {
    write: argv.includes("--write"),
    reportDir,
  };
}

function recordSummary(record: IonicRecord) {
  return {
    id: record.id,
    paper: record.paper.title,
    cation: record.core.ionicLiquid.cation,
    anion: record.core.ionicLiquid.anion,
    substrate: record.core.substrate,
    cof: record.core.cof,
  };
}

function officialAfterPlan(officialRecords: IonicRecord[], plan: OfficialCurationPlan): IonicRecord[] {
  const demoteIds = new Set(plan.demote.map((record) => record.id));
  return [
    ...officialRecords.filter((record) => !demoteIds.has(record.id)),
    ...plan.promote,
  ];
}

function applyPlan(plan: OfficialCurationPlan): void {
  for (const record of plan.demote) {
    const result = updateRecord("tribology", record.id, { status: "review" });
    if (result.error) throw new Error(`${record.id}: ${result.error}`);
  }

  for (const record of plan.promote) {
    const result = updateRecord("tribology", record.id, { status: "official" });
    if (result.error) throw new Error(`${record.id}: ${result.error}`);
  }
}

function timestampForFilename(date: Date): string {
  return date.toISOString().replace(/[:.]/g, "-");
}

function buildReport(opts: {
  generatedAt: Date;
  write: boolean;
  officialRecords: IonicRecord[];
  reviewRecords: IonicRecord[];
  plan: OfficialCurationPlan;
}) {
  const officialAfter = officialAfterPlan(opts.officialRecords, opts.plan);
  return {
    generatedAt: opts.generatedAt.toISOString(),
    write: opts.write,
    counts: {
      officialBefore: opts.officialRecords.length,
      reviewBefore: opts.reviewRecords.length,
      promote: opts.plan.promote.length,
      demote: opts.plan.demote.length,
      keepReview: opts.plan.keepReview.length,
      officialIssues: opts.plan.officialIssues.length,
      duplicateGroups: opts.plan.duplicateGroups.length,
    },
    promote: opts.plan.promote.map(recordSummary),
    demote: opts.plan.demote.map((record) => ({
      id: record.id,
      paper: record.paper.title,
      issues: classifyRecordIssues(record),
    })),
    keepReview: opts.plan.keepReview.map(({ record, reasons }) => ({
      id: record.id,
      paper: record.paper.title,
      reasons,
    })),
    officialIssues: opts.plan.officialIssues.map(({ record, reasons }) => ({
      id: record.id,
      paper: record.paper.title,
      reasons,
    })),
    duplicateGroups: opts.plan.duplicateGroups.map((group) => ({
      fingerprint: group.fingerprint,
      records: group.records.map((record) => record.id),
    })),
    coverage: buildCoverageSummary(officialAfter),
  };
}

function writeReport(reportDir: string, basename: string, phase: "planned" | "applied", report: unknown): string {
  mkdirSync(reportDir, { recursive: true });
  const reportPath = path.join(reportDir, `${basename}-${phase}.json`);
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  return reportPath;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const officialRecords = listRecords("tribology", { status: "official" }) as IonicRecord[];
  const reviewRecords = listRecords("tribology", { status: "review" }) as IonicRecord[];
  const plan = planOfficialCuration({ officialRecords, reviewRecords });

  const generatedAt = new Date();
  const basename = `official-curation-${timestampForFilename(generatedAt)}`;
  const plannedReport = buildReport({ generatedAt, write: options.write, officialRecords, reviewRecords, plan });
  const plannedReportPath = writeReport(options.reportDir, basename, "planned", plannedReport);
  let reportPath = plannedReportPath;

  if (options.write) {
    applyPlan(plan);
    const appliedReport = buildReport({ generatedAt: new Date(), write: true, officialRecords, reviewRecords, plan });
    reportPath = writeReport(options.reportDir, basename, "applied", appliedReport);
  }

  console.log(
    JSON.stringify(
      {
        write: options.write,
        reportPath,
        plannedReportPath,
        promote: plan.promote.length,
        demote: plan.demote.length,
        keepReview: plan.keepReview.length,
        officialIssues: plan.officialIssues.length,
        duplicateGroups: plan.duplicateGroups.length,
      },
      null,
      2
    )
  );
}

main();
