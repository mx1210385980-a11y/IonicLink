import { pdfToPages } from '../lib/pdf';
import { readFileSync } from 'node:fs';
async function main() {
  const pages = await pdfToPages(new Uint8Array(readFileSync('data/literature-expansion-20260912/discovery-bulk-02/meta-analysis.pdf')));
  const all = pages.map((p) => `[PAGE ${p.page}]\n` + p.text).join('\n');
  // print context around mentions of reference [7] conditions and the refs list
  for (const m of all.matchAll(/\[7\]/g)) {
    const start = Math.max(0, m.index! - 400);
    console.log('---', all.slice(start, m.index! + 400).replace(/\s+/g, ' ').slice(0, 800));
  }
}
main();
