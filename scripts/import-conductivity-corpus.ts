import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createJobs, findSourceByDoi, listJobs, listSourceSummaries } from "../lib/db";
import { extractDoiFromPages } from "../lib/doi";
import { kickDrain } from "../lib/jobs";
import { pdfToPages } from "../lib/pdf";
import { createSourceFromPdf, getSourcePdf } from "../lib/sources";

async function findPdfs(root: string): Promise<string[]> {
  const { readdir } = await import("node:fs/promises");
  const output: string[] = [];
  async function walk(directory: string) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith(".pdf")) output.push(full);
    }
  }
  await walk(root);
  return output.sort((a, b) => a.localeCompare(b));
}

async function main() {
  const root = path.resolve(process.argv[2] || "");
  const write = process.argv.includes("--write");
  if (!process.argv[2]) throw new Error("Usage: tsx scripts/import-conductivity-corpus.ts <corpus-root> [--write]");

  const unique = new Map<string, string>();
  let duplicateFiles = 0;
  for (const file of await findPdfs(root)) {
    const digest = createHash("sha256").update(await readFile(file)).digest("hex");
    if (unique.has(digest)) duplicateFiles += 1;
    else unique.set(digest, file);
  }

  const storedByHash = new Map<string, string>();
  for (const source of listSourceSummaries("conductivity")) {
    const pdf = await getSourcePdf("conductivity", source.id);
    if (pdf) storedByHash.set(createHash("sha256").update(pdf).digest("hex"), source.id);
  }

  let uploaded = 0;
  let reused = 0;
  let jobsCreated = 0;
  for (const [digest, file] of unique) {
    const bytes = new Uint8Array(await readFile(file));
    const pages = await pdfToPages(bytes);
    const doi = extractDoiFromPages(pages) ?? undefined;
    let sourceId = storedByHash.get(digest) ?? (doi ? findSourceByDoi("conductivity", doi)?.id : undefined);
    let taggedText = pages.map((page) => `[PAGE ${page.page}]\n${page.text}`).join("\n\n");

    if (!sourceId) {
      if (!write) sourceId = `dry-run:${digest.slice(0, 12)}`;
      else {
        const source = await createSourceFromPdf("conductivity", path.basename(file), bytes, pages);
        sourceId = source.id;
        taggedText = source.taggedText;
        storedByHash.set(digest, sourceId);
        uploaded += 1;
      }
    } else {
      reused += 1;
    }

    const hasJob = listJobs("conductivity").some((job) => job.sourceId === sourceId);
    if (write && !hasJob) {
      createJobs("conductivity", [{ filename: path.basename(file), text: taggedText, sourceId }]);
      jobsCreated += 1;
    }
  }

  if (write && jobsCreated) kickDrain("conductivity");
  console.log(JSON.stringify({
    mode: write ? "imported" : "dry-run",
    pdfFiles: unique.size + duplicateFiles,
    uniquePapers: unique.size,
    duplicateFiles,
    sourcesUploaded: uploaded,
    sourcesReused: reused,
    extractionJobsCreated: jobsCreated,
  }, null, 2));
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
