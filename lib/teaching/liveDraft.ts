import type { LiveRow } from "./liveFields";

export function sameLiveRows(a: LiveRow[], b: LiveRow[]): boolean {
  return a.length === b.length && a.every((row, i) => {
    const keys = new Set([...Object.keys(row), ...Object.keys(b[i])]);
    return [...keys].every((key) => (row[key] ?? "") === (b[i][key] ?? ""));
  });
}

/** A poll may rebase a changed answer-key version, but never overwrite unsaved edits. */
export function liveDraftConflicts(baseRows: LiveRow[], localRows: LiveRow[], remoteRows: LiveRow[]): boolean {
  return !sameLiveRows(localRows, remoteRows) && !sameLiveRows(baseRows, remoteRows);
}
