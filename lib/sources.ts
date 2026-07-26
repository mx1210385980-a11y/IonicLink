import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { Domain } from "./domain";
import { createSource } from "./db";
import { extractDoiFromPages } from "./doi";
import { findQuoteBoxes, type EvidenceBoxes, type TextSpan } from "./evidence";
import { pdfPageTextSpans, pdfToPages, pagesToTaggedText, renderPdfPage } from "./pdf";

/**
 * Source documents: the uploaded PDF is kept on disk so we can always refer back
 * to the original. Storage is domain-scoped (`data/<domain>/sources/<id>/`) so a
 * conductivity upload never lands in the tribology tree. Records link to a
 * source by id.
 */

const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function sourcesDir(domain: Domain): string {
  return path.join(process.cwd(), "data", domain, "sources");
}
function dir(domain: Domain, id: string): string {
  return path.join(sourcesDir(domain), id);
}
function pdfPath(domain: Domain, id: string): string {
  return path.join(dir(domain, id), "source.pdf");
}
function pagePngPath(domain: Domain, id: string, page: number, scale: number): string {
  return path.join(dir(domain, id), `page-${page}@${scale}.png`);
}

/**
 * Store an uploaded PDF, index its per-page text, and return the tagged text.
 * Accepts pre-parsed pages so callers that already extracted them (e.g. the
 * upload route's DOI duplicate check) don't parse the PDF twice.
 */
export async function createSourceFromPdf(
  domain: Domain,
  filename: string,
  bytes: Uint8Array,
  parsedPages?: { page: number; text: string }[]
): Promise<{ id: string; pageCount: number; taggedText: string; doi?: string }> {
  const id = randomUUID();
  await mkdir(dir(domain, id), { recursive: true });
  await writeFile(pdfPath(domain, id), bytes);
  const pages = parsedPages ?? (await pdfToPages(bytes));
  const doi = extractDoiFromPages(pages) ?? undefined;
  createSource(domain, {
    id,
    filename,
    pageCount: pages.length,
    createdAt: new Date().toISOString(),
    pages,
    ...(doi ? { doi } : {}),
  });
  return { id, pageCount: pages.length, taggedText: pagesToTaggedText(pages), doi };
}

export async function getSourcePdf(domain: Domain, id: string): Promise<Uint8Array | null> {
  if (!ID_RE.test(id)) return null; // reject ids that aren't UUIDs before touching the filesystem
  const p = pdfPath(domain, id);
  if (!existsSync(p)) return null;
  return new Uint8Array(await readFile(p));
}

/**
 * Positioned text runs per cited page, cached in memory — parsing the PDF is
 * the slow part and a source never changes once stored.
 */
const spanCache = new Map<string, TextSpan[]>();
const SPAN_CACHE_MAX = 64;

async function sourcePageSpans(domain: Domain, id: string, page: number): Promise<TextSpan[] | null> {
  const key = `${domain}/${id}/${page}`;
  const hit = spanCache.get(key);
  if (hit) return hit;
  const pdf = await getSourcePdf(domain, id);
  if (!pdf) return null;
  const spans = await pdfPageTextSpans(pdf, page);
  if (spanCache.size >= SPAN_CACHE_MAX) {
    const oldest = spanCache.keys().next().value;
    if (oldest !== undefined) spanCache.delete(oldest);
  }
  spanCache.set(key, spans);
  return spans;
}

/**
 * Locate an evidence quote on a cited page → highlight boxes for the page
 * image (page fractions). `match: null` means the quote could not be found on
 * that page — worth surfacing to the reviewer.
 */
export async function findEvidenceOnPage(
  domain: Domain,
  id: string,
  page: number,
  quote: string
): Promise<EvidenceBoxes | null> {
  const spans = await sourcePageSpans(domain, id, page);
  if (!spans) return null;
  return findQuoteBoxes(spans, quote);
}

/** Render a cited page to PNG, caching the result on disk. */
export async function renderSourcePage(
  domain: Domain,
  id: string,
  page: number,
  scale = 2
): Promise<Uint8Array | null> {
  if (!ID_RE.test(id)) return null;
  const cache = pagePngPath(domain, id, page, scale);
  if (existsSync(cache)) return new Uint8Array(await readFile(cache));
  const pdf = await getSourcePdf(domain, id);
  if (!pdf) return null;
  const png = await renderPdfPage(pdf, page, scale);
  await writeFile(cache, png);
  return png;
}
