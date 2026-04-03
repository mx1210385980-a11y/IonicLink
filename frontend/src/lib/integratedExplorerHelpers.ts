import { formatTribopairLabel, type EvidenceResult, type RecordResponse } from '@/lib/api'

export type ConfidenceLineItem = {
  reason: string
  value: number
}

export type ConfidenceDetailsView = {
  base_score: number
  base_percent: number
  score: number
  percent: number
  penalties: ConfidenceLineItem[]
  boosts: ConfidenceLineItem[]
  penalty_total: number
  penalty_percent: number
  boost_total: number
  boost_percent: number
}

export type ConditionGroupTone = 'env' | 'dyn' | 'surf'

export type ConditionGroup = {
  key: ConditionGroupTone
  label: string
  summary: string
  title: string
}

export type SurfaceRoughnessBadgeTone = 'specified' | 'estimated'

export type SurfaceRoughnessBadge = {
  label: string
  tone: SurfaceRoughnessBadgeTone
}

export function cofDisplay(record: RecordResponse): string {
  if (record.cofValue != null && !isNaN(Number(record.cofValue))) {
    return Number(record.cofValue).toFixed(4)
  }
  if (record.cofRaw) return record.cofRaw
  return '--'
}

export function confidenceDisplay(conf: number | null | undefined): string {
  const value = Number(conf ?? 0)
  return `${Math.round(value * 100)}%`
}

export function confidencePenaltyLabel(reason: string): string {
  const labels: Record<string, string> = {
    missing_source: 'Missing source label',
    missing_page: 'Missing source page',
    missing_evidence: 'Missing evidence quote or bbox',
    text_only_source: 'Only text source available',
    inferred_source: 'Source inferred from context',
    missing_value: 'Missing extracted value',
  }
  return labels[reason] || reason.replace(/_/g, ' ')
}

export function confidencePenaltyValue(value: number | null | undefined): string {
  return `-${Math.round(Math.abs(Number(value || 0)) * 100)}`
}

export function confidenceBoostLabel(reason: string): string {
  const labels: Record<string, string> = {
    evidence_quote_present: 'Evidence quote present',
    evidence_bbox_present: 'Evidence bbox present',
    explicit_page_reference: 'Page-level grounding',
    explicit_source_label: 'Explicit figure/table label',
    verified_pdf_match: 'Verified PDF match',
  }
  return labels[reason] || reason.replace(/_/g, ' ')
}

export function confidenceBoostValue(value: number | null | undefined): string {
  return `+${Math.round(Math.abs(Number(value || 0)) * 100)}`
}

export function confidencePercentNumber(conf: number | null | undefined): number {
  return Math.max(0, Math.min(100, Number(conf ?? 0) * 100))
}

export function hasEvidenceText(value: string | null | undefined): boolean {
  return Boolean(String(value || '').trim())
}

export function hasEvidenceBBox(value: number[] | string | null | undefined): boolean {
  return Array.isArray(value) ? value.length === 4 : Boolean(String(value || '').trim())
}

export function normalizeConfidenceDetails(details?: RecordResponse['confidenceDetails'] | null): ConfidenceDetailsView {
  const penalties = Array.isArray(details?.penalties) ? details.penalties.map((item) => ({
    reason: String(item.reason || 'unknown'),
    value: Number(item.value || 0),
  })) : []
  const boosts = Array.isArray(details?.boosts) ? details.boosts.map((item) => ({
    reason: String(item.reason || 'unknown'),
    value: Number(item.value || 0),
  })) : []
  const baseScore = Number(details?.base_score ?? 1)
  const penaltyTotal = penalties.reduce((sum, item) => sum + Number(item.value || 0), 0)
  const boostTotal = boosts.reduce((sum, item) => sum + Number(item.value || 0), 0)
  const score = Math.max(0.05, Math.min(1, baseScore - penaltyTotal + boostTotal))
  return {
    base_score: baseScore,
    base_percent: Number((baseScore * 100).toFixed(1)),
    score: Number(score.toFixed(4)),
    percent: Number((score * 100).toFixed(1)),
    penalties,
    boosts,
    penalty_total: Number(penaltyTotal.toFixed(4)),
    penalty_percent: Number((penaltyTotal * 100).toFixed(1)),
    boost_total: Number(boostTotal.toFixed(4)),
    boost_percent: Number((boostTotal * 100).toFixed(1)),
  }
}

