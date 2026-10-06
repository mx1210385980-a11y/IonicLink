import { getSource, listRecords, listSourceSummaries } from "../db";
import { getSourcePdf } from "../sources";
import type { CoreFields, ProvenanceMap, SourceDoc } from "../schema";
import type { SimpleRow } from "./simpleShared";
import { teachingDataDir } from "./store";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { pdfToPages } from "../pdf";

export type SimplePaperOption = { id: string; title: string; pageCount: number; gold: SimpleRow[] };
export function recordToSimpleRow(record: { core: CoreFields; provenance?: ProvenanceMap }): SimpleRow {
  const { core, provenance } = record;
  const quantity = (key: "temperature" | "load") => {
    const q = core[key];
    if (provenance?.[key]?.basis === "assumed") return "NR";
    return q?.raw || (q?.value != null ? `${q.value} ${q.unit ?? ""}`.trim() : "");
  };
  return { cation: core.ionicLiquid?.cation ?? "", anion: core.ionicLiquid?.anion ?? "",
    substrate: core.substrate ?? "", temperature: quantity("temperature"), load: quantity("load"),
    cof: core.cof == null ? "" : String(core.cof) };
}
export function listSimplePapers(): SimplePaperOption[] {
  const records = listRecords("tribology", { status: "official" });
  return listSourceSummaries("tribology").map((source) => {
    const matching = records.filter((record) => record.sourceId === source.id);
    return { id: source.id, title: matching[0]?.paper.title || source.filename,
      pageCount: source.pageCount, gold: matching.map((record) => recordToSimpleRow(record)) };
  });
}
function snapshotDir(sourceId: string) {
  if (!/^[a-f0-9-]{36}$/i.test(sourceId)) throw new Error("Invalid paper ID.");
  return path.join(teachingDataDir(), "teaching-papers", sourceId);
}
export async function snapshotSimplePaper(sourceId: string): Promise<SourceDoc> {
  const source = getSource("tribology", sourceId);
  if (!source?.pages.some((page) => page.text.trim())) throw new Error("The paper has no extractable text. Upload a readable PDF first.");
  const pdf = await getSourcePdf("tribology", sourceId);
  if (!pdf) throw new Error("The original PDF is missing. Upload the paper again.");
  const dir = snapshotDir(sourceId);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "source.pdf"), pdf);
  await writeFile(path.join(dir, "source.json"), JSON.stringify(source));
  return source;
}
export async function readSimplePaper(sourceId: string): Promise<SourceDoc> {
  return JSON.parse(await readFile(path.join(snapshotDir(sourceId), "source.json"), "utf8")) as SourceDoc;
}
export async function readSimplePdf(sourceId: string): Promise<Uint8Array> {
  return new Uint8Array(await readFile(path.join(snapshotDir(sourceId), "source.pdf")));
}
export function simplePaperFingerprint(pages: SourceDoc["pages"]): string {
  return createHash("sha256").update(pages.map(page => page.text).join(" ").normalize("NFKC").replace(/\s+/g, " ").trim()).digest("hex");
}
export async function saveStudentUploadedPdf(filename: string, bytes: Uint8Array): Promise<SourceDoc & { fingerprint: string }> {
  if (typeof filename !== "string" || !filename.trim() || !/\.pdf$/i.test(filename)) throw new Error("Choose a PDF paper");
  if (!bytes.length || bytes.length > 20 * 1024 * 1024) throw new Error("PDF size must be between 1 byte and 20 MB");
  if (new TextDecoder().decode(bytes.subarray(0, 5)) !== "%PDF-") throw new Error("Invalid PDF file");
  let pages: SourceDoc["pages"];
  try { pages = await pdfToPages(bytes); } catch { throw new Error("The PDF could not be read. Upload a readable PDF"); }
  if (!pages.some(page => page.text.trim())) throw new Error("The paper has no extractable text. Upload a readable PDF first.");
  const source: SourceDoc & { fingerprint: string } = { id: randomUUID(), fingerprint: simplePaperFingerprint(pages), filename: path.basename(filename.replace(/\\/g, "/")).slice(0, 255),
    pageCount: pages.length, pages, createdAt: new Date().toISOString() };
  const dir = snapshotDir(source.id);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "source.pdf"), bytes);
  await writeFile(path.join(dir, "source.json"), JSON.stringify(source));
  return source;
}
