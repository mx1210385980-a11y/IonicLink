<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  AlertTriangle,
  CheckCheck,
  Database,
  ExternalLink,
  Flag,
  FileText,
  Pencil,
  Quote,
  Search,
} from 'lucide-vue-next'

import {
  approveDiffusionReviewCandidate,
  approveReviewCandidate,
  confirmDiffusionCandidateFieldEvidence,
  confirmCandidateFieldEvidence,
  flagDiffusionCandidateFieldEvidence,
  flagCandidateFieldEvidence,
  getDiffusionCandidateEvidence,
  getDiffusionCandidateFieldEvidence,
  getCandidateEvidence,
  getCandidateFieldEvidence,
  type BatchFile,
  type EvidenceResult,
  type ExtractorType,
  type FieldEvidenceEntry,
  type RecordFieldEvidenceResponse,
  type TribologyData,
  type ValidationStatus,
} from '@/lib/api'
import { getIonicLiquidEvidenceParts, getIonicLiquidEvidenceTerms } from '@/lib/ionicLiquidAliasKnowledge'
import type { HighlightRect } from '@/types/pdf-highlight'

const props = defineProps<{
  currentSection: string
  activeScopeLabel: string
  selectedFileName: string
  selectedFile: BatchFile | null
  files: BatchFile[]
  highlightCount: number
  pdfUrl: string
  highlightData: HighlightRect[]
  scopeKey?: string | null
}>()

const emit = defineEmits<{
  'change-section': [section: string]
  'open-pipeline': []
  'open-knowledge': []
  'select-file': [fileId: string]
}>()

type QueueItem = {
  id: string
  name: string
  recordCount: number
  pendingCount: number
  lowConfidenceCount: number
  missingEvidenceCount: number
  status: 'pending' | 'in_progress' | 'confirmed'
  alert: boolean
  selected: boolean
}

type RecordItem = {
  id: string
  label: string
  title: string
  subtitle: string
  metricLabel: string
  metricValue: string
  status: 'review' | 'confirmed' | 'warning'
  lowConfidence: boolean
  missingEvidence: boolean
  selected: boolean
  record: TribologyData
}

type ReviewField = {
  id: string
  label: string
  value: string
  status: 'confirmed' | 'low_conf' | 'review'
  confidence: 'High' | 'Medium' | 'Low'
  evidenceStatus: 'Grounded' | 'Partial' | 'Missing'
  sourceType: 'text' | 'figure' | 'table' | 'inferred'
  location: string
  canConfirm: boolean
  issue?: string
}

type EvidenceSearchMode = 'loose' | 'exact-token' | 'numeric'

type EvidenceSearchSpec = {
  text: string
  mode: EvidenceSearchMode
}

type EvidenceHit = {
  id: string
  label: string
  meta: string
}

type QueueIssue = {
  id: string
  recordId: string
  recordLabel: string
  fieldLabel: string
  value: string
  detail: string
  severity: 'high' | 'medium'
}

const query = ref('')
const prioritizeLowConfidence = ref(true)
const onlyPendingRecords = ref(false)
const onlyLowConfidenceRecords = ref(false)
const activeFieldId = ref('material')
const activeRecordId = ref('')
const activeRecordEvidence = ref<EvidenceResult | null>(null)
const evidenceCache = ref<Record<string, EvidenceResult | null>>({})
const activeRecordFieldEvidence = ref<RecordFieldEvidenceResponse | null>(null)
const fieldEvidenceCache = ref<Record<string, RecordFieldEvidenceResponse | null>>({})
const reviewActionPending = ref<string | null>(null)
const reviewActionError = ref('')

const reviewTabs = computed(() => [
  { key: 'inbox', label: 'Inbox' },
  { key: 'record-review', label: 'Record Review' },
  { key: 'grounding', label: 'Grounding' },
  { key: 'queue', label: 'Queue' },
])

const selectedReviewFile = computed<BatchFile | null>(() => props.selectedFile || props.files[0] || null)
const activeDocumentName = computed(() => selectedReviewFile.value?.name || props.selectedFileName || 'No review document selected')
const allRecords = computed(() => selectedReviewFile.value?.records || [])

const queueItems = computed<QueueItem[]>(() => {
  const base = props.files.length
    ? props.files.map((file) => {
        const pendingCount = file.records.filter(recordNeedsReview).length
        const lowConfidenceCount = file.records.filter(recordLowConfidence).length
        const missingEvidenceCount = file.records.filter(recordNeedsEvidence).length
        const status: QueueItem['status'] = file.status === 'success'
          ? (pendingCount || lowConfidenceCount || missingEvidenceCount ? 'pending' : 'confirmed')
          : file.status === 'processing'
              ? 'in_progress'
              : 'pending'

        return {
          id: file.id,
          name: file.name,
          recordCount: file.records.length,
          pendingCount,
          lowConfidenceCount,
          missingEvidenceCount,
          status,
          alert: Boolean(file.hasWarnings || file.status === 'error' || lowConfidenceCount || missingEvidenceCount),
          selected: file.id === selectedReviewFile.value?.id,
        }
      })
    : [{
        id: 'empty',
        name: activeDocumentName.value,
        recordCount: 0,
        pendingCount: 0,
        lowConfidenceCount: 0,
        missingEvidenceCount: 0,
        status: 'pending' as const,
        alert: false,
        selected: true,
      }]

  const q = query.value.trim().toLowerCase()
  const filtered = q ? base.filter((item) => item.name.toLowerCase().includes(q)) : base

  if (!prioritizeLowConfidence.value) return filtered
  return [...filtered].sort((left, right) => {
    const rightPressure = right.lowConfidenceCount + right.missingEvidenceCount
    const leftPressure = left.lowConfidenceCount + left.missingEvidenceCount
    return rightPressure - leftPressure
  })
})

const recordItems = computed<RecordItem[]>(() => {
  return allRecords.value.map((record, index) => {
    const extractorType = recordExtractorType(record)
    const metric = extractorType === 'diffusion'
      ? diffusionMetric(record)
      : { label: 'COF', value: present(record.cof) }
    const id = String(record.id || `record-${index + 1}`)
    const lowConfidence = recordLowConfidence(record)
    const missingEvidence = recordNeedsEvidence(record)
    const isApproved = String(record.review_status || '').trim().toLowerCase() === 'approved' || record.validationStatus === 'verified'
    const status: RecordItem['status'] = isApproved && !lowConfidence && !missingEvidence
      ? 'confirmed'
      : lowConfidence || missingEvidence
          ? 'warning'
          : 'review'

    return {
      id,
      label: `Record ${index + 1}`,
      title: extractorType === 'diffusion' ? present(record.system_name) : present(record.material_name),
      subtitle: present(record.ionic_liquid),
      metricLabel: metric.label,
      metricValue: metric.value,
      status,
      lowConfidence,
      missingEvidence,
      selected: id === activeRecordId.value,
      record,
    }
  })
})

const visibleRecordItems = computed(() => {
  let rows = recordItems.value

  if (onlyPendingRecords.value || props.currentSection === 'queue') {
    rows = rows.filter((item) => item.status !== 'confirmed')
  }

  if (onlyLowConfidenceRecords.value) {
    rows = rows.filter((item) => item.lowConfidence)
  }

  return rows
})

watch(
  visibleRecordItems,
  (items) => {
    if (!items.length) {
      activeRecordId.value = ''
      return
    }

    const firstItem = items[0]
    if (firstItem && !items.find((item) => item.id === activeRecordId.value)) {
      activeRecordId.value = firstItem.id
    }
  },
  { immediate: true },
)

const activeRecordItem = computed(() => {
  return visibleRecordItems.value.find((item) => item.id === activeRecordId.value)
    || recordItems.value.find((item) => item.id === activeRecordId.value)
    || visibleRecordItems.value[0]
    || recordItems.value[0]
    || null
})

const activeRecord = computed<TribologyData | null>(() => activeRecordItem.value?.record || null)

const documentStats = computed(() => ({
  total: allRecords.value.length,
  pending: allRecords.value.filter(recordNeedsReview).length,
  lowConfidence: allRecords.value.filter(recordLowConfidence).length,
  missingEvidence: allRecords.value.filter(recordNeedsEvidence).length,
}))

const activeLiteratureId = computed<number | null>(() => {
  const match = String(props.pdfUrl || '').match(/\/pdf\/(\d+)/)
  const parsed = Number(match?.[1] || '')
  return Number.isFinite(parsed) ? parsed : null
})

const activeExtractorType = computed<ExtractorType>(() => {
  const fromFile = selectedReviewFile.value?.extractor_type
  if (fromFile === 'diffusion') return 'diffusion'
  const fromFieldPayload = activeRecordFieldEvidence.value?.extractor_type
  if (fromFieldPayload === 'diffusion') return 'diffusion'
  const record = activeRecord.value
  if (record?.extractor_type === 'diffusion') return 'diffusion'
  if (record?.system_name || record?.D_total != null || record?.D_cation != null || record?.D_anion != null) {
    return 'diffusion'
  }
  return 'tribology'
})

const reviewFields = computed<ReviewField[]>(() => buildReviewFields(activeRecord.value, activeRecordFieldEvidence.value?.fields))

watch(
  reviewFields,
  (fields) => {
    if (!fields.find((field) => field.id === activeFieldId.value)) {
      activeFieldId.value = fields[0]?.id || (activeExtractorType.value === 'diffusion' ? 'system_name' : 'material')
    }
  },
  { immediate: true },
)

