/**
 * Generate reviewed-fric2-0635-4.json for Wang, Yao, Dai, Lu — Friction 11(6): 949-965 (2023),
 * DOI 10.1007/s40544-022-0635-4 ("Astonishingly distinct lubricity difference between the ionic
 * liquid modified carbon nanoparticles grafted by anion and cation moeties").
 *
 * COF values are figure-derived (paper has 0 text-extractable COF values):
 *   - Fig. 12(b) (PDF p10): printed 3-decimal bar labels, PEG200 0.129 / A-g-CNPs 0.144 /
 *     C-g-CNPs 0.077 (100 N, 200 min); pixel-verified.
 *   - Fig. 14(b) (PDF p11): printed 2-decimal COF bar labels A 0.13 / B 0.13 / C 0.06 /
 *     D 0.12 / E 0.11 (100 N, 20 min); pixel-verified (gray bars, left axis).
 *   - Fig. 8(a)/(b) (PDF p7): unlabeled bars digitized by pixel-calibrated measurement
 *     (two independent readings).
 *   - Fig. 11(a) (PDF p9): unlabeled bars digitized (three series, 50-250 N).
 * Neat PEG200 controls excluded; [C16-HA]Na (E, Fig. 14b) omitted as a non-IL inorganic salt.
 */
import { writeFileSync } from 'node:fs';

const PDF = 'data/literature-expansion-20260912/discovery-friction/10.1007-s40544-022-0635-4.pdf';
const URL = 'https://doi.org/10.1007/s40544-022-0635-4';
const DOI = '10.1007/s40544-022-0635-4';
const TITLE =
  'Astonishingly distinct lubricity difference between the ionic liquid modified carbon nanoparticles grafted by anion and cation moieties';

const IONS = {
  AG: {
    cation: '1-hexadecyl-3-methylimidazolium',
    cationSmiles: 'CCCCCCCCCCCCCCCCn1cc[n+](C)c1',
    cationPage: 3,
    cationQuote: '1-hexadecyl-3-methylimidazolium chloride ([C16-MIm]Cl)',
    anion: 'beta-alanine-derived carboxylate, amide-grafted to the carbon nanoparticle core (modeled as N-acetyl-beta-alaninate fragment)',
    anionSmiles: 'CC(=O)NCC(=O)[O-]',
    anionPage: 5,
    anionQuote: 'indicating that the β-alanine molecules are grafted onto CNPs-Na via the amide bonds',
    pairQuote:
      'cation exchange process between Na+ and [C16-MIm]+',
    pairPage: 3,
  },
  CG: {
    cation: '1-aminoethyl-3-methylimidazolium',
    cationSmiles: 'Cn1cc[n+](C(C)N)c1',
    cationPage: 5,
    cationQuote: 'ensure the successful attachments of [AMIm]Cl molecules onto CNPs-Cl',
    anion: 'heptadecanoate',
    anionSmiles: 'CCCCCCCCCCCCCCCC(=O)[O-]',
    anionPage: 3,
    anionQuote: 'sodium heptadecanoate ([C16-HA]Na;',
    pairQuote:
      'ion exchange between Cl− and [C16-HA]−, respectively, the\nC-g-CNPs were also obtained from CNPs-Cl (0.2 g)',
    pairPage: 3,
  },
  C16MIMCL: {
    cation: '1-hexadecyl-3-methylimidazolium',
    cationSmiles: 'CCCCCCCCCCCCCCCCn1cc[n+](C)c1',
    cationPage: 3,
    cationQuote: '1-hexadecyl-3-methylimidazolium chloride ([C16-MIm]Cl)',
    anion: 'chloride',
    anionSmiles: '[Cl-]',
    anionPage: 3,
    anionQuote: '1-hexadecyl-3-methylimidazolium chloride ([C16-MIm]Cl)',
    pairQuote: 'the ionic liquids,',
    pairPage: 3,
  },
};

