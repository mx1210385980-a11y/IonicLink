import { toNextJsHandler } from "better-auth/next-js";
import { NextResponse } from "next/server";
import { auditAuthResponse, auth, ensureAuthReady } from "@/lib/auth.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handlers = toNextJsHandler(auth);

function unavailable(error: unknown): NextResponse {
  console.error("[auth] route initialization failed", error);
  return NextResponse.json(
    { error: "登录服务暂时不可用。" },
    { status: 503, headers: { "Cache-Control": "no-store" } }
  );
}

export async function GET(request: Request): Promise<Response> {
  try {
    await ensureAuthReady();
    return handlers.GET(request);
  } catch (error) {
    return unavailable(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    await ensureAuthReady();
    const response = await handlers.POST(request);
    auditAuthResponse(request, response);
    return response;
  } catch (error) {
    const response = unavailable(error);
    auditAuthResponse(request, response);
    return response;
  }
}
