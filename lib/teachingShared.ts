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
