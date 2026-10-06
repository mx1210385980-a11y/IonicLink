import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  createJobs,
  createRecords,
  deleteRecords,
  findSourceByDoi,
  listJobs,
  listRecords,
  listSourceSummaries,
  updateRecord,
} from "../lib/db";
import { conductivityMockExtract } from "../lib/conductivity/extract";
import { ingest, toFields } from "../lib/conductivity/ingest";
import type { ConductivityExtractedFields, ConductivityRecord } from "../lib/conductivity/schema";
import { kickDrain } from "../lib/jobs";
import { extractDoiFromPages } from "../lib/doi";
import { pagesToTaggedText, pdfToPages } from "../lib/pdf";
import { createSourceFromPdf, getSourcePdf } from "../lib/sources";

type Classification = "text-values" | "figure-only" | "no-in-scope-value";
interface AuditedPaper {
  file: string;
  doi?: string;
  classification: Classification;
  reviewSummary: string;
  records: ConductivityExtractedFields[];
}
interface AuditFile { papers: AuditedPaper[] }

async function findPdfs(root: string): Promise<string[]> {
  const { readdir } = await import("node:fs/promises");
  const output: string[] = [];
  async function walk(dir: string) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith(".pdf")) output.push(full);
    }
  }
  await walk(root);
  return output;
}

function recordFingerprint(record: ConductivityRecord): string {
  const c = record.core;
  return JSON.stringify({
    sourceId: record.sourceId,
    doi: record.paper.doi?.toLowerCase(),
    cation: c.ionicLiquid.cation,
    anion: c.ionicLiquid.anion,
    surface: c.surface,
    conductivity: c.conductivity?.raw,
    capacitance: c.capacitance?.raw,
    electricField: c.electricField?.raw,
    electrodePotential: c.electrodePotential?.raw,
    electrochemicalWindow: c.electrochemicalWindow?.raw,
    resistance: c.chargeTransferResistance?.raw,
    viscosity: record.extended.viscosity?.raw,
    concentration: record.extended.concentration,
  });
}

interface PropertyPoint {
  field: "conductivity" | "capacitance" | "electricField" | "electrochemicalWindow" | "chargeTransferResistance" | "viscosity";
  raw: string;
  std: number | null;
  stdUnit: string;
}

function propertyPoints(fields: ConductivityExtractedFields): PropertyPoint[] {
  const draft = ingest(fields);
  const values = {
    conductivity: draft.core.conductivity,
    capacitance: draft.core.capacitance,
    electricField: draft.core.electricField,
    electrochemicalWindow: draft.core.electrochemicalWindow,
    chargeTransferResistance: draft.core.chargeTransferResistance,
    viscosity: draft.extended.viscosity,
  };
  return Object.entries(values).flatMap(([field, quantity]) => quantity ? [{
    field: field as PropertyPoint["field"],
    raw: quantity.raw,
    std: quantity.std,
    stdUnit: quantity.stdUnit,
  }] : []);
}

function comparePropertyPoints(expected: PropertyPoint[], extracted: PropertyPoint[]) {
  const used = new Set<number>();
  const matches: Array<{ expected: PropertyPoint; extracted: PropertyPoint }> = [];
  for (const wanted of expected) {
    const index = extracted.findIndex((candidate, i) => {
      if (used.has(i) || candidate.field !== wanted.field || candidate.stdUnit !== wanted.stdUnit) return false;
      if (wanted.std == null || candidate.std == null) return candidate.raw.replace(/\s+/g, " ") === wanted.raw.replace(/\s+/g, " ");
      return Math.abs(candidate.std - wanted.std) <= Math.max(1e-12, Math.abs(wanted.std) * 1e-6);
    });
    if (index >= 0) {
      used.add(index);
      matches.push({ expected: wanted, extracted: extracted[index] });
    }
  }
  return {
    matches,
    missing: expected.filter((point) => !matches.some((match) => match.expected === point)),
    extra: extracted.filter((_, index) => !used.has(index)),
  };
}

interface ConditionPoint { field: string; value: string }

function normalizedText(value: string): string {
  return value.toLowerCase().replace(/µ|μ/g, "u").replace(/−/g, "-").replace(/[^a-z0-9<>+.-]+/g, "");
}

