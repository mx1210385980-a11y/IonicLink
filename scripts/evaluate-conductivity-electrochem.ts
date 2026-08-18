import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pdfToTaggedText } from "../lib/pdf";
import { conductivityMockExtract } from "../lib/conductivity/extract";

type Expected = "positive" | "negative";

async function main() {
const rootArg = process.argv[2];
const outputArg = process.argv[3];
if (!rootArg || !outputArg) {
  throw new Error("Usage: tsx scripts/evaluate-conductivity-electrochem.ts <corpus-root> <output-json>");
}

const root = path.resolve(rootArg);
const output = path.resolve(outputArg);
const files = await findPdfs(root);
const byHash = new Map<string, { path: string; expected: Expected; duplicates: string[] }>();

for (const file of files) {
  const bytes = await readFile(file);
  const digest = createHash("sha256").update(bytes).digest("hex");
  const expected: Expected = file.includes("不包含电化学相关参数论文") ? "negative" : "positive";
  const existing = byHash.get(digest);
  if (!existing) {
    byHash.set(digest, { path: file, expected, duplicates: [file] });
  } else {
    existing.duplicates.push(file);
    if (existing.expected === "negative" && expected === "positive") {
      existing.path = file;
      existing.expected = expected;
    }
  }
}

const records = [];
for (const [sha256, paper] of [...byHash.entries()].sort((a, b) => a[1].path.localeCompare(b[1].path))) {
  const bytes = await readFile(paper.path);
  let error: string | null = null;
  let extracted = [] as ReturnType<typeof conductivityMockExtract>;
  try {
    extracted = conductivityMockExtract(await pdfToTaggedText(new Uint8Array(bytes)));
  } catch (caught) {
    error = caught instanceof Error ? `${caught.name}: ${caught.message}` : String(caught);
  }
  const properties = extracted.flatMap((candidate) => [
    candidate.conductivity ? "conductivity" : null,
    candidate.capacitance ? "capacitance" : null,
    candidate.electricField ? "electricField" : null,
    candidate.electrodePotential ? "electrodePotential" : null,
    candidate.electrochemicalWindow ? "electrochemicalWindow" : null,
    candidate.chargeTransferResistance ? "chargeTransferResistance" : null,
  ]).filter((value): value is string => Boolean(value));
  const detected = properties.length > 0;
  const outcome = paper.expected === "positive"
    ? (detected ? "true-positive" : "false-negative")
    : (detected ? "false-positive" : "true-negative");
  records.push({
    file: path.basename(paper.path),
    relativePath: path.relative(root, paper.path),
    sha256,
    duplicateCount: paper.duplicates.length,
    expected: paper.expected,
    outcome,
    recordCount: extracted.length,
    properties: [...new Set(properties)],
    candidates: extracted.map((candidate) => ({
      cation: candidate.cation ?? "",
      anion: candidate.anion ?? "",
      surface: candidate.surface ?? "",
      temperature: candidate.temperature ?? null,
      conductivity: candidate.conductivity ?? null,
      capacitance: candidate.capacitance ?? null,
      electricField: candidate.electricField ?? null,
      electrodePotential: candidate.electrodePotential ?? null,
      electrochemicalWindow: candidate.electrochemicalWindow ?? null,
      chargeTransferResistance: candidate.chargeTransferResistance ?? null,
      potentialReference: candidate.potentialReference ?? null,
      provenance: candidate.provenance ?? [],
    })),
    error,
  });
}

const positives = records.filter((record) => record.expected === "positive");
const negatives = records.filter((record) => record.expected === "negative");
const summary = {
  pdfFiles: files.length,
  uniquePapers: records.length,
  duplicateFiles: files.length - records.length,
  expectedPositive: positives.length,
  expectedNegative: negatives.length,
  detectedPositive: positives.filter((record) => record.recordCount > 0).length,
  rejectedNegative: negatives.filter((record) => record.recordCount === 0).length,
  falsePositive: negatives.filter((record) => record.recordCount > 0).length,
  falseNegative: positives.filter((record) => record.recordCount === 0).length,
  candidateRecords: records.reduce((sum, record) => sum + record.recordCount, 0),
};

await writeFile(output, JSON.stringify({
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  sourceCorpus: path.basename(root),
  evaluator: "IonicLink deterministic conductivity/electrochem extractor",
  scope: "Screening benchmark. Positive/negative labels come from the supplied folders; every extracted value still requires source review.",
  summary,
  records,
}, null, 2), "utf8");

console.log(JSON.stringify(summary, null, 2));
}

async function findPdfs(directory: string): Promise<string[]> {
  const { readdir } = await import("node:fs/promises");
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return findPdfs(full);
    return entry.isFile() && entry.name.toLowerCase().endsWith(".pdf") ? [full] : [];
  }));
  return nested.flat().sort((a, b) => a.localeCompare(b));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
