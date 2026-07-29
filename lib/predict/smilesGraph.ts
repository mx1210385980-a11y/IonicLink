/**
 * Minimal molecular-graph layer: SMILES → atoms/bonds/rings with implicit-H
 * perception, plus the literature descriptors the prediction engine uses
 * (MW, rotatable bonds, H-bond donors/acceptors, TPSA, Balaban J, a
 * Bertz-style complexity index, a fragment-additive logP estimate, a van der
 * Waals radius, and the quaternary-ammonium count).
 *
 * Zero dependencies by design. Where an RDKit descriptor needs a large
 * parameter table (MolLogP/BertzCT) we compute an explicitly-labeled
 * APPROXIMATION — these features feed a similarity metric, where internal
 * consistency matters more than absolute fidelity, but they are never
 * presented as the canonical RDKit values.
 *
 * Implicit hydrogens follow the SMILES spec: bracket atoms carry ONLY the H
 * written in the bracket; organic-subset atoms fill their lowest valence
 * (aromatic n/o/s/p → 0 H, aromatic c → 3 − connections). Validated against
 * known formulas in smilesGraph.test.ts (BMIM C₈H₁₅N₂⁺, Pyr₁,₄ C₉H₂₀N⁺, …).
 */

export interface GraphAtom {
  el: string;
  aromatic: boolean;
  charge: number;
  /** Implicit + bracket-explicit hydrogens. */
  hCount: number;
  inRing: boolean;
  /** Indices of bonded heavy atoms. */
  neighbors: number[];
}

export interface GraphBond {
  a: number;
  b: number;
  /** 1 / 2 / 3; aromatic bonds are order 1 with aromatic=true. */
  order: number;
  aromatic: boolean;
  inRing: boolean;
}

export interface MolGraph {
  atoms: GraphAtom[];
  bonds: GraphBond[];
  /** Cyclomatic ring count (bonds − atoms + 1 for a connected graph). */
  ringCount: number;
  aromaticRingAtomCount: number;
}

const ATOMIC_MASS: Record<string, number> = {
  H: 1.008, B: 10.811, C: 12.011, N: 14.007, O: 15.999, F: 18.998,
  Si: 28.085, P: 30.974, S: 32.06, Cl: 35.45, Br: 79.904, I: 126.904,
};

/** Allowed valence lists for implicit-H filling (organic subset). */
const VALENCES: Record<string, number[]> = {
  B: [3], C: [4], N: [3, 5], O: [2], P: [3, 5], S: [2, 4, 6],
  F: [1], Cl: [1], Br: [1], I: [1], Si: [4],
};

/* ------------------------------------------------------------------ */
/* Parser                                                              */
/* ------------------------------------------------------------------ */

