import {
  TEACHING_FIELDS,
  type TeachingAiBehavior,
  type TeachingAnswer,
  type TeachingAnswers,
  type TeachingAutoScore,
  type TeachingExperimentPaper,
  type TeachingFieldScore,
  type TeachingGoldRule,
} from "../teachingShared";

const DASHES = /[\u2010-\u2015\u2212\u2e3a-\u2e3b\ufe58\ufe63\uff0d]/gu;
const NUMBER_SOURCE = "[+-]?(?:\\d+(?:\\.\\d+)?|\\.\\d+)";
const NUMBER_ONLY = new RegExp(`^(${NUMBER_SOURCE})$`, "u");
const TEMPERATURE = new RegExp(
  `^(${NUMBER_SOURCE})\\s*(?:°\\s*)?(c|k|celsius|kelvin)$`,
  "u"
);
const FORCE_RANGE = new RegExp(
  `^(?:load\\s*(?:=|:)?\\s*)?(${NUMBER_SOURCE})\\s*([a-z]+)?\\s*(?:-|to)\\s*(${NUMBER_SOURCE})\\s*([a-z]+)?$`,
  "u"
);

export function normalizeTeachingText(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[\u03bc\u00b5]/gu, "u")
    .replace(DASHES, "-")
    .toLowerCase()
    .replace(/\s+/gu, " ")
    .trim();
}

