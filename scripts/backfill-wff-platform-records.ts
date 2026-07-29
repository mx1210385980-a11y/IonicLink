import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { createRecords, findSourceByDoi, listRecords } from "../lib/db";
import { toFields } from "../lib/ingest";
import { getModule } from "../lib/modules/registry.server";
import { createSourceFromPdf } from "../lib/sources";
import type { DomainDraft, ExtractionMetadata, ExtractionSource } from "../lib/domain";
import type { IonicRecord } from "../lib/schema";

type CachedExtraction = {
  key: string;
  title: string;
  doi?: string;
  filename: string;
  filePath: string;
  extractionSource?: ExtractionSource | "error";
  model?: string;
  records: IonicRecord[];
};

type ManifestRow = {
  source_literature_key: string;
  source_literature_title: string;
  source_literature_doi: string;
  new_filename: string;
  new_abs_path: string;
};

type CandidateAuditRow = {
  key: string;
  id: string;
  title: string;
  method?: string;
  scale?: string;
  velocityRaw?: string;
  velocityStd?: number | null;
  velocitySource?: string;
  scanRate?: string;
  scanSize?: string;
};

const DEFAULT_CACHE_DIR = path.resolve(
  process.cwd(),
  "..",
  "Ioniclink",
  "backend",
  "data",
  "wff",
  "wff_lubrication_platform_cache"
);
const DEFAULT_MANIFEST = path.resolve(process.cwd(), "Lubrication_sources", "manifest.csv");

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
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
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
  row.push(cell);
  rows.push(row);
  return rows.filter((r) => r.some((c) => c.trim()));
}

function parseManifest(filePath: string): Map<string, ManifestRow> {
  const rows = parseCsvRows(fs.readFileSync(filePath, "utf8"));
  rows[0][0] = rows[0][0].replace(/^\uFEFF/, "");
  const header = rows[0];
  const out = new Map<string, ManifestRow>();
  for (const row of rows.slice(1)) {
    const rec: Record<string, string> = {};
    header.forEach((key, i) => {
      rec[key] = row[i] ?? "";
    });
    const key = rec.source_literature_key;
    if (!key) continue;
    out.set(key, rec as ManifestRow);
  }
  return out;
}

function fpNumber(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "";
  return value.toPrecision(8);
}

