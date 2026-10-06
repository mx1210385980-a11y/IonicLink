import assert from "node:assert/strict";
import { parseQuantity, type Quantity } from "@/lib/units";
import { EMPTY_FILTERS } from "@/components/recordFilters";
import { getAnalysisFields } from "./analysisFields";
import type { AnalysisRecord } from "./analysisTypes";
import {
  applyAnalysisFilters, buildAnalysisUrl, defaultAnalysisState, hasAnalysisFilters,
  parseAnalysisState, parseRecordFilters, readDatabaseLocation,
  type AnalysisState, type DatabaseLocation,
} from "./analysisState";

const defaults = defaultAnalysisState("tribology");
const complete: DatabaseLocation = {
  status: "review", facet: "nano", paper: "Gold & graphite: α + β", search: "[BMIM] friction",
  structure: { smiles: "C[N+]1=CC=CN1C", target: "cation", mode: "exact" },
  filters: {
    cations: ["bmim", "emim"], anions: ["tfsi"], surfaces: ["au(111)", "hopg"], surfaceQuery: "gold (111)",
    confinedSystems: ["1D", "2D", "3D-Cage", "Membrane", "0D-Pools", "Gyroid"],
    loadMinN: 1e-9, loadMaxN: 5e-8, tempMinK: 293.15, tempMaxK: 320,
  },
  analysis: {
    ...defaults, view: "plot", density: "comfortable", units: "raw", columns: ["id", "cation", "metric", "load", "temperature"],
    sort: { key: "metric", direction: "desc" },
    plot: { x: "load", y: "metric", logX: true, logY: false, groupBy: "paper" },
    constraints: [{ field: "metric", min: 0, max: 0.12, missing: "present" }, { field: "velocity", min: null, max: 1e-5, missing: "any" }],
    evidence: "direct", method: "AFM", context: "100 ppm", plotIds: ["paper-1/point-2", "paper-2/point-3"],
    groupByPaper: false, conditionsOverview: true,
  },
};
const locationUrl = (location: DatabaseLocation) => new URL(buildAnalysisUrl("https://ioniclink.test/tribology/database?campaign=lab&facet=macro&search=old#records", location), "https://ioniclink.test");
const url = locationUrl(complete);
assert.equal(url.searchParams.get("campaign"), "lab", "Unrelated location parameters survive changing the database view");
assert.equal(url.hash, "#records");
assert.equal(url.searchParams.getAll("search").length, 1);
assert.deepEqual(readDatabaseLocation(url.search, "tribology"), complete, "A shared URL restores the entire experiment query and display settings");
const fromJson = JSON.parse(JSON.stringify(complete)) as DatabaseLocation;
assert.deepEqual(readDatabaseLocation(locationUrl(fromJson).search, "tribology"), complete, "Snapshot JSON and URL restoration agree");
assert.deepEqual(parseAnalysisState(JSON.parse(JSON.stringify(complete.analysis)), "tribology"), complete.analysis);

for (const malformed of [null, undefined, [], "not json", 42, { version: 99, view: "plot", units: "raw" }]) {
  assert.deepEqual(parseAnalysisState(malformed, "tribology"), defaults);
}
const brokenUrl = readDatabaseLocation("?analysis=%7Bbroken&status=invalid&structureSmiles=C.C&structureTarget=anion", "tribology");
assert.deepEqual(brokenUrl.analysis, defaults);
assert.deepEqual(brokenUrl.filters, EMPTY_FILTERS);
assert.equal(brokenUrl.status, "official");
assert.equal(brokenUrl.structure, null);
assert.equal(readDatabaseLocation("?structureSmiles=CC&structureTarget=unknown", "tribology").structure, null);
const sanitized = parseAnalysisState({
  version: 1, view: "spreadsheet", density: "giant", units: "imperial", evidence: "guessed",
  columns: ["id", "metric", "DROP TABLE", "metric", 7], sort: { key: "bad", direction: "sideways" },
  plot: { x: "cation", y: "unknown", groupBy: "scale" },
  constraints: [{ field: "cation", min: 3 }, { field: "metric", min: NaN, max: Infinity, missing: "other" }, { field: "unknown", min: 1 }],
  plotIds: ["a", "a", 4], method: 12, context: [],
}, "tribology");
assert.deepEqual(sanitized.columns, ["id", "metric"]);
assert.deepEqual(sanitized.sort, { key: "id", direction: "asc" });
assert.equal(sanitized.plot.x, defaults.plot.x);
assert.equal(sanitized.plot.y, defaults.plot.y);
assert.equal(sanitized.plot.groupBy, "method");
assert.deepEqual(sanitized.constraints, [{ field: "metric", min: null, max: null, missing: "any" }]);
assert.equal(sanitized.view, "table");
assert.equal(sanitized.units, "std");
assert.equal(sanitized.evidence, "all");
assert.deepEqual(sanitized.plotIds, ["a"]);
const filters = parseRecordFilters({
  cations: ["bmim", "bmim", 12], anions: null, surfaces: ["gold"], surfaceQuery: 17,
  confinedSystems: ["1D", "2D", "3D-Cage", "Membrane", "0D-Pools", "Gyroid", "3D", "pore", "gyroid"],
  loadMinN: NaN, loadMaxN: Infinity, tempMinK: "293", tempMaxK: 323,
});
assert.deepEqual(filters.cations, ["bmim"]);
assert.deepEqual(filters.confinedSystems, ["1D", "2D", "3D-Cage", "Membrane", "0D-Pools", "Gyroid"]);
assert.equal(filters.loadMinN, null);
assert.equal(filters.loadMaxN, null);
assert.equal(filters.tempMinK, null);
assert.equal(filters.tempMaxK, 323);

