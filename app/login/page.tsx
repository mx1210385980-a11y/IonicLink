import Link from "next/link";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/auth/LoginForm";
import { getCurrentAppSession, isAppAuthEnabled, isSelfRegistrationEnabled } from "@/lib/auth.server";
import { safeAuthRedirect } from "@/lib/auth-redirect";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: { next?: string | string[] };
}) {
  const nextValue = Array.isArray(searchParams.next) ? searchParams.next[0] : searchParams.next;
  const nextPath = safeAuthRedirect(nextValue);
  if (!isAppAuthEnabled()) redirect(nextPath);
  const session = await getCurrentAppSession();
  if (session) redirect(nextPath);

  return (
    <div className="mx-auto flex min-h-[calc(100dvh-8.5rem)] max-w-5xl flex-col items-center justify-center px-1 py-10">
      <LoginForm allowSignUp={isSelfRegistrationEnabled()} nextPath={nextPath} />
      <Link
        className="mt-5 rounded-[8px] px-3 py-2 text-sm font-semibold text-ink-600 transition hover:bg-white/70 hover:text-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-200"
        href="/teaching"
      >
        前往独立教学实验入口
      </Link>
    </div>
  );
}
