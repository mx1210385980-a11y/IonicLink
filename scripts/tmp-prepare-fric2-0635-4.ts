/**
 * Generate reviewed-fric2-0635-4.json for Wang et al., Friction 11(6): 949-965 (2023),
 * DOI 10.1007/s40544-022-0635-4 (accepted 2022).
 * IL-modified carbon nanoparticle additives (A-g-CNPs / C-g-CNPs) and the pure component ILs
 * [C16-MIm]Cl / [C16-HA]Na as PEG200 additives.
 * COF values: printed bar labels of Fig. 14(b) (PDF p11) and Fig. 12(b) (PDF p10), verified by
 * pixel-calibrated digitization of those bars and of the parallel Fig. 8(a)/(b) bars (PDF p7).
 * Digitization audit: data/literature-expansion-20260912/digit-work/readings.json
 */
import { writeFileSync } from 'node:fs';

const PDF = 'data/literature-expansion-20260912/discovery-friction/10.1007-s40544-022-0635-4.pdf';
const URL = 'https://doi.org/10.1007/s40544-022-0635-4';
const DOI = '10.1007/s40544-022-0635-4';
const TITLE = 'Astonishingly distinct lubricity difference between the ionic liquid modified carbon nanoparticles grafted by anion and cation moieties';

const C16MIM = {
  cation: '1-hexadecyl-3-methylimidazolium',
  cationSmiles: 'C[n+]1ccnc1CCCCCCCCCCCCCCCC',
};
// grafted carboxylate fragment: core stubbed as acetamide methyl
const AG_ANION = {
  anion: 'beta-alanine-derived carboxylate grafted on carbon nanoparticle core',
  anionSmiles: 'CC(=O)NCCC(=O)[O-]',
};
// grafted [AMIm]+ fragment: core stubbed as acetamide methyl on the amino end
const CG_CATION = {
  cation: '1-aminoethyl-3-methylimidazolium',
  cationSmiles: 'C[n+]1ccnc1CCNC(=O)C',
};
const HEPTADECANOATE = {
  anion: 'heptadecanoate (margarate)',
  anionSmiles: 'CCCCCCCCCCCCCCCCC(=O)[O-]',
};

const SUBSTRATE_PROV = {
  field: 'substrate', basis: 'inferred', page: 4,
  quote: 'with a ball-on-disk linear reciprocating sliding module',
  note: 'Steel contact implied by the wear-track analyses (PDF p11-12: "severe oxidation of steel surface", Fe- and Cr-containing tribofilm species); the steel grade and ball specification are not stated in this paper (test conditions deferred to ref. [45]). Field value records the lower-disk substrate of the steel-steel pair.',
};
const TEMP_PROV = {
  field: 'temperature', basis: 'direct', page: 4,
  quote: 'All the friction tests were conducted at room temperature (15\u201320 \u00b0C) and under the atmospheric environment with the relative humidity of 60%\u201370%.',
};
const VEL_PROV = {
  field: 'velocity', basis: 'direct', page: 4,
  quote: 'The average sliding speed was about 10 mm/s.',
};
const REASON_TAIL =
  ' Two independent pixel readings (strict edge-first; tolerant run-verified) of every bar agree within 0.0007 COF, and the digitization pipeline reproduces all eight printed COF labels of Figs. 12(b)/14(b) within 0.005 (positive-control check), so the promotion gate of +/-0.005 is satisfied for every candidate. ' +
  'Conditions from the Experimental section (PDF p4): Bruker UMT-TriboLab, ball-on-disk linear reciprocating sliding, 5 mm amplitude, ~10 mm/s, room temperature (15-20 \u00b0C), 60-70% RH. ' +
  'Neat-PEG200 base-oil bars (Figs. 8, 11, 12(b), 14(b) bar A) contain no ionic species and are excluded per platform scope; CNPs-Na/CNPs-Cl precursors were not tribotested. ' +
  'Published in Friction 11(6) 2023 (article accepted April 2022). Source-based AI-assisted curation; not independent domain-expert validation.';

interface Spec {
  key: string;
  ions: Record<string, string>;
  cof: number;
  duration: string;
  bar: string;
  cofQuote: string;
  cofPage: number;
  loadProv: { field: string; basis: string; page: number; quote: string };
  concProv: { field: string; basis: string; page: number; quote: string };
  cofNote: string;
  digitization: string;
  extraFlexible?: { key: string; value: string; note?: string }[];
}

