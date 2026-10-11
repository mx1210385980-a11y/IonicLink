/**
 * Generate reviewed-batch-06-lipophilic.json from the page-verified values of
 * Bapat et al., React. Funct. Polym. 2018 (10.1016/j.reactfunctpolym.2018.07.020).
 * Manuscript pages below are the [PAGE n] markers of batch-06-lipophilic/source-pages.txt.
 * Methods: PDF p7 (modified Plint reciprocating tribometer, 52100 steel ball-on-flat,
 *   100 °C, 15.6 N load / 1 GPa Hertzian, 20 mm stroke at 2 Hz, one-hour tests).
 * COF values: PDF p12 — end-of-test average CoF ~0.12 for the majority of samples,
 *   only TDA-TFSI and P4 lower (~0.10); P1's ~0.12 plateau stated for Fig. 1A.
 * Ion identities: PDF p8 (IL methacrylate monomers 3 TFSI / 4 DCA from cation 2);
 *   Table 1 characterization PDF pp23-24. Base oil: PDF p4; 5 wt% loading: PDF p11.
 *
 * Drafts omitted (non-IL controls, per platform scope): P6 and P12 (non-ionic
 * DMAEMA/DMA copolymers) and the neat PAO4 base-oil control. The small-molecule
 * IL TDA-TFSI is ionic and is retained.
 */
import { writeFileSync } from 'node:fs';

const PDF = 'data/literature-expansion-20260912/discovery-institutions/lipophilic-polymeric-ionic-liquid.pdf';
const URL = 'https://doi.org/10.1016/j.reactfunctpolym.2018.07.020';
const DOI = '10.1016/j.reactfunctpolym.2018.07.020';
const TITLE = 'What is the Effect of Lipophilic Polymeric Ionic Liquids on Friction and Wear?';

const CATION_PIL = 'N-ethyl-2-(methacryloyloxy)-N,N-dimethylethan-1-ammonium (polymerized repeat unit)';
const CATION_PIL_SMILES = 'C=C(C)C(=O)OCC[N+](C)(C)CC';
const CATION_TDA = 'tetradodecylammonium';
const CATION_TDA_SMILES = '[N+](CCCCCCCCCCCC)(CCCCCCCCCCCC)(CCCCCCCCCCCC)CCCCCCCCCCCC';
const ANION_TFSI = 'bis((trifluoromethyl)sulfonyl)amide (TFSI)';
const ANION_TFSI_SMILES = '[N-](S(=O)(=O)C(F)(F)F)S(=O)(=O)C(F)(F)F';
const ANION_DCA = 'dicyanamide (DCA)';
const ANION_DCA_SMILES = '[N-](C#N)C#N';

/* Verbatim quotes (verified against batch-06-lipophilic/source-pages.txt). */
const Q_CATION_PIL =
  'quarternization of DMAEMA (1) with bromoethane was achieved at RT in acetonitrile to yield N-ethyl-2-(methacryloyloxy)-N,N-dimethylethan-1-ammonium bromide (2)';
const Q_ANIONS =
  'bis((trifluoromethyl)sulfonyl)amide (TFSI) (3), or a dicyanamide (DCA) (4) counter-anion were';
const Q_TDA = 'tetradodecylammonium bis((trifluoromethyl)sulfonyl)amide (TDA-TFSI)';
const Q_SUBSTRATE = 'lower specimen was a type 52100 steel (hardened to Rc 62 HRC) flat polished to mirror finish';
const Q_PROBE = 'hardened type 52100 steel (Rc 62 HRC with Sa = 15 nm) ball';
const Q_TEMP = 'The testing temperature was 100 °C';
const Q_LOAD = 'A load of 15.6 N was used to';
const Q_VEL = 'The stroke length was 20 mm and the reciprocation rate was…2 Hz';
const Q_COF_P1 = 'the average CoF plateaued to a steady value of ~0.12 at the end of the test duration';
const Q_COF_LOW = 'TDA-TFSI and P4 showed a slightly lower value (~0.10), indicating a';
const Q_COF_MAJORITY = 'of the samples was ~0.12, TDA-TFSI and P4 showed a slightly lower value (~0.10)';
const Q_CONC = 'containing copolymers provided clear, homogeneous solutions in PAO4 at a 5 wt. % loading';

