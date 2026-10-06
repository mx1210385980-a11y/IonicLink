import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createTeachingSession, getTeachingSession } from "@/lib/teaching";
import { createSimpleExperiment, getCurrentSimpleStudentId, joinSimpleGroup, getSimpleStudent, joinSimpleExperiment, listSimpleExperiments } from "@/lib/teaching/simpleStore";
import { rejectCrossOriginMutation, TEACHING_COOKIE, withTeachingCookie } from "../../_auth";
import { labBody, labError } from "../_helpers";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const rejected = rejectCrossOriginMutation(request); if (rejected) return rejected;
  try {
    const { mode, groupNo } = await labBody(request);
    if (groupNo === undefined && mode !== "ai" && mode !== "manual" && mode !== "teacher") {
      return NextResponse.json({ error: "Choose AI, manual, or instructor entry." }, { status: 400 });
    }
    if (mode === "teacher") {
      const currentToken = request.cookies.get(TEACHING_COOKIE)?.value;
      const token = getTeachingSession(currentToken)?.role === "teacher" ? currentToken!
        : createTeachingSession({ role: "teacher", projectId: null, participantId: null });
      return withTeachingCookie(NextResponse.json({ redirect: "/teaching/admin" }), token, request);
    }
    if (groupNo !== undefined) {
      if (typeof groupNo !== "number" || !Number.isInteger(groupNo) || groupNo < 1 || groupNo > 4) throw new Error("Choose group 1, 2, 3, or 4.");
      const latest = listSimpleExperiments()[0];
      const experiment = latest?.design === "crossover" ? latest : createSimpleExperiment({ name: "Group crossover lab", design: "crossover" });
      const savedCookie = `ioniclink_teaching_group_${groupNo}_session`;
      let participantId: string | undefined;
      for (const cookie of [savedCookie, TEACHING_COOKIE]) {
        const previous = getTeachingSession(request.cookies.get(cookie)?.value);
        if (previous?.role === "student" && previous.projectId === experiment.id && previous.participantId) {
          try { const state = getSimpleStudent(getCurrentSimpleStudentId(previous.participantId)); if (state.groupNo === groupNo) { participantId = state.id; break; } } catch { /* Start a new record if the saved assignment no longer exists. */ }
        }
      }
      if (!participantId) participantId = joinSimpleGroup(experiment.id, groupNo, `Student-${randomUUID().slice(0, 8)}`).participantId;
      const token = createTeachingSession({ role: "student", projectId: experiment.id, participantId });
      const response = withTeachingCookie(NextResponse.json({ redirect: "/teaching/student" }), token, request);
      response.cookies.set({ ...response.cookies.get(TEACHING_COOKIE)!, name: savedCookie });
      return response;
    }
    const experiment = listSimpleExperiments()[0];
    if (!experiment) throw new Error("Choose your assigned group number.");
    if (experiment.design === "crossover") throw new Error("Choose your assigned group number.");
    const savedCookie = `ioniclink_teaching_${mode}_session`;
    let token: string | undefined;
    for (const cookie of [savedCookie, TEACHING_COOKIE]) {
      const candidate = request.cookies.get(cookie)?.value;
      const session = getTeachingSession(candidate);
      if (session?.role === "student" && session.projectId === experiment.id && session.participantId) {
        try {
          if (getSimpleStudent(session.participantId).mode === mode) { token = candidate; break; }
        } catch { /* An expired/deleted participant starts a fresh assignment. */ }
      }
    }
    if (!token) {
      const code = mode === "ai" ? experiment.aiInviteCode : experiment.manualInviteCode;
      const student = joinSimpleExperiment(code, `Student-${randomUUID().slice(0, 8)}`);
      token = createTeachingSession({ role: "student", projectId: student.experimentId, participantId: student.participantId });
    }
    const response = withTeachingCookie(NextResponse.json({ redirect: "/teaching/student" }), token, request);
    // Keep each group's progress available when this browser returns to the entry page.
    response.cookies.set({ ...response.cookies.get(TEACHING_COOKIE)!, name: savedCookie });
    return response;
  } catch (error) { return labError(error); }
}
