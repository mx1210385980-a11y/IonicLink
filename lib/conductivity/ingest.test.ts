import assert from "node:assert/strict";
import { ingest, toFields } from "./ingest";
import { conductivityCoreCompleteness, type ConductivityExtractedFields } from "./schema";

const close = (a: number | null | undefined, b: number, tol = 1e-9) =>
  a != null && Math.abs(a - b) < tol;

const fields: ConductivityExtractedFields = {
  paper: { title: "Test conductivity paper" },
  cation: "[EMIM]",
  anion: "[BF4]",
  surface: "Pt",
  temperature: "25 °C",
  conductivity: "14 mS/cm",
  capacitance: "2 F", // 添加电容测试数据
  electricField: "2 kV/m", // 添加电场测试数据
  electrodePotential: "-1.0 V",
  potentialReference: "Ag/AgCl",
  electrochemicalWindow: "-2.0–2.5 V",
  chargeTransferResistance: "4.2 kΩ",
  method: "EIS",
  viscosity: "37 cP",
  waterContent: "50 ppm",
  density: "1.24 g/cm3",
  flexible: [{ key: "pressure", value: "1 atm" }],
  provenance: [{ field: "conductivity", page: 2, quote: "σ = 14 mS/cm" }],
  confidence: 0.9,
};

const draft = ingest(fields);

// core layer — standardized
assert.equal(draft.core.surface, "Pt");
assert.equal(draft.core.ionicLiquid.cation, "[EMIM]");
assert.ok(close(draft.core.temperature?.std, 298.15), "25 °C → 298.15 K");
assert.ok(close(draft.core.conductivity?.std, 1.4), "14 mS/cm → 1.4 S/m");
assert.ok(close(draft.core.capacitance?.std, 2), "2 F → 2 F"); // 添加电容断言
assert.ok(close(draft.core.electricField?.std, 2000), "2 kV/m → 2000 V/m"); // 添加电场断言
assert.ok(close(draft.core.electrodePotential?.std, -1), "-1.0 V → -1 V");
assert.ok(close(draft.core.chargeTransferResistance?.std, 4200), "4.2 kΩ → 4200 Ω");
assert.equal(draft.extended.potentialReference, "Ag/AgCl");

// extended layer — viscosity standardized, method/water/density kept
assert.equal(draft.extended.method, "EIS");
assert.ok(close(draft.extended.viscosity?.std, 0.037), "37 cP → 0.037 Pa·s");
assert.equal(draft.extended.waterContent, "50 ppm");
assert.equal(draft.extended.density, "1.24 g/cm3");

// flexible kept
assert.equal(draft.flexible.length, 1);
assert.equal(draft.flexible[0].key, "pressure");

// provenance mapped
assert.equal(draft.provenance?.conductivity?.page, 2);

// completeness — complete here
assert.equal(conductivityCoreCompleteness(draft).complete, true);

// A capacitance/electric-field record remains valid without conductivity.
const incomplete = ingest({ ...fields, conductivity: undefined });
const comp = conductivityCoreCompleteness(incomplete);
assert.equal(comp.complete, true);

const noTarget = ingest({
  ...fields,
  conductivity: undefined,
  capacitance: undefined,
  electricField: undefined,
  electrodePotential: undefined,
  electrochemicalWindow: undefined,
  chargeTransferResistance: undefined,
});
const noTargetCompleteness = conductivityCoreCompleteness(noTarget);
assert.equal(noTargetCompleteness.complete, false);
assert.ok(noTargetCompleteness.missing.includes("Target electrochemical property"));

// toFields round-trips the raw values for the editor
const back = toFields(draft);
assert.equal(back.conductivity, "14 mS/cm");
assert.equal(back.capacitance, "2 F");
assert.equal(back.electricField, "2 kV/m");
assert.equal(back.electrodePotential, "-1.0 V");
assert.equal(back.potentialReference, "Ag/AgCl");
assert.equal(back.electrochemicalWindow, "-2.0–2.5 V");
assert.equal(back.chargeTransferResistance, "4.2 kΩ");
assert.equal(back.surface, "Pt");
assert.equal(back.method, "EIS");

const missingTemperature = ingest({ ...fields, temperature: undefined });
assert.ok(close(missingTemperature.core.temperature?.std, 293.15), "missing temperature defaults to 293.15 K");
assert.equal(missingTemperature.core.temperature?.raw, "not stated");

console.log("Conductivity ingest tests passed");
