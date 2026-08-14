const FALLBACK_REDIRECT = "/";

/** Keep post-login navigation on this origin and out of the login loop. */
export function safeAuthRedirect(value: unknown, fallback = FALLBACK_REDIRECT): string {
  if (typeof value !== "string") return fallback;
  const candidate = value.trim();
  if (!candidate.startsWith("/") || candidate.startsWith("//") || candidate.includes("\\")) {
    return fallback;
  }

  try {
    const url = new URL(candidate, "http://ioniclink.local");
    if (url.origin !== "http://ioniclink.local" || url.pathname === "/login") return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}