export function parseSmiles(smiles: string): MolGraph {
  const atoms: GraphAtom[] = [];
  const bonds: GraphBond[] = [];
  const stack: number[] = [];
  const ringOpen = new Map<string, { atom: number; order: number }>();
  let prev = -1;
  let pendingOrder = 0; // 0 = default

  const addAtom = (el: string, aromatic: boolean, charge: number, hExplicit: number | null): number => {
    atoms.push({ el, aromatic, charge, hCount: hExplicit ?? -1, inRing: false, neighbors: [] });
    return atoms.length - 1;
  };
  const addBond = (a: number, b: number, order: number) => {
    const aromatic = order === 0 && atoms[a].aromatic && atoms[b].aromatic;
    bonds.push({ a, b, order: order || 1, aromatic, inRing: false });
    atoms[a].neighbors.push(b);
    atoms[b].neighbors.push(a);
  };

  let i = 0;
  while (i < smiles.length) {
    const ch = smiles[i];
    if (ch === "(") {
      stack.push(prev);
      i++;
    } else if (ch === ")") {
      prev = stack.pop() ?? -1;
      i++;
    } else if (ch === "-" || ch === "/" || ch === "\\") {
      pendingOrder = 1;
      i++;
    } else if (ch === "=") {
      pendingOrder = 2;
      i++;
    } else if (ch === "#") {
      pendingOrder = 3;
      i++;
    } else if (ch === ":") {
      pendingOrder = 0;
      i++;
    } else if (/\d/.test(ch) || ch === "%") {
      const key = ch === "%" ? smiles.slice(i + 1, i + 3) : ch;
      i += ch === "%" ? 3 : 1;
      const open = ringOpen.get(key);
      if (open) {
        addBond(open.atom, prev, pendingOrder || open.order);
        ringOpen.delete(key);
      } else {
        ringOpen.set(key, { atom: prev, order: pendingOrder });
      }
      pendingOrder = 0;
    } else if (ch === "[") {
      const close = smiles.indexOf("]", i);
      const body = smiles.slice(i + 1, close);
      const m = body.match(/^(\d+)?([A-Z][a-z]?|[a-z])(@{1,2})?(H\d?)?([+-]\d?|[+]+|[-]+)?/);
      if (!m) throw new Error(`unparseable bracket atom [${body}] in ${smiles}`);
      const sym = m[2];
      const aromatic = sym === sym.toLowerCase();
      const el = aromatic ? sym.charAt(0).toUpperCase() + sym.slice(1) : sym;
      const h = m[4] ? (m[4].length > 1 ? Number(m[4].slice(1)) : 1) : 0;
      let charge = 0;
      if (m[5]) {
        const c = m[5];
        if (/\d/.test(c)) charge = (c.startsWith("-") ? -1 : 1) * Number(c.slice(1));
        else charge = (c[0] === "-" ? -1 : 1) * c.length;
      }
      const idx = addAtom(el, aromatic, charge, h);
      if (prev >= 0) addBond(prev, idx, pendingOrder);
      prev = idx;
      pendingOrder = 0;
      i = close + 1;
    } else {
      // organic subset: two-letter first
      let sym = "";
      if (smiles.startsWith("Cl", i)) sym = "Cl";
      else if (smiles.startsWith("Br", i)) sym = "Br";
      else if (smiles.startsWith("Si", i)) sym = "Si";
      else if (/[BCNOPSFI]/.test(ch)) sym = ch;
      else if (/[bcnops]/.test(ch)) sym = ch;
      else throw new Error(`unexpected character "${ch}" in ${smiles}`);
      const aromatic = sym === sym.toLowerCase();
      const el = aromatic ? sym.toUpperCase() : sym;
      const idx = addAtom(el, aromatic, 0, null);
      if (prev >= 0) addBond(prev, idx, pendingOrder);
      prev = idx;
      pendingOrder = 0;
      i += sym.length;
    }
  }

  // Ring membership: iteratively strip degree-1 atoms; what remains is cyclic.
  const degree = atoms.map((a) => a.neighbors.length);
  const removed = atoms.map(() => false);
  let changed = true;
  while (changed) {
    changed = false;
    for (let k = 0; k < atoms.length; k++) {
      if (!removed[k] && degree[k] <= 1) {
        removed[k] = true;
        changed = true;
        for (const n of atoms[k].neighbors) if (!removed[n]) degree[n]--;
      }
    }
  }
  for (let k = 0; k < atoms.length; k++) atoms[k].inRing = !removed[k];
  for (const b of bonds) b.inRing = atoms[b.a].inRing && atoms[b.b].inRing;

  // Implicit hydrogens for organic-subset atoms (hCount === -1 sentinel).
  for (let k = 0; k < atoms.length; k++) {
    const atom = atoms[k];
    if (atom.hCount !== -1) continue; // bracket atom: only explicit H
    if (atom.aromatic) {
      if (atom.el === "C") atom.hCount = Math.max(0, 3 - atom.neighbors.length);
      else atom.hCount = 0; // aromatic n/o/s/p carry no implicit H (pyrrole needs [nH])
      continue;
    }
    let bondSum = 0;
    for (const b of bonds) if (b.a === k || b.b === k) bondSum += b.order;
    const valences = VALENCES[atom.el] ?? [bondSum];
    const v = valences.find((x) => x >= bondSum) ?? bondSum;
    atom.hCount = Math.max(0, v - bondSum);
  }

  const ringCount = Math.max(0, bonds.length - atoms.length + 1);
  return {
    atoms,
    bonds,
    ringCount,
    aromaticRingAtomCount: atoms.filter((a) => a.aromatic && a.inRing).length,
  };
}

/* ------------------------------------------------------------------ */
/* Descriptors                                                         */
/* ------------------------------------------------------------------ */

/** Molecular weight including implicit hydrogens (g/mol). */
export function molecularWeight(g: MolGraph): number {
  let mw = 0;
  for (const a of g.atoms) mw += (ATOMIC_MASS[a.el] ?? 0) + a.hCount * ATOMIC_MASS.H;
  return Number(mw.toFixed(3));
}

/** Rotatable bonds: acyclic single non-aromatic bonds between non-terminal heavy atoms, excluding bonds adjacent to triples. */
export function rotatableBonds(g: MolGraph): number {
  const tripleAtoms = new Set<number>();
  for (const b of g.bonds) if (b.order === 3) { tripleAtoms.add(b.a); tripleAtoms.add(b.b); }
  let n = 0;
  for (const b of g.bonds) {
    if (b.order !== 1 || b.aromatic || b.inRing) continue;
    if (g.atoms[b.a].neighbors.length < 2 || g.atoms[b.b].neighbors.length < 2) continue;
    if (tripleAtoms.has(b.a) || tripleAtoms.has(b.b)) continue;
    n++;
  }
  return n;
}

