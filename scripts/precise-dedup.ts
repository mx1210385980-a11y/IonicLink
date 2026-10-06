import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { ingest } from '../lib/ingest';
import path from 'node:path';

const root = process.cwd();
const input = path.resolve(process.argv[2] || 'data/literature-expansion-20260912/batch-full-candidates.json');
const output = path.resolve(process.argv[3] || 'data/literature-expansion-20260912/batch-precise-deduped.json');

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

const candidates = JSON.parse(readFileSync(input, 'utf-8'));
console.log(`Input: ${candidates.length} candidates`);

const seen = new Set<string>();
const deduped: any[] = [];
let ingestErrors = 0;
let duplicates = 0;

for (const c of candidates) {
  try {
    const draft = ingest(c.fields);
    const fp = identity(draft);
    if (seen.has(fp)) {
      duplicates++;
      continue;
    }
    seen.add(fp);
    deduped.push(c);
  } catch (e: any) {
    ingestErrors++;
    console.log(`  ingest error for ${c.key}: ${e.message?.substring(0, 100)}`);
  }
}

console.log(`\nIngest errors: ${ingestErrors}`);
console.log(`Duplicates removed: ${duplicates}`);
console.log(`After precise dedup: ${deduped.length}`);
console.log(`Potential total: ${679 + deduped.length}`);

writeFileSync(output, JSON.stringify(deduped, null, 2));
console.log(`\nSaved to: ${output}`);
