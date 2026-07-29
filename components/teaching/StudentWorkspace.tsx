"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { TeachingAnswer, TeachingAnswers, TeachingFieldKey } from "@/lib/teachingShared";
import { requestErrorMessage, requestJson, RequestError } from "@/components/request";

type Workspace = {
  project: {
    id: string;
    name: string;
    fields: readonly { key: TeachingFieldKey; label: string }[];
  };
  participant: { groupCode: string; studentAlias: string };
  paper: { paperNo: string; title: string; doi: string; journal: string; sourceUrl: string };
  submission: {
    startedAt: string;
    submittedAt: string | null;
    answers: TeachingAnswers;
    version: number;
  };
};

type SaveState = "idle" | "saving" | "saved" | "error";

export function StudentWorkspace({ initial }: { initial: Workspace }) {
  const [answers, setAnswers] = useState<TeachingAnswers>(initial.submission.answers);
  const [submittedAt, setSubmittedAt] = useState(initial.submission.submittedAt);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [savedAt, setSavedAt] = useState("");
  const [error, setError] = useState("");
  const [seconds, setSeconds] = useState(() =>
    initial.submission.submittedAt
      ? elapsed(initial.submission.startedAt, initial.submission.submittedAt)
      : 0
  );
  const versionRef = useRef(initial.submission.version);
  const firstRenderRef = useRef(true);
  const saveQueueRef = useRef(Promise.resolve(true));
  const answersRef = useRef(answers);
  answersRef.current = answers;

  const locked = Boolean(submittedAt);
  const completed = useMemo(
    () => initial.project.fields.filter((field) => answers[field.key]?.value?.trim()).length,
    [answers, initial.project.fields]
  );

  useEffect(() => {
    if (locked) return;
    setSeconds(elapsed(initial.submission.startedAt, null));
    const timer = window.setInterval(
      () => setSeconds(elapsed(initial.submission.startedAt, null)),
      1000
    );
    return () => window.clearInterval(timer);
  }, [initial.submission.startedAt, locked]);

  const enqueueSave = (snapshot: TeachingAnswers) => {
    saveQueueRef.current = saveQueueRef.current.then(async () => {
      setSaveState("saving");
      setError("");
      try {
        const result = await requestJson<{ version: number; updatedAt: string }>(
          "/api/teaching/student",
          {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ version: versionRef.current, answers: snapshot }),
          },
          "保存草稿失败"
        );
        versionRef.current = result.version;
        setSavedAt(result.updatedAt);
        setSaveState("saved");
        return true;
      } catch (cause) {
        setSaveState("error");
        setError(requestErrorMessage(cause, "保存草稿失败。"));
        return false;
      }
    });
    return saveQueueRef.current;
  };

  useEffect(() => {
    if (firstRenderRef.current) {
      firstRenderRef.current = false;
      return;
    }
    if (locked) return;
    const timer = window.setTimeout(() => void enqueueSave(answers), 800);
    return () => window.clearTimeout(timer);
    // enqueueSave intentionally uses refs so typing does not recreate the queue.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answers, locked]);

  const update = (key: TeachingFieldKey, patch: Partial<TeachingAnswer>) => {
    setAnswers((current) => ({
      ...current,
      [key]: { value: "", ...current[key], ...patch },
    }));
  };

  const submit = async () => {
    if (completed !== initial.project.fields.length || locked) return;
    if (!window.confirm("提交后答案将锁定，确认提交吗？")) return;
    setError("");
    const saved = await enqueueSave(answersRef.current);
    if (!saved) return;
    try {
      const result = await requestJson<{ submittedAt: string }>(
        "/api/teaching/student",
        { method: "POST" },
        "提交失败"
      );
      setSubmittedAt(result.submittedAt);
      setSeconds(elapsed(initial.submission.startedAt, result.submittedAt));
    } catch (cause) {
      setError(requestErrorMessage(cause, "提交失败。"));
    }
  };

  return (
    <main className="mx-auto w-full max-w-7xl px-4 pb-10 pt-5 sm:px-6">
      <section className="overflow-hidden rounded-[11px] border border-ink-200 bg-white shadow-card">
        <header className="flex flex-wrap items-center gap-x-7 gap-y-2 border-b border-ink-200 px-5 py-3 text-xs text-ink-700">
          <strong className="text-sm text-brand-800">文献 {initial.paper.paperNo}</strong>
          <span className="h-5 w-px bg-ink-200" aria-hidden />
          <span><strong className="mr-2 text-ink-500">DOI</strong>{initial.paper.doi || "—"}</span>
          <span className="h-5 w-px bg-ink-200" aria-hidden />
          <span><strong className="mr-2 text-ink-500">期刊</strong>{initial.paper.journal || "—"}</span>
          <span className="ml-auto text-ink-500">{initial.participant.groupCode} · {initial.participant.studentAlias}</span>
        </header>

        <div className="grid lg:grid-cols-[minmax(0,1fr)_18rem]">
          <div className="px-5 py-6 sm:px-8 sm:py-8">
            <h1 className="text-2xl font-semibold tracking-tight text-ink-950">人工提取实验</h1>
            <p className="mt-2 text-sm text-ink-600">请根据论文填写 {initial.project.fields.length} 个字段，提交前不会显示 AI 结果。</p>
            <h2 className="mt-5 max-w-3xl font-serif text-lg font-semibold leading-7 text-ink-950">{initial.paper.title}</h2>
            {initial.paper.sourceUrl ? (
              <a className="mt-2 inline-block text-xs font-semibold text-brand-700 hover:underline" href={initial.paper.sourceUrl} target="_blank" rel="noreferrer">
                打开论文链接
              </a>
            ) : null}

            <div className="mt-7 divide-y divide-ink-100 border-y border-ink-100">
              {initial.project.fields.map((field) => {
                const answer = answers[field.key] ?? { value: "" };
                return (
                  <div key={field.key} className="grid gap-3 py-4 md:grid-cols-[7rem_minmax(12rem,1fr)_7rem_minmax(14rem,1fr)] md:items-end">
                    <label className="text-sm font-semibold text-ink-950 md:self-center" htmlFor={`answer-${field.key}`}>
                      {field.label} <span className="text-rose-600" aria-label="必填">*</span>
                    </label>
                    <input
                      id={`answer-${field.key}`}
                      value={answer.value}
                      disabled={locked}
                      onChange={(event) => update(field.key, { value: event.target.value })}
                      className="min-h-11 rounded-[8px] border border-ink-200 bg-white px-3 text-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100 disabled:bg-ink-50 disabled:text-ink-600"
                    />
                    <label className="block">
                      <span className="mb-1.5 block text-[10px] font-semibold text-ink-600">页码</span>
                      <input
                        value={answer.page ?? ""}
                        disabled={locked}
                        inputMode="numeric"
                        placeholder="例如：5"
                        aria-label={`${field.label} 页码`}
                        onChange={(event) => update(field.key, { page: event.target.value })}
                        className="min-h-11 w-full rounded-[8px] border border-ink-200 px-3 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100 disabled:bg-ink-50"
                      />
                    </label>
                    <label className="block">
                      <span className="mb-1.5 block text-[10px] font-semibold text-ink-600">原文证据</span>
                      <input
                        value={answer.evidence ?? ""}
                        disabled={locked}
                        placeholder="粘贴原文中的关键词或短语"
                        aria-label={`${field.label} 原文证据`}
                        onChange={(event) => update(field.key, { evidence: event.target.value })}
                        className="min-h-11 w-full rounded-[8px] border border-ink-200 px-3 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100 disabled:bg-ink-50"
                      />
                    </label>
                  </div>
                );
              })}
            </div>

            <div className="mt-4 min-h-6" aria-live="polite">
              <span className={`inline-flex items-center gap-2 text-xs ${saveState === "error" ? "text-rose-700" : "text-ink-600"}`}>
                <span className={`h-2 w-2 rounded-full ${saveState === "saving" ? "bg-amber-500" : saveState === "error" ? "bg-rose-500" : "bg-brand-600"}`} />
                {locked
                  ? "结果已提交并锁定"
                  : saveState === "saving"
                    ? "正在自动保存…"
                    : saveState === "error"
                      ? "自动保存失败"
                      : savedAt
                        ? `已自动保存 ${new Date(savedAt).toLocaleTimeString("zh-CN", { hour12: false })}`
                        : "填写后将自动保存"}
              </span>
            </div>
            {error ? <div className="mt-3"><RequestError>{error}</RequestError></div> : null}
          </div>

          <aside className="border-t border-ink-200 bg-ink-50/55 p-5 lg:border-l lg:border-t-0">
            <div className="sticky top-24">
              <div className="flex items-baseline justify-between">
                <strong className="text-sm text-ink-950">已填写</strong>
                <span className="font-mono text-2xl font-semibold text-brand-700">{completed}<small className="ml-1 text-sm text-ink-500">/ {initial.project.fields.length}</small></span>
              </div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-ink-200">
                <div className="h-full rounded-full bg-brand-600 transition-all" style={{ width: `${(completed / initial.project.fields.length) * 100}%` }} />
              </div>
              <div className="mt-6 border-y border-ink-200 py-4 text-sm text-ink-700">
                <span className="font-mono">用时 {formatElapsed(seconds)}</span>
              </div>
              <p className="mt-5 text-xs leading-6 text-ink-600">提交后将锁定答案。提交前请确认六个字段已经填写完整。</p>
              <button
                type="button"
                onClick={() => void enqueueSave(answersRef.current)}
                disabled={locked || saveState === "saving"}
                className="btn mt-8 w-full justify-center"
              >
                保存草稿
              </button>
              <button
                type="button"
                onClick={() => void submit()}
                disabled={locked || completed !== initial.project.fields.length}
                className="btn-primary mt-3 w-full justify-center"
              >
                {locked ? "已提交" : "提交结果"}
              </button>
              {!locked && completed !== initial.project.fields.length ? (
                <p className="mt-3 text-center text-xs text-ink-500">请完整填写 {initial.project.fields.length} 个字段后提交</p>
              ) : null}
            </div>
          </aside>
        </div>
      </section>
    </main>
  );
}

function elapsed(startedAt: string, endedAt: string | null): number {
  const end = endedAt ? Date.parse(endedAt) : Date.now();
  return Math.max(0, Math.round((end - Date.parse(startedAt)) / 1000));
}

function formatElapsed(total: number): string {
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return [hours, minutes, seconds].map((value) => String(value).padStart(2, "0")).join(":");
}
