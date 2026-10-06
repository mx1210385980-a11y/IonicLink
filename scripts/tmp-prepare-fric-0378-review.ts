/**
 * Generate reviewed-fric-0378-z.json for Guo & Iglesias — Friction 9(1): 169-178 (2021),
 * DOI 10.1007/s40544-020-0378-z ("Tribological behavior of ammonium-based protic ionic liquid
 * as lubricant additive").
 *
 * The paper has 0 text-extractable COF values: friction is reported only as the unlabeled
 * bar chart Fig. 6 (PDF p5, "Average friction coefficients as a function of temperature"),
 * with the percent reductions stated in the text (29.0% at room temperature, 35.5% at 100 °C).
 * COF values below are pixel-calibrated digitizations of the four Fig. 6 bars
 * (MO / 1 wt% DCi+MO at room temperature and 100 °C); the neat-MO bars are the non-IL
 * control and are NOT drafted as records (they are used only as the digitized reference
 * for the text-stated percent reductions).
 */
import { writeFileSync } from 'node:fs';

const PDF = 'data/literature-expansion-20260912/discovery-bulk-03/10.1007-s40544-020-0378-z.pdf';
const URL = 'https://doi.org/10.1007/s40544-020-0378-z';
const DOI = '10.1007/s40544-020-0378-z';
const TITLE = 'Tribological behavior of ammonium-based protic ionic liquid as lubricant additive';

const ION = {
  cation: 'bis(2-hydroxyethylammonium)',
  cationSmiles: '[NH2+](CCO)(CCO)',
  anion: 'citrate(3-)',
  anionSmiles: 'OC(C(=O)[O-])(CC(=O)[O-])CC(=O)[O-]',
};

const DIGI_COMMON =
  'Digitization protocol (platform precedent: batch-09-ammoniumphos promotion, gate |A-B| <= 0.005): ' +
  'axis calibration from the y-axis label-row centers of Fig. 6 (0.18 at row 162.5 px down to 0.02 at row 360.2 px, 24.7 px per 0.02; linear fit max residual 0.00005 COF); ' +
  'reading A (row-scan: topmost row where >=60% of the bar interior matches the bar fill for 2 consecutive rows; error whiskers too narrow to trigger) and ' +
  'reading B (column-scan: per interior column the first row with gray intensity < 128, median over all interior columns; scan started at row 160 to stay below the legend text) - two genuinely independent estimators; ' +
  'both gave identical rows for all four bars (|A-B| = 0.0000), and the computed values were drawn back onto the figure as overlay lines and visually confirmed to pass through the bar tops (digit-check-fig6.png in the batch folder). ';

const SUB_Q = {
  page: 3,
  quote: 'AISI 52100 steel disks (hardness  22.3 HRC and Ra  0.008 m) slid against AISI 52100 steel balls',
};
const LOAD_Q = {
  page: 3,
  quote: 'The tribotests were carried out under a normal load of 2 N, which corresponds to a mean Hertz contact pressure of 1.34 GPa',
};
const TEMP_Q = {
  page: 4,
  quote: 'The lubricating ability of MO and 1 wt% DCi+MO at room temperature and 100 °C under reciprocating',
};
const VEL_Q = {
  page: 3,
  quote: 'The sliding speed for each test was set to 0.05 m/s with frequency of 5 Hz, stroke length of 5 mm, and sliding distance of 200 m.',
};

