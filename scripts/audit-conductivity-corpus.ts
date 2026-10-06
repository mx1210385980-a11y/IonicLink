import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pdfToPages } from "../lib/pdf";
import { extractDoiFromPages } from "../lib/doi";

interface IndexedHit {
  page: number;
  text: string;
}

const SIGNAL = /(?:ionic\s+conductiv|electrolyte\s+conductiv|conductivity|conductance|capacitance|capacitive|\bC\s*dl\b|double[-\s]?layer|charge[-\s]?transfer|polarization\s+resistance|\bR\s*(?:ct|p)\b|electrochemical\s+(?:stability\s+)?window|potential\s+window|voltage\s+window|electric(?:al)?\s+field|field\s+strength|viscosity|pressure|impedance|Nyquist|current\s+density|specific\s+capacity|energy\s+density|power\s+density|coulombic\s+efficiency)/i;

async function findPdfs(root: string): Promise<string[]> {
  const { readdir } = await import("node:fs/promises");
  const found: string[] = [];
  async function walk(dir: string) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const target = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(target);
      else if (entry.isFile() && /\.pdf$/i.test(entry.name)) found.push(target);
    }
  }
  await walk(root);
  return found;
}

function compact(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function pageHits(page: number, text: string): IndexedHit[] {
  const paragraphs = text
    .split(/(?<=[.!?])\s+|\n{2,}/)
    .map(compact)
    .filter((value) => value.length >= 20 && SIGNAL.test(value));
  const seen = new Set<string>();
  return paragraphs
    .filter((value) => {
      const key = value.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 40)
    .map((value) => ({ page, text: value.slice(0, 1600) }));
}

async function main() {
  const root = path.resolve(process.argv[2] || "");
  const output = path.resolve(process.argv[3] || "");
  if (!process.argv[2] || !process.argv[3]) {
    throw new Error("Usage: tsx scripts/audit-conductivity-corpus.ts <corpus-root> <output-json>");
  }

  const unique = new Map<string, { file: string; duplicates: string[] }>();
  for (const file of await findPdfs(root)) {
    const bytes = await readFile(file);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const existing = unique.get(sha256);
    if (existing) existing.duplicates.push(file);
    else unique.set(sha256, { file, duplicates: [file] });
  }

  const papers = [];
  for (const [sha256, item] of [...unique.entries()].sort((a, b) => a[1].file.localeCompare(b[1].file))) {
    const bytes = await readFile(item.file);
    const pages = await pdfToPages(new Uint8Array(bytes));
    const relativePath = path.relative(root, item.file);
    const hits = pages.flatMap((page) => pageHits(page.page, page.text)).slice(0, 160);
    const title = pages
      .flatMap((page) => page.text.split("\n"))
      .map(compact)
      .find((line) => line.length >= 24 && line.length <= 240) ?? path.basename(item.file, ".pdf");
    papers.push({
      sha256,
      file: path.basename(item.file),
      relativePath,
      duplicateCount: item.duplicates.length,
      expectedFolder: relativePath.includes("不包含电化学相关参数论文") ? "negative" : "positive",
      title,
      doi: extractDoiFromPages(pages) ?? null,
      pageCount: pages.length,
      signalHits: hits,
    });
  }

  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify({ generatedAt: new Date().toISOString(), root, papers }, null, 2)}\n`, "utf8");
  console.log(`Indexed ${papers.length} unique papers to ${output}`);
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