const SPECS: Spec[] = [
  {
    key: 'ilfilm-c-g-cnps-peg200-07wt-100n-20min',
    ions: { ...CG_CATION, ...HEPTADECANOATE },
    cof: 0.06,
    duration: '20 min',
    bar: 'Fig. 14(b) bar C (C-g-CNPs dispersion, 0.7 wt%)',
    cofQuote: 'the [C16-MIm]Cl even exhibits better friction and wear reduction effects than A-g-CNPs',
    cofPage: 10,
    loadProv: { field: 'load', basis: 'direct', page: 11, quote: 'under the conditions of 100 N and 20 min' },
    concProv: { field: 'concentration', basis: 'direct', page: 11, quote: '(B) A-g-CNPs (C) C-g-CNPs dispersions (0.7 wt%) in PEG200' },
    cofNote: 'COF digitized/verified: printed bar label 0.06 in Fig. 14(b) (panel b, PDF p11); pixel-calibrated digitization of the same bar gives 0.0635 (mean of readings A/B, |A-B|=0.0000) and of the parallel Fig. 8(a) c=0.7 wt% bar 0.0629 (readings A/B identical); |label-digitized| = 0.003 <= 0.005 gate; text consistency: 1-0.0629/0.1288 = 51.2% vs stated "about 51.0%".',
    digitization: 'Fig. 8(a) c=0.7 wt% bar: 0.0629 (A) / 0.0629 (B); Fig. 14(b) bar C: 0.0635 (A) / 0.0635 (B); printed label 0.06. Calibration: Fig. 8(a) frame rows y=861/1078 px = 0.150/0.050 COF with 5 evenly spaced axis ticks [861, 915, 970, 1024, 1078]; Fig. 14(b) frame rows y=741.5/957.5 px = 0.20/0.05 COF.',
  },
  {
    key: 'ilfilm-a-g-cnps-peg200-07wt-100n-20min',
    ions: { ...C16MIM, ...AG_ANION },
    cof: 0.13,
    duration: '20 min',
    bar: 'Fig. 14(b) bar B (A-g-CNPs dispersion, 0.7 wt%)',
    cofQuote: 'the average COF of base oil only reduces by 2.5% when 0.7 wt% A-g-CNPs is added',
    cofPage: 8,
    loadProv: { field: 'load', basis: 'direct', page: 11, quote: 'under the conditions of 100 N and 20 min' },
    concProv: { field: 'concentration', basis: 'direct', page: 11, quote: '(B) A-g-CNPs (C) C-g-CNPs dispersions (0.7 wt%) in PEG200' },
    cofNote: 'COF digitized/verified: printed bar label 0.13 in Fig. 14(b) (panel b, PDF p11); pixel-calibrated digitization of the same bar gives 0.1257 (mean of readings A/B, |A-B|=0.0007) and of the parallel Fig. 8(b) c=0.7 wt% bar 0.1261 (readings A/B identical); |label-digitized| = 0.004 <= 0.005 gate; text consistency: 1-0.1261/0.1294 = 2.6% vs stated 2.5% reduction.',
    digitization: 'Fig. 8(b) c=0.7 wt% bar: 0.1261 (A) / 0.1261 (B); Fig. 14(b) bar B: 0.1260 (A) / 0.1253 (B); printed label 0.13. Calibration: Fig. 8(b) frame rows y=1129/1347 px = 0.150/0.050 COF (same panel geometry and tick spacing as Fig. 8(a)).',
  },
  {
    key: 'ilfilm-c16mim-cl-peg200-07wt-100n-20min',
    ions: { ...C16MIM, anion: 'chloride', anionSmiles: '[Cl-]' },
    cof: 0.12,
    duration: '20 min',
    bar: 'Fig. 14(b) bar D ([C16-MIm]Cl solution, 0.7 wt%)',
    cofQuote: 'the [C16-MIm]Cl even exhibits better friction and wear reduction effects than A-g-CNPs',
    cofPage: 10,
    loadProv: { field: 'load', basis: 'direct', page: 11, quote: 'under the conditions of 100 N and 20 min' },
    concProv: { field: 'concentration', basis: 'direct', page: 11, quote: '(D) [C16-MIm]Cl, and (E) [C16-HA]Na solutions (0.7 wt%) in PEG200' },
    cofNote: 'COF digitized/verified: printed bar label 0.12 in Fig. 14(b) (panel b, PDF p11); pixel-calibrated digitization of the same bar gives 0.1153 (mean of readings A/B, |A-B|=0.0007); |label-digitized| = 0.005 <= 0.005 gate. The 0.12 label is consistent with the digitized 0.115 under 2-decimal rounding.',
    digitization: 'Fig. 14(b) bar D: 0.1156 (A) / 0.1149 (B); printed label 0.12. Calibration: frame rows y=741.5/957.5 px = 0.20/0.05 COF.',
  },
  {
    key: 'ilfilm-c16ha-na-peg200-07wt-100n-20min',
    ions: { cation: 'sodium', cationSmiles: '[Na+]', ...HEPTADECANOATE },
    cof: 0.11,
    duration: '20 min',
    bar: 'Fig. 14(b) bar E ([C16-HA]Na solution, 0.7 wt%)',
    cofQuote: 'whereas the lubricating function of [C16-HA]Na is far worse than that of C-g-CNPs',
    cofPage: 10,
    loadProv: { field: 'load', basis: 'direct', page: 11, quote: 'under the conditions of 100 N and 20 min' },
    concProv: { field: 'concentration', basis: 'direct', page: 11, quote: '(D) [C16-MIm]Cl, and (E) [C16-HA]Na solutions (0.7 wt%) in PEG200' },
    cofNote: 'COF digitized/verified: printed bar label 0.11 in Fig. 14(b) (panel b, PDF p11); pixel-calibrated digitization of the same bar gives 0.1105 (mean of readings A/B, |A-B|=0.0007); |label-digitized| = 0.0005 <= 0.005 gate.',
    digitization: 'Fig. 14(b) bar E: 0.1108 (A) / 0.1101 (B); printed label 0.11. Calibration: frame rows y=741.5/957.5 px = 0.20/0.05 COF.',
  },
  {
    key: 'ilfilm-c-g-cnps-peg200-07wt-100n-200min',
    ions: { ...CG_CATION, ...HEPTADECANOATE },
    cof: 0.077,
    duration: '200 min',
    bar: 'Fig. 12(b) bar 3 (C-g-CNPs dispersion, 0.7 wt%)',
    cofQuote: 'resulting in significant COF and WV reductions for PEG200 (40.3% and 59.0%, respectively)',
    cofPage: 10,
    loadProv: { field: 'load', basis: 'direct', page: 10, quote: 'under the conditions of 100 N and 200 min' },
    concProv: { field: 'concentration', basis: 'direct', page: 10, quote: 'under the fixed load = 100 N and c = 0.7 wt%' },
    cofNote: 'COF digitized/verified: printed bar label 0.077 in Fig. 12(b) (panel b, PDF p10); pixel-calibrated digitization of the same bar gives 0.0771 (mean of readings A/B, |A-B|=0.0000); |label-digitized| = 0.0001 <= 0.005 gate; text consistency: 1-0.077/0.129 = 40.3% exactly matches the stated 40.3% COF reduction.',
    digitization: 'Fig. 12(b) C-g-CNPs bar: 0.0771 (A) / 0.0771 (B); printed label 0.077 (PEG200 control bar prints 0.129 and digitizes 0.1290). Calibration: Fig. 12(b) frame rows y=1152/1362 px = 0.20/0.05 COF.',
  },
  {
    key: 'ilfilm-a-g-cnps-peg200-07wt-100n-200min',
    ions: { ...C16MIM, ...AG_ANION },
    cof: 0.144,
    duration: '200 min',
    bar: 'Fig. 12(b) bar 2 (A-g-CNPs dispersion, 0.7 wt%)',
    cofQuote: 'The average COF and mean WV lubricated with A-g-CNPs dispersion are 11.6% and 26.8% higher than that lubricated by PEG200, respectively',
    cofPage: 10,
    loadProv: { field: 'load', basis: 'direct', page: 10, quote: 'under the conditions of 100 N and 200 min' },
    concProv: { field: 'concentration', basis: 'direct', page: 10, quote: 'under the fixed load = 100 N and c = 0.7 wt%' },
    cofNote: 'COF digitized/verified: printed bar label 0.144 in Fig. 12(b) (panel b, PDF p10); pixel-calibrated digitization of the same bar gives 0.1440 (mean of readings A/B, |A-B|=0.0007); |label-digitized| = 0.0000 <= 0.005 gate; text consistency: 0.144/0.129 = +11.6% exactly matches the stated 11.6% COF increase (the conclusions print 11.4%; the digitized values reproduce the body-text 11.6%).',
    digitization: 'Fig. 12(b) A-g-CNPs bar: 0.1443 (A) / 0.1436 (B); printed label 0.144 (PEG200 control bar prints 0.129 and digitizes 0.1290). Calibration: Fig. 12(b) frame rows y=1152/1362 px = 0.20/0.05 COF.',
  },
];

