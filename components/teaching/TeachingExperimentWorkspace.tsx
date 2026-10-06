import { ModelPreview } from "@/components/design/ModelPreview";
import { TeachingGateway } from "@/components/teaching/TeachingGateway";

export function TeachingExperimentWorkspace() {
  return (
    <section lang="en-US" aria-labelledby="ai-experiment-title" className="mx-auto w-full max-w-[1600px] px-4 pb-10 pt-6 sm:px-6 lg:px-8 lg:pt-9">
      <header className="mb-8 text-center">
        <h1 id="ai-experiment-title" className="text-3xl font-semibold tracking-tight text-ink-950 sm:text-[36px]">AI experiment</h1>
      </header>
      <div className="grid items-start gap-8 xl:grid-cols-[minmax(260px,0.34fr)_minmax(0,1fr)]">
        <section id="data-extraction" aria-labelledby="data-extraction-title" className="min-w-0 scroll-mt-32 border-t-4 border-brand-600 pt-4 lg:scroll-mt-6">
          <h2 id="data-extraction-title" className="text-xl font-semibold text-brand-900">Data extraction</h2>
          <TeachingGateway embedded />
        </section>
        <section id="prediction" aria-labelledby="prediction-title" className="min-w-0 scroll-mt-32 border-t-4 border-indigo-500 pt-4 lg:scroll-mt-6">
          <h2 id="prediction-title" className="mb-4 text-xl font-semibold text-indigo-900">Prediction of μ</h2>
          <ModelPreview embedded />
        </section>
      </div>
    </section>
  );
}
