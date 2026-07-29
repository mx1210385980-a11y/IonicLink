import Link from "next/link";
import { countByStatus, listPapers } from "@/lib/db";
import { DOMAINS, type Domain } from "@/lib/domain";
import { getModule } from "@/lib/modules/registry.server";

export const dynamic = "force-dynamic";

export default function HomePage() {
  const workspaces = DOMAINS.map((domain) => ({
    domain,
    mod: getModule(domain),
    counts: countByStatus(domain),
    papers: listPapers(domain).length,
  }));

  return (
    <div className="mx-auto flex min-h-[calc(100dvh-8.5rem)] max-w-6xl flex-col justify-center px-4 py-10 sm:py-14">
      <section className="animate-[home-rise_520ms_ease-out_both] text-center">
        <p className="label-eyebrow text-brand-700">IONICLINK EXTRACT</p>
        <div className="mx-auto mt-5 max-w-4xl">
          <h1 className="text-balance text-5xl font-semibold tracking-tight text-ink-950 sm:text-7xl">
            Add papers. Get data.
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-balance text-lg font-medium leading-8 text-ink-700 sm:text-xl">
            Choose the property you are extracting. Each workspace keeps its papers, review queue, and database separate.
          </p>
        </div>

        <div className="mt-11 grid gap-4 text-left md:grid-cols-3">
          {workspaces.map(({ domain, mod, counts, papers }) => (
            <WorkspaceCard
              key={domain}
              domain={domain}
              label={mod.label}
              tagline={mod.tagline}
              official={counts.official}
              review={counts.review}
              papers={papers}
            />
          ))}
        </div>
      </section>
    </div>
  );
}

function WorkspaceCard({
  domain,
  label,
  tagline,
  official,
  review,
  papers,
}: {
  domain: Domain;
  label: string;
  tagline: string;
  official: number;
  review: number;
  papers: number;
}) {
  return (
    <article className="group flex min-h-[22rem] flex-col rounded-[16px] border border-ink-200 bg-white/90 p-5 shadow-[0_24px_64px_-48px_rgba(15,23,42,0.7)] transition duration-200 hover:-translate-y-1 hover:border-brand-300 hover:shadow-[0_28px_72px_-44px_rgba(15,118,110,0.45)] sm:p-6">
      <p className="label-eyebrow text-brand-700">{label} workspace</p>
      <h2 className="mt-4 min-h-[4.5rem] text-lg font-semibold leading-6 text-ink-900">{tagline}</h2>

      <Link
        href={`/${domain}/extract`}
        className="mt-6 flex min-h-16 items-center justify-between gap-3 rounded-[12px] bg-brand-700 px-4 py-3 text-base font-semibold text-white transition hover:bg-brand-800 focus:outline-none focus:ring-2 focus:ring-brand-200"
        aria-label={`Upload ${label} papers`}
      >
        <span>Upload {label} papers</span>
        <span className="text-xl transition group-hover:translate-x-0.5" aria-hidden>
          →
        </span>
      </Link>

      <nav className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-sm font-semibold text-ink-700" aria-label={`${label} workspace`}>
        <Link className="transition hover:text-brand-700" href={`/${domain}/database`}>
          Database
        </Link>
        <Link className="transition hover:text-amber-700" href={`/${domain}/database?status=review`}>
          Review queue
        </Link>
        <Link className="transition hover:text-brand-700" href={`/${domain}/library`}>
          Library
        </Link>
      </nav>

      <div className="mt-auto grid grid-cols-3 gap-2 border-t border-ink-100 pt-5">
        <Metric value={review} label="Review" tone="amber" />
        <Metric value={official} label="Checked" tone="brand" />
        <Metric value={papers} label="Papers" />
      </div>
    </article>
  );
}

function Metric({
  value,
  label,
  tone = "ink",
}: {
  value: number;
  label: string;
  tone?: "brand" | "amber" | "ink";
}) {
  const toneClass = tone === "brand" ? "text-brand-700" : tone === "amber" ? "text-amber-700" : "text-ink-800";

  return (
    <div className="min-w-0" aria-label={`${value} ${label}`}>
      <span className={`block font-mono text-xl font-semibold tnum ${toneClass}`}>{value}</span>
      <span className="mt-0.5 block truncate text-xs font-semibold text-ink-500">{label}</span>
    </div>
  );
}
