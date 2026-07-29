"use client";

import { useEffect, useState } from "react";
import { Extractor } from "@/components/Extractor";
import { DatasetImporter } from "@/components/DatasetImporter";
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
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Extract</h1>
          <p className="mt-1 text-sm text-ink-500">
            Import structured paper datasets directly, or extract candidates from PDFs and pasted text.
            Every record lands in Review before publication.
          </p>
        </div>
        {live !== null && (
          <span
            className={`chip shrink-0 ${
              live ? "border-brand-200 text-brand-700" : "border-amber-200 bg-amber-50 text-amber-800"
            }`}
            title={live ? "Records can be reviewed and published after extraction." : "Offline mock candidates can be reviewed, but cannot be published as Checked records."}
          >
            <span className={`h-2 w-2 rounded-full ${live ? "bg-brand-500" : "bg-amber-400"}`} />
            {live ? "Live AI extraction" : "Demo mode · cannot publish"}
          </span>
        )}
      </div>

      <DatasetImporter domain={domain} />
      <Extractor domain={domain} />
    </div>
  );
}
