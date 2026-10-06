import { NextRequest, NextResponse } from "next/server";
import {
  TEACHING_FIELDS,
  getCurrentTeachingRound,
  recordTeachingHeartbeat,
  saveCurrentTeachingDraft,
  submitCurrentTeachingRound,
  TeachingHeartbeatValidationError,
  TeachingRoundConflictError,
  validateTeachingHeartbeatInput,
  type TeachingAnswers,
  type TeachingHeartbeatInput,
  type TeachingStudentState,
} from "@/lib/teaching";
import { rejectCrossOriginMutation, requireTeachingRole } from "../_auth";
import {
  internalTeachingErrorResponse,
  readTeachingJson,
  teachingRequestErrorResponse,
} from "../_route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ActiveTeachingState = Extract<TeachingStudentState, { status: "active" }>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function teachingAnswersError(value: unknown): string | null {
  if (!isRecord(value)) return "Invalid draft answer format.";
  const allowedFields = new Set<string>(TEACHING_FIELDS.map((field) => field.key));
  for (const [key, answer] of Object.entries(value)) {
    if (!allowedFields.has(key) || !isRecord(answer) || typeof answer.value !== "string") {
      return "Invalid draft answer format.";
    }
    if (answer.page !== undefined && typeof answer.page !== "string") {
      return "Invalid draft answer format.";
    }
    if (answer.evidence !== undefined && typeof answer.evidence !== "string") {
      return "Invalid draft answer format.";
    }
    if (
      answer.value.length > 500 ||
      (typeof answer.page === "string" && answer.page.length > 40) ||
      (typeof answer.evidence === "string" && answer.evidence.length > 2_000)
    ) {
      return "An answer exceeds the allowed length.";
    }
  }
  return null;
}

function conflict(
  kind: "version" | "locked" | "stale_round",
  message: string
): NextResponse {
  return NextResponse.json({ error: message, kind }, { status: 409 });
}

function stateConflict(
  participantId: string,
  expected: { version?: number; roundNo?: 1 | 2 }
): NextResponse | null {
  const state = getCurrentTeachingRound(participantId);
  if (state?.status === "complete") {
    return conflict("locked", "The experiment is complete. Answers are locked.");
  }
  if (!state) return null;
  if (expected.roundNo !== undefined && state.roundNo !== expected.roundNo) {
    return conflict("stale_round", "This request belongs to a completed round.");
  }
  if (expected.version !== undefined && state.version !== expected.version) {
    return conflict("version", "The draft has changed. Refresh before continuing.");
  }
  return null;
}

function committedTransition(
  before: ActiveTeachingState,
  after: TeachingStudentState | null
): ReturnType<typeof submitCurrentTeachingRound> | null {
  if (before.roundNo === 1 && after?.status === "active" && after.roundNo === 2) {
    return { status: "next_round", roundNo: 2 };
  }
  if (before.roundNo === 2 && after?.status === "complete") {
    return { status: "complete", completedAt: after.completedAt };
  }
  return null;
}

export async function GET(request: NextRequest) {
  const session = requireTeachingRole(request, "student");
  if (session instanceof NextResponse) return session;
  try {
    const state = session.participantId ? getCurrentTeachingRound(session.participantId) : null;
    if (!state) return NextResponse.json({ error: "Assigned lab task not found." }, { status: 404 });
    return NextResponse.json(state);
  } catch (error) {
    return internalTeachingErrorResponse(
      "load current student round",
      error,
      { message: "Could not load the lab task. Try again later." }
    );
  }
}

export async function PATCH(request: NextRequest) {
  const rejected = rejectCrossOriginMutation(request);
  if (rejected) return rejected;
  const session = requireTeachingRole(request, "student");
  if (session instanceof NextResponse) return session;
  let body: { version?: unknown; answers?: unknown } | null;
  try {
    const parsed = await readTeachingJson(request);
    body = isRecord(parsed) ? parsed : null;
  } catch (error) {
    return teachingRequestErrorResponse(error) ?? internalTeachingErrorResponse(
      "read student draft request",
      error,
      { message: "Could not read the draft request. Try again later." }
    );
  }
  if (!session.participantId) {
    return NextResponse.json({ error: "Your student session has expired." }, { status: 401 });
  }
  const answersError = teachingAnswersError(body?.answers);
  if (!body || !Number.isInteger(body.version) || Number(body.version) < 0) {
    return NextResponse.json({ error: "Draft data is incomplete." }, { status: 400 });
  }
  if (answersError) return NextResponse.json({ error: answersError }, { status: 400 });
  const expectedVersion = body.version as number;
  try {
    const existingConflict = stateConflict(session.participantId, { version: expectedVersion });
    if (existingConflict) return existingConflict;
    return NextResponse.json(
      saveCurrentTeachingDraft(
        session.participantId,
        expectedVersion,
        body.answers as TeachingAnswers
      )
    );
  } catch (error) {
    try {
      const racedConflict = stateConflict(session.participantId, { version: expectedVersion });
      if (racedConflict) return racedConflict;
    } catch (stateError) {
      return internalTeachingErrorResponse(
        "reload student draft conflict state",
        stateError,
        { message: "Could not save the draft. Try again later." }
      );
    }
    return internalTeachingErrorResponse(
      "save student draft",
      error,
      { message: "Could not save the draft. Try again later." }
    );
  }
}

