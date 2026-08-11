import assert from "node:assert/strict";
import {
  applyRecordFilters,
  confinedSystemOptions,
  countActiveFilters,
  EMPTY_FILTERS,
  hasActiveFilters,
  ionKeyOf,
  ionOptions,
  numericExtent,
  recordLoadN,
  recordTempK,
  surfaceOptions,
  type RecordFilters,
} from "./recordFilters";

function quantity(value: number, stdUnit: string) {
  return { raw: `${value} ${stdUnit}`, value, unit: stdUnit, std: value, stdUnit };
}

/* ---- diffusion confined-system geometry uses the illustration's mode categories ---- */
{
  const diffusionRecords = [
    { id: "#d1", core: { ionicLiquid: { cation: "[EMIM]", anion: "[TFSI]" }, temperature: quantity(298, "K") }, extended: { geometry: "carbon nanotube" }, flexible: [] },
    { id: "#d2", core: { ionicLiquid: { cation: "[BMIM]", anion: "[BF4]" }, temperature: quantity(298, "K") }, extended: { geometry: "slit pore" }, flexible: [] },
    { id: "#d3", core: { ionicLiquid: { cation: "[PYR14]", anion: "[TFSI]" }, temperature: quantity(298, "K") }, extended: { geometry: "MOF framework" }, flexible: [] },
    { id: "#d4", core: { ionicLiquid: { cation: "[PYR14]", anion: "[TFSI]" }, temperature: quantity(298, "K") }, extended: { geometry: "another nanotube" }, flexible: [] },
  ];
  const options = confinedSystemOptions(diffusionRecords);
  assert.equal(options.find((option) => option.key === "1D")?.count, 2);
  assert.equal(options.find((option) => option.key === "2D")?.label, "2D slit");
  assert.equal(options.find((option) => option.key === "3D-Cage")?.label, "3D cage");

  const filtered = applyRecordFilters("diffusion", diffusionRecords, { ...EMPTY_FILTERS, confinedSystems: ["1D"] });
  assert.deepEqual(filtered.map((record) => record.id), ["#d1", "#d4"]);
}

let n = 0;
function rec(opts: { cation: string; anion: string; substrate?: string; loadN?: number | null; tempK?: number | null }) {
  n += 1;
  return {
    id: `#f${n}`,
    status: "official",
    paper: { title: `P${n}` },
    core: {
      ionicLiquid: { cation: opts.cation, anion: opts.anion },
      substrate: opts.substrate ?? "mica",
      temperature: opts.tempK === null ? null : quantity(opts.tempK ?? 298.15, "K"),
      load: opts.loadN === null ? null : quantity(opts.loadN ?? 1e-7, "N"),
      cof: 0.05,
    },
    extended: {},
    flexible: [],
  };
}

const RECORDS = [
  rec({ cation: "[BMIm]", anion: "[TFSI]", substrate: "mica", loadN: 1e-8, tempK: 293.15 }),
  rec({ cation: "[C4C1Im]", anion: "[NTf2]", substrate: "Au(1 1 1)", loadN: 1e-6, tempK: 298.15 }),
  rec({ cation: "[EMIM]", anion: "[TFSI]", substrate: "HOPG", loadN: 2e-3, tempK: 298.15 }),
  rec({ cation: "[EMIM]", anion: "[EtSO4]", substrate: "mica", loadN: null, tempK: 350 }),
  rec({ cation: "P6,6,6,14", anion: "[A4BMB]", substrate: "stainless steel", loadN: 5e-7, tempK: null }),
];

/* ---- options: raw spellings collapse to one canonical entry ---- */
{
  const cations = ionOptions(RECORDS, "cation");
  const bmim = cations.find((o) => o.key === ionKeyOf("[BMIM]", "cation"));
  assert.ok(bmim, "canonical BMIM option exists");
  assert.equal(bmim?.count, 2, "[BMIm] and [C4C1Im] are ONE cation option");
  assert.equal(cations.find((o) => o.key === ionKeyOf("[EMIM]", "cation"))?.count, 2);
  assert.ok(cations[0].count >= cations[cations.length - 1].count, "most frequent first");

  const anions = ionOptions(RECORDS, "anion");
  const tfsi = anions.find((o) => o.key === ionKeyOf("[TFSI]", "anion"));
  assert.equal(tfsi?.count, 3, "[TFSI] and [NTf2] are ONE anion option");

  const surfaces = surfaceOptions("tribology", RECORDS);
  assert.equal(surfaces.find((o) => o.label === "mica")?.count, 2);
  assert.ok(surfaces.some((o) => o.label.includes("Au")));
}