const BASE_FLEX = [
  { key: 'additive_synthesis', value: 'DCi synthesized from diethanolamine + citric acid in ethanol under argon (0.6 mol amine, "0.2 ml" citric acid as printed - stoichiometrically 0.2 mol for the 3:1 tris-salt); ionic structure confirmed by 1H NMR', note: 'PDF p2-3; the "0.2 ml" in the text is a units typo for 0.2 mol (0.6:0.2 = 3 cations per citrate, matching the empirical formula).' },
  { key: 'stoichiometry', value: 'Tri-[bis(2-hydroxyethylammonium)] citrate: 3 bis(2-hydroxyethylammonium) cations per citrate(3-) anion; empirical formula C18H41O13N3 (Table 2)', note: 'PDF p2 Table 2; 3 x C4H12NO2+ + C6H5O7(3-) = C18H41N3O13.' },
  { key: 'test_kinematics', value: 'Reciprocating: 5 Hz, 5 mm stroke, 0.05 m/s, 200 m sliding distance', note: 'PDF p3.' },
  { key: 'hertz_pressure', value: 'Mean Hertz contact pressure 1.34 GPa, maximum 2.02 GPa at the 2 N load', note: 'PDF p3.' },
  { key: 'replicate_policy', value: 'At least three tests per lubricant at room temperature and at 100 °C; Fig. 6 bars carry error whiskers', note: 'PDF p3; Fig. 6 caption "Average friction coefficients as a function of temperature" (PDF p5).' },
  { key: 'lubricant_supply', value: '1 mL lubricant added on the disk before each test; no additional lubricant during the test', note: 'PDF p3.' },
  { key: 'base_oil', value: 'Mineral oil (MO) provided by Repsol (Spain): kinematic viscosity 45.91 cSt at 40 °C and 6.676 cSt at 100 °C, viscosity index 97, density 0.8668 g/mL at 15 °C, flash point 234 °C, pour point -12 °C', note: 'PDF p2 Table 1.' },
  { key: 'blend_viscosity', value: '1 wt% DCi+MO dynamic viscosity 97.17 / 43.58 / 6.22 cP at 25 / 40 / 100 °C (neat MO: 92.78 / 42.54 / 5.90 cP)', note: 'PDF p4 Table 4; the blend viscosity is only slightly higher than neat MO.' },
  { key: 'stability', value: '1 wt% DCi in MO: no visual deposit after centrifuging (6,500 rpm, 10 min) nor after 24, 168 and 720 h', note: 'PDF p3-4, Fig. 3.' },
  { key: 'thermal_stability', value: 'Onset decomposition 300.4 °C for 1 wt% DCi+MO (MO 291.2 °C, DCi 191.2 °C)', note: 'PDF p4 Table 3.' },
  { key: 'halogen_free', value: 'PIL contains only C, H, N and O - free of halogens, sulfur and phosphorus', note: 'PDF p2: "a protic ammonium cation and carboxylate anion, with only carbons, hydrogens, nitrogens, and oxygens, will be used as a new PIL".' },
  { key: 'cof_digitization', value: 'Fig. 6 bars (PDF p5): MO room temperature 0.1440, MO 100 °C 0.1537, 1 wt% DCi+MO room temperature 0.1019, 1 wt% DCi+MO 100 °C 0.0987 (reading A = reading B on every bar)', note: 'Bar columns: MO-RT 229-280, DCi-RT 281-332, MO-100C 409-460, DCi-100C 462-513; measured bar-top rows 207/259/195/263.' },
  { key: 'rt_temperature_note', value: 'The tribotest temperature is stated only as "room temperature" (not numerically specified)', note: 'PDF p3-4; ambient lab temperature, roughly 20-25 °C.' },
  { key: 'roughness_caveat', value: 'Disk Ra 0.008 um and ball Ra 0.53 um as printed; the degree/approx symbols were lost in text extraction and the ball value is unusually high for a bearing ball', note: 'PDF p3; values quoted verbatim from the extracted text.' },
  { key: 'wear_data_available', value: 'yes (not extracted here): disk wear volume reduced 59.4% by DCi at 100 °C, slightly increased at room temperature (PDF p5, Fig. 7); oxygen-richened tribolayer at 100 °C (EDS, PDF p7-8)', note: 'Friction-only batch.' },
];

const REASON =
  'APPROVE - figure-derived COF promoted by rigorous pixel-calibrated digitization of the unlabeled Fig. 6 bar chart, following the platform precedent (greases marker digitization; coatings9110713 bar digitization at ±0.004; batch-09-ammoniumphos promotion gate |A-B| <= 0.005). ' +
  'The paper has zero text-extractable COF values; friction is reported only as the four-bar Fig. 6 "Average friction coefficients as a function of temperature" (verified on rendered pages/page-5.png) plus the percent reductions 29.0% (room temperature) and 35.5% (100 °C) stated in the abstract and conclusions. ' +
  'Two independent readings (row-scan fill fraction and per-column intensity-crossing median) gave identical bar-top rows for all four bars (|A-B| = 0.0000); the y-axis calibration from the nine label-row centers is linear to 0.00005 COF; overlay lines drawn at the computed values visually pass through the bar tops (digit-check-fig6.png). ' +
  'All text statements reproduce: digitized friction reduction (0.1440-0.1019)/0.1440 = 29.2% vs stated 29.0% at room temperature; (0.1537-0.0987)/0.1537 = 35.8% vs stated 35.5% at 100 °C; the DCi blend friction "remains constant" with temperature (0.1019 vs 0.0987) while neat MO friction increases (0.1440 -> 0.1537). ' +
  'The neat-MO bars are the non-IL control and were not drafted as records. Load (2 N), substrate, counterbody, speed, frequency, stroke and distance are text-stated (PDF p3), so core completeness holds. ' +
  'Source-based AI-assisted curation with pixel digitization; not independent domain-expert validation.';

