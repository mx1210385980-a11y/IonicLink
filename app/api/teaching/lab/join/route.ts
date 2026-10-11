import { NextRequest, NextResponse } from "next/server";
import { createTeachingSession } from "@/lib/teaching";
import { joinSimpleExperiment } from "@/lib/teaching/simpleStore";
import { rejectCrossOriginMutation, withTeachingCookie } from "../../_auth";
import { labBody, labError } from "../_helpers";
export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  const rejected = rejectCrossOriginMutation(request); if (rejected) return rejected;
  try {
    const body = await labBody(request);
    const student = joinSimpleExperiment(body.inviteCode as string, body.studentAlias as string, body.resumeCode as string | undefined);
    const token = createTeachingSession({ role: "student", projectId: student.experimentId, participantId: student.participantId });
    return withTeachingCookie(NextResponse.json({ redirect: "/teaching/student" }), token, request);
  } catch (error) { return labError(error); }
}
