import assert from "node:assert/strict";
import { conductivityMockExtract } from "./extract";

const text = `[PAGE 1]
Electrical properties of [EMIM][BF4]
At 298 K on Pt, the ionic conductivity was 3.5 mS/cm. The measured capacitance was 120 pF and the applied electric field was 2 kV/cm.`;

const records = conductivityMockExtract(text);
assert.equal(records.length, 3);
const capacitanceRecord = records.find((record) => record.capacitance);
const electricFieldRecord = records.find((record) => record.electricField);
assert.equal(capacitanceRecord?.capacitance, "120 pF");
assert.equal(electricFieldRecord?.electricField, "2 kV/cm");
assert.equal(capacitanceRecord?.provenance?.find((item) => item.field === "capacitance")?.page, 1);
assert.equal(electricFieldRecord?.provenance?.find((item) => item.field === "electricField")?.page, 1);

const absent = conductivityMockExtract("The [EMIM][BF4] ionic-liquid electrolyte has an ionic conductivity of 1 S/m at 298 K on Pt.")[0];
assert.equal(absent.capacitance, undefined);
assert.equal(absent.electricField, undefined);

assert.deepEqual(
  conductivityMockExtract("At 298 K, the cell delivered 120 mAh/g at 2 A/g with 95% efficiency."),
  [],
  "out-of-scope battery performance must not create a record",
);

const fieldRecords = conductivityMockExtract(`[PAGE 4]
For [C4mim][OTf] at the Pt interface, the structure was evaluated under an external electric field at E = 0.2 V/Å.`);
assert.equal(fieldRecords.length, 1);
assert.equal(fieldRecords[0].electricField, "0.2 V/Å");
assert.equal(fieldRecords[0].cation, "[C4mim]");
assert.equal(fieldRecords[0].anion, "[OTf]");
assert.equal(fieldRecords[0].provenance?.[0]?.page, 4);

const normalizedCapacitance = conductivityMockExtract(`[PAGE 2]
The [EMIM][TFSI] electrode showed a specific capacitance of 64 F/g at 25 °C.`);
assert.equal(normalizedCapacitance[0].capacitance, "64 F/g");

const windowRecord = conductivityMockExtract(`[PAGE 3]
The electrochemical stability window of [Pyr13][TFSI] was tested in the voltage range 0.1 – 5.0 V vs. Na+/Na.`);
assert.equal(windowRecord[0].electrochemicalWindow, "0.1 – 5.0 V");
assert.match(windowRecord[0].potentialReference ?? "", /Na/i);

const electronicConductor = conductivityMockExtract(`[PAGE 1]
The MXene showed an electrical conductivity of 15,000 S/cm and was used as a current collector.`);
assert.deepEqual(electronicConductor, [], "electronic conductivity of a current collector is out of scope");

console.log("Conductivity extraction tests passed");
