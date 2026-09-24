export type IonKind = "cation" | "anion";

export interface IonStructure {
  label: string;
  smiles: string;
  name: string;
  family: string;
  charge: "+" | "-";
  source: "curated" | "pattern";
}

interface CuratedIon extends Omit<IonStructure, "source"> {
  aliases: string[];
}

const MAX_PATTERN_CHAIN = 24;
const SUBSCRIPT_DIGITS = "₀₁₂₃₄₅₆₇₈₉";

const CURATED_CATIONS: CuratedIon[] = [
  imidazolium(1, "1,3-dimethylimidazolium", ["[MMIM]", "[C1MIM]"]),
  imidazolium(2, "1-ethyl-3-methylimidazolium", ["[EMIM]", "[C2MIM]"]),
  imidazolium(3, "1-propyl-3-methylimidazolium", ["[PMIM]", "[C3MIM]"]),
  imidazolium(4, "1-butyl-3-methylimidazolium", ["[BMIM]", "[C4MIM]"]),
  imidazolium(6, "1-hexyl-3-methylimidazolium", ["[HMIM]", "[C6MIM]"]),
  imidazolium(8, "1-octyl-3-methylimidazolium", ["[OMIM]", "[C8MIM]"]),
  pyrrolidinium(2, "1-ethyl-1-methylpyrrolidinium", ["[PYR12]", "[Pyr1,2]", "[Py1,2]"]),
  pyrrolidinium(3, "1-propyl-1-methylpyrrolidinium", ["[PYR13]", "[Pyr1,3]", "[Py1,3]"]),
  pyrrolidinium(4, "1-butyl-1-methylpyrrolidinium", ["[BMPyr]", "[PYR14]", "[Pyr1,4]", "[Py1,4]"]),
  cation("CC[NH3+]", "ethylammonium", "ammonium", ["[EA]"]),
  cation("CCC[NH3+]", "propylammonium", "ammonium", ["[PA]", "[PAN]"]),
  cation("OCC[NH3+]", "ethanolammonium", "hydroxyalkyl ammonium", ["[EtA]"]),
  cation("[NH+](C)(C)CC", "dimethylethylammonium", "ammonium", ["[DMEA]"]),
  cation("[Li+]OCCOCCOCCOCCOC", "lithium tetraglyme complex", "solvate ionic liquid", ["[Li(G4)]"]),
  cation("CCCCC[n+]1ccccc1", "1-pentylpyridinium", "pyridinium", ["[C5Py]"]),
  cation("OCCC[n+]1ccccc1", "1-(3-hydroxypropyl)pyridinium", "hydroxyalkyl pyridinium", ["[HOC3Py]"]),
  cation("OCCCC[n+]1ccccc1", "1-(4-hydroxybutyl)pyridinium", "hydroxyalkyl pyridinium", ["[HOC4Py]"]),
  cation("OCCC[N+]1(C)CCCCC1", "1-(3-hydroxypropyl)methylpiperidinium", "hydroxyalkyl piperidinium", ["[HOC3MPip]"]),
  cation("OCCCC[N+]1(C)CCCCC1", "1-(4-hydroxybutyl)methylpiperidinium", "hydroxyalkyl piperidinium", ["[HOC4MPip]"]),
  cation("Cn1cc[n+](CCCCCCCCCC[n+]2ccn(C)c2)c1", "1,1'-(decane-1,10-diyl)bis(3-methylimidazolium)", "dicationic imidazolium", [
    "[C10(C1Im)2]",
  ]),
];

