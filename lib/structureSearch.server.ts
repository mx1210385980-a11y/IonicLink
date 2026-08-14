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
    if (atomCount === 0) throw new StructureSearchInputError("请先绘制一个离子结构。");
    if (atomCount > MAX_STRUCTURE_ATOMS) {
      throw new StructureSearchInputError(`结构超过 ${MAX_STRUCTURE_ATOMS} 个原子，请缩小查询范围。`, 413);
    }

    for (let atom = 0; atom < atomCount; atom += 1) {
      if (molecule.getAtomicNo(atom) <= 0 || molecule.getAtomCustomLabel(atom)) {
        throw new StructureSearchInputError("精确结构搜索不支持 R 基、伪原子或自定义原子标签。");
      }
    }

    const idCode = CanonizerUtil.getIDCode(molecule, CanonizerUtil.NORMAL);
    if (!idCode) throw new StructureSearchInputError("未能读取该结构，请检查原子、键和电荷。");
    return `${STRUCTURE_KEY_VERSION}:${idCode}`;
  } catch (error) {
    if (error instanceof StructureSearchInputError) throw error;
    throw new StructureSearchInputError("结构式无效，请检查原子、键和形式电荷。");
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
  if (!smiles?.trim()) throw new StructureSearchInputError("structureSmiles 不能为空。");
  if (mode !== null && mode !== "exact") {
    throw new StructureSearchInputError("structureMode 当前仅支持 exact。");
  }
  const target = targetParam ?? "any";
  if (!isStructureSearchTarget(target)) {
    throw new StructureSearchInputError("structureTarget 必须是 any、cation 或 anion。");
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
