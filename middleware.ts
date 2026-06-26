import { NextRequest, NextResponse } from "next/server";
import { isDomain, resolveDomainAlias } from "./lib/domain";

export function middleware(request: NextRequest) {
  const parts = request.nextUrl.pathname.split("/");
  const first = parts[1] ?? "";
  const domain = resolveDomainAlias(first);

  if (domain && !isDomain(first)) {
    const url = request.nextUrl.clone();
    parts[1] = domain;
    url.pathname = parts.join("/") || `/${domain}`;
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}
