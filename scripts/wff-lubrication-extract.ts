import crypto from "node:crypto";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { DomainDraft, ExtractionMetadata } from "../lib/domain";
import { createRecords, createSource, findSourceByDoi, listRecords } from "../lib/db";
import { extractRecords, isLiveExtractionEnabled, type ExtractResult } from "../lib/extract";
import { getModule } from "../lib/modules/registry.server";
import { pagesToTaggedText, pdfToPages } from "../lib/pdf";
import type { IonicRecord, SourceDoc } from "../lib/schema";
import { createSourceFromPdf } from "../lib/sources";

type CsvRecord = Record<string, string>;

export interface SourceJob {
  key: string;
  title: string;
  doi: string;
  filename: string;
  filePath: string;
  wffRows: number;
  filmRows: number;
  noFilmRows: number;
}

interface CliOptions {
  csvPath: string;
  sourcesDir: string;
  outputDir: string;
  cacheDir: string;
  keys?: Set<string>;
  limit?: number;
  force: boolean;
  writeOfficial: boolean;
}

interface SourceText {
  text: string;
  pageCount: number;
  charCount: number;
  sha256: string;
}

type ExtractionSource = ExtractResult["source"] | "error";

export interface CachedExtraction {
  key: string;
  title: string;
  doi: string;
  filename: string;
  filePath: string;
  extractedAt: string;
  extractionSource: ExtractionSource;
  model?: string;
  pageCount: number;
  charCount: number;
  sha256: string;
  quoteAudit: QuoteAudit;
  records: IonicRecord[];
  error?: string;
}

export interface OfficialSelection {
  drafts: DomainDraft<any, any>[];
  selected: {
    sourceKey: string;
    platformRecordId: string;
    fingerprint: string;
    draft: DomainDraft<any, any>;
  }[];
  selectedKeys: string[];
  skipped: {
    sourceKey: string;
    platformRecordId: string;
    reason: string;
  }[];
}

export interface QuoteAudit {
  totalQuotes: number;
  verifiedQuotes: number;
  missingQuotes: number;
}

interface ScoredMatch {
  record?: IonicRecord;
  score: number;
  cationMatch: "yes" | "no" | "unknown";
  anionMatch: "yes" | "no" | "unknown";
  surfaceMatch: "yes" | "no" | "unknown";
  cofDeltaAbs: number | null;
  potentialDeltaV: number | null;
  velocityDeltaUmS: number | null;
  temperatureDeltaK: number | null;
  hDeltaNm: number | null;
  cofMatch: "yes" | "no" | "unknown";
  potentialMatch: "yes" | "no" | "unknown";
  velocityMatch: "yes" | "no" | "unknown";
  temperatureMatch: "yes" | "no" | "unknown";
  hMatch: "yes" | "no" | "unknown";
  notes: string[];
}

const WFF_CSV = path.resolve(
  process.cwd(),
  "..",
  "Ioniclink",
  "backend",
  "data",
  "wff",
  "wff_lubrication_source_annotations.combined.csv"
);
const OUTPUT_DIR = path.dirname(WFF_CSV);
const SOURCES_DIR = path.resolve(process.cwd(), "Lubrication_sources");

export function parseCsvRecords(text: string): CsvRecord[] {
  const rows = parseCsvRows(text);
  if (!rows.length) return [];
  rows[0][0] = rows[0][0].replace(/^\uFEFF/, "");
  const header = rows[0];
  return rows
    .slice(1)
    .filter((row) => row.some((cell) => cell.trim()))
    .map((row) => {
      const out: CsvRecord = {};
      header.forEach((name, i) => {
        out[name] = row[i] ?? "";
      });
      return out;
    });
}

function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (ch !== "\r") {
      cell += ch;
    }
  }
  if (cell.length || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

export function stringifyCsvRows(rows: CsvRecord[]): string {
  if (!rows.length) return "";
  const headers = Array.from(
    rows.reduce((keys, row) => {
      Object.keys(row).forEach((key) => keys.add(key));
      return keys;
    }, new Set<string>())
  );
  return [headers, ...rows.map((row) => headers.map((key) => row[key] ?? ""))]
    .map((row) => row.map(escapeCsvCell).join(","))
    .join("\n");
}

function escapeCsvCell(value: string | number): string {
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function buildSourceJobs(opts: {
  wffRows: CsvRecord[];
  manifestRows: CsvRecord[];
  sourcesDir: string;
}): SourceJob[] {
  const manifest = new Map(opts.manifestRows.map((row) => [row.source_literature_key, row]));
  const byKey = new Map<string, CsvRecord[]>();
  for (const row of opts.wffRows) {
    const key = row.source_literature_key;
    if (!key) continue;
    const rows = byKey.get(key) ?? [];
    rows.push(row);
    byKey.set(key, rows);
  }

  return Array.from(byKey.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, rows]) => {
      const entry = manifest.get(key);
      if (!entry) throw new Error(`No manifest row for source_literature_key=${key}`);
      const filename = entry.new_filename;
      if (!filename) throw new Error(`Manifest row for ${key} has no new_filename`);
      return {
        key,
        title: entry.source_literature_title || rows[0]?.source_literature_title || key,
        doi: entry.source_literature_doi || rows[0]?.source_literature_doi || "",
        filename,
        filePath: path.join(opts.sourcesDir, filename),
        wffRows: rows.length,
        filmRows: rows.filter((row) => row.wff_dataset === "film").length,
        noFilmRows: rows.filter((row) => row.wff_dataset !== "film").length,
      };
    });
}

