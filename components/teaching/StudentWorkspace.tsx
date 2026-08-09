"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { RequestError } from "@/components/request";
import type {
  TeachingAnswer,
  TeachingAnswers,
  TeachingFieldKey,
  TeachingStudentState,
} from "@/lib/teachingShared";
import {
  buildTeachingHeartbeat,
  buildTeachingHeartbeatEventId,
  buildTeachingSubmitPayload,
  createTeachingPageNonce,
  flushTeachingHeartbeatBeforeSubmit,
  hasTeachingAnswerChanged,
  isTeachingHeartbeatEligible,
  isTeachingInteractionLocked,
  isTeachingWorkspaceIdle,
  selectTeachingHeartbeatAttempt,
  teachingHeartbeatSkipSucceeded,
  type TeachingHeartbeatPayload,
} from "./studentWorkspaceModel";

type ActiveTeachingState = Extract<TeachingStudentState, { status: "active" }>;
type CompleteTeachingState = Extract<TeachingStudentState, { status: "complete" }>;
type SaveState = "idle" | "saving" | "saved" | "error";
type TeachingConflictKind = "version" | "locked" | "stale_round";

class TeachingApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly kind?: TeachingConflictKind
  ) {
    super(message);
    this.name = "TeachingApiError";
  }
}

export function StudentWorkspace({ initial }: { initial: TeachingStudentState }) {
  return initial.status === "complete"
    ? <CompletedWorkspace initial={initial} />
    : <ActiveWorkspace initial={initial} />;
}

function CompletedWorkspace({ initial }: { initial: CompleteTeachingState }) {
  return (
    <section
      lang="zh-CN"
      aria-labelledby="experiment-complete-title"
      className="mx-auto max-w-3xl py-5 sm:py-10"
    >
      <div className="overflow-hidden rounded-[12px] border border-ink-200 bg-white shadow-panel">
        <div className="h-1 bg-brand-700" aria-hidden="true" />
        <div className="px-5 py-10 text-center sm:px-12 sm:py-14">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-full border border-brand-200 bg-brand-50 text-2xl text-brand-800" aria-hidden="true">
            ✓
          </div>
          <p className="label-eyebrow mt-6 text-brand-700">Experiment complete</p>
          <h1 id="experiment-complete-title" className="mt-2 text-3xl font-semibold tracking-tight text-ink-950">
            两轮实验已完成
          </h1>
          <p className="mx-auto mt-3 max-w-lg text-sm leading-7 text-ink-600">
            你的两轮答案都已安全提交。现在可以关闭页面，老师会在汇总样本后查看班级对比结果。
          </p>
          <dl className="mx-auto mt-8 grid max-w-md grid-cols-1 overflow-hidden rounded-[9px] border border-ink-200 bg-ink-200 text-left sm:grid-cols-2">
            <div className="bg-ink-50 px-4 py-3">
              <dt className="text-[10px] font-semibold uppercase tracking-wider text-ink-500">学生标识</dt>
              <dd className="mt-1 font-mono text-sm font-semibold text-ink-900">{initial.participant.studentAlias}</dd>
            </div>
            <div className="bg-ink-50 px-4 py-3">
              <dt className="text-[10px] font-semibold uppercase tracking-wider text-ink-500">完成时间</dt>
              <dd className="mt-1 text-sm font-semibold text-ink-900">{formatDateTime(initial.completedAt)}</dd>
            </div>
          </dl>
        </div>
      </div>
    </section>
  );
}

