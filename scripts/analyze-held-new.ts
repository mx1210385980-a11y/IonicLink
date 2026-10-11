import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import Database from 'better-sqlite3';
import { ingest } from '../lib/ingest';
import { coreCompleteness } from '../lib/schema';
import path from 'node:path';

const root = process.cwd();
const input = path.resolve('data/literature-expansion-20260912/held-valid-candidates.json');
const output = path.resolve('data/literature-expansion-20260912/held-new-deduped.json');

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

// Load DB identities
const db = new Database(path.join(root, 'data/tribology.db'), { readonly: true });
const existing = db.prepare('SELECT payload FROM records').all() as { payload: string }[];
db.close();

const seen = new Set<string>();
for (const row of existing) {
  try {
    seen.add(identity(JSON.parse(row.payload)));
  } catch { }
}
console.log(`DB identities loaded: ${seen.size}`);

// Load held candidates
const held = JSON.parse(readFileSync(input, 'utf-8'));
console.log(`Held-valid candidates: ${held.length}`);

const newHeld: any[] = [];
let ingestErrors = 0;
let dupCount = 0;
let incomplete = 0;

for (const c of held) {
  try {
    const draft = ingest(c.fields);
    const fp = identity(draft);
    if (seen.has(fp)) {
      dupCount++;
      continue;
    }
    // Check core completeness
    const comp = coreCompleteness(draft);
    if (!comp.complete) {
      incomplete++;
      continue;
    }
    seen.add(fp);
    newHeld.push(c);
  } catch (e: any) {
    ingestErrors++;
  }
}

console.log(`\nIngest errors: ${ingestErrors}`);
console.log(`Duplicates with DB: ${dupCount}`);
console.log(`Incomplete core: ${incomplete}`);
console.log(`NEW held records (unique + complete): ${newHeld.length}`);

// Categorize by reason quality
const qualityTiers: Record<string, any[]> = {
  'verified': [],
  'confirmed': [],
  'chart-uncertain': [],
  'other': [],
};

for (const c of newHeld) {
  const reason = (c.reason || '').toLowerCase();
  if (reason.includes('verif') || reason.includes('numeric data')) {
    qualityTiers['verified'].push(c);
  } else if (reason.includes('identif') || reason.includes('confirmed') || reason.includes('publisher')) {
    qualityTiers['confirmed'].push(c);
  } else if (reason.includes('marker') || reason.includes('occlusion') || reason.includes('figure') || reason.includes('chart') || reason.includes('peak')) {
    qualityTiers['chart-uncertain'].push(c);
  } else {
    qualityTiers['other'].push(c);
  }
}

console.log('\n=== Quality tiers of NEW held records ===');
for (const [tier, recs] of Object.entries(qualityTiers)) {
  console.log(`  ${tier}: ${recs.length}`);
  for (const r of recs.slice(0, 3)) {
    console.log(`    - ${r.key}: ${(r.reason || '').substring(0, 80)}`);
  }
}

writeFileSync(output, JSON.stringify(newHeld, null, 2));
console.log(`\nSaved ${newHeld.length} new held records to: ${output}`);
