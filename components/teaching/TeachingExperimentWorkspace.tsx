import { ModelPreview } from "@/components/design/ModelPreview";
import { LiveTeacher } from "@/components/teaching/LiveTeacher";
import { LiveStudent } from "@/components/teaching/LiveStudent";
import type { ReactNode } from "react";

function TeachingExperimentShell({ children }: { children: ReactNode }) {
  return (
    <section lang="en-US" aria-labelledby="ai-experiment-title" className="mx-auto w-full max-w-[1600px] px-4 pb-10 pt-6 sm:px-6 lg:px-8 lg:pt-9">
      <header className="mb-8 text-center">
        <h1 id="ai-experiment-title" className="text-3xl font-semibold tracking-tight text-ink-950 sm:text-[36px]">AI experiment</h1>
      </header>
      {children}
    </section>
  );
}

export function TeachingExtractionExperiment({ isAdmin = false }: { isAdmin?: boolean }) {
  return (
    <TeachingExperimentShell>
      <section id="data-extraction" aria-labelledby="data-extraction-title" className="border-t-4 border-brand-600 pt-4">
        <h2 id="data-extraction-title" className="mb-4 text-xl font-semibold text-brand-900">Experiment Ⅰ- Data Extraction</h2>
        {isAdmin ? <LiveTeacher /> : <LiveStudent />}
      </section>
    </TeachingExperimentShell>
  );
}

export function TeachingPredictionExperiment() {
  return (
    <TeachingExperimentShell>
      <section id="prediction" aria-labelledby="prediction-title" className="border-t-4 border-indigo-500 pt-4">
        <h2 id="prediction-title" className="mb-4 text-xl font-semibold text-indigo-900">Experiment Ⅱ- Prediction of μ</h2>
        <ModelPreview embedded />
      </section>
    </TeachingExperimentShell>
  );
}
