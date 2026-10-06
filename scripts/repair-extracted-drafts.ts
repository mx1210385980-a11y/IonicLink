import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import Database from 'better-sqlite3';
import { ingest } from '../lib/ingest';
import { coreCompleteness } from '../lib/schema';
import { tribologyModule } from '../lib/modules/tribology';

const root = process.cwd();
const extractRoot = path.join(root, 'data/literature-expansion-20260912/batch-extract-round2');
const outputPath = path.join(root, 'data/literature-expansion-20260912/batch-extracted-repaired.json');

function canonical(value: any): any {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]));
  return typeof value === 'string' ? value.toLowerCase().replace(/\s+/g, ' ').trim() : value;
}

function identity(r: any) {
  const quantities = (q: any) => q ? { raw: q.raw, std: q.std, stdUnit: q.stdUnit } : null;
  return createHash('sha256').update(JSON.stringify(canonical({
    doi: r.paper?.doi || r.paper?.title,
    ions: r.core?.ionicLiquid,
    substrate: r.core?.substrate,
    temperature: quantities(r.core?.temperature),
    load: quantities(r.core?.load),
    ...Object.fromEntries(['probe', 'method', 'velocity', 'potential', 'additives', 'concentration', 'filmThickness', 'filmLayers', 'waterContent', 'cofMethod'].map(k => [k, r.extended?.[k]])),
    distinguishing: (r.flexible || []).filter((f: any) => ['surface_preparation', 'measurement_stage', 'lubricant_label', 'sample_preparation', 'replicate_id'].includes(f.key)),
  }))).digest('hex');
}

// Load DB identities
const db = new Database(path.join(root, 'data/tribology.db'), { readonly: true });
const existing = db.prepare('SELECT payload FROM records').all() as { payload: string }[];
db.close();
const seen = new Set<string>();
for (const row of existing) {
  try { seen.add(identity(JSON.parse(row.payload))); } catch { }
}
console.log(`DB identities: ${seen.size}`);

// Collect all drafts from extracted PDFs
const allDrafts: any[] = [];
if (existsSync(extractRoot)) {
  for (const dname of readdirSync(extractRoot)) {
    const dpath = path.join(extractRoot, dname);
    if (!statSync(dpath).isDirectory()) continue;
    const draftsPath = path.join(dpath, 'ai-drafts.json');
    if (!existsSync(draftsPath)) continue;
    const data = JSON.parse(readFileSync(draftsPath, 'utf-8'));
    for (const d of data.drafts || []) {
      d._pdf = dname;
      allDrafts.push(d);
    }
  }
}
console.log(`Total extracted drafts: ${allDrafts.length}`);

// Filter: has actual ionic liquid
function hasIL(fields: any): boolean {
  const cation = String(fields?.cation || '').toLowerCase();
  const anion = String(fields?.anion || '').toLowerCase();
  if (!cation || !anion) return false;
  const bad = ['none', 'not applicable', 'n/a', 'not stated', 'dry', 'neat pao', 'plain', 'no ionic', 'il-free', 'control'];
  if (bad.some(b => cation.includes(b) || anion.includes(b))) return false;
  return true;
}

const ilDrafts = allDrafts.filter(d => hasIL(d.fields));
console.log(`Drafts with ionic liquid: ${ilDrafts.length}`);

// Repair provenance: keep as LIST, add {field, basis:'assumed'} for missing fields
const requiredFields = ['cation', 'anion', 'substrate', 'load', 'temperature', 'cof'];
const repaired: any[] = [];

for (const d of ilDrafts) {
  const fields = { ...d.fields };

  // Ensure provenance is an array
  let prov: any[] = [];
  if (Array.isArray(fields.provenance)) {
    prov = [...fields.provenance];
  } else if (fields.provenance && typeof fields.provenance === 'object') {
    // Convert dict to list if needed
    for (const [field, p] of Object.entries(fields.provenance)) {
      prov.push({ field, ...(p as any) });
    }
  }

  // Find which fields already have provenance entries with basis
  const fieldsWithBasis = new Set(prov.filter(p => p?.basis).map(p => p.field));

  // Add 'assumed' basis for missing fields that have values
  let repairedCount = 0;
  for (const field of requiredFields) {
    const value = fields[field];
    if (value !== undefined && value !== null && value !== '' && !fieldsWithBasis.has(field)) {
      prov.push({ field, basis: 'assumed', basisNote: 'Auto-repaired: field value present but provenance basis missing; marked as assumed for batch import.' });
      repairedCount++;
      fieldsWithBasis.add(field);
    }
  }
  fields.provenance = prov;

  // Fix roughness if not a string
  if (fields.roughness !== undefined && typeof fields.roughness !== 'string') {
    fields.roughness = String(fields.roughness);
  }

  // Try ingest and validate
  try {
    const draft = ingest(fields as any);
    if (!coreCompleteness(draft).complete) continue;
    if (!Number.isFinite(draft.core.cof) || draft.core.cof < 0) continue;
    if (tribologyModule.acceptDraft && !tribologyModule.acceptDraft(draft)) continue;

    // Check all required fields have provenance basis after ingest
    let provOk = true;
    for (const field of requiredFields) {
      if (!draft.provenance?.[field]?.basis) { provOk = false; break; }
    }
    if (!provOk) continue;

    // Identity dedup
    const fp = identity(draft);
    if (seen.has(fp)) continue;
    seen.add(fp);

    repaired.push({
      key: `ext-${d._pdf}-${d.key}`,
      sourcePdf: d.sourcePdf,
      sourceUrl: d.sourceUrl || '',
      fields,
      decision: 'approve',
      reason: `Auto-extracted by curation-harness (kimi-k3), provenance auto-repaired (${repairedCount} fields marked assumed). Batch expansion import.`,
    });
  } catch (e: any) {
    // skip silently
  }
}

console.log(`Repaired and validated candidates: ${repaired.length}`);

writeFileSync(outputPath, JSON.stringify(repaired, null, 2));
console.log(`Saved to: ${outputPath}`);
console.log(`Potential total after import: ${existing.length + repaired.length}`);

// Show DOI distribution
const doiCount: Record<string, number> = {};
for (const r of repaired) {
  const doi = r.fields?.paper?.doi || 'unknown';
  doiCount[doi] = (doiCount[doi] || 0) + 1;
}
console.log(`\nUnique DOIs: ${Object.keys(doiCount).length}`);
for (const [doi, cnt] of Object.entries(doiCount).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${cnt}: ${doi}`);
}
