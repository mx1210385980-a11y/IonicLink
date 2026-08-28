import { TEACHING_FIELDS, type TeachingFieldKey } from "../teachingShared";
import { getTeachingDb } from "./store";

const MAX_EVENT_ID_LENGTH = 128;
const MAX_ACTIVE_DELTA_SECONDS = 20;
const SAFE_EVENT_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const ISO_TIMESTAMP =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const TEACHING_FIELD_KEYS = new Set<TeachingFieldKey>(
  TEACHING_FIELDS.map((field) => field.key)
);

export type TeachingHeartbeatInput = {
  eventId: string;
  roundNo: 1 | 2;
  clientAt: string;
  activeDeltaSeconds: number;
  visible: boolean;
  fieldKey?: TeachingFieldKey;
};

export class TeachingHeartbeatValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TeachingHeartbeatValidationError";
  }
}

function isValidIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = ISO_TIMESTAMP.exec(value);
  if (!match || !Number.isFinite(Date.parse(value))) return false;

  const [, yearText, monthText, dayText, hourText, minuteText, secondText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

  return (
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= daysInMonth[month - 1] &&
    hour >= 0 &&
    hour <= 23 &&
    minute >= 0 &&
    minute <= 59 &&
    second >= 0 &&
    second <= 59
  );
}

export function validateTeachingHeartbeatInput(input: TeachingHeartbeatInput): void {
  if (
    !input ||
    typeof input.eventId !== "string" ||
    input.eventId.length === 0 ||
    input.eventId.length > MAX_EVENT_ID_LENGTH ||
    !SAFE_EVENT_ID.test(input.eventId)
  ) {
    throw new TeachingHeartbeatValidationError("Teaching activity event ID is invalid.");
  }
  if (input.roundNo !== 1 && input.roundNo !== 2) {
    throw new TeachingHeartbeatValidationError("Teaching activity round number must be 1 or 2.");
  }
  if (!isValidIsoTimestamp(input.clientAt)) {
    throw new TeachingHeartbeatValidationError("Teaching activity client timestamp is invalid.");
  }
  if (
    !Number.isFinite(input.activeDeltaSeconds) ||
    !Number.isInteger(input.activeDeltaSeconds) ||
    input.activeDeltaSeconds < 0
  ) {
    throw new TeachingHeartbeatValidationError(
      "Teaching activity delta seconds must be a nonnegative finite integer."
    );
  }
  if (typeof input.visible !== "boolean") {
    throw new TeachingHeartbeatValidationError("Teaching activity visible must be a boolean.");
  }
  if (input.fieldKey !== undefined && !TEACHING_FIELD_KEYS.has(input.fieldKey)) {
    throw new TeachingHeartbeatValidationError("Teaching activity field is invalid.");
  }
}

export function recordTeachingHeartbeat(
  participantId: string,
  input: TeachingHeartbeatInput
): { activeSeconds: number } {
  validateTeachingHeartbeatInput(input);
  const creditedSeconds = input.visible
    ? Math.min(input.activeDeltaSeconds, MAX_ACTIVE_DELTA_SECONDS)
    : 0;
  const store = getTeachingDb();

  return store.transaction(() => {
    const participant = store
      .prepare(
        `SELECT pt.completed_at AS completedAt, pr.id AS projectId
         FROM teaching_participants pt
         JOIN teaching_projects pr ON pr.id = pt.project_id
         WHERE pt.id = ?
           AND pt.sequence_code IN ('manual_then_ai', 'ai_then_manual')
           AND (
             (pr.is_default = 1 AND pr.experiment_kind = 'crossover')
             OR pr.experiment_kind = 'group_crossover'
           )`
      )
      .get(participantId) as { completedAt: string | null; projectId: string } | undefined;
    if (!participant) throw new Error("Teaching participant was not found.");
    if (participant.completedAt) {
      throw new Error("The teaching experiment is already complete and locked.");
    }

    const current = store
      .prepare(
        `SELECT s.id, s.active_seconds AS activeSeconds
         FROM teaching_submissions s
         WHERE s.participant_id = ? AND s.project_id = ?
           AND s.round_no = ? AND s.submitted_at IS NULL
           AND NOT EXISTS (
             SELECT 1 FROM teaching_submissions earlier
             WHERE earlier.participant_id = s.participant_id
               AND earlier.project_id = s.project_id
               AND earlier.submitted_at IS NULL
               AND earlier.round_no IN (1, 2)
               AND earlier.round_no < s.round_no
           )
         LIMIT 1`
      )
      .get(participantId, participant.projectId, input.roundNo) as
      | { id: string; activeSeconds: number }
      | undefined;
    if (!current) {
      throw new Error("No active teaching round is available; the submission is locked.");
    }

    const inserted = store
      .prepare(
        `INSERT OR IGNORE INTO teaching_activity_events
         (id, submission_id, event_type, field_key, client_at, received_at,
          active_delta_seconds, metadata_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.eventId,
        current.id,
        input.fieldKey === undefined ? "heartbeat" : "edit",
        input.fieldKey ?? null,
        input.clientAt,
        new Date().toISOString(),
        creditedSeconds,
        JSON.stringify({ visible: input.visible })
      );

    if (inserted.changes === 1 && creditedSeconds > 0) {
      const updated = store
        .prepare(
          `UPDATE teaching_submissions
           SET active_seconds = active_seconds + ?
           WHERE id = ? AND submitted_at IS NULL`
        )
        .run(creditedSeconds, current.id);
      if (updated.changes !== 1) {
        throw new Error("The active teaching round could not be updated.");
      }
    }

    const activeSeconds = store
      .prepare("SELECT active_seconds FROM teaching_submissions WHERE id = ?")
      .pluck()
      .get(current.id) as number;
    return { activeSeconds };
  }).immediate();
}

export function teachingTimingQuality(
  activeSeconds: number,
  wallSeconds: number
): "valid" | "zero_active" | "excessive_idle" {
  if (activeSeconds <= 0) return "zero_active";
  if (wallSeconds >= 1_200 && wallSeconds > 5 * activeSeconds) return "excessive_idle";
  return "valid";
}
