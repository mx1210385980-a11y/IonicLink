"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import { authClient } from "@/lib/auth-client";
import { DEFAULT_DOMAIN, DOMAINS, isDomain, type Domain } from "@/lib/domain";

const DOMAIN_LABELS: Record<Domain, string> = {
  tribology: "Tribology",
  conductivity: "Conductivity",
  diffusion: "Diffusion",
};

const DOMAIN_MARKS: Record<Domain, string> = {
  tribology: "μ",
  conductivity: "σ",
  diffusion: "D",
};

const SECTION_LINKS: readonly {
  segment: "" | "extract" | "database" | "design" | "library";
  label: string;
  icon: ReactNode;
}[] = [
  { segment: "", label: "Home", icon: <HomeIcon /> },
  { segment: "extract", label: "Extract", icon: <ExtractIcon /> },
  { segment: "database", label: "Database", icon: <DatabaseIcon /> },
  { segment: "design", label: "Model preview", icon: <ModelIcon /> },
  { segment: "library", label: "Documents", icon: <LibraryIcon /> },
];

export function WorkspaceNavigationRail() {
  const pathname = usePathname();
  const parts = pathname.split("/");
  const first = parts[1];
  const onDomainPage = isDomain(first);
  const onAfmPage = first === "afm";
  const domain: Domain = onDomainPage ? first : DEFAULT_DOMAIN;
  const section = parts[2] ?? "";
  const onTeachingPage = first === "teaching";
  const onLoginPage = first === "login";

  return (
    <aside
      aria-label="IonicLink primary navigation"
      data-testid="workspace-navigation-rail"
      className="fixed inset-y-0 left-0 z-40 hidden h-dvh w-20 flex-col items-center overflow-visible border-r border-[#e4e9f3] bg-[#f8faff] px-3 py-3 lg:flex"
    >
      <Link
        href="/"
        aria-label="IonicLink home"
        className="group/rail-item relative grid h-11 w-11 shrink-0 place-items-center rounded-[14px] bg-[#0f827b] text-white shadow-[0_14px_28px_-18px_rgba(15,130,123,0.9)] transition hover:-translate-y-0.5 hover:bg-[#0a716b] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#8bd4cf] focus-visible:ring-offset-2"
      >
        <span className="text-[15px] font-bold tracking-[-0.08em]" aria-hidden>IL</span>
        <RailTooltip label="IonicLink home" />
      </Link>

      <nav
        aria-label="Property workspaces"
        data-testid="workspace-switcher"
        className="mt-4 flex flex-col items-center gap-1 rounded-[17px] border border-[#e1e7f1] bg-white p-1.5 shadow-[0_10px_26px_-22px_rgba(36,57,105,0.6)]"
      >
        {DOMAINS.map((item) => {
          const active = onDomainPage && item === domain;
          const href = onDomainPage && section
            ? section === "design" && item !== "tribology"
              ? `/${item}`
              : `/${item}/${section}`
            : `/${item}`;

          return (
            <RailLink
              key={item}
              href={href}
              label={`${DOMAIN_LABELS[item]} workspace`}
              active={active}
              tone="workspace"
            >
              <span className="font-mono text-[15px] font-semibold leading-none tracking-tight" aria-hidden>
                {DOMAIN_MARKS[item]}
              </span>
            </RailLink>
          );
        })}
        <RailLink href="/afm" label="AFM workspace" active={onAfmPage} tone="workspace">
          <span className="font-mono text-[13px] font-semibold leading-none tracking-tight" aria-hidden>AFM</span>
        </RailLink>
      </nav>

      {onDomainPage ? <nav
        aria-label={`${DOMAIN_LABELS[domain]} sections`}
        data-testid="section-dock"
        className="mt-4 flex flex-col items-center gap-1 rounded-[18px] border border-[#e1e7f1] bg-white p-1.5 shadow-[0_14px_30px_-24px_rgba(36,57,105,0.55)]"
      >
        {SECTION_LINKS.map((item) => {
          const href = item.segment === "design" ? "/tribology/design" : item.segment ? `/${domain}/${item.segment}` : `/${domain}`;

          return (
            <RailLink
              key={item.segment || "home"}
              href={href}
              label={item.label}
              active={onDomainPage && (item.segment ? section === item.segment : section === "")}
            >
              {item.icon}
            </RailLink>
          );
        })}
      </nav> : null}

      <div
        data-testid="utility-dock"
        className="mt-auto flex flex-col items-center gap-1 rounded-[18px] border border-[#e1e7f1] bg-white p-1.5 shadow-[0_14px_30px_-24px_rgba(36,57,105,0.55)]"
      >
        <RailLink href="/teaching" label="Teaching lab" active={onTeachingPage}>
          <TeachingIcon />
        </RailLink>
        <RailAuthControls loginActive={onLoginPage} />
      </div>
    </aside>
  );
}

