import assert from "node:assert/strict";
import { formatProvenance, provenanceBadge } from "./schema";
import { ingest, toFields } from "./ingest";

/**
 * Locks the evidence-basis contract: weak evidence (inferred/assumed) is
 * visibly labeled, and basis/basisNote survive the edit round-trip
 * (record → toFields → ingest) instead of being silently dropped.
 */

// Badge: weak evidence is marked "~"; a pure assumption still gets a badge.
assert.equal(provenanceBadge({ page: 2 }), "p.2");
assert.equal(provenanceBadge({ page: 2, basis: "inferred" }), "~p.2");
assert.equal(provenanceBadge({ basis: "assumed" }), "assumed");
assert.equal(provenanceBadge({ figure: "Fig. 4a", basis: "direct" }), "Fig. 4a");

// Full formatting includes the basis and its note.
const formatted = formatProvenance({
  page: 2,
  section: "2. Material and methods",
  basis: "inferred",
  basisNote: "stated for the CV measurements, not AFM friction",
});
assert.ok(formatted.includes("inferred evidence (stated for the CV measurements, not AFM friction)"), formatted);

// Ingest round-trip: basis/basisNote are kept, invalid basis values are
// dropped, and a basis-only entry (assumption with no location) survives.
const draft = ingest({
  paper: { title: "T" },
  cation: "[BMIM]",
  anion: "[TFSI]",
  substrate: "Au(111)",
  temperature: "294 ± 1 K",
  load: "5 nN",
  cof: 0.1,
  provenance: [
    { field: "temperature", page: 2, quote: "at 294 ± 1 K", basis: "inferred", basisNote: "CV/methods" },
    { field: "load", quote: "5 nN", basis: "bogus" as any },
    { field: "cof", basis: "assumed", basisNote: "convention" },
  ],
});
assert.equal(draft.provenance?.temperature?.basis, "inferred");
assert.equal(draft.provenance?.temperature?.basisNote, "CV/methods");
assert.equal(draft.provenance?.load?.basis, undefined, "invalid basis is dropped");
assert.equal(draft.provenance?.load?.quote, "5 nN", "entry survives an invalid basis");
assert.equal(draft.provenance?.cof?.basis, "assumed", "basis-only entry is kept");

const flat = toFields(draft);
const t = flat.provenance?.find((p) => p.field === "temperature");
assert.equal(t?.basis, "inferred", "toFields exports basis for the editor round-trip");
assert.equal(t?.basisNote, "CV/methods");

console.log("Provenance evidence-basis tests passed");
