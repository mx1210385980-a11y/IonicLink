export const STRUCTURE_SMILES_PARAM = "structureSmiles";
export const STRUCTURE_TARGET_PARAM = "structureTarget";
export const STRUCTURE_MODE_PARAM = "structureMode";
export const MAX_STRUCTURE_SMILES_LENGTH = 2048;

export type StructureSearchTarget = "any" | "cation" | "anion";
export type StructureSearchMode = "exact";

/** The user-facing, serializable structure filter kept by DatabaseView. */
export interface StructureSearchValue {
  smiles: string;
  target: StructureSearchTarget;
  mode: StructureSearchMode;
}

/** The server-side query after the drawn structure has been canonicalized. */
export interface ExactStructureFilter {
  key: string;
  target: StructureSearchTarget;
}

export interface StructureSearchInputIssue {
  message: string;
  status: 400 | 413;
}

/** Cheap client/server checks before the canonical graph parser runs. */
export function structureSearchInputIssue(smiles: string): StructureSearchInputIssue | null {
  const source = smiles.trim();
  if (!source) return { message: "请先绘制一个离子结构。", status: 400 };
  if (source.length > MAX_STRUCTURE_SMILES_LENGTH) {
    return { message: "结构式过长，请缩小到一个完整离子。", status: 413 };
  }
  if (source.includes(".") || source.includes(">")) {
    return { message: "首版结构搜索一次只接受一个完整离子，不支持盐对或反应式。", status: 400 };
  }
  if (/[~*?]/.test(source)) {
    return { message: "精确结构搜索不支持通配原子或查询键。", status: 400 };
  }
  return null;
}

export function isStructureSearchTarget(value: unknown): value is StructureSearchTarget {
  return value === "any" || value === "cation" || value === "anion";
}

export function structureTargetLabel(target: StructureSearchTarget): string {
  if (target === "cation") return "阳离子";
  if (target === "anion") return "阴离子";
  return "任意离子";
}
