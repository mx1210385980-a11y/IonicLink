import { NextRequest, NextResponse } from "next/server";
import { getOptionalApiSession, isAppAuthEnabled } from "@/lib/auth.server";
import { recordPageView } from "@/lib/usage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_PATH_LENGTH = 200;

/** Client beacon: records one page view per navigation for the usage monitor. */
export async function POST(request: NextRequest) {
  let pagePath = "";
  try {
    const body = (await request.json()) as { path?: unknown };
    pagePath = typeof body.path === "string" ? body.path.slice(0, MAX_PATH_LENGTH) : "";
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  if (!pagePath.startsWith("/") || pagePath.startsWith("//") || pagePath.startsWith("/api")) {
    return NextResponse.json({ error: "Invalid path." }, { status: 400 });
  }

  const access = await getOptionalApiSession(request);
  if (!access.ok) return access.response;
  if (isAppAuthEnabled() && !access.session) {
    // Anonymous browsing is still counted, under the shared "游客" identity.
  }
  const user = access.session?.user as { id?: string; name?: string | null; displayUsername?: string | null; username?: string | null; email?: string | null } | undefined;
  recordPageView(
    user?.id ? { id: user.id, name: user.name || user.displayUsername || user.username || user.email || "用户" } : null,
    pagePath
  );
  return new NextResponse(null, { status: 204 });
}
