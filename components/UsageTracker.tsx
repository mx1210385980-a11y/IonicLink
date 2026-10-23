"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

/** Sends one page-view beacon per client-side navigation for the usage monitor. */
export function UsageTracker() {
  const pathname = usePathname();

  useEffect(() => {
    if (!pathname || pathname === "/login") return;
    void fetch("/api/usage/track", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: pathname }),
      keepalive: true,
    }).catch(() => {
      // Monitoring must never break navigation; failures are silent.
    });
  }, [pathname]);

  return null;
}
