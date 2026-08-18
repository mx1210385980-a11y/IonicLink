"use client";

import { useEffect, useMemo, useState } from "react";
import type { AfmCurveDataset, AfmCurveRecord } from "@/lib/afm/afmCurves";
import type { CuratedField, FieldReviewStatus } from "@/lib/afm/interfacialExperiment";

type CollectionFilter = "all" | "qualified-new" | "legacy-cleaned";
type ReviewFilter = "all" | "verified" | "paper-suggested" | "needs-review" | "legacy-import";

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
  const [selectedId, setSelectedId] = useState(
    dataset.curves.find((curve) => curve.context.electrochemistry.relatedMeasurements.length > 0)?.id ??
      dataset.curves.find((curve) => curve.review.state === "verified")?.id ??
      dataset.curves[0]?.id ?? "",
  );

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return dataset.curves.filter((curve) => {
      if (collection !== "all" && curve.collection !== collection) return false;
      if (reviewFilter === "verified" && curve.review.state !== "verified") return false;
      if (reviewFilter === "paper-suggested" && !curve.paperCandidate?.status.includes("suggested")) return false;
      if (reviewFilter === "needs-review" && curve.review.state === "verified") return false;
      if (reviewFilter === "legacy-import" && curve.collection !== "legacy-cleaned") return false;
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
  }, [collection, dataset.curves, query, reviewFilter]);

  useEffect(() => {
    if (!filtered.some((curve) => curve.id === selectedId)) setSelectedId(filtered[0]?.id ?? "");
  }, [filtered, selectedId]);

  const selected = filtered.find((curve) => curve.id === selectedId) ?? filtered[0] ?? null;

  return (
    <div className="space-y-5">
      <DataReadiness dataset={dataset} />

      <section className="panel overflow-hidden">
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
                <option value="legacy-cleaned">Legacy cleaned curves</option>
              </select>
              <label className="sr-only" htmlFor="afm-review">Metadata review</label>
              <select
                id="afm-review"
                value={reviewFilter}
                onChange={(event) => setReviewFilter(event.target.value as ReviewFilter)}
                className="min-h-10 rounded-lg border border-ink-200 bg-white px-3 text-sm text-ink-800 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100"
              >
                <option value="all">All review states</option>
                <option value="verified">Metadata verified</option>
                <option value="paper-suggested">Paper match suggested</option>
                <option value="needs-review">Needs review</option>
                <option value="legacy-import">Legacy imports</option>
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
                      <span className="block truncate text-sm font-semibold text-ink-900">{curve.label}</span>
                      <span className="mt-1 flex items-center justify-between gap-2 text-[11px] text-ink-500">
                        <span className="flex min-w-0 items-center gap-1.5 truncate"><CurveToneDot curve={curve} /><span className="truncate">{curve.ionicLiquid || curve.source.folder}</span></span>
                        <span className="shrink-0 font-mono">{curve.review.verifiedPercent}% verified</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="rounded-lg border border-dashed border-ink-200 bg-white p-4 text-sm text-ink-600">No curves match these filters.</p>
            )}
          </div>

          <div className="min-w-0 p-4 sm:p-6">{selected ? <CurveDetail curve={selected} /> : null}</div>
        </div>
      </section>
    </div>
  );
}

