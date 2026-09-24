import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextRequest } from "next/server";
import { POST } from "../app/api/afm/digitize/route";
import { createTestAppSession } from "../lib/auth.test-helpers";
import { extractDoiFromPages } from "../lib/doi";
import { pdfToPages } from "../lib/pdf";

const AFM_SIGNAL = /(?:atomic\s+force\s+microscop|\bAFM\b|force[-\s]?(?:distance|separation|curve)|solvation\s+force|normal\s+force|surface\s+force|layering\s+force)/gi;
const MAX_UPLOAD_BYTES = 35 * 1024 * 1024;

interface IndexedPdf {
  file: string;
  relativePath: string;
  bytes: Buffer;
  sha256: string;
  title: string;
  doi: string | null;
  pages: number;
  signal: number;
  signalPages: number[];
}

interface AuditCandidate {
  id: string;
  page: number | null;
  pageLabel: string;
  figureLabel: string | null;
  sourceFigure: { kind: string; crop: { left: number; top: number; right: number; bottom: number } | null };
  panel: { label: string; figureLabel: string } | null;
  analysis: {
    normalizedPoints: unknown[];
    segmentStarts: number[];
    traceColor: { hex: string } | null;
    confidence: number;
    axisConfidence: number;
    traceConfidence: number;
    coverage: number;
    quality: string;
    warnings: string[];
    traceMode?: string;
  };
  axisCalibration?: { status: string; method: string; confidence: number; axes: unknown; evidence: string[] };
}

interface DigitizePayload {
  sourceName: string;
  totalPages: number;
  matchedPaper: { doi: string; curveIds: string[] } | null;
  axisCalibration: { status: string; method: string; confidence: number; axes: unknown; evidence: string[] };
  experimentalMetadata?: unknown;
  candidates: AuditCandidate[];
  error?: string;
}

function compact(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function countSignal(text: string) {
  return [...text.matchAll(AFM_SIGNAL)].length;
}

async function findPdfs(root: string): Promise<string[]> {
  const found: string[] = [];
  async function walk(dir: string) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const target = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(target);
      else if (entry.isFile() && /\.pdf$/i.test(entry.name)) found.push(target);
    }
  }
  await walk(root);
  return found.sort((a, b) => a.localeCompare(b));
}

async function indexPdf(root: string, file: string): Promise<IndexedPdf | null> {
  const details = await stat(file);
  if (details.size <= 0 || details.size > MAX_UPLOAD_BYTES) return null;
  const bytes = await readFile(file);
  const pages = await pdfToPages(new Uint8Array(bytes));
  const pageSignals = pages.map((page) => ({ page: page.page, score: countSignal(page.text) }));
  const lines = pages.flatMap((page) => page.text.split("\n")).map(compact);
  const title = lines.find((line) => line.length >= 24 && line.length <= 220) ?? path.basename(file, ".pdf");
  return {
    file,
    relativePath: path.relative(root, file),
    bytes,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    title,
    doi: extractDoiFromPages(pages),
    pages: pages.length,
    signal: pageSignals.reduce((sum, item) => sum + item.score, 0),
    signalPages: pageSignals.filter((item) => item.score > 0).sort((a, b) => b.score - a.score).map((item) => item.page),
  };
}

