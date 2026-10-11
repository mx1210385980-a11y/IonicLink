import assert from "node:assert/strict";
import { parseQuantity } from "@/lib/units";
import type { Domain } from "@/lib/domain";
import { defaultColumns, defaultPlotConfig, getAnalysisFields, sortAnalysisRecords } from "./analysisFields";
import type { AnalysisRecord } from "./analysisTypes";

const record = (id: string, cof: number | null, overrides: Partial<AnalysisRecord> = {}): AnalysisRecord => ({
  id, status: "official", createdAt: "2026-09-12", paper: { title: "Paper", year: 2026 },
  core: { cof, ionicLiquid: { cation: "[BMIM]", anion: "[Tf2N]" }, temperature: parseQuantity("25 °C", "temperature"), load: parseQuantity("10 nN", "force") },
  extended: { velocity: parseQuantity("4 µm/s", "velocity"), waterContent: "100 ppm", additives: "1 wt% additive" }, flexible: [], ...overrides,
});
const tribology = getAnalysisFields("tribology");
const find = (key: string, domain: Domain = "tribology") => {
  const field = getAnalysisFields(domain).find((candidate) => candidate.key === key);
  assert.ok(field, `Missing ${domain} field ${key}`);
  return field;
};
const records = [record("r10", 10), record("missing", null), record("r2", 2), record("nan", NaN), record("zero", 0)];
assert.deepEqual(sortAnalysisRecords(records, tribology, { key: "metric", direction: "asc" }).map((item) => item.id), ["zero", "r2", "r10", "missing", "nan"]);
assert.deepEqual(sortAnalysisRecords(records, tribology, { key: "metric", direction: "desc" }).map((item) => item.id), ["r10", "r2", "zero", "missing", "nan"]);
assert.equal(records[0].id, "r10", "Sorting must leave the input list unchanged");
assert.deepEqual(sortAnalysisRecords([record("first", 2), record("second", 2)], tribology, { key: "metric", direction: "desc" }).map((item) => item.id), ["first", "second"]);

const sample = record("r1", 0.1);
assert.equal(find("cation").format(sample, "raw"), "[BMIM]");
assert.equal(find("cation").getValue(sample), find("cation").getValue(record("alias", 0.1, { core: { ionicLiquid: { cation: "[C4C1Im]" } } })));
assert.equal(find("anion").getValue(sample), find("anion").getValue(record("alias", 0.1, { core: { ionicLiquid: { anion: "[TFSI]" } } })));
assert.equal(find("temperature").getValue(sample), 298.15);
assert.equal(find("temperature").format(sample, "raw"), "25 °C");
assert.match(find("temperature").format(sample, "std"), /298.*K/);
assert.equal(find("load").getValue(sample), 1e-8);
assert.equal(find("velocity").getValue(sample), 4e-6);
assert.equal(find("waterContent").format(sample, "std"), "100 ppm");
assert.equal(find("additives").format(sample, "std"), "1 wt% additive");

const range = parseQuantity("5–10 nN", "force")!;
const rangeRecord = record("range", 0.1, { core: { load: range } });
assert.strictEqual(find("load").getQuantity?.(rangeRecord), range);
assert.match(find("load").format(rangeRecord, "std"), /5.*10.*nN/);
const errorRecord = record("error", 0.1, { core: { cof: 0.1, load: parseQuantity("10 ± 2 nN", "force") }, flexible: [{ key: "cof_error", value: "0.003" }] });
assert.match(find("load").format(errorRecord, "std"), /10 ± 2 nN/);
assert.match(find("metric").format(errorRecord, "std"), /±0\.003/);
const approximation = record("approx", 0.1, { core: { load: parseQuantity("~10 nN", "force") } });
assert.match(find("load").format(approximation, "std"), /≈/);
const unreported = record("unreported", null, { core: { temperature: parseQuantity("not stated", "temperature") } });
assert.equal(find("temperature").format(unreported, "raw"), "not stated");
assert.match(find("temperature").format(unreported, "std"), /≈/);
const quoteOnly = record("quote", 0.1, { provenance: { cof: { quote: "COF 0.1 ± 0.3" } } });
assert.doesNotMatch(find("metric").format(quoteOnly, "std"), /±/, "Quoted prose must not become a measurement uncertainty");

const conductivity = record("conductivity", null, { core: { conductivity: parseQuantity("12 mS/cm", "conductivity"), surface: "Pt" }, extended: { viscosity: parseQuantity("45 cP", "viscosity") } });
assert.ok(Math.abs(Number(find("metric", "conductivity").getValue(conductivity)) - 1.2) < 1e-12);
assert.equal(find("metric", "conductivity").provenanceKey, "conductivity");
assert.equal(find("metric", "conductivity").format(conductivity, "raw"), "12 mS/cm");
assert.equal(find("surface", "conductivity").getValue(conductivity), "Pt");
assert.equal(find("viscosity", "conductivity").getValue(conductivity), 0.045);
const electrochemical = record("electrochemical", null, {
  core: { capacitance: parseQuantity("120 pF", "capacitance"), chargeTransferResistance: parseQuantity("4.2 kΩ", "resistance") },
  extended: { pressure: parseQuantity("1 atm", "pressure"), workingElectrode: "Pt disk" },
});
assert.equal(find("metric", "conductivity").getValue(electrochemical), null);
assert.equal(find("capacitance", "conductivity").getValue(electrochemical), 1.2e-10);
assert.equal(find("chargeTransferResistance", "conductivity").getValue(electrochemical), 4200);
assert.equal(find("pressure", "conductivity").getValue(electrochemical), 101325);
assert.equal(find("workingElectrode", "conductivity").getValue(electrochemical), "Pt disk");
const diffusion = record("diffusion", null, { core: { diffusion: parseQuantity("5e-11 m2/s", "diffusion"), species: "cation" }, extended: { poreSize: parseQuantity("2.5 nm", "length"), systemName: "MCM-41", geometry: "channel" } });
assert.equal(find("metric", "diffusion").getValue(diffusion), 5e-11);
assert.equal(find("metric", "diffusion").provenanceKey, "diffusion");
assert.equal(find("poreSize", "diffusion").getValue(diffusion), 2.5e-9);
assert.equal(find("species", "diffusion").getValue(diffusion), "cation");
assert.equal(find("systemName", "diffusion").getValue(diffusion), "MCM-41");
for (const domain of ["tribology", "conductivity", "diffusion"] as const) {
  const fields = getAnalysisFields(domain);
  assert.equal(new Set(fields.map((field) => field.key)).size, fields.length);
  for (const column of defaultColumns(domain)) assert.ok(fields.some((field) => field.key === column));
  const plot = defaultPlotConfig(domain);
  assert.ok(fields.find((field) => field.key === plot.x)?.numeric);
  assert.ok(fields.find((field) => field.key === plot.y)?.numeric);
  assert.equal(find("metric", domain).getValue(record("empty", null, { core: {} })), null);
}
console.log("Analysis field sorting, units, aliases and three-domain tests passed");
