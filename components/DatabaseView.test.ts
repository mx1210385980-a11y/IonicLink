import assert from "node:assert/strict";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  analyzeGroupConditions,
  GroupConditionsStrip,
  buildDatabaseQuery,
  databaseStatusUrl,
  defaultUnitModeForDomain,
  DatabaseView,
  filterSources,
  isMockExtractionRecord,
  isLoadedQueryReady,
  parseDatabaseResponse,
  pruneSelectionToDisplayed,
  recordListUnitsForStatus,
  requireOk,
  SEARCH_DEBOUNCE_MS,
  selectedDisplayedRecords,
  shouldShowUnitModeControl,
  splitBySystem,
  takeVisibleRecords,
  VISIBLE_BATCH_SIZE,
} from "./DatabaseView";
import { tribologyClientModule } from "./database/TribologyDatabaseView";
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
assert.equal(defaultUnitModeForDomain("conductivity"), "std");
assert.equal(defaultUnitModeForDomain("diffusion"), "raw");
assert.equal(defaultUnitModeForDomain("tribology"), "raw");
assert.equal(isMockExtractionRecord({ extraction: { source: "mock" } }), true);
assert.equal(isMockExtractionRecord({ extraction: { source: "openai-compatible" } }), false);
assert.equal(isMockExtractionRecord({}), false, "legacy records without extractor metadata remain publishable");

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
assert.equal(
  buildDatabaseQuery({
    status: "official",
    facet: "all",
    paper: "all",
    search: "",
    structure: { smiles: "F[P-](F)(F)(F)(F)F", target: "anion", mode: "exact" },
  }),
  "status=official&structureSmiles=F%5BP-%5D%28F%29%28F%29%28F%29%28F%29F&structureTarget=anion&structureMode=exact"
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

const officialHtml = renderToStaticMarkup(
  createElement(DatabaseView, { domain: "tribology", clientModule: tribologyClientModule })
);

assert.match(officialHtml, /Checked Database/);
assert.doesNotMatch(officialHtml, />Official</);
assert.match(officialHtml, /data-testid="database-workbench-shell"/);
assert.match(officialHtml, /data-testid="database-command-bar"/);
assert.match(officialHtml, /data-testid="analysis-toolbar"/);
assert.match(officialHtml, /aria-label="Database view"/);
assert.match(officialHtml, /Export visible \(0\)/);
assert.match(officialHtml, /disabled=""/, "empty visible sets cannot be exported");
assert.doesNotMatch(officialHtml, /data-testid="review-readiness-strip"/);
assert.doesNotMatch(officialHtml, /Approved library records only/);
assert.doesNotMatch(officialHtml, /AI-extracted candidates awaiting approval/);
assert.match(officialHtml, /aria-label="Analysis units"/);
assert.match(officialHtml, /Snapshot JSON/);

const reviewHtml = renderToStaticMarkup(
  createElement(DatabaseView, {
    domain: "tribology",
    clientModule: tribologyClientModule,
    initialData: {
      queryKey: "tribology?status=review",
      status: "review",
      records: [],
      counts: { official: 0, review: 0 },
      papers: [],
    },
  })
);
assert.match(reviewHtml, /Review Queue/);
assert.match(reviewHtml, /data-testid="database-command-bar"/);
assert.doesNotMatch(reviewHtml, /Review readiness/i);
assert.doesNotMatch(reviewHtml, /Ready to approve/);

const hydratedOfficialHtml = renderToStaticMarkup(
  createElement(DatabaseView, {
    domain: "tribology",
    clientModule: tribologyClientModule,
    initialData: {
      queryKey: "tribology?status=official",
      status: "official",
      records: [{
        id: "prefetched-record",
        status: "official",
        createdAt: "2026-08-26T00:00:00.000Z",
        paper: { title: "Prefetched paper" },
        core: {
          ionicLiquid: { cation: "[BMIM]", anion: "[PF6]" },
          substrate: "mica",
          temperature: { raw: "298 K", value: 298, unit: "K", std: 298, stdUnit: "K" },
          load: { raw: "5 nN", value: 5, unit: "nN", std: 5e-9, stdUnit: "N" },
          cof: 0.08,
        },
        extended: { scale: "nano" },
        flexible: [],
      }],
      counts: { official: 1, review: 2 },
      papers: [{ title: "Prefetched paper", n: 1 }],
    },
  })
);
assert.match(hydratedOfficialHtml, /Export visible \(1\)/, "server-prefetched records render in the first HTML response");
assert.match(hydratedOfficialHtml, /Checked Database[^]*1/, "server-prefetched queue counts avoid the zero-state flash");
assert.doesNotMatch(hydratedOfficialHtml, /Loading database records/, "prefetched HTML does not fall back to the loading shell");

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

assert.doesNotMatch(hydratedOfficialHtml, /curated readings|>checked</);
assert.match(hydratedOfficialHtml, /<details[^>]*>[\s\S]*Statistics/);
assert.match(hydratedOfficialHtml, /aria-label="Database table"/);
assert.match(hydratedOfficialHtml, /Prefetched paper/);
assert.doesNotMatch(hydratedOfficialHtml, /Clear filters/);

// Compare values against their own record, and never imply missing conditions are shared.
{
  const rows = [
    { id: "#a", items: [{ label: "Potential", value: "0.5 V" }, { label: "Load", value: "5 nN" }] },
    { id: "#b", items: [{ label: "Potential", value: "-0.5 V" }, { label: "Load", value: "5 nN" }] },
    { id: "#c", items: [] },
  ];
  const html = renderToStaticMarkup(createElement(GroupConditionsStrip, {
    records: rows, itemsOf: (record) => record.items, domain: "tribology",
  }));
  assert.match(html, /Varies by record/);
  assert.match(html, /#a<[^]*?0\.5 V/);
  assert.match(html, /#b<[^]*?-0\.5 V/);
  assert.match(html, /Not reported/);
  assert.match(html, /Reported in 2 of 3 records/);
  assert.doesNotMatch(html, /0\.5 V · -0\.5 V/);
}
