import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import Database from 'better-sqlite3';
import { ingest } from '../lib/ingest';
import path from 'node:path';

const root = process.cwd();
const input = path.resolve(process.argv[2] || 'data/literature-expansion-20260912/batch-full-candidates.json');
const output = path.resolve(process.argv[3] || 'data/literature-expansion-20260912/batch-final-deduped.json');

function canonical(value: any): any {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]));
  return typeof value === 'string' ? value.toLowerCase().replace(/\s+/g, ' ').trim() : value;
}

function identity(r: any) {
  const quantities = (q: any) => q ? { raw: q.raw, std: q.std, stdUnit: q.stdUnit } : null;
  return createHash('sha256').update(JSON.stringify(canonical({
    doi: r.paper.doi || r.paper.title,
    ions: r.core.ionicLiquid,
    substrate: r.core.substrate,
    temperature: quantities(r.core.temperature),
    load: quantities(r.core.load),
    ...Object.fromEntries(['probe', 'method', 'velocity', 'potential', 'additives', 'concentration', 'filmThickness', 'filmLayers', 'waterContent', 'cofMethod'].map(k => [k, r.extended[k]])),
    distinguishing: r.flexible.filter((f: any) => ['surface_preparation', 'measurement_stage', 'lubricant_label', 'sample_preparation', 'replicate_id'].includes(f.key)),
  }))).digest('hex');
}

// Load existing DB identities
const db = new Database(path.join(root, 'data/tribology.db'), { readonly: true });
const existing = db.prepare('SELECT payload FROM records').all() as { payload: string }[];
db.close();

const seen = new Set<string>();
let dbIdentities = 0;
let dbIdentityErrors = 0;
for (const row of existing) {
  try {
    const rec = JSON.parse(row.payload);
    seen.add(identity(rec));
    dbIdentities++;
  } catch {
    dbIdentityErrors++;
  }
}
console.log(`Existing DB: ${existing.length} records, ${dbIdentities} valid identities, ${dbIdentityErrors} errors`);

// Load candidates
const candidates = JSON.parse(readFileSync(input, 'utf-8'));
console.log(`Input candidates: ${candidates.length}`);

const deduped: any[] = [];
let ingestErrors = 0;
let dupWithDb = 0;
let dupInBatch = 0;

for (const c of candidates) {
  try {
    const draft = ingest(c.fields);
    const fp = identity(draft);
    if (seen.has(fp)) {
      // Check if it was already in DB or just a batch duplicate
      dupInBatch++;
      continue;
    }
    seen.add(fp);
    deduped.push(c);
  } catch (e: any) {
    ingestErrors++;
  }
}

console.log(`\nIngest errors: ${ingestErrors}`);
console.log(`Duplicates (DB + batch): ${dupInBatch}`);
console.log(`After dedup: ${deduped.length}`);
console.log(`Potential total after import: ${679 + deduped.length}`);

writeFileSync(output, JSON.stringify(deduped, null, 2));
console.log(`\nSaved to: ${output}`);

// DOI distribution
const doiCount: Record<string, number> = {};
for (const r of deduped) {
  const doi = r.fields?.paper?.doi || 'unknown';
  doiCount[doi] = (doiCount[doi] || 0) + 1;
}
console.log(`\nUnique DOIs: ${Object.keys(doiCount).length}`);
const sorted = Object.entries(doiCount).sort((a, b) => b[1] - a[1]);
for (const [doi, cnt] of sorted.slice(0, 15)) {
  console.log(`  ${String(cnt).padStart(4)}  ${doi}`);
}
