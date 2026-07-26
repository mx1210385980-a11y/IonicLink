"use client";

import { useCallback, useDeferredValue, useMemo, useRef, useState } from "react";
import type { WffDatasetData, WffEvaluationData, WffPaperMetricBlock, WffPaperReport } from "@/lib/predict/wffEvaluation.server";
import {
  buildWffEvaluationFromRows,
  wffPointsToCsv,
  type WffDatasetId,
  type WffEvaluationResult,
  type WffMetrics,
  type WffPoint,
  type WffStratifyMode,
} from "@/lib/predict/wffEvaluation";
import {
  DEFAULT_HYBRID_CONFIG,
  WFF_BASE_LEARNERS,
  WFF_BASE_LEARNER_LABELS,
  WFF_META_LABELS,
  WFF_META_MODELS,
  WFF_MODEL_LABELS,
  type WffBaseLearner,
  type WffHybridConfig,
  type WffMetaModel,
  type WffModelType,
} from "@/lib/predict/wffModel";

const MODEL_OPTIONS: WffModelType[] = ["gradient_boosting", "random_forest", "blend", "gated_hybrid", "snapshot"];

// Chart marks carry inline colors (not Tailwind classes) so the SVG is fully
// self-described and rasterizes correctly on PNG export. Palette mirrors the
// plan's mock and the studio's honesty contract: teal = measured, violet =
// predicted/estimate.
const CHART = {
  train: "#2563eb", // blue — training
  test: "#d97706", // orange — testing
  measured: "#0f8f84", // teal — measured / experimental
  predicted: "#6d28d9", // violet — predicted
  invalid: "#b42318", // red — physically invalid
  ref: "#94a3b8", // gray — Y = X reference
  axis: "#94a3b8",
  panel: "#f8fafc",
  mono: "ui-monospace, SFMono-Regular, Menlo, monospace",
};

const STRATIFY_OPTIONS: { value: WffStratifyMode; label: string; title: string }[] = [
  { value: "joint", label: "Joint", title: "Stratify by cation × COF bin (the plan's joint label)" },
  { value: "friction", label: "COF bin", title: "Stratify by COF bin only" },
  { value: "cation", label: "Cation", title: "Stratify by cation only" },
];

function fmt(v: number | null | undefined, digits = 3) {
  return v == null || !Number.isFinite(v) ? "—" : v.toFixed(digits);
}

function project(v: number, lo: number, hi: number, size: number, invert = false) {
  const t = (v - lo) / (hi - lo || 1);
  const px = 34 + t * (size - 54);
  return +(invert ? size - px : px).toFixed(2);
}

