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
