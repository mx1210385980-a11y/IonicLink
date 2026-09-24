import assert from "node:assert/strict";
import { findPerformanceFigureCandidates } from "./performanceFigureBackfill";

const rct = findPerformanceFigureCandidates([
  {
    page: 2,
    text: "The fitted Rct values were 370.5 Ω and 260.8 Ω (Fig. 4a).\nFig. 4. a) Nyquist plots obtained by electrochemical impedance spectroscopy for the modified GCE series.",
  },
], {
  field: "chargeTransferResistance",
  rawValue: "370.5 Ω",
  provenancePage: 2,
  method: "EIS",
  seriesTokens: ["CPO-ILBMB/rGO/GCE"],
});
assert.equal(rct[0]?.figure, "Fig. 4a");
assert.ok((rct[0]?.score ?? 0) >= 20);
assert.equal(rct[0]?.valueMatched, true);

const panelBinding = findPerformanceFigureCandidates([
  { page: 5, text: "Fig. 3 a CV curves and b EIS spectra of the modified sensor." },
], {
  field: "chargeTransferResistance",
  rawValue: "1374 Ω",
  provenancePage: 5,
  method: "EIS",
});
assert.equal(panelBinding[0]?.figure, "Fig. 3b", "the EIS target binds to panel b rather than the CV panel");

const noWordSuffix = findPerformanceFigureCandidates([
  { page: 6, text: "Fig. 5 shows specific conductivity of these eight ILs." },
], {
  field: "conductivity",
  rawValue: "2.77 mS/cm",
  provenancePage: 6,
});
assert.equal(noWordSuffix[0]?.figure, "Fig. 5", "the first letter of 'shows' is not a panel suffix");

const window = findPerformanceFigureCandidates([
  { page: 7, text: "Fig. 6. CV analyses of the different ionic-liquid electrolytes from 0.1 to 5.0 V vs Na+/Na." },
  { page: 8, text: "As shown in Fig. 6, the electrochemical window is wider than 4.2 V. Conclusions." },
], {
  field: "electrochemicalWindow",
  rawValue: ">4.2 V",
  provenancePage: 8,
  method: "CV",
  seriesTokens: ["Pyr13", "TFSI", "Na01"],
});
assert.equal(window[0]?.page, 7, "the actual caption page outranks a body reference to the same figure");
assert.equal(window[0]?.figure, "Fig. 6");

const viscosity = findPerformanceFigureCandidates([
  { page: 5, text: "Figure 1a. Cyclic voltammograms recorded during electropolymerization." },
  { page: 6, text: "The viscosity at 20 °C was 682 cP and is listed in Table S1." },
], {
  field: "viscosity",
  rawValue: "682 cP",
  provenancePage: 6,
  method: "viscometer",
  seriesTokens: ["pyrrole-C6MIm", "PF6"],
});
assert.equal(viscosity.length, 0, "an unrelated nearby voltammogram must not support a viscosity value");

const semFalsePositive = findPerformanceFigureCandidates([
  { page: 9, text: "Rct increased with inhibitor concentration.\nFig. 7. SEM micrographs of the corroded mild-steel specimens." },
], {
  field: "chargeTransferResistance",
  rawValue: "230.68 Ω cm2",
  provenancePage: 9,
  method: "EIS",
});
assert.equal(semFalsePositive.length, 0, "performance words elsewhere on the page must not turn an SEM caption into an EIS match");

const corrosion = findPerformanceFigureCandidates([
  { page: 3, text: "Figure 2a and 2b present the Nyquist and Bode plots. The fitted charge-transfer resistance Rct is given in Table 3." },
], {
  field: "chargeTransferResistance",
  rawValue: "95.64 ± 6.29 Ω cm2",
  provenancePage: 3,
  method: "EIS",
  seriesTokens: ["PCVIB", "N80-CS", "5 ppm"],
});
assert.equal(corrosion[0]?.figure, "Fig. 2a");

console.log("Conductivity performance-figure backfill tests passed");
