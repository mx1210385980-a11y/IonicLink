import type { Metadata } from "next";
import { AuthControls } from "@/components/auth/AuthControls";
import { isAppAuthEnabled } from "@/lib/auth.server";

export const metadata: Metadata = { title: "Account · IonicLink" };
export const dynamic = "force-dynamic";

export default function AccountPage() {
  return (
    <section aria-labelledby="account-title" className="mx-auto min-h-dvh w-full max-w-[1264px] px-4 py-8 sm:px-8 lg:px-16 lg:py-16">
      <h1 id="account-title" className="text-3xl font-semibold tracking-tight text-ink-900 lg:text-[40px]">Account</h1>
      <p className="mt-3 text-base text-ink-600">Manage your IonicLink account and campus identity.</p>

      <section aria-labelledby="campus-account-title" className="mt-10 max-w-3xl rounded-xl border border-ink-200 bg-white p-6 sm:p-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="campus-account-title" className="text-lg font-semibold text-ink-900">NJUST Campus Portal</h2>
          <span className="rounded-full bg-ink-100 px-3 py-1 text-xs font-medium text-ink-600">Coming soon</span>
        </div>
        <p className="mt-4 text-sm leading-7 text-ink-600">Campus sign-in and account linking through the NJUST Campus Portal will be available here.</p>
        <button type="button" disabled className="mt-6 inline-flex min-h-10 cursor-not-allowed items-center rounded-lg bg-ink-100 px-4 text-sm font-medium text-ink-500">Campus sign-in · Coming soon</button>
      </section>

      {isAppAuthEnabled() && (
        <section aria-label="Existing account sign-in" className="mt-6 flex max-w-3xl flex-wrap items-center justify-between gap-4 rounded-xl border border-ink-200 bg-white p-6">
          <div><h2 className="text-sm font-medium text-ink-900">Existing account</h2><p className="mt-1 text-xs text-ink-600">Continue using your existing account until campus sign-in is available.</p></div>
          <AuthControls />
        </section>
      )}
    </section>
  );
}
