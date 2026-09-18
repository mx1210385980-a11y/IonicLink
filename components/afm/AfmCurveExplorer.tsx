"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { MoleculeView } from "@/components/MoleculeView";
import type { AfmCurveDataset, AfmCurveRecord } from "@/lib/afm/afmCurves";
import { AFM_DIGITIZATION_DRAFT_STORAGE_KEY, afmDraftToCurveRecord, parseStoredAfmDrafts } from "@/lib/afm/digitizationDraft";
import { afmCurveFileStem, buildAfmCurveCsv, buildAfmCurveJson, type AfmExportFormat } from "@/lib/afm/exportCurve";
import type { CuratedField, FieldReviewStatus } from "@/lib/afm/interfacialExperiment";
import { resolveIonStructure } from "@/lib/ionStructures";
import { deriveAfmCurveDependencies, type AfmCurveDependency } from "@/lib/afm/curveDependencies";

type CollectionFilter = "all" | "qualified-new" | "legacy-cleaned";
type ReviewFilter = "all" | "verified" | "paper-suggested" | "needs-review" | "legacy-import";

const REVIEW_FILTER_HELP: Record<ReviewFilter, string> = {
  all: "Shows every curve allowed by the collection, paper-focus and search filters.",
  verified: "Only curves whose complete required metadata has been checked against a source.",
  "paper-suggested": "A likely source paper was found automatically, but the match still needs human confirmation.",
  "needs-review": "One or more required metadata fields or source links still need review.",
  "legacy-import": "Representative curves retained from the old prediction platform; these are not raw figure digitizations.",
};

const STATUS_LABELS = {
  "source-verified": "Source verified",
  "pairing-qualified": "Pairing qualified",
  "legacy-unverified": "Legacy / unverified",
} as const;

const FIELD_STATUS_LABELS: Record<FieldReviewStatus, string> = {
  verified: "Verified",
  reported: "Reported",
  inferred: "Inferred",
  "legacy-import": "Legacy import",
  "not-reported": "Not reported",
  unreviewed: "Needs review",
};

