"use client";

import { useEffect, useState } from "react";
import { Extractor } from "@/components/Extractor";
import { DEFAULT_DOMAIN, isDomain, type Domain } from "@/lib/domain";

export default function ExtractPage({ params }: { params: { domain: string } }) {
  const domain: Domain = isDomain(params.domain) ? params.domain : DEFAULT_DOMAIN;
  const [live, setLive] = useState<boolean | null>(null);

  useEffect(() => {
    fetch(`/api/${domain}/extract`)
      .then((r) => r.json())
      .then((d) => setLive(d.live))
      .catch(() => setLive(false));
  }, [domain]);

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Extract</h1>
          <p className="mt-1 text-sm text-ink-500">
            Drop one or many PDFs, or paste text. Each is queued and extracted in the background;
            review each paper’s candidates, then commit the ones you want.
          </p>
        </div>
        {live !== null && (
          <span className={`chip ${live ? "border-brand-200 text-brand-700" : "text-ink-400"}`}>
            <span className={`h-2 w-2 rounded-full ${live ? "bg-brand-500" : "bg-amber-400"}`} />
            {live ? "Live AI extraction" : "Mock mode (no API key)"}
          </span>
        )}
      </div>

      <Extractor domain={domain} />
    </div>
  );
}
