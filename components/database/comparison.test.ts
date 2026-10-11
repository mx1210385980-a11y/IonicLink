import assert from "node:assert/strict";
import { buildComparisonCsv, buildQualitySummary, compareField, comparisonCsvCell, comparisonWarnings, getFieldEvidence, getRecordEvidence, hasFieldValue } from "./comparison";
import type { AnalysisField, AnalysisRecord } from "./analysisTypes";
import { parseQuantity } from "@/lib/units";

function record(id: string, load = "1 N"): AnalysisRecord {
  return { id, status: "official", createdAt: "2026-09-12", paper: { title: `Paper ${id}`, doi: "10.1/example" }, sourceId: `source-${id}`, core: { load: parseQuantity(load, "force"), cof: 0.1 }, extended: { method: "AFM", scale: "nano" }, flexible: [] };
}

const load: AnalysisField = { key: "load", label: "Load", provenanceKey: "load", numeric: true, getValue: (r) => r.core.load?.std ?? null, getQuantity: (r) => r.core.load, format: (r) => r.core.load?.raw ?? "—" };
const metric: AnalysisField = { key: "metric", label: "COF", provenanceKey: "cof", numeric: true, getValue: (r) => r.core.cof, format: (r) => String(r.core.cof) };
const textField = (key: string): AnalysisField => ({ key, label: key, provenanceKey: key, getValue: (r) => r.extended[key] ?? null, format: (r) => r.extended[key] ?? "—" });

const a = record("a");
const b = record("b", "1000 mN");
assert.equal(compareField([a, b], load).state, "same", "different original units with equal SI values match");
b.provenance = { load: { basis: "assumed" } };
assert.equal(compareField([a, b], load).state, "different", "assumed and unassessed quantities must differ");
b.provenance = {};
b.core.load = null;
assert.equal(compareField([a, b], load).state, "missing");
assert.equal(compareField([a, b], load).missing, 1);
assert.equal(compareField([record("a", "1-5 N"), record("b", "2-5 N")], load).state, "different", "range lower bounds matter even with matching upper values");
assert.equal(compareField([record("a", "1-5 N"), record("b", "1000-5000 mN")], load).state, "same", "range bounds compare canonically across units");
assert.equal(compareField([record("a", ">5 N"), record("b", "<5 N")], load).state, "different", "inequality direction matters");
assert.equal(getFieldEvidence(a, metric), "unassessed");
a.provenance = { cof: { page: 2, quote: "cof = 0.1" } };
assert.equal(getRecordEvidence(a, [metric]), "unassessed", "a located source without basis is unassessed");
a.provenance.cof.basis = "direct";
assert.equal(getRecordEvidence(a, [metric]), "direct");

b.extended = { method: "Tribometer", scale: "macro", waterContent: "unknown" };
const fields = [metric, load, textField("method"), textField("scale"), textField("waterContent")];
const warnings = comparisonWarnings([a, b], fields);
assert.ok(warnings.some((warning) => warning.includes("Multiple measurement methods")));
assert.ok(warnings.some((warning) => warning.includes("Multiple measurement scales")));
assert.ok(warnings.some((warning) => warning.includes("Water content is unknown")));
assert.equal(hasFieldValue(b, textField("waterContent")), false, "unknown water content is missing, not matching conditions");
const quality = buildQualitySummary([a, b], fields);
assert.equal(quality.evidence.direct, 1);
assert.equal(quality.evidence.unassessed, 1);
assert.equal(quality.availability.find(({ field }) => field.key === "waterContent")?.available, 0);
assert.equal(quality.availability.find(({ field }) => field.key === "metric")?.located, 1);

assert.equal(comparisonCsvCell('a,"b"\nc'), '"a,""b""\nc"');
assert.equal(comparisonCsvCell("=1+1"), '"\'=1+1"');
assert.equal(comparisonCsvCell("  @formula"), '"\'  @formula"');
const csv = buildComparisonCsv([a, b], fields, "raw");
assert.ok(csv.includes("source-a"));
assert.ok(csv.includes("10.1/example"));
assert.ok(csv.includes("cof = 0.1"));
assert.ok(csv.includes('"COF — evidence","","direct","unassessed"'));
console.log("Database comparison and coverage regression tests passed");