/** Lipinski H-bond donors: N or O bearing at least one H. */
export function hBondDonors(g: MolGraph): number {
  return g.atoms.filter((a) => (a.el === "N" || a.el === "O") && a.hCount > 0).length;
}

/** Lipinski H-bond acceptors: every N and O. */
export function hBondAcceptors(g: MolGraph): number {
  return g.atoms.filter((a) => a.el === "N" || a.el === "O").length;
}

/** Quaternary ammonium nitrogens: non-aromatic N⁺ with four heavy-atom bonds and no H. */
export function quaternaryAmmoniumCount(g: MolGraph): number {
  return g.atoms.filter(
    (a) => a.el === "N" && a.charge > 0 && !a.aromatic && a.neighbors.length === 4 && a.hCount === 0
  ).length;
}

/**
 * Topological polar surface area, Ertl-style (Å²). Covers the N/O/S/P
 * environments in the ion catalog; charged types without a published Ertl
 * entry map to the nearest neutral analog — a documented approximation that
 * keeps the feature deterministic and comparable across ions.
 */
export function tpsa(g: MolGraph): number {
  let area = 0;
  for (let k = 0; k < g.atoms.length; k++) {
    const a = g.atoms[k];
    if (a.el !== "N" && a.el !== "O" && a.el !== "S" && a.el !== "P") continue;
    const deg = a.neighbors.length;
    let dbl = 0;
    let trp = 0;
    for (const b of g.bonds) {
      if (b.a !== k && b.b !== k) continue;
      if (!b.aromatic && b.order === 2) dbl++;
      if (!b.aromatic && b.order === 3) trp++;
    }
    if (a.el === "N") {
      if (a.aromatic) {
        // imidazolium pair: substituted neutral n 4.93 + substituted n⁺ 3.88 → 8.81 (matches PubChem BMIM 8.8)
        if (a.charge > 0) area += deg >= 3 ? 3.88 : 4.10;
        else if (deg >= 3) area += 4.93;
        else area += a.hCount > 0 ? 15.79 : 12.89;
      } else if (a.charge > 0) {
        area += a.hCount > 0 ? 16.61 : 0.0; // R4N⁺ is non-polar in Ertl's scheme
      } else if (trp > 0) {
        area += 23.79;
      } else if (dbl > 0) {
        area += a.hCount > 0 ? 23.85 : 12.36;
      } else {
        // amine / amide N (charged amide anions map to the neutral analog)
        area += a.hCount >= 2 ? 26.02 : a.hCount === 1 ? 12.03 : 3.24;
      }
    } else if (a.el === "O") {
      if (a.aromatic) area += 13.14;
      else if (a.charge < 0) area += 23.06;
      else if (dbl > 0) area += 17.07;
      else area += a.hCount > 0 ? 20.23 : 9.23;
    } else if (a.el === "S") {
      if (a.aromatic) area += 28.24;
      else if (a.charge < 0) area += 38.8; // thiolate → SH analog
      else if (dbl >= 2) area += 8.38; // sulfonyl
      else if (dbl === 1) area += 19.21;
      else area += a.hCount > 0 ? 38.8 : 25.3;
    } else if (a.el === "P") {
      if (dbl > 0) area += 9.81;
      else if (deg >= 4) area += 0.0; // R4P⁺ / PF6⁻ phosphorus: non-polar center
      else area += 13.59;
    }
  }
  return Number(area.toFixed(2));
}

/** All-pairs shortest paths (BFS per atom — graphs here are ≤ ~60 atoms). */
function distanceMatrix(g: MolGraph): number[][] {
  const n = g.atoms.length;
  const dist = Array.from({ length: n }, () => new Array<number>(n).fill(Infinity));
  for (let s = 0; s < n; s++) {
    dist[s][s] = 0;
    const queue = [s];
    while (queue.length) {
      const u = queue.shift() as number;
      for (const v of g.atoms[u].neighbors) {
        if (dist[s][v] === Infinity) {
          dist[s][v] = dist[s][u] + 1;
          queue.push(v);
        }
      }
    }
  }
  return dist;
}

/** Balaban J index — exact graph computation (J = m/(μ+1) · Σ_edges (s_a·s_b)^(−½)). */
export function balabanJ(g: MolGraph): number {
  const n = g.atoms.length;
  if (n < 2) return 0;
  const dist = distanceMatrix(g);
  const s = dist.map((row) => row.reduce((acc, d) => acc + (Number.isFinite(d) ? d : 0), 0));
  const m = g.bonds.length;
  const mu = m - n + 1;
  let sum = 0;
  for (const b of g.bonds) {
    if (s[b.a] > 0 && s[b.b] > 0) sum += 1 / Math.sqrt(s[b.a] * s[b.b]);
  }
  return Number(((m / (mu + 1)) * sum).toFixed(4));
}

