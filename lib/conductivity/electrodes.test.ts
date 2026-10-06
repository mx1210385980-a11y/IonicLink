import assert from "node:assert/strict";
import { ingest } from "./ingest";
import { buildConductivityCellModel, normalizeCellConfiguration } from "./electrodes";

assert.equal(normalizeCellConfiguration("three-electrode Swagelok cell"), "three-electrode");
assert.equal(normalizeCellConfiguration("双电极体系"), "two-electrode");
assert.equal(normalizeCellConfiguration("electrochemical cell"), undefined);

const threeDraft = ingest({
  paper: { title: "Three-electrode example" },
  cation: "[BMIM]",
  anion: "[Br]",
  surface: "glassy carbon",
  chargeTransferResistance: "370.5 Ω",
  potentialReference: "SCE",
  flexible: [
    { key: "Cell setup", value: "three-electrode system" },
    { key: "Counter electrode", value: "carbon rod" },
  ],
});
const three = buildConductivityCellModel({ ...threeDraft, id: "#3", status: "official", createdAt: "" });
assert.equal(three.configuration, "three-electrode");
assert.equal(three.applicability, "electrochemical");
assert.equal(three.workingElectrode, "glassy carbon");
assert.equal(three.counterElectrode, "carbon rod");
assert.equal(three.referenceElectrode, "SCE");
assert.equal(threeDraft.flexible.length, 0, "legacy electrode fields are promoted out of flexible conditions");

const twoDraft = ingest({
  paper: { title: "Two-electrode example" },
  cation: "[EMIM]",
  anion: "[BF4]",
  surface: "stainless steel",
  conductivity: "1 S/m",
  cellConfiguration: "two-electrode",
  positiveElectrode: "activated carbon",
  negativeElectrode: "graphite",
});
const two = buildConductivityCellModel({ ...twoDraft, id: "#2", status: "official", createdAt: "" });
assert.equal(two.configuration, "two-electrode");
assert.equal(two.applicability, "electrochemical");
assert.equal(two.positiveElectrode, "activated carbon");
assert.equal(two.negativeElectrode, "graphite");

const sharedDraft = ingest({
  paper: { title: "Shared sodium electrode" },
  cation: "[Pyr13]",
  anion: "[TFSI]",
  surface: "carbon-coated aluminum",
  electrochemicalWindow: ">4.2 V",
  potentialReference: "Na+/Na",
  flexible: [{ key: "Cell setup", value: "three-electrode Swagelok cell; Na counter/reference" }],
});
const shared = buildConductivityCellModel({ ...sharedDraft, id: "#1", status: "official", createdAt: "" });
assert.equal(shared.counterElectrode, "Na");
assert.equal(shared.referenceElectrode, "Na");

const bulkDraft = ingest({
  paper: { title: "Bulk conductivity" },
  cation: "[EMIM]",
  anion: "[TFSI]",
  surface: "bulk liquid",
  conductivity: "1 S/m",
  method: "viscometer; conductivity cell",
});
const bulk = buildConductivityCellModel({ ...bulkDraft, id: "#4", status: "official", createdAt: "" });
assert.equal(bulk.configuration, "unknown");
assert.equal(bulk.applicability, "not-applicable");

const pendingDraft = ingest({
  paper: { title: "Unverified electrochemical setup" },
  cation: "[BMIM]",
  anion: "[Cl]",
  surface: "mild steel",
  chargeTransferResistance: "10 ohm",
  method: "EIS",
});
const pending = buildConductivityCellModel({ ...pendingDraft, id: "#5", status: "official", createdAt: "" });
assert.equal(pending.applicability, "unverified");

console.log("Conductivity electrode model tests passed");
