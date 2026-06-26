import Link from "next/link";
import { countByStatus, listRecords } from "@/lib/db";
import { DEFAULT_DOMAIN, DOMAINS } from "@/lib/domain";
import { getModule } from "@/lib/modules/registry.server";

export const dynamic = "force-dynamic";

const PRIMARY_DOMAIN = DEFAULT_DOMAIN;

export default function HomePage() {
  const modules = DOMAINS.map((domain) => ({
    domain,
    mod: getModule(domain),
    counts: countByStatus(domain),
    papers: new Set(listRecords(domain).map((record) => record.paper.title)).size,
  }));

  const primary = modules.find((item) => item.domain === PRIMARY_DOMAIN) ?? modules[0];

  return (
    <div className="mx-auto flex min-h-[calc(100dvh-8.5rem)] max-w-5xl flex-col justify-center px-4 py-10 sm:py-14">
      <section className="animate-[home-rise_520ms_ease-out_both] text-center">
        <p className="label-eyebrow text-brand-700">IONICLINK EXTRACT</p>
        <div className="mx-auto mt-5 max-w-4xl">
          <h1 className="text-balance text-5xl font-semibold tracking-tight text-ink-950 sm:text-7xl">
            Add papers. Get data.
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-balance text-lg font-medium leading-8 text-ink-700 sm:text-xl">
            Upload PDFs, extract evidence-backed ionic liquid records, and review rows before they enter the database.
          </p>
        </div>

        <Link
          href={`/${primary.domain}/extract`}
          className="group mx-auto mt-12 flex min-h-[7.5rem] w-full max-w-3xl items-center justify-between gap-5 rounded-[14px] bg-brand-700 px-7 py-6 text-left text-white shadow-[0_28px_80px_-46px_rgba(15,118,110,0.95)] transition duration-200 hover:-translate-y-0.5 hover:bg-brand-800 focus:outline-none focus:ring-2 focus:ring-brand-200 sm:px-8"
        >
          <span className="flex min-w-0 items-center gap-5">
            <span className="grid h-16 w-16 shrink-0 place-items-center rounded-[12px] bg-white/10 text-3xl ring-1 ring-white/20 transition group-hover:bg-white/20">
              <span aria-hidden>⇧</span>
            </span>
            <span className="min-w-0">
              <span className="block text-2xl font-semibold tracking-tight sm:text-3xl">Upload PDF papers</span>
              <span className="mt-1 block text-base font-semibold text-brand-50/90 sm:text-lg">
                Start a clean extraction run.
              </span>
            </span>
          </span>
          <span className="text-4xl leading-none transition group-hover:translate-x-1" aria-hidden>
            →
          </span>
        </Link>

        <div className="mx-auto mt-9 flex flex-wrap items-center justify-center gap-x-10 gap-y-3 text-lg font-semibold text-ink-700">
          <Link className="transition hover:text-brand-700" href={`/${primary.domain}/database`}>
            Database
          </Link>
          <Link className="transition hover:text-brand-700" href={`/${primary.domain}/database?status=review`}>
            Review Queue
          </Link>
          <Link className="transition hover:text-brand-700" href={`/${primary.domain}/library`}>
            Library
          </Link>
        </div>

        <div className="mx-auto mt-12 h-px w-full max-w-3xl bg-ink-200" />

        <div className="mx-auto mt-8 flex flex-wrap items-center justify-center gap-x-7 gap-y-3 text-2xl font-semibold text-ink-700 sm:text-3xl">
          <Metric href={`/${primary.domain}/database?status=review`} value={primary.counts.review} label="Needs review" tone="amber" />
          <span className="text-ink-300">·</span>
          <Metric href={`/${primary.domain}/database?status=official`} value={primary.counts.official} label="Official database" tone="brand" />
          <span className="text-ink-300">·</span>
          <Metric href={`/${primary.domain}/library`} value={primary.papers} label="Papers indexed" />
        </div>

        <div className="mx-auto mt-10 flex flex-wrap justify-center gap-2">
          {modules.map(({ domain, mod, counts }) => (
            <WorkspaceLink
              key={domain}
              href={`/${domain}`}
              label={mod.label}
              official={counts.official}
              review={counts.review}
            />
          ))}
        </div>
      </section>
    </div>
  );
}

function WorkspaceLink({
  href,
  label,
  official,
  review,
}: {
  href: string;
  label: string;
  official: number;
  review: number;
}) {
  return (
    <Link
      href={href}
      className="group inline-flex items-center gap-2 rounded-[10px] border border-ink-200/80 bg-white/75 px-3 py-2 text-sm font-semibold text-ink-600 shadow-sm backdrop-blur transition hover:-translate-y-0.5 hover:border-brand-300 hover:bg-white hover:text-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-200"
    >
      <span>{label}</span>
      <span className="font-mono text-[11px]">
        <span className="text-brand-700">{official}</span>
        <span className="text-ink-400">/</span>
        <span className="text-amber-700">{review}</span>
      </span>
    </Link>
  );
}

function Metric({
  href,
  value,
  label,
  tone = "ink",
}: {
  href: string;
  value: number;
  label: string;
  tone?: "brand" | "amber" | "ink";
}) {
  const toneClass = tone === "brand" ? "text-brand-700" : tone === "amber" ? "text-amber-700" : "text-ink-800";
  const hoverClass =
    tone === "brand"
      ? "group-hover:text-brand-700"
      : tone === "amber"
        ? "group-hover:text-amber-700"
        : "group-hover:text-brand-700";
  const linkHoverClass = tone === "amber" ? "hover:text-amber-700" : "hover:text-brand-700";

  return (
    <Link
      href={href}
      className={`group inline-flex items-baseline gap-2 transition ${linkHoverClass} focus:outline-none focus:ring-2 focus:ring-brand-200`}
      aria-label={`${value} ${label}`}
    >
      <span className={`font-mono tnum ${toneClass} ${hoverClass}`}>{value}</span>
      <span>{label}</span>
    </Link>
  );
}
