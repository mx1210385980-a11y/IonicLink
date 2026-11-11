import { AfmCurveExplorer } from "@/components/afm/AfmCurveExplorer";
import { AfmDigitizationWorkspace } from "@/components/afm/AfmDigitizationWorkspace";
import { AfmPresentationBriefing } from "@/components/afm/AfmPresentationBriefing";
import { AFM_CURVE_DATASET } from "@/lib/afm/afmCurves";
import benchmark from "@/data/conductivity/electrochem-extractor-benchmark.json";
import { WorkspacePageFrame } from "@/components/WorkspacePageFrame";
import { SCHOOL_PAGE_TITLE } from "@/components/workspaceStyles";

export const dynamic = "force-static";

export default function AfmWorkspacePage() {
  return (
    <WorkspacePageFrame variant="school" aria-label="AFM workspace">
    <div className="space-y-6">
      <header className="max-w-4xl">
        <p className="label-eyebrow text-brand-700">AFM · interfacial structure workspace</p>
        <h1 className={`mt-2 ${SCHOOL_PAGE_TITLE}`}>AFM solvation-force curves</h1>
        <p className="mt-2 text-sm leading-6 text-ink-700">
          Curate AFM solvation-force curves together with ionic identity, interface conditions, acquisition metadata,
          solvation-layer structure, capacitance and electric-field linkage. AFM is an independent workspace while
          retaining explicit links to relevant electrochemical evidence.
        </p>
      </header>
      <AfmPresentationBriefing dataset={AFM_CURVE_DATASET} benchmark={benchmark.summary} />
      <AfmDigitizationWorkspace />
      <AfmCurveExplorer dataset={AFM_CURVE_DATASET} />
    </div>
    </WorkspacePageFrame>
  );
}
