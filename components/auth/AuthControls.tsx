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
    return <span aria-label="Loading sign-in status" className="h-9 w-16 shrink-0 animate-pulse rounded-[8px] bg-ink-100" />;
  }

  if (!user) {
    return (
      <Link
        className="min-h-9 shrink-0 rounded-[8px] border border-ink-200 bg-white px-3 py-2 text-xs font-semibold text-ink-700 transition hover:border-brand-300 hover:text-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-200"
        href="/login"
      >
        Sign in
      </Link>
    );
  }

  const busy = signingOut || isNavigating;
  const role = (user as { role?: string | null }).role ?? "";
  const isAdmin = role.split(",").map((part) => part.trim()).includes("admin");
  const username = (user as { displayUsername?: string | null; username?: string | null }).displayUsername
    ?? (user as { username?: string | null }).username
    ?? null;

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
      <span
        className="hidden max-w-32 truncate text-xs font-semibold text-ink-600 lg:block"
        title={user.email ?? undefined}
      >
        {user.name || username || user.email}
      </span>
      <span
        className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
          isAdmin ? "bg-brand-100 text-brand-800" : "bg-ink-100 text-ink-600"
        }`}
      >
        {isAdmin ? "Admin" : "Student"}
      </span>
      <Link
        className="min-h-9 rounded-[8px] border border-ink-200 bg-white px-3 py-2 text-xs font-semibold text-ink-700 transition hover:border-brand-300 hover:text-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-200"
        href="/account"
        title="Change your password"
      >
        Password
      </Link>
      <button
        className="min-h-9 rounded-[8px] border border-ink-200 bg-white px-3 py-2 text-xs font-semibold text-ink-700 transition hover:border-brand-300 hover:text-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-200 disabled:cursor-not-allowed disabled:opacity-50"
        disabled={busy}
        onClick={signOut}
        title={signOutError ? "Sign-out failed. Please try again." : "Sign out and switch to another account"}
        type="button"
      >
        {busy ? "Signing out…" : signOutError ? "Retry sign-out" : "Sign out"}
      </button>
    </div>
  );
}