/**
 * Bertz-style complexity (approximation): information content over
 * "connections" (adjacent bond pairs) classified by element+degree, plus the
 * heteroatom-distribution term. Tracks the original BertzCT's ordering for
 * molecules of growing size/branching; not the RDKit value.
 */
export function bertzComplexity(g: MolGraph): number {
  const degrees = g.atoms.map((a) => a.neighbors.length);
  const pairs = degrees.reduce((acc, d) => acc + (d * (d - 1)) / 2, 0) + g.bonds.length;
  if (pairs === 0) return 0;
  const classes = new Map<string, number>();
  for (let k = 0; k < g.atoms.length; k++) {
    const a = g.atoms[k];
    const key = `${a.el}|${degrees[k]}|${a.aromatic ? 1 : 0}`;
    classes.set(key, (classes.get(key) ?? 0) + 1);
  }
  let info = 0;
  for (const count of classes.values()) info += count * Math.log2(count);
  const nAtoms = g.atoms.length;
  return Number((2 * pairs * Math.log2(pairs) - info - nAtoms * Math.log2(Math.max(1, nAtoms)) / 2).toFixed(2));
}

/**
 * Fragment-additive logP ESTIMATE (Hansch-style increments — explicitly not
 * Crippen MolLogP). Hydrophobic chains raise it; polar/charged centers sink it.
 */
export function logPApprox(g: MolGraph): number {
  // O atoms double-bonded to S (sulfonyl) are far less hydrophilic than
  // ether/carbonyl O — π(SO2CF3) is in fact mildly positive as a substituent.
  const sulfonylO = new Set<number>();
  for (const b of g.bonds) {
    if (b.order !== 2 || b.aromatic) continue;
    const [x, y] = [g.atoms[b.a], g.atoms[b.b]];
    if (x.el === "S" && y.el === "O") sulfonylO.add(b.b);
    if (y.el === "S" && x.el === "O") sulfonylO.add(b.a);
  }
  let v = 0;
  for (let k = 0; k < g.atoms.length; k++) {
    const a = g.atoms[k];
    if (a.el === "C") {
      if (a.aromatic) v += 0.29;
      else v += 0.2 + 0.12 * a.hCount; // CH3 0.56, CH2 0.44, CH 0.32, quaternary 0.2
    } else if (a.el === "F") v += 0.25; // fluorous fragments (CF3 ≈ +0.88 net with the carbon)
    else if (a.el === "Cl") v += 0.71;
    else if (a.el === "Br") v += 0.86;
    else if (a.el === "I") v += 1.12;
    else if (a.el === "N") v += a.aromatic ? -0.5 : -0.9;
    else if (a.el === "O") v += sulfonylO.has(k) ? -0.15 : -0.6;
    else if (a.el === "S") v += -0.3;
    else if (a.el === "P") v += -0.5;
    else if (a.el === "B") v += -0.2;
    v += a.charge !== 0 ? -2.0 : 0; // formal charge: strong hydrophilicity
  }
  return Number(v.toFixed(2));
}

// Zhao–Abraham–Zissimos atomic vdW volume contributions (Å³); B estimated from Bondi.
const VDW_VOLUME: Record<string, number> = {
  H: 7.24, C: 20.58, N: 15.6, O: 14.71, F: 13.31, Cl: 22.45, Br: 26.52,
  I: 32.52, P: 24.43, S: 24.43, Si: 38.79, B: 18.32,
};

/** Van der Waals volume (Zhao et al. 2003) in Å³, and the equivalent-sphere radius in Å. */
export function vdwVolumeAndRadius(g: MolGraph): { volumeA3: number; radiusA: number } {
  let v = 0;
  let totalAtoms = 0;
  for (const a of g.atoms) {
    v += (VDW_VOLUME[a.el] ?? 20) + a.hCount * VDW_VOLUME.H;
    totalAtoms += 1 + a.hCount;
  }
  const nBonds = totalAtoms - 1 + g.ringCount; // H atoms each add one bond
  const aromaticRings = g.aromaticRingAtomCount >= 5 ? Math.round(g.aromaticRingAtomCount / 5) : 0;
  const nonAromaticRings = Math.max(0, g.ringCount - aromaticRings);
  v -= 5.92 * nBonds + 14.7 * aromaticRings + 3.8 * nonAromaticRings;
  const volumeA3 = Number(Math.max(10, v).toFixed(1));
  const radiusA = Number(Math.cbrt((3 * volumeA3) / (4 * Math.PI)).toFixed(3));
  return { volumeA3, radiusA };
}
