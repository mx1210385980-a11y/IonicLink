/**
 * PDF helpers built on unpdf (serverless-friendly). Text extraction has no
 * native deps; page rendering uses @napi-rs/canvas (kept external to the bundle).
 */

// Polyfill for Math.sumPrecise used by some pdfjs/unpdf builds. The original
// implementation is for higher-precision summation; a simple numeric sum
// prevents runtime warnings while keeping behavior predictable in Node.
if (typeof (Math as any).sumPrecise !== "function") {
  (Math as any).sumPrecise = function (arr: number[]) {
    let s = 0;
    for (const v of arr) s += Number(v) || 0;
    return s;
  };
}

// Suppress noisy process warnings from pdfjs/unpdf (e.g. Math.sumPrecise)
try {
  const _oldEmitWarning = process.emitWarning;
  process.emitWarning = function (warning: any, ...args: any[]) {
    try {
      const msg = typeof warning === "string" ? warning : warning?.message ?? "";
      if (msg.includes("Math.sumPrecise") || msg.includes("Cannot substitute the font")) return;
    } catch (e) {}
    return (_oldEmitWarning as any).call(process, warning, ...args);
  };
} catch (e) {
  // ignore if process.emitWarning not available
}

import type { TextSpan } from "./evidence";
import type { BBox } from "./schema";

/** Actual embedded-image placement, including the page rotation and PDF transforms. */
export async function pdfPageImageBoxes(data: Uint8Array, pageNumber: number): Promise<BBox[]> {
  const { getDocumentProxy, getResolvedPDFJS } = await import("unpdf");
  const { OPS } = await getResolvedPDFJS();
  const pdf = await getDocumentProxy(own(data));
  try {
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });
    const ops = await page.getOperatorList();
    const multiply = (a: number[], b: number[]) => [
      a[0]*b[0]+a[2]*b[1], a[1]*b[0]+a[3]*b[1], a[0]*b[2]+a[2]*b[3],
      a[1]*b[2]+a[3]*b[3], a[0]*b[4]+a[2]*b[5]+a[4], a[1]*b[4]+a[3]*b[5]+a[5],
    ];
    let transform = [1, 0, 0, 1, 0, 0];
    const stack: number[][] = [];
    const boxes: BBox[] = [];
    for (let index = 0; index < ops.fnArray.length; index++) {
      const op = ops.fnArray[index];
      if (op === OPS.save) stack.push([...transform]);
      else if (op === OPS.restore) transform = stack.pop() ?? transform;
      else if (op === OPS.transform) transform = multiply(transform, ops.argsArray[index]);
      else if (op === OPS.paintImageXObject || op === OPS.paintInlineImageXObject) {
        const t = multiply(viewport.transform, transform);
        const xs = [t[4], t[0]+t[4], t[2]+t[4], t[0]+t[2]+t[4]];
        const ys = [t[5], t[1]+t[5], t[3]+t[5], t[1]+t[3]+t[5]];
        const x = Math.max(0, Math.min(...xs)/viewport.width);
        const y = Math.max(0, Math.min(...ys)/viewport.height);
        const w = Math.min(1-x, (Math.max(...xs)-Math.min(...xs))/viewport.width);
        const h = Math.min(1-y, (Math.max(...ys)-Math.min(...ys))/viewport.height);
        // Logos, inline equations and whole-page scans are not figure crops.
        if (w > 0.12 && h > 0.07 && !(w > 0.94 && h > 0.9)) boxes.push({ x, y, w, h });
      }
    }
    return boxes;
  } finally {
    await pdf.cleanup();
  }
}

/**
 * pdf.js takes OWNERSHIP of the bytes it is given (the ArrayBuffer is
 * transferred and the caller's view detaches — later reads throw "Cannot
 * perform Construct on a detached ArrayBuffer"). Every unpdf entry point
 * below therefore hands over a private copy so callers keep their buffer,
 * e.g. the upload route which parses pages for the DOI check and then still
 * needs the bytes to store the source PDF.
 */
function own(data: Uint8Array): Uint8Array {
  return data.slice();
}