function RailLink({
  href,
  label,
  active = false,
  tone = "section",
  children,
}: {
  href: string;
  label: string;
  active?: boolean;
  tone?: "workspace" | "section";
  children: ReactNode;
}) {
  const activeClass = tone === "workspace"
    ? "bg-[#17223b] text-white shadow-[0_10px_20px_-14px_rgba(23,34,59,0.9)]"
    : "bg-[#2f5fe3] text-white shadow-[0_12px_22px_-15px_rgba(47,95,227,0.9)]";
  const sizeClass = tone === "workspace" ? "h-9 w-9 rounded-[11px]" : "h-10 w-10 rounded-[12px]";

  return (
    <Link
      href={href}
      aria-label={label}
      aria-current={active ? "page" : undefined}
      className={`group/rail-item relative grid shrink-0 place-items-center transition duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#9bb3f3] focus-visible:ring-offset-2 ${sizeClass} ${
        active
          ? activeClass
          : "text-[#7f8ead] hover:bg-[#edf2fd] hover:text-[#2f5fe3]"
      }`}
    >
      {children}
      <RailTooltip label={label} current={active} />
    </Link>
  );
}

function RailTooltip({ label, current = false }: { label: string; current?: boolean }) {
  return (
    <span
      data-testid="rail-tooltip"
      aria-hidden
      className="pointer-events-none absolute left-[calc(100%+12px)] top-1/2 z-50 flex -translate-y-1/2 translate-x-1 items-center gap-2 whitespace-nowrap rounded-[9px] border border-[#dce3ef] bg-[#10182b] px-2.5 py-1.5 text-[11px] font-semibold tracking-normal text-white opacity-0 shadow-[0_12px_28px_-14px_rgba(15,24,43,0.7)] transition duration-150 delay-75 group-hover/rail-item:translate-x-0 group-hover/rail-item:opacity-100 group-focus-visible/rail-item:translate-x-0 group-focus-visible/rail-item:opacity-100"
    >
      {label}
      {current ? <span className="h-1.5 w-1.5 rounded-full bg-[#77a0ff]" /> : null}
    </span>
  );
}

function RailAuthControls({ loginActive }: { loginActive: boolean }) {
  const router = useRouter();
  const { data: session, isPending } = authClient.useSession();
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState(false);
  const [isNavigating, startTransition] = useTransition();

  if (isPending) {
    return <span aria-label="Reading account" className="h-10 w-10 animate-pulse rounded-[12px] bg-[#edf1f7]" />;
  }

  const user = session?.user ?? null;
  if (!user) {
    return (
      <RailLink href="/login" label="Sign in" active={loginActive}>
        <UserIcon />
      </RailLink>
    );
  }

  const busy = signingOut || isNavigating;
  const displayName = user.name || user.email || "Account";
  const initial = displayName.trim().charAt(0).toUpperCase() || "A";

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
    <>
      <span
        className="group/rail-item relative grid h-10 w-10 place-items-center rounded-[12px] bg-[#eef3ff] text-xs font-bold text-[#3458ad]"
        aria-label={`Account: ${displayName}`}
      >
        {initial}
        <RailTooltip label={displayName} />
      </span>
      <button
        type="button"
        onClick={signOut}
        disabled={busy}
        aria-label={busy ? "Signing out" : signOutError ? "Retry sign out" : "Sign out"}
        className="group/rail-item relative grid h-10 w-10 place-items-center rounded-[12px] text-[#8a98b4] transition hover:bg-rose-50 hover:text-rose-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-200 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <LogoutIcon spinning={busy} />
        <RailTooltip label={signOutError ? "Retry sign out" : "Sign out"} />
      </button>
    </>
  );
}

function HomeIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M4 10.7L12 4l8 6.7v7.8a1.5 1.5 0 01-1.5 1.5h-13A1.5 1.5 0 014 18.5v-7.8z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M9.2 20v-6h5.6v6" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}

function ExtractIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M5 15.5v2.8A1.7 1.7 0 006.7 20h10.6a1.7 1.7 0 001.7-1.7v-2.8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M12 16V4m0 0L8.2 7.8M12 4l3.8 3.8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function DatabaseIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <ellipse cx="12" cy="5.7" rx="7" ry="2.7" stroke="currentColor" strokeWidth="1.8" />
      <path d="M5 5.7v6c0 1.5 3.1 2.7 7 2.7s7-1.2 7-2.7v-6M5 11.7v6c0 1.5 3.1 2.7 7 2.7s7-1.2 7-2.7v-6" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

function ModelIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M4 19V5M4 19h16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M7 15l3.2-3.6 3 2.2L19 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M15.8 7H19v3.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function LibraryIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M6.5 4h8.8L18 6.7V20H6.5A1.5 1.5 0 015 18.5v-13A1.5 1.5 0 016.5 4z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M15 4v3h3M8.5 11h6.5M8.5 14.5h6.5M8.5 18h4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function TeachingIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M9 3h6M10 3v5l-5 8.7A2.2 2.2 0 006.9 20h10.2a2.2 2.2 0 001.9-3.3L14 8V3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M7.7 15h8.6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function UserIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="8" r="3.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M5.5 20a6.5 6.5 0 0113 0" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function LogoutIcon({ spinning }: { spinning: boolean }) {
  return (
    <svg className={spinning ? "animate-pulse" : ""} width="19" height="19" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M10 4H6a2 2 0 00-2 2v12a2 2 0 002 2h4M14.5 8.5L18 12l-3.5 3.5M9 12h9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
