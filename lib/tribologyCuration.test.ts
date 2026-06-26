import assert from "node:assert/strict";
import { ingest } from "./ingest";
import {
  buildCoverageSummary,
  classifyRecordIssues,
  officialFingerprint,
  planOfficialCuration,
} from "./tribologyCuration";
import type { IonicRecord, RecordStatus } from "./schema";

function record(id: string, status: RecordStatus, fields: Parameters<typeof ingest>[0]): IonicRecord {
  return {
    ...ingest(fields),
    id,
    status,
    createdAt: "2026-06-20T00:00:00.000Z",
  };
}

function storedRecord(id: string, status: RecordStatus, source: IonicRecord, patch: Partial<IonicRecord>): IonicRecord {
  return {
    ...source,
    ...patch,
    id,
    status,
    core: { ...source.core, ...patch.core },
    extended: { ...source.extended, ...patch.extended },
  };
}

const base = {
  paper: { title: "Curation Test Paper", doi: "10.0000/test" },
  cation: "[BMIM]",
  anion: "[PF6]",
  substrate: "mica",
  temperature: "25 °C",
  load: "5 nN",
  cof: 0.12,
  scale: "nano" as const,
  provenance: [
    { field: "cof", page: 4, figure: "Fig. 2", quote: "the coefficient of friction was 0.12", basis: "direct" as const },
    { field: "load", page: 3, quote: "normal load of 5 nN", basis: "direct" as const },
    { field: "substrate", page: 2, quote: "freshly cleaved mica was used", basis: "direct" as const },
  ],
};

const completeOfficial = record("#001", "official", base);
const duplicateReview = record("#002", "review", base);
const newReview = record("#003", "review", {
  ...base,
  paper: { title: "New Ion Pair" },
  cation: "[EMIM]",
  anion: "[TFSI]",
  substrate: "HOPG",
  cof: 0.08,
});
const incompleteReview = record("#004", "review", { ...base, load: "" });
const suspiciousOfficial = record("#005", "official", { ...base, cof: 3.4 });
const sameDoiDifferentTitle = record("#010", "review", {
  ...base,
  paper: { title: "Alternate Curation Test Title", doi: "10.0000/test" },
});

assert.equal(
  officialFingerprint(completeOfficial),
  officialFingerprint(duplicateReview),
  "same condition-performance point has the same official fingerprint"
);
assert.equal(
  officialFingerprint(completeOfficial),
  officialFingerprint(sameDoiDifferentTitle),
  "same DOI and condition-performance point has the same official fingerprint"
);
assert.equal(
  officialFingerprint(record("#023", "review", { ...base, paper: { title: "Fallback Title" } })),
  officialFingerprint(record("#024", "review", { ...base, paper: { title: "Fallback Title" } })),
  "paper title is used for fingerprint identity when DOI is absent"
);
assert.notEqual(
  officialFingerprint(completeOfficial),
  officialFingerprint(newReview),
  "different ion pair and surface changes the official fingerprint"
);
assert.equal(
  officialFingerprint(record("#013", "official", base)),
  officialFingerprint(record("#014", "review", { ...base, cation: "BMIM+", anion: "PF6-" })),
  "common ion label variants have the same official fingerprint"
);
assert.notEqual(
  officialFingerprint(record("#015", "review", { ...base, scale: "nano" as const })),
  officialFingerprint(record("#016", "review", { ...base, scale: "macro" as const })),
  "scale changes the official fingerprint"
);
for (const [label, fields] of [
  ["cof", { cof: 0.13 }],
  ["temperature", { temperature: "30 °C" }],
  ["load", { load: "6 nN" }],
  ["potential", { potential: "+0.5 V" }],
  ["velocity", { velocity: "20 µm/s" }],
  ["roughness", { roughness: "1 nm" }],
  ["film thickness", { filmThickness: "2 nm" }],
  ["film layers", { filmThickness: "3 layers" }],
  ["concentration", { concentration: "0.5 mol/L" }],
  ["water content", { waterContent: "100 ppm" }],
] as const) {
  assert.notEqual(
    officialFingerprint(record(`#fp-${label}-a`, "review", base)),
    officialFingerprint(record(`#fp-${label}-b`, "review", { ...base, ...fields })),
    `${label} changes the official fingerprint`
  );
}

