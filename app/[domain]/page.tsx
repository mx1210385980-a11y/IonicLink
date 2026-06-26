import Link from "next/link";
import { notFound } from "next/navigation";
import { countByStatus, listRecords } from "@/lib/db";
import { isDomain } from "@/lib/domain";
import { getModule } from "@/lib/modules/registry.server";

export const dynamic = "force-dynamic";

export default function DomainHome({ params }: { params: { domain: string } }) {
  if (!isDomain(params.domain)) notFound();
  const domain = params.domain;
  const mod = getModule(domain);
  const counts = countByStatus(domain);
  const papers = new Set(listRecords(domain).map((r) => r.paper.title)).size;

  return (
    <div className="mx-auto flex min-h-[calc(100dvh-8.5rem)] max-w-6xl flex-col justify-center px-1 py-8 sm:py-12">
      <section className="animate-[home-rise_520ms_ease-out_both]">
        <div className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr] lg:items-stretch">
          <div className="panel flex flex-col justify-between overflow-hidden p-6 sm:p-8">
            <div>
              <p className="label-eyebrow text-brand-700">{mod.label.toUpperCase()} WORKSPACE</p>
              <h1 className="mt-5 text-balance text-4xl font-semibold tracking-tight text-ink-950 sm:text-5xl">
                {mod.label} workbench
              </h1>
              <p className="mt-4 max-w-2xl text-base leading-7 text-ink-700 sm:text-lg">{mod.tagline}</p>
            </div>

            <div className="mt-8 grid gap-3 sm:grid-cols-3">
              <Metric href={`/${domain}/database?status=review`} value={counts.review} label="Needs review" tone="amber" />
              <Metric href={`/${domain}/database?status=official`} value={counts.official} label="Official records" tone="brand" />
              <Metric href={`/${domain}/library`} value={papers} label="Papers indexed" tone="ink" />
            </div>
          </div>

          <div className="grid gap-3">
            <ActionCard
              href={`/${domain}/extract`}
              eyebrow="Upload papers"
              title="Start extraction"
              body="Add PDFs, run extraction, and send candidates into the review queue."
              primary
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <ActionCard
                href={`/${domain}/database`}
                eyebrow="Curated store"
                title="Database"
                body="Browse approved records and export clean CSV data."
                tone="brand"
              />
              <ActionCard
                href={`/${domain}/database?status=review`}
                eyebrow="Human check"
                title="Review Queue"
                body="Approve complete candidates or reject noisy extractions."
                tone="amber"
              />
              <ActionCard
                href={`/${domain}/library`}
                eyebrow="Sources"
                title="Library"
                body="Inspect indexed papers and source coverage."
                tone="cyan"
              />
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function ActionCard({
  href,
  eyebrow,
  title,
  body,
  primary = false,
  tone = "brand",
}: {
  href: string;
  eyebrow: string;
  title: string;
  body: string;
  primary?: boolean;
  tone?: "brand" | "amber" | "cyan" | "violet";
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
      className={`group flex min-h-[8.5rem] flex-col justify-between rounded-[10px] border p-5 text-left transition duration-200 focus:outline-none focus:ring-2 focus:ring-brand-200 ${
        primary
          ? "border-brand-700 bg-brand-700 text-white shadow-[0_26px_62px_-42px_rgba(15,118,110,0.95)] hover:-translate-y-0.5 hover:bg-brand-800"
          : "border-ink-200/80 bg-white/90 text-ink-900 shadow-card backdrop-blur hover:-translate-y-0.5 hover:border-brand-300 hover:bg-white hover:shadow-panel"
      }`}
    >
      <span>
        <span className={`font-mono text-[10px] font-semibold uppercase tracking-eyebrow ${primary ? "text-brand-100" : toneClass}`}>
          {eyebrow}
        </span>
        <span className="mt-2 block text-xl font-semibold tracking-tight">{title}</span>
        <span className={`mt-2 block text-sm leading-6 ${primary ? "text-brand-50" : "text-ink-700"}`}>{body}</span>
      </span>
      <span
        className={`mt-4 grid h-8 w-8 place-items-center rounded-[8px] transition group-hover:translate-x-0.5 ${
          primary ? "bg-white/10 text-white ring-1 ring-white/20" : "border border-brand-100 bg-brand-50 text-brand-700"
        }`}
        aria-hidden
      >
        →
      </span>
    </Link>
  );
}

function Metric({ href, value, label, tone }: { href: string; value: number; label: string; tone: "brand" | "amber" | "ink" }) {
  const toneClass = tone === "brand" ? "text-brand-700" : tone === "amber" ? "text-amber-700" : "text-ink-700";
  return (
    <Link
      href={href}
      aria-label={`${value} ${label}`}
      className="rounded-[8px] border border-ink-200/80 bg-white/80 px-3 py-3 text-left shadow-sm transition hover:border-brand-300 hover:bg-white focus:outline-none focus:ring-2 focus:ring-brand-200"
    >
      <span className={`block font-mono text-2xl font-semibold tracking-tight tnum ${toneClass}`}>{value}</span>
      <span className="mt-1 block text-xs font-medium text-ink-700">{label}</span>
    </Link>
  );
}