for (const selection of [[], null] as const) {
  const state = { ...defaults, plotIds: selection === null ? null : [] };
  const location = { ...complete, analysis: state };
  const restored = readDatabaseLocation(locationUrl(location).search, "tribology");
  assert.deepEqual(restored.analysis.plotIds, selection, "An empty brush result must not be turned into an unfiltered view");
  assert.equal(hasAnalysisFilters(restored.analysis), selection !== null);
}

function point(id: string, load: Quantity | null, cof: number | null = 0.1, overrides: Partial<AnalysisRecord> = {}): AnalysisRecord {
  return {
    id, status: "official", createdAt: "2026-09-12", paper: { title: "AFM series", year: 2026 },
    core: { cof, load, ionicLiquid: { cation: "[BMIM]", anion: "[TFSI]" } },
    extended: { method: "AFM", waterContent: "100 ppm", concentration: "1 mol/L", additives: "graphene" }, flexible: [],
    provenance: { cof: { basis: "direct" }, temperature: { basis: "assumed" } }, ...overrides,
  };
}
const fieldList = getAnalysisFields("tribology");
const all = [
  point("exact-lower", parseQuantity("5 nN", "force")), point("exact-upper", parseQuantity("10 nN", "force")),
  point("contained-range", parseQuantity("6–9 nN", "force")), point("overlap-only", parseQuantity("1–8 nN", "force")),
  point("above", parseQuantity("20 nN", "force")), point("open-ended", parseQuantity(">7 nN", "force")),
  point("approximate", parseQuantity("~7 nN", "force")), point("missing", null),
];
const bounded: AnalysisState = { ...defaults, constraints: [{ field: "load", min: 5e-9, max: 1e-8, missing: "any" }] };
assert.deepEqual(applyAnalysisFilters(all, fieldList, bounded).map((item) => item.id), ["exact-lower", "exact-upper", "contained-range"], "A stored range endpoint inside the query is insufficient; the entire interval must fit");
assert.equal(applyAnalysisFilters(all, fieldList, defaults).length, all.length, "Unbounded queries retain qualified and missing measurements");
const missingOnly = { ...defaults, constraints: [{ field: "load", min: null, max: null, missing: "missing" as const }] };
assert.deepEqual(applyAnalysisFilters(all, fieldList, missingOnly).map((item) => item.id), ["missing"]);
const numeric = [point("zero", null, 0), point("finite", null, 0.2), point("nan", null, NaN), point("null", null, null)];
assert.deepEqual(applyAnalysisFilters(numeric, fieldList, { ...defaults, constraints: [{ field: "metric", min: 0, max: 0, missing: "present" }] }).map((item) => item.id), ["zero"]);
assert.deepEqual(applyAnalysisFilters(numeric, fieldList, { ...defaults, constraints: [{ field: "metric", min: null, max: null, missing: "missing" }] }).map((item) => item.id), ["nan", "null"]);

const mixed = [
  point("direct-metric", null),
  point("assumed-metric", null, 0.1, { provenance: { cof: { basis: "assumed" }, temperature: { basis: "direct" } } }),
  point("inferred-metric", null, 0.1, { provenance: { cof: { basis: "inferred" } } }),
  point("legacy", null, 0.1, { provenance: { cof: { page: 3, quote: "Measured COF = 0.1" } } }),
  point("other-method", null, 0.1, { extended: { method: "Tribometer", waterContent: "100 ppm", additives: "graphene" } }),
];
assert.deepEqual(applyAnalysisFilters(mixed, fieldList, { ...defaults, evidence: "direct", method: "AFM", context: "PPM GRAPHENE" }).map((item) => item.id), ["direct-metric"], "Evidence applies to the primary measurement; composition terms are AND-matched without case sensitivity");
assert.deepEqual(applyAnalysisFilters(mixed, fieldList, { ...defaults, evidence: "unassessed" }).map((item) => item.id), ["legacy"]);
for (const domain of ["conductivity", "diffusion"] as const) {
  const candidate = point(domain, null, null, { provenance: { cof: { basis: "assumed" }, [domain]: { basis: "direct" } } });
  assert.equal(applyAnalysisFilters([candidate], getAnalysisFields(domain), { ...defaultAnalysisState(domain), evidence: "direct" }).length, 1, `${domain} evidence must use its own metric provenance key`);
}

// Clearing query constraints should preserve the user's chosen way of viewing data.
const presentationOnly: AnalysisState = { ...complete.analysis, constraints: [], evidence: "all", method: "", context: "", plotIds: null };
assert.equal(hasAnalysisFilters(presentationOnly), false);
assert.equal(hasAnalysisFilters({ ...presentationOnly, context: " \t " }), false);
assert.equal(hasAnalysisFilters({ ...presentationOnly, constraints: [{ field: "metric", min: null, max: null, missing: "any" }] }), false);
const cleared: DatabaseLocation = { ...complete, facet: "all", paper: "all", search: "", structure: null, filters: { ...EMPTY_FILTERS }, analysis: presentationOnly };
const clearedUrl = locationUrl(cleared);
for (const key of ["facet", "paper", "search", "structureSmiles", "structureTarget", "structureMode"]) assert.equal(clearedUrl.searchParams.has(key), false);
const restoredClear = readDatabaseLocation(clearedUrl.search, "tribology");
assert.deepEqual(restoredClear, cleared);
assert.equal(restoredClear.analysis.view, "plot");
assert.equal(restoredClear.analysis.units, "raw");
assert.deepEqual(restoredClear.analysis.sort, complete.analysis.sort);
console.log("Analysis state URL, validation, scientific filters and reset-semantics tests passed");