function conditionPoints(fields: ConductivityExtractedFields): ConditionPoint[] {
  const draft = ingest(fields);
  const points: ConditionPoint[] = [];
  const add = (field: string, value: string | undefined | null) => { if (value) points.push({ field, value }); };
  add("cation", draft.core.ionicLiquid.cation);
  add("anion", draft.core.ionicLiquid.anion);
  add("surface", draft.core.surface);
  if (draft.core.temperature?.std != null && draft.provenance?.temperature?.basis !== "assumed" && !/^room temperature$/i.test(fields.temperature ?? "")) {
    add("temperature", `${draft.core.temperature.std} ${draft.core.temperature.stdUnit}`);
  }
  if (draft.core.electrodePotential?.std != null) add("electrodePotential", `${draft.core.electrodePotential.std} ${draft.core.electrodePotential.stdUnit}`);
  if (draft.extended.pressure?.std != null) add("pressure", `${draft.extended.pressure.std} ${draft.extended.pressure.stdUnit}`);
  add("potentialReference", draft.extended.potentialReference);
  add("waterContent", draft.extended.waterContent);
  add("concentration", draft.extended.concentration);
  add("method", draft.extended.method);
  for (const item of draft.flexible) add(`flexible:${item.key}`, `${item.value}${item.unit ? ` ${item.unit}` : ""}`);
  return points;
}

function conditionValuesMatch(expected: ConditionPoint, extracted: ConditionPoint): boolean {
  if (normalizedText(expected.field) !== normalizedText(extracted.field)) return false;
  const left = normalizedText(expected.value);
  const right = normalizedText(extracted.value);
  if (left === right) return true;
  if (expected.field === "concentration") {
    const tokens = (value: string) => [...value.matchAll(/\d+(?:\.\d+)?\s*(?:mM|M\b|mol\s*\/?\s*L)/gi)]
      .map((match) => normalizedText(match[0]));
    const wanted = tokens(expected.value);
    const actual = tokens(extracted.value);
    return wanted.length > 0 && wanted.every((token) => actual.includes(token));
  }
  return false;
}

function compareConditionsForPaper(expectedRecords: ConductivityExtractedFields[], extractedRecords: ConductivityExtractedFields[]) {
  const usedRecords = new Set<number>();
  const expected: ConditionPoint[] = [];
  const matched: ConditionPoint[] = [];
  const missing: ConditionPoint[] = [];
  const extra: ConditionPoint[] = [];
  for (const wantedRecord of expectedRecords) {
    const wantedProperties = propertyPoints(wantedRecord);
    let bestIndex = -1;
    let bestOverlap = 0;
    extractedRecords.forEach((candidate, index) => {
      if (usedRecords.has(index)) return;
      const overlap = comparePropertyPoints(wantedProperties, propertyPoints(candidate)).matches.length;
      if (overlap > bestOverlap) { bestOverlap = overlap; bestIndex = index; }
    });
    const wantedConditions = conditionPoints(wantedRecord);
    expected.push(...wantedConditions);
    if (bestIndex < 0) {
      missing.push(...wantedConditions);
      continue;
    }
    usedRecords.add(bestIndex);
    const actualConditions = conditionPoints(extractedRecords[bestIndex]);
    const usedConditions = new Set<number>();
    for (const condition of wantedConditions) {
      const index = actualConditions.findIndex((candidate, i) => !usedConditions.has(i) && conditionValuesMatch(condition, candidate));
      if (index >= 0) { usedConditions.add(index); matched.push(condition); }
      else missing.push(condition);
    }
    extra.push(...actualConditions.filter((_, index) => !usedConditions.has(index)));
  }
  return { expected, matched, missing, extra };
}

async function waitForJobs(sourceIds: Set<string>) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const jobs = listJobs("conductivity").filter((job) => job.sourceId && sourceIds.has(job.sourceId));
    if (jobs.every((job) => job.status === "done" || job.status === "error" || job.status === "committed")) return jobs;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return listJobs("conductivity").filter((job) => job.sourceId && sourceIds.has(job.sourceId));
}

