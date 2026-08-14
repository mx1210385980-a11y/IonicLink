import Link from "next/link";
import { notFound } from "next/navigation";
import { countByStatus, listJobs, listRecords, listSourceSummaries } from "@/lib/db";
import { isDomain, type Domain } from "@/lib/domain";
import { getModule } from "@/lib/modules/registry.server";
import { deriveWorkspaceProgress, type WorkspaceProgress } from "@/lib/workspaceProgress";

export const dynamic = "force-dynamic";

function loadWorkspaceProgress(domain: Domain) {
  const mod = getModule(domain);
  const records = listRecords(domain);

  return deriveWorkspaceProgress({
    domain,
    records,
    counts: countByStatus(domain),
    jobs: listJobs(domain),
    sourceCount: listSourceSummaries(domain).length,
    coreCompleteness: mod.coreCompleteness,
  });
}

function DomainHome({ params }: { params: { domain: string } }) {
  if (!isDomain(params.domain)) notFound();
  const domain = params.domain;
  const mod = getModule(domain);
  const progress = loadWorkspaceProgress(domain);

  return (
    <main className="mx-auto flex min-h-[calc(100dvh-4.25rem)] w-full max-w-[1180px] items-center justify-center px-1 py-5 sm:px-3 sm:py-8 lg:min-h-dvh lg:px-6 lg:py-10">
      <section
        aria-labelledby="workspace-title"
        className="w-full animate-[home-rise_520ms_ease-out_both] rounded-[26px] border border-[#e2e8f3] bg-white p-4 shadow-[0_30px_80px_-52px_rgba(35,62,120,0.42)] sm:p-7 lg:p-8"
      >
        <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7083aa]">
              {mod.label} workspace
            </p>
            <h1 id="workspace-title" className="mt-2 text-3xl font-semibold tracking-[-0.035em] text-[#111a2e] sm:text-4xl">
              Hello, researcher
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[#536786] sm:text-base">
              Extract trustworthy evidence, then preview the model strategy — two focused tools, one clear workflow.
            </p>
          </div>
          <span className="inline-flex w-fit items-center gap-2 whitespace-nowrap rounded-full border border-[#d8e2fb] bg-[#f4f7ff] px-3 py-1.5 text-xs font-semibold text-[#2456d6]">
            <span className="h-2 w-2 rounded-full bg-[#4f7ee8]" aria-hidden />
            2 core tools
          </span>
        </header>

        <div className="mt-6 grid gap-5 lg:grid-cols-2">
          <CoreToolCard
            eyebrow="Evidence to structured data"
            title="IonicLink · Extraction Tool"
            icon={<ExtractionToolIcon />}
            features={[
              "Extract structures, properties, and conditions from source files",
              "Review evidence before records enter the curated database",
              "Keep uploads, job status, and provenance in one workspace",
            ]}
            preview={<ExtractionPreview progress={progress} workspace={mod.label} />}
            href={`/${domain}/extract`}
            action="Open extraction tool"
          />

          <CoreToolCard
            eyebrow="Tribology model sandbox"
            title="Model Training Preview"
            icon={<ModelPreviewIcon />}
            features={[
              "Compare CatBoost, Random Forest, XGBoost, SVR, and MLP",
              "Tune single, dual, and triple model strategies",
              "Inspect train/test trends and literature validation",
            ]}
            preview={<ModelStrategyPreview />}
            href="/tribology/design"
            action="Preview model strategy"
            note="Teaching-grade trend sandbox · opening it does not start a training run"
          />
        </div>
      </section>
    </main>
  );
}

export default DomainHome;