export function confidenceDetailsFor(record: RecordResponse, evidence?: EvidenceResult | null): ConfidenceDetailsView {
  const base = normalizeConfidenceDetails(record.confidenceDetails)
  const ev = evidence || null
  if (!ev) return base
  const hasSource = !!String(ev?.source || record.source || record.sourceFigure || '').trim()
  const hasPage = !!(ev?.page || record.sourcePage || record.evidencePage)
  const hasGroundedEvidence =
    hasEvidenceText(ev?.text_snippet) ||
    hasEvidenceText(ev?.evidence_text) ||
    hasEvidenceText(record.evidence) ||
    hasEvidenceBBox(ev?.bbox) ||
    hasEvidenceBBox(record.evidenceBbox)

  const penalties = base.penalties.filter((penalty) => {
    if (penalty.reason === 'missing_source' && hasSource) return false
    if (penalty.reason === 'missing_source_page' && hasPage) return false
    if (penalty.reason === 'missing_evidence' && hasGroundedEvidence) return false
    return true
  })

  return normalizeConfidenceDetails({
    ...base,
    penalties,
    penalty_total: penalties.reduce((sum, item) => sum + Number(item.value || 0), 0),
    penalty_percent: penalties.reduce((sum, item) => sum + Number(item.value || 0), 0) * 100,
  })
}

export function confidenceValueFor(record: RecordResponse, evidence?: EvidenceResult | null): number {
  return confidenceDetailsFor(record, evidence).score
}

export function confidenceDeltaPercent(record: RecordResponse, evidence?: EvidenceResult | null): number {
  return Number(((confidenceValueFor(record, evidence) - Number(record.confidence || 0)) * 100).toFixed(1))
}

export function applyLiveConfidence(record: RecordResponse, evidence?: EvidenceResult | null): number {
  const previousStoredScore = Number(record.confidence || 0)
  const liveDetails = confidenceDetailsFor(record, evidence)
  record.confidence = liveDetails.score
  record.confidenceDetails = {
    base_score: liveDetails.base_score,
    base_percent: liveDetails.base_percent,
    score: liveDetails.score,
    percent: liveDetails.percent,
    penalties: liveDetails.penalties,
    boosts: liveDetails.boosts,
    penalty_total: liveDetails.penalty_total,
    penalty_percent: liveDetails.penalty_percent,
    boost_total: liveDetails.boost_total,
    boost_percent: liveDetails.boost_percent,
  }
  return previousStoredScore
}

export function conditionGroupClass(key: ConditionGroupTone): string {
  const classes: Record<ConditionGroupTone, string> = {
    env: 'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-500/20 dark:bg-sky-500/10 dark:text-sky-300',
    dyn: 'border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-500/20 dark:bg-violet-500/10 dark:text-violet-300',
    surf: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300',
  }
  return classes[key]
}

export function surfaceRoughnessBadgeClass(tone: SurfaceRoughnessBadgeTone): string {
  const classes: Record<SurfaceRoughnessBadgeTone, string> = {
    specified: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300',
    estimated: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300',
  }
  return classes[tone]
}

export function normalizeTraceDisplayText(input: string | null | undefined): string {
  return String(input || '')
    .replace(/\s+/g, ' ')
    .replace(/渭/g, 'μ')
    .replace(/碌/g, 'μ')
    .trim()
}

function summarizeConditionGroup(items: string[], maxItems: number = 2): string {
  const filtered = items.filter(Boolean)
  if (!filtered.length) return ''
  if (filtered.length <= maxItems) return filtered.join(' · ')
  return `${filtered.slice(0, maxItems).join(' · ')} +${filtered.length - maxItems}`
}

