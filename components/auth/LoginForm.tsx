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
            ? "Too many attempts. Please try again later."
            : mode === "sign-in"
              ? "Incorrect email or password."
              : "Could not create your account. Check your details and try again."
        );
        return;
      }

      startTransition(() => {
        router.replace(safeAuthRedirect(nextPath));
        router.refresh();
      });
    } catch {
      setError("Sign-in is temporarily unavailable. Please try again later.");
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
        {mode === "sign-in" ? "Sign in to IonicLink" : "Create an IonicLink account"}
      </h1>
      <p className="mt-3 text-sm leading-6 text-ink-600">
        {mode === "sign-in"
          ? "Sign in to manage papers, extraction tasks, and standardized data."
          : "Create an account with your work email and a password of at least 8 characters."}
      </p>

      <div className="mt-7 space-y-5">
        {mode === "sign-up" ? (
          <label className="block">
            <span className="text-sm font-semibold text-ink-800">Name</span>
            <input
              autoComplete="name"
              className="mt-2 min-h-11 w-full rounded-[8px] border border-ink-200 bg-white px-3.5 text-sm text-ink-950 outline-none transition placeholder:text-ink-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
              name="name"
              placeholder="Your name"
              required
              type="text"
            />
          </label>
        ) : null}

        <label className="block">
          <span className="text-sm font-semibold text-ink-800">Email</span>
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
          <span className="text-sm font-semibold text-ink-800">Password</span>
          <span className="relative mt-2 block">
            <input
              autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
              className="min-h-11 w-full rounded-[8px] border border-ink-200 bg-white px-3.5 pr-16 text-sm text-ink-950 outline-none transition placeholder:text-ink-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
              maxLength={128}
              minLength={8}
              name="password"
              placeholder="At least 8 characters"
              required
              type={showPassword ? "text" : "password"}
            />
            <button
              aria-pressed={showPassword}
              className="absolute inset-y-0 right-0 px-3 text-xs font-semibold text-ink-500 transition hover:text-brand-700 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-brand-200"
              onClick={() => setShowPassword((visible) => !visible)}
              type="button"
            >
              {showPassword ? "Hide" : "Show"}
            </button>
          </span>
        </label>
      </div>

      {mode === "sign-in" ? (
        <label className="mt-5 flex w-fit items-center gap-2 text-sm text-ink-700">
          <input className="h-4 w-4 rounded border-ink-300 accent-brand-700" name="rememberMe" type="checkbox" />
          Keep me signed in
        </label>
      ) : null}

      {error ? (
        <div className="mt-5 rounded-[8px] border border-rose-200 bg-rose-50 px-3.5 py-3 text-sm text-rose-700" role="alert">
          {error}
        </div>
      ) : null}

      <button className="btn-primary mt-6 w-full justify-center" disabled={busy} type="submit">
        {busy ? "Processing…" : mode === "sign-in" ? "Sign in" : "Create account"}
      </button>

      {allowSignUp ? (
        <p className="mt-6 text-center text-sm text-ink-600">
          {mode === "sign-in" ? "New to IonicLink?" : "Already have an account?"}{" "}
          <button
            className="font-semibold text-brand-700 underline-offset-4 hover:underline focus:outline-none focus:ring-2 focus:ring-brand-200"
            onClick={() => switchMode(mode === "sign-in" ? "sign-up" : "sign-in")}
            type="button"
          >
            {mode === "sign-in" ? "Create account" : "Back to sign in"}
          </button>
        </p>
      ) : null}
    </form>
  );
}
