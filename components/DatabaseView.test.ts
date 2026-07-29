import assert from "node:assert/strict";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  analyzeGroupConditions,
  buildDatabaseQuery,
  databaseStatusUrl,
  DatabaseView,
  filterRecordsByReadiness,
  filterSources,
  isMockExtractionRecord,
  isLoadedQueryReady,
  parseDatabaseResponse,
  pruneSelectionToDisplayed,
  recordListUnitsForStatus,
  requireOk,
  ReviewReadinessStrip,
  SEARCH_DEBOUNCE_MS,
  selectedDisplayedRecords,
  shouldShowUnitModeControl,
  splitBySystem,
  summarizeReviewReadiness,
  takeVisibleRecords,
  VISIBLE_BATCH_SIZE,
} from "./DatabaseView";
import { buildGroupConditionItems } from "./RecordCard";
import { parseQuantity } from "../lib/units";
import type { ConditionItem } from "./recordCardParts";
import type { IonicRecord } from "../lib/schema";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

assert.equal(recordListUnitsForStatus("official", "raw"), "std");
assert.equal(recordListUnitsForStatus("official", "std"), "std");
assert.equal(recordListUnitsForStatus("review", "raw"), "raw");
assert.equal(recordListUnitsForStatus("review", "std"), "std");
assert.equal(shouldShowUnitModeControl("official"), false);
assert.equal(shouldShowUnitModeControl("review"), true);
assert.equal(isMockExtractionRecord({ extraction: { source: "mock" } }), true);
assert.equal(isMockExtractionRecord({ extraction: { source: "openai-compatible" } }), false);
assert.equal(isMockExtractionRecord({}), false, "legacy records without extractor metadata remain publishable");

type ReadinessFixture = { id: string; complete: boolean; extraction?: { source?: string } };
const readinessFixtures: ReadinessFixture[] = [
  { id: "ready", complete: true, extraction: { source: "openai-compatible" } },
  { id: "incomplete", complete: false, extraction: { source: "anthropic" } },
  { id: "mock-complete", complete: true, extraction: { source: "mock" } },
  { id: "mock-incomplete", complete: false, extraction: { source: "mock" } },
];
const checkCompleteness = (record: ReadinessFixture) => ({ complete: record.complete });
assert.deepEqual(summarizeReviewReadiness(readinessFixtures, checkCompleteness), {
  all: 4,
  ready: 1,
  incomplete: 1,
  mock: 2,
});
assert.deepEqual(
  filterRecordsByReadiness(readinessFixtures, "ready", checkCompleteness).map((record) => record.id),
  ["ready"]
);
assert.deepEqual(
  filterRecordsByReadiness(readinessFixtures, "incomplete", checkCompleteness).map((record) => record.id),
  ["incomplete"],
  "Mock records never leak into the incomplete bucket"
);
assert.deepEqual(
  filterRecordsByReadiness(readinessFixtures, "mock", checkCompleteness).map((record) => record.id),
  ["mock-complete", "mock-incomplete"],
  "Mock wins regardless of core completeness"
);
assert.equal(filterRecordsByReadiness(readinessFixtures, "all", checkCompleteness), readinessFixtures);

const readinessStripHtml = renderToStaticMarkup(
  createElement(ReviewReadinessStrip, {
    summary: { all: 4, ready: 1, incomplete: 1, mock: 2 },
    active: "ready",
    onChange: () => {},
  })
);
assert.match(readinessStripHtml, /data-testid="review-readiness-strip"/);
assert.match(readinessStripHtml, /aria-label="Review readiness"/);
assert.match(readinessStripHtml, /aria-label="Ready to approve: 1"[^>]*aria-pressed="true"|aria-pressed="true"[^>]*aria-label="Ready to approve: 1"/);
assert.match(readinessStripHtml, /Needs core fields/);
assert.match(readinessStripHtml, /Mock locked/);
assert.match(readinessStripHtml, /Ready → approve/);
assert.match(readinessStripHtml, /edit missing fields/);
assert.match(readinessStripHtml, /re-extract with a live model or enter manually/);

const zeroReadinessHtml = renderToStaticMarkup(
  createElement(ReviewReadinessStrip, {
    summary: { all: 2, ready: 2, incomplete: 0, mock: 0 },
    active: "all",
    onChange: () => {},
  })
);
assert.match(zeroReadinessHtml, /aria-label="Needs core fields: 0"/);
assert.match(zeroReadinessHtml, /aria-label="Mock locked: 0"/);
assert.equal(zeroReadinessHtml.match(/disabled=""/g)?.length, 2, "zero-count readiness shortcuts stay visible but disabled");

