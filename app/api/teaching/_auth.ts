import { NextRequest, NextResponse } from "next/server";
import { getAppSession, isAppAuthEnabled, sessionHasAdminRole } from "@/lib/auth.server";
import { getTeachingSession, type TeachingRole, type TeachingSession } from "@/lib/teaching";
import { internalTeachingErrorResponse } from "./_route";

export const TEACHING_COOKIE = "ioniclink_teaching_session";

export function sessionFromRequest(request: NextRequest): TeachingSession | null {
  return getTeachingSession(request.cookies.get(TEACHING_COOKIE)?.value);
}

/** True when the caller is signed in to the platform (always true when app auth is disabled). */
export async function platformSignedIn(request: NextRequest): Promise<boolean> {
  if (!isAppAuthEnabled()) return true;
  return Boolean(await getAppSession(request.headers));
}

/** True when the caller is a platform administrator (always true when app auth is disabled). */
export async function platformSessionIsAdmin(request: NextRequest): Promise<boolean> {
  if (!isAppAuthEnabled()) return true;
  const session = await getAppSession(request.headers);
  return sessionHasAdminRole(session);
}

/** Display name of the signed-in platform administrator, for review attribution. */
export async function platformAdminLabel(request: NextRequest): Promise<string> {
  if (!isAppAuthEnabled()) return "teacher";
  const session = await getAppSession(request.headers);
  const user = session?.user as { name?: string; username?: string | null; email?: string } | undefined;
  return user?.name || user?.username || user?.email || "teacher";
}

export async function requireTeachingRole(
  request: NextRequest,
  role: TeachingRole
): Promise<TeachingSession | NextResponse> {
  let session: TeachingSession | null;
  try {
    session = sessionFromRequest(request);
  } catch (error) {
    return internalTeachingErrorResponse(
      "read teaching session",
      error,
      { message: "Lab authentication is temporarily unavailable. Try again later." }
    );
  }
  if (!session) {
    // A platform administrator is an instructor even without a teaching cookie.
    if (role === "teacher" && (await platformSessionIsAdmin(request))) {
      return { role: "teacher", projectId: null, participantId: null };
    }
    return NextResponse.json({ error: "Sign in to the teaching lab first." }, { status: 401 });
  }
  if (session.role !== role) {
    return NextResponse.json({ error: "Your account does not have permission for this action." }, { status: 403 });
  }
  return session;
}

export function rejectCrossOriginMutation(request: NextRequest): NextResponse | null {
  const origin = request.headers.get("origin");
  if (!origin) return null;
  try {
    const source = new URL(origin);
    const target = new URL(request.url);
    const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
    const requestHost = forwardedHost || request.headers.get("host") || target.host;
    const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
    const requestProtocol = forwardedProto ? `${forwardedProto}:` : target.protocol;
    if (source.host === requestHost && source.protocol === requestProtocol) return null;
  } catch {
    // Invalid origins are rejected below.
  }
  return NextResponse.json({ error: "Request origin validation failed." }, { status: 403 });
}

function secureCookieFor(request: NextRequest): boolean {
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  return (forwardedProto ? `${forwardedProto}:` : request.nextUrl.protocol) === "https:";
}

export function withTeachingCookie(
  response: NextResponse,
  token: string,
  request: NextRequest
): NextResponse {
  response.cookies.set(TEACHING_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: secureCookieFor(request),
    path: "/",
    maxAge: 14 * 24 * 60 * 60,
  });
  return response;
}

export function clearTeachingCookie(response: NextResponse, request: NextRequest): NextResponse {
  response.cookies.set(TEACHING_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: secureCookieFor(request),
    path: "/",
    maxAge: 0,
  });
  return response;
}