const candidates = [
  {
    key: 'protpil-dci-mo-1wt-rt',
    temperature: 'Room temperature',
    cof: 0.102,
    cofMethod:
      'Average friction coefficient ("recorded over time and calculated as average of each running", PDF p3) of 1 wt% DCi+MO at room temperature, digitized from the unlabeled Fig. 6 bar chart (PDF p5). ' +
      'Reading A (row-scan) 0.1019 / reading B (column intensity-crossing median) 0.1019, |A-B| = 0.0000. ' + DIGI_COMMON +
      'Consistent with the stated 29.0% friction reduction vs MO: digitized MO 0.1440 -> (0.1440-0.1019)/0.1440 = 29.2%.',
    cofProv: {
      page: 8,
      quote: 'with friction reductions of 29.0% at room temperature, and 35.5% at 100 °C',
      note: 'COF digitized from the unlabeled Fig. 6 bar (PDF p5) by pixel-calibrated two-reading measurement (0.1019/0.1019); the digitized pair (MO 0.1440, DCi 0.1019) reproduces the stated 29.0% reduction as 29.2%.',
    },
    flexible: [
      ...BASE_FLEX,
      { key: 'wear_at_rt', value: 'At room temperature the presence of DCi slightly increased the disk wear volume vs MO', note: 'PDF p5: "At room temperature, the presence of DCi in the lubricant slightly increased the wear volume of the steel disks" - friction improves but wear does not at RT.' },
    ],
  },
  {
    key: 'protpil-dci-mo-1wt-100c',
    temperature: '100 °C',
    cof: 0.099,
    cofMethod:
      'Average friction coefficient ("recorded over time and calculated as average of each running", PDF p3) of 1 wt% DCi+MO at 100 °C, digitized from the unlabeled Fig. 6 bar chart (PDF p5). ' +
      'Reading A (row-scan) 0.0987 / reading B (column intensity-crossing median) 0.0987, |A-B| = 0.0000. ' + DIGI_COMMON +
      'Consistent with the stated maximum friction reduction of 35.5% at 100 °C: digitized MO 0.1537 -> (0.1537-0.0987)/0.1537 = 35.8%; also consistent with "when 1 wt% DCi+MO is used as lubricant, the friction coefficient remains constant" (0.1019 at RT vs 0.0987 at 100 °C).',
    cofProv: {
      page: 8,
      quote: 'with friction reductions of 29.0% at room temperature, and 35.5% at 100 °C',
      note: 'COF digitized from the unlabeled Fig. 6 bar (PDF p5) by pixel-calibrated two-reading measurement (0.0987/0.0987); the digitized pair (MO 0.1537, DCi 0.0987) reproduces the stated 35.5% reduction as 35.8%.',
    },
    flexible: [
      ...BASE_FLEX,
      { key: 'tribolayer', value: 'Oxygen-richened tribolayer on the disk at 100 °C (EDS: higher oxygen inside the wear track, homogeneously distributed), held responsible for the good lubricating behavior', note: 'PDF p7-8, Fig. 13.' },
    ],
  },
].map((r) => ({
  key: r.key,
  sourcePdf: PDF,
  sourceUrl: URL,
  decision: 'approve',
  reason: REASON,
  fields: {
    paper: { title: TITLE, doi: DOI, journal: 'Friction', year: 2021 },
    cation: ION.cation,
    cationSmiles: ION.cationSmiles,
    anion: ION.anion,
    anionSmiles: ION.anionSmiles,
    substrate: 'AISI 52100 steel disk',
    temperature: r.temperature,
    load: '2 N',
    cof: r.cof,
    cofMethod: r.cofMethod,
    scale: 'macro',
    method: 'Reciprocating sliding, custom-designed ball-on-flat reciprocating tribometer with heater',
    probe: 'AISI 52100 steel ball',
    probeType: 'ball, 1.5 mm',
    velocity: '0.05 m/s',
    roughness: 'Disk Ra 0.008 µm; ball Ra 0.53 µm (as printed)',
    concentration: '1 wt% DCi (tri-[bis(2-hydroxyethylammonium)] citrate) in mineral oil (MO)',
    flexible: r.flexible,
    provenance: [
      { field: 'cation', basis: 'direct', page: 2, quote: 'The PIL, tri-[bis(2-hydroxyethylammonium)] citrate (DCi), was synthesized in our laboratory' },
      { field: 'anion', basis: 'direct', page: 2, quote: '0.2 ml citric acid was dissolved in 100 ml of ethanol, and the mixture', note: 'Citrate anion from citric acid precursor; 3:1 amine:acid stoichiometry gives the tri-ammonium citrate; ionic structure confirmed by 1H NMR (PDF p3).' },
      { field: 'substrate', basis: 'direct', page: SUB_Q.page, quote: SUB_Q.quote },
      { field: 'temperature', basis: 'direct', page: TEMP_Q.page, quote: TEMP_Q.quote },
      { field: 'load', basis: 'direct', page: LOAD_Q.page, quote: LOAD_Q.quote },
      { field: 'cof', basis: 'inferred', page: r.cofProv.page, quote: r.cofProv.quote, note: r.cofProv.note },
      { field: 'velocity', basis: 'direct', page: VEL_Q.page, quote: VEL_Q.quote },
    ],
  },
}));

writeFileSync('data/literature-expansion-20260912/reviewed-fric-0378-z.json', JSON.stringify(candidates, null, 2));
console.log('wrote', candidates.length, 'candidates');