function CoreToolCard({
  eyebrow,
  title,
  icon,
  features,
  preview,
  href,
  action,
  note,
}: {
  eyebrow: string;
  title: string;
  icon: React.ReactNode;
  features: readonly string[];
  preview: React.ReactNode;
  href: string;
  action: string;
  note?: string;
}) {
  return (
    <article
      data-testid="core-tool-card"
      className="group flex min-w-0 flex-col overflow-hidden rounded-[18px] border border-[#dfe6f2] bg-white transition duration-200 hover:-translate-y-0.5 hover:border-[#cbd8f4] hover:shadow-[0_22px_46px_-34px_rgba(36,86,214,0.5)]"
    >
      <div className="flex items-center gap-3 border-b border-[#e6ebf4] bg-[#f5f7fc] px-5 py-4 sm:px-6">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-white text-[#2456d6] shadow-[0_6px_18px_-12px_rgba(36,86,214,0.8)] ring-1 ring-[#d9e2f5]">
          {icon}
        </span>
        <span className="min-w-0">
          <span className="block text-[10px] font-semibold uppercase tracking-[0.16em] text-[#7083aa]">{eyebrow}</span>
          <span className="mt-0.5 block text-base font-semibold tracking-tight text-[#14203a] sm:text-lg">{title}</span>
        </span>
      </div>

      <div className="flex flex-1 flex-col p-5 sm:p-6">
        <ul className="space-y-2.5" aria-label={`${title} capabilities`}>
          {features.map((feature) => (
            <li key={feature} className="flex gap-2.5 text-sm leading-5 text-[#344663]">
              <CheckIcon />
              <span>{feature}</span>
            </li>
          ))}
        </ul>

        <div className="mt-5 flex-1">{preview}</div>

        {note ? <p className="mt-3 text-center text-[11px] leading-4 text-[#70809c]">{note}</p> : null}

        <Link
          href={href}
          aria-label={action}
          className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-[11px] bg-[#2456d6] px-4 py-2.5 text-sm font-semibold text-white shadow-[0_14px_28px_-18px_rgba(36,86,214,0.9)] transition hover:bg-[#1e49ba] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#9bb3f3] focus-visible:ring-offset-2"
        >
          {action}
          <span aria-hidden>→</span>
        </Link>
      </div>
    </article>
  );
}

function ExtractionPreview({ progress, workspace }: { progress: WorkspaceProgress; workspace: string }) {
  const active = progress.jobs.queued + progress.jobs.extracting;

  return (
    <div className="h-full min-h-[238px] rounded-[15px] border border-[#dfe6f4] bg-[#f8faff] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold text-[#1d2b49]">Live extraction workspace</p>
          <p className="mt-0.5 text-[11px] text-[#7888a5]">Current queue at a glance</p>
        </div>
        <span className="rounded-full border border-[#d7e1f5] bg-white px-2.5 py-1 text-[10px] font-semibold text-[#52698f]">
          {workspace}
        </span>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2">
        <PreviewMetric label="Jobs" value={progress.jobs.total} />
        <PreviewMetric label="Active" value={active} accent />
        <PreviewMetric label="Review" value={progress.counts.review} />
      </div>

      <div className="mt-3 flex min-h-[105px] items-center justify-center rounded-[12px] border border-dashed border-[#bfcdef] bg-white/90 px-4 text-center">
        <div>
          <span className="mx-auto grid h-9 w-9 place-items-center rounded-full bg-[#edf2ff] text-[#2456d6]">
            <UploadIcon />
          </span>
          <p className="mt-2 text-xs font-semibold text-[#243553]">Drop a source to begin</p>
          <p className="mt-1 text-[10px] text-[#8290aa]">PDF, TXT, CSV, XLSX, or ZIP</p>
        </div>
      </div>
    </div>
  );
}

function PreviewMetric({ label, value, accent = false }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className="rounded-[10px] border border-[#e2e8f3] bg-white px-3 py-2.5">
      <p className={`font-mono text-lg font-semibold tabular-nums ${accent ? "text-[#2456d6]" : "text-[#1f2c47]"}`}>{value}</p>
      <p className="mt-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-[#8491aa]">{label}</p>
    </div>
  );
}

function ModelStrategyPreview() {
  return (
    <div className="h-full min-h-[238px] rounded-[15px] border border-[#e2def6] bg-[#faf9ff] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold text-[#252044]">Strategy preview</p>
          <p className="mt-0.5 text-[11px] text-[#827ba0]">True vs predicted trend</p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-violet-200 bg-white px-2.5 py-1 text-[10px] font-semibold text-violet-700">
          <span className="h-1.5 w-1.5 rounded-full bg-violet-500" aria-hidden />
          Preview
        </span>
      </div>

      <div className="mt-3 flex gap-1.5" aria-label="Available strategy types">
        <span className="rounded-md border border-violet-200 bg-white px-2 py-1 text-[9px] font-semibold text-[#756b93]">Single</span>
        <span className="rounded-md bg-violet-600 px-2 py-1 text-[9px] font-semibold text-white">Dual</span>
        <span className="rounded-md border border-violet-200 bg-white px-2 py-1 text-[9px] font-semibold text-[#756b93]">Triple</span>
      </div>

      <div className="mt-3 rounded-[11px] border border-[#e5e1f2] bg-white p-2.5">
        <svg viewBox="0 0 360 108" className="h-[108px] w-full" role="img" aria-label="Illustrative true versus predicted trend preview">
          <path d="M30 88H340M30 88V12" stroke="#d9deeb" strokeWidth="1" />
          <path d="M42 80L325 18" stroke="#b7a7e8" strokeWidth="1.5" strokeDasharray="5 5" />
          <path d="M42 71C87 65 104 59 138 55C180 50 199 39 238 33C273 28 299 27 326 20" fill="none" stroke="#2456d6" strokeWidth="2.2" strokeLinecap="round" />
          {[
            [52, 75], [76, 68], [96, 66], [118, 57], [143, 59], [169, 47], [197, 45], [224, 35], [251, 34], [283, 25], [314, 23],
          ].map(([cx, cy]) => (
            <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="3.2" fill="#4f7ee8" />
          ))}
          {[
            [65, 73], [132, 51], [188, 50], [244, 30], [299, 29],
          ].map(([cx, cy]) => (
            <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="3.5" fill="#8b5cf6" stroke="white" strokeWidth="1.2" />
          ))}
        </svg>
        <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-[#edf0f6] pt-2 text-[9px] font-medium text-[#697895]">
          <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-[#4f7ee8]" aria-hidden />Train / test trend</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-violet-500" aria-hidden />Literature validation</span>
        </div>
      </div>
    </div>
  );
}

function CheckIcon() {
  return (
    <span className="mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full bg-[#4dbb82] text-white" aria-hidden>
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
        <path d="M2.2 5.1l1.7 1.7 3.9-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

function ExtractionToolIcon() {
  return (
    <svg width="21" height="21" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M8 5.3L5.3 2.6 2.6 5.3 5.3 8 8 5.3zm13.4 0l-2.7-2.7L16 5.3 18.7 8l2.7-2.7zM14.5 18.8L12 16.3l-2.5 2.5 2.5 2.5 2.5-2.5z" stroke="currentColor" strokeWidth="1.55" strokeLinejoin="round" />
      <path d="M8 6.4l2.6 2.4a2.05 2.05 0 002.8 0L16 6.4M12 10.3v5.8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function ModelPreviewIcon() {
  return (
    <svg width="21" height="21" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M4 18.5l4.3-5 3.4 2.8L20 6.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M16 6.5h4v4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="8.3" cy="13.5" r="1.5" fill="currentColor" opacity=".34" />
      <circle cx="11.7" cy="16.3" r="1.5" fill="currentColor" opacity=".34" />
    </svg>
  );
}

function UploadIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M12 16V6m0 0L8 10m4-4l4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5 15.5v2A1.5 1.5 0 006.5 19h11a1.5 1.5 0 001.5-1.5v-2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