const SECTION_TRIB = '2.4 Tribology measurements';
const SECTION_MONO = '3.1 Synthesis of IL monomers';
const SECTION_FRIC = '3.4 Friction-and-wear';

const MAJORITY_BASIS_NOTE =
  'End-of-test average CoF stated as ~0.12 for the majority of samples, with only TDA-TFSI and P4 lower (~0.10); ' +
  'the individual Fig. 2A bars are unlabeled, so the per-sample value is attributed from this group statement ' +
  '(the rendered Fig. 2A confirms all bars fall within ~0.10-0.12).';

const VELOCITY_BASIS_NOTE =
  'Mean sliding speed derived as 2 x stroke x frequency = 2 x 20 mm x 2 Hz = 0.08 m/s; speed not directly reported.';

interface FlexibleEntry {
  key: string;
  value: string;
  unit?: string;
  note?: string;
}

interface Spec {
  key: string;
  polymeric: boolean;
  polymerId?: string;
  monomer?: string;
  topology?: 'random' | 'block';
  anion: 'TFSI' | 'DCA';
  cof: number;
  cofBasis: 'direct' | 'inferred';
  cofQuote: string;
  cofFigure: string;
  cofBasisNote?: string;
  additives: string;
  concentration?: string;
  flex: FlexibleEntry[];
}

const PIL_FLEX = (topology: string, monomer: string): FlexibleEntry[] => [
  {
    key: 'polymeric_nature',
    value: `Polymeric ionic liquid (PIL): ion SMILES represent the monomeric IL-methacrylate repeat-ion species; the additive is a ${topology} copolymer of dodecyl methacrylate (DMA, ~80 mol% feed) and IL methacrylate monomer ${monomer}`,
    note: 'PDF pp8-9 and Table 1 (PDF pp23-24).',
  },
  { key: 'base_oil', value: 'PAO4 (Exxon Mobil), additive-free hydrogenated olefin oligomer, 4.1 cSt at 100 °C and 19 cSt at 40 °C', note: 'PDF p4.' },
  { key: 'velocity_derivation', value: '0.08 m/s mean sliding speed', note: 'Derived as 2 x stroke x frequency = 2 x 20 mm x 2 Hz from PDF p7; not a directly reported speed.' },
  { key: 'test_duration', value: 'Nominally one hour', note: 'PDF p7.' },
  { key: 'hertzian_pressure', value: '1 GPa peak initial static Hertzian pressure', note: 'PDF p7; the 15.6 N load was chosen to produce it.' },
  { key: 'counterbody', value: 'Type 52100 steel ball, hardened Rc 62 HRC, Sa = 15 nm, 1/2 in diameter', note: 'PDF p7.' },
];

const PIL_PROV_EXTRA = [
  { field: 'probe', basis: 'direct' as const, page: 7, section: SECTION_TRIB, quote: Q_PROBE },
  { field: 'concentration', basis: 'direct' as const, page: 11, section: '3.3 Solubility of copolymers in PAO4', quote: Q_CONC },
];