watch(
  [activeRecord, activeLiteratureId, activeExtractorType],
  async ([record, literatureId, extractorType]) => {
    const recordId = Number(record?.id || '')
    if (!record || !literatureId || !Number.isFinite(recordId)) {
      activeRecordEvidence.value = null
      activeRecordFieldEvidence.value = null
      return
    }

    const cacheKey = `${literatureId}:${recordId}`
    if (cacheKey in evidenceCache.value) {
      activeRecordEvidence.value = evidenceCache.value[cacheKey] ?? null
    } else {
      try {
        const evidence = extractorType === 'diffusion'
          ? await getDiffusionCandidateEvidence(literatureId, recordId)
          : await getCandidateEvidence(literatureId, recordId)
        evidenceCache.value[cacheKey] = evidence
        activeRecordEvidence.value = evidence
      } catch {
        evidenceCache.value[cacheKey] = null
        activeRecordEvidence.value = null
      }
    }

    if (cacheKey in fieldEvidenceCache.value) {
      activeRecordFieldEvidence.value = fieldEvidenceCache.value[cacheKey] ?? null
    } else {
      try {
        const fieldEvidence = extractorType === 'diffusion'
          ? await getDiffusionCandidateFieldEvidence(recordId)
          : await getCandidateFieldEvidence(recordId)
        fieldEvidenceCache.value[cacheKey] = fieldEvidence
        activeRecordFieldEvidence.value = fieldEvidence
      } catch {
        fieldEvidenceCache.value[cacheKey] = null
        activeRecordFieldEvidence.value = null
      }
    }
  },
  { immediate: true },
)

const activeField = computed(() => reviewFields.value.find((field) => field.id === activeFieldId.value) || reviewFields.value[0] || null)
const activeFieldEvidenceEntry = computed(() => {
  const fieldMap = resolveRecordFieldEvidenceMap(activeRecord.value, activeRecordFieldEvidence.value?.fields)
  return fieldMap[activeField.value?.id || ''] || null
})
const canApproveAllVisible = computed(() => visibleRecordItems.value.length > 0 && visibleRecordItems.value.every((item) => recordCanApprove(item.record)))

const queueIssues = computed<QueueIssue[]>(() => {
  return visibleRecordItems.value.flatMap((item) => {
    return buildReviewFields(item.record)
      .filter((field) => field.issue)
      .map((field) => ({
        id: `${item.id}-${field.id}`,
        recordId: item.id,
        recordLabel: item.label,
        fieldLabel: field.label,
        value: field.value,
        detail: field.issue || '',
        severity: field.status === 'low_conf' ? 'high' : 'medium',
      }))
  })
})

const fieldEvidenceContext = computed(() => buildFieldEvidence(activeRecord.value, activeField.value, activeRecordEvidence.value, activeFieldEvidenceEntry.value))
const evidenceExcerpt = computed(() => fieldEvidenceContext.value.excerpt)
const activeEvidenceHit = computed(() => bestEvidenceHitForField(
  activeRecordEvidence.value,
  activeField.value,
  fieldEvidenceContext.value.specs,
))

const highlightedExcerpt = computed(() => {
  return highlightTerms(evidenceExcerpt.value, fieldEvidenceContext.value.specs)
})

const evidenceImageUrl = computed(() => {
  const imageB64 = activeRecordEvidence.value?.image_b64 || activeEvidenceHit.value?.image_b64
  return imageB64 ? `data:image/png;base64,${imageB64}` : null
})

const evidencePagePreviewUrl = computed(() => {
  const imageB64 = activeRecordEvidence.value?.page_preview_b64
  return imageB64 ? `data:image/png;base64,${imageB64}` : null
})

const evidenceHits = computed<EvidenceHit[]>(() => {
  if (props.highlightData.length) {
    return props.highlightData.slice(0, 8).map((item, index) => ({
      id: item.id,
      label: `Highlight ${index + 1}`,
      meta: `Page ${item.page} | x ${Math.round(item.coords.x)}, y ${Math.round(item.coords.y)}`,
    }))
  }

  if (activeField.value) {
    return [{
      id: `field-${activeField.value.id}`,
      label: activeField.value.label,
      meta: activeField.value.location,
    }]
  }

  return []
})

const reviewTitle = computed(() => activeDocumentName.value)
const activeFieldDisplayLabel = computed(() => {
  const label = activeField.value?.label
  return label ? label.toUpperCase().replace(/_/g, ' ') : 'NO FIELD SELECTED'
})
const evidenceSecondaryLabel = computed(() => activeExtractorType.value === 'diffusion' ? 'System Link' : 'Sample Alignment')
const evidenceSecondaryValue = computed(() => {
  if (activeExtractorType.value === 'diffusion') {
    return activeRecord?.value?.system_name || 'Not linked yet'
  }
  return activeFieldEvidenceEntry.value?.evidence?.sample_id || activeRecord?.value?.sample_id || 'Not linked yet'
})
const reviewKicker = computed(() => {
  if (props.currentSection === 'queue') return 'RESOLVE THE ITEMS BLOCKING FINAL CONFIRMATION.'
  if (props.currentSection === 'grounding') return 'VERIFY FIELD EVIDENCE BEFORE CONFIRMING THIS RECORD.'
  if (!activeRecord.value) return 'SELECT A RECORD BEFORE REVIEWING FIELD EVIDENCE.'
  return activeRecord.value.validationStatus === 'verified'
    ? 'THIS RECORD IS READY FOR FINAL CHECK.'
    : 'REVIEW FIELD BY FIELD, THEN CONFIRM THE RECORD.'
})

const modeSummary = computed(() => {
  if (props.currentSection === 'queue') return `${queueIssues.value.length} issue items still need action.`
  if (props.currentSection === 'grounding') return 'Field-level grounding is in focus. PDF evidence takes priority.'
  return `${documentStats.value.total} records found in this literature file.`
})

const reviewGridClass = computed(() => {
  return 'grid min-h-0 flex-1 gap-3 xl:grid-cols-[20rem_minmax(0,1fr)]'
})

const reviewWorkspaceClass = computed(() => {
  return props.currentSection === 'grounding'
    ? 'grid min-h-0 flex-1 gap-3 overflow-y-auto custom-scrollbar xl:grid-cols-[minmax(0,0.92fr)_minmax(28rem,1.08fr)]'
    : 'grid min-h-0 flex-1 gap-3 overflow-y-auto custom-scrollbar xl:grid-cols-[minmax(0,1fr)_24rem]'
})

function trim(value: unknown) {
  return String(value ?? '').trim()
}

function present(value: unknown) {
  return trim(value) || 'Not captured yet'
}

function normalizeFieldKey(key: string) {
  return String(key || '')
    .trim()
    .toLowerCase()
    .replace(/-/g, '_')
}

function deriveValidationStatusFromReviewStatus(reviewStatus: string | null | undefined): ValidationStatus {
  const normalized = String(reviewStatus || '').trim().toLowerCase()
  if (normalized === 'approved') return 'verified'
  if (normalized === 'flagged' || normalized === 'needs_evidence') return 'warning'
  return 'unverified'
}

function normalizeStoredFieldEvidenceMap(fieldEvidence: TribologyData['field_evidence_json'] | Record<string, FieldEvidenceEntry> | undefined) {
  return Object.entries(fieldEvidence || {}).reduce<Record<string, FieldEvidenceEntry>>((acc, [key, value]) => {
    acc[normalizeFieldKey(key)] = value || {}
    return acc
  }, {})
}

function recordExtractorType(record: TribologyData | null | undefined): ExtractorType {
  if (record?.extractor_type === 'diffusion') return 'diffusion'
  if (record?.system_name || record?.D_total != null || record?.D_cation != null || record?.D_anion != null) {
    return 'diffusion'
  }
  return 'tribology'
}

function formatDiffusionNumber(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return 'Not captured yet'
  return `${Number(value).toPrecision(4)}`.replace(/\.?0+e/, 'e').replace(/\.?0+$/, '')
}

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

function toSuperscript(value: string) {
  return Array.from(value).map((char) => superscriptDigits[char] || char).join('')
}

function formatScientificUnit(value: string | null | undefined) {
  const text = trim(value)
  if (!text) return 'Not captured yet'

  return text
    .replace(/10\s*\^?\s*([+-]?\d+)/g, (_match, exponent: string) => `10${toSuperscript(exponent)}`)
    .replace(/([A-Za-zÅμµ])2(?=\/)/g, '$1²')
    .replace(/([A-Za-zÅμµ])\^2(?=\/)/g, '$1²')
    .replace(/ps-1/g, 'ps⁻¹')
    .replace(/s-1/g, 's⁻¹')
}

function hasAnyDiffusionCoefficient(record: TribologyData | null | undefined) {
  if (!record) return false
  return [record.D_total, record.D_cation, record.D_anion].some((value) => value !== null && value !== undefined)
}

function diffusionMetric(record: TribologyData | null | undefined) {
  if (!record) return { label: 'Diffusion', value: 'Not captured yet' }
  if (record.D_total != null) return { label: 'D_total', value: formatDiffusionNumber(record.D_total) }
  if (record.D_cation != null) return { label: 'D_cation', value: formatDiffusionNumber(record.D_cation) }
  if (record.D_anion != null) return { label: 'D_anion', value: formatDiffusionNumber(record.D_anion) }
  return { label: 'Diffusion', value: 'Not captured yet' }
}

