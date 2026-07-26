import assert from "node:assert/strict";
import {
  describeIon,
  featureNorm,
  ionVocabulary,
  normalizedFeatureDelta,
  smilesElements,
} from "./descriptors";

/* ---- SMILES tokenization ---- */
{
  assert.deepEqual(smilesElements("[B-](F)(F)(F)F"), ["B", "F", "F", "F", "F"]);
  // aromatic atoms fold to uppercase; bracket atoms keep their element
  assert.deepEqual(smilesElements("CCCCn1cc[n+](C)c1"), ["C", "C", "C", "C", "N", "C", "C", "N", "C", "C"]);
  // two-letter elements never split into B + r / C + l
  assert.deepEqual(smilesElements("[Cl-]"), ["Cl"]);
  assert.deepEqual(smilesElements("[Br-]"), ["Br"]);
}

/* ---- heavy-atom masses against hand-computed anchors ---- */
{
  const tfsi = describeIon("[TFSI]", "anion");
  assert.ok(tfsi.resolved);
  assert.ok(Math.abs(tfsi.heavyMass - 280.13) < 0.05, `TFSI heavyMass ${tfsi.heavyMass}`);
  assert.equal(tfsi.nF, 6);
  assert.equal(tfsi.heavyAtoms, 15);
  assert.equal(tfsi.hasRing, false);

  const bf4 = describeIon("[BF4]", "anion");
  assert.ok(Math.abs(bf4.heavyMass - 86.8) < 0.05, `BF4 heavyMass ${bf4.heavyMass}`);
  assert.equal(bf4.nF, 4);

  const bmim = describeIon("[BMIM]", "cation");
  assert.ok(Math.abs(bmim.heavyMass - 124.1) < 0.05, `BMIM heavy-atom mass ${bmim.heavyMass}`);
  assert.equal(bmim.nC, 8);
  assert.equal(bmim.nHetero, 2);
  assert.equal(bmim.hasRing, true);
  assert.equal(bmim.chainLength, 4);

  const fap = describeIon("[FAP]", "anion");
  assert.equal(fap.nF, 18);
}

/* ---- canonical key collapses raw DB spellings ---- */
{
  const a = describeIon("[BMIm]", "cation");
  const b = describeIon("[BMIM]", "cation");
  const c = describeIon("[C4C1Im]", "cation");
  assert.equal(a.key, b.key);
  assert.equal(b.key, c.key);
  assert.equal(describeIon("[TFSI]", "anion").key, describeIon("[NTf2]", "anion").key);
  // unbracketed phosphonium from the live tribology DB
  const p = describeIon("P6,6,6,14", "cation");
  assert.ok(p.resolved);
  assert.equal(p.family, "phosphonium");
  assert.equal(p.chainLength, 14);
  const n = describeIon("[N88812]", "cation");
  assert.ok(n.resolved);
  assert.equal(n.chainLength, 12);
  const phosphinate = describeIon("(iC8)2PO2", "anion");
  assert.ok(phosphinate.resolved);
}

/* ---- unresolved ions are explicit, never silently featurized ---- */
{
  const x = describeIon("mysteryium", "cation");
  assert.equal(x.resolved, false);
  assert.equal(x.family, "unknown");
  assert.equal(x.heavyMass, 0);
}

/* ---- vocabulary: curated + patterns + extras, deduplicated ---- */
{
  const cations = ionVocabulary("cation", ["[BMIm]", "[P6,6,6,14]"]);
  const keys = cations.map((i) => i.key);
  assert.equal(new Set(keys).size, keys.length, "vocabulary must be deduplicated");
  assert.ok(keys.includes("c4mim"));
  assert.ok(keys.includes("c12mim"), "pattern chain lengths enumerated");
  assert.ok(keys.includes("p66614"), "dataset extras included");
  const anions = ionVocabulary("anion");
  assert.ok(anions.some((i) => i.key === "ntf2"));
  assert.ok(anions.length >= 20);
}

/* ---- normalization: identity is 0, deltas bounded ---- */
{
  const vocab = [...ionVocabulary("cation"), ...ionVocabulary("anion")];
  const norm = featureNorm(vocab);
  const a = describeIon("[C2MIM]", "cation");
  const b = describeIon("[C8MIM]", "cation");
  assert.equal(normalizedFeatureDelta(a, a, norm), 0);
  const d = normalizedFeatureDelta(a, b, norm);
  assert.ok(d > 0 && d <= 1, `delta ${d}`);
}

console.log("predict/descriptors tests passed");
