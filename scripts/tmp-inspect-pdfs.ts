import { pdfToPages } from '../lib/pdf';
import { readFileSync } from 'node:fs';

async function main() {
  const files = [
    'data/literature-expansion-20260912/discovery-bulk-02/silicone-thesis.pdf',
    'data/literature-expansion-20260912/discovery-bulk-02/meta-analysis.pdf',
    'data/literature-expansion-20260912/discovery-institutions/lipophilic-polymeric-ionic-liquid.pdf',
    'data/literature-expansion-20260912/discovery-datasets/molecules-1013-s001.pdf',
    'data/literature-expansion-20260912/discovery-papers/frontiers-chemistry-titania.pdf',
    'data/literature-expansion-20260912/discovery-datasets/molecules-1013-supplementary/molecules-26-01013-s001.pdf',
    'data/literature-expansion-20260912/discovery-datasets/PMC11357439-supp/molecules-29-03851-s001/molecules-3133331-supplementary.pdf',
  ];
  for (const f of files) {
    try {
      const pages = await pdfToPages(new Uint8Array(readFileSync(f)));
      const all = pages.map((p) => p.text).join('\n');
      const name = f.split('/').pop();
      console.log('==', name, '| pages:', pages.length, '| chars:', all.length);
      console.log('   head:', all.slice(0, 300).replace(/\s+/g, ' '));
      console.log('   [coefficient of friction]:', (all.match(/coefficient of friction/gi) || []).length, '| [ionic liquid]:', (all.match(/ionic liquid/gi) || []).length, '| [Table]:', (all.match(/Table \d/g) || []).length);
    } catch (e: any) {
      console.log('==', f, 'ERR', e.message);
    }
  }
}
main();
