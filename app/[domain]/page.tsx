import Link from "next/link";
import { notFound } from "next/navigation";
import { countByStatus, listJobs, listRecords, listSourceSummaries } from "@/lib/db";
import { isDomain } from "@/lib/domain";
import { getModule } from "@/lib/modules/registry.server";
import {
  chooseNextAction,
  deriveWorkspaceProgress,
  type NextAction,
  type WorkspaceProgress,
} from "@/lib/workspaceProgress";

export const dynamic = "force-dynamic";

function DomainHome({ params }: { params: { domain: string } }) {
  if (!isDomain(params.domain)) notFound();
  const domain = params.domain;
  const mod = getModule(domain);
  const records = listRecords(domain);
  const counts = countByStatus(domain);
  const progress = deriveWorkspaceProgress({
    domain,
    records,
    counts,
    jobs: listJobs(domain),
    sourceCount: listSourceSummaries(domain).length,
    coreCompleteness: mod.coreCompleteness,
  });
  const nextAction = chooseNextAction(progress);

  return (
    <div className="mx-auto flex min-h-[calc(100dvh-8.5rem)] max-w-6xl flex-col justify-center px-1 py-8 sm:py-10">
      <section className="animate-[home-rise_520ms_ease-out_both]">
        <div className="grid gap-4 lg:grid-cols-[1.08fr_0.92fr] lg:items-stretch">
          <div className="panel flex flex-col justify-between overflow-hidden p-6 sm:p-7">
            <div>
              <p className="label-eyebrow text-brand-700">{mod.label.toUpperCase()} WORKSPACE</p>
              <h1 className="mt-4 text-balance text-4xl font-semibold tracking-tight text-ink-950 sm:text-5xl">
                {mod.label} workbench
              </h1>
              <p className="mt-3 max-w-2xl text-base leading-7 text-ink-700 sm:text-lg">{mod.tagline}</p>
            </div>

            <NextActionCard action={nextAction} />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <ActionCard
              href={`/${domain}/extract`}
              eyebrow="Upload papers or data"
              title="Extract"
              body="Import datasets, add PDFs, and manage extraction jobs."
              tone="brand"
            />
            <ActionCard
              href={`/${domain}/database`}
              eyebrow="Curated store"
              title="Database"
              body="Browse records and export clean CSV data."
              tone="brand"
            />
            <ActionCard
              href={`/${domain}/database?status=review`}
              eyebrow="Human check"
              title="Review Queue"
              body="Approve complete candidates or repair missing fields."
              tone="amber"
            />
            <ActionCard
              href={`/${domain}/library`}
              eyebrow="Sources"
              title="Library"
              body="Inspect indexed papers and source coverage."
              tone="cyan"
            />
            <ActionCard
              href={`/${domain}/design`}
              eyebrow={`${progress.design.usable} / ${progress.design.gate} usable`}
              title="Design Studio"
              body={progress.design.ready ? "Explore the calibrated design space." : `${progress.design.gap} more usable points to the gate.`}
              tone="violet"
              wide
            />
          </div>
        </div>

        <WorkflowRail progress={progress} />
      </section>
    </div>
  );
}

export default DomainHome;

function NextActionCard({ action }: { action: NextAction }) {
  const toneClass = {
    brand: "border-brand-700 bg-brand-700 text-white shadow-[0_26px_62px_-42px_rgba(15,118,110,0.95)]",
    amber: "border-amber-300 bg-amber-50 text-ink-950 shadow-card",
    rose: "border-rose-500 bg-rose-600 text-white shadow-[0_26px_62px_-42px_rgba(225,29,72,0.8)]",
    violet: "border-violet-700 bg-violet-700 text-white shadow-[0_26px_62px_-42px_rgba(109,40,217,0.8)]",
  }[action.tone];
  const mutedClass = action.tone === "amber" ? "text-amber-900" : "text-white/80";
  const iconClass = action.tone === "amber" ? "border-amber-200 bg-white/70 text-amber-800" : "border-white/20 bg-white/10 text-white";

  return (
    <Link
      href={action.href}
      aria-label={`Next action: ${action.title}`}
      className={`group mt-6 flex items-end justify-between gap-5 rounded-[10px] border p-5 text-left transition duration-200 hover:-translate-y-0.5 focus:outline-none focus:ring-2 focus:ring-brand-200 ${toneClass}`}
    >
      <span>
        <span className={`font-mono text-[10px] font-semibold uppercase tracking-eyebrow ${mutedClass}`}>
          Next action · {action.eyebrow}
        </span>
        <span className="mt-2 block text-xl font-semibold tracking-tight sm:text-2xl">{action.title}</span>
        <span className={`mt-2 block max-w-xl text-sm leading-6 ${mutedClass}`}>{action.body}</span>
      </span>
      <span
        className={`grid h-9 w-9 shrink-0 place-items-center rounded-[8px] border transition group-hover:translate-x-0.5 ${iconClass}`}
        aria-hidden
      >
        →
      </span>
    </Link>
  );
}