async function main() {
  const root = path.resolve(process.argv[2] || "");
  const auditPath = path.resolve(process.argv[3] || "data/conductivity/electrochem-manual-audit.json");
  const reportPath = path.resolve(process.argv[4] || "data/conductivity/electrochem-extractor-benchmark.json");
  const write = process.argv.includes("--write");
  if (!process.argv[2]) throw new Error("Usage: tsx scripts/import-conductivity-audit.ts <corpus-root> [audit-json] [report-json] [--write]");

  const audit = JSON.parse(await readFile(auditPath, "utf8")) as AuditFile;
  const auditByFile = new Map(audit.papers.map((paper) => [paper.file, paper]));
  const unique = new Map<string, string>();
  for (const file of await findPdfs(root)) {
    const bytes = await readFile(file);
    const hash = createHash("sha256").update(bytes).digest("hex");
    if (!unique.has(hash)) unique.set(hash, file);
  }

  const storedByHash = new Map<string, string>();
  for (const source of listSourceSummaries("conductivity")) {
    const bytes = await getSourcePdf("conductivity", source.id);
    if (bytes) storedByHash.set(createHash("sha256").update(bytes).digest("hex"), source.id);
  }

  const sourceIds = new Set<string>();
  const sourceForAudit = new Map<string, string>();
  const offlineResults: Array<{ file: string; classification: Classification; expectedRecords: number; extracted: ReturnType<typeof conductivityMockExtract> }> = [];
  let uploaded = 0;
  let reused = 0;
  const unavailable: string[] = [];

  for (const paper of audit.papers) {
    const match = [...unique.entries()].find(([, file]) => path.basename(file) === paper.file);
    if (!match) {
      unavailable.push(paper.file);
      continue;
    }
    const [hash, file] = match;
    const bytes = new Uint8Array(await readFile(file));
    const pages = await pdfToPages(bytes);
    const doi = paper.doi ?? extractDoiFromPages(pages) ?? undefined;
    let sourceId = (doi ? findSourceByDoi("conductivity", doi)?.id : undefined) ?? storedByHash.get(hash);
    if (!sourceId) {
      if (!write) sourceId = `dry-run:${hash.slice(0, 12)}`;
      else {
        const source = await createSourceFromPdf("conductivity", paper.file, bytes, pages);
        sourceId = source.id;
        uploaded += 1;
      }
    } else reused += 1;
    sourceIds.add(sourceId);
    sourceForAudit.set(paper.file, sourceId);
    const taggedText = pagesToTaggedText(pages);
    offlineResults.push({
      file: paper.file,
      classification: paper.classification,
      expectedRecords: paper.records.length,
      extracted: conductivityMockExtract(taggedText),
    });
    if (write && !listJobs("conductivity").some((job) => job.sourceId === sourceId)) {
      createJobs("conductivity", [{ filename: paper.file, text: taggedText, sourceId }]);
    }
  }

  let removedMockRecords = 0;
  let createdManualRecords = 0;
  let updatedManualRecords = 0;
  if (write) {
    kickDrain("conductivity");
    await waitForJobs(sourceIds);
    const mockIds = (listRecords("conductivity") as ConductivityRecord[])
      .filter((record) => record.sourceId && sourceIds.has(record.sourceId) && record.extraction?.source === "mock")
      .map((record) => record.id);
    if (mockIds.length) removedMockRecords = deleteRecords("conductivity", mockIds);

    const existingRecords = (listRecords("conductivity") as ConductivityRecord[]).filter((record) => !record.extraction);
    const existing = new Map(existingRecords.map((record) => [recordFingerprint(record), record]));
    const audited = audit.papers.flatMap((paper) => {
      const sourceId = sourceForAudit.get(paper.file);
      if (!sourceId) return [];
      return paper.records.map((fields) => ({ fields, draft: { ...ingest(fields), sourceId } }));
    });
    const newDrafts = audited.flatMap(({ fields, draft }) => {
      const comparable = { ...draft, id: "", status: "review" as const, createdAt: "" } as ConductivityRecord;
      const fingerprint = recordFingerprint(comparable);
      const current = existing.get(fingerprint);
      if (!current) {
        existing.set(fingerprint, comparable);
        return [draft];
      }
      const currentFields = toFields(current);
      const nextFields = { ...currentFields, ...fields };
      const result = updateRecord("conductivity", current.id, { fields: nextFields });
      if (result.error) throw new Error(`Could not update audited record ${current.id}: ${result.error}`);
      updatedManualRecords += 1;
      return [];
    });
    createdManualRecords = createRecords("conductivity", newDrafts, "review").length;
  }

  const jobs = write ? await waitForJobs(sourceIds) : [];
  const textPapers = offlineResults.filter((paper) => paper.classification === "text-values");
  const nonTextPapers = offlineResults.filter((paper) => paper.classification !== "text-values");
  const valueComparisons = offlineResults.map((paper) => {
    const expected = (auditByFile.get(paper.file)?.records ?? []).flatMap(propertyPoints);
    const extracted = paper.extracted.flatMap(propertyPoints);
    return { file: paper.file, expected, extracted, ...comparePropertyPoints(expected, extracted) };
  });
  const conditionComparisons = offlineResults.map((paper) => {
    const expectedRecords = auditByFile.get(paper.file)?.records ?? [];
    return { file: paper.file, ...compareConditionsForPaper(expectedRecords, paper.extracted) };
  });
  const expectedPropertyValues = valueComparisons.reduce((sum, paper) => sum + paper.expected.length, 0);
  const matchedPropertyValues = valueComparisons.reduce((sum, paper) => sum + paper.matches.length, 0);
  const extraExtractedValues = valueComparisons.reduce((sum, paper) => sum + paper.extra.length, 0);
  const expectedConditions = conditionComparisons.reduce((sum, paper) => sum + paper.expected.length, 0);
  const matchedConditions = conditionComparisons.reduce((sum, paper) => sum + paper.matched.length, 0);
  const extraConditions = conditionComparisons.reduce((sum, paper) => sum + paper.extra.length, 0);
  const report = {
    schemaVersion: 3,
    generatedAt: new Date().toISOString(),
    sourceCorpus: path.basename(root),
    mode: write ? "imported" : "dry-run",
    scope: "Compared deterministic Conductivity extraction against a manual paper audit. Figure-only values are excluded from text-extractor recall.",
    summary: {
      auditedPapers: audit.papers.length,
      uniqueAvailablePapers: unique.size,
      auditedAvailablePapers: offlineResults.length,
      unavailableAuditedPapers: unavailable.length,
      textValuePapers: textPapers.length,
      textValuePapersDetected: textPapers.filter((paper) => paper.extracted.length > 0).length,
      textValuePapersMissed: textPapers.filter((paper) => paper.extracted.length === 0).length,
      nonTextPapers: nonTextPapers.length,
      nonTextPapersCorrectlyEmpty: nonTextPapers.filter((paper) => paper.extracted.length === 0).length,
      nonTextFalsePositive: nonTextPapers.filter((paper) => paper.extracted.length > 0).length,
      figureOnlyPapers: offlineResults.filter((paper) => paper.classification === "figure-only").length,
      extractedCandidates: offlineResults.reduce((sum, paper) => sum + paper.extracted.length, 0),
      manuallyCuratedRecords: audit.papers.reduce((sum, paper) => sum + paper.records.length, 0),
      expectedPropertyValues,
      matchedPropertyValues,
      missedPropertyValues: expectedPropertyValues - matchedPropertyValues,
      extraExtractedValues,
      propertyValueRecall: expectedPropertyValues ? matchedPropertyValues / expectedPropertyValues : 1,
      propertyValuePrecision: matchedPropertyValues + extraExtractedValues ? matchedPropertyValues / (matchedPropertyValues + extraExtractedValues) : 1,
      expectedReportedConditions: expectedConditions,
      matchedReportedConditions: matchedConditions,
      missedReportedConditions: expectedConditions - matchedConditions,
      extraExtractedConditions: extraConditions,
      reportedConditionRecall: expectedConditions ? matchedConditions / expectedConditions : 1,
      reportedConditionPrecision: matchedConditions + extraConditions ? matchedConditions / (matchedConditions + extraConditions) : 1,
      sourcesUploaded: uploaded,
      sourcesReused: reused,
      manualRecordsCreated: createdManualRecords,
      manualRecordsUpdated: updatedManualRecords,
      inaccurateMockRecordsRemoved: removedMockRecords,
      jobs: jobs.reduce<Record<string, number>>((counts, job) => ({ ...counts, [job.status]: (counts[job.status] ?? 0) + 1 }), {}),
    },
    unavailable,
    papers: offlineResults.map((paper) => ({
      file: paper.file,
      classification: paper.classification,
      expectedManualRecords: paper.expectedRecords,
      extractedCandidateCount: paper.extracted.length,
      extractedProperties: [...new Set(paper.extracted.flatMap((record) => [
        record.conductivity && "conductivity",
        record.capacitance && "capacitance",
        record.electricField && "electricField",
        record.electrochemicalWindow && "electrochemicalWindow",
        record.chargeTransferResistance && "chargeTransferResistance",
        record.viscosity && "viscosity",
      ].filter(Boolean)))],
      valueComparison: (() => {
        const comparison = valueComparisons.find((item) => item.file === paper.file)!;
        return {
          expected: comparison.expected,
          matched: comparison.matches.map((match) => match.expected),
          missing: comparison.missing,
          extra: comparison.extra,
        };
      })(),
      conditionComparison: (() => {
        const comparison = conditionComparisons.find((item) => item.file === paper.file)!;
        return {
          expected: comparison.expected,
          matched: comparison.matched,
          missing: comparison.missing,
          extra: comparison.extra,
        };
      })(),
    })),
  };
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(report.summary, null, 2));
  if (unavailable.length) console.warn(`Unavailable: ${unavailable.join(", ")}`);
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
