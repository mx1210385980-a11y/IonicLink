import type { TeachingAnswer } from "../teachingShared";

const DASHES = /[\u2010-\u2015\u2212\u2e3a-\u2e3b\ufe58\ufe63\uff0d]/gu;

export function normalizeTeachingText(value: string): string {
  return value
    .normalize("NFKC")
    .replace(DASHES, "-")
    .toLowerCase()
    .replace(/[\u03bc\u00b5]/gu, "u")
    .replace(/\s+/gu, " ")
    .trim();
}

export function normalizeTeachingStructuredText(value: string): string {
  const characters = Array.from(
    normalizeTeachingText(value)
      .replace(/(\d)\s*([.:\/-])\s*(?=\d)/gu, "$1$2")
      .replace(
        /(^|[\s([{=,:;])([+-])(?:\s*[\(\[\{<])*\s*(?=(?:\d|\.\d))/gu,
        "$1$2"
      )
  );
  const normalized = characters.map((character, index) => {
    if (!/[\p{P}\p{S}]/u.test(character)) return character;

    const previous = characters[index - 1] ?? "";
    const next = characters[index + 1] ?? "";
    const previousPrevious = characters[index - 2] ?? "";
    const nextNext = characters[index + 2] ?? "";
    const betweenDigits = /[.:\/-]/u.test(character) && /\d/u.test(previous) && /\d/u.test(next);
    const hasLeadingBoundary = !previous || /[\s([{=,:;]/u.test(previous);
    const unarySign =
      /[+-]/u.test(character) &&
      hasLeadingBoundary &&
      (/\d/u.test(next) || (next === "." && /\d/u.test(nextNext)));
    const leadingDecimalPoint =
      character === "." &&
      /\d/u.test(next) &&
      (hasLeadingBoundary ||
        (/[+-]/u.test(previous) &&
          (!previousPrevious || /[\s([{=,:;]/u.test(previousPrevious))));
    return betweenDigits || unarySign || leadingDecimalPoint ? character : " ";
  });
  return normalized.join("").replace(/\s+/gu, " ").trim();
}

export function parseTeachingPage(value: string | undefined): number | null {
  const normalized = normalizeTeachingText(value ?? "");
  const match = normalized.match(/^(?:(?:p|page)\.?\s*)?(\d+)$/u);
  if (match) return Number(match[1]);
  const chineseMatch = normalized.match(/^(?:第\s*)?(\d+)\s*页$/u);
  return chineseMatch ? Number(chineseMatch[1]) : null;
}

export function normalizeTeachingPage(value: string | undefined): string {
  const parsed = parseTeachingPage(value);
  return parsed === null ? normalizeTeachingStructuredText(value ?? "") : String(parsed);
}

/** Client-safe comparison of what a student actually changed; it needs no answer-key data. */
export function teachingAnswersEquivalent(
  first: TeachingAnswer | undefined,
  second: TeachingAnswer | undefined
): boolean {
  return (
    normalizeTeachingStructuredText(first?.value ?? "") ===
      normalizeTeachingStructuredText(second?.value ?? "") &&
    normalizeTeachingPage(first?.page) === normalizeTeachingPage(second?.page) &&
    normalizeTeachingStructuredText(first?.evidence ?? "") ===
      normalizeTeachingStructuredText(second?.evidence ?? "")
  );
}
