import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ClientModule } from "@/components/registry.client";
import { ingest as ingestConductivity } from "@/lib/conductivity/ingest";
import { conductivityClientModule } from "./ConductivityDatabaseView";
import {
  buildReviewMatrixCells,
  buildSharedReviewCells,
  ReviewWorkbench,
  reviewCellNeedsVerification,
  reviewEvidenceLookupUrl,
  reviewIssueBucket,
  reviewRecordHasLowConfidence,
  reviewRecordHasMissingEvidence,
  reviewRecordMatchesFilter,
} from "./ReviewWorkbench";

const direct = { page: 3, quote: "reported value", basis: "direct" as const };

function record(id: string, cof: number, load: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    status: "review",
    paper: { title: "Potential sweep paper" },
    core: {
      ionicLiquid: { cation: "[OMIm]", anion: "[Tf2N]" },
      substrate: "HOPG",
      temperature: { raw: "not stated", value: null, unit: "", std: 298.15, stdUnit: "K" },
      load: { raw: load, value: 10, unit: "nN", std: 1e-8, stdUnit: "N" },
      cof,
    },
    extended: {
      method: "AFM",
      velocity: { raw: "6 μm/s", value: 6, unit: "μm/s", std: 6e-6, stdUnit: "m/s" },
      potential: { raw: "-2.0 V", value: -2, unit: "V", std: -2, stdUnit: "V" },
    },
    provenance: {
      cation: direct,
      anion: direct,
      substrate: direct,
      temperature: direct,
      load: direct,
      cof: direct,
      velocity: direct,
      potential: direct,
    },
    confidence: 0.96,
    sourceId: "source-1",
    ...overrides,
  };
}

const records = [record("#035", 0.01, ">10 nN"), record("#036", 0.025, "20 nN")];
const cells = buildReviewMatrixCells(records[0], "tribology", "raw");
assert.equal(cells.find((cell) => cell.key === "cof")?.value, "0.0100");
assert.equal(cells.find((cell) => cell.key === "cof")?.primary, true);
assert.equal(cells.find((cell) => cell.key === "load")?.value, ">10 nN");
assert.equal(reviewRecordHasMissingEvidence(records[0], "tribology"), false);
assert.equal(reviewCellNeedsVerification({ key: "cation", label: "Cation", value: "[OMIm]" }), false);
assert.equal(reviewCellNeedsVerification({ key: "anion", label: "Anion", value: "[Tf2N]", provenance: direct }), true);
assert.equal(reviewCellNeedsVerification({ key: "temperature", label: "Temp", value: "not stated", editableValue: "not stated", provenance: { basis: "assumed" } }), false);
assert.equal(reviewCellNeedsVerification({ key: "temperature", label: "Temp", value: "room temperature" }), false);
assert.equal(reviewCellNeedsVerification({ key: "temperature", label: "Temp", value: "298 K", provenance: direct }), true);
assert.equal(
  reviewRecordHasMissingEvidence({ ...records[0], provenance: { cof: direct } }, "tribology"),
  false,
  "shared identity fields do not create a record-level evidence gap when the measured result is sourced"
);
assert.equal(
  reviewRecordHasMissingEvidence({ ...records[0], provenance: { ...records[0].provenance, cof: undefined } }, "tribology"),
  true
);
assert.equal(reviewRecordHasMissingEvidence({ provenance: { conductivity: direct } }, "conductivity"), false);
assert.equal(reviewRecordHasMissingEvidence({ provenance: { diffusion: direct } }, "diffusion"), false);
assert.equal(reviewRecordHasMissingEvidence({ provenance: { temperature: direct } }, "conductivity"), true);
assert.equal(reviewRecordHasMissingEvidence({ provenance: { temperature: direct } }, "diffusion"), true);
assert.equal(
  reviewEvidenceLookupUrl("tribology", "source/1", 3, "μ = 0.010"),
  "/api/tribology/source/source%2F1/page/3?format=evidence&q=%CE%BC%20%3D%200.010"
);

