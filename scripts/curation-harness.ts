/**
 * AI-assisted candidate generation for the literature-expansion curation workflow.
 *
 * Usage: npx tsx scripts/curation-harness.ts <sourcePdf> <outDir> --url <sourceUrl> [--max-visual N]
 *
 * Runs the platform's own tribology extraction (lib/extract.ts, Kimi + vision) over
 * the per-page text of one source PDF, then applies the same admission checks the
 * import script enforces (completeness, admission, finite COF, provenance basis and
 * page bounds, quote containment, condition-identity dedup against the live DB).
 *
 * Output (all inside <outDir>): source-pages.txt, pages/page-<n>.png, ai-drafts.json.
 * ai-drafts.json records are DRAFTS for agent review — nothing here touches the DB.
 * The reviewing agent promotes drafts to reviewed-candidates.json; the import path
 * (scripts/import-reviewed-literature-20260912.ts) stays the only DB writer.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { pdfToPages, renderPdfPage } from '../lib/pdf';
import { extractRecords, selectVisualPageNumbers } from '../lib/extract';
import { ingest } from '../lib/ingest';
import { coreCompleteness, type ExtractedFields } from '../lib/schema';
import { tribologyModule } from '../lib/modules/tribology';
import { recordStructureKey } from '../lib/structureSearch.server';
import Database from 'better-sqlite3';

const args = process.argv.slice(2);
const pdfPath = path.resolve(args[0]);
const outDir = path.resolve(args[1]);
const urlArg = args.indexOf('--url');
const sourceUrl = urlArg >= 0 ? args[urlArg + 1] : '';
const maxVisual = Number(args[args.indexOf('--max-visual') + 1] || 6);
if (!existsSync(pdfPath)) throw new Error(`PDF not found: ${pdfPath}`);
mkdirSync(outDir, { recursive: true });
mkdirSync(path.join(outDir, 'pages'), { recursive: true });

function foldText(s: string): string {
  return s.normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu, '').toLowerCase();
}
function quoteInPage(quote: string, pageText: string): boolean {
  const q = foldText(quote);
  if (q.length < 5) return false;
  const t = foldText(pageText);
  if (t.includes(q)) return true;
  // partial: pieces between ellipses must appear in order
  const pieces = quote.split(/\.{3,}|…/).map(foldText).filter((p) => p.length >= 5);
  if (pieces.length > 1) {
    let at = 0;
    for (const piece of pieces) {
      const found = t.indexOf(piece, at);
      if (found < 0) return false;
      at = found + piece.length;
    }
    return true;
  }
  return false;
}

const hash = (v: string | Buffer) => createHash('sha256').update(v).digest('hex');

async function main() {
  const bytes = readFileSync(pdfPath);
  if (bytes.subarray(0, 5).toString() !== '%PDF-') throw new Error('Not a PDF');
  const pages = await pdfToPages(new Uint8Array(bytes));
  const pageCount = pages.length;
  writeFileSync(path.join(outDir, 'source-pages.txt'), pages.map((p) => `[PAGE ${p.page}]\n${p.text}`).join('\n\n'));
  for (const p of pages) {
    const png = await renderPdfPage(new Uint8Array(bytes.slice()), p.page, 2);
    if (png) writeFileSync(path.join(outDir, 'pages', `page-${p.page}.png`), png);
  }

  const tagged = pages.map((p) => `[PAGE ${p.page}]\n${p.text}`).join('\n\n');
  const picked = new Set(selectVisualPageNumbers('tribology', tagged, maxVisual));
  for (const p of pages) {
    if (picked.size >= maxVisual) break;
    picked.add(p.page);
  }
  const visualPages = [...picked].slice(0, maxVisual).map((page) => {
    const file = path.join(outDir, 'pages', `page-${page}.png`);
    return { page, dataUrl: `data:image/png;base64,${readFileSync(file).toString('base64')}` };
  });

  const result = await extractRecords('tribology', tagged, undefined, { visualPages });
  console.log(`extraction: ${result.records.length} drafts via ${result.source} ${result.model ?? ''}`);

  const db = new Database(path.resolve('data/tribology.db'), { readonly: true });
  const canonical = (value: any): any => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((k) => [k, canonical(value[k])]));
    return typeof value === 'string' ? value.toLowerCase().replace(/\s+/g, ' ').trim() : value;
  };
  const identity = (r: any) => hash(JSON.stringify(canonical({
    doi: r.paper?.doi || r.paper?.title,
    ions: r.core?.ionicLiquid,
    substrate: r.core?.substrate,
    temperature: r.core?.temperature ? { raw: r.core.temperature.raw, std: r.core.temperature.std, stdUnit: r.core.temperature.stdUnit } : null,
    load: r.core?.load ? { raw: r.core.load.raw, std: r.core.load.std, stdUnit: r.core.load.stdUnit } : null,
    ...Object.fromEntries(['probe', 'method', 'velocity', 'potential', 'additives', 'concentration', 'filmThickness', 'filmLayers', 'waterContent', 'cofMethod'].map((k) => [k, r.extended?.[k]])),
    distinguishing: (r.flexible || []).filter((f: any) => ['surface_preparation', 'measurement_stage', 'lubricant_label', 'sample_preparation', 'replicate_id'].includes(f.key)),
  })));
  const seenIdentities = new Set<string>();
  for (const row of db.prepare('SELECT payload FROM records').all() as { payload: string }[]) {
    seenIdentities.add(identity(JSON.parse(row.payload)));
  }
  db.close();

  const seen = new Set<string>(seenIdentities);
  const drafts: any[] = [];
  for (const draft of result.records) {
    const problems: string[] = [];
    const completeness = coreCompleteness(draft);
    if (!completeness.complete) problems.push(`incomplete: ${completeness.missing.join(',')}`);
    if (!(Number.isFinite(draft.core.cof) && draft.core.cof >= 0)) problems.push('cof not finite');
    if (tribologyModule.acceptDraft && !tribologyModule.acceptDraft(draft)) problems.push('inadmissible per module gate');
    if (!draft.paper?.doi) problems.push('missing doi');
    const six = ['cation', 'anion', 'substrate', 'load', 'temperature', 'cof'];
    for (const field of six) {
      const p = draft.provenance?.[field];
      if (!p?.basis) { problems.push(`no provenance basis for ${field}`); continue; }
      if (p.basis !== 'assumed') {
        if (!p.page || p.page < 1 || p.page > pageCount) problems.push(`${field} page out of range`);
        else if (p.quote && !quoteInPage(p.quote, pages[p.page - 1].text)) problems.push(`${field} quote not found on page ${p.page}`);
      }
    }
    if (draft.core.temperature?.basis === undefined && draft.provenance?.temperature?.basis === 'assumed') {
      // platform convention: unstated temperature normalizes to 293.15 K
    }
    const fp = identity(draft);
    if (seen.has(fp)) problems.push('duplicate condition identity vs DB or batch');
    seen.add(fp);

    const fields: ExtractedFields = {
      paper: draft.paper,
      cation: draft.core.ionicLiquid.cation,
      cationSmiles: draft.core.ionicLiquid.cationSmiles,
      anion: draft.core.ionicLiquid.anion,
      anionSmiles: draft.core.ionicLiquid.anionSmiles,
      substrate: draft.core.substrate,
      temperature: draft.core.temperature?.raw,
      load: draft.core.load?.raw,
      cof: draft.core.cof,
      scale: draft.core.scale,
      method: draft.extended.method,
      probe: draft.extended.probe,
      probeType: draft.extended.probeType,
      velocity: draft.extended.velocity?.raw,
      roughness: draft.extended.roughness,
      concentration: draft.extended.concentration,
      additives: draft.extended.additives,
      cofMethod: draft.extended.cofMethod,
      flexible: draft.flexible,
      provenance: draft.provenance ? Object.entries(draft.provenance).map(([field, p]) => ({ field: field as any, ...(p as any) })) : undefined,
    } as ExtractedFields;
    // round-trip guard: the import script re-ingests these fields
    try {
      const again = ingest(fields as any);
      if (!coreCompleteness(again).complete) problems.push('re-ingest loses completeness');
      if (Math.abs((again.core.cof ?? NaN) - (draft.core.cof ?? NaN)) > 1e-9) problems.push('re-ingest changes cof');
      recordStructureKey(again, 'cation');
    } catch (e: any) {
      problems.push(`re-ingest failed: ${String(e.message).slice(0, 120)}`);
    }
    drafts.push({
      key: `draft-${drafts.length + 1}`,
      sourcePdf: path.relative(process.cwd(), pdfPath).split(path.sep).join('/'),
      sourceUrl,
      fields,
      autoOk: problems.length === 0,
      problems,
    });
  }
  const summary = {
    pdf: path.relative(process.cwd(), pdfPath).split(path.sep).join('/'),
    pdfSha256: hash(bytes),
    sourceUrl,
    pageCount,
    extracted: drafts.length,
    autoOk: drafts.filter((d) => d.autoOk).length,
    model: result.model,
    createdAt: new Date().toISOString(),
  };
  writeFileSync(path.join(outDir, 'ai-drafts.json'), JSON.stringify({ summary, drafts }, null, 2));
  console.log(JSON.stringify(summary));
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
