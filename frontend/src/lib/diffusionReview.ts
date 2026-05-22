export type OriginalDiffusionEvidenceValue = {
  value: string
  unit: string
  mantissa: string
  uncertainty: string
}

function trim(value: unknown) {
  return String(value ?? '').trim()
}

function toSuperscript(value: string) {
  const superscriptDigits: Record<string, string> = {
    '0': '⁰',
    '1': '¹',
    '2': '²',
    '3': '³',
    '4': '⁴',
    '5': '⁵',
    '6': '⁶',
    '7': '⁷',
    '8': '⁸',
    '9': '⁹',
    '-': '⁻',
    '+': '⁺',
  }
  return Array.from(value).map((char) => superscriptDigits[char] || char).join('')
}

export function normalizeScientificExponent(value: string) {
  return trim(value)
    .replace(/[−–—]/g, '-')
    .replace(/[⁺₊]/g, '+')
    .replace(/[⁻₋]/g, '-')
    .replace(/[⁰₀]/g, '0')
    .replace(/[¹₁]/g, '1')
    .replace(/[²₂]/g, '2')
    .replace(/[³₃]/g, '3')
    .replace(/[⁴₄]/g, '4')
    .replace(/[⁵₅]/g, '5')
    .replace(/[⁶₆]/g, '6')
    .replace(/[⁷₇]/g, '7')
    .replace(/[⁸₈]/g, '8')
    .replace(/[⁹₉]/g, '9')
    .replace(/\s+/g, '')
}

export function formatScientificUnit(value: string | null | undefined) {
  const text = trim(value)
  if (!text) return 'Not captured yet'

  return text
    .replace(/10\s*(?:\^\s*)?([+-]?\s*\d+)/g, (_match, exponent: string) => `10${toSuperscript(normalizeScientificExponent(exponent))}`)
    .replace(/([A-Za-zÅμµ])2(?=[\s/]|$)/g, '$1²')
    .replace(/([A-Za-zÅμµ])\^2(?=[\s/]|$)/g, '$1²')
    .replace(/ps\s*-1/g, 'ps⁻¹')
    .replace(/s\s*-1/g, 's⁻¹')
    .replace(/\s+/g, ' ')
    .trim()
}

export function normalizeDiffusionSourceText(value: string) {
  return trim(value)
    .replace(/[−–—]/g, '-')
    .replace(/\s+/g, ' ')
}

const PHYSICAL_DIFFUSION_UNIT_PATTERN = String.raw`(?:m|cm|a|A|Å|å|angstrom|Angstrom)\s*(?:\^?2|2|²)\s*(?:\/\s*(?:s|ps|ns)|(?:s|ps|ns)\s*(?:-?1|⁻¹)|\/?s\s*-?1?)?`

function rangesOverlap(start: number, end: number, ranges: Array<[number, number]>) {
  return ranges.some(([rangeStart, rangeEnd]) => start < rangeEnd && end > rangeStart)
}

function scientificUnitLabel(exponent: string, unit?: string) {
  return formatScientificUnit([`10^${normalizeScientificExponent(exponent)}`, trim(unit)].filter(Boolean).join(' '))
}

export function originalDiffusionValueFromText(value: unknown): OriginalDiffusionEvidenceValue | null {
  const text = normalizeDiffusionSourceText(String(value || ''))
  if (!text) return null

  const focused = text.match(/\bas\b(.+?)(?:\bat\b|\bin\b|;|$)/i)?.[1] || text
  const candidates: Array<OriginalDiffusionEvidenceValue & { score: number; start: number; end: number }> = []
  const scientificPattern = new RegExp(
    String.raw`\(?\s*([-+]?\d+(?:\.\d+)?)\s*(?:±\s*([-+]?\d+(?:\.\d+)?))?\s*\)?\s*[×x*]\s*10\s*(?:\^\s*)?([+\-]?\s*\d+|[⁺⁻]?[⁰¹²³⁴⁵⁶⁷⁸⁹]+)\s*(${PHYSICAL_DIFFUSION_UNIT_PATTERN})?`,
    'gi',
  )
  let match: RegExpExecArray | null
  while ((match = scientificPattern.exec(focused)) !== null) {
    const mantissa = trim(match[1])
    const exponent = normalizeScientificExponent(match[3] || '')
    if (!mantissa || !exponent) continue
    const unit = scientificUnitLabel(exponent, match[4])
    candidates.push({
      value: mantissa,
      unit,
      mantissa,
      uncertainty: trim(match[2] || ''),
      score: 10 + (match[2] ? 3 : 0) + (match[4] ? 2 : 0) + (mantissa.includes('.') ? 1 : 0),
      start: match.index,
      end: match.index + match[0].length,
    })
  }

  const scientificRanges = candidates.map((candidate) => [candidate.start, candidate.end] as [number, number])
  const plainPattern = new RegExp(
    String.raw`\(?\s*([-+]?\d+(?:\.\d+)?(?:e[-+]?\d+)?)\s*(?:±\s*([-+]?\d+(?:\.\d+)?))?\s*\)?\s*(${PHYSICAL_DIFFUSION_UNIT_PATTERN})`,
    'gi',
  )
  while ((match = plainPattern.exec(focused)) !== null) {
    if (rangesOverlap(match.index, match.index + match[0].length, scientificRanges)) continue
    const mantissa = trim(match[1])
    if (!mantissa) continue
    candidates.push({
      value: mantissa,
      unit: formatScientificUnit(match[3]),
      mantissa,
      uncertainty: trim(match[2] || ''),
      score: 4 + (match[2] ? 3 : 0) + (mantissa.includes('.') ? 1 : 0),
      start: match.index,
      end: match.index + match[0].length,
    })
  }

  const barePattern = /[-+]?\d+(?:\.\d+)?(?:e[-+]?\d+)?/gi
  while ((match = barePattern.exec(focused)) !== null) {
    if (rangesOverlap(match.index, match.index + match[0].length, scientificRanges)) continue
    const mantissa = trim(match[0])
    if (!mantissa) continue
    candidates.push({
      value: mantissa,
      unit: 'Not captured yet',
      mantissa,
      uncertainty: '',
      score: mantissa.includes('.') ? 1 : 0,
      start: match.index,
      end: match.index + match[0].length,
    })
  }

  return candidates
    .sort((left, right) => right.score - left.score || left.start - right.start)[0] || null
}
