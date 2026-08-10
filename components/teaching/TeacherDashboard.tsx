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
  manual_then_ai: "人工→AI",
  ai_then_manual: "AI→人工",
} as const;

const TIMING_LABELS: Record<TeachingParticipantTimingStatus, string> = {
  valid: "有效",
  zero_active: "零有效时间",
  excessive_idle: "空闲过多",
  unavailable: "不可用",
};

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

  const refresh = useCallback((): Promise<void> => {
    if (refreshInFlightRef.current) return refreshInFlightRef.current;
    setRefreshState("refreshing");
    const operation = requestJson<TeachingExperimentDashboard>(
      "/api/teaching/admin",
      { cache: "no-store" },
      "刷新实验数据失败"
    )
      .then((next) => {
        setData(next);
        setLastRefreshedAt(new Date().toISOString());
        setError("");
        setRefreshState(document.visibilityState === "visible" ? "live" : "paused");
      })
      .catch((cause) => {
        setError(requestErrorMessage(cause, "刷新实验数据失败，请稍后重试。"));
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
    const normalizedSearch = search.trim().toLocaleLowerCase("zh-CN");
    return data.participants.filter((participant) => {
      if (
        normalizedSearch &&
        !participant.studentAlias.toLocaleLowerCase("zh-CN").includes(normalizedSearch)
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
  const closeDetail = useCallback(() => setSelectedParticipantId(null), []);

  return (
    <section lang="zh-CN" aria-labelledby="teacher-dashboard-title" className="min-w-0 pb-10">
      <header className="border-b border-ink-300 pb-5">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="label-eyebrow text-brand-700">Live experiment console</span>
              <RefreshIndicator state={refreshState} />
            </div>
            <h1
              id="teacher-dashboard-title"
              className="mt-2 max-w-4xl font-serif text-3xl font-semibold tracking-tight text-ink-950 sm:text-4xl"
            >
              {data.experiment.name}
            </h1>
            <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-xs text-ink-600">
              <span>实验版本 {data.experiment.version}</span>
              <span>评分版本 {data.experiment.scoringVersion}</span>
              <span>计划样本 30 人 · 双轮交叉</span>
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <a className="btn min-h-11" href="/api/teaching/admin/export">
              导出 CSV
            </a>
            <a className="btn min-h-11" href="/api/teaching/admin/export?anonymize=1">
              匿名 CSV
            </a>
            <button
              type="button"
              className="btn min-h-11"
              onClick={async () => {
                await fetch("/api/teaching/session", { method: "DELETE" });
                window.location.assign("/teaching");
              }}
            >
              退出
            </button>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-dashed border-ink-200 pt-3 text-xs text-ink-500">
          <span>无需设置：学生进入后自动均衡分配 A/B 文献与人工/AI 顺序。</span>
          <span className="font-mono">上次更新：{formatRefreshTime(lastRefreshedAt)}</span>
        </div>
      </header>

      {error ? <div className="mt-4"><RequestError>{error}</RequestError></div> : null}

      <SummaryStrip dashboard={data} />
      <ModeComparisonFigure dashboard={data} />
      <AiBehaviorSection dashboard={data} />
      <DiagnosticsSection dashboard={data} />

      <section aria-labelledby="participant-results-title" className="mt-10 border-t border-ink-300 pt-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="label-eyebrow">Participant ledger</p>
            <h2 id="participant-results-title" className="mt-1 font-serif text-2xl font-semibold text-ink-950">
              参与者结果
            </h2>
          </div>
          <p className="font-mono text-xs text-ink-500">
            显示 {filteredParticipants.length} / {data.participants.length} 人
          </p>
        </div>

        <div className="mt-4 grid gap-3 border-y border-ink-200 bg-white/70 px-3 py-4 sm:grid-cols-2 lg:grid-cols-5">
          <FilterField label="学生搜索" htmlFor="teacher-search">
            <input
              id="teacher-search"
              className="min-h-11 w-full rounded-[8px] border border-ink-200 bg-white px-3 text-sm text-ink-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="输入学生标识"
            />
          </FilterField>
          <FilterField label="文献聚焦" htmlFor="teacher-paper-focus">
            <select
              id="teacher-paper-focus"
              className="min-h-11 w-full rounded-[8px] border border-ink-200 bg-white px-3 text-sm text-ink-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
              value={paperFocus}
              onChange={(event) => setPaperFocus(event.target.value as PaperFocus)}
            >
              <option value="">全部文献与模式</option>
              <option value="A_manual">A · 人工</option>
              <option value="A_ai">A · AI</option>
              <option value="B_manual">B · 人工</option>
              <option value="B_ai">B · AI</option>
            </select>
          </FilterField>
          <FilterField label="实验序列" htmlFor="teacher-sequence">
            <select
              id="teacher-sequence"
              className="min-h-11 w-full rounded-[8px] border border-ink-200 bg-white px-3 text-sm text-ink-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
              value={sequence}
              onChange={(event) => setSequence(event.target.value)}
            >
              <option value="">全部序列</option>
              <option value="manual_then_ai">人工→AI</option>
              <option value="ai_then_manual">AI→人工</option>
            </select>
          </FilterField>
          <FilterField label="完成状态" htmlFor="teacher-completion">
            <select
              id="teacher-completion"
              className="min-h-11 w-full rounded-[8px] border border-ink-200 bg-white px-3 text-sm text-ink-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
              value={completion}
              onChange={(event) => setCompletion(event.target.value as CompletionFilter)}
            >
              <option value="">全部状态</option>
              <option value="completed">已完成</option>
              <option value="incomplete">未完成</option>
            </select>
          </FilterField>
          <FilterField label="计时质量" htmlFor="teacher-timing">
            <select
              id="teacher-timing"
              className="min-h-11 w-full rounded-[8px] border border-ink-200 bg-white px-3 text-sm text-ink-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
              value={timing}
              onChange={(event) => setTiming(event.target.value)}
            >
              <option value="">全部计时质量</option>
              {Object.entries(TIMING_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </FilterField>
        </div>

        <div className="mt-4 max-w-full overflow-x-auto border-y border-ink-200 bg-white">
          <table className="w-full min-w-[70rem] border-collapse text-left text-xs">
            <caption className="border-b border-ink-200 px-4 py-3 text-left text-sm font-semibold text-ink-800">
              参与者结果 · 自动评分只读明细
            </caption>
            <thead className="bg-ink-50 text-ink-600">
              <tr>
                {[
                  "学生标识",
                  "序列",
                  "完成",
                  "计时质量",
                  "人工文献",
                  "人工有效时间",
                  "人工正确数",
                  "AI 文献",
                  "AI 有效时间",
                  "AI 正确数",
                  "时间差",
                  "准确率差",
                  "详情",
                ].map((label) => (
                  <th key={label} scope="col" className="whitespace-nowrap border-b border-ink-200 px-3 py-3 font-semibold">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {filteredParticipants.map((participant) => (
                <ParticipantRow
                  key={participant.participantId}
                  participant={participant}
                  onOpen={() => setSelectedParticipantId(participant.participantId)}
                />
              ))}
              {filteredParticipants.length === 0 ? (
                <tr>
                  <td colSpan={13} className="px-4 py-12 text-center text-sm text-ink-500">
                    当前筛选条件下没有参与者。
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      {selectedParticipant ? (
        <TeacherParticipantDetail
          participant={selectedParticipant}
          papers={data.experiment.papers}
          onClose={closeDetail}
        />
      ) : null}
    </section>
  );
}

function RefreshIndicator({ state }: { state: RefreshState }) {
  const content = state === "refreshing"
    ? "正在同步"
    : state === "paused"
      ? "页面隐藏 · 已暂停"
      : state === "error"
        ? "同步待重试"
        : "自动刷新 · 每 30 秒";
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
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="label-eyebrow">Primary readout</p>
          <h2 id="summary-title" className="sr-only">实验摘要</h2>
        </div>
        <p className="text-xs text-ink-500">主分析仅纳入完成双轮、评分链路有效且计时有效的配对样本。</p>
      </div>
      <div className="mt-2 grid gap-px overflow-hidden rounded-[10px] border border-ink-200 bg-ink-200 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCell label="完成 / 计划">
          <strong className="font-mono text-2xl text-ink-950">{completion.completed} / 30</strong>
          <span>已进入系统 {completion.total} 人 · 配对 {completion.paired} 人 · 排除 {completion.excluded} 人</span>
        </SummaryCell>
        <SummaryCell label="中位有效时间">
          <strong className="font-mono text-xl text-ink-950">
            {formatDuration(manual.medianActiveSeconds)} <span className="text-sm font-normal text-ink-400">→</span>{" "}
            <span className="text-brand-800">{formatDuration(aiAssisted.medianActiveSeconds)}</span>
          </strong>
          <span>人工 vs AI · n={manual.n}；节省 {formatPercent(dashboard.summary.timeSavedRate)}</span>
        </SummaryCell>
        <SummaryCell label="中位值准确率">
          <strong className="font-mono text-xl text-ink-950">
            {formatCorrectFraction(manual.medianAccuracy, manual.n)} <span className="text-sm font-normal text-ink-400">→</span>{" "}
            <span className="text-brand-800">{formatCorrectFraction(aiAssisted.medianAccuracy, aiAssisted.n)}</span>
          </strong>
          <span>人工 {formatPercent(manual.medianAccuracy)} · AI {formatPercent(aiAssisted.medianAccuracy)} · 配对差 {formatSignedPercentagePoints(dashboard.summary.accuracyDelta)}</span>
        </SummaryCell>
        <SummaryCell label="证据质量护栏">
          <strong className="font-mono text-lg text-ink-950">
            {formatPercent(manual.medianEvidenceAccuracy)} <span className="text-sm font-normal text-ink-400">→</span>{" "}
            <span className="text-brand-800">{formatPercent(aiAssisted.medianEvidenceAccuracy)}</span>
          </strong>
          <span>证据准确率（人工→AI） · 覆盖率 {formatPercent(manual.medianEvidenceCoverage)} → {formatPercent(aiAssisted.medianEvidenceCoverage)}</span>
        </SummaryCell>
      </div>
    </section>
  );
}

function SummaryCell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-32 flex-col justify-between bg-white px-4 py-4">
      <span className="label-eyebrow">{label}</span>
      <div className="mt-4 flex flex-col gap-1 text-xs leading-5 text-ink-500">{children}</div>
    </div>
  );
}

function ModeComparisonFigure({ dashboard }: { dashboard: TeachingExperimentDashboard }) {
  const { manual, aiAssisted, timeDifference, accuracyDifference } = dashboard.summary;
  const enough = manual.n > 0 && aiAssisted.n > 0;
  const ariaLabel = enough
    ? `AI 辅助与人工模式比较：有效时间中位数为 ${formatSecondsLabel(aiAssisted.medianActiveSeconds)} 对 ${formatSecondsLabel(manual.medianActiveSeconds)}，值准确率为 ${formatPercent(aiAssisted.medianAccuracy)} 对 ${formatPercent(manual.medianAccuracy)}。`
    : "AI 辅助与人工模式比较：有效时间和准确率目前样本不足。";
  return (
    <section aria-labelledby="mode-comparison-title" className="mt-10 border-t border-ink-300 pt-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="label-eyebrow">Primary question</p>
          <h2 id="mode-comparison-title" className="mt-1 font-serif text-2xl font-semibold text-ink-950">
            AI 是否缩短有效时间并保持／提高准确率？
          </h2>
        </div>
        <p className="max-w-xl text-right text-sm text-ink-600">
          {enough
            ? `AI 中位有效时间节省 ${formatPercent(dashboard.summary.timeSavedRate)}，配对值准确率变化 ${formatSignedPercentagePoints(dashboard.summary.accuracyDelta)}。`
            : "样本不足：至少需要 1 名满足主分析条件的配对参与者。"}
        </p>
      </div>

      <div role="img" aria-label={ariaLabel} className="mt-5 grid gap-6 lg:grid-cols-2">
        <ComparisonPanel
          title="有效时间（秒）"
          manual={manual.medianActiveSeconds}
          assisted={aiAssisted.medianActiveSeconds}
          maximum={maxScale(manual.medianActiveSeconds, aiAssisted.medianActiveSeconds, 1)}
          format={formatSecondsLabel}
          insufficient={!enough}
        />
        <ComparisonPanel
          title="值准确率"
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
            模式对比精确数值 · 主分析配对样本 n={dashboard.summary.completion.paired}
          </caption>
          <thead className="text-ink-600">
            <tr>
              {["指标", "人工模式", "AI 辅助", "AI−人工配对中位差", "95% CI", "Wilcoxon p"].map((label) => (
                <th key={label} scope="col" className="border-b border-ink-200 px-3 py-2 font-semibold">{label}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100 bg-white">
            <tr>
              <th scope="row" className="px-3 py-3 font-semibold text-ink-900">有效时间</th>
              <td className="px-3 py-3 font-mono">{formatSecondsLabel(manual.medianActiveSeconds)}</td>
              <td className="px-3 py-3 font-mono text-brand-800">{formatSecondsLabel(aiAssisted.medianActiveSeconds)}</td>
              <td className="px-3 py-3 font-mono">{formatSignedSeconds(timeDifference.median)}</td>
              <td className="px-3 py-3 font-mono">{formatSecondsCi(timeDifference.ci95)}</td>
              <td className="px-3 py-3 font-mono">{formatPValue(timeDifference.wilcoxonP)}</td>
            </tr>
            <tr>
              <th scope="row" className="px-3 py-3 font-semibold text-ink-900">值准确率</th>
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
        误差区间为配对中位差的 95% bootstrap CI；p 值为双侧 Wilcoxon 符号秩近似。版本 {dashboard.experiment.version} / {dashboard.experiment.scoringVersion}。
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
        <span className="font-mono text-[10px] text-ink-500">零基线 · 0—{format(maximum)}</span>
      </div>
      {insufficient ? (
        <div className="mt-5 border-l-2 border-ink-300 py-5 pl-4 text-sm text-ink-500">— · 样本不足</div>
      ) : (
        <div className="mt-5 space-y-4">
          <ComparisonBar label="人工模式 · 轮廓" value={manual} maximum={maximum} format={format} variant="manual" />
          <ComparisonBar label="AI 辅助 · 实心" value={assisted} maximum={maximum} format={format} variant="ai" />
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
    { label: "建议数", value: behavior.suggested, context: `AI 有值建议 · n=${n}` },
    { label: "采纳数", value: behavior.adopted, context: rateContext(behavior.adopted, behavior.suggested) },
    { label: "修改数", value: behavior.modified, context: rateContext(behavior.modified, behavior.suggested) },
    { label: "初始错误", value: behavior.initiallyIncorrect, context: rateContext(behavior.initiallyIncorrect, behavior.suggested) },
    { label: "已纠正", value: behavior.corrected, context: rateContext(behavior.corrected, behavior.initiallyIncorrect) },
    { label: "错误照抄", value: behavior.incorrectlyAdopted, context: rateContext(behavior.incorrectlyAdopted, behavior.initiallyIncorrect) },
  ];
  return (
    <section aria-labelledby="ai-behavior-title" className="mt-10 border-t border-ink-300 pt-6">
      <p className="label-eyebrow">AI behavior audit</p>
      <h2 id="ai-behavior-title" className="mt-1 font-serif text-2xl font-semibold text-ink-950">AI 建议如何被使用</h2>
      <div className="mt-4 grid gap-px overflow-hidden rounded-[10px] border border-ink-200 bg-ink-200 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {tiles.map((tile) => (
          <div key={tile.label} className="min-h-28 bg-white px-4 py-4">
            <span className="label-eyebrow">{tile.label}</span>
            <strong className="mt-3 block font-mono text-2xl text-ink-950">{tile.value}</strong>
            <span className="mt-1 block text-xs leading-5 text-ink-500">{n === 0 ? "— · 样本不足" : tile.context}</span>
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
      <h2 id="diagnostics-title" className="mt-1 font-serif text-2xl font-semibold text-ink-950">设计平衡与计时诊断</h2>
      <div className="mt-4 grid gap-7 xl:grid-cols-[1.2fr_1fr_0.7fr]">
        <DiagnosticTable title="按文献与模式" caption="文献 A/B 主分析样本">
          <thead>
            <tr>
              {['条件', 'n', '中位时间', '中位准确率'].map((label) => <th key={label} scope="col" className="px-2 py-2 font-semibold">{label}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100 bg-white">
            {(["A", "B"] as const).flatMap((paperCode) => ([
              { key: `${paperCode}-manual`, label: `文献 ${paperCode} · 人工`, summary: diagnostics.byPaper[paperCode].manual },
              { key: `${paperCode}-ai`, label: `文献 ${paperCode} · AI`, summary: diagnostics.byPaper[paperCode].aiAssisted },
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

        <DiagnosticTable title="按实验序列" caption="序列完成与配对">
          <thead>
            <tr>
              {['序列', '总数', '完成', '配对', '人工 / AI 时间', '人工 / AI 准确率'].map((label) => <th key={label} scope="col" className="px-2 py-2 font-semibold">{label}</th>)}
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

        <DiagnosticTable title="计时质量" caption="所有参与者计时分类">
          <thead>
            <tr><th scope="col" className="px-2 py-2 font-semibold">分类</th><th scope="col" className="px-2 py-2 font-semibold">人数</th></tr>
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
  onOpen: () => void;
}) {
  return (
    <tr className="hover:bg-brand-50/40">
      <th scope="row" className="whitespace-nowrap px-3 py-3 font-mono font-semibold text-ink-950">{participant.studentAlias}</th>
      <td className="whitespace-nowrap px-3 py-3">{SEQUENCE_LABELS[participant.sequence]}</td>
      <td className="whitespace-nowrap px-3 py-3">{participant.quality.completion === "completed" ? "已完成" : "未完成"}</td>
      <td className="whitespace-nowrap px-3 py-3">{TIMING_LABELS[participant.quality.timing]}</td>
      <RoundTableCells round={participant.manual} />
      <RoundTableCells round={participant.aiAssisted} />
      <td className="whitespace-nowrap px-3 py-3 font-mono">{formatSignedSeconds(participant.activeTimeDifference)}</td>
      <td className="whitespace-nowrap px-3 py-3 font-mono">{formatSignedPercentagePoints(participant.accuracyDifference)}</td>
      <td className="px-3 py-2">
        <button
          type="button"
          className="btn min-h-11 whitespace-nowrap"
          aria-label={`查看学生 ${participant.studentAlias} 的结果`}
          onClick={onOpen}
        >
          查看
        </button>
      </td>
    </tr>
  );
}

function RoundTableCells({ round }: { round: TeachingTeacherRound | null }) {
  return round ? (
    <>
      <td className="px-3 py-3 font-mono">{round.paperCode}</td>
      <td className="whitespace-nowrap px-3 py-3 font-mono">{formatDuration(round.activeSeconds)}</td>
      <td className="whitespace-nowrap px-3 py-3 font-mono">{round.score.valueCorrect}/{TEACHING_FIELDS.length}</td>
    </>
  ) : (
    <><td className="px-3 py-3">—</td><td className="px-3 py-3">—</td><td className="px-3 py-3">—</td></>
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
  useEffect(() => {
    closeRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="teacher-participant-detail-title"
      className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-ink-950/35 p-2 sm:p-6"
    >
      <button type="button" aria-label="关闭参与者详情" className="absolute inset-0 cursor-default" onClick={onClose} />
      <article className="relative z-10 my-auto w-full max-w-6xl overflow-hidden rounded-[12px] border border-ink-200 bg-[#f8faf9] shadow-2xl">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-ink-200 bg-white px-4 py-4 sm:px-6">
          <div>
            <p className="label-eyebrow">Read-only participant record</p>
            <h2 id="teacher-participant-detail-title" className="mt-1 font-serif text-2xl font-semibold text-ink-950">
              {participant.studentAlias} · 双轮自动评分明细
            </h2>
            <p className="mt-1 text-xs text-ink-500">{SEQUENCE_LABELS[participant.sequence]} · {TIMING_LABELS[participant.quality.timing]} · 不可编辑</p>
          </div>
          <button ref={closeRef} type="button" className="btn min-h-11" onClick={onClose}>关闭</button>
        </header>
        <div className="max-h-[calc(100vh-8rem)] overflow-y-auto px-4 py-5 sm:px-6">
          <div className="grid gap-8 xl:grid-cols-2">
            <RoundDetail round={participant.manual} papers={papers} title="人工模式" />
            <RoundDetail round={participant.aiAssisted} papers={papers} title="AI 辅助" />
          </div>
        </div>
      </article>
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
        <p className="mt-3 border-y border-ink-200 py-8 text-sm text-ink-500">— · 本轮尚无可用评分数据</p>
      </section>
    );
  }
  const paper = papers.find((candidate) => candidate.code === round.paperCode);
  return (
    <section aria-labelledby={`round-${round.submissionId}`} className="min-w-0">
      <div className="border-b-2 border-ink-800 pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 id={`round-${round.submissionId}`} className="font-serif text-xl font-semibold text-ink-950">{title} · 文献 {round.paperCode}</h3>
          <span className="font-mono text-xs text-ink-600">{formatDuration(round.activeSeconds)} · {round.score.valueCorrect}/{TEACHING_FIELDS.length}</span>
        </div>
        <p className="mt-1 truncate text-xs text-ink-500">{paper?.title ?? "文献信息不可用"}</p>
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
                <DetailValue label="最终答案" value={answer?.value} />
                <DetailValue label="页码" value={answer?.page} />
                <div className="sm:col-span-2">
                  <DetailValue label="证据摘录" value={answer?.evidence} />
                </div>
                <ScoreDetail label="值判定" correct={valueScore.correct} reason={valueScore.reason} />
                <ScoreDetail label="证据判定" correct={evidenceScore.correct} reason={evidenceScore.reason} />
              </dl>
              {round.mode === "ai_assisted" ? (
                <div className="mt-3 border-l-2 border-brand-500 bg-brand-50/60 px-3 py-3 text-xs text-ink-700">
                  <strong className="text-brand-900">AI 初始建议</strong>
                  <p className="mt-1 break-words">{initial?.value || "—"}</p>
                  <p className="mt-1 text-ink-500">页码 {initial?.page || "—"} · {initial?.evidence || "无初始证据"}</p>
                </div>
              ) : null}
              {round.review ? (
                <p className="mt-2 text-[11px] text-ink-500">
                  历史教师判定：最终值 {reviewScoreLabel(round.review.finalValueScores[field.key])}；AI 初始值 {reviewScoreLabel(round.review.aiInitialValueScores[field.key])} · {formatDateTime(round.review.reviewedAt)}
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
          {correct ? "正确" : "不正确"}
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
  return `${points > 0 ? "+" : ""}${points.toFixed(1)} 个百分点`;
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
    ? value.toLocaleString("zh-CN")
    : value.toLocaleString("zh-CN", { maximumFractionDigits: 1 });
}

function rateContext(numerator: number, denominator: number): string {
  return denominator === 0 ? "— · 样本不足" : `${numerator} / ${denominator} · ${formatPercent(numerator / denominator)}`;
}

function formatRefreshTime(value: string | null): string {
  return value ? formatDateTime(value) : "页面载入时";
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
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
  if (score === "correct") return "正确";
  if (score === "incorrect") return "不正确";
  if (score === "pending") return "待定";
  return "未记录";
}
