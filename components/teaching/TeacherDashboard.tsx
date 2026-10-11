"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { RequestError, requestErrorMessage, requestJson } from "@/components/request";
import {
  TEACHING_FIELDS,
  type TeachingDashboardParticipant,
  type TeachingExperimentDashboard,
  type TeachingParticipantTimingStatus,
  type TeachingSafeExperimentPaper,
  type TeachingScore,
  type TeachingTeacherRound,
} from "@/lib/teachingShared";

const REFRESH_INTERVAL_MS = 30_000;

type RefreshState = "live" | "refreshing" | "paused" | "error";
type PaperFocus = "" | "A_manual" | "A_ai" | "B_manual" | "B_ai";
type CompletionFilter = "" | "completed" | "incomplete";

const SEQUENCE_LABELS = {
  manual_then_ai: "Manual→AI",
  ai_then_manual: "AI→Manual",
} as const;

const TIMING_LABELS: Record<TeachingParticipantTimingStatus, string> = {
  valid: "Valid",
  zero_active: "No active time",
  excessive_idle: "Excessive idle time",
  unavailable: "Unavailable",
};

export function teachingDialogTabTarget(
  currentIndex: number,
  focusableCount: number,
  shiftKey: boolean
): number | null {
  if (focusableCount <= 0) return null;
  if (shiftKey && currentIndex <= 0) return focusableCount - 1;
  if (!shiftKey && (currentIndex < 0 || currentIndex >= focusableCount - 1)) return 0;
  return null;
}

