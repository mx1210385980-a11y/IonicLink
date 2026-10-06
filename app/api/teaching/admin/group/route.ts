import { TeachingInputError } from "@/lib/teaching/inputError";
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
      if (!projectId) return badRequest("Experiment ID is required.");
      return NextResponse.json({ roster: listGroupRoster(projectId) });
    }
    if (action === "dashboard") {
      const projectId = request.nextUrl.searchParams.get("projectId") ?? "";
      if (!projectId) return badRequest("Experiment ID is required.");
      return NextResponse.json(getGroupCrossoverDashboard(projectId));
    }
    return badRequest("Unknown query.");
  } catch (error) {
    return internalTeachingErrorResponse(
      "load group crossover data",
      error,
      { status: 503, message: "Group experiment data is temporarily unavailable. Try again later." }
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
      { message: "Could not read the instructor request. Try again later." }
    );
  }
  if (!body) return badRequest("Invalid request data.");
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
        return badRequest("Invalid experiment creation data.");
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
        return badRequest("Invalid roster data.");
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
        return badRequest("Invalid roster data.");
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
        return badRequest("Invalid review data.");
      }
      reviewTeachingSubmission(
        body.submissionId,
        (body.humanScores ?? {}) as TeachingScores,
        (body.aiScores ?? {}) as TeachingScores
      );
      return NextResponse.json({ ok: true });
    }

    return badRequest("Unknown action.");
  } catch (error) {
    if (error instanceof TeachingReviewValidationError) {
      return badRequest(error.message);
    }
    // Only known validation errors expose their messages to the client.
    if (error instanceof TeachingInputError) {
      return badRequest(error.message);
    }
    return internalTeachingErrorResponse(
      "group crossover admin action",
      error,
      { message: "Instructor action failed. Try again later." }
    );
  }
}
