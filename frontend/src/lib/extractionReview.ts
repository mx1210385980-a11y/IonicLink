import type { TribologyData } from './api'

export type ExtractionReviewStatus = 'ready' | 'needs_review' | 'flagged' | 'published'

export type FieldEvidenceMap = NonNullable<TribologyData['field_evidence_json']>
export type FieldEvidenceEntry = FieldEvidenceMap[string]

const REQUIRED_FIELD_GROUPS = [
  ['ionic_liquid', 'lubricant'],
  ['material', 'material_name', 'probe_material', 'substrate_material'],
  ['cof', 'cof_extracted'],
] as const

const DIFFUSION_REQUIRED_FIELD_GROUPS = [
  ['system_name'],
  ['ionic_liquid', 'lubricant'],
  ['diffusing_ion'],
  ['D_total', 'D_cation', 'D_anion', 'diffusion_coefficient', 'd_total', 'd_cation', 'd_anion'],
  ['d_unit', 'D_unit'],
] as const

const ACTION_FIELD_KEYS: Record<string, string[]> = {
  'ionic liquid': ['ionic_liquid', 'lubricant'],
  tribopair: ['material', 'material_name', 'probe_material', 'substrate_material'],
  conditions: ['temperature', 'load', 'speed', 'potential', 'water_content'],
  cof: ['cof'],
  diffusion: ['D_total', 'D_cation', 'D_anion', 'diffusion_coefficient', 'd_total', 'd_cation', 'd_anion'],
}

function normalizeReviewState(value: unknown) {
  return String(value || '').trim().toLowerCase()
}

export function confidenceTierOf(row: Pick<TribologyData, 'confidence_tier' | 'confidenceTier' | 'confidence'>) {
  const explicit = normalizeReviewState(row.confidence_tier ?? row.confidenceTier)
  if (explicit === 'low' || explicit === 'medium' || explicit === 'high') return explicit
  const numeric = Number(row.confidence)
  if (Number.isFinite(numeric)) {
    if (numeric >= 0.8) return 'high'
    if (numeric >= 0.6) return 'medium'
  }
  return 'low'
}

export function confidenceTierLabel(tier: unknown) {
  const normalized = normalizeReviewState(tier)
  if (normalized === 'high') return 'High confidence'
  if (normalized === 'medium') return 'Medium confidence'
  return 'Low confidence'
}

export function missingFieldsOf(row: Pick<TribologyData, 'missing_fields' | 'missingFields'>) {
  const fields = row.missing_fields ?? row.missingFields ?? []
  return Array.isArray(fields) ? fields.filter((field) => String(field || '').trim()) : []
}

export function missingFieldLabels(fields: unknown[]) {
  const labels: Record<string, string> = {
    ionic_liquid: 'Missing IL',
    material_name: 'Missing material',
    cof: 'Missing COF',
    normal_load: 'Missing load',
    speed: 'Missing speed',
  }
  return fields.map((field) => {
    const normalized = String(field || '').trim()
    return labels[normalized] || `Missing ${normalized}`
  })
}

