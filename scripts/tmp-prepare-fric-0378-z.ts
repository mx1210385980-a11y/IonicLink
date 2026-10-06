/**
 * Generate reviewed-fric-0378-z.json for Guo & Iglesias, Friction 9(1): 169-178 (2021),
 * DOI 10.1007/s40544-020-0378-z (accepted February 2020).
 * Protic ionic liquid tri-[bis(2-hydroxyethylammonium)] citrate (DCi), 1 wt% in a mineral oil (MO),
 * AISI 52100 steel-steel reciprocating ball-on-flat, 2 N, room temperature and 100 C.
 * COF values: pixel-calibrated digitization of the Fig. 6 bar chart (PDF p5) - no numeric labels
 * are printed on the figure. Two independent readings per bar (strict edge-first; tolerant
 * run-verified) agree within 0.0008. Digitization audit:
 * data/literature-expansion-20260912/digit-work/readings.json
 */
import { writeFileSync } from 'node:fs';

const PDF = 'data/literature-expansion-20260912/discovery-bulk-03/10.1007-s40544-020-0378-z.pdf';
const URL = 'https://doi.org/10.1007/s40544-020-0378-z';
const DOI = '10.1007/s40544-020-0378-z';
const TITLE = 'Tribological behavior of ammonium-based protic ionic liquid as lubricant additive';

// DCi = tri-[bis(2-hydroxyethylammonium)] citrate: 3 protic ammonium cations per citrate(3-) anion,
// empirical formula C18H41O13N3 (Table 2, PDF p2).

const SUBSTRATE_PROV = {
  field: 'substrate', basis: 'direct', page: 3,
  quote: 'AISI 52100 steel disks \u2026 slid against AISI 52100 steel balls \u2026 with diameter of 1.5 mm',
};
const TEMP_PROV = {
  field: 'temperature', basis: 'direct', page: 3,
  quote: 'with a heater to run tests at room temperature and 100 \u00b0C, respectively',
};
const LOAD_PROV = {
  field: 'load', basis: 'direct', page: 3,
  quote: 'The tribotests were carried out under a normal load of 2 N, which corresponds to a mean Hertz contact pressure of 1.34 GPa and a maximum Hertz contact pressure of 2.02 GPa',
};
const VEL_PROV = {
  field: 'velocity', basis: 'direct', page: 3,
  quote: 'The sliding speed for each test was set to 0.05 m/s with frequency of 5 Hz, stroke length of 5 mm, and sliding distance of 200 m',
};
const CONC_PROV = {
  field: 'concentration', basis: 'direct', page: 2,
  quote: 'DCi was added in 1 wt% to MO to form a homogeneous mixture at room temperature',
};

const REASON_TAIL =
  ' Two independent pixel readings (strict edge-first; tolerant run-verified) of each bar agree within 0.0008 COF (promotion gate +/-0.005), and the digitized MO/DCi pairs reproduce the paper-stated friction reductions (29.0% at room temperature, 35.5% at 100 \u00b0C) to within 0.6 percentage points. ' +
  'Conditions from the Materials and methods (PDF p3): custom reciprocating ball-on-flat tribometer, AISI 52100 steel disk vs 1.5 mm AISI 52100 steel ball, 2 N (mean Hertz pressure 1.34 GPa), 0.05 m/s, 5 Hz, 5 mm stroke, 200 m sliding, 1 mL lubricant per test. ' +
  'The neat-MO control bars of Fig. 6 (COF 0.144 digitized at room temperature and 0.153 at 100 \u00b0C) contain no ionic liquid and are excluded from the records per platform scope; they are retained only as the cross-check base for the stated reductions. ' +
  'Published in Friction 9(1) 2021 (article accepted February 2020). Source-based AI-assisted curation; not independent domain-expert validation.';

