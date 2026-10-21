"use client";

import { FormEvent, useState } from "react";
import { authClient } from "@/lib/auth-client";

const inputClass =
  "mt-2 min-h-11 w-full rounded-[8px] border border-ink-200 bg-white px-3.5 text-sm text-ink-950 outline-none transition placeholder:text-ink-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-100";

export function ChangePasswordForm() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const formEl = event.currentTarget;
    const form = new FormData(formEl);
    const currentPassword = String(form.get("currentPassword") ?? "");
    const newPassword = String(form.get("newPassword") ?? "");
    const confirmPassword = String(form.get("confirmPassword") ?? "");

    if (newPassword !== confirmPassword) {
      setError("The two new passwords do not match.");
      setNotice(null);
      return;
    }

    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await authClient.changePassword({
        currentPassword,
        newPassword,
        revokeOtherSessions: true,
      });
      if (result.error) {
        setError(
          result.error.status === 429
            ? "Too many attempts. Please try again later."
            : "Could not change the password. Check your current password and try again."
        );
        return;
      }
      formEl.reset();
      setNotice("Password updated. Other devices have been signed out.");
    } catch {
      setError("The request is temporarily unavailable. Please try again later.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="panel w-full max-w-md p-6 sm:p-8" onSubmit={submit}>
      <h1 className="text-2xl font-semibold tracking-tight text-ink-950">Change password</h1>
      <p className="mt-3 text-sm leading-6 text-ink-600">
        Choose a password of at least 8 characters. Other devices are signed out when the password changes.
      </p>

      <div className="mt-6 space-y-5">
        <label className="block">
          <span className="text-sm font-semibold text-ink-800">Current password</span>
          <input
            autoComplete="current-password"
            className={inputClass}
            maxLength={128}
            name="currentPassword"
            required
            type={showPassword ? "text" : "password"}
          />
        </label>
        <label className="block">
          <span className="text-sm font-semibold text-ink-800">New password</span>
          <input
            autoComplete="new-password"
            className={inputClass}
            maxLength={128}
            minLength={8}
            name="newPassword"
            placeholder="At least 8 characters"
            required
            type={showPassword ? "text" : "password"}
          />
        </label>
        <label className="block">
          <span className="text-sm font-semibold text-ink-800">Confirm new password</span>
          <input
            autoComplete="new-password"
            className={inputClass}
            maxLength={128}
            minLength={8}
            name="confirmPassword"
            required
            type={showPassword ? "text" : "password"}
          />
        </label>
        <label className="flex w-fit items-center gap-2 text-sm text-ink-700">
          <input
            checked={showPassword}
            className="h-4 w-4 rounded border-ink-300 accent-brand-700"
            onChange={(event) => setShowPassword(event.target.checked)}
            type="checkbox"
          />
          Show passwords
        </label>
      </div>

      {error ? (
        <div className="mt-5 rounded-[8px] border border-rose-200 bg-rose-50 px-3.5 py-3 text-sm text-rose-700" role="alert">
          {error}
        </div>
      ) : null}
      {notice ? (
        <div className="mt-5 rounded-[8px] border border-emerald-200 bg-emerald-50 px-3.5 py-3 text-sm text-emerald-700" role="status">
          {notice}
        </div>
      ) : null}

      <button className="btn-primary mt-6 w-full justify-center" disabled={busy} type="submit">
        {busy ? "Updating…" : "Update password"}
      </button>
    </form>
  );
}