function numericEvidenceScore(row: Pick<TribologyData, 'evidence_score' | 'evidenceScore'>) {
  const value = row.evidence_score ?? row.evidenceScore
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function backendEvidenceGrade(row: Pick<TribologyData, 'evidence_grade' | 'evidenceGrade'>) {
  return normalizeReviewState(row.evidence_grade ?? row.evidenceGrade)
}

function fieldEvidenceHasSource(entry: FieldEvidenceEntry | undefined) {
  if (!entry || typeof entry !== 'object') return false
  const evidence = entry.evidence || {}
  return Boolean(
    entry.value !== undefined
    && entry.value !== null
    && String(entry.value).trim() !== ''
    && (
      String(evidence.quote || '').trim()
      || String(evidence.matched_text || '').trim()
      || String(evidence.matchedText || '').trim()
      || evidence.page
      || evidence.bbox
    ),
  )
}

function groupHasGroundedEvidence(fieldMap: FieldEvidenceMap, keys: readonly string[]) {
  return keys.some((key) => fieldEvidenceHasSource(fieldMap[key]))
}

function groupHasFlag(fieldMap: FieldEvidenceMap, keys: readonly string[]) {
  return keys.some((key) => normalizeReviewState(fieldMap[key]?.review_state) === 'flagged')
}

export function extractionReviewStatusForRow(row: Pick<TribologyData, 'extractor_type' | 'field_evidence_json' | 'review_status' | 'evidence_score' | 'evidenceScore' | 'evidence_grade' | 'evidenceGrade' | 'record_origin' | 'confidence_tier' | 'confidenceTier' | 'confidence' | 'missing_fields' | 'missingFields'>): ExtractionReviewStatus {
  const reviewStatus = normalizeReviewState(row.review_status)
  if (reviewStatus === 'approved' || reviewStatus === 'published') return 'published'
  if (reviewStatus === 'flagged') return 'flagged'
  if (reviewStatus === 'needs_review' || reviewStatus === 'pending_review') return 'needs_review'
  if (normalizeReviewState(row.record_origin) === 'weak_candidate') return 'needs_review'
  if (missingFieldsOf(row).length > 0 && confidenceTierOf(row) === 'low') return 'needs_review'
  const evidenceGrade = backendEvidenceGrade(row)
  const evidenceScore = numericEvidenceScore(row)
  if (evidenceGrade === 'weak' || evidenceGrade === 'missing' || (evidenceScore !== null && evidenceScore < 0.65)) {
    return 'needs_review'
  }

  const fieldMap = row.field_evidence_json || {}
  const requiredFieldGroups = normalizeReviewState(row.extractor_type) === 'diffusion'
    ? DIFFUSION_REQUIRED_FIELD_GROUPS
    : REQUIRED_FIELD_GROUPS

  if (requiredFieldGroups.some((keys) => groupHasFlag(fieldMap, keys))) return 'flagged'
  if (!requiredFieldGroups.every((keys) => groupHasGroundedEvidence(fieldMap, keys))) return 'needs_review'
  return 'ready'
}

export function extractionReviewStatusLabel(status: ExtractionReviewStatus) {
  if (status === 'ready') return 'Ready'
  if (status === 'needs_review') return 'Needs review'
  if (status === 'flagged') return 'Flagged'
  return 'Published'
}

export function extractionReviewStatusClass(status: ExtractionReviewStatus) {
  if (status === 'ready') return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  if (status === 'needs_review') return 'border-amber-200 bg-amber-50 text-amber-700'
  if (status === 'flagged') return 'border-rose-200 bg-rose-50 text-rose-700'
  return 'border-slate-200 bg-slate-100 text-slate-600'
}

export function pdfUploadReviewFieldKeys(fieldLabel: string) {
  return ACTION_FIELD_KEYS[String(fieldLabel || '').trim().toLowerCase()] || []
}

export function firstPdfUploadReviewFieldKey(fieldLabel: string) {
  return pdfUploadReviewFieldKeys(fieldLabel)[0] || ''
}

export function firstAvailablePdfUploadReviewFieldKey(
  fieldLabel: string,
  fieldKeys: string[],
  fieldEvidence: FieldEvidenceMap | undefined,
) {
  const evidenceMap = fieldEvidence || {}
  return fieldKeys.find((key) => fieldEvidenceHasSource(evidenceMap[key]))
    || fieldKeys[0]
    || firstPdfUploadReviewFieldKey(fieldLabel)
}

export function extractionReviewSummary(statuses: ExtractionReviewStatus[]) {
  const ready = statuses.filter((status) => status === 'ready').length
  const published = statuses.filter((status) => status === 'published').length
  const needsReview = statuses.filter((status) => status === 'needs_review' || status === 'flagged').length
  const label = statuses.length > 0 && published === statuses.length
    ? `${published} published`
    : `${ready} ready / ${needsReview} need review`
  return { ready, needsReview, published, label }
}
