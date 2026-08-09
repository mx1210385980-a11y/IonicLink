import { NextRequest, NextResponse } from "next/server";
import {
  createTeachingSession,
  deleteTeachingSession,
  joinDefaultTeachingExperiment,
  normalizeStudentAlias,
  teacherLoginConfigured,
  verifyTeacherPassword,
} from "@/lib/teaching";
import {
  TEACHING_COOKIE,
  clearTeachingCookie,
  rejectCrossOriginMutation,
  withTeachingCookie,
} from "../_auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const rejected = rejectCrossOriginMutation(request);
  if (rejected) return rejected;
  const body = (await request.json().catch(() => null)) as
    | {
        role?: unknown;
        studentAlias?: string;
        password?: string;
      }
    | null;
  if (body?.role !== "student" && body?.role !== "teacher") {
    return NextResponse.json({ error: "请选择学生或教师入口。" }, { status: 400 });
  }

  if (body.role === "teacher") {
    try {
      if (!teacherLoginConfigured()) {
        return NextResponse.json(
          { error: "服务器尚未配置 TEACHING_TEACHER_PASSWORD。" },
          { status: 503 }
        );
      }
      if (!verifyTeacherPassword(body.password ?? "")) {
        return NextResponse.json({ error: "教师密码错误。" }, { status: 401 });
      }
      const token = createTeachingSession({ role: "teacher", projectId: null, participantId: null });
      return withTeachingCookie(NextResponse.json({ redirect: "/teaching/admin" }), token, request);
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "教师登录失败。" },
        { status: 500 }
      );
    }
  }

  let studentAlias: string;
  try {
    studentAlias = normalizeStudentAlias(body.studentAlias ?? "");
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "学生标识无效。" },
      { status: 400 }
    );
  }

  try {
    const joined = joinDefaultTeachingExperiment(studentAlias);
    const token = createTeachingSession({
      role: "student",
      projectId: joined.projectId,
      participantId: joined.participantId,
    });
    return withTeachingCookie(NextResponse.json({ redirect: "/teaching/student" }), token, request);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "进入教学实验失败。" },
      { status: 503 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  const rejected = rejectCrossOriginMutation(request);
  if (rejected) return rejected;
  deleteTeachingSession(request.cookies.get(TEACHING_COOKIE)?.value);
  return clearTeachingCookie(NextResponse.json({ ok: true }), request);
}