export function normalizeIonLabel(value: string | null | undefined): string {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\[\]{}()+\-_,\s]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function normalizeSurface(value: string | null | undefined): string {
  const compact = String(value ?? "")
    .toLowerCase()
    .replace(/highly oriented pyrolytic graphite/g, "hopg")
    .replace(/stainless\s+steel/g, "steel")
    .replace(/gold/g, "au")
    .replace(/silica/g, "sio2")
    .replace(/[^a-z0-9]/g, "");
  if (compact.includes("hopg")) return "hopg";
  if (compact.includes("graphite")) return "graphite";
  if (compact.includes("au111") || compact.includes("au")) return compact.includes("111") ? "au111" : "au";
  if (compact.includes("mica")) return "mica";
  if (compact.includes("steel")) return "steel";
  if (compact.includes("titanium")) return "titanium";
  return compact;
}

function surfacesMatch(a: string | null | undefined, b: string | null | undefined): "yes" | "no" | "unknown" {
  const aa = normalizeSurface(a);
  const bb = normalizeSurface(b);
  if (!aa || !bb) return "unknown";
  if (aa === bb) return "yes";
  if ((aa === "graphite" && bb === "hopg") || (aa === "hopg" && bb === "graphite")) return "yes";
  return aa.includes(bb) || bb.includes(aa) ? "yes" : "no";
}

function sameIon(a: string | null | undefined, b: string | null | undefined): "yes" | "no" | "unknown" {
  const aa = normalizeIonLabel(a);
  const bb = normalizeIonLabel(b);
  if (!aa || !bb) return "unknown";
  return aa === bb ? "yes" : "no";
}

export function reviewWffRows(opts: {
  wffRows: CsvRecord[];
  recordsByKey: Map<string, IonicRecord[]>;
}): CsvRecord[] {
  return opts.wffRows.map((row) => {
    const key = row.source_literature_key;
    const records = opts.recordsByKey.get(key) ?? [];
    if (!records.length) {
      return {
        ...pickReviewIdentity(row),
        review_status: "no_platform_record",
        matched_platform_record_id: "",
        score: "0",
        review_notes: "No platform extraction records were produced for this literature source.",
      };
    }

    const best = records
      .map((record) => scoreRecord(row, record))
      .sort((a, b) => b.score - a.score)[0];
    const reviewStatus = classifyMatch(best);
    return {
      ...pickReviewIdentity(row),
      review_status: reviewStatus,
      matched_platform_record_id: best.record?.id ?? "",
      score: formatNumber(best.score),
      platform_cation: best.record?.core.ionicLiquid.cation ?? "",
      platform_anion: best.record?.core.ionicLiquid.anion ?? "",
      platform_surface: best.record?.core.substrate ?? "",
      platform_cof: formatNullable(best.record?.core.cof),
      platform_potential_V: formatNullable(best.record?.extended.potential?.std),
      platform_velocity_um_s: formatNullable(
        best.record?.extended.velocity?.std == null ? null : best.record.extended.velocity.std * 1e6
      ),
      platform_temperature_K: formatNullable(best.record?.core.temperature?.std),
      platform_film_thickness_nm: formatNullable(
        best.record?.extended.filmThickness?.std == null ? null : best.record.extended.filmThickness.std * 1e9
      ),
      platform_confidence: formatNullable(best.record?.confidence),
      cation_match: best.cationMatch,
      anion_match: best.anionMatch,
      surface_match: best.surfaceMatch,
      cof_match: best.cofMatch,
      cof_delta_abs: formatNullable(best.cofDeltaAbs),
      potential_match: best.potentialMatch,
      potential_delta_V: formatNullable(best.potentialDeltaV),
      velocity_match: best.velocityMatch,
      velocity_delta_um_s: formatNullable(best.velocityDeltaUmS),
      temperature_match: best.temperatureMatch,
      temperature_delta_K: formatNullable(best.temperatureDeltaK),
      h_match: best.hMatch,
      h_delta_nm: formatNullable(best.hDeltaNm),
      review_notes: best.notes.join("; "),
    };
  });
}