const SPECS = [
  {
    key: 'protpil-dci-1wt-mo-room-temperature',
    temperature: 'room temperature',
    cof: 0.101,
    readings: 'Fig. 6 bar "1%DCi+MO" at Room temperature: 0.1009 (A) / 0.1017 (B), |A-B| = 0.0008; promoted cof = mean rounded to 3 decimals (0.101).',
    cofQuote: 'frictional performance is improved at both temperatures studied with a friction reduction of 29.0% and 35.5%, respectively',
    cofPage: 1,
    cofNote: 'COF digitized from the Fig. 6 bar chart (panel "Room temperature", PDF p5; the figure prints no numeric labels). Readings: 0.1009 (A, strict) / 0.1017 (B, tolerant). Text cross-check: digitized MO bar 0.1437 with the stated 29.0% reduction implies 0.1020; the stated reduction reproduced from the digitized pair (1-0.101/0.1437) is 29.5%, within 0.6 percentage points of the stated 29.0%.',
    reasonHead: 'Average friction coefficient of 1 wt% DCi+MO at room temperature over the 200 m reciprocating steel-steel test, digitized from the Fig. 6 bar chart (PDF p5).',
    tempValue: 'room temperature',
    blendViscosity: '97.17 cP at 25 \u00b0C, 43.58 cP at 40 \u00b0C, 6.22 cP at 100 \u00b0C (MO alone: 92.78 / 42.54 / 5.90 cP)',
    wearNote: 'at room temperature the presence of DCi slightly increased the disk wear volume vs MO (PDF p5); ball scar size unchanged (Fig. 8(a) vs 8(c))',
  },
  {
    key: 'protpil-dci-1wt-mo-100c',
    temperature: '100 \u00b0C',
    cof: 0.099,
    readings: 'Fig. 6 bar "1%DCi+MO" at 100 \u00b0C: 0.0985 (A) / 0.0993 (B), |A-B| = 0.0008; promoted cof = mean rounded to 3 decimals (0.099).',
    cofQuote: 'maximum friction reduction of 35.5% is obtained when the mixture was used as lubricant compared with neat MO at 100 \u00b0C',
    cofPage: 5,
    cofNote: 'COF digitized from the Fig. 6 bar chart (panel "100 \u00b0C", PDF p5; the figure prints no numeric labels). Readings: 0.0985 (A, strict) / 0.0993 (B, tolerant). Text cross-check: digitized MO bar 0.1534 with the stated 35.5% reduction implies 0.0989; the stated reduction reproduced from the digitized pair (1-0.099/0.1534) is 35.5%, matching exactly.',
    reasonHead: 'Average friction coefficient of 1 wt% DCi+MO at 100 \u00b0C over the 200 m reciprocating steel-steel test, digitized from the Fig. 6 bar chart (PDF p5).',
    tempValue: '100 \u00b0C',
    blendViscosity: '97.17 cP at 25 \u00b0C, 43.58 cP at 40 \u00b0C, 6.22 cP at 100 \u00b0C (MO alone: 92.78 / 42.54 / 5.90 cP)',
    wearNote: 'at 100 \u00b0C the disk wear volume is reduced 59.4% vs MO and the ball wear track is smaller (PDF p5, Fig. 8(b) vs 8(d))',
  },
];

