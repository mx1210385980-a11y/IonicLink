/** Shared text-scan helpers for the deterministic offline mock extractors. */

export function matchAll(text: string, re: RegExp): RegExpMatchArray[] {
  return Array.from(text.matchAll(re));
}

export function first(text: string, re: RegExp): string | null {
  const m = text.match(re);
  return m ? m[1].replace(/\s+/g, " ").trim() : null;
}

/** Page number from the nearest preceding [PAGE n] marker. */
export function pageOf(text: string, idx: number): number | undefined {
  if (idx < 0) return undefined;
  const before = text.slice(0, idx);
  const m = [...before.matchAll(/\[PAGE (\d+)\]/g)];
  return m.length ? parseInt(m[m.length - 1][1], 10) : undefined;
}

/** A short cleaned quote window around an index. */
export function snippet(text: string, idx: number): string {
  return text
    .slice(Math.max(0, idx - 12), idx + 44)
    .replace(/\[PAGE \d+\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
