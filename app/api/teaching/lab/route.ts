import { NextRequest, NextResponse } from "next/server";
import { rejectCrossOriginMutation, sessionFromRequest } from "../_auth";
import { createSimpleExperiment, getSimpleDashboard, getSimpleStudent, listSimpleExperiments,
  reviewSimpleStudent, saveSimpleDraft, submitSimpleStudent, setSimpleStudentGold, setSimpleTaskGold, nextSimpleRound } from "@/lib/teaching/simpleStore";
import type { SimpleRow } from "@/lib/teaching/simpleShared";
import { labBody, labError, labStudentId, checkLabAttempt } from "./_helpers";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const session = sessionFromRequest(request);
    if (!session) return NextResponse.json({ error: "Sign in to the teaching lab first." }, { status: 401 });
    if (session.role === "student") {
      const state = session.participantId ? getSimpleStudent(labStudentId(session.participantId)) : null;
      return state ? NextResponse.json(state) : NextResponse.json({ error: "Rejoin using the group code provided by your instructor." }, { status: 404 });
    }
    const experiments = listSimpleExperiments();
    const id = request.nextUrl.searchParams.get("id") || experiments[0]?.id;
    return NextResponse.json({ experiments, papers: [], dashboard: id ? getSimpleDashboard(id) : null });
  } catch (error) { return labError(error); }
}

export async function POST(request: NextRequest) {
  const rejected = rejectCrossOriginMutation(request); if (rejected) return rejected;
  try {
    const session = sessionFromRequest(request);
    if (!session) return NextResponse.json({ error: "Sign in to the teaching lab first." }, { status: 401 });
    const body = await labBody(request);
    if (session.role === "teacher") {
      if (body.action === "create") {
        const experiment = createSimpleExperiment({ name: body.name as string, design: "crossover" });
        return NextResponse.json(getSimpleDashboard(experiment.id));
      }
      if (body.action === "taskGold") {
        setSimpleTaskGold(body.taskId as string, { version: body.version as number, gold: body.gold as SimpleRow[] });
        return NextResponse.json({ ok: true });
      }
      if (body.action === "gold") {
        setSimpleStudentGold(body.studentId as string, { version: body.version as number, gold: body.gold as SimpleRow[] });
        return NextResponse.json({ ok: true });
      }
      if (body.action === "review") {
        reviewSimpleStudent(body.studentId as string, { version: body.version as number,
          overrides: body.overrides as Record<string, boolean>, note: body.note as string });
        return NextResponse.json({ ok: true });
      }
    } else if (session.participantId) {
      const id = labStudentId(session.participantId);
      checkLabAttempt(id, body.attemptId);
      if (body.action === "nextRound") return NextResponse.json(nextSimpleRound(id, body.version as number));
      if (body.action === "save") return NextResponse.json(saveSimpleDraft(id,
        { version: body.version as number, rows: body.rows as SimpleRow[] }));
      if (body.action === "submit") return NextResponse.json(submitSimpleStudent(id,
        { version: body.version as number, rows: body.rows as SimpleRow[], manualSeconds: body.manualSeconds as number | undefined }));
    }
    return NextResponse.json({ error: "This action is not available for your group." }, { status: 403 });
  } catch (error) { return labError(error); }
}
