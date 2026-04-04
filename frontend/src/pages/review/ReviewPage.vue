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

import { getRecordEvidence, type BatchFile, type EvidenceResult, type TribologyData, type ValidationStatus } from '@/lib/api'
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
  cof: string
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
    const id = String(record.id || `record-${index + 1}`)
    const lowConfidence = recordLowConfidence(record)
    const missingEvidence = recordNeedsEvidence(record)
    const status: RecordItem['status'] = record.validationStatus === 'verified' && !lowConfidence && !missingEvidence
      ? 'confirmed'
      : lowConfidence || missingEvidence
          ? 'warning'
          : 'review'

    return {
      id,
      label: `Record ${index + 1}`,
      title: present(record.material_name),
      subtitle: present(record.ionic_liquid),
      cof: present(record.cof),
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

const reviewFields = computed<ReviewField[]>(() => buildReviewFields(activeRecord.value))

watch(
  reviewFields,
  (fields) => {
    if (!fields.find((field) => field.id === activeFieldId.value)) {
      activeFieldId.value = fields[0]?.id || 'material'
    }
  },
  { immediate: true },
)

watch(
  [activeRecord, activeLiteratureId],
  async ([record, literatureId]) => {
    const recordId = Number(record?.id || '')
    if (!record || !literatureId || !Number.isFinite(recordId)) {
      activeRecordEvidence.value = null
      return
    }

    const cacheKey = `${literatureId}:${recordId}`
    if (cacheKey in evidenceCache.value) {
      activeRecordEvidence.value = evidenceCache.value[cacheKey] ?? null
      return
    }

    try {
      const evidence = await getRecordEvidence(literatureId, recordId)
      evidenceCache.value[cacheKey] = evidence
      activeRecordEvidence.value = evidence
    } catch {
      evidenceCache.value[cacheKey] = null
      activeRecordEvidence.value = null
    }
  },
  { immediate: true },
)

const activeField = computed(() => reviewFields.value.find((field) => field.id === activeFieldId.value) || reviewFields.value[0] || null)

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

const fieldEvidenceContext = computed(() => buildFieldEvidence(activeRecord.value, activeField.value, activeRecordEvidence.value))
const evidenceExcerpt = computed(() => fieldEvidenceContext.value.excerpt)

const highlightedExcerpt = computed(() => {
  return highlightTerms(evidenceExcerpt.value, fieldEvidenceContext.value.specs)
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
const activeFieldDisplayLabel = computed(() => activeField.value?.label.toUpperCase() || 'NO FIELD SELECTED')
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

function hasTextEvidence(record: TribologyData | null | undefined) {
  if (!record) return false
  return Boolean(trim(record.evidence) || trim(record.notes) || trim(record.source))
}

function recordNeedsEvidence(record: TribologyData) {
  return !record.source_page && !trim(record.source_figure) && !hasTextEvidence(record)
}

function recordNeedsReview(record: TribologyData) {
  return record.validationStatus !== 'verified'
}

function recordLowConfidence(record: TribologyData) {
  const missingCore = !trim(record.material_name) || !trim(record.ionic_liquid) || !trim(record.cof)
  return record.validationStatus === 'warning' || missingCore
}

function summarizeConditions(record: TribologyData) {
  const parts = [record.load, record.speed, record.temperature].map((item) => trim(item)).filter(Boolean)
  return parts.length ? parts.join(' | ') : 'Not captured yet'
}

function inferSourceType(record: TribologyData): ReviewField['sourceType'] {
  const sourceText = [record.source, record.evidence, record.notes].map((item) => trim(item).toLowerCase()).join(' ')
  if (trim(record.source_figure)) return 'figure'
  if (sourceText.includes('table')) return 'table'
  if (hasTextEvidence(record)) return 'text'
  return 'inferred'
}

function evidenceLocation(record: TribologyData) {
  if (record.source_page && trim(record.source_figure)) return `Page ${record.source_page} | ${record.source_figure}`
  if (record.source_page) return `Page ${record.source_page}`
  if (trim(record.source_figure)) return `Figure ${trim(record.source_figure)}`
  return `Scope ${props.activeScopeLabel}`
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

  const specs = new Map<string, EvidenceSearchSpec>()
  const cleanValue = trim(field.value)

  if (cleanValue && cleanValue !== 'Not captured yet') {
    addEvidenceSpec(specs, cleanValue, field.id === 'cof' ? 'numeric' : 'loose')
  }

  if (field.id === 'conditions') {
    ;[record.load, record.speed, record.temperature]
      .map((item) => trim(item))
      .filter(Boolean)
      .forEach((item) => addEvidenceSpec(specs, item, 'loose'))
  }

  if (field.id === 'material') {
    const material = trim(record.material_name)
    if (material) addEvidenceSpec(specs, material, 'loose')
  }

  if (field.id === 'ionic-liquid') {
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

  if (field.id === 'source-page') {
    if (record.source_page) addEvidenceSpec(specs, `Page ${record.source_page}`, 'loose')
    if (trim(record.source_figure)) addEvidenceSpec(specs, trim(record.source_figure), 'loose')
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
  if (field.id === 'ionic-liquid') return ['ionic_liquid', 'lubricant', 'cation', 'anion']
  if (field.id === 'cof') return ['cof', 'friction_coefficient']
  if (field.id === 'conditions') return ['load', 'speed', 'temperature', 'condition']
  if (field.id === 'source-page') return ['source_page', 'figure', 'table']
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

function buildFieldEvidence(record: TribologyData | null, field: ReviewField | null, evidence: EvidenceResult | null) {
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

function evidenceStatus(record: TribologyData, value: string): ReviewField['evidenceStatus'] {
  if (!trim(value)) return 'Missing'
  if (record.source_page || trim(record.source_figure)) return 'Grounded'
  if (hasTextEvidence(record)) return 'Partial'
  return 'Missing'
}

function fieldStatus(record: TribologyData, value: string): ReviewField['status'] {
  if (!trim(value)) return 'low_conf'
  if (record.validationStatus === 'verified' && evidenceStatus(record, value) === 'Grounded') return 'confirmed'
  if (record.validationStatus === 'warning' || evidenceStatus(record, value) === 'Missing') return 'low_conf'
  return 'review'
}

function buildField(label: string, id: string, rawValue: string, record: TribologyData, issueMessage?: string): ReviewField {
  const value = rawValue
  const status = fieldStatus(record, value)

  return {
    id,
    label,
    value,
    status,
    confidence: confidenceLabel(record.validationStatus, value),
    evidenceStatus: evidenceStatus(record, value),
    sourceType: inferSourceType(record),
    location: evidenceLocation(record),
    issue: status === 'low_conf' ? issueMessage : undefined,
  }
}

function buildReviewFields(record: TribologyData | null): ReviewField[] {
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
        issue: 'No extracted record is attached to this literature file yet.',
      },
    ]
  }

  return [
    buildField('Material', 'material', present(record.material_name), record, 'Material still needs grounding confirmation.'),
    buildField('Ionic Liquid', 'ionic-liquid', present(record.ionic_liquid), record, 'Ionic liquid still needs grounding confirmation.'),
    buildField('COF', 'cof', present(record.cof), record, 'COF still needs grounding confirmation.'),
    buildField('Test Conditions', 'conditions', summarizeConditions(record), record, 'Load, speed, or temperature still need confirmation.'),
    buildField('Source Page', 'source-page', record.source_page ? `Page ${record.source_page}` : 'Not captured yet', record, 'No grounded page was attached to this record.'),
  ]
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
              <button type="button" class="inline-flex items-center gap-2 rounded-[0.85rem] border border-[#d9e2ef] bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-[#f8fbff]">
                <Flag class="h-4 w-4" />
                Escalate
              </button>
              <button type="button" class="inline-flex items-center gap-2 rounded-[0.85rem] bg-[#5b56ea] px-5 py-2.5 text-sm font-semibold text-white shadow-[0_18px_36px_-24px_rgba(91,86,234,0.85)] transition hover:bg-[#4c47d9]">
                <CheckCheck class="h-4 w-4" />
                Approve All
              </button>
            </div>
          </div>
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
                  <span class="font-medium">COF</span> {{ item.cof }}
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
                  <button type="button" class="inline-flex h-8 w-8 items-center justify-center rounded-[0.6rem] transition hover:bg-slate-100 hover:text-slate-700">
                    <Flag class="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    class="ml-1 inline-flex items-center rounded-[0.75rem] border px-3.5 py-2 text-sm font-bold uppercase tracking-[0.12em] transition"
                    :class="field.id === activeFieldId ? 'border-[#5b56ea] bg-[#5b56ea] text-white hover:bg-[#4c47d9]' : 'border-[#dbe2eb] bg-white text-slate-500 hover:border-[#cdd5e2] hover:text-slate-700'"
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
