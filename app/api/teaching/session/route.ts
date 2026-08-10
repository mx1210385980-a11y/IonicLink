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
import {
  internalTeachingErrorResponse,
  readTeachingJson,
  teachingRequestErrorResponse,
} from "../_route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const rejected = rejectCrossOriginMutation(request);
  if (rejected) return rejected;
  let body: {
    role?: unknown;
    studentAlias?: unknown;
    password?: unknown;
  } | null;
  try {
    const parsed = await readTeachingJson(request);
    body = parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as typeof body
      : null;
  } catch (error) {
    return teachingRequestErrorResponse(error) ?? internalTeachingErrorResponse(
      "read teaching session request",
      error,
      { message: "读取登录请求失败，请稍后重试。" }
    );
  }
  if (body?.role !== "student" && body?.role !== "teacher") {
    return NextResponse.json({ error: "请选择学生或教师入口。" }, { status: 400 });
  }

  if (body.role === "teacher") {
    if (typeof body.password !== "string") {
      return NextResponse.json({ error: "请输入教师密码。" }, { status: 400 });
    }
    try {
      if (!teacherLoginConfigured()) {
        return NextResponse.json(
          { error: "服务器尚未配置 TEACHING_TEACHER_PASSWORD。" },
          { status: 503 }
        );
      }
      if (!verifyTeacherPassword(body.password)) {
        return NextResponse.json({ error: "教师密码错误。" }, { status: 401 });
      }
      const token = createTeachingSession({ role: "teacher", projectId: null, participantId: null });
      return withTeachingCookie(NextResponse.json({ redirect: "/teaching/admin" }), token, request);
    } catch (error) {
      return internalTeachingErrorResponse(
        "create teacher session",
        error,
        { message: "教师登录失败，请稍后重试。" }
      );
    }
  }

  let studentAlias: string;
  try {
    studentAlias = normalizeStudentAlias(
      typeof body.studentAlias === "string" ? body.studentAlias : ""
    );
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
    return internalTeachingErrorResponse(
      "join default teaching experiment",
      error,
      { status: 503, message: "教学实验暂不可用，请稍后重试。" }
    );
  }
}

export async function DELETE(request: NextRequest) {
  const rejected = rejectCrossOriginMutation(request);
  if (rejected) return rejected;
  try {
    deleteTeachingSession(request.cookies.get(TEACHING_COOKIE)?.value);
    return clearTeachingCookie(NextResponse.json({ ok: true }), request);
  } catch (error) {
    return internalTeachingErrorResponse(
      "delete teaching session",
      error,
      { message: "退出教学实验失败，请稍后重试。" }
    );
  }
}
