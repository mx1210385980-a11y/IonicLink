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

// --- material/geometry/functionalGroups/polarizable must reach extended (was a silent-drop bug)
const extendedWiring = adaptDiffusionDataset([{
  name: "Sheet1",
  headerRow: 1,
  headers: ["cation", "anion", "D_cation", "D_unit", "temperature", "material", "geometry", "functional_groups", "polarizable"],
  rows: [{ rowNumber: 2, values: ["[EMIM]", "[TFSI]", 5, "10^-11 m2/s", 303, "silica", "slit pore", "hydroxyl", "yes"] }],
}], { filename: "dataset.xlsx", fingerprint: "fixture-sha" });
assert.equal(extendedWiring.drafts.length, 1);
assert.equal(extendedWiring.drafts[0].extended.material, "silica");
assert.equal(extendedWiring.drafts[0].extended.geometry, "slit pore");
assert.equal(extendedWiring.drafts[0].extended.functionalGroups, "hydroxyl");
assert.equal(extendedWiring.drafts[0].extended.polarizable, "yes");
assert.equal(
  extendedWiring.drafts[0].flexible.some((field) => ["material", "geometry", "functional_groups", "polarizable"].includes(field.key)),
  false,
  "recognized columns must not be duplicated into flexible"
);

// --- headers with unit annotations and CJK aliases resolve to the same targets
const localized = adaptDiffusionDataset([{
  name: "Sheet1",
  headerRow: 1,
  headers: ["阳离子", "阴离子", "D_cation (10^-11 m2/s)", "Temperature (K)", "温度单位", "孔径", "官能团"],
  rows: [{ rowNumber: 2, values: ["[BMIM]", "[BF4]", 7.5, 323, "K", "2.5 nm", "sulfonate"] }],
}], { filename: "dataset.xlsx", fingerprint: "fixture-sha" });
assert.equal(localized.invalidRows.length, 0, JSON.stringify(localized.invalidRows));
assert.equal(localized.drafts.length, 1);
assert.equal(localized.drafts[0].core.ionicLiquid.cation, "[BMIM]");
assert.equal(localized.drafts[0].core.temperature?.std, 323);
assert.ok(Math.abs((localized.drafts[0].core.diffusion?.std ?? 0) - 7.5e-11) < 1e-23);
assert.equal(localized.drafts[0].extended.poreSize?.std, 2.5e-9);
assert.equal(localized.drafts[0].extended.functionalGroups, "sulfonate");
assert.ok(
  localized.mappings.some((mapping) => mapping.source === "Temperature (K)" && mapping.target === "core.temperature"),
  "unit-annotated header maps to core.temperature"
);

// --- unit-suffixed headers match fuzzily, but unrelated suffixes never collapse
const fuzzy = adaptDiffusionDataset([{
  name: "Sheet1",
  headerRow: 1,
  headers: ["cation", "anion", "d_cation_10_9_m2s", "temperature_k", "anion_transport_number"],
  rows: [{ rowNumber: 2, values: ["[EMIM]", "[TFSI]", 4.2, 298, 0.45] }],
}], { filename: "dataset.xlsx", fingerprint: "fixture-sha" });
assert.equal(fuzzy.invalidRows.length, 0, JSON.stringify(fuzzy.invalidRows));
assert.equal(fuzzy.drafts[0].core.temperature?.std, 298);
assert.equal(fuzzy.drafts[0].core.ionicLiquid.anion, "[TFSI]", "anion_transport_number must not be mistaken for the anion column");
assert.equal(
  fuzzy.drafts[0].flexible.find((field) => field.key === "anion_transport_number")?.value,
  "0.45",
  "unmapped columns are still preserved verbatim in flexible"
);

// --- confinement_*_class columns merge into the confined-system extended fields
const confinement = adaptDiffusionDataset([{
  name: "Sheet1",
  headerRow: 1,
  headers: ["cation", "anion", "D_cation", "D_unit", "temperature", "confinement_material_class", "confinement_geometry_class"],
  rows: [{ rowNumber: 2, values: ["[EMIM]", "[TFSI]", 5, "10^-11 m2/s", 303, "silica", "slit pore"] }],
}], { filename: "dataset.xlsx", fingerprint: "fixture-sha" });
assert.equal(confinement.drafts.length, 1);
assert.equal(confinement.drafts[0].extended.material, "silica");
assert.equal(confinement.drafts[0].extended.geometry, "slit pore");
assert.equal(
  confinement.drafts[0].flexible.some((field) => field.key.includes("confinement_")),
  false,
  "confinement classes belong in extended, not the flexible layer"
);

// --- ionic-liquid intrinsic columns (SMILES, ion pairs, CAS, molar mass, structure descriptors) are dropped entirely
const intrinsic = adaptDiffusionDataset([{
  name: "Sheet1",
  headerRow: 1,
  headers: [
    "cation", "anion", "D_cation", "D_unit", "temperature",
    "cation_smiles", "anion_smiles", "pairs", "ion_pair_cas_number", "molar_mass",
    "Mol_Weight (g/mol)", "LogP (Hydrophobicity)", "TPSA (Polar Surface Area)", "Num_H_Donors", "Num_H_Acceptors",
    "MSD cat\n(Å2)", "MSD ani\n(Å2)", "log\n(slope_cat)", "log\n(slope_ani)",
    "fluid_density_value", "fluid_density_unit",
  ],
  rows: [{ rowNumber: 2, values: [
    "[EMIM]", "[TFSI]", 5, "10^-11 m2/s", 303,
    "CCN1C=C[N+](C)=C1", "F[B-](F)(F)F", 128, "174-65-8", 391.31,
    391.31, 1.2, 65.4, 0, 8,
    120.5, 98.3, 0.98, 1.01,
    1.52, "g/cm3",
  ] }],
}], { filename: "dataset.xlsx", fingerprint: "fixture-sha" });
assert.equal(intrinsic.drafts.length, 1);
for (const key of [
  "cation_smiles", "anion_smiles", "pairs", "ion_pair_cas_number", "molar_mass",
  "Mol_Weight (g/mol)", "LogP (Hydrophobicity)", "TPSA (Polar Surface Area)", "Num_H_Donors", "Num_H_Acceptors",
  "MSD cat\n(Å2)", "MSD ani\n(Å2)", "log\n(slope_cat)", "log\n(slope_ani)",
]) {
  assert.equal(
    intrinsic.drafts[0].flexible.some((field) => field.key === key),
    false,
    `${key} is derivable from the ion names and must not be stored`
  );
  const mapping = intrinsic.mappings.find((item) => item.source === key);
  assert.equal(mapping?.mode, "ignored", `${key} mapping should be reported as ignored`);
}
// system-state quantities (density depends on the simulated/experimental conditions) stay in flexible,
// with the unit column folded into the value instead of appearing as a separate constant column
const density = intrinsic.drafts[0].flexible.find((field) => field.key === "fluid_density_value");
assert.equal(density?.value, "1.52");
assert.equal(density?.unit, "g/cm3");
assert.equal(
  intrinsic.drafts[0].flexible.some((field) => field.key === "fluid_density_unit"),
  false,
  "a unit column must not become its own flexible field"
);
assert.equal(
  intrinsic.mappings.find((item) => item.source === "fluid_density_value")?.mode,
  "preserved",
  "fluid density is condition-specific and must be kept"
);
assert.equal(
  intrinsic.mappings.find((item) => item.source === "fluid_density_unit")?.target,
  "flexible[fluid_density_value].unit"
);

console.log("diffusion dataset adapter tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
