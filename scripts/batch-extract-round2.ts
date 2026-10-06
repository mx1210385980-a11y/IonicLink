import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';

// Load .env.local environment variables
const envPath = path.join(process.cwd(), '.env.local');
if (existsSync(envPath)) {
  const envContent = readFileSync(envPath, 'utf-8');
  for (const line of envContent.split('\n')) {
    const match = line.match(/^\s*([A-Z_]+)=(.*)$/);
    if (match) {
      process.env[match[1]] = match[2].trim();
    }
  }
  console.log('Loaded .env.local environment variables');
}

const root = process.cwd();
const base = path.join(root, 'data/literature-expansion-20260912');
const extractRoot = path.join(base, 'batch-extract-round2');
mkdirSync(extractRoot, { recursive: true });

// Load unprocessed PDFs
const unprocessed = JSON.parse(readFileSync(path.join(base, 'unprocessed-pdfs.json'), 'utf-8')) as string[];
console.log(`Total unprocessed PDFs: ${unprocessed.length}`);

// Prioritize: lubricants and coatings journals (most relevant to IL tribology)
function priority(p: string): number {
  const lower = p.toLowerCase();
  if (lower.includes('lubricants')) return 0;
  if (lower.includes('coatings')) return 1;
  if (lower.includes('friction') || lower.includes('wear') || lower.includes('tribol')) return 2;
  if (lower.includes('molecules') || lower.includes('ijms') || lower.includes('gels')) return 3;
  return 4;
}

const sorted = unprocessed.sort((a, b) => priority(a) - priority(b));

// Select first N PDFs to process
const MAX_PDFS = parseInt(process.argv[2] || '25');
const toProcess = sorted.slice(0, MAX_PDFS);
console.log(`Processing ${toProcess.length} PDFs (priority order)`);

// Infer source URL from filename
function inferUrl(pdfPath: string): string {
  const basename = path.basename(pdfPath, '.pdf');
  // MDPI format: 10_3390_lubricants12030089 -> https://doi.org/10.3390/lubricants12030089
  const mdpiMatch = basename.match(/^10_3390_(.+)$/);
  if (mdpiMatch) return `https://doi.org/10.3390/${mdpiMatch[1]}`;
  // Other DOI formats with underscores
  const doiMatch = basename.match(/^(\d+)_(\d+)_(.+)$/);
  if (doiMatch) return `https://doi.org/${doiMatch[1]}.${doiMatch[2]}/${doiMatch[3]}`;
  // discovery format: 10.1007-s40544-019-0266-6
  const discMatch = basename.match(/^(\d+\.\d+)-(.+)$/);
  if (discMatch) return `https://doi.org/${discMatch[1]}/${discMatch[2]}`;
  return '';
}

let totalDrafts = 0;
let totalAutoOk = 0;
const allAutoOk: any[] = [];
const results: any[] = [];

for (let i = 0; i < toProcess.length; i++) {
  const pdfRel = toProcess[i];
  const pdfPath = path.join(root, pdfRel);
  const pdfName = path.basename(pdfRel, '.pdf');
  const outDir = path.join(extractRoot, pdfName);
  const url = inferUrl(pdfRel);

  console.log(`\n[${i + 1}/${toProcess.length}] ${pdfName}`);
  console.log(`  URL: ${url || 'unknown'}`);

  if (!existsSync(pdfPath)) {
    console.log('  SKIP: PDF not found');
    continue;
  }

  // Skip if already extracted
  const draftsPath = path.join(outDir, 'ai-drafts.json');
  if (existsSync(draftsPath)) {
    console.log('  Already extracted, loading existing...');
  } else {
    mkdirSync(outDir, { recursive: true });
    try {
      const tsxCmd = process.platform === 'win32' ? 'node_modules\\.bin\\tsx.cmd' : 'node_modules/.bin/tsx';
      const cmd = `"${tsxCmd}" scripts/curation-harness.ts "${pdfPath}" "${outDir}" --url "${url}" --max-visual 4`;
      console.log(`  Running extraction...`);
      const output = execSync(cmd, { cwd: root, encoding: 'utf-8', timeout: 180000, stdio: ['pipe', 'pipe', 'pipe'], shell: true });
      console.log(`  ${output.trim().split('\n').pop()}`);
    } catch (e: any) {
      console.log(`  ERROR: ${e.message?.substring(0, 150) || e}`);
      if (e.stderr) console.log(`  stderr: ${String(e.stderr).substring(0, 200)}`);
      continue;
    }
  }

  // Load and collect autoOk drafts
  if (existsSync(draftsPath)) {
    try {
      const data = JSON.parse(readFileSync(draftsPath, 'utf-8'));
      const drafts = data.drafts || [];
      const autoOk = drafts.filter((d: any) => d.autoOk);
      console.log(`  Drafts: ${drafts.length}, autoOk: ${autoOk.length}`);
      totalDrafts += drafts.length;
      totalAutoOk += autoOk.length;

      for (const d of autoOk) {
        allAutoOk.push({
          key: `${pdfName}-${d.key}`,
          sourcePdf: d.sourcePdf,
          sourceUrl: d.sourceUrl || url,
          fields: d.fields,
          decision: 'approve',
          reason: `Auto-extracted and validated by curation-harness (all checks passed). PDF: ${pdfName}`,
        });
      }

      results.push({ pdf: pdfRel, drafts: drafts.length, autoOk: autoOk.length, url });
    } catch (e: any) {
      console.log(`  Failed to load drafts: ${e.message}`);
    }
  }
}

console.log(`\n${'='.repeat(60)}`);
console.log(`EXTRACTION SUMMARY`);
console.log(`${'='.repeat(60)}`);
console.log(`PDFs processed: ${results.length}/${toProcess.length}`);
console.log(`Total drafts: ${totalDrafts}`);
console.log(`Total autoOk: ${totalAutoOk}`);
console.log(`Unique autoOk candidates: ${allAutoOk.length}`);

// Save combined candidates
const outputPath = path.join(base, 'batch-extract-round2-candidates.json');
writeFileSync(outputPath, JSON.stringify(allAutoOk, null, 2));
console.log(`\nSaved ${allAutoOk.length} candidates to: ${outputPath}`);

// Save summary
writeFileSync(path.join(extractRoot, 'summary.json'), JSON.stringify({ results, totalDrafts, totalAutoOk }, null, 2));
