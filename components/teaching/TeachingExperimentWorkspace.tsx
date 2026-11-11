import { ModelPreview } from "@/components/design/ModelPreview";
import { LiveTeacher } from "@/components/teaching/LiveTeacher";
import { LiveStudent } from "@/components/teaching/LiveStudent";
import type { ReactNode } from "react";
import { WorkspacePageFrame } from "@/components/WorkspacePageFrame";
import { SCHOOL_PAGE_TITLE } from "@/components/workspaceStyles";

function TeachingExperimentShell({ children }: { children: ReactNode }) {
  return (
    <WorkspacePageFrame variant="school" lang="en-US" aria-labelledby="ai-experiment-title">
      <header className="mb-8">
        <h1 id="ai-experiment-title" className={SCHOOL_PAGE_TITLE}>AI experiment</h1>
      </header>
      {children}
    </WorkspacePageFrame>
  );
}

export function TeachingExtractionExperiment({ isAdmin = false }: { isAdmin?: boolean }) {
  return (
    <TeachingExperimentShell>
      <section id="data-extraction" aria-labelledby="data-extraction-title" className="border-t border-[#dce0e4] pt-5">
        <h2 id="data-extraction-title" className="mb-4 text-xl font-semibold text-brand-900">Experiment Ⅰ- Data Extraction</h2>
        <p className="mb-5 text-sm leading-6 text-ink-600">One classroom workflow for tribology, conductivity / electrochemistry and AFM. Prepare the source, extract observations and review the evidence. Classroom work stays separate from the research database.</p>
        {isAdmin ? <LiveTeacher /> : <LiveStudent />}
      </section>
    </TeachingExperimentShell>
  );
}

export function TeachingPredictionExperiment() {
  return (
    <TeachingExperimentShell>
      <section id="prediction" aria-labelledby="prediction-title" className="border-t border-[#dce0e4] pt-5">
        <h2 id="prediction-title" className="mb-4 text-xl font-semibold text-brand-900">Experiment Ⅱ- Prediction of μ</h2>
        <p role="note" className="mb-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">Classroom trend simulation only. This preview does not train a model on your uploaded records and is not a validated conductivity, AFM or MD predictor.</p>
        <ModelPreview embedded />
      </section>
    </TeachingExperimentShell>
  );
}