async function downloadSvgPng(svg: SVGSVGElement, filename: string) {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  const vb = svg.viewBox.baseVal;
  const w = vb && vb.width ? vb.width : svg.clientWidth || 320;
  const h = vb && vb.height ? vb.height : svg.clientHeight || 250;
  clone.setAttribute("width", String(w));
  clone.setAttribute("height", String(h));
  const xml = new XMLSerializer().serializeToString(clone);
  const img = new Image();
  img.onload = () => {
    const scale = 2;
    const canvas = document.createElement("canvas");
    canvas.width = w * scale;
    canvas.height = h * scale;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    }, "image/png");
  };
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`;
}

function useSvgPng(filename: string) {
  const ref = useRef<SVGSVGElement | null>(null);
  const onExport = useCallback(() => {
    if (ref.current) void downloadSvgPng(ref.current, filename);
  }, [filename]);
  return { ref, onExport };
}

function MetricCard({ label, metrics, tone }: { label: string; metrics: WffMetrics; tone: string }) {
  return (
    <div className="rounded-[8px] border border-ink-200 bg-white px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-eyebrow text-ink-600">
          <span className="h-2 w-2 rounded-full" style={{ background: tone }} aria-hidden="true" />
          {label}
        </span>
        <span className="font-mono text-[11px] font-semibold text-ink-500">n={metrics.n}</span>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        <span className="text-ink-500">R²</span>
        <span className="text-right font-mono font-semibold text-ink-900">{fmt(metrics.r2)}</span>
        <span className="text-ink-500">MAE(M1)</span>
        <span className="text-right font-mono font-semibold text-brand-700">{fmt(metrics.mae)}</span>
        <span className="text-ink-500">RMSE</span>
        <span className="text-right font-mono font-semibold text-violet-700">{fmt(metrics.rmse)}</span>
        <span className="text-ink-500">MSE</span>
        <span className="text-right font-mono font-semibold text-ink-900">{fmt(metrics.mse, 4)}</span>
      </div>
      {metrics.r2Note && <p className="mt-1.5 text-[10px] leading-snug text-ink-500">{metrics.r2Note}</p>}
    </div>
  );
}

function ChartButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-[6px] border border-ink-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-ink-600 transition hover:border-brand-200 hover:text-brand-700"
    >
      {children}
    </button>
  );
}

/** Chart 1 — Training & Testing measured-vs-predicted scatter with per-set fit lines + Y = X. */
function ScatterChart({ result }: { result: WffEvaluationResult }) {
  const { ref, onExport } = useSvgPng(`ioniclink-${result.datasetId}-train-test-scatter.png`);
  const S = 250;
  const { xMin, xMax, yMin, yMax } = result.chartBounds;
  const X = (v: number) => project(v, xMin, xMax, S);
  const Y = (v: number) => project(v, yMin, yMax, S, true);
  const points = [...result.splits.train.points, ...result.splits.test.points];
  const trainLine = result.fitLines.train;
  const testLine = result.fitLines.test;

  const fit = (l: NonNullable<WffEvaluationResult["fitLines"]["train"]>, color: string) => (
    <line x1={X(l.x1)} y1={Y(l.y1)} x2={X(l.x2)} y2={Y(l.y2)} stroke={color} strokeWidth={1.7} />
  );

  return (
    <figure className="rounded-[8px] border border-ink-200 bg-white p-3">
      <figcaption className="mb-2 flex items-center justify-between gap-2">
        <span className="text-sm font-semibold text-ink-900">Training &amp; Testing Performance</span>
        <ChartButton onClick={onExport}>PNG</ChartButton>
      </figcaption>
      <svg ref={ref} viewBox={`0 0 ${S} ${S}`} className="w-full" role="img" aria-label="Training and testing measured versus predicted COF">
        <rect x="0" y="0" width={S} height={S} rx="10" fill={CHART.panel} />
        <line x1={X(xMin)} y1={Y(xMin)} x2={X(xMax)} y2={Y(xMax)} stroke={CHART.ref} strokeWidth={1} strokeDasharray="4 4" />
        <text x={S - 42} y={Y(xMax) + 12} fill={CHART.axis} fontFamily={CHART.mono} fontSize={8}>
          Y = X
        </text>
        {trainLine ? fit(trainLine, CHART.train) : null}
        {testLine ? fit(testLine, CHART.test) : null}
        {points.map((p) => {
          const color = p.physicallyInvalidPrediction ? CHART.invalid : p.split === "train" ? CHART.train : CHART.test;
          return <circle key={`${p.split}-${p.id}`} cx={X(p.measured)} cy={Y(p.predicted)} r="3" fill={color} fillOpacity={0.8} />;
        })}
        <text x={S / 2} y={S - 7} textAnchor="middle" fill={CHART.axis} fontFamily={CHART.mono} fontSize={8}>
          measured COF
        </text>
        <text x="10" y={S / 2} textAnchor="middle" transform={`rotate(-90 10 ${S / 2})`} fill={CHART.axis} fontFamily={CHART.mono} fontSize={8}>
          predicted COF
        </text>
      </svg>
      <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-ink-600">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full" style={{ background: CHART.train }} /> Training + fit
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full" style={{ background: CHART.test }} /> Testing + fit
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full" style={{ background: CHART.ref }} /> Y = X reference
        </span>
      </div>
    </figure>
  );
}

/** Chart 2 — point-wise external validation: experimental vs predicted COF, sample by sample. */
function PointWiseChart({ result }: { result: WffEvaluationResult }) {
  const { ref, onExport } = useSvgPng(`ioniclink-${result.datasetId}-external-pointwise.png`);
  const split = result.splits.externalLiterature;
  const pts = split.points;
  const W = 320;
  const H = 220;

  if (!pts.length) {
    return (
      <figure className="flex flex-col rounded-[8px] border border-ink-200 bg-white p-3">
        <figcaption className="mb-2 text-sm font-semibold text-ink-900">
          Held-out literature <span className="font-normal text-ink-400">({result.settings.trained ? "out-of-sample" : "snapshot re-scored"})</span>
        </figcaption>
        <div className="flex flex-1 items-center justify-center rounded-[8px] bg-ink-50 px-4 py-8 text-center text-xs leading-5 text-ink-500">
          {split.note}
        </div>
      </figure>
    );
  }

  const vals = pts.flatMap((p) => [p.measured, p.predicted]);
  const rawLo = Math.min(...vals);
  let hi = Math.max(...vals);
  const pad = (hi - rawLo) * 0.1 || 0.05;
  // Keep negative (physically invalid) predictions visible at their true value.
  const lo = rawLo < 0 ? rawLo - pad : Math.max(0, rawLo - pad);
  hi = hi + pad;
  const X = (i: number) => +(40 + ((i - 1) / Math.max(1, pts.length - 1)) * (W - 56)).toFixed(2);
  const Y = (v: number) => +(H - 28 - ((v - lo) / (hi - lo || 1)) * (H - 48)).toFixed(2);
  const path = (key: "measured" | "predicted") =>
    pts.map((p, i) => `${i ? "L" : "M"}${X(p.sampleIndex)},${Y(p[key])}`).join(" ");

  return (
    <figure className="rounded-[8px] border border-ink-200 bg-white p-3">
      <figcaption className="mb-2 flex items-center justify-between gap-2">
        <span className="text-sm font-semibold text-ink-900">
          Held-out literature{" "}
          <span className="font-normal text-ink-400">({result.settings.trained ? "out-of-sample" : "snapshot re-scored"} · point-wise)</span>
        </span>
        <ChartButton onClick={onExport}>PNG</ChartButton>
      </figcaption>
      <svg ref={ref} viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Point-wise external literature measured versus predicted COF">
        <rect x="0" y="0" width={W} height={H} rx="10" fill={CHART.panel} />
        <path d={path("measured")} fill="none" stroke={CHART.measured} strokeWidth={1.7} />
        <path d={path("predicted")} fill="none" stroke={CHART.predicted} strokeWidth={1.7} strokeDasharray="5 3" />
        {pts.map((p) => (
          <circle key={`m-${p.id}`} cx={X(p.sampleIndex)} cy={Y(p.measured)} r="2.6" fill={CHART.measured} />
        ))}
        {pts.map((p) => (
          <circle
            key={`p-${p.id}`}
            cx={X(p.sampleIndex)}
            cy={Y(p.predicted)}
            r="2.6"
            fill={p.physicallyInvalidPrediction ? CHART.invalid : CHART.predicted}
          />
        ))}
        <text x={W / 2} y={H - 6} textAnchor="middle" fill={CHART.axis} fontFamily={CHART.mono} fontSize={8}>
          validation sample index
        </text>
        <text x="10" y={H / 2} textAnchor="middle" transform={`rotate(-90 10 ${H / 2})`} fill={CHART.axis} fontFamily={CHART.mono} fontSize={8}>
          COF
        </text>
      </svg>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-ink-600">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full" style={{ background: CHART.measured }} /> Experimental COF
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full" style={{ background: CHART.predicted }} /> Predicted COF
        </span>
        <span className="ml-auto font-mono text-[10px] text-ink-500">
          n={split.metrics.n} · MAE(M1) {fmt(split.metrics.mae)} · RMSE {fmt(split.metrics.rmse)}
        </span>
      </div>
      {split.note && <p className="mt-1.5 text-[11px] leading-4 text-ink-500">{split.note}</p>}
    </figure>
  );
}

function exportCsv(result: WffEvaluationResult) {
  const points = [
    ...result.splits.train.points,
    ...result.splits.test.points,
    ...result.splits.externalLiterature.points,
    ...result.splits.externalExperiment.points,
  ];
  const blob = new Blob([wffPointsToCsv(points)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `ioniclink-${result.datasetId}-${result.settings.modelType}-evaluation.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

