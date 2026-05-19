<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  AlertTriangle,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ExternalLink,
  Flag,
  FileText,
  Gauge,
  Layers,
  Loader2,
  RefreshCw,
  Search,
} from 'lucide-vue-next'

import {
  approveDiffusionReviewCandidate,
  approveDiffusionReviewRecord,
  approveReviewCandidate,
  approveReviewRecord,
  confirmDiffusionCandidateFieldEvidence,
  confirmDiffusionRecordFieldEvidence,
  confirmCandidateFieldEvidence,
  confirmRecordFieldEvidence,
  flagDiffusionCandidateFieldEvidence,
  flagDiffusionRecordFieldEvidence,
  flagCandidateFieldEvidence,
  flagRecordFieldEvidence,
  getDiffusionCandidateEvidence,
  getDiffusionCandidateFieldEvidence,
  getDiffusionRecordEvidence,
  getDiffusionRecordFieldEvidence,
  getCandidateEvidence,
  getCandidateFieldEvidence,
  getRecordEvidence,
  getRecordFieldEvidence,
  updateReviewCandidateCofExtracted,
  updateReviewCandidateLoadConditions,
  updateReviewCandidateSpeedConditions,
  updateReviewCandidateTribologicalSystem,
  unflagDiffusionCandidateFieldEvidence,
  unflagDiffusionRecordFieldEvidence,
  unflagCandidateFieldEvidence,
  unflagRecordFieldEvidence,
  updateReviewRecordCofExtracted,
  updateReviewRecordLoadConditions,
  updateReviewRecordSpeedConditions,
  updateReviewRecordTribologicalSystem,
  type BatchFile,
  type ConfidenceDetails,
  type CofExtracted,
  type DiffusionStandardFields,
  type EvidenceResult,
  type ExtractorType,
  type FieldEvidenceEntry,
  type LoadConditions,
  type LubricantComponent,
  type RecordFieldEvidenceResponse,
  type SpeedConditions,
  type TribologyData,
  type TribologicalSystem,
  type ValidationStatus,
} from '@/lib/api'
import {
  formatIonicLiquidHtml,
  lubricantAliasDisplay,
  lubricantDisplay,
  lubricantTooltip,
} from '@/lib/integratedExplorerHelpers'
import { canonicalExperimentScaleValue, experimentScaleLabel } from '@/lib/experimentScale'
import { getIonicLiquidEvidenceParts, getIonicLiquidEvidenceTerms } from '@/lib/ionicLiquidAliasKnowledge'
import { normalizePotentialDisplayText } from '@/lib/potential'
import { lazyComponent } from '@/lib/lazyComponent'
import type { HighlightRect } from '@/types/pdf-highlight'

type PdfViewerBridge = {
  scrollToPage: (page: number) => void
}

const PdfViewerWithHighlight = lazyComponent(() => import('@/components/PdfViewerWithHighlight.vue'))

const props = defineProps<{
  currentSection: string
  activeScopeLabel: string
  selectedFileName: string
  selectedFile: BatchFile | null
  initialRecordId?: string | null
  initialMode?: 'training-blockers' | null
  files: BatchFile[]
  highlightCount: number
  pdfUrl: string
  highlightData: HighlightRect[]
  scopeKey?: string | null
  reextractFile?: (fileId: string) => Promise<void> | void
}>()

const emit = defineEmits<{
  'change-section': [section: string]
  'open-pipeline': []
  'open-knowledge': []
  'open-dataset-workflow': []
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
  titleTooltip: string
  titleHtml: string
  titleIsIonicLiquid: boolean
  subtitle: string
  probe?: string
  substrate?: string
  metricLabel: string
  metricValue: string
  metricTags: StructuredTag[]
  confidence: RecordConfidenceView
  status: 'review' | 'confirmed' | 'warning'
  lowConfidence: boolean
  missingEvidence: boolean
  trainingBlocker: boolean
  selected: boolean
  record: TribologyData
}

type StructuredTag = {
  label: string
  value: string
}

type RecordConfidenceView = {
  score: number
  percent: number
  band: 'high' | 'medium' | 'low'
  label: string
  className: string
  title: string
}

type ReviewField = {
  id: string
  label: string
  value: string
  status: 'confirmed' | 'low_conf' | 'review'
  confidence: 'High' | 'Medium' | 'Low'
  evidenceStatus: 'Grounded' | 'Partial' | 'Missing'
  groundingMode: 'explicit' | 'derived' | 'inferred' | null
  groundingNote?: string
  sourceType: 'text' | 'figure' | 'table' | 'calculation' | 'inferred'
  location: string
  locationMode?: 'precise' | 'source' | 'record' | 'inferred' | 'missing'
  reviewState?: string | null
  reviewNote?: string
  canConfirm: boolean
  issue?: string
  tooltip?: string
}

type TribopairReviewPart = {
  id: string
  label: string
  value: string
  meta: string
  status: ReviewField['evidenceStatus'] | 'Optional'
  statusLabel: string
  statusClass: string
  sourceLabel: string
  sourceType: ReviewField['sourceType']
  fieldId: string
  optional: boolean
  roughness?: string
  roughnessFieldId?: string
  roughnessStatusLabel?: string
  roughnessStatusClass?: string
  roughnessSourceLabel?: string
  highlight?: boolean
}

type EvidenceSearchMode = 'loose' | 'exact-token' | 'numeric'

type EvidenceSearchSpec = {
  text: string
  mode: EvidenceSearchMode
}

const query = ref('')
const prioritizeLowConfidence = ref(true)
const onlyPendingRecords = ref(false)
const onlyLowConfidenceRecords = ref(false)
const onlyTrainingBlockers = ref(props.initialMode === 'training-blockers')
const activeFieldId = ref('material')
const activeRecordId = ref('')
const collapsedRecordIds = ref<Set<string>>(new Set())
const inboxCollapsed = ref(false)
const activeRecordEvidence = ref<EvidenceResult | null>(null)
const evidenceCache = ref<Record<string, EvidenceResult | null>>({})
const activeRecordFieldEvidence = ref<RecordFieldEvidenceResponse | null>(null)
const fieldEvidenceCache = ref<Record<string, RecordFieldEvidenceResponse | null>>({})
const reviewActionPending = ref<string | null>(null)
const reviewActionError = ref('')
const reextractingFileId = ref<string | null>(null)
const cofEditRecord = ref<TribologyData | null>(null)
const cofEditJson = ref('')
const cofEditError = ref('')
const loadEditRecord = ref<TribologyData | null>(null)
const loadEditRawText = ref('')
const loadEditSystemTotal = ref('')
const loadEditContactLoad = ref('')
const loadEditContactUnit = ref('')
const loadEditError = ref('')
const speedEditRecord = ref<TribologyData | null>(null)
const speedEditRawText = ref('')
const speedEditSliding = ref('')
const speedEditRate = ref('')
const speedEditLength = ref('')
const speedEditError = ref('')
const systemEditRecord = ref<TribologyData | null>(null)
const systemEditRawText = ref('')
const systemEditFrictionRegime = ref('unstated')
const systemEditContactGeometry = ref('')
const systemEditScale = ref('')
const systemEditError = ref('')
const pdfViewerRef = ref<PdfViewerBridge | null>(null)
const pdfPageInput = ref('')
const pdfPageCount = ref(0)
const pdfPageError = ref('')

const reviewFiles = computed<BatchFile[]>(() => Array.isArray(props.files) ? props.files.filter(Boolean) : [])
const selectedReviewFile = computed<BatchFile | null>(() => props.selectedFile || reviewFiles.value[0] || null)
const activeDocumentName = computed(() => selectedReviewFile.value?.name || props.selectedFileName || 'No review document selected')
const allRecords = computed(() => Array.isArray(selectedReviewFile.value?.records) ? selectedReviewFile.value.records : [])

