"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
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

const SECTION_LINKS = [
  { segment: "extract", label: "Extract", icon: <ExtractIcon /> },
  { segment: "database", label: "Database", icon: <DatabaseIcon /> },
] as const;

export function WorkspaceNavigationRail() {
  const pathname = usePathname();
  const parts = pathname.split("/");
  const first = parts[1];
  const onDomainPage = isDomain(first);
  const domain: Domain = onDomainPage ? first : DEFAULT_DOMAIN;
  const section = parts[2] ?? "";
  const onTeachingPage = first === "teaching";
  const onMonitorPage = first === "monitor";
  const onHomePage = pathname === "/";
  const onAccountPage = first === "account";

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
        <RailLink href="/monitor" label="Usage monitor" active={onMonitorPage}><MonitorIcon /></RailLink>
        <RailAuthControls active={onAccountPage} />
      </div>
    </aside>
  );
}

const RAIL_ITEM = "flex h-[46px] w-full shrink-0 items-center gap-3 rounded-md px-3.5 text-sm font-normal transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-300 focus-visible:ring-inset";

function RailLink({ href, label, displayLabel, active = false, children }: { href: string; label: string; displayLabel?: string; active?: boolean; children: ReactNode }) {
  return <Link href={href} aria-label={label} aria-current={active ? "page" : undefined} className={`${RAIL_ITEM} ${active ? "bg-[#3c454c] text-white" : "text-[#dce7ed] hover:bg-[#353e45] hover:text-white"}`}>
    <span className="grid h-6 w-6 shrink-0 place-items-center" aria-hidden>{children}</span>
    <span className="whitespace-nowrap">{displayLabel ?? label}</span>
  </Link>;
}

function IonicLinkMark() {
  return <svg width="52" height="46" viewBox="0 0 52 46" fill="none" aria-hidden>
    <circle cx="9" cy="6" r="5" fill="#19b6b8" />
    <path d="M9 20v15M25 6v23c0 5 2 6 7 6h12" stroke="#19b6b8" strokeWidth="9" strokeLinecap="round" strokeLinejoin="round" />
  </svg>;
}

function RailAuthControls({ active }: { active: boolean }) {
  return <RailLink href="/account" label="Account" active={active}><UserIcon /></RailLink>;
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

