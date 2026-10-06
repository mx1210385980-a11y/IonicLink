/**
 * Generate reviewed-batch-06-adma.json from the page-verified values of
 * Qu et al., Adv. Mater. 2015 (10.1002/adma.201502037).
 * Steady-state COF values: Fig. S2 (PDF p19), average of final 100 m of sliding.
 * Methods: PDF p9 (TE77, 100 °C, 100 N, 10 Hz, 10 mm stroke, 1000 m).
 */
import { writeFileSync } from 'node:fs';

const PDF = 'data/literature-expansion-20260912/discovery-bulk-03/10.1002-adma.201502037.pdf';
const URL = 'https://doi.org/10.1002/adma.201502037';
const DOI = '10.1002/adma.201502037';
const TITLE = 'Synergistic Effects Between Phosphonium-Alkylphosphate Ionic Liquids and ZDDP as Lubricant Additives';

const IONS: Record<string, { cation: string; cationSmiles: string; anion: string; anionSmiles: string; anionQuote: string }> = {
  P8888: {
    cation: 'tetraoctylphosphonium',
    cationSmiles: '[P+](CCCCCCCC)(CCCCCCCC)(CCCCCCCC)CCCCCCCC',
    anion: 'bis(2-ethylhexyl) phosphate',
    anionSmiles: 'CCCCC(CC)COP(=O)([O-])OCC(CC)CCCC',
    anionQuote: 'tetraoctylphosphonium bis(2-ethylhexyl)phosphate',
  },
  P66614DEHP: {
    cation: 'trihexyl(tetradecyl)phosphonium',
    cationSmiles: '[P+](CCCCCC)(CCCCCC)(CCCCCC)CCCCCCCCCCCCCC',
    anion: 'bis(2-ethylhexyl) phosphate',
    anionSmiles: 'CCCCC(CC)COP(=O)([O-])OCC(CC)CCCC',
    anionQuote: 'trihexyltetradecylphosphonium bis(2-ethylhexyl)phosphate ([P66614][DEHP])',
  },
  P66614BTMPP: {
    cation: 'trihexyl(tetradecyl)phosphonium',
    cationSmiles: '[P+](CCCCCC)(CCCCCC)(CCCCCC)CCCCCCCCCCCCCC',
    anion: 'bis(2,4,4-trimethylpentyl)phosphinate',
    anionSmiles: 'O=P([O-])(CC(C)CC(C)(C)C)CC(C)CC(C)(C)C',
    anionQuote: 'trihexyltetradecylphosphonium bis(2,4,4-trimethylpentyl)alkylphosphinate',
  },
  N888H: {
    cation: 'trioctylammonium',
    cationSmiles: '[NH+](CCCCCCCC)(CCCCCCCC)CCCCCCCC',
    anion: 'bis(2-ethylhexyl) phosphate',
    anionSmiles: 'CCCCC(CC)COP(=O)([O-])OCC(CC)CCCC',
    anionQuote: 'trioctylammonium di(2-ethylhexyl)phosphate ([N888H][DEHP])',
  },
};

const METHOD_QUOTE = 'using an AISI 52100 steel ball against a CL35 grey cast iron flat';
const TEMP_QUOTE = 'At a controlled oil temperature of 100 ºC';
const LOAD_QUOTE = 'under a 100 N normal load';
const VEL_QUOTE = '10 Hz oscillation with a 10 mm stroke';

interface Spec {
  key: string;
  ions: keyof typeof IONS;
  withZddp: boolean;
  cof: number;
  cofQuote: string;
  treatRate: string;
  concentration: string;
  additives?: string;
}

