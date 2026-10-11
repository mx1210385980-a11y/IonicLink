import { NextRequest, NextResponse } from "next/server";
import { getCurrentSimpleStudentId, getSimpleStudent } from "@/lib/teaching/simpleStore";
import { readTeachingJson } from "../_route";
export async function labBody(request: NextRequest): Promise<Record<string, unknown>> {
  const body = await readTeachingJson(request, 1024 * 1024);
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Invalid request data format.");
  return body as Record<string, unknown>;
}
export function labError(error: unknown): NextResponse {
  const status = error && typeof error === "object" && "status" in error ? Number(error.status) : 400;
  const message = error instanceof Error ? error.message : "Action failed. Try again.";
  // Avoid exposing filesystem/database internals to students.
  if (/SQLITE|ENOENT|EPERM|EACCES|UNIQUE constraint/i.test(message)) {
    console.error("[teaching lab]", error);
    return NextResponse.json({ error: "Lab data is temporarily unavailable. Refresh or contact your instructor." }, { status: 503 });
  }
  return NextResponse.json({ error: message }, { status: [400, 401, 403, 404, 409, 413, 503].includes(status) ? status : 400 });
}

export function labStudentId(participantId: string): string { return getCurrentSimpleStudentId(participantId); }
export function checkLabAttempt(id: string, attemptId: unknown): void {
  const state = getSimpleStudent(id);
  if (state.groupNo && attemptId !== state.id) throw new Error("The round has changed. Refresh before continuing.");
}
