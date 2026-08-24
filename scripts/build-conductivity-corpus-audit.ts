import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { conductivityMockExtract } from "../lib/conductivity/extract";
import type { ConductivityExtractedFields } from "../lib/conductivity/schema";
import { extractDoiFromPages } from "../lib/doi";
import { pagesToTaggedText, pdfToPages } from "../lib/pdf";

interface CuratedPaper {
  title: string;
  reviewSummary: string;
  expectedRecords: number;
  accept(record: ConductivityExtractedFields): boolean;
}

const CURATED: Record<string, CuratedPaper> = {
  "1-s2.0-S0013468610008790-main.pdf": {
    title: "Ionic liquid electrolytes based on multi-methoxyethyl substituted ammoniums and perfluorinated sulfonimides: Preparation, characterization, and properties",
    reviewSummary: "Manually checked Table 1 (viscosity and specific conductivity at 25 °C) and the electrochemical-window table. KFSI/LiFSI non-IL rows and binary-electrolyte rows without both bulk properties are excluded.",
    expectedRecords: 16,
    accept: (record) => Boolean(record.cation && record.anion && record.cation !== "[TFSI]" && (record.conductivity || record.viscosity || record.electrochemicalWindow)),
  },
  "1-s2.0-S0013468616307848-main.pdf": {
    title: "New ionic liquids based on a super-delocalized perfluorinated sulfonimide anion: physical and electrochemical properties",
    reviewSummary: "Manually checked the six [sTFSI]-IL rows reporting viscosity and ionic conductivity at 25 °C. The abstract's aggregate electrochemical-window range is not entered as a single-IL record.",
    expectedRecords: 6,
    accept: (record) => Boolean(record.conductivity || record.viscosity),
  },
  "1-s2.0-S0167732218325492-main.pdf": {
    title: "Experimental, density functional theory and molecular dynamics supported adsorption behavior of environmental benign imidazolium based ionic liquids on mild steel surface in acidic medium",
    reviewSummary: "Manually checked the EIS table rows for [bmim][Cl], [bmim][CF3SO3], and [bmim][Ac]. Rct and Cdl from each concentration row are retained together; Rs and inhibition efficiency are excluded.",
    expectedRecords: 12,
    accept: (record) => Boolean(record.chargeTransferResistance && record.capacitance),
  },
  "1-s2.0-S235234092100860X-main.pdf": {
    title: "Dataset of the electrochemical potential windows for the Au(hkl)|ionic liquid interfaces defined by the cut-off current densities",
    reviewSummary: "Manually checked Tables 2, 4, 6, 8, and 10. Each ionic liquid, Au crystal face, and cut-off current density is a separate condition set; ND rows are excluded.",
    expectedRecords: 42,
    accept: (record) => Boolean(record.electrochemicalWindow && record.surface?.startsWith("Au(") && record.flexible?.some((item) => item.key === "Cut-off current density")),
  },
  "Giroud_2008_Meet._Abstr._MA2008-02_26.pdf": {
    title: "Physicochemical Study of Ionic Liquids' Structure and Influence of the Lithium Salt Associated",
    reviewSummary: "Manually checked the meeting-abstract table. Viscosity and ionic conductivity at 20 °C are merged for each of the five ionic liquids.",
    expectedRecords: 5,
    accept: (record) => Boolean(record.conductivity && record.viscosity),
  },
  "Hwang_2021_J._Electrochem._Soc._168_030508.pdf": {
    title: "Benefits of the Mixtures of Ionic Liquid and Organic Electrolytes for Sodium-ion Batteries",
    reviewSummary: "Manually checked Tables II and III. Conductivity and viscosity are merged for ILOL 20/50/80/100 at each reported temperature; ILOL 0 and literature-reference columns are excluded.",
    expectedRecords: 36,
    accept: (record) => Boolean(record.conductivity && record.viscosity && /^ILOL (?:20|50|80|100)$/.test(record.concentration ?? "")),
  },
};

async function main() {
  const root = path.resolve(process.argv[2] || "");
  const output = path.resolve(process.argv[3] || "data/conductivity/conductivity-corpus-curated-audit.json");
  if (!process.argv[2]) throw new Error("Usage: tsx scripts/build-conductivity-corpus-audit.ts <corpus-root> [output-json]");

  const papers = [];
  for (const [file, policy] of Object.entries(CURATED)) {
    const bytes = new Uint8Array(await readFile(path.join(root, file)));
    const pages = await pdfToPages(bytes);
    const doi = extractDoiFromPages(pages) ?? undefined;
    const records = conductivityMockExtract(pagesToTaggedText(pages))
      .filter(policy.accept)
      .map((record) => ({
        ...record,
        paper: { title: policy.title, ...(doi ? { doi } : {}) },
        confidence: 0.98,
      }));
    if (records.length !== policy.expectedRecords) {
      throw new Error(`${file}: expected ${policy.expectedRecords} curated records, got ${records.length}`);
    }
    papers.push({
      file,
      ...(doi ? { doi } : {}),
      classification: "text-values",
      reviewSummary: policy.reviewSummary,
      records,
    });
  }

  const payload = {
    schemaVersion: 1,
    auditedAt: new Date().toISOString().slice(0, 10),
    scope: "Source-checked high-confidence subset of the 2026-08 conductivity corpus. Only explicit text/table measurements are curated here; all PDFs are preserved separately as source documents.",
    papers,
  };
  await writeFile(output, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ auditedPapers: papers.length, curatedRecords: papers.reduce((sum, paper) => sum + paper.records.length, 0), output }, null, 2));
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