function pickReviewIdentity(row: CsvRecord): CsvRecord {
  return {
    source_literature_key: row.source_literature_key ?? "",
    wff_dataset: row.wff_dataset ?? "",
    wff_source_file: row.wff_source_file ?? "",
    wff_row_number: row.wff_row_number ?? "",
    wff_cation: row.Cation ?? "",
    wff_anion: row.anion ?? "",
    wff_compound: row.compound ?? "",
    wff_surface: row.surface ?? "",
    wff_h_nm: row.h ?? "",
    wff_velocity_um_s: row.velocity ?? "",
    wff_potential_V: row.Potential ?? "",
    wff_temperature_K: row.T ?? "",
    wff_x_IL: row.x_IL ?? "",
    wff_cof_mu: row["μ"] ?? row.mu ?? "",
  };
}

function scoreRecord(row: CsvRecord, record: IonicRecord): ScoredMatch {
  const cationMatch = sameIon(row.Cation, record.core.ionicLiquid.cation);
  const anionMatch = sameIon(row.anion, record.core.ionicLiquid.anion);
  const surfaceMatch = surfacesMatch(row.surface, record.core.substrate);
  const wffCof = numeric(row["μ"] ?? row.mu);
  const recCof = record.core.cof;
  const cofDeltaAbs = wffCof != null && recCof != null ? Math.abs(wffCof - recCof) : null;
  const cofMatch = matchNumericDelta(cofDeltaAbs, wffCof, { abs: 0.01, rel: 0.25 });
  const wffPotential = numeric(row.Potential);
  const recPotential = record.extended.potential?.std ?? null;
  const potentialDeltaV = wffPotential != null && recPotential != null ? Math.abs(wffPotential - recPotential) : null;
  const potentialMatch = matchNumericDelta(potentialDeltaV, wffPotential, { abs: 0.05, rel: 0.05 });
  const wffVelocity = numeric(row.velocity);
  const recVelocityUmS = record.extended.velocity?.std == null ? null : record.extended.velocity.std * 1e6;
  const velocityDeltaUmS =
    wffVelocity != null && recVelocityUmS != null ? Math.abs(wffVelocity - recVelocityUmS) : null;
  const velocityMatch = matchNumericDelta(velocityDeltaUmS, wffVelocity, { abs: 1, rel: 0.15 });
  const wffTemperature = numeric(row.T);
  const recTemperature = record.core.temperature?.std ?? null;
  const temperatureDeltaK =
    wffTemperature != null && recTemperature != null ? Math.abs(wffTemperature - recTemperature) : null;
  const temperatureMatch = matchNumericDelta(temperatureDeltaK, wffTemperature, { abs: 5, rel: 0.02 });
  const wffH = numeric(row.h);
  const recH = record.extended.filmThickness?.std == null ? null : record.extended.filmThickness.std * 1e9;
  const hDeltaNm = wffH != null && recH != null ? Math.abs(wffH - recH) : null;
  const hMatch = matchNumericDelta(hDeltaNm, wffH, { abs: 0.5, rel: 0.25 });

  const notes: string[] = [];
  let score = 0;
  score += scoreTernary(cationMatch, 3, notes, "cation");
  score += scoreTernary(anionMatch, 3, notes, "anion");
  score += scoreTernary(surfaceMatch, 2, notes, "surface");
  score += scoreTernary(cofMatch, 3, notes, "cof");
  score += scoreTernary(potentialMatch, 2, notes, "potential");
  score += scoreTernary(velocityMatch, 2, notes, "velocity");
  score += scoreTernary(temperatureMatch, 1, notes, "temperature");
  score += scoreTernary(hMatch, 2, notes, "h/film thickness");
  return {
    record,
    score,
    cationMatch,
    anionMatch,
    surfaceMatch,
    cofDeltaAbs,
    potentialDeltaV,
    velocityDeltaUmS,
    temperatureDeltaK,
    hDeltaNm,
    cofMatch,
    potentialMatch,
    velocityMatch,
    temperatureMatch,
    hMatch,
    notes,
  };
}

function matchNumericDelta(
  delta: number | null,
  reference: number | null,
  tolerance: { abs: number; rel: number }
): "yes" | "no" | "unknown" {
  if (delta == null || reference == null) return "unknown";
  const allowed = Math.max(tolerance.abs, Math.abs(reference) * tolerance.rel);
  return delta <= allowed ? "yes" : "no";
}

function scoreTernary(
  match: "yes" | "no" | "unknown",
  points: number,
  notes: string[],
  label: string
): number {
  if (match === "yes") return points;
  if (match === "no") {
    notes.push(`${label} mismatch`);
    return -points;
  }
  notes.push(`${label} not available for comparison`);
  return 0;
}

function classifyMatch(match: ScoredMatch): string {
  const identityBad = [match.cationMatch, match.anionMatch, match.surfaceMatch].includes("no");
  const numericBad = [match.cofMatch, match.potentialMatch, match.velocityMatch].includes("no");
  if (!identityBad && !numericBad && match.score >= 8) return "matched";
  if (!identityBad && match.score >= 5) return "partial_match";
  return "needs_review";
}