assert.equal(SEARCH_DEBOUNCE_MS, 300);
assert.equal(VISIBLE_BATCH_SIZE, 50);
assert.equal(
  buildDatabaseQuery({ status: "review", facet: "nano", paper: "A paper", search: "  bmim pf6  " }),
  "status=review&facet=nano&paper=A+paper&search=bmim+pf6"
);
assert.equal(
  buildDatabaseQuery({ status: "official", facet: "all", paper: "all", search: "   " }),
  "status=official",
  "only committed, non-empty filters enter the server query"
);
const manyRecords = Array.from({ length: 120 }, (_, index) => ({ id: index + 1 }));
assert.deepEqual(takeVisibleRecords(manyRecords, VISIBLE_BATCH_SIZE), manyRecords.slice(0, 50));
assert.deepEqual(takeVisibleRecords(manyRecords, 100), manyRecords.slice(0, 100));
assert.equal(isLoadedQueryReady(null, "tribology?status=official", "", ""), false);
assert.equal(
  isLoadedQueryReady("tribology?status=official", "tribology?status=official", "", ""),
  true
);
assert.equal(
  isLoadedQueryReady("tribology?status=official", "tribology?status=review", "", ""),
  false,
  "old records are not interactive under a new status query"
);
assert.equal(
  isLoadedQueryReady("tribology?status=official", "tribology?status=official", "bmim", ""),
  false,
  "an uncommitted search input invalidates the loaded query"
);
const displayedSelectionFixtures = [{ id: "a" }, { id: "b" }];
const selectionWithPaginatedRecord = new Set(["a", "c"]);
assert.deepEqual(
  selectedDisplayedRecords(displayedSelectionFixtures, selectionWithPaginatedRecord).map((record) => record.id),
  ["a"],
  "bulk records come only from the current pagination slice"
);
assert.deepEqual(
  [...pruneSelectionToDisplayed(selectionWithPaginatedRecord, displayedSelectionFixtures)],
  ["a"],
  "pagination-hidden selections are removed"
);
assert.equal(
  databaseStatusUrl("http://localhost/tribology/database?source=paper#records", "review"),
  "/tribology/database?source=paper&status=review#records"
);

const officialHtml = renderToStaticMarkup(createElement(DatabaseView, { domain: "tribology" }));

assert.match(officialHtml, /Checked Database/);
assert.doesNotMatch(officialHtml, />Official</);
assert.match(officialHtml, /data-testid="database-workbench-shell"/);
assert.match(officialHtml, /data-testid="database-command-bar"/);
assert.match(officialHtml, /rounded-\[8px\]/);
assert.match(officialHtml, /Export visible \(0\)/);
assert.match(officialHtml, /disabled=""/, "empty visible sets cannot be exported");
assert.doesNotMatch(officialHtml, /data-testid="review-readiness-strip"/, "readiness is Review-only");
assert.doesNotMatch(officialHtml, /As reported/);
assert.doesNotMatch(officialHtml, /Standardized/);

/* ---- source filter: searchable combobox replaces the flat <select> ---- */

assert.match(officialHtml, /data-testid="source-filter"/);
assert.match(officialHtml, /All sources/);
// popover is closed by default — the option list only mounts on open
assert.doesNotMatch(officialHtml, /data-testid="source-filter-popover"/);

const sourceFixtures = [
  { title: "Ionic liquid lubrication: influence of ion structure", n: 44 },
  { title: "Potential-dependent superlubricity of stainless steel", n: 12 },
  { title: "Boundary layer friction of solvate ionic liquids", n: 15 },
];
assert.deepEqual(filterSources(sourceFixtures, ""), sourceFixtures);
assert.deepEqual(filterSources(sourceFixtures, "   "), sourceFixtures);
assert.deepEqual(
  filterSources(sourceFixtures, "superlubricity").map((p) => p.n),
  [12]
);
// every token must match, regardless of order or case
assert.deepEqual(
  filterSources(sourceFixtures, "Liquid IONIC").map((p) => p.n),
  [44, 15]
);
assert.deepEqual(filterSources(sourceFixtures, "graphene"), []);

console.log("DatabaseView source filter tests passed");