assert.deepEqual(classifyRecordIssues(completeOfficial), [], "complete sourced record has no issues");
assert.deepEqual(
  classifyRecordIssues(incompleteReview).map((issue) => issue.code),
  ["missing_core_fields"],
  "missing load keeps review record out of official promotion"
);
assert.ok(
  classifyRecordIssues(suspiciousOfficial).some((issue) => issue.code === "cof_out_of_expected_range"),
  "COF above accepted curation range is flagged"
);
assert.ok(
  classifyRecordIssues(record("#017", "review", { ...base, load: "2001 N" })).some(
    (issue) => issue.code === "load_out_of_expected_range"
  ),
  "load above accepted curation range is flagged"
);
assert.ok(
  classifyRecordIssues(
    storedRecord("#018", "review", completeOfficial, {
      core: { ...completeOfficial.core, load: { ...completeOfficial.core.load!, raw: "5 V" } },
    })
  ).some((issue) => issue.code === "load_looks_like_potential"),
  "stored load with potential units is flagged"
);
assert.ok(
  classifyRecordIssues(record("#019", "review", { ...base, potential: "5 nN" })).some(
    (issue) => issue.code === "potential_looks_like_load"
  ),
  "potential with force units is flagged"
);

const plan = planOfficialCuration({
  officialRecords: [completeOfficial, suspiciousOfficial],
  reviewRecords: [duplicateReview, newReview, incompleteReview],
});

assert.deepEqual(plan.promote.map((r) => r.id), ["#003"], "only complete new review records are promoted");
assert.deepEqual(plan.demote.map((r) => r.id), ["#005"], "suspicious official records return to review");
assert.deepEqual(plan.keepReview.map((entry) => entry.record.id), ["#002", "#004"], "duplicates and incomplete records stay in review");
assert.equal(plan.duplicateGroups.length, 1, "duplicate groups are reported");

const dirtyOfficial = storedRecord("#020", "official", completeOfficial, {
  core: { ...completeOfficial.core, load: { ...completeOfficial.core.load!, raw: "5 V" } },
});
const cleanReplacementReview = record("#021", "review", base);
const replacementPlan = planOfficialCuration({
  officialRecords: [dirtyOfficial],
  reviewRecords: [cleanReplacementReview],
});
assert.deepEqual(replacementPlan.demote.map((r) => r.id), ["#020"], "bad official records can leave official curation");
assert.deepEqual(replacementPlan.promote.map((r) => r.id), ["#021"], "clean duplicate review can replace a demoted official record");

const mixedOfficialDuplicatePlan = planOfficialCuration({
  officialRecords: [completeOfficial, dirtyOfficial],
  reviewRecords: [record("#021-still-duplicate", "review", base)],
});
assert.deepEqual(
  mixedOfficialDuplicatePlan.promote.map((r) => r.id),
  [],
  "review duplicates are not promoted while a clean official duplicate remains"
);
assert.deepEqual(
  mixedOfficialDuplicatePlan.keepReview.map((entry) => entry.record.id),
  ["#021-still-duplicate"],
  "review duplicate stays in review when a clean official duplicate remains"
);

const reviewWithoutEvidence = record("#022", "review", { ...base, provenance: [] });
const reviewWithoutEvidencePlan = planOfficialCuration({
  officialRecords: [],
  reviewRecords: [reviewWithoutEvidence],
});
assert.deepEqual(
  reviewWithoutEvidencePlan.keepReview.flatMap((entry) => entry.reasons.map((issue) => issue.code)),
  ["missing_cof_evidence", "missing_load_evidence", "missing_substrate_evidence"],
  "review promotion candidates need official evidence"
);

const officialWithoutEvidence = record("#023-official-issue", "official", { ...base, provenance: [] });
const officialIssuePlan = planOfficialCuration({
  officialRecords: [officialWithoutEvidence],
  reviewRecords: [],
});
assert.deepEqual(officialIssuePlan.demote.map((r) => r.id), [], "non-hard official issues do not demote records");
assert.deepEqual(
  officialIssuePlan.officialIssues.flatMap((entry) => entry.reasons.map((issue) => issue.code)),
  ["missing_cof_evidence", "missing_load_evidence", "missing_substrate_evidence"],
  "non-hard official issues are retained for audit reporting"
);

const reviewDuplicateBase = {
  ...base,
  paper: { title: "Review Duplicate Source" },
  cation: "[HMIM]",
  anion: "[BF4]",
  substrate: "silica",
};
const earlierDuplicateReview = record("#007", "review", reviewDuplicateBase);
const laterCleanDuplicateReview = record("#008", "review", {
  ...reviewDuplicateBase,
});

