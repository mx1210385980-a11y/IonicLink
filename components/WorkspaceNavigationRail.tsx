"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { authClient } from "@/lib/auth-client";
import { FeedbackDialog } from "@/components/auth/FeedbackDialog";
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

const SECTION_LINKS = [
  { segment: "extract", label: "Extract", icon: <ExtractIcon /> },
  { segment: "database", label: "Database", icon: <DatabaseIcon /> },
] as const;

export function WorkspaceNavigationRail({ authEnabled = false, viewerIsAdmin = false, viewerName = null }: { authEnabled?: boolean; viewerIsAdmin?: boolean; viewerName?: string | null }) {
  const pathname = usePathname();
  const parts = pathname.split("/");
  const first = parts[1];
  const onDomainPage = isDomain(first);
  const domain: Domain = onDomainPage ? first : DEFAULT_DOMAIN;
  const section = parts[2] ?? "";
  const onTeachingPage = first === "teaching";
  const onMonitorPage = first === "monitor";
  const onAfmPage = first === "afm";
  const onHomePage = pathname === "/";
  const onAccountPage = first === "account" || first === "admin";
  // The root layout does not re-render on client-side navigation, so the
  // server-passed props are only a first-frame snapshot. Subscribe to the
  // client session and prefer it once loaded; this keeps the account entries
  // in sync after sign-in/sign-out without a full page refresh. In public
  // compatibility mode (auth disabled) the server snapshot always wins.
  const { data: clientSession, isPending: sessionPending } = authClient.useSession();
  const clientUser = clientSession?.user as
    | { name?: string | null; displayUsername?: string | null; username?: string | null; email?: string | null; role?: string | null }
    | null
    | undefined;
  const clientName = clientUser
    ? clientUser.name || clientUser.displayUsername || clientUser.username || clientUser.email || null
    : null;
  const clientIsAdmin = Boolean(
    clientUser?.role?.split(",").map((part) => part.trim()).includes("admin")
  );
  const effectiveName = authEnabled && !sessionPending ? clientName : viewerName;
  const effectiveIsAdmin = authEnabled && !sessionPending ? clientIsAdmin : viewerIsAdmin;
  // The usage monitor is administrator-only once accounts are enabled; in
  // public compatibility mode (no auth) it stays visible to everyone.
  const showMonitor = !authEnabled || effectiveIsAdmin;

  return (
    <aside aria-label="IonicLink primary navigation" data-testid="workspace-navigation-rail" className="fixed inset-y-0 left-0 z-40 hidden h-dvh w-[190px] flex-col overflow-y-auto border-r border-[#41484e] bg-[#282f35] px-2 pb-7 pt-7 text-[#dce7ed] lg:flex">
      <Link href="/" aria-label="IonicLink home" className="mx-auto flex shrink-0 flex-col items-center gap-1 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400">
        <IonicLinkMark />
        <span className="text-xl font-medium leading-7 tracking-[-0.035em] text-white">IonicLink</span>
      </Link>
      <div className="mt-[35px]"><RailLink href="/" label="Home" active={onHomePage}><HomeIcon /></RailLink></div>
      <nav aria-label="Property workspaces" data-testid="workspace-switcher" className="mt-2.5 flex shrink-0 flex-col gap-2.5">
        {DOMAINS.map((item) => {
          const href = onDomainPage && section
            ? section === "design" && item !== "tribology" ? `/${item}/database` : `/${item}/${section}`
            : `/${item}/database`;
          return <RailLink key={item} href={href} label={`${DOMAIN_LABELS[item]} workspace`} displayLabel={DOMAIN_LABELS[item]} active={onDomainPage && item === domain}>
            <span className="text-[27px] font-normal italic leading-none" aria-hidden>{DOMAIN_MARKS[item]}</span>
          </RailLink>;
        })}
        <RailLink href="/afm" label="AFM workspace" displayLabel="AFM" active={onAfmPage}>
          <span className="text-[22px] font-normal italic leading-none" aria-hidden>F</span>
        </RailLink>
      </nav>
      <div className="mx-3 mb-5 mt-[22px] shrink-0 border-t border-[#566169]" />
      <nav aria-label={onMonitorPage ? "Usage monitor sections" : onTeachingPage ? "AI experiment sections" : `${DOMAIN_LABELS[domain]} sections`} data-testid="section-dock" className="flex shrink-0 flex-col gap-2.5">
        {onMonitorPage ? <>
          <RailLink href="/monitor#overview" label="使用概览"><MonitorIcon /></RailLink>
          <RailLink href="/monitor#feedback" label="用户反馈"><FeedbackIcon /></RailLink>
        </> : onTeachingPage ? <>
          <RailLink href="/teaching#data-extraction" label="Data extraction"><ExtractIcon /></RailLink>
          <RailLink href="/teaching#prediction" label="Prediction of μ"><ModelIcon /></RailLink>
        </> : SECTION_LINKS.map((item) => {
          const href = `/${domain}/${item.segment}`;
          return <RailLink key={item.segment} href={href} label={item.label} active={onDomainPage && section === item.segment}>{item.icon}</RailLink>;
        })}
      </nav>
      <div className="mx-3 mb-5 mt-6 shrink-0 border-t border-[#566169]" />
      <div data-testid="utility-dock" className="flex shrink-0 flex-col gap-[17px]">
        <RailLink href={`/${domain}/library`} label="Documents" active={onDomainPage && section === "library"}><LibraryIcon /></RailLink>
        <RailLink href="/teaching" label="AI experiment" active={onTeachingPage}><TeachingIcon /></RailLink>
        {showMonitor ? <RailLink href="/monitor" label="Usage monitor" active={onMonitorPage}><MonitorIcon /></RailLink> : null}
        {effectiveIsAdmin ? <RailLink href="/admin/users" label="Account management" displayLabel="Accounts" active={pathname.startsWith("/admin")}><UsersIcon /></RailLink> : null}
      </div>
      {authEnabled ? (
        effectiveName ? (
          <RailUserMenu name={effectiveName} isAdmin={effectiveIsAdmin} active={first === "account"} />
        ) : (
          <div className="mt-auto shrink-0 pt-4">
            <RailLink href="/login" label="Sign in" active={first === "login"}><UserIcon /></RailLink>
          </div>
        )
      ) : null}
    </aside>
  );
}