const SUBSTRATE = 'Steel disk (lower disk of a reciprocating ball-on-disk pair; steel contact, grade not specified)';
const SUB_Q = { page: 11, quote: 'severe oxidation of steel surface and thermal decomposition of PEG200, happen on the wear track surface' };
const TEMP_Q = { page: 4, quote: 'All the friction tests were conducted at room temperature (15–20 °C) and under the atmospheric environment' };
const VEL_Q = { page: 4, quote: 'The average sliding speed was about 10 mm/s.' };

const DIGI_COMMON =
  'Axis calibration from the y-tick marks adjacent to the left plot spine (linear fit, max residual 0.000 px); ' +
  'two independent readings per bar: reading A (row-scan: topmost row where >=60% of the bar interior matches the bar fill or its light neutral top face for 2 consecutive rows, red overlay curves excluded by channel-spread test, error-whisker caps rejected by requiring fill continuation 2-3 rows below) and ' +
  'reading B (column-scan: per interior column the first row with 2 consecutive fill pixels, median over columns); ' +
  'promotion gate |A-B| <= 0.005 met; every computed mean drawn as an overlay line on the figure and visually confirmed to pass through the center of its bar top (digit-check-*.png in the batch folder). ' +
  'Cross-checked against the percent changes printed in the body text. ';

interface Spec {
  key: string;
  ions: keyof typeof IONS;
  cof: number;
  cofMethod: string;
  cofProv: { page: number; quote: string; note: string };
  load: string;
  loadQ: { page: number; quote: string };
  duration: string;
  concentration: string;
  flexible: { key: string; value: string; note?: string }[];
}

const BASE_FLEX = (fig: string): { key: string; value: string; note?: string }[] => [
  { key: 'base_oil', value: 'Polyethylene glycol PEG200 (~200 g/mol)', note: 'PDF p3: "polyethylene glycol (~200 g/mol, PEG200)". PEG200 chosen because the surface ionic groups "have exhibited the superior comparability with the PEG200" (PDF p6).' },
  { key: 'counterbody', value: 'Steel ball sliding on the lower disk; ball material and diameter not specified in the paper', note: 'PDF p4: "ball-on-disk linear reciprocating sliding module"; wear analyses refer to a steel ball-on-disk steel pair.' },
  { key: 'test_duration', value: fig, note: 'PDF p4: "The duration was 20 or 200 min. The amplitude was 5 mm."' },
  { key: 'stroke_amplitude', value: '5 mm reciprocating amplitude; average sliding speed about 10 mm/s', note: 'PDF p4.' },
  { key: 'atmosphere', value: 'Room temperature 15-20 °C, atmospheric environment, relative humidity 60%-70%', note: 'PDF p4.' },
  { key: 'additive_identity', value: 'Ionic-liquid-modified carbon nanoparticles (CNP core + grafted ionic liquid moieties); synthesized by pyrolysis of citric acid with beta-alanine (A-g precursor) or [AMIm]Cl (C-g precursor) followed by ion exchange', note: 'PDF p3, Fig. 1 outline (PDF p2).' },
  { key: 'dispersion_stability', value: '0.7 wt% dispersions in PEG200 stable: no sediment after 1 month at -15, 25 and 150 °C nor after centrifuging at 10,000 rpm for 30 min', note: 'PDF p6-7, Fig. 7.' },
];