const SPLIT_BADGE: Record<WffPoint["split"], string> = {
  train: "train",
  test: "test",
  externalLiterature: "ext-lit",
  externalExperiment: "ext-exp",
};

function DetailTable({ result }: { result: WffEvaluationResult }) {
  const rows = [
    ...result.splits.train.points,
    ...result.splits.test.points,
    ...result.splits.externalLiterature.points,
  ].sort((a, b) => b.absoluteError - a.absoluteError);

  return (
    <details className="rounded-[8px] border border-ink-200 bg-white p-3">
      <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-semibold text-ink-900">Prediction Detail Table</span>
        <span className="text-[11px] text-ink-500">
          {rows.length} rows ·{" "}
          {result.invalidCount
            ? `${result.invalidCount} physically invalid prediction${result.invalidCount === 1 ? "" : "s"}`
            : "no physically invalid prediction"}
        </span>
      </summary>
      <div className="mt-3 max-h-96 overflow-auto rounded-[7px] border border-ink-100">
        <table className="min-w-full text-left text-xs">
          <thead className="sticky top-0 bg-ink-50 text-[10px] uppercase tracking-eyebrow text-ink-500">
            <tr>
              <th className="px-2 py-1.5">Ion pair</th>
              <th className="px-2 py-1.5">Surface</th>
              <th className="px-2 py-1.5 text-right">T (K)</th>
              <th className="px-2 py-1.5 text-right">Measured</th>
              <th className="px-2 py-1.5 text-right">Predicted</th>
              <th className="px-2 py-1.5 text-right">|error|</th>
              <th className="px-2 py-1.5">Split</th>
              <th className="px-2 py-1.5">Source</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={`${p.split}-${p.id}`} className="border-t border-ink-100 align-top">
                <td className="whitespace-nowrap px-2 py-1.5 font-mono text-ink-900">
                  {p.cation}
                  {p.anion}
                </td>
                <td className="px-2 py-1.5 text-ink-700">{p.surface}</td>
                <td className="px-2 py-1.5 text-right font-mono text-ink-700">{p.temperature ?? "—"}</td>
                <td className="px-2 py-1.5 text-right font-mono text-ink-900">{fmt(p.measured)}</td>
                <td className={`px-2 py-1.5 text-right font-mono ${p.physicallyInvalidPrediction ? "text-rose-600" : "text-ink-900"}`}>
                  {fmt(p.predicted)}
                  {p.physicallyInvalidPrediction && <span className="ml-1 text-[9px] font-semibold uppercase text-rose-600">invalid</span>}
                </td>
                <td className="px-2 py-1.5 text-right font-mono text-ink-700">{fmt(p.absoluteError)}</td>
                <td className="px-2 py-1.5">
                  <span className="rounded-full bg-ink-100 px-1.5 py-0.5 font-mono text-[10px] text-ink-700">{SPLIT_BADGE[p.split]}</span>
                </td>
                <td className="max-w-[16rem] truncate px-2 py-1.5 text-ink-600" title={p.sourceLiteratureTitle || p.sourceLiteratureKey}>
                  {p.sourceLiteratureTitle || p.sourceLiteratureKey || "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[11px] leading-5 text-ink-500">
        Metrics use raw predictions — negative (physically invalid) COF values are flagged, never clipped. {result.splits.externalExperiment.note}
      </p>
    </details>
  );
}

function DatasetPanel({ result }: { result: WffEvaluationResult }) {
  return (
    <section className="rounded-[8px] border border-ink-200 bg-ink-50/35 p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-ink-950">
            {result.label} <span className="font-normal text-ink-400">· {result.settings.modelLabel}</span>
          </h3>
          <p className="mt-1 text-xs leading-5 text-ink-700">
            {result.evaluatedRowCount} predicted rows · {result.singletonStrataCount} singleton strata → external literature · seed{" "}
            {result.settings.randomSeed} · internal test {Math.round(result.settings.testSize * 100)}%
            {result.droppedFlaggedCount ? ` · ${result.droppedFlaggedCount} flagged dropped` : ""}
          </p>
        </div>
        <button
          type="button"
          onClick={() => exportCsv(result)}
          className="rounded-[7px] border border-ink-200 bg-white px-3 py-1.5 text-xs font-semibold text-ink-700 transition hover:border-brand-200 hover:text-brand-700"
        >
          Export CSV
        </button>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Training" metrics={result.splits.train.metrics} tone={CHART.train} />
        <MetricCard label="Internal testing" metrics={result.splits.test.metrics} tone={CHART.test} />
        <MetricCard label="Held-out literature" metrics={result.splits.externalLiterature.metrics} tone={CHART.measured} />
        <MetricCard label="External experiment" metrics={result.splits.externalExperiment.metrics} tone={CHART.predicted} />
      </div>

      <div className="mt-3 grid gap-3 xl:grid-cols-2">
        <ScatterChart result={result} />
        <PointWiseChart result={result} />
      </div>

      <div className="mt-3">
        <DetailTable result={result} />
      </div>
    </section>
  );
}

function DatasetViewSwitch({
  activeDatasetId,
  datasets,
  onChange,
}: {
  activeDatasetId: WffDatasetId;
  datasets: WffEvaluationResult[];
  onChange: (datasetId: WffDatasetId) => void;
}) {
  return (
    <section className="rounded-[8px] border border-ink-200 bg-white p-2 shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="label-eyebrow px-1 text-ink-500">Dataset view</p>
        <div role="tablist" aria-label="Dataset view" className="grid w-full gap-1 rounded-[8px] bg-ink-50 p-1 sm:w-auto sm:grid-cols-2">
          {datasets.map((result) => {
            const selected = result.datasetId === activeDatasetId;
            return (
              <button
                key={result.datasetId}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => onChange(result.datasetId)}
                className={`min-w-0 rounded-[7px] border px-3 py-2 text-left transition ${
                  selected ? "border-brand-200 bg-white text-ink-950 shadow-sm" : "border-transparent text-ink-600 hover:bg-white/75 hover:text-ink-900"
                }`}
              >
                <span className="block truncate text-xs font-semibold">{result.label}</span>
                <span className="mt-1 grid grid-cols-3 gap-2 font-mono text-[10px] leading-4">
                  <span className={selected ? "text-ink-700" : "text-ink-500"}>n={result.evaluatedRowCount}</span>
                  <span className={selected ? "text-brand-700" : "text-ink-500"}>test {fmt(result.splits.test.metrics.r2)}</span>
                  <span className={selected ? "text-violet-700" : "text-ink-500"}>ext {fmt(result.splits.externalLiterature.metrics.r2)}</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}

type PaperMetricTarget = Omit<WffPaperMetricBlock, "n">;

function PaperMetricRow({ label, target, actual }: { label: string; target: PaperMetricTarget; actual: WffPaperMetricBlock }) {
  return (
    <tr className="border-t border-ink-100 align-top">
      <th scope="row" className="px-2 py-2 text-left text-xs font-semibold text-ink-900">
        <span>{label}</span>
        <span className="ml-1 font-mono text-[10px] font-medium text-ink-400">n={actual.n}</span>
      </th>
      <td className="px-2 py-2">
        <div className="grid grid-cols-3 gap-2 font-mono text-xs font-semibold text-ink-700">
          <span>R² {fmt(target.r2)}</span>
          <span>MAE {fmt(target.mae)}</span>
          <span>RMSE {fmt(target.rmse)}</span>
        </div>
      </td>
      <td className="px-2 py-2">
        <div className="grid grid-cols-3 gap-2 font-mono text-xs font-semibold text-ink-950">
          <span>R² {fmt(actual.r2)}</span>
          <span>MAE {fmt(actual.mae)}</span>
          <span>RMSE {fmt(actual.rmse)}</span>
        </div>
      </td>
    </tr>
  );
}

function PaperReproductionPanel({ report }: { report: WffPaperReport | null }) {
  const badgeClass = report?.within_tolerance ? "bg-brand-50 text-brand-700" : "bg-amber-50 text-amber-800";
  const isBestCurrent = report?.config?.model === "best_current_ensemble";
  const title = isBestCurrent ? "Best Current Model" : "Paper Reproduction";
  const description = isBestCurrent
    ? "Dataset B strongest current-data profile found so far, compared against the thesis target metrics."
    : "Dataset B gated hybrid benchmark against the published target metrics.";
  const valueLabel = isBestCurrent ? "Current" : "Reproduced";

  return (
    <section className="rounded-[8px] border border-ink-200 bg-white p-3 shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-ink-950">{title}</h3>
          <p className="mt-1 text-xs leading-5 text-ink-600">{description}</p>
        </div>
        <span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${badgeClass}`}>
          {report ? (report.within_tolerance ? "within tolerance" : "outside tolerance") : "report missing"}
        </span>
      </div>

      {report ? (
        <div className="mt-3 overflow-x-auto rounded-[7px] border border-ink-100">
          <table className="min-w-full text-left">
            <thead className="bg-ink-50 text-[10px] font-semibold uppercase tracking-eyebrow text-ink-500">
              <tr>
                <th className="px-2 py-1.5">Split</th>
                <th className="px-2 py-1.5">Target</th>
                <th className="px-2 py-1.5">{valueLabel}</th>
              </tr>
            </thead>
            <tbody>
              <PaperMetricRow label="Test" target={report.target_metrics.test} actual={report.metrics.test} />
              <PaperMetricRow
                label="External literature"
                target={report.target_metrics.external_literature}
                actual={report.metrics.external_literature}
              />
            </tbody>
          </table>
        </div>
      ) : (
        <div className="mt-3 rounded-[7px] border border-dashed border-amber-200 bg-amber-50/45 px-3 py-2 text-xs leading-5 text-amber-900">
          Paper reproduction report is missing. Run <code className="font-mono font-semibold">npm run wff:reproduce</code> to generate it.
        </div>
      )}
    </section>
  );
}

function SettingField({ label, value, children }: { label: string; value?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="flex items-baseline justify-between gap-2 text-[10px] font-semibold uppercase tracking-eyebrow text-ink-500">
        <span>{label}</span>
        {value != null && <span className="font-mono text-[12px] font-semibold normal-case tracking-normal text-ink-900 tnum">{value}</span>}
      </span>
      {children}
    </div>
  );
}

const RANGE_CLASS = "h-1.5 w-full cursor-pointer appearance-none rounded-full bg-ink-200 accent-brand-600";
const SELECT_CLASS =
  "min-h-[34px] w-full rounded-[7px] border border-ink-200 bg-white px-2 text-xs font-semibold text-ink-800 outline-none transition focus:border-brand-300";

function HybridConfigPanel({ hybrid, onHybrid }: { hybrid: WffHybridConfig; onHybrid: (patch: Partial<WffHybridConfig>) => void }) {
  const toggleBase = (b: WffBaseLearner) => {
    const has = hybrid.baseLearners.includes(b);
    const next = has ? hybrid.baseLearners.filter((x) => x !== b) : [...hybrid.baseLearners, b];
    if (next.length === 0) return; // always keep at least one base learner
    onHybrid({ baseLearners: next });
  };
  const q1 = Math.round(hybrid.q1 * 100);
  const q2 = Math.round(hybrid.q2 * 100);
  return (
    <div className="mt-3 rounded-[7px] border border-brand-100 bg-brand-50/40 p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-eyebrow text-brand-700">Hybrid configuration</span>
        <span className="font-mono text-[10px] text-ink-400">gate → low / mid / high · per-region stacking</span>
      </div>
      <div className="mt-2.5 grid items-start gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
        <SettingField label={`Base learners · ${hybrid.baseLearners.length}`}>
          <div className="flex flex-col gap-1.5">
            {WFF_BASE_LEARNERS.map((b) => {
              const checked = hybrid.baseLearners.includes(b);
              const lockedLast = checked && hybrid.baseLearners.length === 1;
              return (
                <label key={b} className={`flex items-center gap-1.5 text-xs font-medium text-ink-700 ${lockedLast ? "opacity-60" : "cursor-pointer"}`}>
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={lockedLast}
                    onChange={() => toggleBase(b)}
                    className="h-3.5 w-3.5 accent-brand-600"
                  />
                  {WFF_BASE_LEARNER_LABELS[b]}
                </label>
              );
            })}
          </div>
        </SettingField>
        <SettingField label="Gate model">
          <select className={SELECT_CLASS} value={hybrid.gate} onChange={(e) => onHybrid({ gate: e.target.value as WffBaseLearner })}>
            {WFF_BASE_LEARNERS.map((b) => (
              <option key={b} value={b}>
                {WFF_BASE_LEARNER_LABELS[b]}
              </option>
            ))}
          </select>
        </SettingField>
        <SettingField label="Meta-model">
          <select className={SELECT_CLASS} value={hybrid.metaModel} onChange={(e) => onHybrid({ metaModel: e.target.value as WffMetaModel })}>
            {WFF_META_MODELS.map((m) => (
              <option key={m} value={m}>
                {WFF_META_LABELS[m]}
              </option>
            ))}
          </select>
        </SettingField>
        <div className="flex flex-col gap-3">
          <SettingField label="Gate q₁" value={`${q1}%`}>
            <input
              type="range"
              min={5}
              max={90}
              step={5}
              value={q1}
              aria-label="Lower gating quantile q1"
              onChange={(e) => onHybrid({ q1: Math.min(Number(e.target.value) / 100, hybrid.q2 - 0.05) })}
              className={RANGE_CLASS}
            />
          </SettingField>
          <SettingField label="Gate q₂" value={`${q2}%`}>
            <input
              type="range"
              min={10}
              max={95}
              step={5}
              value={q2}
              aria-label="Upper gating quantile q2"
              onChange={(e) => onHybrid({ q2: Math.max(Number(e.target.value) / 100, hybrid.q1 + 0.05) })}
              className={RANGE_CLASS}
            />
          </SettingField>
        </div>
      </div>
    </div>
  );
}

function EvaluationSettings({
  modelType,
  stratifyMode,
  testSize,
  randomSeed,
  excludeFlagged,
  hybrid,
  pending,
  onChange,
  onHybrid,
  onReset,
}: {
  modelType: WffModelType;
  stratifyMode: WffStratifyMode;
  testSize: number;
  randomSeed: number;
  excludeFlagged: boolean;
  hybrid: WffHybridConfig;
  pending: boolean;
  onChange: (
    patch: Partial<{ modelType: WffModelType; stratifyMode: WffStratifyMode; testSize: number; randomSeed: number; excludeFlagged: boolean }>
  ) => void;
  onHybrid: (patch: Partial<WffHybridConfig>) => void;
  onReset: () => void;
}) {
  const trained = modelType !== "snapshot";
  return (
    <section className="rounded-[8px] border border-ink-200 bg-white p-3 shadow-card">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-ink-950">Evaluation Settings</h3>
        <span className="font-mono text-[10px] text-ink-400">
          model: {WFF_MODEL_LABELS[modelType]} {trained ? "· trained on the training split" : "· re-scored snapshot"} ·{" "}
          {pending ? <span className="text-amber-600">updating…</span> : "live"}
        </span>
      </div>
      <div className="mt-3 grid items-start gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
        <SettingField label="Model">
          <select className={SELECT_CLASS} value={modelType} onChange={(e) => onChange({ modelType: e.target.value as WffModelType })}>
            {MODEL_OPTIONS.map((m) => (
              <option key={m} value={m}>
                {WFF_MODEL_LABELS[m]}
              </option>
            ))}
          </select>
        </SettingField>
        <SettingField label="Stratify by">
          <div role="group" aria-label="Stratify by" className="inline-flex rounded-[7px] border border-ink-200 bg-ink-50 p-0.5">
            {STRATIFY_OPTIONS.map((o) => {
              const active = stratifyMode === o.value;
              return (
                <button
                  key={o.value}
                  type="button"
                  title={o.title}
                  aria-pressed={active}
                  onClick={() => onChange({ stratifyMode: o.value })}
                  className={`flex-1 rounded-[5px] px-2.5 py-1.5 text-xs font-semibold transition ${
                    active ? "bg-white text-brand-700 shadow-sm" : "text-ink-500 hover:text-ink-700"
                  }`}
                >
                  {o.label}
                </button>
              );
            })}
          </div>
        </SettingField>
        <SettingField label="Test size" value={`${Math.round(testSize * 100)}%`}>
          <input
            type="range"
            min={10}
            max={40}
            step={5}
            value={Math.round(testSize * 100)}
            aria-label="Test size percent"
            onChange={(e) => onChange({ testSize: Number(e.target.value) / 100 })}
            className={RANGE_CLASS}
          />
        </SettingField>
        <SettingField label="Random seed" value={randomSeed}>
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={1}
              max={99}
              step={1}
              value={Math.min(99, Math.max(1, randomSeed))}
              aria-label="Random seed — drag to resample the split"
              onChange={(e) => onChange({ randomSeed: Number(e.target.value) })}
              className={RANGE_CLASS}
            />
            <button
              type="button"
              title="Resample with a new random seed"
              aria-label="Resample with a new random seed"
              onClick={() => onChange({ randomSeed: 1 + Math.floor(Math.random() * 99) })}
              className="shrink-0 rounded-[6px] border border-ink-200 bg-white px-2 py-1 text-[12px] font-semibold leading-none text-ink-600 transition hover:border-brand-200 hover:text-brand-700"
            >
              ↻
            </button>
          </div>
        </SettingField>
      </div>
      {modelType === "gated_hybrid" && <HybridConfigPanel hybrid={hybrid} onHybrid={onHybrid} />}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-ink-100 pt-3">
        <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-semibold text-ink-700">
          <input
            type="checkbox"
            checked={excludeFlagged}
            onChange={(e) => onChange({ excludeFlagged: e.target.checked })}
            className="h-3.5 w-3.5 accent-brand-600"
          />
          Drop flagged rows
        </label>
        <button
          type="button"
          onClick={onReset}
          className="rounded-[7px] border border-ink-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-ink-600 transition hover:border-brand-200 hover:text-brand-700"
        >
          Reset
        </button>
      </div>
      <p className="mt-2 text-[11px] leading-5 text-ink-500">
        Joint-label stratified split (§2.2.1): singleton strata are routed to external-literature validation; the rest are split{" "}
        {Math.round((1 - testSize) * 100)}/{Math.round(testSize * 100)} train/test.{" "}
        {trained ? (
          <>
            A {WFF_MODEL_LABELS[modelType].toLowerCase()} model is fit on the <strong>training split only</strong> (missing features imputed from
            train); test and external-literature rows are predicted out-of-sample, so those metrics show real generalization. Training metrics are
            in-sample.
            {modelType === "gated_hybrid" &&
              " The gate sorts samples into low / medium / high friction regions by its q₁/q₂ quantiles, then each region stacks the chosen base learners through the meta-model — configure the base-learner combination, gate, meta-model and quantiles below (the thesis's gated partitioned hybrid)."}
          </>
        ) : (
          <>No model is trained — the lab re-scores the precomputed snapshot column on each split, so the split only decides which rows each metric covers.</>
        )}
      </p>
    </section>
  );
}

const DEFAULTS = {
  modelType: "gradient_boosting" as WffModelType,
  stratifyMode: "joint" as WffStratifyMode,
  testSize: 0.2,
  randomSeed: 42,
  excludeFlagged: false,
};

export function WffEvaluationPanel({ data }: { data: WffEvaluationData }) {
  const [modelType, setModelType] = useState<WffModelType>(DEFAULTS.modelType);
  const [stratifyMode, setStratifyMode] = useState<WffStratifyMode>(DEFAULTS.stratifyMode);
  const [testSize, setTestSize] = useState(DEFAULTS.testSize);
  const [randomSeed, setRandomSeed] = useState(DEFAULTS.randomSeed);
  const [excludeFlagged, setExcludeFlagged] = useState(DEFAULTS.excludeFlagged);
  const [hybrid, setHybrid] = useState<WffHybridConfig>(DEFAULT_HYBRID_CONFIG);
  const [activeDatasetId, setActiveDatasetId] = useState<WffDatasetId>("dataset-b");

  // Training the ensembles is the heavy step; defer the inputs so slider drags
  // and selects stay responsive while the metrics/charts catch up.
  const dModel = useDeferredValue(modelType);
  const dStratify = useDeferredValue(stratifyMode);
  const dTestSize = useDeferredValue(testSize);
  const dSeed = useDeferredValue(randomSeed);
  const dExclude = useDeferredValue(excludeFlagged);
  const dHybrid = useDeferredValue(hybrid);
  const pending =
    dModel !== modelType ||
    dStratify !== stratifyMode ||
    dTestSize !== testSize ||
    dSeed !== randomSeed ||
    dExclude !== excludeFlagged ||
    dHybrid !== hybrid;

  const build = useCallback(
    (ds: WffDatasetData) =>
      buildWffEvaluationFromRows(ds.rows, {
        datasetId: ds.datasetId,
        label: ds.label,
        sourceRowCount: ds.sourceRowCount,
        modelType: dModel,
        stratifyMode: dStratify,
        testSize: dTestSize,
        randomSeed: dSeed,
        excludeFlagged: dExclude,
        hybridConfig: dHybrid,
      }),
    [dModel, dStratify, dTestSize, dSeed, dExclude, dHybrid]
  );

  const datasetA = useMemo(() => build(data.datasetA), [build, data.datasetA]);
  const datasetB = useMemo(() => build(data.datasetB), [build, data.datasetB]);
  const datasets = useMemo(() => [datasetA, datasetB], [datasetA, datasetB]);
  const activeDataset = activeDatasetId === "dataset-a" ? datasetA : datasetB;

  const onChange = (patch: Partial<typeof DEFAULTS>) => {
    if (patch.modelType !== undefined) setModelType(patch.modelType);
    if (patch.stratifyMode !== undefined) setStratifyMode(patch.stratifyMode);
    if (patch.testSize !== undefined) setTestSize(patch.testSize);
    if (patch.randomSeed !== undefined) setRandomSeed(patch.randomSeed);
    if (patch.excludeFlagged !== undefined) setExcludeFlagged(patch.excludeFlagged);
  };
  const onHybrid = (patch: Partial<WffHybridConfig>) => setHybrid((prev) => ({ ...prev, ...patch }));
  const onReset = () => {
    setModelType(DEFAULTS.modelType);
    setStratifyMode(DEFAULTS.stratifyMode);
    setTestSize(DEFAULTS.testSize);
    setRandomSeed(DEFAULTS.randomSeed);
    setExcludeFlagged(DEFAULTS.excludeFlagged);
    setHybrid(DEFAULT_HYBRID_CONFIG);
    setActiveDatasetId("dataset-b");
  };

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="label-eyebrow text-brand-700">Teaching dataset</p>
          <h2 className="mt-1 text-base font-semibold tracking-tight text-ink-950">Model Evaluation Lab</h2>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-ink-700">
            Train a tree-ensemble model on the training split and validate it out-of-sample on held-out test and literature rows. Tune the model and
            split live and watch the metrics, fit lines and point-wise comparison update.
          </p>
        </div>
        <div className="rounded-[7px] border border-brand-100 bg-brand-50 px-3 py-2 text-xs font-semibold text-brand-700">
          R² / MAE(M1) / RMSE / MSE
        </div>
      </div>

      <PaperReproductionPanel report={data.paperReport} />

      <EvaluationSettings
        modelType={modelType}
        stratifyMode={stratifyMode}
        testSize={testSize}
        randomSeed={randomSeed}
        excludeFlagged={excludeFlagged}
        hybrid={hybrid}
        pending={pending}
        onChange={onChange}
        onHybrid={onHybrid}
        onReset={onReset}
      />

      <DatasetViewSwitch activeDatasetId={activeDatasetId} datasets={datasets} onChange={setActiveDatasetId} />
      <DatasetPanel result={activeDataset} />
    </section>
  );
}