function normalizeAlias(value: string): string {
  return normalizeTeachingText(value)
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function result(correct: boolean, normalized: string, reason: string): TeachingFieldScore {
  return { correct, normalized, reason };
}

function numberText(value: number): string {
  return String(Number(value.toFixed(12)));
}

function within(actual: number, expected: number, tolerance: number): boolean {
  return Math.abs(actual - expected) <= tolerance + Number.EPSILON * 8;
}

function aliasMatch(value: string, aliases: string[]): boolean {
  const normalized = normalizeAlias(value);
  return aliases.some((alias) => normalizeAlias(alias) === normalized);
}

export function scoreValue(value: string, rule: TeachingGoldRule): TeachingFieldScore {
  const normalizedText = normalizeTeachingText(value);
  if (!normalizedText) return result(false, "", "blank");

  switch (rule.value.kind) {
    case "text": {
      const normalized = normalizeAlias(value);
      const matches = aliasMatch(value, [rule.value.expected, ...rule.value.aliases]);
      return result(matches, normalized, matches ? "alias_match" : "value_mismatch");
    }
    case "not_reported": {
      const normalized = normalizeAlias(value);
      const matches = aliasMatch(value, rule.value.aliases);
      return result(matches, normalized, matches ? "alias_match" : "value_mismatch");
    }
    case "number": {
      if (aliasMatch(value, rule.value.aliases)) {
        return result(true, normalizeAlias(value), "alias_match");
      }
      const scalar = normalizedText.match(NUMBER_ONLY);
      if (!scalar) return result(false, normalizeAlias(value), "parse_error");
      const actual = Number(scalar[1]);
      const correct = Number.isFinite(actual) && within(actual, rule.value.expected, rule.value.tolerance);
      return result(correct, numberText(actual), correct ? "within_tolerance" : "value_mismatch");
    }
    case "temperature": {
      if (aliasMatch(value, rule.value.aliases)) {
        return result(true, normalizeAlias(value), "alias_match");
      }
      const parsed = normalizedText.match(TEMPERATURE);
      if (!parsed) {
        const reason = NUMBER_ONLY.test(normalizedText) ? "unit_missing" : "parse_error";
        return result(false, normalizeAlias(value), reason);
      }
      const scalar = Number(parsed[1]);
      const unit = parsed[2];
      const kelvin = unit === "c" || unit === "celsius" ? scalar + 273.15 : scalar;
      const correct = Number.isFinite(kelvin) && within(kelvin, rule.value.kelvin, rule.value.toleranceKelvin);
      return result(correct, `${numberText(kelvin)} k`, correct ? "within_tolerance" : "value_mismatch");
    }
    case "force-range": {
      if (aliasMatch(value, rule.value.aliases)) {
        return result(true, normalizeAlias(value), "alias_match");
      }
      const parsed = normalizedText.match(FORCE_RANGE);
      if (!parsed) return result(false, normalizeAlias(value), "parse_error");
      const min = Number(parsed[1]);
      const max = Number(parsed[3]);
      const firstUnit = parsed[2];
      const secondUnit = parsed[4];
      if (!firstUnit && !secondUnit) {
        return result(false, `${numberText(min)}-${numberText(max)}`, "unit_missing");
      }
      if (
        (firstUnit && firstUnit !== "nn") ||
        (secondUnit && secondUnit !== "nn") ||
        (firstUnit && secondUnit && firstUnit !== secondUnit)
      ) {
        return result(false, normalizeAlias(value), "unit_mismatch");
      }
      const correct =
        Number.isFinite(min) &&
        Number.isFinite(max) &&
        within(min, rule.value.min, rule.value.tolerance) &&
        within(max, rule.value.max, rule.value.tolerance);
      return result(
        correct,
        `${numberText(min)}-${numberText(max)} ${rule.value.unit.toLowerCase()}`,
        correct ? "within_tolerance" : "value_mismatch"
      );
    }
  }
}

function parsePage(value: string): number | null {
  const normalized = normalizeTeachingText(value);
  const match = normalized.match(/^(?:(?:p|page)\.?\s*)?(\d+)$/u);
  if (match) return Number(match[1]);
  const chineseMatch = normalized.match(/^(?:第\s*)?(\d+)\s*页$/u);
  return chineseMatch ? Number(chineseMatch[1]) : null;
}

function keywordSetMatches(evidence: string, keywordSets: string[][]): boolean {
  if (keywordSets.length === 0) return false;
  const normalizedEvidence = normalizeAlias(evidence);
  const paddedEvidence = ` ${normalizedEvidence} `;
  return keywordSets.some((set) =>
    set.length > 0 && set.every((keyword) => {
      const normalizedKeyword = normalizeAlias(keyword);
      if (!normalizedKeyword) return false;
      if (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(normalizedKeyword)) {
        return normalizedEvidence.includes(normalizedKeyword);
      }
      return paddedEvidence.includes(` ${normalizedKeyword} `);
    })
  );
}

export function scoreEvidence(
  answer: TeachingAnswer | undefined,
  rule: TeachingGoldRule
): TeachingFieldScore {
  const evidence = answer?.evidence ?? "";
  const normalized = normalizeTeachingText(evidence);
  if (!normalized) return result(false, "", "blank");

  const pageText = answer?.page ?? "";
  const keywordsMatch = keywordSetMatches(evidence, rule.evidence.anyKeywordSets);

  if (rule.evidence.notReported) {
    if (normalizeTeachingText(pageText)) return result(false, normalized, "page_mismatch");
    return result(keywordsMatch, normalized, keywordsMatch ? "keyword_match" : "keyword_mismatch");
  }

  const page = parsePage(pageText);
  if (page === null || !rule.evidence.pages.includes(page)) {
    return result(false, normalized, "page_mismatch");
  }
  return result(keywordsMatch, normalized, keywordsMatch ? "keyword_match" : "keyword_mismatch");
}

export function scoreSubmission(
  answers: TeachingAnswers,
  paper: TeachingExperimentPaper
): TeachingAutoScore {
  const values = {} as TeachingAutoScore["values"];
  const evidence = {} as TeachingAutoScore["evidence"];
  let valueCorrect = 0;
  let valueCovered = 0;
  let evidenceCorrect = 0;
  let evidenceCovered = 0;

  for (const field of TEACHING_FIELDS) {
    const answer = answers[field.key];
    const valueScore = scoreValue(answer?.value ?? "", paper.gold[field.key]);
    const evidenceScore = scoreEvidence(answer, paper.gold[field.key]);
    values[field.key] = valueScore;
    evidence[field.key] = evidenceScore;
    if (valueScore.correct) valueCorrect += 1;
    if (normalizeTeachingText(answer?.value ?? "")) valueCovered += 1;
    if (evidenceScore.correct) evidenceCorrect += 1;
    const evidenceText = answer?.evidence ?? "";
    const hasEvidence = Boolean(normalizeTeachingText(evidenceText));
    const hasPage = Boolean(normalizeTeachingText(answer?.page ?? ""));
    const isExplicitNotReported =
      paper.gold[field.key].evidence.notReported === true &&
      keywordSetMatches(evidenceText, paper.gold[field.key].evidence.anyKeywordSets);
    if (hasEvidence && (hasPage || isExplicitNotReported)) evidenceCovered += 1;
  }

  const denominator = TEACHING_FIELDS.length;
  return {
    values,
    evidence,
    valueCorrect,
    valueAccuracy: valueCorrect / denominator,
    valueCoverage: valueCovered / denominator,
    evidenceCorrect,
    evidenceAccuracy: evidenceCorrect / denominator,
    evidenceCoverage: evidenceCovered / denominator,
  };
}

function normalizedPage(value: string | undefined): string {
  const parsed = parsePage(value ?? "");
  return parsed === null ? normalizeAlias(value ?? "") : String(parsed);
}

function rate(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

export function scoreAiBehavior(
  ai: TeachingAnswers,
  final: TeachingAnswers,
  aiScore: TeachingAutoScore,
  finalScore: TeachingAutoScore
): TeachingAiBehavior {
  let suggested = 0;
  let adopted = 0;
  let modified = 0;
  let initiallyIncorrect = 0;
  let corrected = 0;
  let incorrectlyAdopted = 0;

  for (const field of TEACHING_FIELDS) {
    const key = field.key;
    const aiAnswer = ai[key];
    if (!normalizeTeachingText(aiAnswer?.value ?? "")) continue;

    suggested += 1;
    const finalAnswer = final[key];
    const unchanged =
      aiScore.values[key].normalized === finalScore.values[key].normalized &&
      normalizedPage(aiAnswer?.page) === normalizedPage(finalAnswer?.page) &&
      normalizeAlias(aiAnswer?.evidence ?? "") === normalizeAlias(finalAnswer?.evidence ?? "");

    if (unchanged) adopted += 1;
    else modified += 1;

    if (!aiScore.values[key].correct) {
      initiallyIncorrect += 1;
      if (finalScore.values[key].correct) corrected += 1;
      else if (unchanged) incorrectlyAdopted += 1;
    }
  }

  return {
    suggested,
    adopted,
    modified,
    initiallyIncorrect,
    corrected,
    incorrectlyAdopted,
    adoptionRate: rate(adopted, suggested),
    modificationRate: rate(modified, suggested),
    correctionRate: rate(corrected, initiallyIncorrect),
    incorrectAdoptionRate: rate(incorrectlyAdopted, initiallyIncorrect),
  };
}