export function verifyProvenanceQuotes(records: IonicRecord[], taggedText: string): QuoteAudit {
  const normalizedText = normalizeEvidenceText(taggedText);
  let totalQuotes = 0;
  let verifiedQuotes = 0;
  for (const record of records) {
    for (const prov of Object.values(record.provenance ?? {})) {
      const quote = prov.quote?.trim();
      if (!quote) continue;
      totalQuotes++;
      if (normalizedText.includes(normalizeEvidenceText(quote))) verifiedQuotes++;
    }
  }
  return {
    totalQuotes,
    verifiedQuotes,
    missingQuotes: totalQuotes - verifiedQuotes,
  };
}

function normalizeEvidenceText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

async function main() {
  loadEnvLocal(path.resolve(process.cwd(), ".env.local"));
  const options = parseArgs(process.argv.slice(2));
  await fs.mkdir(options.outputDir, { recursive: true });
  await fs.mkdir(options.cacheDir, { recursive: true });

  const [wffCsv, manifestCsv] = await Promise.all([
    fs.readFile(options.csvPath, "utf8"),
    fs.readFile(path.join(options.sourcesDir, "manifest.csv"), "utf8"),
  ]);
  const wffRows = parseCsvRecords(wffCsv);
  const manifestRows = parseCsvRecords(manifestCsv);
  let jobs = buildSourceJobs({ wffRows, manifestRows, sourcesDir: options.sourcesDir });
  if (options.keys) jobs = jobs.filter((job) => options.keys?.has(job.key));
  if (options.limit != null) jobs = jobs.slice(0, options.limit);
  if (!jobs.length) throw new Error("No source jobs selected.");

  console.log(
    `WFF rows=${wffRows.length}; selected sources=${jobs.length}; liveExtraction=${isLiveExtractionEnabled() ? "yes" : "no"}`
  );

  const extractions: CachedExtraction[] = [];
  for (const [i, job] of jobs.entries()) {
    console.log(`[${i + 1}/${jobs.length}] ${job.key}: ${job.filename}`);
    const cached = options.force ? null : await readCache(options.cacheDir, job.key);
    if (cached) {
      console.log(`  cache hit: ${cached.records.length} records`);
      extractions.push(cached);
      continue;
    }
    try {
      const extraction = await extractSource(job);
      extractions.push(extraction);
      await writeCache(options.cacheDir, extraction);
      console.log(
        `  extracted: ${extraction.records.length} records; source=${extraction.extractionSource}; quotes=${extraction.quoteAudit.verifiedQuotes}/${extraction.quoteAudit.totalQuotes}`
      );
    } catch (error) {
      const extraction = failedExtraction(job, error);
      extractions.push(extraction);
      console.error(`  failed after retries: ${extraction.error}`);
    }
  }

  const output = await writeOutputs({ options, wffRows, jobs, extractions });
  if (options.writeOfficial) {
    const official = await writeOfficialDatabase({
      options,
      extractions,
      reviewRows: output.reviewRows,
    });
    console.log(
      `Official import: created=${official.created.length}; skipped=${official.skipped.length}; audit=${official.auditPath}`
    );
  }
}

async function extractSource(job: SourceJob): Promise<CachedExtraction> {
  const sourceText = await readSourceText(job.filePath);
  const result = await withRetries(
    `extract ${job.key}`,
    () => extractRecords("tribology", sourceText.text, job.key),
    { retries: 3, baseDelayMs: 5_000 }
  );
  const records = stampRecords(job, result.records as DomainDraft<any, any>[]);
  const quoteAudit = verifyProvenanceQuotes(records, sourceText.text);
  return {
    key: job.key,
    title: job.title,
    doi: job.doi,
    filename: job.filename,
    filePath: job.filePath,
    extractedAt: new Date().toISOString(),
    extractionSource: result.source,
    model: result.model,
    pageCount: sourceText.pageCount,
    charCount: sourceText.charCount,
    sha256: sourceText.sha256,
    quoteAudit,
    records,
  };
}

function failedExtraction(job: SourceJob, error: unknown): CachedExtraction {
  return {
    key: job.key,
    title: job.title,
    doi: job.doi,
    filename: job.filename,
    filePath: job.filePath,
    extractedAt: new Date().toISOString(),
    extractionSource: "error",
    pageCount: 0,
    charCount: 0,
    sha256: "",
    quoteAudit: { totalQuotes: 0, verifiedQuotes: 0, missingQuotes: 0 },
    records: [],
    error: errorToMessage(error),
  };
}

async function readSourceText(filePath: string): Promise<SourceText> {
  const data = await fs.readFile(filePath);
  const sha256 = crypto.createHash("sha256").update(data).digest("hex");
  if (/\.pdf$/i.test(filePath)) {
    const pages = await pdfToPages(new Uint8Array(data));
    const text = pagesToTaggedText(pages);
    return { text, pageCount: pages.length, charCount: text.length, sha256 };
  }
  if (/\.html?$/i.test(filePath)) {
    const text = `[PAGE 1]\n${htmlToText(data.toString("utf8"))}`;
    return { text, pageCount: 1, charCount: text.length, sha256 };
  }
  const text = `[PAGE 1]\n${data.toString("utf8")}`;
  return { text, pageCount: 1, charCount: text.length, sha256 };
}

