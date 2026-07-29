import type { BBox } from "./schema";

/**
 * Locating a provenance quote ON the rendered page image (not just in the page
 * text). The PDF text layer gives positioned runs (TextSpan); we match the
 * quote against the concatenated runs and map the matched characters back to
 * normalized page rectangles, one per visual line — the highlight marks the
 * source viewer draws over the page PNG.
 *
 * Extracted quotes rarely match the PDF text byte-for-byte (ligatures, µ vs μ,
 * line-break hyphenation, spacing drift), so matching is tiered:
 *   exact   — equal after per-char normalization + whitespace collapsing.
 *   loose   — equal after dropping everything but letters/digits (survives
 *             hyphenation and missing/extra spaces or punctuation).
 *   partial — extractor quotes often elide symbols or table columns with "..."
 *             ("increases from ... = 0.02 to ... = 0.04"); the pieces between
 *             the gaps are matched individually, in order, within a window.
 *   null    — the quote is not on this page; the viewer surfaces that, since a
 *             quote that cannot be located is exactly the misalignment a
 *             reviewer needs to see.
 *
 * Pure functions only (no pdf.js, no fs) so both the API route and the client
 * viewer can import them, and they stay unit-testable.
 */

/** One positioned text run, in page fractions (0–1, top-left origin). */
export interface TextSpan {
  str: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export type EvidenceMatch = "exact" | "loose" | "partial";

export interface EvidenceBoxes {
  match: EvidenceMatch | null;
  boxes: BBox[];
}

/** Loose matches shorter than this (in letters/digits) are too ambiguous to trust. */
const MIN_LOOSE_LENGTH = 5;
/** Same-line pieces closer than this (page-width fraction) merge into one mark. */
const MERGE_GAP = 0.025;
/** Max letters/digits between two elision-separated pieces of a partial match. */
const PARTIAL_WINDOW = 600;
/** Plain long quotes may be interrupted by figure captions/table text in PDF order. */
const MIN_ANCHOR_WORDS = 4;
const MIN_ANCHOR_LOOSE_LENGTH = 14;
const MIN_ANCHOR_COVERAGE = 0.45;
const MIN_SHORT_ANCHOR_COVERAGE = 0.72;
/** "..." or "…" (the latter folds to dots) — how extractor quotes mark elisions. */
const ELLIPSIS_RE = /(?:\.\s*){3,}/;

/**
 * PDF-text lookalikes folded to one canonical form before comparing. NFKC
 * already folds ligatures, µ→μ, math alphanumerics (𝜇→μ) and super/subscripts
 * (²→2); this map covers what NFKC leaves alone.
 */
const CHAR_FOLD: Record<string, string> = {
  "­": "", // soft hyphen
  "‐": "-",
  "‑": "-",
  "‒": "-",
  "–": "-",
  "—": "-",
  "−": "-",
  "∼": "~",
  "‘": "'",
  "’": "'",
  "‚": "'",
  "“": '"',
  "”": '"',
  "„": '"',
};

function foldChar(c: string): string {
  if (/\s/.test(c)) return " ";
  const norm = c.normalize("NFKC");
  const mapped = CHAR_FOLD[norm];
  return (mapped ?? norm).toLowerCase();
}

/** Normalize a quote the same way the page stream is normalized. */
function foldQuote(quote: string): string {
  let out = "";
  for (const c of Array.from(quote)) {
    const f = foldChar(c);
    if (f === " " && out.endsWith(" ")) continue;
    out += f;
  }
  return out.trim();
}

/** A character's origin: which span, and which code point within it. */
interface CharRef {
  span: number;
  ch: number;
}

interface Stream {
  text: string; // joined chars — refs are indexed by CODE POINT, not UTF-16 unit
  refs: (CharRef | null)[]; // null = separator whitespace
}

/** UTF-16 index → code-point index, so `indexOf` results line up with refs. */
function cpIndex(s: string, utf16: number): number {
  return Array.from(s.slice(0, utf16)).length;
}

function sameLine(a: TextSpan, b: TextSpan): boolean {
  return Math.abs(a.y + a.h / 2 - (b.y + b.h / 2)) < Math.max(a.h, b.h) * 0.5;
}

/**
 * Concatenate spans into one normalized string with a char→span map. A space
 * separates spans unless they visually continue the same word (pdf.js splits
 * words across runs for kerning); a wrongly-added space only demotes a match
 * from exact to loose, so the geometry check just improves exactness.
 */
function buildStream(spans: TextSpan[]): Stream {
  const chars: string[] = [];
  const refs: (CharRef | null)[] = [];
  const push = (s: string, ref: CharRef | null) => {
    for (const c of s) {
      if (c === " " && (chars.length === 0 || chars[chars.length - 1] === " ")) continue;
      chars.push(c);
      refs.push(c === " " ? null : ref);
    }
  };
  let prev: TextSpan | null = null;
  spans.forEach((sp, i) => {
    if (prev) {
      const gap = sp.x - (prev.x + prev.w);
      const continuesWord = sameLine(prev, sp) && gap < Math.max(prev.h, sp.h) * 0.15;
      if (!continuesWord) push(" ", null);
    }
    Array.from(sp.str).forEach((c, j) => push(foldChar(c), { span: i, ch: j }));
    prev = sp;
  });
  return { text: chars.join(""), refs };
}

function isWordChar(c: string): boolean {
  // BMP-only so positions in the loose projection are plain string indices.
  return /[\p{L}\p{N}]/u.test(c) && (c.codePointAt(0) ?? 0) <= 0xffff;
}

/** The stream reduced to letters/digits, with a map back to stream positions. */
interface LooseProjection {
  text: string;
  idx: number[]; // loose position → stream code-point position
}

function looseProjection(stream: Stream): LooseProjection {
  const chars: string[] = [];
  const idx: number[] = [];
  Array.from(stream.text).forEach((c, i) => {
    if (isWordChar(c)) {
      chars.push(c);
      idx.push(i);
    }
  });
  return { text: chars.join(""), idx };
}

function looseFold(s: string): string {
  return Array.from(s).filter(isWordChar).join("");
}

interface WordRef {
  text: string;
  start: number; // stream code-point index, inclusive
  end: number; // stream code-point index, exclusive
}

function wordsFromText(text: string): string[] {
  const words: string[] = [];
  let cur = "";
  for (const c of Array.from(text)) {
    if (isWordChar(c)) cur += c;
    else if (cur) {
      words.push(cur);
      cur = "";
    }
  }
  if (cur) words.push(cur);
  return words;
}

function wordProjection(stream: Stream): WordRef[] {
  const words: WordRef[] = [];
  const chars = Array.from(stream.text);
  let cur = "";
  let start = -1;
  chars.forEach((c, i) => {
    if (isWordChar(c)) {
      if (!cur) start = i;
      cur += c;
      return;
    }
    if (cur) {
      words.push({ text: cur, start, end: i });
      cur = "";
      start = -1;
    }
  });
  if (cur) words.push({ text: cur, start, end: chars.length });
  return words;
}

function looseLength(words: string[], start: number, end: number): number {
  let n = 0;
  for (let i = start; i < end; i++) n += words[i].length;
  return n;
}

interface WordRun {
  qStart: number;
  qEnd: number;
  sStart: number;
  sEnd: number;
  score: number;
}

function commonWordRun(qWords: string[], sWords: WordRef[], qStart: number, sStart: number): number {
  let len = 0;
  while (
    qStart + len < qWords.length &&
    sStart + len < sWords.length &&
    qWords[qStart + len] === sWords[sStart + len].text
  ) {
    len++;
  }
  return len;
}

function collectWordRuns(qWords: string[], sWords: WordRef[]): WordRun[] {
  const runs: WordRun[] = [];
  for (let qStart = 0; qStart < qWords.length; qStart++) {
    for (let sStart = 0; sStart < sWords.length; sStart++) {
      if (qWords[qStart] !== sWords[sStart].text) continue;
      const alreadyInsideRun =
        qStart > 0 && sStart > 0 && qWords[qStart - 1] === sWords[sStart - 1].text;
      if (alreadyInsideRun) continue;

      const len = commonWordRun(qWords, sWords, qStart, sStart);
      const score = looseLength(qWords, qStart, qStart + len);
      if (len >= MIN_ANCHOR_WORDS && score >= MIN_ANCHOR_LOOSE_LENGTH) {
        runs.push({ qStart, qEnd: qStart + len, sStart, sEnd: sStart + len, score });
      }
    }
  }
  return runs;
}

/**
 * Anchor tier for plain long quotes. It is intentionally conservative: it only
 * accepts substantial word runs from the quote that appear in order on the same
 * page. This catches PDF text-order interruptions without hiding truly wrong
 * page citations.
 */
function findAnchoredRefs(stream: Stream, q: string): CharRef[] | null {
  const qWords = wordsFromText(q);
  if (qWords.length < MIN_ANCHOR_WORDS) return null;
  const sWords = wordProjection(stream);
  if (sWords.length === 0) return null;

  const runs = collectWordRuns(qWords, sWords).sort((a, b) => a.qStart - b.qStart || a.sStart - b.sStart);
  if (runs.length === 0) return null;

  const best = runs.map((run, index) => ({ score: run.score, wordCount: run.qEnd - run.qStart, prev: -1, index }));
  for (let i = 0; i < runs.length; i++) {
    for (let j = 0; j < i; j++) {
      if (runs[j].qEnd > runs[i].qStart || runs[j].sEnd > runs[i].sStart) continue;
      const nextScore = best[j].score + runs[i].score;
      const nextWords = best[j].wordCount + runs[i].qEnd - runs[i].qStart;
      if (nextScore > best[i].score) {
        best[i] = { score: nextScore, wordCount: nextWords, prev: j, index: i };
      }
    }
  }

  let bestIndex = 0;
  for (let i = 1; i < best.length; i++) {
    if (best[i].score > best[bestIndex].score) bestIndex = i;
  }

  const quoteLooseLength = looseLength(qWords, 0, qWords.length);
  const coverage = best[bestIndex].score / Math.max(1, quoteLooseLength);
  const wordCoverage = best[bestIndex].wordCount / qWords.length;
  const required = qWords.length <= 7 ? MIN_SHORT_ANCHOR_COVERAGE : MIN_ANCHOR_COVERAGE;
  if (coverage < required && wordCoverage < required) return null;

  const chain: WordRun[] = [];
  for (let i = bestIndex; i >= 0; i = best[i].prev) {
    chain.push(runs[best[i].index]);
    if (best[i].prev < 0) break;
  }
  chain.reverse();

  const refs: CharRef[] = [];
  for (const run of chain) {
    refs.push(...refsInRange(stream, sWords[run.sStart].start, sWords[run.sEnd - 1].end));
  }
  return refs;
}

/** Refs for stream positions [start, end), separators skipped. */
function refsInRange(stream: Stream, start: number, end: number): CharRef[] {
  const out: CharRef[] = [];
  for (let i = start; i < end; i++) {
    const r = stream.refs[i];
    if (r) out.push(r);
  }
  return out;
}

/** Matched chars → one clamped rectangle per visual line. */
function refsToBoxes(spans: TextSpan[], refs: CharRef[]): BBox[] {
  const bySpan = new Map<number, { min: number; max: number }>();
  for (const r of refs) {
    const cur = bySpan.get(r.span);
    if (!cur) bySpan.set(r.span, { min: r.ch, max: r.ch });
    else {
      cur.min = Math.min(cur.min, r.ch);
      cur.max = Math.max(cur.max, r.ch);
    }
  }
  const pieces: BBox[] = [];
  for (const [i, range] of bySpan) {
    const sp = spans[i];
    const len = Math.max(1, Array.from(sp.str).length);
    pieces.push({
      x: sp.x + (sp.w * range.min) / len,
      y: sp.y,
      w: (sp.w * (range.max - range.min + 1)) / len,
      h: sp.h,
    });
  }
  return mergeIntoLines(pieces).map(clampBox);
}

/** Merge horizontally-adjacent pieces on the same line; keep column gaps apart. */
function mergeIntoLines(pieces: BBox[]): BBox[] {
  const sorted = [...pieces].sort((a, b) => a.y + a.h / 2 - (b.y + b.h / 2) || a.x - b.x);
  const out: BBox[] = [];
  for (const p of sorted) {
    const last = out[out.length - 1];
    const sameVisualLine = last && Math.abs(p.y + p.h / 2 - (last.y + last.h / 2)) < Math.max(p.h, last.h) * 0.6;
    const closeX = last && p.x <= last.x + last.w + MERGE_GAP;
    if (last && sameVisualLine && closeX) {
      const x = Math.min(last.x, p.x);
      const y = Math.min(last.y, p.y);
      last.w = Math.max(last.x + last.w, p.x + p.w) - x;
      last.h = Math.max(last.y + last.h, p.y + p.h) - y;
      last.x = x;
      last.y = y;
    } else {
      out.push({ ...p });
    }
  }
  return out;
}

function clampBox(b: BBox): BBox {
  const x = Math.max(0, Math.min(1, b.x));
  const y = Math.max(0, Math.min(1, b.y));
  return { x, y, w: Math.max(0, Math.min(1 - x, b.w)), h: Math.max(0, Math.min(1 - y, b.h)) };
}

/** Loose-projection range → stream refs. */
function refsForLooseRange(stream: Stream, proj: LooseProjection, start: number, end: number): CharRef[] {
  return refsInRange(stream, proj.idx[start], proj.idx[end - 1] + 1);
}

/**
 * Partial tier: split the quote on "..." elisions, then find the pieces in
 * order. The anchor piece is retried across its occurrences (and across pieces,
 * in case the first one is paraphrased) so one ambiguous fragment doesn't sink
 * the rest; at least half the usable pieces must land.
 */
function findPartialRefs(stream: Stream, q: string): CharRef[] | null {
  const rawSegments = q.split(ELLIPSIS_RE).map((s) => s.trim()).filter(Boolean);
  if (rawSegments.length < 2) return null; // no elision — nothing beyond loose to try
  const segments = rawSegments.map(looseFold).filter((s) => s.length >= MIN_LOOSE_LENGTH);
  if (segments.length === 0) return null;
  const proj = looseProjection(stream);

  let best: { score: number; ranges: [number, number][] } | null = null;
  for (let anchor = 0; anchor < segments.length && (!best || best.score < segments.length - anchor); anchor++) {
    for (let from = 0, tries = 0; tries < 30; tries++) {
      const at = proj.text.indexOf(segments[anchor], from);
      if (at < 0) break;
      const ranges: [number, number][] = [[at, at + segments[anchor].length]];
      let cursor = at + segments[anchor].length;
      for (let j = anchor + 1; j < segments.length; j++) {
        const hit = proj.text.indexOf(segments[j], cursor);
        if (hit < 0 || hit - cursor > PARTIAL_WINDOW) continue;
        ranges.push([hit, hit + segments[j].length]);
        cursor = hit + segments[j].length;
      }
      if (!best || ranges.length > best.score) best = { score: ranges.length, ranges };
      if (ranges.length === segments.length - anchor) break; // all pieces from this anchor
      from = at + 1;
    }
  }

  if (!best || best.score < Math.ceil(segments.length / 2)) return null;
  const refs: CharRef[] = [];
  for (const [s, e] of best.ranges) refs.push(...refsForLooseRange(stream, proj, s, e));
  return refs;
}

/**
 * Locate `quote` among the page's text spans and return highlight boxes
 * (page fractions, one per line). First occurrence wins, matching how the
 * text-context highlight resolves repeated snippets.
 */
export function findQuoteBoxes(spans: TextSpan[], quote: string): EvidenceBoxes {
  const q = foldQuote(quote);
  if (!q || spans.length === 0) return { match: null, boxes: [] };
  const stream = buildStream(spans);

  const exactAt = stream.text.indexOf(q);
  if (exactAt >= 0) {
    const start = cpIndex(stream.text, exactAt);
    const end = cpIndex(stream.text, exactAt + q.length);
    return { match: "exact", boxes: refsToBoxes(spans, refsInRange(stream, start, end)) };
  }

  // Loose: letters/digits only — survives hyphenation, spacing and punctuation drift.
  const qLoose = looseFold(q);
  if (qLoose.length >= MIN_LOOSE_LENGTH) {
    const proj = looseProjection(stream);
    const looseAt = proj.text.indexOf(qLoose);
    if (looseAt >= 0) {
      return { match: "loose", boxes: refsToBoxes(spans, refsForLooseRange(stream, proj, looseAt, looseAt + qLoose.length)) };
    }
  }

  const partialRefs = findPartialRefs(stream, q);
  if (partialRefs) return { match: "partial", boxes: refsToBoxes(spans, partialRefs) };

  const anchoredRefs = findAnchoredRefs(stream, q);
  if (anchoredRefs) return { match: "partial", boxes: refsToBoxes(spans, anchoredRefs) };

  return { match: null, boxes: [] };
}

/**
 * Re-express page-fraction boxes in the coordinate space of a figure crop,
 * clipping to it and dropping boxes that fall outside entirely (so the
 * cropped figure view can draw the same evidence marks).
 */
export function boxesInCrop(boxes: BBox[], crop: BBox): BBox[] {
  if (crop.w <= 0 || crop.h <= 0) return [];
  const out: BBox[] = [];
  for (const b of boxes) {
    const x1 = Math.max(b.x, crop.x);
    const y1 = Math.max(b.y, crop.y);
    const x2 = Math.min(b.x + b.w, crop.x + crop.w);
    const y2 = Math.min(b.y + b.h, crop.y + crop.h);
    if (x2 <= x1 || y2 <= y1) continue;
    out.push({ x: (x1 - crop.x) / crop.w, y: (y1 - crop.y) / crop.h, w: (x2 - x1) / crop.w, h: (y2 - y1) / crop.h });
  }
  return out;
}
