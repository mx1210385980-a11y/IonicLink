import assert from "node:assert/strict";
import {
  STRUCTURE_KEY_VERSION,
  StructureSearchInputError,
  canonicalStructureKey,
  recordStructureKey,
} from "./structureSearch.server";

const reordered = canonicalStructureKey("[NH3+]CC");
assert.equal(
  reordered,
  canonicalStructureKey("CC[NH3+]"),
  "atom order does not change the exact structure key"
);
assert.ok(
  reordered.startsWith(`${STRUCTURE_KEY_VERSION}:`),
  "structure keys identify the canonicalization version"
);

assert.equal(
  canonicalStructureKey("c1ccccc1"),
  canonicalStructureKey("C1=CC=CC=C1"),
  "aromatic and Kekule forms of benzene share one key"
);

assert.notEqual(
  canonicalStructureKey("NCC"),
  canonicalStructureKey("[NH3+]CC"),
  "formal charge and protonation remain part of exact identity"
);
assert.notEqual(
  canonicalStructureKey("N[C@H](C)C(=O)O"),
  canonicalStructureKey("N[C@@H](C)C(=O)O"),
  "declared stereochemistry remains part of exact identity"
);

function expectInputError(smiles: string, expectedStatus: 400 | 413, label: string): void {
  let caught: unknown;
  try {
    canonicalStructureKey(smiles);
  } catch (error) {
    caught = error;
  }
  assert.ok(caught instanceof StructureSearchInputError, label);
  assert.equal(caught.status, expectedStatus, `${label}: HTTP status`);
}

expectInputError("   ", 400, "empty structure is rejected");
expectInputError("C1CC", 400, "invalid SMILES is rejected");
expectInputError("C.[Na+]", 400, "multi-fragment structures are rejected");
expectInputError("C".repeat(10_000), 413, "overlong structures are rejected");

const explicitSmiles = "C[N+](C)(C)C";
const explicitRecord = {
  core: {
    ionicLiquid: {
      cation: "[BMIM]",
      anion: "[BF4]",
      cationSmiles: explicitSmiles,
    },
  },
};
assert.equal(
  recordStructureKey(explicitRecord, "cation"),
  canonicalStructureKey(explicitSmiles),
  "an explicit record SMILES takes priority over the label resolver"
);
assert.notEqual(
  recordStructureKey(explicitRecord, "cation"),
  canonicalStructureKey("CCCCn1cc[n+](C)c1"),
  "the label resolver does not replace a valid explicit SMILES"
);

const labelOnlyRecord = {
  core: {
    ionicLiquid: {
      cation: "[BMIM]",
      anion: "[BF4]",
    },
  },
};
assert.equal(
  recordStructureKey(labelOnlyRecord, "cation"),
  canonicalStructureKey("CCCCn1cc[n+](C)c1"),
  "a missing cation SMILES falls back to the ion-label resolver"
);
assert.equal(
  recordStructureKey(labelOnlyRecord, "anion"),
  canonicalStructureKey("[B-](F)(F)(F)F"),
  "a missing anion SMILES falls back to the ion-label resolver"
);

console.log("Structure search canonicalization tests passed");
