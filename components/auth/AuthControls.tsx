"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { authClient } from "@/lib/auth-client";

export function AuthControls() {
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState(false);
  const [isNavigating, startTransition] = useTransition();
  const { data: session, isPending } = authClient.useSession();
  const user = session?.user ?? null;

  if (isPending) {
    return <span aria-label="正在读取登录状态" className="h-9 w-16 shrink-0 animate-pulse rounded-[8px] bg-ink-100" />;
  }

  if (!user) {
    return (
      <Link
        className="min-h-9 shrink-0 rounded-[8px] border border-ink-200 bg-white px-3 py-2 text-xs font-semibold text-ink-700 transition hover:border-brand-300 hover:text-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-200"
        href="/login"
      >
        登录
      </Link>
    );
  }

  const busy = signingOut || isNavigating;

  async function signOut() {
    if (busy) return;
    setSigningOut(true);
    setSignOutError(false);
    try {
      const result = await authClient.signOut();
      if (result.error) throw new Error(result.error.message);
      startTransition(() => {
        router.replace("/login");
        router.refresh();
      });
    } catch {
      setSignOutError(true);
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <div className="flex shrink-0 items-center gap-2">
      <span className="hidden max-w-32 truncate text-xs font-semibold text-ink-600 lg:block" title={user.email}>
        {user.name || user.email}
      </span>
      <button
        className="min-h-9 rounded-[8px] border border-ink-200 bg-white px-3 py-2 text-xs font-semibold text-ink-700 transition hover:border-brand-300 hover:text-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-200 disabled:cursor-not-allowed disabled:opacity-50"
        disabled={busy}
        onClick={signOut}
        title={signOutError ? "退出失败，请重试" : undefined}
        type="button"
      >
        {busy ? "退出中…" : signOutError ? "重试退出" : "退出"}
      </button>
    </div>
  );
}
