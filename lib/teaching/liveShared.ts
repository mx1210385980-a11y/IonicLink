import { scoreSimpleRows } from "./simpleScoring";
import { LIVE_EXTRACTION_FIELDS, type LiveExtractionFieldKey, type LiveRow } from "./liveFields";

export type LiveMode = "manual" | "ai";
export type LiveWorkStatus = "waiting" | "idle" | "extracting" | "review" | "submitted";
export type LiveExperimentStatus = "open" | "running" | "finished";
export type LiveMark = "correct" | "incorrect" | "uncertain";
export type LiveCellScore = {
  key: string; goldRow: number | null; answerRow: number | null;
  field: LiveExtractionFieldKey; expected: string; actual: string;
  machineCorrect: boolean; correct: boolean; mark: LiveMark;
};
export type LiveScore = {
  version: "field-overlap-v1"; denominator: number;
  machineCorrect: number; correct: number; machineAccuracy: number; accuracy: number;
  uncertain: number; cells: LiveCellScore[];
};

export type LivePaper = {
  sourceId: string;
  paperTitle: string;
  gold: LiveRow[];
};

export type LiveExperiment = {
  id: string;
  name: string;
  groupCount: number;
  status: LiveExperimentStatus;
  /** One paper per group; currentRound is zero-based. */
  papers: LivePaper[];
  currentRound: number;
  /** Legacy fields are kept synchronized with the current paper for old stored payloads. */
  paperSourceId: string;
  paperTitle: string;
  gold: LiveRow[];
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
};

export type LiveRoundResult = {
  round: number;
  paperIndex: number;
  mode: LiveMode;
  status: LiveWorkStatus;
  rows: LiveRow[];
  startedAt: string | null;
  submittedAt: string | null;
  elapsedSeconds: number | null;
  overrides: Record<string, LiveMark>;
  reviewNote: string;
  reviewedAt: string | null;
  error: string;
};

export type LiveParticipant = LiveRoundResult & {
  id: string;
  experimentId: string;
  userKey: string;
  alias: string;
  groupNo: number;
  joinedAt: string;
  version: number;
  exitedAt: string | null;
  history: LiveRoundResult[];
};

export type LiveDashboardParticipant = LiveParticipant & {
  score: LiveScore | null;
};
export type LiveParticipantView = LiveDashboardParticipant;
export type LiveDashboard = { experiment: LiveExperiment; participants: LiveDashboardParticipant[] };

export function scoreLive(gold: LiveRow[], rows: LiveRow[], overrides: Record<string, LiveMark> = {}): LiveScore {
  const base = scoreSimpleRows(gold, rows, {}, LIVE_EXTRACTION_FIELDS);
  const cells = base.cells.map((cell) => {
    const override = overrides[cell.key];
    return { ...cell, correct: override ? override === "correct" : cell.correct,
      mark: override ?? (cell.machineCorrect ? "correct" : "incorrect") } as LiveCellScore;
  });
  const correct = cells.filter((cell) => cell.mark === "correct").length;
  const uncertain = cells.filter((cell) => cell.mark === "uncertain").length;
  return { ...base, cells, correct, uncertain, accuracy: base.denominator ? correct / base.denominator : 0 };
}

/** Groups and papers rotate together; odd groups begin manually and even groups with AI. */
export function liveAssignment(groupNo: number, round: number, groupCount: number) {
  return {
    paperIndex: (groupNo - 1 + round) % groupCount,
    mode: ((groupNo - 1 + round) % 2 === 0 ? "manual" : "ai") as LiveMode,
  };
}

export type LiveStudentState = {
  experiment: {
    id: string; name: string; groupCount: number; status: LiveExperimentStatus;
    currentRound: number; totalRounds: number;
    paperTitle: string; hasPaper: boolean; hasAnswerKey: boolean;
  };
  participant: LiveParticipant & { score: LiveScore | null };
  joinedCount: number;
};
