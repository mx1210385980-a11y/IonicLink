import assert from "node:assert/strict";
import { conductivityMockExtract } from "./extract";

const text = `[PAGE 1]
Electrical properties of [EMIM][BF4]
At 298 K and 1.5 bar on Pt, the ionic conductivity was 3.5 mS/cm. The measured capacitance was 120 pF and the applied electric field was 2 kV/cm.`;

const records = conductivityMockExtract(text);
assert.equal(records.length, 1, "properties sharing one condition set should be combined in one record");
const capacitanceRecord = records[0];
const electricFieldRecord = records[0];
assert.equal(capacitanceRecord?.capacitance, "120 pF");
assert.equal(electricFieldRecord?.electricField, "2 kV/cm");
assert.equal(capacitanceRecord?.pressure, "1.5 bar");
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
CV was scanned for [Pyr13][TFSI] in the voltage range 0.1 – 5.0 V vs. Na+/Na.
After five cycles the electrolyte was electrochemically stable above 4.2 V.`);
assert.equal(windowRecord.length, 1, "the CV scan range must not be stored as a stability window");
assert.equal(windowRecord[0].electrochemicalWindow, ">4.2 V");

const electronicConductor = conductivityMockExtract(`[PAGE 1]
The MXene showed an electrical conductivity of 15,000 S/cm and was used as a current collector.`);
assert.deepEqual(electronicConductor, [], "electronic conductivity of a current collector is out of scope");

const viscosityRecords = conductivityMockExtract(`[PAGE 6]
The pyrrole ionic liquids CPIL1 [MIm][PF6] and CPIL2 [MIm][TFSI] should have viscosity below 500 cP for processing.
At 20 °C, the measured viscosities of CPIL1 and CPIL2 were 682 cP and 363 cP, respectively.`);
assert.deepEqual(
  viscosityRecords.map((record) => record.viscosity),
  ["682 cP", "363 cP"],
  "measured viscosity is a standalone target and a generic processing limit is excluded",
);

const currentCapacitance = conductivityMockExtract(`[PAGE 1]
Acidic electrolytes have previously reported volumetric capacitance of 1500 F/cm3.
[EMIM][TFSI] on Ti3C2Tx was measured at room temperature and showed a volumetric capacitance of 140 F/cm3.`);
assert.deepEqual(currentCapacitance.map((record) => record.capacitance), ["140 F/cm3"]);

const resistanceSeries = conductivityMockExtract(`[PAGE 2]
For the ionic-liquid composite, the charge-transfer resistance values were CPO/GCE: 618.6 Ω,
CPO-ILBMB/rGO/GCE: 370.5 Ω, CPO-ILBMB/rGO-Au NPs/GCE: 260.8 Ω,
bare GCE: 84.1 Ω, rGO/GCE: 69.7 Ω, and rGO-Au NPs/GCE: 13.23 Ω.`);
assert.deepEqual(
  resistanceSeries.map((record) => record.chargeTransferResistance),
  ["370.5 Ω", "260.8 Ω"],
  "blank electrodes that do not contain the ionic liquid must be excluded",
);

const xpsPressure = conductivityMockExtract(`[PAGE 3]
[BMP][DCA] on Pt(111) has an electrochemical stability window of approximately 3.4 V at 23 ± 1 °C.
XPS was performed in an analyzer chamber at 10−9 mbar.`)[0];
assert.equal(xpsPressure.electrochemicalWindow, "3.4 V");
assert.equal(xpsPressure.pressure, undefined, "XPS vacuum is not an electrochemical measurement condition");

const tableRecords = conductivityMockExtract(`[PAGE 3]
Poly(1-acetamide-3-vinylimidazolium bromide) (PCVIB) was tested on N80-CS in 1.0 mol L−1 HCl at 25.0 ± 0.1 °C.
Sample C/ppm Rs/Ω cm2 n Y0/μS sn cm−2 CDL/μF cm−2 Rp/Ω cm2
PCVIB 5 2.48 ± 0.14 0.8366 ± 0.0041 299.3 ± 15.4 149.3 ± 8.2 95.64 ± 6.29
10 2.41 ± 0.12 0.8101 ± 0.0138 248.8 ± 1.4 115.4 ± 8.1 149.57 ± 4.03`);
assert.equal(tableRecords.length, 2, "Cdl and Rp from one table row must share one record");
assert.deepEqual(tableRecords.map((record) => record.capacitance), ["149.3 ± 8.2 µF/cm²", "115.4 ± 8.1 µF/cm²"]);
assert.deepEqual(tableRecords.map((record) => record.chargeTransferResistance), ["95.64 ± 6.29 Ω cm²", "149.57 ± 4.03 Ω cm²"]);
assert.equal(tableRecords[0].concentration, "5 ppm PCVIB in 1.0 mol/L HCl");
assert.equal(tableRecords[0].temperature, "25.0 ± 0.1 °C");

const encodedRange = conductivityMockExtract(`[PAGE 1]
In pure form, the ionic conductivity of [CxCyIm][FcNTf] was found to range between 0.22 and 0.42 mS cm\u00011 at 60 \u000eC.`);
assert.equal(encodedRange.length, 1, "PDF control characters in exponents and degree signs must be normalized");
assert.equal(encodedRange[0].conductivity, "0.22–0.42 mS cm−1");
assert.equal(encodedRange[0].temperature, "60 °C");
assert.equal(encodedRange[0].cation, "[CxCyIm]");
assert.equal(encodedRange[0].anion, "[FcNTf]");

const pairedBulkTable = conductivityMockExtract(`[PAGE 2]
Table 1: ionic conductivity and viscosity at 20°C of various ionic liquids.
Ionic liquids Viscosity 20°C (Pa.s) Ionic conductivity 20°C (S.m-1)
BMPyrTFSI 0.092 2.29
BMITFSI 0.047 3.39
BMIBF4 0.107 2.62
EMITFSI 0.038 7.39
DMBIBF4 0.713 0.58`);
assert.equal(pairedBulkTable.length, 5, "paired bulk properties are merged into one record per IL and condition set");
assert.deepEqual(
  pairedBulkTable.filter((record) => record.cation === "[BMPyr]").map((record) => [record.viscosity, record.conductivity]),
  [["0.092 Pa·s", "2.29 S/m"]],
);
assert.equal(pairedBulkTable[0].method, "viscometer; impedance spectroscopy");
assert.ok(pairedBulkTable.every((record) => record.temperature === "20 °C"));

const wideBulkTable = conductivityMockExtract(`[PAGE 4]
Entry Ionic liquids Tg (°C) Td (°C) density (g cm−3) viscosity (cP) conductivity (mS cm−1)
1 N22.2(1O2)[FSI] 15 94.3 303 1.3263 81 2.77
2 N1.3(1O2)[FSI] −86 300 1.3528 79 2.40
3 N4(1O2) [FSI] −57 −22 21 88.6 287 1.3178 127 1.34
Viscosity at 25°C. Specific conductivity at 25°C.`);
assert.equal(wideBulkTable.length, 3);
assert.deepEqual(wideBulkTable.map((record) => record.temperature), ["25 °C", "25 °C", "25 °C"]);
assert.deepEqual(
  wideBulkTable.filter((record) => record.cation === "[N22.2(1O2)]").map((record) => [record.viscosity, record.conductivity]),
  [["81 cP", "2.77 mS/cm"]],
);

const windowTable = conductivityMockExtract(`[PAGE 6]
Electrochemical windows for various ionic liquids at 25 °C measured on a glassy carbon electrode versus Fc/Fc+.
Salts Ecathodic(V) Eanodic(V) EWs(V)
N22.2(1O2)[FSI] −3.06 2.42 5.48
N1.3(1O2)[FSI] −3.05 2.37 5.42`);
assert.deepEqual(windowTable.map((record) => record.electrochemicalWindow), ["5.48 V", "5.42 V"]);
assert.ok(windowTable.every((record) => record.surface === "glassy carbon electrode"));
assert.ok(windowTable.every((record) => record.temperature === "25 °C"));

const criterionWindowTable = conductivityMockExtract(`[PAGE 6]
Ionic-liquid electrochemical-window measurements.
LSV profiles were recorded at 25 ± 1 °C using Fc/Fc+ as reference.
Table 2
The Epw-AL, Epw-CL, and Epw of [C4 mim][PF6] on Au(hkl) at different jcut-off values.
jcut-off Au(hkl) Epw-CL Epw-AL Epw
(mA cm−2) (V) (V) (V)
0.1 Au(111) −2.80 1.80 4.60
Au(100) −2.74 1.72 4.46
Au(110) −2.65 1.66 4.31
0.5 Au(111) −2.95 1.91 4.86
Au(100) −2.88 1.83 4.71
Au(110) −2.79 1.78 4.57`);
assert.equal(criterionWindowTable.length, 6, "cut-off-dependent potential-window rows remain separate condition sets");
assert.ok(criterionWindowTable.every((record) => record.cation === "[C4 mim]" && record.anion === "[PF6]"));
assert.ok(criterionWindowTable.every((record) => record.temperature === "25 ± 1 °C"));
assert.deepEqual(
  criterionWindowTable.map((record) => record.electrochemicalWindow),
  ["4.60 V", "4.46 V", "4.31 V", "4.86 V", "4.71 V", "4.57 V"],
);
assert.deepEqual(
  criterionWindowTable[0].flexible?.map((item) => `${item.key}: ${item.value} ${item.unit ?? ""}`.trim()),
  ["Cut-off current density: ±0.1 mA/cm²", "Cathodic limit: −2.80 V vs Fc/Fc+", "Anodic limit: 1.80 V vs Fc/Fc+"],
);

const temperatureMatrix = conductivityMockExtract(`[PAGE 5]
The ILOL systems contain [C3C1pyrr][FSA].
Table II. Ionic conductivity results (mS cm−1) and fitting parameters.
Electrolytes
Temp./K ILOL 0 ILOL 20 ILOL 50 Ref 1
273 2.9 3.6 3.2 2.4
283 4.2 5.2 4.9 3.6
Table III. Viscosity results (mPa s) and fitting parameters.
Electrolytes
Temp/K ILOL 0 ILOL 20 ILOL 50 Ref 1
273 15.4 22.9 54.5 15.4`);
assert.equal(temperatureMatrix.length, 4, "matrix properties merge at equal temperature and IL concentration");
assert.ok(temperatureMatrix.every((record) => record.cation === "[C3C1pyrr]" && record.anion === "[FSA]"));
assert.ok(temperatureMatrix.every((record) => record.concentration === "ILOL 20" || record.concentration === "ILOL 50"));
assert.equal(temperatureMatrix.filter((record) => record.temperature === "273 K").length, 2);
assert.ok(temperatureMatrix.filter((record) => record.temperature === "273 K").every((record) => record.conductivity && record.viscosity));

const impedanceTable = conductivityMockExtract(`[PAGE 9]
Electrochemical impedance parameters for mild steel in ionic-liquid inhibitors.
Inhibitors Conc
(mol L−1)
Rs
(Ω cm2)
Rct
(Ω cm2)
n Cdl
(μF cm−2)
η% θ
[bmim][Cl] 1.73 × 10−4 0.883 58.81 0.997 112.80 73.64 0.7364
3.47 × 10−4 1.63 98.07 0.997 195.59 84.19 0.8419
[bmim][Ac] 1.73 × 10−4 1.57 87.83 0.997 123.59 82.35 0.8235
3.47 × 10−4 9.27 121.73 0.997 59.07 87.26 0.8726`);
assert.equal(impedanceTable.length, 4, "Rct and Cdl from every IL-containing impedance row share one record");
assert.deepEqual(
  impedanceTable.filter((record) => record.cation === "[bmim]" && record.anion === "[Cl]").map((record) => record.chargeTransferResistance),
  ["58.81 Ω cm²", "98.07 Ω cm²"],
);
assert.deepEqual(
  impedanceTable.filter((record) => record.cation === "[bmim]" && record.anion === "[Cl]").map((record) => record.capacitance),
  ["112.80 µF/cm²", "195.59 µF/cm²"],
);
assert.equal(
  conductivityMockExtract("[BMIM][Cl] impedance uses Z = 1 / (jω); n = 0 corresponds to resistance Rct.").length,
  0,
  "angular frequency omega is not the ohm symbol",
);
assert.equal(
  conductivityMockExtract("[BMIM][BF4] gives very low vapor pressure and a high electrochemical window.").length,
  0,
  "a citation number before lowercase 'very' is not parsed as volts",
);
assert.equal(
  conductivityMockExtract("The new ionic liquids show wide electrochemical windows ranging from 4.8 to 5.8 V." ).length,
  0,
  "an aggregate range across several ionic liquids is not assigned to one ion pair",
);
assert.equal(
  conductivityMockExtract("For [BMIM][BF4], viscosity measurements have an uncertainty of ±0.03 mPa·s.").length,
  0,
  "measurement uncertainty is not a viscosity result",
);
assert.equal(
  conductivityMockExtract("The [BMIM][BF4] device has charge-transfer resistance; the control has Rs = 1.89 Ω.").length,
  0,
  "series resistance Rs is not charge-transfer resistance Rct",
);

const longReview = `${"Review Article. This review summarizes ionic liquid electrolytes for energy storage. ".repeat(180)}
[EMIM][TFSI] has an ionic conductivity of 8.0 mS/cm at 298 K.`;
assert.equal(conductivityMockExtract(longReview).length, 0, "explicit review articles do not contribute background values");

const unrelatedLongElectrolyte = `${"Agarose sodium nitrate biopolymer electrolyte. ".repeat(300)}
The measured ionic conductivity was 1.73 × 10−3 S/cm.`;
assert.equal(conductivityMockExtract(unrelatedLongElectrolyte).length, 0, "long papers without an ionic-liquid study subject are rejected");

const contentsLedReview = `Ionic liquids at electrified interfaces
Contents
1 Introduction ................................ 4
2 RTIL properties ............................. 7
2.1 Transport properties ..................... 15
2.2 Electrochemical stability ................ 18
3 Electric double layers ..................... 21
4 Mean-field theory ........................... 30
5 Experimental studies ....................... 60
6 Electrode reactions ........................ 73
7 Confined geometry .......................... 85
8 Applications .............................. 109
${"This chapter surveys room-temperature ionic liquids and published measurements. ".repeat(180)}
[EMIM][TFSI] has a reported capacitance of 12 µF/cm².`;
assert.equal(conductivityMockExtract(contentsLedReview).length, 0, "contents-led scholarly reviews do not contribute secondary values");

console.log("Conductivity extraction tests passed");