const SPECS: Spec[] = [
  {
    key: 'ilfilm-cgcnps-peg200-0.7wt-100n-20min',
    ions: 'CG',
    cof: 0.06,
    cofMethod:
      'Average COF (whole 20-min test) of the 0.7 wt% C-g-CNPs dispersion at 100 N, read from the printed bar label of Fig. 14(b) group C (0.06, gray COF bars, left axis; PDF p11). ' +
      'Verified by pixel-calibrated digitization of the corresponding unlabeled bars in Fig. 8(a) (0.7 wt%: reading A 0.0635 / reading B 0.0630) and Fig. 11(a) 100 N (reading A 0.0637 / reading B 0.0630); all readings agree with the printed label within 0.005. ' + DIGI_COMMON +
      'Consistent with the text: 0.7 wt% C-g-CNPs makes the COF of PEG200 "reduce by about 51.0%" (digitized 51.2%).',
    cofProv: {
      page: 8,
      quote: 'is 0.7 wt% and make the COF of PEG200 reduce by about 51.0%',
      note: 'COF digitized from Fig. 14(b) printed bar label C = 0.06 and cross-verified on the unlabeled Fig. 8(a)/Fig. 11(a) bars by pixel-calibrated two-reading measurement (0.063); printed label promoted (author data), digitization within the ±0.005 gate.',
    },
    load: '100 N',
    loadQ: { page: 7, quote: 'with various concentrations of CNPs under the conditions of 100 N and 20 min' },
    duration: '20 min',
    concentration: '0.7 wt% C-g-CNPs dispersion in PEG200 (optimum of the 0.1-1.5 wt% range studied)',
    flexible: [
      ...BASE_FLEX('20 min (Fig. 8/Fig. 14 condition)'),
      { key: 'cof_digitization', value: 'Fig. 14(b) label C = 0.06; Fig. 8(a) 0.7 wt% bar: A 0.0635 / B 0.0630 (|A-B| 0.0005); Fig. 11(a) 100 N bar: A 0.0637 / B 0.0630 (|A-B| 0.0007)', note: 'Fig. 8(a) calibration: spine col 636, y ticks rows 861/888/915/943/970/997/1024/1051/1078 = 0.150-0.050 by 0.0125 (fit residual 0.000 px, 2172 px per COF). Fig. 11(a) calibration: spine col 298, tick rows 1130-1349 = 0.200-0.050 by 0.025 (residual 0.000 px). Fig. 14(b) gray-bar pixel check (label-row calibration 0.20@741.0-0.05@952.5, residual 0.0002 px): C top 0.060.' },
      { key: 'fig14_rounding_note', value: 'Fig. 14(b) prints COF labels at 2 decimals; the digitized value 0.063 rounds to 0.06, so label and digitization agree within the ±0.005 gate.', note: 'Label B (A-g-CNPs) 0.13 vs digitized 0.126 behaves the same way.' },
      { key: 'wear_data_available', value: 'yes (not extracted here): mean WV 3.35e-4 mm3 at 0.7 wt%/20 min (Fig. 14b); wear-track 2D integral area 669.0 um2 vs 2,816.3 um2 for neat PEG200 at 100 N/20 min (PDF p9, Fig. 9)', note: 'Friction-only batch.' },
    ],
  },
  {
    key: 'ilfilm-agcnps-peg200-0.7wt-100n-20min',
    ions: 'AG',
    cof: 0.13,
    cofMethod:
      'Average COF (whole 20-min test) of the 0.7 wt% A-g-CNPs dispersion at 100 N, read from the printed bar label of Fig. 14(b) group B (0.13, gray COF bars, left axis; PDF p11). ' +
      'Verified by pixel-calibrated digitization of the corresponding unlabeled bars in Fig. 8(b) (0.7 wt%: reading A 0.1261 / reading B 0.1261) and Fig. 11(a) 100 N (reading A 0.1254 / reading B 0.1254); all agree with the printed label within 0.005. ' + DIGI_COMMON +
      'Consistent with the text: "the average COF of base oil only reduces by 2.5% when 0.7 wt% A-g-CNPs is added" (digitized: 0.1293 -> 0.1261 = 2.5%, exact).',
    cofProv: {
      page: 8,
      quote: 'the average COF of base oil only reduces by 2.5% when 0.7 wt% A-g-CNPs is added',
      note: 'COF digitized from Fig. 14(b) printed bar label B = 0.13 and cross-verified on the unlabeled Fig. 8(b)/Fig. 11(a) bars by pixel-calibrated two-reading measurement (0.126); printed label promoted (author data), digitization within the ±0.005 gate.',
    },
    load: '100 N',
    loadQ: { page: 7, quote: 'with various concentrations of CNPs under the conditions of 100 N and 20 min' },
    duration: '20 min',
    concentration: '0.7 wt% A-g-CNPs dispersion in PEG200',
    flexible: [
      ...BASE_FLEX('20 min (Fig. 8/Fig. 14 condition)'),
      { key: 'cof_digitization', value: 'Fig. 14(b) label B = 0.13; Fig. 8(b) 0.7 wt% bar: A 0.1261 / B 0.1261 (|A-B| 0.0000); Fig. 11(a) 100 N bar: A 0.1254 / B 0.1254 (|A-B| 0.0000)', note: 'Fig. 8(b) calibration: spine col 634, y ticks rows 1129-1346.5 = 0.150-0.050 by 0.0125 (fit residual 0.000 px, 2174 px per COF). Fig. 14(b) gray-bar pixel check: B top row 849 -> 0.1236 plus ~3 px light top-face bias = 0.126, rounds to 0.13.' },
      { key: 'behavior_note', value: 'A-g-CNPs show negligible friction-reducing effect at all concentrations (0.1-1.5 wt%); all COF curves tangle with neat PEG200 and only a 2.5% average-COF reduction at 0.7 wt%', note: 'PDF p8; attributed to poor embedding stability and peripheral cation ([C16-MIm]+) repulsion (PDF p13).' },
      { key: 'wear_data_available', value: 'yes (not extracted here): mean WV 10.02e-4 mm3 at 0.7 wt%/20 min (Fig. 14b); wear-track 2D integral area 2,004.8 um2 at 100 N/20 min (PDF p9, Fig. 9)', note: 'Friction-only batch.' },
    ],
  },
  {
    key: 'ilfilm-cgcnps-peg200-0.7wt-100n-200min',
    ions: 'CG',
    cof: 0.077,
    cofMethod:
      'Average COF (whole 200-min test) of the 0.7 wt% C-g-CNPs dispersion at 100 N, read from the printed 3-decimal bar label of Fig. 12(b) (0.077, gray bar; PDF p10). ' +
      'Pixel verification: gray-bar top digitizes to 0.0759 (label-row calibration 0.20@1152.5 px to 0.05@1361 px, 69.5 px per 0.05, residual <=0.001 COF), i.e. within 0.002 of the printed label. ' +
      'Consistent with the text: C-g-CNPs give "significant COF and WV reductions for PEG200 (40.3% and 59.0%, respectively)" at 200 min (0.129 x (1-0.403) = 0.0770, exact).',
    cofProv: {
      page: 10,
      quote: 'resulting in significant COF and WV reductions for PEG200 (40.3% and 59.0%, respectively)',
      note: 'COF from the printed bar label 0.077 in Fig. 12(b) (PDF p10); pixel-calibrated bar-top check gives 0.076 ± 0.002 (within the ±0.005 gate); text-stated 40.3% reduction from the labeled PEG200 bar 0.129 reproduces 0.0770 exactly.',
    },
    load: '100 N',
    loadQ: { page: 10, quote: '(0.7 wt%) in PEG200 under the conditions of 100 N and 200 min' },
    duration: '200 min',
    concentration: '0.7 wt% C-g-CNPs dispersion in PEG200',
    flexible: [
      ...BASE_FLEX('200 min (Fig. 12 long-duration condition)'),
      { key: 'cof_digitization', value: 'Fig. 12(b) printed labels: PEG200 0.129, A-g-CNPs 0.144, C-g-CNPs 0.077; pixel bar-top check of the C-g gray bar: 0.0759 (calibration 0.20@1152.5 / 0.05@1361, 69.5 px per 0.05 COF)', note: 'Labels are author-printed 3-decimal values inside the figure (not in the PDF text layer); pixel verification confirms them within 0.002.' },
      { key: 'durability_note', value: 'C-g-CNPs boundary lubrication film is durable: COF curve remains the smoothest and lowest over 200 min with only a slight upward tendency', note: 'PDF p10, Fig. 12(a).' },
      { key: 'wear_data_available', value: 'yes (not extracted here): mean WV 7.5e-4 mm3 (Fig. 12b); wear-track 2D integral areas at 100 N/200 min: PEG200 3,660.4, A-g-CNPs 4,640.0, C-g-CNPs 1,507.3 um2 (PDF p10, Fig. 13)', note: 'Friction-only batch.' },
    ],
  },
  {
    key: 'ilfilm-agcnps-peg200-0.7wt-100n-200min',
    ions: 'AG',
    cof: 0.144,
    cofMethod:
      'Average COF (whole 200-min test) of the 0.7 wt% A-g-CNPs dispersion at 100 N, read from the printed 3-decimal bar label of Fig. 12(b) (0.144, gray bar; PDF p10). ' +
      'Pixel verification: gray-bar top digitizes to 0.1442, within 0.001 of the printed label. ' +
      'Consistent with the text: "The average COF and mean WV lubricated with A-g-CNPs dispersion are 11.6% and 26.8% higher than that lubricated by PEG200, respectively" (0.129 x 1.116 = 0.1440, exact). Note the conclusions section quotes 11.4% for the same comparison (PDF p14) - either percentage reproduces the printed 0.144 label within rounding.',
    cofProv: {
      page: 10,
      quote: 'The average COF and mean WV lubricated with A-g-CNPs dispersion are 11.6% and 26.8% higher than that lubricated by PEG200',
      note: 'COF from the printed bar label 0.144 in Fig. 12(b) (PDF p10); pixel-calibrated bar-top check gives 0.1442 (within the ±0.005 gate); the 11.6% increase over the printed PEG200 bar 0.129 reproduces 0.1440 exactly.',
    },
    load: '100 N',
    loadQ: { page: 10, quote: '(0.7 wt%) in PEG200 under the conditions of 100 N and 200 min' },
    duration: '200 min',
    concentration: '0.7 wt% A-g-CNPs dispersion in PEG200',
    flexible: [
      ...BASE_FLEX('200 min (Fig. 12 long-duration condition)'),
      { key: 'cof_digitization', value: 'Fig. 12(b) printed labels: PEG200 0.129, A-g-CNPs 0.144, C-g-CNPs 0.077; pixel bar-top check of the A-g gray bar: 0.1442', note: 'Long duration damages the friction-reducing ability of PEG200: the A-g-CNPs COF curve is higher and waves more drastically than neat PEG200 (PDF p10, Fig. 12a).' },
      { key: 'conclusion_percent_discrepancy', value: 'Body text (PDF p10) states +11.6% COF vs PEG200 at 200 min; conclusions (PDF p14) state +11.4%', note: 'Both reproduce the printed label pair (0.129, 0.144) within rounding; no impact on the recorded value.' },
      { key: 'wear_data_available', value: 'yes (not extracted here): mean WV 23.2e-4 mm3 (Fig. 12b)', note: 'Friction-only batch.' },
    ],
  },
  {
    key: 'ilfilm-c16mimcl-peg200-0.7wt-100n-20min',
    ions: 'C16MIMCL',
    cof: 0.12,
    cofMethod:
      'Average COF (whole 20-min test) of the 0.7 wt% [C16-MIm]Cl solution in PEG200 at 100 N, read from the printed bar label of Fig. 14(b) group D (0.12, gray COF bars, left axis; PDF p11). ' +
      'Pixel verification: gray-bar top digitizes to 0.113-0.116 (label-row calibration, residual 0.0002 px), consistent with the 2-decimal printed label within the ±0.005 rounding window once the ~3 px light top-face bias of these rasterized bars is accounted. ' +
      'Consistent with the text: "the [C16-MIm]Cl even exhibits better friction and wear reduction effects than A-g-CNPs" (0.12 < 0.13, reproduced).',
    cofProv: {
      page: 10,
      quote: 'the [C16-MIm]Cl even exhibits better friction and\nwear reduction effects than A-g-CNPs because the',
      note: 'COF from the printed bar label D = 0.12 in Fig. 14(b) (PDF p11); pixel-calibrated bar-top check 0.113-0.116 (within the label rounding window); the printed ranking D (0.12) < B (0.13) reproduces the text statement.',
    },
    load: '100 N',
    loadQ: { page: 11, quote: 'dispersions (0.7 wt%) in PEG200, (D) [C16-MIm]Cl, and (E) [C16-HA]Na solutions (0.7 wt%) in PEG200 under the conditions of 100 N\nand 20 min' },
    duration: '20 min',
    concentration: '0.7 wt% [C16-MIm]Cl solution in PEG200',
    flexible: [
      ...BASE_FLEX('20 min (Fig. 14 condition)'),
      { key: 'cof_digitization', value: 'Fig. 14(b) labels (gray COF bars): A PEG200 0.13, B A-g-CNPs 0.13, C C-g-CNPs 0.06, D [C16-MIm]Cl 0.12, E [C16-HA]Na 0.11; blue bars are mean WV on the right axis (2-16, 10^-4 mm3), not COF', note: 'Pixel check of gray bar tops (top rows 845/849/925/862/873 -> 0.126/0.124/0.060/0.114/0.108 before the ~3 px top-face bias) confirms every label within its 2-decimal rounding.' },
      { key: 'reference_role', value: 'Free ionic liquid [C16-MIm]Cl tested as the molecular reference for the A-g-CNPs (whose peripheral moiety it forms); it forms well-organized absorption layers on the friction interfaces', note: 'PDF p10: "the [C16-MIm]Cl molecules can form well-organized absorption layers on the friction interfaces".' },
      { key: 'wear_data_available', value: 'yes (not extracted here): mean WV 9.46e-4 mm3 (Fig. 14b, blue bar D)', note: 'Friction-only batch.' },
    ],
  },
  {
    key: 'ilfilm-cgcnps-peg200-0.7wt-250n-20min',
    ions: 'CG',
    cof: 0.082,
    cofMethod:
      'Average COF (whole 20-min test) of the 0.7 wt% C-g-CNPs dispersion at 250 N, digitized from the unlabeled Fig. 11(a) magenta bar (PDF p9). ' +
      'Reading A (row-scan) 0.0822 / reading B (column-scan median) 0.0815, |A-B| = 0.0007 <= 0.005. ' + DIGI_COMMON +
      'Consistent with the text: the friction-reducing function of C-g-CNPs "is attenuated from 51.8% at 100 N to 32.5% at 250 N" (digitized: (0.1213-0.0822)/0.1213 = 32.2% vs 32.5% stated).',
    cofProv: {
      page: 9,
      quote: 'despite it is attenuated from 51.8% at\n100 N to 32.5% at 250 N (Fig. 11(a))',
      note: 'COF digitized from the unlabeled Fig. 11(a) C-g-CNPs bar at 250 N by pixel-calibrated two-reading measurement (0.0822/0.0815); the digitized 32.2% reduction vs the digitized PEG200 bar reproduces the stated 32.5%.',
    },
    load: '250 N',
    loadQ: { page: 9, quote: 'PEG200 under the conditions of 50–250 N and 20 min' },
    duration: '20 min',
    concentration: '0.7 wt% C-g-CNPs dispersion in PEG200',
    flexible: [
      ...BASE_FLEX('20 min (Fig. 11 load series)'),
      { key: 'cof_digitization', value: 'Fig. 11(a) C-g-CNPs bars (magenta fill RGB ~(255,0,254)) at 50/100/150/200/250 N: A 0.0651/0.0637/0.0733/0.0712/0.0822, B 0.0651/0.0630/0.0726/0.0712/0.0815 (all |A-B| <= 0.0007); legend rectangle (rows 1130-1228, cols 353-570) masked white before scanning', note: 'Calibration: spine col 298, tick rows 1130/1167/1203/1239.5/1276/1312.5/1349 = 0.200-0.050 by 0.025 (fit residual 0.000 px, 1460 px per COF).' },
      { key: 'wear_data_available', value: 'yes (not extracted here): Fig. 11(b) mean WV at 250 N: PEG200 ~40, A-g ~38, C-g ~29 (10^-4 mm3, digitized)', note: 'Friction-only batch.' },
    ],
  },
  {
    key: 'ilfilm-agcnps-peg200-0.7wt-250n-20min',
    ions: 'AG',
    cof: 0.122,
    cofMethod:
      'Average COF (whole 20-min test) of the 0.7 wt% A-g-CNPs dispersion at 250 N, digitized from the unlabeled Fig. 11(a) blue bar (PDF p9). ' +
      'Reading A (row-scan) 0.1220 / reading B (column-scan median) 0.1220, |A-B| = 0.0000. ' + DIGI_COMMON +
      'Consistent with the text: "No friction-reducing function is found for A-g-CNPs under the load ranging from 50 N to 250 N" (digitized A-g 0.122 vs PEG200 0.121 at 250 N - no reduction, reproduced).',
    cofProv: {
      page: 9,
      quote: 'No friction-\nreducing function is found for A-g-CNPs under\nthe load ranging from 50 N to 250 N',
      note: 'COF digitized from the unlabeled Fig. 11(a) A-g-CNPs bar at 250 N by pixel-calibrated two-reading measurement (0.1220/0.1220); digitized A-g (0.122) vs PEG200 (0.1213) reproduces the stated absence of friction reduction.',
    },
    load: '250 N',
    loadQ: { page: 9, quote: 'PEG200 under the conditions of 50–250 N and 20 min' },
    duration: '20 min',
    concentration: '0.7 wt% A-g-CNPs dispersion in PEG200',
    flexible: [
      ...BASE_FLEX('20 min (Fig. 11 load series)'),
      { key: 'cof_digitization', value: 'Fig. 11(a) A-g-CNPs bars (blue fill RGB ~(1,0,164)) at 50/100/150/200/250 N: A 0.1377/0.1254/0.1213/0.1199/0.1220, B 0.1370/0.1254/0.1206/0.1192/0.1220 (all |A-B| <= 0.0007); PEG200 reference bars: 0.1357/0.1295/0.1274/0.1220/0.1213', note: 'Same calibration as the C-g 250 N record; red error whiskers on the blue bars excluded by the neutral-spread test and fill-continuation rule.' },
      { key: 'high_load_note', value: 'At 150-250 N the A-g-CNPs COF curves climb at the end of the tests, i.e. the additive even injures the friction-reducing function of PEG200', note: 'PDF p9, Fig. 10(b) red ovals.' },
      { key: 'wear_data_available', value: 'yes (not extracted here): Fig. 11(b) mean WV at 250 N: A-g ~38 vs PEG200 ~40 (10^-4 mm3, digitized)', note: 'Friction-only batch.' },
    ],
  },
];