function DataReadiness({ dataset }: { dataset: AfmCurveDataset }) {
  const summary = dataset.summary;
  return (
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
      <Metric label="Browsable curves" value={summary.totalCurves} detail={`${summary.qualifiedNewCurves} new + ${summary.legacyCleanedCurves} legacy`} />
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

function CurveDetail({ curve }: { curve: AfmCurveRecord }) {
  return (
    <article className="space-y-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={curve.status} />
            <ReviewBadge state={curve.review.state} />
            <DigitizationBadge curve={curve} />
            {curve.paperCandidate?.status.includes("suggested") ? <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-wide text-amber-800">Paper suggested</span> : null}
            <span className="chip">{curve.collection === "qualified-new" ? "New extraction" : "Legacy representative"}</span>
          </div>
          <h3 className="mt-3 break-words text-xl font-semibold tracking-tight text-ink-950">{curve.label}</h3>
          <p className="mt-1 font-mono text-xs text-ink-500">{curve.id}</p>
        </div>
        <span className="shrink-0 rounded-lg border border-ink-200 bg-ink-50 px-3 py-2 font-mono text-xs font-semibold text-ink-700">{curve.pointCount} points</span>
      </header>

      <ReviewProgress curve={curve} />
      <CurvePlot curve={curve} />
      {curve.layering.layerPositions.value?.length ? <LayeringPanel curve={curve} /> : null}
      {curve.paperCandidate?.requiresReview && curve.paperCandidate.candidate ? <SuggestedPaperPanel curve={curve} /> : null}

      <div className="grid gap-4 xl:grid-cols-3">
        <MetadataSection title="Experimental system">
          <MetadataLine label="Ionic liquid" field={curve.context.ionicLiquid.name} />
          <MetadataLine label="Cation" field={curve.context.ionicLiquid.cation} />
          <MetadataLine label="Anion" field={curve.context.ionicLiquid.anion} />
          <MetadataLine label="Substrate" field={curve.context.interface.substrate} />
          <MetadataLine label="Probe" field={curve.context.interface.probeMaterial} />
          <MetadataLine label="Temperature" field={curve.context.thermodynamics.temperature} />
          <MetadataLine label="Atmosphere" field={curve.context.thermodynamics.atmosphere} />
          <MetadataLine label="Water content" field={curve.context.thermodynamics.waterContent} />
        </MetadataSection>

        <MetadataSection title="AFM acquisition">
          <MetadataLine label="Technique" field={curve.acquisition.technique} />
          <MetadataLine label="Curve branch" field={curve.acquisition.curveBranch} />
          <MetadataLine label="Instrument" field={curve.acquisition.instrument} />
          <MetadataLine label="Scan rate" field={curve.acquisition.scanRate} />
          <MetadataLine label="Scan size" field={curve.acquisition.scanSize} />
          <MetadataLine label="Spring constant" field={curve.acquisition.springConstant} />
        </MetadataSection>

        <MetadataSection title="Electrochemical context">
          <MetadataLine label="Potential" field={curve.context.electrochemistry.electrodePotential} />
          <MetadataLine label="Reference" field={curve.context.electrochemistry.potentialReference} />
          <MetadataLine label="Capacitance" field={curve.context.electrochemistry.capacitance} />
          <MetadataLine label="Electric field" field={curve.context.electrochemistry.electricField} />
          <div className="flex items-center justify-between gap-3 border-t border-ink-100 pt-2 text-xs">
            <span className="text-ink-500">Related measurements</span>
            <span className="font-mono font-semibold text-ink-800">{curve.context.electrochemistry.relatedMeasurements.length}</span>
          </div>
          <div className="flex items-center justify-between gap-3 border-t border-ink-100 pt-2 text-xs">
            <span className="text-ink-500">Linked conductivity records</span>
            <span className="font-mono font-semibold text-ink-800">{curve.context.electrochemistry.linkedConductivityRecordIds.length}</span>
          </div>
        </MetadataSection>
      </div>

      {curve.context.electrochemistry.relatedMeasurements.length ? <RelatedElectrochemistryPanel curve={curve} /> : null}

      {curve.context.ionicLiquid.cationSmiles.value || curve.context.ionicLiquid.anionSmiles.value ? (
        <section className="rounded-xl border border-rose-200 bg-rose-50/70 p-4">
          <h4 className="label-eyebrow text-rose-800">Legacy molecular identifiers</h4>
          <p className="mt-2 text-xs leading-5 text-rose-900">
            These SMILES were copied from the old platform and have not passed chemical validation. Do not use them for RDKit descriptors yet.
          </p>
          <dl className="mt-3 space-y-2 font-mono text-xs text-rose-950">
            <TraceRow label="Cation" value={curve.context.ionicLiquid.cationSmiles.value || "—"} />
            <TraceRow label="Anion" value={curve.context.ionicLiquid.anionSmiles.value || "—"} />
          </dl>
        </section>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-2">
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
        <section className="rounded-xl border border-ink-200 bg-white p-4">
          <h4 className="label-eyebrow text-ink-600">Curation note</h4>
          <p className="mt-3 text-sm leading-6 text-ink-700">{curve.notes}</p>
          {curve.review.qualityFlags.length ? (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {curve.review.qualityFlags.map((flag) => <span key={flag} className="rounded-md bg-ink-100 px-2 py-1 font-mono text-[10px] text-ink-700">{flag}</span>)}
            </div>
          ) : null}
        </section>
      </div>
    </article>
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

function MetadataLine<T>({ label, field }: { label: string; field: CuratedField<T> }) {
  return (
    <div className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-2 border-b border-ink-100 pb-2 last:border-0 last:pb-0">
      <dt className="text-xs text-ink-500">{label}</dt>
      <dd className="min-w-0 text-right">
        <span className="block break-words text-xs font-medium text-ink-900">{formatCuratedField(field)}</span>
        <FieldStatus status={field.status} />
      </dd>
    </div>
  );
}

function FieldStatus({ status }: { status: FieldReviewStatus }) {
  const classes: Record<FieldReviewStatus, string> = {
    verified: "text-brand-700",
    reported: "text-cyan-700",
    inferred: "text-violet-700",
    "legacy-import": "text-rose-700",
    "not-reported": "text-ink-500",
    unreviewed: "text-amber-700",
  };
  return <span className={`mt-0.5 block font-mono text-[9px] font-semibold uppercase tracking-wide ${classes[status]}`}>{FIELD_STATUS_LABELS[status]}</span>;
}

function CurvePlot({ curve }: { curve: AfmCurveRecord }) {
  const width = 800;
  const height = 360;
  const margin = { left: 66, right: 24, top: 26, bottom: 52 };
  const xs = curve.points.map(([x]) => x);
  const ys = curve.points.map(([, y]) => y);
  const [xMin, xMax] = paddedExtent(xs);
  const [yMin, yMax] = paddedExtent(ys);
  const sx = (x: number) => margin.left + ((x - xMin) / (xMax - xMin)) * (width - margin.left - margin.right);
  const sy = (y: number) => height - margin.bottom - ((y - yMin) / (yMax - yMin)) * (height - margin.top - margin.bottom);
  const path = curve.points.map(([x, y], index) => `${index ? "L" : "M"}${sx(x).toFixed(2)},${sy(y).toFixed(2)}`).join(" ");
  const xTicks = ticks(xMin, xMax, 5);
  const yTicks = ticks(yMin, yMax, 5);
  const zeroInRange = yMin <= 0 && yMax >= 0;
  const gradientId = `afm-plot-${curve.id.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
  const tone = curve.status === "source-verified"
    ? { stroke: "#0d9488", point: "#0f766e", wash: "#ccfbf1", label: "Source-verified measurement", dotClass: "bg-brand-600" }
    : curve.collection === "legacy-cleaned"
      ? { stroke: "#8b5cf6", point: "#7c3aed", wash: "#ede9fe", label: "Legacy cleaned measurement", dotClass: "bg-violet-500" }
      : { stroke: "#d97706", point: "#b45309", wash: "#fef3c7", label: "Qualified measurement · metadata review", dotClass: "bg-amber-500" };

  return (
    <figure className="overflow-hidden rounded-[10px] border border-ink-200/80 bg-white shadow-sm">
      <div className="flex flex-col gap-2 border-b border-ink-100 bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="label-eyebrow text-ink-500">Force–distance trace</p>
          <p className="mt-1 text-xs text-ink-600">Digitized experimental points · stored order preserved</p>
        </div>
        <div className="flex flex-wrap items-center gap-3 font-mono text-[10px] text-ink-500">
          <span className="inline-flex items-center gap-1.5"><span className={`h-2.5 w-2.5 rounded-full ${tone.dotClass}`} />{tone.label}</span>
          <span className="rounded-md border border-ink-100 bg-ink-50 px-2 py-1 tnum">n = {curve.pointCount}</span>
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
            <text x={margin.left - 10} y={sy(tick) + 4} textAnchor="end" fontSize="10" fill="#64748b" fontFamily="ui-monospace, monospace">{formatNumber(tick)}</text>
          </g>
        ))}
        {xTicks.map((tick) => (
          <g key={`x-${tick}`}>
            <line x1={sx(tick)} x2={sx(tick)} y1={margin.top} y2={height - margin.bottom} stroke="#f1f5f9" />
            <text x={sx(tick)} y={height - margin.bottom + 20} textAnchor="middle" fontSize="10" fill="#64748b" fontFamily="ui-monospace, monospace">{formatNumber(tick)}</text>
          </g>
        ))}
        {zeroInRange ? <line x1={margin.left} x2={width - margin.right} y1={sy(0)} y2={sy(0)} stroke="#94a3b8" strokeWidth="1.2" strokeDasharray="5 5" /> : null}
        <line x1={margin.left} x2={width - margin.right} y1={height - margin.bottom} y2={height - margin.bottom} stroke="#94a3b8" />
        <line x1={margin.left} x2={margin.left} y1={margin.top} y2={height - margin.bottom} stroke="#94a3b8" />
        <path d={path} fill="none" stroke={tone.stroke} strokeWidth="1.45" strokeOpacity="0.6" strokeLinejoin="round" strokeLinecap="round" />
        {curve.points.map(([x, y], index) => <circle key={`${index}-${x}-${y}`} cx={sx(x)} cy={sy(y)} r="1.75" fill={tone.point} fillOpacity="0.9" />)}
        <text x={(margin.left + width - margin.right) / 2} y={height - 13} textAnchor="middle" fontSize="11" fontWeight="600" fill="#475569" fontFamily="ui-monospace, monospace">Separation · {curve.xUnit}</text>
        <text transform={`translate(18 ${(margin.top + height - margin.bottom) / 2}) rotate(-90)`} textAnchor="middle" fontSize="11" fontWeight="600" fill="#475569" fontFamily="ui-monospace, monospace">Force · {curve.yUnit}</text>
      </svg>
      <figcaption className="flex flex-col gap-1 border-t border-ink-100 bg-ink-50/60 px-4 py-2.5 text-xs text-ink-600 sm:flex-row sm:items-center sm:justify-between">
        <span>Units are displayed only when supported by the linked figure or reviewed source.</span>
        <span className="font-mono text-[10px] text-ink-500">x {formatNumber(Math.min(...xs))}–{formatNumber(Math.max(...xs))} {curve.xUnit} · y {formatNumber(Math.min(...ys))}–{formatNumber(Math.max(...ys))} {curve.yUnit}</span>
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
