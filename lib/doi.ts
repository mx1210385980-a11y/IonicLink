/**
 * DOI extraction from source page text, powering upload deduplication: the
 * same paper re-uploaded under a different filename still resolves to the
 * same DOI, so it can be skipped before a redundant (and costly) extraction.
 *
 * A paper's own DOI is printed on its first page(s) — in the header/footer or
 * on a "DOI:" / doi.org line — while reference lists cite OTHER papers' DOIs.
 * Two heuristics keep the right one: only the first pages are scanned, and a
 * match preceded by a doi marker beats a bare match on the same page.
 */

const DOI_RE = /\b10\.\d{4,9}\/[^\s"'<>]+/g;
/** The paper's own DOI line rarely appears later than this. */
const MAX_DOI_PAGES = 2;

/**
 * Canonical form for comparison: no url/label prefix, no trailing punctuation,
 * lowercase (DOIs are case-insensitive per the spec).
 */
export function normalizeDoi(raw: string): string {
  let doi = raw
    .trim()
    .replace(/^(?:https?:\/\/)?(?:dx\.)?doi\.org\//i, "")
    .replace(/^doi:?\s*/i, "");
  for (;;) {
    if (/[.,;:]$/.test(doi)) {
      doi = doi.slice(0, -1);
      continue;
    }
    // strip a trailing ")" only when unbalanced — "(02)" suffixes are part of real DOIs
    if (doi.endsWith(")") && (doi.match(/\(/g)?.length ?? 0) < (doi.match(/\)/g)?.length ?? 0)) {
      doi = doi.slice(0, -1);
      continue;
    }
    break;
  }
  return doi.startsWith("10.") ? doi.toLowerCase() : "";
}

/** The document's own DOI, or null when none is detectable on the first pages. */
export function extractDoiFromPages(pages: { page: number; text: string }[]): string | null {
  const first = [...pages].sort((a, b) => a.page - b.page).slice(0, MAX_DOI_PAGES);
  for (const { text } of first) {
    let bare: string | null = null;
    for (const m of text.matchAll(DOI_RE)) {
      const doi = normalizeDoi(m[0]);
      if (!doi) continue;
      const lead = text.slice(Math.max(0, (m.index ?? 0) - 20), m.index);
      if (/doi/i.test(lead)) return doi; // marker-prefixed → the paper's own DOI line
      bare ??= doi;
    }
    if (bare) return bare;
  }
  return null;
}
