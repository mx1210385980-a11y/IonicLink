import {
  listCuratedIons,
  normalizeIonKey,
  resolveIonStructure,
  standardizeIonLabel,
  type IonKind,
  type IonStructure,
} from "../ionStructures";
import {
  balabanJ,
  bertzComplexity,
  hBondAcceptors,
  hBondDonors,
  logPApprox,
  molecularWeight,
  parseSmiles,
  quaternaryAmmoniumCount,
  rotatableBonds,
  tpsa,
  vdwVolumeAndRadius,
} from "./smilesGraph";

/**
 * Ion featurization for the prediction engine.
 *
 * Every resolvable ion (lib/ionStructures) carries a SMILES string; a small
 * tokenizer turns it into physically named descriptors — no learned features,
 * no external chemistry library. Hydrogens are deliberately NOT counted
 * (`heavyMass` is the heavy-atom mass, not the molar mass): implicit-H
 * perception needs a full SMILES graph parser, and descriptors are only ever
 * compared with each other, so a consistent heavy-atom convention is enough.
 */

export interface IonDescriptor {
  /** Canonical identity key (normalizeIonKey) — collapses [BMIm]/[BMIM]/[C4C1Im]. */
  key: string;
  /** Standardized display label (subscript digits), or the raw input when unresolved. */
  label: string;
  name: string;
  family: string;
  kind: IonKind;
  /** False when lib/ionStructures cannot resolve the label — no features available. */
  resolved: boolean;
  heavyAtoms: number;
  /** Sum of heavy-atom atomic masses (g/mol, hydrogens excluded by convention). */
  heavyMass: number;
  nC: number;
  nF: number;
  /** N + O + S + P + B + Si heteroatom count. */
  nHetero: number;
  /** nF / heavyAtoms — 0..1 fluorination degree. */
  fluorineFraction: number;
  hasRing: boolean;
  /** Longest alkyl chain: parsed from the canonical label pattern, falling back to the longest C-run in SMILES. */
  chainLength: number;

  /* ---- literature feature set (computed from the molecular graph) ---- */
  /** Molecular weight including implicit hydrogens (g/mol). */
  mw: number;
  /** Rotatable bond count N_rot. */
  nRot: number;
  /** Lipinski H-bond donor count. */
  hbd: number;
  /** Lipinski H-bond acceptor count. */
  hba: number;
  /** Topological polar surface area, Ertl-style (Å²). */
  tpsa: number;
  /** Balaban J topological index (exact). */
  balabanJ: number;
  /** Bertz-style graph complexity (approximation — not the RDKit value). */
  bertzCT: number;
  /** Fragment-additive logP estimate (Hansch-style — not Crippen MolLogP). */
  logP: number;
  /** Equivalent-sphere van der Waals radius (Å, Zhao volume scheme). */
  radiusA: number;
  /** Quaternary ammonium nitrogen count. */
  qAmmonium: number;
}

const ATOMIC_MASS: Record<string, number> = {
  H: 1.008,
  B: 10.811,
  C: 12.011,
  N: 14.007,
  O: 15.999,
  F: 18.998,
  Si: 28.085,
  P: 30.974,
  S: 32.06,
  Cl: 35.45,
  Br: 79.904,
  I: 126.904,
};

const HETERO = new Set(["N", "O", "S", "P", "B", "Si"]);

/** Tokenize a SMILES into element symbols (aromatic folded to uppercase). H is skipped. */
export function smilesElements(smiles: string): string[] {
  const out: string[] = [];
  const re = /\[[^\]]+\]|Cl|Br|Si|[BCNOPSFI]|[bcnops]/g;
  for (const token of smiles.match(re) ?? []) {
    if (token.startsWith("[")) {
      const m = token.match(/^\[(?:\d+)?([A-Z][a-z]?|[a-z])/);
      if (!m) continue;
      const sym = m[1].length === 1 ? m[1].toUpperCase() : m[1];
      if (sym !== "H") out.push(sym);
    } else {
      out.push(token.length === 1 ? token.toUpperCase() : token);
    }
  }
  return out;
}

function hasRingClosure(smiles: string): boolean {
  // Ring-closure digits live outside brackets; strip bracket contents first.
  return /\d/.test(smiles.replace(/\[[^\]]+\]/g, ""));
}

/** Longest alkyl chain length from the canonical label, else the longest C-run in the SMILES. */
function chainLengthOf(ion: IonStructure): number {
  const label = ion.label;
  const im = label.match(/^\[C(\d{1,2})MIM\]$/i);
  if (im) return Number(im[1]);
  const pyr = label.match(/^\[Pyr1,(\d{1,2})\]$/i);
  if (pyr) return Number(pyr[1]);
  const tetra = label.match(/^\[[NP]([\d,]+)\]$/i);
  if (tetra) return Math.max(...tetra[1].split(",").map(Number));
  let longest = 0;
  for (const run of ion.smiles.match(/C+/g) ?? []) longest = Math.max(longest, run.length);
  return longest;
}

function emptyDescriptor(raw: string, kind: IonKind): IonDescriptor {
  return {
    key: normalizeIonKey(raw),
    label: raw.trim(),
    name: raw.trim(),
    family: "unknown",
    kind,
    resolved: false,
    heavyAtoms: 0,
    heavyMass: 0,
    nC: 0,
    nF: 0,
    nHetero: 0,
    fluorineFraction: 0,
    hasRing: false,
    chainLength: 0,
    mw: 0,
    nRot: 0,
    hbd: 0,
    hba: 0,
    tpsa: 0,
    balabanJ: 0,
    bertzCT: 0,
    logP: 0,
    radiusA: 0,
    qAmmonium: 0,
  };
}