export function TeacherDashboard({ initial }: { initial: TeachingExperimentDashboard }) {
  const [data, setData] = useState(initial);
  const [refreshState, setRefreshState] = useState<RefreshState>("live");
  const [lastRefreshedAt, setLastRefreshedAt] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [paperFocus, setPaperFocus] = useState<PaperFocus>("");
  const [sequence, setSequence] = useState("");
  const [completion, setCompletion] = useState<CompletionFilter>("");
  const [timing, setTiming] = useState("");
  const [selectedParticipantId, setSelectedParticipantId] = useState<string | null>(null);
  const refreshInFlightRef = useRef<Promise<void> | null>(null);
  const detailReturnFocusRef = useRef<HTMLButtonElement | null>(null);
  const dashboardBackgroundRef = useRef<HTMLElement | null>(null);

  const refresh = useCallback((): Promise<void> => {
    if (refreshInFlightRef.current) return refreshInFlightRef.current;
    setRefreshState("refreshing");
    const operation = requestJson<TeachingExperimentDashboard>(
      "/api/teaching/admin",
      { cache: "no-store" },
      "Could not refresh experiment data"
    )
      .then((next) => {
        setData(next);
        setLastRefreshedAt(new Date().toISOString());
        setError("");
        setRefreshState(document.visibilityState === "visible" ? "live" : "paused");
      })
      .catch((cause) => {
        setError(requestErrorMessage(cause, "Could not refresh experiment data. Try again later."));
        setRefreshState("error");
      })
      .finally(() => {
        if (refreshInFlightRef.current === operation) refreshInFlightRef.current = null;
      });
    refreshInFlightRef.current = operation;
    return operation;
  }, []);

  useEffect(() => {
    setLastRefreshedAt(new Date().toISOString());
    let intervalId: number | null = null;
    const stopInterval = () => {
      if (intervalId !== null) window.clearInterval(intervalId);
      intervalId = null;
    };
    const startInterval = () => {
      stopInterval();
      if (document.visibilityState !== "visible") {
        setRefreshState("paused");
        return;
      }
      setRefreshState((current) => current === "error" ? "error" : "live");
      intervalId = window.setInterval(() => void refresh(), REFRESH_INTERVAL_MS);
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void refresh();
      }
      startInterval();
    };
    startInterval();
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      stopInterval();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [refresh]);

  const filteredParticipants = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase("en-US");
    return data.participants.filter((participant) => {
      if (
        normalizedSearch &&
        !participant.studentAlias.toLocaleLowerCase("en-US").includes(normalizedSearch)
      ) {
        return false;
      }
      if (sequence && participant.sequence !== sequence) return false;
      if (completion && participant.quality.completion !== completion) return false;
      if (timing && participant.quality.timing !== timing) return false;
      if (paperFocus) {
        const [paperCode, mode] = paperFocus.split("_") as ["A" | "B", "manual" | "ai"];
        const round = mode === "manual" ? participant.manual : participant.aiAssisted;
        if (round?.paperCode !== paperCode) return false;
      }
      return true;
    });
  }, [completion, data.participants, paperFocus, search, sequence, timing]);

  useEffect(() => {
    if (
      selectedParticipantId &&
      !data.participants.some(
        (participant) => participant.participantId === selectedParticipantId
      )
    ) {
      setSelectedParticipantId(null);
    }
  }, [data.participants, selectedParticipantId]);

  const selectedParticipant = selectedParticipantId
    ? data.participants.find((participant) => participant.participantId === selectedParticipantId) ?? null
    : null;

  useEffect(() => {
    const background = dashboardBackgroundRef.current;
    if (!background) return;
    if (selectedParticipant) {
      background.setAttribute("inert", "");
    } else {
      background.removeAttribute("inert");
    }
    return () => background.removeAttribute("inert");
  }, [selectedParticipant]);

  const closeDetail = useCallback(() => {
    setSelectedParticipantId(null);
    const trigger = detailReturnFocusRef.current;
    window.requestAnimationFrame(() => {
      if (trigger?.isConnected) trigger.focus();
    });
  }, []);

  return (
    <>
      <section
        ref={dashboardBackgroundRef}
        lang="en-US"
        aria-labelledby="teacher-dashboard-title"
        aria-hidden={selectedParticipant ? true : undefined}
        className="min-w-0 pb-8"
      >
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 id="teacher-dashboard-title" className="text-xl font-semibold text-ink-950 sm:text-2xl">
                Open experiment
              </h2>
              <RefreshIndicator state={refreshState} />
            </div>
            <p className="mt-1 text-sm text-ink-600">{data.experiment.name}</p>
            <p className="mt-1 text-xs leading-5 text-ink-500">
              Students join with an alias. Papers and round order are assigned automatically. Last updated {formatRefreshTime(lastRefreshedAt)}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn min-h-10 px-4" onClick={() => void refresh()}>
              Refresh
            </button>
            <a className="btn min-h-10 px-4" href="/api/teaching/admin/export">
              Export results
            </a>
            <a className="btn min-h-10 px-4" href="/api/teaching/admin/export?anonymize=1">
              Export anonymized
            </a>
          </div>
        </header>

        {error ? <div className="mt-4"><RequestError>{error}</RequestError></div> : null}

        <SummaryStrip dashboard={data} />

        <section aria-labelledby="participant-results-title" className="mt-8 border-t border-ink-200 pt-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 id="participant-results-title" className="text-lg font-semibold text-ink-950">Student progress</h3>
            <p className="text-sm text-ink-500">{filteredParticipants.length} / {data.participants.length} participants</p>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <FilterField label="Search students" htmlFor="teacher-search">
              <input
                id="teacher-search"
                className="min-h-11 w-full rounded-[8px] border border-ink-200 bg-white px-3 text-sm text-ink-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Name or student ID"
              />
            </FilterField>
            <FilterField label="Completion status" htmlFor="teacher-completion">
              <select
                id="teacher-completion"
                className="min-h-11 w-full rounded-[8px] border border-ink-200 bg-white px-3 text-sm text-ink-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
                value={completion}
                onChange={(event) => setCompletion(event.target.value as CompletionFilter)}
              >
                <option value="">All students</option>
                <option value="completed">Completed</option>
                <option value="incomplete">In progress</option>
              </select>
            </FilterField>
          </div>

          <details className="mt-3 rounded-[8px] border border-ink-200 bg-white">
            <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-ink-700">More filters</summary>
            <div className="grid gap-3 border-t border-ink-100 px-4 py-4 sm:grid-cols-3">
              <FilterField label="Paper and mode" htmlFor="teacher-paper-focus">
                <select id="teacher-paper-focus" className="min-h-11 w-full rounded-[8px] border border-ink-200 bg-white px-3 text-sm" value={paperFocus} onChange={(event) => setPaperFocus(event.target.value as PaperFocus)}>
                  <option value="">All</option>
                  <option value="A_manual">A · Manual</option>
                  <option value="A_ai">A · AI</option>
                  <option value="B_manual">B · Manual</option>
                  <option value="B_ai">B · AI</option>
                </select>
              </FilterField>
              <FilterField label="Experiment sequence" htmlFor="teacher-sequence">
                <select id="teacher-sequence" className="min-h-11 w-full rounded-[8px] border border-ink-200 bg-white px-3 text-sm" value={sequence} onChange={(event) => setSequence(event.target.value)}>
                  <option value="">All</option>
                  <option value="manual_then_ai">Manual→AI</option>
                  <option value="ai_then_manual">AI→Manual</option>
                </select>
              </FilterField>
              <FilterField label="Timing quality" htmlFor="teacher-timing">
                <select id="teacher-timing" className="min-h-11 w-full rounded-[8px] border border-ink-200 bg-white px-3 text-sm" value={timing} onChange={(event) => setTiming(event.target.value)}>
                  <option value="">All</option>
                  {Object.entries(TIMING_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </FilterField>
            </div>
          </details>

          <div className="mt-4 max-w-full overflow-x-auto rounded-[10px] border border-ink-200 bg-white">
            <table className="w-full min-w-[52rem] border-collapse text-left text-sm">
              <caption className="sr-only">Participant results</caption>
              <thead className="bg-ink-50 text-xs text-ink-600">
                <tr>
                  {[
                    "Student",
                    "Status",
                    "Experiment order",
                    "Manual results",
                    "AI Results",
                    "Accuracy change",
                    "Actions",
                  ].map((label) => <th key={label} scope="col" className="whitespace-nowrap border-b border-ink-200 px-4 py-3 font-semibold">{label}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {filteredParticipants.map((participant) => (
                  <ParticipantRow
                    key={participant.participantId}
                    participant={participant}
                    onOpen={(trigger) => {
                      detailReturnFocusRef.current = trigger;
                      setSelectedParticipantId(participant.participantId);
                    }}
                  />
                ))}
                {filteredParticipants.length === 0 ? (
                  <tr><td colSpan={7} className="px-4 py-12 text-center text-sm text-ink-500">No students match these filters.</td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>

        <details className="mt-8 border-t border-ink-200 pt-5">
          <summary className="cursor-pointer text-base font-semibold text-ink-800">Advanced statistical analysis</summary>
          <p className="mt-1 text-sm text-ink-500">Detailed mode comparisons, Wilcoxon tests, AI usage, and experiment quality diagnostics.</p>
          <ModeComparisonFigure dashboard={data} />
          <AiBehaviorSection dashboard={data} />
          <DiagnosticsSection dashboard={data} />
        </details>
      </section>
      {selectedParticipant ? (
        <TeacherParticipantDetail
          participant={selectedParticipant}
          papers={data.experiment.papers}
          onClose={closeDetail}
        />
      ) : null}
    </>
  );
}

function RefreshIndicator({ state }: { state: RefreshState }) {
  const content = state === "refreshing"
    ? "Syncing"
    : state === "paused"
      ? "Page hidden · Paused"
      : state === "error"
        ? "Sync retry pending"
        : "Auto-refresh · Every 30 seconds";
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-brand-200 bg-brand-50 px-2 py-1 text-[10px] font-semibold text-brand-800">
      <span className="h-1.5 w-1.5 rounded-full bg-brand-600" aria-hidden="true" />
      {content}
    </span>
  );
}

function SummaryStrip({ dashboard }: { dashboard: TeachingExperimentDashboard }) {
  const { completion, manual, aiAssisted } = dashboard.summary;
  return (
    <section aria-labelledby="summary-title" className="mt-6">
      <h3 id="summary-title" className="sr-only">Experiment summary</h3>
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[10px] border border-ink-200 bg-ink-200 xl:grid-cols-4">
        <SummaryCell label="Completion progress">
          <strong className="font-mono text-2xl text-ink-950">{completion.completed} / 30</strong>
          <span>Joined {completion.total} participants · Eligible {completion.paired} participants</span>
        </SummaryCell>
        <SummaryCell label="Median time · Manual → AI">
          <strong className="font-mono text-xl text-ink-950">
            {formatDuration(manual.medianActiveSeconds)} <span className="text-sm font-normal text-ink-400">→</span>{" "}
            <span className="text-brand-800">{formatDuration(aiAssisted.medianActiveSeconds)}</span>
          </strong>
          <span>AI Saved {formatPercent(dashboard.summary.timeSavedRate)}</span>
        </SummaryCell>
        <SummaryCell label="Median correct answers · Manual → AI">
          <strong className="font-mono text-xl text-ink-950">
            {formatCorrectFraction(manual.medianAccuracy, manual.n)} <span className="text-sm font-normal text-ink-400">→</span>{" "}
            <span className="text-brand-800">{formatCorrectFraction(aiAssisted.medianAccuracy, aiAssisted.n)}</span>
          </strong>
          <span>Accuracy {formatPercent(manual.medianAccuracy)} → {formatPercent(aiAssisted.medianAccuracy)}</span>
        </SummaryCell>
        <SummaryCell label="Evidence accuracy · Manual → AI">
          <strong className="font-mono text-lg text-ink-950">
            {formatPercent(manual.medianEvidenceAccuracy)} <span className="text-sm font-normal text-ink-400">→</span>{" "}
            <span className="text-brand-800">{formatPercent(aiAssisted.medianEvidenceAccuracy)}</span>
          </strong>
          <span>Evidence coverage {formatPercent(manual.medianEvidenceCoverage)} → {formatPercent(aiAssisted.medianEvidenceCoverage)}</span>
        </SummaryCell>
      </div>
    </section>
  );
}

function SummaryCell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-28 flex-col justify-between bg-white px-4 py-4">
      <span className="text-xs font-semibold text-ink-500">{label}</span>
      <div className="mt-3 flex flex-col gap-1 text-xs leading-5 text-ink-500">{children}</div>
    </div>
  );
}

function ModeComparisonFigure({ dashboard }: { dashboard: TeachingExperimentDashboard }) {
  const { manual, aiAssisted, timeDifference, accuracyDifference } = dashboard.summary;
  const enough = manual.n > 0 && aiAssisted.n > 0;
  const ariaLabel = enough
    ? `AI assisted versus manual: median active time ${formatSecondsLabel(aiAssisted.medianActiveSeconds)} versus ${formatSecondsLabel(manual.medianActiveSeconds)}, value accuracy: ${formatPercent(aiAssisted.medianAccuracy)} versus ${formatPercent(manual.medianAccuracy)}.`
    : "AI assisted versus manual: insufficient time and accuracy data.";
  return (
    <section aria-labelledby="mode-comparison-title" className="mt-10 border-t border-ink-300 pt-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="label-eyebrow">Primary question</p>
          <h2 id="mode-comparison-title" className="mt-1 font-serif text-2xl font-semibold text-ink-950">
            Does AI reduce active time while maintaining or improving accuracy?
          </h2>
        </div>
        <p className="max-w-xl text-right text-sm text-ink-600">
          {enough
            ? `AI median active time saved ${formatPercent(dashboard.summary.timeSavedRate)}, Paired value accuracy change ${formatSignedPercentagePoints(dashboard.summary.accuracyDelta)}.`
            : "Insufficient data: at least one eligible paired participant is required."}
        </p>
      </div>

      <div role="img" aria-label={ariaLabel} className="mt-5 grid gap-6 lg:grid-cols-2">
        <ComparisonPanel
          title="Active time (seconds)"
          manual={manual.medianActiveSeconds}
          assisted={aiAssisted.medianActiveSeconds}
          maximum={maxScale(manual.medianActiveSeconds, aiAssisted.medianActiveSeconds, 1)}
          format={formatSecondsLabel}
          insufficient={!enough}
        />
        <ComparisonPanel
          title="Value accuracy"
          manual={manual.medianAccuracy}
          assisted={aiAssisted.medianAccuracy}
          maximum={1}
          format={formatPercent}
          insufficient={!enough}
        />
      </div>

      <div className="mt-5 max-w-full overflow-x-auto">
        <table className="w-full min-w-[52rem] border-collapse text-left text-xs">
          <caption className="border-y border-ink-200 px-3 py-2 text-left font-semibold text-ink-800">
            Mode comparison details · Primary analysis pairs n={dashboard.summary.completion.paired}
          </caption>
          <thead className="text-ink-600">
            <tr>
              {["Metric", "Manual mode", "AI assisted", "AI−manual paired median difference", "95% CI", "Wilcoxon p"].map((label) => (
                <th key={label} scope="col" className="border-b border-ink-200 px-3 py-2 font-semibold">{label}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100 bg-white">
            <tr>
              <th scope="row" className="px-3 py-3 font-semibold text-ink-900">Active time</th>
              <td className="px-3 py-3 font-mono">{formatSecondsLabel(manual.medianActiveSeconds)}</td>
              <td className="px-3 py-3 font-mono text-brand-800">{formatSecondsLabel(aiAssisted.medianActiveSeconds)}</td>
              <td className="px-3 py-3 font-mono">{formatSignedSeconds(timeDifference.median)}</td>
              <td className="px-3 py-3 font-mono">{formatSecondsCi(timeDifference.ci95)}</td>
              <td className="px-3 py-3 font-mono">{formatPValue(timeDifference.wilcoxonP)}</td>
            </tr>
            <tr>
              <th scope="row" className="px-3 py-3 font-semibold text-ink-900">Value accuracy</th>
              <td className="px-3 py-3 font-mono">{formatPercent(manual.medianAccuracy)}</td>
              <td className="px-3 py-3 font-mono text-brand-800">{formatPercent(aiAssisted.medianAccuracy)}</td>
              <td className="px-3 py-3 font-mono">{formatSignedPercentagePoints(accuracyDifference.median)}</td>
              <td className="px-3 py-3 font-mono">{formatPercentagePointCi(accuracyDifference.ci95)}</td>
              <td className="px-3 py-3 font-mono">{formatPValue(accuracyDifference.wilcoxonP)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-ink-500">
        Intervals show the 95% bootstrap CI for paired median differences. P-values use the two-sided Wilcoxon signed-rank approximation. Version {dashboard.experiment.version} / {dashboard.experiment.scoringVersion}.
      </p>
    </section>
  );
}

function ComparisonPanel({
  title,
  manual,
  assisted,
  maximum,
  format,
  insufficient,
}: {
  title: string;
  manual: number | null;
  assisted: number | null;
  maximum: number;
  format: (value: number | null) => string;
  insufficient: boolean;
}) {
  return (
    <div className="min-w-0 border-y border-ink-200 py-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-ink-900">{title}</h3>
        <span className="font-mono text-[10px] text-ink-500">Zero baseline · 0—{format(maximum)}</span>
      </div>
      {insufficient ? (
        <div className="mt-5 border-l-2 border-ink-300 py-5 pl-4 text-sm text-ink-500">— · Insufficient data</div>
      ) : (
        <div className="mt-5 space-y-4">
          <ComparisonBar label="Manual mode · Outline" value={manual} maximum={maximum} format={format} variant="manual" />
          <ComparisonBar label="AI assisted · Filled" value={assisted} maximum={maximum} format={format} variant="ai" />
        </div>
      )}
    </div>
  );
}

function ComparisonBar({
  label,
  value,
  maximum,
  format,
  variant,
}: {
  label: string;
  value: number | null;
  maximum: number;
  format: (value: number | null) => string;
  variant: "manual" | "ai";
}) {
  const width = value === null || maximum <= 0 ? 0 : Math.max(0, Math.min(100, value / maximum * 100));
  return (
    <div className="grid grid-cols-[7.5rem_minmax(0,1fr)_4.75rem] items-center gap-2 text-xs">
      <span className="font-semibold text-ink-700">{label}</span>
      <span className="relative h-7 overflow-hidden border-y border-ink-200 bg-ink-50">
        <span
          aria-hidden="true"
          className={variant === "manual"
            ? "block h-full border-2 border-dashed border-ink-600 bg-white"
            : "block h-full border-y-2 border-brand-800 bg-brand-600"}
          style={{ width: `${width}%` }}
        />
      </span>
      <strong className="text-right font-mono text-ink-900">{format(value)}</strong>
    </div>
  );
}

function AiBehaviorSection({ dashboard }: { dashboard: TeachingExperimentDashboard }) {
  const behavior = dashboard.summary.aiBehavior;
  const n = dashboard.summary.aiAssisted.n;
  const tiles = [
    { label: "Suggestions", value: behavior.suggested, context: `AI Suggestions with values · n=${n}` },
    { label: "Adopted", value: behavior.adopted, context: rateContext(behavior.adopted, behavior.suggested) },
    { label: "Modified", value: behavior.modified, context: rateContext(behavior.modified, behavior.suggested) },
    { label: "Initially incorrect", value: behavior.initiallyIncorrect, context: rateContext(behavior.initiallyIncorrect, behavior.suggested) },
    { label: "Corrected", value: behavior.corrected, context: rateContext(behavior.corrected, behavior.initiallyIncorrect) },
    { label: "Incorrectly adopted", value: behavior.incorrectlyAdopted, context: rateContext(behavior.incorrectlyAdopted, behavior.initiallyIncorrect) },
  ];
  return (
    <section aria-labelledby="ai-behavior-title" className="mt-10 border-t border-ink-300 pt-6">
      <p className="label-eyebrow">AI behavior audit</p>
      <h2 id="ai-behavior-title" className="mt-1 font-serif text-2xl font-semibold text-ink-950">AI How suggestions were used</h2>
      <div className="mt-4 grid gap-px overflow-hidden rounded-[10px] border border-ink-200 bg-ink-200 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {tiles.map((tile) => (
          <div key={tile.label} className="min-h-28 bg-white px-4 py-4">
            <span className="label-eyebrow">{tile.label}</span>
            <strong className="mt-3 block font-mono text-2xl text-ink-950">{tile.value}</strong>
            <span className="mt-1 block text-xs leading-5 text-ink-500">{n === 0 ? "— · Insufficient data" : tile.context}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function DiagnosticsSection({ dashboard }: { dashboard: TeachingExperimentDashboard }) {
  const { diagnostics } = dashboard;
  return (
    <section aria-labelledby="diagnostics-title" className="mt-10 border-t border-ink-300 pt-6">
      <p className="label-eyebrow">Balance & quality checks</p>
      <h2 id="diagnostics-title" className="mt-1 font-serif text-2xl font-semibold text-ink-950">Design balance and timing diagnostics</h2>
      <div className="mt-4 grid gap-7 xl:grid-cols-[1.2fr_1fr_0.7fr]">
        <DiagnosticTable title="By paper and mode" caption="Paper A/B Primary analysis sample">
          <thead>
            <tr>
              {['Condition', 'n', 'Median time', 'Median accuracy'].map((label) => <th key={label} scope="col" className="px-2 py-2 font-semibold">{label}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100 bg-white">
            {(["A", "B"] as const).flatMap((paperCode) => ([
              { key: `${paperCode}-manual`, label: `Paper ${paperCode} · Manual`, summary: diagnostics.byPaper[paperCode].manual },
              { key: `${paperCode}-ai`, label: `Paper ${paperCode} · AI`, summary: diagnostics.byPaper[paperCode].aiAssisted },
            ])).map((row) => (
              <tr key={row.key}>
                <th scope="row" className="px-2 py-2 font-semibold text-ink-800">{row.label}</th>
                <td className="px-2 py-2 font-mono">{row.summary.n}</td>
                <td className="px-2 py-2 font-mono">{formatDuration(row.summary.medianActiveSeconds)}</td>
                <td className="px-2 py-2 font-mono">{formatPercent(row.summary.medianAccuracy)}</td>
              </tr>
            ))}
          </tbody>
        </DiagnosticTable>

        <DiagnosticTable title="By experiment sequence" caption="Sequence completion and pairing">
          <thead>
            <tr>
              {['Sequence', 'Total', 'Complete', 'Paired', 'Manual / AI Time', 'Manual / AI Accuracy'].map((label) => <th key={label} scope="col" className="px-2 py-2 font-semibold">{label}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100 bg-white">
            {(["manual_then_ai", "ai_then_manual"] as const).map((sequence) => {
              const item = diagnostics.bySequence[sequence];
              return (
                <tr key={sequence}>
                  <th scope="row" className="px-2 py-2 font-semibold text-ink-800">{SEQUENCE_LABELS[sequence]}</th>
                  <td className="px-2 py-2 font-mono">{item.total}</td>
                  <td className="px-2 py-2 font-mono">{item.completed}</td>
                  <td className="px-2 py-2 font-mono">{item.paired}</td>
                  <td className="whitespace-nowrap px-2 py-2 font-mono">{formatDuration(item.manual.medianActiveSeconds)} / {formatDuration(item.aiAssisted.medianActiveSeconds)}</td>
                  <td className="whitespace-nowrap px-2 py-2 font-mono">{formatPercent(item.manual.medianAccuracy)} / {formatPercent(item.aiAssisted.medianAccuracy)}</td>
                </tr>
              );
            })}
          </tbody>
        </DiagnosticTable>

        <DiagnosticTable title="Timing quality" caption="Timing categories for all participants">
          <thead>
            <tr><th scope="col" className="px-2 py-2 font-semibold">Category</th><th scope="col" className="px-2 py-2 font-semibold">Participants</th></tr>
          </thead>
          <tbody className="divide-y divide-ink-100 bg-white">
            {(Object.keys(TIMING_LABELS) as TeachingParticipantTimingStatus[]).map((status) => (
              <tr key={status}>
                <th scope="row" className="px-2 py-2 font-semibold text-ink-800">{TIMING_LABELS[status]}</th>
                <td className="px-2 py-2 font-mono">{diagnostics.timingQuality[status]}</td>
              </tr>
            ))}
          </tbody>
        </DiagnosticTable>
      </div>
    </section>
  );
}

function DiagnosticTable({
  title,
  caption,
  children,
}: {
  title: string;
  caption: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <h3 className="text-sm font-semibold text-ink-900">{title}</h3>
      <div className="mt-2 max-w-full overflow-x-auto border-y border-ink-200">
        <table className="w-full min-w-max border-collapse text-left text-xs">
          <caption className="sr-only">{caption}</caption>
          {children}
        </table>
      </div>
    </div>
  );
}

function ParticipantRow({
  participant,
  onOpen,
}: {
  participant: TeachingDashboardParticipant;
  onOpen: (trigger: HTMLButtonElement) => void;
}) {
  return (
    <tr className="hover:bg-brand-50/40">
      <th scope="row" className="whitespace-nowrap px-4 py-3 font-mono font-semibold text-ink-950">{participant.studentAlias}</th>
      <td className="whitespace-nowrap px-4 py-3">
        <span className="font-medium text-ink-900">{participant.quality.completion === "completed" ? "Completed" : "In progress"}</span>
        {participant.quality.excluded ? <span className="ml-2 text-xs text-red-600">Excluded</span> : null}
      </td>
      <td className="whitespace-nowrap px-4 py-3 text-xs text-ink-600">{SEQUENCE_LABELS[participant.sequence]}</td>
      <RoundSummary round={participant.manual} />
      <RoundSummary round={participant.aiAssisted} />
      <td className="whitespace-nowrap px-4 py-3 font-mono text-xs">{formatSignedPercentagePoints(participant.accuracyDifference)}</td>
      <td className="px-4 py-2">
        <button
          type="button"
          className="btn min-h-10 whitespace-nowrap px-4"
          aria-label={`View student ${participant.studentAlias}  results`}
          onClick={(event) => onOpen(event.currentTarget)}
        >
          View
        </button>
      </td>
    </tr>
  );
}

function participantAnalysisStatus(participant: TeachingDashboardParticipant): string {
  if (participant.quality.excluded) return "Excluded";
  return participant.quality.paired ? "Included" : "Unpaired";
}

function RoundSummary({ round }: { round: TeachingTeacherRound | null }) {
  return round ? (
    <td className="whitespace-nowrap px-4 py-3 font-mono text-xs">
      {round.paperCode} · {round.score.valueCorrect}/{TEACHING_FIELDS.length} · {formatDuration(round.activeSeconds)}
    </td>
  ) : (
    <td className="px-4 py-3 text-ink-400">—</td>
  );
}

export function TeacherParticipantDetail({
  participant,
  papers,
  onClose,
}: {
  participant: TeachingDashboardParticipant;
  papers: TeachingSafeExperimentPaper[];
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]):not([tabindex="-1"]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      );
      const currentIndex = focusable.indexOf(document.activeElement as HTMLElement);
      const targetIndex = teachingDialogTabTarget(
        currentIndex,
        focusable.length,
        event.shiftKey
      );
      if (targetIndex === null) return;
      event.preventDefault();
      focusable[targetIndex]?.focus();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);
  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="teacher-participant-detail-title"
      className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-ink-950/35 p-2 sm:p-6"
    >
      <button type="button" tabIndex={-1} aria-label="Close participant details" className="absolute inset-0 cursor-default" onClick={onClose} />
      <article className="relative z-10 my-auto w-full max-w-6xl overflow-hidden rounded-[12px] border border-ink-200 bg-[#f8faf9] shadow-2xl">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-ink-200 bg-white px-4 py-4 sm:px-6">
          <div>
            <p className="label-eyebrow">Read-only participant record</p>
            <h2 id="teacher-participant-detail-title" className="mt-1 font-serif text-2xl font-semibold text-ink-950">
              {participant.studentAlias} · Automatic scores for both rounds
            </h2>
            <p className="mt-1 text-xs text-ink-500">{SEQUENCE_LABELS[participant.sequence]} · {TIMING_LABELS[participant.quality.timing]} · {participantAnalysisStatus(participant)} · Read-only</p>
          </div>
          <button ref={closeRef} type="button" className="btn min-h-11" onClick={onClose}>Close</button>
        </header>
        <div className="max-h-[calc(100vh-8rem)] overflow-y-auto px-4 py-5 sm:px-6">
          <dl className="mb-6 grid gap-px overflow-hidden rounded-[9px] border border-ink-200 bg-ink-200 text-xs sm:grid-cols-2 lg:grid-cols-5">
            <QualityValue label="Completion status" value={participant.quality.completion === "completed" ? "Completed" : "Incomplete"} />
            <QualityValue label="Timing quality" value={TIMING_LABELS[participant.quality.timing]} />
            <QualityValue label="Exclusion status" value={participant.quality.excluded ? "Excluded" : "Not excluded"} />
            <QualityValue label="Primary analysis pairing" value={participant.quality.paired ? "Included" : "Not included"} />
            <QualityValue label="Exclusion reason" value={participant.exclusionReason || "—"} />
          </dl>
          <div className="grid gap-8 xl:grid-cols-2">
            <RoundDetail round={participant.manual} papers={papers} title="Manual mode" />
            <RoundDetail round={participant.aiAssisted} papers={papers} title="AI assisted" />
          </div>
        </div>
      </article>
    </div>
  );
}

function QualityValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 bg-white px-3 py-3">
      <dt className="font-semibold text-ink-500">{label}</dt>
      <dd className="mt-1 break-words font-mono text-ink-900">{value}</dd>
    </div>
  );
}

function RoundDetail({
  round,
  papers,
  title,
}: {
  round: TeachingTeacherRound | null;
  papers: TeachingSafeExperimentPaper[];
  title: string;
}) {
  if (!round) {
    return (
      <section>
        <h3 className="font-serif text-xl font-semibold text-ink-950">{title}</h3>
        <p className="mt-3 border-y border-ink-200 py-8 text-sm text-ink-500">— · No scores available for this round</p>
      </section>
    );
  }
  const paper = papers.find((candidate) => candidate.code === round.paperCode);
  return (
    <section aria-labelledby={`round-${round.submissionId}`} className="min-w-0">
      <div className="border-b-2 border-ink-800 pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 id={`round-${round.submissionId}`} className="font-serif text-xl font-semibold text-ink-950">{title} · Paper {round.paperCode}</h3>
          <span className="font-mono text-xs text-ink-600">{round.score.valueCorrect}/{TEACHING_FIELDS.length}</span>
        </div>
        <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 font-mono text-xs text-ink-600">
          <span>Active time {formatSecondsLabel(round.activeSeconds)} ({formatDuration(round.activeSeconds)})</span>
          <span>Elapsed time {formatSecondsLabel(round.wallSeconds)} ({formatDuration(round.wallSeconds)})</span>
          <span>Timing quality {TIMING_LABELS[round.timingQuality]}</span>
        </p>
        <p className="mt-1 truncate text-xs text-ink-500">{paper?.title ?? "Paper information unavailable"}</p>
      </div>
      <div className="divide-y divide-ink-200">
        {TEACHING_FIELDS.map((field) => {
          const answer = round.finalAnswers[field.key];
          const initial = round.mode === "ai_assisted" ? round.aiInitial[field.key] : undefined;
          const valueScore = round.score.values[field.key];
          const evidenceScore = round.score.evidence[field.key];
          return (
            <article key={field.key} className="py-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h4 className="text-sm font-semibold text-ink-950">{field.label}</h4>
                <span className="font-mono text-[10px] uppercase tracking-wider text-ink-500">field {field.key}</span>
              </div>
              <dl className="mt-3 grid gap-3 text-xs sm:grid-cols-2">
                <DetailValue label="Final answer" value={answer?.value} />
                <DetailValue label="Page" value={answer?.page} />
                <div className="sm:col-span-2">
                  <DetailValue label="Evidence excerpt" value={answer?.evidence} />
                </div>
                <ScoreDetail label="Value assessment" correct={valueScore.correct} reason={valueScore.reason} />
                <ScoreDetail label="Evidence assessment" correct={evidenceScore.correct} reason={evidenceScore.reason} />
              </dl>
              {round.mode === "ai_assisted" ? (
                <div className="mt-3 border-l-2 border-brand-500 bg-brand-50/60 px-3 py-3 text-xs text-ink-700">
                  <strong className="text-brand-900">AI Initial suggestion</strong>
                  <p className="mt-1 break-words">{initial?.value || "—"}</p>
                  <p className="mt-1 text-ink-500">Page {initial?.page || "—"} · {initial?.evidence || "No initial evidence"}</p>
                </div>
              ) : null}
              {round.review ? (
                <p className="mt-2 text-[11px] text-ink-500">
                  Previous instructor review: final value {reviewScoreLabel(round.review.finalValueScores[field.key])}; AI Initial value {reviewScoreLabel(round.review.aiInitialValueScores[field.key])} · {formatDateTime(round.review.reviewedAt)}
                </p>
              ) : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}

function DetailValue({ label, value }: { label: string; value: string | undefined }) {
  return (
    <div>
      <dt className="font-semibold text-ink-500">{label}</dt>
      <dd className="mt-1 break-words font-mono leading-5 text-ink-900">{value || "—"}</dd>
    </div>
  );
}

function ScoreDetail({ label, correct, reason }: { label: string; correct: boolean; reason: string }) {
  return (
    <div>
      <dt className="font-semibold text-ink-500">{label}</dt>
      <dd className="mt-1 flex flex-wrap items-center gap-2">
        <span className={correct
          ? "border-b-2 border-brand-600 font-semibold text-brand-800"
          : "border-b-2 border-ink-500 font-semibold text-ink-800"}
        >
          {correct ? "Correct" : "Incorrect"}
        </span>
        <code className="break-all text-[10px] text-ink-500">{reason}</code>
      </dd>
    </div>
  );
}

function FilterField({ label, htmlFor, children }: { label: string; htmlFor: string; children: React.ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="block min-w-0 text-xs font-semibold text-ink-700">
      <span className="mb-1.5 block">{label}</span>
      {children}
    </label>
  );
}

function maxScale(left: number | null, right: number | null, fallback: number): number {
  const maximum = Math.max(left ?? 0, right ?? 0);
  return maximum > 0 ? maximum : fallback;
}

function formatDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return "—";
  const rounded = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(rounded / 60);
  const remainder = rounded % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

function formatSecondsLabel(seconds: number | null): string {
  return seconds === null || !Number.isFinite(seconds)
    ? "—"
    : `${formatNumber(seconds)} s`;
}

function formatPercent(value: number | null): string {
  return value === null || !Number.isFinite(value) ? "—" : `${(value * 100).toFixed(1)}%`;
}

function formatCorrectFraction(value: number | null, n: number): string {
  if (n === 0 || value === null || !Number.isFinite(value)) return "—";
  return `${formatNumber(value * TEACHING_FIELDS.length)}/${TEACHING_FIELDS.length}`;
}

function formatSignedSeconds(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return `${value > 0 ? "+" : ""}${formatNumber(value)} s`;
}

function formatSignedPercentagePoints(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  const points = value * 100;
  return `${points > 0 ? "+" : ""}${points.toFixed(1)} percentage points`;
}

function formatSecondsCi(ci: { low: number; high: number } | null): string {
  return ci ? `[${formatSignedSeconds(ci.low)}, ${formatSignedSeconds(ci.high)}]` : "—";
}

function formatPercentagePointCi(ci: { low: number; high: number } | null): string {
  return ci ? `[${formatSignedPercentagePoints(ci.low)}, ${formatSignedPercentagePoints(ci.high)}]` : "—";
}

function formatPValue(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return value < 0.001 ? "<0.001" : value.toFixed(3);
}

function formatNumber(value: number): string {
  return Number.isInteger(value)
    ? value.toLocaleString("en-US")
    : value.toLocaleString("en-US", { maximumFractionDigits: 1 });
}

function rateContext(numerator: number, denominator: number): string {
  return denominator === 0 ? "— · Insufficient data" : `${numerator} / ${denominator} · ${formatPercent(numerator / denominator)}`;
}

function formatRefreshTime(value: string | null): string {
  return value ? formatDateTime(value) : "At page load";
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

function reviewScoreLabel(score: TeachingScore | undefined): string {
  if (score === "correct") return "Correct";
  if (score === "incorrect") return "Incorrect";
  if (score === "pending") return "Pending";
  return "Not recorded";
}
