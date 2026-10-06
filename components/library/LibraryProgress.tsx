export type SourceProgressState = "empty" | "reviewOnly" | "mixed" | "officialOnly";

export interface SourceProgressRecord {
  status: "review" | "official";
  sourceId?: string;
  extraction?: { source?: string };
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
        {official > 0 ? <span className="font-semibold text-emerald-700">{official} checked</span> : null}
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
