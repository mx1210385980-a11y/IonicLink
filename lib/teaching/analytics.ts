import {
  TEACHING_FIELDS,
  type TeachingAutoScore,
  type TeachingAiBehavior,
  type TeachingDifferenceSummary,
  type TeachingExperimentAnalysisRow,
  type TeachingExperimentSummary,
  type TeachingModeSummary,
  type TeachingRoundAnalysis,
} from "../teachingShared";

const DEFAULT_BOOTSTRAP_SEED = 20260809;
const DEFAULT_BOOTSTRAP_ITERATIONS = 2_000;

function finiteValues(values: readonly number[]): number[] {
  return values.filter(Number.isFinite);
}

export function median(values: number[]): number | null {
  const sorted = finiteValues(values).sort((left, right) => left - right);
  if (sorted.length === 0) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function percentile(sorted: readonly number[], probability: number): number {
  const index = probability < 0.5
    ? Math.floor((sorted.length - 1) * probability)
    : Math.ceil((sorted.length - 1) * probability);
  return sorted[Math.max(0, Math.min(index, sorted.length - 1))];
}

export function bootstrapMedianCi(
  values: number[],
  seed = DEFAULT_BOOTSTRAP_SEED,
  iterations = DEFAULT_BOOTSTRAP_ITERATIONS
): { low: number; high: number } | null {
  const sample = finiteValues(values);
  const iterationCount = Number.isFinite(iterations) ? Math.floor(iterations) : 0;
  if (sample.length === 0 || iterationCount < 1) return null;

  let state = (Number.isFinite(seed) ? Math.trunc(seed) : DEFAULT_BOOTSTRAP_SEED) >>> 0;
  const random = (): number => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
  const medians = new Array<number>(iterationCount);
  for (let iteration = 0; iteration < iterationCount; iteration += 1) {
    const resample = new Array<number>(sample.length);
    for (let index = 0; index < sample.length; index += 1) {
      resample[index] = sample[Math.floor(random() * sample.length)];
    }
    medians[iteration] = median(resample)!;
  }
  medians.sort((left, right) => left - right);
  return {
    low: percentile(medians, 0.025),
    high: percentile(medians, 0.975),
  };
}

function normalCdf(value: number): number {
  const absolute = Math.abs(value) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * absolute);
  const polynomial =
    (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t +
      0.254829592) *
    t;
  const erf = 1 - polynomial * Math.exp(-(absolute * absolute));
  return value < 0 ? (1 - erf) / 2 : (1 + erf) / 2;
}

export function wilcoxonSignedRank(differences: number[]): number | null {
  const ranked = finiteValues(differences)
    .filter((difference) => difference !== 0)
    .map((difference) => ({
      absolute: Math.abs(difference),
      positive: difference > 0,
      rank: 0,
    }))
    .sort((left, right) => left.absolute - right.absolute);
  if (ranked.length < 5) return null;

  let tieCorrection = 0;
  for (let start = 0; start < ranked.length;) {
    let end = start + 1;
    while (end < ranked.length && ranked[end].absolute === ranked[start].absolute) end += 1;
    const averageRank = (start + 1 + end) / 2;
    for (let index = start; index < end; index += 1) ranked[index].rank = averageRank;
    const tieSize = end - start;
    tieCorrection += tieSize ** 3 - tieSize;
    start = end;
  }

  const n = ranked.length;
  const positiveRankSum = ranked.reduce(
    (sum, item) => sum + (item.positive ? item.rank : 0),
    0
  );
  const expected = (n * (n + 1)) / 4;
  const variance = (n * (n + 1) * (2 * n + 1)) / 24 - tieCorrection / 48;
  if (!(variance > 0) || !Number.isFinite(variance)) return null;
  const correctedDistance = Math.max(0, Math.abs(positiveRankSum - expected) - 0.5);
  if (correctedDistance === 0) return 1;
  const z = correctedDistance / Math.sqrt(variance);
  return Math.max(0, Math.min(1, 2 * (1 - normalCdf(z))));
}

export function isTeachingExperimentAnalysisEligible(
  row: TeachingExperimentAnalysisRow
): boolean {
  return Boolean(
    row.completed === true &&
      row.exclusionReason === null &&
      row.manual &&
      row.aiAssisted &&
      row.manual.mode === "manual" &&
      row.aiAssisted.mode === "ai_assisted" &&
      Number.isFinite(row.manual.activeSeconds) &&
      row.manual.activeSeconds > 0 &&
      Number.isFinite(row.aiAssisted.activeSeconds) &&
      row.aiAssisted.activeSeconds > 0 &&
      row.manual.timingQuality === "valid" &&
      row.aiAssisted.timingQuality === "valid"
  );
}

function mean(values: number[]): number | null {
  const finite = finiteValues(values);
  if (finite.length === 0) return null;
  return finite.reduce(
    (currentMean, value, index) => currentMean + (value - currentMean) / (index + 1),
    0
  );
}

