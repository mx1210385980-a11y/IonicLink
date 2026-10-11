import { NextRequest, NextResponse } from "next/server";
import {
  createTeachingSession,
  deleteTeachingSession,
  joinDefaultTeachingExperiment,
  joinGroupCrossoverExperiment,
  normalizeStudentAlias,
  teacherLoginConfigured,
  TeachingRosterError,
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
    inviteCode?: unknown;
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
      { message: "Could not read the sign-in request. Try again later." }
    );
  }
  if (body?.role !== "student" && body?.role !== "teacher") {
    return NextResponse.json({ error: "Choose the student or instructor entry." }, { status: 400 });
  }

  if (body.role === "teacher") {
    if (typeof body.password !== "string") {
      return NextResponse.json({ error: "Enter the instructor password." }, { status: 400 });
    }
    try {
      if (!teacherLoginConfigured()) {
        return NextResponse.json(
          { error: "TEACHING_TEACHER_PASSWORD is not configured on the server." },
          { status: 503 }
        );
      }
      if (!verifyTeacherPassword(body.password)) {
        return NextResponse.json({ error: "Incorrect instructor password." }, { status: 401 });
      }
      const token = createTeachingSession({ role: "teacher", projectId: null, participantId: null });
      return withTeachingCookie(NextResponse.json({ redirect: "/teaching/admin" }), token, request);
    } catch (error) {
      return internalTeachingErrorResponse(
        "create teacher session",
        error,
        { message: "Instructor sign-in failed. Try again later." }
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
      { error: error instanceof Error ? error.message : "Invalid student ID." },
      { status: 400 }
    );
  }

  const inviteCode = typeof body.inviteCode === "string" ? body.inviteCode.trim() : "";
  try {
    const joined = inviteCode
      ? joinGroupCrossoverExperiment(inviteCode, studentAlias)
      : joinDefaultTeachingExperiment(studentAlias);
    const token = createTeachingSession({
      role: "student",
      projectId: joined.projectId,
      participantId: joined.participantId,
    });
    return withTeachingCookie(NextResponse.json({ redirect: "/teaching/student" }), token, request);
  } catch (error) {
    if (error instanceof TeachingRosterError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    return internalTeachingErrorResponse(
      "join teaching experiment",
      error,
      { status: 503, message: "The teaching lab is temporarily unavailable. Try again later." }
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
      { message: "Could not sign out of the teaching lab. Try again later." }
    );
  }
}
