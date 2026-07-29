import { NextRequest, NextResponse } from "next/server";
import {
  getStudentWorkspace,
  saveStudentDraft,
  submitStudentWork,
  TeachingConflictError,
  type TeachingAnswers,
} from "@/lib/teaching";
import { rejectCrossOriginMutation, requireTeachingRole } from "../_auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const session = requireTeachingRole(request, "student");
  if (session instanceof NextResponse) return session;
  const workspace = session.participantId ? getStudentWorkspace(session.participantId) : null;
  if (!workspace) return NextResponse.json({ error: "未找到分配的教学任务。" }, { status: 404 });
  return NextResponse.json(workspace);
}
export async function PATCH(request: NextRequest) {
  const rejected = rejectCrossOriginMutation(request);
  if (rejected) return rejected;
  const session = requireTeachingRole(request, "student");
  if (session instanceof NextResponse) return session;
  const body = (await request.json().catch(() => null)) as
    | { version?: number; answers?: TeachingAnswers }
    | null;
  if (!session.participantId || !Number.isInteger(body?.version) || !body?.answers) {
    return NextResponse.json({ error: "草稿数据不完整。" }, { status: 400 });
  }
  try {
    return NextResponse.json(
      saveStudentDraft(session.participantId, body.version as number, body.answers)
    );
  } catch (error) {
    if (error instanceof TeachingConflictError) {
      return NextResponse.json({ error: error.message, kind: error.kind }, { status: 409 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "保存草稿失败。" },
      { status: 400 }
    );
  }
}

export async function POST(request: NextRequest) {
  const rejected = rejectCrossOriginMutation(request);
  if (rejected) return rejected;
  const session = requireTeachingRole(request, "student");
  if (session instanceof NextResponse) return session;
  if (!session.participantId) return NextResponse.json({ error: "学生会话已失效。" }, { status: 401 });
  try {
    return NextResponse.json(submitStudentWork(session.participantId));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "提交失败。" },
      { status: 400 }
    );
  }
}
