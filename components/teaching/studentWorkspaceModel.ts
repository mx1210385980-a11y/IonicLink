import type { TeachingAnswer, TeachingFieldKey } from "@/lib/teachingShared";
import {
  normalizeTeachingText,
  teachingAnswersEquivalent,
} from "@/lib/teaching/answerComparison";

const IDLE_AFTER_MS = 120_000;
const MAX_HEARTBEAT_SECONDS = 15;

export type TeachingHeartbeatPayload = {
  action: "heartbeat";
  eventId: string;
  roundNo: 1 | 2;
  clientAt: string;
  activeDeltaSeconds: number;
  visible: true;
  fieldKey?: TeachingFieldKey;
};

export type TeachingSubmitPayload = {
  action: "submit";
  roundNo: 1 | 2;
  version: number;
};

export function normalizeTeachingDraftText(value: string | undefined): string {
  return normalizeTeachingText(value ?? "");
}

export function hasTeachingAnswerChanged(
  answer: TeachingAnswer | undefined,
  initial: TeachingAnswer | undefined
): boolean {
  return !teachingAnswersEquivalent(answer, initial);
}

export function buildTeachingHeartbeat(input: {
  enabled: boolean;
  visible: boolean;
  now: number;
  lastActivityAt: number;
  lastHeartbeatAt: number;
  eventId: string;
  roundNo: 1 | 2;
  fieldKey?: TeachingFieldKey;
}): TeachingHeartbeatPayload | null {
  if (!input.enabled || !input.visible || input.now - input.lastActivityAt > IDLE_AFTER_MS) {
    return null;
  }
  const elapsedSeconds = Math.round((input.now - input.lastHeartbeatAt) / 1_000);
  if (elapsedSeconds <= 0) return null;
  const payload: TeachingHeartbeatPayload = {
    action: "heartbeat",
    eventId: input.eventId,
    roundNo: input.roundNo,
    clientAt: new Date(input.now).toISOString(),
    activeDeltaSeconds: Math.min(MAX_HEARTBEAT_SECONDS, elapsedSeconds),
    visible: true,
  };
  if (input.fieldKey !== undefined) payload.fieldKey = input.fieldKey;
  return payload;
}

export function buildTeachingSubmitPayload(
  roundNo: 1 | 2,
  version: number
): TeachingSubmitPayload {
  return { action: "submit", roundNo, version };
}

export function isTeachingWorkspaceIdle(now: number, lastActivityAt: number): boolean {
  return now - lastActivityAt > IDLE_AFTER_MS;
}

export function isTeachingInteractionLocked(locked: boolean, submitting: boolean): boolean {
  return locked || submitting;
}
