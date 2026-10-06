import { TEACHING_FIELDS, type TeachingFieldKey } from "../teachingShared";
export { TEACHING_FIELDS };
export type SimpleRow = Record<TeachingFieldKey, string>;
export type SimpleMode = "ai" | "manual";
export function simpleGroupAssignment(groupNo: number, roundNo: number): { paperNo: number; mode: SimpleMode } {
  if (!Number.isInteger(groupNo) || groupNo < 1 || groupNo > 4 || (roundNo !== 1 && roundNo !== 2)) throw new Error("Invalid group or round");
  return { paperNo: (groupNo <= 2 ? 1 : 2) + (roundNo === 2 ? 2 : 0), mode: (groupNo % 2 === 1) === (roundNo === 1) ? "ai" : "manual" };
}
export type SimpleStatus = "idle" | "extracting" | "review" | "submitted" | "error";
export type SimpleExperiment = {
  design?: "crossover";
  id: string; name: string; sourceId: string; paperTitle: string;
  gold: SimpleRow[]; aiInviteCode: string; manualInviteCode: string; createdAt: string;
};
export type SimplePaperTask = {
  paperNo?: number; contentFingerprint?: string;
  id: string; experimentId: string; sourceId: string; paperTitle: string; fingerprint: string;
  gold: SimpleRow[]; version: number; createdAt: string;
};
export type SimpleCellScore = { key: string; goldRow: number | null; answerRow: number | null;
  field: TeachingFieldKey; expected: string; actual: string; machineCorrect: boolean; correct: boolean };
export type SimpleScore = { version: "field-overlap-v1"; denominator: number; machineCorrect: number;
  correct: number; machineAccuracy: number; accuracy: number; cells: SimpleCellScore[] };
export type SimpleStudent = {
  learnerId?: string; groupNo?: number; roundNo?: number; paperNo?: number;
  taskId?: string;
  paper?: { sourceId: string; paperTitle: string; gold: SimpleRow[] };
  id: string; experimentId: string; studentAlias: string; resumeCode: string; mode: SimpleMode; status: SimpleStatus;
  rows: SimpleRow[]; version: number; startedAt: string | null; extractedAt: string | null;
  extractionAttemptAt: string | null;
  submittedAt: string | null; elapsedSeconds: number | null; error: string | null;
  score: SimpleScore | null; overrides: Record<string, boolean>; reviewNote: string; reviewedAt: string | null;
};
export type SimpleStudentState = Omit<SimpleStudent, "score" | "overrides" | "reviewNote" | "reviewedAt" | "paper"> & {
  rounds?: { id: string; roundNo: number; paperNo: number; mode: SimpleMode; status: SimpleStatus; elapsedSeconds: number | null; result: { machineAccuracy: number; accuracy: number } | null }[];
  task?: { id: string; paperTitle: string };
  paper?: { sourceId: string; paperTitle: string };
  pendingGrade?: boolean;
  experiment: Pick<SimpleExperiment, "id" | "name" | "sourceId" | "paperTitle">;
  result: { machineAccuracy: number; accuracy: number } | null;
};
export type SimpleDashboard = { experiment: SimpleExperiment; students: SimpleStudent[]; tasks: SimplePaperTask[] };
