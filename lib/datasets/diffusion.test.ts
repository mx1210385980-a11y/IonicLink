import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { adaptDiffusionDataset } from "./diffusion";
import { parseTabularFile } from "./parse";

async function main() {
const workbook = new ExcelJS.Workbook();
const worksheet = workbook.addWorksheet("SI data");
worksheet.addRow([
  " system_name",
  "ionic_liquid",
  "D_total",
  "D_cation",
  "D_anion",
  "D_unit",
  "temperature_value",
  "confinement_scale_value",
  "confinement_scale_unit",
  "source",
  "fluid_density_value",
]);
worksheet.addRow([
  "Confined slit pore",
  "[BMIM][PF6]",
  "26",
  12.1,
  8.6,
  "10^-12 m2/s",
  349.9,
  2.52,
  "nm",
  "SI Table",
  1.642,
]);
const bytes = new Uint8Array(await workbook.xlsx.writeBuffer());
const sheets = await parseTabularFile("dataset.xlsx", bytes);
const result = adaptDiffusionDataset(sheets, {
  filename: "dataset.xlsx",
  fingerprint: "fixture-sha",
  paperTitle: "Fixture paper",
});

assert.equal(result.inputRows, 1);
assert.equal(result.drafts.length, 2, "one source row expands into cation and anion records");
assert.deepEqual(result.drafts.map((draft) => draft.core.species), ["cation", "anion"]);
assert.equal(result.drafts[0].core.ionicLiquid.cation, "[BMIM]");
assert.equal(result.drafts[0].core.ionicLiquid.anion, "[PF6]");
assert.equal(result.drafts[0].core.temperature?.std, 349.9);
assert.ok(Math.abs((result.drafts[0].core.diffusion?.std ?? 0) - 12.1e-12) < 1e-24);
assert.equal(result.drafts[0].extended.poreSize?.std, 2.52e-9);
assert.equal(result.drafts[0].provenance?.diffusion.table, "SI data!row 2");
assert.equal(result.drafts[0].flexible.find((field) => field.key === "dataset_row")?.value, "2");
assert.equal(result.drafts[0].flexible.find((field) => field.key === "fluid_density_value")?.value, "1.642");
assert.ok(result.warnings.some((warning) => warning.includes("D_total was ignored")));
assert.ok(result.mappings.some((mapping) => mapping.source === "ionic_liquid" && mapping.mode === "expanded"));

const hyphenated = adaptDiffusionDataset([{
  name: "Sheet1",
  headerRow: 1,
  headers: ["ionic_liquid", "D_cation", "D_anion", "D_unit", "temperature_value"],
  rows: [{ rowNumber: 2, values: ["BMIM-OcSO4", 3, 2, "10^-12 m2/s", 350] }],
}], { filename: "dataset.xlsx", fingerprint: "fixture-sha" });
assert.equal(hyphenated.drafts[0].core.ionicLiquid.cation, "[BMIM]");
assert.equal(hyphenated.drafts[0].core.ionicLiquid.anion, "[OcSO4]");
assert.ok(hyphenated.warnings.some((warning) => warning.includes("Hyphenated")));

console.log("diffusion dataset adapter tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
