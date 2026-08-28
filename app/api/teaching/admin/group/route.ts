import { NextRequest, NextResponse } from "next/server";
import {
  TEACHING_FIELDS,
  createGroupCrossoverExperiment,
  deleteGroupRosterEntry,
  getGroupCrossoverDashboard,
  importGroupRoster,
  listCheckedTribologyRecords,
  listGroupCrossoverExperiments,
  listGroupRoster,
  reviewTeachingSubmission,
  TeachingReviewValidationError,
  type TeachingScores,
} from "@/lib/teaching";
import { rejectCrossOriginMutation, requireTeachingRole } from "../../_auth";
import {
  internalTeachingErrorResponse,
  readTeachingJson,
  teachingRequestErrorResponse,
} from "../../_route";

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

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

export async function GET(request: NextRequest) {
  const session = requireTeachingRole(request, "teacher");
  if (session instanceof NextResponse) return session;
  const action = request.nextUrl.searchParams.get("action") ?? "list";
  try {
    if (action === "list") {
      return NextResponse.json({ experiments: listGroupCrossoverExperiments() });
    }
    if (action === "checkedRecords") {
      return NextResponse.json({ records: listCheckedTribologyRecords() });
    }
    if (action === "roster") {
      const projectId = request.nextUrl.searchParams.get("projectId") ?? "";
      if (!projectId) return badRequest("缺少实验编号。");
      return NextResponse.json({ roster: listGroupRoster(projectId) });
    }
    if (action === "dashboard") {
      const projectId = request.nextUrl.searchParams.get("projectId") ?? "";
      if (!projectId) return badRequest("缺少实验编号。");
      return NextResponse.json(getGroupCrossoverDashboard(projectId));
    }
    return badRequest("未知查询。");
  } catch (error) {
    return internalTeachingErrorResponse(
      "load group crossover data",
      error,
      { status: 503, message: "分组实验数据暂不可用,请稍后重试。" }
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
      "read group crossover request",
      error,
      { message: "读取教师操作请求失败,请稍后重试。" }
    );
  }
  if (!body) return badRequest("请求数据无效。");
  const action = typeof body.action === "string" ? body.action : "";

  try {
    if (action === "create") {
      if (
        typeof body.name !== "string" ||
        typeof body.inviteCode !== "string" ||
        !Number.isFinite(body.groupCount) ||
        !Array.isArray(body.recordIds) ||
        !body.recordIds.every((id) => typeof id === "string")
      ) {
        return badRequest("创建实验的数据无效。");
      }
      const created = createGroupCrossoverExperiment({
        name: body.name,
        inviteCode: body.inviteCode,
        groupCount: Number(body.groupCount),
        recordIds: body.recordIds as string[],
      });
      return NextResponse.json({ ok: true, projectId: created.projectId });
    }

    if (action === "importRoster") {
      if (
        typeof body.projectId !== "string" ||
        !Array.isArray(body.entries) ||
        !body.entries.every(
          (entry) =>
            isRecord(entry) &&
            typeof entry.studentName === "string" &&
            Number.isFinite(entry.groupNo)
        )
      ) {
        return badRequest("名单数据无效。");
      }
      const result = importGroupRoster(
        body.projectId,
        (body.entries as Array<{ studentName: string; groupNo: number }>).map((entry) => ({
          studentName: entry.studentName,
          groupNo: Number(entry.groupNo),
        }))
      );
      return NextResponse.json({ ok: true, ...result });
    }

    if (action === "deleteRosterEntry") {
      if (typeof body.projectId !== "string" || typeof body.rosterId !== "string") {
        return badRequest("名单数据无效。");
      }
      deleteGroupRosterEntry(body.projectId, body.rosterId);
      return NextResponse.json({ ok: true });
    }

    if (action === "review") {
      if (
        typeof body.submissionId !== "string" ||
        body.submissionId.length === 0 ||
        body.submissionId.length > 128 ||
        (body.humanScores !== undefined && !isTeachingScores(body.humanScores)) ||
        (body.aiScores !== undefined && !isTeachingScores(body.aiScores))
      ) {
        return badRequest("审核数据无效。");
      }
      reviewTeachingSubmission(
        body.submissionId,
        (body.humanScores ?? {}) as TeachingScores,
        (body.aiScores ?? {}) as TeachingScores
      );
      return NextResponse.json({ ok: true });
    }

    return badRequest("未知操作。");
  } catch (error) {
    if (error instanceof TeachingReviewValidationError) {
      return badRequest(error.message);
    }
    // Module validation errors carry user-facing Chinese messages; anything
    // else is internal and must not leak details to the client.
    if (error instanceof Error && /[一-鿿]/u.test(error.message)) {
      return badRequest(error.message);
    }
    return internalTeachingErrorResponse(
      "group crossover admin action",
      error,
      { message: "教师操作失败,请稍后重试。" }
    );
  }
}