async function testDatabaseResponseParsing() {
  const parsed = await parseDatabaseResponse(
    new Response(
      JSON.stringify({
        records: [{ id: "r1" }],
        counts: { official: 1, review: 2 },
        papers: [{ title: "Paper", n: 1 }],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    )
  );
  assert.equal(parsed.records.length, 1);
  assert.deepEqual(parsed.counts, { official: 1, review: 2 });
  await assert.rejects(
    () => parseDatabaseResponse(new Response("<!doctype html><h1>404</h1>", { status: 404 })),
    /Database API returned 404/
  );
  await requireOk(new Response(null, { status: 204 }), "unused fallback");
  await assert.rejects(
    () => requireOk(new Response(JSON.stringify({ error: "Mutation rejected" }), { status: 422 }), "fallback"),
    /Mutation rejected/
  );
  await assert.rejects(
    () => requireOk(new Response("not json", { status: 500 }), "Readable fallback"),
    /Readable fallback/
  );
}

testDatabaseResponseParsing()
  .then(() => console.log("DatabaseView standardized official-mode tests passed"))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

/* ---- group condition analysis: shared values carry the group's single evidence link ---- */

type FakeRecord = { id: string; sourceId?: string; items: ConditionItem[] };
const itemsOf = (r: FakeRecord) => r.items;
const velocityProv = { page: 4, quote: "At a sliding velocity of 150 nm/s" };

// A potential sweep: velocity identical on every record, but cited only on the SECOND one.
const sweep: FakeRecord[] = [
  {
    id: "#A",
    sourceId: "src-1",
    items: [
      { label: "Velocity", value: "150 nm/s" },
      { label: "Potential", value: "OCP" },
      { label: "Temp", value: "25 °C" },
    ],
  },
  {
    id: "#B",
    sourceId: "src-1",
    items: [
      { label: "Velocity", value: "150 nm/s", prov: velocityProv, field: "velocity" },
      { label: "Potential", value: "OCP+0.5 V" },
      { label: "Temp", value: "25 °C" },
    ],
  },
  {
    id: "#C",
    sourceId: "src-1",
    items: [
      { label: "Velocity", value: "150 nm/s" },
      { label: "Potential", value: "OCP+1.0 V" },
    ],
  },
];

{
  const { shared, varying } = analyzeGroupConditions(sweep, itemsOf);

  const velocity = shared.find((s) => s.item.label === "Velocity");
  assert.ok(velocity, "a value identical across the sweep is shared");
  assert.equal(velocity.recordId, "#B", "the evidence link comes from the record that actually cites it");
  assert.equal(velocity.sourceId, "src-1");
  assert.equal(velocity.item.prov, velocityProv, "the shared chip carries that record's provenance");
  assert.equal(velocity.coverage, 3);

  const temp = shared.find((s) => s.item.label === "Temp");
  assert.ok(temp, "a value stated on only part of the group still shares (with coverage)");
  assert.equal(temp.coverage, 2, "coverage counts the records that state it");
  assert.equal(temp.total, 3);

  assert.deepEqual(
    varying.map((v) => v.label),
    ["Potential"],
    "only genuinely differing conditions are sweep axes"
  );
  assert.deepEqual(varying[0].values, ["OCP", "OCP+0.5 V", "OCP+1.0 V"], "distinct values in first-encounter order");
}

{
  const { shared, varying } = analyzeGroupConditions([sweep[0]], itemsOf);
  assert.deepEqual(shared, [], "a single record has no collective context");
  assert.deepEqual(varying, []);
}

console.log("DatabaseView group condition analysis tests passed");

/* ---- tribology group items: tribosystem context joins the condition chips ---- */

{
  const record: IonicRecord = {
    id: "#G1",
    status: "review",
    createdAt: "2026-06-10T00:00:00.000Z",
    paper: { title: "Sweep paper" },
    core: {
      ionicLiquid: { cation: "[BMIM]", anion: "[PF6]" },
      substrate: "mica",
      temperature: parseQuantity("25 °C", "temperature"),
      load: parseQuantity("5 nN", "force"),
      cof: 0.04,
    },
    extended: {
      method: "AFM",
      probe: "silica",
      probeType: "Colloid · Ø 5 μm",
      velocity: parseQuantity("150 nm/s", "velocity") ?? undefined,
      afm: { scanRate: "1 Hz" },
    },
    flexible: [],
    sourceId: "src-9",
    provenance: {
      substrate: { page: 2, quote: "mica surfaces" },
      probe: { page: 14, quote: "A silica colloid" },
      velocity: { page: 4, quote: "at 150 nm/s" },
    },
  };
  const items = buildGroupConditionItems(record, "raw");
  const labels = items.map((i) => i.label);
  assert.deepEqual(labels, ["Substrate", "Probe", "Method", "Load", "Temp", "Velocity", "Scan rate"]);
  assert.equal(items[0].field, "substrate");
  assert.equal(items[0].prov?.page, 2, "substrate carries its provenance into the group analysis");
  assert.equal(items[1].value, "silica · Colloid · Ø 5 μm", "probe and probeType combine like the card label");
  assert.equal(items.find((i) => i.label === "Velocity")?.prov?.page, 4);
}

console.log("DatabaseView tribology group condition item tests passed");

/* ---- system sub-grouping: a paper comparing systems splits, sweeps don't ---- */

type FacetRecord = { id: string; sourceId?: string; facets: ConditionItem[] };
const facetsOf = (r: FacetRecord) => r.facets;
const ions = (rest: ConditionItem[]): ConditionItem[] => [
  { label: "Cation", value: "[BMIm]" },
  { label: "Anion", value: "[AOT]" },
  ...rest,
];

{
  // two substrates, same IL — the substrate paper splits into two systems
  const substrateProv = { page: 2, quote: "stainless steel disks" };
  const records: FacetRecord[] = [
    { id: "#1", sourceId: "s", facets: ions([{ label: "Substrate", value: "Au(1 1 1)", prov: { page: 2 }, field: "substrate" }]) },
    { id: "#2", sourceId: "s", facets: ions([{ label: "Substrate", value: "Au(1 1 1)" }]) },
    { id: "#3", sourceId: "s", facets: ions([{ label: "Substrate", value: "stainless steel" }]) },
    { id: "#4", sourceId: "s", facets: ions([{ label: "Substrate", value: "stainless steel", prov: substrateProv, field: "substrate" }]) },
  ];
  const subgroups = splitBySystem(records, facetsOf);
  assert.equal(subgroups.length, 2, "one sub-group per distinct system");
  assert.deepEqual(subgroups[0].records.map((r: FacetRecord) => r.id), ["#1", "#2"], "first-encounter order");
  assert.deepEqual(subgroups[1].records.map((r: FacetRecord) => r.id), ["#3", "#4"]);

  assert.deepEqual(subgroups[0].facets.map((f) => f.item.label), ["Substrate"], "only the DIFFERING facet heads the sub-group — constant ions stay out");
  assert.equal(subgroups[1].facets[0].item.value, "stainless steel");
  assert.equal(subgroups[1].facets[0].recordId, "#4", "facet evidence comes from the sub-group record that cites it");
  assert.equal(subgroups[1].facets[0].item.prov, substrateProv);
}

{
  // one system → single headerless sub-group (renders exactly as before)
  const records: FacetRecord[] = [
    { id: "#1", facets: ions([{ label: "Substrate", value: "mica" }]) },
    { id: "#2", facets: ions([{ label: "Substrate", value: "mica" }]) },
  ];
  const subgroups = splitBySystem(records, facetsOf);
  assert.equal(subgroups.length, 1);
  assert.deepEqual(subgroups[0].facets, [], "a single system has nothing to distinguish");
  assert.equal(subgroups[0].records.length, 2);
}

{
  // an anion-comparison paper splits per IL
  const records: FacetRecord[] = [
    { id: "#1", facets: [{ label: "Cation", value: "[N88812]" }, { label: "Anion", value: "[A4BMB]" }, { label: "Substrate", value: "HOPG" }] },
    { id: "#2", facets: [{ label: "Cation", value: "[N88812]" }, { label: "Anion", value: "[A8BMB]" }, { label: "Substrate", value: "HOPG" }] },
    { id: "#3", facets: [{ label: "Cation", value: "[N88812]" }, { label: "Anion", value: "[A8BMB]" }, { label: "Substrate", value: "HOPG" }] },
  ];
  const subgroups = splitBySystem(records, facetsOf);
  assert.equal(subgroups.length, 2);
  assert.deepEqual(subgroups.map((s) => s.facets.map((f) => `${f.item.label}=${f.item.value}`)), [["Anion=[A4BMB]"], ["Anion=[A8BMB]"]]);
  assert.equal(subgroups[1].records.length, 2);
}

console.log("DatabaseView system sub-grouping tests passed");
