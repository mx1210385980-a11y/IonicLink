import { pdfToPages } from '../lib/pdf';
import { readFileSync } from 'node:fs';
async function main() {
  for (const f of ['data/literature-expansion-20260912/discovery-bulk-02/meta-analysis.pdf', 'data/literature-expansion-20260912/discovery-bulk-02/silicone-thesis.pdf']) {
    const pages = await pdfToPages(new Uint8Array(readFileSync(f)));
    const all = pages.map((p) => `[PAGE ${p.page}]\n` + p.text).join('\n');
    const name = f.split('/').pop()!;
    console.log('==', name, '| pages:', pages.length);
    // find table headers with COF
    const lines = all.split(/\r?\n/);
    lines.forEach((l, i) => {
      if (/coefficient of friction|COF|friction coefficient/i.test(l) && /table|Table/i.test(lines[Math.max(0, i - 2) + i - i] || '') === false && i % 1 === 0) {
        // print lines near COF mentions that also have numbers
      }
    });
    const m = all.match(/Table \d[^\n]{0,150}/g) || [];
    for (const x of m.slice(0, 30)) console.log('  ', x.replace(/\s+/g, ' ').slice(0, 130));
  }
}
main();