async function main() {
  const root = path.resolve(process.argv[2] || "");
  const output = path.resolve(process.argv[3] || "");
  const limit = Number(process.argv[4] || 10);
  if (!process.argv[2] || !process.argv[3] || !Number.isInteger(limit) || limit < 1) {
    throw new Error("Usage: tsx scripts/audit-afm-pdf-uploads.ts <corpus-root> <output-json> [limit]");
  }

  console.log(`Indexing PDF corpus: ${root}`);
  const unique = new Map<string, IndexedPdf>();
  for (const file of await findPdfs(root)) {
    try {
      const indexed = await indexPdf(root, file);
      if (indexed && !unique.has(indexed.sha256)) unique.set(indexed.sha256, indexed);
    } catch (error) {
      console.warn(`Index skipped: ${path.relative(root, file)} (${error instanceof Error ? error.message : String(error)})`);
    }
  }

  const selected = [...unique.values()]
    .filter((paper) => paper.signal > 0)
    .sort((a, b) => b.signal - a.signal || a.relativePath.localeCompare(b.relativePath))
    .slice(0, limit);
  console.log(`Selected ${selected.length} signal-positive PDFs from ${unique.size} unique readable PDFs.`);

  const { cookie } = await createTestAppSession();
  const records = [];
  for (let index = 0; index < selected.length; index += 1) {
    const paper = selected[index];
    console.log(`[${index + 1}/${selected.length}] ${paper.relativePath} · signal ${paper.signal}`);
    const bytes = paper.bytes.buffer.slice(paper.bytes.byteOffset, paper.bytes.byteOffset + paper.bytes.byteLength) as ArrayBuffer;
    const form = new FormData();
    form.set("file", new File([bytes], path.basename(paper.file), { type: "application/pdf" }));
    try {
      const response = await POST(new NextRequest("http://localhost/api/afm/digitize", {
        method: "POST",
        headers: { cookie, origin: "http://localhost" },
        body: form,
      }));
      const payload = await response.json() as DigitizePayload;
      records.push({
        relativePath: paper.relativePath,
        title: paper.title,
        doi: paper.doi,
        pageCount: paper.pages,
        textualAfmSignal: paper.signal,
        signalPages: paper.signalPages,
        httpStatus: response.status,
        detected: response.status === 200 && payload.candidates?.length > 0,
        error: response.status === 200 ? null : payload.error ?? `HTTP ${response.status}`,
        matchedPaper: payload.matchedPaper ?? null,
        axisCalibration: payload.axisCalibration ?? null,
        experimentalMetadata: payload.experimentalMetadata ?? null,
        candidates: (payload.candidates ?? []).map((candidate) => ({
          id: candidate.id,
          page: candidate.page,
          pageLabel: candidate.pageLabel,
          figureLabel: candidate.figureLabel,
          sourceKind: candidate.sourceFigure.kind,
          crop: candidate.sourceFigure.crop,
          panel: candidate.panel,
          pointCount: candidate.analysis.normalizedPoints.length,
          segmentCount: candidate.analysis.segmentStarts.length,
          traceColor: candidate.analysis.traceColor?.hex ?? null,
          confidence: candidate.analysis.confidence,
          axisConfidence: candidate.analysis.axisConfidence,
          traceConfidence: candidate.analysis.traceConfidence,
          coverage: candidate.analysis.coverage,
          quality: candidate.analysis.quality,
          warnings: candidate.analysis.warnings,
          traceMode: candidate.analysis.traceMode ?? null,
          axisCalibration: candidate.axisCalibration ?? null,
        })),
      });
    } catch (error) {
      records.push({
        relativePath: paper.relativePath,
        title: paper.title,
        doi: paper.doi,
        pageCount: paper.pages,
        textualAfmSignal: paper.signal,
        signalPages: paper.signalPages,
        httpStatus: 500,
        detected: false,
        error: error instanceof Error ? error.message : String(error),
        matchedPaper: null,
        axisCalibration: null,
        candidates: [],
      });
    }
  }

  const detectedRecords = records.filter((record) => record.detected);
  const candidateCount = detectedRecords.reduce((sum, record) => sum + record.candidates.length, 0);
  const summary = {
    uniqueReadablePdfs: unique.size,
    afmSignalPositivePdfs: [...unique.values()].filter((paper) => paper.signal > 0).length,
    evaluated: records.length,
    detectedPdfs: detectedRecords.length,
    rejectedOrFailedPdfs: records.length - detectedRecords.length,
    candidateCurves: candidateCount,
    autoCalibratedPdfs: detectedRecords.filter((record) => record.axisCalibration?.status === "auto-calibrated").length,
    relativeOnlyPdfs: detectedRecords.filter((record) => record.axisCalibration?.status === "relative-only").length,
    nonBlueCandidates: detectedRecords.flatMap((record) => record.candidates).filter((candidate) => {
      if (!candidate.traceColor) return true;
      const hex = candidate.traceColor.slice(1);
      const r = Number.parseInt(hex.slice(0, 2), 16);
      const g = Number.parseInt(hex.slice(2, 4), 16);
      const b = Number.parseInt(hex.slice(4, 6), 16);
      return !(b > r * 1.1 && b > g * 1.05);
    }).length,
  };

  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify({ generatedAt: new Date().toISOString(), root, selection: "top textual AFM signal, SHA-256 deduplicated", summary, records }, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(summary, null, 2));
  console.log(`Audit written to ${output}`);
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