function WorkflowRail({ progress }: { progress: WorkspaceProgress }) {
  const extractionDetail = `${progress.jobs.queued} queued · ${progress.jobs.extracting} extracting · ${progress.jobs.done} done · ${progress.jobs.error} error · ${progress.jobs.committed} committed`;
  const reviewDetail = `${progress.review.ready} ready · ${progress.review.incomplete} incomplete · ${progress.review.mockLocked} mock locked`;
  const designDetail = progress.design.ready ? "usable points · gate met" : `usable points · ${progress.design.gap} to gate`;

  return (
    <nav aria-label="Workspace workflow" className="panel mt-4 p-3 sm:p-4">
      <div className="mb-3 flex items-center justify-between gap-3 px-1">
        <p className="label-eyebrow text-ink-600">Workflow</p>
        <p className="text-xs text-ink-500">Live counts from the current workspace.</p>
      </div>
      <div className="grid gap-2 md:grid-cols-5">
        <WorkflowNode href={`/${progress.domain}/library`} label="Papers" value={progress.sourceCount} detail="indexed source documents" tone="cyan" />
        <WorkflowNode href={`/${progress.domain}/extract`} label="Extraction" value={progress.jobs.total} detail={extractionDetail} tone="brand" />
        <WorkflowNode
          href={`/${progress.domain}/database?status=review`}
          label="Review"
          value={progress.counts.review}
          detail={reviewDetail}
          tone="amber"
        />
        <WorkflowNode
          href={`/${progress.domain}/database?status=official`}
          label="Checked"
          value={progress.counts.official}
          detail="approved records"
          tone="brand"
        />
        <WorkflowNode
          href={`/${progress.domain}/design`}
          label="Design"
          value={`${progress.design.usable} / ${progress.design.gate}`}
          detail={designDetail}
          tone="violet"
        />
      </div>
    </nav>
  );
}

function WorkflowNode({
  href,
  label,
  value,
  detail,
  tone,
}: {
  href: string;
  label: string;
  value: number | string;
  detail: string;
  tone: "brand" | "amber" | "cyan" | "violet";
}) {
  const toneClass = {
    brand: "text-brand-700",
    amber: "text-amber-700",
    cyan: "text-cyan-700",
    violet: "text-violet-700",
  }[tone];

  return (
    <Link
      href={href}
      aria-label={`${label}: ${value}; ${detail}`}
      className="group relative rounded-[8px] border border-ink-200/80 bg-white/80 p-3 text-left transition hover:-translate-y-0.5 hover:border-brand-300 hover:bg-white focus:outline-none focus:ring-2 focus:ring-brand-200"
    >
      <span className="flex items-start justify-between gap-2">
        <span className={`font-mono text-[10px] font-semibold uppercase tracking-eyebrow ${toneClass}`}>{label}</span>
        <span className="text-ink-400 transition group-hover:translate-x-0.5" aria-hidden>
          →
        </span>
      </span>
      <span className={`mt-2 block font-mono text-2xl font-semibold tracking-tight tnum ${toneClass}`}>{value}</span>
      <span className="mt-1 block text-[11px] leading-4 text-ink-600">{detail}</span>
    </Link>
  );
}

function ActionCard({
  href,
  eyebrow,
  title,
  body,
  tone = "brand",
  wide = false,
}: {
  href: string;
  eyebrow: string;
  title: string;
  body: string;
  tone?: "brand" | "amber" | "cyan" | "violet";
  wide?: boolean;
}) {
  const toneClass = {
    brand: "text-brand-700",
    amber: "text-amber-700",
    cyan: "text-cyan-700",
    violet: "text-violet-700",
  }[tone];

  return (
    <Link
      href={href}
      className={`group flex min-h-[7.25rem] flex-col justify-between rounded-[10px] border border-ink-200/80 bg-white/90 p-4 text-left text-ink-900 shadow-card backdrop-blur transition duration-200 hover:-translate-y-0.5 hover:border-brand-300 hover:bg-white hover:shadow-panel focus:outline-none focus:ring-2 focus:ring-brand-200 ${wide ? "sm:col-span-2" : ""}`}
    >
      <span>
        <span className={`font-mono text-[10px] font-semibold uppercase tracking-eyebrow ${toneClass}`}>{eyebrow}</span>
        <span className="mt-1.5 block text-lg font-semibold tracking-tight">{title}</span>
        <span className="mt-1 block text-sm leading-5 text-ink-700">{body}</span>
      </span>
      <span
        className="mt-3 grid h-7 w-7 place-items-center rounded-[7px] border border-brand-100 bg-brand-50 text-brand-700 transition group-hover:translate-x-0.5"
        aria-hidden
      >
        →
      </span>
    </Link>
  );
}
