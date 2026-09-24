import type { TextSpan } from "./evidence";
import type { BBox } from "./schema";

interface TextLine {
  text: string;
  x: number;
  y: number;
  right: number;
  h: number;
}

function figureToken(label: string): string | null {
  const match = label.match(/(?:fig(?:ure)?\.?\s*)?([a-z]?\d+[a-z]?|\d+\s*[a-z])/i);
  return match?.[1]?.replace(/\s+/g, "").toLowerCase() ?? null;
}

function linesFromSpans(spans: TextSpan[]): TextLine[] {
  const sorted = [...spans].sort((a, b) => {
    const dy = a.y + a.h / 2 - (b.y + b.h / 2);
    return Math.abs(dy) < Math.max(a.h, b.h) * 0.55 ? a.x - b.x : dy;
  });
  const rows: TextSpan[][] = [];
  for (const span of sorted) {
    const center = span.y + span.h / 2;
    const row = rows.find((candidate) => {
      const sample = candidate[0];
      return Math.abs(center - (sample.y + sample.h / 2)) < Math.max(span.h, sample.h) * 0.65;
    });
    if (row) row.push(span);
    else rows.push([span]);
  }
  return rows.flatMap((row) => {
    row.sort((a, b) => a.x - b.x);
    // Two-column papers often place unrelated text at the same vertical
    // coordinate. Keep those columns as separate lines; otherwise a short
    // right-column caption appears full-width and produces a full-page crop.
    const segments: TextSpan[][] = [];
    for (const span of row) {
      const segment = segments.at(-1);
      const previous = segment?.at(-1);
      if (!segment || !previous || span.x - (previous.x + previous.w) > 0.025) {
        segments.push([span]);
      } else {
        segment.push(span);
      }
    }
    return segments.map((segment) => {
      const x = Math.min(...segment.map((span) => span.x));
      const right = Math.max(...segment.map((span) => span.x + span.w));
      const y = Math.min(...segment.map((span) => span.y));
      const bottom = Math.max(...segment.map((span) => span.y + span.h));
      return {
        text: segment.map((span) => span.str).join(" ").replace(/\s+/g, " ").trim(),
        x,
        y,
        right,
        h: bottom - y,
      };
    });
  });
}

/**
 * Conservative automatic source-figure crop. Scientific PDFs normally place a
 * caption directly below its figure. We locate the requested caption in the
 * positioned text layer, identify its page column, and crop the figure-sized
 * region above it. The result is explicitly an inferred candidate; an existing
 * exact figureBox always takes precedence.
 */
export function inferFigureBoxFromSpans(spans: TextSpan[], figureLabel: string): BBox | null {
  const token = figureToken(figureLabel);
  if (!token) return null;
  const tokens = [token, token.replace(/(?<=\d)[a-z]$/i, "")].filter(
    (value, index, all) => value && all.indexOf(value) === index,
  );
  const lines = linesFromSpans(spans);
  const normal = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
  const candidates = lines.filter((line) => {
    const text = normal(line.text);
    return tokens.some((candidate) => text.includes(`figure${candidate}`) || text.includes(`fig${candidate}`));
  });
  if (!candidates.length) return null;

  // Captions usually start with Figure/Fig and are wider than in-plot labels.
  const caption = candidates.sort((a, b) => {
    const aStarts = /^(?:figure|fig\.?)/i.test(a.text.trim()) ? 1 : 0;
    const bStarts = /^(?:figure|fig\.?)/i.test(b.text.trim()) ? 1 : 0;
    return bStarts - aStarts || (b.right - b.x) - (a.right - a.x);
  })[0];

  let x = 0.045;
  let w = 0.91;
  const captionWidth = caption.right - caption.x;
  if (captionWidth < 0.5) {
    const captionOnLeft = (caption.x + caption.right) / 2 < 0.5;
    const sameColumn = lines
      .filter((line) => {
        const lineOnLeft = (line.x + line.right) / 2 < 0.5;
        return line.y >= caption.y - 0.004
          && line.y <= caption.y + 0.32
          && lineOnLeft === captionOnLeft
          && Math.abs(line.x - caption.x) < 0.1;
      })
      .sort((a, b) => a.y - b.y);
    let blockBottom = caption.y + caption.h;
    for (const line of sameColumn) {
      if (line.y > blockBottom + 0.035) break;
      blockBottom = Math.max(blockBottom, line.y + line.h);
    }

    // Some journals place a tall caption beside the figure. In that layout
    // the image is in the opposite column, aligned with the caption, not above
    // it. Detect the caption block before falling back to the usual crop-above.
    if (blockBottom - caption.y > 0.11) {
      x = captionOnLeft ? Math.min(0.93, caption.right + 0.018) : 0.045;
      w = captionOnLeft
        ? Math.max(0.2, 0.955 - x)
        : Math.max(0.2, caption.x - x - 0.018);
      const top = Math.max(0.025, caption.y - 0.018);
      const bottom = Math.min(0.965, Math.max(blockBottom + 0.075, top + 0.34));
      return { x, y: top, w, h: bottom - top };
    }

    x = captionOnLeft ? 0.045 : 0.51;
    w = 0.445;
  }
  const bottom = Math.max(0.2, caption.y - 0.012);
  const top = Math.max(0.025, bottom - 0.43);
  if (bottom - top < 0.16) return null;
  return { x, y: top, w, h: bottom - top };
}

export function validFigureBox(box: BBox | null | undefined): BBox | null {
  if (!box || ![box.x, box.y, box.w, box.h].every(Number.isFinite)) return null;
  if (box.x < 0 || box.y < 0 || box.w <= 0 || box.h <= 0) return null;
  if (box.x + box.w > 1.001 || box.y + box.h > 1.001) return null;
  return box;
}

/** Snap a caption-localized candidate to real PDF artwork, never to a page-sized scan. */
export function matchEmbeddedFigureBox(candidate: BBox, images: BBox[]): BBox | null {
  const ranked = images.map((box) => {
    const overlap = Math.max(0, Math.min(candidate.x+candidate.w, box.x+box.w)-Math.max(candidate.x,box.x))
      * Math.max(0, Math.min(candidate.y+candidate.h, box.y+box.h)-Math.max(candidate.y,box.y));
    return { box, score: overlap / Math.min(candidate.w*candidate.h, box.w*box.h) };
  }).filter(({score}) => score >= 0.45).sort((a,b) => b.score-a.score);
  // Multiple similarly plausible images require further localization, not a guess.
  if (!ranked.length || (ranked[1] && ranked[0].score-ranked[1].score < 0.1)) return null;
  return ranked[0].box;
}
