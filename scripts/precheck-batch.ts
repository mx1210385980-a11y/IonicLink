import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import Database from 'better-sqlite3';
import { ingest } from '../lib/ingest';
import { coreCompleteness } from '../lib/schema';
import { tribologyModule } from '../lib/modules/tribology';
import path from 'node:path';

const root = process.cwd();
const input = path.resolve(process.argv[2] || 'data/literature-expansion-20260912/batch-import-round1.json');
const output = path.resolve(process.argv[3] || 'data/literature-expansion-20260912/batch-import-round1-filtered.json');

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

// Load DB
const db = new Database(path.join(root, 'data/tribology.db'), { readonly: true });
const existing = db.prepare('SELECT id, payload FROM records ORDER BY id').all() as { id: string; payload: string }[];
db.close();

const seen = new Set<string>();
for (const row of existing) {
  try { seen.add(identity(JSON.parse(row.payload))); } catch { }
}

// Load candidates
const candidates = JSON.parse(readFileSync(input, 'utf-8'));
console.log(`Input candidates: ${candidates.length}`);

const filtered: any[] = [];
const errors: Record<string, string> = {};

for (const c of candidates) {
  const key = c.key || 'unknown';
  try {
    // Basic checks
    if (c.decision !== 'approve') { errors[key] = 'not approved'; continue; }
    if (!c.reason) { errors[key] = 'missing reason'; continue; }
    if (!c.sourceUrl) { errors[key] = 'missing sourceUrl'; continue; }
    if (!c.fields?.paper?.doi) { errors[key] = 'missing DOI'; continue; }

    // Ingest
    const draft = ingest(c.fields);

    // Core completeness
    const comp = coreCompleteness(draft);
    if (!comp.complete) { errors[key] = `incomplete: ${comp.missing}`; continue; }

    // COF valid
    if (!Number.isFinite(draft.core.cof) || draft.core.cof < 0) { errors[key] = 'invalid COF'; continue; }

    // Module admission
    if (tribologyModule.acceptDraft && !tribologyModule.acceptDraft(draft)) { errors[key] = 'not admitted by module'; continue; }

    // Provenance basis for required fields
    let provError = '';
    for (const field of ['cation', 'anion', 'substrate', 'load', 'temperature', 'cof']) {
      const p = draft.provenance?.[field];
      if (!p?.basis) { provError = `missing ${field} provenance basis`; break; }
    }
    if (provError) { errors[key] = provError; continue; }

    // Identity dedup
    const fp = identity(draft);
    if (seen.has(fp)) { errors[key] = 'duplicate identity'; continue; }
    seen.add(fp);

    filtered.push(c);
  } catch (e: any) {
    errors[key] = `exception: ${e.message?.substring(0, 100)}`;
  }
}

console.log(`\nFiltered (pass all checks): ${filtered.length}`);
console.log(`Rejected: ${Object.keys(errors).length}`);
console.log('\nRejection reasons:');
const reasonCount: Record<string, number> = {};
for (const [k, v] of Object.entries(errors)) {
  const reason = v.split(':')[0];
  reasonCount[reason] = (reasonCount[reason] || 0) + 1;
}
for (const [reason, count] of Object.entries(reasonCount).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${count}: ${reason}`);
}
console.log('\nRejected records:');
for (const [k, v] of Object.entries(errors)) {
  console.log(`  - ${k}: ${v}`);
}

writeFileSync(output, JSON.stringify(filtered, null, 2));
console.log(`\nSaved ${filtered.length} filtered records to: ${output}`);
console.log(`Potential total after import: ${679 + filtered.length}`);
