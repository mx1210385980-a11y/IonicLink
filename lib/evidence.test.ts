import assert from "node:assert/strict";
import { boxesInCrop, findQuoteBoxes, type TextSpan } from "./evidence";

const close = (a: number, b: number, tol = 1e-6) => Math.abs(a - b) < tol;

/* One visual line split across two pdf.js runs (word gap between them). */
const line = (y: number, parts: [string, number, number][]): TextSpan[] =>
  parts.map(([str, x, w]) => ({ str, x, y, w, h: 0.02 }));

/* --- exact match, spanning two runs, sub-run start/end positions --- */
{
  const spans = line(0.2, [
    ["The friction coefficient", 0.1, 0.24],
    ["µ = 0.12 at 300 K.", 0.36, 0.18],
  ]);
  const { match, boxes } = findQuoteBoxes(spans, "coefficient µ = 0.12");
  assert.equal(match, "exact", "plain quote matches exactly");
  assert.equal(boxes.length, 1, "single-line quote yields one merged box");
  const b = boxes[0];
  assert.ok(b.x > 0.1 && b.x < 0.36, "box starts inside the first run (at 'coefficient')");
  assert.ok(b.x + b.w < 0.36 + 0.18, "box ends before the second run's end");
  assert.ok(close(b.y, 0.2) && close(b.h, 0.02), "box keeps the line's vertical extent");
}

/* --- whitespace + case + unicode lookalikes still match exactly --- */
{
  const spans = line(0.3, [["The eﬀective ﬁlm thickness was 2 nm", 0.1, 0.4]]);
  assert.equal(findQuoteBoxes(spans, "the EFFECTIVE   film thickness").match, "exact", "ligatures, case and double spaces fold away");

  const mu = line(0.4, [["μ = 0.083 ± 0.002 at 20–30 nN", 0.1, 0.3]]);
  assert.equal(findQuoteBoxes(mu, "µ = 0.083 ± 0.002 at 20-30 nN").match, "exact", "micro sign vs mu, en dash vs hyphen fold away");
}

/* --- adjacent kerning runs join without a phantom space --- */
{
  const spans: TextSpan[] = [
    { str: "coeffi", x: 0.1, y: 0.2, w: 0.06, h: 0.02 },
    { str: "cient", x: 0.1601, y: 0.2, w: 0.05, h: 0.02 }, // ~0.005·h gap → same word
  ];
  assert.equal(findQuoteBoxes(spans, "coefficient").match, "exact", "split word runs rejoin via geometry");
}

/* --- hyphenation across a line break falls back to loose, one box per line --- */
{
  const spans: TextSpan[] = [
    ...line(0.2, [["measurements showed that fric-", 0.1, 0.3]]),
    ...line(0.225, [["tion forces increase with load", 0.1, 0.3]]),
  ];
  const { match, boxes } = findQuoteBoxes(spans, "friction forces increase");
  assert.equal(match, "loose", "hyphenated line break needs the loose tier");
  assert.equal(boxes.length, 2, "match spanning two lines yields two boxes");
  assert.ok(boxes[0].y < boxes[1].y, "boxes are per visual line");
}

/* --- same line, far-apart columns stay separate boxes --- */
{
  const spans = line(0.5, [
    ["left column text", 0.05, 0.2],
    ["right column text", 0.55, 0.2],
  ]);
  const { boxes } = findQuoteBoxes(spans, "left column text right column text");
  assert.equal(boxes.length, 2, "column gap is not smeared into one mark");
}

/* --- NFKC folding: math glyphs and superscripts --- */
{
  const spans = line(0.3, [["area of 1 cm² with 𝜇 = 0.05", 0.1, 0.3]]);
  assert.equal(findQuoteBoxes(spans, "1 cm2 with μ = 0.05").match, "exact", "superscript 2 and mathematical italic mu fold to plain forms");
}

/* --- partial tier: '...' elisions in extractor quotes --- */
{
  const spans = line(0.2, [["The estimated friction coefficient increases from μ = 0.02 to μ = 0.04 with load.", 0.1, 0.7]]);
  const { match, boxes } = findQuoteBoxes(spans, "The estimated friction coefficient increases from ... = 0.02 to ... = 0.04");
  assert.equal(match, "partial", "elided quote matches its pieces");
  assert.ok(boxes.length >= 1, "partial match still yields marks");
  const left = Math.min(...boxes.map((b) => b.x));
  const right = Math.max(...boxes.map((b) => b.x + b.w));
  assert.ok(left >= 0.1 - 1e-9 && left < 0.15, "marks start at the sentence start");
  assert.ok(right < 0.8, "marks end before the line does");
}

