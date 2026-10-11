import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { ingest } from '../lib/ingest';
import { coreCompleteness } from '../lib/schema';
import { tribologyModule } from '../lib/modules/tribology';

const root = process.cwd();
const extractRoot = path.join(root, 'data/literature-expansion-20260912/batch-extract-round2');

// Collect all IL drafts
const ilDrafts: any[] = [];
for (const dname of readdirSync(extractRoot)) {
  const dpath = path.join(extractRoot, dname);
  if (!statSync(dpath).isDirectory()) continue;
  const draftsPath = path.join(dpath, 'ai-drafts.json');
  if (!existsSync(draftsPath)) continue;
  const data = JSON.parse(readFileSync(draftsPath, 'utf-8'));
  for (const d of data.drafts || []) {
    const fields = d.fields || {};
    const cation = String(fields.cation || '').toLowerCase();
    const anion = String(fields.anion || '').toLowerCase();
    const bad = ['none', 'not applicable', 'n/a', 'dry', 'plain'];
    if (cation && anion && !bad.some(b => cation.includes(b) || anion.includes(b))) {
      d._pdf = dname;
      ilDrafts.push(d);
    }
  }
}

console.log(`IL drafts: ${ilDrafts.length}`);

// Test first 5 with repair
const requiredFields = ['cation', 'anion', 'substrate', 'load', 'temperature', 'cof'];

for (let i = 0; i < Math.min(5, ilDrafts.length); i++) {
  const d = ilDrafts[i];
  const fields = { ...d.fields };
  console.log(`\n=== Draft ${i + 1} (${d._pdf}) ===`);
  console.log(`  cation: ${fields.cation}`);
  console.log(`  anion: ${fields.anion}`);
  console.log(`  cof: ${fields.cof}`);
  console.log(`  temp: ${fields.temperature}`);
  console.log(`  load: ${fields.load}`);
  console.log(`  substrate: ${fields.substrate}`);
  console.log(`  provenance type: ${typeof fields.provenance}, isArray: ${Array.isArray(fields.provenance)}`);

  // Convert provenance
  let prov: any = {};
  if (Array.isArray(fields.provenance)) {
    for (const p of fields.provenance) {
      if (p?.field) prov[p.field] = p;
    }
    console.log(`  provenance keys after conversion: ${Object.keys(prov)}`);
  } else if (fields.provenance && typeof fields.provenance === 'object') {
    prov = { ...fields.provenance };
    console.log(`  provenance keys: ${Object.keys(prov)}`);
  }

  // Add assumed basis
  for (const field of requiredFields) {
    const value = fields[field];
    if (value !== undefined && value !== null && value !== '') {
      if (!prov[field] || !prov[field].basis) {
        prov[field] = { basis: 'assumed', note: 'auto-repaired' };
      }
    }
  }
  fields.provenance = prov;

  // Fix roughness
  if (fields.roughness !== undefined && typeof fields.roughness !== 'string') {
    fields.roughness = String(fields.roughness);
  }

  try {
    const draft = ingest(fields as any);
    console.log(`  ingest OK`);
    console.log(`  coreCompleteness: ${JSON.stringify(coreCompleteness(draft))}`);
    console.log(`  cof after ingest: ${draft.core.cof}`);
    console.log(`  provenance after ingest keys: ${Object.keys(draft.provenance || {})}`);

    // Check required fields have basis
    for (const field of requiredFields) {
      const p = draft.provenance?.[field];
      console.log(`    ${field}: basis=${p?.basis}, hasValue=${fields[field] !== undefined}`);
    }

    if (tribologyModule.acceptDraft) {
      console.log(`  module accept: ${tribologyModule.acceptDraft(draft)}`);
    }
  } catch (e: any) {
    console.log(`  ingest ERROR: ${e.message}`);
    console.log(`  stack: ${e.stack?.substring(0, 300)}`);
  }
}
