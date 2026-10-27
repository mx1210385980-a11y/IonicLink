import type { NextRequest } from "next/server";
import { getAppSession, isAppAuthEnabled, sessionHasAdminRole } from "@/lib/auth.server";

export type LiveCaller = { admin: boolean; userKey: string; alias: string };

/** Live experiments use platform accounts directly; no teaching cookie is involved. */
export async function liveCaller(request: NextRequest): Promise<LiveCaller | null> {
  if (!isAppAuthEnabled()) return { admin: true, userKey: "local-teacher", alias: "Instructor" };
  const session = await getAppSession(request.headers);
  if (!session) return null;
  const user = session.user as { id?: string; name?: string; username?: string | null; email?: string };
  return {
    admin: sessionHasAdminRole(session),
    userKey: String(user.id ?? user.email ?? ""),
    alias: user.name || user.username || user.email || "Student",
  };
}
