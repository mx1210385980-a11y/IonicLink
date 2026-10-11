import { CanonizerUtil, Molecule } from "openchemlib";
import { resolveIonSmiles, type IonKind } from "./ionStructures";
import {
  isStructureSearchTarget,
  STRUCTURE_MODE_PARAM,
  STRUCTURE_SMILES_PARAM,
  STRUCTURE_TARGET_PARAM,
  structureSearchInputIssue,
  type ExactStructureFilter,
  type StructureSearchTarget,
} from "./structureSearch";

export const STRUCTURE_KEY_VERSION = "ocl-normal-v1";
export { MAX_STRUCTURE_SMILES_LENGTH } from "./structureSearch";
export const MAX_STRUCTURE_ATOMS = 256;

export class StructureSearchInputError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 413 = 400
  ) {
    super(message);
    this.name = "StructureSearchInputError";
  }
}

/**
 * Convert a complete, connected molecule/ion into a canonical graph identity.
 * The key deliberately includes an algorithm version so a future toolkit
 * upgrade can be rolled out by rebuilding the two indexed record columns.
 */
export function canonicalStructureKey(smiles: string): string {
  const source = smiles.trim();
  const issue = structureSearchInputIssue(source);
  if (issue) throw new StructureSearchInputError(issue.message, issue.status);

  try {
    // Keep the parser's stereo/coordinate pass: OpenChemLib needs it to
    // distinguish @/@@ configurations in the resulting canonical IDCode.
    const molecule = Molecule.fromSmiles(source);
    const atomCount = molecule.getAllAtoms();
    if (atomCount === 0) throw new StructureSearchInputError("Draw an ion structure first.");
    if (atomCount > MAX_STRUCTURE_ATOMS) {
      throw new StructureSearchInputError(`The structure exceeds ${MAX_STRUCTURE_ATOMS} atoms. Use a smaller query.`, 413);
    }

    for (let atom = 0; atom < atomCount; atom += 1) {
      if (molecule.getAtomicNo(atom) <= 0 || molecule.getAtomCustomLabel(atom)) {
        throw new StructureSearchInputError("Exact structure search does not support R-groups, pseudoatoms, or custom atom labels.");
      }
    }

    const idCode = CanonizerUtil.getIDCode(molecule, CanonizerUtil.NORMAL);
    if (!idCode) throw new StructureSearchInputError("Could not read the structure. Check its atoms, bonds, and charges.");
    return `${STRUCTURE_KEY_VERSION}:${idCode}`;
  } catch (error) {
    if (error instanceof StructureSearchInputError) throw error;
    throw new StructureSearchInputError("Invalid structure. Check its atoms, bonds, and formal charges.");
  }
}

export function createExactStructureFilter(
  smiles: string,
  target: StructureSearchTarget = "any"
): ExactStructureFilter {
  return { key: canonicalStructureKey(smiles), target };
}

export function parseExactStructureSearch(searchParams: URLSearchParams): ExactStructureFilter | undefined {
  const smiles = searchParams.get(STRUCTURE_SMILES_PARAM);
  const targetParam = searchParams.get(STRUCTURE_TARGET_PARAM);
  const mode = searchParams.get(STRUCTURE_MODE_PARAM);
  const hasAnyStructureParam = smiles !== null || targetParam !== null || mode !== null;
  if (!hasAnyStructureParam) return undefined;
  if (!smiles?.trim()) throw new StructureSearchInputError("structureSmiles must not be empty.");
  if (mode !== null && mode !== "exact") {
    throw new StructureSearchInputError("structureMode currently supports exact only.");
  }
  const target = targetParam ?? "any";
  if (!isStructureSearchTarget(target)) {
    throw new StructureSearchInputError("structureTarget must be any, cation, or anion.");
  }
  return createExactStructureFilter(smiles, target);
}

type StructureRecord = {
  core?: {
    ionicLiquid?: {
      cation?: string;
      anion?: string;
      cationSmiles?: string;
      anionSmiles?: string;
    };
  };
};

/** Record ingestion is tolerant: a bad optional SMILES leaves the row unindexed. */
export function recordStructureKey(record: StructureRecord, kind: IonKind): string | null {
  const ionicLiquid = record.core?.ionicLiquid;
  const explicit = ionicLiquid?.[`${kind}Smiles`]?.trim();
  const fallback = resolveIonSmiles(ionicLiquid?.[kind], kind);
  const smiles = explicit || fallback;
  if (!smiles) return null;
  try {
    return canonicalStructureKey(smiles);
  } catch {
    return null;
  }
}
