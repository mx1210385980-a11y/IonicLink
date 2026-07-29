import assert from "node:assert/strict";
import path from "node:path";
import { createRecords } from "../lib/db";
import {
  buildSourceJobs,
  normalizeIonLabel,
  parseCsvRecords,
  reviewWffRows,
  selectOfficialRecordDrafts,
  stringifyCsvRows,
  verifyProvenanceQuotes,
  withRetries,
} from "./wff-lubrication-extract";

const parsed = parseCsvRecords(
  "\uFEFFsource_literature_key,source_literature_title,wff_dataset\n" +
    'paper_a,"Title, with comma",film\n'
);
assert.deepEqual(parsed, [
  {
    source_literature_key: "paper_a",
    source_literature_title: "Title, with comma",
    wff_dataset: "film",
  },
]);

assert.equal(normalizeIonLabel("[BMIm]+"), "bmim");
assert.equal(normalizeIonLabel("[P6,6,6,14]+"), "p66614");

const jobs = buildSourceJobs({
  wffRows: [
    { source_literature_key: "paper_a", wff_dataset: "film" },
    { source_literature_key: "paper_a", wff_dataset: "no_film" },
  ],
  manifestRows: [
    {
      source_literature_key: "paper_a",
      source_literature_title: "Paper A",
      source_literature_doi: "10/example",
      new_filename: "paper-a.pdf",
    },
  ],
  sourcesDir: "/tmp/sources",
});
assert.deepEqual(jobs, [
  {
    key: "paper_a",
    title: "Paper A",
    doi: "10/example",
    filename: "paper-a.pdf",
    filePath: path.join("/tmp/sources", "paper-a.pdf"),
    wffRows: 2,
    filmRows: 1,
    noFilmRows: 1,
  },
]);

const platformRecord = {
  id: "platform:paper_a:1",
  status: "review",
  confidence: 0.91,
  createdAt: "2026-06-11T00:00:00.000Z",
  paper: { title: "Paper A" },
  core: {
    ionicLiquid: { cation: "[BMIM]", anion: "[PF6]" },
    substrate: "HOPG",
    temperature: { raw: "298 K", value: 298, std: 298, kind: "temperature" },
    load: { raw: "5 nN", value: 5, std: 5e-9, kind: "force" },
    cof: 0.0029,
  },
  extended: {
    potential: { raw: "0 V", value: 0, std: 0, kind: "potential" },
    velocity: { raw: "20 um/s", value: 20, std: 20e-6, kind: "velocity" },
    filmThickness: { raw: "3.8 nm", value: 3.8, std: 3.8e-9, kind: "length" },
  },
  flexible: [],
  provenance: {
    cof: { page: 3, quote: "friction coefficient was 0.0029" },
  },
};

const reviewed = reviewWffRows({
  wffRows: [
    {
      source_literature_key: "paper_a",
      wff_dataset: "film",
      wff_row_number: "7",
      Cation: "[BMIm]+",
      anion: "[PF6]-",
      surface: "HOPG",
      Potential: "0.0",
      velocity: "20.0",
      T: "298",
      h: "3.9",
      "\u03BC": "0.0028",
    },
  ],
  recordsByKey: new Map([["paper_a", [platformRecord as any]]]),
});
assert.equal(reviewed[0].review_status, "matched");
assert.equal(reviewed[0].matched_platform_record_id, "platform:paper_a:1");
assert.equal(reviewed[0].cation_match, "yes");
assert.equal(reviewed[0].anion_match, "yes");
assert.equal(reviewed[0].surface_match, "yes");
assert.ok(Number(reviewed[0].score) >= 10);

const missing = reviewWffRows({
  wffRows: [{ source_literature_key: "paper_b", wff_dataset: "no_film", wff_row_number: "1" }],
  recordsByKey: new Map(),
});
assert.equal(missing[0].review_status, "no_platform_record");