const CURATED_ANIONS: CuratedIon[] = [
  anion("[F-]", "fluoride", "halide", ["[F]", "[F-]", "fluoride"]),
  anion("[Cl-]", "chloride", "halide", ["[Cl]", "[Cl-]", "chloride"]),
  anion("[Br-]", "bromide", "halide", ["[Br]", "[Br-]", "bromide"]),
  anion("[I-]", "iodide", "halide", ["[I]", "[I-]", "iodide"]),
  anion("[B-](F)(F)(F)F", "tetrafluoroborate", "fluoroborate", ["[BF4]", "[BF4-]", "BF4"]),
  anion("[P-](F)(F)(F)(F)(F)F", "hexafluorophosphate", "fluorophosphate", ["[PF6]", "[PF6-]", "PF6"]),
  anion(
    "C(C(F)(F)[P-](C(C(F)(F)F)(F)F)(C(C(F)(F)F)(F)F)(F)(F)F)(F)(F)F",
    "tris(pentafluoroethyl)trifluorophosphate",
    "fluoroalkyl phosphate",
    ["[FAP]", "FAP", "tris(pentafluoroethyl)trifluorophosphate"]
  ),
  anion(
    "[N-](S(=O)(=O)C(F)(F)F)S(=O)(=O)C(F)(F)F",
    "bis(trifluoromethylsulfonyl)imide",
    "sulfonylimide",
    ["[NTf2]", "[Tf2N]", "[TFSI]", "bis(trifluoromethylsulfonyl)imide"]
  ),
  anion("[N-](S(=O)(=O)F)S(=O)(=O)F", "bis(fluorosulfonyl)imide", "sulfonylimide", ["[FSI]", "[NFSI]"]),
  anion("C(F)(F)(F)S(=O)(=O)[O-]", "triflate", "sulfonate", ["[OTf]", "[TfO]", "[CF3SO3]", "triflate"]),
  anion("[N-](C#N)C#N", "dicyanamide", "cyanamide", ["[DCA]", "[N(CN)2]", "dicyanamide"]),
  anion("[S-]C#N", "thiocyanate", "pseudohalide", ["[SCN]", "thiocyanate"]),
  anion("[O-][N+](=O)[O-]", "nitrate", "oxoanion", ["[NO3]", "nitrate"]),
  anion("[B-](C#N)(C#N)(C#N)C#N", "tetracyanoborate", "cyanoborate", ["[B(CN)4]", "[TCB]"]),
  anion("[C-](C#N)(C#N)C#N", "tricyanomethanide", "cyanocarbon", ["[TCM]", "[C(CN)3]"]),
  anion("CC(=O)[O-]", "acetate", "carboxylate", ["[OAc]", "[Ac]", "[CH3COO]", "acetate"]),
  anion("C(=O)[O-]", "formate", "carboxylate", ["[Formate]", "formate"]),
  anion("COS(=O)(=O)[O-]", "methyl sulfate", "sulfate", ["[MeSO4]", "[MSO4]"]),
  anion("CCOS(=O)(=O)[O-]", "ethyl sulfate", "sulfate", ["[EtSO4]", "[ESO4]"]),
  anion("CS(=O)(=O)[O-]", "methanesulfonate", "sulfonate", ["[OMs]", "[MsO]", "mesylate", "methanesulfonate"]),
  anion("OS(=O)(=O)[O-]", "hydrogen sulfate", "sulfate", ["[HSO4]", "hydrogen sulfate"]),
  anion("O=Cl(=O)(=O)[O-]", "perchlorate", "oxoanion", ["[ClO4]", "perchlorate"]),
  anion("COP(=O)([O-])OC", "dimethyl phosphate", "phosphate", ["[DMP]", "dimethyl phosphate"]),
  anion("CCOP(=O)([O-])OCC", "diethyl phosphate", "phosphate", ["[DEP]", "diethyl phosphate"]),
  anion(
    "CCCCC(CC)COP(=O)([O-])OCC(CC)CCCC",
    "bis(2-ethylhexyl) phosphate",
    "phosphate",
    ["[DEHP]", "DEHP", "[BEHP]", "bis(2-ethylhexyl) phosphate", "bis(2-ethylhexyl)phosphate"]
  ),
  anion(
    "CCCCC(CC)COC(=O)CC(C(=O)OCC(CC)CCCC)S(=O)(=O)[O-]",
    "bis(2-ethylhexyl) sulfosuccinate",
    "sulfosuccinate",
    ["[AOT]", "AOT", "[DS]", "[Doc]", "docusate", "bis(2-ethylhexyl) sulfosuccinate"]
  ),
  anion("[B-]12(OC(C(=O)O1)c1ccccc1)OC(C(=O)O2)c1ccccc1", "bis(mandelato)borate", "borate", ["[BMB]", "BMB"]),
  anion("[B-]12(OC(C(=O)O1)c1ccccc1O)OC(C(=O)O2)c1ccccc1O", "bis(salicylato)borate", "borate", ["[BScB]", "BScB"]),
  anion("[B-]12(OC(=O)C(=O)O1)OC(=O)C(=O)O2", "bis(oxalato)borate", "borate", ["[BOB]", "BOB"]),
];

