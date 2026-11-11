import { liveDomainLabel, liveInstructions, type LiveDomain } from "@/lib/teaching/liveFields";
import { LIVE_EXAMPLE_BRIEFS } from "@/lib/teaching/liveExampleBriefs";

const LESSONS: Record<LiveDomain, string[]> = {
  tribology: ["Identify the ionic liquid and contact surface.", "Extract friction with load and temperature.", "Link each measurement to its source evidence."],
  conductivity: ["Read a conductivity table or supported CV / EIS landmark.", "Keep each value linked to its ionic liquid, electrode and conditions.", "Describe a supported dependence on temperature, scan rate or composition."],
  afm: ["Identify the ionic liquid, substrate, probe and force / separation axes.", "Read supported layer spacings or force landmarks; distinguish reported and digitized values.", "Compare conditions without inventing missing values or connecting disconnected force branches."],
};

export function LiveLessonGuide({ domain, instructor = false }: { domain: LiveDomain; instructor?: boolean }) {
  const example = instructor ? LIVE_EXAMPLE_BRIEFS[domain] : null;
  return <details className="rounded-xl border border-ink-200 bg-white px-4 py-3">
    <summary className="cursor-pointer text-sm font-medium text-ink-800">Lesson brief · {liveDomainLabel(domain)}</summary>
    <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-ink-600">{LESSONS[domain].map((text) => <li key={text}>{text}</li>)}</ol>
    <p className="mt-3 text-xs leading-5 text-ink-500">{liveInstructions(domain)} Use NR when unreported, not zero.</p>
    {instructor && <p className="mt-3 text-xs leading-5 text-ink-500">Use one focused paper with readable tables / axes. Define the target figure, panels and landmarks in the answer key&apos;s source field. Verify the key against the paper before class. Missing and extra records affect the score; classroom records never enter the research database automatically.</p>}
    {example && <div className="mt-4 rounded-lg border border-ink-200 p-3"><p className="text-sm font-medium">Worked lesson · {example.title}</p><p className="mt-2 text-xs leading-5 text-ink-600">{example.source}</p><p className="mt-2 text-xs leading-5 text-ink-600">{example.task}</p><a className="btn mt-3" href={`/api/teaching/live/table?domain=${domain}&example=${example.id}`}>Download instructor example key</a><p className="mt-2 text-xs text-ink-500">{example.observationCount} source-checked observations. Upload the matching PDF, adapt the task and review this key before teaching. No paper or grades are imported automatically.</p></div>}
  </details>;
}