const SPECS: Spec[] = [
  { key: 'adma-2015-p8888-dehp-zddp-100c', ions: 'P8888', withZddp: true, cof: 0.079, cofQuote: '0.116 0.079 0.115', treatRate: '0.4 wt% ZDDP + 0.52 wt% [P8888][DEHP]', concentration: '0.52 wt% [P8888][DEHP] + 0.4 wt% ZDDP in GTL 4 cSt base oil (ZDDP:IL 1:1 molecular ratio; 0.08 wt% total P)', additives: '0.4 wt% secondary ZDDP (Lubrizol)' },
  { key: 'adma-2015-p8888-dehp-alone-100c', ions: 'P8888', withZddp: false, cof: 0.115, cofQuote: '0.116 0.079 0.115', treatRate: '1.04 wt% [P8888][DEHP]', concentration: '1.04 wt% [P8888][DEHP] in GTL 4 cSt base oil (0.08 wt% P)' },
  { key: 'adma-2015-p66614-dehp-zddp-100c', ions: 'P66614DEHP', withZddp: true, cof: 0.081, cofQuote: '0.116 0.081 0.111', treatRate: '0.4 wt% ZDDP + 0.52 wt% [P66614][DEHP]', concentration: '0.52 wt% [P66614][DEHP] + 0.4 wt% ZDDP in GTL 4 cSt base oil (ZDDP:IL 1:1 molecular ratio; 0.08 wt% total P)', additives: '0.4 wt% secondary ZDDP (Lubrizol)' },
  { key: 'adma-2015-p66614-dehp-alone-100c', ions: 'P66614DEHP', withZddp: false, cof: 0.111, cofQuote: '0.116 0.081 0.111', treatRate: '1.04 wt% [P66614][DEHP]', concentration: '1.04 wt% [P66614][DEHP] in GTL 4 cSt base oil (0.08 wt% P)' },
  { key: 'adma-2015-p66614-btmpp-zddp-100c', ions: 'P66614BTMPP', withZddp: true, cof: 0.122, cofQuote: '0.116 0.122 0.121', treatRate: '0.4 wt% ZDDP + 0.5 wt% [P66614][BTMPP]', concentration: '0.5 wt% [P66614][BTMPP] + 0.4 wt% ZDDP in GTL 4 cSt base oil (ZDDP:IL 1:1 molecular ratio; 0.08 wt% total P)', additives: '0.4 wt% secondary ZDDP (Lubrizol)' },
  { key: 'adma-2015-p66614-btmpp-alone-100c', ions: 'P66614BTMPP', withZddp: false, cof: 0.121, cofQuote: '0.116 0.122 0.121', treatRate: '1.0 wt% [P66614][BTMPP]', concentration: '1.0 wt% [P66614][BTMPP] in GTL 4 cSt base oil (0.08 wt% P)' },
  { key: 'adma-2015-n888h-dehp-zddp-100c', ions: 'N888H', withZddp: true, cof: 0.123, cofQuote: '0.116 0.123 0.108', treatRate: '0.4 wt% ZDDP + 0.87 wt% [N888H][DEHP]', concentration: '0.87 wt% [N888H][DEHP] + 0.4 wt% ZDDP in GTL 4 cSt base oil (ZDDP:IL 1:2 molecular ratio; 0.08 wt% total P)', additives: '0.4 wt% secondary ZDDP (Lubrizol)' },
  { key: 'adma-2015-n888h-dehp-alone-100c', ions: 'N888H', withZddp: false, cof: 0.108, cofQuote: '0.116 0.123 0.108', treatRate: '1.74 wt% [N888H][DEHP]', concentration: '1.74 wt% [N888H][DEHP] in GTL 4 cSt base oil (0.08 wt% P)' },
];

const REASON =
  'Steady-state friction coefficient read from the labeled bar values of Fig. S2 (PDF p19), defined in its caption as the average of the final 100 m of sliding; Fig. 1 traces report the same tests graphically without conflicting labels for the same statistic. ' +
  'Conditions taken from the Experimental section (PDF p9): TE77 reciprocating tribometer, AISI 52100 steel ball vs CL35 grey cast iron flat, 100 °C oil temperature, 100 N load, 10 Hz / 10 mm stroke, 1000 m sliding. ' +
  'Ion identities from PDF p2; treat rates from PDF p2 and Table S2 (PDF p18). The GTL+0.8%ZDDP control (0.116) contains no ionic liquid and is excluded per platform scope. ' +
  'Source-based AI-assisted curation; not independent domain-expert validation.';

