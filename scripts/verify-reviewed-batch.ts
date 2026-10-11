/**
 * Mechanical pre-import verifier for reviewed-candidate batches.
 * Usage: npx tsx scripts/verify-reviewed-batch.ts <reviewed.json> <source-pages.txt>
 *
 * Checks every approve candidate:
 *  - core fields present, finite COF in [0, 2]
 *  - provenance exists for cation/anion/substrate/temperature/load/cof with basis
 *  - every non-assumed provenance quote is found (folded) in the cited page text
 *  - unique candidate keys
 * Exits non-zero if any approve candidate fails.
 */
import { readFileSync } from 'node:fs';

function fold(s: string): string {
  return s.normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu, '').toLowerCase();
}

const [batchFile, pagesFile] = process.argv.slice(2);
const candidates = JSON.parse(readFileSync(batchFile, 'utf8'));
const pagesText = readFileSync(pagesFile, 'utf8');
const pages = new Map<number, string>();
let current = 0;
for (const line of pagesText.split(/\r?\n/)) {
  const m = line.match(/^\[PAGE (\d+)\]$/);
  if (m) { current = Number(m[1]); pages.set(current, ''); }
  else if (current) pages.set(current, (pages.get(current) || '') + line + '\n');
}

const SIX = ['cation', 'anion', 'substrate', 'temperature', 'load', 'cof'];
let failures = 0;
const keys = new Set<string>();
for (const c of candidates) {
  if (c.decision !== 'approve') continue;
  const problems: string[] = [];
  if (keys.has(c.key)) problems.push('duplicate key');
  keys.add(c.key);
  const f = c.fields || {};
  if (!f.paper?.doi) problems.push('missing paper.doi');
  if (!f.cation || !f.anion) problems.push('missing ion');
  if (!f.substrate) problems.push('missing substrate');
  if (!(typeof f.cof === 'number' && Number.isFinite(f.cof) && f.cof >= 0 && f.cof <= 2)) problems.push(`bad cof ${f.cof}`);
  const prov: any[] = Array.isArray(f.provenance) ? f.provenance : [];
  const byField = new Map<string, any>(prov.map((p: any) => [p.field, p]));
  for (const field of SIX) {
    const p = byField.get(field);
    if (!p) { problems.push(`no provenance for ${field}`); continue; }
    if (!p.basis) { problems.push(`no basis for ${field}`); continue; }
    if (p.basis === 'assumed') continue;
    if (!p.page || !pages.has(p.page)) { problems.push(`${field}: page ${p.page} not in source text`); continue; }
    if (!p.quote) { problems.push(`${field}: missing quote`); continue; }
    if (!fold(p.quote).includes('…') && !pages.get(p.page)!.toLowerCase().includes('…')) {
      // direct containment or ellipsis pieces
    }
    const q = fold(p.quote);
    const t = fold(pages.get(p.page)!);
    if (q.length < 5) { problems.push(`${field}: quote too short`); continue; }
    if (t.includes(q)) continue;
    const pieces = p.quote.split(/\.{3,}|…/).map(fold).filter((x: string) => x.length >= 5);
    if (pieces.length > 1) {
      let at = 0, ok = true;
      for (const piece of pieces) {
        const found = t.indexOf(piece, at);
        if (found < 0) { ok = false; break; }
        at = found + piece.length;
      }
      if (ok) continue;
    }
    problems.push(`${field}: quote NOT found on page ${p.page}: "${String(p.quote).slice(0, 60)}"`);
  }
  if (problems.length) {
    failures++;
    console.log(`FAIL ${c.key}`);
    for (const p of problems) console.log(`   - ${p}`);
  } else {
    console.log(`ok   ${c.key}`);
  }
}
console.log(failures ? `\n${failures} candidate(s) failed` : '\nall approve candidates passed');
process.exit(failures ? 1 : 0);