function htmlToText(html: string): string {
  return decodeHtmlEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, "\n")
      .replace(/<style[\s\S]*?<\/style>/gi, "\n")
      .replace(/<[^>]+>/g, "\n")
      .replace(/\s+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
  ).trim();
}

function decodeHtmlEntities(value: string): string {
  const named: Record<string, string> = {
    amp: "&",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
    apos: "'",
    mu: "μ",
    micro: "μ",
    deg: "°",
  };
  return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (_, token: string) => {
    if (token[0] === "#") {
      const code = token[1]?.toLowerCase() === "x" ? parseInt(token.slice(2), 16) : parseInt(token.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : "";
    }
    return named[token] ?? `&${token};`;
  });
}

function stampRecords(job: SourceJob, drafts: DomainDraft<any, any>[]): IonicRecord[] {
  return drafts.map((draft, i) => ({
    ...draft,
    id: `platform:${job.key}:${String(i + 1).padStart(3, "0")}`,
    status: "review",
    createdAt: new Date().toISOString(),
    sourceId: job.key,
  })) as IonicRecord[];
}

async function writeOutputs(opts: {
  options: CliOptions;
  wffRows: CsvRecord[];
  jobs: SourceJob[];
  extractions: CachedExtraction[];
}): Promise<{ reviewRows: CsvRecord[] }> {
  const recordsByKey = new Map(opts.extractions.map((extraction) => [extraction.key, extraction.records]));
  const reviewRows = reviewWffRows({ wffRows: opts.wffRows, recordsByKey });
  const extractionRows = buildExtractionRows(opts.extractions);
  const summaryRows = buildSummaryRows(opts.jobs, opts.extractions, reviewRows);
  const summaryMarkdown = buildSummaryMarkdown({
    wffRows: opts.wffRows,
    jobs: opts.jobs,
    extractions: opts.extractions,
    reviewRows,
  });

  await fs.writeFile(
    path.join(opts.options.outputDir, "wff_lubrication_platform_extractions.csv"),
    stringifyCsvRows(extractionRows)
  );
  await fs.writeFile(
    path.join(opts.options.outputDir, "wff_lubrication_platform_review.csv"),
    stringifyCsvRows(reviewRows)
  );
  await fs.writeFile(
    path.join(opts.options.outputDir, "wff_lubrication_platform_extraction_summary.csv"),
    stringifyCsvRows(summaryRows)
  );
  await fs.writeFile(
    path.join(opts.options.outputDir, "wff_lubrication_platform_review_summary.md"),
    summaryMarkdown
  );
  return { reviewRows };
}

export function selectOfficialRecordDrafts(opts: {
  extractions: CachedExtraction[];
  reviewRows: CsvRecord[];
  existingOfficialRecords: IonicRecord[];
  sourceIdsByKey: Map<string, string>;
}): OfficialSelection {
  const mod = getModule("tribology");
  const matchedPlatformIds = new Set(
    opts.reviewRows
      .filter((row) => row.review_status === "matched" && row.matched_platform_record_id)
      .map((row) => row.matched_platform_record_id)
  );
  const existing = new Set(opts.existingOfficialRecords.map(officialFingerprint));
  const seen = new Set<string>();
  const selected: OfficialSelection["selected"] = [];
  const skipped: OfficialSelection["skipped"] = [];

  for (const extraction of opts.extractions) {
    for (const record of extraction.records) {
      if (!matchedPlatformIds.has(record.id)) continue;
      const fingerprint = officialFingerprint(record);
      const skipBase = { sourceKey: extraction.key, platformRecordId: record.id };
      if (!mod.coreCompleteness(record).complete) {
        skipped.push({ ...skipBase, reason: "incomplete_core_fields" });
        continue;
      }
      if (existing.has(fingerprint)) {
        skipped.push({ ...skipBase, reason: "duplicate_existing_official" });
        continue;
      }
      if (seen.has(fingerprint)) {
        skipped.push({ ...skipBase, reason: "duplicate_current_import" });
        continue;
      }
      const extractionMetadata: ExtractionMetadata | undefined =
        record.extraction ??
        (!extraction.extractionSource || extraction.extractionSource === "error"
          ? undefined
          : {
              source: extraction.extractionSource,
              ...(extraction.model ? { model: extraction.model } : {}),
            });
      if (!extractionMetadata) {
        skipped.push({ ...skipBase, reason: "missing_extraction_provenance" });
        continue;
      }
      seen.add(fingerprint);
      const draft = recordToDraft(
        record,
        opts.sourceIdsByKey.get(extraction.key) ?? record.sourceId ?? extraction.key,
        extractionMetadata
      );
      selected.push({
        sourceKey: extraction.key,
        platformRecordId: record.id,
        fingerprint,
        draft,
      });
    }
  }

  return {
    drafts: selected.map((entry) => entry.draft),
    selected,
    selectedKeys: Array.from(new Set(selected.map((entry) => entry.sourceKey))),
    skipped,
  };
}

