import { NextRequest, NextResponse } from "next/server";
import { getTeachingSession, type TeachingRole, type TeachingSession } from "@/lib/teaching";

export const TEACHING_COOKIE = "ioniclink_teaching_session";

export function sessionFromRequest(request: NextRequest): TeachingSession | null {
  return getTeachingSession(request.cookies.get(TEACHING_COOKIE)?.value);
}

export function requireTeachingRole(
  request: NextRequest,
  role: TeachingRole
): TeachingSession | NextResponse {
  const session = sessionFromRequest(request);
  if (!session) return NextResponse.json({ error: "请先登录教学实验。" }, { status: 401 });
  if (session.role !== role) return NextResponse.json({ error: "当前账号没有此操作权限。" }, { status: 403 });
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
  return NextResponse.json({ error: "请求来源校验失败。" }, { status: 403 });
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
