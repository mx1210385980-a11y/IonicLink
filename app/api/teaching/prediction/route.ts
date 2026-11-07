import { NextRequest, NextResponse } from "next/server";
import { liveCaller } from "@/app/api/teaching/live/_auth";
import { rejectCrossOriginMutation } from "@/app/api/teaching/_auth";
import { readTeachingJson } from "@/app/api/teaching/_route";
import { labError } from "@/app/api/teaching/lab/_helpers";
import { createPredictionSubmission, listPredictionSubmissions } from "@/lib/teaching/predictionStore";
import type { PredictionSubmissionInput } from "@/lib/teaching/predictionShared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_PREDICTION_REQUEST_BYTES = 2_700_000;

export async function GET(request: NextRequest) {
  try {
    const caller = await liveCaller(request);
    if (!caller) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
    return NextResponse.json({
      role: caller.admin ? "teacher" : "student",
      submissions: listPredictionSubmissions(caller.admin ? undefined : caller.userKey),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return labError(error);
  }
}

export async function POST(request: NextRequest) {
  const rejected = rejectCrossOriginMutation(request);
  if (rejected) return rejected;
  try {
    const caller = await liveCaller(request);
    if (!caller) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
    if (caller.admin) return NextResponse.json({ error: "Only student accounts can submit experiment reflections." }, { status: 403 });
    const body = await readTeachingJson(request, MAX_PREDICTION_REQUEST_BYTES);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Invalid request data format.");
    const input = body as Record<string, unknown>;
    const submission = createPredictionSubmission(
      { userKey: caller.userKey, studentName: caller.alias },
      { screenshot: input.screenshot, reflection: input.reflection, parameters: input.parameters } satisfies PredictionSubmissionInput,
    );
    return NextResponse.json(submission, { status: 201 });
  } catch (error) {
    return labError(error);
  }
}
