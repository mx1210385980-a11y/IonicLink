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

export function isTeachingHeartbeatEligible(input: {
  enabled: boolean;
  visible: boolean;
  now: number;
  lastActivityAt: number;
}): boolean {
  return input.enabled && input.visible && input.now - input.lastActivityAt <= IDLE_AFTER_MS;
}

export function teachingHeartbeatSkipSucceeded(
  eligible: boolean,
  finalFlush: boolean
): boolean {
  return eligible || !finalFlush;
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
  minimumOneSecond?: boolean;
}): TeachingHeartbeatPayload | null {
  if (!isTeachingHeartbeatEligible(input)) return null;
  const elapsedMilliseconds = input.now - input.lastHeartbeatAt;
  const elapsedSeconds = input.minimumOneSecond && elapsedMilliseconds > 0
    ? Math.max(1, Math.round(elapsedMilliseconds / 1_000))
    : Math.round(elapsedMilliseconds / 1_000);
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

export function createTeachingPageNonce(): string {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID === "function") return cryptoApi.randomUUID();
  if (typeof cryptoApi?.getRandomValues === "function") {
    const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
  }
  throw new Error("Secure random identifiers are unavailable in this browser.");
}

export function buildTeachingHeartbeatEventId(
  pageNonce: string,
  roundNo: 1 | 2,
  sequence: number
): string {
  return `teaching-${pageNonce}-${roundNo}-${sequence.toString(36)}`;
}

export function selectTeachingHeartbeatAttempt(
  pending: TeachingHeartbeatPayload | null,
  create: () => TeachingHeartbeatPayload | null
): TeachingHeartbeatPayload | null {
  return pending ?? create();
}

export async function flushTeachingHeartbeatBeforeSubmit(input: {
  currentInFlight: () => Promise<boolean> | null;
  hasPending: () => boolean;
  send: () => Promise<boolean>;
}): Promise<boolean> {
  const inFlight = input.currentInFlight();
  if (inFlight) await inFlight;
  if (input.hasPending() && !(await input.send())) return false;
  return input.send();
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
