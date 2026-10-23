import { NextRequest, NextResponse } from "next/server";
import { requireAppApiRole } from "@/lib/auth.server";
import { replyFeedback } from "@/lib/usage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Administrators reply to a feedback entry; the reply is stored in usage.db. */
export async function POST(request: NextRequest) {
  const access = await requireAppApiRole(request, "admin");
  if (!access.ok) return access.response;

  let body: { id?: unknown; reply?: unknown };
  try {
    body = (await request.json()) as { id?: unknown; reply?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const id = typeof body.id === "string" ? body.id.trim() : "";
  const reply = typeof body.reply === "string" ? body.reply.trim() : "";
  if (!id) return NextResponse.json({ error: "Feedback id is required." }, { status: 400 });
  if (!reply || reply.length > 1000) return NextResponse.json({ error: "Replies must be 1-1000 characters." }, { status: 400 });

  const admin = access.session?.user as { name?: string | null; displayUsername?: string | null; username?: string | null; email?: string | null } | undefined;
  const repliedBy = admin?.name || admin?.displayUsername || admin?.username || admin?.email || "管理员";
  if (!replyFeedback(id, reply, repliedBy)) {
    return NextResponse.json({ error: "That feedback entry does not exist." }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
