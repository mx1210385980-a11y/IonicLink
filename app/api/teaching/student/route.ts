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
  if (!isRecord(value)) return "草稿答案格式无效。";
  const allowedFields = new Set<string>(TEACHING_FIELDS.map((field) => field.key));
  for (const [key, answer] of Object.entries(value)) {
    if (!allowedFields.has(key) || !isRecord(answer) || typeof answer.value !== "string") {
      return "草稿答案格式无效。";
    }
    if (answer.page !== undefined && typeof answer.page !== "string") {
      return "草稿答案格式无效。";
    }
    if (answer.evidence !== undefined && typeof answer.evidence !== "string") {
      return "草稿答案格式无效。";
    }
    if (
      answer.value.length > 500 ||
      (typeof answer.page === "string" && answer.page.length > 40) ||
      (typeof answer.evidence === "string" && answer.evidence.length > 2_000)
    ) {
      return "单个答案超出允许长度。";
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
    return conflict("locked", "教学实验已完成，答案已锁定。");
  }
  if (!state) return null;
  if (expected.roundNo !== undefined && state.roundNo !== expected.roundNo) {
    return conflict("stale_round", "该请求属于已结束的轮次。");
  }
  if (expected.version !== undefined && state.version !== expected.version) {
    return conflict("version", "草稿已有更新，请刷新后继续。");
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
    if (!state) return NextResponse.json({ error: "未找到分配的教学任务。" }, { status: 404 });
    return NextResponse.json(state);
  } catch (error) {
    return internalTeachingErrorResponse(
      "load current student round",
      error,
      { message: "读取教学任务失败，请稍后重试。" }
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
      { message: "读取草稿请求失败，请稍后重试。" }
    );
  }
  if (!session.participantId) {
    return NextResponse.json({ error: "学生会话已失效。" }, { status: 401 });
  }
  const answersError = teachingAnswersError(body?.answers);
  if (!body || !Number.isInteger(body.version) || Number(body.version) < 0) {
    return NextResponse.json({ error: "草稿数据不完整。" }, { status: 400 });
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
        { message: "保存草稿失败，请稍后重试。" }
      );
    }
    return internalTeachingErrorResponse(
      "save student draft",
      error,
      { message: "保存草稿失败，请稍后重试。" }
    );
  }
}

export async function POST(request: NextRequest) {
  const rejected = rejectCrossOriginMutation(request);
  if (rejected) return rejected;
  const session = requireTeachingRole(request, "student");
  if (session instanceof NextResponse) return session;
  if (!session.participantId) return NextResponse.json({ error: "学生会话已失效。" }, { status: 401 });

  let body: unknown;
  try {
    body = await readTeachingJson(request);
  } catch (error) {
    return teachingRequestErrorResponse(error) ?? internalTeachingErrorResponse(
      "read student action request",
      error,
      { message: "读取学生操作请求失败，请稍后重试。" }
    );
  }
  if (!isRecord(body) || (body.action !== "heartbeat" && body.action !== "submit")) {
    return NextResponse.json({ error: "未知的学生操作。" }, { status: 400 });
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
        return NextResponse.json({ error: "心跳数据无效。" }, { status: 400 });
      }
      return internalTeachingErrorResponse(
        "validate student heartbeat",
        error,
        { message: "校验心跳数据失败，请稍后重试。" }
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
          { message: "记录有效时间失败，请稍后重试。" }
        );
      }
      return internalTeachingErrorResponse(
        "record student heartbeat",
        error,
        { message: "记录有效时间失败，请稍后重试。" }
      );
    }
  }

  if (
    (body.roundNo !== 1 && body.roundNo !== 2) ||
    !Number.isInteger(body.version) ||
    Number(body.version) < 0
  ) {
    return NextResponse.json(
      { error: "提交必须绑定当前轮次和草稿版本。" },
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
      { message: "提交失败，请稍后重试。" }
    );
  }
  if (!before) return NextResponse.json({ error: "未找到当前教学轮次。" }, { status: 404 });
  if (before.status === "active") {
    try {
      const existingConflict = stateConflict(session.participantId, expected);
      if (existingConflict) return existingConflict;
    } catch (error) {
      return internalTeachingErrorResponse(
        "load student submit conflict state",
        error,
        { message: "提交失败，请稍后重试。" }
      );
    }
    if (TEACHING_FIELDS.some((field) => !before.answers[field.key]?.value?.trim())) {
      return NextResponse.json(
        { error: "提交前请完成全部 6 个必填字段。" },
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
          { message: "提交失败，请稍后重试。" }
        );
      }
      const transition = committedTransition(before, after);
      if (transition) return NextResponse.json(transition);
    }
    return internalTeachingErrorResponse(
      "submit student round",
      error,
      { message: "提交失败，请稍后重试。" }
    );
  }
}
