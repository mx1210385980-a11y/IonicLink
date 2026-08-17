import Link from "next/link";
import { notFound } from "next/navigation";
import { listJobs, listRecords, listSourceSummaries } from "@/lib/db";
import { isDomain, type Domain } from "@/lib/domain";
import { getModule } from "@/lib/modules/registry.server";
import { LibraryProgress, SourceProgressTrack } from "@/components/library/LibraryProgress";
import { SourceThumb } from "@/components/SourceThumb";
import { DeleteLiteratureButton } from "@/components/library/DeleteLiteratureButton";

export const dynamic = "force-dynamic";

type AnyRecord = any;

/**
 * Documents = the source documents (uploaded PDFs) and the records drawn from each,
 * plus a fallback group for records extracted from pasted text (no PDF).
 */
export default function LibraryPage({ params }: { params: { domain: string } }) {
  if (!isDomain(params.domain)) notFound();
  const domain = params.domain;
  const mod = getModule(domain);
  const sources = listSourceSummaries(domain);
  const records = listRecords(domain);
  const jobs = listJobs(domain);

  const bySource = new Map<string, AnyRecord[]>();
  const noSource: AnyRecord[] = [];
  const jobsBySource = new Map<string, number>();
  for (const job of jobs) {
    if (job.sourceId) jobsBySource.set(job.sourceId, (jobsBySource.get(job.sourceId) ?? 0) + 1);
  }
  const sourceIds = new Set(sources.map((source) => source.id));
  for (const r of records) {
    if (r.sourceId && sourceIds.has(r.sourceId)) {
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
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="label-eyebrow">Unified literature management</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">Documents</h1>
          </div>
          <Link href={`/${domain}/extract`} className="btn">Upload documents</Link>
        </div>
        <p className="mt-1 text-sm text-ink-700">
          {sources.length} source document{sources.length === 1 ? "" : "s"} ·{" "}
          {records.length} {mod.label.toLowerCase()} record{records.length === 1 ? "" : "s"} total ·{" "}
          {records.length - noSource.length} linked to indexed PDFs.
        </p>
        <p className="mt-2 max-w-3xl text-xs leading-5 text-ink-500">
          Manage literature here across Extract, Review, Checked Database, and Library. Deleting an indexed document removes its PDF and every linked extraction record.
        </p>
      </header>

      <LibraryProgress domain={domain} sources={sources} records={records} />

      {sources.length > 0 ? (
        <section className="space-y-4">
          <h2 className="label-eyebrow">Source documents</h2>
          <div className="grid min-w-0 gap-4">
            {sources.map((s) => (
              <SourceRow
                key={s.id}
                domain={domain}
                source={s}
                jobs={jobsBySource.get(s.id) ?? 0}
                records={bySource.get(s.id) ?? []}
                headline={headline}
              />
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
          <h2 className="label-eyebrow">Without an indexed source PDF · pasted, seeded, or orphaned</h2>
          <div className="grid gap-3">
            {[...noSourcePapers.entries()].map(([title, recs]) => (
              <div key={title} className="panel flex flex-wrap items-center justify-between gap-4 p-4">
                <div className="min-w-0">
                  <h3 className="truncate font-semibold text-ink-900">{title}</h3>
                  <p className="text-xs text-ink-400">
                    {[recs[0].paper.journal, recs[0].paper.year].filter(Boolean).join(" · ") || "—"}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="chip shrink-0">{recs.length} record{recs.length > 1 ? "s" : ""}</span>
                  <DeleteLiteratureButton
                    domain={domain}
                    label={title}
                    action={{ kind: "records", recordIds: recs.map((record) => record.id) }}
                  />
                </div>
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
  jobs,
  records,
  headline,
}: {
  domain: Domain;
  source: { id: string; filename: string; pageCount: number; createdAt: string };
  jobs: number;
  records: AnyRecord[];
  headline: (r: AnyRecord) => string;
}) {
  const date = source.createdAt.slice(0, 10);

  return (
    <div className="panel flex min-w-0 flex-col gap-4 overflow-hidden p-4 sm:flex-row">
      <SourceThumb id={source.id} filename={source.filename} domain={domain} />

      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h3 className="min-w-0 flex-1 basis-full truncate font-semibold text-ink-900 sm:basis-auto">{source.filename}</h3>
          <span className="chip shrink-0">{source.pageCount} pp</span>
          <span className="chip shrink-0">{jobs} extraction job{jobs === 1 ? "" : "s"}</span>
          <span className="text-xs text-ink-400">added {date}</span>
        </div>

        <SourceProgressTrack records={records} />

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
                    {r.status === "official" ? "checked" : r.status}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex flex-wrap items-center gap-3">
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
          <DeleteLiteratureButton
            domain={domain}
            label={source.filename}
            action={{ kind: "source", sourceId: source.id, jobCount: jobs, recordCount: records.length }}
          />
        </div>
      </div>
    </div>
  );
}
