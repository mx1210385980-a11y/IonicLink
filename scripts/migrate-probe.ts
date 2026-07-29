/**
 * One-time data fix for tribology probe fields (re-runnable, idempotent).
 *
 * Early extractions copied the paper's entire probe-describing SENTENCE into
 * extended.probe and attached no provenance. This script:
 *   1. rewrites probe/probeType to key data — material (+ model/maker) and
 *      geometry + size — using only facts present in the source text;
 *   2. attaches provenance.probe with the page and a VERBATIM quote of the
 *      describing sentence, located in the stored source pages, so the source
 *      viewer can highlight it on the page image;
 *   3. verifies every probe quote (new and pre-existing) resolves against the
 *      source PDF via the evidence locator.
 *
 * Transforms are value-pattern based: already-concise values don't match and
 * existing provenance is never overwritten. Probe sizes are emitted ONLY when
 * captured from the old value or the located sentence — never guessed.
 *
 * Run: npx tsx scripts/migrate-probe.ts [--dry]
 */
import path from "node:path";
import Database from "better-sqlite3";
import { getSource } from "../lib/db";
import { findEvidenceOnPage } from "../lib/sources";
import type { FieldProvenance, IonicRecord, SourceDoc } from "../lib/schema";

const DRY = process.argv.includes("--dry");
const DOMAIN = "tribology" as const;
const DB_PATH = path.join(process.cwd(), "data", "tribology.db");

interface ProbeFix {
  probe: string;
  probeType?: string; // undefined = keep current
  /** Verbatim page-text fragments that anchor the probe-describing sentence. */
  anchors: string[];
}

/** Sentence-shaped probe values → key data. Concise values match no rule. */
function planFix(probe: string, probeType: string | undefined): ProbeFix | null {
  if (/SNL probes \(silicon nitride/i.test(probe)) {
    const r = probe.match(/radius of (\d+(?:\.\d+)?)\s*nm/i);
    return {
      probe: "silicon nitride (SNL, Bruker)",
      probeType: r ? `Tip · ${r[1]} nm` : probeType,
      anchors: ["SNL probes (silicon nitride"],
    };
  }
  if (/sharp silicon AFM tips \(NSC36/i.test(probe)) {
    // No tip radius is stated anywhere in this source — geometry only.
    return {
      probe: "silicon (NSC36, Mikromasch)",
      probeType: "sharp tip",
      anchors: ["sharp silicon AFM tips (NSC36, Mikromasch)"],
    };
  }
  const silica = probe.match(/(\d+(?:\.\d+)?)[-\s]?[μµ]m silica sphere/i);
  if (silica) {
    return {
      probe: "silica",
      probeType: `Colloid · Ø ${silica[1]} μm`,
      anchors: ["A silica colloid (diameter", "silica colloid"],
    };
  }
  if (/^mica surface$/i.test(probe)) {
    return {
      probe: "mica",
      probeType: "SFA surface",
      anchors: ["surface force apparatus (SFA) was used to measure", "surface force apparatus (SFA)"],
    };
  }
  return null;
}

/** First page containing an anchor → {page, quote, context}, quote = the containing sentence. */
function locateProbeEvidence(doc: SourceDoc, anchors: string[]): FieldProvenance | null {
  for (const { page, text } of doc.pages) {
    const flat = text.replace(/\s+/g, " ");
    for (const anchor of anchors) {
      const at = flat.indexOf(anchor);
      if (at < 0) continue;
      const quote = sentenceAround(flat, at, anchor.length, 240);
      const context = sentenceAround(flat, at, anchor.length, 420);
      return { page, quote, ...(context !== quote ? { context } : {}) };
    }
  }
  return null;
}

/** Expand a match to sentence boundaries, capped at maxLen around the anchor. */
function sentenceAround(flat: string, at: number, len: number, maxLen: number): string {
  // ". " followed by anything non-lowercase starts a sentence ("0.7" and "e.g. so" don't split).
  const boundary = /[.!?]\s+(?=[^a-z\s])/g;
  let start = 0;
  let m: RegExpExecArray | null;
  while ((m = boundary.exec(flat)) && m.index + m[0].length <= at) start = m.index + m[0].length;
  boundary.lastIndex = at + len;
  const endMatch = boundary.exec(flat);
  let end = endMatch ? endMatch.index + 1 : flat.length;
  if (end - start > maxLen) {
    // keep the anchor centered inside the cap, snapped to word boundaries
    start = Math.max(start, flat.lastIndexOf(" ", Math.max(0, at - Math.floor((maxLen - len) / 2))) + 1);
    end = Math.min(end, (flat.indexOf(" ", start + maxLen) + 1 || flat.length + 1) - 1);
  }
  // drop a leading "■ RESULTS "-style section marker — the rest stays a contiguous verbatim run
  return flat
    .slice(start, end)
    .trim()
    .replace(/^■\s*(?:[A-Z][A-Z\s]{2,}?\s)?(?=[A-Z(])/, "");
}

async function main() {
  const db = new Database(DB_PATH);
  const rows = db.prepare("SELECT id, payload FROM records ORDER BY id").all() as { id: string; payload: string }[];
  const update = db.prepare("UPDATE records SET payload=? WHERE id=?");
  const sources = new Map<string, SourceDoc | null>();

  let changed = 0;
  const toVerify: { id: string; sourceId: string; prov: FieldProvenance }[] = [];

  for (const row of rows) {
    const rec = JSON.parse(row.payload) as IonicRecord;
    const probe = rec.extended?.probe;
    if (!probe) continue;

    const fix = planFix(probe, rec.extended.probeType);
    const hasProv = !!rec.provenance?.probe;
    let touched = false;

    if (fix && (fix.probe !== probe || (fix.probeType && fix.probeType !== rec.extended.probeType))) {
      console.log(`${row.id}: probe "${probe}" · "${rec.extended.probeType ?? ""}"`);
      console.log(`        →     "${fix.probe}" · "${fix.probeType ?? rec.extended.probeType ?? ""}"`);
      rec.extended.probe = fix.probe;
      if (fix.probeType) rec.extended.probeType = fix.probeType;
      touched = true;
    }

    if (fix && !hasProv && rec.sourceId) {
      if (!sources.has(rec.sourceId)) sources.set(rec.sourceId, getSource(DOMAIN, rec.sourceId));
      const doc = sources.get(rec.sourceId);
      const prov = doc && locateProbeEvidence(doc, fix.anchors);
      if (prov) {
        console.log(`${row.id}: probe evidence ← p.${prov.page} "${prov.quote?.slice(0, 80)}…"`);
        rec.provenance = { ...rec.provenance, probe: prov };
        touched = true;
      } else {
        console.log(`${row.id}: WARN — no probe sentence located in source; provenance left unset`);
      }
    }

    if (touched) {
      changed++;
      if (!DRY) update.run(JSON.stringify(rec), row.id);
    }
    if (rec.provenance?.probe && rec.sourceId) toVerify.push({ id: row.id, sourceId: rec.sourceId, prov: rec.provenance.probe });
  }

  console.log(`\n${DRY ? "[dry run] would update" : "updated"} ${changed} of ${rows.length} records`);

  if (!DRY) {
    console.log("\nverifying probe quotes against source PDFs:");
    for (const v of toVerify) {
      const res = v.prov.page != null && v.prov.quote ? await findEvidenceOnPage(DOMAIN, v.sourceId, v.prov.page, v.prov.quote) : null;
      console.log(`  ${v.id}: p.${v.prov.page} → ${res?.match ?? "NOT LOCATED"}`);
    }
  }
}

main();
