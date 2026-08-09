import { NextRequest, NextResponse } from "next/server";
import {
  TEACHING_FIELDS,
  getCurrentTeachingRound,
  recordTeachingHeartbeat,
  saveCurrentTeachingDraft,
  submitCurrentTeachingRound,
  TeachingRoundConflictError,
  type TeachingAnswers,
  type TeachingFieldKey,
  type TeachingStudentState,
} from "@/lib/teaching";
import { rejectCrossOriginMutation, requireTeachingRole } from "../_auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ActiveTeachingState = Extract<TeachingStudentState, { status: "active" }>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isTeachingAnswers(value: unknown): value is TeachingAnswers {
  if (!isRecord(value)) return false;
  const allowedFields = new Set<string>(TEACHING_FIELDS.map((field) => field.key));
  for (const [key, answer] of Object.entries(value)) {
    if (!allowedFields.has(key) || !isRecord(answer) || typeof answer.value !== "string") {
      return false;
    }
    if (answer.page !== undefined && typeof answer.page !== "string") return false;
    if (answer.evidence !== undefined && typeof answer.evidence !== "string") return false;
  }
  return true;
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
  const state = session.participantId ? getCurrentTeachingRound(session.participantId) : null;
  if (!state) return NextResponse.json({ error: "未找到分配的教学任务。" }, { status: 404 });
  return NextResponse.json(state);
}

export async function PATCH(request: NextRequest) {
  const rejected = rejectCrossOriginMutation(request);
  if (rejected) return rejected;
  const session = requireTeachingRole(request, "student");
  if (session instanceof NextResponse) return session;
  const body = (await request.json().catch(() => null)) as
    | { version?: unknown; answers?: unknown }
    | null;
  if (!session.participantId) {
    return NextResponse.json({ error: "学生会话已失效。" }, { status: 401 });
  }
  if (
    !Number.isInteger(body?.version) ||
    Number(body?.version) < 0 ||
    !isTeachingAnswers(body?.answers)
  ) {
    return NextResponse.json({ error: "草稿数据不完整。" }, { status: 400 });
  }
  const expectedVersion = body.version as number;
  const existingConflict = stateConflict(session.participantId, { version: expectedVersion });
  if (existingConflict) return existingConflict;
  try {
    return NextResponse.json(
      saveCurrentTeachingDraft(session.participantId, expectedVersion, body.answers)
    );
  } catch (error) {
    const racedConflict = stateConflict(session.participantId, { version: expectedVersion });
    if (racedConflict) return racedConflict;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "保存草稿失败。" },
      { status: 400 }
    );
  }
}

export async function POST(request: NextRequest) {
  const rejected = rejectCrossOriginMutation(request);
  if (rejected) return rejected;
  const session = requireTeachingRole(request, "student");
  if (session instanceof NextResponse) return session;
  if (!session.participantId) return NextResponse.json({ error: "学生会话已失效。" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as unknown;
  if (!isRecord(body) || (body.action !== "heartbeat" && body.action !== "submit")) {
    return NextResponse.json({ error: "未知的学生操作。" }, { status: 400 });
  }

  if (body.action === "heartbeat") {
    const fieldKeys = new Set<string>(TEACHING_FIELDS.map((field) => field.key));
    if (
      typeof body.eventId !== "string" ||
      (body.roundNo !== 1 && body.roundNo !== 2) ||
      typeof body.clientAt !== "string" ||
      !Number.isInteger(body.activeDeltaSeconds) ||
      Number(body.activeDeltaSeconds) < 0 ||
      typeof body.visible !== "boolean" ||
      (body.fieldKey !== undefined &&
        (typeof body.fieldKey !== "string" || !fieldKeys.has(body.fieldKey)))
    ) {
      return NextResponse.json({ error: "心跳数据不完整。" }, { status: 400 });
    }
    const roundNo = body.roundNo as 1 | 2;
    const existingConflict = stateConflict(session.participantId, { roundNo });
    if (existingConflict) return existingConflict;
    try {
      return NextResponse.json(
        recordTeachingHeartbeat(session.participantId, {
          eventId: body.eventId,
          roundNo,
          clientAt: body.clientAt,
          activeDeltaSeconds: body.activeDeltaSeconds as number,
          visible: body.visible,
          fieldKey: body.fieldKey as TeachingFieldKey | undefined,
        })
      );
    } catch (error) {
      const racedConflict = stateConflict(session.participantId, { roundNo });
      if (racedConflict) return racedConflict;
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "记录有效时间失败。" },
        { status: 400 }
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
  const before = getCurrentTeachingRound(session.participantId);
  if (!before) return NextResponse.json({ error: "未找到当前教学轮次。" }, { status: 404 });
  if (before.status === "active") {
    const existingConflict = stateConflict(session.participantId, expected);
    if (existingConflict) return existingConflict;
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
      const transition = committedTransition(
        before,
        getCurrentTeachingRound(session.participantId)
      );
      if (transition) return NextResponse.json(transition);
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "提交失败。" },
      { status: 500 }
    );
  }
}
