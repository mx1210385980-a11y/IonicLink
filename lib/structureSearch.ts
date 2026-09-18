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
  if (!source) return { message: "Draw one complete ion structure first.", status: 400 };
  if (source.length > MAX_STRUCTURE_SMILES_LENGTH) {
    return { message: "The structure is too large. Reduce it to one complete ion.", status: 413 };
  }
  if (source.includes(".") || source.includes(">")) {
    return { message: "Exact structure search accepts one complete ion at a time; salt pairs and reactions are not supported.", status: 400 };
  }
  if (/[~*?]/.test(source)) {
    return { message: "Exact structure search does not support wildcard atoms or query bonds.", status: 400 };
  }
  return null;
}

export function isStructureSearchTarget(value: unknown): value is StructureSearchTarget {
  return value === "any" || value === "cation" || value === "anion";
}

export function structureTargetLabel(target: StructureSearchTarget): string {
  if (target === "cation") return "Cation";
  if (target === "anion") return "Anion";
  return "Any ion";
}