const SPECS: Spec[] = [
  {
    key: 'lipophilic-tda-tfsi-steel-100c',
    polymeric: false,
    anion: 'TFSI',
    cof: 0.1,
    cofBasis: 'direct',
    cofQuote: Q_COF_LOW,
    cofFigure: 'Fig. 2A',
    additives: 'None (TDA-TFSI itself is the ionic-liquid additive)',
    flex: [
      {
        key: 'polymeric_nature',
        value: 'Small-molecule (non-polymeric) ionic liquid; the paper’s non-polymeric IL comparison sample',
        note: 'PDF p12.',
      },
      { key: 'base_oil', value: 'PAO4 (Exxon Mobil), additive-free hydrogenated olefin oligomer, 4.1 cSt at 100 °C and 19 cSt at 40 °C', note: 'PDF p4.' },
      { key: 'velocity_derivation', value: '0.08 m/s mean sliding speed', note: 'Derived as 2 x stroke x frequency = 2 x 20 mm x 2 Hz from PDF p7; not a directly reported speed.' },
      { key: 'test_duration', value: 'Nominally one hour', note: 'PDF p7.' },
      { key: 'hertzian_pressure', value: '1 GPa peak initial static Hertzian pressure', note: 'PDF p7; the 15.6 N load was chosen to produce it.' },
      { key: 'counterbody', value: 'Type 52100 steel ball, hardened Rc 62 HRC, Sa = 15 nm, 1/2 in diameter', note: 'PDF p7.' },
      { key: 'tda_tfsi_loading', value: 'not stated', note: 'PAO4 solution loading of TDA-TFSI is not given in the main text; the copolymers were all tested at 5 wt% (PDF p11).' },
      { key: 'wear_volume', value: '226000', unit: 'μm3', note: 'PDF p12: average ball wear volume; more than twice P4 (98500 μm3) at a similar ~0.10 CoF.' },
    ],
  },
  {
    key: 'lipophilic-pil-p1-tfsi-random-5wt-steel-100c',
    polymeric: true,
    polymerId: 'P1',
    monomer: '3 (TFSI)',
    topology: 'random',
    anion: 'TFSI',
    cof: 0.12,
    cofBasis: 'direct',
    cofQuote: Q_COF_P1,
    cofFigure: 'Fig. 1A',
    additives: 'P1: random copolymer of dodecyl methacrylate and IL monomer 3 (TFSI); Mn,SEC 17.9 kDa',
    concentration: '5 wt% in PAO4',
    flex: [
      ...PIL_FLEX('random', '3 (TFSI)'),
      { key: 'polymer_id', value: 'P1', note: 'Table 1 (PDF p23).' },
      { key: 'mn_sec', value: 'Mn,SEC 17.9 kDa; Mw,SEC 21.4 kDa; dispersity 1.20', note: 'Table 1 (PDF p23); SEC vs polystyrene standards.' },
      { key: 'il_mole_percent_nmr', value: '12.6 mol% (20 mol% in feed)', note: 'Table 1 (PDF p23); the paper notes NMR-derived IL content is likely underestimated.' },
      { key: 'tribofilm_note', value: 'Representative sample in Fig. 1, showing pronounced, patchy thin tribochemical films on the ball wear scar', note: 'PDF p12 and Fig. 1 (PDF pp21-22).' },
    ],
  },
  {
    key: 'lipophilic-pil-p2-tfsi-random-5wt-steel-100c',
    polymeric: true,
    polymerId: 'P2',
    monomer: '3 (TFSI)',
    topology: 'random',
    anion: 'TFSI',
    cof: 0.12,
    cofBasis: 'inferred',
    cofQuote: Q_COF_MAJORITY,
    cofFigure: 'Fig. 2A',
    cofBasisNote: MAJORITY_BASIS_NOTE,
    additives: 'P2: random copolymer of dodecyl methacrylate and IL monomer 3 (TFSI); Mn,SEC 15.7 kDa',
    concentration: '5 wt% in PAO4',
    flex: [
      ...PIL_FLEX('random', '3 (TFSI)'),
      { key: 'polymer_id', value: 'P2', note: 'Table 1 (PDF p23).' },
      { key: 'mn_sec', value: 'Mn,SEC 15.7 kDa; Mw,SEC 20 kDa; dispersity 1.28', note: 'Table 1 (PDF p23).' },
      { key: 'il_mole_percent_nmr', value: '18.7 mol% (20 mol% in feed)', note: 'Table 1 (PDF p23).' },
    ],
  },
  {
    key: 'lipophilic-pil-p3-tfsi-random-5wt-steel-100c',
    polymeric: true,
    polymerId: 'P3',
    monomer: '3 (TFSI)',
    topology: 'random',
    anion: 'TFSI',
    cof: 0.12,
    cofBasis: 'inferred',
    cofQuote: Q_COF_MAJORITY,
    cofFigure: 'Fig. 2A',
    cofBasisNote: MAJORITY_BASIS_NOTE,
    additives: 'P3: random copolymer of dodecyl methacrylate and IL monomer 3 (TFSI); Mn,SEC 9.5 kDa',
    concentration: '5 wt% in PAO4',
    flex: [
      ...PIL_FLEX('random', '3 (TFSI)'),
      { key: 'polymer_id', value: 'P3', note: 'Table 1 (PDF p23).' },
      { key: 'mn_sec', value: 'Mn,SEC 9.5 kDa; Mw,SEC 11.9 kDa; dispersity 1.25', note: 'Table 1 (PDF p23).' },
      { key: 'il_mole_percent_nmr', value: '18.0 mol% (20 mol% in feed)', note: 'Table 1 (PDF p23).' },
      { key: 'wear_comparison', value: 'Ball wear volume of P5 (DCA, similar Mn,SEC ~10 kDa) was ~85% lower than P3', note: 'PDF p13; recorded on the P5 record.' },
    ],
  },
  {
    key: 'lipophilic-pil-p4-tfsi-random-5wt-steel-100c',
    polymeric: true,
    polymerId: 'P4',
    monomer: '3 (TFSI)',
    topology: 'random',
    anion: 'TFSI',
    cof: 0.1,
    cofBasis: 'direct',
    cofQuote: Q_COF_LOW,
    cofFigure: 'Fig. 2A',
    additives: 'P4: random copolymer of dodecyl methacrylate and IL monomer 3 (TFSI); Mn,SEC 6.1 kDa',
    concentration: '5 wt% in PAO4',
    flex: [
      ...PIL_FLEX('random', '3 (TFSI)'),
      { key: 'polymer_id', value: 'P4', note: 'Table 1 (PDF p23).' },
      { key: 'mn_sec', value: 'Mn,SEC 6.1 kDa; Mw,SEC 7.7 kDa; dispersity 1.27', note: 'Table 1 (PDF p23).' },
      { key: 'il_mole_percent_nmr', value: '17.7 mol% (20 mol% in feed)', note: 'Table 1 (PDF p23).' },
      { key: 'wear_volume', value: '98500', unit: 'μm3', note: 'PDF p12: average ball wear volume, less than half that of TDA-TFSI (226000 μm3) at a similar ~0.10 CoF.' },
    ],
  },
  {
    key: 'lipophilic-pil-p5-dca-random-5wt-steel-100c',
    polymeric: true,
    polymerId: 'P5',
    monomer: '4 (DCA)',
    topology: 'random',
    anion: 'DCA',
    cof: 0.12,
    cofBasis: 'inferred',
    cofQuote: Q_COF_MAJORITY,
    cofFigure: 'Fig. 2A',
    cofBasisNote: MAJORITY_BASIS_NOTE,
    additives: 'P5: random copolymer of dodecyl methacrylate and IL monomer 4 (DCA); Mn,SEC 8.5 kDa',
    concentration: '5 wt% in PAO4',
    flex: [
      ...PIL_FLEX('random', '4 (DCA)'),
      { key: 'polymer_id', value: 'P5', note: 'Table 1 (PDF p23).' },
      { key: 'mn_sec', value: 'Mn,SEC 8.5 kDa; Mw,SEC 10.4 kDa; dispersity 1.21', note: 'Table 1 (PDF p23).' },
      { key: 'il_mole_percent_nmr', value: '10.1 mol% (20 mol% in feed)', note: 'Table 1 (PDF p23); likely underestimated per paper.' },
      { key: 'wear_note', value: 'P5 (with P11) had the lowest wear of all IL copolymers; average ball wear volume ~85% lower than P3 (TFSI) at similar Mn,SEC ~10 kDa', note: 'PDF p13.' },
    ],
  },
  {
    key: 'lipophilic-pil-p7-tfsi-block-5wt-steel-100c',
    polymeric: true,
    polymerId: 'P7',
    monomer: '3 (TFSI)',
    topology: 'block',
    anion: 'TFSI',
    cof: 0.12,
    cofBasis: 'inferred',
    cofQuote: Q_COF_MAJORITY,
    cofFigure: 'Fig. 2A',
    cofBasisNote: MAJORITY_BASIS_NOTE,
    additives: 'P7: block copolymer of dodecyl methacrylate and IL monomer 3 (TFSI); Mn,SEC 28.5 kDa',
    concentration: '5 wt% in PAO4',
    flex: [
      ...PIL_FLEX('block', '3 (TFSI)'),
      { key: 'polymer_id', value: 'P7', note: 'Table 1 (PDF p23).' },
      { key: 'mn_sec', value: 'Mn,SEC 28.5 kDa; Mw,SEC 44.8 kDa; dispersity 1.57 (bimodal trace)', note: 'Table 1 (PDF p23); low-MW hump attributed to chain termination during the first block synthesis (PDF p10).' },
      { key: 'il_mole_percent_nmr', value: '14.3 mol% (20 mol% in feed)', note: 'Table 1 (PDF p23); likely underestimated per paper.' },
    ],
  },
  {
    key: 'lipophilic-pil-p8-tfsi-block-5wt-steel-100c',
    polymeric: true,
    polymerId: 'P8',
    monomer: '3 (TFSI)',
    topology: 'block',
    anion: 'TFSI',
    cof: 0.12,
    cofBasis: 'inferred',
    cofQuote: Q_COF_MAJORITY,
    cofFigure: 'Fig. 2A',
    cofBasisNote: MAJORITY_BASIS_NOTE,
    additives: 'P8: block copolymer of dodecyl methacrylate and IL monomer 3 (TFSI); Mn,SEC 14.4 kDa',
    concentration: '5 wt% in PAO4',
    flex: [
      ...PIL_FLEX('block', '3 (TFSI)'),
      { key: 'polymer_id', value: 'P8', note: 'Table 1 (PDF p24).' },
      { key: 'mn_sec', value: 'Mn,SEC 14.4 kDa; Mw,SEC 17.2 kDa; dispersity 1.19', note: 'Table 1 (PDF p24).' },
      { key: 'il_mole_percent_nmr', value: '16.8 mol% (20 mol% in feed)', note: 'Table 1 (PDF p24).' },
      { key: 'wear_comparison', value: 'The paper reports P11 (DCA) ball wear volume ~70% lower than P8; its text calls both "Mn,SEC ~10 kDa" though Table 1 lists 14.2/14.4 kDa', note: 'PDF p13; recorded on the P11 record.' },
    ],
  },
  {
    key: 'lipophilic-pil-p9-tfsi-block-5wt-steel-100c',
    polymeric: true,
    polymerId: 'P9',
    monomer: '3 (TFSI)',
    topology: 'block',
    anion: 'TFSI',
    cof: 0.12,
    cofBasis: 'inferred',
    cofQuote: Q_COF_MAJORITY,
    cofFigure: 'Fig. 2A',
    cofBasisNote: MAJORITY_BASIS_NOTE,
    additives: 'P9: block copolymer of dodecyl methacrylate and IL monomer 3 (TFSI); Mn,SEC 9.2 kDa',
    concentration: '5 wt% in PAO4',
    flex: [
      ...PIL_FLEX('block', '3 (TFSI)'),
      { key: 'polymer_id', value: 'P9', note: 'Table 1 (PDF p24).' },
      { key: 'mn_sec', value: 'Mn,SEC 9.2 kDa; Mw,SEC 11.1 kDa; dispersity 1.20', note: 'Table 1 (PDF p24).' },
      { key: 'il_mole_percent_nmr', value: '17.2 mol% (20 mol% in feed)', note: 'Table 1 (PDF p24).' },
    ],
  },
  {
    key: 'lipophilic-pil-p10-tfsi-block-5wt-steel-100c',
    polymeric: true,
    polymerId: 'P10',
    monomer: '3 (TFSI)',
    topology: 'block',
    anion: 'TFSI',
    cof: 0.12,
    cofBasis: 'inferred',
    cofQuote: Q_COF_MAJORITY,
    cofFigure: 'Fig. 2A',
    cofBasisNote: MAJORITY_BASIS_NOTE,
    additives: 'P10: block copolymer of dodecyl methacrylate and IL monomer 3 (TFSI); Mn,SEC 5.5 kDa',
    concentration: '5 wt% in PAO4',
    flex: [
      ...PIL_FLEX('block', '3 (TFSI)'),
      { key: 'polymer_id', value: 'P10', note: 'Table 1 (PDF p24).' },
      { key: 'mn_sec', value: 'Mn,SEC 5.5 kDa; Mw,SEC 6.8 kDa; dispersity 1.22', note: 'Table 1 (PDF p24).' },
      { key: 'il_mole_percent_nmr', value: '17.5 mol% (20 mol% in feed)', note: 'Table 1 (PDF p24).' },
    ],
  },
  {
    key: 'lipophilic-pil-p11-dca-block-5wt-steel-100c',
    polymeric: true,
    polymerId: 'P11',
    monomer: '4 (DCA)',
    topology: 'block',
    anion: 'DCA',
    cof: 0.12,
    cofBasis: 'inferred',
    cofQuote: Q_COF_MAJORITY,
    cofFigure: 'Fig. 2A',
    cofBasisNote: MAJORITY_BASIS_NOTE,
    additives: 'P11: block copolymer of dodecyl methacrylate and IL monomer 4 (DCA); Mn,SEC 14.2 kDa',
    concentration: '5 wt% in PAO4',
    flex: [
      ...PIL_FLEX('block', '4 (DCA)'),
      { key: 'polymer_id', value: 'P11', note: 'Table 1 (PDF p24).' },
      { key: 'mn_sec', value: 'Mn,SEC 14.2 kDa; Mw,SEC 18.4 kDa; dispersity 1.29 (bimodal trace)', note: 'Table 1 (PDF p24); the numbers are the lower-MW distribution - the higher-MW distribution has apparent Mn,SEC 419 kDa, possibly micellar aggregates.' },
      { key: 'il_mole_percent_nmr', value: '11.7 mol% (20 mol% in feed)', note: 'Table 1 (PDF p24); likely underestimated per paper.' },
      { key: 'wear_note', value: 'P11 (with P5) had the lowest wear of all IL copolymers; the paper reports its average ball wear volume ~70% lower than P8 (TFSI) - the text calls both "Mn,SEC ~10 kDa" though Table 1 lists 14.2/14.4 kDa', note: 'PDF p13.' },
    ],
  },
];

