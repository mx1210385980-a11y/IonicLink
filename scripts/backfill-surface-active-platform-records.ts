import fs from "node:fs";
import path from "node:path";
import { createRecords, listRecords } from "../lib/db";
import { toFields } from "../lib/ingest";
import { getModule } from "../lib/modules/registry.server";
import type { DomainDraft, ExtractionMetadata, ExtractionSource } from "../lib/domain";
import type { IonicRecord } from "../lib/schema";

const TITLE = "Surface-active ionic liquids as lubricant additives to hexadecane and diethyl succinate";
const DEFAULT_CACHE = path.resolve(
  process.cwd(),
  "..",
  "Ioniclink",
  "backend",
  "data",
  "wff",
  "wff_lubrication_platform_cache",
  "surface_active_2024.json"
);

type CachedExtraction = {
  extractionSource?: ExtractionSource | "error";
  model?: string;
  records: IonicRecord[];
};

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

function sourceIdForPaper(existing: IonicRecord[]): string | undefined {
  return existing.find((record) => record.paper.title === TITLE && record.sourceId)?.sourceId;
}

function cacheExtractionMetadata(
  cache: CachedExtraction,
  record: IonicRecord
): ExtractionMetadata | undefined {
  if (record.extraction) return record.extraction;
  if (!cache.extractionSource || cache.extractionSource === "error") return undefined;
  return {
    source: cache.extractionSource,
    ...(cache.model ? { model: cache.model } : {}),
  };
}

function draftFromCacheRecord(
  record: IonicRecord,
  sourceId: string | undefined,
  cache: CachedExtraction
): DomainDraft<any, any> {
  const mod = getModule("tribology");
  const draft = mod.ingest(toFields(record));
  return {
    ...draft,
    sourceId: sourceId ?? record.sourceId,
    extraction: cacheExtractionMetadata(cache, record),
  };
}

function main() {
  const write = process.argv.includes("--write");
  const cachePathArg = process.argv.find((arg) => arg.startsWith("--cache="));
  const cachePath = cachePathArg ? path.resolve(cachePathArg.slice("--cache=".length)) : DEFAULT_CACHE;
  const cache = JSON.parse(fs.readFileSync(cachePath, "utf8")) as CachedExtraction;
  const official = listRecords("tribology", { status: "official" }) as IonicRecord[];
  const existing = new Set(official.map(fingerprint));
  const sourceId = sourceIdForPaper(official);
  const selected: DomainDraft<any, any>[] = [];
  const skipped: string[] = [];

  for (const cached of cache.records) {
    if (cached.paper.title !== TITLE) continue;
    const draft = draftFromCacheRecord(cached, sourceId, cache);
    if (write && !draft.extraction) {
      throw new Error(
        `Cached record ${cached.id} has no extraction provenance; re-extract it before writing Official records.`
      );
    }
    const recordForFingerprint = { ...draft, id: cached.id, status: "official" as const, createdAt: cached.createdAt } as IonicRecord;
    const fp = fingerprint(recordForFingerprint);
    if (existing.has(fp)) {
      skipped.push(cached.id);
      continue;
    }
    existing.add(fp);
    selected.push(draft);
  }

  console.log(`cache=${cachePath}`);
  console.log(`selected=${selected.length}; skippedDuplicates=${skipped.length}${skipped.length ? ` (${skipped.join(", ")})` : ""}`);
  if (!write) {
    console.log("dry-run only; pass --write to insert official records");
    return;
  }
  const created = createRecords("tribology", selected, "official") as IonicRecord[];
  console.log(`created=${created.length}; ids=${created.map((record) => record.id).join(", ")}`);
}

main();
