import { pdfToPages } from '../lib/pdf';
import { readFileSync } from 'node:fs';
async function main() {
  const pages = await pdfToPages(new Uint8Array(readFileSync('data/literature-expansion-20260912/discovery-bulk-02/meta-analysis.pdf')));
  for (const p of pages) {
    if (/Table [45]\./.test(p.text)) {
      console.log('==== PAGE', p.page, '====');
      console.log(p.text.slice(0, 3500));
    }
  }
}
main();
