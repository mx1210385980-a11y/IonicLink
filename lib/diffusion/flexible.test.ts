import assert from "node:assert/strict";
import { ingest } from "./ingest";
import { normalizeFlexibleFields } from "./flexible";
import type { DiffusionExtended } from "./schema";

function main() {
  // --- merge: polarizability details enrich the bare extended.polarizable
  const extended: DiffusionExtended = { polarizable: "polarizable" };
  const kept = normalizeFlexibleFields(
    [
      { key: "surface polarizability", value: "Drude oscillators on graphene, per-atom polarizability 0.867 Å³" },
      { key: "surface treatment", value: "fixed-charge (non-polarizable) graphene walls" },
    ],
    extended
  );
  assert.equal(kept.length, 0, "merged keys leave the flexible layer");
  assert.match(extended.polarizable!, /polarizable \(Drude oscillators/);
  assert.match(extended.polarizable!, /fixed-charge/);

  // --- merge: D evaluation folds into method, composition ratio into concentration
  const extended2: DiffusionExtended = { method: "MD simulation" };
  const kept2 = normalizeFlexibleFields(
    [
      { key: "D evaluation", value: "slope of MSD via Einstein's relation" },
      { key: "IL:PVDF weight ratio", value: "1:1" },
    ],
    extended2
  );
  assert.equal(kept2.length, 0);
  assert.equal(extended2.method, "MD simulation; slope of MSD via Einstein's relation");
  assert.equal(extended2.concentration, "IL:PVDF = 1:1 (w/w)");

  // --- drop: out-of-scope context, leakage, derivable notes, paper-scope lists
  const extended3: DiffusionExtended = {};
  const kept3 = normalizeFlexibleFields(
    [
      { key: "bulk reference D", value: "2.411 × 10⁻¹⁰ m² s⁻¹ (cation) at 340 K" },
      { key: "potential of zero charge", value: "−0.23 V" },
      { key: "layer-resolved D", value: "also reported (Table II)" },
      { key: "note", value: "anion slower than cation here" },
      { key: "structural state", value: "quasi-superionic state in diffuse layer" },
      { key: "gas permeation stage", value: "NVT, 140 ns, 298 K" },
      { key: "membrane thicknesses studied", value: "3, 4, 5 and 6 nm" },
      { key: "dimensionality of D", value: "2D in-plane (Dxy)" },
      { key: "diffusion dimensionality", value: "2D in-plane (Dxy)" },
    ],
    extended3
  );
  assert.equal(kept3.length, 0, "noise keys are dropped entirely");

  // --- keep + rename to a self-explanatory label
  const kept4 = normalizeFlexibleFields(
    [
      { key: "production run", value: "10 ns" },
      { key: "membrane preparation stage", value: "NPT, 100 ns, 493 K, 1 bar" },
      { key: "system composition (6 nm membrane)", value: "150 PVDF chains + 349 IL ion pairs" },
      { key: "force field", value: "modified CL & Pol (Drude polarizable)" },
      { key: "fluid_density_value", value: "1.52", unit: "g/cm3" },
    ],
    {}
  );
  assert.deepEqual(
    kept4.map((field) => field.key),
    ["production run length", "membrane preparation", "simulation system composition", "force field", "fluid_density_value"]
  );
  assert.equal(kept4[4].unit, "g/cm3", "unlisted keys pass through untouched");

  // --- ingest applies the same cleanup end to end
  const draft = ingest({
    paper: { title: "Fixture" },
    cation: "[EMIM]",
    anion: "[TFSI]",
    species: "cation",
    temperature: "340 K",
    diffusion: "5.2 × 10⁻¹¹ m² s⁻¹",
    method: "MD simulation",
    polarizable: "polarizable",
    flexible: [
      { key: "surface polarizability", value: "Drude oscillators on graphene" },
      { key: "bulk reference D", value: "2.4 × 10⁻¹⁰ m² s⁻¹" },
      { key: "production run", value: "10 ns" },
    ],
  });
  assert.match(draft.extended.polarizable!, /Drude oscillators/);
  assert.deepEqual(draft.flexible.map((field) => field.key), ["production run length"]);

  console.log("diffusion flexible-normalization tests passed");
}

main();
