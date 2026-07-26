"use client";

import { FormEvent, useState } from "react";
import { requestErrorMessage, requestJson, RequestError } from "@/components/request";

type Mode = "student" | "teacher";

export function TeachingGateway() {
  const [mode, setMode] = useState<Mode>("student");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const payload =
      mode === "student"
        ? {
            role: "student",
            inviteCode: form.get("inviteCode"),
            groupCode: form.get("groupCode"),
            studentAlias: form.get("studentAlias"),
          }
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
    <main className="mx-auto flex w-full max-w-5xl items-start px-4 py-8 sm:px-6 lg:py-12">
      <section className="grid w-full overflow-hidden rounded-[12px] border border-ink-200 bg-white shadow-panel lg:grid-cols-[1.05fr_0.95fr]">
        <div className="border-b border-ink-100 px-6 py-8 sm:px-10 sm:py-12 lg:border-b-0 lg:border-r">
          <h1 className="text-3xl font-semibold tracking-tight text-ink-950">教学实验</h1>
          <p className="mt-3 max-w-md text-sm leading-7 text-ink-700">
            用同一篇论文比较 AI 提取与人工提取。学生只填写人工结果，提交前不会看到 AI 答案。
          </p>
          <ol className="mt-8 space-y-5 text-sm text-ink-800">
            {[
              ["1", "输入课程邀请码", "系统会自动分配一篇实验文献。"],
              ["2", "填写六个字段", "草稿自动保存，刷新后可以继续。"],
              ["3", "提交并等待审核", "老师审核后统一查看对比结果。"],
            ].map(([n, title, body]) => (
              <li key={n} className="flex gap-4">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[8px] bg-brand-50 font-mono text-xs font-bold text-brand-700">
                  {n}
                </span>
                <span>
                  <strong className="block font-semibold text-ink-950">{title}</strong>
                  <span className="mt-1 block text-xs leading-5 text-ink-600">{body}</span>
                </span>
              </li>
            ))}
          </ol>
        </div>

        <div className="px-6 py-8 sm:px-10 sm:py-12">
          <div className="grid grid-cols-2 gap-1 rounded-[9px] bg-ink-50 p-1" role="tablist" aria-label="教学实验入口">
            {(["student", "teacher"] as const).map((value) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={mode === value}
                onClick={() => {
                  setMode(value);
                  setError("");
                }}
                className={`min-h-10 rounded-[7px] px-3 text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-brand-200 ${
                  mode === value ? "bg-white text-brand-800 shadow-sm" : "text-ink-600 hover:text-ink-950"
                }`}
              >
                {value === "student" ? "学生填写" : "教师后台"}
              </button>
            ))}
          </div>

          <form className="mt-7 space-y-4" onSubmit={submit}>
            {mode === "student" ? (
              <>
                <Field label="课程邀请码" name="inviteCode" placeholder="例如：TRIBO2026" autoComplete="off" />
                <Field label="组别" name="groupCode" placeholder="例如：第 1 组" autoComplete="organization" />
                <Field label="学号或姓名缩写" name="studentAlias" placeholder="仅用于区分提交" autoComplete="username" />
              </>
            ) : (
              <Field label="教师密码" name="password" type="password" placeholder="请输入服务器配置的教师密码" autoComplete="current-password" />
            )}
            {error ? <RequestError>{error}</RequestError> : null}
            <button type="submit" disabled={busy} className="btn-primary mt-2 w-full justify-center">
              {busy ? "正在进入…" : mode === "student" ? "开始人工提取" : "进入教师后台"}
            </button>
          </form>
        </div>
      </section>
    </main>
  );
}

function Field({
  label,
  name,
  type = "text",
  placeholder,
  autoComplete,
}: {
  label: string;
  name: string;
  type?: string;
  placeholder: string;
  autoComplete: string;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold text-ink-800">{label}</span>
      <input
        required
        name={name}
        type={type}
        placeholder={placeholder}
        autoComplete={autoComplete}
        className="min-h-11 w-full rounded-[8px] border border-ink-200 bg-white px-3 text-sm text-ink-950 outline-none transition placeholder:text-ink-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
      />
    </label>
  );
}