function reasonFor(spec: Spec): string {
  const sample = spec.polymeric ? `${spec.polymerId} (${spec.topology} ${spec.anion} copolymer, 5 wt% in PAO4)` : 'TDA-TFSI (small-molecule IL in PAO4)';
  const cofPart =
    spec.cofBasis === 'direct'
      ? `End-of-test average COF (${spec.cof.toFixed(2)}) stated verbatim on PDF p12${spec.polymerId === 'P1' ? ' for the Fig. 1A trace of P1' : ''} and plotted in ${spec.cofFigure}.`
      : `End-of-test average COF ${spec.cof.toFixed(2)} attributed from the PDF p12 group statement (majority of samples ~0.12; only TDA-TFSI and P4 ~0.10); Fig. 2A bars are unlabeled.`;
  const ionPart = spec.polymeric
    ? 'Ion identities from the IL methacrylate monomer synthesis (PDF p8) and Table 1 (PDF pp23-24); the SMILES represent the monomeric repeat-ion species of the polymer.'
    : 'Ion identity from PDF p12 ("tetradodecylammonium bis((trifluoromethyl)sulfonyl)amide (TDA-TFSI)"); ionic liquid, so in platform scope despite being the paper’s non-polymeric comparison.';
  return (
    `Sample: ${sample}. ${cofPart} ${ionPart} ` +
    'Conditions from the Experimental tribology section (PDF p7): modified Plint reciprocating tribometer, ' +
    'type 52100 steel ball-on-flat, 100 °C, 15.6 N load (1 GPa peak Hertzian), 20 mm stroke at 2 Hz, one-hour tests; ' +
    'copolymers tested as clear 5 wt% solutions in PAO4 (PDF p11). ' +
    'Non-IL samples (P6, P12 DMAEMA copolymers; neat PAO4 control) are omitted from this batch per platform scope. ' +
    'Source-based AI-assisted curation; not independent domain-expert validation.');
}