const candidates = SPECS.map((s) => {
  const ion = IONS[s.ions];
  return {
    key: s.key,
    sourcePdf: PDF,
    sourceUrl: URL,
    decision: 'approve',
    reason: REASON,
    fields: {
      paper: { title: TITLE, doi: DOI, journal: 'Advanced Materials', year: 2015 },
      cation: ion.cation,
      cationSmiles: ion.cationSmiles,
      anion: ion.anion,
      anionSmiles: ion.anionSmiles,
      substrate: 'CL35 grey cast iron flat',
      temperature: '100 °C',
      load: '100 N',
      cof: s.cof,
      cofMethod: 'Steady-state friction coefficient, average of the final 100 m of sliding (Fig. S2)',
      scale: 'macro',
      method: 'Reciprocating sliding, Phoenix-Tribology Plint TE77 tribometer',
      probe: 'AISI 52100 steel ball',
      velocity: '0.2 m/s',
      concentration: s.concentration,
      ...(s.additives ? { additives: s.additives } : {}),
      flexible: [
        { key: 'measurement_stage', value: 'steady_state_final_100m_avg', note: 'Fig. S2 caption: "Steady-state friction coefficient (average of final 100 m of sliding)" (PDF p19).' },
        { key: 'velocity_derivation', value: '0.2 m/s mean sliding speed', note: 'Derived as 2 x stroke x frequency = 2 x 10 mm x 10 Hz from PDF p9 "10 Hz oscillation with a 10 mm stroke"; not a directly reported speed.' },
        { key: 'base_oil', value: 'GTL 4 cSt base oil (Shell); density 0.82 g/cc; 18.5 / 4.0 cSt at 40 / 100 °C', note: 'PDF p8 Experimental section.' },
        { key: 'sample_preparation', value: 'CL35 grey cast iron flat polished using 600 grit SiC grinding paper', note: 'PDF p9.' },
        { key: 'test_duration', value: '1000 m sliding', note: 'PDF p9.' },
        { key: 'replicate_policy', value: 'At least three replicate tests per lubricant; each friction trace or wear volume is the mean of three repeat tests', note: 'PDF p2 and p9.' },
        { key: 'treat_rate_detail', value: s.treatRate, note: 'PDF p2 / Table S2 (PDF p18); all blends equalized to 0.08 wt% phosphorus.' },
        { key: 'counterbody', value: 'AISI 52100 steel ball', note: 'PDF p9; mimics piston ring / cylinder liner interface.' },
        { key: 'wear_data_available', value: 'yes (not extracted here)', note: 'Fig. 1 / Fig. S2 wear volumes exist; this batch records friction only.' },
      ],
      provenance: [
        { field: 'cation', basis: 'direct', page: 2, quote: `${ion.cation.replace('trihexyl(tetradecyl)', 'trihexyltetradecyl')}` },
        { field: 'anion', basis: 'direct', page: 2, quote: ion.anionQuote },
        { field: 'substrate', basis: 'direct', page: 9, quote: METHOD_QUOTE },
        { field: 'temperature', basis: 'direct', page: 9, quote: TEMP_QUOTE },
        { field: 'load', basis: 'direct', page: 9, quote: LOAD_QUOTE },
        { field: 'cof', basis: 'direct', page: 19, quote: s.cofQuote },
        { field: 'velocity', basis: 'inferred', page: 9, quote: VEL_QUOTE, note: 'Mean sliding speed derived from stroke and frequency; not a reported speed.' },
      ],
    },
  };
});

writeFileSync('data/literature-expansion-20260912/reviewed-batch-06-adma.json', JSON.stringify(candidates, null, 2));
console.log('wrote', candidates.length, 'candidates');