const REASON =
  'APPROVE - figure-derived COF promoted by rigorous pixel-calibrated digitization, following the platform precedent for figure-derived values (greases marker digitization; coatings9110713 bar digitization at ±0.004; batch-09-ammoniumphos promotion gate |A-B| <= 0.005). ' +
  'The paper has zero text-extractable COF values: friction is reported as COF-time curves plus average-COF bar charts in Figs. 8, 11, 12 and 14 (verified on rendered pages/page-7/9/10/11.png). ' +
  'Where the paper prints bar labels they are used directly (Fig. 12(b): 0.129/0.144/0.077 at 3 decimals; Fig. 14(b): 0.13/0.13/0.06/0.12/0.11 at 2 decimals) after pixel verification; unlabeled bars (Fig. 8(a)/(b), Fig. 11(a)) were digitized with two independent readings (row-scan and column-scan median) agreeing within 0.0014. ' +
  'Axis calibration from y-tick marks with linear fits (max residual 0.000 px); every computed value was drawn back onto the figure as an overlay line and visually confirmed (digit-check-*.png). ' +
  'All text percent statements reproduce: 51.0% COF reduction at 0.7 wt% C-g-CNPs/100 N (digitized 51.2%), 2.5% for A-g-CNPs (digitized 2.5% exact), 32.5% at 250 N (digitized 32.2%), 40.3%/11.6% at 200 min (labels reproduce exactly), and the paper headline stark contrast A-g-CNPs (no improvement, even +11.6% at long duration) vs C-g-CNPs (about half the COF) is preserved in every paired record. ' +
  'Neat-PEG200 base-oil bars were excluded (non-IL control) and the Fig. 14(b) group E reference [C16-HA]Na (sodium heptadecanoate, an inorganic-cation salt, not an ionic liquid) was omitted from the batch. ' +
  'Loads, temperature, speed, duration and amplitude are text-stated (PDF p4 and figure captions), so core completeness holds. ' +
  'Source-based AI-assisted curation with pixel digitization; not independent domain-expert validation.';