function fromStructure(ion: IonStructure, kind: IonKind): IonDescriptor {
  const elements = smilesElements(ion.smiles);
  const heavyAtoms = elements.length;
  let heavyMass = 0;
  let nC = 0;
  let nF = 0;
  let nHetero = 0;
  for (const el of elements) {
    heavyMass += ATOMIC_MASS[el] ?? 0;
    if (el === "C") nC++;
    if (el === "F") nF++;
    if (HETERO.has(el)) nHetero++;
  }
  // The full molecular graph (implicit H, rings, bond orders) drives the
  // literature feature set; descriptors update automatically for ANY ion the
  // catalog can resolve, so new ionic liquids featurize as soon as they arrive.
  const graph = parseSmiles(ion.smiles);
  const { radiusA } = vdwVolumeAndRadius(graph);
  return {
    key: normalizeIonKey(ion.label),
    label: standardizeIonLabel(ion.label, kind),
    name: ion.name,
    family: ion.family,
    kind,
    resolved: true,
    heavyAtoms,
    heavyMass: Number(heavyMass.toFixed(3)),
    nC,
    nF,
    nHetero,
    fluorineFraction: heavyAtoms ? nF / heavyAtoms : 0,
    hasRing: hasRingClosure(ion.smiles),
    chainLength: chainLengthOf(ion),
    mw: molecularWeight(graph),
    nRot: rotatableBonds(graph),
    hbd: hBondDonors(graph),
    hba: hBondAcceptors(graph),
    tpsa: tpsa(graph),
    balabanJ: balabanJ(graph),
    bertzCT: bertzComplexity(graph),
    logP: logPApprox(graph),
    radiusA,
    qAmmonium: quaternaryAmmoniumCount(graph),
  };
}

/** Featurize a raw label (DB labels are non-canonical — resolution collapses spellings). */
export function describeIon(label: string | null | undefined, kind: IonKind): IonDescriptor {
  const raw = label?.trim() ?? "";
  if (!raw) return emptyDescriptor("", kind);
  const ion = resolveIonStructure(raw, kind);
  return ion ? fromStructure(ion, kind) : emptyDescriptor(raw, kind);
}

/* ------------------------------------------------------------------ */
/* Design-space vocabulary + descriptor normalization                  */
/* ------------------------------------------------------------------ */

/** Pattern chain lengths enumerated for the design space (beyond the curated set). */
const PATTERN_IMIDAZOLIUM_CHAINS = [1, 2, 3, 4, 5, 6, 7, 8, 10, 12];
const PATTERN_PYRROLIDINIUM_CHAINS = [2, 3, 4, 6, 8];

/**
 * The enumerable ion vocabulary: curated catalog + common pattern ions +
 * any extra labels (e.g. ions present in the dataset), deduplicated by key.
 */
export function ionVocabulary(kind: IonKind, extraLabels: string[] = []): IonDescriptor[] {
  const byKey = new Map<string, IonDescriptor>();
  const add = (d: IonDescriptor) => {
    if (d.resolved && d.key && !byKey.has(d.key)) byKey.set(d.key, d);
  };
  for (const ion of listCuratedIons(kind)) add(fromStructure(ion, kind));
  if (kind === "cation") {
    for (const n of PATTERN_IMIDAZOLIUM_CHAINS) add(describeIon(`[C${n}MIM]`, "cation"));
    for (const n of PATTERN_PYRROLIDINIUM_CHAINS) add(describeIon(`[Pyr1,${n}]`, "cation"));
  }
  for (const label of extraLabels) add(describeIon(label, kind));
  return [...byKey.values()].sort(
    (a, b) => a.family.localeCompare(b.family) || a.chainLength - b.chainLength || a.heavyMass - b.heavyMass
  );
}

/** Numeric features used in the distance metric, in a fixed order. */
export const NUMERIC_FEATURES = [
  "mw",
  "nC",
  "nF",
  "fluorineFraction",
  "nHetero",
  "chainLength",
  "nRot",
  "hbd",
  "hba",
  "tpsa",
  "balabanJ",
  "bertzCT",
  "logP",
  "radiusA",
  "qAmmonium",
] as const;
export type NumericFeature = (typeof NUMERIC_FEATURES)[number];

export interface FeatureNorm {
  min: Record<NumericFeature, number>;
  max: Record<NumericFeature, number>;
}

/**
 * Min-max ranges over the FULL vocabulary (not the dataset) so descriptor
 * scaling stays stable as records arrive.
 */
export function featureNorm(vocabulary: IonDescriptor[]): FeatureNorm {
  const min = {} as Record<NumericFeature, number>;
  const max = {} as Record<NumericFeature, number>;
  for (const f of NUMERIC_FEATURES) {
    min[f] = Infinity;
    max[f] = -Infinity;
    for (const ion of vocabulary) {
      min[f] = Math.min(min[f], ion[f]);
      max[f] = Math.max(max[f], ion[f]);
    }
    if (!Number.isFinite(min[f])) {
      min[f] = 0;
      max[f] = 1;
    }
  }
  return { min, max };
}

/** Mean absolute difference of min-max-scaled numeric features (0..1). */
export function normalizedFeatureDelta(a: IonDescriptor, b: IonDescriptor, norm: FeatureNorm): number {
  let sum = 0;
  for (const f of NUMERIC_FEATURES) {
    const span = norm.max[f] - norm.min[f];
    if (span <= 0) continue;
    sum += Math.abs(a[f] - b[f]) / span;
  }
  return sum / NUMERIC_FEATURES.length;
}