/** Green avatar pinned to the bottom of the rail; opens a small account menu. */
function RailUserMenu({ name, isAdmin, active }: { name: string; isAdmin: boolean; active: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  async function signOut() {
    if (busy) return;
    setBusy(true);
    try {
      await authClient.signOut();
      router.replace("/login");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div ref={rootRef} className="relative mt-auto flex shrink-0 flex-col items-center gap-1.5 self-center pb-1 pt-4">
      {open ? (
        <div role="menu" className="absolute bottom-full left-1/2 z-50 mb-2 w-44 -translate-x-1/2 rounded-lg border border-[#566169] bg-[#1f262b] p-1.5 shadow-xl">
          <div className="border-b border-[#41484e] px-2.5 pb-2 pt-1">
            <p className="truncate text-sm font-medium text-white" title={name}>{name}</p>
            <p className="mt-0.5 text-[11px] font-semibold uppercase tracking-wide text-[#8fa3ad]">{isAdmin ? "Admin" : "Student"}</p>
          </div>
          <Link
            href="/account"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="mt-1 block rounded-md px-2.5 py-2 text-sm text-[#dce7ed] transition-colors hover:bg-[#353e45] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-300"
          >
            Account settings
          </Link>
          <button
            type="button"
            role="menuitem"
            onClick={() => { setOpen(false); setFeedbackOpen(true); }}
            className="block w-full rounded-md px-2.5 py-2 text-left text-sm text-[#dce7ed] transition-colors hover:bg-[#353e45] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-300"
          >
            Submit feedback
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={busy}
            onClick={() => void signOut()}
            className="block w-full rounded-md px-2.5 py-2 text-left text-sm text-[#dce7ed] transition-colors hover:bg-[#353e45] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-300 disabled:opacity-50"
          >
            {busy ? "Signing out…" : "Sign out"}
          </button>
        </div>
      ) : null}
      <button
        type="button"
        aria-label="Account menu"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((value) => !value)}
        className={`grid h-11 w-11 place-items-center rounded-full bg-emerald-500 text-white shadow-md transition hover:bg-emerald-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-300 ${active ? "ring-2 ring-teal-300" : ""}`}
      >
        <UserIcon />
      </button>
      <span className="max-w-[130px] truncate text-[11px] leading-4 text-[#dce7ed]" title={name}>{name}</span>
      <FeedbackDialog open={feedbackOpen} onClose={() => setFeedbackOpen(false)} />
    </div>
  );
}

const RAIL_ITEM = "flex h-[46px] w-full shrink-0 items-center gap-3 rounded-md px-3.5 text-sm font-normal transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-300 focus-visible:ring-inset";

function RailLink({ href, label, displayLabel, active = false, truncate = false, children }: { href: string; label: string; displayLabel?: string; active?: boolean; truncate?: boolean; children: ReactNode }) {
  return <Link href={href} aria-label={label} aria-current={active ? "page" : undefined} title={truncate ? displayLabel ?? label : undefined} className={`${RAIL_ITEM} ${active ? "bg-[#3c454c] text-white" : "text-[#dce7ed] hover:bg-[#353e45] hover:text-white"}`}>
    <span className="grid h-6 w-6 shrink-0 place-items-center" aria-hidden>{children}</span>
    <span className={truncate ? "min-w-0 truncate" : "whitespace-nowrap"}>{displayLabel ?? label}</span>
  </Link>;
}

function IonicLinkMark() {
  return <svg width="52" height="46" viewBox="0 0 52 46" fill="none" aria-hidden>
    <circle cx="9" cy="6" r="5" fill="#19b6b8" />
    <path d="M9 20v15M25 6v23c0 5 2 6 7 6h12" stroke="#19b6b8" strokeWidth="9" strokeLinecap="round" strokeLinejoin="round" />
  </svg>;
}

function HomeIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M4 10.7L12 4l8 6.7v7.8a1.5 1.5 0 01-1.5 1.5h-13A1.5 1.5 0 014 18.5v-7.8z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}