/* ---- empty filters pass everything through (same reference) ---- */
{
  assert.equal(hasActiveFilters(EMPTY_FILTERS), false);
  assert.equal(applyRecordFilters("tribology", RECORDS, EMPTY_FILTERS), RECORDS);
}

/* ---- ion filters match across raw spellings ---- */
{
  const f: RecordFilters = { ...EMPTY_FILTERS, cations: [ionKeyOf("[BMIM]", "cation")] };
  const out = applyRecordFilters("tribology", RECORDS, f);
  assert.equal(out.length, 2);
  assert.ok(out.every((r) => ["[BMIm]", "[C4C1Im]"].includes(r.core.ionicLiquid.cation)));

  const f2: RecordFilters = { ...EMPTY_FILTERS, anions: [ionKeyOf("[NTf2]", "anion")] };
  assert.equal(applyRecordFilters("tribology", RECORDS, f2).length, 3);

  // AND across groups
  const f3: RecordFilters = { ...f, anions: [ionKeyOf("[TFSI]", "anion")] };
  assert.equal(applyRecordFilters("tribology", RECORDS, f3).length, 2);
}

/* ---- substrate filter ---- */
{
  const surfaces = surfaceOptions("tribology", RECORDS);
  const mica = surfaces.find((o) => o.label === "mica")!;
  const f: RecordFilters = { ...EMPTY_FILTERS, surfaces: [mica.key] };
  const out = applyRecordFilters("tribology", RECORDS, f);
  assert.equal(out.length, 2);
  assert.ok(out.every((r) => r.core.substrate === "mica"));
}

/* ---- load window: SI bounds, missing values excluded while a window is set ---- */
{
  const min: RecordFilters = { ...EMPTY_FILTERS, loadMinN: 1e-7 };
  assert.deepEqual(
    applyRecordFilters("tribology", RECORDS, min).map((r) => recordLoadN(r)),
    [1e-6, 2e-3, 5e-7],
    "null-load record is excluded by a bounded window"
  );
  const both: RecordFilters = { ...EMPTY_FILTERS, loadMinN: 1e-8, loadMaxN: 1e-6 };
  assert.equal(applyRecordFilters("tribology", RECORDS, both).length, 3, "inclusive bounds");
  assert.equal(countActiveFilters(both), 1, "a range counts as one active filter group");
}

/* ---- temperature window ---- */
{
  const f: RecordFilters = { ...EMPTY_FILTERS, tempMinK: 295, tempMaxK: 300 };
  const out = applyRecordFilters("tribology", RECORDS, f);
  assert.equal(out.length, 2);
  assert.ok(out.every((r) => (recordTempK(r) as number) >= 295 && (recordTempK(r) as number) <= 300));
}

/* ---- extents ---- */
{
  const loads = numericExtent(RECORDS, recordLoadN);
  assert.deepEqual(loads, [1e-8, 2e-3]);
  const temps = numericExtent(RECORDS, recordTempK);
  assert.deepEqual(temps, [293.15, 350]);
  assert.equal(numericExtent([], recordLoadN), null);
}

/* ---- conductivity surfaces come from core.surface ---- */
{
  const cRecords = [
    { id: "#c1", core: { ionicLiquid: { cation: "[BMIM]", anion: "[BF4]" }, surface: "Pt", temperature: quantity(298, "K") }, extended: {}, flexible: [] },
    { id: "#c2", core: { ionicLiquid: { cation: "[PYR14]", anion: "[TFSI]" }, surface: "glassy carbon", temperature: quantity(353, "K") }, extended: {}, flexible: [] },
  ];
  const opts = surfaceOptions("conductivity", cRecords);
  assert.equal(opts.length, 2);
  const f: RecordFilters = { ...EMPTY_FILTERS, surfaces: [opts.find((o) => o.label === "Pt")!.key] };
  assert.equal(applyRecordFilters("conductivity", cRecords, f).length, 1);
}

console.log("recordFilters tests passed");
