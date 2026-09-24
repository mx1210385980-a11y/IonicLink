"use client";

import { useMemo, useRef, useState, type DragEvent, type MouseEvent } from "react";
import type { AfmAutomaticAxisCalibration } from "@/lib/afm/axisCalibration";
import { calibrateAfmPoints, type AfmDigitizationAnalysis, type AfmNormalizedPoint, type AfmPlotBox } from "@/lib/afm/digitizeCurve";
import {
  AFM_DIGITIZATION_DRAFT_STORAGE_KEY,
  mergeStoredAfmDrafts,
  parseStoredAfmDrafts,
  type AfmDigitizationDraft,
} from "@/lib/afm/digitizationDraft";
import type { AfmPanelConditions } from "@/lib/afm/multiPanel";
import type { AfmExperimentalMetadata, AfmMetadataField } from "@/lib/afm/experimentalMetadata";

export interface DigitizationCandidate {
  id: string;
  page: number | null;
  pageLabel: string;
  imageDataUrl: string;
  sourceFigure: {
    kind: "pdf-panel-crop" | "pdf-figure-crop" | "pdf-page" | "uploaded-image";
    width: number;
    height: number;
    renderScale: number | null;
    crop: { left: number; top: number; right: number; bottom: number } | null;
  };
  panel: {
    figureLabel: string;
    label: string;
    row: number;
    column: number;
    rows: number;
    columns: number;
    suggestedLabel: string;
    conditions: AfmPanelConditions;
  } | null;
  analysis: AfmDigitizationAnalysis;
  paperSignal: number;
  rankScore: number;
  axisCalibration?: AfmAutomaticAxisCalibration;
  experimentalMetadata?: AfmExperimentalMetadata;
}

interface DigitizationResponse {
  schemaVersion: number;
  sourceName: string;
  sourceType: "image" | "pdf";
  totalPages: number | null;
  selectedCandidateId: string;
  candidates: DigitizationCandidate[];
  matchedPaper: { doi: string; curveIds: string[] } | null;
  axisCalibration: AfmAutomaticAxisCalibration;
  experimentalMetadata: AfmExperimentalMetadata;
  reviewRequired: boolean;
  note: string;
}

export interface AxisForm {
  xMin: string;
  xMax: string;
  yMin: string;
  yMax: string;
  xUnit: string;
  yUnit: string;
}