/**
 * Run an async action while temporarily suppressing known noisy warnings
 * emitted by the bundled pdf.js/unpdf code. Filters messages that mention
 * Math.sumPrecise or font substitution; restores console afterwards.
 */
async function withSuppressedPdfWarnings<T>(fn: () => Promise<T>): Promise<T> {
  const oldWarn = console.warn;
  const oldError = console.error;
  console.warn = (...args: any[]) => {
    try {
      const msg = args.join(" ");
      if (msg.includes("Math.sumPrecise") || msg.includes("Cannot substitute the font")) return;
    } catch (e) {}
    oldWarn.apply(console, args as any);
  };
  console.error = (...args: any[]) => {
    try {
      const msg = args.join(" ");
      if (msg.includes("Math.sumPrecise") || msg.includes("Cannot substitute the font")) return;
    } catch (e) {}
    oldError.apply(console, args as any);
  };
  try {
    return await fn();
  } finally {
    console.warn = oldWarn;
    console.error = oldError;
  }
}

export async function pdfToText(data: Uint8Array): Promise<string> {
  return withSuppressedPdfWarnings(async () => {
    const { extractText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(own(data));
    const { text } = await extractText(pdf, { mergePages: true });
    return Array.isArray(text) ? text.join("\n") : text;
  });
}

/** Per-page text, 1-indexed. Powers both provenance context and tagged text. */
export async function pdfToPages(data: Uint8Array): Promise<{ page: number; text: string }[]> {
  return withSuppressedPdfWarnings(async () => {
    const { extractText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(own(data));
    const { text } = await extractText(pdf, { mergePages: false });
    const pages = Array.isArray(text) ? text : [text];
    return pages.map((t, i) => ({ page: i + 1, text: t }));
  });
}

/** Text with `[PAGE n]` markers, so the extractor can attribute values to pages. */
export function pagesToTaggedText(pages: { page: number; text: string }[]): string {
  return pages.map((p) => `[PAGE ${p.page}]\n${p.text}`).join("\n\n");
}

export async function pdfToTaggedText(data: Uint8Array): Promise<string> {
  return pagesToTaggedText(await pdfToPages(data));
}

/**
 * Positioned text runs for one page, in page fractions (top-left origin) so
 * they overlay the rendered page image at any scale. Powers evidence-quote
 * highlighting in the source viewer.
 */
export async function pdfPageTextSpans(data: Uint8Array, page: number): Promise<TextSpan[]> {
  return withSuppressedPdfWarnings(async () => {
    const { getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(own(data));
    if (!Number.isInteger(page) || page < 1 || page > pdf.numPages) return [];
    const p = await pdf.getPage(page);
    const viewport = p.getViewport({ scale: 1 });
    const content = await p.getTextContent();
  const spans: TextSpan[] = [];
  for (const item of content.items) {
    if (!("str" in item) || !item.str) continue;
    const tx = item.transform[4];
    const ty = item.transform[5];
    // Baseline-origin rect in PDF user space; the viewport handles page rotation
    // and the flipped y-axis.
    const [vx1, vy1] = viewport.convertToViewportPoint(tx, ty);
    const [vx2, vy2] = viewport.convertToViewportPoint(tx + item.width, ty + item.height);
    const w = Math.abs(vx2 - vx1) / viewport.width;
    const h = Math.abs(vy2 - vy1) / viewport.height;
    if (!(w > 0) || !(h > 0)) continue;
    spans.push({
      str: item.str,
      x: Math.min(vx1, vx2) / viewport.width,
      y: Math.min(vy1, vy2) / viewport.height,
      w,
      h,
    });
  }
    return spans;
  });
}

/** Render a single page to a PNG buffer (for the in-app source viewer). */
export async function renderPdfPage(
  data: Uint8Array,
  page: number,
  scale = 2
): Promise<Uint8Array> {
  return withSuppressedPdfWarnings(async () => {
    const { renderPageAsImage } = await import("unpdf");
    const img = await renderPageAsImage(own(data), page, {
      scale,
      canvasImport: () => import("@napi-rs/canvas") as never,
    });
    return new Uint8Array(img);
  });
}
