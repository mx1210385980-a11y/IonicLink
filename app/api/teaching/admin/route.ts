import { NextRequest, NextResponse } from "next/server";
import {
  addTeachingPaper,
  createTeachingProject,
  getTeachingAdminDashboard,
  reviewTeachingSubmission,
  type TeachingScores,
} from "@/lib/teaching";
import { rejectCrossOriginMutation, requireTeachingRole } from "../_auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const session = requireTeachingRole(request, "teacher");
  if (session instanceof NextResponse) return session;
  return NextResponse.json(
    getTeachingAdminDashboard(request.nextUrl.searchParams.get("project"))
  );
}

export async function POST(request: NextRequest) {
  const rejected = rejectCrossOriginMutation(request);
  if (rejected) return rejected;
  const session = requireTeachingRole(request, "teacher");
  if (session instanceof NextResponse) return session;
  const body = (await request.json().catch(() => null)) as
    | {
        action?: "create-project" | "add-paper" | "review";
        name?: string;
        inviteCode?: string;
        projectId?: string;
        recordId?: string;
        paperNo?: string;
        sourceUrl?: string;
        submissionId?: string;
        humanScores?: TeachingScores;
        aiScores?: TeachingScores;
      }
    | null;
  try {
    if (body?.action === "create-project") {
      const projectId = createTeachingProject({
        name: body.name ?? "",
        inviteCode: body.inviteCode ?? "",
      });
      return NextResponse.json({ projectId });
    }
    if (body?.action === "add-paper") {
      if (!body.projectId) throw new Error("请先选择项目。");
      const paperId = addTeachingPaper({
        projectId: body.projectId,
        recordId: body.recordId ?? "",
        paperNo: body.paperNo ?? "",
        sourceUrl: body.sourceUrl,
      });
      return NextResponse.json({ paperId });
    }
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
    const rawMessage = error instanceof Error ? error.message : "教师操作失败。";
    const message = /UNIQUE constraint failed: teaching_papers\.project_id, teaching_papers\.paper_no/i.test(rawMessage)
      ? "这个文献编号已经使用，请换一个编号。"
      : rawMessage;
    const status = /UNIQUE constraint|已经使用/i.test(rawMessage) ? 409 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