const ACCEPTED_EXTENSIONS = /\.(pdf|png|jpe?g|webp)$/i;
export function AfmDigitizationWorkspace() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DigitizationResponse | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [curveLabel, setCurveLabel] = useState("");
  const [axes, setAxes] = useState<AxisForm>({ xMin: "", xMax: "", yMin: "", yMax: "", xUnit: "nm", yUnit: "nN" });
  const [reviewConfirmed, setReviewConfirmed] = useState(false);
  const [showManualCorrection, setShowManualCorrection] = useState(false);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [reviewedBoxes, setReviewedBoxes] = useState<Record<string, AfmPlotBox>>({});

  const selected = result?.candidates.find((candidate) => candidate.id === selectedId) ?? result?.candidates[0] ?? null;
  const selectedCalibration = selected?.axisCalibration ?? result?.axisCalibration ?? null;
  const reviewedBox = selected ? reviewedBoxes[selected.id] ?? selected.analysis.plotBox : null;
  const reviewedPoints = useMemo(
    () => selected && reviewedBox ? remapDetectedPoints(selected.analysis, reviewedBox) : [],
    [reviewedBox, selected],
  );
  const calibrated = useMemo(() => {
    if (!selected) return null;
    const numeric = numericAxes(axes);
    if (!numeric) return null;
    try {
      return calibrateAfmPoints(reviewedPoints, numeric);
    } catch {
      return null;
    }
  }, [axes, reviewedPoints, selected]);
  const automaticAxisActive = Boolean(selectedCalibration?.status === "auto-calibrated" && axisFormMatchesCalibration(axes, selectedCalibration));
  const exportReady = Boolean(calibrated?.length && (automaticAxisActive || reviewConfirmed) && axes.xUnit.trim() && axes.yUnit.trim());
  const downloadablePoints = calibrated ?? reviewedPoints.map((point) => [point.x, point.y] as [number, number]);
  const downloadableStatus: AfmDigitizationDraft["calibration"]["status"] = calibrated
    ? automaticAxisActive ? "physical-auto" : "physical-reviewed"
    : "relative-pending";

  const analyseFile = async (file: File) => {
    if (!ACCEPTED_EXTENSIONS.test(file.name)) {
      setError("Choose a PDF, PNG, JPG, JPEG, or WebP file.");
      return;
    }
    setBusy(true);
    setError(null);
    setSavedMessage(null);
    setReviewConfirmed(false);
    setShowManualCorrection(false);
    try {
      const form = new FormData();
      form.set("file", file);
      const response = await fetch("/api/afm/digitize", { method: "POST", body: form });
      const rawPayload = await response.text();
      let payload: DigitizationResponse & { error?: string };
      try {
        payload = JSON.parse(rawPayload) as DigitizationResponse & { error?: string };
      } catch {
        throw new Error(`The curve-recognition service returned an unreadable response (HTTP ${response.status}). Check the local Node.js runtime.`);
      }
      if (!response.ok) throw new Error(payload.error || "Curve recognition failed.");
      setResult(payload);
      setSelectedId(payload.selectedCandidateId);
      const initialCandidate = payload.candidates.find((candidate) => candidate.id === payload.selectedCandidateId) ?? payload.candidates[0];
      setCurveLabel(initialCandidate?.panel?.suggestedLabel ?? file.name.replace(/\.[^.]+$/, ""));
      const automaticAxes = axisFormFromCalibration(initialCandidate?.axisCalibration ?? payload.axisCalibration);
      setAxes(automaticAxes);
      setReviewedBoxes({});
      const canAutoQueue = payload.candidates.length === 1 || payload.candidates.every((candidate) => candidate.panel);
      if (canAutoQueue) {
        const calibrationStatus: AfmDigitizationDraft["calibration"]["status"] = payload.candidates.some((candidate) => (candidate.axisCalibration ?? payload.axisCalibration).status === "auto-calibrated")
          ? "physical-auto"
          : "relative-pending";
        const automaticDrafts = buildPanelDrafts(payload, automaticAxes, {}, calibrationStatus);
        try {
          persistDrafts(automaticDrafts);
          setSavedMessage(
            calibrationStatus === "physical-auto"
              ? `${automaticDrafts.length} curve(s) were calibrated automatically and added to the AI review queue below. No per-curve axis entry is required.`
              : `${automaticDrafts.length} curve(s) were retained in relative coordinates in the exception queue below; the original extraction has not been discarded.`,
          );
        } catch {
          setSavedMessage("Curves were recognized, but browser storage is full. Export JSON before clearing local review drafts.");
        }
      }
      if (payload.matchedPaper?.curveIds.length) {
        window.dispatchEvent(new CustomEvent("ioniclink:afm-paper-match", { detail: payload.matchedPaper }));
      }
    } catch (cause) {
      setResult(null);
      setError(cause instanceof Error ? cause.message : "Curve recognition failed.");
    } finally {
      setBusy(false);
    }
  };

  const chooseFiles = (files: FileList | null) => {
    const file = files?.[0];
    if (file) void analyseFile(file);
  };

  const saveDraft = () => {
    if (!selected || !calibrated || !exportReady) return;
    const draft = buildDraft(result!, selected, curveLabel, axes, calibrated, reviewedBox!, automaticAxisActive ? "physical-auto" : "physical-reviewed");
    try {
      persistDrafts([draft]);
      setSavedMessage(automaticAxisActive
        ? "This curve was updated in the AI review queue with automatically resolved physical axes; it is not labelled as human-verified."
        : "This curve was saved to the AFM review queue; it is not promoted automatically to verified data.");
    } catch {
      setSavedMessage("The browser could not save this draft. Export a JSON backup first.");
    }
  };

  const saveAllPanelDrafts = () => {
    if (!result || !result.candidates.length || !result.candidates.every((candidate) => candidate.panel)) return;
    const physicalAxes = numericAxes(axes);
    const physicallyReady = Boolean(physicalAxes && (automaticAxisActive || reviewConfirmed) && axes.xUnit.trim() && axes.yUnit.trim());
    const status: AfmDigitizationDraft["calibration"]["status"] = physicallyReady
      ? automaticAxisActive ? "physical-auto" : "physical-reviewed"
      : "relative-pending";
    const drafts = buildPanelDrafts(result, axes, reviewedBoxes, status);
    try {
      persistDrafts(drafts);
      setSavedMessage(
        physicallyReady
          ? `${drafts.length} curve(s) were updated in the review queue with ${automaticAxisActive ? "automatically resolved" : "manually corrected"} physical axes; metadata still requires review.`
          : `${drafts.length} curve(s) were saved to the calibration review queue with relative pixel coordinates only.`,
      );
    } catch {
      setSavedMessage("Browser storage is insufficient for every panel. Export JSON or remove obsolete local review drafts.");
    }
  };

  return (
    <section className="panel overflow-hidden" data-testid="afm-digitization-workspace">
      <div className="border-b border-ink-200 bg-gradient-to-r from-cyan-50/80 via-white to-brand-50/60 px-4 py-4 sm:px-6 sm:py-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl">
            <p className="label-eyebrow text-cyan-700">AFM curve digitization</p>
            <h2 className="mt-1 text-xl font-semibold tracking-tight text-ink-950">Digitize curves from papers or figure images</h2>
            <p className="mt-1 text-sm leading-6 text-ink-600">
              Upload a PDF or image. The platform locates figure pages, separates panels, extracts curves, and inherits physical axes and units when traceable evidence is available. Results enter the AI review queue automatically; manual controls are reserved for low-confidence exceptions.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-[11px] font-medium text-ink-600">
            <StageChip index="1" label="Upload" />
            <StageChip index="2" label="Source comparison" />
            <StageChip index="3" label="Axis calibration" />
            <StageChip index="4" label="Review / export" />
          </div>
        </div>
      </div>

      <div className="p-4 sm:p-6">
        {!result ? (
          <div
            className={`grid min-h-64 place-items-center rounded-2xl border-2 border-dashed px-5 py-10 text-center transition ${dragging ? "border-cyan-500 bg-cyan-50" : "border-ink-200 bg-ink-50/55 hover:border-cyan-300 hover:bg-cyan-50/40"}`}
            onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={(event) => { if (event.currentTarget === event.target) setDragging(false); }}
            onDrop={(event: DragEvent<HTMLDivElement>) => {
              event.preventDefault();
              setDragging(false);
              chooseFiles(event.dataTransfer.files);
            }}
          >
            <div>
              <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-cyan-100 text-cyan-800"><UploadIcon /></div>
              <h3 className="mt-4 text-lg font-semibold text-ink-950">Drop in a paper or an AFM curve image</h3>
              <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-ink-600">PDF pages are screened for credible force–distance or force–separation figures before digitization. Images are analysed directly.</p>
              <button
                type="button"
                disabled={busy}
                onClick={() => inputRef.current?.click()}
                className="mt-5 inline-flex min-h-11 items-center justify-center rounded-xl bg-ink-950 px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-ink-800 focus:outline-none focus:ring-2 focus:ring-cyan-300 disabled:cursor-wait disabled:opacity-60"
              >
                {busy ? "Analysing figure pages and curves…" : "Choose PDF or image"}
              </button>
              <input ref={inputRef} type="file" aria-label="Upload PDF or image" accept=".pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/png,image/jpeg,image/webp" className="sr-only" onChange={(event) => { chooseFiles(event.target.files); event.target.value = ""; }} />
              <p className="mt-3 font-mono text-[10px] uppercase tracking-wide text-ink-400">PDF · PNG · JPG · WEBP · max 35 MB</p>
            </div>
          </div>
        ) : selected ? (
          <div className="space-y-5">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="text-sm font-semibold text-ink-900">{result.sourceName}</p>
                <p className="mt-1 text-xs text-ink-500">
                  {result.sourceType === "pdf"
                    ? result.candidates.every((candidate) => candidate.panel)
                      ? `${result.totalPages} pages · ${result.candidates.length} panel curves detected and separated`
                      : `${result.totalPages} pages · ${result.candidates.length} candidate pages returned`
                    : "Single image"}
                </p>
                {result.matchedPaper?.curveIds.length ? (
                  <p className="mt-1 text-xs font-semibold text-brand-700">
                    Matched {result.matchedPaper.curveIds.length} existing curve record(s); the curve browser below is focused on them.
                  </p>
                ) : null}
              </div>
              <div className="flex max-h-36 flex-wrap gap-2 overflow-y-auto">
                {result.candidates.map((candidate, index) => (
                  <button
                    key={candidate.id}
                    type="button"
                    onClick={() => {
                      setSelectedId(candidate.id);
                      setCurveLabel(candidate.panel?.suggestedLabel ?? curveLabel);
                      setAxes(axisFormFromCalibration(candidate.axisCalibration ?? result.axisCalibration));
                      setReviewConfirmed(false);
                    }}
                    className={`rounded-lg border px-3 py-2 text-xs font-semibold transition ${candidate.id === selected.id ? "border-cyan-400 bg-cyan-50 text-cyan-900" : "border-ink-200 bg-white text-ink-600 hover:border-cyan-200"}`}
                  >
                    {candidate.panel ? `Panel ${candidate.panel.label}` : candidate.pageLabel}{index === 0 && !candidate.panel ? " · best" : ""}
                  </button>
                ))}
                {result.candidates.length > 1 && result.candidates.every((candidate) => candidate.panel) ? (
                  <button type="button" onClick={saveAllPanelDrafts} className="rounded-lg border border-brand-300 bg-brand-600 px-3 py-2 text-xs font-semibold text-white hover:bg-brand-700">
                    Rewrite all {result.candidates.length} curves
                  </button>
                ) : null}
                <button type="button" onClick={() => { setResult(null); setError(null); }} className="rounded-lg border border-ink-200 bg-white px-3 py-2 text-xs font-semibold text-ink-600 hover:bg-ink-50">Choose another file</button>
              </div>
            </div>

            <AfmSourceResultComparison candidate={selected} sourceName={result.sourceName} normalizedPoints={reviewedPoints} calibrated={calibrated} axes={axes} />

            {selected.panel ? <InheritedPanelContext panel={selected.panel} /> : null}
            <ExtractedExperimentalMetadata metadata={selected.experimentalMetadata ?? result.experimentalMetadata} />

            <div className="grid gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(20rem,0.85fr)]">
              <div className="space-y-3">
                <DigitizationOverlay
                  candidate={selected}
                  reviewedBox={reviewedBox!}
                  onReviewedBoxChange={(box) => {
                    setReviewedBoxes((current) => ({ ...current, [selected.id]: box }));
                    setReviewConfirmed(false);
                  }}
                />
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <QualityBadge quality={selected.analysis.quality} confidence={selected.analysis.confidence} />
                  <span className="chip">axis {Math.round(selected.analysis.axisConfidence * 100)}%</span>
                  <span className="chip">trace {Math.round(selected.analysis.traceConfidence * 100)}%</span>
                  <span className="chip">{reviewedPoints.length} sampled pixels</span>
                  {selected.analysis.traceColor ? <span className="chip"><span className="mr-1 inline-block h-2.5 w-2.5 rounded-full align-middle" style={{ backgroundColor: selected.analysis.traceColor.hex }} />{selected.analysis.traceColor.hex}</span> : null}
                </div>
                {selected.analysis.warnings.length ? (
                  <ul className="space-y-1 rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-3 text-xs leading-5 text-amber-950">
                    {selected.analysis.warnings.map((warning) => <li key={warning}>• {warning}</li>)}
                  </ul>
                ) : null}
              </div>

              <div className="space-y-4 rounded-2xl border border-ink-200 bg-ink-50/55 p-4 sm:p-5">
                <AutomaticAxisSummary calibration={selectedCalibration ?? result.axisCalibration} axes={axes} active={automaticAxisActive} />
                <label className="block text-xs font-semibold text-ink-700">Curve name
                  <input value={curveLabel} onChange={(event) => setCurveLabel(event.target.value)} className="mt-1.5 min-h-10 w-full rounded-lg border border-ink-200 bg-white px-3 text-sm font-normal text-ink-900 focus:border-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-100" />
                </label>
                <button type="button" onClick={() => setShowManualCorrection((value) => !value)} className="min-h-10 w-full rounded-lg border border-ink-200 bg-white px-3 text-xs font-semibold text-ink-700 hover:border-cyan-300 hover:text-cyan-800">
                  {showManualCorrection ? "Hide exception controls" : "Recognition issue? Open exception controls"}
                </button>
                {showManualCorrection ? (
                  <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50/55 p-3" data-testid="afm-axis-exception-editor">
                    <p className="text-xs leading-5 text-amber-950">Use this only for papers that automatic recognition cannot resolve. Endpoint or unit corrections require confirmation, and the original automatic evidence remains in the draft.</p>
                    <div className="grid grid-cols-2 gap-3">
                      <AxisInput label="X minimum" value={axes.xMin} onChange={(value) => updateAxis(setAxes, "xMin", value)} />
                      <AxisInput label="X maximum" value={axes.xMax} onChange={(value) => updateAxis(setAxes, "xMax", value)} />
                      <AxisInput label="Y minimum" value={axes.yMin} onChange={(value) => updateAxis(setAxes, "yMin", value)} />
                      <AxisInput label="Y maximum" value={axes.yMax} onChange={(value) => updateAxis(setAxes, "yMax", value)} />
                      <AxisInput label="X unit" value={axes.xUnit} onChange={(value) => updateAxis(setAxes, "xUnit", value)} text />
                      <AxisInput label="Y unit" value={axes.yUnit} onChange={(value) => updateAxis(setAxes, "yUnit", value)} text />
                    </div>
                    <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-cyan-200 bg-white px-3 py-3 text-xs leading-5 text-ink-700">
                      <input type="checkbox" checked={reviewConfirmed} onChange={(event) => setReviewConfirmed(event.target.checked)} disabled={!calibrated} className="mt-0.5 h-4 w-4 rounded border-ink-300 text-cyan-600 focus:ring-cyan-300" />
                      <span>I compared this manual correction with the source figure. The record remains <strong>Digitized from figure · pending metadata review</strong> and is not presented as verified data.</span>
                    </label>
                  </div>
                ) : null}
                <div className="grid gap-2 sm:grid-cols-2">
                  <button type="button" disabled={!downloadablePoints.length} onClick={() => downloadCsv(result, selected, curveLabel, axes, downloadablePoints, downloadableStatus)} className="min-h-10 rounded-lg border border-ink-200 bg-white px-3 text-xs font-semibold text-ink-800 hover:bg-ink-50 disabled:cursor-not-allowed disabled:opacity-40">Export CSV points</button>
                  <button type="button" disabled={!downloadablePoints.length} onClick={() => downloadJson(result, selected, curveLabel, axes, downloadablePoints, reviewedBox!, downloadableStatus)} className="min-h-10 rounded-lg border border-ink-200 bg-white px-3 text-xs font-semibold text-ink-800 hover:bg-ink-50 disabled:cursor-not-allowed disabled:opacity-40">Export JSON record</button>
                  <button type="button" disabled={!downloadablePoints.length} onClick={() => void downloadDigitizedPng(result, selected, curveLabel, axes, downloadablePoints, downloadableStatus)} className="min-h-10 rounded-lg border border-ink-200 bg-white px-3 text-xs font-semibold text-ink-800 hover:bg-ink-50 disabled:cursor-not-allowed disabled:opacity-40">Export PNG chart</button>
                  <button type="button" disabled={!exportReady} onClick={saveDraft} className="min-h-10 rounded-lg bg-cyan-700 px-3 text-xs font-semibold text-white hover:bg-cyan-800 disabled:cursor-not-allowed disabled:opacity-40">Update review draft</button>
                </div>
                {!calibrated && downloadablePoints.length ? <p className="text-[10px] leading-4 text-amber-800">CSV, JSON, and PNG remain exportable for audit in explicitly labelled relative coordinates. Only physically calibrated curves can be promoted as model-ready data.</p> : null}
                {savedMessage ? <p role="status" className="rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-xs text-brand-900">{savedMessage} <a href="#afm-curve-browser" className="font-semibold underline underline-offset-2">View curves below</a></p> : null}
              </div>
            </div>
          </div>
        ) : null}

        {error ? <p role="alert" className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</p> : null}
      </div>
    </section>
  );
}

