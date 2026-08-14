"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AuthControls } from "@/components/auth/AuthControls";
import { DEFAULT_DOMAIN, DOMAINS, isDomain, type Domain } from "@/lib/domain";

const SUBROUTES = [
  { seg: "", label: "Home" },
  { seg: "extract", label: "Extract" },
  { seg: "database", label: "Database" },
  { seg: "design", label: "Design" },
  { seg: "library", label: "Library" },
];

const DOMAIN_LABELS: Record<Domain, string> = {
  tribology: "Tribology",
  conductivity: "Conductivity",
  diffusion: "Diffusion",
};

export function TopNav() {
  const pathname = usePathname();
  const parts = pathname.split("/");
  const first = parts[1];
  const onDomainPage = isDomain(first);
  const onTeachingPage = first === "teaching";
  const domain: Domain = onDomainPage ? (first as Domain) : DEFAULT_DOMAIN;
  const sub = parts[2] ?? "";

  return (
    <header className="sticky top-0 z-30 overflow-x-clip border-b border-ink-200/80 bg-[#fbfcfc]/80 backdrop-blur-xl lg:hidden">
      <div className="mx-auto flex min-h-[4.25rem] w-full max-w-7xl flex-col gap-2 px-4 py-2.5 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <Link href="/" className="group flex shrink-0 items-center gap-2 rounded-[9px] focus:outline-none focus:ring-2 focus:ring-brand-200">
            <LogoMark />
            <span className="hidden text-base font-semibold tracking-tight text-ink-950 sm:inline">
              Ionic<span className="text-brand-700">Link</span>
            </span>
          </Link>

          {!onTeachingPage ? (
            <div aria-label="Property workspace" className="flex shrink-0 rounded-[9px] border border-ink-200/90 bg-white/90 p-0.5 text-xs shadow-sm">
              {DOMAINS.map((d) => {
                const active = onDomainPage && d === domain;
                const href = sub === "design" && d !== "tribology" ? `/${d}` : `/${d}${sub ? "/" + sub : ""}`;
                return (
                  <Link
                    key={d}
                    href={href}
                    className={`min-h-8 rounded-[7px] px-2.5 py-1.5 font-semibold transition focus:outline-none focus:ring-2 focus:ring-brand-200 ${
                      active ? "bg-ink-950 text-white shadow-sm" : "text-ink-700 hover:bg-ink-50 hover:text-brand-700"
                    }`}
                  >
                    {DOMAIN_LABELS[d]}
                  </Link>
                );
              })}
            </div>
          ) : null}
          <Link
            href="/teaching"
            aria-label="教学实验"
            title="教学实验"
            className={`inline-flex min-h-8 shrink-0 items-center justify-center rounded-[8px] px-2 py-1.5 text-xs font-semibold transition focus:outline-none focus:ring-2 focus:ring-brand-200 sm:px-2.5 ${
              onTeachingPage
                ? "bg-brand-50 text-brand-800 ring-1 ring-brand-100"
                : "text-ink-700 hover:bg-white/80 hover:text-brand-700"
            }`}
          >
            <span className="sm:hidden" aria-hidden><TeachingGlyph /></span>
            <span className="hidden sm:inline">教学实验</span>
          </Link>
        </div>

        <div className="flex w-full min-w-0 items-center justify-end gap-2">
          {onDomainPage && (
            <nav
              aria-label={`${DOMAIN_LABELS[domain]} sections`}
              className="flex min-w-0 flex-1 items-center justify-start gap-0.5 overflow-x-auto rounded-[9px] sm:gap-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            >
              {SUBROUTES.map((r) => {
                const href = r.seg === "design" ? "/tribology/design" : r.seg ? `/${domain}/${r.seg}` : `/${domain}`;
                const active = r.seg ? sub === r.seg : sub === "";
                return (
                  <Link
                    key={r.seg || "home"}
                    href={href}
                    className={`min-h-8 shrink-0 whitespace-nowrap rounded-[8px] px-1.5 py-1.5 text-xs font-medium transition focus:outline-none focus:ring-2 focus:ring-brand-200 sm:min-h-9 sm:px-3 sm:py-2 sm:text-sm ${
                      active ? "bg-brand-50 text-brand-800 ring-1 ring-brand-100" : "text-ink-700 hover:bg-white/80 hover:text-brand-700"
                    }`}
                  >
                    {r.label}
                  </Link>
                );
              })}
            </nav>
          )}
          <AuthControls />
        </div>
      </div>
    </header>
  );
}

function LogoMark() {
  return (
    <span className="grid h-8 w-8 place-items-center rounded-[9px] bg-brand-700 text-white shadow-[0_10px_22px_-16px_rgba(15,118,110,0.9)] transition group-hover:bg-brand-800">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
        <circle cx="6" cy="12" r="3" fill="currentColor" opacity="0.92" />
        <circle cx="18" cy="7" r="2.4" fill="currentColor" opacity="0.72" />
        <circle cx="17" cy="17" r="2.4" fill="currentColor" opacity="0.72" />
        <path d="M8.5 11L15.5 7.8M8.6 13L15.2 16" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
    </span>
  );
}

function TeachingGlyph() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M4.5 5.5A2.5 2.5 0 017 3h5v17H7a2.5 2.5 0 01-2.5-2.5v-12zM19.5 5.5A2.5 2.5 0 0017 3h-5v17h5a2.5 2.5 0 002.5-2.5v-12z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
    </svg>
  );
}
