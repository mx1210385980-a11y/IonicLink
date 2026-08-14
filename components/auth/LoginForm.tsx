"use client";

import { FormEvent, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { safeAuthRedirect } from "@/lib/auth-redirect";

type Mode = "sign-in" | "sign-up";

export function LoginForm({ allowSignUp, nextPath }: { allowSignUp: boolean; nextPath: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("sign-in");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isNavigating, startTransition] = useTransition();

  const busy = submitting || isNavigating;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;

    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");
    const rememberMe = form.get("rememberMe") === "on";
    setSubmitting(true);
    setError(null);

    try {
      const result = mode === "sign-up"
        ? await authClient.signUp.email({
            name: String(form.get("name") ?? "").trim(),
            email,
            password,
          })
        : await authClient.signIn.email({ email, password, rememberMe });

      if (result.error) {
        setError(
          result.error.status === 429
            ? "尝试次数过多，请稍后再试。"
            : mode === "sign-in"
              ? "邮箱或密码错误。"
              : "账号创建失败，请检查填写内容后重试。"
        );
        return;
      }

      startTransition(() => {
        router.replace(safeAuthRedirect(nextPath));
        router.refresh();
      });
    } catch {
      setError("登录服务暂时不可用，请稍后再试。");
    } finally {
      setSubmitting(false);
    }
  }

  function switchMode(nextMode: Mode) {
    setMode(nextMode);
    setError(null);
  }

  return (
    <form className="panel w-full max-w-md p-6 sm:p-8" onSubmit={submit}>
      <h1 className="text-3xl font-semibold tracking-tight text-ink-950">
        {mode === "sign-in" ? "登录 IonicLink" : "创建 IonicLink 账号"}
      </h1>
      <p className="mt-3 text-sm leading-6 text-ink-600">
        {mode === "sign-in"
          ? "登录后继续管理论文、提取任务和标准化数据。"
          : "使用工作邮箱创建账号，密码至少 8 个字符。"}
      </p>

      <div className="mt-7 space-y-5">
        {mode === "sign-up" ? (
          <label className="block">
            <span className="text-sm font-semibold text-ink-800">姓名</span>
            <input
              autoComplete="name"
              className="mt-2 min-h-11 w-full rounded-[8px] border border-ink-200 bg-white px-3.5 text-sm text-ink-950 outline-none transition placeholder:text-ink-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
              name="name"
              placeholder="你的姓名"
              required
              type="text"
            />
          </label>
        ) : null}

        <label className="block">
          <span className="text-sm font-semibold text-ink-800">邮箱</span>
          <input
            autoCapitalize="none"
            autoComplete="email"
            className="mt-2 min-h-11 w-full rounded-[8px] border border-ink-200 bg-white px-3.5 text-sm text-ink-950 outline-none transition placeholder:text-ink-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
            inputMode="email"
            name="email"
            placeholder="name@example.com"
            required
            spellCheck={false}
            type="email"
          />
        </label>

        <label className="block">
          <span className="text-sm font-semibold text-ink-800">密码</span>
          <span className="relative mt-2 block">
            <input
              autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
              className="min-h-11 w-full rounded-[8px] border border-ink-200 bg-white px-3.5 pr-16 text-sm text-ink-950 outline-none transition placeholder:text-ink-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
              maxLength={128}
              minLength={8}
              name="password"
              placeholder="至少 8 个字符"
              required
              type={showPassword ? "text" : "password"}
            />
            <button
              aria-pressed={showPassword}
              className="absolute inset-y-0 right-0 px-3 text-xs font-semibold text-ink-500 transition hover:text-brand-700 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-brand-200"
              onClick={() => setShowPassword((visible) => !visible)}
              type="button"
            >
              {showPassword ? "隐藏" : "显示"}
            </button>
          </span>
        </label>
      </div>

      {mode === "sign-in" ? (
        <label className="mt-5 flex w-fit items-center gap-2 text-sm text-ink-700">
          <input className="h-4 w-4 rounded border-ink-300 accent-brand-700" name="rememberMe" type="checkbox" />
          保持登录
        </label>
      ) : null}

      {error ? (
        <div className="mt-5 rounded-[8px] border border-rose-200 bg-rose-50 px-3.5 py-3 text-sm text-rose-700" role="alert">
          {error}
        </div>
      ) : null}

      <button className="btn-primary mt-6 w-full justify-center" disabled={busy} type="submit">
        {busy ? "正在处理…" : mode === "sign-in" ? "登录" : "创建账号"}
      </button>

      {allowSignUp ? (
        <p className="mt-6 text-center text-sm text-ink-600">
          {mode === "sign-in" ? "还没有账号？" : "已经有账号？"}{" "}
          <button
            className="font-semibold text-brand-700 underline-offset-4 hover:underline focus:outline-none focus:ring-2 focus:ring-brand-200"
            onClick={() => switchMode(mode === "sign-in" ? "sign-up" : "sign-in")}
            type="button"
          >
            {mode === "sign-in" ? "创建账号" : "返回登录"}
          </button>
        </p>
      ) : null}
    </form>
  );
}