const candidates = SPECS.map((spec) => {
  const isPil = spec.polymeric;
  const cation = isPil ? CATION_PIL : CATION_TDA;
  const cationSmiles = isPil ? CATION_PIL_SMILES : CATION_TDA_SMILES;
  const anion = spec.anion === 'TFSI' ? ANION_TFSI : ANION_DCA;
  const anionSmiles = spec.anion === 'TFSI' ? ANION_TFSI_SMILES : ANION_DCA_SMILES;

  const provenance: { field: string; basis: string; page: number; section?: string; figure?: string; quote: string; basisNote?: string }[] = [
    {
      field: 'cation',
      basis: 'direct',
      page: isPil ? 8 : 12,
      section: isPil ? SECTION_MONO : SECTION_FRIC,
      quote: isPil ? Q_CATION_PIL : Q_TDA,
      basisNote: isPil
        ? 'Cation of IL methacrylate monomers 3 (TFSI) and 4 (DCA); the P# additives are RAFT copolymers of that monomer with dodecyl methacrylate, so the record represents the polymerized repeat ion.'
        : undefined,
    },
    {
      field: 'anion',
      basis: 'direct',
      page: isPil ? 8 : 12,
      section: isPil ? SECTION_MONO : SECTION_FRIC,
      quote: isPil ? Q_ANIONS : Q_TDA,
    },
    { field: 'substrate', basis: 'direct', page: 7, section: SECTION_TRIB, quote: Q_SUBSTRATE },
    { field: 'temperature', basis: 'direct', page: 7, section: SECTION_TRIB, quote: Q_TEMP },
    { field: 'load', basis: 'direct', page: 7, section: SECTION_TRIB, quote: Q_LOAD },
    {
      field: 'cof',
      basis: spec.cofBasis,
      page: 12,
      section: SECTION_FRIC,
      figure: spec.cofFigure,
      quote: spec.cofQuote,
      basisNote: spec.cofBasisNote,
    },
    { field: 'velocity', basis: 'inferred', page: 7, section: SECTION_TRIB, quote: Q_VEL, basisNote: VELOCITY_BASIS_NOTE },
  ];
  if (isPil) provenance.push(...PIL_PROV_EXTRA);

  return {
    key: spec.key,
    sourcePdf: PDF,
    sourceUrl: URL,
    decision: 'approve',
    reason: reasonFor(spec),
    fields: {
      paper: { title: TITLE, doi: DOI, journal: 'Reactive and Functional Polymers', year: 2018 },
      cation,
      cationSmiles,
      anion,
      anionSmiles,
      substrate: 'Type 52100 steel flat, hardened to Rc 62 HRC, mirror-polished (Sa = 6 nm)',
      temperature: '100 °C',
      load: '15.6 N',
      cof: spec.cof,
      cofMethod: 'Time-average coefficient of friction calculated in software; end-of-test value',
      scale: 'macro',
      method: 'Reciprocating sliding, modified Plint tribometer (ball-on-flat)',
      probe: 'Hardened type 52100 steel ball (Rc 62 HRC, Sa = 15 nm), 1/2 in diameter',
      probeType: 'Ball',
      velocity: '0.08 m/s',
      roughness: 'Sa = 6 nm (flat); Sa = 15 nm (ball)',
      ...(spec.concentration ? { concentration: spec.concentration } : {}),
      additives: spec.additives,
      flexible: spec.flex,
      provenance: provenance.map((p) => (p.basisNote ? p : (({ basisNote, ...rest }) => rest)(p))),
    },
  };
});

writeFileSync('data/literature-expansion-20260912/reviewed-batch-06-lipophilic.json', JSON.stringify(candidates, null, 2));
console.log('wrote', candidates.length, 'candidates');