function StageChip({ index, label }: { index: string; label: string }) {
  return <span className="inline-flex items-center gap-1.5 rounded-full border border-ink-200 bg-white/80 px-2.5 py-1.5"><span className="grid h-4 w-4 place-items-center rounded-full bg-ink-900 font-mono text-[9px] text-white">{index}</span>{label}</span>;
}

export function InheritedPanelContext({ panel }: { panel: NonNullable<DigitizationCandidate["panel"]> }) {
  const fields = [
    { label: "Ionic liquid", condition: panel.conditions.ionicLiquid },
    { label: "Substrate", condition: panel.conditions.substrate },
    { label: "Electrode potential", condition: panel.conditions.electrodePotential },
  ];
  return (
    <section data-testid="afm-inferred-panel-context" className="rounded-2xl border border-amber-200 bg-amber-50/55 p-4 sm:p-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="label-eyebrow text-amber-800">Inherited panel context</p>
          <h3 className="mt-1 text-base font-semibold text-ink-950">Figure {panel.figureLabel} · Panel {panel.label}</h3>
          <p className="mt-1 text-xs leading-5 text-ink-600">These conditions are inherited automatically from the caption, panel ranges, and row order. They remain inferred until reviewed.</p>
        </div>
        <span className="w-fit rounded-full border border-amber-300 bg-white px-2.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-wide text-amber-900">INFERRED · REVIEW REQUIRED</span>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-3">
        {fields.map(({ label, condition }) => (
          <div key={label} className="rounded-xl border border-amber-100 bg-white px-3 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-500">{label}</p>
            <p className="mt-1 text-sm font-semibold text-ink-950">{formatInheritedValue(condition.value, condition.unit)}</p>
            <p className="mt-1 font-mono text-[10px] text-amber-800">Inferred · {Math.round(condition.confidence * 100)}%</p>
            <p className="mt-1 text-[10px] leading-4 text-ink-500">{condition.evidence}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function ExtractedExperimentalMetadata({ metadata }: { metadata: AfmExperimentalMetadata }) {
  const fields: Array<{ label: string; field: AfmMetadataField<unknown> }> = [
    { label: "Probe material", field: metadata.probe.material },
    { label: "Tip radius", field: metadata.probe.tipRadius },
    { label: "Cantilever spring constant", field: metadata.probe.cantileverSpringConstant },
    { label: "Approach speed", field: metadata.acquisition.approachSpeed },
    { label: "Temperature", field: metadata.externalFactors.temperature },
    { label: "Atmosphere", field: metadata.externalFactors.atmosphere },
    { label: "Water content", field: metadata.externalFactors.waterContent },
  ];
  return (
    <section className="rounded-2xl border border-cyan-200 bg-cyan-50/35 p-4 sm:p-5" data-testid="afm-extracted-experimental-metadata">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="label-eyebrow text-cyan-800">Automatically extracted experiment context</p>
          <h3 className="mt-1 text-base font-semibold text-ink-950">Ionic liquid, interface, probe, and external conditions</h3>
          <p className="mt-1 text-xs leading-5 text-ink-600">Only values stated explicitly in the paper are populated. An empty field means “not reported,” never an assumed room-temperature or ambient value.</p>
        </div>
        <span className="w-fit rounded-full border border-cyan-200 bg-white px-2.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-wide text-cyan-900">AI extracted · evidence retained</span>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetadataListCard label="Ionic liquids" values={metadata.ionicLiquids} />
        <MetadataListCard label="Substrates" values={metadata.substrates} />
        {fields.map(({ label, field }) => <MetadataFieldCard key={label} label={label} field={field} />)}
      </div>
    </section>
  );
}

function MetadataListCard({ label, values }: { label: string; values: AfmMetadataField<string>[] }) {
  const value = values.length ? values.map((item) => item.value).filter(Boolean).join(" · ") : "Not reported";
  const evidence = values[0]?.evidence ?? "No explicit value was found in the article text.";
  return <MetadataCard label={label} value={value} status={values.length ? "extracted" : "not-reported"} evidence={evidence} />;
}

function MetadataFieldCard({ label, field }: { label: string; field: AfmMetadataField<unknown> }) {
  const value = field.value === null ? "Not reported" : `${String(field.value)}${field.unit ? ` ${field.unit}` : ""}`;
  return <MetadataCard label={label} value={value} status={field.status} evidence={field.evidence} />;
}

function MetadataCard({ label, value, status, evidence }: { label: string; value: string; status: string; evidence: string }) {
  return (
    <div className="rounded-xl border border-cyan-100 bg-white px-3 py-3">
      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-500">{label}</p>
      <p className="mt-1 text-sm font-semibold text-ink-950">{value}</p>
      <p className={`mt-1 font-mono text-[10px] uppercase ${status === "extracted" ? "text-brand-700" : "text-ink-400"}`}>{status}</p>
      <p className="mt-1 line-clamp-3 text-[10px] leading-4 text-ink-500" title={evidence}>{evidence}</p>
    </div>
  );
}

function formatInheritedValue(value: string | number | null, unit: string | null) {
  if (value === null) return "Not resolved";
  const formatted = typeof value === "number" && value > 0 ? `+${value}` : String(value);
  return unit ? `${formatted} ${unit}` : formatted;
}

function UploadIcon() {
  return <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 16V5m0 0L8 9m4-4 4 4M5 15v3.5h14V15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function QualityBadge({ quality, confidence }: { quality: AfmDigitizationAnalysis["quality"]; confidence: number }) {
  const classes = quality === "high" ? "border-brand-200 bg-brand-50 text-brand-800" : quality === "medium" ? "border-amber-200 bg-amber-50 text-amber-800" : "border-rose-200 bg-rose-50 text-rose-800";
  return <span className={`rounded-full border px-2.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-wide ${classes}`}>{quality} · {Math.round(confidence * 100)}%</span>;
}

export function AfmSourceResultComparison({
  candidate,
  sourceName,
  normalizedPoints,
  calibrated,
  axes,
}: {
  candidate: DigitizationCandidate;
  sourceName: string;
  normalizedPoints: AfmNormalizedPoint[];
  calibrated: Array<[number, number]> | null;
  axes: AxisForm;
}) {
  return (
    <section data-testid="afm-source-result-comparison" className="overflow-hidden rounded-2xl border border-ink-200 bg-white shadow-sm">
      <div className="flex flex-col gap-2 border-b border-ink-200 bg-gradient-to-r from-slate-50 via-white to-cyan-50/60 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div>
          <p className="label-eyebrow text-cyan-700">Source vs digitized result</p>
          <h3 className="mt-1 text-base font-semibold text-ink-950">Original paper curve versus platform digitization</h3>
        </div>
        <span className="w-fit rounded-full border border-cyan-200 bg-cyan-50 px-2.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-wide text-cyan-800">
          same candidate · {candidate.pageLabel}
        </span>
      </div>
      <div className="grid xl:grid-cols-2">
        <OriginalFigurePanel candidate={candidate} sourceName={sourceName} />
        <ExtractedCurvePanel normalizedPoints={normalizedPoints} segmentStarts={candidate.analysis.segmentStarts} calibrated={calibrated} axes={axes} />
      </div>
      <div className="border-t border-ink-100 bg-ink-50/60 px-4 py-2.5 text-xs leading-5 text-ink-600 sm:px-5">
        The left side preserves the paper image without recognition overlays. The right side is reconstructed only from detected coordinates. Compare both views to identify missed points, false points, or an incorrect plot region.
      </div>
    </section>
  );
}

function OriginalFigurePanel({ candidate, sourceName }: { candidate: DigitizationCandidate; sourceName: string }) {
  const [expanded, setExpanded] = useState(false);
  const sourceKind = candidate.sourceFigure.kind === "pdf-panel-crop"
    ? "PDF panel crop"
    : candidate.sourceFigure.kind === "pdf-figure-crop"
    ? "PDF figure crop"
    : candidate.sourceFigure.kind === "pdf-page"
      ? "PDF page"
      : "Uploaded image";
  const figureLabel = `${sourceName}${candidate.page ? ` · page ${candidate.page}` : ""}`;
  const figure = (
    <svg
      viewBox={`0 0 ${candidate.sourceFigure.width} ${candidate.sourceFigure.height}`}
      className="block max-h-[32rem] w-full"
      role="img"
      aria-label={`Original AFM curve figure from ${figureLabel}`}
    >
      <rect width="100%" height="100%" fill="white" />
      <image href={candidate.imageDataUrl} width={candidate.sourceFigure.width} height={candidate.sourceFigure.height} />
    </svg>
  );
  return (
    <figure className="min-w-0 border-b border-ink-100 xl:border-b-0 xl:border-r">
      <div className="flex items-center justify-between gap-3 border-b border-ink-100 bg-slate-50/70 px-4 py-2.5 sm:px-5">
        <div>
          <p className="text-sm font-semibold text-ink-950">Original paper curve</p>
          <p className="mt-0.5 font-mono text-[10px] text-ink-500">{sourceKind} · {candidate.sourceFigure.width}×{candidate.sourceFigure.height} px</p>
        </div>
        <button type="button" onClick={() => setExpanded(true)} className="rounded-lg border border-ink-200 bg-white px-3 py-1.5 text-xs font-semibold text-ink-700 hover:border-cyan-300 hover:text-cyan-800">View full resolution</button>
      </div>
      <div className="grid min-h-[22rem] place-items-center overflow-hidden bg-[#eef3f7] p-3 sm:p-4">{figure}</div>
      <figcaption className="border-t border-ink-100 px-4 py-2.5 text-xs text-ink-600 sm:px-5">{figureLabel} · original axes, legend, and paper annotations retained</figcaption>
      {expanded ? (
        <div role="dialog" aria-modal="true" aria-label="High-resolution original AFM curve" className="fixed inset-0 z-[80] grid place-items-center bg-ink-950/75 p-4 backdrop-blur-sm" onMouseDown={(event) => { if (event.currentTarget === event.target) setExpanded(false); }}>
          <div className="flex max-h-[94vh] w-full max-w-7xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between gap-4 border-b border-ink-200 px-4 py-3 sm:px-5">
              <div className="min-w-0"><p className="truncate text-sm font-semibold text-ink-950">{figureLabel}</p><p className="mt-0.5 text-xs text-ink-500">Full-resolution source · no recognition overlay</p></div>
              <button type="button" autoFocus onClick={() => setExpanded(false)} className="rounded-lg border border-ink-200 px-3 py-2 text-xs font-semibold text-ink-700 hover:bg-ink-50">Close</button>
            </div>
            <div className="min-h-0 flex-1 overflow-auto bg-[#dfe7ed] p-4">{figure}</div>
          </div>
        </div>
      ) : null}
    </figure>
  );
}

function ExtractedCurvePanel({ normalizedPoints, segmentStarts, calibrated, axes }: { normalizedPoints: AfmNormalizedPoint[]; segmentStarts: number[]; calibrated: Array<[number, number]> | null; axes: AxisForm }) {
  const points = calibrated ?? normalizedPoints.map((point) => [point.x, point.y] as [number, number]);
  const bounds = calibrated ? numericAxes(axes) : { xMin: 0, xMax: 1, yMin: 0, yMax: 1 };
  const sampled = points.length > 1400 ? points.filter((_, index) => index % Math.ceil(points.length / 1400) === 0) : points;
  const left = 58; const top = 24; const width = 470; const height = 272;
  const xSpan = (bounds?.xMax ?? 1) - (bounds?.xMin ?? 0);
  const ySpan = (bounds?.yMax ?? 1) - (bounds?.yMin ?? 0);
  const sx = (value: number) => left + ((value - (bounds?.xMin ?? 0)) / (Math.abs(xSpan) < 1e-12 ? 1 : xSpan)) * width;
  const sy = (value: number) => top + height - ((value - (bounds?.yMin ?? 0)) / (Math.abs(ySpan) < 1e-12 ? 1 : ySpan)) * height;
  const fmt = (value: number | undefined) => value == null ? "—" : Number(value.toPrecision(5)).toString();
  const displaySegments = splitDisplaySegments(sampled.map(([x, y]) => ({ x: sx(x), y: sy(y) })), width, height, segmentStarts);
  return (
    <figure className="min-w-0">
      <div className="flex items-center justify-between gap-3 border-b border-ink-100 bg-cyan-50/45 px-4 py-2.5 sm:px-5">
        <div>
          <p className="text-sm font-semibold text-ink-950">Platform-digitized curve</p>
          <p className="mt-0.5 font-mono text-[10px] text-ink-500">{points.length} coordinate points · {calibrated ? "physical axes" : "normalised preview"}</p>
        </div>
        <span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold ${calibrated ? "border-brand-200 bg-brand-50 text-brand-800" : "border-amber-200 bg-amber-50 text-amber-800"}`}>{calibrated ? "Calibrated" : "Relative-coordinate preview"}</span>
      </div>
      <div className="grid min-h-[22rem] place-items-center bg-white p-3 sm:p-4">
        {sampled.length && bounds ? (
          <svg viewBox="0 0 560 350" className="block max-h-[32rem] w-full" role="img" aria-label="Digitized AFM curve reconstructed from extracted coordinate points">
            <rect x={left} y={top} width={width} height={height} rx="3" fill="#f8fafc" stroke="#dbe4ec" />
            {[0.25, 0.5, 0.75].map((fraction) => <g key={fraction}><line x1={left + width * fraction} x2={left + width * fraction} y1={top} y2={top + height} stroke="#e2e8f0" /><line x1={left} x2={left + width} y1={top + height * fraction} y2={top + height * fraction} stroke="#e2e8f0" /></g>)}
            <line x1={left} x2={left + width} y1={top + height} y2={top + height} stroke="#64748b" strokeWidth="1.5" />
            <line x1={left} x2={left} y1={top} y2={top + height} stroke="#64748b" strokeWidth="1.5" />
            {displaySegments.map((segment, index) => <polyline key={index} points={segment.map((point) => `${point.x},${point.y}`).join(" ")} fill="none" stroke="#0f766e" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" opacity="0.82" />)}
            {sampled.slice(0, 900).map(([x, y], index) => <circle key={index} cx={sx(x)} cy={sy(y)} r="1.35" fill="#0891b2" fillOpacity="0.7" />)}
            {calibrated ? <>
              <text x={left} y={top + height + 17} textAnchor="middle" fontSize="10" fill="#64748b">{fmt(bounds.xMin)}</text>
              <text x={left + width} y={top + height + 17} textAnchor="middle" fontSize="10" fill="#64748b">{fmt(bounds.xMax)}</text>
              <text x={left - 8} y={top + height + 3} textAnchor="end" fontSize="10" fill="#64748b">{fmt(bounds.yMin)}</text>
              <text x={left - 8} y={top + 4} textAnchor="end" fontSize="10" fill="#64748b">{fmt(bounds.yMax)}</text>
            </> : <text x={left + 8} y={top + 16} fontSize="10" fontWeight="600" fill="#b45309">RELATIVE PIXEL SPACE · NOT PHYSICAL AXES</text>}
            <text x={left + width / 2} y="340" textAnchor="middle" fontSize="11" fontWeight="600" fill="#475569">{calibrated ? `Separation (${axes.xUnit})` : "Relative horizontal position"}</text>
            <text x="15" y={top + height / 2} transform={`rotate(-90 15 ${top + height / 2})`} textAnchor="middle" fontSize="11" fontWeight="600" fill="#475569">{calibrated ? `Force (${axes.yUnit})` : "Relative vertical position"}</text>
          </svg>
        ) : <div className="text-center"><p className="text-sm font-semibold text-ink-700">No credible redrawable curve was found</p><p className="mt-1 text-xs text-ink-500">Choose another figure candidate or correct the plot region.</p></div>}
      </div>
      <figcaption className="border-t border-ink-100 px-4 py-2.5 text-xs text-ink-600 sm:px-5">{calibrated ? "The digitized result uses traceable physical axis endpoints from the paper. Automatic inheritance and manual corrections are identified separately in exports." : "This view shows relative pixel position without artificial 0–1 tick labels. It is not a physical paper axis and remains in the exception queue."}</figcaption>
    </figure>
  );
}

export function splitDisplaySegments(points: Array<{ x: number; y: number }>, width: number, height: number, segmentStarts: number[] = []) {
  const segments: Array<Array<{ x: number; y: number }>> = [];
  const jumpLimit = Math.hypot(width, height) * 0.16;
  const explicitStarts = new Set(segmentStarts.filter((index) => index > 0));
  points.forEach((point, index) => {
    const segment = segments[segments.length - 1];
    const previous = segment?.[segment.length - 1];
    if (!segment || explicitStarts.has(index) || (previous && Math.hypot(point.x - previous.x, point.y - previous.y) > jumpLimit)) {
      segments.push([point]);
    } else {
      segment.push(point);
    }
  });
  return segments.filter((segment) => segment.length >= 2);
}

function DigitizationOverlay({
  candidate,
  reviewedBox,
  onReviewedBoxChange,
}: {
  candidate: DigitizationCandidate;
  reviewedBox: AfmPlotBox;
  onReviewedBoxChange: (box: AfmPlotBox) => void;
}) {
  const { analysis } = candidate;
  const [selecting, setSelecting] = useState(false);
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  const chooseCorner = (event: MouseEvent<SVGSVGElement>) => {
    if (!selecting) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const point = {
      x: ((event.clientX - bounds.left) / Math.max(1, bounds.width)) * analysis.width,
      y: ((event.clientY - bounds.top) / Math.max(1, bounds.height)) * analysis.height,
    };
    if (!anchor) {
      setAnchor(point);
      return;
    }
    const box = {
      left: Math.max(0, Math.round(Math.min(anchor.x, point.x))),
      top: Math.max(0, Math.round(Math.min(anchor.y, point.y))),
      right: Math.min(analysis.width - 1, Math.round(Math.max(anchor.x, point.x))),
      bottom: Math.min(analysis.height - 1, Math.round(Math.max(anchor.y, point.y))),
    };
    if (box.right - box.left >= 20 && box.bottom - box.top >= 20) onReviewedBoxChange(box);
    setAnchor(null);
    setSelecting(false);
  };
  return (
    <figure className="overflow-hidden rounded-xl border border-ink-200 bg-[#eef3f7]">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-200 bg-white px-4 py-2.5 text-xs text-ink-600">
        <span>{selecting ? (anchor ? "Click the lower-right plot corner" : "Click the upper-left plot corner") : "Recognition review overlay"}</span>
        <div className="flex items-center gap-2">
          <span className="font-mono">cyan box · red trace pixels</span>
          <button type="button" onClick={() => { setSelecting((value) => !value); setAnchor(null); }} className="rounded-md border border-cyan-200 bg-cyan-50 px-2 py-1 font-semibold text-cyan-800 hover:bg-cyan-100">{selecting ? "Cancel selection" : "Correct plot region"}</button>
          {JSON.stringify(reviewedBox) !== JSON.stringify(analysis.plotBox) ? <button type="button" onClick={() => onReviewedBoxChange(analysis.plotBox)} className="rounded-md border border-ink-200 bg-white px-2 py-1 font-semibold text-ink-600 hover:bg-ink-50">Restore automatic region</button> : null}
        </div>
      </div>
      <svg viewBox={`0 0 ${analysis.width} ${analysis.height}`} className={`block max-h-[36rem] w-full ${selecting ? "cursor-crosshair" : ""}`} role="img" aria-label="AFM curve recognition overlay" onClick={chooseCorner}>
        <image href={candidate.imageDataUrl} width={analysis.width} height={analysis.height} />
        <rect x={reviewedBox.left} y={reviewedBox.top} width={reviewedBox.right - reviewedBox.left} height={reviewedBox.bottom - reviewedBox.top} fill="none" stroke="#06b6d4" strokeWidth={Math.max(2, analysis.width / 420)} strokeDasharray={`${Math.max(6, analysis.width / 120)} ${Math.max(4, analysis.width / 190)}`} />
        {anchor ? <circle cx={anchor.x} cy={anchor.y} r={Math.max(4, analysis.width / 180)} fill="#06b6d4" stroke="white" strokeWidth="2" /> : null}
        {analysis.normalizedPoints.map((point, index) => (
          <circle key={index} cx={analysis.plotBox.left + point.x * (analysis.plotBox.right - analysis.plotBox.left)} cy={analysis.plotBox.bottom - point.y * (analysis.plotBox.bottom - analysis.plotBox.top)} r={Math.max(1.2, analysis.width / 900)} fill="#ef4444" fillOpacity="0.56" />
        ))}
      </svg>
      <figcaption className="border-t border-ink-200 bg-white px-4 py-2 text-xs text-ink-600">Red points are curve pixels selected by the algorithm. If the cyan box is wrong, choose “Correct plot region” and click the upper-left and lower-right plot corners. Points outside the box are excluded from exports.</figcaption>
    </figure>
  );
}

function AxisInput({ label, value, onChange, text = false }: { label: string; value: string; onChange: (value: string) => void; text?: boolean }) {
  return <label className="text-[11px] font-semibold text-ink-600">{label}<input type={text ? "text" : "number"} step="any" value={value} onChange={(event) => onChange(event.target.value)} placeholder={text ? "unit" : "required"} className="mt-1 min-h-9 w-full rounded-lg border border-ink-200 bg-white px-2.5 text-sm font-normal text-ink-900 focus:border-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-100" /></label>;
}

function AutomaticAxisSummary({ calibration, axes, active }: { calibration: AfmAutomaticAxisCalibration; axes: AxisForm; active: boolean }) {
  const method = calibration.method === "verified-source-profile"
    ? "Verified paper axes resolved by DOI"
    : calibration.method === "explicit-document-range"
      ? "Explicit axis range reported in the PDF"
      : "Relative pixel-coordinate fallback";
  return (
    <div className={`rounded-xl border p-3 ${active ? "border-brand-200 bg-brand-50/70" : "border-amber-200 bg-amber-50/70"}`} data-testid="afm-automatic-axis-summary">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className={`label-eyebrow ${active ? "text-brand-700" : "text-amber-800"}`}>Automatic axis calibration</p>
          <h3 className="mt-1 text-base font-semibold text-ink-950">{active ? "Physical axes resolved automatically" : "Curve retained; physical axes need exception handling"}</h3>
        </div>
        <span className={`rounded-full border bg-white px-2.5 py-1 font-mono text-[10px] font-semibold uppercase ${active ? "border-brand-200 text-brand-800" : "border-amber-300 text-amber-900"}`}>
          {active ? `AUTO · ${Math.round(calibration.confidence * 100)}%` : "RELATIVE · REVIEW"}
        </span>
      </div>
      {active ? (
        <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
          <AxisSummaryValue label="X range" value={`${axes.xMin} – ${axes.xMax} ${axes.xUnit}`} />
          <AxisSummaryValue label="Y range" value={`${axes.yMin} – ${axes.yMax} ${axes.yUnit}`} />
          <AxisSummaryValue label="Method" value={method} />
          <AxisSummaryValue label="Data state" value="AI extracted · metadata review" />
        </div>
      ) : (
        <p className="mt-2 text-xs leading-5 text-amber-950">Unreliable ticks are never guessed as experimental values. The centreline is retained in relative coordinates without requiring the user to complete a form first.</p>
      )}
      <ul className="mt-2 space-y-1 text-[10px] leading-4 text-ink-500">
        {calibration.evidence.map((evidence) => <li key={evidence}>• {evidence}</li>)}
      </ul>
    </div>
  );
}

function AxisSummaryValue({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg border border-white/80 bg-white px-2.5 py-2"><p className="font-mono text-[9px] uppercase tracking-wide text-ink-400">{label}</p><p className="mt-1 font-semibold leading-4 text-ink-800">{value}</p></div>;
}

function updateAxis(setAxes: (update: (current: AxisForm) => AxisForm) => void, key: keyof AxisForm, value: string) {
  setAxes((current) => ({ ...current, [key]: value }));
}

function numericAxes(axes: AxisForm) {
  if ([axes.xMin, axes.xMax, axes.yMin, axes.yMax].some((value) => value.trim() === "")) return null;
  const parsed = { xMin: Number(axes.xMin), xMax: Number(axes.xMax), yMin: Number(axes.yMin), yMax: Number(axes.yMax) };
  if (Object.values(parsed).some((value) => !Number.isFinite(value)) || parsed.xMin === parsed.xMax || parsed.yMin === parsed.yMax) return null;
  return parsed;
}

function axisFormFromCalibration(calibration: AfmAutomaticAxisCalibration): AxisForm {
  const value = calibration.axes;
  return value
    ? { xMin: String(value.xMin), xMax: String(value.xMax), yMin: String(value.yMin), yMax: String(value.yMax), xUnit: value.xUnit, yUnit: value.yUnit }
    : { xMin: "", xMax: "", yMin: "", yMax: "", xUnit: "nm", yUnit: "nN" };
}

function axisFormMatchesCalibration(axes: AxisForm, calibration: AfmAutomaticAxisCalibration) {
  if (!calibration.axes) return false;
  const numeric = numericAxes(axes);
  return Boolean(numeric
    && numeric.xMin === calibration.axes.xMin
    && numeric.xMax === calibration.axes.xMax
    && numeric.yMin === calibration.axes.yMin
    && numeric.yMax === calibration.axes.yMax
    && axes.xUnit.trim() === calibration.axes.xUnit
    && axes.yUnit.trim() === calibration.axes.yUnit);
}

function buildPanelDrafts(
  result: DigitizationResponse,
  axes: AxisForm,
  reviewedBoxes: Record<string, AfmPlotBox>,
  status: AfmDigitizationDraft["calibration"]["status"],
) {
  return result.candidates.map((candidate) => {
    const candidateCalibration = candidate.axisCalibration ?? result.axisCalibration;
    const candidateAxes = status === "physical-auto"
      ? axisFormFromCalibration(candidateCalibration)
      : axes;
    const physicalAxes = numericAxes(candidateAxes);
    const candidateStatus: AfmDigitizationDraft["calibration"]["status"] =
      status === "physical-auto" && candidateCalibration.status !== "auto-calibrated"
        ? "relative-pending"
        : status;
    const physical = candidateStatus !== "relative-pending" && physicalAxes;
    const box = reviewedBoxes[candidate.id] ?? candidate.analysis.plotBox;
    const normalized = remapDetectedPoints(candidate.analysis, box);
    const points = physical
      ? calibrateAfmPoints(normalized, physicalAxes)
      : normalized.map((point) => [point.x, point.y] as [number, number]);
    return buildDraft(result, candidate, candidate.panel?.suggestedLabel ?? candidate.pageLabel, candidateAxes, points, box, candidateStatus);
  });
}

function persistDrafts(drafts: AfmDigitizationDraft[]) {
  const existing = parseStoredAfmDrafts(window.localStorage.getItem(AFM_DIGITIZATION_DRAFT_STORAGE_KEY));
  const next = mergeStoredAfmDrafts(existing, drafts);
  window.localStorage.setItem(AFM_DIGITIZATION_DRAFT_STORAGE_KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent("ioniclink:afm-drafts-updated", { detail: { ids: drafts.map((draft) => draft.id) } }));
}

function buildDraft(
  result: DigitizationResponse,
  candidate: DigitizationCandidate,
  label: string,
  axes: AxisForm,
  points: Array<[number, number]>,
  plotBox: AfmPlotBox,
  calibrationStatus: AfmDigitizationDraft["calibration"]["status"],
): AfmDigitizationDraft {
  const numeric = numericAxes(axes);
  const physical = calibrationStatus !== "relative-pending" && numeric;
  const panelLabel = candidate.panel?.label ?? "figure";
  const automaticCalibration = candidate.axisCalibration ?? result.axisCalibration;
  return {
    schema: "ioniclink.afm-digitized-draft",
    schemaVersion: 5,
    id: `AFM-DRAFT-${safeStem(result.sourceName)}-${candidate.page ?? "image"}-${panelLabel}`,
    createdAt: new Date().toISOString(),
    reviewState: "pending-metadata-review",
    digitizationBasis: "Digitized from figure",
    calibration: {
      status: physical ? calibrationStatus : "relative-pending",
      axes: physical ? { ...numeric, xUnit: axes.xUnit.trim(), yUnit: axes.yUnit.trim() } : null,
      confidence: calibrationStatus === "physical-auto" ? automaticCalibration.confidence : undefined,
      method: calibrationStatus === "physical-auto" ? automaticCalibration.method : calibrationStatus === "physical-reviewed" ? "manual-exception-correction" : automaticCalibration.method,
      evidence: calibrationStatus === "physical-auto" ? automaticCalibration.evidence : undefined,
    },
    source: {
      file: result.sourceName,
      page: candidate.page,
      figure: {
        kind: candidate.sourceFigure.kind,
        width: candidate.sourceFigure.width,
        height: candidate.sourceFigure.height,
        renderScale: candidate.sourceFigure.renderScale,
        crop: candidate.sourceFigure.crop,
        imageDataUrl: candidate.imageDataUrl,
      },
      panel: candidate.panel,
    },
    curve: {
      label: label.trim() || result.sourceName,
      xUnit: physical ? axes.xUnit.trim() : "relative-x",
      yUnit: physical ? axes.yUnit.trim() : "relative-y",
      points,
      segmentStarts: candidate.analysis.segmentStarts,
    },
    recognition: { confidence: candidate.analysis.confidence, quality: candidate.analysis.quality, plotBox, automaticallyDetectedPlotBox: candidate.analysis.plotBox, warnings: candidate.analysis.warnings },
    experimentalMetadata: candidate.experimentalMetadata ?? result.experimentalMetadata,
  };
}

function downloadCsv(result: DigitizationResponse, candidate: DigitizationCandidate, label: string, axes: AxisForm, points: Array<[number, number]>, status: AfmDigitizationDraft["calibration"]["status"]) {
  const physical = status !== "relative-pending";
  const xUnit = physical ? axes.xUnit.trim() : "relative-x";
  const yUnit = physical ? axes.yUnit.trim() : "relative-y";
  const rows: Array<Array<string | number>> = [
    ["# IonicLink AFM digitization draft"], ["# review_status", "pending-metadata-review"], ["# digitization", "Digitized from figure"],
    ["# source_file", result.sourceName], ["# source_page", candidate.page ?? "image"], ["# recognition_confidence", candidate.analysis.confidence],
    ["# calibration_status", status],
    ...(candidate.panel ? [
      ["# source_panel", candidate.panel.label],
      ["# ionic_liquid_inferred", candidate.panel.conditions.ionicLiquid.value ?? ""],
      ["# substrate_inferred", candidate.panel.conditions.substrate.value ?? ""],
      ["# electrode_potential_inferred", candidate.panel.conditions.electrodePotential.value ?? "", candidate.panel.conditions.electrodePotential.unit ?? ""],
    ] : []),
    ["# curve_label", label], [], [`separation_${xUnit}`, `force_${yUnit}`], ...points,
  ];
  const csv = `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
  downloadBlob(new Blob([csv], { type: "text/csv;charset=utf-8" }), `${safeStem(label || result.sourceName)}.csv`);
}

async function downloadDigitizedPng(
  result: DigitizationResponse,
  candidate: DigitizationCandidate,
  label: string,
  axes: AxisForm,
  points: Array<[number, number]>,
  status: AfmDigitizationDraft["calibration"]["status"],
) {
  const canvas = document.createElement("canvas");
  canvas.width = 1800;
  canvas.height = 1160;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas export is unavailable in this browser.");
  const physical = status !== "relative-pending";
  const bounds = physical && numericAxes(axes) ? numericAxes(axes)! : { xMin: 0, xMax: 1, yMin: 0, yMax: 1 };
  const margin = { left: 180, right: 90, top: 180, bottom: 230 };
  const plotRight = canvas.width - margin.right;
  const plotBottom = canvas.height - margin.bottom;
  const plotWidth = plotRight - margin.left;
  const plotHeight = plotBottom - margin.top;
  const sx = (value: number) => margin.left + ((value - bounds.xMin) / (bounds.xMax - bounds.xMin)) * plotWidth;
  const sy = (value: number) => plotBottom - ((value - bounds.yMin) / (bounds.yMax - bounds.yMin)) * plotHeight;
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#0f172a";
  context.font = "700 34px system-ui, sans-serif";
  context.fillText(label.trim() || result.sourceName, margin.left, 72);
  context.fillStyle = "#64748b";
  context.font = "20px ui-monospace, monospace";
  context.fillText(`${candidate.pageLabel} · ${points.length} extracted points · ${status}`, margin.left, 112);
  context.fillStyle = "#f8fafc";
  context.fillRect(margin.left, margin.top, plotWidth, plotHeight);
  context.strokeStyle = "#dbe4ec";
  context.lineWidth = 2;
  context.strokeRect(margin.left, margin.top, plotWidth, plotHeight);
  context.font = "18px ui-monospace, monospace";
  context.textAlign = "center";
  context.textBaseline = "top";
  for (let index = 0; index <= 5; index += 1) {
    const fraction = index / 5;
    const x = margin.left + plotWidth * fraction;
    const y = plotBottom - plotHeight * fraction;
    context.strokeStyle = index === 0 ? "#64748b" : "#dbe4ec";
    context.lineWidth = index === 0 ? 2.5 : 1.5;
    context.beginPath(); context.moveTo(x, margin.top); context.lineTo(x, plotBottom); context.stroke();
    context.beginPath(); context.moveTo(margin.left, y); context.lineTo(plotRight, y); context.stroke();
    context.fillStyle = "#475569";
    context.fillText(formatPlotNumber(bounds.xMin + (bounds.xMax - bounds.xMin) * fraction), x, plotBottom + 18);
    context.textAlign = "right";
    context.textBaseline = "middle";
    context.fillText(formatPlotNumber(bounds.yMin + (bounds.yMax - bounds.yMin) * fraction), margin.left - 18, y);
    context.textAlign = "center";
    context.textBaseline = "top";
  }
  const plotted = points.map(([x, y]) => ({ x: sx(x), y: sy(y) }));
  const segments = splitDisplaySegments(plotted, plotWidth, plotHeight, candidate.analysis.segmentStarts);
  context.strokeStyle = candidate.analysis.traceColor?.hex ?? "#0f766e";
  context.lineWidth = 4;
  context.lineJoin = "round";
  context.lineCap = "round";
  for (const segment of segments) {
    context.beginPath();
    segment.forEach((point, index) => index ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y));
    context.stroke();
  }
  context.fillStyle = candidate.analysis.traceColor?.hex ?? "#0f766e";
  for (const point of plotted) {
    context.beginPath(); context.arc(point.x, point.y, 2.4, 0, Math.PI * 2); context.fill();
  }
  context.fillStyle = "#334155";
  context.font = "600 24px system-ui, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "alphabetic";
  context.fillText(physical ? `Separation (${axes.xUnit.trim()})` : "Relative horizontal position", (margin.left + plotRight) / 2, plotBottom + 100);
  context.save();
  context.translate(62, (margin.top + plotBottom) / 2);
  context.rotate(-Math.PI / 2);
  context.fillText(physical ? `Force (${axes.yUnit.trim()})` : "Relative vertical position", 0, 0);
  context.restore();
  context.textAlign = "left";
  context.fillStyle = physical ? "#0f766e" : "#b45309";
  context.font = "600 19px system-ui, sans-serif";
  context.fillText(physical ? "PHYSICAL AXES · AUTOMATIC PROVENANCE RETAINED" : "RELATIVE COORDINATES · NOT MODEL-READY", margin.left, canvas.height - 82);
  context.textAlign = "right";
  context.fillStyle = "#64748b";
  context.font = "17px ui-monospace, monospace";
  context.fillText("IonicLink AFM digitization", plotRight, canvas.height - 40);
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("PNG generation failed.")), "image/png", 1));
  downloadBlob(blob, `${safeStem(label || result.sourceName)}.png`);
}

function formatPlotNumber(value: number) {
  if (Math.abs(value) >= 1000 || (Math.abs(value) > 0 && Math.abs(value) < 0.001)) return value.toExponential(2);
  return Number(value.toPrecision(5)).toString();
}

function downloadJson(result: DigitizationResponse, candidate: DigitizationCandidate, label: string, axes: AxisForm, points: Array<[number, number]>, plotBox: AfmPlotBox, status: AfmDigitizationDraft["calibration"]["status"]) {
  const json = JSON.stringify(buildDraft(result, candidate, label, axes, points, plotBox, status), null, 2);
  downloadBlob(new Blob([json], { type: "application/json;charset=utf-8" }), `${safeStem(label || result.sourceName)}.json`);
}

function csvCell(value: string | number) {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function safeStem(value: string) {
  return `ioniclink-afm-${value}`.normalize("NFKD").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 110) || "ioniclink-afm-curve";
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = filename; document.body.appendChild(anchor); anchor.click(); anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function remapDetectedPoints(analysis: AfmDigitizationAnalysis, reviewedBox: AfmPlotBox): AfmNormalizedPoint[] {
  const automatic = analysis.plotBox;
  const width = Math.max(1, reviewedBox.right - reviewedBox.left);
  const height = Math.max(1, reviewedBox.bottom - reviewedBox.top);
  return analysis.normalizedPoints
    .map((point) => ({
      rawX: automatic.left + point.x * (automatic.right - automatic.left),
      rawY: automatic.bottom - point.y * (automatic.bottom - automatic.top),
    }))
    .filter((point) => point.rawX >= reviewedBox.left && point.rawX <= reviewedBox.right && point.rawY >= reviewedBox.top && point.rawY <= reviewedBox.bottom)
    .map((point) => ({
      x: Math.max(0, Math.min(1, (point.rawX - reviewedBox.left) / width)),
      y: Math.max(0, Math.min(1, 1 - (point.rawY - reviewedBox.top) / height)),
    }));
}