function recordToDraft(
  record: IonicRecord,
  sourceId: string,
  extraction: ExtractionMetadata
): DomainDraft<any, any> {
  const { id: _id, status: _status, createdAt: _createdAt, ...draft } = record;
  return { ...draft, sourceId, extraction: record.extraction ?? extraction };
}

function officialFingerprint(record: IonicRecord): string {
  const parts = [
    normalizeText(record.paper.doi || record.paper.title),
    normalizeIonLabel(record.core.ionicLiquid.cation),
    normalizeIonLabel(record.core.ionicLiquid.anion),
    normalizeSurface(record.core.substrate),
    fpNumber(record.core.cof),
    fpNumber(record.core.temperature?.std),
    fpNumber(record.core.load?.std),
    fpNumber(record.extended.potential?.std),
    fpNumber(record.extended.velocity?.std),
    fpNumber(record.extended.filmThickness?.std),
    record.extended.filmLayers == null ? "" : String(record.extended.filmLayers),
  ];
  return parts.join("|");
}

function normalizeText(value: string | null | undefined): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function fpNumber(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "";
  return value.toPrecision(8);
}

async function writeOfficialDatabase(opts: {
  options: CliOptions;
  extractions: CachedExtraction[];
  reviewRows: CsvRecord[];
}): Promise<{ created: IonicRecord[]; skipped: OfficialSelection["skipped"]; auditPath: string }> {
  const existingOfficialRecords = listRecords("tribology", { status: "official" }) as IonicRecord[];
  const preliminary = selectOfficialRecordDrafts({
    extractions: opts.extractions,
    reviewRows: opts.reviewRows,
    existingOfficialRecords,
    sourceIdsByKey: new Map(),
  });
  const sourceIdsByKey = await ensureOfficialSources(opts.extractions, new Set(preliminary.selectedKeys));
  const selection = selectOfficialRecordDrafts({
    extractions: opts.extractions,
    reviewRows: opts.reviewRows,
    existingOfficialRecords,
    sourceIdsByKey,
  });
  const created = createRecords("tribology", selection.drafts, "official") as IonicRecord[];
  const auditRows: CsvRecord[] = [
    ...selection.selected.map((entry, i) => ({
      official_import_status: "created",
      source_literature_key: entry.sourceKey,
      platform_record_id: entry.platformRecordId,
      official_record_id: created[i]?.id ?? "",
      official_source_id: entry.draft.sourceId ?? "",
      fingerprint: entry.fingerprint,
      paper_title: entry.draft.paper.title,
      cation: entry.draft.core.ionicLiquid.cation,
      anion: entry.draft.core.ionicLiquid.anion,
      substrate: entry.draft.core.substrate,
      cof: formatNullable(entry.draft.core.cof),
    })),
    ...selection.skipped.map((entry) => ({
      official_import_status: "skipped",
      source_literature_key: entry.sourceKey,
      platform_record_id: entry.platformRecordId,
      official_record_id: "",
      official_source_id: sourceIdsByKey.get(entry.sourceKey) ?? "",
      fingerprint: "",
      paper_title: "",
      cation: "",
      anion: "",
      substrate: "",
      cof: "",
      reason: entry.reason,
    })),
  ];
  const auditPath = path.join(opts.options.outputDir, "wff_lubrication_official_import.csv");
  await fs.writeFile(auditPath, stringifyCsvRows(auditRows));
  return { created, skipped: selection.skipped, auditPath };
}

async function ensureOfficialSources(
  extractions: CachedExtraction[],
  neededKeys: Set<string>
): Promise<Map<string, string>> {
  const sourceIdsByKey = new Map<string, string>();
  for (const extraction of extractions) {
    if (!neededKeys.has(extraction.key)) continue;
    const existing = extraction.doi ? findSourceByDoi("tribology", extraction.doi) : null;
    if (existing) {
      sourceIdsByKey.set(extraction.key, existing.id);
      continue;
    }
    const bytes = await fs.readFile(extraction.filePath);
    if (/\.pdf$/i.test(extraction.filePath)) {
      const pages = await pdfToPages(new Uint8Array(bytes));
      const source = await createSourceFromPdf("tribology", extraction.filename, new Uint8Array(bytes), pages);
      sourceIdsByKey.set(extraction.key, source.id);
      continue;
    }
    const sourceId = crypto.randomUUID();
    const pages = [{ page: 1, text: htmlToText(bytes.toString("utf8")) }];
    const doc: SourceDoc = {
      id: sourceId,
      filename: extraction.filename,
      pageCount: 1,
      createdAt: new Date().toISOString(),
      pages,
      ...(extraction.doi ? { doi: extraction.doi } : {}),
    };
    createSource("tribology", doc);
    sourceIdsByKey.set(extraction.key, sourceId);
  }
  return sourceIdsByKey;
}

