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

// missing σ flags Conductivity and blocks approval
const incomplete = ingest({ ...fields, conductivity: undefined });
const comp = conductivityCoreCompleteness(incomplete);
assert.equal(comp.complete, false);
assert.ok(comp.missing.includes("Conductivity"), "missing σ reported");

// toFields round-trips the raw values for the editor
const back = toFields(draft);
assert.equal(back.conductivity, "14 mS/cm");
assert.equal(back.surface, "Pt");
assert.equal(back.method, "EIS");

const missingTemperature = ingest({ ...fields, temperature: undefined });
assert.ok(close(missingTemperature.core.temperature?.std, 293.15), "missing temperature defaults to 293.15 K");
assert.equal(missingTemperature.core.temperature?.raw, "not stated");

console.log("Conductivity ingest tests passed");