function normalizeText(value: string | null | undefined): string {
  return String(value ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

function normalizeIonLabel(value: string | null | undefined): string {
  return normalizeText(value).replace(/[\[\]\s,+-]/g, "");
}

function fingerprint(record: IonicRecord): string {
  return [
    normalizeText(record.paper.doi || record.paper.title),
    normalizeIonLabel(record.core.ionicLiquid.cation),
    normalizeIonLabel(record.core.ionicLiquid.anion),
    normalizeText(record.core.substrate),
    fpNumber(record.core.cof),
    fpNumber(record.core.temperature?.std),
    fpNumber(record.core.load?.std),
    fpNumber(record.extended.potential?.std),
    fpNumber(record.extended.velocity?.std),
    fpNumber(record.extended.filmThickness?.std),
    record.extended.filmLayers == null ? "" : String(record.extended.filmLayers),
  ].join("|");
}

function isCoreComplete(record: IonicRecord): boolean {
  return Boolean(
    record.core.ionicLiquid.cation &&
      record.core.ionicLiquid.anion &&
      record.core.substrate &&
      record.core.temperature &&
      record.core.load &&
      record.core.cof != null
  );
}

function cacheExtractionMetadata(
  extraction: CachedExtraction,
  record: IonicRecord
): ExtractionMetadata | undefined {
  if (record.extraction) return record.extraction;
  if (!extraction.extractionSource || extraction.extractionSource === "error") return undefined;
  return {
    source: extraction.extractionSource,
    ...(extraction.model ? { model: extraction.model } : {}),
  };
}

function draftFromCacheRecord(
  record: IonicRecord,
  sourceId: string | undefined,
  extraction: CachedExtraction
): DomainDraft<any, any> {
  const mod = getModule("tribology");
  const draft = mod.ingest(toFields(record));
  return {
    ...draft,
    sourceId: sourceId ?? record.sourceId,
    extraction: cacheExtractionMetadata(extraction, record),
  };
}

async function sourceIdForExtraction(extraction: CachedExtraction, manifest?: ManifestRow): Promise<string | undefined> {
  if (extraction.doi) {
    const existing = findSourceByDoi("tribology", extraction.doi);
    if (existing) return existing.id;
  }
  const sourcePath = manifest?.new_abs_path || extraction.filePath;
  const filename = manifest?.new_filename || extraction.filename;
  if (!sourcePath || !fs.existsSync(sourcePath)) return undefined;
  if (/\.pdf$/i.test(sourcePath)) {
    const bytes = await fsp.readFile(sourcePath);
    const source = await createSourceFromPdf("tribology", filename, new Uint8Array(bytes));
    return source.id;
  }
  return undefined;
}

async function main() {
  const write = process.argv.includes("--write");
  const auditVelocities = process.argv.includes("--audit-velocities");
  const keysArg = process.argv.find((arg) => arg.startsWith("--keys="));
  const wantedKeys = keysArg ? new Set(keysArg.slice("--keys=".length).split(",").map((s) => s.trim()).filter(Boolean)) : null;
  const cacheDirArg = process.argv.find((arg) => arg.startsWith("--cache-dir="));
  const cacheDir = path.resolve(cacheDirArg ? cacheDirArg.slice("--cache-dir=".length) : DEFAULT_CACHE_DIR);
  const manifestArg = process.argv.find((arg) => arg.startsWith("--manifest="));
  const manifestPath = path.resolve(manifestArg ? manifestArg.slice("--manifest=".length) : DEFAULT_MANIFEST);
  const manifest = parseManifest(manifestPath);
  const official = listRecords("tribology", { status: "official" }) as IonicRecord[];
  const existing = new Set(official.map(fingerprint));
  const selectedByKey = new Map<string, DomainDraft<any, any>[]>();
  const duplicateByKey = new Map<string, number>();
  const incompleteByKey = new Map<string, number>();
  const auditRows: CandidateAuditRow[] = [];

  for (const file of fs.readdirSync(cacheDir).filter((name) => name.endsWith(".json")).sort()) {
    const key = file.replace(/\.json$/, "");
    if (wantedKeys && !wantedKeys.has(key)) continue;
    const extraction = JSON.parse(fs.readFileSync(path.join(cacheDir, file), "utf8")) as CachedExtraction;
    const selected: DomainDraft<any, any>[] = [];
    let duplicates = 0;
    let incomplete = 0;
    const sourceId = write ? await sourceIdForExtraction(extraction, manifest.get(key)) : undefined;
    for (const cached of extraction.records) {
      if (!isCoreComplete(cached)) {
        incomplete++;
        continue;
      }
      const draft = draftFromCacheRecord(cached, sourceId, extraction);
      if (write && !draft.extraction) {
        throw new Error(
          `${key}: cached record ${cached.id} has no extraction provenance; re-extract it before writing Official records.`
        );
      }
      const recForFingerprint = { ...draft, id: cached.id, status: "official" as const, createdAt: cached.createdAt } as IonicRecord;
      const fp = fingerprint(recForFingerprint);
      if (existing.has(fp)) {
        duplicates++;
        continue;
      }
      existing.add(fp);
      selected.push(draft);
      if (auditVelocities) {
        auditRows.push({
          key,
          id: cached.id,
          title: extraction.title,
          method: draft.extended.method,
          scale: draft.extended.scale,
          velocityRaw: draft.extended.velocity?.raw,
          velocityStd: draft.extended.velocity?.std,
          velocitySource: draft.extended.velocitySource,
          scanRate: draft.extended.afm?.scanRate,
          scanSize: draft.extended.afm?.scanSize,
        });
      }
    }
    if (selected.length) selectedByKey.set(key, selected);
    if (duplicates) duplicateByKey.set(key, duplicates);
    if (incomplete) incompleteByKey.set(key, incomplete);
  }

  let totalSelected = 0;
  for (const [key, selected] of selectedByKey) {
    totalSelected += selected.length;
    console.log(`${key}: selected=${selected.length}; duplicate=${duplicateByKey.get(key) ?? 0}; incomplete=${incompleteByKey.get(key) ?? 0}`);
  }
  console.log(`totalSelected=${totalSelected}`);
  if (auditVelocities) {
    const suspicious = auditRows.filter(
      (row) =>
        row.velocityStd != null &&
        row.velocityStd >= 1e-3 &&
        /afm|ffm|nano/i.test(`${row.method ?? ""} ${row.scale ?? ""}`)
    );
    const derived = auditRows.filter((row) => row.velocitySource === "derived");
    console.log(`velocityAudit.suspiciousAfmNanoHigh=${suspicious.length}`);
    for (const row of suspicious) {
      console.log(`  high\t${row.key}\t${row.id}\t${row.velocityRaw ?? ""}\t${row.method ?? ""}\t${row.scale ?? ""}`);
    }
    console.log(`velocityAudit.derivedFromAfm=${derived.length}`);
    for (const row of derived) {
      console.log(
        `  derived\t${row.key}\t${row.id}\t${row.velocityRaw ?? ""}\t${row.scanRate ?? ""}\t${row.scanSize ?? ""}`
      );
    }
  }
  if (!write) {
    console.log("dry-run only; pass --write to insert official records");
    return;
  }

  let totalCreated = 0;
  for (const [key, drafts] of selectedByKey) {
    const created = createRecords("tribology", drafts, "official") as IonicRecord[];
    totalCreated += created.length;
    console.log(`${key}: created=${created.length}; ids=${created.map((record) => record.id).join(", ")}`);
  }
  console.log(`totalCreated=${totalCreated}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
