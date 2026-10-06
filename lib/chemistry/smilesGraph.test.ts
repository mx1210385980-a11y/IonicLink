import assert from "node:assert/strict";
import {
  balabanJ,
  bertzComplexity,
  hBondAcceptors,
  hBondDonors,
  logPApprox,
  molecularWeight,
  parseSmiles,
  quaternaryAmmoniumCount,
  rotatableBonds,
  tpsa,
  vdwVolumeAndRadius,
} from "./smilesGraph";

const BMIM = "CCCCn1cc[n+](C)c1"; // C8H15N2+
const PYR14 = "CCCC[N+]1(C)CCCC1"; // C9H20N+
const TFSI = "[N-](S(=O)(=O)C(F)(F)F)S(=O)(=O)C(F)(F)F"; // C2F6NO4S2-
const BF4 = "[B-](F)(F)(F)F";
const HSO4 = "OS(=O)(=O)[O-]"; // HSO4-
const ACETATE = "CC(=O)[O-]"; // C2H3O2-
const DCA = "[N-](C#N)C#N"; // dicyanamide

/* ---- implicit hydrogens against known molecular formulas ---- */
{
  const h = (s: string) => parseSmiles(s).atoms.reduce((a, x) => a + x.hCount, 0);
  assert.equal(h(BMIM), 15, "BMIM is C8H15N2+");
  assert.equal(h(PYR14), 20, "Pyr1,4 is C9H20N+");
  assert.equal(h(TFSI), 0, "TFSI carries no hydrogen");
  assert.equal(h(BF4), 0);
  assert.equal(h(HSO4), 1, "hydrogen sulfate has exactly one OH");
  assert.equal(h(ACETATE), 3);
}

/* ---- molecular weight (WITH hydrogens — unlike the heavy-atom mass) ---- */
{
  const mw = (s: string) => molecularWeight(parseSmiles(s));
  assert.ok(Math.abs(mw(BMIM) - 139.22) < 0.05, `BMIM MW ${mw(BMIM)}`);
  assert.ok(Math.abs(mw(PYR14) - 142.26) < 0.06, `Pyr14 MW ${mw(PYR14)}`);
  assert.ok(Math.abs(mw(TFSI) - 280.15) < 0.05, `TFSI MW ${mw(TFSI)}`);
  assert.ok(Math.abs(mw(BF4) - 86.8) < 0.05);
  assert.ok(Math.abs(mw(HSO4) - 97.07) < 0.05);
  assert.ok(Math.abs(mw(ACETATE) - 59.04) < 0.05);
}

/* ---- rotatable bonds ---- */
{
  const rot = (s: string) => rotatableBonds(parseSmiles(s));
  assert.equal(rot(BMIM), 3, "butyl chain: C2-C3, C3-C4, C4-n");
  assert.equal(rot(BF4), 0);
  assert.equal(rot(DCA), 0, "bonds adjacent to nitrile triples are not rotatable");
  assert.equal(rot("CCOS(=O)(=O)[O-]"), 2, "ethyl sulfate: C-C terminal excluded, C-O and O-S rotatable");
}

/* ---- H-bond donors / acceptors / quaternary N ---- */
{
  assert.equal(hBondDonors(parseSmiles(BMIM)), 0);
  assert.equal(hBondDonors(parseSmiles(HSO4)), 1);
  assert.equal(hBondAcceptors(parseSmiles(BMIM)), 2);
  assert.equal(hBondAcceptors(parseSmiles(TFSI)), 5, "N + 4 O");
  assert.equal(quaternaryAmmoniumCount(parseSmiles(PYR14)), 1);
  assert.equal(quaternaryAmmoniumCount(parseSmiles(BMIM)), 0, "aromatic n+ is not a quaternary ammonium");
  assert.equal(quaternaryAmmoniumCount(parseSmiles("[N+](CCCCCCCC)(CCCCCCCC)(CCCCCCCC)CC")), 1);
}

/* ---- TPSA: anchored on BMIM (PubChem 8.8 Å2) and the zero-PSA fluoroanions ---- */
{
  assert.ok(Math.abs(tpsa(parseSmiles(BMIM)) - 8.81) < 0.1, `BMIM TPSA ${tpsa(parseSmiles(BMIM))}`);
  assert.equal(tpsa(parseSmiles(BF4)), 0);
  assert.equal(tpsa(parseSmiles("[P-](F)(F)(F)(F)(F)F")), 0, "PF6 has no polar surface");
  assert.equal(tpsa(parseSmiles(PYR14)), 0, "R4N+ is non-polar in the Ertl scheme");
  assert.ok(tpsa(parseSmiles(TFSI)) > 50, "sulfonylimide is strongly polar");
  assert.ok(tpsa(parseSmiles(ACETATE)) > 35);
}

/* ---- vdW radius: literature anchors (r_BF4 ≈ 2.29 Å, r_BMIM ≈ 3.3 Å) ---- */
{
  const r = (s: string) => vdwVolumeAndRadius(parseSmiles(s)).radiusA;
  assert.ok(Math.abs(r(BF4) - 2.25) < 0.15, `BF4 radius ${r(BF4)}`);
  assert.ok(Math.abs(r(BMIM) - 3.35) < 0.2, `BMIM radius ${r(BMIM)}`);
  assert.ok(r("CCCCCCCCn1cc[n+](C)c1") > r(BMIM), "longer chain → larger ion");
  assert.ok(r(TFSI) > r(BF4), "TFSI is the bigger anion");
}

/* ---- Balaban J / Bertz complexity: structural invariants ---- */
{
  const j = (s: string) => balabanJ(parseSmiles(s));
  assert.ok(j("CCCC") > 0);
  assert.ok(Math.abs(j("CCCC") - 1.9747) < 0.01, "n-butane Balaban J is 1.9747");
  assert.ok(j(BMIM) > 0 && Number.isFinite(j(BMIM)));

  const ct = (s: string) => bertzComplexity(parseSmiles(s));
  assert.ok(ct(TFSI) > ct(BF4), "complexity grows with structure");
  assert.ok(ct(BMIM) > ct("CC"), "complexity grows with size");
}

/* ---- logP estimate: invariants only (explicitly not Crippen MolLogP) ---- */
{
  const lp = (s: string) => logPApprox(parseSmiles(s));
  assert.ok(lp("CCCCCCCCn1cc[n+](C)c1") > lp(BMIM), "longer alkyl chain → more lipophilic");
  assert.ok(lp(TFSI) > lp(ACETATE), "fluorous anion beats carboxylate");
  assert.ok(lp(BMIM) < lp("CCCCc1ccccc1"), "the charged ring sinks logP vs butylbenzene");
}

console.log("predict/smilesGraph tests passed");
