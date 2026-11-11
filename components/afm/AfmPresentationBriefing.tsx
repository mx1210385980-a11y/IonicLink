import type { AfmCurveDataset } from "@/lib/afm/afmCurves";
import { SCHOOL_PANEL } from "@/components/workspaceStyles";

interface ElectrochemBenchmarkSummary {
  auditedPapers: number;
  auditedAvailablePapers: number;
  unavailableAuditedPapers: number;
  textValuePapers: number;
  textValuePapersDetected: number;
  nonTextPapers: number;
  nonTextPapersCorrectlyEmpty: number;
  nonTextFalsePositive: number;
  figureOnlyPapers: number;
}

export function AfmPresentationBriefing({
  dataset,
  benchmark,
}: {
  dataset: AfmCurveDataset;
  benchmark: ElectrochemBenchmarkSummary;
}) {
  const featured = [
    { potential: "OCP", voltage: "≈ −0.2 V", layers: 5, note: "partial trace · audit only", tone: "amber" },
    { potential: "−1.0 V", voltage: "vs Pt", layers: 6, note: "model ready · EIS linked", tone: "brand" },
    { potential: "−2.0 V", voltage: "vs Pt", layers: 8, note: "model ready", tone: "cyan" },
  ] as const;

  return (
    <section className={`${SCHOOL_PANEL} overflow-hidden`}>
      <div className="grid lg:grid-cols-[1.12fr_0.88fr]">
        <div className="relative overflow-hidden border-b border-[#e3e6e9] bg-[#f8f9fa] p-5 text-[#242b33] sm:p-6 lg:border-b-0 lg:border-r">
          <div className="relative">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-md border border-[#dce0e4] bg-white px-2.5 py-1 text-xs font-medium text-ink-700">Presentation snapshot</span>
              <span className="rounded-md border border-[#dce0e4] bg-white px-2.5 py-1 text-xs font-medium text-ink-600">No MD in current scope</span>
            </div>
            <h2 className="mt-4 max-w-2xl text-xl font-semibold tracking-tight sm:text-2xl">From paper figures to a model-ready interfacial dataset</h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-ink-600">
              The current milestone connects digitized AFM solvation-force curves with ionic identity, interface conditions, applied potential, layer structure, source evidence, and related electrochemistry.
            </p>
            <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <BriefMetric label="Curves online" value={dataset.summary.totalCurves} detail={`${dataset.summary.qualifiedNewCurves} new`} />
              <BriefMetric label="Source verified" value={dataset.summary.sourceVerifiedCurves} detail="paper + figure" />
              <BriefMetric label="Model ready" value={dataset.summary.modelEligibleCurves} detail="quality gated" />
              <BriefMetric label="Paper QA set" value={benchmark.auditedPapers} detail={`${benchmark.auditedAvailablePapers} available · ${benchmark.unavailableAuditedPapers} missing`} />
            </div>
          </div>
        </div>

        <div className="p-5 sm:p-6">
          <p className="label-eyebrow text-brand-700">Representative scientific case</p>
          <h3 className="mt-2 text-lg font-semibold text-ink-950">[Py1,4][FAP] on Au(111)</h3>
          <p className="mt-1 text-xs leading-5 text-ink-600">Potential-dependent solvation layering with a separately measured EIS link at −1.0 V.</p>
          <div className="mt-4 grid gap-2 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
            {featured.map((item) => <PotentialCase key={item.potential} {...item} />)}
          </div>
          <div className="mt-4 rounded-lg border border-[#dce0e4] bg-[#f8fbfb] p-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs font-semibold text-ink-800">Related EIS capacitance at −1.0 V</span>
              <span className="text-base font-semibold text-[#00888a]">≈ 14.9 µF/cm²</span>
            </div>
            <p className="mt-1 text-xs leading-5 text-ink-600">Kept separate from direct AFM measurements; no electric field is inferred from voltage.</p>
          </div>
        </div>
      </div>

      <div className="grid border-t border-ink-200 lg:grid-cols-[0.9fr_1.1fr]">
        <div className="border-b border-ink-200 p-5 lg:border-b-0 lg:border-r sm:p-6">
          <p className="label-eyebrow text-ink-700">Electrochemical extraction QA</p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <QaMetric label="Text-value papers detected" value={`${benchmark.textValuePapersDetected}/${benchmark.textValuePapers}`} tone="brand" />
            <QaMetric label="Non-text papers kept empty" value={`${benchmark.nonTextPapersCorrectlyEmpty}/${benchmark.nonTextPapers}`} tone="brand" />
            <QaMetric label="False positives" value={String(benchmark.nonTextFalsePositive)} tone="brand" />
            <QaMetric label="Figure digitization queue" value={String(benchmark.figureOnlyPapers)} tone="amber" />
          </div>
          <p className="mt-3 text-[11px] leading-5 text-ink-600">This is the deterministic offline screening benchmark. Every candidate still enters human source review before becoming checked data.</p>
        </div>

        <div className="p-5 sm:p-6">
          <p className="label-eyebrow text-ink-600">Project path</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            <RoadmapStage number="01" label="Current" title="Data asset" body="Curves, metadata, potential, layering and electrochemical linkage." tone="brand" />
            <RoadmapStage number="02" label="Next" title="Feature dataset" body="Finish figure/table curation and chemically validate ion identities." tone="cyan" />
            <RoadmapStage number="03" label="Later" title="Prediction" body="Build uncertainty-aware models; add MD only after the data foundation is stable." tone="violet" />
          </div>
        </div>
      </div>
    </section>
  );
}

function BriefMetric({ label, value, detail }: { label: string; value: number; detail: string }) {
  return <div className="rounded-lg border border-[#dce0e4] bg-white p-3"><p className="text-xs font-medium text-ink-600">{label}</p><p className="mt-1 text-2xl font-semibold tabular-nums text-[#00888a]">{value}</p><p className="mt-1 text-xs text-ink-600">{detail}</p></div>;
}

function PotentialCase({ potential, voltage, layers, note, tone }: { potential: string; voltage: string; layers: number; note: string; tone: "brand" | "cyan" | "amber" }) {
  const colors = tone === "amber" ? "border-amber-200 bg-amber-50 text-amber-900" : "border-[#dce0e4] bg-[#f8fbfb] text-brand-900";
  return <div className={`rounded-lg border p-3 ${colors}`}><div className="flex items-start justify-between gap-2"><div><p className="font-mono text-sm font-semibold">{potential}</p><p className="text-[10px] opacity-70">{voltage}</p></div><span className="font-mono text-2xl font-semibold tnum">{layers}</span></div><p className="mt-2 text-[10px] font-medium">layers · {note}</p></div>;
}

function QaMetric({ label, value, tone }: { label: string; value: string; tone: "brand" | "amber" }) {
  return <div className={`rounded-lg border p-3 ${tone === "brand" ? "border-[#dce0e4] bg-white" : "border-amber-200 bg-amber-50/70"}`}><p className="text-xs text-ink-600">{label}</p><p className={`mt-1 text-xl font-semibold tabular-nums ${tone === "brand" ? "text-[#00888a]" : "text-amber-800"}`}>{value}</p></div>;
}

function RoadmapStage({ number, label, title, body, tone }: { number: string; label: string; title: string; body: string; tone: "brand" | "cyan" | "violet" }) {
  const colors = tone === "brand" ? "text-brand-700 bg-brand-50" : "text-ink-700 bg-ink-50";
  return <div className="rounded-lg border border-ink-200 bg-white p-3"><div className="flex items-center justify-between"><span className={`rounded-md px-2 py-1 font-mono text-[9px] font-semibold ${colors}`}>{number}</span><span className="font-mono text-[9px] font-semibold uppercase tracking-wide text-ink-400">{label}</span></div><h4 className="mt-3 text-sm font-semibold text-ink-950">{title}</h4><p className="mt-1 text-[11px] leading-4 text-ink-600">{body}</p></div>;
}