const queueItems = computed<QueueItem[]>(() => {
  const base = reviewFiles.value.length
    ? reviewFiles.value.map((file) => {
        const records = Array.isArray(file.records) ? file.records : []
        const pendingCount = records.filter(recordNeedsReview).length
        const lowConfidenceCount = records.filter(recordLowConfidence).length
        const missingEvidenceCount = records.filter(recordNeedsEvidence).length
        const status: QueueItem['status'] = file.status === 'success'
          ? (pendingCount || lowConfidenceCount || missingEvidenceCount ? 'pending' : 'confirmed')
          : file.status === 'processing'
              ? 'in_progress'
              : 'pending'

        return {
          id: file.id,
          name: file.name,
          recordCount: records.length,
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
      : { label: 'COF', value: cofMetricValue(record) }
    const id = String(record.id || `record-${index + 1}`)
    const title = extractorType === 'diffusion' ? present(record.system_name) : reviewIonicLiquidDisplay(record)
    const probeRaw = extractorType === 'tribology' ? trim(record.probe_material) : ''
    const substrateRaw = extractorType === 'tribology' ? trim(record.substrate_material) : ''
    const subtitle = extractorType === 'diffusion' ? reviewIonicLiquidDisplay(record) : ''
    const dedupedSubtitle = trim(subtitle) === trim(title) ? '' : subtitle
    const confidence = recordConfidenceView(record)
    const lowConfidence = recordLowConfidence(record)
    const missingEvidence = recordNeedsEvidence(record)
    const trainingBlocker = recordIsTrainingBlocker(record)
    const isApproved = String(record.review_status || '').trim().toLowerCase() === 'approved' || record.validationStatus === 'verified'
    const status: RecordItem['status'] = isApproved && !lowConfidence && !missingEvidence
      ? 'confirmed'
      : lowConfidence || missingEvidence
          ? 'warning'
          : 'review'

    return {
      id,
      label: `Record ${index + 1}`,
      title,
      titleTooltip: extractorType === 'diffusion' ? present(record.system_name) : reviewIonicLiquidTooltip(record),
      titleHtml: extractorType === 'diffusion' ? title : formatIonicLiquidHtml(title),
      titleIsIonicLiquid: extractorType !== 'diffusion',
      subtitle: dedupedSubtitle,
      probe: probeRaw,
      substrate: substrateRaw,
      metricLabel: metric.label,
      metricValue: metric.value,
      metricTags: extractorType === 'diffusion' ? [] : cofStructuredTags(record),
      confidence,
      status,
      lowConfidence,
      missingEvidence,
      trainingBlocker,
      selected: id === activeRecordId.value,
      record,
    }
  })
})

const visibleRecordItems = computed(() => {
  let rows = recordItems.value

  if (onlyTrainingBlockers.value) {
    rows = rows.filter((item) => item.trainingBlocker)
  }

  if (onlyPendingRecords.value) {
    rows = rows.filter((item) => item.status !== 'confirmed')
  }

  if (onlyLowConfidenceRecords.value) {
    rows = rows.filter((item) => item.lowConfidence)
  }

  return rows
})

const trainingBlockerCount = computed(() => recordItems.value.filter((item) => item.trainingBlocker).length)

watch(
  visibleRecordItems,
  (items) => {
    if (!items.length) {
      activeRecordId.value = ''
      collapsedRecordIds.value = new Set()
      return
    }

    const firstItem = items[0]
    if (firstItem && !items.find((item) => item.id === activeRecordId.value)) {
      activeRecordId.value = firstItem.id
      collapsedRecordIds.value = discardCollapsedRecord(firstItem.id)
    }
  },
  { immediate: true },
)

watch(
  [recordItems, () => props.initialRecordId],
  ([items, targetId]) => {
    if (!targetId) return
    if (items.some((item) => item.id === targetId)) {
      activeRecordId.value = targetId
      collapsedRecordIds.value = discardCollapsedRecord(targetId)
    }
  },
  { immediate: true },
)

watch(
  () => props.initialMode,
  (mode) => {
    if (mode === 'training-blockers') {
      onlyTrainingBlockers.value = true
    }
  },
)

const activeRecordItem = computed(() => {
  return visibleRecordItems.value.find((item) => item.id === activeRecordId.value)
    || recordItems.value.find((item) => item.id === activeRecordId.value)
    || visibleRecordItems.value[0]
    || recordItems.value[0]
    || null
})

const activeRecord = computed<TribologyData | null>(() => activeRecordItem.value?.record || null)

const documentTotal = computed(() => allRecords.value.length)
const documentPending = computed(() => allRecords.value.filter(recordNeedsReview).length)
const documentLowConfidence = computed(() => allRecords.value.filter(recordLowConfidence).length)
const documentMissingEvidence = computed(() => allRecords.value.filter(recordNeedsEvidence).length)
const queueItemCount = computed(() => queueItems.value.length)
const recordItemCount = computed(() => recordItems.value.length)
const visibleRecordCount = computed(() => visibleRecordItems.value.length)

const activeLiteratureId = computed<number | null>(() => {
  const match = String(props.pdfUrl || '').match(/\/pdf\/(\d+)/)
  const parsed = Number(match?.[1] || '')
  return Number.isFinite(parsed) ? parsed : null
})

watch(() => props.pdfUrl, () => {
  pdfPageInput.value = ''
  pdfPageCount.value = 0
  pdfPageError.value = ''
})

function handlePdfLoaded(pageCount: number) {
  pdfPageCount.value = pageCount
  pdfPageError.value = ''
}

function jumpToPdfPage() {
  const parsed = Number.parseInt(pdfPageInput.value, 10)
  if (!Number.isFinite(parsed)) {
    pdfPageError.value = '请输入页码'
    return
  }
  const maxPage = Math.max(1, pdfPageCount.value || parsed)
  const targetPage = Math.min(maxPage, Math.max(1, parsed))
  pdfPageInput.value = String(targetPage)
  pdfPageError.value = ''
  pdfViewerRef.value?.scrollToPage(targetPage)
}

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

type ReviewRecordEntityType = 'candidate' | 'record'

function reviewRecordEntityType(record: TribologyData | null | undefined): ReviewRecordEntityType {
  const explicit = trim((record as any)?.review_entity_type || (record as any)?.reviewEntityType).toLowerCase()
  if (explicit === 'record' || explicit === 'final' || explicit === 'final_record') return 'record'
  if (explicit === 'candidate' || explicit === 'record_candidate') return 'candidate'

  const origin = trim(record?.record_origin).toLowerCase()
  if (origin.includes('candidate') || origin === 'llm_extraction' || origin === 'reprocessed_extraction') {
    return 'candidate'
  }
  if (origin.includes('knowledge') || origin.includes('sync') || origin.includes('cached') || origin.includes('promoted')) {
    return 'record'
  }
  return 'candidate'
}

function reviewEntityType(record: TribologyData | null | undefined): ReviewRecordEntityType {
  if (recordExtractorType(record) === 'diffusion') {
    const explicit = trim((record as any)?.review_entity_type || (record as any)?.reviewEntityType).toLowerCase()
    if (explicit === 'record' || explicit === 'final' || explicit === 'final_record' || explicit === 'diffusion_record') {
      return 'record'
    }
    if (explicit === 'candidate' || explicit === 'record_candidate' || explicit === 'diffusion_candidate') {
      return 'candidate'
    }

    const origin = trim(record?.record_origin).toLowerCase()
    if (origin.includes('knowledge') || origin.includes('sync') || origin.includes('cached') || origin.includes('promoted')) {
      return 'record'
    }
    return 'candidate'
  }
  return reviewRecordEntityType(record)
}

function promotedDiffusionRecordId(record: TribologyData | null | undefined) {
  if (recordExtractorType(record) !== 'diffusion') return null
  const raw = (record as any)?.promoted_record_id ?? (record as any)?.promotedRecordId
  const id = Number(raw)
  return Number.isFinite(id) && id > 0 ? id : null
}

function isPromotedDiffusionCandidate(record: TribologyData | null | undefined) {
  return promotedDiffusionRecordId(record) !== null
}

function diffusionStorageState(record: TribologyData | null | undefined) {
  if (recordExtractorType(record) !== 'diffusion') return null
  if (isPromotedDiffusionCandidate(record)) return 'promoted'
  return reviewEntityType(record) === 'candidate' ? 'candidate' : 'record'
}

function reviewCacheKey(
  literatureId: number,
  recordId: number,
  extractorType: ExtractorType,
  entityType: ReviewRecordEntityType,
) {
  return `${literatureId}:${extractorType}:${entityType}:${recordId}`
}

function payloadMatchesLiterature(payload: RecordFieldEvidenceResponse, literatureId: number) {
  const payloadLiteratureId = Number(payload.literature_id || 0)
  return !literatureId || !payloadLiteratureId || payloadLiteratureId === literatureId
}

async function fetchTribologyEvidence(
  record: TribologyData,
  literatureId: number,
  entityType: ReviewRecordEntityType,
) {
  const recordId = Number(record.id || '')
  const primary = entityType === 'record'
    ? () => getRecordEvidence(literatureId, recordId)
    : () => getCandidateEvidence(literatureId, recordId)
  const fallback = entityType === 'record'
    ? () => getCandidateEvidence(literatureId, recordId)
    : () => getRecordEvidence(literatureId, recordId)

  try {
    return await primary()
  } catch (primaryError) {
    if (entityType === 'candidate') {
      console.warn('[Review] Candidate evidence lookup failed; trying final record endpoint.', primaryError)
    }
    return fallback()
  }
}

async function fetchTribologyFieldEvidence(
  record: TribologyData,
  literatureId: number,
  entityType: ReviewRecordEntityType,
) {
  const recordId = Number(record.id || '')
  const loadCandidate = async () => {
    const payload = await getCandidateFieldEvidence(recordId, literatureId)
    if (!payloadMatchesLiterature(payload, literatureId)) {
      throw new Error(`Candidate field evidence belongs to literature ${payload.literature_id}, expected ${literatureId}`)
    }
    return payload
  }
  const loadRecord = async () => {
    const payload = await getRecordFieldEvidence(recordId)
    if (!payloadMatchesLiterature(payload, literatureId)) {
      throw new Error(`Record field evidence belongs to literature ${payload.literature_id}, expected ${literatureId}`)
    }
    return payload
  }
  const primary = entityType === 'record' ? loadRecord : loadCandidate
  const fallback = entityType === 'record' ? loadCandidate : loadRecord

  try {
    return await primary()
  } catch (primaryError) {
    if (entityType === 'candidate') {
      console.warn('[Review] Candidate field evidence lookup failed or mismatched; trying final record endpoint.', primaryError)
    }
    return fallback()
  }
}

async function fetchDiffusionEvidence(
  record: TribologyData,
  literatureId: number,
  entityType: ReviewRecordEntityType,
) {
  const recordId = Number(record.id || '')
  const primary = entityType === 'record'
    ? () => getDiffusionRecordEvidence(literatureId, recordId)
    : () => getDiffusionCandidateEvidence(literatureId, recordId)
  const fallback = entityType === 'record'
    ? () => getDiffusionCandidateEvidence(literatureId, recordId)
    : () => getDiffusionRecordEvidence(literatureId, recordId)

  try {
    return await primary()
  } catch (primaryError) {
    console.warn('[Review] Diffusion evidence lookup failed; trying alternate endpoint.', primaryError)
    return fallback()
  }
}

async function fetchDiffusionFieldEvidence(
  record: TribologyData,
  literatureId: number,
  entityType: ReviewRecordEntityType,
) {
  const recordId = Number(record.id || '')
  const loadCandidate = async () => {
    const payload = await getDiffusionCandidateFieldEvidence(recordId)
    if (!payloadMatchesLiterature(payload, literatureId)) {
      throw new Error(`Diffusion candidate field evidence belongs to literature ${payload.literature_id}, expected ${literatureId}`)
    }
    return payload
  }
  const loadRecord = async () => {
    const payload = await getDiffusionRecordFieldEvidence(recordId)
    if (!payloadMatchesLiterature(payload, literatureId)) {
      throw new Error(`Diffusion record field evidence belongs to literature ${payload.literature_id}, expected ${literatureId}`)
    }
    return payload
  }
  const primary = entityType === 'record' ? loadRecord : loadCandidate
  const fallback = entityType === 'record' ? loadCandidate : loadRecord

  try {
    return await primary()
  } catch (primaryError) {
    console.warn('[Review] Diffusion field evidence lookup failed or mismatched; trying alternate endpoint.', primaryError)
    return fallback()
  }
}

const reviewFields = computed<ReviewField[]>(() => buildReviewFields(activeRecord.value, activeRecordFieldEvidence.value?.fields))
const visibleReviewFields = computed(() => filterVisibleReviewFields(activeRecord.value, reviewFields.value))
const embeddedTribopairFieldIds = new Set(['probe_roughness', 'substrate_roughness'])

watch(
  [reviewFields, activeRecord],
  ([fields]) => {
    const visibleFields = filterVisibleReviewFields(activeRecord.value, fields)
    const activeFieldExists = fields.some((field) => field.id === activeFieldId.value)
    const activeFieldIsVisible = visibleFields.some((field) => field.id === activeFieldId.value)
    const activeFieldIsEmbedded = hasStructuredTribopair(activeRecord.value) && embeddedTribopairFieldIds.has(activeFieldId.value)
    if (!activeFieldExists || (!activeFieldIsVisible && !activeFieldIsEmbedded)) {
      activeFieldId.value = visibleFields[0]?.id || fields[0]?.id || (activeExtractorType.value === 'diffusion' ? 'system_name' : 'material')
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

	    const entityType = reviewEntityType(record)
	    const cacheKey = reviewCacheKey(literatureId, recordId, extractorType, entityType)
    const cachedEvidence = evidenceCache.value[cacheKey]
    if (cachedEvidence) {
      activeRecordEvidence.value = cachedEvidence
    } else {
      try {
        const evidence = extractorType === 'diffusion'
	          ? await fetchDiffusionEvidence(record, literatureId, entityType)
	          : await fetchTribologyEvidence(record, literatureId, entityType)
	        evidenceCache.value[cacheKey] = evidence
	        activeRecordEvidence.value = evidence
	      } catch {
	        evidenceCache.value[cacheKey] = null
	        activeRecordEvidence.value = null
      }
    }

    const cachedFieldEvidence = fieldEvidenceCache.value[cacheKey]
    if (cachedFieldEvidence) {
      activeRecordFieldEvidence.value = cachedFieldEvidence
	    } else {
	      try {
	        const fieldEvidence = extractorType === 'diffusion'
	          ? await fetchDiffusionFieldEvidence(record, literatureId, entityType)
	          : await fetchTribologyFieldEvidence(record, literatureId, entityType)
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
const canApproveAllVisible = computed(() => visibleRecordCount.value > 0 && visibleRecordItems.value.every((item) => recordCanApprove(item.record, remoteFieldsForRecord(item.record))))
const approveAllLabel = computed(() => {
  if (visibleRecordCount.value === 1) {
    return approveActionLabel(visibleRecordItems.value[0]?.record || null)
  }
  if (activeExtractorType.value === 'diffusion') return '全部确认入库'
  return '全部确认'
})
const isReextractingCurrentFile = computed(() => {
  const fileId = selectedReviewFile.value?.id || ''
  return Boolean(fileId && reextractingFileId.value === fileId) || selectedReviewFile.value?.status === 'processing'
})
const canReextractCurrentFile = computed(() => {
  const file = selectedReviewFile.value
  return Boolean(file?.id && file.id !== 'empty' && props.reextractFile && !isReextractingCurrentFile.value)
})

const activeRecordIndex = computed(() => visibleRecordItems.value.findIndex((item) => item.id === activeRecordId.value))
const hasPrevRecord = computed(() => activeRecordIndex.value > 0)
const hasNextRecord = computed(() => activeRecordIndex.value >= 0 && activeRecordIndex.value < visibleRecordCount.value - 1)

const fieldEvidenceContext = computed(() => buildFieldEvidence(activeRecord.value, activeField.value, activeRecordEvidence.value, activeFieldEvidenceEntry.value))
const evidenceExcerpt = computed(() => fieldEvidenceContext.value.excerpt)

const highlightedExcerpt = computed(() => {
  return highlightTerms(evidenceExcerpt.value, fieldEvidenceContext.value.specs)
})

function normalizeResolvedBBox(value: unknown) {
  if (!Array.isArray(value) || value.length < 4) return null
  const coords = value.slice(0, 4).map((item) => Number(item))
  if (!coords.every(Number.isFinite)) return null
  return coords as [number, number, number, number]
}

function discardCollapsedRecord(recordId: string) {
  const next = new Set(collapsedRecordIds.value)
  next.delete(recordId)
  return next
}

function isRecordExpanded(recordId: string) {
  return activeRecordId.value === recordId && !collapsedRecordIds.value.has(recordId)
}

function toggleRecordItem(item: RecordItem) {
  if (activeRecordId.value !== item.id) {
    activeRecordId.value = item.id
    collapsedRecordIds.value = discardCollapsedRecord(item.id)
    return
  }

  const next = new Set(collapsedRecordIds.value)
  if (next.has(item.id)) {
    next.delete(item.id)
  } else {
    next.add(item.id)
  }
  collapsedRecordIds.value = next
}

function quoteMatchesFieldSpecs(quote: string, specs: EvidenceSearchSpec[]) {
  if (!quote) return false
  return specs.some((spec) => matchesEvidenceSpecText(quote, spec))
}

function fieldEvidenceTextMatchesSpecs(matchedText: string, quote: string, specs: EvidenceSearchSpec[]) {
  return quoteMatchesFieldSpecs(matchedText, specs) || quoteMatchesFieldSpecs(quote, specs)
}

const activeFieldResolvedEvidence = computed(() => {
  const fieldEntry = activeFieldEvidenceEntry.value
  const specs = fieldEvidenceContext.value.specs
  const entryBbox = normalizeResolvedBBox(fieldEntry?.evidence?.bbox)
  const entryPage = Number(fieldEntry?.evidence?.page || 0)
  const directQuote = trim(fieldEntry?.evidence?.quote)
  const directMatchedText = trim(fieldEntry?.evidence?.matched_text ?? (fieldEntry?.evidence as Record<string, unknown> | undefined)?.matchedText)
  const sourceType = trim(fieldEntry?.evidence?.source_type).toLowerCase()
  const isExplicitField = trim(fieldEntry?.grounding_mode).toLowerCase() === 'explicit'
  const isDerivedField = trim(fieldEntry?.grounding_mode).toLowerCase() === 'derived'
  const isFigureAnchor = sourceType.includes('figure') || trim(fieldEntry?.evidence?.source_label).toLowerCase().startsWith('fig')
  const fieldTextMatches = fieldEvidenceTextMatchesSpecs(directMatchedText, directQuote, specs)
  const canUseStoredBBox = sourceType !== 'table' || Boolean(directMatchedText) || isExplicitField

  if (entryBbox && entryPage > 0 && canUseStoredBBox && (fieldTextMatches || isDerivedField || isExplicitField || isFigureAnchor)) {
    return {
      page: entryPage,
      bbox: entryBbox,
      quote: directQuote || directMatchedText,
      imageB64: null,
      sourceLabel: formatReviewSourceLabel(fieldEntry?.evidence?.source_label),
      sampleId: trim(fieldEntry?.evidence?.sample_id),
      mode: 'field' as const,
    }
  }

  return null
})

const evidenceImageUrl = computed(() => {
  const imageB64 = activeFieldResolvedEvidence.value?.imageB64 || null
  return imageB64 ? `data:image/png;base64,${imageB64}` : null
})

const evidencePagePreviewUrl = computed(() => {
  if (!activeFieldResolvedEvidence.value) return null
  const imageB64 = activeRecordEvidence.value?.page_preview_b64
  return imageB64 ? `data:image/png;base64,${imageB64}` : null
})

const evidenceSecondaryLabel = computed(() => activeExtractorType.value === 'diffusion' ? '体系关联' : '样品关联')
const evidenceSecondaryValue = computed(() => {
  if (activeExtractorType.value === 'diffusion') {
    return activeRecord?.value?.system_name || '尚未关联'
  }
  return activeFieldResolvedEvidence.value?.sampleId || activeFieldEvidenceEntry.value?.evidence?.sample_id || activeRecord?.value?.sample_id || '尚未关联'
})
const activeFieldSourceLabel = computed(() => {
  return formatReviewSourceLabel(activeFieldEvidenceEntry.value?.evidence?.source_label)
})

const recordHighlights = computed<HighlightRect[]>(() => {
  const resolved = activeFieldResolvedEvidence.value
  if (resolved) {
    const [x0, y0, x1, y1] = resolved.bbox
    const w = Math.max(0, x1 - x0)
    const h = Math.max(0, y1 - y0)
    if (w > 0 && h > 0) {
      return [{
        id: `field:${normalizeFieldKey(activeFieldId.value)}`,
        page: resolved.page,
        coords: { x: x0, y: y0, w, h },
        color: 'rgba(91, 86, 234, 0.24)',
      }]
    }
  }
  return []
})

const activeHighlightId = computed(() => {
  const id = `field:${normalizeFieldKey(activeFieldId.value)}`
  return recordHighlights.value.some((h) => h.id === id) ? id : null
})

function handleHighlightClick(highlightId: string) {
  const match = highlightId.startsWith('field:') ? highlightId.slice(6) : ''
  if (!match) return
  const field = reviewFields.value.find((item) => normalizeFieldKey(item.id) === match)
  if (field) activeFieldId.value = field.id
}

function gotoPrevRecord() {
  if (!hasPrevRecord.value) return
  const previous = visibleRecordItems.value[activeRecordIndex.value - 1]
  if (previous) {
    activeRecordId.value = previous.id
    collapsedRecordIds.value = discardCollapsedRecord(previous.id)
  }
}

function gotoNextRecord() {
  if (!hasNextRecord.value) return
  const next = visibleRecordItems.value[activeRecordIndex.value + 1]
  if (next) {
    activeRecordId.value = next.id
    collapsedRecordIds.value = discardCollapsedRecord(next.id)
  }
}

async function handleReextractCurrentFile() {
  const fileId = selectedReviewFile.value?.id
  if (!fileId || fileId === 'empty' || !props.reextractFile || isReextractingCurrentFile.value) return

  reextractingFileId.value = fileId
  reviewActionPending.value = 'reextract'
  reviewActionError.value = ''
  activeRecordEvidence.value = null
  activeRecordFieldEvidence.value = null
  evidenceCache.value = {}
  fieldEvidenceCache.value = {}

  try {
    await props.reextractFile(fileId)
  } catch (error: any) {
    reviewActionError.value = String(error?.response?.data?.detail || error?.message || '重新提取失败')
  } finally {
    reextractingFileId.value = null
    if (reviewActionPending.value === 'reextract') {
      reviewActionPending.value = null
    }
  }
}

function trim(value: unknown) {
  return String(value ?? '').trim()
}

function readPlainObject(value: unknown): Record<string, unknown> {
  if (!value) return {}
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
    } catch {
      return {}
    }
  }
  return typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function diffusionStandardFields(record: TribologyData | null | undefined): DiffusionStandardFields {
  if (!record) return {}
  const features = readPlainObject(record.novel_features_json)
  const nested = readPlainObject(features.standard_fields || features.standardFields)
  const direct = readPlainObject((record as any).diffusion_standard_fields || (record as any).diffusionStandardFields)
  return { ...nested, ...direct } as DiffusionStandardFields
}

function diffusionStandardText(record: TribologyData, ...keys: string[]) {
  const standard = diffusionStandardFields(record) as Record<string, unknown>
  return keys.map((key) => trim(standard[key])).find(Boolean) || ''
}

function isPlaceholderValue(value: unknown) {
  const normalized = trim(value).toLowerCase().replace(/[._-]+/g, ' ')
  return ['unknown', 'not known', 'n/a', 'na', 'none', 'null', 'undefined', 'unstated'].includes(normalized)
}

function formatReviewSourceLabel(value: unknown) {
  return trim(value).replace(
    /\b(Fig(?:ure)?\.?\s*\d+)\s*([A-Z])\b/g,
    (_match, prefix, panel) => `${prefix.replace(/^Figure/i, 'Fig.')}${String(panel).toLowerCase()}`,
  )
}

function present(value: unknown) {
  const text = trim(value)
  return text && !isPlaceholderValue(text) ? text : 'Not captured yet'
}

function normalizeConfidenceValue(value: unknown): number | null {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return null
  if (numeric > 1 && numeric <= 100) return numeric / 100
  return Math.max(0, Math.min(1, numeric))
}

function recordConfidenceDetails(record: TribologyData | null | undefined): ConfidenceDetails | null {
  const details = record?.confidence_details || record?.confidenceDetails || null
  return details && typeof details === 'object' ? details : null
}

function recordConfidenceScore(record: TribologyData | null | undefined): number {
  const details = recordConfidenceDetails(record)
  const detailScore = normalizeConfidenceValue(details?.score)
  if (detailScore != null) return detailScore
  const storedScore = normalizeConfidenceValue(record?.confidence)
  if (storedScore != null) return storedScore
  return fallbackReviewConfidenceScore(record)
}

function fallbackReviewConfidenceScore(record: TribologyData | null | undefined): number {
  if (!record) return 0
  const extractorType = recordExtractorType(record)
  const fieldMap = resolveRecordFieldEvidenceMap(record)
  const slotScores: number[] = extractorType === 'diffusion'
    ? [
        hasRecordValue(record, 'system_name', extractorType) ? 1 : 0,
        hasRecordValue(record, 'ionic_liquid', extractorType) ? 1 : 0,
        hasAnyDiffusionCoefficient(record) ? 1 : 0,
      ]
    : requiredTribologyFieldKeys(record).map((key) => hasRecordValue(record, key, extractorType) ? 1 : 0)
  const groundingKeys = extractorType === 'diffusion'
    ? ['system_name', 'ionic_liquid', 'd_total', 'd_cation', 'd_anion']
    : requiredTribologyFieldKeys(record)
  const groundingScores: number[] = groundingKeys.map((key) => {
    const status = resolveFieldEvidenceStatus(fieldMap[key], fieldValueForKey(record, key, extractorType))
    if (status === 'Grounded') return 1
    if (status === 'Partial') return 0.5
    return 0
  })
  const completeness = slotScores.reduce((sum, value) => sum + value, 0) / Math.max(1, slotScores.length)
  const grounding = groundingScores.reduce((sum, value) => sum + value, 0) / Math.max(1, groundingScores.length)
  const contextKeys = ['load', 'speed', 'shear_rate', 'temperature', 'potential', 'water_content', 'surface_roughness']
  const context = Math.min(1, contextKeys.filter((key) => hasRecordValue(record, key, extractorType)).length / 4)
  const valueQuality = record.validationStatus === 'warning' ? 0.45 : 0.78
  return Math.max(0.05, Math.min(1, 0.35 * completeness + 0.35 * grounding + 0.2 * valueQuality + 0.1 * context))
}

function confidenceComponentLabel(key: string) {
  if (key === 'completeness') return '完整度'
  if (key === 'grounding') return '证据'
  if (key === 'value_quality') return '数值'
  if (key === 'context') return '上下文'
  return key.replace(/_/g, ' ')
}

function confidenceReasonLabel(reason: string) {
  const labels: Record<string, string> = {
    missing_material: '缺材料',
    weak_material: '材料弱匹配',
    missing_lubricant: '缺离子液体',
    weak_lubricant: '离子液体弱匹配',
    missing_primary_metric: '缺主指标',
    missing_diffusion_coefficient: '缺扩散系数',
    sparse_conditions: '条件稀疏',
    value_quality_gap: '数值质量不足',
    pending_review_ceiling: '待审上限',
    unreviewed_ceiling: '未审上限',
    partial_review_ceiling: '部分确认上限',
    field_review_ceiling: '字段确认上限',
    review_flagged_ceiling: '标记上限',
    review_rejected_ceiling: '驳回上限',
    review_pending: '待人工确认',
    review_flagged: '人工标记',
    model_inferred: '模型推断',
    panel_mismatch: '图版不一致',
    cof_uncertain: 'COF 不确定',
    cof_out_of_range: 'COF 超范围',
    unresolved_ionic_liquid: '离子液体未解析',
  }
  if (labels[reason]) return labels[reason]
  return reason.replace(/^missing_/, '缺 ').replace(/^partial_/, '部分 ').replace(/^weak_/, '弱 ').replace(/_/g, ' ')
}

function recordConfidenceView(record: TribologyData | null | undefined): RecordConfidenceView {
  const score = recordConfidenceScore(record)
  const percent = Math.round(score * 100)
  const band: RecordConfidenceView['band'] = percent >= 80 ? 'high' : percent >= 55 ? 'medium' : 'low'
  const className = band === 'high'
    ? 'border-[#bbf7d0] bg-[#ecfdf5] text-[#047857]'
    : band === 'medium'
      ? 'border-[#fed7aa] bg-[#fff7ed] text-[#c2410c]'
      : 'border-[#fecdd3] bg-[#fff1f2] text-[#be123c]'
  const details = recordConfidenceDetails(record)
  const components = details?.components || {}
  const componentText = Object.entries(components)
    .filter(([, value]) => Number.isFinite(Number(value)))
    .map(([key, value]) => `${confidenceComponentLabel(key)} ${Math.round(Number(value) * 100)}%`)
    .join(' · ')
  const penaltyText = (details?.penalties || [])
    .slice(0, 3)
    .map((item) => confidenceReasonLabel(item.reason))
    .join(' · ')
  const titleParts = [
    `自研置信度 ${percent}%`,
    componentText,
    penaltyText ? `主要扣分：${penaltyText}` : '',
  ].filter(Boolean)

  return {
    score,
    percent,
    band,
    label: band === 'high' ? '高' : band === 'medium' ? '中' : '低',
    className,
    title: titleParts.join('\n'),
  }
}

function normalizeCofExtracted(value: unknown): CofExtracted | null {
  if (!value) return null
  if (typeof value === 'string') {
    try {
      return normalizeCofExtracted(JSON.parse(value))
    } catch {
      return null
    }
  }
  if (typeof value !== 'object') return null
  const raw = value as any
  return {
    raw_text: raw.raw_text ?? raw.rawText ?? null,
    value_type: raw.value_type ?? raw.valueType ?? null,
    cof_min: raw.cof_min ?? raw.cofMin ?? null,
    cof_max: raw.cof_max ?? raw.cofMax ?? null,
    cof_average: raw.cof_average ?? raw.cofAverage ?? null,
    dependent_variable: raw.dependent_variable ?? raw.dependentVariable ?? null,
    test_condition_value: raw.test_condition_value ?? raw.testConditionValue ?? null,
    note: raw.note ?? null,
    segments: Array.isArray(raw.segments)
      ? raw.segments.map((segment: unknown) => normalizeCofExtracted(segment)).filter(Boolean) as CofExtracted[]
      : undefined,
  }
}

function deriveCofExtractedFromText(text: unknown): CofExtracted | null {
  const raw = trim(text)
  if (!raw) return null
  const range = raw.match(/(\d+(?:\.\d+)?)\s*[-–]\s*(\d+(?:\.\d+)?)/)
  if (!range) {
    const single = Number(raw.match(/\d+(?:\.\d+)?/)?.[0])
    if (!Number.isFinite(single)) return null
    return {
      raw_text: raw,
      value_type: 'single',
      cof_min: single,
      cof_max: single,
      cof_average: single,
      dependent_variable: null,
      test_condition_value: null,
    }
  }
  const min = Number(range[1])
  const max = Number(range[2])
  const condition = raw.match(/\bat\s+([^;]+)/i)?.[1]?.trim() || null
  const velocityDependent = /velocity|scan velocity|speed/i.test(raw)
  const loadDependent = /nN|load/i.test(condition || raw)
  const segments = raw.includes(';')
    ? raw.split(';').map((part) => deriveCofExtractedFromText(part.trim())).filter(Boolean) as CofExtracted[]
    : undefined
  return {
    raw_text: raw,
    value_type: condition || segments?.length ? 'conditional' : 'range',
    cof_min: Number.isFinite(min) ? min : null,
    cof_max: Number.isFinite(max) ? max : null,
    cof_average: Number.isFinite(min) && Number.isFinite(max) ? Number(((min + max) / 2).toFixed(6)) : null,
    dependent_variable: loadDependent ? 'normal load' : velocityDependent ? 'scan velocity' : null,
    test_condition_value: condition,
    segments,
  }
}

function cofExtractedForRecord(record: TribologyData | null | undefined): CofExtracted | null {
  if (!record) return null
  return normalizeCofExtracted((record as any).cof_extracted ?? (record as any).cofExtracted)
    || deriveCofExtractedFromText(record.cof)
}

function cofStructuredTags(record: TribologyData | null | undefined): { label: string, value: string }[] {
  const cof = cofExtractedForRecord(record)
  if (!cof) return []
  const valueType = trim(cof.value_type ?? cof.valueType).toLowerCase()
  const min = cof.cof_min ?? cof.cofMin
  const max = cof.cof_max ?? cof.cofMax
  const hasDependency = Boolean(trim(cof.dependent_variable ?? cof.dependentVariable))
    || Boolean(trim(cof.test_condition_value ?? cof.testConditionValue))
    || Boolean(cof.segments?.length)
  const isDeterminateSingle = valueType === 'single' || (min != null && max != null && Number(min) === Number(max) && !hasDependency)
  if (isDeterminateSingle) return []

  const tags: { label: string, value: string }[] = []
  if (min != null) tags.push({ label: 'Min', value: String(min) })
  if (max != null) tags.push({ label: 'Max', value: String(max) })
  const avg = cof.cof_average ?? cof.cofAverage
  if (avg != null) tags.push({ label: 'Avg', value: String(avg) })
  const dep = trim(cof.dependent_variable ?? cof.dependentVariable)
  if (dep) tags.push({ label: '依赖', value: dep })
  const cond = trim(cof.test_condition_value ?? cof.testConditionValue)
  if (cond) tags.push({ label: '条件', value: cond })

  return tags
}

function cofMetricValue(record: TribologyData) {
  const cof = cofExtractedForRecord(record)
  if (!cof) return present(record.cof)
  const min = cof.cof_min ?? cof.cofMin
  const max = cof.cof_max ?? cof.cofMax
  if (min != null && max != null && min !== max) return `${min}-${max}`
  const average = cof.cof_average ?? cof.cofAverage
  return average != null ? String(average) : present(record.cof)
}

const FORCE_UNIT_TO_N: Record<string, number> = {
  kn: 1e3,
  n: 1,
  mn: 1e-3,
  un: 1e-6,
  'µn': 1e-6,
  'μn': 1e-6,
  nn: 1e-9,
  pn: 1e-12,
}

function asNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function forceToNewton(value: string, unit: string): number | null {
  const parsed = Number(value)
  const multiplier = FORCE_UNIT_TO_N[unit.trim().replace('μ', 'µ').toLowerCase()]
  if (!Number.isFinite(parsed) || multiplier == null) return null
  return Number((parsed * multiplier).toPrecision(12))
}

function forceDisplayUnits() {
  return [
    { unit: 'N', factor: 1 },
    { unit: 'mN', factor: 1e-3 },
    { unit: 'µN', factor: 1e-6 },
    { unit: 'nN', factor: 1e-9 },
    { unit: 'pN', factor: 1e-12 },
  ] as const
}

function pickForceDisplayUnit(...values: Array<number | null | undefined>) {
  const units = forceDisplayUnits()
  const maxAbs = Math.max(...values.map((value) => Math.abs(Number(value || 0))))
  if (!Number.isFinite(maxAbs) || maxAbs <= 0) return units[0]!
  return units.find((unit) => maxAbs >= unit.factor) || units[units.length - 1]!
}

function formatPlainMagnitude(value: number) {
  if (!Number.isFinite(value)) return ''
  const abs = Math.abs(value)
  const decimals = abs >= 100 ? 0 : abs >= 10 ? 1 : abs >= 1 ? 2 : abs >= 0.1 ? 3 : 4
  return Number(value.toFixed(decimals)).toLocaleString('en-US', {
    maximumFractionDigits: decimals,
  })
}

function formatForceValue(valueN: unknown, preferredUnit?: ReturnType<typeof pickForceDisplayUnit>) {
  const value = asNumberOrNull(valueN)
  if (value == null) return ''
  const unit = preferredUnit || pickForceDisplayUnit(value)
  return `${formatPlainMagnitude(value / unit.factor)} ${unit.unit}`
}

function forceStructuredTag(label: string, valueN: unknown): StructuredTag | null {
  const value = asNumberOrNull(valueN)
  if (value == null) return null
  const unit = pickForceDisplayUnit(value)
  return {
    label,
    value: formatForceValue(value, unit),
  }
}

function forceRangeStructuredTag(label: string, minN: unknown, maxN: unknown): StructuredTag | null {
  const min = asNumberOrNull(minN)
  const max = asNumberOrNull(maxN)
  if (min == null || max == null) return null
  const unit = pickForceDisplayUnit(min, max)
  const minLabel = formatPlainMagnitude(min / unit.factor)
  const maxLabel = formatPlainMagnitude(max / unit.factor)
  if (min === max) {
    return {
      label: '载荷',
      value: `${minLabel} ${unit.unit}`,
    }
  }
  return {
    label,
    value: `${minLabel}–${maxLabel} ${unit.unit}`,
  }
}

function normalizeLoadConditions(value: unknown): LoadConditions | null {
  if (!value) return null
  if (typeof value === 'string') {
    try {
      return normalizeLoadConditions(JSON.parse(value))
    } catch {
      return deriveLoadConditionsFromText(value)
    }
  }
  if (typeof value !== 'object') return null
  const raw = value as any
  return {
    raw_text: raw.raw_text ?? raw.rawText ?? null,
    value_type: raw.value_type ?? raw.valueType ?? null,
    system_total_load_N: raw.system_total_load_N ?? raw.systemTotalLoadN ?? null,
    contact_load_per_unit_N: raw.contact_load_per_unit_N ?? raw.contactLoadPerUnitN ?? null,
    contact_unit_type: raw.contact_unit_type ?? raw.contactUnitType ?? null,
    load_min_N: raw.load_min_N ?? raw.loadMinN ?? null,
    load_max_N: raw.load_max_N ?? raw.loadMaxN ?? null,
    note: raw.note ?? null,
  }
}

function deriveLoadConditionsFromText(text: unknown): LoadConditions | null {
  const raw = trim(text)
  if (!raw) return null
  const matches = [...raw.matchAll(/(\d+(?:\.\d+)?)(?:\s*[-–]\s*(\d+(?:\.\d+)?))?\s*(kN|mN|µN|μN|uN|nN|pN|N)\b/gi)]
  if (!matches.length) return null
  const loads = matches.map((match) => {
    const first = forceToNewton(match[1] || '', match[3] || '')
    const second = match[2] ? forceToNewton(match[2], match[3] || '') : first
    return { first, second, index: match.index ?? 0, end: (match.index ?? 0) + match[0].length }
  }).filter((item) => item.first != null)
  if (!loads.length) return null

  const lower = raw.toLowerCase()
  const payload: LoadConditions = {
    raw_text: raw,
    value_type: loads.length > 1 || raw.includes(';') ? 'composite' : matches[0]?.[2] ? 'range' : 'single',
    system_total_load_N: null,
    contact_load_per_unit_N: null,
    contact_unit_type: null,
    load_min_N: Math.min(...loads.map((item) => Number(item.first))),
    load_max_N: Math.max(...loads.map((item) => Number(item.second ?? item.first))),
  }
  loads.forEach((item) => {
    const segmentStart = raw.lastIndexOf(';', item.index) + 1
    const rawSegmentEnd = raw.indexOf(';', item.end)
    const segmentEnd = rawSegmentEnd < 0 ? raw.length : rawSegmentEnd
    const context = lower.slice(Math.max(segmentStart, item.index - 12), Math.min(segmentEnd, item.end + 48))
    if (context.includes('total')) payload.system_total_load_N = item.first
    if (context.includes('per') || context.includes('/pin')) {
      payload.contact_load_per_unit_N = item.first
      payload.contact_unit_type = context.match(/(?:per|\/)\s*([a-z][\w-]*)/)?.[1] || null
    }
  })
  if (payload.value_type === 'single' && payload.system_total_load_N == null) {
    payload.contact_load_per_unit_N = payload.contact_load_per_unit_N ?? payload.load_min_N ?? null
  }
  return payload
}

function loadConditionsForRecord(record: TribologyData | null | undefined): LoadConditions | null {
  if (!record) return null
  return normalizeLoadConditions((record as any).load_conditions ?? (record as any).loadConditions)
    || deriveLoadConditionsFromText(record.load)
}

function loadStructuredTags(record: TribologyData | null | undefined): StructuredTag[] {
  const load = loadConditionsForRecord(record)
  if (!load) return []
  const valueType = trim(load.value_type ?? load.valueType).toLowerCase()
  const isSimple = valueType === 'single'
    && load.system_total_load_N == null
    && load.systemTotalLoadN == null
    && !(trim(load.contact_unit_type ?? load.contactUnitType))
  if (isSimple) return []

  const tags: StructuredTag[] = []
  const system = load.system_total_load_N ?? load.systemTotalLoadN
  const contact = load.contact_load_per_unit_N ?? load.contactLoadPerUnitN
  const min = load.load_min_N ?? load.loadMinN
  const max = load.load_max_N ?? load.loadMaxN
  const systemTag = forceStructuredTag('系统载荷', system)
  const contactTag = forceStructuredTag('单点载荷', contact)
  if (systemTag) tags.push(systemTag)
  if (contactTag) tags.push(contactTag)
  const unit = trim(load.contact_unit_type ?? load.contactUnitType)
  if (unit) tags.push({ label: '作用对象', value: unit })
  if (system == null && contact == null && min != null && max != null) {
    const rangeTag = forceRangeStructuredTag(min === max ? '载荷' : '载荷范围', min, max)
    if (rangeTag) tags.push(rangeTag)
  }
  return tags
}

function normalizeSpeedConditions(value: unknown): SpeedConditions | null {
  if (!value) return null
  if (typeof value === 'string') {
    try {
      return normalizeSpeedConditions(JSON.parse(value))
    } catch {
      return null
    }
  }
  if (typeof value !== 'object') return null
  const raw = value as any
  const rate = raw.scan_rate_hz ?? raw.scanRateHz ?? null
  const length = raw.scan_length_um ?? raw.scanLengthUm ?? null
  const sliding = raw.sliding_velocity_um_s ?? raw.slidingVelocityUmS ?? null
  const parsed: SpeedConditions = {
    raw_text: raw.raw_text ?? raw.rawText ?? null,
    value_type: raw.value_type ?? raw.valueType ?? (sliding != null ? 'linear' : rate != null ? 'scan_rate' : 'unknown'),
    sliding_velocity_um_s: sliding,
    scan_rate_hz: rate,
    scan_length_um: length,
    unit_warning: Boolean(raw.unit_warning ?? raw.unitWarning ?? (rate != null && sliding == null)),
    calculation: raw.calculation ?? null,
    note: raw.note ?? null,
  }
  return parsed
}

function deriveSpeedConditionsFromText(text: unknown): SpeedConditions | null {
  const raw = trim(text)
  if (!raw) return null
  const normalized = raw.replace(/µ/g, 'μ')
  const rateMatch = normalized.match(/(?:scan\s*(?:rate|frequency)|frequency)?\D{0,20}(\d+(?:\.\d+)?)\s*hz\b/i)
  const velocityMatch = normalized.match(/(\d+(?:\.\d+)?)\s*(nm\/s|μm\/s|um\/s|mm\/s|m\/s|μm\s*s[-−]1|um\s*s[-−]1)/i)
  const lengthMatch = normalized.match(/(?:scan\s*(?:size|length)|track(?:\s*length)?)\D{0,30}(\d+(?:\.\d+)?)\s*(nm|μm|um|mm)/i)
    || normalized.match(/(\d+(?:\.\d+)?)\s*(nm|μm|um|mm)\s*[x×]\s*\d+(?:\.\d+)?/i)
  const rate = rateMatch ? Number(rateMatch[1]) : null
  const lengthRaw = lengthMatch ? Number(lengthMatch[1]) : null
  const lengthUnit = lengthMatch ? String(lengthMatch[2]).toLowerCase().replace('μ', 'u') : ''
  const scanLength = lengthRaw == null
    ? null
    : lengthUnit === 'nm'
      ? lengthRaw / 1000
      : lengthUnit === 'mm'
        ? lengthRaw * 1000
        : lengthRaw
  let sliding: number | null = null
  if (velocityMatch) {
    const velocity = Number(velocityMatch[1])
    const unit = String(velocityMatch[2]).toLowerCase().replace('μ', 'u').replace(/\s+/g, '')
    sliding = unit.startsWith('nm') ? velocity / 1000 : unit.startsWith('mm') ? velocity * 1000 : unit.startsWith('m/') ? velocity * 1000000 : velocity
  } else if (rate != null && scanLength != null) {
    sliding = Number((2 * scanLength * rate).toPrecision(12))
  }
  if (rate == null && scanLength == null && sliding == null) return null
  return {
    raw_text: raw,
    value_type: rate != null && scanLength != null && !velocityMatch ? 'derived' : sliding != null ? 'linear' : 'scan_rate',
    sliding_velocity_um_s: sliding,
    scan_rate_hz: rate,
    scan_length_um: scanLength,
    unit_warning: rate != null && sliding == null,
    calculation: rate != null && scanLength != null && !velocityMatch ? `v = 2 x ${scanLength} μm x ${rate} Hz` : null,
  }
}

function speedConditionsForRecord(record: TribologyData | null | undefined): SpeedConditions | null {
  if (!record) return null
  return normalizeSpeedConditions((record as any).speed_conditions ?? (record as any).speedConditions)
    || deriveSpeedConditionsFromText(`${record.speed || ''} ${record.evidence || ''}`)
}

function speedStructuredTags(record: TribologyData | null | undefined): { label: string, value: string }[] {
  const speed = speedConditionsForRecord(record)
  if (!speed) return []
  const sliding = speed.sliding_velocity_um_s ?? speed.slidingVelocityUmS
  const rate = speed.scan_rate_hz ?? speed.scanRateHz
  const length = speed.scan_length_um ?? speed.scanLengthUm
  const warning = Boolean(speed.unit_warning ?? speed.unitWarning)
  if (rate == null && length == null && !warning) return []

  const tags: { label: string, value: string }[] = []
  if (sliding != null) tags.push({ label: '滑移速度', value: `${sliding} μm/s` })
  if (rate != null) tags.push({ label: '扫描频率', value: `${rate} Hz` })
  if (length != null) tags.push({ label: '扫描长度', value: `${length} μm` })
  if (trim(speed.calculation)) tags.push({ label: '换算', value: trim(speed.calculation) })
  if (warning) tags.push({ label: '单位需换算', value: '需要扫描长度' })
  return tags
}

function normalizeTribologicalSystem(value: unknown): TribologicalSystem | null {
  if (!value) return null
  if (typeof value === 'string') {
    try {
      return normalizeTribologicalSystem(JSON.parse(value))
    } catch {
      return deriveTribologicalSystemFromText(value)
    }
  }
  if (typeof value !== 'object') return null
  const raw = value as any
  return {
    raw_text: raw.raw_text ?? raw.rawText ?? null,
    friction_regime: raw.friction_regime ?? raw.frictionRegime ?? null,
    contact_geometry: raw.contact_geometry ?? raw.contactGeometry ?? null,
    scale: raw.scale ?? null,
    note: raw.note ?? null,
  }
}

function deriveTribologicalSystemFromText(text: unknown): TribologicalSystem | null {
  const raw = trim(text)
  if (!raw) return null
  const lower = raw.toLowerCase()
  let frictionRegime = 'unstated'
  if (lower.includes('static')) frictionRegime = 'static'
  else if (/(kinetic|sliding|dynamic)/.test(lower)) frictionRegime = 'kinetic'
  if (lower.includes('boundary')) frictionRegime = 'boundary'
  else if (lower.includes('mixed')) frictionRegime = 'mixed'
  else if (lower.includes('elastohydrodynamic') || /\behd\b/.test(lower)) frictionRegime = 'elastohydrodynamic'
  else if (lower.includes('hydrodynamic')) frictionRegime = 'hydrodynamic'

  const geometry = [
    [/ball[-\s]*on[-\s]*(?:3|three)[-\s]*pins?/, 'ball_on_3_pins'],
    [/ball[-\s]*on[-\s]*disk/, 'ball_on_disk'],
    [/ball[-\s]*on[-\s]*plate/, 'ball_on_plate'],
    [/pin[-\s]*on[-\s]*disk/, 'pin_on_disk'],
    [/four[-\s]*ball/, 'four_ball'],
    [/afm|ffm|colloidal\s+probe|borosilicate\s+glass\s+bead/, 'afm_colloidal_probe'],
  ].find(([pattern]) => (pattern as RegExp).test(lower))?.[1] as string | undefined

  const scale = lower.includes('nano') || lower.includes('afm') || lower.includes('ffm')
    ? 'nano'
    : lower.includes('micro')
      ? 'micro'
      : lower.includes('macro')
        ? 'macro'
        : null
  return {
    raw_text: raw,
    friction_regime: frictionRegime,
    contact_geometry: geometry || null,
    scale,
  }
}

function tribologicalSystemForRecord(record: TribologyData | null | undefined): TribologicalSystem | null {
  if (!record) return null
  return normalizeTribologicalSystem((record as any).tribological_system ?? (record as any).tribologicalSystem)
    || deriveTribologicalSystemFromText(record.regime)
}

function regimeStructuredTags(record: TribologyData | null | undefined): { label: string, value: string }[] {
  const system = tribologicalSystemForRecord(record)
  if (!system) return []
  const tags: { label: string, value: string }[] = []
  const friction = trim(system.friction_regime ?? system.frictionRegime)
  const geometry = trim(system.contact_geometry ?? system.contactGeometry)
  const scale = trim(system.scale)
  if (friction && !isPlaceholderValue(friction)) tags.push({ label: '摩擦状态', value: friction })
  if (geometry && !isPlaceholderValue(geometry)) tags.push({ label: '接触几何', value: geometry })
  if (scale && !isPlaceholderValue(scale)) tags.push({ label: '尺度', value: experimentScaleLabel(scale) })
  return tags
}

function structuredTagsForField(field: ReviewField, record: TribologyData | null | undefined): StructuredTag[] {
  return structuredTagsForFieldId(field.id, record)
}

function structuredTagsForFieldId(fieldId: string, record: TribologyData | null | undefined): StructuredTag[] {
  if (fieldId === 'cof') return cofStructuredTags(record)
  if (fieldId === 'load') return loadStructuredTags(record)
  if (fieldId === 'speed') return speedStructuredTags(record)
  if (fieldId === 'regime') return regimeStructuredTags(record)
  return []
}

function structuredFieldLocation(field: ReviewField) {
  const source = field.groundingMode === 'inferred' || field.sourceType === 'inferred'
    ? '推断'
    : sourceTypeLabel(field.sourceType)
  const location = trim(field.location)
  const status = field.locationMode === 'precise'
    ? '已精确定位'
    : field.locationMode === 'source'
      ? '继承原文定位'
      : field.locationMode === 'record'
        ? '继承记录来源'
        : field.locationMode === 'inferred'
          ? '由结构化解析推断'
          : '未见原文定位'
  return location ? `${status} · ${source} · ${location}` : `${status} · ${source}`
}

function structuredFieldLocationClass(field: ReviewField) {
  if (field.locationMode === 'precise' || field.locationMode === 'source') return 'text-[#0f766e]'
  if (field.locationMode === 'record') return 'text-[#4f46e5]'
  if (field.locationMode === 'inferred') return 'text-[#6d28d9]'
  return 'text-[#cf334f]'
}

function shouldShowStructuredSubfieldLocation(field: ReviewField) {
  return field.locationMode === 'precise'
    || field.locationMode === 'inferred'
    || field.locationMode === 'missing'
}

function structuredSubfieldTitle(field: ReviewField) {
  if (field.locationMode === 'source' || field.locationMode === 'record') {
    return `来源：${sourceTypeLabel(field.sourceType)} · ${field.location}`
  }
  return structuredFieldLocation(field)
}

function reviewLubricantProxy(record: TribologyData | null | undefined) {
  const source = (record || {}) as any
  return {
    ...source,
    lubricant: source.lubricant || source.ionic_liquid,
    lubricantComponents: source.lubricantComponents || source.lubricant_components,
    lubricantAlias: source.lubricantAlias || source.lubricant_alias,
    ionicLiquidDisplay: source.ionicLiquidDisplay || source.ionic_liquid_display,
    lubricantTooltip: source.lubricantTooltip || source.lubricant_tooltip,
  }
}

type ReviewLubricantComponent = LubricantComponent & { compound: string }

function reviewLubricantComponents(record: TribologyData | null | undefined): ReviewLubricantComponent[] {
  const source = (record || {}) as any
  const raw = source.lubricantComponents || source.lubricant_components
  if (!Array.isArray(raw)) return []
  const components: ReviewLubricantComponent[] = []
  raw.forEach((component) => {
    if (typeof component === 'string') {
      const compound = trim(component)
      if (compound) components.push({ compound })
      return
    }
    if (!component || typeof component !== 'object') return
    const compound = trim(component.compound || component.component || component.name || component.ionic_liquid)
    if (!compound) return
    components.push({
      compound,
      fraction: component.fraction ?? null,
      unit: component.unit ?? null,
      role: component.role ?? null,
    })
  })
  return components
}

function componentFieldSlug(compound: string) {
  return trim(compound)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function componentFieldKey(component: ReviewLubricantComponent, index: number) {
  const slug = componentFieldSlug(component.compound)
  return slug ? `compound_${slug}` : `lubricant_component_${index}`
}

function reviewComponentForFieldKey(record: TribologyData | null | undefined, key: string) {
  const normalizedKey = normalizeFieldKey(key)
  return reviewLubricantComponents(record).find((component, index) => (
    componentFieldKey(component, index) === normalizedKey
    || `lubricant_component_${index}` === normalizedKey
  )) || null
}

function isIonicLiquidComponent(component: ReviewLubricantComponent) {
  const role = trim(component.role).toLowerCase()
  if (role.includes('ionic')) return true
  if (['base_oil', 'oil', 'solvent', 'compound'].includes(role)) return false
  return /\[[^\]]+\]\s*\[[^\]]+\]/.test(component.compound)
}

function isSeparateCompoundComponent(component: ReviewLubricantComponent) {
  const role = trim(component.role).toLowerCase()
  const compound = trim(component.compound).toLowerCase()
  if (['base_oil', 'oil', 'solvent', 'compound'].includes(role)) return true
  if (['hexadecane', 'degdbe', 'pao', 'peg'].includes(compound)) return true
  return !isIonicLiquidComponent(component)
}

function reviewIonicLiquidDisplay(record: TribologyData | null | undefined) {
  if (!record) return 'Not captured yet'
  const components = reviewLubricantComponents(record)
  const ionicComponents = components.filter(isIonicLiquidComponent)
  const hasSeparateCompound = components.some(isSeparateCompoundComponent)
  if (ionicComponents.length && hasSeparateCompound) {
    return ionicComponents.map((component) => component.compound).join(' / ')
  }
  if (ionicComponents.length === 1) return ionicComponents[0]?.compound || 'Not captured yet'
  const display = trim(lubricantDisplay(reviewLubricantProxy(record) as any))
  return display && display !== '--' ? display : present(record.ionic_liquid)
}

function reviewIonicLiquidTooltip(record: TribologyData | null | undefined) {
  if (!record) return ''
  return lubricantTooltip(reviewLubricantProxy(record) as any)
}

function reviewIonicLiquidAlias(record: TribologyData | null | undefined) {
  if (!record) return ''
  return lubricantAliasDisplay(reviewLubricantProxy(record) as any)
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

function normalizeStoredFieldEvidenceMap(
  fieldEvidence: TribologyData['field_evidence_json'] | Record<string, FieldEvidenceEntry> | string | undefined,
) {
  let source: Record<string, FieldEvidenceEntry> = {}

  if (typeof fieldEvidence === 'string') {
    try {
      const parsed = JSON.parse(fieldEvidence)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        source = parsed as Record<string, FieldEvidenceEntry>
      }
    } catch {
      source = {}
    }
  } else if (fieldEvidence && typeof fieldEvidence === 'object') {
    source = fieldEvidence as Record<string, FieldEvidenceEntry>
  }

  return Object.entries(source).reduce<Record<string, FieldEvidenceEntry>>((acc, [key, value]) => {
    const entry = { ...(value || {}) } as FieldEvidenceEntry
    const evidence = entry.evidence && typeof entry.evidence === 'object'
      ? { ...(entry.evidence as Record<string, unknown>) }
      : null
    if (evidence && !evidence.matched_text && evidence.matchedText) {
      evidence.matched_text = evidence.matchedText
    }
    if (evidence) {
      entry.evidence = evidence as FieldEvidenceEntry['evidence']
    }
    acc[normalizeFieldKey(key)] = entry
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
      : (merged.load || merged.speed || merged.temperature || merged.potential || null)
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
  const sourceType = trim(evidence?.source_type).toLowerCase()
  const groundingMode = trim(entry?.grounding_mode).toLowerCase()
  const matchedText = trim(evidence?.matched_text ?? (evidence as Record<string, unknown> | undefined)?.matchedText)
  const bbox = normalizeResolvedBBox(evidence?.bbox)
  if (sourceType === 'table' && !matchedText && groundingMode !== 'explicit') return false
  return Boolean(evidence?.page && bbox)
}

function fieldEntryHasSourceAnchor(entry: FieldEvidenceEntry | null | undefined) {
  const evidence = entry?.evidence
  const matchedText = trim(evidence?.matched_text ?? (evidence as Record<string, unknown> | undefined)?.matchedText)
  return Boolean(
    evidence?.page
    || trim(evidence?.source_label)
    || trim(evidence?.quote)
    || matchedText,
  )
}

function recordHasSourceAnchor(record: TribologyData | null | undefined) {
  if (!record) return false
  return Boolean(record.source_page || trim(record.source_figure) || trim(record.source) || trim(record.evidence))
}

function resolveFieldEvidenceStatus(
  entry: FieldEvidenceEntry | null | undefined,
  value: string,
  hasStructuredValue = false,
): ReviewField['evidenceStatus'] {
  if ((!trim(value) || value === 'Not captured yet') && !hasStructuredValue) return 'Missing'
  if (!entry) return 'Missing'
  if (trim(entry.grounding_mode).toLowerCase() === 'inferred') return 'Grounded'
  if (fieldEntryHasEvidence(entry)) {
    return 'Grounded'
  }
  if (entry.status === 'grounded' || entry.status === 'partial') return 'Partial'
  if (entry.evidence && (entry.evidence.page || trim(entry.evidence.source_label) || trim(entry.evidence.quote))) return 'Partial'
  return 'Missing'
}

function resolveFieldGroundingMode(entry: FieldEvidenceEntry | null | undefined, value: string): ReviewField['groundingMode'] {
  if (!trim(value) || value === 'Not captured yet') return null
  const mode = trim(entry?.grounding_mode).toLowerCase()
  if (mode === 'inferred') return 'inferred'
  if (mode === 'derived') return 'derived'
  if (mode === 'explicit') return 'explicit'
  if (mode === 'source_anchor') return 'explicit'
  return null
}

function resolveFieldGroundingNote(entry: FieldEvidenceEntry | null | undefined) {
  return trim(entry?.grounding_note) || undefined
}

function resolveFieldLocationMode(
  entry: FieldEvidenceEntry | null | undefined,
  record: TribologyData | null | undefined,
  groundingMode: ReviewField['groundingMode'],
): ReviewField['locationMode'] {
  if (fieldEntryHasEvidence(entry)) return 'precise'
  if (fieldEntryHasSourceAnchor(entry)) return 'source'
  if (groundingMode === 'derived' || groundingMode === 'inferred') return 'inferred'
  if (recordHasSourceAnchor(record)) return 'record'
  return 'missing'
}

function syncRecordReviewState(recordId: string, payload: RecordFieldEvidenceResponse) {
  for (const file of props.files) {
    const record = file.records.find((item) => String(item.id || '') === recordId)
    if (!record) continue
    if (payload.extractor_type === 'diffusion') {
      record.extractor_type = 'diffusion'
      file.extractor_type = 'diffusion'
      const entityType = payload.review_entity_type || payload.reviewEntityType || record.review_entity_type || record.reviewEntityType
      if (entityType) {
        record.review_entity_type = entityType
        record.reviewEntityType = entityType
      }
      const promotedRecordId = Number(payload.promoted_record_id ?? payload.promotedRecordId ?? '')
      if (Number.isFinite(promotedRecordId) && promotedRecordId > 0) {
        record.promoted_record_id = promotedRecordId
        record.promotedRecordId = promotedRecordId
        record.record_origin = payload.record_origin || record.record_origin || 'review_promoted_candidate'
      }
      const promotedAt = payload.promoted_at || payload.promotedAt || null
      if (promotedAt) {
        record.promoted_at = promotedAt
        record.promotedAt = promotedAt
      }
    }
    record.field_evidence_json = payload.fields
    if (payload.diffusion_standard_fields || payload.diffusionStandardFields) {
      record.diffusion_standard_fields = payload.diffusion_standard_fields || payload.diffusionStandardFields
      record.diffusionStandardFields = payload.diffusionStandardFields || payload.diffusion_standard_fields
    }
    record.review_status = payload.review_status || undefined
    record.record_origin = payload.record_origin || record.record_origin
    record.assembly_notes = payload.assembly_notes || undefined
    record.sample_id = payload.sample_id || record.sample_id
    record.series_id = payload.series_id || record.series_id
    if (payload.confidence != null) {
      record.confidence = payload.confidence
    }
    if (payload.confidence_details || payload.confidenceDetails) {
      record.confidence_details = payload.confidence_details || payload.confidenceDetails || null
      record.confidenceDetails = payload.confidenceDetails || payload.confidence_details || null
    }
    record.validationStatus = deriveValidationStatusFromReviewStatus(payload.review_status)
    record.validationMessage = payload.assembly_notes || undefined
  }
}

function applyReviewResponse(payload: RecordFieldEvidenceResponse) {
  const recordId = String(payload.record_id)
  const literatureId = Number(payload.literature_id || activeLiteratureId.value || 0)
  if (literatureId && Number.isFinite(payload.record_id)) {
    const extractorType = payload.extractor_type === 'diffusion' ? 'diffusion' : 'tribology'
    const entityType = activeRecord.value && String(activeRecord.value.id || '') === recordId
      ? reviewEntityType(activeRecord.value)
      : 'candidate'
    fieldEvidenceCache.value[reviewCacheKey(literatureId, payload.record_id, extractorType, entityType)] = payload
  }
  if (activeRecord.value && String(activeRecord.value.id || '') === recordId) {
    activeRecordFieldEvidence.value = payload
  }
  syncRecordReviewState(recordId, payload)
}

function resolveFieldSourceType(entry: FieldEvidenceEntry | null | undefined, record: TribologyData | null | undefined): ReviewField['sourceType'] {
  const sourceType = trim(entry?.evidence?.source_type).toLowerCase()
  if (sourceType.includes('inferred')) return 'inferred'
  if (sourceType.includes('calculation') || sourceType.includes('computed') || sourceType.includes('derived')) return 'calculation'
  if (sourceType.includes('table')) return 'table'
  if (sourceType.includes('figure') || sourceType.includes('caption') || trim(entry?.evidence?.source_label).toLowerCase().startsWith('fig')) return 'figure'
  if (sourceType) return 'text'
  return inferSourceType(record)
}

function resolveFieldLocation(entry: FieldEvidenceEntry | null | undefined, record: TribologyData | null | undefined) {
  const page = entry?.evidence?.page
  const label = formatReviewSourceLabel(entry?.evidence?.source_label)
  if (page && label) return `Page ${page} | ${label}`
  if (page) return `Page ${page}`
  if (label) return label
  return evidenceLocation(record)
}

function hasTextEvidence(record: TribologyData | null | undefined) {
  if (!record) return false
  return Boolean(trim(record.evidence) || trim(record.notes) || trim(record.source))
}

function getTribologyPrimaryMetricKeys() {
  return [
    'cof',
    'friction_force',
    'wear_rate',
    'film_thickness',
    'residual_film_thickness_d',
    'layer_spacing_delta',
    'surface_roughness',
  ] as const
}

function resolvePrimaryTribologyMetricKey(record: TribologyData | null | undefined) {
  if (!record) return null
  for (const key of getTribologyPrimaryMetricKeys()) {
    if (trim(String(record[key] ?? ''))) return key
  }
  return null
}

function requiredTribologyFieldKeys(record: TribologyData | null | undefined) {
  const keys = ['material', 'ionic_liquid']
  const metricKey = resolvePrimaryTribologyMetricKey(record)
  if (metricKey) keys.push(metricKey)
  return keys
}

function hasRecordValue(record: TribologyData | null | undefined, key: string, extractorType: ExtractorType = recordExtractorType(record)) {
  const value = record ? fieldValueForKey(record, key, extractorType) : 'Not captured yet'
  return trim(value) !== '' && value !== 'Not captured yet'
}

function hasFieldEntry(fieldMap: Record<string, FieldEvidenceEntry>, key: string) {
  const entry = fieldMap[key]
  if (!entry) return false
  return Boolean(trim(entry.value)) && !isPlaceholderValue(entry.value)
}

function shouldShowOptionalField(
  record: TribologyData | null | undefined,
  fieldMap: Record<string, FieldEvidenceEntry>,
  key: string,
  extractorType: ExtractorType = 'tribology',
) {
  return hasRecordValue(record, key, extractorType)
    || hasFieldEntry(fieldMap, key)
    || structuredTagsForFieldId(key, record).length > 0
}

function tribologyFieldLabel(key: string) {
  if (key === 'cof') return 'COF'
  if (key === 'friction_force') return 'Friction Force'
  if (key === 'wear_rate') return 'Wear Rate'
  if (key === 'film_thickness') return 'Film Thickness'
  if (key === 'residual_film_thickness_d') return 'Residual Film Thickness'
  if (key === 'layer_spacing_delta') return 'Layer Spacing'
  if (key === 'regime') return 'Regime'
  if (key === 'surface_roughness') return 'Surface Roughness'
  if (key === 'probe_roughness') return 'Probe Roughness'
  if (key === 'substrate_roughness') return 'Substrate Roughness'
  if (key === 'load') return 'Load'
  if (key === 'speed') return 'Speed'
  if (key === 'shear_rate') return 'Shear Rate'
  if (key === 'temperature') return 'Temperature'
  if (key === 'water_content') return 'Water Content'
  if (key === 'potential') return 'Potential'
  return key
}

function tribologyFieldIssue(key: string) {
  if (key === 'cof') return 'COF still needs grounding confirmation.'
  if (key === 'friction_force') return 'Friction force still needs grounding confirmation.'
  if (key === 'wear_rate') return 'Wear rate still needs grounding confirmation.'
  if (key === 'film_thickness') return 'Film thickness still needs grounding confirmation.'
  if (key === 'residual_film_thickness_d') return 'Residual film thickness still needs grounding confirmation.'
  if (key === 'layer_spacing_delta') return 'Layer spacing still needs grounding confirmation.'
  if (key === 'regime') return 'Regime still needs grounding confirmation.'
  if (key === 'surface_roughness') return 'Surface roughness still needs grounding confirmation.'
  if (key === 'probe_roughness') return 'Probe roughness still needs grounding confirmation.'
  if (key === 'substrate_roughness') return 'Substrate roughness still needs grounding confirmation.'
  if (key === 'load') return 'Load still needs grounding confirmation.'
  if (key === 'speed') return 'Speed still needs grounding confirmation.'
  if (key === 'shear_rate') return 'Shear rate still needs grounding confirmation.'
  return 'Field still needs grounding confirmation.'
}

function recordNeedsEvidence(record: TribologyData) {
  const extractorType = recordExtractorType(record)
  const fieldMap = resolveRecordFieldEvidenceMap(record)
  if (extractorType === 'diffusion') {
    const missingBase = ['system_name', 'ionic_liquid']
      .some((key) => resolveFieldEvidenceStatus(fieldMap[key], fieldValueForKey(record, key, extractorType)) !== 'Grounded')
    const coefficientMissing = ['d_total', 'd_cation', 'd_anion']
      .every((key) => resolveFieldEvidenceStatus(fieldMap[key], fieldValueForKey(record, key, extractorType)) !== 'Grounded')
    return missingBase || coefficientMissing
  }
  return requiredTribologyFieldKeys(record)
    .some((key) => resolveFieldEvidenceStatus(fieldMap[key], fieldValueForKey(record, key, extractorType)) !== 'Grounded')
}

function recordNeedsReview(record: TribologyData) {
  return String(record.review_status || '').trim().toLowerCase() !== 'approved' && record.validationStatus !== 'verified'
}

function recordLowConfidence(record: TribologyData) {
  if (recordConfidenceScore(record) < 0.8) return true
  const extractorType = recordExtractorType(record)
  const missingCore = extractorType === 'diffusion'
    ? (!trim(record.system_name) || !trim(record.ionic_liquid) || !hasAnyDiffusionCoefficient(record))
    : requiredTribologyFieldKeys(record)
      .some((key) => !trim(fieldValueForKey(record, key, extractorType)))
  const reviewStatus = String(record.review_status || '').trim().toLowerCase()
  return record.validationStatus === 'warning' || reviewStatus === 'flagged' || reviewStatus === 'needs_evidence' || missingCore
}

function recordIsTrainingBlocker(record: TribologyData) {
  if (recordExtractorType(record) !== 'tribology') return false

  const reviewStatus = String(record.review_status || '').trim().toLowerCase()
  if (reviewStatus === 'flagged' || reviewStatus === 'needs_evidence') return true

  const recordMap = record as unknown as Record<string, unknown>
  const cofRaw = recordMap.cof
  const cofValueRaw = recordMap.cof_value
  const cofExtracted = recordMap.cof_extracted
  const cofText = trim(cofRaw as string)
    || trim(cofValueRaw as string)
    || (Array.isArray(cofExtracted) && cofExtracted.length > 0
      ? trim(((cofExtracted as Array<Record<string, unknown>>)[0]?.value) as string)
      : '')
  if (!cofText) return true

  if (!trim(record.cation_smiles) || !trim(record.anion_smiles)) return true

  if (record.confidence != null && Number(record.confidence) < 0.8) return true

  return recordNeedsEvidence(record)
}

function flaggedRequiredFieldKeys(
  record: TribologyData | null | undefined,
  remoteFields?: Record<string, FieldEvidenceEntry> | null,
) {
  if (!record) return []
  const extractorType = recordExtractorType(record)
  const fieldMap = resolveRecordFieldEvidenceMap(record, remoteFields)
  if (extractorType === 'diffusion') {
    const flagged: string[] = ['system_name', 'ionic_liquid']
      .filter((key) => String(fieldMap[key]?.review_state || '').trim().toLowerCase() === 'flagged')
    const coefficientKeys = ['d_total', 'd_cation', 'd_anion']
    const groundedCoefficients = coefficientKeys.filter((key) => resolveFieldEvidenceStatus(fieldMap[key], fieldValueForKey(record, key, extractorType)) === 'Grounded')
    if (groundedCoefficients.length && groundedCoefficients.every((key) => String(fieldMap[key]?.review_state || '').trim().toLowerCase() === 'flagged')) {
      flagged.push('diffusion_coefficient')
    }
    return flagged
  }
  return requiredTribologyFieldKeys(record)
    .filter((key) => String(fieldMap[key]?.review_state || '').trim().toLowerCase() === 'flagged')
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
  const parts = [record.regime, record.load, record.speed, record.shear_rate, record.temperature, normalizePotentialDisplayText(record.potential)].map((item) => trim(item)).filter(Boolean)
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
  if (record.source_page && trim(record.source_figure)) return `Page ${record.source_page} | ${formatReviewSourceLabel(record.source_figure)}`
  if (record.source_page) return `Page ${record.source_page}`
  if (trim(record.source_figure)) return `Figure ${formatReviewSourceLabel(record.source_figure)}`
  return `Scope ${props.activeScopeLabel}`
}

function fieldValueForKey(record: TribologyData, key: string, extractorType: ExtractorType = recordExtractorType(record)) {
  if (key.startsWith('compound_') || key.startsWith('lubricant_component_')) {
    return present(reviewComponentForFieldKey(record, key)?.compound)
  }
  if (extractorType === 'diffusion') {
    if (key === 'system_name') return present(record.system_name)
    if (key === 'confinement_material_class') return present(record.confinement_material_class)
    if (key === 'confinement_geometry_class') return present(record.confinement_geometry_class)
    if (key === 'surface_functional_groups') return present(record.surface_functional_groups)
    if (key === 'confinement_dimensionality') return present(record.confinement_dimensionality)
    if (key === 'ionic_liquid') return reviewIonicLiquidDisplay(record)
    if (key === 'cation') return present(diffusionStandardText(record, 'cation'))
    if (key === 'anion') return present(diffusionStandardText(record, 'anion'))
    if (key === 'diffusing_ion') return present(diffusionStandardText(record, 'diffusing_ion', 'diffusingIon'))
    if (key === 'side_chain') return present(diffusionStandardText(record, 'side_chain_label', 'sideChainLabel'))
    if (key === 'water_uptake') return present(diffusionStandardText(record, 'water_uptake_label', 'waterUptakeLabel'))
    if (key === 'd_total') return formatDiffusionNumber(record.D_total)
    if (key === 'd_cation') return formatDiffusionNumber(record.D_cation)
    if (key === 'd_anion') return formatDiffusionNumber(record.D_anion)
    if (key === 'd_unit') return formatScientificUnit(record.D_unit)
    if (key === 'temperature_value') return formatDiffusionNumber(record.temperature_value)
    if (key === 'confinement_scale_value') return formatDiffusionNumber(record.confinement_scale_value)
    if (key === 'confinement_scale_unit') return formatScientificUnit(record.confinement_scale_unit)
    if (key === 'source_page') return record.source_page ? `Page ${record.source_page}` : 'Not captured yet'
    return 'Not captured yet'
  }
  if (key === 'material') return present(record.material_name)
  if (key === 'ionic_liquid') return reviewIonicLiquidDisplay(record)
  if (key === 'cof') return cofMetricValue(record)
  if (key === 'friction_force') return present(record.friction_force)
  if (key === 'wear_rate') return present(record.wear_rate)
  if (key === 'film_thickness') return present(record.film_thickness)
  if (key === 'residual_film_thickness_d') return present(record.residual_film_thickness_d)
  if (key === 'layer_spacing_delta') return present(record.layer_spacing_delta)
  if (key === 'regime') return present(record.regime)
  if (key === 'surface_roughness') return present(record.surface_roughness)
  if (key === 'probe_roughness') return present(record.probe_roughness)
  if (key === 'substrate_roughness') return present(record.substrate_roughness)
  if (key === 'load') return present(record.load)
  if (key === 'speed') return present(record.speed)
  if (key === 'shear_rate') return present(record.shear_rate)
  if (key === 'temperature') return present(record.temperature)
  if (key === 'water_content') return present(record.water_content)
  if (key === 'potential') return normalizePotentialDisplayText(record.potential) || present(record.potential)
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
    addEvidenceSpec(
      specs,
      cleanValue,
      ['cof', 'friction_force', 'wear_rate', 'film_thickness', 'residual_film_thickness_d', 'layer_spacing_delta', 'surface_roughness', 'probe_roughness', 'substrate_roughness', 'd_total', 'd_cation', 'd_anion', 'water_uptake'].includes(field.id)
        ? 'numeric'
        : 'loose',
    )
  }

  if (field.id === 'material') {
    const material = trim(record.material_name)
    if (material) addEvidenceSpec(specs, material, 'loose')
  }

  if (field.id.startsWith('compound_') || field.id.startsWith('lubricant_component_')) {
    const component = reviewComponentForFieldKey(record, field.id)
    const compound = trim(component?.compound || cleanValue)
    if (compound) addEvidenceSpec(specs, compound, 'loose')
  }

  if (field.id === 'system_name') {
    const systemName = trim(record.system_name)
    if (systemName) addEvidenceSpec(specs, systemName, 'loose')
  }

  if (['confinement_material_class', 'confinement_geometry_class', 'surface_functional_groups', 'confinement_dimensionality'].includes(field.id)) {
    const raw = fieldValueForKey(record, field.id, extractorType)
    if (trim(raw)) addEvidenceSpec(specs, raw, 'loose')
  }

  if (field.id === 'load') {
    const load = trim(record.load || cleanValue)
    if (load) {
      addEvidenceSpec(specs, load, 'loose')
      addEvidenceSpec(specs, `load ${load}`, 'loose')
      addEvidenceSpec(specs, `normal load ${load}`, 'loose')
    }
  }

  if (field.id === 'speed') {
    const speed = trim(record.speed || cleanValue)
    if (speed) {
      addEvidenceSpec(specs, speed, 'loose')
      addEvidenceSpec(specs, `speed ${speed}`, 'loose')
      addEvidenceSpec(specs, `sliding speed ${speed}`, 'loose')
    }
    const speedConditions = speedConditionsForRecord(record)
    const rate = speedConditions?.scan_rate_hz ?? speedConditions?.scanRateHz
    const length = speedConditions?.scan_length_um ?? speedConditions?.scanLengthUm
    if (rate != null) {
      addEvidenceSpec(specs, `${rate} Hz`, 'loose')
      addEvidenceSpec(specs, `scan rate ${rate} Hz`, 'loose')
    }
    if (length != null) {
      addEvidenceSpec(specs, `${length} μm`, 'loose')
      addEvidenceSpec(specs, `scan size ${length}`, 'loose')
    }
  }

  if (field.id === 'shear_rate') {
    const shearRate = trim(record.shear_rate || cleanValue)
    if (shearRate) {
      addEvidenceSpec(specs, shearRate, 'loose')
      addEvidenceSpec(specs, `shear rate ${shearRate}`, 'loose')
      addEvidenceSpec(specs, `shear rates ${shearRate}`, 'loose')
    }
  }

  if (field.id === 'temperature') {
    const temperature = trim(record.temperature || cleanValue)
    if (temperature) {
      addEvidenceSpec(specs, temperature, 'loose')
      addEvidenceSpec(specs, `temperature ${temperature}`, 'loose')
    }
  }

  if (field.id === 'water_content') {
    const waterContent = trim(record.water_content || cleanValue)
    if (waterContent) {
      addEvidenceSpec(specs, waterContent, 'loose')
      addEvidenceSpec(specs, `water content ${waterContent}`, 'loose')
      addEvidenceSpec(specs, `humidity ${waterContent}`, 'loose')
    }
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

  if (['friction_force', 'wear_rate', 'film_thickness', 'residual_film_thickness_d', 'layer_spacing_delta', 'surface_roughness', 'probe_roughness', 'substrate_roughness'].includes(field.id)) {
    const numeric = cleanValue.match(/[0-9]+(?:\.[0-9]+)?(?:e[-+]?\d+)?/i)?.[0]
    if (numeric) {
      addEvidenceSpec(specs, numeric, 'numeric')
      addEvidenceSpec(specs, `${tribologyFieldLabel(field.id)} ${numeric}`, 'loose')
    }
  }

  if (field.id === 'regime') {
    const regime = trim(record.regime || cleanValue)
    if (regime) {
      addEvidenceSpec(specs, regime, 'loose')
      addEvidenceSpec(specs, regime.replace(/\blayers?\b/i, '').trim(), 'loose')
    }
  }

  if (field.id === 'potential') {
    const potential = trim(record.potential || cleanValue)
    if (potential) {
      addEvidenceSpec(specs, potential, 'loose')
      const normalizedPotential = normalizePotentialDisplayText(potential)
      if (normalizedPotential && normalizedPotential !== potential) {
        addEvidenceSpec(specs, normalizedPotential, 'loose')
      }
      addEvidenceSpec(specs, `potential ${potential}`, 'loose')
      addEvidenceSpec(specs, `voltage ${potential}`, 'loose')
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

  if (field.id === 'temperature_value') {
    const numeric = cleanValue.match(/[0-9]+(?:\.[0-9]+)?(?:e[-+]?\d+)?/i)?.[0]
    if (numeric) {
      addEvidenceSpec(specs, numeric, 'numeric')
      addEvidenceSpec(specs, `temperature ${numeric}`, 'loose')
    }
  }

  if (field.id === 'confinement_scale_value') {
    const numeric = cleanValue.match(/[0-9]+(?:\.[0-9]+)?(?:e[-+]?\d+)?/i)?.[0]
    if (numeric) {
      addEvidenceSpec(specs, numeric, 'numeric')
      addEvidenceSpec(specs, `scale ${numeric}`, 'loose')
      addEvidenceSpec(specs, `confinement ${numeric}`, 'loose')
    }
  }

  if (field.id === 'confinement_scale_unit') {
    const unit = trim(record.confinement_scale_unit || cleanValue)
    if (unit) {
      addEvidenceSpec(specs, unit, 'loose')
      addEvidenceSpec(specs, `scale ${unit}`, 'loose')
      addEvidenceSpec(specs, `confinement ${unit}`, 'loose')
    }
  }

  if (field.id === 'source_page') {
    if (record.source_page) addEvidenceSpec(specs, `Page ${record.source_page}`, 'loose')
    if (trim(record.source_figure)) addEvidenceSpec(specs, trim(record.source_figure), 'loose')
    if (trim(record.source)) addEvidenceSpec(specs, trim(record.source), 'loose')
  }

  return [...specs.values()]
}

function extractEvidenceExcerpt(
  text: string,
  specs: EvidenceSearchSpec[],
  options?: {
    contextBefore?: number
    contextAfter?: number
  },
) {
  if (!text) return ''
  const contextBefore = options?.contextBefore ?? 110
  const contextAfter = options?.contextAfter ?? 170

  const matchResult = findEvidenceMatch(text, specs)

  if (!matchResult) {
    return text.slice(0, Math.max(180, contextBefore + contextAfter))
  }

  const { match } = matchResult

  const startBoundary = Math.max(
    text.lastIndexOf('. ', match.index),
    text.lastIndexOf('; ', match.index),
    text.lastIndexOf(', ', match.index),
    text.lastIndexOf('\n', match.index),
  )
  const excerptStart = Math.max(0, startBoundary >= 0 ? startBoundary + 1 : match.index - contextBefore)

  const afterIndex = match.index + match[0].length
  const sentenceEndCandidates = [
    text.indexOf('. ', afterIndex),
    text.indexOf('; ', afterIndex),
    text.indexOf(', ', afterIndex),
    text.indexOf('\n', afterIndex),
  ].filter((index) => index >= 0)

  const nextBoundary = sentenceEndCandidates.length ? Math.min(...sentenceEndCandidates) : -1
  const excerptEnd = nextBoundary >= 0 ? nextBoundary + 1 : Math.min(text.length, afterIndex + contextAfter)

  return text.slice(excerptStart, excerptEnd).trim()
}

function matchesEvidenceSpecText(text: string, spec: EvidenceSearchSpec) {
  if (!text) return false
  if (spec.mode === 'numeric') return numericTokensConsistent(spec.text, text)
  const normalizedText = normalizePdfEvidenceText(text)
  const matcher = buildEvidenceMatcher(spec)
  if (matcher.test(normalizedText)) return true
  if (spec.mode === 'loose') return normalizeLooseText(normalizedText).includes(normalizeLooseText(spec.text))
  return false
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
  const directMatchedText = trim(fieldEntry?.evidence?.matched_text)
  const isDerivedField = trim(fieldEntry?.grounding_mode).toLowerCase() === 'derived'
  const isInferredField = trim(fieldEntry?.grounding_mode).toLowerCase() === 'inferred'
  if (directQuote && (fieldEvidenceTextMatchesSpecs(directMatchedText, directQuote, specs) || isDerivedField || isInferredField)) {
    const excerptSpecs = directMatchedText ? [{ text: directMatchedText, mode: 'exact-token' as const }] : specs
    return {
      excerpt: extractEvidenceExcerpt(directQuote, excerptSpecs, { contextBefore: 72, contextAfter: 96 }),
      specs: excerptSpecs,
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

function normalizePdfEvidenceText(value: string) {
  return String(value || '')
    .replace(/[\u0000-\u0002\u0005-\u001f]/g, ' ')
    .replace(/\u0003/g, '-')
    .replace(/\u0004/g, '+')
    .replace(/\u00b5/g, 'μ')
    .replace(/[−–—]/g, '-')
    .replace(/[＋þ]/g, '+')
}

function normalizeLooseText(value: string) {
  return normalizePdfEvidenceText(value)
    .toLowerCase()
    .replace(/[\[\](){}]/g, '')
    .replace(/[^a-z0-9+-]+/g, '')
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function buildLooseMatcher(term: string) {
  const normalizedTerm = normalizePdfEvidenceText(term)
  const parts = normalizedTerm
    .replace(/[\[\](){}]/g, ' ')
    .split(/[^A-Za-z0-9+-]+/)
    .map((item) => item.trim())
    .filter(Boolean)

  if (!parts.length) {
    const escaped = normalizedTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return new RegExp(escaped, 'gi')
  }

  const pattern = parts
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('[\\]\\[\\s\\x00-\\x1F\\u00bd\\-_/,:;(){}]*')

  return new RegExp(pattern, 'gi')
}

function buildExactTokenMatcher(term: string) {
  return new RegExp(`(?<![A-Za-z0-9])${escapeRegex(normalizePdfEvidenceText(term))}(?![A-Za-z0-9])`, 'gi')
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
    if (spec.mode === 'numeric' && numericTokensConsistent(spec.text, text)) {
      const termNum = extractNumberTokens(spec.text)[0]
      const matchedNum = extractNumberTokens(text).find((value) => numericTokensConsistent(spec.text, value)) || termNum || spec.text
      return {
        spec,
        match: {
          index: Math.max(0, matchedNum ? text.indexOf(matchedNum) : 0),
          0: matchedNum,
          length: matchedNum.length,
        } as RegExpExecArray,
      }
    }
    const matcher = buildEvidenceMatcher(spec)
    const match = matcher.exec(normalizePdfEvidenceText(text))
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
  return (String(input || '').match(/\d+(?:[\.:]\d+)?/g) || []).map((value) => String(value))
}

function numericTokensConsistent(term: string, matched: string): boolean {
  const termNums = extractNumberTokens(term).map((value) => Number(value.replace(':', '.'))).filter((value) => Number.isFinite(value))
  if (!termNums.length) return true
  const matchedNums = extractNumberTokens(matched).map((value) => Number(value.replace(':', '.'))).filter((value) => Number.isFinite(value))
  if (!matchedNums.length) return false
  return termNums.every((termValue) => {
    const tolerance = Math.max(1e-6, Math.abs(termValue) * 0.01)
    return matchedNums.some((matchedValue) => Math.abs(matchedValue - termValue) <= tolerance)
  })
}

function confidenceLabel(status: ValidationStatus | undefined, value: string, hasStructuredValue = false): ReviewField['confidence'] {
  if ((!trim(value) && !hasStructuredValue) || status === 'warning') return 'Low'
  if (status === 'verified') return 'High'
  return 'Medium'
}

function fieldStatusFromEntry(
  record: TribologyData,
  value: string,
  evidence: ReviewField['evidenceStatus'],
  entry: FieldEvidenceEntry | null | undefined,
  hasStructuredValue = false,
): ReviewField['status'] {
  const reviewState = String(entry?.review_state || '').trim().toLowerCase()
  const groundingMode = trim(entry?.grounding_mode).toLowerCase()
  if (!trim(value) && !hasStructuredValue) return 'low_conf'
  if (reviewState === 'flagged') return 'low_conf'
  if (groundingMode === 'inferred') return 'confirmed'
  if (reviewState === 'confirmed' && evidence === 'Grounded') return 'confirmed'
  if (record.validationStatus === 'verified' && evidence === 'Grounded') return 'confirmed'
  if (record.validationStatus === 'warning' || evidence !== 'Grounded') return 'low_conf'
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
  const hasStructuredValue = structuredTagsForFieldId(id, record).length > 0
  const evidence = resolveFieldEvidenceStatus(entry, value, hasStructuredValue)
  const groundingMode = resolveFieldGroundingMode(entry, value)
  const locationMode = resolveFieldLocationMode(entry, record, groundingMode)
  const reviewExempt = groundingMode === 'inferred'
  const reviewState = String(entry?.review_state || '').trim().toLowerCase()
  const reviewNote = trim(entry?.review_note)
  const status = reviewExempt ? 'confirmed' : fieldStatusFromEntry(record, value, evidence, entry, hasStructuredValue)
  const hasCapturedValue = (trim(value) !== '' && value !== 'Not captured yet') || hasStructuredValue
  const canConfirm = !reviewExempt && hasCapturedValue && evidence === 'Grounded'

  return {
    id,
    label,
    value,
    status,
    confidence: reviewExempt ? 'High' : confidenceLabel(record.validationStatus, value, hasStructuredValue),
    evidenceStatus: evidence,
    groundingMode,
    groundingNote: resolveFieldGroundingNote(entry),
    sourceType: resolveFieldSourceType(entry, record),
    location: resolveFieldLocation(entry, record),
    locationMode,
    reviewState: reviewState || null,
    reviewNote,
    canConfirm,
    tooltip: id === 'ionic_liquid'
      ? reviewIonicLiquidTooltip(record)
      : id === 'cof'
        ? trim(cofExtractedForRecord(record)?.raw_text || cofExtractedForRecord(record)?.rawText || record.cof)
        : undefined,
    issue: reviewExempt
      ? undefined
      : reviewState === 'flagged'
      ? (reviewNote || issueMessage || '该字段已标记为存疑，请编辑处理或解除存疑。')
      : (!canConfirm ? issueMessage : undefined),
  }
}

function componentFieldEntry(
  fieldMap: Record<string, FieldEvidenceEntry>,
  component: ReviewLubricantComponent,
  index: number,
) {
  const key = componentFieldKey(component, index)
  return fieldMap[key] || fieldMap[`lubricant_component_${index}`]
}

function buildLubricantComponentReviewFields(
  record: TribologyData,
  fieldMap: Record<string, FieldEvidenceEntry>,
) {
  const components = reviewLubricantComponents(record)
  if (components.length < 2) return []
  return components
    .map((component, index) => ({ component, index }))
    .filter(({ component }) => isSeparateCompoundComponent(component))
    .map(({ component, index }) => buildField(
      'Compound',
      componentFieldKey(component, index),
      component.compound,
      record,
      componentFieldEntry(fieldMap, component, index),
      `${component.compound} still needs grounding confirmation.`,
    ))
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
        groundingMode: null,
        sourceType: 'inferred',
        location: `Scope ${props.activeScopeLabel}`,
        locationMode: 'missing',
        canConfirm: false,
        issue: 'No extracted record is attached to this literature file yet.',
      },
    ]
  }

  const extractorType = recordExtractorType(record)
  const fieldMap = resolveRecordFieldEvidenceMap(record, remoteFields)
  if (extractorType === 'diffusion') {
    const diffusionValue = (key: string) => {
      const value = fieldValueForKey(record, key, extractorType)
      return value !== 'Not captured yet' ? value : present(fieldMap[key]?.value)
    }
    return [
      buildField('System', 'system_name', diffusionValue('system_name'), record, fieldMap.system_name, 'System name still needs grounding confirmation.'),
      buildField('Ionic Liquid', 'ionic_liquid', diffusionValue('ionic_liquid'), record, fieldMap.ionic_liquid, 'Ionic liquid still needs grounding confirmation.'),
      buildField('Cation', 'cation', diffusionValue('cation'), record, fieldMap.cation, 'Cation still needs grounding confirmation.'),
      buildField('Anion', 'anion', diffusionValue('anion'), record, fieldMap.anion, 'Anion still needs grounding confirmation.'),
      buildField('Diffusing Ion', 'diffusing_ion', diffusionValue('diffusing_ion'), record, fieldMap.diffusing_ion, 'Diffusing ion still needs grounding confirmation.'),
      ...(shouldShowOptionalField(record, fieldMap, 'side_chain', extractorType)
        ? [buildField('Side Chain', 'side_chain', diffusionValue('side_chain'), record, fieldMap.side_chain, 'Side chain still needs confirmation.')]
        : []),
      ...(shouldShowOptionalField(record, fieldMap, 'water_uptake', extractorType)
        ? [buildField('Water Uptake', 'water_uptake', diffusionValue('water_uptake'), record, fieldMap.water_uptake, 'Water uptake still needs confirmation.')]
        : []),
      buildField('D_total', 'd_total', formatDiffusionNumber(record.D_total), record, fieldMap.d_total, 'Total diffusion coefficient still needs grounding confirmation.'),
      buildField('D_cation', 'd_cation', formatDiffusionNumber(record.D_cation), record, fieldMap.d_cation, 'Cation diffusion coefficient still needs grounding confirmation.'),
      buildField('D_anion', 'd_anion', formatDiffusionNumber(record.D_anion), record, fieldMap.d_anion, 'Anion diffusion coefficient still needs grounding confirmation.'),
      buildField('D Unit', 'd_unit', formatScientificUnit(record.D_unit), record, fieldMap.d_unit, 'Diffusion unit still needs grounding confirmation.'),
      buildField('Confinement Material', 'confinement_material_class', present(record.confinement_material_class), record, fieldMap.confinement_material_class, 'Confinement material still needs confirmation.'),
      buildField('Geometry', 'confinement_geometry_class', present(record.confinement_geometry_class), record, fieldMap.confinement_geometry_class, 'Confinement geometry still needs confirmation.'),
      buildField('Surface Groups', 'surface_functional_groups', present(record.surface_functional_groups), record, fieldMap.surface_functional_groups, 'Surface functional groups still need confirmation.'),
      buildField('Dimensionality', 'confinement_dimensionality', present(record.confinement_dimensionality), record, fieldMap.confinement_dimensionality, 'Confinement dimensionality still needs confirmation.'),
      ...(shouldShowOptionalField(record, fieldMap, 'temperature_value', extractorType)
        ? [buildField('Temperature', 'temperature_value', formatDiffusionNumber(record.temperature_value), record, fieldMap.temperature_value, 'Temperature still needs confirmation.')]
        : []),
      ...(shouldShowOptionalField(record, fieldMap, 'confinement_scale_value', extractorType)
        ? [buildField('Confinement Scale', 'confinement_scale_value', formatDiffusionNumber(record.confinement_scale_value), record, fieldMap.confinement_scale_value, 'Confinement scale still needs confirmation.')]
        : []),
      ...(shouldShowOptionalField(record, fieldMap, 'confinement_scale_unit', extractorType)
        ? [buildField('Confinement Unit', 'confinement_scale_unit', formatScientificUnit(record.confinement_scale_unit), record, fieldMap.confinement_scale_unit, 'Confinement unit still needs confirmation.')]
        : []),
    ]
  }
  const primaryMetricKey = resolvePrimaryTribologyMetricKey(record)
  return [
    buildField('Material', 'material', present(record.material_name), record, fieldMap.material, 'Material still needs grounding confirmation.'),
    buildField('Ionic Liquid', 'ionic_liquid', reviewIonicLiquidDisplay(record), record, fieldMap.ionic_liquid, 'Ionic liquid still needs grounding confirmation.'),
    ...buildLubricantComponentReviewFields(record, fieldMap),
    ...(primaryMetricKey
      ? [
          buildField(
            tribologyFieldLabel(primaryMetricKey),
            primaryMetricKey,
            fieldValueForKey(record, primaryMetricKey, extractorType),
            record,
            fieldMap[primaryMetricKey],
            tribologyFieldIssue(primaryMetricKey),
          ),
        ]
      : []),
    ...(shouldShowOptionalField(record, fieldMap, 'probe_roughness')
      ? [buildField('Probe Roughness', 'probe_roughness', fieldValueForKey(record, 'probe_roughness', extractorType), record, fieldMap.probe_roughness, 'Probe roughness still needs grounding confirmation.')]
      : []),
    ...(shouldShowOptionalField(record, fieldMap, 'substrate_roughness')
      ? [buildField('Substrate Roughness', 'substrate_roughness', fieldValueForKey(record, 'substrate_roughness', extractorType), record, fieldMap.substrate_roughness, 'Substrate roughness still needs grounding confirmation.')]
      : []),
    ...(shouldShowOptionalField(record, fieldMap, 'regime')
      ? [buildField('Regime', 'regime', fieldValueForKey(record, 'regime', extractorType), record, fieldMap.regime, 'Regime still needs grounding confirmation.')]
      : []),
    ...(shouldShowOptionalField(record, fieldMap, 'load')
      ? [buildField('Load', 'load', fieldValueForKey(record, 'load', extractorType), record, fieldMap.load, 'Load still needs grounding confirmation.')]
      : []),
    ...(shouldShowOptionalField(record, fieldMap, 'speed')
      ? [buildField('Speed', 'speed', fieldValueForKey(record, 'speed', extractorType), record, fieldMap.speed, 'Speed still needs grounding confirmation.')]
      : []),
    ...(shouldShowOptionalField(record, fieldMap, 'shear_rate')
      ? [buildField('Shear Rate', 'shear_rate', fieldValueForKey(record, 'shear_rate', extractorType), record, fieldMap.shear_rate, 'Shear rate still needs grounding confirmation.')]
      : []),
    ...(shouldShowOptionalField(record, fieldMap, 'temperature')
      ? [buildField('Temperature', 'temperature', fieldValueForKey(record, 'temperature', extractorType), record, fieldMap.temperature, 'Temperature still needs grounding confirmation.')]
      : []),
    ...(shouldShowOptionalField(record, fieldMap, 'potential')
      ? [
          buildField(
            'Potential',
            'potential',
            fieldValueForKey(record, 'potential', extractorType),
            record,
            fieldMap.potential,
            'Potential still needs grounding confirmation.',
          ),
        ]
      : []),
    ...(shouldShowOptionalField(record, fieldMap, 'water_content')
      ? [buildField('Water Content', 'water_content', fieldValueForKey(record, 'water_content', extractorType), record, fieldMap.water_content, 'Water content still needs grounding confirmation.')]
      : []),
  ]
}

function firstCaptured(...values: Array<string | null | undefined>) {
  return values.map((value) => trim(value)).find(Boolean) || ''
}

function hasStructuredTribopair(record: TribologyData | null | undefined) {
  if (!record || recordExtractorType(record) !== 'tribology') return false
  return Boolean(
    trim(record.probe_material)
    || trim(record.probe_geometry)
    || trim(record.probe_radius)
    || trim(record.probe_roughness)
    || trim(record.substrate_material)
    || trim(record.substrate_coating)
    || trim(record.substrate_roughness)
    || trim(record.surface_roughness),
  )
}

function filterVisibleReviewFields(record: TribologyData | null | undefined, fields: ReviewField[]) {
  if (!hasStructuredTribopair(record)) return fields
  return fields.filter((field) => {
    if (field.id === 'material') return field.evidenceStatus !== 'Grounded'
    return !['probe_roughness', 'substrate_roughness'].includes(field.id)
  })
}

function fieldEntryForAny(fieldMap: Record<string, FieldEvidenceEntry>, keys: string[]) {
  return keys.map((key) => fieldMap[key]).find((entry) => Boolean(entry)) || null
}

function tribopairPartStatus(
  entry: FieldEvidenceEntry | null | undefined,
  value: string,
  optional = false,
): TribopairReviewPart['status'] {
  if (!trim(value)) return optional ? 'Optional' : 'Missing'
  return resolveFieldEvidenceStatus(entry, value)
}

function tribopairPartStatusLabel(status: TribopairReviewPart['status']) {
  if (status === 'Grounded') return '已定位'
  if (status === 'Partial') return '缺定位'
  if (status === 'Optional') return '可选'
  return '待核验'
}

function tribopairPartStatusClass(status: TribopairReviewPart['status'], sourceType?: ReviewField['sourceType']) {
  if (sourceType === 'calculation') return 'border-[#ddd6fe] bg-[#f5f3ff] text-[#6d28d9]'
  if (status === 'Grounded') return 'border-[#bbf7d0] bg-[#ecfdf3] text-[#087443]'
  if (status === 'Partial') return 'border-[#fed7aa] bg-[#fff7ed] text-[#c2410c]'
  if (status === 'Optional') return 'border-[#e2e8f0] bg-white text-[#64748b]'
  return 'border-[#fecdd3] bg-[#fff5f6] text-[#cf334f]'
}

function roughnessPillClass(part: TribopairReviewPart) {
  if (part.roughnessFieldId === 'probe_roughness') {
    return part.status === 'Missing'
      ? 'border-[#bfdbfe] bg-[#eff6ff] text-[#2563eb]'
      : 'border-[#93c5fd] bg-[#dbeafe] text-[#1d4ed8] hover:bg-[#bfdbfe]'
  }
  if (part.roughnessFieldId === 'substrate_roughness') {
    return part.status === 'Missing'
      ? 'border-[#99f6e4] bg-[#f0fdfa] text-[#0f766e]'
      : 'border-[#5eead4] bg-[#ccfbf1] text-[#0f766e] hover:bg-[#99f6e4]'
  }
  return part.roughnessStatusClass || 'border-[#e2e8f0] bg-[#f1f5f9] text-slate-500'
}

function tribopairPartSource(entry: FieldEvidenceEntry | null | undefined, record: TribologyData) {
  if (trim(entry?.grounding_mode).toLowerCase() === 'inferred') return '推断'
  const sourceType = sourceTypeLabel(resolveFieldSourceType(entry, record))
  const page = entry?.evidence?.page
  const label = formatReviewSourceLabel(entry?.evidence?.source_label)
  if (page && label) return `${sourceType} · Page ${page} | ${label}`
  if (page) return `${sourceType} · Page ${page}`
  if (label) return `${sourceType} · ${label}`
  return sourceType
}

function buildTribopairReviewPart(
  record: TribologyData,
  fieldMap: Record<string, FieldEvidenceEntry>,
  config: {
    id: string
    label: string
    value: string
    meta?: string
    roughness?: string
    roughnessKey?: string
    highlight?: boolean
    keys: string[]
    fieldId: string
    optional?: boolean
  },
): TribopairReviewPart {
  const entry = fieldEntryForAny(fieldMap, config.keys)
  const status = tribopairPartStatus(entry, config.value, config.optional)
  const sourceType = resolveFieldSourceType(entry, record)
  const roughnessEntry = config.roughnessKey ? fieldMap[config.roughnessKey] : null
  const roughnessStatus = config.roughnessKey
    ? tribopairPartStatus(roughnessEntry, config.roughness || '', false)
    : null
  const roughnessSourceType = roughnessEntry ? resolveFieldSourceType(roughnessEntry, record) : undefined
  return {
    id: config.id,
    label: config.label,
    value: trim(config.value) || (config.optional ? '未记录' : '未提取'),
    meta: trim(config.meta),
    status,
    statusLabel: sourceType === 'calculation' ? '推导计算' : tribopairPartStatusLabel(status),
    statusClass: tribopairPartStatusClass(status, sourceType),
    sourceLabel: status === 'Optional' ? '非必填层' : tribopairPartSource(entry, record),
    sourceType,
    fieldId: config.fieldId,
    optional: Boolean(config.optional),
    roughness: config.roughness,
    roughnessFieldId: config.roughnessKey,
    roughnessStatusLabel: roughnessStatus ? tribopairPartStatusLabel(roughnessStatus) : undefined,
    roughnessStatusClass: roughnessStatus ? tribopairPartStatusClass(roughnessStatus, roughnessSourceType) : undefined,
    roughnessSourceLabel: roughnessEntry ? tribopairPartSource(roughnessEntry, record) : undefined,
    highlight: config.highlight,
  }
}

function buildTribopairReviewParts(record: TribologyData | null | undefined, remoteFields?: Record<string, FieldEvidenceEntry> | null): TribopairReviewPart[] {
  if (!record || recordExtractorType(record) !== 'tribology') return []
  const fieldMap = resolveRecordFieldEvidenceMap(record, remoteFields)
  const probeMeta = [
    trim(record.probe_geometry) ? `几何 ${trim(record.probe_geometry)}` : '',
    trim(record.probe_radius) ? `半径 ${trim(record.probe_radius)}` : '',
  ].filter(Boolean).join(' · ')
  const substrateValue = firstCaptured(record.substrate_material, record.material_name)
  const substrateMeta = ''
  const compositeRoughnessValue = trim(fieldMap.surface_roughness?.value)
  const roughnessValue = firstCaptured(compositeRoughnessValue, record.surface_roughness, record.substrate_roughness, record.probe_roughness)

  return [
    buildTribopairReviewPart(record, fieldMap, {
      id: 'probe',
      label: 'Probe',
      value: trim(record.probe_material),
      meta: probeMeta,
      roughness: trim(record.probe_roughness),
      roughnessKey: 'probe_roughness',
      keys: ['probe_material', 'material'],
      fieldId: 'material',
    }),
    buildTribopairReviewPart(record, fieldMap, {
      id: 'substrate',
      label: 'Substrate',
      value: substrateValue,
      meta: substrateMeta,
      roughness: trim(record.substrate_roughness),
      roughnessKey: 'substrate_roughness',
      keys: ['substrate_material', 'material'],
      fieldId: 'material',
    }),
    buildTribopairReviewPart(record, fieldMap, {
      id: 'coating',
      label: 'Coating',
      value: trim(record.substrate_coating),
      keys: ['substrate_coating', 'material'],
      fieldId: 'material',
      optional: true,
    }),
    buildTribopairReviewPart(record, fieldMap, {
      id: 'roughness',
      label: 'Roughness',
      value: roughnessValue,
      highlight: true,
      keys: ['surface_roughness', 'substrate_roughness', 'probe_roughness', 'material'],
      fieldId: reviewFields.value.some((field) => field.id === 'surface_roughness') ? 'surface_roughness' : 'material',
      optional: true,
    }),
  ]
}

function recordCanApprove(record: TribologyData | null | undefined, remoteFields?: Record<string, FieldEvidenceEntry> | null) {
  if (!record) return false
  const extractorType = recordExtractorType(record)
  if (extractorType === 'diffusion' && isPromotedDiffusionCandidate(record)) return false
  const fieldMap = resolveRecordFieldEvidenceMap(record, remoteFields)
  if (extractorType === 'diffusion') {
    const baseReady = ['system_name', 'ionic_liquid']
      .every((key) => resolveFieldEvidenceStatus(fieldMap[key], fieldValueForKey(record, key, extractorType)) === 'Grounded')
    const coefficientReady = ['d_total', 'd_cation', 'd_anion']
      .some((key) => resolveFieldEvidenceStatus(fieldMap[key], fieldValueForKey(record, key, extractorType)) === 'Grounded')
    if (!baseReady || !coefficientReady) return false
    return flaggedRequiredFieldKeys(record, remoteFields).length === 0
  }
  const hasMissingRequired = requiredTribologyFieldKeys(record)
    .some((key) => resolveFieldEvidenceStatus(fieldMap[key], fieldValueForKey(record, key, extractorType)) !== 'Grounded')
  if (hasMissingRequired) return false
  return flaggedRequiredFieldKeys(record, remoteFields).length === 0
}

function missingRequiredFieldLabels(record: TribologyData | null | undefined, remoteFields?: Record<string, FieldEvidenceEntry> | null) {
  if (!record) return []
  const extractorType = recordExtractorType(record)
  const fieldMap = resolveRecordFieldEvidenceMap(record, remoteFields)
  if (extractorType === 'diffusion') {
    const labels: string[] = []
    for (const key of ['system_name', 'ionic_liquid']) {
      if (resolveFieldEvidenceStatus(fieldMap[key], fieldValueForKey(record, key, extractorType)) !== 'Grounded') {
        labels.push(key === 'system_name' ? 'System' : 'Ionic Liquid')
      }
    }
    const coefficientMissing = ['d_total', 'd_cation', 'd_anion']
      .every((key) => resolveFieldEvidenceStatus(fieldMap[key], fieldValueForKey(record, key, extractorType)) !== 'Grounded')
    if (coefficientMissing) labels.push('Diffusion Coefficient')
    return labels
  }
  return requiredTribologyFieldKeys(record)
    .filter((key) => resolveFieldEvidenceStatus(fieldMap[key], fieldValueForKey(record, key, extractorType)) !== 'Grounded')
    .map((key) => tribologyFieldLabel(key))
}

function recordApprovalBlockedReason(record: TribologyData | null | undefined, remoteFields?: Record<string, FieldEvidenceEntry> | null) {
  if (isPromotedDiffusionCandidate(record)) return ''
  if (!record || recordCanApprove(record, remoteFields)) return ''

  const missingLabels = missingRequiredFieldLabels(record, remoteFields)
  if (missingLabels.length) {
    return `完成前需补齐证据字段：${missingLabels.join('、')}`
  }

  const flaggedLabels = flaggedRequiredFieldKeys(record, remoteFields).map((key) => {
    if (key === 'system_name') return 'System'
    if (key === 'ionic_liquid') return 'Ionic Liquid'
    if (key === 'diffusion_coefficient') return 'Diffusion Coefficient'
    return tribologyFieldLabel(key)
  })
  if (flaggedLabels.length) {
    return `完成前需先处理已标记字段：${flaggedLabels.join('、')}`
  }

  return '当前记录仍有未完成的审核字段。'
}

const approvalBlockedReason = computed(() => {
  return recordApprovalBlockedReason(activeRecord.value, activeRecordFieldEvidence.value?.fields)
})

function remoteFieldsForRecord(record: TribologyData | null | undefined) {
  if (!record || !activeRecord.value) return undefined
  return String(record.id || '') === String(activeRecord.value.id || '')
    ? activeRecordFieldEvidence.value?.fields
    : undefined
}

function approveActionLabel(record: TribologyData | null | undefined) {
  if (recordExtractorType(record) === 'diffusion') {
    if (isPromotedDiffusionCandidate(record)) return '已入库'
    if (reviewEntityType(record) === 'candidate') return '确认并入库'
  }
  return '确认本条'
}

function approveActionTitle(record: TribologyData | null | undefined, remoteFields?: Record<string, FieldEvidenceEntry> | null) {
  const blockedReason = recordApprovalBlockedReason(record, remoteFields)
  if (blockedReason) return blockedReason
  if (recordExtractorType(record) === 'diffusion') {
    if (isPromotedDiffusionCandidate(record)) return '这条扩散候选已生成正式入库记录'
    if (reviewEntityType(record) === 'candidate') return '确认字段证据，并写入扩散库正式记录'
  }
  return '确认这条 Record 下所有字段'
}

function usesRecordReviewEndpoint(record: TribologyData | null | undefined) {
  return reviewEntityType(record) === 'record'
}

async function confirmReviewFieldPayload(record: TribologyData, fieldId: string) {
  const recordId = Number(record.id || '')
  if (recordExtractorType(record) === 'diffusion') {
    return usesRecordReviewEndpoint(record)
      ? confirmDiffusionRecordFieldEvidence(recordId, fieldId)
      : confirmDiffusionCandidateFieldEvidence(recordId, fieldId)
  }
  return usesRecordReviewEndpoint(record)
    ? confirmRecordFieldEvidence(recordId, fieldId)
    : confirmCandidateFieldEvidence(recordId, fieldId)
}

async function flagReviewFieldPayload(record: TribologyData, fieldId: string, note: string) {
  const recordId = Number(record.id || '')
  if (recordExtractorType(record) === 'diffusion') {
    return usesRecordReviewEndpoint(record)
      ? flagDiffusionRecordFieldEvidence(recordId, fieldId, note)
      : flagDiffusionCandidateFieldEvidence(recordId, fieldId, note)
  }
  return usesRecordReviewEndpoint(record)
    ? flagRecordFieldEvidence(recordId, fieldId, note)
    : flagCandidateFieldEvidence(recordId, fieldId, note)
}

async function unflagReviewFieldPayload(record: TribologyData, fieldId: string, note?: string | null) {
  const recordId = Number(record.id || '')
  if (recordExtractorType(record) === 'diffusion') {
    return usesRecordReviewEndpoint(record)
      ? unflagDiffusionRecordFieldEvidence(recordId, fieldId, note)
      : unflagDiffusionCandidateFieldEvidence(recordId, fieldId, note)
  }
  return usesRecordReviewEndpoint(record)
    ? unflagRecordFieldEvidence(recordId, fieldId, note)
    : unflagCandidateFieldEvidence(recordId, fieldId, note)
}

async function approveReviewRecordPayload(record: TribologyData) {
  const recordId = Number(record.id || '')
  if (recordExtractorType(record) === 'diffusion') {
    return usesRecordReviewEndpoint(record)
      ? approveDiffusionReviewRecord(recordId)
      : approveDiffusionReviewCandidate(recordId)
  }
  return usesRecordReviewEndpoint(record)
    ? approveReviewRecord(recordId)
    : approveReviewCandidate(recordId)
}

function openCofEditor(record: TribologyData) {
  const current = cofExtractedForRecord(record) || {
    raw_text: record.cof || '',
    value_type: 'single',
    cof_min: null,
    cof_max: null,
    cof_average: null,
    dependent_variable: null,
    test_condition_value: null,
  }
  cofEditRecord.value = record
  cofEditJson.value = JSON.stringify(current, null, 2)
  cofEditError.value = ''
}

function closeCofEditor() {
  cofEditRecord.value = null
  cofEditJson.value = ''
  cofEditError.value = ''
}

function openLoadEditor(record: TribologyData) {
  const current = loadConditionsForRecord(record) || {
    raw_text: record.load || '',
    value_type: 'unstated',
    system_total_load_N: null,
    contact_load_per_unit_N: null,
    contact_unit_type: null,
    load_min_N: null,
    load_max_N: null,
  }
  loadEditRecord.value = record
  loadEditRawText.value = trim(current.raw_text ?? current.rawText ?? record.load)
  const systemTotal = current.system_total_load_N ?? current.systemTotalLoadN
  const contactLoad = current.contact_load_per_unit_N ?? current.contactLoadPerUnitN
  loadEditSystemTotal.value = systemTotal == null ? '' : String(systemTotal)
  loadEditContactLoad.value = contactLoad == null ? '' : String(contactLoad)
  loadEditContactUnit.value = trim(current.contact_unit_type ?? current.contactUnitType)
  loadEditError.value = ''
}

function closeLoadEditor() {
  loadEditRecord.value = null
  loadEditRawText.value = ''
  loadEditSystemTotal.value = ''
  loadEditContactLoad.value = ''
  loadEditContactUnit.value = ''
  loadEditError.value = ''
}

function openSpeedEditor(record: TribologyData) {
  const current = speedConditionsForRecord(record) || {
    raw_text: record.speed || '',
    value_type: 'linear',
    sliding_velocity_um_s: null,
    scan_rate_hz: null,
    scan_length_um: null,
    unit_warning: false,
  }
  speedEditRecord.value = record
  speedEditRawText.value = trim(current.raw_text ?? current.rawText ?? record.speed)
  const sliding = current.sliding_velocity_um_s ?? current.slidingVelocityUmS
  const rate = current.scan_rate_hz ?? current.scanRateHz
  const length = current.scan_length_um ?? current.scanLengthUm
  speedEditSliding.value = sliding == null ? '' : String(sliding)
  speedEditRate.value = rate == null ? '' : String(rate)
  speedEditLength.value = length == null ? '' : String(length)
  speedEditError.value = ''
}

function closeSpeedEditor() {
  speedEditRecord.value = null
  speedEditRawText.value = ''
  speedEditSliding.value = ''
  speedEditRate.value = ''
  speedEditLength.value = ''
  speedEditError.value = ''
}

function openSystemEditor(record: TribologyData) {
  const current = tribologicalSystemForRecord(record) || {
    raw_text: record.regime || '',
    friction_regime: 'unstated',
    contact_geometry: null,
    scale: null,
  }
  systemEditRecord.value = record
  systemEditRawText.value = trim(current.raw_text ?? current.rawText ?? record.regime)
  systemEditFrictionRegime.value = trim(current.friction_regime ?? current.frictionRegime) || 'unstated'
  systemEditContactGeometry.value = trim(current.contact_geometry ?? current.contactGeometry)
  systemEditScale.value = canonicalExperimentScaleValue(current.scale)
  systemEditError.value = ''
}

function closeSystemEditor() {
  systemEditRecord.value = null
  systemEditRawText.value = ''
  systemEditFrictionRegime.value = 'unstated'
  systemEditContactGeometry.value = ''
  systemEditScale.value = ''
  systemEditError.value = ''
}

function isFieldFlagged(field: ReviewField | null | undefined) {
  return String(field?.reviewState || '').trim().toLowerCase() === 'flagged'
}

function fieldSupportsFlaggedEditor(fieldId: string, record: TribologyData | null | undefined) {
  if (recordExtractorType(record) !== 'tribology') return false
  return ['cof', 'load', 'speed', 'regime'].includes(fieldId)
}

function openFlaggedFieldEditor(fieldId: string, record: TribologyData) {
  activeFieldId.value = fieldId
  if (fieldId === 'cof') {
    openCofEditor(record)
    return
  }
  if (fieldId === 'load') {
    openLoadEditor(record)
    return
  }
  if (fieldId === 'speed') {
    openSpeedEditor(record)
    return
  }
  if (fieldId === 'regime') {
    openSystemEditor(record)
  }
}

async function saveCofEditor() {
  const record = cofEditRecord.value
  const recordId = Number(record?.id || '')
  if (!record || !Number.isFinite(recordId)) return
  let parsed: CofExtracted
  try {
    parsed = JSON.parse(cofEditJson.value)
  } catch {
    cofEditError.value = 'JSON 格式不正确。'
    return
  }

  reviewActionPending.value = `cof-edit:${recordId}`
  cofEditError.value = ''
  reviewActionError.value = ''
  try {
    const payload = usesRecordReviewEndpoint(record)
      ? await updateReviewRecordCofExtracted(recordId, parsed)
      : await updateReviewCandidateCofExtracted(recordId, parsed)
    ;(record as any).cof_extracted = parsed
    record.cof = trim(parsed.raw_text || parsed.rawText || record.cof)
    applyReviewResponse(payload)
    closeCofEditor()
  } catch (error: any) {
    cofEditError.value = String(error?.response?.data?.detail || error?.message || '保存 COF 结构失败')
  } finally {
    reviewActionPending.value = null
  }
}

async function saveLoadEditor() {
  const record = loadEditRecord.value
  const recordId = Number(record?.id || '')
  if (!record || !Number.isFinite(recordId)) return
  const systemTotal = asNumberOrNull(loadEditSystemTotal.value)
  const contactLoad = asNumberOrNull(loadEditContactLoad.value)
  if (loadEditSystemTotal.value && systemTotal == null) {
    loadEditError.value = '系统载荷必须是数字，单位固定为 N。'
    return
  }
  if (loadEditContactLoad.value && contactLoad == null) {
    loadEditError.value = '单点载荷必须是数字，单位固定为 N。'
    return
  }
  const current = loadConditionsForRecord(record)
  const parsed: LoadConditions = {
    raw_text: loadEditRawText.value || record.load || '',
    value_type: systemTotal != null && contactLoad != null
      ? 'composite'
      : current?.value_type || current?.valueType || 'single',
    system_total_load_N: systemTotal,
    contact_load_per_unit_N: contactLoad,
    contact_unit_type: loadEditContactUnit.value || null,
    load_min_N: current?.load_min_N ?? current?.loadMinN ?? contactLoad ?? systemTotal,
    load_max_N: current?.load_max_N ?? current?.loadMaxN ?? contactLoad ?? systemTotal,
  }

  reviewActionPending.value = `load-edit:${recordId}`
  loadEditError.value = ''
  reviewActionError.value = ''
  try {
    const payload = usesRecordReviewEndpoint(record)
      ? await updateReviewRecordLoadConditions(recordId, parsed)
      : await updateReviewCandidateLoadConditions(recordId, parsed)
    ;(record as any).load_conditions = parsed
    record.load = trim(parsed.raw_text || parsed.rawText || record.load)
    applyReviewResponse(payload)
    closeLoadEditor()
  } catch (error: any) {
    loadEditError.value = String(error?.response?.data?.detail || error?.message || '保存载荷结构失败')
  } finally {
    reviewActionPending.value = null
  }
}

async function saveSpeedEditor() {
  const record = speedEditRecord.value
  const recordId = Number(record?.id || '')
  if (!record || !Number.isFinite(recordId)) return
  const slidingInput = asNumberOrNull(speedEditSliding.value)
  const rate = asNumberOrNull(speedEditRate.value)
  const length = asNumberOrNull(speedEditLength.value)
  if (speedEditSliding.value && slidingInput == null) {
    speedEditError.value = '滑移速度必须是数字，单位固定为 μm/s。'
    return
  }
  if (speedEditRate.value && rate == null) {
    speedEditError.value = '扫描频率必须是数字，单位固定为 Hz。'
    return
  }
  if (speedEditLength.value && length == null) {
    speedEditError.value = '扫描长度必须是数字，单位固定为 μm。'
    return
  }
  const derivedSliding = slidingInput ?? (rate != null && length != null ? Number((2 * length * rate).toPrecision(12)) : null)
  const parsed: SpeedConditions = {
    raw_text: speedEditRawText.value || record.speed || '',
    value_type: rate != null && length != null && slidingInput == null
      ? 'derived'
      : derivedSliding != null
        ? 'linear'
        : rate != null
          ? 'scan_rate'
          : 'unknown',
    sliding_velocity_um_s: derivedSliding,
    scan_rate_hz: rate,
    scan_length_um: length,
    unit_warning: rate != null && derivedSliding == null,
    calculation: rate != null && length != null && slidingInput == null ? `v = 2 x ${length} μm x ${rate} Hz` : null,
  }

  reviewActionPending.value = `speed-edit:${recordId}`
  speedEditError.value = ''
  reviewActionError.value = ''
  try {
    const payload = usesRecordReviewEndpoint(record)
      ? await updateReviewRecordSpeedConditions(recordId, parsed)
      : await updateReviewCandidateSpeedConditions(recordId, parsed)
    ;(record as any).speed_conditions = parsed
    record.speed = derivedSliding != null ? `${derivedSliding} μm/s` : ''
    applyReviewResponse(payload)
    closeSpeedEditor()
  } catch (error: any) {
    speedEditError.value = String(error?.response?.data?.detail || error?.message || '保存速度结构失败')
  } finally {
    reviewActionPending.value = null
  }
}

async function saveSystemEditor() {
  const record = systemEditRecord.value
  const recordId = Number(record?.id || '')
  if (!record || !Number.isFinite(recordId)) return
  const parsed: TribologicalSystem = {
    raw_text: systemEditRawText.value || record.regime || '',
    friction_regime: systemEditFrictionRegime.value || 'unstated',
    contact_geometry: systemEditContactGeometry.value || null,
    scale: canonicalExperimentScaleValue(systemEditScale.value) || null,
  }

  reviewActionPending.value = `system-edit:${recordId}`
  systemEditError.value = ''
  reviewActionError.value = ''
  try {
    const payload = usesRecordReviewEndpoint(record)
      ? await updateReviewRecordTribologicalSystem(recordId, parsed)
      : await updateReviewCandidateTribologicalSystem(recordId, parsed)
    ;(record as any).tribological_system = parsed
    record.regime = trim(parsed.raw_text || parsed.rawText || record.regime)
    applyReviewResponse(payload)
    closeSystemEditor()
  } catch (error: any) {
    systemEditError.value = String(error?.response?.data?.detail || error?.message || '保存测试机制结构失败')
  } finally {
    reviewActionPending.value = null
  }
}

async function handleConfirmField(field: ReviewField, recordOverride?: TribologyData | null) {
  const record = recordOverride || activeRecord.value
  const recordId = Number(record?.id || '')
  if (!record || !field.canConfirm || !Number.isFinite(recordId)) return

  activeFieldId.value = field.id
  reviewActionPending.value = `confirm:${recordId}:${field.id}`
  reviewActionError.value = ''
  try {
    const payload = await confirmReviewFieldPayload(record, field.id)
    applyReviewResponse(payload)
  } catch (error: any) {
    reviewActionError.value = String(error?.response?.data?.detail || error?.message || 'Failed to confirm field')
  } finally {
    reviewActionPending.value = null
  }
}

async function handleFlagActiveField(fieldId?: string, recordOverride?: TribologyData | null) {
  const record = recordOverride || activeRecord.value
  const recordId = Number(record?.id || '')
  const targetFieldId = fieldId || activeField.value?.id
  if (!record || !targetFieldId || !Number.isFinite(recordId)) return

  activeFieldId.value = targetFieldId
  reviewActionPending.value = `flag:${recordId}:${targetFieldId}`
  reviewActionError.value = ''
  try {
    const payload = await flagReviewFieldPayload(record, targetFieldId, 'Flagged from review UI')
    applyReviewResponse(payload)
  } catch (error: any) {
    reviewActionError.value = String(error?.response?.data?.detail || error?.message || 'Failed to flag field')
  } finally {
    reviewActionPending.value = null
  }
}

async function handleUnflagActiveField(fieldId?: string, recordOverride?: TribologyData | null) {
  const record = recordOverride || activeRecord.value
  const recordId = Number(record?.id || '')
  const targetFieldId = fieldId || activeField.value?.id
  if (!record || !targetFieldId || !Number.isFinite(recordId)) return

  activeFieldId.value = targetFieldId
  reviewActionPending.value = `unflag:${recordId}:${targetFieldId}`
  reviewActionError.value = ''
  try {
    const payload = await unflagReviewFieldPayload(record, targetFieldId)
    applyReviewResponse(payload)
  } catch (error: any) {
    reviewActionError.value = String(error?.response?.data?.detail || error?.message || 'Failed to clear field flag')
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
    const payload = await approveReviewRecordPayload(target)
    applyReviewResponse(payload)
  } catch (error: any) {
    reviewActionError.value = String(error?.response?.data?.detail || error?.message || 'Failed to approve record')
  } finally {
    reviewActionPending.value = null
  }
}

async function handleApproveAll() {
  if (!canApproveAllVisible.value) return

  if (visibleRecordCount.value === 1) {
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
      const payload = await approveReviewRecordPayload(item.record)
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
  if (status === 'confirmed') return '已完成'
  if (status === 'in_progress') return '处理中'
  return '待审'
}

function recordBadge(status: RecordItem['status']) {
  if (status === 'confirmed') return { label: '已确认', className: 'bg-[#e8fff2] text-[#0b9d63]' }
  if (status === 'warning') return { label: '需关注', className: 'bg-[#fff4da] text-[#c97a00]' }
  return { label: '待审核', className: 'bg-[#edf2ff] text-[#3d56d2]' }
}

function recordBadgeForRecord(record: TribologyData, status: RecordItem['status']) {
  if (recordExtractorType(record) === 'diffusion') {
    const storageState = diffusionStorageState(record)
    if (storageState === 'promoted') return { label: '已入库', className: 'bg-[#e8fff2] text-[#0b9d63]' }
    if (storageState === 'candidate') {
      if (status === 'warning') return { label: '需复核', className: 'bg-[#fff4da] text-[#c97a00]' }
      return { label: '待入库', className: 'bg-[#edf2ff] text-[#3d56d2]' }
    }
    if (status === 'confirmed') return { label: '已入库', className: 'bg-[#e8fff2] text-[#0b9d63]' }
  }
  return recordBadge(status)
}

function fieldRowTone(field: ReviewField) {
  if (field.id === activeFieldId.value) return 'border-[#b8c1ff] bg-[#fbfcff] ring-1 ring-[#c5cbff]'
  if (field.status === 'low_conf') return 'border-[#f1ddbd] bg-white hover:border-[#dcc89e]'
  if (field.status === 'confirmed') return 'border-[#e5ebf4] bg-white opacity-90 hover:opacity-100'
  return 'border-[#e5ebf4] bg-white hover:border-[#cdd5e2]'
}

function confidenceText(confidence: ReviewField['confidence']) {
  if (confidence === 'High') return '高'
  if (confidence === 'Medium') return '中'
  return '低'
}

function sourceTypeLabel(sourceType: ReviewField['sourceType']) {
  if (sourceType === 'figure') return '图'
  if (sourceType === 'table') return '表'
  if (sourceType === 'calculation') return '计算'
  if (sourceType === 'text') return '正文'
  return '推断'
}

function presentZh(value: string) {
  return value === 'Not captured yet' ? '尚未提取' : value
}

function isRoughnessFieldId(fieldId: string) {
  return ['surface_roughness', 'probe_roughness', 'substrate_roughness'].includes(fieldId)
}

function roughnessTextParts(value: string) {
  const text = presentZh(value)
  const parts: Array<{ type: 'text' | 'rq', text: string }> = []
  const pattern = /\bR\s*[_-]?\s*[Qq]\b/g
  let cursor = 0
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text))) {
    if (match.index > cursor) {
      parts.push({ type: 'text', text: text.slice(cursor, match.index) })
    }
    parts.push({ type: 'rq', text: 'Rq' })
    cursor = match.index + match[0].length
  }
  if (cursor < text.length) {
    parts.push({ type: 'text', text: text.slice(cursor) })
  }
  return parts.length ? parts : [{ type: 'text', text }]
}
</script>


<template>
  <div class="flex h-full min-h-0 flex-col gap-3 overflow-hidden bg-[#f1f5f9] p-3">
    <!-- ─── 顶部状态条 ─────────────────────────────────────────────── -->
    <section class="shell-surface flex flex-wrap items-center gap-3 px-4 py-2.5 sm:px-5">
      <button
        type="button"
        class="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[0.6rem] border border-[#e2e8f0] bg-white text-slate-500 transition hover:bg-[#f8fbff] hover:text-slate-800"
        :title="inboxCollapsed ? '展开文献列表' : '收起文献列表'"
        @click="inboxCollapsed = !inboxCollapsed"
      >
        <ChevronsRight v-if="inboxCollapsed" class="h-4 w-4" />
        <ChevronsLeft v-else class="h-4 w-4" />
      </button>

      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-2">
          <FileText class="h-4 w-4 shrink-0 text-[#7d8eaa]" />
          <h1 class="truncate text-[0.95rem] font-semibold text-slate-900">
            {{ activeDocumentName }}
          </h1>
          <span
            v-if="documentTotal"
            class="shrink-0 rounded-full bg-[#edf2ff] px-2.5 py-0.5 text-xs font-semibold text-[#3d56d2]"
          >
            待审 {{ documentPending }} / {{ documentTotal }}
          </span>
          <span
            v-if="documentLowConfidence"
            class="shrink-0 rounded-full bg-[#fff4da] px-2.5 py-0.5 text-xs font-semibold text-[#c97a00]"
          >
            低置信度 {{ documentLowConfidence }}
          </span>
          <span
            v-if="documentMissingEvidence"
            class="shrink-0 rounded-full bg-[#fff5f6] px-2.5 py-0.5 text-xs font-semibold text-[#cf334f]"
          >
            缺证据 {{ documentMissingEvidence }}
          </span>
        </div>
      </div>

      <div class="flex shrink-0 items-center gap-1.5">
        <button
          type="button"
          class="inline-flex items-center gap-1 rounded-[0.6rem] border border-[#e2e8f0] bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 transition disabled:cursor-not-allowed disabled:opacity-50 hover:bg-[#f8fbff] hover:text-slate-900"
          :disabled="!hasPrevRecord"
          title="上一条"
          @click="gotoPrevRecord"
        >
          <ChevronLeft class="h-3.5 w-3.5" />
          上一条
        </button>
        <span v-if="activeRecordIndex >= 0" class="text-xs font-medium text-slate-500 tabular-nums">
          {{ activeRecordIndex + 1 }} / {{ visibleRecordCount }}
        </span>
        <button
          type="button"
          class="inline-flex items-center gap-1 rounded-[0.6rem] border border-[#e2e8f0] bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 transition disabled:cursor-not-allowed disabled:opacity-50 hover:bg-[#f8fbff] hover:text-slate-900"
          :disabled="!hasNextRecord"
          title="下一条"
          @click="gotoNextRecord"
        >
          下一条
          <ChevronRight class="h-3.5 w-3.5" />
        </button>

        <span class="mx-2 h-5 w-px bg-[#e2e8f0]" />

        <button
          type="button"
          class="inline-flex items-center gap-1.5 rounded-[0.6rem] border border-[#bfdbfe] bg-[#eff6ff] px-3 py-1.5 text-xs font-semibold text-[#1d4ed8] transition hover:border-[#93c5fd] hover:bg-[#dbeafe] disabled:cursor-not-allowed disabled:border-[#dbeafe] disabled:bg-[#f8fbff] disabled:text-slate-400"
          :disabled="!canReextractCurrentFile"
          title="对当前文献强制重新提取，重新生成候选记录和字段证据"
          @click="handleReextractCurrentFile"
        >
          <Loader2 v-if="reviewActionPending === 'reextract'" class="h-3.5 w-3.5 animate-spin" />
          <RefreshCw v-else class="h-3.5 w-3.5" />
          {{ reviewActionPending === 'reextract' ? '提取中' : '重新提取' }}
        </button>

        <button
          type="button"
          class="inline-flex items-center gap-1.5 rounded-[0.6rem] bg-[#5b56ea] px-3.5 py-1.5 text-xs font-semibold text-white shadow-[0_10px_24px_-18px_rgba(91,86,234,0.85)] transition hover:bg-[#4c47d9] disabled:cursor-not-allowed disabled:bg-[#cfd2f3] disabled:shadow-none"
          :disabled="!canApproveAllVisible || reviewActionPending === 'approve-all'"
          @click="handleApproveAll"
        >
          <Loader2 v-if="reviewActionPending === 'approve-all'" class="h-3.5 w-3.5 animate-spin" />
          <CheckCheck v-else class="h-3.5 w-3.5" />
          {{ approveAllLabel }}
        </button>

        <button
          type="button"
          class="inline-flex items-center gap-1 rounded-[0.6rem] border border-[#e2e8f0] bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-[#f8fbff] hover:text-slate-900"
          @click="emit('open-pipeline')"
        >
          返回提取
        </button>
        <button
          type="button"
          class="inline-flex items-center gap-1 rounded-[0.6rem] border border-[#e2e8f0] bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-[#f8fbff] hover:text-slate-900"
          @click="emit('open-knowledge')"
        >
          打开知识库
        </button>
      </div>

      <p
        v-if="reviewActionError"
        class="basis-full rounded-[0.6rem] border border-[#ffd4da] bg-[#fff5f6] px-3 py-1.5 text-xs text-[#cf334f]"
      >
        {{ reviewActionError }}
      </p>
      <p
        v-else-if="approvalBlockedReason"
        class="basis-full rounded-[0.6rem] border border-[#f1ddbd] bg-[#fffaf0] px-3 py-1.5 text-xs text-[#9a5b00]"
      >
        {{ approvalBlockedReason }}
      </p>
    </section>

    <!-- ─── 主区：左 文献列表 / 中 PDF / 右 数据卡片 ──────────── -->
    <div
      class="grid min-h-0 flex-1 gap-3"
      :class="inboxCollapsed
        ? 'xl:grid-cols-[3rem_minmax(0,1fr)_24rem]'
        : 'xl:grid-cols-[15rem_minmax(0,1fr)_24rem]'"
    >
      <!-- ── 左：文献列表 ──────────────────────────────── -->
      <aside
        v-if="!inboxCollapsed"
        class="flex min-h-0 flex-col overflow-hidden rounded-[1.25rem] border border-[#e2e8f0] bg-white"
      >
        <div class="border-b border-[#eef2f6] px-3 py-3">
          <div class="flex items-center justify-between gap-2">
            <p class="text-[11px] font-bold uppercase tracking-[0.18em] text-[#8fa0ba]">文献列表</p>
            <span class="inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-md bg-[#eef2ff] px-1.5 text-[11px] font-semibold text-[#5061d1]">
              {{ queueItemCount }}
            </span>
          </div>
          <div class="relative mt-2">
            <Search class="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              v-model="query"
              type="text"
              class="h-8 w-full rounded-[0.55rem] border border-[#e2e8f0] bg-white pl-7 pr-2 text-xs text-slate-700 outline-none placeholder:text-slate-400 focus:border-[#b7c6ef]"
              placeholder="搜索文献..."
            >
          </div>
          <label class="mt-2 inline-flex items-center gap-1.5 text-[11px] font-medium text-slate-600">
            <input
              v-model="prioritizeLowConfidence"
              type="checkbox"
              class="h-3.5 w-3.5 rounded border-slate-300 text-[#5b56ea] focus:ring-[#5b56ea]"
            >
            优先显示低置信度
          </label>
        </div>

        <div class="min-h-0 flex-1 space-y-1.5 overflow-y-auto custom-scrollbar p-2">
          <button
            v-for="item in queueItems"
            :key="item.id"
            type="button"
            class="w-full rounded-[0.75rem] border px-2.5 py-2 text-left transition"
            :class="item.selected
              ? 'border-[#aebdfc] bg-[#f5f7ff] ring-1 ring-[#aebdfc]/40'
              : 'border-[#eef2f6] bg-white hover:border-[#d8e0eb] hover:bg-[#f8fbff]'"
            @click="item.id !== 'empty' && emit('select-file', item.id)"
          >
            <div class="flex items-start justify-between gap-1.5">
              <p
                class="line-clamp-2 text-xs font-semibold leading-snug"
                :class="item.selected ? 'text-[#2c3ea8]' : 'text-slate-800'"
              >
                {{ item.name }}
              </p>
              <AlertTriangle v-if="item.alert" class="mt-0.5 h-3 w-3 shrink-0 text-[#f5a623]" />
            </div>
            <div class="mt-1.5 flex flex-wrap items-center gap-1">
              <span
                class="inline-flex rounded-md px-1.5 py-0.5 text-[10px] font-semibold"
                :class="queueTone(item.status)"
              >
                {{ queueLabel(item.status) }}
              </span>
              <span class="text-[10px] text-slate-500">{{ item.recordCount }} 条</span>
              <span
                v-if="item.lowConfidenceCount + item.missingEvidenceCount"
                class="text-[10px] font-semibold text-[#cf334f]"
              >
                {{ item.lowConfidenceCount + item.missingEvidenceCount }} 待处理
              </span>
            </div>
          </button>
        </div>
      </aside>

      <aside
        v-else
        class="flex min-h-0 flex-col items-center gap-1.5 overflow-y-auto rounded-[1.25rem] border border-[#e2e8f0] bg-white py-3"
      >
        <button
          v-for="item in queueItems"
          :key="item.id"
          type="button"
          class="relative flex h-8 w-8 items-center justify-center rounded-[0.55rem] text-[10px] font-bold uppercase transition"
          :class="item.selected
            ? 'bg-[#5b56ea] text-white'
            : 'bg-[#f1f5f9] text-slate-500 hover:bg-[#e2e8f0]'"
          :title="item.name"
          @click="item.id !== 'empty' && emit('select-file', item.id)"
        >
          {{ item.name.slice(0, 2) }}
          <span
            v-if="item.alert"
            class="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-[#f5a623] ring-2 ring-white"
          />
        </button>
      </aside>

      <!-- ── 中：PDF 内联预览 ──────────────────────── -->
      <section class="flex min-h-0 flex-col overflow-hidden rounded-[1.25rem] border border-[#e2e8f0] bg-white">
        <div class="flex flex-wrap items-center justify-between gap-2 border-b border-[#eef2f6] px-4 py-2.5">
          <div class="flex min-w-0 items-center gap-2">
            <FileText class="h-4 w-4 text-[#7d8eaa]" />
            <p class="text-[11px] font-bold uppercase tracking-[0.18em] text-[#8fa0ba]">原文预览</p>
            <span
              v-if="activeField"
              class="rounded-md bg-[#f5f7ff] px-2 py-0.5 text-[11px] font-medium text-[#5061d1]"
            >
              当前字段：{{ activeField.label }}
            </span>
          </div>
          <div class="flex items-center gap-2">
            <form
              v-if="pdfUrl"
              class="flex items-center gap-1 rounded-md bg-transparent px-0 py-1"
              title="输入页码后按 Enter 跳转"
              @submit.prevent="jumpToPdfPage"
            >
              <label for="review-pdf-page-jump" class="text-[11px] font-semibold text-[#64748b]">Page</label>
              <input
                id="review-pdf-page-jump"
                v-model="pdfPageInput"
                type="number"
                min="1"
                :max="pdfPageCount || undefined"
                inputmode="numeric"
                placeholder="8"
                class="h-6 w-14 rounded border border-[#dbe4f0] bg-white px-2 text-center text-[12px] font-semibold text-[#1e293b] outline-none transition focus:border-[#5b56ea] focus:ring-2 focus:ring-[#5b56ea]/15"
                :aria-invalid="Boolean(pdfPageError)"
                @change="jumpToPdfPage"
              >
              <span v-if="pdfPageCount" class="text-[11px] font-medium text-[#94a3b8]">/ {{ pdfPageCount }}</span>
            </form>
            <a
              v-if="pdfUrl"
              :href="pdfUrl"
              target="_blank"
              rel="noreferrer"
              class="inline-flex items-center gap-1 text-[11px] font-medium text-[#5b56ea] transition hover:text-[#403bcb]"
            >
              新窗口打开
              <ExternalLink class="h-3 w-3" />
            </a>
          </div>
        </div>

        <div class="min-h-0 flex-1 overflow-hidden bg-[#f8fafc]">
          <PdfViewerWithHighlight
            v-if="pdfUrl"
            ref="pdfViewerRef"
            :key="pdfUrl"
            :src="pdfUrl"
            :highlights="recordHighlights"
            :active-id="activeHighlightId"
            @loaded="handlePdfLoaded"
            @highlight-click="handleHighlightClick"
          />
          <div v-else class="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
            <FileText class="h-12 w-12 text-slate-300" />
            <p class="text-sm font-semibold text-slate-700">暂无可预览的 PDF</p>
            <p class="text-xs text-slate-500">从左侧文献列表选择一篇已提取的论文，即可在此查看原文与高亮。</p>
          </div>
        </div>
      </section>

      <!-- ── 右：数据卡片 ──────────────────────────── -->
      <aside class="flex min-h-0 flex-col overflow-hidden rounded-[1.25rem] border border-[#e2e8f0] bg-white">
        <div class="border-b border-[#eef2f6] px-4 py-2.5">
          <div class="flex items-center justify-between gap-2">
            <p class="text-[11px] font-bold uppercase tracking-[0.18em] text-[#8fa0ba]">提取记录</p>
            <span class="text-[11px] font-medium text-slate-500">{{ visibleRecordCount }} / {{ recordItemCount }}</span>
          </div>
          <div class="mt-2 flex flex-wrap items-center gap-1">
            <button
              type="button"
              class="inline-flex items-center gap-1 rounded-[0.5rem] px-2 py-1 text-[11px] font-semibold transition"
              :class="onlyTrainingBlockers ? 'bg-rose-600 text-white' : 'bg-rose-50 text-rose-700 hover:bg-rose-100'"
              @click="onlyTrainingBlockers = !onlyTrainingBlockers"
            >
              卡住训练 <span class="ml-0.5 tabular-nums opacity-90">{{ trainingBlockerCount }}</span>
            </button>
            <button
              type="button"
              class="rounded-[0.5rem] px-2 py-1 text-[11px] font-semibold transition"
              :class="onlyPendingRecords ? 'bg-[#101b29] text-white' : 'bg-[#f1f5f9] text-slate-600 hover:bg-[#e2e8f0]'"
              @click="onlyPendingRecords = !onlyPendingRecords"
            >
              只看待审
            </button>
            <button
              type="button"
              class="rounded-[0.5rem] px-2 py-1 text-[11px] font-semibold transition"
              :class="onlyLowConfidenceRecords ? 'bg-[#101b29] text-white' : 'bg-[#f1f5f9] text-slate-600 hover:bg-[#e2e8f0]'"
              @click="onlyLowConfidenceRecords = !onlyLowConfidenceRecords"
            >
              只看低置信度
            </button>
          </div>

          <div
            v-if="onlyTrainingBlockers"
            class="mt-2 rounded-[0.7rem] border px-3 py-2 text-[11px] leading-4"
            :class="trainingBlockerCount > 0
              ? 'border-rose-200 bg-rose-50 text-rose-800'
              : 'border-emerald-200 bg-emerald-50 text-emerald-800'"
          >
            <div v-if="trainingBlockerCount > 0">
              <p class="font-semibold">{{ trainingBlockerCount }} 条记录正卡住你的训练集</p>
              <p class="mt-0.5 font-normal text-rose-700/90">修完后回到 Dataset Workflow 即可继续生成数据集。</p>
            </div>
            <div v-else>
              <div class="flex items-center justify-between gap-2">
                <p class="font-semibold">全部解决了 ✓</p>
                <button
                  type="button"
                  class="rounded-md bg-emerald-600 px-2 py-1 text-[11px] font-semibold text-white transition hover:bg-emerald-500"
                  @click="emit('open-dataset-workflow')"
                >
                  返回 Dataset Workflow →
                </button>
              </div>
              <p class="mt-0.5 font-normal text-emerald-700/90">回去生成训练数据集吧。</p>
            </div>
          </div>
        </div>

        <div class="min-h-0 flex-1 space-y-2 overflow-y-auto custom-scrollbar p-3">
          <article
            v-for="item in visibleRecordItems"
            :key="item.id"
            class="relative rounded-[0.95rem] border transition hover:z-10"
            :class="item.id === activeRecordId
              ? 'border-[#aebdfc] bg-white shadow-[0_12px_28px_-22px_rgba(91,86,234,0.45)] ring-1 ring-[#aebdfc]/50 z-10'
              : 'border-[#eef2f6] bg-white hover:border-[#d8e0eb]'"
          >
            <button
              type="button"
              class="flex w-full items-start justify-between gap-3 px-3.5 py-3 text-left"
              :aria-expanded="isRecordExpanded(item.id)"
              :title="isRecordExpanded(item.id) ? '收起记录详情' : '展开记录详情'"
              @click="toggleRecordItem(item)"
            >
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-1.5">
                  <span class="text-[11px] font-bold uppercase tracking-[0.16em] text-[#7f90aa]">{{ item.label }}</span>
                  <span
                    class="rounded-md px-1.5 py-0.5 text-[10px] font-semibold"
                    :class="recordBadgeForRecord(item.record, item.status).className"
                  >
                    {{ recordBadgeForRecord(item.record, item.status).label }}
                  </span>
                </div>
                <div class="mt-1">
                  <p class="truncate text-sm font-bold text-slate-900">
                    <span v-if="item.titleIsIonicLiquid" v-html="item.titleHtml" />
                    <span v-else>{{ item.title }}</span>
                  </p>
                  <div
                    v-if="item.titleTooltip"
                    class="mt-2 flex flex-col gap-1.5 border-l-[1.5px] border-[#c7d2fe]/70 pl-2.5"
                  >
                    <div
                      v-for="(part, i) in item.titleTooltip.split(';')"
                      :key="i"
                      class="flex items-baseline"
                    >
                      <template v-if="part.includes('=')">
                        <span class="text-[10px] font-bold text-[#334155]">{{ part.split('=').slice(1).join('=').trim() }}</span>
                      </template>
                      <template v-else-if="part.includes(':')">
                        <span class="w-[4.85rem] shrink-0 text-[9.5px] font-medium leading-4 text-[#64748b]">{{ (part.split(':')[0] || '').trim() }}</span>
                        <div class="mx-1.5 flex-1 border-b-[1.5px] border-dotted border-[#cbd5e1]/60"></div>
                        <span
                          v-if="(part.split(':')[0] || '').trim() === '标准离子形式'"
                          class="min-w-0 text-[10px] font-semibold tabular-nums text-[#0f172a]"
                          v-html="formatIonicLiquidHtml(part.split(':').slice(1).join(':').trim())"
                        />
                        <span v-else class="min-w-0 text-[10px] font-semibold tabular-nums text-[#0f172a]">{{ part.split(':').slice(1).join(':').trim() }}</span>
                      </template>
                      <template v-else>
                        <span class="text-[9.5px] font-medium text-[#64748b]">{{ part.trim() }}</span>
                      </template>
                    </div>
                  </div>
                </div>
                <div v-if="item.probe || item.substrate" class="mt-2.5 flex items-center gap-1.5 rounded-[0.45rem] bg-[#f8fafc] px-2 py-1.5 border border-[#e2e8f0]/60">
                  <div class="flex h-4 w-4 shrink-0 items-center justify-center rounded-[0.25rem] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04)] border border-[#e2e8f0]">
                    <Layers class="h-2.5 w-2.5 text-slate-400" />
                  </div>
                  <div class="flex min-w-0 flex-1 items-center gap-1.5 truncate">
                    <span v-if="item.probe" class="truncate text-[10px] font-bold text-slate-700" title="Probe / Pin">{{ item.probe }}</span>
                    <span v-if="item.probe && item.substrate" class="shrink-0 text-[10px] font-black text-slate-300">/</span>
                    <span v-if="item.substrate" class="truncate text-[10px] font-medium text-slate-500" title="Substrate / Disk">{{ item.substrate }}</span>
                  </div>
                </div>
                <div v-else-if="item.subtitle" class="mt-2.5 flex items-center gap-1.5 rounded-[0.45rem] bg-[#f8fafc] px-2 py-1.5 border border-[#e2e8f0]/60">
                  <div class="flex h-4 w-4 shrink-0 items-center justify-center rounded-[0.25rem] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04)] border border-[#e2e8f0]">
                    <Layers class="h-2.5 w-2.5 text-slate-400" />
                  </div>
                  <p class="truncate text-[10px] font-medium text-slate-600">
                    {{ item.subtitle }}
                  </p>
                </div>
                <p class="mt-1.5 text-xs">
                  <span class="font-bold uppercase tracking-[0.12em] text-[#7f90aa]">{{ item.metricLabel }}</span>
                  <span class="ml-1.5 font-semibold text-slate-900">{{ item.metricValue }}</span>
                </p>
                <div v-if="item.metricTags.length" class="mt-1.5 flex flex-wrap gap-1.5">
                  <span
                    v-for="tag in item.metricTags"
                    :key="`${item.id}-${tag.label}`"
                    class="inline-flex items-center overflow-hidden rounded-[0.45rem] border border-[#dce5ef] bg-white text-[9.5px] shadow-[0_2px_4px_-2px_rgba(0,0,0,0.03)]"
                  >
                    <span class="bg-[#f4f7fb] px-1.5 py-[2px] font-bold text-[#667793] border-r border-[#dce5ef]/60">{{ tag.label }}</span>
                    <span class="px-1.5 py-[2px] font-bold text-[#334155]">{{ tag.value }}</span>
                  </span>
                </div>
              </div>
              <div class="flex shrink-0 flex-col items-end gap-1.5">
                <div
                  class="inline-flex h-7 min-w-[4.75rem] items-center justify-center gap-1 rounded-md border px-2 text-[10px] font-black tabular-nums shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
                  :class="item.confidence.className"
                  :title="item.confidence.title"
                >
                  <Gauge class="h-3 w-3" />
                  <span>{{ item.confidence.percent }}%</span>
                  <span class="opacity-75">{{ item.confidence.label }}</span>
                </div>
                <div class="flex items-start gap-1.5">
                  <button
                    type="button"
                    class="inline-flex h-7 shrink-0 items-center gap-1 rounded-md bg-[#5b56ea] px-2.5 text-[10px] font-bold normal-case tracking-normal text-white transition hover:bg-[#4c47d9] disabled:cursor-not-allowed disabled:bg-[#cfd2f3]"
                    :disabled="!recordCanApprove(item.record, remoteFieldsForRecord(item.record)) || reviewActionPending === `approve:${Number(item.record.id || '')}`"
                    :title="approveActionTitle(item.record, remoteFieldsForRecord(item.record))"
                    @click.stop="handleApproveRecord(item.record)"
                  >
                    <Loader2
                      v-if="reviewActionPending === `approve:${Number(item.record.id || '')}`"
                      class="h-3 w-3 animate-spin"
                    />
                    <CheckCheck v-else class="h-3 w-3" />
                    {{ approveActionLabel(item.record) }}
                  </button>
                  <ChevronDown
                    class="mt-1.5 h-4 w-4 shrink-0 text-slate-400 transition"
                    :class="isRecordExpanded(item.id) ? 'rotate-180 text-[#5b56ea]' : ''"
                  />
                </div>
              </div>
            </button>

            <!-- 展开：字段列表 -->
            <div v-if="isRecordExpanded(item.id)" class="border-t border-[#eef2f6] bg-[#fbfcff] px-3 py-2.5 rounded-b-[0.95rem]">
              <div
                v-if="recordExtractorType(item.record) === 'tribology'"
                class="mb-2"
              >
                <div class="flex items-center justify-between px-1 pb-1.5">
                  <div class="flex items-center gap-1.5">
                    <Layers class="h-3.5 w-3.5 text-[#087443]" />
                    <span class="text-[10px] font-black uppercase tracking-[0.16em] text-[#7f90aa]">TRIBOPAIR</span>
                  </div>
                  <span
                    v-if="!trim(item.record.probe_material) && !trim(item.record.substrate_material)"
                    class="rounded-full bg-[#fff7ed] px-1.5 py-0.5 text-[9px] font-bold text-[#c2410c]"
                  >
                    Legacy
                  </span>
                </div>

                <div class="flex flex-col gap-[1px] overflow-hidden rounded-[0.6rem] border border-[#eef2f6] bg-[#eef2f6]">
                  <button
                    v-for="part in buildTribopairReviewParts(item.record, activeRecordFieldEvidence?.fields)"
                    :key="part.id"
                    type="button"
                    class="group flex min-h-[44px] items-center gap-3 px-3 py-2 text-left transition"
                    :class="[
                      part.highlight ? 'bg-[#fffdf5] hover:bg-[#fff9e6]' : 'bg-[#fbfdff] hover:bg-[#f2f7fd]'
                    ]"
                    :title="`${part.label}: ${part.value}${part.meta ? ' · ' + part.meta : ''} · ${part.sourceLabel}`"
                    @click="activeFieldId = part.fieldId"
                  >
                    <span
                      class="w-[72px] shrink-0 text-[10px] font-black uppercase tracking-[0.11em]"
                      :class="part.highlight ? 'text-[#b45309]' : 'text-[#8fa0ba]'"
                    >
                      {{ part.label }}
                    </span>
                    
                    <div class="flex min-w-0 flex-1 flex-col justify-center">
                      <div class="flex flex-wrap items-center gap-2">
                        <span
                          class="truncate font-bold"
                          :class="[
                            part.value === '未提取' ? 'text-slate-400' : 'text-slate-900',
                            part.highlight ? 'text-[14px] text-[#92400e]' : 'text-xs'
                          ]"
                        >
                          <template v-if="part.id === 'roughness'">
                            <template
                              v-for="(segment, segmentIndex) in roughnessTextParts(part.value)"
                              :key="`roughness-value-${part.id}-${segmentIndex}`"
                            >
                              <template v-if="segment.type === 'rq'">R<sub class="align-sub text-[0.68em] leading-none">q</sub></template>
                              <template v-else>{{ segment.text }}</template>
                            </template>
                          </template>
                          <template v-else>{{ part.value }}</template>
                        </span>
                        
                        <span
                          v-if="part.roughness"
                          role="button"
                          tabindex="0"
                          class="inline-flex shrink-0 items-center gap-1 rounded-[4px] border px-1.5 py-0.5 text-[9px] font-bold transition hover:brightness-95 focus:outline-none focus:ring-2 focus:ring-[#b8c1ff]"
                          :class="roughnessPillClass(part)"
                          :title="`${part.roughnessFieldId === 'probe_roughness' ? 'Probe roughness' : 'Substrate roughness'}: ${part.roughness}${part.roughnessSourceLabel ? ' · ' + part.roughnessSourceLabel : ''}`"
                          @click.stop="activeFieldId = part.roughnessFieldId || part.fieldId"
                          @keydown.enter.stop.prevent="activeFieldId = part.roughnessFieldId || part.fieldId"
                          @keydown.space.stop.prevent="activeFieldId = part.roughnessFieldId || part.fieldId"
                        >
                          <span>
                            <template
                              v-for="(segment, segmentIndex) in roughnessTextParts(part.roughness)"
                              :key="`roughness-pill-${part.id}-${segmentIndex}`"
                            >
                              <template v-if="segment.type === 'rq'">R<sub class="align-sub text-[0.68em] leading-none">q</sub></template>
                              <template v-else>{{ segment.text }}</template>
                            </template>
                          </span>
                          <span v-if="part.roughnessStatusLabel" class="opacity-80">· {{ part.roughnessStatusLabel }}</span>
                        </span>

                        <span
                          class="shrink-0 rounded-[4px] border px-1 py-0.5 text-[8px] font-bold leading-none"
                          :class="part.statusClass"
                        >
                          {{ part.statusLabel }}
                        </span>
                      </div>
                      <div class="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[9.5px] leading-4 text-slate-500">
                        <span v-if="part.meta" class="min-w-0 max-w-full break-words whitespace-normal">{{ part.meta }}</span>
                        <span v-if="part.meta && part.sourceLabel !== '非必填层'" class="text-slate-300">|</span>
                        <span
                          v-if="part.sourceLabel !== '非必填层'"
                          class="min-w-0 max-w-full break-words whitespace-normal"
                          :class="part.highlight ? 'text-[#b45309]/70' : 'text-[#7f90aa]'"
                        >
                          {{ part.sourceLabel }}
                        </span>
                      </div>
                    </div>
                  </button>
                </div>
              </div>

              <p
                v-if="!visibleReviewFields.length"
                class="rounded-[0.6rem] border border-dashed border-[#dbe4f2] bg-white px-3 py-3 text-xs text-slate-500"
              >
                此记录暂无可审核字段。
              </p>
              <div v-else class="space-y-1.5">
                <button
                  v-for="field in visibleReviewFields"
                  :key="field.id"
                  type="button"
                  class="group w-full rounded-[0.7rem] border px-3 py-2 text-left transition"
                  :class="fieldRowTone(field)"
                  @click="activeFieldId = field.id"
                >
                  <div class="flex items-start justify-between gap-2">
                    <div class="min-w-0 flex-1">
                      <div class="flex items-center gap-1.5">
                        <span
                          class="text-[10px] font-bold uppercase tracking-[0.14em]"
                          :class="field.id === activeFieldId ? 'text-[#5b56ea]' : 'text-[#7f90aa]'"
                        >{{ field.label }}</span>
                        <span
                          v-if="field.confidence !== 'High'"
                          class="rounded px-1 py-0.5 text-[9px] font-semibold"
                          :class="field.confidence === 'Low' ? 'bg-[#fff5f6] text-[#cf334f]' : 'bg-[#fff4da] text-[#b97113]'"
                        >
                          置信度{{ confidenceText(field.confidence) }}
                        </span>
                        <span
                          v-if="isFieldFlagged(field)"
                          class="rounded bg-[#fff5f6] px-1 py-0.5 text-[9px] font-semibold text-[#cf334f]"
                        >存疑</span>
                        <span
                          v-if="structuredTagsForField(field, item.record).length && field.locationMode === 'inferred'"
                          class="rounded bg-[#f3f0ff] px-1 py-0.5 text-[9px] font-semibold text-[#6d28d9]"
                        >推断</span>
                        <span
                          v-else-if="structuredTagsForField(field, item.record).length && (field.locationMode === 'source' || field.locationMode === 'record')"
                          class="rounded bg-[#eef2ff] px-1 py-0.5 text-[9px] font-semibold text-[#4f46e5]"
                        >原文来源</span>
                        <span
                          v-else-if="field.evidenceStatus === 'Missing'"
                          class="rounded bg-[#fff5f6] px-1 py-0.5 text-[9px] font-semibold text-[#cf334f]"
                        >缺证据</span>
                        <span
                          v-else-if="field.evidenceStatus === 'Partial'"
                          class="rounded bg-[#fff5f6] px-1 py-0.5 text-[9px] font-semibold text-[#cf334f]"
                        >缺定位</span>
                        <button
                          v-if="field.id === 'cof' && cofStructuredTags(item.record).length"
                          type="button"
                          class="inline-flex h-5 shrink-0 items-center rounded-md border border-[#c7d2fe] bg-white px-1.5 text-[9px] font-bold text-[#4f46e5] transition hover:bg-[#eef2ff]"
                          title="编辑结构化 COF"
                          @click.stop="openCofEditor(item.record)"
                        >
                          {{ isFieldFlagged(field) ? '处理存疑' : '结构化编辑' }}
                        </button>
                        <button
                          v-if="field.id === 'load' && loadStructuredTags(item.record).length"
                          type="button"
                          class="inline-flex h-5 shrink-0 items-center rounded-md border border-[#c7d2fe] bg-white px-1.5 text-[9px] font-bold text-[#4f46e5] transition hover:bg-[#eef2ff]"
                          title="编辑结构化载荷"
                          @click.stop="openLoadEditor(item.record)"
                        >
                          {{ isFieldFlagged(field) ? '处理存疑' : '结构化编辑' }}
                        </button>
                        <button
                          v-if="field.id === 'speed' && speedStructuredTags(item.record).length"
                          type="button"
                          class="inline-flex h-5 shrink-0 items-center rounded-md border border-[#c7d2fe] bg-white px-1.5 text-[9px] font-bold text-[#4f46e5] transition hover:bg-[#eef2ff]"
                          title="编辑结构化速度"
                          @click.stop="openSpeedEditor(item.record)"
                        >
                          {{ isFieldFlagged(field) ? '处理存疑' : '结构化编辑' }}
                        </button>
                        <button
                          v-if="field.id === 'regime' && regimeStructuredTags(item.record).length"
                          type="button"
                          class="inline-flex h-5 shrink-0 items-center rounded-md border border-[#c7d2fe] bg-white px-1.5 text-[9px] font-bold text-[#4f46e5] transition hover:bg-[#eef2ff]"
                          title="编辑结构化测试机制"
                          @click.stop="openSystemEditor(item.record)"
                        >
                          {{ isFieldFlagged(field) ? '处理存疑' : '结构化编辑' }}
                        </button>
                        <button
                          v-if="isFieldFlagged(field) && fieldSupportsFlaggedEditor(field.id, item.record) && !structuredTagsForField(field, item.record).length"
                          type="button"
                          class="inline-flex h-5 shrink-0 items-center rounded-md border border-[#fecdd3] bg-white px-1.5 text-[9px] font-bold text-[#cf334f] transition hover:bg-[#fff5f6]"
                          title="打开结构化编辑处理这个存疑字段"
                          @click.stop="openFlaggedFieldEditor(field.id, item.record)"
                        >
                          处理存疑
                        </button>
                        <button
                          v-if="isFieldFlagged(field)"
                          type="button"
                          class="inline-flex h-5 shrink-0 items-center rounded-md border border-[#dbe4f2] bg-white px-1.5 text-[9px] font-bold text-slate-600 transition hover:bg-[#f8fafc] disabled:cursor-not-allowed disabled:text-slate-300"
                          :disabled="reviewActionPending === `unflag:${Number(item.record.id || '')}:${field.id}`"
                          title="解除存疑状态，回到普通待审核"
                          @click.stop="handleUnflagActiveField(field.id, item.record)"
                        >
                          解除存疑
                        </button>
                      </div>
                      <div v-if="!structuredTagsForField(field, item.record).length">
                        <p
                          class="mt-1 truncate text-sm font-semibold text-slate-900"
                          :title="field.tooltip || presentZh(field.value)"
                        >
                          <span v-if="field.id === 'ionic_liquid'" v-html="formatIonicLiquidHtml(presentZh(field.value))" />
                          <span v-else-if="isRoughnessFieldId(field.id)">
                            <template
                              v-for="(segment, segmentIndex) in roughnessTextParts(field.value)"
                              :key="`roughness-field-${field.id}-${segmentIndex}`"
                            >
                              <template v-if="segment.type === 'rq'">R<sub class="align-sub text-[0.68em] leading-none">q</sub></template>
                              <template v-else>{{ segment.text }}</template>
                            </template>
                          </span>
                          <span v-else>{{ presentZh(field.value) }}</span>
                        </p>
                        <div
                          v-if="field.id === 'ionic_liquid' && reviewIonicLiquidAlias(item.record)"
                          class="mt-1.5 flex min-w-0 flex-wrap items-center gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-[10px] font-semibold text-amber-800"
                          :title="`文献中的 ${reviewIonicLiquidAlias(item.record)} 是样品代号，平台已映射为标准离子形式 ${reviewIonicLiquidDisplay(item.record)}`"
                        >
                          <span class="shrink-0 rounded-[0.3rem] bg-white/80 px-1.5 py-[1px] text-[9px] font-black text-amber-600 shadow-[inset_0_0_0_1px_rgba(251,191,36,0.35)]">文献别名</span>
                          <span class="font-black">{{ reviewIonicLiquidAlias(item.record) }}</span>
                          <span class="text-amber-700/80">已映射为上方标准离子形式</span>
                        </div>
                      </div>
                      <div v-else class="mt-1.5 grid gap-1.5">
                        <div
                          v-for="tag in structuredTagsForField(field, item.record)"
                          :key="`field-${field.id}-${tag.label}`"
                          role="button"
                          tabindex="0"
                          class="group/tag rounded-[0.55rem] border border-[#dce5ef] bg-white px-2 py-1.5 shadow-[0_2px_4px_-2px_rgba(0,0,0,0.03)] transition hover:border-[#b8c1ff] hover:bg-[#fbfcff]"
                          :title="structuredSubfieldTitle(field)"
                          @click.stop="activeFieldId = field.id"
                          @keydown.enter.stop.prevent="activeFieldId = field.id"
                          @keydown.space.stop.prevent="activeFieldId = field.id"
                        >
                          <div class="flex min-w-0 flex-wrap items-center gap-1.5 text-[10px]">
                            <span
                              class="rounded-[0.35rem] bg-[#f4f7fb] px-1.5 py-[2px] font-bold text-[#667793]"
                            >{{ tag.label }}</span>
                            <span class="min-w-0 break-words font-bold tabular-nums text-[#334155]">{{ tag.value }}</span>
                          </div>
                          <p
                            v-if="shouldShowStructuredSubfieldLocation(field)"
                            class="mt-1 truncate text-[9.5px] font-semibold"
                            :class="structuredFieldLocationClass(field)"
                          >
                            定位：{{ structuredFieldLocation(field) }}
                          </p>
                        </div>
                      </div>
                      <p class="mt-1 flex min-w-0 items-center gap-1.5 truncate text-[11px] text-slate-500">
                        <span>来源：</span>
                        <span
                          v-if="field.groundingMode === 'inferred' || field.sourceType === 'inferred'"
                          class="inline-flex shrink-0 rounded-md border border-[#c4b5fd] bg-[#f3f0ff] px-1.5 py-0.5 text-[10px] font-bold text-[#5b21b6]"
                        >
                          推断
                        </span>
                        <span v-else>{{ sourceTypeLabel(field.sourceType) }}</span>
                        <span class="shrink-0 text-slate-300">·</span>
                        <span class="truncate">{{ field.location }}</span>
                      </p>
                      <p
                        v-if="field.issue && field.id === activeFieldId"
                        class="mt-1.5 rounded-[0.4rem] bg-[#fff5f6] px-2 py-1 text-[11px] text-[#cf334f]"
                      >
                        {{ field.issue }}
                      </p>
                    </div>

                    <div
                      class="flex shrink-0 items-center gap-0.5 transition"
                      :class="field.id === activeFieldId ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'"
                    >
                      <button
                        v-if="!isFieldFlagged(field)"
                        type="button"
                        class="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-400 transition hover:bg-[#fff5f6] hover:text-[#cf334f] disabled:cursor-not-allowed disabled:text-slate-300"
                        :disabled="reviewActionPending === `flag:${Number(item.record.id || '')}:${field.id}`"
                        title="标记存疑"
                        @click.stop="handleFlagActiveField(field.id, item.record)"
                      >
                        <Loader2
                          v-if="reviewActionPending === `flag:${Number(item.record.id || '')}:${field.id}`"
                          class="h-3.5 w-3.5 animate-spin"
                        />
                        <Flag v-else class="h-3.5 w-3.5" />
                      </button>
                      <button
                        v-else
                        type="button"
                        class="inline-flex h-7 w-7 items-center justify-center rounded-md text-[#cf334f] transition hover:bg-[#fff5f6] disabled:cursor-not-allowed disabled:text-slate-300"
                        :disabled="reviewActionPending === `unflag:${Number(item.record.id || '')}:${field.id}`"
                        title="解除存疑"
                        @click.stop="handleUnflagActiveField(field.id, item.record)"
                      >
                        <Loader2
                          v-if="reviewActionPending === `unflag:${Number(item.record.id || '')}:${field.id}`"
                          class="h-3.5 w-3.5 animate-spin"
                        />
                        <RefreshCw v-else class="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        class="inline-flex h-7 w-7 items-center justify-center rounded-md transition disabled:cursor-not-allowed disabled:text-slate-300"
                        :class="field.canConfirm
                          ? 'text-[#5b56ea] hover:bg-[#eef2ff]'
                          : ''"
                        :disabled="!field.canConfirm || reviewActionPending === `confirm:${Number(item.record.id || '')}:${field.id}`"
                        title="确认本字段"
                        @click.stop="handleConfirmField(field, item.record)"
                      >
                        <Loader2
                          v-if="reviewActionPending === `confirm:${Number(item.record.id || '')}:${field.id}`"
                          class="h-3.5 w-3.5 animate-spin"
                        />
                        <Check v-else class="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </button>
              </div>

              <!-- 当前字段的原文片段 -->
              <div v-if="evidenceExcerpt" class="mt-3 rounded-[0.7rem] border border-[#f2e5bf] bg-[#fffbf0] p-2.5">
                <p class="text-[10px] font-bold uppercase tracking-[0.16em] text-[#b97113]">原文片段 · {{ activeField?.label }}</p>
                <p class="mt-1.5 font-serif text-[12.5px] leading-6 text-[#4a5568]" v-html="highlightedExcerpt" />
                <div class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-slate-500">
                  <span v-if="activeField?.location">📍 {{ activeField.location }}</span>
                  <span v-if="activeFieldSourceLabel">📑 {{ activeFieldSourceLabel }}</span>
                  <span v-if="evidenceSecondaryValue !== '尚未关联'">🔗 {{ evidenceSecondaryLabel }}：{{ evidenceSecondaryValue }}</span>
                </div>
                <p
                  v-if="activeField?.groundingMode === 'derived' && activeField.groundingNote"
                  class="mt-2 rounded-[0.45rem] border border-[#d8e0ff] bg-[#f5f7ff] px-2 py-1.5 text-[11px] text-[#5061d1]"
                >
                  推导说明：{{ activeField.groundingNote }}
                </p>
              </div>

              <div
                v-if="evidenceImageUrl || evidencePagePreviewUrl"
                class="mt-2.5 grid gap-2"
                :class="evidenceImageUrl && evidencePagePreviewUrl ? 'grid-cols-2' : 'grid-cols-1'"
              >
                <img
                  v-if="evidenceImageUrl"
                  :src="evidenceImageUrl"
                  alt="证据截图"
                  class="max-h-[10rem] w-full rounded-[0.6rem] border border-[#e4e9f2] bg-white object-contain"
                >
                <img
                  v-if="evidencePagePreviewUrl"
                  :src="evidencePagePreviewUrl"
                  alt="所在页预览"
                  class="max-h-[10rem] w-full rounded-[0.6rem] border border-[#e4e9f2] bg-white object-contain"
                >
              </div>
            </div>
          </article>

          <div
            v-if="!visibleRecordCount"
            class="flex min-h-[12rem] flex-col items-center justify-center gap-2 rounded-[0.85rem] border border-dashed border-[#dbe4f2] bg-[#fbfcff] px-4 text-center"
          >
            <FileText class="h-8 w-8 text-slate-300" />
            <p class="text-sm font-semibold text-slate-700">
              {{ recordItemCount ? '当前筛选下无记录' : '尚未选择文献' }}
            </p>
            <p class="text-xs text-slate-500">
              {{ recordItemCount ? '试试关闭筛选条件，或切换其他文献。' : '从左侧选择一篇文献开始审核。' }}
            </p>
          </div>
        </div>
      </aside>
    </div>

    <div
      v-if="cofEditRecord"
      class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 px-4"
      @click.self="closeCofEditor"
    >
      <section class="w-full max-w-2xl overflow-hidden rounded-2xl border border-[#dbe4f2] bg-white shadow-2xl">
        <div class="border-b border-[#eef2f6] px-5 py-4">
          <p class="text-[11px] font-black uppercase tracking-[0.18em] text-[#7f90aa]">结构化 COF 编辑</p>
          <p class="mt-1 text-sm font-semibold text-slate-900">{{ reviewIonicLiquidDisplay(cofEditRecord) }}</p>
          <p class="mt-1 text-xs text-slate-500">把范围、条件节点或拐点写入 JSON 后再确认记录。</p>
        </div>
        <div class="p-5">
          <textarea
            v-model="cofEditJson"
            class="min-h-[18rem] w-full resize-y rounded-xl border border-[#dbe4f2] bg-[#fbfcff] p-3 font-mono text-xs leading-5 text-slate-800 outline-none transition focus:border-[#aebdfc] focus:ring-2 focus:ring-[#dce3ff]"
            spellcheck="false"
          />
          <p v-if="cofEditError" class="mt-2 rounded-lg bg-[#fff5f6] px-3 py-2 text-xs font-semibold text-[#cf334f]">
            {{ cofEditError }}
          </p>
        </div>
        <div class="flex items-center justify-end gap-2 border-t border-[#eef2f6] px-5 py-3">
          <button
            type="button"
            class="rounded-lg border border-[#dbe4f2] px-3 py-2 text-xs font-bold text-slate-600 transition hover:bg-[#f8fafc]"
            @click="closeCofEditor"
          >
            取消
          </button>
          <button
            type="button"
            class="inline-flex items-center gap-1 rounded-lg bg-[#5b56ea] px-3 py-2 text-xs font-bold text-white transition hover:bg-[#4c47d9] disabled:cursor-not-allowed disabled:bg-[#cfd2f3]"
            :disabled="reviewActionPending === `cof-edit:${Number(cofEditRecord?.id || '')}`"
            @click="saveCofEditor"
          >
            <Loader2
              v-if="reviewActionPending === `cof-edit:${Number(cofEditRecord?.id || '')}`"
              class="h-3.5 w-3.5 animate-spin"
            />
            保存结构
          </button>
        </div>
      </section>
    </div>

    <div
      v-if="loadEditRecord"
      class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 px-4"
      @click.self="closeLoadEditor"
    >
      <section class="w-full max-w-xl overflow-hidden rounded-2xl border border-[#dbe4f2] bg-white shadow-2xl">
        <div class="border-b border-[#eef2f6] px-5 py-4">
          <p class="text-[11px] font-black uppercase tracking-[0.18em] text-[#7f90aa]">结构化载荷编辑</p>
          <p class="mt-1 text-sm font-semibold text-slate-900">{{ reviewIonicLiquidDisplay(loadEditRecord) }}</p>
          <p class="mt-1 text-xs text-slate-500">把复合载荷拆成模型可直接读取的 N 单位数值。</p>
        </div>
        <div class="grid gap-3 p-5">
          <label class="grid gap-1.5 text-xs font-bold text-slate-600">
            原始载荷文本
            <input
              v-model="loadEditRawText"
              class="h-10 rounded-lg border border-[#dbe4f2] bg-[#fbfcff] px-3 text-sm font-semibold text-slate-800 outline-none transition focus:border-[#aebdfc] focus:ring-2 focus:ring-[#dce3ff]"
            >
          </label>
          <div class="grid gap-3 sm:grid-cols-2">
            <label class="grid gap-1.5 text-xs font-bold text-slate-600">
              系统载荷
              <div class="flex overflow-hidden rounded-lg border border-[#dbe4f2] bg-[#fbfcff] focus-within:border-[#aebdfc] focus-within:ring-2 focus-within:ring-[#dce3ff]">
                <input
                  v-model="loadEditSystemTotal"
                  inputmode="decimal"
                  class="h-10 min-w-0 flex-1 bg-transparent px-3 text-sm font-semibold text-slate-800 outline-none"
                  placeholder="5"
                >
                <span class="flex items-center border-l border-[#dbe4f2] px-3 text-xs font-black text-[#7f90aa]">N</span>
              </div>
            </label>
            <label class="grid gap-1.5 text-xs font-bold text-slate-600">
              单点载荷
              <div class="flex overflow-hidden rounded-lg border border-[#dbe4f2] bg-[#fbfcff] focus-within:border-[#aebdfc] focus-within:ring-2 focus-within:ring-[#dce3ff]">
                <input
                  v-model="loadEditContactLoad"
                  inputmode="decimal"
                  class="h-10 min-w-0 flex-1 bg-transparent px-3 text-sm font-semibold text-slate-800 outline-none"
                  placeholder="2.36"
                >
                <span class="flex items-center border-l border-[#dbe4f2] px-3 text-xs font-black text-[#7f90aa]">N</span>
              </div>
            </label>
          </div>
          <label class="grid gap-1.5 text-xs font-bold text-slate-600">
            作用对象
            <input
              v-model="loadEditContactUnit"
              class="h-10 rounded-lg border border-[#dbe4f2] bg-[#fbfcff] px-3 text-sm font-semibold text-slate-800 outline-none transition focus:border-[#aebdfc] focus:ring-2 focus:ring-[#dce3ff]"
              placeholder="pin"
            >
          </label>
          <p v-if="loadEditError" class="rounded-lg bg-[#fff5f6] px-3 py-2 text-xs font-semibold text-[#cf334f]">
            {{ loadEditError }}
          </p>
        </div>
        <div class="flex items-center justify-end gap-2 border-t border-[#eef2f6] px-5 py-3">
          <button
            type="button"
            class="rounded-lg border border-[#dbe4f2] px-3 py-2 text-xs font-bold text-slate-600 transition hover:bg-[#f8fafc]"
            @click="closeLoadEditor"
          >
            取消
          </button>
          <button
            type="button"
            class="inline-flex items-center gap-1 rounded-lg bg-[#5b56ea] px-3 py-2 text-xs font-bold text-white transition hover:bg-[#4c47d9] disabled:cursor-not-allowed disabled:bg-[#cfd2f3]"
            :disabled="reviewActionPending === `load-edit:${Number(loadEditRecord?.id || '')}`"
            @click="saveLoadEditor"
          >
            <Loader2
              v-if="reviewActionPending === `load-edit:${Number(loadEditRecord?.id || '')}`"
              class="h-3.5 w-3.5 animate-spin"
            />
            保存结构
          </button>
        </div>
      </section>
    </div>

    <div
      v-if="speedEditRecord"
      class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 px-4"
      @click.self="closeSpeedEditor"
    >
      <section class="w-full max-w-xl overflow-hidden rounded-2xl border border-[#dbe4f2] bg-white shadow-2xl">
        <div class="border-b border-[#eef2f6] px-5 py-4">
          <p class="text-[11px] font-black uppercase tracking-[0.18em] text-[#7f90aa]">结构化速度编辑</p>
          <p class="mt-1 text-sm font-semibold text-slate-900">{{ reviewIonicLiquidDisplay(speedEditRecord) }}</p>
          <p class="mt-1 text-xs text-slate-500">Hz 只表示扫描频率；只有换算后的线速度才会写入滑移速度字段。</p>
        </div>
        <div class="grid gap-3 p-5">
          <label class="grid gap-1.5 text-xs font-bold text-slate-600">
            原始速度/扫描文本
            <input
              v-model="speedEditRawText"
              class="h-10 rounded-lg border border-[#dbe4f2] bg-[#fbfcff] px-3 text-sm font-semibold text-slate-800 outline-none transition focus:border-[#aebdfc] focus:ring-2 focus:ring-[#dce3ff]"
            >
          </label>
          <label class="grid gap-1.5 text-xs font-bold text-slate-600">
            滑移线速度
            <div class="flex overflow-hidden rounded-lg border border-[#dbe4f2] bg-[#fbfcff] focus-within:border-[#aebdfc] focus-within:ring-2 focus-within:ring-[#dce3ff]">
              <input
                v-model="speedEditSliding"
                inputmode="decimal"
                class="h-10 min-w-0 flex-1 bg-transparent px-3 text-sm font-semibold text-slate-800 outline-none"
                placeholder="20"
              >
              <span class="flex items-center border-l border-[#dbe4f2] px-3 text-xs font-black text-[#7f90aa]">μm/s</span>
            </div>
          </label>
          <div class="grid gap-3 sm:grid-cols-2">
            <label class="grid gap-1.5 text-xs font-bold text-slate-600">
              扫描频率
              <div class="flex overflow-hidden rounded-lg border border-[#dbe4f2] bg-[#fbfcff] focus-within:border-[#aebdfc] focus-within:ring-2 focus:ring-[#dce3ff]">
                <input
                  v-model="speedEditRate"
                  inputmode="decimal"
                  class="h-10 min-w-0 flex-1 bg-transparent px-3 text-sm font-semibold text-slate-800 outline-none"
                  placeholder="2"
                >
                <span class="flex items-center border-l border-[#dbe4f2] px-3 text-xs font-black text-[#7f90aa]">Hz</span>
              </div>
            </label>
            <label class="grid gap-1.5 text-xs font-bold text-slate-600">
              单程扫描长度
              <div class="flex overflow-hidden rounded-lg border border-[#dbe4f2] bg-[#fbfcff] focus-within:border-[#aebdfc] focus-within:ring-2 focus:ring-[#dce3ff]">
                <input
                  v-model="speedEditLength"
                  inputmode="decimal"
                  class="h-10 min-w-0 flex-1 bg-transparent px-3 text-sm font-semibold text-slate-800 outline-none"
                  placeholder="5"
                >
                <span class="flex items-center border-l border-[#dbe4f2] px-3 text-xs font-black text-[#7f90aa]">μm</span>
              </div>
            </label>
          </div>
          <p v-if="speedEditError" class="rounded-lg bg-[#fff5f6] px-3 py-2 text-xs font-semibold text-[#cf334f]">
            {{ speedEditError }}
          </p>
        </div>
        <div class="flex items-center justify-end gap-2 border-t border-[#eef2f6] px-5 py-3">
          <button
            type="button"
            class="rounded-lg border border-[#dbe4f2] px-3 py-2 text-xs font-bold text-slate-600 transition hover:bg-[#f8fafc]"
            @click="closeSpeedEditor"
          >
            取消
          </button>
          <button
            type="button"
            class="inline-flex items-center gap-1 rounded-lg bg-[#5b56ea] px-3 py-2 text-xs font-bold text-white transition hover:bg-[#4c47d9] disabled:cursor-not-allowed disabled:bg-[#cfd2f3]"
            :disabled="reviewActionPending === `speed-edit:${Number(speedEditRecord?.id || '')}`"
            @click="saveSpeedEditor"
          >
            <Loader2
              v-if="reviewActionPending === `speed-edit:${Number(speedEditRecord?.id || '')}`"
              class="h-3.5 w-3.5 animate-spin"
            />
            保存结构
          </button>
        </div>
      </section>
    </div>

    <div
      v-if="systemEditRecord"
      class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 px-4"
      @click.self="closeSystemEditor"
    >
      <section class="w-full max-w-xl overflow-hidden rounded-2xl border border-[#dbe4f2] bg-white shadow-2xl">
        <div class="border-b border-[#eef2f6] px-5 py-4">
          <p class="text-[11px] font-black uppercase tracking-[0.18em] text-[#7f90aa]">结构化测试机制编辑</p>
          <p class="mt-1 text-sm font-semibold text-slate-900">{{ reviewIonicLiquidDisplay(systemEditRecord) }}</p>
          <p class="mt-1 text-xs text-slate-500">把摩擦状态和接触几何拆成可枚举特征。</p>
        </div>
        <div class="grid gap-3 p-5">
          <label class="grid gap-1.5 text-xs font-bold text-slate-600">
            原始机制文本
            <input
              v-model="systemEditRawText"
              class="h-10 rounded-lg border border-[#dbe4f2] bg-[#fbfcff] px-3 text-sm font-semibold text-slate-800 outline-none transition focus:border-[#aebdfc] focus:ring-2 focus:ring-[#dce3ff]"
            >
          </label>
          <div class="grid gap-3 sm:grid-cols-2">
            <label class="grid gap-1.5 text-xs font-bold text-slate-600">
              摩擦状态
              <select
                v-model="systemEditFrictionRegime"
                class="h-10 rounded-lg border border-[#dbe4f2] bg-[#fbfcff] px-3 text-sm font-semibold text-slate-800 outline-none transition focus:border-[#aebdfc] focus:ring-2 focus:ring-[#dce3ff]"
              >
                <option value="static">static</option>
                <option value="kinetic">kinetic</option>
                <option value="boundary">boundary</option>
                <option value="mixed">mixed</option>
                <option value="hydrodynamic">hydrodynamic</option>
                <option value="elastohydrodynamic">elastohydrodynamic</option>
                <option value="unstated">unstated</option>
              </select>
            </label>
            <label class="grid gap-1.5 text-xs font-bold text-slate-600">
              接触几何
              <select
                v-model="systemEditContactGeometry"
                class="h-10 rounded-lg border border-[#dbe4f2] bg-[#fbfcff] px-3 text-sm font-semibold text-slate-800 outline-none transition focus:border-[#aebdfc] focus:ring-2 focus:ring-[#dce3ff]"
              >
                <option value="">未指定</option>
                <option value="ball_on_disk">ball_on_disk</option>
                <option value="ball_on_3_pins">ball_on_3_pins</option>
                <option value="ball_on_plate">ball_on_plate</option>
                <option value="pin_on_disk">pin_on_disk</option>
                <option value="four_ball">four_ball</option>
                <option value="afm_colloidal_probe">afm_colloidal_probe</option>
              </select>
            </label>
          </div>
          <label class="grid gap-1.5 text-xs font-bold text-slate-600">
            尺度
            <select
              v-model="systemEditScale"
              class="h-10 rounded-lg border border-[#dbe4f2] bg-[#fbfcff] px-3 text-sm font-semibold text-slate-800 outline-none transition focus:border-[#aebdfc] focus:ring-2 focus:ring-[#dce3ff]"
            >
              <option value="">未指定</option>
              <option value="macroscale">宏观摩擦</option>
              <option value="microscale">微观摩擦</option>
              <option value="nanoscale">纳米摩擦</option>
            </select>
          </label>
          <p v-if="systemEditError" class="rounded-lg bg-[#fff5f6] px-3 py-2 text-xs font-semibold text-[#cf334f]">
            {{ systemEditError }}
          </p>
        </div>
        <div class="flex items-center justify-end gap-2 border-t border-[#eef2f6] px-5 py-3">
          <button
            type="button"
            class="rounded-lg border border-[#dbe4f2] px-3 py-2 text-xs font-bold text-slate-600 transition hover:bg-[#f8fafc]"
            @click="closeSystemEditor"
          >
            取消
          </button>
          <button
            type="button"
            class="inline-flex items-center gap-1 rounded-lg bg-[#5b56ea] px-3 py-2 text-xs font-bold text-white transition hover:bg-[#4c47d9] disabled:cursor-not-allowed disabled:bg-[#cfd2f3]"
            :disabled="reviewActionPending === `system-edit:${Number(systemEditRecord?.id || '')}`"
            @click="saveSystemEditor"
          >
            <Loader2
              v-if="reviewActionPending === `system-edit:${Number(systemEditRecord?.id || '')}`"
              class="h-3.5 w-3.5 animate-spin"
            />
            保存结构
          </button>
        </div>
      </section>
    </div>
  </div>
</template>