const candidates = SPECS.map((s) => {
  return {
    key: s.key,
    sourcePdf: PDF,
    sourceUrl: URL,
    decision: 'approve',
    reason:
      `${s.reasonHead} cof ${s.cof} is the two-reading pixel-calibrated digitization of the unlabeled bar; the digitized MO/DCi pair reproduces the paper-stated friction reduction for this temperature, and DCi lowers the COF relative to MO at both temperatures as the text requires. ` +
      REASON_TAIL,
    fields: {
      paper: { title: TITLE, doi: DOI, journal: 'Friction', year: 2021 },
      cation: 'bis(2-hydroxyethylammonium)',
      cationSmiles: 'OCC[NH3+]CCO',
      anion: 'citrate (2-hydroxypropane-1,2,3-tricarboxylate, 3-)',
      anionSmiles: '[O-]C(=O)CC(O)(CC([O-])=O)C([O-])=O',
      substrate: 'AISI 52100 steel disk (lower flat specimen)',
      temperature: s.tempValue,
      load: '2 N',
      cof: s.cof,
      cofMethod: 'Average friction coefficient of the 200 m reciprocating run ("Friction coefficients were recorded over time and calculated as average of each running", PDF p3), read from the unlabeled Fig. 6 bar chart by two-reading pixel-calibrated digitization',
      scale: 'macro',
      method: 'Reciprocating ball-on-flat sliding, custom-designed tribometer with heater',
      probe: 'AISI 52100 steel ball, 1.5 mm diameter',
      probeType: 'ball',
      velocity: '0.05 m/s (5 Hz, 5 mm stroke)',
      roughness: 'AISI 52100 steel disk Ra \u2248 0.008 \u00b5m; ball Ra \u2248 0.53 \u00b5m',
      concentration: '1 wt% DCi in mineral oil (MO, Repsol)',
      flexible: [
        { key: 'cof_digitization', value: s.readings, note: 'Calibration: Fig. 6 gridlines at rows y = 162, 187, 212, 236, 261, 286, 335, 360, 385 px mapped to 0.18-0.00 COF (median spacing 25.0 px per 0.02; the 0.06 gridline is hidden behind the bars and skipped by the spacing-robust assignment; linear-fit residual <= 0.0003 COF). MO bars digitized 0.1437 (room temperature) and 0.1534 (100 \u00b0C). Full audit in data/literature-expansion-20260912/digit-work/readings.json and digit-check-fig6.png overlay.' },
        { key: 'ion_stoichiometry', value: 'DCi = tri-[bis(2-hydroxyethylammonium)] citrate: 3 bis(2-hydroxyethylammonium) cations per citrate(3-) anion; empirical formula C18H41O13N3', note: 'Table 2 (PDF p2); synthesis from 0.6 mol diethanolamine + 0.2 mol citric acid (PDF p2). "0.2 ml citric acid" in the PDF text is a typographical error for 0.2 mol (molar ratio 3:1).' },
        { key: 'hertz_contact', value: 'mean Hertz contact pressure 1.34 GPa, maximum 2.02 GPa at 2 N', note: 'PDF p3.' },
        { key: 'blend_viscosity', value: s.blendViscosity, note: 'Table 4 (PDF p4); adding 1 wt% DCi raises MO viscosity only slightly.' },
        { key: 'lubricant_volume', value: '1 mL lubricant added before each test; no replenishment', note: 'PDF p3.' },
        { key: 'stability', value: '1 wt% DCi in MO: no visual deposit after centrifuging (6,500 rpm, 10 min) nor after 24, 168, 720 h', note: 'PDF p3-4, Fig. 3.' },
        { key: 'wear_data', value: s.wearNote, note: 'Wear volumes (Fig. 7) recorded here as context only; this batch stores friction.' },
        { key: 'thermal_stability', value: 'onset decomposition: MO 291.2 \u00b0C, DCi 191.2 \u00b0C, 1 wt% DCi+MO 300.4 \u00b0C', note: 'Table 3 (PDF p4).' },
        { key: 'tribolayer', value: 'oxygen-richened (C,O) tribolayer inside the wear track at 100 \u00b0C per EDS', note: 'PDF p7-8, Fig. 13; proposed mechanism for the good high-temperature lubricating behavior.' },
      ],
      provenance: [
        { field: 'cation', basis: 'direct', page: 2, quote: 'The PIL, tri-[bis(2-hydroxyethylammonium)] citrate (DCi), was synthesized in our laboratory', note: 'Protic cation from diethanolamine neutralization (PDF p2 synthesis); 3 cations per citrate anion per Table 2 formula C18H41O13N3.' },
        { field: 'anion', basis: 'direct', page: 1, quote: 'Tri-[bis(2-hydroxyethylammonium)] citrate (DCi) was synthesized in a simple and low-cost way', note: 'Citrate(3-) anion from citric acid deprotonation; ionic structure confirmed by 1H NMR (PDF p3: anion C=O-CH2 peak at \u03b4 2.33-2.4).' },
        SUBSTRATE_PROV,
        { field: 'temperature', basis: 'direct', page: 3, quote: TEMP_PROV.quote, note: `This record is the ${s.temperature} condition of the two-temperature study.` },
        LOAD_PROV,
        { field: 'cof', basis: 'inferred', page: s.cofPage, quote: s.cofQuote, note: s.cofNote },
        VEL_PROV,
        CONC_PROV,
      ],
    },
  };
});

writeFileSync('data/literature-expansion-20260912/reviewed-fric-0378-z.json', JSON.stringify(candidates, null, 2));
console.log('wrote', candidates.length, 'candidates');