function summarizeMode(rounds: TeachingRoundAnalysis[]): TeachingModeSummary {
  return {
    n: rounds.length,
    medianActiveSeconds: median(rounds.map((round) => round.activeSeconds)),
    medianAccuracy: median(rounds.map((round) => round.score.valueAccuracy)),
    meanAccuracy: mean(rounds.map((round) => round.score.valueAccuracy)),
    medianCoverage: median(rounds.map((round) => round.score.valueCoverage)),
    medianEvidenceAccuracy: median(rounds.map((round) => round.score.evidenceAccuracy)),
  };
}

function summarizeDifference(values: number[]): TeachingDifferenceSummary {
  const finite = finiteValues(values);
  return {
    median: median(finite),
    ci95: bootstrapMedianCi(finite),
    wilcoxonP: wilcoxonSignedRank(finite),
  };
}

function rate(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

function withinStudentAccuracyDifference(
  manual: TeachingAutoScore,
  aiAssisted: TeachingAutoScore
): number {
  const denominator = TEACHING_FIELDS.length;
  if (
    manual.valueAccuracy === manual.valueCorrect / denominator &&
    aiAssisted.valueAccuracy === aiAssisted.valueCorrect / denominator
  ) {
    return (aiAssisted.valueCorrect - manual.valueCorrect) / denominator;
  }
  return aiAssisted.valueAccuracy - manual.valueAccuracy;
}

export function teachingPairedDifferences(
  row: TeachingExperimentAnalysisRow
): { activeTimeDifference: number; accuracyDifference: number } | null {
  if (!isTeachingExperimentAnalysisEligible(row)) return null;
  return {
    activeTimeDifference: row.aiAssisted!.activeSeconds - row.manual!.activeSeconds,
    accuracyDifference: withinStudentAccuracyDifference(
      row.manual!.score,
      row.aiAssisted!.score
    ),
  };
}

function aggregateAiBehavior(rows: TeachingExperimentAnalysisRow[]): TeachingAiBehavior {
  const totals = {
    suggested: 0,
    adopted: 0,
    modified: 0,
    initiallyIncorrect: 0,
    corrected: 0,
    incorrectlyAdopted: 0,
  };
  for (const row of rows) {
    const behavior = row.aiAssisted?.aiBehavior;
    if (!behavior) continue;
    totals.suggested += behavior.suggested;
    totals.adopted += behavior.adopted;
    totals.modified += behavior.modified;
    totals.initiallyIncorrect += behavior.initiallyIncorrect;
    totals.corrected += behavior.corrected;
    totals.incorrectlyAdopted += behavior.incorrectlyAdopted;
  }
  return {
    ...totals,
    adoptionRate: rate(totals.adopted, totals.suggested),
    modificationRate: rate(totals.modified, totals.suggested),
    correctionRate: rate(totals.corrected, totals.initiallyIncorrect),
    incorrectAdoptionRate: rate(totals.incorrectlyAdopted, totals.initiallyIncorrect),
  };
}

export function summarizeTeachingExperiment(
  rows: TeachingExperimentAnalysisRow[]
): TeachingExperimentSummary {
  const participantIds = new Set<string>();
  for (const row of rows) {
    if (participantIds.has(row.participantId)) {
      throw new Error(`Duplicate teaching participant row: ${row.participantId}`);
    }
    participantIds.add(row.participantId);
  }

  const eligible = rows.filter(isTeachingExperimentAnalysisEligible);
  const manualRounds = eligible.map((row) => row.manual!);
  const aiRounds = eligible.map((row) => row.aiAssisted!);
  const pairedDifferences = eligible.map((row) => teachingPairedDifferences(row)!);
  const timeDifferences = pairedDifferences.map(({ activeTimeDifference }) => activeTimeDifference);
  const accuracyDifferences = pairedDifferences.map(({ accuracyDifference }) => accuracyDifference);
  const manual = summarizeMode(manualRounds);
  const aiAssisted = summarizeMode(aiRounds);
  const timeDifference = summarizeDifference(timeDifferences);
  const accuracyDifference = summarizeDifference(accuracyDifferences);
  const completed = rows.filter((row) => row.completed).length;

  return {
    completion: {
      total: rows.length,
      completed,
      paired: eligible.length,
      incomplete: rows.length - completed,
      excluded: rows.filter((row) => row.exclusionReason !== null).length,
    },
    sequenceCounts: {
      manual_then_ai: rows.filter((row) => row.sequence === "manual_then_ai").length,
      ai_then_manual: rows.filter((row) => row.sequence === "ai_then_manual").length,
    },
    manual,
    aiAssisted,
    timeSavedRate:
      manual.medianActiveSeconds === null || manual.medianActiveSeconds === 0 ||
      aiAssisted.medianActiveSeconds === null
        ? null
        : (manual.medianActiveSeconds - aiAssisted.medianActiveSeconds) /
          manual.medianActiveSeconds,
    accuracyDelta: accuracyDifference.median,
    fasterAndMoreAccurate: eligible.filter(
      (row) =>
        row.aiAssisted!.activeSeconds < row.manual!.activeSeconds &&
        row.aiAssisted!.score.valueAccuracy > row.manual!.score.valueAccuracy
    ).length,
    timeDifference,
    accuracyDifference,
    aiBehavior: aggregateAiBehavior(eligible),
  };
}
