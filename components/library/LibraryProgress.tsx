import Link from "next/link";
import type { Domain } from "@/lib/domain";

export type SourceProgressState = "empty" | "reviewOnly" | "mixed" | "officialOnly";

export interface SourceProgressSource {
  id: string;
}

export interface SourceProgressRecord {
  status: "review" | "official";
  sourceId?: string;
  extraction?: { source?: string };
}

export interface SourceProgressSummary {
  sourceTotal: number;
  withRecords: number;
  pendingReviewSources: number;
  publishedSources: number;
  unlinkedRecords: number;
  linkedOfficial: number;
  linkedReview: number;
  mockLocked: number;
}

/** Return one mutually exclusive publishing state for a single indexed source. */
export function sourceProgressState(recordsForSource: readonly SourceProgressRecord[]): SourceProgressState {
  if (recordsForSource.length === 0) return "empty";

  let hasReview = false;
  let hasOfficial = false;
  for (const record of recordsForSource) {
    if (record.status === "review") hasReview = true;
    if (record.status === "official") hasOfficial = true;
  }

  if (hasReview && hasOfficial) return "mixed";
  return hasOfficial ? "officialOnly" : "reviewOnly";
}

/** Summarize the exact source-to-record pipeline without estimating completion. */
export function summarizeSourceProgress(
  sources: readonly SourceProgressSource[],
  records: readonly SourceProgressRecord[]
): SourceProgressSummary {
  const sourceIds = new Set(sources.map((source) => source.id));
  const sourceFlags = new Map<string, { review: boolean; official: boolean }>();
  let unlinkedRecords = 0;
  let linkedOfficial = 0;
  let linkedReview = 0;
  let mockLocked = 0;

  for (const record of records) {
    if (!record.sourceId || !sourceIds.has(record.sourceId)) {
      unlinkedRecords += 1;
      continue;
    }

    if (record.status === "official") linkedOfficial += 1;
    if (record.status === "review") {
      linkedReview += 1;
      if (record.extraction?.source === "mock") mockLocked += 1;
    }

    const flags = sourceFlags.get(record.sourceId) ?? { review: false, official: false };
    if (record.status === "review") flags.review = true;
    if (record.status === "official") flags.official = true;
    sourceFlags.set(record.sourceId, flags);
  }

  let withRecords = 0;
  let pendingReviewSources = 0;
  let publishedSources = 0;
  for (const source of sources) {
    const flags = sourceFlags.get(source.id);
    if (!flags) continue;
    withRecords += 1;
    if (flags.review) pendingReviewSources += 1;
    if (flags.official) publishedSources += 1;
  }

  return {
    sourceTotal: sources.length,
    withRecords,
    pendingReviewSources,
    publishedSources,
    unlinkedRecords,
    linkedOfficial,
    linkedReview,
    mockLocked,
  };
}