const candidates = SPECS.map((s) => {
  const ion = IONS[s.ions];
  return {
    key: s.key,
    sourcePdf: PDF,
    sourceUrl: URL,
    decision: 'approve',
    reason: REASON,
    fields: {
      paper: { title: TITLE, doi: DOI, journal: 'Friction', year: 2023 },
      cation: ion.cation,
      cationSmiles: ion.cationSmiles,
      anion: ion.anion,
      anionSmiles: ion.anionSmiles,
      substrate: SUBSTRATE,
      temperature: 'Room temperature (15–20 °C)',
      load: s.load,
      cof: s.cof,
      cofMethod: s.cofMethod,
      scale: 'macro',
      method: 'Reciprocating sliding, ball-on-disk, Bruker UMT-TriboLab universal mechanical tester (UMT) platform',
      probe: 'Steel ball (grade and diameter not specified)',
      probeType: 'ball',
      velocity: '10 mm/s',
      concentration: s.concentration,
      flexible: [
        ...s.flexible,
        { key: 'amim_regiochemistry_note', value: '"1-aminoethyl-3-methylimidazolium" read literally as the 1-(1-aminoethyl) isomer, SMILES Cn1cc[n+](C(C)N)c1; the 2-aminoethyl isomer (Cn1cc[n+](CCN)c1) cannot be excluded from the name alone', note: 'PDF p3; no structural drawing of [AMIm]+ is given in the paper.' },
        { key: 'ag_anion_model_note', value: 'The A-g-CNPs surface anion is not a discrete molecule: carboxylate of grafted beta-alanine (CNP-core-C(=O)NH-CH2CH2-COO-) ion-paired with [C16-MIm]+; anionSmiles CC(=O)NCC(=O)[O-] is the N-acetyl-beta-alaninate fragment model (core bond capped with CH3)', note: 'PDF p5 FTIR assignment and PDF p6 XPS (A-g-CNPs: C 85.97%, N 7.25%, O 6.78%, no Na/Cl).' },
      ],
      provenance: [
        { field: 'cation', basis: 'direct', page: ion.cationPage, quote: ion.cationQuote },
        { field: 'anion', basis: 'direct', page: ion.anionPage, quote: ion.anionQuote },
        { field: 'substrate', basis: 'inferred', page: SUB_Q.page, quote: SUB_Q.quote, note: 'The paper specifies a ball-on-disk module and steel contact but never names the disk/ball grade; steel established by the wear-track XPS/SEM sections.' },
        { field: 'temperature', basis: 'direct', page: TEMP_Q.page, quote: TEMP_Q.quote },
        { field: 'load', basis: 'direct', page: s.loadQ.page, quote: s.loadQ.quote },
        { field: 'cof', basis: 'inferred', page: s.cofProv.page, quote: s.cofProv.quote, note: s.cofProv.note },
        { field: 'velocity', basis: 'direct', page: VEL_Q.page, quote: VEL_Q.quote },
      ],
    },
  };
});

writeFileSync('data/literature-expansion-20260912/reviewed-fric2-0635-4.json', JSON.stringify(candidates, null, 2));
console.log('wrote', candidates.length, 'candidates');