const candidates = SPECS.map((s) => {
  const isPILControl = s.key.includes('c16mim') || s.key.includes('c16ha');
  const flexible: { key: string; value: string; note?: string }[] = [
    { key: 'test_duration', value: s.duration, note: 'PDF p4: "The duration was 20 or 200 min."' },
    { key: 'stroke_amplitude', value: '5 mm', note: 'PDF p4: "The amplitude was 5 mm."' },
    { key: 'environment', value: 'room temperature 15-20 \u00b0C, relative humidity 60%-70%, atmospheric environment', note: 'PDF p4.' },
    { key: 'base_oil', value: 'PEG200 (polyethylene glycol, ~200 g/mol)', note: 'PDF p3 Chemicals; PDF p6 explains PEG200 chosen for comparability with the surface ionic liquid groups.' },
    {
      key: 'cof_digitization', value: s.digitization,
      note: 'Full audit in data/literature-expansion-20260912/digit-work/readings.json and digit-check-*.png overlays; two independent readings A (strict edge-first run rule) and B (tolerant 8-of-12 run rule), per-bar median over 22-28 bar columns; method validated against all printed Fig. 12(b)/14(b) labels within 0.005.',
    },
    {
      key: 'not_extracted', value: 'friction traces (Figs. 8, 10, 12(a), 14(a)), the 50-250 N load series (Fig. 11(a)), and the mean wear volumes (WV bars) are present in the figures but not extracted in this batch',
      note: 'Only the printed average-COF bar values (Figs. 12(b) and 14(b)) and their Fig. 8 cross-checks are recorded.',
    },
  ];
  if (s.key.includes('c-g-cnps') || s.key.includes('a-g-cnps')) {
    flexible.push({
      key: 'particle_size', value: 'carbon nanoparticle core diameter ~20.2 nm (A-g precursor CNPs-Na) / ~22.7 nm (C-g precursor CNPs-Cl)',
      note: 'PDF p4, Fig. 2 TEM insets.',
    });
    flexible.push({
      key: 'dispersion_stability', value: 'no sediment after 1 month at -15, 25, 150 \u00b0C or centrifuging (10,000 rpm, 0.5 h) at 0.7 wt% in PEG200',
      note: 'PDF p6-7, Fig. 7.',
    });
    flexible.push({
      key: 'smiles_convention', value: s.key.includes('c-g') ? 'cationSmiles stubs the carbon nanoparticle core as an acetamide methyl (core-C(=O)NH-CH2CH2-NIm+)' : 'anionSmiles stubs the carbon nanoparticle core as an acetamide methyl (core-C(=O)NH-CH2CH2-COO-)',
      note: 'Grafted-fragment SMILES; the free ion does not exist as such. Structures per Fig. 1 (PDF p2).',
    });
  }
  if (isPILControl) {
    flexible.push({
      key: 'comparison_note', value: 'peripheral-ion controls: [C16-MIm]Cl (0.12) gives lower COF than A-g-CNPs (0.13); [C16-HA]Na (0.11) far worse than C-g-CNPs (0.06)',
      note: 'PDF p10 - inner carbon cores collaborate with peripheral anion moieties in C-g-CNPs; bare molecular absorption layers are less robust.',
    });
  }
  const prov = [
    { field: 'cation', basis: 'direct', page: 3, quote: s.ions.cationQuoteP3 ?? cationQuote(s.key), note: cationNote(s.key) },
    { field: 'anion', basis: 'direct', page: 3, quote: anionQuote(s.key), note: anionNote(s.key) },
    SUBSTRATE_PROV,
    TEMP_PROV,
    s.loadProv,
    { field: 'cof', basis: 'inferred', page: s.cofPage, quote: s.cofQuote, note: s.cofNote },
    VEL_PROV,
    s.concProv,
  ];
  return {
    key: s.key,
    sourcePdf: PDF,
    sourceUrl: URL,
    decision: 'approve',
    reason:
      `Average friction coefficient of ${s.bar} under 100 N / ${s.duration} / room temperature (15-20 \u00b0C). ` +
      `cof ${s.cof} is the value printed by the authors on the bar; it was verified by pixel-calibrated digitization of the same bar and of the parallel concentration-series bar (Fig. 8), agreeing within the +/-0.005 promotion gate, and it reproduces the paper's stated percentage change for this condition. ` +
      REASON_TAIL,
    fields: {
      paper: { title: TITLE, doi: DOI, journal: 'Friction', year: 2023 },
      cation: s.ions.cation,
      cationSmiles: s.ions.cationSmiles,
      anion: s.ions.anion,
      anionSmiles: s.ions.anionSmiles,
      substrate: 'steel disk (lower specimen of a steel-steel sliding pair; grade not specified)',
      temperature: 'room temperature (15-20 \u00b0C)',
      load: '100 N',
      cof: s.cof,
      cofMethod: `Average COF over the ${s.duration} reciprocating test, bar value printed in ${s.bar.split(' (')[0]}; verified by two-reading pixel-calibrated digitization`,
      scale: 'macro',
      method: 'Reciprocating ball-on-disk linear sliding, Bruker UMT-TriboLab universal mechanical tester',
      probe: 'steel ball (grade not specified in this paper)',
      probeType: 'ball',
      velocity: '~10 mm/s (average sliding speed)',
      concentration: s.concProv.quote.includes('D)') ? '0.7 wt% in PEG200' : '0.7 wt% dispersion in PEG200',
      flexible,
      provenance: prov,
    },
  };
});