const sharedSourceRecords = [
  record("#shared-1", 0.01, "10 nN", {
    provenance: { ...record("seed", 0.01, "10 nN").provenance, load: undefined },
    sourceId: "source-without-load-citation",
  }),
  record("#shared-2", 0.02, "10 nN", {
    sourceId: "source-with-load-citation",
  }),
];
const sharedReviewCells = buildSharedReviewCells(sharedSourceRecords, "tribology", "raw");
const sharedLoad = sharedReviewCells.find((cell) => cell.key === "load");
assert.equal(sharedLoad?.value, "10 nN");
assert.equal(sharedLoad?.recordId, "#shared-2", "shared fields use provenance from any record in the paper group");
assert.equal(sharedLoad?.sourceId, "source-with-load-citation");
assert.equal(sharedLoad?.provenance?.page, 3);
assert.equal(sharedLoad?.coverage, 2);
assert.equal(sharedLoad?.total, 2);

const clientModule: ClientModule = {
  label: "Tribology",
  tagline: "Review fixture",
  Card: () => null,
  Editor: () => null,
  coreCompleteness: (candidate) => ({ complete: candidate.core.cof != null, missing: candidate.core.cof == null ? ["COF"] : [] }),
  facet: { label: "Scale", options: [{ value: "all", label: "All" }] },
  listStats: () => [],
  conditionItems: () => [],
  systemFacets: () => [],
};

assert.equal(reviewIssueBucket(records[0], "tribology", clientModule.coreCompleteness), "ready");
assert.equal(
  reviewIssueBucket({ ...records[0], core: { ...records[0].core, cof: null } }, "tribology", clientModule.coreCompleteness),
  "needs"
);
assert.equal(
  reviewIssueBucket({ ...records[0], confidence: 0.65 }, "tribology", clientModule.coreCompleteness),
  "ready",
  "low extraction confidence is advisory and does not override approval readiness"
);
const lowConfidenceReady = { ...records[0], confidence: 0.65 };
assert.equal(reviewRecordHasLowConfidence(lowConfidenceReady), true);
assert.equal(reviewRecordMatchesFilter(lowConfidenceReady, "ready", "tribology", clientModule.coreCompleteness), true);
assert.equal(reviewRecordMatchesFilter(lowConfidenceReady, "low-confidence", "tribology", clientModule.coreCompleteness), true);
assert.equal(
  reviewIssueBucket({ ...records[0], provenance: { ...records[0].provenance, cof: undefined } }, "tribology", clientModule.coreCompleteness),
  "missing-evidence"
);
assert.equal(
  reviewIssueBucket({ ...records[0], extraction: { source: "mock" } }, "tribology", clientModule.coreCompleteness),
  "mock"
);

const html = renderToStaticMarkup(
  createElement(ReviewWorkbench, {
    domain: "tribology",
    records,
    units: "raw",
    clientModule,
    queryReady: true,
    mutationBusy: false,
    selected: new Set<string>(),
    editingId: null,
    onToggle: () => {},
    onEdit: () => {},
    onQuickEdit: async () => true,
    onApprove: () => {},
    onReject: () => {},
  })
);

assert.match(html, /data-testid="review-workbench"/);
assert.match(html, />Papers</);
assert.match(html, />Records</);
assert.match(html, /Potential sweep paper/);
assert.match(html, /data-testid="review-ionic-liquid-title"/);
assert.match(html, /data-testid="review-field-selector"/);
assert.doesNotMatch(html, /Shared evidence|All record fields/);
assert.equal((html.match(/aria-label="Record fields"/g) ?? []).length, 1);
assert.equal((html.match(/data-field="cof"/g) ?? []).length, 1);
assert.match(html, /aria-label="Inspect Cation"/);
assert.match(html, /data-testid="review-matrix-scroller"/);
assert.match(html, /data-testid="review-mobile-record"/);
assert.equal((html.match(/data-testid="review-matrix-row"/g) ?? []).length, 2);
assert.match(html, /data-testid="review-evidence-inspector"/);
assert.match(html, /data-testid="review-source-page"/);
assert.match(html, /data-testid="review-evidence-summary"/);
assert.match(html, /Field evidence/);
assert.match(html, /Source evidence/);
assert.match(html, /Verbatim source excerpt/);
assert.match(html, /Quick edit this field/);
assert.match(html, /Open full evidence/);
assert.doesNotMatch(html, /Supporting context/);
assert.match(html, /Approve &amp; next/);