function buildExtractionRows(extractions: CachedExtraction[]): CsvRecord[] {
  const mod = getModule("tribology");
  const rows: CsvRecord[] = [];
  for (const extraction of extractions) {
    for (const [i, record] of extraction.records.entries()) {
      const completeness = mod.coreCompleteness(record);
      const csvRow = mod.csvRow(record);
      const base: CsvRecord = {
        source_literature_key: extraction.key,
        source_filename: extraction.filename,
        platform_record_index: String(i + 1),
        extraction_source: extraction.extractionSource,
        extraction_model: extraction.model ?? "",
        source_page_count: String(extraction.pageCount),
        source_text_chars: String(extraction.charCount),
        source_sha256: extraction.sha256,
        core_complete: completeness.complete ? "yes" : "no",
        missing_core_fields: completeness.missing.join("; "),
        quote_total: String(extraction.quoteAudit.totalQuotes),
        quote_verified: String(extraction.quoteAudit.verifiedQuotes),
        quote_missing: String(extraction.quoteAudit.missingQuotes),
        extraction_error: extraction.error ?? "",
      };
      mod.csvHeaders.forEach((header, index) => {
        base[`platform_${header}`] = String(csvRow[index] ?? "");
      });
      rows.push(base);
    }
    if (!extraction.records.length) {
      rows.push({
        source_literature_key: extraction.key,
        source_filename: extraction.filename,
        platform_record_index: "",
        extraction_source: extraction.extractionSource,
        extraction_model: extraction.model ?? "",
        source_page_count: String(extraction.pageCount),
        source_text_chars: String(extraction.charCount),
        source_sha256: extraction.sha256,
        core_complete: "no",
        missing_core_fields: "no records extracted",
        quote_total: "0",
        quote_verified: "0",
        quote_missing: "0",
        extraction_error: extraction.error ?? "",
      });
    }
  }
  return rows;
}

function buildSummaryRows(
  jobs: SourceJob[],
  extractions: CachedExtraction[],
  reviewRows: CsvRecord[]
): CsvRecord[] {
  const byExtraction = new Map(extractions.map((entry) => [entry.key, entry]));
  return jobs.map((job) => {
    const extraction = byExtraction.get(job.key);
    const sourceReviewRows = reviewRows.filter((row) => row.source_literature_key === job.key);
    const statusCounts = countBy(sourceReviewRows, (row) => row.review_status);
    const complete = extraction?.records.filter((record) => getModule("tribology").coreCompleteness(record).complete).length ?? 0;
    return {
      source_literature_key: job.key,
      title: job.title,
      doi: job.doi,
      filename: job.filename,
      wff_rows: String(job.wffRows),
      film_rows: String(job.filmRows),
      no_film_rows: String(job.noFilmRows),
      platform_records: String(extraction?.records.length ?? 0),
      platform_core_complete_records: String(complete),
      extraction_source: extraction?.extractionSource ?? "",
      extraction_model: extraction?.model ?? "",
      source_pages: String(extraction?.pageCount ?? ""),
      source_text_chars: String(extraction?.charCount ?? ""),
      quote_total: String(extraction?.quoteAudit.totalQuotes ?? 0),
      quote_verified: String(extraction?.quoteAudit.verifiedQuotes ?? 0),
      quote_missing: String(extraction?.quoteAudit.missingQuotes ?? 0),
      extraction_error: extraction?.error ?? "",
      wff_matched_rows: String(statusCounts.get("matched") ?? 0),
      wff_partial_match_rows: String(statusCounts.get("partial_match") ?? 0),
      wff_needs_review_rows: String(statusCounts.get("needs_review") ?? 0),
      wff_no_platform_record_rows: String(statusCounts.get("no_platform_record") ?? 0),
    };
  });
}