export async function POST(request: NextRequest) {
  const rejected = rejectCrossOriginMutation(request);
  if (rejected) return rejected;
  const session = requireTeachingRole(request, "student");
  if (session instanceof NextResponse) return session;
  if (!session.participantId) return NextResponse.json({ error: "Your student session has expired." }, { status: 401 });

  let body: unknown;
  try {
    body = await readTeachingJson(request);
  } catch (error) {
    return teachingRequestErrorResponse(error) ?? internalTeachingErrorResponse(
      "read student action request",
      error,
      { message: "Could not read the student request. Try again later." }
    );
  }
  if (!isRecord(body) || (body.action !== "heartbeat" && body.action !== "submit")) {
    return NextResponse.json({ error: "Unknown student action." }, { status: 400 });
  }

  if (body.action === "heartbeat") {
    const heartbeat = {
      eventId: body.eventId,
      roundNo: body.roundNo,
      clientAt: body.clientAt,
      activeDeltaSeconds: body.activeDeltaSeconds,
      visible: body.visible,
      fieldKey: body.fieldKey,
    } as TeachingHeartbeatInput;
    try {
      validateTeachingHeartbeatInput(heartbeat);
    } catch (error) {
      if (error instanceof TeachingHeartbeatValidationError) {
        return NextResponse.json({ error: "Invalid timing heartbeat." }, { status: 400 });
      }
      return internalTeachingErrorResponse(
        "validate student heartbeat",
        error,
        { message: "Could not validate the timing heartbeat. Try again later." }
      );
    }
    const roundNo = heartbeat.roundNo;
    try {
      const existingConflict = stateConflict(session.participantId, { roundNo });
      if (existingConflict) return existingConflict;
      return NextResponse.json(
        recordTeachingHeartbeat(session.participantId, heartbeat)
      );
    } catch (error) {
      try {
        const racedConflict = stateConflict(session.participantId, { roundNo });
        if (racedConflict) return racedConflict;
      } catch (stateError) {
        return internalTeachingErrorResponse(
          "reload student heartbeat conflict state",
          stateError,
          { message: "Could not save active time. Try again later." }
        );
      }
      return internalTeachingErrorResponse(
        "record student heartbeat",
        error,
        { message: "Could not save active time. Try again later." }
      );
    }
  }

  if (
    (body.roundNo !== 1 && body.roundNo !== 2) ||
    !Number.isInteger(body.version) ||
    Number(body.version) < 0
  ) {
    return NextResponse.json(
      { error: "Submission must reference the current round and draft version." },
      { status: 400 }
    );
  }
  const expected = {
    roundNo: body.roundNo as 1 | 2,
    version: body.version as number,
  };
  let before: TeachingStudentState | null;
  try {
    before = getCurrentTeachingRound(session.participantId);
  } catch (error) {
    return internalTeachingErrorResponse(
      "load round before student submit",
      error,
      { message: "Submission failed. Try again later." }
    );
  }
  if (!before) return NextResponse.json({ error: "Current lab round not found." }, { status: 404 });
  if (before.status === "active") {
    try {
      const existingConflict = stateConflict(session.participantId, expected);
      if (existingConflict) return existingConflict;
    } catch (error) {
      return internalTeachingErrorResponse(
        "load student submit conflict state",
        error,
        { message: "Submission failed. Try again later." }
      );
    }
    if (TEACHING_FIELDS.some((field) => !before.answers[field.key]?.value?.trim())) {
      return NextResponse.json(
        { error: "Complete all six required fields before submitting." },
        { status: 400 }
      );
    }
  }
  try {
    return NextResponse.json(submitCurrentTeachingRound(session.participantId, expected));
  } catch (error) {
    if (error instanceof TeachingRoundConflictError) {
      return conflict(error.kind, error.message);
    }
    if (before.status === "active") {
      let after: TeachingStudentState | null;
      try {
        after = getCurrentTeachingRound(session.participantId);
      } catch (stateError) {
        return internalTeachingErrorResponse(
          "reload state after student submit",
          stateError,
          { message: "Submission failed. Try again later." }
        );
      }
      const transition = committedTransition(before, after);
      if (transition) return NextResponse.json(transition);
    }
    return internalTeachingErrorResponse(
      "submit student round",
      error,
      { message: "Submission failed. Try again later." }
    );
  }
}
