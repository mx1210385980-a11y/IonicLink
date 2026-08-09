import { NextRequest, NextResponse } from "next/server";
import {
  getDefaultTeachingDashboard,
  rescoreErroredTeachingSubmissions,
  reviewTeachingSubmission,
  type TeachingScores,
} from "@/lib/teaching";
import { rejectCrossOriginMutation, requireTeachingRole } from "../_auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const session = requireTeachingRole(request, "teacher");
  if (session instanceof NextResponse) return session;
  rescoreErroredTeachingSubmissions(20);
  return NextResponse.json(getDefaultTeachingDashboard());
}

export async function POST(request: NextRequest) {
  const rejected = rejectCrossOriginMutation(request);
  if (rejected) return rejected;
  const session = requireTeachingRole(request, "teacher");
  if (session instanceof NextResponse) return session;
  const body = (await request.json().catch(() => null)) as
    | {
        action?: unknown;
        submissionId?: string;
        humanScores?: TeachingScores;
        aiScores?: TeachingScores;
      }
    | null;
  try {
    if (body?.action === "review") {
      if (!body.submissionId) throw new Error("缺少提交记录。");
      reviewTeachingSubmission(
        body.submissionId,
        body.humanScores ?? {},
        body.aiScores ?? {}
      );
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "未知操作。" }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "教师操作失败。" },
      { status: 400 }
    );
  }
}
