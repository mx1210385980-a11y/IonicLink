export const TEACHING_FIELDS = [
  { key: "cation", label: "Cation" },
  { key: "anion", label: "Anion" },
  { key: "substrate", label: "Substrate" },
  { key: "temperature", label: "Temperature" },
  { key: "load", label: "Load" },
  { key: "cof", label: "COF" },
] as const;

export type TeachingFieldKey = (typeof TEACHING_FIELDS)[number]["key"];
export type TeachingAnswer = { value: string; page?: string; evidence?: string };
export type TeachingAnswers = Partial<Record<TeachingFieldKey, TeachingAnswer>>;
export type TeachingScore = "correct" | "incorrect" | "pending";
export type TeachingScores = Partial<Record<TeachingFieldKey, TeachingScore>>;
export type TeachingRole = "teacher" | "student";

export type TeachingMode = "manual" | "ai_assisted";
export type TeachingSequence = "manual_then_ai" | "ai_then_manual";

type TeachingStudentActiveBase = {
  status: "active";
  project: { id: string; name: string; fields: typeof TEACHING_FIELDS };
  participant: { studentAlias: string };
  paper: {
    id: string;
    code: "A" | "B";
    title: string;
    doi: string;
    journal: string;
    sourceUrl: string;
    taskPrompt: string;
  };
  roundNo: 1 | 2;
  totalRounds: 2;
  startedAt: string;
  answers: TeachingAnswers;
  activeSeconds: number;
  version: number;
};

export type TeachingStudentState =
  | (TeachingStudentActiveBase & { mode: "manual" })
  | (TeachingStudentActiveBase & { mode: "ai_assisted"; aiInitial: TeachingAnswers })
  | { status: "complete"; participant: { studentAlias: string }; completedAt: string };

export type TeachingRoundTransition =
  | { status: "next_round"; roundNo: 2 }
  | { status: "complete"; completedAt: string };

export type TeachingEvidenceRule = {
  pages: number[];
  anyKeywordSets: string[][];
  notReported?: boolean;
};

export type TeachingValueRule =
  | { kind: "text"; expected: string; aliases: string[] }
  | { kind: "number"; expected: number; tolerance: number; aliases: string[] }
  | { kind: "temperature"; kelvin: number; toleranceKelvin: number; aliases: string[] }
  | { kind: "force-range"; min: number; max: number; unit: "nN"; tolerance: number; aliases: string[] }
  | { kind: "not_reported"; aliases: string[] };

export type TeachingGoldRule = {
  value: TeachingValueRule;
  evidence: TeachingEvidenceRule;
};

export type TeachingFieldScore = {
  correct: boolean;
  normalized: string;
  reason: string;
};

export type TeachingAutoScore = {
  values: Record<TeachingFieldKey, TeachingFieldScore>;
  evidence: Record<TeachingFieldKey, TeachingFieldScore>;
  valueCorrect: number;
  valueAccuracy: number;
  valueCoverage: number;
  evidenceCorrect: number;
  evidenceAccuracy: number;
  evidenceCoverage: number;
};

export type TeachingAiBehavior = {
  suggested: number;
  adopted: number;
  modified: number;
  initiallyIncorrect: number;
  corrected: number;
  incorrectlyAdopted: number;
  adoptionRate: number | null;
  modificationRate: number | null;
  correctionRate: number | null;
  incorrectAdoptionRate: number | null;
};

export type TeachingTimingQuality = "valid" | "zero_active" | "excessive_idle";

export type TeachingRoundAnalysis = {
  submissionId: string;
  paperCode: "A" | "B";
  mode: TeachingMode;
  activeSeconds: number;
  wallSeconds: number;
  score: TeachingAutoScore;
  aiBehavior: TeachingAiBehavior | null;
  timingQuality: TeachingTimingQuality;
};

export type TeachingExperimentAnalysisRow = {
  participantId: string;
  studentAlias: string;
  sequence: TeachingSequence;
  completed: boolean;
  exclusionReason: string | null;
  manual: TeachingRoundAnalysis | null;
  aiAssisted: TeachingRoundAnalysis | null;
};

export type TeachingModeSummary = {
  n: number;
  medianActiveSeconds: number | null;
  medianAccuracy: number | null;
  meanAccuracy: number | null;
  medianCoverage: number | null;
  medianEvidenceAccuracy: number | null;
  medianEvidenceCoverage: number | null;
};

export type TeachingDifferenceSummary = {
  median: number | null;
  ci95: { low: number; high: number } | null;
  wilcoxonP: number | null;
};

export type TeachingExperimentSummary = {
  completion: {
    total: number;
    completed: number;
    paired: number;
    incomplete: number;
    excluded: number;
  };
  sequenceCounts: Record<TeachingSequence, number>;
  manual: TeachingModeSummary;
  aiAssisted: TeachingModeSummary;
  timeSavedRate: number | null;
  accuracyDelta: number | null;
  fasterAndMoreAccurate: number;
  timeDifference: TeachingDifferenceSummary;
  accuracyDifference: TeachingDifferenceSummary;
  aiBehavior: TeachingAiBehavior;
};

export type TeachingPairedResult = TeachingExperimentAnalysisRow & {
  activeTimeDifference: number | null;
  accuracyDifference: number | null;
};

export type TeachingExperimentDashboard = {
  experiment: { id: string; name: string; version: string; scoringVersion: string };
  summary: TeachingExperimentSummary;
  participants: TeachingPairedResult[];
};

export type TeachingExperimentPaper = {
  id: string;
  code: "A" | "B";
  title: string;
  doi: string;
  journal: string;
  sourceUrl: string;
  taskPrompt: string;
  aiModel: string;
  aiInitial: TeachingAnswers;
  gold: Record<TeachingFieldKey, TeachingGoldRule>;
};

export type TeachingExperimentConfig = {
  id: string;
  name: string;
  version: string;
  scoringVersion: string;
  fields: typeof TEACHING_FIELDS;
  papers: [TeachingExperimentPaper, TeachingExperimentPaper];
};

export interface TeachingMetrics {
  expected: number;
  humanFilled: number;
  humanCorrect: number;
  humanCoverage: number | null;
  humanAccuracy: number | null;
  aiFilled: number;
  aiCorrect: number;
  aiCoverage: number | null;
  aiAccuracy: number | null;
}

export type TeachingDashboardRow = {
  submissionId: string;
  projectId: string;
  projectName: string;
  groupCode: string;
  studentAlias: string;
  paperNo: string;
  title: string;
  doi: string;
  journal: string;
  startedAt: string;
  submittedAt: string | null;
  elapsedSeconds: number | null;
  answers: TeachingAnswers;
  aiSnapshot: Record<string, string>;
  humanScores: TeachingScores;
  aiScores: TeachingScores;
  metrics: TeachingMetrics;
  status: "draft" | "pending" | "reviewed";
};
