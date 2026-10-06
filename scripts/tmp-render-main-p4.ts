import { renderPdfPage } from '../lib/pdf';
import { readFileSync, writeFileSync } from 'node:fs';

async function main() {
  const pdf = 'data/literature-expansion-20260912/discovery-pmc/10.1021-acsami.4c01750.pdf';
  const data = new Uint8Array(readFileSync(pdf));
  const img = await renderPdfPage(data, 4, 8);
  const out = 'data/literature-expansion-20260912/batch-08-pyrylium/pages/page-4-x8.png';
  writeFileSync(out, img);
  console.log('wrote', out, img.length, 'bytes');
}
main();