function ActiveWorkspace({ initial }: { initial: ActiveTeachingState }) {
  const [answers, setAnswers] = useState<TeachingAnswers>(() => initialAnswers(initial));
  const [activeSeconds, setActiveSeconds] = useState(initial.activeSeconds);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [savedAt, setSavedAt] = useState("");
  const [error, setError] = useState("");
  const [needsReload, setNeedsReload] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [idle, setIdle] = useState(false);

  const answersRef = useRef(answers);
  const versionRef = useRef(initial.version);
  const saveQueueRef = useRef<Promise<boolean>>(Promise.resolve(true));
  const debounceRef = useRef<number | null>(null);
  const firstRenderRef = useRef(true);
  const editRevisionRef = useRef(0);
  const savedRevisionRef = useRef(0);
  const lockedRef = useRef(false);
  const submittingRef = useRef(false);
  const heartbeatInFlightRef = useRef<Promise<boolean> | null>(null);
  const pendingHeartbeatRef = useRef<TeachingHeartbeatPayload | null>(null);
  const sendHeartbeatRef = useRef<(requirePayload?: boolean) => Promise<boolean>>(
    async () => false
  );
  const heartbeatPageNonceRef = useRef<string>();
  const heartbeatSequenceRef = useRef(0);
  const lastActivityAtRef = useRef(Date.now());
  const activeWindowStartedAtRef = useRef(Date.now());
  const lastEditedFieldRef = useRef<TeachingFieldKey>();
  answersRef.current = answers;

  const completedFields = useMemo(
    () => initial.project.fields.filter((field) => answers[field.key]?.value?.trim()).length,
    [answers, initial.project.fields]
  );
  const allValuesComplete = completedFields === initial.project.fields.length;
  const canSubmit = allValuesComplete && (initial.mode === "manual" || confirmed);
  const interactionLocked = isTeachingInteractionLocked(lockedRef.current, submitting);

  const clearPendingAutosave = () => {
    if (debounceRef.current !== null) {
      window.clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
  };

  const handleConflict = (cause: unknown): boolean => {
    if (!(cause instanceof TeachingApiError) || cause.status !== 409) return false;
    lockedRef.current = true;
    setSaveState("error");
    setNeedsReload(true);
    if (cause.kind === "locked" || cause.kind === "stale_round") {
      setError("当前轮次已更新，正在重新载入最新任务…");
      window.setTimeout(() => window.location.reload(), 0);
    } else {
      setError("服务器上已有更新。为避免覆盖较新的草稿，请刷新页面后继续。");
    }
    return true;
  };

  const enqueueSave = (snapshot: TeachingAnswers, revision: number): Promise<boolean> => {
    const operation = saveQueueRef.current.then(async () => {
      if (lockedRef.current) return false;
      setSaveState("saving");
      setError("");
      try {
        const result = await teachingRequest<{ version: number; updatedAt: string }>(
          "PATCH",
          { version: versionRef.current, answers: snapshot },
          "保存草稿失败"
        );
        versionRef.current = result.version;
        savedRevisionRef.current = Math.max(savedRevisionRef.current, revision);
        setSavedAt(result.updatedAt);
        setSaveState(savedRevisionRef.current === editRevisionRef.current ? "saved" : "saving");
        return true;
      } catch (cause) {
        if (!handleConflict(cause)) {
          setSaveState("error");
          setError(errorMessage(cause, "保存草稿失败，请检查网络后重试。"));
        }
        return false;
      }
    });
    saveQueueRef.current = operation;
    return operation;
  };

  const flushLatestDraft = async (): Promise<boolean> => {
    clearPendingAutosave();
    await saveQueueRef.current;
    if (lockedRef.current) return false;
    if (savedRevisionRef.current >= editRevisionRef.current) return true;
    return enqueueSave(answersRef.current, editRevisionRef.current);
  };

  useEffect(() => {
    if (firstRenderRef.current) {
      firstRenderRef.current = false;
      return;
    }
    if (lockedRef.current) return;
    clearPendingAutosave();
    debounceRef.current = window.setTimeout(() => {
      debounceRef.current = null;
      void enqueueSave(answersRef.current, editRevisionRef.current);
    }, 800);
    return clearPendingAutosave;
    // The queue and current draft are held in refs so typing does not rebuild in-flight work.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answers]);

  useEffect(() => {
    const markActivity = () => {
      const timestamp = Date.now();
      if (isTeachingWorkspaceIdle(timestamp, lastActivityAtRef.current)) {
        activeWindowStartedAtRef.current = timestamp;
      }
      lastActivityAtRef.current = timestamp;
      setIdle(false);
    };
    const passive = { passive: true } as const;
    const eventNames = ["pointerdown", "keydown", "input", "scroll", "touchstart"] as const;
    for (const eventName of eventNames) document.addEventListener(eventName, markActivity, passive);

    const resetVisibleWindow = () => {
      activeWindowStartedAtRef.current = Date.now();
    };
    document.addEventListener("visibilitychange", resetVisibleWindow);

    const sendHeartbeat = (requirePayload = false): Promise<boolean> => {
      const existing = heartbeatInFlightRef.current;
      if (existing) return existing;

      const timestamp = Date.now();
      const isIdle = isTeachingWorkspaceIdle(timestamp, lastActivityAtRef.current);
      setIdle(isIdle);
      const heartbeatEligible = isTeachingHeartbeatEligible({
        enabled: !lockedRef.current,
        visible: document.visibilityState === "visible",
        now: timestamp,
        lastActivityAt: lastActivityAtRef.current,
      });
      if (!heartbeatEligible) {
        return Promise.resolve(teachingHeartbeatSkipSucceeded(false, requirePayload));
      }
      const fieldKey = lastEditedFieldRef.current;
      let payload: TeachingHeartbeatPayload | null;
      try {
        payload = selectTeachingHeartbeatAttempt(pendingHeartbeatRef.current, () => {
          const sequence = heartbeatSequenceRef.current + 1;
          const pageNonce = heartbeatPageNonceRef.current ?? createTeachingPageNonce();
          heartbeatPageNonceRef.current = pageNonce;
          const created = buildTeachingHeartbeat({
            enabled: true,
            visible: true,
            now: timestamp,
            lastActivityAt: lastActivityAtRef.current,
            lastHeartbeatAt: activeWindowStartedAtRef.current,
            eventId: buildTeachingHeartbeatEventId(pageNonce, initial.roundNo, sequence),
            roundNo: initial.roundNo,
            fieldKey,
            minimumOneSecond: requirePayload,
          });
          if (created) heartbeatSequenceRef.current = sequence;
          return created;
        });
      } catch (cause) {
        setError(errorMessage(cause, "无法生成安全的计时事件，请刷新页面后重试。"));
        return Promise.resolve(false);
      }
      if (!payload) {
        return Promise.resolve(teachingHeartbeatSkipSucceeded(true, requirePayload));
      }
      pendingHeartbeatRef.current = payload;

      const operation = (async () => {
        try {
          const result = await teachingRequest<{ activeSeconds: number }>(
            "POST",
            payload,
            "记录有效时间失败"
          );
          setActiveSeconds(result.activeSeconds);
          const acknowledgedAt = Date.parse(payload.clientAt);
          if (Number.isFinite(acknowledgedAt)) {
            activeWindowStartedAtRef.current = Math.max(
              activeWindowStartedAtRef.current,
              acknowledgedAt
            );
          }
          if (pendingHeartbeatRef.current?.eventId === payload.eventId) {
            pendingHeartbeatRef.current = null;
          }
          if (lastEditedFieldRef.current === payload.fieldKey) {
            lastEditedFieldRef.current = undefined;
          }
          return true;
        } catch (cause) {
          if (!handleConflict(cause)) {
            setError(errorMessage(cause, "有效时间暂未同步，将在后续操作时重试。"));
          }
          return false;
        }
      })();
      heartbeatInFlightRef.current = operation;
      void operation.then(() => {
        if (heartbeatInFlightRef.current === operation) {
          heartbeatInFlightRef.current = null;
        }
      });
      return operation;
    };
    sendHeartbeatRef.current = sendHeartbeat;

    const heartbeatTimer = window.setInterval(() => void sendHeartbeat(), 15_000);
    return () => {
      window.clearInterval(heartbeatTimer);
      for (const eventName of eventNames) document.removeEventListener(eventName, markActivity);
      document.removeEventListener("visibilitychange", resetVisibleWindow);
      sendHeartbeatRef.current = async () => false;
    };
    // The round is the only prop that identifies this activity stream; transient values live in refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial.roundNo]);

  const updateAnswer = (key: TeachingFieldKey, patch: Partial<TeachingAnswer>) => {
    if (isTeachingInteractionLocked(lockedRef.current, submittingRef.current)) return;
    editRevisionRef.current += 1;
    lastEditedFieldRef.current = key;
    lastActivityAtRef.current = Date.now();
    setConfirmed(false);
    setAnswers((current) => ({
      ...current,
      [key]: { value: "", ...current[key], ...patch },
    }));
  };

  const submit = async () => {
    if (!canSubmit || lockedRef.current || submittingRef.current) return;
    if (!window.confirm(`确认提交第 ${initial.roundNo} 轮吗？提交后本轮答案将锁定。`)) return;

    submittingRef.current = true;
    setSubmitting(true);
    setError("");
    clearPendingAutosave();
    const heartbeatPersisted = await flushTeachingHeartbeatBeforeSubmit({
      currentInFlight: () => heartbeatInFlightRef.current,
      hasPending: () => pendingHeartbeatRef.current !== null,
      send: () => sendHeartbeatRef.current(true),
    });
    if (!heartbeatPersisted) {
      if (!lockedRef.current) {
        setError("有效时间尚未保存，本轮没有提交。请检查网络后重试提交。");
      }
      submittingRef.current = false;
      setSubmitting(false);
      return;
    }
    const saved = await flushLatestDraft();
    if (!saved) {
      submittingRef.current = false;
      setSubmitting(false);
      return;
    }

    try {
      await teachingRequest(
        "POST",
        buildTeachingSubmitPayload(initial.roundNo, versionRef.current),
        "提交失败"
      );
      lockedRef.current = true;
      window.location.reload();
    } catch (cause) {
      if (!handleConflict(cause)) {
        setError(errorMessage(cause, "提交失败，请稍后重试。"));
      }
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  return (
    <section lang="zh-CN" aria-labelledby="student-workspace-title" className="mx-auto w-full py-1 sm:py-3">
      <div className="overflow-hidden rounded-[12px] border border-ink-200 bg-white shadow-card">
        <header className="border-b border-ink-200 bg-ink-950 px-4 py-4 text-white sm:px-6">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="rounded-[6px] border border-white/20 bg-white/10 px-2.5 py-1 font-mono text-xs font-semibold">
              第 {initial.roundNo} / {initial.totalRounds} 轮
            </span>
            <span className={`rounded-[6px] px-2.5 py-1 text-xs font-semibold ${
              initial.mode === "manual" ? "bg-white text-ink-900" : "bg-brand-400 text-ink-950"
            }`}>
              {initial.mode === "manual" ? "纯人工提取" : "AI 辅助提取"}
            </span>
            <span className="rounded-[6px] border border-white/20 px-2.5 py-1 text-xs">论文 {initial.paper.code}</span>
            <span className="ml-auto font-mono text-xs text-ink-300">{initial.participant.studentAlias}</span>
          </div>
          <div className="mt-4 flex items-center gap-3">
            <div
              role="progressbar"
              aria-label={`实验轮次进度：第 ${initial.roundNo} 轮，共 ${initial.totalRounds} 轮`}
              aria-valuemin={0}
              aria-valuemax={initial.totalRounds}
              aria-valuenow={initial.roundNo}
              className="flex flex-1 gap-1.5"
            >
              {Array.from({ length: initial.totalRounds }, (_, index) => (
                <span key={index} className={`h-1.5 flex-1 rounded-full ${index < initial.roundNo ? "bg-brand-400" : "bg-white/20"}`} />
              ))}
            </div>
            <span className="text-[10px] text-ink-300">完成本轮后自动进入下一步</span>
          </div>
        </header>

        <div className="grid lg:grid-cols-[minmax(0,1fr)_18rem]">
          <div className="min-w-0 px-4 py-6 sm:px-7 sm:py-8">
            <p className="label-eyebrow text-brand-700">Literature extraction sheet</p>
            <h1 id="student-workspace-title" className="mt-2 text-2xl font-semibold tracking-tight text-ink-950">
              教学提取实验
            </h1>
            {initial.mode === "ai_assisted" ? (
              <p className="mt-2 text-sm leading-6 text-ink-600">逐项核对 AI 初始建议，可直接保留或按论文内容编辑。</p>
            ) : (
              <p className="mt-2 text-sm leading-6 text-ink-600">请独立阅读论文并填写六个目标字段。</p>
            )}

            <div className="mt-6 border-l-2 border-brand-600 bg-brand-50/60 px-4 py-3">
              <span className="text-[10px] font-bold uppercase tracking-wider text-brand-800">本轮提取范围</span>
              <p className="mt-1 text-sm font-semibold leading-6 text-ink-900">{initial.paper.taskPrompt}</p>
            </div>

            <div className="mt-6 border-y border-ink-200 py-4">
              <h2 className="font-serif text-lg font-semibold leading-7 text-ink-950">{initial.paper.title}</h2>
              <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-xs text-ink-600">
                <span><strong className="mr-1.5 text-ink-800">期刊</strong>{initial.paper.journal || "未注明"}</span>
                <span><strong className="mr-1.5 text-ink-800">DOI</strong>{initial.paper.doi || "未注明"}</span>
              </div>
              <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                {initial.paper.sourceUrl ? (
                  <a className="btn-primary min-h-11 justify-center" href={initial.paper.sourceUrl} target="_blank" rel="noreferrer">
                    打开论文来源（PDF）
                  </a>
                ) : null}
                {initial.paper.doi ? (
                  <a className="btn min-h-11 justify-center" href={`https://doi.org/${initial.paper.doi}`} target="_blank" rel="noreferrer">
                    DOI 备用链接
                  </a>
                ) : null}
              </div>
            </div>

            <div className="mt-6 flex flex-col gap-2 border-b border-ink-200 pb-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 className="text-base font-semibold text-ink-950">目标字段</h2>
                <p className="mt-1 text-xs leading-5 text-ink-600">值为必填；同时填写页码和原文证据，才计入证据覆盖率。</p>
              </div>
              <span className="font-mono text-xs text-ink-500">{completedFields} / {initial.project.fields.length} 已填写</span>
            </div>

            <div className="divide-y divide-ink-200">
              {initial.project.fields.map((field, index) => {
                const answer = answers[field.key] ?? { value: "" };
                const changed = initial.mode === "ai_assisted"
                  ? hasTeachingAnswerChanged(answer, initial.aiInitial[field.key])
                  : false;
                return (
                  <fieldset key={field.key} className="py-5">
                    <legend className="flex w-full items-center justify-between gap-3 text-sm font-semibold text-ink-950">
                      <span><span className="mr-2 font-mono text-[10px] text-brand-700">{String(index + 1).padStart(2, "0")}</span>{field.label}</span>
                      {initial.mode === "ai_assisted" ? (
                        <span className={`rounded-[5px] border px-2 py-0.5 text-[10px] font-bold ${
                          changed ? "border-amber-200 bg-amber-50 text-amber-700" : "border-brand-200 bg-brand-50 text-brand-700"
                        }`}>
                          {changed ? "已编辑" : "未修改"}
                        </span>
                      ) : null}
                    </legend>

                    {initial.mode === "ai_assisted" ? (
                      <p className="mt-2 rounded-[7px] bg-ink-50 px-3 py-2 text-xs leading-5 text-ink-600">
                        <strong className="text-ink-800">AI 初始建议：</strong>
                        {formatInitialSuggestion(initial.aiInitial[field.key])}
                      </p>
                    ) : null}

                    <div className="mt-3 grid gap-3 md:grid-cols-[minmax(12rem,1fr)_8rem]">
                      <label className="block">
                        <span className="mb-1.5 block text-[11px] font-semibold text-ink-700">提取值 <span className="text-rose-600" aria-label="必填">*</span></span>
                        <input
                          required
                          id={`answer-${field.key}`}
                          name={`value-${field.key}`}
                          value={answer.value}
                          maxLength={500}
                          disabled={interactionLocked}
                          onChange={(event) => updateAnswer(field.key, { value: event.target.value })}
                          className="min-h-11 w-full rounded-[8px] border border-ink-300 bg-white px-3 text-sm text-ink-950 outline-none transition motion-reduce:transition-none focus:border-brand-600 focus:ring-2 focus:ring-brand-100 disabled:bg-ink-50 disabled:text-ink-500"
                        />
                      </label>
                      <label className="block">
                        <span className="mb-1.5 block text-[11px] font-semibold text-ink-700">页码</span>
                        <input
                          name={`page-${field.key}`}
                          value={answer.page ?? ""}
                          maxLength={40}
                          inputMode="text"
                          disabled={interactionLocked}
                          onChange={(event) => updateAnswer(field.key, { page: event.target.value })}
                          className="min-h-11 w-full rounded-[8px] border border-ink-300 bg-white px-3 text-sm text-ink-950 outline-none transition motion-reduce:transition-none focus:border-brand-600 focus:ring-2 focus:ring-brand-100 disabled:bg-ink-50"
                        />
                      </label>
                    </div>
                    <label className="mt-3 block">
                      <span className="mb-1.5 block text-[11px] font-semibold text-ink-700">原文证据</span>
                      <textarea
                        name={`evidence-${field.key}`}
                        value={answer.evidence ?? ""}
                        maxLength={2000}
                        rows={2}
                        disabled={interactionLocked}
                        placeholder="粘贴能支持该值的原文短句或关键词"
                        onChange={(event) => updateAnswer(field.key, { evidence: event.target.value })}
                        className="min-h-[4.5rem] w-full resize-y rounded-[8px] border border-ink-300 bg-white px-3 py-2 text-sm leading-6 text-ink-950 outline-none transition motion-reduce:transition-none placeholder:text-ink-400 focus:border-brand-600 focus:ring-2 focus:ring-brand-100 disabled:bg-ink-50"
                      />
                    </label>
                  </fieldset>
                );
              })}
            </div>
          </div>

          <aside className="border-t border-ink-200 bg-ink-50/70 p-4 sm:p-6 lg:border-l lg:border-t-0">
            <div className="lg:sticky lg:top-24">
              <p className="label-eyebrow">Round status</p>
              <div className="mt-3 flex items-end justify-between gap-3">
                <strong className="text-sm text-ink-900">字段进度</strong>
                <span className="font-mono text-2xl font-semibold text-brand-700">{completedFields}<small className="ml-1 text-sm text-ink-500">/ {initial.project.fields.length}</small></span>
              </div>
              <div
                role="progressbar"
                aria-label={`字段填写进度：已完成 ${completedFields} 项，共 ${initial.project.fields.length} 项`}
                aria-valuemin={0}
                aria-valuemax={initial.project.fields.length}
                aria-valuenow={completedFields}
                className="mt-3 h-2 overflow-hidden rounded-full bg-ink-200"
              >
                <div
                  className="h-full rounded-full bg-brand-600 transition-[width] motion-reduce:transition-none"
                  style={{ width: `${(completedFields / initial.project.fields.length) * 100}%` }}
                />
              </div>

              <dl className="mt-6 border-y border-ink-200 py-4">
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-xs font-semibold text-ink-600">有效用时</dt>
                  <dd className="font-mono text-lg font-semibold tabular-nums text-ink-950">{formatElapsed(activeSeconds)}</dd>
                </div>
              </dl>
              <p className={`mt-3 text-xs font-semibold ${idle ? "text-amber-700" : "text-brand-700"}`}>
                {idle ? "闲置，计时已暂停" : "页面可见且有操作时记录有效时间"}
              </p>

              {initial.mode === "ai_assisted" ? (
                <label className="mt-6 flex min-h-11 cursor-pointer items-start gap-3 rounded-[8px] border border-brand-200 bg-brand-50 px-3 py-3 text-sm font-semibold leading-5 text-ink-900">
                  <input
                    type="checkbox"
                    checked={confirmed}
                    disabled={interactionLocked}
                    onChange={(event) => setConfirmed(event.target.checked)}
                    className="mt-0.5 h-5 w-5 shrink-0 accent-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-200"
                  />
                  <span>已核对全部字段</span>
                </label>
              ) : null}

              <div className="mt-5 min-h-6 text-xs text-ink-600" aria-live="polite">
                {saveState === "saving"
                  ? "正在自动保存…"
                  : saveState === "error"
                    ? "草稿尚未同步"
                    : savedAt
                      ? `已保存 ${formatTime(savedAt)}`
                      : "修改后将自动保存"}
              </div>
              {error ? <div className="mt-3"><RequestError>{error}</RequestError></div> : null}
              {needsReload ? (
                <button type="button" onClick={() => window.location.reload()} className="btn mt-3 min-h-11 w-full justify-center">
                  刷新并恢复最新草稿
                </button>
              ) : null}

              <button
                type="button"
                onClick={() => void flushLatestDraft()}
                disabled={interactionLocked || saveState === "saving"}
                className="btn mt-6 min-h-11 w-full justify-center"
              >
                保存草稿
              </button>
              <button
                type="button"
                onClick={() => void submit()}
                disabled={!canSubmit || interactionLocked}
                className="btn-primary mt-3 min-h-11 w-full justify-center"
              >
                {submitting ? "正在提交…" : `提交第 ${initial.roundNo} 轮`}
              </button>
              {!allValuesComplete ? (
                <p className="mt-3 text-center text-xs leading-5 text-ink-500">请先填写全部 {initial.project.fields.length} 个必填值</p>
              ) : initial.mode === "ai_assisted" && !confirmed ? (
                <p className="mt-3 text-center text-xs leading-5 text-ink-500">核对后勾选确认即可提交</p>
              ) : null}
            </div>
          </aside>
        </div>
      </div>
    </section>
  );
}

function initialAnswers(initial: ActiveTeachingState): TeachingAnswers {
  if (initial.mode === "manual") return initial.answers;
  const answers: TeachingAnswers = {};
  for (const field of initial.project.fields) {
    const answer = initial.answers[field.key] ?? initial.aiInitial[field.key];
    if (answer) answers[field.key] = answer;
  }
  return answers;
}

function formatInitialSuggestion(answer: TeachingAnswer | undefined): string {
  if (!answer) return "未提供";
  const context = [
    answer.value || "未提供值",
    answer.page ? `页码 ${answer.page}` : "未提供页码",
    answer.evidence ? `证据：${answer.evidence}` : "未提供证据",
  ];
  return context.join(" · ");
}

async function teachingRequest<T>(
  method: "PATCH" | "POST",
  body: unknown,
  fallback: string
): Promise<T> {
  let response: Response;
  try {
    response = await fetch("/api/teaching/student", {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (cause) {
    throw new Error(`${fallback}，请检查网络连接。`, { cause });
  }
  const payload = await response.json().catch(() => null) as
    | { error?: unknown; kind?: unknown }
    | T
    | null;
  if (!response.ok) {
    const record = payload && typeof payload === "object" ? payload as { error?: unknown; kind?: unknown } : null;
    const message = typeof record?.error === "string" && record.error.trim()
      ? record.error
      : `${fallback}（HTTP ${response.status}）。`;
    const kind = record?.kind === "version" || record?.kind === "locked" || record?.kind === "stale_round"
      ? record.kind
      : undefined;
    throw new TeachingApiError(message, response.status, kind);
  }
  if (payload === null) throw new Error(`${fallback}：服务器响应无法读取。`);
  return payload as T;
}

function errorMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message.trim() ? cause.message : fallback;
}

function formatElapsed(total: number): string {
  const safe = Math.max(0, Math.round(total));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  return [hours, minutes, seconds].map((value) => String(value).padStart(2, "0")).join(":");
}

function formatDateTime(value: string): string {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp)
    ? new Date(timestamp).toLocaleString("zh-CN", {
        hour12: false,
        timeZone: "Asia/Shanghai",
      })
    : value;
}

function formatTime(value: string): string {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp)
    ? new Date(timestamp).toLocaleTimeString("zh-CN", { hour12: false })
    : "刚刚";
}