function ExtractIcon() {
  return <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden><path d="M6 2.5h8l5 5v13H6a1.5 1.5 0 0 1-1.5-1.5V4A1.5 1.5 0 0 1 6 2.5ZM14 2.5v5h5" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" /></svg>;
}

function DatabaseIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden>
      <ellipse cx="12" cy="5.7" rx="7" ry="2.7" stroke="currentColor" strokeWidth="1.8" />
      <path d="M5 5.7v6c0 1.5 3.1 2.7 7 2.7s7-1.2 7-2.7v-6M5 11.7v6c0 1.5 3.1 2.7 7 2.7s7-1.2 7-2.7v-6" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

function ModelIcon() {
  return <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden><path d="M5 21v-6M11 21V8M18 21V2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>;
}

function MonitorIcon() {
  return <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden><path d="M4 20V10m6 10V4m6 16v-7m5 7H3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>;
}

function FeedbackIcon() {
  return <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden><path d="M5 4h14a2 2 0 012 2v10a2 2 0 01-2 2H9l-5 3V6a2 2 0 012-2ZM8 9h9M8 13h6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function LibraryIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M6.5 4h8.8L18 6.7V20H6.5A1.5 1.5 0 015 18.5v-13A1.5 1.5 0 016.5 4z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M15 4v3h3M8.5 11h6.5M8.5 14.5h6.5M8.5 18h4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function TeachingIcon() {
  return <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden><path d="m2 8 10-5 10 5-10 5-10-5Zm4 2v7c3 3 9 3 12 0v-7M22 8v7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function UserIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="8" r="3.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M5.5 20a6.5 6.5 0 0113 0" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function UsersIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="9" cy="8" r="3" stroke="currentColor" strokeWidth="1.7" />
      <path d="M3.5 19a5.5 5.5 0 0111 0" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M16 5.5a3 3 0 010 5.8M17.5 14.2a5.5 5.5 0 013 4.8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

