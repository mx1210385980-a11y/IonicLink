import { NextRequest, NextResponse } from "next/server";
import {
  TEACHING_FIELDS,
  getDefaultTeachingDashboard,
  rescoreErroredTeachingSubmissions,
  reviewTeachingSubmission,
  TeachingReviewValidationError,
  type TeachingScores,
} from "@/lib/teaching";
import { rejectCrossOriginMutation, requireTeachingRole } from "../_auth";
import {
  internalTeachingErrorResponse,
  readTeachingJson,
  teachingRequestErrorResponse,
} from "../_route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isTeachingScores(value: unknown): value is TeachingScores {
  if (!isRecord(value)) return false;
  const fields = new Set<string>(TEACHING_FIELDS.map((field) => field.key));
  return Object.entries(value).every(
    ([key, score]) =>
      fields.has(key) &&
      (score === "correct" || score === "incorrect" || score === "pending")
  );
}

export async function GET(request: NextRequest) {
  const session = requireTeachingRole(request, "teacher");
  if (session instanceof NextResponse) return session;
  try {
    rescoreErroredTeachingSubmissions(20);
    return NextResponse.json(getDefaultTeachingDashboard());
  } catch (error) {
    return internalTeachingErrorResponse(
      "load default teaching dashboard",
      error,
      { status: 503, message: "教学实验看板暂不可用，请稍后重试。" }
    );
  }
}

export async function POST(request: NextRequest) {
  const rejected = rejectCrossOriginMutation(request);
  if (rejected) return rejected;
  const session = requireTeachingRole(request, "teacher");
  if (session instanceof NextResponse) return session;
  let body: Record<string, unknown> | null;
  try {
    const parsed = await readTeachingJson(request);
    body = isRecord(parsed) ? parsed : null;
  } catch (error) {
    return teachingRequestErrorResponse(error) ?? internalTeachingErrorResponse(
      "read teaching admin request",
      error,
      { message: "读取教师操作请求失败，请稍后重试。" }
    );
  }
  if (body?.action !== "review") {
    return NextResponse.json({ error: "未知操作。" }, { status: 400 });
  }
  if (
    typeof body.submissionId !== "string" ||
    body.submissionId.length === 0 ||
    body.submissionId.length > 128 ||
    (body.humanScores !== undefined && !isTeachingScores(body.humanScores)) ||
    (body.aiScores !== undefined && !isTeachingScores(body.aiScores))
  ) {
    return NextResponse.json({ error: "审核数据无效。" }, { status: 400 });
  }
  try {
    reviewTeachingSubmission(
      body.submissionId,
      (body.humanScores ?? {}) as TeachingScores,
      (body.aiScores ?? {}) as TeachingScores
    );
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof TeachingReviewValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return internalTeachingErrorResponse(
      "review teaching submission",
      error,
      { message: "教师操作失败，请稍后重试。" }
    );
  }
}
