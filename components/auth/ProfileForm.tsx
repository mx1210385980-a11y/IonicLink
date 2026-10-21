"use client";

import { FormEvent, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";

const inputClass =
  "mt-2 min-h-11 w-full rounded-[8px] border border-ink-200 bg-white px-3.5 text-sm text-ink-950 outline-none transition placeholder:text-ink-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-100";

export function ProfileForm({ initialName, account, roleLabel }: { initialName: string; account: string; roleLabel: string }) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isRefreshing, startTransition] = useTransition();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || isRefreshing) return;
    const next = name.trim();
    if (!next) {
      setError("The display name cannot be empty.");
      setNotice(null);
      return;
    }
    if (next === initialName) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await authClient.updateUser({ name: next });
      if (result.error) {
        setError("Could not update the display name. Please try again.");
        return;
      }
      setNotice("Display name updated.");
      startTransition(() => router.refresh());
    } catch {
      setError("The request is temporarily unavailable. Please try again later.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="panel w-full max-w-md p-6 sm:p-8" onSubmit={submit}>
      <h1 className="text-2xl font-semibold tracking-tight text-ink-950">My account</h1>
      <dl className="mt-5 space-y-3 text-sm">
        <div className="flex items-baseline justify-between gap-4">
          <dt className="font-semibold text-ink-800">Account</dt>
          <dd className="truncate font-mono text-ink-600" title={account}>{account}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-4">
          <dt className="font-semibold text-ink-800">Role</dt>
          <dd className="text-ink-600">{roleLabel}</dd>
        </div>
      </dl>

      <label className="mt-6 block">
        <span className="text-sm font-semibold text-ink-800">Display name</span>
        <input
          autoComplete="name"
          className={inputClass}
          maxLength={60}
          onChange={(event) => setName(event.target.value)}
          required
          type="text"
          value={name}
        />
      </label>
      <p className="mt-2 text-xs leading-5 text-ink-500">
        Shown in the navigation rail and next to your sign-out button. Your sign-in account never changes.
      </p>

      {error ? (
        <div className="mt-4 rounded-[8px] border border-rose-200 bg-rose-50 px-3.5 py-3 text-sm text-rose-700" role="alert">
          {error}
        </div>
      ) : null}
      {notice ? (
        <div className="mt-4 rounded-[8px] border border-emerald-200 bg-emerald-50 px-3.5 py-3 text-sm text-emerald-700" role="status">
          {notice}
        </div>
      ) : null}

      <button className="btn-primary mt-5 w-full justify-center" disabled={busy || isRefreshing} type="submit">
        {busy || isRefreshing ? "Saving…" : "Save display name"}
      </button>
    </form>
  );
}
