"use client";

import { useEffect, useState } from "react";
import { Extractor } from "@/components/Extractor";
import { DEFAULT_DOMAIN, isDomain, type Domain } from "@/lib/domain";

export default function ExtractPage({ params }: { params: { domain: string } }) {
  const domain: Domain = isDomain(params.domain) ? params.domain : DEFAULT_DOMAIN;
  const [live, setLive] = useState<boolean | null>(null);

  useEffect(() => {
    fetch(`/api/${domain}/extract`)
      .then((response) => response.json())
      .then((data) => setLive(data.live))
      .catch(() => setLive(false));
  }, [domain]);

  useEffect(() => {
    const previousBodyOverflow = document.body.style.overflowX;
    const previousRootOverflow = document.documentElement.style.overflowX;
    document.body.style.overflowX = "clip";
    document.documentElement.style.overflowX = "clip";
    return () => {
      document.body.style.overflowX = previousBodyOverflow;
      document.documentElement.style.overflowX = previousRootOverflow;
    };
  }, []);

  return (
    <div className="relative left-1/2 -mb-16 -mt-6 w-[100dvw] max-w-[100dvw] -translate-x-1/2 lg:w-[calc(100dvw-5rem)] lg:max-w-[calc(100dvw-5rem)]">
      <Extractor domain={domain} live={live} />
    </div>
  );
}
