import assert from "node:assert/strict";
import { ingest, toFields } from "./ingest";
import { diffusionCoreCompleteness, type DiffusionExtractedFields } from "./schema";
import { diffusionMockExtract } from "./extract";
import { diffusionModule } from "../modules/diffusion";

const close = (a: number | null | undefined, b: number) =>
  a != null && Math.abs(a - b) < Math.abs(b) * 1e-9;

const fields: DiffusionExtractedFields = {
  paper: { title: "Test diffusion paper" },
  cation: "[EMIM]",
  anion: "[TFSI]",
  species: "cation",
  temperature: "30 °C",
  diffusion: "6.2 × 10⁻¹¹ m² s⁻¹",
  systemName: "MCM-41 pores",
  poreSize: "38 Å",
  material: "silica",
  geometry: "pore",
  functionalGroups: "hydroxyl",
  polarizable: "yes",
  method: "PFG-NMR",
  nucleus: "¹H",
  viscosity: "28 cP",
  waterContent: "20 ppm",
  flexible: [{ key: "diffusion time", value: "50 ms" }],
  provenance: [
    { field: "diffusion", page: 4, quote: "D+ = 6.2 × 10−11 m2 s−1", basis: "direct" },
    { field: "temperature", page: 2, quote: "thermostated at 303 K", basis: "inferred", basisNote: "stated in methods, not per measurement" },
  ],
  confidence: 0.9,
};

const draft = ingest(fields);

// core layer — standardized
assert.equal(draft.core.species, "cation");
assert.equal(draft.core.ionicLiquid.cation, "[EMIM]");
assert.ok(close(draft.core.temperature?.std, 303.15), "30 °C → 303.15 K");
assert.ok(close(draft.core.diffusion?.std, 6.2e-11), "6.2 × 10⁻¹¹ m² s⁻¹ → 6.2e-11 m²/s");

// extended layer — confined system kept verbatim, pore size standardized to m
assert.equal(draft.extended.systemName, "MCM-41 pores");
assert.ok(close(draft.extended.poreSize?.std, 3.8e-9), "38 Å → 3.8e-9 m");

// extended layer — viscosity standardized, method/nucleus/water kept
assert.equal(draft.extended.method, "PFG-NMR");
assert.equal(draft.extended.nucleus, "¹H");
assert.ok(close(draft.extended.viscosity?.std, 0.028), "28 cP → 0.028 Pa·s");
assert.equal(draft.extended.waterContent, "20 ppm");

// flexible kept
assert.equal(draft.flexible.length, 1);
assert.equal(draft.flexible[0].key, "diffusion time");

// provenance mapped, including the evidence basis
assert.equal(draft.provenance?.diffusion?.page, 4);
assert.equal(draft.provenance?.diffusion?.basis, "direct");
assert.equal(draft.provenance?.temperature?.basis, "inferred");
assert.ok(draft.provenance?.temperature?.basisNote?.includes("methods"));

// completeness — complete here
assert.equal(diffusionCoreCompleteness(draft).complete, true);

// missing D blocks approval
const noD = ingest({ ...fields, diffusion: undefined });
const compD = diffusionCoreCompleteness(noD);
assert.equal(compD.complete, false);
assert.ok(compD.missing.includes("Diffusion D"), "missing D reported");

// 无数据拒收 — a freshly extracted draft with no D at all never enters review
assert.equal(diffusionModule.acceptDraft?.(noD), false, "no-D draft is rejected outright");
assert.equal(diffusionModule.acceptDraft?.(ingest({ ...fields, diffusion: "  " })), false, "blank D rejected");
assert.equal(diffusionModule.acceptDraft?.(draft), true, "draft with D accepted");

const tableScaledMock = diffusionMockExtract(`
  [PAGE 1]
  PFG-NMR self-diffusion of [BMIM][TFSI] confined in MCM-41 pores was measured at 303 K.
  The pore diameter was 4 nm.
  Table 2
  Self-diffusion coefficients, D / 10−11 m2 s−1
  species    D
  D+         6.2
  D-         4.8
`);
assert.ok(tableScaledMock.length >= 2, "mock extractor handles table-scaled confined diffusion values");
assert.match(tableScaledMock[0].diffusion ?? "", /10−11|10-11/);
assert.equal(tableScaledMock[0].systemName, "MCM-41 pores");
assert.equal(tableScaledMock[0].poreSize, "4 nm");

// missing species blocks approval — a D without its ion is ambiguous
const noSpecies = ingest({ ...fields, species: "" });
const compS = diffusionCoreCompleteness(noSpecies);
assert.equal(compS.complete, false);
assert.ok(compS.missing.includes("Species"), "missing species reported");

// toFields round-trips the raw values for the editor
const back = toFields(draft);
assert.equal(back.diffusion, "6.2 × 10⁻¹¹ m² s⁻¹");
assert.equal(back.species, "cation");
assert.equal(back.nucleus, "¹H");
assert.equal(back.systemName, "MCM-41 pores");
assert.equal(back.poreSize, "38 Å");

console.log("Diffusion ingest tests passed");