export function conditionGroups(record: RecordResponse): ConditionGroup[] {
  const groups: ConditionGroup[] = [
    {
      key: 'env',
      label: 'ENV',
      summary: summarizeConditionGroup([
        record.temperature ? `${normalizeTraceDisplayText(record.temperature)}` : '',
        record.waterContent ? `${normalizeTraceDisplayText(record.waterContent)}` : '',
        record.potential ? `${normalizeTraceDisplayText(record.potential)}` : '',
      ]),
      title: 'Environmental conditions',
    },
    {
      key: 'dyn',
      label: 'DYN',
      summary: summarizeConditionGroup([
        record.speedValue ? `${normalizeTraceDisplayText(record.speedValue)}` : '',
        record.loadValue ? `${normalizeTraceDisplayText(record.loadValue)}` : '',
      ]),
      title: 'Dynamic conditions',
    },
    {
      key: 'surf',
      label: 'SURF',
      summary: summarizeConditionGroup([
        record.probeGeometry ? `${record.probeGeometry}` : '',
        record.probeRadius ? `${record.probeRadius}` : '',
        record.probeRoughness ? `Probe ${record.probeRoughness}` : '',
        record.substrateCoating ? `${record.substrateCoating}` : '',
        String(record.filmThickness || '').trim() ? `${record.filmThickness}` : '',
      ]),
      title: 'Surface descriptors',
    },
  ]
  return groups.filter((group) => Boolean(group.summary))
}

export function surfaceRoughnessBadge(record: RecordResponse): SurfaceRoughnessBadge | null {
  const raw = String(record.substrateRoughness || record.surfaceRoughness || '').trim()
  if (!raw) return null
  const lowered = raw.toLowerCase()
  if (lowered.includes('atomically flat') || lowered.includes('estimated')) {
    return { label: raw, tone: 'estimated' }
  }
  return { label: raw, tone: 'specified' }
}

function normalizeOptionalTagValue(value: string | null | undefined): string {
  const normalized = String(value || '').trim()
  if (!normalized || normalized.toLowerCase() === 'none') return ''
  return normalized
}

export function tribopairParts(record: RecordResponse): { probe: string, substrate: string, coating: string } {
  return {
    probe: String(record.probeMaterial || '').trim() || 'Probe N/A',
    substrate: String(record.substrateMaterial || record.materialName || '').trim() || 'Substrate N/A',
    coating: normalizeOptionalTagValue(record.substrateCoating),
  }
}

export function tribopairDisplay(record: RecordResponse): string {
  return formatTribopairLabel({
    probeMaterial: record.probeMaterial,
    substrateMaterial: record.substrateMaterial,
    substrateCoating: record.substrateCoating,
    materialName: record.materialName,
  })
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function renderChemicalDigitsAsSubscriptHtml(input: string): string {
  const phosphoniumAliasMatch = String(input).trim().match(/^\[([PNpn])([0-9,]+)\]$/)
  if (phosphoniumAliasMatch) {
    const aliasHead = phosphoniumAliasMatch[1] || ''
    const aliasDigits = phosphoniumAliasMatch[2] || ''
    return `[${escapeHtml(aliasHead)}<sub>${escapeHtml(aliasDigits)}</sub>]`
  }
  return escapeHtml(input).replace(/([A-Za-z\]\)])(\d{1,2})(?!\d)/g, '$1<sub>$2</sub>')
}

export function ionicLiquidParts(input: string | null | undefined): string[] {
  const normalized = String(input || '').trim()
  if (!normalized) return ['--']

  const compact = normalized.replace(/\s+/g, '')
  const bracketParts = compact.match(/\[[^\]]+\]/g)
  if (bracketParts && bracketParts.join('') === compact) {
    return bracketParts
  }

  return [normalized]
}

export function formatIonicLiquidPartHtml(input: string | null | undefined): string {
  return renderChemicalDigitsAsSubscriptHtml(String(input || '--'))
}

export function formatIonicLiquidHtml(input: string | null | undefined): string {
  return ionicLiquidParts(input)
    .map((part) => formatIonicLiquidPartHtml(part))
    .join('')
}