export function LibraryProgress({
  domain,
  sources,
  records,
}: {
  domain: Domain;
  sources: readonly SourceProgressSource[];
  records: readonly SourceProgressRecord[];
}) {
  const summary = summarizeSourceProgress(sources, records);
  const emptySources = summary.sourceTotal - summary.withRecords;
  const reviewRecords = records.reduce((count, record) => count + (record.status === "review" ? 1 : 0), 0);
  const needsFirstSource = summary.sourceTotal === 0 && records.length === 0;

  const nextAction =
    needsFirstSource
      ? {
          href: `/${domain}/extract`,
          label: "Index a source",
          detail: "Upload a PDF in Extract to start a traceable source-to-record pipeline.",
        }
      : emptySources > 0
      ? {
          href: `/${domain}/extract`,
          label: `Extract ${emptySources} source${emptySources === 1 ? "" : "s"}`,
          detail: "Indexed PDFs have no kept records yet. Run extraction to connect evidence to the pipeline.",
        }
      : reviewRecords > 0
        ? {
            href: `/${domain}/database?status=review`,
            label: `Review ${reviewRecords} record${reviewRecords === 1 ? "" : "s"}`,
            detail: "Resolve the review queue before treating every source as fully published.",
          }
        : summary.unlinkedRecords > 0
          ? {
              href: `/${domain}/database`,
              label: "Resolve source links",
              detail: `${summary.unlinkedRecords} record${summary.unlinkedRecords === 1 ? " has" : "s have"} no available indexed-PDF provenance link. Inspect them in the database.`,
            }
          : {
              href: `/${domain}/database?status=official`,
              label: "Open official database",
              detail: "All indexed sources with records are published and no review work remains.",
            };

  const metrics = [
    ["Indexed", summary.sourceTotal],
    ["With records", summary.withRecords],
    ["Pending review", summary.pendingReviewSources],
    ["Published sources", summary.publishedSources],
  ] as const;

  return (
    <section aria-labelledby="source-pipeline-title" className="panel overflow-hidden">
      <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(16rem,0.55fr)] lg:p-5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <p className="label-eyebrow">Source pipeline</p>
              <h2 id="source-pipeline-title" className="mt-1 text-base font-semibold text-ink-900">
                Evidence publishing status
              </h2>
            </div>
            <p className="text-xs text-ink-400">Exact source counts</p>
          </div>

          <dl className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-slate-200 bg-slate-200 sm:grid-cols-4">
            {metrics.map(([label, value]) => (
              <div key={label} className="bg-white px-3 py-3">
                <dt className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-400">{label}</dt>
                <dd className="mt-1 font-mono text-xl font-bold tabular-nums text-ink-900">{value}</dd>
              </div>
            ))}
          </dl>

          {summary.unlinkedRecords > 0 || summary.mockLocked > 0 ? (
            <div className="mt-3 flex flex-wrap gap-2 text-xs" aria-label="Source pipeline blockers">
              {summary.unlinkedRecords > 0 ? (
                <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 font-semibold text-ink-700">
                  {summary.unlinkedRecords} without indexed PDF
                </span>
              ) : null}
              {summary.mockLocked > 0 ? (
                <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 font-semibold text-amber-800">
                  {summary.mockLocked} mock locked
                </span>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="rounded-xl border border-brand-200 bg-brand-50/60 p-4">
          <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-brand-700">Next action</p>
          <Link href={nextAction.href} className="mt-2 inline-flex font-semibold text-brand-700 hover:underline">
            {nextAction.label} →
          </Link>
          <p className="mt-2 text-xs leading-5 text-ink-700">{nextAction.detail}</p>
        </div>
      </div>
    </section>
  );
}

const STATE_META: Record<SourceProgressState, { label: string; classes: string }> = {
  empty: { label: "No records", classes: "border-slate-200 bg-slate-50 text-ink-500" },
  reviewOnly: { label: "Review pending", classes: "border-amber-200 bg-amber-50 text-amber-800" },
  mixed: { label: "Partially published", classes: "border-cyan-200 bg-cyan-50 text-cyan-800" },
  officialOnly: { label: "Published", classes: "border-emerald-200 bg-emerald-50 text-emerald-800" },
};

export function SourceProgressTrack({ records }: { records: readonly SourceProgressRecord[] }) {
  const state = sourceProgressState(records);
  let review = 0;
  let official = 0;
  for (const record of records) {
    if (record.status === "review") review += 1;
    if (record.status === "official") official += 1;
  }
  const meta = STATE_META[state];
  const hasRecords = records.length > 0;
  const hasPublished = official > 0;

  return (
    <div className="mt-2.5" data-source-state={state}>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className={`rounded-full border px-2.5 py-1 font-bold ${meta.classes}`}>{meta.label}</span>
        {review > 0 ? (
          <span className="font-semibold text-amber-800">
            {review} pending review
          </span>
        ) : null}
        {official > 0 ? <span className="font-semibold text-emerald-700">{official} official</span> : null}
        {state === "empty" ? <span className="text-ink-400">no records</span> : null}
      </div>

      <ol aria-label="Source progress: Indexed to Records to Published" className="mt-2 grid grid-cols-3 gap-2 text-[11px] font-semibold">
        <ProgressStep label="Indexed" state="complete" />
        <ProgressStep label="Records" state={hasRecords ? "complete" : "pending"} />
        <ProgressStep label="Published" state={hasPublished ? (state === "mixed" ? "partial" : "complete") : "pending"} />
      </ol>
    </div>
  );
}

function ProgressStep({ label, state }: { label: string; state: "complete" | "partial" | "pending" }) {
  const tone =
    state === "complete"
      ? "border-emerald-500 bg-emerald-500 text-emerald-800"
      : state === "partial"
        ? "border-amber-500 bg-amber-500 text-amber-800"
        : "border-slate-300 bg-white text-ink-400";

  return (
    <li className="flex min-w-0 items-center gap-1.5" aria-label={`${label}: ${state}`}>
      <span aria-hidden="true" className={`h-2.5 w-2.5 shrink-0 rounded-full border ${tone}`} />
      <span className="truncate">{label}</span>
    </li>
  );
}