const selectedOfficial = selectOfficialRecordDrafts({
  extractions: [
    {
      key: "paper_a",
      title: "Paper A",
      doi: "",
      filename: "paper-a.pdf",
      filePath: "/tmp/paper-a.pdf",
      extractedAt: "2026-06-11T00:00:00.000Z",
      extractionSource: "openai-compatible",
      pageCount: 1,
      charCount: 100,
      sha256: "abc",
      quoteAudit: { totalQuotes: 1, verifiedQuotes: 1, missingQuotes: 0 },
      records: [platformRecord as any],
    },
  ],
  reviewRows: reviewed,
  existingOfficialRecords: [],
  sourceIdsByKey: new Map([["paper_a", "source-uuid"]]),
});
assert.equal(selectedOfficial.drafts.length, 1);
assert.equal(selectedOfficial.drafts[0].sourceId, "source-uuid");
assert.deepEqual(
  selectedOfficial.drafts[0].extraction,
  { source: "openai-compatible" },
  "old caches inherit extraction provenance from their wrapper before Official import"
);
assert.equal(selectedOfficial.skipped.length, 0);

const selectedMock = selectOfficialRecordDrafts({
  extractions: [
    {
      key: "paper_a",
      title: "Paper A",
      doi: "",
      filename: "paper-a.pdf",
      filePath: "/tmp/paper-a.pdf",
      extractedAt: "2026-06-11T00:00:00.000Z",
      extractionSource: "mock",
      pageCount: 1,
      charCount: 100,
      sha256: "abc",
      quoteAudit: { totalQuotes: 1, verifiedQuotes: 1, missingQuotes: 0 },
      records: [platformRecord as any],
    },
  ],
  reviewRows: reviewed,
  existingOfficialRecords: [],
  sourceIdsByKey: new Map([[
    "paper_a",
    "source-uuid",
  ]]),
});
assert.equal(selectedMock.drafts[0].extraction?.source, "mock", "old mock caches cannot masquerade as legacy records");
assert.throws(
  () => createRecords("tribology", selectedMock.drafts, "official"),
  /Cannot create official records from mock extraction/,
  "the WFF --write-official path rejects a reused mock cache"
);

for (const extractionSource of [undefined, "error"] as const) {
  const missingProvenance = selectOfficialRecordDrafts({
    extractions: [
      {
        key: "paper_a",
        title: "Paper A",
        doi: "",
        filename: "paper-a.pdf",
        filePath: "/tmp/paper-a.pdf",
        extractedAt: "2026-06-11T00:00:00.000Z",
        ...(extractionSource ? { extractionSource } : {}),
        pageCount: 1,
        charCount: 100,
        sha256: "abc",
        quoteAudit: { totalQuotes: 1, verifiedQuotes: 1, missingQuotes: 0 },
        records: [platformRecord as any],
      } as any,
    ],
    reviewRows: reviewed,
    existingOfficialRecords: [],
    sourceIdsByKey: new Map([["paper_a", "source-uuid"]]),
  });
  assert.equal(missingProvenance.drafts.length, 0);
  assert.equal(missingProvenance.skipped[0].reason, "missing_extraction_provenance");
}

const skippedDuplicate = selectOfficialRecordDrafts({
  extractions: [
    {
      key: "paper_a",
      title: "Paper A",
      doi: "",
      filename: "paper-a.pdf",
      filePath: "/tmp/paper-a.pdf",
      extractedAt: "2026-06-11T00:00:00.000Z",
      extractionSource: "openai-compatible",
      pageCount: 1,
      charCount: 100,
      sha256: "abc",
      quoteAudit: { totalQuotes: 1, verifiedQuotes: 1, missingQuotes: 0 },
      records: [platformRecord as any],
    },
  ],
  reviewRows: reviewed,
  existingOfficialRecords: [platformRecord as any],
  sourceIdsByKey: new Map([["paper_a", "source-uuid"]]),
});
assert.equal(skippedDuplicate.drafts.length, 0);
assert.equal(skippedDuplicate.skipped[0].reason, "duplicate_existing_official");

const quoteAudit = verifyProvenanceQuotes([platformRecord as any], "[PAGE 3]\nThe friction coefficient was   0.0029.");
assert.deepEqual(quoteAudit, { totalQuotes: 1, verifiedQuotes: 1, missingQuotes: 0 });

assert.equal(
  stringifyCsvRows([{ a: "x,y", b: 'quote "inside"' }]),
  'a,b\n"x,y","quote ""inside"""'
);

async function testRetries() {
  let attempts = 0;
  const retried = await withRetries(
    "transient operation",
    async () => {
      attempts++;
      if (attempts < 3) throw new Error("temporary upstream failure");
      return "ok";
    },
    { retries: 3, baseDelayMs: 1 }
  );
  assert.equal(retried, "ok");
  assert.equal(attempts, 3);
}

testRetries()
  .then(() => {
    console.log("WFF lubrication extraction helper tests passed");
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
