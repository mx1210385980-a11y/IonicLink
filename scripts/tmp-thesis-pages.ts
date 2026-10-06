import { pdfToPages } from '../lib/pdf';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
async function main() {
  const f = 'data/literature-expansion-20260912/discovery-bulk-02/silicone-thesis.pdf';
  const pages = await pdfToPages(new Uint8Array(readFileSync(f)));
  const out = 'data/literature-expansion-20260912/batch-10-thesis';
  mkdirSync(out, { recursive: true });
  writeFileSync(out + '/source-pages.txt', pages.map((p) => `[PAGE ${p.page}]\n${p.text}`).join('\n\n'));
  console.log('pages:', pages.length, 'chars:', pages.reduce((n, p) => n + p.text.length, 0));
}
main();