const CATION_ALIASES = buildAliasMap(CURATED_CATIONS);
const ANION_ALIASES = buildAliasMap(CURATED_ANIONS);

export function resolveIonSmiles(label: string | null | undefined, kind?: IonKind): string | undefined {
  return resolveIonStructure(label, kind)?.smiles;
}

/**
 * The curated catalog as plain structures (aliases dropped) — the enumerable
 * half of the design space for the prediction module. Pattern ions (CnMIM,
 * Pyr1,n, tetraalkyl N/P) are generated separately by the caller.
 */
export function listCuratedIons(kind: IonKind): IonStructure[] {
  const list = kind === "cation" ? CURATED_CATIONS : CURATED_ANIONS;
  return list.map(({ aliases: _aliases, ...ion }) => ({ ...ion, source: "curated" as const }));
}

export function resolveIonStructure(label: string | null | undefined, kind?: IonKind): IonStructure | null {
  const key = normalizeIonKey(label);
  if (!key) return null;

  if (!kind || kind === "cation") {
    const exact = CATION_ALIASES.get(key);
    if (exact) return exact;
    const patterned = resolvePatternCation(key);
    if (patterned) return patterned;
  }

  if (!kind || kind === "anion") {
    const exact = ANION_ALIASES.get(key);
    if (exact) return exact;
    const patterned = resolvePatternAnion(key);
    if (patterned) return patterned;
  }

  return null;
}

export function standardizeIonLabel(label: string | null | undefined, kind?: IonKind): string {
  return subscriptDigits(standardizeIonFormula(label, kind));
}

export function standardizeIonFormula(label: string | null | undefined, kind?: IonKind): string {
  const raw = label?.trim() ?? "";
  if (!raw) return "";
  const resolved = resolveIonStructure(raw, kind);
  return resolved?.label ?? raw;
}

export function normalizeIonKey(label: string | null | undefined): string {
  return stripOuterIonSyntax(label).replace(/[^a-z0-9]/g, "");
}

function subscriptDigits(label: string): string {
  return label.replace(/iC/g, "ⁱC").replace(/\d/g, (digit) => SUBSCRIPT_DIGITS[Number(digit)] ?? digit);
}

function buildAliasMap(ions: CuratedIon[]): Map<string, IonStructure> {
  const map = new Map<string, IonStructure>();
  for (const ion of ions) {
    const structure: IonStructure = { ...ion, source: "curated" };
    for (const alias of [ion.label, ion.name, ...ion.aliases]) {
      map.set(normalizeIonKey(alias), structure);
    }
  }
  return map;
}

function resolvePatternCation(key: string): IonStructure | null {
  const imidazoliumMatch = key.match(/^c(\d{1,2})(?:mim|c1im)$/);
  if (imidazoliumMatch) {
    const n = Number(imidazoliumMatch[1]);
    if (validChain(n)) return { ...imidazolium(n, `1-${alkylName(n)}-3-methylimidazolium`, []), source: "pattern" };
  }

  const pyrrolidiniumMatch = key.match(/^pyr1(\d{1,2})$/);
  if (pyrrolidiniumMatch) {
    const n = Number(pyrrolidiniumMatch[1]);
    if (validChain(n)) return { ...pyrrolidinium(n, `1-${alkylName(n)}-1-methylpyrrolidinium`, []), source: "pattern" };
  }

  const phosphonium = parseTetraalkylIon(key, "p");
  if (phosphonium) return tetraalkyl("P", phosphonium);

  const ammonium = parseTetraalkylIon(key, "n");
  if (ammonium) return tetraalkyl("N", ammonium);

  return null;
}

