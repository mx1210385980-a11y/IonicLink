import type { FieldProvenance } from "./schema";

const HOPG_RE = /\bH\.?\s*O\.?\s*P\.?\s*G\.?\b|highly\s+oriented\s+pyrolytic\s+graphite/i;

export function standardizeSubstrate(
  raw: string | null | undefined,
  provenance?: FieldProvenance | null
): string {
  const value = (raw ?? "").trim();
  const evidence = [
    value,
    provenance?.quote,
    provenance?.context,
    provenance?.basisNote,
  ]
    .filter((part): part is string => !!part?.trim())
    .join(" ");

  if (HOPG_RE.test(evidence)) return "HOPG";
  return value;
}
