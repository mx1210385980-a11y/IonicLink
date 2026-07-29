import assert from "node:assert/strict";
import { ingest } from "./ingest";
import { resolveIonStructure, standardizeIonFormula, standardizeIonLabel } from "./ionStructures";
import type { ExtractedFields } from "./schema";

assert.equal(resolveIonStructure("[BMIM]", "cation")?.smiles, "CCCCn1cc[n+](C)c1");
assert.equal(resolveIonStructure("[C12MIM]", "cation")?.smiles, "CCCCCCCCCCCCn1cc[n+](C)c1");
assert.equal(resolveIonStructure("[C2C1Im]", "cation")?.smiles, "CCn1cc[n+](C)c1");
assert.equal(resolveIonStructure("[C4C1Im]", "cation")?.smiles, "CCCCn1cc[n+](C)c1");
assert.equal(resolveIonStructure("[C6 C1 im]", "cation")?.smiles, "CCCCCCn1cc[n+](C)c1");
assert.equal(resolveIonStructure("[Py1,4]", "cation")?.label, "[Pyr1,4]");
assert.equal(resolveIonStructure("[EA]", "cation")?.smiles, "CC[NH3+]");
assert.equal(resolveIonStructure("[Li(G4)]", "cation")?.smiles, "[Li+]OCCOCCOCCOCCOC");
assert.equal(resolveIonStructure("[HOC4Py]", "cation")?.family, "hydroxyalkyl pyridinium");
assert.equal(resolveIonStructure("[HOC3MPip]", "cation")?.family, "hydroxyalkyl piperidinium");
assert.match(resolveIonStructure("[C10(C1Im)2]", "cation")?.smiles ?? "", /\[n\+\].*\[n\+\]/i);
assert.equal(
  resolveIonStructure("[P6,6,6,14]", "cation")?.smiles,
  "[P+](CCCCCC)(CCCCCC)(CCCCCC)CCCCCCCCCCCCCC"
);

assert.equal(standardizeIonLabel("[BMIM]", "cation"), "[C₄MIM]");
assert.equal(standardizeIonLabel("[C4MIM]", "cation"), "[C₄MIM]");
assert.equal(standardizeIonLabel("[C4C1Im]", "cation"), "[C₄MIM]");
assert.equal(standardizeIonLabel("[P6,6,6,14]", "cation"), "[P₆,₆,₆,₁₄]");
assert.equal(standardizeIonFormula("[N88812]", "cation"), "[N8,8,8,12]");
assert.equal(standardizeIonFormula("[P6,6,6,14]", "cation"), "[P6,6,6,14]");

assert.equal(resolveIonStructure("[BF4]", "anion")?.smiles, "[B-](F)(F)(F)F");
assert.equal(
  resolveIonStructure("[TFSI]", "anion")?.smiles,
  "[N-](S(=O)(=O)C(F)(F)F)S(=O)(=O)C(F)(F)F"
);
assert.equal(
  resolveIonStructure("bis(trifluoromethylsulfonyl)imide", "anion")?.smiles,
  "[N-](S(=O)(=O)C(F)(F)F)S(=O)(=O)C(F)(F)F"
);
assert.equal(
  resolveIonStructure("[FAP]", "anion")?.smiles,
  "C(C(F)(F)[P-](C(C(F)(F)F)(F)F)(C(C(F)(F)F)(F)F)(F)(F)F)(F)(F)F"
);
assert.equal(resolveIonStructure("[AOT]", "anion")?.family, "sulfosuccinate");
assert.equal(resolveIonStructure("[DS]", "anion")?.family, "sulfosuccinate");
assert.equal(resolveIonStructure("[Formate]", "anion")?.smiles, "C(=O)[O-]");
assert.equal(resolveIonStructure("[OMs]", "anion")?.smiles, "CS(=O)(=O)[O-]");
assert.equal(resolveIonStructure("[BOB]", "anion")?.family, "borate");
assert.equal(resolveIonStructure("[BScB]", "anion")?.family, "borate");
assert.equal(resolveIonStructure("[PAN]", "anion")?.name, "nitrate");
assert.match(resolveIonStructure("[A4BMB]", "anion")?.smiles ?? "", /ccc\(CCCC\)cc/);
assert.match(resolveIonStructure("[A8BMB]", "anion")?.smiles ?? "", /ccc\(CCCCCCCC\)cc/);
assert.match(resolveIonStructure("[A12BMB]", "anion")?.smiles ?? "", /ccc\(CCCCCCCCCCCC\)cc/);
assert.match(resolveIonStructure("[BMB]", "anion")?.smiles ?? "", /c1ccccc1/);
assert.equal(resolveIonStructure("[(iC8)2PO2]", "anion")?.family, "phosphinate");
assert.equal(resolveIonStructure("[(iC8)2PO2]", "anion")?.label, "[(iC8)2PO2]");
assert.match(resolveIonStructure("[(iC8)2PO2]", "anion")?.smiles ?? "", /P\(=O\)\(\[O-\]\)/);
assert.equal(resolveIonStructure("[DEHP]", "anion")?.family, "phosphate");
assert.equal(resolveIonStructure("[DEHP]", "anion")?.name, "bis(2-ethylhexyl) phosphate");
assert.match(resolveIonStructure("[DEHP]", "anion")?.smiles ?? "", /P\(=O\)\(\[O-\]\)/);
assert.equal(standardizeIonLabel("[BF4]", "anion"), "[BF₄]");
assert.equal(standardizeIonLabel("[PF6]", "anion"), "[PF₆]");
assert.equal(standardizeIonLabel("[NTf2]", "anion"), "[NTf₂]");
assert.equal(standardizeIonLabel("[TFSI]", "anion"), "[NTf₂]");
assert.equal(standardizeIonLabel("[(iC8)2PO2]", "anion"), "[(ⁱC₈)₂PO₂]");
assert.equal(standardizeIonFormula("[(iC8)2PO2]", "anion"), "[(iC8)2PO2]");
assert.equal(standardizeIonFormula("[DEHP]", "anion"), "[DEHP]");
assert.equal(standardizeIonFormula("[A12BMB]", "anion"), "[A12BMB]");

const draft: ExtractedFields = {
  paper: { title: "Ion structure test" },
  cation: "[EMIM]",
  anion: "[PF6]",
  substrate: "graphite",
  temperature: "298 K",
  load: "5 nN",
  cof: 0.1,
};

const record = ingest(draft);
assert.equal(record.core.ionicLiquid.cationSmiles, "CCn1cc[n+](C)c1");
assert.equal(record.core.ionicLiquid.anionSmiles, "[P-](F)(F)(F)(F)(F)F");

console.log("Ion structure resolver tests passed");