{
  // pieces on separate lines (table header row vs value row), within the window
  const spans: TextSpan[] = [
    ...line(0.3, [["Potential μ1 μ2 μ", 0.1, 0.3]]),
    ...line(0.33, [["OCP 0.012 0.211 0.198", 0.1, 0.3]]),
    ...line(0.36, [["OCP+0.5 V 0.001 0.442 0.310", 0.1, 0.3]]),
  ];
  const { match, boxes } = findQuoteBoxes(spans, "Potential μ1 μ2 ... OCP+0.5 V 0.001 0.442");
  assert.equal(match, "partial", "table-style elided quote matches across rows");
  assert.equal(boxes.length, 2, "one mark per matched row");
  assert.ok(boxes[0].y < boxes[1].y, "header and value row each get their own mark");
}

{
  const spans = line(0.2, [["nothing relevant here at all", 0.1, 0.3]]);
  const gone = findQuoteBoxes(spans, "friction coefficient ... 0.0065 at 150 nm/s");
  assert.equal(gone.match, null, "elided quote whose pieces are absent stays unmatched");

  const plain = findQuoteBoxes(spans, "completely different sentence with many words");
  assert.equal(plain.match, null);
}

/* --- partial tier: plain long quotes survive inserted PDF text blocks --- */
{
  const spans: TextSpan[] = [
    ...line(0.2, [["However, upon increasing the load beyond ∼30 nN", 0.1, 0.5]]),
    ...line(0.225, [["(≈2.4 GPa for a 2 nm-radius probe), a sharp drop in μ to", 0.1, 0.6]]),
    ...line(0.25, [["Figure 3. Angle-resolved X-ray photoelectron spectroscopy analysis", 0.1, 0.7]]),
  ];
  const { match, boxes } = findQuoteBoxes(
    spans,
    "upon increasing the load beyond ∼30 nN (≈2.4 GPa for a 2 nm-radius probe), a sharp drop in μ to 0.0013 was observed"
  );
  assert.equal(match, "partial", "long quote still anchors when a figure caption interrupts the PDF text stream");
  assert.ok(boxes.length >= 2, "the anchored sentence pieces are highlighted");
}

{
  const spans: TextSpan[] = [
    ...line(0.2, [["chain A8 ILs exhibited consistently low friction coefficients of", 0.1, 0.58]]),
    ...line(0.225, [["μ = 0.0032 and 0.0068, respectively, over the entire load range.", 0.1, 0.65]]),
  ];
  const { match, boxes } = findQuoteBoxes(
    spans,
    "Both short-chain A4 and medium-chain A8 ILs exhibited consistently low friction coefficients of μ = 0.0032 and 0.0068, respectively, over the entire load range."
  );
  assert.equal(match, "partial", "long quote anchors even when the start of the sentence is outside the page text stream");
  assert.ok(boxes.length >= 2, "the present tail of the quote is highlighted");
}

/* --- absent quote and too-short loose quotes report no match --- */
{
  const spans = line(0.2, [["completely unrelated sentence", 0.1, 0.3]]);
  const missing = findQuoteBoxes(spans, "quote that is not on the page");
  assert.equal(missing.match, null);
  assert.deepEqual(missing.boxes, []);

  const short = findQuoteBoxes(spans, "µ=1"); // loose form too short to trust
  assert.equal(short.match, null, "tiny loose quotes are rejected as ambiguous");
  assert.equal(findQuoteBoxes(spans, "").match, null, "empty quote matches nothing");
  assert.equal(findQuoteBoxes([], "anything").match, null, "no spans matches nothing");
}

/* --- boxes are clamped to the page --- */
{
  const spans: TextSpan[] = [{ str: "edge", x: 0.95, y: 0.99, w: 0.1, h: 0.03 }];
  const { boxes } = findQuoteBoxes(spans, "edge");
  const b = boxes[0];
  assert.ok(b.x + b.w <= 1 && b.y + b.h <= 1, "marks never overflow the page");
}

console.log("Evidence quote-location tests passed");

/* --- crop-space transform: clip, drop, re-normalize --- */
{
  const crop = { x: 0.2, y: 0.2, w: 0.5, h: 0.4 };
  const inside = boxesInCrop([{ x: 0.45, y: 0.4, w: 0.1, h: 0.02 }], crop);
  assert.equal(inside.length, 1);
  assert.ok(close(inside[0].x, 0.5) && close(inside[0].y, 0.5), "inner box re-normalizes to crop space");
  assert.ok(close(inside[0].w, 0.2) && close(inside[0].h, 0.05), "inner box scales by crop size");

  const outside = boxesInCrop([{ x: 0.8, y: 0.8, w: 0.1, h: 0.05 }], crop);
  assert.equal(outside.length, 0, "boxes outside the crop are dropped");

  const straddling = boxesInCrop([{ x: 0.1, y: 0.3, w: 0.2, h: 0.05 }], crop);
  assert.equal(straddling.length, 1);
  assert.ok(close(straddling[0].x, 0), "straddling box is clipped to the crop edge");
  assert.ok(close(straddling[0].w, 0.2), "only the inside part remains");

  assert.deepEqual(boxesInCrop([{ x: 0.1, y: 0.1, w: 0.1, h: 0.1 }], { x: 0, y: 0, w: 0, h: 0 }), [], "degenerate crop yields nothing");
}

console.log("Evidence crop-transform tests passed");