function buildSummaryMarkdown(opts: {
  wffRows: CsvRecord[];
  jobs: SourceJob[];
  extractions: CachedExtraction[];
  reviewRows: CsvRecord[];
}): string {
  const totalRecords = opts.extractions.reduce((sum, extraction) => sum + extraction.records.length, 0);
  const liveSources = countBy(opts.extractions, (entry) => entry.extractionSource);
  const statuses = countBy(opts.reviewRows, (row) => row.review_status);
  const quoteTotal = opts.extractions.reduce((sum, entry) => sum + entry.quoteAudit.totalQuotes, 0);
  const quoteVerified = opts.extractions.reduce((sum, entry) => sum + entry.quoteAudit.verifiedQuotes, 0);
  const quoteRate = quoteTotal ? `${((quoteVerified / quoteTotal) * 100).toFixed(1)}%` : "n/a";
  const generatedAt = new Date().toISOString();

  const sourceLines = opts.jobs
    .map((job) => {
      const extraction = opts.extractions.find((entry) => entry.key === job.key);
      const rows = opts.reviewRows.filter((row) => row.source_literature_key === job.key);
      const statusCounts = countBy(rows, (row) => row.review_status);
      return `| ${job.key} | ${job.wffRows} | ${extraction?.records.length ?? 0} | ${
        statusCounts.get("matched") ?? 0
      } | ${statusCounts.get("partial_match") ?? 0} | ${statusCounts.get("needs_review") ?? 0} | ${
        statusCounts.get("no_platform_record") ?? 0
      } |`;
    })
    .join("\n");

  return [
    "# WFF Lubrication Platform Extraction Review",
    "",
    `Generated: ${generatedAt}`,
    "",
    "## Inputs",
    "",
    `- WFF rows: ${opts.wffRows.length}`,
    `- Literature sources selected: ${opts.jobs.length}`,
    `- Platform domain/module: tribology`,
    `- Extraction sources used: ${formatMap(liveSources)}`,
    "",
    "## Outputs",
    "",
    "- wff_lubrication_platform_extractions.csv",
    "- wff_lubrication_platform_review.csv",
    "- wff_lubrication_platform_extraction_summary.csv",
    "- wff_lubrication_platform_review_summary.md",
    "",
    "## Review Summary",
    "",
    `- Platform records extracted: ${totalRecords}`,
    `- WFF row review statuses: ${formatMap(statuses)}`,
    `- Provenance quote verification: ${quoteVerified}/${quoteTotal} (${quoteRate})`,
    "",
    "## Source Breakdown",
    "",
    "| source_literature_key | WFF rows | platform records | matched | partial | needs review | no record |",
    "|---|---:|---:|---:|---:|---:|---:|",
    sourceLines,
    "",
    "## Review Notes",
    "",
    "- `matched` means the best platform record agreed with WFF identity fields and available numeric conditions within tolerance.",
    "- `partial_match` keeps likely same-system candidates where platform output lacked or disagreed with some numeric fields.",
    "- `needs_review` marks rows with identity or key numeric mismatches.",
    "- `no_platform_record` means the platform extractor returned no candidate for that source.",
    "",
  ].join("\n");
}

function countBy<T>(items: T[], keyFn: (item: T) => string | undefined): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) {
    const key = keyFn(item) || "";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function formatMap(map: Map<string, number>): string {
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key || "unknown"}=${value}`)
    .join(", ");
}

async function readCache(cacheDir: string, key: string): Promise<CachedExtraction | null> {
  const file = path.join(cacheDir, `${key}.json`);
  if (!fsSync.existsSync(file)) return null;
  return JSON.parse(await fs.readFile(file, "utf8")) as CachedExtraction;
}

async function writeCache(cacheDir: string, extraction: CachedExtraction): Promise<void> {
  await fs.writeFile(path.join(cacheDir, `${extraction.key}.json`), JSON.stringify(extraction, null, 2));
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    csvPath: WFF_CSV,
    sourcesDir: SOURCES_DIR,
    outputDir: OUTPUT_DIR,
    cacheDir: path.join(OUTPUT_DIR, "wff_lubrication_platform_cache"),
    force: false,
    writeOfficial: false,
  };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--force") options.force = true;
    else if (arg === "--write-official") options.writeOfficial = true;
    else if (arg === "--csv") options.csvPath = path.resolve(args[++i]);
    else if (arg === "--sources") options.sourcesDir = path.resolve(args[++i]);
    else if (arg === "--out") options.outputDir = path.resolve(args[++i]);
    else if (arg === "--cache") options.cacheDir = path.resolve(args[++i]);
    else if (arg === "--limit") options.limit = Number(args[++i]);
    else if (arg === "--keys") options.keys = new Set(args[++i].split(",").map((s) => s.trim()).filter(Boolean));
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function loadEnvLocal(filePath: string): void {
  if (!fsSync.existsSync(filePath)) return;
  const lines = fsSync.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const key = match[1];
    if (process.env[key]) continue;
    process.env[key] = unquoteEnvValue(match[2].trim());
  }
}

export async function withRetries<T>(
  label: string,
  operation: () => Promise<T>,
  opts: { retries?: number; baseDelayMs?: number } = {}
): Promise<T> {
  const retries = opts.retries ?? 3;
  const baseDelayMs = opts.baseDelayMs ?? 1_000;
  let lastError: unknown;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt >= retries) break;
      const delayMs = baseDelayMs * attempt;
      console.warn(
        `${label} failed on attempt ${attempt}/${retries}: ${errorToMessage(error)}; retrying in ${delayMs} ms`
      );
      await sleep(delayMs);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(errorToMessage(lastError));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorToMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function unquoteEnvValue(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function numeric(value: string | number | null | undefined): number | null {
  if (value == null || value === "") return null;
  const n = Number(String(value).replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : null;
}

function formatNullable(value: number | string | null | undefined): string {
  if (value == null || value === "") return "";
  return typeof value === "number" ? formatNumber(value) : String(value);
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return "";
  return Math.abs(value) >= 1000 || (Math.abs(value) > 0 && Math.abs(value) < 0.001)
    ? value.toExponential(6)
    : Number(value.toFixed(8)).toString();
}

const thisFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === thisFile) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
