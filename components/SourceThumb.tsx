"use client";

import { useState } from "react";
import { DEFAULT_DOMAIN, type Domain } from "@/lib/domain";

/**
 * First-page thumbnail of a source PDF. Clicking opens the Source Viewer at
 * page 1 (reusing the same drawer used for provenance), so the library doubles
 * as a way to browse uploaded papers.
 */
export function SourceThumb({
  id,
  filename,
  page = 1,
  domain = DEFAULT_DOMAIN,
}: {
  id: string;
  filename: string;
  page?: number;
  domain?: Domain;
}) {
  const [error, setError] = useState(false);
  return (
    <button
      type="button"
      onClick={() =>
        window.dispatchEvent(
          new CustomEvent("ioniclink:source", {
            detail: { sourceId: id, field: "page", value: filename, prov: { page }, domain },
          })
        )
      }
      title={`Open ${filename}`}
      className="group/thumb relative block h-28 w-20 shrink-0 overflow-hidden rounded-lg border border-slate-200 bg-slate-50 transition hover:border-cyan-300 hover:shadow-card"
    >
      {error ? (
        <span className="grid h-full w-full place-items-center text-ink-300">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
            <path d="M7 3h7l5 5v13H7a2 2 0 01-2-2V5a2 2 0 012-2z" stroke="currentColor" strokeWidth="1.6" />
            <path d="M14 3v5h5" stroke="currentColor" strokeWidth="1.6" />
          </svg>
        </span>
      ) : (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={`/api/${domain}/source/${encodeURIComponent(id)}/page/${page}?scale=1`}
          alt={`${filename} page ${page}`}
          loading="lazy"
          className="h-full w-full object-cover object-top transition group-hover/thumb:scale-[1.03]"
          onError={() => setError(true)}
        />
      )}
      <span className="absolute inset-x-0 bottom-0 bg-ink-900/55 py-0.5 text-center text-[9px] font-bold text-white opacity-0 transition group-hover/thumb:opacity-100">
        open
      </span>
    </button>
  );
}
