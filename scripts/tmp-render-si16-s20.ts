import { renderPdfPage } from '../lib/pdf';
import { readFileSync, writeFileSync } from 'node:fs';

async function main() {
  const pdf = 'data/literature-expansion-20260912/pyrylium-si/am4c01750_si_001.pdf';
  const data = new Uint8Array(readFileSync(pdf));
  for (const scale of [8]) {
    const img = await renderPdfPage(data, 16, scale);
    const out = `data/literature-expansion-20260912/pyrylium-si/pages/si-p16-x${scale}.png`;
    writeFileSync(out, img);
    console.log('wrote', out, img.length, 'bytes');
  }
}
main();
