import { AfmCurveExplorer } from "@/components/afm/AfmCurveExplorer";
import { AfmPresentationBriefing } from "@/components/afm/AfmPresentationBriefing";
import { AFM_CURVE_DATASET } from "@/lib/afm/afmCurves";
import benchmark from "@/data/conductivity/electrochem-extractor-benchmark.json";

export const dynamic = "force-static";

export default function AfmWorkspacePage() {
  return (
    <div className="space-y-6 py-4">
      <header className="max-w-3xl">
        <p className="label-eyebrow text-brand-700">AFM · interfacial structure workspace</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-ink-950">AFM solvation-force curves</h1>
        <p className="mt-2 text-sm leading-6 text-ink-700">
          Curate AFM solvation-force curves together with ionic identity, interface conditions, acquisition metadata,
          solvation-layer structure, capacitance and electric-field linkage. AFM is an independent workspace while
          retaining explicit links to relevant electrochemical evidence.
        </p>
      </header>
      <AfmPresentationBriefing dataset={AFM_CURVE_DATASET} benchmark={benchmark.summary} />
      <AfmCurveExplorer dataset={AFM_CURVE_DATASET} />
    </div>
  );
}