const defaultsRecord = record("#defaults", 0.01, "10 nN", {
  provenance: {
    ...record("seed", 0.01, "10 nN").provenance,
    cation: undefined,
    anion: undefined,
    temperature: { basis: "assumed" as const },
  },
});
const defaultsHtml = renderToStaticMarkup(
  createElement(ReviewWorkbench, {
    domain: "tribology",
    records: [defaultsRecord],
    units: "raw",
    clientModule,
    queryReady: true,
    mutationBusy: false,
    selected: new Set<string>(),
    editingId: null,
    onToggle: () => {},
    onEdit: () => {},
    onQuickEdit: async () => true,
    onApprove: () => {},
    onReject: () => {},
  })
);
assert.match(defaultsHtml, /data-testid="review-ionic-liquid-title"[^>]*>[\s\S]*?\[OMIm\] \/ \[Tf2N\]/);
assert.doesNotMatch(defaultsHtml, /data-field="cation"/);
assert.doesNotMatch(defaultsHtml, /data-field="anion"/);
assert.doesNotMatch(defaultsHtml, /data-field="temperature"/);
assert.doesNotMatch(defaultsHtml, /data-shared-field="cation"/);
assert.doesNotMatch(defaultsHtml, /data-shared-field="anion"/);
assert.doesNotMatch(defaultsHtml, /data-shared-field="temperature"/);
assert.match(defaultsHtml, /data-field="substrate"/);
assert.match(defaultsHtml, /data-field="cof"/);

console.log("ReviewWorkbench comparison and issue-routing tests passed");

const electrical = {
  ...ingestConductivity({ paper: { title: "Electrical series" }, cation: "[EMIM]", anion: "[TFSI]", capacitance: "120 pF", surface: "Pt",
    provenance: [{ field: "capacitance", ...direct }] }), id: "cap", status: "review", createdAt: "",
};
assert.equal(reviewRecordHasMissingEvidence(electrical, "conductivity"), false, "a sourced capacitance-only record does not require conductivity evidence");
assert.equal(reviewRecordHasMissingEvidence({ ...electrical, provenance: {} }, "conductivity"), true);
const electricalCells = buildReviewMatrixCells(electrical, "conductivity", "raw");
assert.equal(electricalCells.find((cell) => cell.primary)?.key, "capacitance");
assert.equal(electricalCells.find((cell) => cell.key === "capacitance")?.editableValue, "120 pF");
const resistance = { ...electrical, id: "rct", core: { ...electrical.core, capacitance: null, chargeTransferResistance: { raw: "4.2 kΩ", std: 4200, stdUnit: "Ω" } }, provenance: { chargeTransferResistance: direct } };
const electricalHtml = renderToStaticMarkup(createElement(ReviewWorkbench, {
  domain: "conductivity", records: [electrical, resistance], units: "raw", clientModule: conductivityClientModule,
  queryReady: true, mutationBusy: false, selected: new Set<string>(), editingId: null,
  onToggle: () => {}, onEdit: () => {}, onQuickEdit: async () => true, onApprove: () => {}, onReject: () => {},
}));
assert.match(electricalHtml, /Capacitance/);
assert.match(electricalHtml, /Charge-transfer resistance/);
assert.match(electricalHtml, /120 pF/);
assert.match(electricalHtml, /4\.2 kΩ/);