export function AfmCurveExplorer({ dataset }: { dataset: AfmCurveDataset }) {
  const [collection, setCollection] = useState<CollectionFilter>("all");
  const [reviewFilter, setReviewFilter] = useState<ReviewFilter>("all");
  const [query, setQuery] = useState("");
  const [paperFocus, setPaperFocus] = useState<{ doi: string; curveIds: string[] } | null>(null);
  const [localDraftCurves, setLocalDraftCurves] = useState<AfmCurveRecord[]>([]);
  const [selectedId, setSelectedId] = useState(
    dataset.curves.find((curve) => curve.context.electrochemistry.relatedMeasurements.length > 0)?.id ??
      dataset.curves.find((curve) => curve.review.state === "verified")?.id ??
      dataset.curves[0]?.id ?? "",
  );
  const allCurves = useMemo(() => [...localDraftCurves, ...dataset.curves], [dataset.curves, localDraftCurves]);

  useEffect(() => {
    const loadDrafts = (event?: Event) => {
      const drafts = parseStoredAfmDrafts(window.localStorage.getItem(AFM_DIGITIZATION_DRAFT_STORAGE_KEY));
      const records = drafts.map(afmDraftToCurveRecord);
      setLocalDraftCurves(records);
      const requestedId = (event as CustomEvent<{ ids?: string[] }> | undefined)?.detail?.ids?.[0];
      if (requestedId && records.some((record) => record.id === requestedId)) {
        setPaperFocus(null);
        setCollection("all");
        setReviewFilter("needs-review");
        setQuery("");
        setSelectedId(requestedId);
      }
    };
    loadDrafts();
    window.addEventListener("ioniclink:afm-drafts-updated", loadDrafts);
    return () => window.removeEventListener("ioniclink:afm-drafts-updated", loadDrafts);
  }, []);

  const reviewScope = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    const focusedIds = paperFocus ? new Set(paperFocus.curveIds) : null;
    return allCurves.filter((curve) => {
      if (focusedIds && !focusedIds.has(curve.id)) return false;
      if (collection !== "all" && curve.collection !== collection) return false;
      if (!needle) return true;
      return [
        curve.id,
        curve.label,
        curve.ionicLiquid,
        curve.cation,
        curve.anion,
        curve.context.interface.substrate.value,
        curve.source.folder,
        curve.source.pdfFile,
        curve.source.doi,
        curve.paperCandidate?.candidate?.pdfFile,
        curve.paperCandidate?.candidate?.title,
        curve.paperCandidate?.candidate?.doi,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLocaleLowerCase().includes(needle));
    });
  }, [allCurves, collection, paperFocus, query]);

  const reviewCounts = useMemo<Record<ReviewFilter, number>>(() => ({
    all: reviewScope.length,
    verified: reviewScope.filter((curve) => matchesReviewFilter(curve, "verified")).length,
    "paper-suggested": reviewScope.filter((curve) => matchesReviewFilter(curve, "paper-suggested")).length,
    "needs-review": reviewScope.filter((curve) => matchesReviewFilter(curve, "needs-review")).length,
    "legacy-import": reviewScope.filter((curve) => matchesReviewFilter(curve, "legacy-import")).length,
  }), [reviewScope]);

  const filtered = useMemo(
    () => reviewScope.filter((curve) => matchesReviewFilter(curve, reviewFilter)),
    [reviewFilter, reviewScope],
  );

  useEffect(() => {
    const handlePaperMatch = (event: Event) => {
      const detail = (event as CustomEvent<{ doi?: string; curveIds?: string[] }>).detail;
      if (!detail?.doi || !Array.isArray(detail.curveIds) || !detail.curveIds.length) return;
      const matchedIds = detail.curveIds.filter((id) => allCurves.some((curve) => curve.id === id));
      if (!matchedIds.length) return;
      setPaperFocus({ doi: detail.doi, curveIds: matchedIds });
      setCollection("all");
      setReviewFilter("all");
      setQuery("");
      setSelectedId(matchedIds[0]);
    };
    window.addEventListener("ioniclink:afm-paper-match", handlePaperMatch);
    return () => window.removeEventListener("ioniclink:afm-paper-match", handlePaperMatch);
  }, [allCurves]);

  useEffect(() => {
    if (!filtered.some((curve) => curve.id === selectedId)) setSelectedId(filtered[0]?.id ?? "");
  }, [filtered, selectedId]);

  const selected = filtered.find((curve) => curve.id === selectedId) ?? filtered[0] ?? null;

  return (
    <div className="space-y-5">
      <DataReadiness dataset={dataset} localDraftCount={localDraftCurves.length} />

      <section id="afm-curve-browser" className="panel scroll-mt-4 overflow-hidden">
        <div className="border-b border-ink-200 bg-white/80 p-4 sm:p-5">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <p className="label-eyebrow text-brand-700">Curve browser</p>
              <h2 className="mt-1 text-xl font-semibold tracking-tight text-ink-950">Measured AFM force curves</h2>
              <p className="mt-1 max-w-2xl text-sm text-ink-600">
                Browse digitized curves together with field-level review status and electrochemical context.
              </p>
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              <label className="sr-only" htmlFor="afm-collection">Data collection</label>
              <select
                id="afm-collection"
                value={collection}
                onChange={(event) => setCollection(event.target.value as CollectionFilter)}
                className="min-h-10 rounded-lg border border-ink-200 bg-white px-3 text-sm text-ink-800 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100"
              >
                <option value="all">All collections</option>
                <option value="qualified-new">Qualified new curves</option>
                <option value="legacy-cleaned">Manual / legacy curves</option>
              </select>
              <label className="sr-only" htmlFor="afm-review">Metadata review</label>
              <select
                id="afm-review"
                value={reviewFilter}
                onChange={(event) => setReviewFilter(event.target.value as ReviewFilter)}
                className="min-h-10 rounded-lg border border-ink-200 bg-white px-3 text-sm text-ink-800 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100"
              >
                <option value="all">All review states ({reviewCounts.all})</option>
                <option value="verified">Fully metadata verified ({reviewCounts.verified})</option>
                <option value="paper-suggested">Paper link suggested ({reviewCounts["paper-suggested"]})</option>
                <option value="needs-review">Needs metadata review ({reviewCounts["needs-review"]})</option>
                <option value="legacy-import">Manual / legacy source ({reviewCounts["legacy-import"]})</option>
              </select>
              <label className="sr-only" htmlFor="afm-search">Search AFM curves</label>
              <input
                id="afm-search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search ion, surface, DOI…"
                className="min-h-10 w-full rounded-lg border border-ink-200 bg-white px-3 text-sm text-ink-800 placeholder:text-ink-400 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100 sm:w-64"
              />
            </div>
          </div>
          <div className="mt-2 flex flex-col gap-1 text-xs text-ink-500 sm:flex-row sm:items-center sm:justify-between">
            <p>{REVIEW_FILTER_HELP[reviewFilter]}</p>
            <p className="shrink-0 font-mono">Counts also respect collection, paper focus and search.</p>
          </div>
          {paperFocus ? (
            <div className="mt-3 flex flex-col gap-2 rounded-xl border border-brand-200 bg-brand-50/70 px-3 py-2.5 text-xs text-brand-950 sm:flex-row sm:items-center sm:justify-between">
              <span>
                Matched uploaded paper <span className="font-mono">{paperFocus.doi}</span>. The browser shows {paperFocus.curveIds.length} existing curve record(s).
              </span>
              <button type="button" onClick={() => setPaperFocus(null)} className="w-fit font-semibold text-brand-800 hover:text-brand-950">
                Show all curves
              </button>
            </div>
          ) : null}
        </div>

        <div className="grid min-h-[38rem] lg:grid-cols-[20rem_minmax(0,1fr)]">
          <div className="max-h-[48rem] overflow-y-auto border-b border-ink-200 bg-ink-50/60 p-2 lg:border-b-0 lg:border-r">
            <p className="px-2 py-1.5 font-mono text-[10px] font-semibold uppercase tracking-eyebrow text-ink-500">
              {filtered.length} curve{filtered.length === 1 ? "" : "s"}
            </p>
            {filtered.length ? (
              <ul className="space-y-1">
                {filtered.map((curve) => (
                  <li key={curve.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(curve.id)}
                      className={`w-full rounded-lg border px-3 py-2.5 text-left transition focus:outline-none focus:ring-2 focus:ring-brand-200 ${
                        selected?.id === curve.id
                          ? "border-brand-300 bg-white shadow-sm"
                          : "border-transparent hover:border-ink-200 hover:bg-white/80"
                      }`}
                    >
                      <span className="block truncate text-sm font-semibold text-ink-900">{curveBrowserTitle(curve)}</span>
                      <span className="mt-1 flex items-center justify-between gap-2 text-[11px] text-ink-500">
                        <span className="flex min-w-0 items-center gap-1.5 truncate"><CurveToneDot curve={curve} /><span className="truncate">{curveBrowserSubtitle(curve)}</span></span>
                        <span className="shrink-0 font-mono">{curve.review.verifiedPercent}% verified</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="rounded-lg border border-dashed border-ink-200 bg-white p-4 text-sm text-ink-600">
                <p>No curves match this combination of collection, review state, paper focus and search.</p>
                <button
                  type="button"
                  onClick={() => {
                    setCollection("all");
                    setReviewFilter("all");
                    setQuery("");
                    setPaperFocus(null);
                  }}
                  className="mt-2 font-semibold text-brand-700 hover:text-brand-900"
                >
                  Reset all curve filters
                </button>
              </div>
            )}
          </div>

          <div className="min-w-0 p-4 sm:p-6">{selected ? <CurveDetail curve={selected} comparisonCurves={allCurves} /> : null}</div>
        </div>
      </section>
    </div>
  );
}

function DataReadiness({ dataset, localDraftCount }: { dataset: AfmCurveDataset; localDraftCount: number }) {
  const summary = dataset.summary;
  return (
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
      <Metric label="Browsable curves" value={summary.totalCurves + localDraftCount} detail={`${summary.qualifiedNewCurves} new + ${summary.legacyCleanedCurves} legacy${localDraftCount ? ` + ${localDraftCount} local review` : ""}`} />
      <Metric label="Metadata verified" value={summary.metadataCompleteCurves} detail="all required fields checked" tone="verified" />
      <Metric label="Model ready" value={summary.modelEligibleCurves} detail="complete digitization + verified source" tone="verified" />
      <Metric label="Paper suggestions" value={summary.paperSuggestedCurves} detail={`${summary.paperSuggestedFolderGroups} folders await review`} tone="suggested" />
      <Metric label="Ionic identity" value={summary.curvesWithIonicIdentity} detail="name, cation and anion present" />
      <Metric label="Applied potential" value={summary.curvesWithPotential} detail="linked to individual curves" />
      <div className="panel border-amber-200 bg-amber-50/80 p-4 sm:col-span-2 xl:col-span-6">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="font-mono text-[10px] font-semibold uppercase tracking-eyebrow text-amber-800">Electrochemical linkage</p>
            <p className="mt-1 text-sm leading-6 text-amber-950">
              Direct AFM-linked values remain separate from related measurements. One curve now links to a same-paper EIS capacitance result; no electric field is inferred when the paper does not report one.
            </p>
          </div>
          <div className="flex shrink-0 gap-2 text-xs">
            <CoverageChip label="Direct capacitance" value={summary.curvesWithCapacitance} />
            <CoverageChip label="Related capacitance" value={summary.curvesWithRelatedCapacitance} />
            <CoverageChip label="Electric field" value={summary.curvesWithElectricField} />
          </div>
        </div>
      </div>
    </section>
  );
}

function Metric({ label, value, detail, tone = "default" }: { label: string; value: number; detail: string; tone?: "default" | "verified" | "suggested" }) {
  const labelClass = tone === "verified" ? "text-brand-700" : tone === "suggested" ? "text-amber-700" : "text-ink-500";
  const valueClass = tone === "verified" ? "text-brand-800" : tone === "suggested" ? "text-amber-800" : "text-ink-950";
  return (
    <div className={`panel p-4 ${tone === "verified" ? "border-brand-200 bg-brand-50/70" : tone === "suggested" ? "border-amber-200 bg-amber-50/70" : "bg-white/85"}`}>
      <p className={`font-mono text-[10px] font-semibold uppercase tracking-eyebrow ${labelClass}`}>{label}</p>
      <p className={`mt-2 font-mono text-3xl font-semibold tnum ${valueClass}`}>{value}</p>
      <p className="mt-1 text-xs text-ink-600">{detail}</p>
    </div>
  );
}

function CoverageChip({ label, value }: { label: string; value: number }) {
  return <span className="rounded-lg border border-amber-200 bg-white/70 px-3 py-2 font-mono text-amber-900">{label}: {value}</span>;
}

function CurveDetail({ curve, comparisonCurves }: { curve: AfmCurveRecord; comparisonCurves: AfmCurveRecord[] }) {
  const dependencies = deriveAfmCurveDependencies(curve, comparisonCurves);
  return (
    <article className="space-y-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={curve.status} />
            <ReviewBadge state={curve.review.state} />
            <DigitizationBadge curve={curve} />
            {curve.paperCandidate?.status.includes("suggested") ? <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-wide text-amber-800">Paper suggested</span> : null}
            <span className="chip">{curve.collection === "qualified-new" ? "New extraction" : curve.digitization.quality === "complete" ? "Source re-digitized" : "Manual / legacy representative"}</span>
          </div>
          <h3 className="mt-3 break-words text-xl font-semibold tracking-tight text-ink-950">{curve.label}</h3>
          <p className="mt-1 font-mono text-xs text-ink-500">{curve.id}</p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <span className="rounded-lg border border-ink-200 bg-ink-50 px-3 py-2 font-mono text-xs font-semibold text-ink-700">{curve.pointCount} points</span>
          <CurveExportControl curve={curve} dependencies={dependencies} />
        </div>
      </header>

      {curve.source.previewImageDataUrl ? (
        <DraftSourceComparison curve={curve} />
      ) : hasVerifiedSourceComparison(curve) ? (
        <CurveSourceComparison curve={curve} />
      ) : (
        <CurvePlot curve={curve} />
      )}

      <section aria-labelledby={`context-${curve.id}`}>
        <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-eyebrow text-brand-700">Experimental context</p>
            <h4 id={`context-${curve.id}`} className="mt-1 text-lg font-semibold text-ink-950">Experimental system summary</h4>
          </div>
          <p className="text-sm text-ink-600">Only reported values appear in this summary; review status remains visible beside every field.</p>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <ContextCard title="Ionic liquid" accent="cyan" className="md:col-span-2">
            <VisibleMetadataLine label="Identity" field={curve.context.ionicLiquid.name} />
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <IonStructureCard curve={curve} kind="cation" />
              <IonStructureCard curve={curve} kind="anion" />
            </div>
          </ContextCard>

          <ContextCard title="Probe" accent="violet">
            <VisibleMetadataLine label="Material" field={curve.context.interface.probeMaterial} />
            <VisibleMetadataLine label="Spring constant" field={curve.acquisition.springConstant} />
            <VisibleMetadataLine label="Instrument" field={curve.acquisition.instrument} />
          </ContextCard>

          <ContextCard title="Substrate" accent="amber">
            <VisibleMetadataLine label="Material" field={curve.context.interface.substrate} />
            <VisibleMetadataLine label="Surface state" field={curve.context.interface.surfaceState} />
          </ContextCard>

          <ContextCard title="Interface and measurement conditions" accent="brand" className="md:col-span-2">
            <VisibleMetadataLine label="Technique" field={curve.acquisition.technique} />
            <VisibleMetadataLine label="Curve branch" field={curve.acquisition.curveBranch} />
            <VisibleMetadataLine label="Scan rate" field={curve.acquisition.scanRate} />
            <VisibleMetadataLine label="Scan size" field={curve.acquisition.scanSize} />
            <VisibleMetadataLine label="Potential" field={curve.context.electrochemistry.electrodePotential} />
            <VisibleMetadataLine label="Reference" field={curve.context.electrochemistry.potentialReference} />
            <VisibleMetadataLine label="Capacitance" field={curve.context.electrochemistry.capacitance} />
            <VisibleMetadataLine label="Electric field" field={curve.context.electrochemistry.electricField} />
            <VisibleMetadataLine label="Temperature" field={curve.context.thermodynamics.temperature} />
            <VisibleMetadataLine label="Pressure" field={curve.context.thermodynamics.pressure} />
            <VisibleMetadataLine label="Atmosphere" field={curve.context.thermodynamics.atmosphere} />
            <VisibleMetadataLine label="Water content" field={curve.context.thermodynamics.waterContent} />
          </ContextCard>
        </div>
      </section>

      {curve.layering.layerPositions.value?.length ? <LayeringPanel curve={curve} /> : null}
      {dependencies.length ? <AfmDependenciesPanel dependencies={dependencies} /> : null}
      {curve.context.electrochemistry.relatedMeasurements.length ? <RelatedElectrochemistryPanel curve={curve} /> : null}

      <details className="group overflow-hidden rounded-xl border border-ink-200 bg-white">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-semibold text-ink-800 hover:bg-ink-50 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-brand-200">
          Review, acquisition and provenance details
          <span className="font-mono text-xs text-ink-500 group-open:hidden">Show</span>
          <span className="hidden font-mono text-xs text-ink-500 group-open:inline">Hide</span>
        </summary>
        <div className="space-y-4 border-t border-ink-100 p-4">
          <ReviewProgress curve={curve} />
          {curve.paperCandidate?.requiresReview && curve.paperCandidate.candidate ? <SuggestedPaperPanel curve={curve} /> : null}
          <div className="grid gap-4 xl:grid-cols-3">
            <MetadataSection title="AFM acquisition">
              <MetadataLine label="Technique" field={curve.acquisition.technique} />
              <MetadataLine label="Curve branch" field={curve.acquisition.curveBranch} />
              <MetadataLine label="Instrument" field={curve.acquisition.instrument} />
              <MetadataLine label="Scan rate" field={curve.acquisition.scanRate} />
              <MetadataLine label="Scan size" field={curve.acquisition.scanSize} />
              <MetadataLine label="Spring constant" field={curve.acquisition.springConstant} />
              <MetadataLine label="Separation unit" field={curve.acquisition.separationUnit} />
              <MetadataLine label="Force unit" field={curve.acquisition.forceUnit} />
            </MetadataSection>
            <MetadataSection title="Electrochemical links">
              <MetadataLine label="Potential" field={curve.context.electrochemistry.electrodePotential} />
              <MetadataLine label="Reference" field={curve.context.electrochemistry.potentialReference} />
              <MetadataLine label="Capacitance" field={curve.context.electrochemistry.capacitance} />
              <MetadataLine label="Electric field" field={curve.context.electrochemistry.electricField} />
              <TraceRow label="Related" value={String(curve.context.electrochemistry.relatedMeasurements.length)} />
              <TraceRow label="Conductivity" value={String(curve.context.electrochemistry.linkedConductivityRecordIds.length)} />
            </MetadataSection>
            <section className="rounded-xl border border-ink-200 bg-ink-50/60 p-4">
              <h4 className="label-eyebrow text-ink-600">Source trace</h4>
              <dl className="mt-3 space-y-2 text-sm">
                <TraceRow label="Folder" value={curve.source.folder} />
                <TraceRow label="Image" value={curve.source.imageFile || "—"} />
                <TraceRow label="Workbook" value={`${curve.source.workbookFile}${curve.source.range ? ` · ${curve.source.sheet}!${curve.source.range}` : ""}`} />
                <TraceRow label="Paper" value={curve.source.pdfFile || "Not linked"} />
                <TraceRow label="DOI" value={curve.source.doi || "—"} />
              </dl>
            </section>
          </div>
          {curve.context.ionicLiquid.cationSmiles.value || curve.context.ionicLiquid.anionSmiles.value ? (
            <section className="rounded-xl border border-rose-200 bg-rose-50/70 p-4">
              <h4 className="label-eyebrow text-rose-800">Legacy molecular identifiers</h4>
              <p className="mt-2 text-xs leading-5 text-rose-900">Record-level SMILES remain visible for traceability. The displayed structure uses the curated ion catalog whenever a verified match exists.</p>
              <dl className="mt-3 space-y-2 font-mono text-xs text-rose-950">
                <TraceRow label="Cation" value={curve.context.ionicLiquid.cationSmiles.value || "—"} />
                <TraceRow label="Anion" value={curve.context.ionicLiquid.anionSmiles.value || "—"} />
              </dl>
            </section>
          ) : null}
          <section className="rounded-xl border border-ink-200 bg-white p-4">
            <h4 className="label-eyebrow text-ink-600">Curation note</h4>
            <p className="mt-3 text-sm leading-6 text-ink-700">{curve.notes}</p>
            {curve.review.qualityFlags.length ? <div className="mt-3 flex flex-wrap gap-1.5">{curve.review.qualityFlags.map((flag) => <span key={flag} className="rounded-md bg-ink-100 px-2 py-1 font-mono text-[10px] text-ink-700">{flag}</span>)}</div> : null}
          </section>
        </div>
      </details>
    </article>
  );
}

function matchesReviewFilter(curve: AfmCurveRecord, reviewFilter: ReviewFilter) {
  if (reviewFilter === "verified") return curve.review.state === "verified";
  if (reviewFilter === "paper-suggested") return Boolean(curve.paperCandidate?.status.includes("suggested"));
  if (reviewFilter === "needs-review") return curve.review.state !== "verified";
  if (reviewFilter === "legacy-import") return curve.collection === "legacy-cleaned";
  return true;
}

export function curveBrowserTitle(curve: AfmCurveRecord) {
  const ionicLiquid = curve.context.ionicLiquid.name.value?.trim() || curve.ionicLiquid?.trim();
  const substrate = curve.context.interface.substrate.value?.trim();
  if (ionicLiquid) return substrate ? `${ionicLiquid} · ${substrate}` : ionicLiquid;
  return substrate ? `Ionic liquid pending · ${substrate}` : "Ionic liquid pending review";
}

function curveBrowserSubtitle(curve: AfmCurveRecord) {
  const conditions = [
    curve.context.electrochemistry.electrodePotential.value == null
      ? null
      : `${Number(curve.context.electrochemistry.electrodePotential.value.toFixed(3))} V`,
    curve.context.thermodynamics.temperature.value == null
      ? null
      : `${Number(curve.context.thermodynamics.temperature.value.toFixed(2))} K`,
  ].filter(Boolean);
  return conditions.length ? conditions.join(" · ") : curve.source.figure?.label ?? curve.label;
}

function CurveExportControl({ curve, dependencies }: { curve: AfmCurveRecord; dependencies: AfmCurveDependency[] }) {
  const [format, setFormat] = useState<AfmExportFormat>("csv");
  const [state, setState] = useState<"idle" | "working" | "done" | "error">("idle");

  async function handleExport() {
    setState("working");
    try {
      const stem = afmCurveFileStem(curve);
      if (format === "csv") {
        downloadBlob(new Blob([buildAfmCurveCsv(curve, dependencies)], { type: "text/csv;charset=utf-8" }), `${stem}.csv`);
      } else if (format === "json") {
        downloadBlob(new Blob([buildAfmCurveJson(curve, dependencies)], { type: "application/json;charset=utf-8" }), `${stem}.json`);
      } else {
        await downloadCurvePng(curve, `${stem}.png`);
      }
      setState("done");
      window.setTimeout(() => setState("idle"), 1800);
    } catch (error) {
      console.error("AFM curve export failed", error);
      setState("error");
    }
  }

  return (
    <div className="flex overflow-hidden rounded-lg border border-brand-200 bg-white shadow-sm">
      <label className="sr-only" htmlFor={`afm-export-${curve.id}`}>Curve export format</label>
      <select
        id={`afm-export-${curve.id}`}
        value={format}
        onChange={(event) => { setFormat(event.target.value as AfmExportFormat); setState("idle"); }}
        className="min-h-9 border-0 bg-white pl-3 pr-7 text-xs font-medium text-ink-700 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-brand-200"
      >
        <option value="csv">CSV · points + conditions</option>
        <option value="json">JSON · full record</option>
        <option value="png">PNG · chart image</option>
      </select>
      <button
        type="button"
        onClick={handleExport}
        disabled={state === "working"}
        className="min-h-9 border-l border-brand-200 bg-brand-600 px-3 text-xs font-semibold text-white transition hover:bg-brand-700 disabled:cursor-wait disabled:opacity-70"
      >
        {state === "working" ? "Preparing…" : state === "done" ? "Downloaded" : state === "error" ? "Retry" : "Export"}
      </button>
    </div>
  );
}

function ContextCard({ title, accent, className = "", children }: { title: string; accent: "cyan" | "violet" | "amber" | "brand" | "rose"; className?: string; children: React.ReactNode }) {
  const tones = {
    cyan: "border-cyan-200 bg-cyan-50/45 text-cyan-800",
    violet: "border-violet-200 bg-violet-50/45 text-violet-800",
    amber: "border-amber-200 bg-amber-50/45 text-amber-800",
    brand: "border-brand-200 bg-brand-50/45 text-brand-800",
    rose: "border-rose-200 bg-rose-50/45 text-rose-800",
  } as const;
  return (
    <section className={`rounded-xl border p-4 ${tones[accent]} ${className}`}>
      <h5 className="text-xs font-semibold uppercase tracking-eyebrow">{title}</h5>
      <dl className="mt-3 space-y-2 text-ink-900">{children}</dl>
    </section>
  );
}

function VisibleMetadataLine<T>({ label, field }: { label: string; field: CuratedField<T> }) {
  if (field.value === null || field.value === "" || field.status === "not-reported") return null;
  return <MetadataLine label={label} field={field} size="large" />;
}

function IonStructureCard({ curve, kind }: { curve: AfmCurveRecord; kind: "cation" | "anion" }) {
  const identity = kind === "cation" ? curve.context.ionicLiquid.cation : curve.context.ionicLiquid.anion;
  const storedSmiles = kind === "cation" ? curve.context.ionicLiquid.cationSmiles : curve.context.ionicLiquid.anionSmiles;
  const label = identity.value || (kind === "cation" ? curve.cation : curve.anion) || "Unknown";
  const resolved = resolveIonStructure(label, kind);
  const reviewedRecordSmiles = storedSmiles.status === "verified" || storedSmiles.status === "reported" ? storedSmiles.value ?? undefined : undefined;
  const canRender = Boolean(resolved || reviewedRecordSmiles);
  return (
    <div className="overflow-hidden rounded-lg border border-white/90 bg-white/85 p-2.5 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-mono text-[10px] font-semibold uppercase tracking-wide text-ink-500">{kind}</p>
          <p className="mt-1 break-words text-sm font-semibold leading-5 text-ink-900">{label}</p>
        </div>
        <span className={`rounded px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase ${canRender ? "bg-brand-50 text-brand-700" : "bg-amber-50 text-amber-800"}`}>
          {resolved ? "Curated" : reviewedRecordSmiles ? "Reviewed" : "Needs review"}
        </span>
      </div>
      <div className="mt-2 flex min-h-28 items-center justify-center rounded-md bg-white">
        {canRender ? (
          <MoleculeView smiles={reviewedRecordSmiles} ionLabel={label} kind={kind} label={`${kind} structure for ${label}`} width={190} height={108} />
        ) : (
          <div className="px-3 text-center">
            <span className="text-2xl text-ink-300">{kind === "cation" ? "+" : "−"}</span>
            <p className="mt-1 text-[10px] leading-4 text-amber-800">Structure not drawn until the ion identity is chemically validated.</p>
          </div>
        )}
      </div>
    </div>
  );
}

function LayeringPanel({ curve }: { curve: AfmCurveRecord }) {
  const positions = curve.layering.layerPositions.value ?? [];
  const partial = curve.digitization.quality === "partial";
  return (
    <section className={`rounded-xl border p-4 ${partial ? "border-rose-200 bg-rose-50/60" : "border-brand-200 bg-brand-50/60"}`}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className={`label-eyebrow ${partial ? "text-rose-800" : "text-brand-800"}`}>Solvation-layer structure</p>
          <p className="mt-1 text-sm text-ink-700">Layer positions digitized from the annotations beside the force curve.</p>
        </div>
        <span className="shrink-0 rounded-lg border border-white/80 bg-white/75 px-3 py-2 font-mono text-xs font-semibold text-ink-800">
          {positions.length} layers
        </span>
      </div>
      <dl className="mt-3 grid gap-2 sm:grid-cols-3">
        <LayerMetric label="Detected layers" value={String(curve.layering.detectedLayerCount.value ?? positions.length)} />
        <LayerMetric label="Innermost layer" value={formatValueWithUnit(curve.layering.innermostLayerThickness.value, curve.layering.innermostLayerThickness.unit)} />
        <LayerMetric label="Median spacing" value={formatValueWithUnit(curve.layering.medianLayerSpacing.value, curve.layering.medianLayerSpacing.unit)} />
      </dl>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {positions.map((position, index) => (
          <span key={`${index}-${position}`} className="rounded-md border border-white/90 bg-white/80 px-2 py-1 font-mono text-[10px] text-ink-700">
            L{index + 1}: {formatNumber(position)} nm
          </span>
        ))}
      </div>
      {partial ? <p className="mt-3 text-xs leading-5 text-rose-900">This trace is retained for inspection but excluded from modeling because the near-surface force segment is missing.</p> : null}
    </section>
  );
}

function LayerMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/80 bg-white/70 px-3 py-2">
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-ink-500">{label}</dt>
      <dd className="mt-1 font-mono text-sm font-semibold text-ink-900">{value}</dd>
    </div>
  );
}

function RelatedElectrochemistryPanel({ curve }: { curve: AfmCurveRecord }) {
  return (
    <section className="rounded-xl border border-cyan-200 bg-cyan-50/60 p-4">
      <p className="label-eyebrow text-cyan-800">Related electrochemistry</p>
      <p className="mt-1 text-xs leading-5 text-cyan-950">These values are contextual links, not measurements taken simultaneously with the displayed AFM trace.</p>
      <div className="mt-3 grid gap-3">
        {curve.context.electrochemistry.relatedMeasurements.map((measurement, index) => (
          <article key={`${measurement.quantity}-${index}`} className="rounded-lg border border-cyan-100 bg-white/80 p-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h5 className="text-sm font-semibold text-ink-950">{measurement.kind}</h5>
                <p className="mt-1 font-mono text-lg font-semibold text-cyan-900">{formatNumber(measurement.value)} {measurement.unit}</p>
              </div>
              <span className="rounded-md bg-cyan-100 px-2 py-1 font-mono text-[10px] font-semibold uppercase tracking-wide text-cyan-800">
                {Math.round(measurement.confidence * 100)}% confidence
              </span>
            </div>
            <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-3">
              <TraceRow label="Potential" value={measurement.electrodePotentialV === null ? "Not reported" : `${formatNumber(measurement.electrodePotentialV)} V`} />
              <TraceRow label="Reference" value={measurement.potentialReference ?? "Not reported"} />
              <TraceRow label="Temperature" value={measurement.temperatureK === null ? "Not reported" : `${formatNumber(measurement.temperatureK - 273.15)} °C`} />
            </dl>
            <p className="mt-3 border-t border-cyan-100 pt-3 text-xs leading-5 text-ink-700">{measurement.relation}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function SuggestedPaperPanel({ curve }: { curve: AfmCurveRecord }) {
  const match = curve.paperCandidate;
  if (!match?.candidate) return null;
  const candidate = match.candidate;
  return (
    <section className="rounded-xl border border-amber-200 bg-amber-50/70 p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="label-eyebrow text-amber-800">Suggested paper match · review required</p>
          <h4 className="mt-2 text-sm font-semibold leading-6 text-amber-950">{candidate.title || candidate.pdfFile}</h4>
          <p className="mt-1 text-xs leading-5 text-amber-900">
            This is an order-based candidate and is not used as verified provenance until a person confirms the paper, figure and workbook relationship.
          </p>
        </div>
        <span className="shrink-0 rounded-lg border border-amber-200 bg-white/70 px-3 py-2 font-mono text-xs font-semibold text-amber-900">
          {Math.round(match.confidence * 100)}% match confidence
        </span>
      </div>
      <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
        <TraceRow label="PDF" value={candidate.pdfFile} />
        <TraceRow label="DOI" value={candidate.doi || "Not extracted"} />
      </dl>
      {match.reasons.length ? <p className="mt-3 text-xs leading-5 text-amber-900">{match.reasons.join(" ")}</p> : null}
    </section>
  );
}

function ReviewProgress({ curve }: { curve: AfmCurveRecord }) {
  const review = curve.review;
  return (
    <section className="rounded-xl border border-ink-200 bg-white p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="label-eyebrow text-ink-600">Metadata audit</p>
          <p className="mt-1 text-sm text-ink-700">
            {review.presentFieldCount}/{review.requiredFieldCount} required fields present · {review.verifiedFieldCount}/{review.requiredFieldCount} verified
          </p>
        </div>
        <span className="font-mono text-sm font-semibold text-brand-800">{review.verifiedPercent}% verified</span>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-ink-100">
        <div className="h-full rounded-full bg-brand-600" style={{ width: `${review.verifiedPercent}%` }} />
      </div>
      {review.missingFields.length || review.unverifiedFields.length ? (
        <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
          <AuditList label="Missing" values={review.missingFields} />
          <AuditList label="Present but unverified" values={review.unverifiedFields} />
        </div>
      ) : (
        <p className="mt-3 text-xs font-medium text-brand-800">All required metadata fields are source-verified.</p>
      )}
    </section>
  );
}

function AuditList({ label, values }: { label: string; values: string[] }) {
  return (
    <div className="rounded-lg bg-ink-50 px-3 py-2">
      <span className="font-medium text-ink-600">{label}: </span>
      <span className="text-ink-800">{values.length ? values.join(", ") : "none"}</span>
    </div>
  );
}

function MetadataSection({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="rounded-xl border border-ink-200 bg-white p-4"><h4 className="label-eyebrow text-ink-600">{title}</h4><dl className="mt-3 space-y-2">{children}</dl></section>;
}

function MetadataLine<T>({ label, field, size = "normal" }: { label: string; field: CuratedField<T>; size?: "normal" | "large" }) {
  const labelClass = size === "large" ? "text-sm text-ink-600" : "text-xs text-ink-500";
  const valueClass = size === "large" ? "text-sm font-medium leading-5 text-ink-950" : "text-xs font-medium text-ink-900";
  return (
    <div className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-2 border-b border-ink-100 pb-2 last:border-0 last:pb-0">
      <dt className={labelClass}>{label}</dt>
      <dd className="min-w-0 text-right">
        <span className={`block break-words ${valueClass}`}>{formatCuratedField(field)}</span>
        <FieldStatus status={field.status} large={size === "large"} />
      </dd>
    </div>
  );
}

const AFM_TREND_LABEL: Record<AfmCurveDependency["trend"], string> = {
  increases: "Increases with X ↗",
  decreases: "Decreases with X ↘",
  "non-monotonic": "Non-monotonic ∿",
  "approximately-constant": "Approximately constant →",
  comparison: "Conditional comparison",
};

function AfmDependenciesPanel({ dependencies }: { dependencies: AfmCurveDependency[] }) {
  return (
    <details data-testid="afm-property-dependencies" className="group rounded-xl border border-ink-200 bg-white p-4">
      <summary className="cursor-pointer list-none">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="label-eyebrow text-brand-800">Cross-curve condition trends</p>
          <p className="mt-1 text-xs leading-5 text-ink-600">Compare curve descriptors only across records from the same paper with compatible conditions.</p>
        </div>
        <span className="w-fit rounded-full border border-ink-200 bg-ink-50 px-2 py-1 font-mono text-[10px] text-ink-600">descriptor Y = f(condition X) · expand</span>
      </div>
      </summary>
      <div className="mt-3 grid gap-2 lg:grid-cols-2">
        {dependencies.map((dependency, index) => (
          <article key={`${dependency.descriptor}-${dependency.independentVariable}-${index}`} className="rounded-lg border border-violet-100 bg-white p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <h5 className="text-sm font-semibold text-ink-950">{dependency.label}</h5>
              <span className="rounded bg-brand-50 px-2 py-0.5 text-[10px] font-semibold text-brand-800">{AFM_TREND_LABEL[dependency.trend]}</span>
            </div>
            <p className="mt-2 text-xs leading-5 text-ink-600">{dependency.statement}</p>
            <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
              {dependency.observations.map((observation) => (
                <div key={`${observation.curveId}-${observation.x}`} className="min-w-[9rem] rounded-md border border-ink-100 bg-slate-50 px-2 py-1.5">
                  <p className="truncate font-mono text-[9px] text-ink-400" title={observation.curveId}>{observation.curveId}</p>
                  <p className="mt-0.5 font-mono text-[11px] font-semibold text-ink-900">{observation.x} → {observation.y}</p>
                </div>
              ))}
            </div>
            <p className="mt-1 text-[10px] text-ink-400">{dependency.basis === "verified-metadata" ? "Source: reviewed layering metadata" : "Source: same-paper digitized curve comparison"} · Confidence {Math.round(dependency.confidence * 100)}%</p>
          </article>
        ))}
      </div>
    </details>
  );
}

function FieldStatus({ status, large = false }: { status: FieldReviewStatus; large?: boolean }) {
  const classes: Record<FieldReviewStatus, string> = {
    verified: "text-brand-700",
    reported: "text-cyan-700",
    inferred: "text-violet-700",
    "legacy-import": "text-rose-700",
    "not-reported": "text-ink-500",
    unreviewed: "text-amber-700",
  };
  return <span className={`mt-1 block font-mono ${large ? "text-[10px]" : "text-[9px]"} font-semibold uppercase tracking-wide ${classes[status]}`}>{FIELD_STATUS_LABELS[status]}</span>;
}

type CurveDisplaySeries = {
  points: [number, number][];
  hiddenPointCount: number;
};

export function curveDisplaySeries(curve: AfmCurveRecord): CurveDisplaySeries {
  if (curve.collection !== "legacy-cleaned" || curve.digitization.quality === "complete" || curve.points.length < 4) {
    return { points: curve.points, hiddenPointCount: 0 };
  }

  const lastY = curve.points[curve.points.length - 1][1];
  const tolerance = Math.max(1, Math.abs(lastY)) * 1e-10;
  let repeatedTailStart = curve.points.length - 1;
  while (
    repeatedTailStart > 0 &&
    Math.abs(curve.points[repeatedTailStart - 1][1] - lastY) <= tolerance
  ) {
    repeatedTailStart -= 1;
  }

  const repeatedTailLength = curve.points.length - repeatedTailStart;
  if (repeatedTailLength < 3 || repeatedTailStart === 0) {
    return { points: curve.points, hiddenPointCount: 0 };
  }

  return {
    points: curve.points.slice(0, repeatedTailStart + 1),
    hiddenPointCount: repeatedTailLength - 1,
  };
}

export function hasVerifiedSourceComparison(curve: AfmCurveRecord): boolean {
  if (
    curve.status !== "source-verified" ||
    !curve.source.imagePath ||
    !curve.source.pdfFile
  ) {
    return false;
  }

  if (curve.source.figure?.mappingStatus === "verified") return true;

  return curve.context.ionicLiquid.name.evidence.some((item) => (
    item.sourceKind === "figure" &&
    Boolean(item.locator) &&
    (!curve.source.imageFile || item.sourceFile === curve.source.imageFile)
  ));
}

function sourceComparisonLocator(curve: AfmCurveRecord): string | null {
  if (curve.source.figure) {
    return `${curve.source.figure.label}${curve.source.figure.pdfPage ? ` · PDF p.${curve.source.figure.pdfPage}` : ""}`;
  }

  return curve.context.ionicLiquid.name.evidence.find((item) => (
    item.sourceKind === "figure" &&
    (!curve.source.imageFile || item.sourceFile === curve.source.imageFile)
  ))?.locator ?? null;
}

function CurveSourceComparison({ curve }: { curve: AfmCurveRecord }) {
  const imageUrl = `/api/afm/source-image?curveId=${encodeURIComponent(curve.id)}`;
  const locator = sourceComparisonLocator(curve);

  return (
    <section className="overflow-hidden rounded-[12px] border border-brand-200 bg-brand-50/35 shadow-sm" aria-label="Original paper curve and platform digitization">
      <div className="border-b border-brand-100 bg-white px-4 py-3">
        <p className="label-eyebrow text-brand-700">Source comparison</p>
        <div className="mt-1 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <h4 className="text-base font-semibold text-ink-950">Original paper curve and platform digitization</h4>
          <p className="font-mono text-[10px] text-ink-500">
            {locator}
          </p>
        </div>
      </div>
      <div className="grid gap-px bg-brand-100 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <figure className="flex min-w-0 flex-col bg-white">
          <div className="flex items-center justify-between gap-2 border-b border-ink-100 px-4 py-3">
            <div>
              <p className="label-eyebrow text-ink-500">01 · Original paper figure</p>
              <p className="mt-1 text-xs text-ink-600">Original AFM curve panel from the paper</p>
            </div>
            <a
              href={imageUrl}
              target="_blank"
              rel="noreferrer"
              className="rounded-md border border-brand-200 bg-brand-50 px-2.5 py-1.5 text-xs font-semibold text-brand-800 hover:bg-brand-100"
            >
              View source
            </a>
          </div>
          <div className="flex min-h-[22rem] flex-1 items-center justify-center bg-white p-3">
            {/* The source image is served from a trusted local corpus route so its full resolution is preserved. */}
            <Image
              src={imageUrl}
              alt={`Original paper AFM curve: ${curve.label}`}
              width={1400}
              height={1000}
              unoptimized
              className="max-h-[32rem] w-full object-contain"
            />
          </div>
          <figcaption className="border-t border-ink-100 bg-ink-50/60 px-4 py-2.5 text-xs text-ink-600">
            <span className="font-medium text-ink-800">{curve.source.pdfFile}</span>
            <span className="mx-1.5 text-ink-300">·</span>
            <span>{curve.source.imageFile}</span>
            <span className="ml-2 font-mono text-[10px] font-semibold uppercase text-brand-700">source-verified pairing</span>
          </figcaption>
        </figure>
        <div className="min-w-0 bg-white">
          <CurvePlot curve={curve} embedded />
        </div>
      </div>
    </section>
  );
}

function DraftSourceComparison({ curve }: { curve: AfmCurveRecord }) {
  const sourceImage = curve.source.previewImageDataUrl!;
  const locator = sourceComparisonLocator(curve) ?? curve.source.imageFile ?? "Digitized panel";
  return (
    <section className="overflow-hidden rounded-[12px] border border-amber-200 bg-amber-50/25 shadow-sm" aria-label="Paper panel and pending platform digitization">
      <div className="border-b border-amber-100 bg-white px-4 py-3">
        <p className="label-eyebrow text-amber-700">Local review draft comparison</p>
        <div className="mt-1 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <h4 className="text-base font-semibold text-ink-950">Paper panel and pending digitization</h4>
          <p className="font-mono text-[10px] text-ink-500">{locator}</p>
        </div>
      </div>
      <div className="grid gap-px bg-amber-100 lg:grid-cols-2">
        <figure className="flex min-w-0 flex-col bg-white">
          <div className="border-b border-ink-100 px-4 py-3">
            <p className="label-eyebrow text-ink-500">01 · Original PDF panel</p>
            <p className="mt-1 text-xs text-ink-600">Original panel crop retained at upload · inferred pairing</p>
          </div>
          <div className="flex min-h-[22rem] flex-1 items-center justify-center bg-[#eef3f7] p-3">
            <Image src={sourceImage} alt={`Pending paper AFM panel: ${curve.label}`} width={1200} height={900} unoptimized className="max-h-[32rem] w-full object-contain" />
          </div>
          <figcaption className="border-t border-ink-100 bg-ink-50/60 px-4 py-2.5 text-xs text-ink-600">
            {curve.source.pdfFile} · <span className="font-mono text-[10px] font-semibold uppercase text-amber-700">local draft · not verified</span>
          </figcaption>
        </figure>
        <div className="min-w-0 bg-white"><CurvePlot curve={curve} embedded /></div>
      </div>
    </section>
  );
}

function CurvePlot({ curve, embedded = false }: { curve: AfmCurveRecord; embedded?: boolean }) {
  const width = 800;
  const height = 360;
  const margin = { left: 66, right: 24, top: 26, bottom: 52 };
  const displaySeries = curveDisplaySeries(curve);
  const displayPoints = displaySeries.points;
  const xs = displayPoints.map(([x]) => x);
  const ys = displayPoints.map(([, y]) => y);
  const [xMin, xMax] = paddedExtent(xs);
  const [yMin, yMax] = paddedExtent(ys);
  const sx = (x: number) => margin.left + ((x - xMin) / (xMax - xMin)) * (width - margin.left - margin.right);
  const sy = (y: number) => height - margin.bottom - ((y - yMin) / (yMax - yMin)) * (height - margin.top - margin.bottom);
  const pathSegments = splitCurvePath(displayPoints.map(([x, y]) => ({ x: sx(x), y: sy(y) })), width, height, curve.segmentStarts)
    .map((segment) => segment.map((point, index) => `${index ? "L" : "M"}${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(" "));
  const xTicks = ticks(xMin, xMax, 5);
  const yTicks = ticks(yMin, yMax, 5);
  const zeroInRange = yMin <= 0 && yMax >= 0;
  const relativeAxes = curve.xUnit.startsWith("relative") || curve.yUnit.startsWith("relative");
  const gradientId = `afm-plot-${curve.id.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
  const tone = curve.status === "source-verified"
    ? { stroke: "#0d9488", point: "#0f766e", wash: "#ccfbf1", label: "Source-verified measurement", dotClass: "bg-brand-600" }
    : curve.collection === "legacy-cleaned"
      ? { stroke: "#8b5cf6", point: "#7c3aed", wash: "#ede9fe", label: "Manual / legacy model series", dotClass: "bg-violet-500" }
      : { stroke: "#d97706", point: "#b45309", wash: "#fef3c7", label: "Qualified measurement · metadata review", dotClass: "bg-amber-500" };
  const seriesDescription = curve.collection === "legacy-cleaned" && curve.digitization.quality !== "complete"
    ? "Fixed-grid representative curve from the legacy prediction model · not original digitized points"
    : "Digitized experimental points · stored order preserved";

  return (
    <figure className={embedded ? "overflow-hidden bg-white" : "overflow-hidden rounded-[10px] border border-ink-200/80 bg-white shadow-sm"}>
      <div className="flex flex-col gap-2 border-b border-ink-100 bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="label-eyebrow text-ink-500">{embedded ? "02 · Platform extraction" : "Force–distance trace"}</p>
          <p className="mt-1 text-xs text-ink-600">{embedded ? "Coordinates digitized from the matching source panel · reconstructed experimental curve" : seriesDescription}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3 font-mono text-[10px] text-ink-500">
          <span className="inline-flex items-center gap-1.5"><span className={`h-2.5 w-2.5 rounded-full ${tone.dotClass}`} />{tone.label}</span>
          <span className="rounded-md border border-ink-100 bg-ink-50 px-2 py-1 tnum">n = {displayPoints.length}</span>
          {displaySeries.hiddenPointCount ? (
            <span className="rounded-md border border-violet-200 bg-violet-50 px-2 py-1 text-violet-800">
              {displaySeries.hiddenPointCount} extrapolated points hidden
            </span>
          ) : null}
        </div>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="block w-full" role="img" aria-label={`AFM force curve: ${curve.label}`}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={tone.wash} stopOpacity="0.52" />
            <stop offset="65%" stopColor="#f8fafc" stopOpacity="0.76" />
            <stop offset="100%" stopColor="#ffffff" />
          </linearGradient>
        </defs>
        <rect width={width} height={height} fill={`url(#${gradientId})`} />
        {yTicks.map((tick) => (
          <g key={`y-${tick}`}>
            <line x1={margin.left} x2={width - margin.right} y1={sy(tick)} y2={sy(tick)} stroke="#e2e8f0" strokeDasharray="3 4" />
            {!relativeAxes ? <text x={margin.left - 10} y={sy(tick) + 4} textAnchor="end" fontSize="10" fill="#64748b" fontFamily="ui-monospace, monospace">{formatNumber(tick)}</text> : null}
          </g>
        ))}
        {xTicks.map((tick) => (
          <g key={`x-${tick}`}>
            <line x1={sx(tick)} x2={sx(tick)} y1={margin.top} y2={height - margin.bottom} stroke="#f1f5f9" />
            {!relativeAxes ? <text x={sx(tick)} y={height - margin.bottom + 20} textAnchor="middle" fontSize="10" fill="#64748b" fontFamily="ui-monospace, monospace">{formatNumber(tick)}</text> : null}
          </g>
        ))}
        {zeroInRange ? <line x1={margin.left} x2={width - margin.right} y1={sy(0)} y2={sy(0)} stroke="#94a3b8" strokeWidth="1.2" strokeDasharray="5 5" /> : null}
        <line x1={margin.left} x2={width - margin.right} y1={height - margin.bottom} y2={height - margin.bottom} stroke="#94a3b8" />
        <line x1={margin.left} x2={margin.left} y1={margin.top} y2={height - margin.bottom} stroke="#94a3b8" />
        {pathSegments.map((path, index) => <path key={index} d={path} fill="none" stroke={tone.stroke} strokeWidth="1.45" strokeOpacity="0.6" strokeLinejoin="round" strokeLinecap="round" />)}
        {displayPoints.map(([x, y], index) => <circle key={`${index}-${x}-${y}`} cx={sx(x)} cy={sy(y)} r="1.75" fill={tone.point} fillOpacity="0.9" />)}
        {relativeAxes ? <text x={margin.left + 8} y={margin.top + 16} fontSize="10" fontWeight="600" fill="#b45309" fontFamily="ui-monospace, monospace">RELATIVE PIXEL SPACE · CALIBRATION PENDING</text> : null}
        <text x={(margin.left + width - margin.right) / 2} y={height - 13} textAnchor="middle" fontSize="11" fontWeight="600" fill="#475569" fontFamily="ui-monospace, monospace">{relativeAxes ? "Relative horizontal position" : `Separation · ${curve.xUnit}`}</text>
        <text transform={`translate(18 ${(margin.top + height - margin.bottom) / 2}) rotate(-90)`} textAnchor="middle" fontSize="11" fontWeight="600" fill="#475569" fontFamily="ui-monospace, monospace">{relativeAxes ? "Relative vertical position" : `Force · ${curve.yUnit}`}</text>
      </svg>
      <figcaption className="flex flex-col gap-1 border-t border-ink-100 bg-ink-50/60 px-4 py-2.5 text-xs text-ink-600 sm:flex-row sm:items-center sm:justify-between">
        <span>
          {relativeAxes
            ? "Relative-pixel review draft: physical axis endpoints and units are not yet approved."
            : displaySeries.hiddenPointCount
            ? "Display-only cleanup hides the repeated endpoint extrapolation; the stored model series and exports are unchanged."
            : "Units are displayed only when supported by the linked figure or reviewed source."}
        </span>
        <span className="font-mono text-[10px] text-ink-500">{relativeAxes ? "physical ranges pending" : `x ${formatNumber(Math.min(...xs))}–${formatNumber(Math.max(...xs))} ${curve.xUnit} · y ${formatNumber(Math.min(...ys))}–${formatNumber(Math.max(...ys))} ${curve.yUnit}`}</span>
      </figcaption>
    </figure>
  );
}

function CurveToneDot({ curve }: { curve: AfmCurveRecord }) {
  const className = curve.status === "source-verified" ? "bg-brand-600" : curve.collection === "legacy-cleaned" ? "bg-violet-500" : "bg-amber-500";
  return <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${className}`} aria-hidden="true" />;
}

function StatusBadge({ status }: { status: AfmCurveRecord["status"] }) {
  const classes = {
    "source-verified": "border-brand-200 bg-brand-50 text-brand-800",
    "pairing-qualified": "border-cyan-200 bg-cyan-50 text-cyan-800",
    "legacy-unverified": "border-amber-200 bg-amber-50 text-amber-800",
  }[status];
  return <span className={`rounded-full border px-2.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-wide ${classes}`}>{STATUS_LABELS[status]}</span>;
}

function ReviewBadge({ state }: { state: AfmCurveRecord["review"]["state"] }) {
  const label = state === "verified" ? "Metadata verified" : state === "partial" ? "Partial metadata" : "Metadata pending";
  const classes = state === "verified" ? "border-brand-200 bg-brand-50 text-brand-800" : "border-amber-200 bg-amber-50 text-amber-800";
  return <span className={`rounded-full border px-2.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-wide ${classes}`}>{label}</span>;
}

function DigitizationBadge({ curve }: { curve: AfmCurveRecord }) {
  const presentation = curve.digitization.modelEligible
    ? { label: "Model ready", classes: "border-brand-200 bg-brand-50 text-brand-800" }
    : curve.digitization.quality === "partial"
      ? { label: "Partial digitization", classes: "border-rose-200 bg-rose-50 text-rose-800" }
      : curve.digitization.quality === "legacy-resampled"
        ? { label: "Legacy resampled", classes: "border-violet-200 bg-violet-50 text-violet-800" }
        : { label: "Digitization pending", classes: "border-amber-200 bg-amber-50 text-amber-800" };
  return <span className={`rounded-full border px-2.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-wide ${presentation.classes}`}>{presentation.label}</span>;
}

function TraceRow({ label, value }: { label: string; value: string }) {
  return <div className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-2"><dt className="font-medium text-ink-500">{label}</dt><dd className="break-all font-mono text-xs leading-5 text-ink-800">{value}</dd></div>;
}

function formatCuratedField<T>(field: CuratedField<T>) {
  if (field.status === "not-reported") return "Not reported in reviewed paper";
  if (field.value === null || field.value === "") return "Pending review";
  const value = typeof field.value === "number" ? formatNumber(field.value) : String(field.value);
  return field.unit ? `${value} ${field.unit}` : value;
}

function formatValueWithUnit(value: number | null, unit: string | null) {
  return value === null ? "Not reported" : `${formatNumber(value)}${unit ? ` ${unit}` : ""}`;
}

function splitCurvePath(points: Array<{ x: number; y: number }>, width: number, height: number, segmentStarts: number[] = []) {
  const segments: Array<Array<{ x: number; y: number }>> = [];
  const jumpLimit = Math.hypot(width, height) * 0.16;
  const explicitStarts = new Set(segmentStarts.filter((index) => index > 0));
  points.forEach((point, index) => {
    const segment = segments[segments.length - 1];
    const previous = segment?.[segment.length - 1];
    if (!segment || explicitStarts.has(index) || (previous && Math.hypot(point.x - previous.x, point.y - previous.y) > jumpLimit)) segments.push([point]);
    else segment.push(point);
  });
  return segments.filter((segment) => segment.length >= 2);
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function downloadCurvePng(curve: AfmCurveRecord, filename: string) {
  const canvas = document.createElement("canvas");
  canvas.width = 1800;
  canvas.height = 1120;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas export is unavailable in this browser.");

  const width = canvas.width;
  const height = canvas.height;
  const margin = { left: 150, right: 80, top: 190, bottom: 260 };
  const plotRight = width - margin.right;
  const plotBottom = height - margin.bottom;
  const xs = curve.points.map(([x]) => x);
  const ys = curve.points.map(([, y]) => y);
  const [xMin, xMax] = paddedExtent(xs);
  const [yMin, yMax] = paddedExtent(ys);
  const sx = (x: number) => margin.left + ((x - xMin) / (xMax - xMin)) * (plotRight - margin.left);
  const sy = (y: number) => plotBottom - ((y - yMin) / (yMax - yMin)) * (plotBottom - margin.top);

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.fillStyle = "#0f172a";
  context.font = "600 34px system-ui, sans-serif";
  context.fillText(curve.label, margin.left, 68, width - margin.left - margin.right);
  context.fillStyle = "#64748b";
  context.font = "22px ui-monospace, monospace";
  context.fillText(`${curve.id} · Digitized from figure · ${curve.pointCount} points`, margin.left, 108);

  context.lineWidth = 1;
  context.strokeStyle = "#e2e8f0";
  context.fillStyle = "#64748b";
  context.font = "18px ui-monospace, monospace";
  const xTicks = ticks(xMin, xMax, 6);
  const yTicks = ticks(yMin, yMax, 6);
  for (const tick of yTicks) {
    const y = sy(tick);
    context.beginPath();
    context.moveTo(margin.left, y);
    context.lineTo(plotRight, y);
    context.stroke();
    context.textAlign = "right";
    context.fillText(formatNumber(tick), margin.left - 18, y + 6);
  }
  for (const tick of xTicks) {
    const x = sx(tick);
    context.beginPath();
    context.moveTo(x, margin.top);
    context.lineTo(x, plotBottom);
    context.stroke();
    context.textAlign = "center";
    context.fillText(formatNumber(tick), x, plotBottom + 34);
  }
  context.strokeStyle = "#94a3b8";
  context.lineWidth = 2;
  context.strokeRect(margin.left, margin.top, plotRight - margin.left, plotBottom - margin.top);
  if (yMin <= 0 && yMax >= 0) {
    context.save();
    context.setLineDash([10, 10]);
    context.beginPath();
    context.moveTo(margin.left, sy(0));
    context.lineTo(plotRight, sy(0));
    context.stroke();
    context.restore();
  }

  context.strokeStyle = curve.status === "source-verified" ? "#0d9488" : curve.collection === "legacy-cleaned" ? "#8b5cf6" : "#d97706";
  context.lineWidth = 3;
  context.lineJoin = "round";
  context.beginPath();
  curve.points.forEach(([x, y], index) => index ? context.lineTo(sx(x), sy(y)) : context.moveTo(sx(x), sy(y)));
  context.stroke();

  context.fillStyle = "#334155";
  context.font = "600 22px ui-monospace, monospace";
  context.textAlign = "center";
  context.fillText(`Separation · ${curve.xUnit}`, (margin.left + plotRight) / 2, plotBottom + 82);
  context.save();
  context.translate(48, (margin.top + plotBottom) / 2);
  context.rotate(-Math.PI / 2);
  context.fillText(`Force · ${curve.yUnit}`, 0, 0);
  context.restore();

  const conditions = pngConditionLines(curve);
  context.textAlign = "left";
  context.font = "600 19px system-ui, sans-serif";
  context.fillStyle = "#0f766e";
  context.fillText("EXPERIMENTAL CONDITIONS", margin.left, height - 142);
  context.font = "18px system-ui, sans-serif";
  context.fillStyle = "#334155";
  conditions.forEach((line, index) => context.fillText(line, margin.left, height - 105 + index * 30, width - margin.left - margin.right));
  context.textAlign = "right";
  context.fillStyle = "#64748b";
  context.font = "16px ui-monospace, monospace";
  context.fillText("IonicLink AFM workspace", plotRight, height - 34);

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((result) => result ? resolve(result) : reject(new Error("PNG generation failed.")), "image/png", 1);
  });
  downloadBlob(blob, filename);
}

function pngConditionLines(curve: AfmCurveRecord) {
  const value = <T,>(label: string, field: CuratedField<T>) => {
    if (field.value === null || field.value === "" || field.status === "not-reported") return null;
    return `${label}: ${formatCuratedField(field)}`;
  };
  const lineOne = [
    value("Ionic liquid", curve.context.ionicLiquid.name),
    value("Probe", curve.context.interface.probeMaterial),
    value("Substrate", curve.context.interface.substrate),
  ].filter(Boolean).join("   ·   ");
  const lineTwo = [
    value("Temperature", curve.context.thermodynamics.temperature),
    value("Atmosphere", curve.context.thermodynamics.atmosphere),
    value("Potential", curve.context.electrochemistry.electrodePotential),
  ].filter(Boolean).join("   ·   ");
  return [lineOne || "No reviewed system conditions reported", lineTwo || "No reviewed external/electrochemical conditions reported"];
}

function paddedExtent(values: number[]): [number, number] {
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (min === max) return [min - 1, max + 1];
  const padding = (max - min) * 0.05;
  min -= padding;
  max += padding;
  return [min, max];
}

function ticks(min: number, max: number, count: number) {
  return Array.from({ length: count }, (_, index) => min + ((max - min) * index) / (count - 1));
}

function formatNumber(value: number) {
  const magnitude = Math.abs(value);
  if ((magnitude !== 0 && magnitude < 0.01) || magnitude >= 1000) return value.toExponential(2);
  return Number(value.toPrecision(4)).toString();
}
