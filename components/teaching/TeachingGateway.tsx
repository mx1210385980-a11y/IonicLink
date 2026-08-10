"use client";

import { FormEvent, useState } from "react";
import { requestErrorMessage, requestJson, RequestError } from "@/components/request";

type Mode = "student" | "teacher";

export function TeachingGateway({ initialMode = "student" }: { initialMode?: Mode }) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const payload = mode === "student"
      ? { role: "student", studentAlias: form.get("studentAlias") }
      : { role: "teacher", password: form.get("password") };
    try {
      const result = await requestJson<{ redirect: string }>(
        "/api/teaching/session",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        },
        "进入教学实验失败"
      );
      window.location.assign(result.redirect);
    } catch (cause) {
      setError(requestErrorMessage(cause, "进入教学实验失败。"));
      setBusy(false);
    }
  };

  return (
    <section
      lang="zh-CN"
      aria-labelledby="teaching-gateway-title"
      className="mx-auto w-full max-w-5xl py-3 sm:py-7"
    >
      <div className="overflow-hidden rounded-[12px] border border-ink-200 bg-white shadow-panel lg:grid lg:grid-cols-[1.15fr_0.85fr]">
        <div className="relative border-b border-ink-200 px-5 py-7 sm:px-9 sm:py-10 lg:border-b-0 lg:border-r">
          <div className="absolute inset-x-0 top-0 h-1 bg-brand-700" aria-hidden="true" />
          <p className="label-eyebrow text-brand-700">IonicLink · Teaching Lab</p>
          <h1 id="teaching-gateway-title" className="mt-3 max-w-lg text-3xl font-semibold tracking-tight text-ink-950 sm:text-4xl">
            两轮文献提取对比实验
          </h1>
          <p className="mt-4 max-w-xl text-sm leading-7 text-ink-700">
            系统会自动安排一轮纯人工提取和一轮 AI 辅助提取，并均衡分配先后顺序。无需邀请码，也不需要选择论文。
          </p>

          <div className="mt-8 grid gap-px overflow-hidden rounded-[9px] border border-ink-200 bg-ink-200 sm:grid-cols-3">
            {[
              ["01", "输入化名", "使用学号或姓名缩写，不要求真实姓名。"],
              ["02", "完成两轮", "系统自动保存草稿并衔接下一轮。"],
              ["03", "查看对比", "老师直接查看班级汇总，无需逐项评分。"],
            ].map(([number, title, detail]) => (
              <div key={number} className="bg-ink-50 px-4 py-4">
                <span className="font-mono text-[10px] font-bold tracking-widest text-brand-700">{number}</span>
                <strong className="mt-2 block text-sm text-ink-950">{title}</strong>
                <span className="mt-1 block text-xs leading-5 text-ink-600">{detail}</span>
              </div>
            ))}
          </div>

          <div className="mt-7 border-l-2 border-brand-500 bg-brand-50/70 px-4 py-3 text-xs leading-6 text-ink-700">
            <strong className="text-ink-950">实验记录说明</strong>
            <span className="mt-1 block">
              系统记录有效时间、提交答案和字段是否修改，用于比较速度与准确性；不记录逐键输入内容、剪贴板内容或论文全文。
            </span>
          </div>
        </div>

        <div className="flex flex-col justify-center px-5 py-7 sm:px-9 sm:py-10">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="label-eyebrow">Experiment access</p>
              <h2 className="mt-1 text-xl font-semibold text-ink-950">
                {mode === "student" ? "学生开始实验" : "教师入口"}
              </h2>
            </div>
            <div className="flex rounded-[8px] border border-ink-200 bg-ink-50 p-1" role="group" aria-label="选择入口">
              <ModeButton active={mode === "student"} onClick={() => { setMode("student"); setError(""); }}>
                学生
              </ModeButton>
              <ModeButton active={mode === "teacher"} onClick={() => { setMode("teacher"); setError(""); }}>
                教师
              </ModeButton>
            </div>
          </div>

          <form className="mt-8" onSubmit={submit}>
            {mode === "student" ? (
              <label className="block">
                <span className="mb-2 block text-xs font-semibold text-ink-800">学号或姓名缩写</span>
                <input
                  required
                  type="text"
                  name="studentAlias"
                  maxLength={80}
                  autoComplete="username"
                  placeholder="例如：S001"
                  className="min-h-11 w-full rounded-[8px] border border-ink-300 bg-white px-3.5 text-sm text-ink-950 outline-none transition placeholder:text-ink-400 focus:border-brand-600 focus:ring-2 focus:ring-brand-100"
                />
                <span className="mt-2 block text-xs leading-5 text-ink-500">再次使用同一标识可恢复当前轮次和草稿。</span>
              </label>
            ) : (
              <label className="block">
                <span className="mb-2 block text-xs font-semibold text-ink-800">教师密码</span>
                <input
                  required
                  type="password"
                  name="password"
                  autoComplete="current-password"
                  placeholder="输入服务器配置的教师密码"
                  className="min-h-11 w-full rounded-[8px] border border-ink-300 bg-white px-3.5 text-sm text-ink-950 outline-none transition placeholder:text-ink-400 focus:border-brand-600 focus:ring-2 focus:ring-brand-100"
                />
                <span className="mt-2 block text-xs leading-5 text-ink-500">教师入口仅用于查看汇总结果和导出数据。</span>
              </label>
            )}
            {error ? <div className="mt-4"><RequestError>{error}</RequestError></div> : null}
            <button
              type="submit"
              disabled={busy}
              className={mode === "student" ? "btn-primary mt-6 min-h-11 w-full justify-center" : "btn mt-6 min-h-11 w-full justify-center"}
            >
              {busy ? "正在进入…" : mode === "student" ? "进入第 1 轮" : "查看实验结果"}
            </button>
          </form>
        </div>
      </div>
    </section>
  );
}

function ModeButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`min-h-11 min-w-14 rounded-[6px] px-3 text-xs font-semibold transition focus:outline-none focus:ring-2 focus:ring-brand-200 ${
        active ? "bg-white text-brand-800 shadow-sm" : "text-ink-500 hover:text-ink-900"
      }`}
    >
      {children}
    </button>
  );
}