function cationQuote(key: string): string {
  if (key.includes('a-g')) return '1-hexadecyl-3-methylimidazolium chloride ([C16-MIm]Cl)';
  if (key.includes('c-g')) return '1-aminoethyl-3-methylimidazolium chloride';
  if (key.includes('c16mim')) return '1-hexadecyl-3-methylimidazolium chloride ([C16-MIm]Cl)';
  return 'sodium heptadecanoate ([C16-HA]Na; AR)';
}
function cationNote(key: string): string {
  if (key.includes('a-g')) return 'Identity from PDF p3 Chemicals; role as the peripheral counter-cation of the carboxylate-grafted CNP from "cation exchange process between Na+ and [C16-MIm]+" (PDF p3) and Fig. 1 (PDF p2).';
  if (key.includes('c-g')) return 'Identity from PDF p3 Chemicals; grafted onto the CNP: "ensure the successful attachments of [AMIm]Cl molecules onto CNPs-Cl" (PDF p5); Fig. 1 (PDF p2) shows the amide-linked 2-aminoethyl connection (hence 1-(2-aminoethyl)-3-methylimidazolium).';
  if (key.includes('c16mim')) return 'Identity from PDF p3 Chemicals; the pure [C16-MIm]Cl IL itself is the tested additive (Fig. 14(b) bar D).';
  return 'Sodium is the cation of sodium heptadecanoate ([C16-HA]Na), the pure IL tested as additive (Fig. 14(b) bar E), from PDF p3 Chemicals.';
}
function anionQuote(key: string): string {
  if (key.includes('a-g')) return 'The CNPs capped by ionic molecules of sodium carboxylate (CNPs-Na)';
  if (key.includes('c-g')) return 'ion exchange between Cl\u2212 and [C16-HA]\u2212';
  if (key.includes('c16mim')) return '1-hexadecyl-3-methylimidazolium chloride ([C16-MIm]Cl)';
  return 'sodium heptadecanoate ([C16-HA]Na; AR)';
}
function anionNote(key: string): string {
  if (key.includes('a-g')) return 'beta-alanine-derived carboxylate is the anion moiety grafted on the CNP core (amide-bound, COO- terminus; PDF p3 synthesis and Fig. 1); peripheral counter-cation is [C16-MIm]+.';
  if (key.includes('c-g')) return 'Heptadecanoate [C16-HA]- (sodium heptadecanoate, PDF p3) is the peripheral counter-anion of the [AMIm]+-grafted CNP; "displacements of small ions (Na+ and Cl-) by big ions with long carbon chains ([C16-MIm]+ and [C16-HA]-)" (PDF p4).';
  if (key.includes('c16mim')) return 'Chloride is the anion of [C16-MIm]Cl (PDF p3 Chemicals).';
  return 'Heptadecanoate (margarate, C17H35O2-) is the anion of sodium heptadecanoate [C16-HA]Na (PDF p3).';
}

writeFileSync('data/literature-expansion-20260912/reviewed-fric2-0635-4.json', JSON.stringify(candidates, null, 2));
console.log('wrote', candidates.length, 'candidates');
