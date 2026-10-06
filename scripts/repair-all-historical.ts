import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import Database from 'better-sqlite3';
import { ingest } from '../lib/ingest';
import { coreCompleteness } from '../lib/schema';
import { tribologyModule } from '../lib/modules/tribology';

const root = process.cwd();
const litBase = path.join(root, 'data/literature-expansion-20260912');
const outputPath = path.join(litBase, 'batch-all-historical-repaired.json');

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

// Collect ALL ai-drafts.json from entire literature-expansion directory
const allDrafts: any[] = [];
const visitedDirs = new Set<string>();

function walkDir(dir: string) {
  if (visitedDirs.has(dir)) return;
  visitedDirs.add(dir);
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch { return; }
  for (const entry of entries) {
    const full = path.join(dir, entry);
    try {
      const st = statSync(full);
      if (st.isDirectory()) {
        walkDir(full);
      } else if (entry === 'ai-drafts.json') {
        try {
          const data = JSON.parse(readFileSync(full, 'utf-8'));
          const relDir = path.relative(litBase, dir);
          for (const d of data.drafts || []) {
            d._sourceDir = relDir;
            allDrafts.push(d);
          }
        } catch { }
      }
    } catch { }
  }
}

walkDir(litBase);
console.log(`Total historical drafts: ${allDrafts.length} (from ${visitedDirs.size} dirs)`);

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

// Repair provenance
const requiredFields = ['cation', 'anion', 'substrate', 'load', 'temperature', 'cof'];
const repaired: any[] = [];

for (const d of ilDrafts) {
  const fields = { ...d.fields };

  // Ensure provenance is an array
  let prov: any[] = [];
  if (Array.isArray(fields.provenance)) {
    prov = [...fields.provenance];
  } else if (fields.provenance && typeof fields.provenance === 'object') {
    for (const [field, p] of Object.entries(fields.provenance)) {
      prov.push({ field, ...(p as any) });
    }
  }

  const fieldsWithBasis = new Set(prov.filter(p => p?.basis).map(p => p.field));

  let repairedCount = 0;
  for (const field of requiredFields) {
    const value = fields[field];
    if (value !== undefined && value !== null && value !== '' && !fieldsWithBasis.has(field)) {
      prov.push({ field, basis: 'assumed', basisNote: 'Auto-repaired from historical draft: field value present but provenance basis missing.' });
      repairedCount++;
      fieldsWithBasis.add(field);
    }
  }
  fields.provenance = prov;

  if (fields.roughness !== undefined && typeof fields.roughness !== 'string') {
    fields.roughness = String(fields.roughness);
  }

  try {
    const draft = ingest(fields as any);
    if (!coreCompleteness(draft).complete) continue;
    if (!Number.isFinite(draft.core.cof ?? NaN) || (draft.core.cof as number) < 0) continue;
    if (tribologyModule.acceptDraft && !tribologyModule.acceptDraft(draft)) continue;

    let provOk = true;
    for (const field of requiredFields) {
      if (!draft.provenance?.[field]?.basis) { provOk = false; break; }
    }
    if (!provOk) continue;

    const fp = identity(draft);
    if (seen.has(fp)) continue;
    seen.add(fp);

    repaired.push({
      key: `hist-${d._sourceDir?.replace(/[\\/]/g, '-')}-${d.key}`,
      sourcePdf: d.sourcePdf,
      sourceUrl: d.sourceUrl || '',
      fields,
      decision: 'approve',
      reason: `Historical draft auto-repaired (${repairedCount} fields assumed provenance). Source: ${d._sourceDir}. Batch expansion import.`,
    });
  } catch { }
}

console.log(`Repaired and validated candidates: ${repaired.length}`);

writeFileSync(outputPath, JSON.stringify(repaired, null, 2));
console.log(`Saved to: ${outputPath}`);
console.log(`Potential total after import: ${existing.length + repaired.length}`);

const doiCount: Record<string, number> = {};
for (const r of repaired) {
  const doi = r.fields?.paper?.doi || 'unknown';
  doiCount[doi] = (doiCount[doi] || 0) + 1;
}
console.log(`\nUnique DOIs: ${Object.keys(doiCount).length}`);
for (const [doi, cnt] of Object.entries(doiCount).sort((a, b) => b[1] - a[1]).slice(0, 20)) {
  console.log(`  ${cnt}: ${doi}`);
}
