import { scoreSimpleRows } from "./simpleScoring";
import type { SimpleMode, SimpleRow } from "./simpleShared";
import type { TeachingFieldKey } from "../teachingShared";

export type LiveExperimentStatus = "open" | "running" | "finished";
export type LiveMark = "correct" | "incorrect" | "uncertain";

export type LiveExperiment = {
  id: string;
  name: string;
  groupCount: number;
  status: LiveExperimentStatus;
  paperSourceId: string;
  paperTitle: string;
  gold: SimpleRow[];
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
};

export type LiveParticipant = {
  id: string;
  experimentId: string;
  userKey: string;
  alias: string;
  groupNo: number | null;
  mode: SimpleMode | null;
  status: "waiting" | "idle" | "extracting" | "review" | "submitted";
  rows: SimpleRow[];
  version: number;
  startedAt: string | null;
  extractionAttemptAt: string | null;
  extractedAt: string | null;
  submittedAt: string | null;
  elapsedSeconds: number | null;
  error: string | null;
  overrides: Record<string, LiveMark>;
  reviewNote: string;
  reviewedAt: string | null;
};

export type LiveCell = {
  key: string;
  goldRow: number | null;
  answerRow: number | null;
  field: TeachingFieldKey;
  expected: string;
  actual: string;
  machineCorrect: boolean;
  mark: LiveMark;
};

export type LiveScore = {
  denominator: number;
  correct: number;
  uncertain: number;
  accuracy: number;
  machineAccuracy: number;
  cells: LiveCell[];
};

/** Teacher marks override the automatic comparison; ⭕ keeps a cell out of neither camp. */
export function scoreLive(gold: SimpleRow[], rows: SimpleRow[], overrides: Record<string, LiveMark> = {}): LiveScore {
  const base = scoreSimpleRows(gold, rows);
  const cells = base.cells.map((cell): LiveCell => ({
    key: cell.key, goldRow: cell.goldRow, answerRow: cell.answerRow, field: cell.field,
    expected: cell.expected, actual: cell.actual, machineCorrect: cell.machineCorrect,
    mark: overrides[cell.key] ?? (cell.machineCorrect ? "correct" : "incorrect"),
  }));
  const correct = cells.filter((cell) => cell.mark === "correct").length;
  const uncertain = cells.filter((cell) => cell.mark === "uncertain").length;
  return {
    denominator: base.denominator, correct, uncertain,
    accuracy: base.denominator ? correct / base.denominator : 0,
    machineAccuracy: base.machineAccuracy,
    cells,
  };
}

export type LiveParticipantView = LiveParticipant & { score: LiveScore | null };
export type LiveDashboard = { experiment: LiveExperiment; participants: LiveParticipantView[] };

export type LiveStudentState = {
  participant: LiveParticipantView;
  experiment: Pick<LiveExperiment, "id" | "name" | "status" | "groupCount" | "paperTitle"> & { hasPaper: boolean; hasAnswerKey: boolean };
  joinedCount: number;
};
