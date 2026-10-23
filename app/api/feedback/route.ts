import { NextRequest, NextResponse } from "next/server";
import { getOptionalApiSession, isAppAuthEnabled } from "@/lib/auth.server";
import { createFeedback, FEEDBACK_KINDS, type FeedbackKind } from "@/lib/usage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Signed-in users (students and administrators) submit feedback here. */
export async function POST(request: NextRequest) {
  const access = await getOptionalApiSession(request);
  if (!access.ok) return access.response;
  if (isAppAuthEnabled() && !access.session) {
    return NextResponse.json({ error: "Please sign in to submit feedback." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }

  let body: { kind?: unknown; text?: unknown };
  try {
    body = (await request.json()) as { kind?: unknown; text?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const kind = FEEDBACK_KINDS.includes(body.kind as FeedbackKind) ? (body.kind as FeedbackKind) : null;
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!kind) return NextResponse.json({ error: "Choose a feedback type." }, { status: 400 });
  if (!text || text.length > 1000) return NextResponse.json({ error: "Feedback must be 1-1000 characters." }, { status: 400 });

  const user = access.session?.user as { id?: string; name?: string | null; displayUsername?: string | null; username?: string | null; email?: string | null } | undefined;
  const created = createFeedback(
    user?.id ? { id: user.id, name: user.name || user.displayUsername || user.username || user.email || "用户" } : null,
    kind,
    text
  );
  return NextResponse.json({ ok: true, feedback: created });
}
