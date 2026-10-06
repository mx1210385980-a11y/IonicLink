import { pdfToPages } from '../lib/pdf';
import { readFileSync } from 'node:fs';
async function main() {
  const pages = await pdfToPages(new Uint8Array(readFileSync('data/literature-expansion-20260912/discovery-bulk-02/meta-analysis.pdf')));
  const refs = pages.filter((p) => p.page >= 15).map((p) => p.text).join('\n');
  const idx = refs.indexOf('7. ');
  if (idx >= 0) console.log(refs.slice(idx, idx + 400));
  const idx2 = refs.indexOf('6. ');
  if (idx2 >= 0) console.log('---'); if (idx2 >= 0) console.log(refs.slice(idx2, idx2 + 300));
}
main();
