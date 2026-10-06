import Link from "next/link";
import { countByStatus, listPapers } from "@/lib/db";
import { DOMAINS, type Domain } from "@/lib/domain";
import { getModule } from "@/lib/modules/registry.server";

const WORKSPACE_DETAILS: Record<Domain, { mark: string }> = {
  tribology: { mark: "μ" },
  conductivity: { mark: "σ" },
  diffusion: { mark: "D" },
};

const FOCUS = "rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2";
const PRIMARY_LINK = `inline-flex min-h-10 items-center justify-center gap-3 whitespace-nowrap rounded-lg border border-[#00888a] bg-[#00888a] px-4 text-sm font-medium text-white shadow-sm transition hover:border-[#006e70] hover:bg-[#006e70] ${FOCUS}`;

export function HomePageContent() {
  const workspaces = DOMAINS.map((domain) => ({
    domain,
    label: getModule(domain).label,
    counts: countByStatus(domain),
    papers: listPapers(domain).length,
  }));
  const totals = workspaces.reduce((sum, workspace) => ({
    checked: sum.checked + workspace.counts.official,
    review: sum.review + workspace.counts.review,
  }), { checked: 0, review: 0 });

  return (
    <section aria-labelledby="overview-title" data-testid="data-overview" className="-mx-2 -mb-6 -mt-3 min-h-dvh bg-[#fafafa] px-4 py-7 font-sans text-[#242b33] sm:-mx-4 sm:px-8 lg:mx-0 lg:mb-0 lg:mt-0 lg:px-16 lg:pb-16 lg:pt-14">
      <div className="mx-auto w-full max-w-[1264px]">
        <header className="flex flex-wrap items-center justify-between gap-5">
          <div>
            <h1 id="overview-title" className="text-[30px] font-semibold leading-tight lg:text-[36px] tracking-[-0.025em]">Data overview</h1>
          </div>
          <Link href="/teaching#prediction" className={`inline-flex min-h-10 items-center gap-3 rounded-lg border border-[#dce0e4] bg-white px-4 text-sm font-medium text-ink-700 transition hover:border-[#00888a] hover:text-[#00888a] ${FOCUS}`}>Prediction of μ <ArrowIcon /></Link>
        </header>

        <dl aria-label="All workspace totals" className="my-8 grid grid-cols-3 divide-x divide-[#dce0e4] sm:my-10 lg:mb-9 lg:grid-cols-[31.2%_36.8%_32%] lg:mt-12 lg:min-h-[76px]">
          <SummaryMetric label="Workspaces" value={workspaces.length} />
          <SummaryMetric label="Checked records" value={totals.checked} />
          <SummaryMetric label="To review" value={totals.review} />
        </dl>

        <div className="rounded-xl border border-[#dce0e4] bg-white shadow-[0_2px_8px_rgba(24,39,48,0.025)]">
          <table aria-label="Data workspaces" className="block w-full table-fixed border-separate border-spacing-0 text-left xl:table">
            <colgroup className="hidden xl:table-column-group"><col className="w-[37.5%]" /><col className="w-[13%]" /><col className="w-[13%]" /><col className="w-[13%]" /><col className="w-[23.5%]" /></colgroup>
            <thead className="hidden text-[13px] font-medium text-ink-700 xl:table-header-group">
              <tr>
                <th scope="col" className="h-12 rounded-tl-xl border-b border-[#e3e6e9] bg-[#f8f9fa] px-5 font-medium">Workspace</th>
                <th scope="col" className="h-12 border-b border-[#e3e6e9] bg-[#f8f9fa] px-3 text-center font-medium">Papers</th>
                <th scope="col" className="h-12 border-b border-[#e3e6e9] bg-[#f8f9fa] px-3 text-center font-medium">Checked</th>
                <th scope="col" className="h-12 border-b border-[#e3e6e9] bg-[#f8f9fa] px-3 text-center font-medium">Review</th>
                <th scope="col" className="h-12 rounded-tr-xl border-b border-[#e3e6e9] bg-[#f8f9fa] px-5 2xl:pl-[76px] text-left font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="block xl:table-row-group">
              {workspaces.map(({ domain, label, counts, papers }) => {
                const detail = WORKSPACE_DETAILS[domain];
                return (
                  <tr key={domain} aria-label={`${label} workspace`} className="grid grid-cols-3 border-b border-[#e3e6e9] px-4 py-5 last:border-b-0 transition-colors hover:bg-[#f8fbfb] xl:table-row xl:h-[104px] xl:border-0 xl:p-0 xl:[&:not(:last-child)>td]:border-b xl:[&:not(:last-child)>td]:border-[#e3e6e9]">
                    <th scope="row" className="col-span-3 block min-w-0 pb-5 text-left xl:table-cell xl:border-b xl:border-[#e3e6e9] xl:px-5 xl:py-5 xl:[tr:last-child_&]:border-b-0">
                      <div className="flex items-center gap-[18px]">
                        <span aria-hidden className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-[#f0f1f2] text-[26px] font-normal italic text-[#46515d]">{detail.mark}</span>
                        <div className="min-w-0">
                          <Link href={`/${domain}/database`} className={`block text-lg font-semibold leading-7 text-[#242b33] hover:text-[#00888a] ${FOCUS}`}>{label}</Link>
                        </div>
                      </div>
                    </th>
                    <td className="block text-center xl:table-cell xl:px-3">
                      <MetricLink href={`/${domain}/library`} label="Papers" workspace={label} value={papers} tone="brand" title="Distinct paper titles represented in this workspace's records" />
                    </td>
                    <td className="block text-center xl:table-cell xl:px-3">
                      <MetricLink href={`/${domain}/database`} label="Checked" workspace={label} value={counts.official} tone="brand" />
                    </td>
                    <td className="block text-center xl:table-cell xl:px-3">
                      <MetricLink href={`/${domain}/database?status=review`} label="Review" workspace={label} value={counts.review} tone={counts.review > 0 ? "amber" : "ink"} />
                    </td>
                    <td className="col-span-3 block pt-5 xl:table-cell xl:px-5 xl:py-4 2xl:pl-[76px] 2xl:pr-6">
                      <div className="flex items-center justify-between gap-3 xl:flex-col xl:items-start xl:gap-2">
                        <Link href={`/${domain}/extract`} aria-label={`Extract ${label} papers`} className={PRIMARY_LINK}>Extract papers <ArrowIcon /></Link>
                        <Link href={`/${domain}/database`} aria-label={`Open ${label} database`} className={`inline-flex min-h-6 items-center text-sm text-ink-700 underline-offset-4 hover:text-[#00888a] hover:underline ${FOCUS}`}>Open database</Link>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function SummaryMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-w-0 px-3 first:pl-1 sm:px-7 lg:px-[72px]">
      <dt className="text-xs leading-5 text-ink-700 sm:text-sm">{label}</dt>
      <dd className="mt-1.5 text-[28px] font-semibold lg:text-[36px] leading-none tracking-tight text-[#242b33] tabular-nums">{value.toLocaleString("en-US")}</dd>
    </div>
  );
}

function MetricLink({ href, label, workspace, value, tone = "ink", title }: {
  href: string;
  label: string;
  workspace: string;
  value: number;
  tone?: "brand" | "amber" | "ink";
  title?: string;
}) {
  const color = tone === "brand" ? "text-[#00888a]" : tone === "amber" ? "text-[#d98700]" : "text-ink-700";
  return (
    <Link href={href} aria-label={`${workspace}: ${value} ${label}`} title={title} className={`inline-flex min-h-10 min-w-10 flex-col items-center justify-center gap-1 px-1 text-xl font-medium tabular-nums decoration-current/40 underline-offset-4 transition hover:underline ${color} ${FOCUS}`}>
      <span>{value.toLocaleString("en-US")}</span>
      <span className="text-[11px] font-normal text-ink-700 no-underline xl:hidden">{label}</span>
    </Link>
  );
}

function ArrowIcon() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden><path d="M5 12h14m-5-5 5 5-5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
