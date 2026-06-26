import Link from "next/link";
import { notFound } from "next/navigation";
import { listRecords, listSourceSummaries } from "@/lib/db";
import { isDomain, type Domain } from "@/lib/domain";
import { getModule } from "@/lib/modules/registry.server";
import { SourceThumb } from "@/components/SourceThumb";

export const dynamic = "force-dynamic";

type AnyRecord = any;

/**
 * Library = the source documents (uploaded PDFs) and the records drawn from each,
 * plus a fallback group for records extracted from pasted text (no PDF).
 */
export default function LibraryPage({ params }: { params: { domain: string } }) {
  if (!isDomain(params.domain)) notFound();
  const domain = params.domain;
  const mod = getModule(domain);
  const sources = listSourceSummaries(domain);
  const records = listRecords(domain);

  const bySource = new Map<string, AnyRecord[]>();
  const noSource: AnyRecord[] = [];
  for (const r of records) {
    if (r.sourceId) {
      if (!bySource.has(r.sourceId)) bySource.set(r.sourceId, []);
      bySource.get(r.sourceId)!.push(r);
    } else {
      noSource.push(r);
    }
  }

  const noSourcePapers = new Map<string, AnyRecord[]>();
  for (const r of noSource) {
    const key = r.paper.title || "Untitled";
    if (!noSourcePapers.has(key)) noSourcePapers.set(key, []);
    noSourcePapers.get(key)!.push(r);
  }

  const headline = (r: AnyRecord) => mod.recordHeadline(r);

  return (
    <div className="space-y-8 py-4">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Library</h1>
        <p className="mt-1 text-sm text-ink-700">
          {sources.length} source document{sources.length === 1 ? "" : "s"} ·{" "}
          {records.length} {mod.label.toLowerCase()} record{records.length === 1 ? "" : "s"} drawn from them.
        </p>
      </header>

      {sources.length > 0 ? (
        <section className="space-y-4">
          <h2 className="label-eyebrow">Source documents</h2>
          <div className="grid min-w-0 gap-4">
            {sources.map((s) => (
              <SourceRow key={s.id} domain={domain} source={s} records={bySource.get(s.id) ?? []} headline={headline} />
            ))}
          </div>
        </section>
      ) : (
        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/40 px-4 py-6 text-sm text-ink-700">
          No source documents yet. Upload PDFs in{" "}
          <Link href={`/${domain}/extract`} className="font-semibold text-brand-600 underline">
            Extract
          </Link>{" "}
          (single or batch) and they’ll appear here with the records drawn from them.
        </div>
      )}

      {noSource.length > 0 && (
        <section className="space-y-3">
          <h2 className="label-eyebrow">Without a source PDF · pasted or seeded</h2>
          <div className="grid gap-3">
            {[...noSourcePapers.entries()].map(([title, recs]) => (
              <div key={title} className="panel flex items-center justify-between gap-4 p-4">
                <div className="min-w-0">
                  <h3 className="truncate font-semibold text-ink-900">{title}</h3>
                  <p className="text-xs text-ink-400">
                    {[recs[0].paper.journal, recs[0].paper.year].filter(Boolean).join(" · ") || "—"}
                  </p>
                </div>
                <span className="chip shrink-0">{recs.length} record{recs.length > 1 ? "s" : ""}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function SourceRow({
  domain,
  source,
  records,
  headline,
}: {
  domain: Domain;
  source: { id: string; filename: string; pageCount: number; createdAt: string };
  records: AnyRecord[];
  headline: (r: AnyRecord) => string;
}) {
  const review = records.filter((r) => r.status === "review").length;
  const official = records.filter((r) => r.status === "official").length;
  const date = source.createdAt.slice(0, 10);

  return (
    <div className="panel flex min-w-0 flex-col gap-4 overflow-hidden p-4 sm:flex-row">
      <SourceThumb id={source.id} filename={source.filename} domain={domain} />

      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h3 className="min-w-0 flex-1 basis-full truncate font-semibold text-ink-900 sm:basis-auto">{source.filename}</h3>
          <span className="chip shrink-0">{source.pageCount} pp</span>
          <span className="text-xs text-ink-400">added {date}</span>
        </div>

        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
          {official > 0 && <span className="status-mini status-mini-official">{official} official</span>}
          {review > 0 && <span className="status-mini status-mini-review">{review} in review</span>}
          {records.length === 0 && <span className="text-ink-400">no records kept</span>}
        </div>

        {records.length > 0 && (
          <ul className="mt-3 grid gap-1.5 sm:grid-cols-2">
            {records.map((r) => (
              <li
                key={r.id}
                className="flex min-w-0 flex-col gap-1.5 rounded-lg border border-slate-100 bg-slate-50/60 px-2.5 py-1.5 text-xs sm:flex-row sm:items-center sm:justify-between sm:gap-2"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className="shrink-0 font-mono text-ink-400">{r.id}</span>
                  <span className="truncate font-mono font-semibold text-ink-800">
                    {r.core.ionicLiquid.cation}
                    {r.core.ionicLiquid.anion}
                  </span>
                </span>
                <span className="flex shrink-0 flex-wrap items-center gap-2">
                  <span className="font-mono font-bold text-brand-600">{headline(r)}</span>
                  <span className={`status-mini ${r.status === "review" ? "status-mini-review" : "status-mini-official"}`}>
                    {r.status}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-3 flex items-center gap-3 text-xs">
          <a
            href={`/api/${domain}/source/${encodeURIComponent(source.id)}/pdf`}
            target="_blank"
            rel="noreferrer"
            className="font-semibold text-brand-600 hover:underline"
          >
            Open PDF →
          </a>
          <Link href={`/${domain}/database`} className="text-ink-700 hover:text-brand-700">
            View in database
          </Link>
        </div>
      </div>
    </div>
  );
}