const reviewDuplicatePlan = planOfficialCuration({
  officialRecords: [],
  reviewRecords: [earlierDuplicateReview, laterCleanDuplicateReview],
});
const laterDuplicateEntry = reviewDuplicatePlan.keepReview.find((entry) => entry.record.id === "#008");
assert.deepEqual(reviewDuplicatePlan.promote.map((r) => r.id), ["#007"], "first clean review duplicate can be promoted");
assert.ok(
  laterDuplicateEntry?.reasons.some((issue) => issue.code === "duplicate_condition_point"),
  "later review duplicate is kept for duplicate condition point"
);

const badThenCleanDuplicatePlan = planOfficialCuration({
  officialRecords: [],
  reviewRecords: [reviewWithoutEvidence, record("#023-clean-duplicate", "review", base)],
});
assert.deepEqual(
  badThenCleanDuplicatePlan.promote.map((r) => r.id),
  ["#023-clean-duplicate"],
  "questionable review duplicates do not block a later trusted duplicate"
);

const lowercaseSubstrate = record("#011", "official", base);
const uppercaseSubstrate = record("#012", "official", { ...base, substrate: "Mica" });
const substrateCoverage = buildCoverageSummary([lowercaseSubstrate, uppercaseSubstrate]);
assert.deepEqual(substrateCoverage.substrates, [{ substrate: "mica", count: 2 }], "substrate coverage groups labels by case");

const manyCoverageRecords = Array.from({ length: 22 }, (_, i) =>
  record(`#coverage-${i}`, "official", {
    ...base,
    paper: { title: `Coverage Paper ${i}` },
    cation: `[C${String(i).padStart(2, "0")}]`,
    anion: "[PF6]",
    substrate: i === 21 ? "aaa surface" : `surface ${String(i).padStart(2, "0")}`,
  })
);
const sortedCoverageRecords = [
  ...manyCoverageRecords,
  record("#coverage-repeat-ion", "official", {
    ...base,
    paper: { title: "Coverage Repeat Ion" },
    cation: "[C05]",
    anion: "[PF6]",
    substrate: "surface 05",
  }),
  record("#coverage-repeat-surface", "official", {
    ...base,
    paper: { title: "Coverage Repeat Surface" },
    cation: "[C99]",
    anion: "[PF6]",
    substrate: "surface 05",
  }),
];
const sortedCoverage = buildCoverageSummary(sortedCoverageRecords);
assert.equal(sortedCoverage.topIonPairs.length, 20, "top ion pairs are capped at 20");
assert.equal(sortedCoverage.substrates.length, 20, "substrates are capped at 20");
assert.deepEqual(sortedCoverage.topIonPairs[0], { cation: "[C05]", anion: "[PF6]", count: 2 });
assert.deepEqual(sortedCoverage.substrates[0], { substrate: "surface 05", count: 3 });
assert.equal(sortedCoverage.substrates[1].substrate, "aaa surface", "substrates sort by label when counts tie");

const coverage = buildCoverageSummary([completeOfficial, newReview]);
assert.equal(coverage.recordCount, 2);
assert.equal(coverage.paperCount, 2);
assert.equal(coverage.ionPairCount, 2);
assert.deepEqual(coverage.topIonPairs[0], { cation: "[BMIM]", anion: "[PF6]", count: 1 });
assert.ok(coverage.substrates.some((entry) => entry.substrate === "HOPG"));

const conditionCoverage = buildCoverageSummary([
  completeOfficial,
  record("#condition-coverage", "official", {
    ...base,
    paper: { title: "Velocity Paper" },
    velocity: "20 µm/s",
    potential: "+0.5 V",
    roughness: "1 nm",
    concentration: "0.5 mol/L",
    waterContent: "100 ppm",
    filmThickness: "2 nm",
  }),
]);

assert.deepEqual(conditionCoverage.conditionFields, {
  velocity: 1,
  potential: 1,
  roughness: 1,
  concentration: 1,
  waterContent: 1,
  filmThickness: 1,
});

const assumedRoughnessRecord = record("#assumed-roughness", "official", {
  ...base,
  paper: { title: "Assumed Roughness Paper" },
});
assumedRoughnessRecord.extended.roughness = {
  raw: "1 nm",
  value: 1,
  unit: "nm",
  std: 1e-9,
  stdUnit: "m",
  approx: false,
};
assumedRoughnessRecord.provenance = {
  ...assumedRoughnessRecord.provenance,
  roughness: {
    basis: "assumed",
    basisNote: "default surface descriptor, not a reported test condition",
  },
};
assert.equal(
  buildCoverageSummary([assumedRoughnessRecord]).conditionFields.roughness,
  0,
  "assumed roughness does not count as reported condition coverage"
);

console.log("Tribology curation tests passed");