function resolvePatternAnion(key: string): IonStructure | null {
  if (key === "pan") {
    return {
      charge: "-",
      family: "oxoanion",
      label: "[NO3]",
      name: "nitrate",
      smiles: "[O-][N+](=O)[O-]",
      source: "pattern",
    };
  }

  if (key === "ic82po2") {
    return {
      charge: "-",
      family: "phosphinate",
      label: "[(iC8)2PO2]",
      name: "bis(2,4,4-trimethylpentyl)phosphinate",
      smiles: "CC(C)CC(C)(C)CP(=O)([O-])CC(C)CC(C)(C)C",
      source: "pattern",
    };
  }

  const alkylBmbMatch = key.match(/^a(4|8|12)bmb$/);
  if (alkylBmbMatch) {
    const chainLength = Number(alkylBmbMatch[1]);
    const chain = carbonChain(chainLength);
    return {
      charge: "-",
      family: "alkyl bis(mandelato)borate",
      label: `[A${chainLength}BMB]`,
      name: `bis(${alkylName(chainLength)}-substituted mandelato)borate`,
      smiles: `[B-]12(OC(C(=O)O1)c1ccc(${chain})cc1)OC(C(=O)O2)c1ccc(${chain})cc1`,
      source: "pattern",
    };
  }

  return null;
}

function stripOuterIonSyntax(label: string | null | undefined): string {
  if (!label) return "";
  return label
    .trim()
    .replace(/ⁱ/g, "i")
    .replace(/[₀-₉]/g, (ch) => "₀₁₂₃₄₅₆₇₈₉".indexOf(ch).toString())
    .replace(/[−–—]/g, "-")
    .replace(/^[\[\(\{]+/, "")
    .replace(/[\]\)\}]+$/, "")
    .replace(/(?:\+|-|⁺|⁻)+$/g, "")
    .toLowerCase();
}

function parseTetraalkylIon(key: string, prefix: "p" | "n"): number[] | null {
  if (!key.startsWith(prefix)) return null;
  const tail = key.slice(1);
  const parts = tail.includes(",") ? tail.split(",") : tail.match(/\d+/g);
  if (parts && parts.length === 4) {
    const chains = parts.map(Number);
    return chains.every(validChain) ? chains : null;
  }

  if (/^\d{4}$/.test(tail)) return tail.split("").map(Number);
  if (/^\d{5}$/.test(tail)) {
    const chains = [Number(tail[0]), Number(tail[1]), Number(tail[2]), Number(tail.slice(3))];
    return chains.every(validChain) ? chains : null;
  }

  return null;
}

function imidazolium(chainLength: number, name: string, aliases: string[]): CuratedIon {
  return {
    aliases,
    charge: "+",
    family: "imidazolium",
    label: `[C${chainLength}MIM]`,
    name,
    smiles: `${carbonChain(chainLength)}n1cc[n+](C)c1`,
  };
}

function pyrrolidinium(chainLength: number, name: string, aliases: string[]): CuratedIon {
  return {
    aliases,
    charge: "+",
    family: "pyrrolidinium",
    label: `[Pyr1,${chainLength}]`,
    name,
    smiles: `${carbonChain(chainLength)}[N+]1(C)CCCC1`,
  };
}

function tetraalkyl(atom: "N" | "P", chains: number[]): IonStructure {
  const family = atom === "N" ? "ammonium" : "phosphonium";
  const [a, b, c, d] = chains.map(carbonChain);
  return {
    charge: "+",
    family,
    label: `[${atom}${chains.join(",")}]`,
    name: `tetraalkyl${family}`,
    smiles: `[${atom}+](${a})(${b})(${c})${d}`,
    source: "pattern",
  };
}

function cation(smiles: string, name: string, family: string, aliases: string[]): CuratedIon {
  return { aliases, charge: "+", family, label: aliases[0] ?? name, name, smiles };
}

function anion(smiles: string, name: string, family: string, aliases: string[]): CuratedIon {
  return { aliases, charge: "-", family, label: aliases[0] ?? name, name, smiles };
}

function carbonChain(length: number): string {
  return "C".repeat(length);
}

function validChain(n: number): boolean {
  return Number.isInteger(n) && n >= 1 && n <= MAX_PATTERN_CHAIN;
}

function alkylName(n: number): string {
  return (
    [
      "",
      "methyl",
      "ethyl",
      "propyl",
      "butyl",
      "pentyl",
      "hexyl",
      "heptyl",
      "octyl",
      "nonyl",
      "decyl",
      "undecyl",
      "dodecyl",
    ][n] ?? `C${n} alkyl`
  );
}