function resolveRecordFieldEvidenceMap(
  record: TribologyData | null | undefined,
  remoteFields?: Record<string, FieldEvidenceEntry> | null,
) {
  const extractorType = recordExtractorType(record)
  const localFields = normalizeStoredFieldEvidenceMap(record?.field_evidence_json)
  const merged = {
    ...localFields,
    ...normalizeStoredFieldEvidenceMap(remoteFields || undefined),
  }

  if (!merged.conditions) {
    const conditionSource = extractorType === 'diffusion'
      ? (merged.temperature_value || merged.confinement_scale_value || merged.confinement_scale_unit || null)
      : (merged.load || merged.speed || merged.temperature || null)
    const conditionValue = summarizeConditions(record || null, extractorType)
    if (conditionValue !== 'Not captured yet') {
      merged.conditions = {
        value: conditionValue,
        confidence: conditionSource?.confidence ?? undefined,
        evidence: conditionSource?.evidence ?? undefined,
        status: conditionSource?.status ?? undefined,
      }
    }
  }

  if (!merged.source_page && record?.source_page) {
    merged.source_page = {
      value: `Page ${record.source_page}`,
      evidence: {
        source_type: inferSourceType(record),
        page: record.source_page,
        source_label: record.source_figure || record.source || null,
        quote: record.evidence || null,
        bbox: record.source_bbox || null,
        sample_id: extractorType === 'tribology' ? (record.sample_id || null) : null,
      },
    }
  }

  return merged
}

function fieldEntryHasEvidence(entry: FieldEvidenceEntry | null | undefined) {
  const evidence = entry?.evidence
  return Boolean(
    evidence && (
      evidence.page
      || trim(evidence.source_label)
      || trim(evidence.quote)
      || (Array.isArray(evidence.bbox) && evidence.bbox.length === 4)
      || trim(evidence.sample_id)
      || trim(evidence.source_type)
    ),
  )
}

function resolveFieldEvidenceStatus(entry: FieldEvidenceEntry | null | undefined, value: string): ReviewField['evidenceStatus'] {
  if (!trim(value) || value === 'Not captured yet') return 'Missing'
  if (!entry) return 'Missing'
  if (entry.status === 'grounded') return 'Grounded'
  if (entry.status === 'partial') return 'Partial'
  if (fieldEntryHasEvidence(entry)) {
    const evidence = entry.evidence
    if (evidence?.page || trim(evidence?.source_label) || trim(evidence?.quote) || (Array.isArray(evidence?.bbox) && evidence?.bbox.length === 4)) {
      return 'Grounded'
    }
    return 'Partial'
  }
  return 'Missing'
}

function syncRecordReviewState(recordId: string, payload: RecordFieldEvidenceResponse) {
  for (const file of props.files) {
    const record = file.records.find((item) => String(item.id || '') === recordId)
    if (!record) continue
    if (payload.extractor_type === 'diffusion') {
      record.extractor_type = 'diffusion'
      file.extractor_type = 'diffusion'
    }
    record.field_evidence_json = payload.fields
    record.review_status = payload.review_status || undefined
    record.record_origin = payload.record_origin || record.record_origin
    record.assembly_notes = payload.assembly_notes || undefined
    record.sample_id = payload.sample_id || record.sample_id
    record.series_id = payload.series_id || record.series_id
    record.validationStatus = deriveValidationStatusFromReviewStatus(payload.review_status)
    record.validationMessage = payload.assembly_notes || undefined
  }
}

function applyReviewResponse(payload: RecordFieldEvidenceResponse) {
  const recordId = String(payload.record_id)
  const literatureId = Number(payload.literature_id || activeLiteratureId.value || 0)
  if (literatureId && Number.isFinite(payload.record_id)) {
    fieldEvidenceCache.value[`${literatureId}:${payload.record_id}`] = payload
  }
  if (activeRecord.value && String(activeRecord.value.id || '') === recordId) {
    activeRecordFieldEvidence.value = payload
  }
  syncRecordReviewState(recordId, payload)
}

function resolveFieldSourceType(entry: FieldEvidenceEntry | null | undefined, record: TribologyData | null | undefined): ReviewField['sourceType'] {
  const sourceType = trim(entry?.evidence?.source_type).toLowerCase()
  if (sourceType.includes('table')) return 'table'
  if (sourceType.includes('figure') || sourceType.includes('caption') || trim(entry?.evidence?.source_label).toLowerCase().startsWith('fig')) return 'figure'
  if (sourceType) return 'text'
  return inferSourceType(record)
}

function resolveFieldLocation(entry: FieldEvidenceEntry | null | undefined, record: TribologyData | null | undefined) {
  const page = entry?.evidence?.page
  const label = trim(entry?.evidence?.source_label)
  if (page && label) return `Page ${page} | ${label}`
  if (page) return `Page ${page}`
  if (label) return label
  return evidenceLocation(record)
}

function hasTextEvidence(record: TribologyData | null | undefined) {
  if (!record) return false
  return Boolean(trim(record.evidence) || trim(record.notes) || trim(record.source))
}

function recordNeedsEvidence(record: TribologyData) {
  const extractorType = recordExtractorType(record)
  const fieldMap = resolveRecordFieldEvidenceMap(record)
  if (extractorType === 'diffusion') {
    const missingBase = ['system_name', 'ionic_liquid']
      .some((key) => resolveFieldEvidenceStatus(fieldMap[key], fieldValueForKey(record, key, extractorType)) === 'Missing')
    const coefficientMissing = ['d_total', 'd_cation', 'd_anion']
      .every((key) => resolveFieldEvidenceStatus(fieldMap[key], fieldValueForKey(record, key, extractorType)) === 'Missing')
    return missingBase || coefficientMissing
  }
  return ['material', 'ionic_liquid', 'cof']
    .some((key) => resolveFieldEvidenceStatus(fieldMap[key], fieldValueForKey(record, key, extractorType)) === 'Missing')
}

function recordNeedsReview(record: TribologyData) {
  return String(record.review_status || '').trim().toLowerCase() !== 'approved' && record.validationStatus !== 'verified'
}

function recordLowConfidence(record: TribologyData) {
  const extractorType = recordExtractorType(record)
  const missingCore = extractorType === 'diffusion'
    ? (!trim(record.system_name) || !trim(record.ionic_liquid) || !hasAnyDiffusionCoefficient(record))
    : (!trim(record.material_name) || !trim(record.ionic_liquid) || !trim(record.cof))
  const reviewStatus = String(record.review_status || '').trim().toLowerCase()
  return record.validationStatus === 'warning' || reviewStatus === 'flagged' || reviewStatus === 'needs_evidence' || missingCore
}

function summarizeConditions(record: TribologyData | null | undefined, extractorType: ExtractorType = recordExtractorType(record)) {
  if (!record) return 'Not captured yet'
  if (extractorType === 'diffusion') {
    const parts = [
      record.temperature_value != null ? `T ${formatDiffusionNumber(record.temperature_value)}` : '',
      record.confinement_scale_value != null
        ? `Scale ${formatDiffusionNumber(record.confinement_scale_value)}${trim(record.confinement_scale_unit) ? ` ${formatScientificUnit(record.confinement_scale_unit)}` : ''}`
        : '',
    ].map((item) => trim(item)).filter(Boolean)
    return parts.length ? parts.join(' | ') : 'Not captured yet'
  }
  const parts = [record.load, record.speed, record.temperature].map((item) => trim(item)).filter(Boolean)
  return parts.length ? parts.join(' | ') : 'Not captured yet'
}

function inferSourceType(record: TribologyData | null | undefined): ReviewField['sourceType'] {
  if (!record) return 'inferred'
  const sourceLabel = trim(record.source || record.source_figure).toLowerCase()
  const sourceText = [record.source, record.evidence, record.notes].map((item) => trim(item).toLowerCase()).join(' ')
  if (trim(record.source_figure)) return 'figure'
  if (sourceLabel.startsWith('fig') || sourceLabel.startsWith('image') || sourceLabel.startsWith('plot')) return 'figure'
  if (sourceText.includes('table')) return 'table'
  if (sourceLabel.startsWith('table')) return 'table'
  if (hasTextEvidence(record)) return 'text'
  return 'inferred'
}

function evidenceLocation(record: TribologyData | null | undefined) {
  if (!record) return `Scope ${props.activeScopeLabel}`
  if (record.source_page && trim(record.source_figure)) return `Page ${record.source_page} | ${record.source_figure}`
  if (record.source_page) return `Page ${record.source_page}`
  if (trim(record.source_figure)) return `Figure ${trim(record.source_figure)}`
  return `Scope ${props.activeScopeLabel}`
}

function fieldValueForKey(record: TribologyData, key: string, extractorType: ExtractorType = recordExtractorType(record)) {
  if (extractorType === 'diffusion') {
    if (key === 'system_name') return present(record.system_name)
    if (key === 'confinement_material_class') return present(record.confinement_material_class)
    if (key === 'confinement_geometry_class') return present(record.confinement_geometry_class)
    if (key === 'surface_functional_groups') return present(record.surface_functional_groups)
    if (key === 'confinement_dimensionality') return present(record.confinement_dimensionality)
    if (key === 'ionic_liquid') return present(record.ionic_liquid)
    if (key === 'd_total') return formatDiffusionNumber(record.D_total)
    if (key === 'd_cation') return formatDiffusionNumber(record.D_cation)
    if (key === 'd_anion') return formatDiffusionNumber(record.D_anion)
    if (key === 'd_unit') return formatScientificUnit(record.D_unit)
    if (key === 'temperature_value') return formatDiffusionNumber(record.temperature_value)
    if (key === 'confinement_scale_value') return formatDiffusionNumber(record.confinement_scale_value)
    if (key === 'confinement_scale_unit') return formatScientificUnit(record.confinement_scale_unit)
    if (key === 'conditions') return summarizeConditions(record, extractorType)
    if (key === 'source_page') return record.source_page ? `Page ${record.source_page}` : 'Not captured yet'
    return 'Not captured yet'
  }
  if (key === 'material') return present(record.material_name)
  if (key === 'ionic_liquid') return present(record.ionic_liquid)
  if (key === 'cof') return present(record.cof)
  if (key === 'conditions') return summarizeConditions(record, extractorType)
  if (key === 'source_page') return record.source_page ? `Page ${record.source_page}` : 'Not captured yet'
  return 'Not captured yet'
}

function getRecordEvidenceText(record: TribologyData | null) {
  if (!record) return ''
  return [record.evidence, record.notes, record.source]
    .map((item) => trim(item))
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function addEvidenceSpec(store: Map<string, EvidenceSearchSpec>, text: string, mode: EvidenceSearchMode) {
  const cleanText = trim(text)
  if (!cleanText || cleanText === 'Not captured yet') return
  store.set(`${mode}:${cleanText.toLowerCase()}`, { text: cleanText, mode })
}

function classifyIonicLiquidMode(term: string): EvidenceSearchMode {
  const normalized = term.replace(/[^A-Za-z0-9]/g, '')
  if (normalized && normalized.length <= 4 && !/[\[\]\s-]/.test(term)) {
    return 'exact-token'
  }
  return 'loose'
}

function fieldEvidenceSpecs(field: ReviewField | null, record: TribologyData | null) {
  if (!field || !record) return []

  const extractorType = recordExtractorType(record)
  const specs = new Map<string, EvidenceSearchSpec>()
  const cleanValue = trim(field.value)

  if (cleanValue && cleanValue !== 'Not captured yet') {
    addEvidenceSpec(specs, cleanValue, ['cof', 'd_total', 'd_cation', 'd_anion'].includes(field.id) ? 'numeric' : 'loose')
  }

  if (field.id === 'conditions') {
    ;(extractorType === 'diffusion'
      ? [record.temperature_value != null ? formatDiffusionNumber(record.temperature_value) : '', record.confinement_scale_value != null ? formatDiffusionNumber(record.confinement_scale_value) : '', record.confinement_scale_unit]
      : [record.load, record.speed, record.temperature])
      .map((item) => trim(item))
      .filter(Boolean)
      .forEach((item) => addEvidenceSpec(specs, item, 'loose'))
  }

  if (field.id === 'material') {
    const material = trim(record.material_name)
    if (material) addEvidenceSpec(specs, material, 'loose')
  }

  if (field.id === 'system_name') {
    const systemName = trim(record.system_name)
    if (systemName) addEvidenceSpec(specs, systemName, 'loose')
  }

  if (['confinement_material_class', 'confinement_geometry_class', 'surface_functional_groups', 'confinement_dimensionality'].includes(field.id)) {
    const raw = fieldValueForKey(record, field.id, extractorType)
    if (trim(raw)) addEvidenceSpec(specs, raw, 'loose')
  }

  if (field.id === 'ionic_liquid') {
    const ionicLiquid = trim(record.ionic_liquid)
    const ionicParts = getIonicLiquidEvidenceParts(ionicLiquid)

    getIonicLiquidEvidenceTerms(ionicLiquid).forEach((term) => addEvidenceSpec(specs, term, classifyIonicLiquidMode(term)))

    ;[record.cation, record.anion]
      .map((item) => trim(item))
      .filter(Boolean)
      .forEach((item) => {
        const normalized = item.replace(/[^A-Za-z0-9]/g, '')
        if (normalized.length <= 3) return
        addEvidenceSpec(specs, item, normalized.length <= 4 ? 'exact-token' : 'loose')
      })

    if (ionicParts) {
      ;[
        `[${ionicParts.cationRaw}]`,
        `[${ionicParts.anionRaw}]`,
      ]
        .map((item) => trim(item))
        .filter(Boolean)
        .forEach((item) => addEvidenceSpec(specs, item, 'exact-token'))
    }
  }

  if (field.id === 'cof') {
    const numeric = cleanValue.match(/[0-9]+(?:\.[0-9]+)?/)?.[0]
    if (numeric) {
      addEvidenceSpec(specs, numeric, 'numeric')
      addEvidenceSpec(specs, `COF ${numeric}`, 'loose')
      addEvidenceSpec(specs, `coefficient of friction ${numeric}`, 'loose')
      addEvidenceSpec(specs, `friction coefficient of ${numeric}`, 'loose')
    }
  }

  if (['d_total', 'd_cation', 'd_anion'].includes(field.id)) {
    const numeric = cleanValue.match(/[0-9]+(?:\.[0-9]+)?(?:e[-+]?\d+)?/i)?.[0]
    if (numeric) {
      addEvidenceSpec(specs, numeric, 'numeric')
      addEvidenceSpec(specs, `diffusion ${numeric}`, 'loose')
      addEvidenceSpec(specs, `diffusion coefficient ${numeric}`, 'loose')
    }
  }

  if (field.id === 'source_page') {
    if (record.source_page) addEvidenceSpec(specs, `Page ${record.source_page}`, 'loose')
    if (trim(record.source_figure)) addEvidenceSpec(specs, trim(record.source_figure), 'loose')
    if (trim(record.source)) addEvidenceSpec(specs, trim(record.source), 'loose')
  }

  return [...specs.values()]
}

function extractEvidenceExcerpt(text: string, specs: EvidenceSearchSpec[]) {
  if (!text) return ''

  const matchResult = findEvidenceMatch(text, specs)

  if (!matchResult) {
    return text.slice(0, 280)
  }

  const { match } = matchResult

  const startBoundary = Math.max(
    text.lastIndexOf('. ', match.index),
    text.lastIndexOf('; ', match.index),
    text.lastIndexOf('\n', match.index),
  )
  const excerptStart = Math.max(0, startBoundary >= 0 ? startBoundary + 1 : match.index - 110)

  const afterIndex = match.index + match[0].length
  const sentenceEndCandidates = [
    text.indexOf('. ', afterIndex),
    text.indexOf('; ', afterIndex),
    text.indexOf('\n', afterIndex),
  ].filter((index) => index >= 0)

  const nextBoundary = sentenceEndCandidates.length ? Math.min(...sentenceEndCandidates) : -1
  const excerptEnd = nextBoundary >= 0 ? nextBoundary + 1 : Math.min(text.length, afterIndex + 170)

  return text.slice(excerptStart, excerptEnd).trim()
}

function semanticTypesForField(field: ReviewField | null) {
  if (!field) return []
  if (field.id === 'material') return ['material', 'substrate_material', 'probe_material', 'tribopair']
  if (field.id === 'system_name') return ['system', 'system_name', 'sample']
  if (field.id === 'confinement_material_class') return ['material', 'confinement_material']
  if (field.id === 'confinement_geometry_class') return ['geometry', 'confinement_geometry']
  if (field.id === 'surface_functional_groups') return ['surface_functional_groups', 'surface_group']
  if (field.id === 'confinement_dimensionality') return ['dimensionality', 'confinement_dimensionality']
  if (field.id === 'ionic_liquid') return ['ionic_liquid', 'lubricant', 'cation', 'anion']
  if (field.id === 'cof') return ['cof', 'friction_coefficient']
  if (field.id === 'd_total') return ['diffusion', 'd_total']
  if (field.id === 'd_cation') return ['diffusion', 'd_cation']
  if (field.id === 'd_anion') return ['diffusion', 'd_anion']
  if (field.id === 'conditions') return ['load', 'speed', 'temperature', 'condition']
  if (field.id === 'source_page') return ['source_page', 'figure', 'table']
  return []
}

function matchesEvidenceSpecText(text: string, spec: EvidenceSearchSpec) {
  if (!text) return false
  const matcher = buildEvidenceMatcher(spec)
  if (matcher.test(text)) return true
  if (spec.mode === 'loose') return normalizeLooseText(text).includes(normalizeLooseText(spec.text))
  return false
}

function bestEvidenceHitForField(evidence: EvidenceResult | null, field: ReviewField | null, specs: EvidenceSearchSpec[]) {
  const hits = Array.isArray(evidence?.term_hits) ? evidence.term_hits : []
  if (!field || !hits.length) return null

  const semanticTypes = new Set(semanticTypesForField(field))
  const semanticHits = semanticTypes.size
    ? hits.filter((hit) => semanticTypes.has(String(hit.semantic_type || '').trim().toLowerCase()))
    : []
  const pools = semanticHits.length ? [semanticHits, hits] : [hits]

  for (const pool of pools) {
    for (const spec of specs) {
      const matchedHit = pool.find((hit) => {
        const termText = String(hit.term || '')
        const matchedText = String(hit.matched_text || '')
        const snippetText = String(hit.snippet_text || '')
        return matchesEvidenceSpecText(termText, spec)
          || matchesEvidenceSpecText(matchedText, spec)
          || matchesEvidenceSpecText(snippetText, spec)
      })
      if (matchedHit) return matchedHit
    }
  }

  return null
}

function buildFieldEvidence(
  record: TribologyData | null,
  field: ReviewField | null,
  evidence: EvidenceResult | null,
  fieldEntry: FieldEvidenceEntry | null | undefined,
) {
  if (!field) {
    return {
      excerpt: 'Select a field on the left to inspect its grounding evidence.',
      specs: [] as EvidenceSearchSpec[],
    }
  }

  if (!record) {
    return {
      excerpt: 'Choose a record from the rail before confirming field evidence.',
      specs: [] as EvidenceSearchSpec[],
    }
  }

  const specs = fieldEvidenceSpecs(field, record)
  const directQuote = trim(fieldEntry?.evidence?.quote)
  if (directQuote) {
    return {
      excerpt: directQuote,
      specs,
    }
  }

  const bestHit = bestEvidenceHitForField(evidence, field, specs)
  if (bestHit) {
    const matchedText = trim(bestHit.matched_text) || trim(bestHit.term)
    return {
      excerpt: trim(bestHit.snippet_text) || matchedText || trim(evidence?.text_snippet) || trim(evidence?.evidence_text),
      specs: matchedText ? [{ text: matchedText, mode: 'exact-token' as const }] : specs,
    }
  }

  const baseText = [trim(evidence?.text_snippet), trim(evidence?.evidence_text), getRecordEvidenceText(record)]
    .filter(Boolean)
    .join(' ')
    .trim()

  if (baseText) {
    const excerpt = extractEvidenceExcerpt(baseText, specs)
    return { excerpt, specs }
  }

  if (field.value === 'Not captured yet') {
    return {
      excerpt: `${field.label} is still missing. Inspect the source PDF or mark the field for follow-up.`,
      specs: [],
    }
  }

  return {
    excerpt: `${field.label} resolved as ${field.value}. Confirm the value against the linked source before approving this record.`,
    specs,
  }
}

function highlightTerms(text: string, specs: EvidenceSearchSpec[]) {
  let output = text

  specs
    .filter((spec) => Boolean(spec.text))
    .sort((left, right) => right.text.length - left.text.length)
    .forEach((spec) => {
      const matcher = buildEvidenceMatcher(spec)
      output = output.replace(
        matcher,
        (match) => `<mark class="rounded-[0.28rem] bg-[#fde7a8] px-1 py-0.5 font-medium text-[#8c5a05]">${match}</mark>`,
      )
    })

  return output
}

function normalizeLooseText(value: string) {
  return value
    .toLowerCase()
    .replace(/[\[\](){}]/g, '')
    .replace(/[^a-z0-9+]+/g, '')
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function buildLooseMatcher(term: string) {
  const parts = term
    .replace(/[\[\](){}]/g, ' ')
    .split(/[^A-Za-z0-9+]+/)
    .map((item) => item.trim())
    .filter(Boolean)

  if (!parts.length) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return new RegExp(escaped, 'gi')
  }

  const pattern = parts
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('[\\]\\[\\s\\-_/,:;(){}]*')

  return new RegExp(pattern, 'gi')
}

function buildExactTokenMatcher(term: string) {
  return new RegExp(`(?<![A-Za-z0-9])${escapeRegex(term)}(?![A-Za-z0-9])`, 'gi')
}

function buildNumericMatcher(term: string) {
  return new RegExp(`(?<![0-9.])${escapeRegex(term)}(?![0-9.])`, 'gi')
}

function buildEvidenceMatcher(spec: EvidenceSearchSpec) {
  if (spec.mode === 'numeric') return buildNumericMatcher(spec.text)
  if (spec.mode === 'exact-token') return buildExactTokenMatcher(spec.text)
  return buildLooseMatcher(spec.text)
}

function findEvidenceMatch(text: string, specs: EvidenceSearchSpec[]) {
  const orderedSpecs = [...specs].sort((left, right) => right.text.length - left.text.length)

  for (const spec of orderedSpecs) {
    const matcher = buildEvidenceMatcher(spec)
    const match = matcher.exec(text)
    if (!match || match.index === undefined) continue
    if (spec.mode === 'numeric' && !numericTokensConsistent(spec.text, match[0])) continue
    return { spec, match }
  }

  for (const spec of orderedSpecs) {
    if (spec.mode !== 'loose') continue
    if (normalizeLooseText(text).includes(normalizeLooseText(spec.text))) {
      return { spec, match: { index: 0, 0: spec.text, length: spec.text.length } as RegExpExecArray }
    }
  }

  return null
}

function extractNumberTokens(input: string): string[] {
  return (String(input || '').match(/\d+(?:\.\d+)?/g) || []).map((value) => String(value))
}

function numericTokensConsistent(term: string, matched: string): boolean {
  const termNums = extractNumberTokens(term).map((value) => Number(value)).filter((value) => Number.isFinite(value))
  if (!termNums.length) return true
  const matchedNums = extractNumberTokens(matched).map((value) => Number(value)).filter((value) => Number.isFinite(value))
  if (!matchedNums.length) return false
  return termNums.every((termValue) => {
    const tolerance = Math.max(1e-6, Math.abs(termValue) * 0.01)
    return matchedNums.some((matchedValue) => Math.abs(matchedValue - termValue) <= tolerance)
  })
}

function confidenceLabel(status: ValidationStatus | undefined, value: string): ReviewField['confidence'] {
  if (!trim(value) || status === 'warning') return 'Low'
  if (status === 'verified') return 'High'
  return 'Medium'
}

function fieldStatusFromEntry(record: TribologyData, value: string, evidence: ReviewField['evidenceStatus'], entry: FieldEvidenceEntry | null | undefined): ReviewField['status'] {
  const reviewState = String(entry?.review_state || '').trim().toLowerCase()
  if (!trim(value)) return 'low_conf'
  if (reviewState === 'flagged') return 'low_conf'
  if (reviewState === 'confirmed' && evidence !== 'Missing') return 'confirmed'
  if (record.validationStatus === 'verified' && evidence === 'Grounded') return 'confirmed'
  if (record.validationStatus === 'warning' || evidence === 'Missing') return 'low_conf'
  return 'review'
}

function buildField(
  label: string,
  id: string,
  rawValue: string,
  record: TribologyData,
  entry: FieldEvidenceEntry | null | undefined,
  issueMessage?: string,
): ReviewField {
  const value = rawValue
  const evidence = resolveFieldEvidenceStatus(entry, value)
  const status = fieldStatusFromEntry(record, value, evidence, entry)
  const canConfirm = trim(value) !== '' && value !== 'Not captured yet' && evidence !== 'Missing'

  return {
    id,
    label,
    value,
    status,
    confidence: confidenceLabel(record.validationStatus, value),
    evidenceStatus: evidence,
    sourceType: resolveFieldSourceType(entry, record),
    location: resolveFieldLocation(entry, record),
    canConfirm,
    issue: entry?.review_state === 'flagged'
      ? (trim(entry.review_note) || issueMessage)
      : (!canConfirm ? issueMessage : undefined),
  }
}

function buildReviewFields(record: TribologyData | null, remoteFields?: Record<string, FieldEvidenceEntry> | null): ReviewField[] {
  if (!record) {
    return [
      {
        id: 'source',
        label: 'Source Document',
        value: activeDocumentName.value,
        status: 'review',
        confidence: 'Medium',
        evidenceStatus: 'Missing',
        sourceType: 'inferred',
        location: `Scope ${props.activeScopeLabel}`,
        canConfirm: false,
        issue: 'No extracted record is attached to this literature file yet.',
      },
    ]
  }

  const extractorType = recordExtractorType(record)
  const fieldMap = resolveRecordFieldEvidenceMap(record, remoteFields)
  if (extractorType === 'diffusion') {
    return [
      buildField('System', 'system_name', present(record.system_name), record, fieldMap.system_name, 'System name still needs grounding confirmation.'),
      buildField('Ionic Liquid', 'ionic_liquid', present(record.ionic_liquid), record, fieldMap.ionic_liquid, 'Ionic liquid still needs grounding confirmation.'),
      buildField('D_total', 'd_total', formatDiffusionNumber(record.D_total), record, fieldMap.d_total, 'Total diffusion coefficient still needs grounding confirmation.'),
      buildField('D_cation', 'd_cation', formatDiffusionNumber(record.D_cation), record, fieldMap.d_cation, 'Cation diffusion coefficient still needs grounding confirmation.'),
      buildField('D_anion', 'd_anion', formatDiffusionNumber(record.D_anion), record, fieldMap.d_anion, 'Anion diffusion coefficient still needs grounding confirmation.'),
      buildField('D Unit', 'd_unit', formatScientificUnit(record.D_unit), record, fieldMap.d_unit, 'Diffusion unit still needs grounding confirmation.'),
      buildField('Confinement Material', 'confinement_material_class', present(record.confinement_material_class), record, fieldMap.confinement_material_class, 'Confinement material still needs confirmation.'),
      buildField('Geometry', 'confinement_geometry_class', present(record.confinement_geometry_class), record, fieldMap.confinement_geometry_class, 'Confinement geometry still needs confirmation.'),
      buildField('Surface Groups', 'surface_functional_groups', present(record.surface_functional_groups), record, fieldMap.surface_functional_groups, 'Surface functional groups still need confirmation.'),
      buildField('Dimensionality', 'confinement_dimensionality', present(record.confinement_dimensionality), record, fieldMap.confinement_dimensionality, 'Confinement dimensionality still needs confirmation.'),
      buildField('Diffusion Conditions', 'conditions', summarizeConditions(record, extractorType), record, fieldMap.conditions, 'Temperature or confinement scale still need confirmation.'),
      buildField('Source Page', 'source_page', record.source_page ? `Page ${record.source_page}` : 'Not captured yet', record, fieldMap.source_page, 'No grounded page was attached to this record.'),
    ]
  }
  return [
    buildField('Material', 'material', present(record.material_name), record, fieldMap.material, 'Material still needs grounding confirmation.'),
    buildField('Ionic Liquid', 'ionic_liquid', present(record.ionic_liquid), record, fieldMap.ionic_liquid, 'Ionic liquid still needs grounding confirmation.'),
    buildField('COF', 'cof', present(record.cof), record, fieldMap.cof, 'COF still needs grounding confirmation.'),
    buildField('Test Conditions', 'conditions', summarizeConditions(record), record, fieldMap.conditions, 'Load, speed, or temperature still need confirmation.'),
    buildField('Source Page', 'source_page', record.source_page ? `Page ${record.source_page}` : 'Not captured yet', record, fieldMap.source_page, 'No grounded page was attached to this record.'),
  ]
}

function recordCanApprove(record: TribologyData | null | undefined, remoteFields?: Record<string, FieldEvidenceEntry> | null) {
  if (!record) return false
  const extractorType = recordExtractorType(record)
  const fieldMap = resolveRecordFieldEvidenceMap(record, remoteFields)
  if (extractorType === 'diffusion') {
    const baseReady = ['system_name', 'ionic_liquid']
      .every((key) => resolveFieldEvidenceStatus(fieldMap[key], fieldValueForKey(record, key, extractorType)) !== 'Missing')
    const coefficientReady = ['d_total', 'd_cation', 'd_anion']
      .some((key) => resolveFieldEvidenceStatus(fieldMap[key], fieldValueForKey(record, key, extractorType)) !== 'Missing')
    return baseReady && coefficientReady
  }
  return ['material', 'ionic_liquid', 'cof']
    .every((key) => resolveFieldEvidenceStatus(fieldMap[key], fieldValueForKey(record, key, extractorType)) !== 'Missing')
}

async function handleConfirmField(field: ReviewField) {
  const recordId = Number(activeRecord.value?.id || '')
  if (!field.canConfirm || !Number.isFinite(recordId)) return

  reviewActionPending.value = `confirm:${recordId}:${field.id}`
  reviewActionError.value = ''
  try {
    const payload = activeExtractorType.value === 'diffusion'
      ? await confirmDiffusionCandidateFieldEvidence(recordId, field.id)
      : await confirmCandidateFieldEvidence(recordId, field.id)
    applyReviewResponse(payload)
  } catch (error: any) {
    reviewActionError.value = String(error?.response?.data?.detail || error?.message || 'Failed to confirm field')
  } finally {
    reviewActionPending.value = null
  }
}

async function handleFlagActiveField(fieldId?: string) {
  const recordId = Number(activeRecord.value?.id || '')
  const targetFieldId = fieldId || activeField.value?.id
  if (!targetFieldId || !Number.isFinite(recordId)) return

  reviewActionPending.value = `flag:${recordId}:${targetFieldId}`
  reviewActionError.value = ''
  try {
    const payload = activeExtractorType.value === 'diffusion'
      ? await flagDiffusionCandidateFieldEvidence(recordId, targetFieldId, 'Flagged from review UI')
      : await flagCandidateFieldEvidence(recordId, targetFieldId, 'Flagged from review UI')
    applyReviewResponse(payload)
  } catch (error: any) {
    reviewActionError.value = String(error?.response?.data?.detail || error?.message || 'Failed to flag field')
  } finally {
    reviewActionPending.value = null
  }
}

async function handleApproveRecord(record?: TribologyData | null) {
  const target = record || activeRecord.value
  const recordId = Number(target?.id || '')
  const remoteFields = target && activeRecord.value && String(target.id || '') === String(activeRecord.value.id || '')
    ? activeRecordFieldEvidence.value?.fields
    : undefined
  if (!target || !Number.isFinite(recordId) || !recordCanApprove(target, remoteFields)) return

  reviewActionPending.value = `approve:${recordId}`
  reviewActionError.value = ''
  try {
    const payload = activeExtractorType.value === 'diffusion'
      ? await approveDiffusionReviewCandidate(recordId)
      : await approveReviewCandidate(recordId)
    applyReviewResponse(payload)
  } catch (error: any) {
    reviewActionError.value = String(error?.response?.data?.detail || error?.message || 'Failed to approve record')
  } finally {
    reviewActionPending.value = null
  }
}

async function handleApproveAll() {
  if (!canApproveAllVisible.value) return

  if (visibleRecordItems.value.length === 1) {
    await handleApproveRecord(visibleRecordItems.value[0]?.record || null)
    return
  }

  reviewActionPending.value = 'approve-all'
  reviewActionError.value = ''
  try {
    for (const item of visibleRecordItems.value) {
      if (!recordCanApprove(item.record)) {
        throw new Error(`Record ${item.label} is missing required evidence`)
      }
      const payload = activeExtractorType.value === 'diffusion'
        ? await approveDiffusionReviewCandidate(Number(item.record.id))
        : await approveReviewCandidate(Number(item.record.id))
      applyReviewResponse(payload)
    }
  } catch (error: any) {
    reviewActionError.value = String(error?.response?.data?.detail || error?.message || 'Failed to approve all visible records')
  } finally {
    reviewActionPending.value = null
  }
}

function queueTone(status: QueueItem['status']) {
  if (status === 'confirmed') return 'bg-[#e8fff2] text-[#0b9d63]'
  if (status === 'in_progress') return 'bg-[#edf2ff] text-[#3d56d2]'
  return 'bg-[#fff4da] text-[#c97a00]'
}

function queueLabel(status: QueueItem['status']) {
  if (status === 'confirmed') return 'Confirmed'
  if (status === 'in_progress') return 'In Progress'
  return 'Pending'
}

function recordTone(status: RecordItem['status']) {
  if (status === 'confirmed') return 'border-[#e4ebf5] bg-white opacity-80 hover:opacity-100'
  if (status === 'warning') return 'border-[#eadfca] bg-white opacity-95'
  return 'border-[#e4ebf5] bg-white opacity-80 hover:opacity-100'
}

function recordBadge(status: RecordItem['status']) {
  if (status === 'confirmed') return { label: 'Confirmed', className: 'bg-[#e8fff2] text-[#0b9d63]' }
  if (status === 'warning') return { label: 'Needs Review', className: 'bg-[#fff4da] text-[#c97a00]' }
  return { label: 'In Review', className: 'bg-[#edf2ff] text-[#3d56d2]' }
}

function fieldTone(field: ReviewField) {
  if (field.id === activeFieldId.value) return 'border-[#b8c1ff] bg-[#fbfcff] ring-1 ring-[#c5cbff]'
  if (field.status === 'confirmed') return 'border-[#e5ebf4] bg-white'
  if (field.status === 'low_conf') return 'border-[#f1ddbd] bg-white'
  return 'border-[#e5ebf4] bg-white'
}

function issueTone(severity: QueueIssue['severity']) {
  return severity === 'high'
    ? 'border-[#ffd4da] bg-[#fff5f6] text-[#ef3958]'
    : 'border-[#ffe8c7] bg-[#fffbf4] text-[#b97113]'
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col gap-3 overflow-hidden bg-[#f1f5f9] p-3">
    <section class="shell-surface px-4 py-3.5 sm:px-5">
      <div class="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div class="flex flex-wrap items-center gap-2">
          <button
            v-for="tab in reviewTabs"
            :key="tab.key"
            type="button"
            class="inline-flex items-center gap-2 rounded-full border px-3.5 py-2 text-sm font-semibold transition"
            :class="currentSection === tab.key
              ? 'border-transparent bg-[#101b29] text-white shadow-[0_16px_34px_-24px_rgba(15,23,42,0.9)]'
              : 'border-black/8 bg-white text-slate-600 hover:bg-[#f8fbff] hover:text-slate-900'"
            @click="emit('change-section', tab.key)"
          >
            {{ tab.label }}
          </button>
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <button
            type="button"
            class="inline-flex items-center rounded-full border border-black/8 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-[#f8fbff]"
            @click="emit('open-pipeline')"
          >
            Back To Pipeline
          </button>
          <button
            type="button"
            class="inline-flex items-center rounded-full border border-black/8 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-[#f8fbff]"
            @click="emit('open-knowledge')"
          >
            Open Knowledge
          </button>
        </div>
      </div>
    </section>

    <div :class="reviewGridClass">
      <aside class="min-h-0 overflow-hidden rounded-[1.65rem] border border-[#e2e8f0] bg-[#eef3f9]">
        <div class="border-b border-[#dfe7f1] px-5 py-5">
          <div class="flex items-center justify-between gap-3">
            <p class="text-[11px] font-bold uppercase tracking-[0.24em] text-[#8fa0ba]">LITERATURE INBOX</p>
            <span class="inline-flex h-7 min-w-7 items-center justify-center rounded-[0.55rem] bg-[#dfe6f2] px-2 text-sm font-semibold text-[#5e6b84]">
              {{ queueItems.length }}
            </span>
          </div>

          <div class="mt-3 relative">
            <Search class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              v-model="query"
              type="text"
              class="h-10 w-full rounded-[0.85rem] border border-[#dde5ef] bg-white pl-9 pr-3 text-sm text-slate-700 outline-none transition placeholder:text-slate-400 focus:border-[#b7c6ef]"
              placeholder="Filter documents..."
            >
          </div>

          <label class="mt-4 inline-flex items-center gap-2 text-sm font-medium text-slate-700">
            <input v-model="prioritizeLowConfidence" type="checkbox" class="h-4 w-4 rounded border-slate-300 text-[#ef3958] focus:ring-[#ef3958]">
            Prioritize Low Confidence
          </label>
        </div>

        <div class="min-h-0 space-y-2 overflow-y-auto px-4 py-4">
          <button
            v-for="item in queueItems"
            :key="item.id"
            type="button"
            class="w-full rounded-[1.15rem] border bg-white px-4 py-4 text-left shadow-[0_10px_28px_-26px_rgba(15,23,42,0.28)] transition"
            :class="item.selected
              ? 'border-[#aebdfc] ring-1 ring-[#aebdfc]/30'
              : 'border-[#e5ebf4] opacity-85 hover:border-[#d8e0eb] hover:opacity-100'"
            @click="item.id !== 'empty' && emit('select-file', item.id)"
          >
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                <p class="line-clamp-2 text-[0.98rem] font-semibold leading-6 tracking-[-0.03em]" :class="item.selected ? 'text-[#2c3ea8]' : 'text-slate-800'">{{ item.name }}</p>
              </div>
              <AlertTriangle v-if="item.alert" class="mt-1 h-4 w-4 shrink-0 text-[#f5a623]" />
            </div>

            <div class="mt-3 flex items-center gap-2">
              <span class="inline-flex rounded-[0.5rem] px-2 py-1 text-[0.72rem] font-bold uppercase tracking-[0.14em]" :class="queueTone(item.status)">
                {{ queueLabel(item.status) }}
              </span>
              <span class="text-xs text-slate-500">{{ item.recordCount }} records</span>
            </div>

            <div class="mt-4 grid grid-cols-3 gap-2 border-t border-[#edf1f6] pt-3 text-[10px] uppercase tracking-[0.14em] text-[#8ea2c0]">
              <div>
                <p>Pending</p>
                <p class="mt-1 text-sm font-semibold normal-case tracking-normal text-slate-950">{{ item.pendingCount }}</p>
              </div>
              <div>
                <p>Low Conf</p>
                <p class="mt-1 text-sm font-semibold normal-case tracking-normal text-slate-950">{{ item.lowConfidenceCount }}</p>
              </div>
              <div>
                <p>No Evidence</p>
                <p class="mt-1 text-sm font-semibold normal-case tracking-normal text-slate-950">{{ item.missingEvidenceCount }}</p>
              </div>
            </div>
          </button>
        </div>
      </aside>

      <div :class="reviewWorkspaceClass">
      <section class="self-start overflow-hidden rounded-[1.8rem] border border-[#e2e8f0] bg-white shadow-[0_18px_40px_-32px_rgba(15,23,42,0.22)]">
        <div class="border-b border-[#eef2f6] px-6 py-5">
          <div class="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div class="min-w-0">
              <h2 class="max-w-[22ch] text-[2rem] font-semibold leading-[1.03] tracking-[-0.06em] text-slate-950">
                {{ reviewTitle }}
              </h2>
              <p class="mt-3 text-[11px] font-bold uppercase tracking-[0.24em] text-[#8fa0ba]">
                {{ reviewKicker }} <span class="text-[#93a2ba]">• {{ modeSummary }}</span>
              </p>
            </div>

            <div class="flex shrink-0 items-center gap-2">
              <button
                type="button"
                class="inline-flex items-center gap-2 rounded-[0.85rem] border border-[#d9e2ef] bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-[#f8fbff]"
                :disabled="!activeField"
                @click="() => handleFlagActiveField()"
              >
                <Flag class="h-4 w-4" />
                Escalate
              </button>
              <button
                type="button"
                class="inline-flex items-center gap-2 rounded-[0.85rem] px-5 py-2.5 text-sm font-semibold transition"
                :class="canApproveAllVisible
                  ? 'bg-[#5b56ea] text-white shadow-[0_18px_36px_-24px_rgba(91,86,234,0.85)] hover:bg-[#4c47d9]'
                  : 'cursor-not-allowed bg-[#d7ddf7] text-white/80'"
                :disabled="!canApproveAllVisible || reviewActionPending === 'approve-all'"
                @click="handleApproveAll"
              >
                <CheckCheck class="h-4 w-4" />
                {{ visibleRecordItems.length === 1 ? 'Approve Record' : 'Approve All' }}
              </button>
            </div>
          </div>
          <p
            v-if="reviewActionError"
            class="mt-3 rounded-[0.8rem] border border-[#ffd4da] bg-[#fff5f6] px-3 py-2 text-sm text-[#cf334f]"
          >
            {{ reviewActionError }}
          </p>
        </div>

        <div class="space-y-5 bg-white px-6 py-4">
          <section class="rounded-[1.2rem] border border-[#eef2f6] bg-[#f8fafc]">
            <div class="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div class="px-4 pt-4">
                <div class="flex items-center gap-2">
                  <Database class="h-4 w-4 text-[#7d8eaa]" />
                  <p class="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#6c84aa]">Record Rail</p>
                </div>
              </div>

              <div class="flex flex-wrap items-center gap-1 rounded-[0.8rem] bg-[#edf2f7] p-1 lg:mr-4 lg:mt-4">
                <button
                  type="button"
                  class="inline-flex items-center rounded-[0.65rem] px-3 py-1.5 text-sm font-semibold transition"
                  :class="onlyPendingRecords ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'"
                  @click="onlyPendingRecords = !onlyPendingRecords"
                >
                  Only Pending
                </button>
                <button
                  type="button"
                  class="inline-flex items-center gap-1 rounded-[0.65rem] px-3 py-1.5 text-sm font-semibold transition"
                  :class="onlyLowConfidenceRecords ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'"
                  @click="onlyLowConfidenceRecords = !onlyLowConfidenceRecords"
                >
                  Low Confidence
                </button>
              </div>
            </div>

            <div class="mt-4 flex gap-3 overflow-x-auto px-4 pb-4 custom-scrollbar">
              <button
                v-for="item in visibleRecordItems"
                :key="item.id"
                type="button"
                class="shrink-0 min-w-[14.5rem] rounded-[1rem] border p-4 text-left transition"
                :class="item.id === activeRecordItem?.id
                  ? 'scale-[1.02] border-[#8c96ff] bg-white shadow-[0_16px_36px_-28px_rgba(91,86,234,0.45)] ring-1 ring-[#8c96ff]/20'
                  : recordTone(item.status)"
                @click="activeRecordId = item.id"
              >
                <div class="flex items-start justify-between gap-3">
                  <div>
                    <p class="text-[11px] font-bold uppercase tracking-[0.18em]" :class="item.id === activeRecordItem?.id ? 'text-[#5b56ea]' : 'text-[#9aa8bc]'">{{ item.label }}</p>
                    <p class="mt-2 text-base font-semibold text-slate-950">{{ item.title }}</p>
                    <p class="mt-1 text-sm text-slate-500">{{ item.subtitle }}</p>
                  </div>
                  <span class="inline-flex rounded-[0.5rem] px-2 py-1 text-[0.7rem] font-bold uppercase tracking-[0.14em]" :class="recordBadge(item.status).className">
                    {{ recordBadge(item.status).label }}
                  </span>
                </div>

                <div class="mt-4 text-sm text-slate-700">
                  <span class="font-medium">{{ item.metricLabel }}</span> {{ item.metricValue }}
                </div>

                <div class="mt-4 flex flex-wrap gap-2">
                  <span
                    v-if="item.lowConfidence"
                    class="inline-flex rounded-full bg-[#fff4da] px-2.5 py-1 text-xs font-semibold text-[#c97a00]"
                  >
                    Low confidence
                  </span>
                  <span
                    v-if="item.missingEvidence"
                    class="inline-flex rounded-full bg-[#fff1f3] px-2.5 py-1 text-xs font-semibold text-[#ef3958]"
                  >
                    Missing evidence
                  </span>
                </div>
                <div v-if="item.id === activeRecordItem?.id" class="mt-4 h-1 w-10 rounded-full bg-[#5b56ea]" />
              </button>

              <div
                v-if="!visibleRecordItems.length"
                class="flex min-h-[10rem] min-w-full items-center justify-center rounded-[1rem] border border-dashed border-[#dbe4f2] bg-white text-sm text-slate-500"
              >
                No records match the current review filters.
              </div>
            </div>
          </section>

          <section
            v-if="currentSection === 'queue'"
            class="space-y-3"
          >
            <div class="flex items-center justify-between gap-3">
              <div>
                <p class="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#6c84aa]">Issue Queue</p>
                <p class="mt-2 text-sm text-slate-500">
                  These items still block confirmation for the selected literature file.
                </p>
              </div>
              <span class="inline-flex rounded-full bg-[#eef2ff] px-3 py-1 text-sm font-semibold text-[#5061d1]">
                {{ queueIssues.length }}
              </span>
            </div>

            <article
              v-for="issue in queueIssues"
              :key="issue.id"
              class="rounded-[1.1rem] border px-4 py-4"
              :class="issueTone(issue.severity)"
              @click="activeRecordId = issue.recordId"
            >
              <div class="flex items-start justify-between gap-4">
                <div class="min-w-0">
                  <p class="text-[11px] font-semibold uppercase tracking-[0.18em]">{{ issue.recordLabel }} | {{ issue.fieldLabel }}</p>
                  <p class="mt-3 text-base font-semibold text-slate-950">{{ issue.value }}</p>
                  <p class="mt-2 text-sm">{{ issue.detail }}</p>
                </div>
                <AlertTriangle class="mt-1 h-4 w-4 shrink-0" />
              </div>
            </article>

            <div
              v-if="!queueIssues.length"
              class="rounded-[1rem] border border-dashed border-[#dbe4f2] bg-[#fbfcff] px-4 py-5 text-sm text-slate-500"
            >
              No blocking issues remain for the current literature file.
            </div>
          </section>

          <section v-else class="space-y-4">
            <div class="flex items-center justify-between gap-3">
              <div>
                <h3 class="text-[1.05rem] font-bold text-slate-900">
                  {{ activeRecordItem ? `${activeRecordItem.label} Review` : 'Record Review' }}
                </h3>
              </div>
              <div class="flex flex-wrap items-center gap-3 text-[11px] font-bold uppercase tracking-[0.16em] text-[#9aa8bc]">
                <span class="text-[#d38a11]">{{ documentStats.lowConfidence }} Low Conf</span>
                <span class="text-[#d5dbe6]">|</span>
                <span>{{ documentStats.missingEvidence }} No Evidence</span>
              </div>
            </div>

            <article
              v-for="field in reviewFields"
              :key="field.id"
              class="relative cursor-pointer overflow-hidden rounded-[1.2rem] border p-5 shadow-[0_12px_24px_-24px_rgba(15,23,42,0.18)] transition"
              :class="fieldTone(field)"
              @click="activeFieldId = field.id"
            >
              <div v-if="field.id === activeFieldId" class="absolute inset-y-0 left-0 w-1 bg-[#5b56ea]" />
              <div class="flex items-start justify-between gap-4">
                <div class="min-w-0 pl-1">
                  <div class="flex flex-wrap items-center gap-2">
                    <p class="text-[11px] font-bold uppercase tracking-[0.24em]" :class="field.id === activeFieldId ? 'text-[#5b56ea]' : 'text-[#7f90aa]'">{{ field.label }}</p>
                    <span
                      v-if="field.confidence !== 'High'"
                      class="h-2.5 w-2.5 rounded-full"
                      :class="field.confidence === 'Low' ? 'bg-[#f05f6f]' : 'bg-[#f0b544]'"
                    />
                  </div>
                  <p class="mt-4 text-[1.85rem] font-semibold tracking-[-0.04em] text-slate-950">{{ field.value }}</p>
                  <p class="mt-3 flex items-center gap-1.5 text-[12px] text-[#8a98ad]">
                    <FileText class="h-3.5 w-3.5" />
                    {{ field.sourceType }} | {{ field.location }}
                  </p>
                </div>

                <div class="flex shrink-0 items-center gap-1 text-slate-400" :class="field.id === activeFieldId ? 'opacity-100' : 'opacity-45'">
                  <button type="button" class="inline-flex h-8 w-8 items-center justify-center rounded-[0.6rem] transition hover:bg-slate-100 hover:text-slate-700">
                    <Pencil class="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    class="inline-flex h-8 w-8 items-center justify-center rounded-[0.6rem] transition hover:bg-slate-100 hover:text-slate-700"
                    @click.stop="activeFieldId = field.id; handleFlagActiveField(field.id)"
                  >
                    <Flag class="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    class="ml-1 inline-flex items-center rounded-[0.75rem] border px-3.5 py-2 text-sm font-bold uppercase tracking-[0.12em] transition"
                    :class="field.canConfirm
                      ? (field.id === activeFieldId ? 'border-[#5b56ea] bg-[#5b56ea] text-white hover:bg-[#4c47d9]' : 'border-[#dbe2eb] bg-white text-slate-500 hover:border-[#cdd5e2] hover:text-slate-700')
                      : 'cursor-not-allowed border-[#e5e7eb] bg-[#f8fafc] text-slate-300'"
                    :disabled="!field.canConfirm || reviewActionPending === `confirm:${Number(activeRecord?.id || '')}:${field.id}`"
                    @click.stop="handleConfirmField(field)"
                  >
                    Confirm
                  </button>
                </div>
              </div>

              <div
                v-if="field.issue"
                class="mt-4 rounded-[0.85rem] border border-[#ffd4da] bg-[#fff5f6] px-3.5 py-3 text-sm text-[#ef3958]"
              >
                {{ field.issue }}
              </div>
            </article>
          </section>
        </div>
      </section>

      <aside class="sticky top-0 self-start overflow-hidden rounded-[1.8rem] border border-[#e2e8f0] bg-white shadow-[0_18px_40px_-32px_rgba(15,23,42,0.22)]">
        <div class="border-b border-[#eef2f6] bg-[#f8fafc] px-5 py-4">
          <div class="flex items-center justify-between gap-3">
            <div class="flex items-center gap-2">
              <Quote class="h-4 w-4 text-[#8ea2c0]" />
              <p class="text-[11px] font-bold uppercase tracking-[0.24em] text-[#8ea2c0]">Evidence Inspector</p>
            </div>
            <a
              v-if="pdfUrl"
              :href="pdfUrl"
              target="_blank"
              rel="noreferrer"
              class="inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-[0.14em] text-[#5b56ea] transition hover:text-[#403bcb]"
            >
              Jump To PDF
              <ExternalLink class="h-3.5 w-3.5" />
            </a>
            <Search v-else class="h-4 w-4 text-slate-400" />
          </div>
        </div>

        <div class="space-y-6 px-5 py-6">
          <div>
            <p class="text-[11px] font-bold uppercase tracking-[0.22em] text-[#8ea2c0]">Focus Field</p>
            <p class="mt-2 text-[1.8rem] font-bold tracking-[-0.04em] text-[#2f3ea5]">
              {{ activeFieldDisplayLabel }}
            </p>
          </div>

          <div class="space-y-3 rounded-[1.1rem] border border-[#eef2f6] bg-[#f8fafc] p-4">
            <div>
              <p class="text-[11px] font-bold uppercase tracking-[0.18em] text-[#9aa8bc]">Resolved Value</p>
              <p class="mt-1 text-[1.05rem] font-semibold text-slate-900">{{ activeField?.value || 'Not captured yet' }}</p>
            </div>
            <div class="h-px w-full bg-[#e6ebf2]" />
            <dl class="grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt class="text-[11px] font-bold uppercase tracking-[0.18em] text-[#9aa8bc]">Evidence Type</dt>
                <dd class="mt-1 font-medium text-slate-700">{{ activeField?.sourceType || 'inferred' }}</dd>
              </div>
              <div>
                <dt class="text-[11px] font-bold uppercase tracking-[0.18em] text-[#9aa8bc]">Location</dt>
                <dd class="mt-1 font-medium text-slate-700">{{ activeField?.location || `Scope ${activeScopeLabel}` }}</dd>
              </div>
              <div>
                <dt class="text-[11px] font-bold uppercase tracking-[0.18em] text-[#9aa8bc]">Source Label</dt>
                <dd class="mt-1 font-medium text-slate-700">{{ activeFieldEvidenceEntry?.evidence?.source_label || 'Not linked yet' }}</dd>
              </div>
              <div>
                <dt class="text-[11px] font-bold uppercase tracking-[0.18em] text-[#9aa8bc]">{{ evidenceSecondaryLabel }}</dt>
                <dd class="mt-1 font-medium text-slate-700">{{ evidenceSecondaryValue }}</dd>
              </div>
            </dl>
          </div>

          <div>
            <p class="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.18em] text-[#8ea2c0]">
              <FileText class="h-3.5 w-3.5" />
              Evidence Preview
            </p>
            <div class="relative mt-3 rounded-[1.15rem] border border-[#f2e5bf] bg-[#fff8e8] p-5">
              <p class="font-serif text-[1.03rem] leading-10 text-[#39455c]" v-html="highlightedExcerpt" />
              <Quote class="pointer-events-none absolute bottom-2 right-2 h-10 w-10 rotate-180 text-[#7b5d18]/10" />
            </div>
          </div>

          <div v-if="evidenceImageUrl || evidencePagePreviewUrl">
            <p class="text-[11px] font-bold uppercase tracking-[0.18em] text-[#8ea2c0]">PDF Crop Preview</p>
            <div class="mt-3 space-y-3">
              <div
                v-if="evidenceImageUrl"
                class="overflow-hidden rounded-[1rem] border border-[#e4e9f2] bg-[#f8fafc]"
              >
                <img :src="evidenceImageUrl" alt="Evidence crop preview" class="max-h-[18rem] w-full object-contain bg-white" />
              </div>
              <div
                v-if="evidencePagePreviewUrl"
                class="overflow-hidden rounded-[1rem] border border-[#e4e9f2] bg-[#f8fafc]"
              >
                <img :src="evidencePagePreviewUrl" alt="Evidence page preview" class="max-h-[18rem] w-full object-contain bg-white" />
              </div>
            </div>
          </div>

          <div>
            <p class="text-[11px] font-bold uppercase tracking-[0.18em] text-[#8ea2c0]">Evidence Hits</p>
            <div class="mt-3 space-y-2">
              <div
                v-for="hit in evidenceHits"
                :key="hit.id"
                class="rounded-[0.95rem] border border-[#e4e9f2] bg-white px-3.5 py-3 text-sm text-slate-600"
              >
                <p class="font-semibold text-slate-900">{{ hit.label }}</p>
                <p class="mt-1 text-sm text-slate-500">{{ hit.meta }}</p>
              </div>
              <div
                v-if="!evidenceHits.length"
                class="rounded-[0.95rem] border border-dashed border-[#dbe4f2] bg-[#fbfcff] px-3.5 py-3 text-sm text-slate-500"
              >
                No grounded evidence is attached to the active field yet.
              </div>
            </div>
          </div>

          <div class="rounded-[1rem] border border-[#e4e9f2] bg-white p-4">
            <p class="text-[11px] font-bold uppercase tracking-[0.18em] text-[#8ea2c0]">PDF Preview</p>
            <p class="mt-3 text-sm text-slate-600">
              {{ pdfUrl
                ? `Open the linked PDF and inspect ${activeField?.location || 'the referenced source'}.`
                : 'No PDF is linked yet. Grounding is currently limited to extracted evidence text.' }}
            </p>
            <a
              v-if="pdfUrl"
              :href="pdfUrl"
              target="_blank"
              rel="noreferrer"
              class="mt-4 inline-flex items-center gap-2 rounded-[0.8rem] border border-[#d9e2ef] bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-[#f8fbff]"
            >
              Open PDF
              <ExternalLink class="h-4 w-4" />
            </a>
          </div>
        </div>
      </aside>
      </div>
    </div>
  </div>
</template>
