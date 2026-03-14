<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  searchRecords,
  getFilterOptions,
  updateTribologyRecord,
  promoteTribologyRecordConfidence,
  deleteTribologyRecord,
  getRecordEvidence,
  formatTribopairLabel,
  type SearchFilter,
  type RecordResponse,
  type PaginatedRecordResponse,
  type EvidenceResult,
} from '@/lib/api'
import type {
  EvidenceSnippet as InteractiveEvidenceSnippet,
  EvidenceTagType as InteractiveEvidenceTagType,
  RowData as InteractiveEvidenceRow,
} from '@/components/InteractiveEvidencePanel'
import {
  Search,
  Trash2,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  BookOpen,
  Save,
  ExternalLink,
  Eye,
  Edit,
  Download,
  ShieldCheck,
  Flag,
  MinusCircle,
  PlusCircle,
  ArrowUp,
  ArrowDown
} from 'lucide-vue-next'
import Modal from '@/components/ui/Modal.vue'
import InteractiveEvidencePanelHost from '@/components/InteractiveEvidencePanelHost.vue'
import PdfViewerWithHighlight from '@/components/PdfViewerWithHighlight.vue'
import MoleculeViewer from '@/components/MoleculeViewer.vue'
import type { HighlightRect } from '@/types/pdf-highlight'

const props = defineProps<{
  initialDoi?: string
  sourceName?: string
  literatureMetadata?: any
  selectedFileId?: string | null
}>()

const emit = defineEmits<{
  'view-literature': []
  'clear-doi': []
}>()

const PAGE_SIZE = 10

const loading = ref(false)
const savingRowId = ref<number | null>(null)
const deletingRowId = ref<number | null>(null)

const result = ref<PaginatedRecordResponse>({
  total: 0,
  skip: 0,
  limit: PAGE_SIZE,
  items: [],
})

const filterOptions = ref<{ materials: string[]; lubricants: string[] }>({
  materials: [],
  lubricants: [],
})

const selectedLubricant = ref('')
const selectedMaterial = ref('')
const searchDoi = ref(props.initialDoi || '')
const cofMin = ref('')
const cofMax = ref('')

const currentPage = ref(1)
const activeConfidencePopoverId = ref<number | null>(null)
const evidenceModalRecord = ref<RecordResponse | null>(null)
const editDrawerRecord = ref<RecordResponse | null>(null)
const showExportMenu = ref(false)
const exporting = ref(false)
type ExportFormat = 'json' | 'csv' | 'ndjson'
type EditableRecordValues = {
  lubricant: string
  temperature: string
  potential: string
  waterContent: string
  speedValue: string
  loadValue: string
  probeMaterial: string
  probeGeometry: string
  probeRadius: string
  probeRoughness: string
  substrateMaterial: string
  substrateCoating: string
  substrateRoughness: string
  filmThickness: string
  cof: string
}

const editingValues = ref<Record<number, EditableRecordValues>>({})
const parameterEditorOpen = ref<Record<number, boolean>>({})
const confidenceCardOpen = ref<Record<number, boolean>>({})
const evidenceData = ref<Record<number, EvidenceResult | null>>({})
const evidenceLoading = ref<Record<number, boolean>>({})
const evidenceError = ref<Record<number, string | null>>({})
const confidenceSyncing = ref<Record<number, boolean>>({})
const imagePreview = ref<{
  open: boolean
  src: string
  title: string
  scale: number
}>({
  open: false,
  src: '',
  title: '',
  scale: 1,
})
const structurePreview = ref<{
  open: boolean
  rowId: number | null
  title: string
  cationSmiles: string | null
  anionSmiles: string | null
  cationLabel: string
  anionLabel: string
}>({
  open: false,
  rowId: null,
  title: '',
  cationSmiles: null,
  anionSmiles: null,
  cationLabel: 'Cation',
  anionLabel: 'Anion',
})
type EvidenceTermHit = {
  term: string
  page: number
  bbox: number[]
  matched_text?: string | null
  inferred?: boolean
}
type ConfidenceLineItem = {
  reason: string
  value: number
}
type ConfidenceDetailsView = {
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
const pdfLocate = ref<{
  open: boolean
  title: string
  pdfUrl: string
  highlights: HighlightRect[]
  activeHighlightId: string | null
  notice: string
}>({
  open: false,
  title: '',
  pdfUrl: '',
  highlights: [],
  activeHighlightId: null,
  notice: '',
})

const totalPages = computed(() => Math.max(1, Math.ceil(result.value.total / PAGE_SIZE)))
const activeEvidenceRow = computed<InteractiveEvidenceRow | null>(() => {
  if (!evidenceModalRecord.value) return null
  return buildInteractiveEvidenceRow(evidenceModalRecord.value)
})
const activeEditValues = computed<EditableRecordValues | null>(() => {
  if (!editDrawerRecord.value) return null
  return editingValues.value[editDrawerRecord.value.id] ?? null
})

const rangeStart = computed(() => (result.value.total === 0 ? 0 : result.value.skip + 1))
const rangeEnd = computed(() => Math.min(result.value.skip + PAGE_SIZE, result.value.total))

type ConditionGroupTone = 'env' | 'dyn' | 'surf'

type ConditionGroup = {
  key: ConditionGroupTone
  label: string
  summary: string
  title: string
}

function cofDisplay(record: RecordResponse): string {
  if (record.cofValue != null && !isNaN(Number(record.cofValue))) {
    return Number(record.cofValue).toFixed(4)
  }
  if (record.cofRaw) return record.cofRaw
  return '--'
}

function confidenceDisplay(conf: number | null | undefined): string {
  if (conf == null || Number.isNaN(Number(conf))) return '--'
  const pct = Math.max(0, Math.min(100, Number(conf) * 100))
  return `${pct.toFixed(1)}%`
}

function confidencePenaltyLabel(reason: string): string {
  const labels: Record<string, string> = {
    missing_lubricant: 'Missing ionic liquid',
    unknown_lubricant: 'Unresolved ionic liquid',
    missing_material: 'Missing tribopair material',
    unknown_material: 'Unresolved tribopair material',
    missing_cof: 'Missing COF value',
    cof_uncertain: 'Uncertain COF notation',
    cof_out_of_range: 'COF out of physical range',
    missing_source: 'Missing source label',
    missing_source_page: 'Missing page grounding',
    missing_evidence: 'Missing evidence quote or bbox',
    panel_mismatch: 'Figure panel mismatch',
    sparse_conditions: 'Sparse experiment conditions',
    model_inferred: 'Model-inferred condition',
  }
  return labels[reason] || reason.replace(/_/g, ' ')
}

function confidencePenaltyValue(value: number | null | undefined): string {
  if (value == null || Number.isNaN(Number(value))) return '--'
  return `-${(Number(value) * 100).toFixed(0)} pts`
}

function confidenceBoostLabel(reason: string): string {
  const labels: Record<string, string> = {
    source_labeled: 'Specific source label present',
    page_grounded: 'Page-level grounding',
    evidence_quote_present: 'Evidence quote present',
    grounded_bbox: 'Grounded bounding box',
    panel_level_grounding: 'Panel-level figure grounding',
    rich_conditions: 'Rich experiment conditions',
  }
  return labels[reason] || reason.replace(/_/g, ' ')
}

function confidenceBoostValue(value: number | null | undefined): string {
  if (value == null || Number.isNaN(Number(value))) return '--'
  return `+${(Number(value) * 100).toFixed(0)} pts`
}

function confidencePercentNumber(conf: number | null | undefined): number {
  if (conf == null || Number.isNaN(Number(conf))) return 0
  return Math.max(0, Math.min(100, Number(conf) * 100))
}

function hasEvidenceText(value: string | null | undefined): boolean {
  return !!String(value || '').trim()
}

function hasEvidenceBBox(value: number[] | string | null | undefined): boolean {
  if (Array.isArray(value)) return value.length === 4
  return !!String(value || '').trim()
}

function normalizeConfidenceDetails(details?: RecordResponse['confidenceDetails'] | null): ConfidenceDetailsView {
  const penalties = Array.isArray(details?.penalties) ? details!.penalties.map((p) => ({ reason: p.reason, value: Number(p.value) || 0 })) : []
  const boosts = Array.isArray(details?.boosts) ? details!.boosts.map((b) => ({ reason: b.reason, value: Number(b.value) || 0 })) : []
  const baseScore = Number(details?.base_score ?? 1)
  const penaltyTotal = penalties.reduce((sum, item) => sum + item.value, 0)
  const boostTotal = boosts.reduce((sum, item) => sum + item.value, 0)
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

function confidenceDetailsFor(record: RecordResponse): ConfidenceDetailsView {
  const base = normalizeConfidenceDetails(record.confidenceDetails)
  const ev = evidenceData.value[record.id]
  if (!ev) return base

  const hasSource = !!String(ev.source || record.source || record.sourceFigure || '').trim()
  const hasPage = !!(ev.page || record.sourcePage || record.evidencePage)
  const hasGroundedEvidence =
    hasEvidenceText(ev.text_snippet) ||
    hasEvidenceText(ev.evidence_text) ||
    hasEvidenceText(record.evidence) ||
    hasEvidenceBBox(ev.bbox) ||
    hasEvidenceBBox(record.evidenceBbox)

  const filteredPenalties = base.penalties.filter((penalty) => {
    if (penalty.reason === 'missing_source' && hasSource) return false
    if (penalty.reason === 'missing_source_page' && hasPage) return false
    if (penalty.reason === 'missing_evidence' && hasGroundedEvidence) return false
    return true
  })

  return normalizeConfidenceDetails({
    ...base,
    penalties: filteredPenalties,
    penalty_total: filteredPenalties.reduce((sum, item) => sum + item.value, 0),
    penalty_percent: filteredPenalties.reduce((sum, item) => sum + item.value, 0) * 100,
  })
}

function confidenceValueFor(record: RecordResponse): number {
  return confidenceDetailsFor(record).score
}

function confidenceDeltaPercent(record: RecordResponse): number {
  return Number(((confidenceValueFor(record) - Number(record.confidence || 0)) * 100).toFixed(1))
}

function promoteRecordConfidence(record: RecordResponse) {
  const liveDetails = confidenceDetailsFor(record)
  const storedScore = Number(record.confidence || 0)
  if (liveDetails.score > storedScore) {
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
  }
}

async function persistPromotedConfidence(record: RecordResponse, previousStoredScore?: number) {
  const ev = evidenceData.value[record.id]
  if (!ev || confidenceSyncing.value[record.id]) return

  const liveDetails = confidenceDetailsFor(record)
  const storedScore = Number(previousStoredScore ?? record.confidence ?? 0)
  if (liveDetails.score <= storedScore) return

  confidenceSyncing.value[record.id] = true
  try {
    const resp = await promoteTribologyRecordConfidence(record.id, {
      confidence: liveDetails.score,
      evidence: ev.text_snippet || ev.evidence_text || record.evidence,
      evidencePage: ev.page ?? record.evidencePage ?? record.sourcePage ?? null,
      evidenceBbox: ev.bbox?.length === 4 ? JSON.stringify(ev.bbox) : (record.evidenceBbox || null),
      source: ev.source || record.source,
      sourcePage: ev.page ?? record.sourcePage ?? null,
      sourceFigure: record.sourceFigure || (String(ev.source || '').match(/fig/i) ? String(ev.source) : null),
    })
    if (typeof resp?.confidence === 'number') {
      record.confidence = resp.confidence
    }
    if (resp?.confidenceDetails) {
      record.confidenceDetails = resp.confidenceDetails
    }
  } catch (err) {
    console.error('Failed to persist promoted confidence', err)
  } finally {
    confidenceSyncing.value[record.id] = false
  }
}

function conditionGroupClass(key: ConditionGroupTone): string {
  if (key === 'env') {
    return 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-300'
  }
  if (key === 'dyn') {
    return 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-500/25 dark:bg-blue-500/10 dark:text-blue-300'
  }
  return 'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300'
}

function summarizeConditionGroup(items: string[], maxItems: number = 2): string {
  if (!items.length) return ''
  const compact = items.slice(0, maxItems).join(' · ')
  const remaining = items.length - maxItems
  return remaining > 0 ? `${compact} · +${remaining}` : compact
}

function conditionGroups(record: RecordResponse): ConditionGroup[] {
  const groups: ConditionGroup[] = []

  const envItems = [
    record.temperature ? `${record.temperature}` : '',
    record.waterContent ? `${record.waterContent}` : '',
    record.potential ? `${record.potential}` : '',
  ].filter(Boolean)

  const dynItems = [
    record.speedValue ? `${record.speedValue}` : '',
    record.loadValue ? `${record.loadValue}` : '',
  ].filter(Boolean)

  const filmRaw = String(record.filmThickness || '').trim()
  const filmValue = filmRaw ? filmRaw.replace(/\([A-Za-z0-9-]+\)/g, '').trim() || filmRaw : ''
  const surfItems = [
    record.probeGeometry ? `${record.probeGeometry}` : '',
    record.probeRadius ? `${record.probeRadius}` : '',
    record.probeRoughness ? `Probe ${record.probeRoughness}` : '',
    record.substrateCoating ? `${record.substrateCoating}` : '',
    record.substrateRoughness ? `Sub ${record.substrateRoughness}` : '',
    filmValue ? `Film ${filmValue}` : '',
  ].filter(Boolean)

  if (envItems.length) {
    groups.push({
      key: 'env',
      label: 'ENV',
      summary: summarizeConditionGroup(envItems, 2),
      title: envItems.join(' · '),
    })
  }

  if (dynItems.length) {
    groups.push({
      key: 'dyn',
      label: 'DYN',
      summary: summarizeConditionGroup(dynItems, 2),
      title: dynItems.join(' · '),
    })
  }

  if (surfItems.length) {
    groups.push({
      key: 'surf',
      label: 'SURF',
      summary: summarizeConditionGroup(surfItems, 2),
      title: surfItems.join(' · '),
    })
  }

  return groups
}

function normalizeOptionalTagValue(value: string | null | undefined): string {
  const normalized = String(value || '').trim()
  if (!normalized) return ''
  if (['none', 'null', 'n/a', 'na', '-'].includes(normalized.toLowerCase())) return ''
  return normalized
}

function tribopairParts(record: RecordResponse): { probe: string, substrate: string, coating: string } {
  return {
    probe: String(record.probeMaterial || '').trim() || 'Probe N/A',
    substrate: String(record.substrateMaterial || record.materialName || '').trim() || 'Substrate N/A',
    coating: normalizeOptionalTagValue(record.substrateCoating),
  }
}

function tribopairDisplay(record: RecordResponse): string {
  return formatTribopairLabel({
    probeMaterial: record.probeMaterial,
    substrateMaterial: record.substrateMaterial,
    substrateCoating: record.substrateCoating,
    materialName: record.materialName,
  })
}

function ensureEditingValues(record: RecordResponse) {
  if (!editingValues.value[record.id]) {
    editingValues.value[record.id] = {
      lubricant: record.lubricant ?? '',
      temperature: record.temperature ?? '',
      potential: record.potential ?? '',
      waterContent: record.waterContent ?? '',
      speedValue: record.speedValue ?? '',
      loadValue: record.loadValue ?? '',
      probeMaterial: record.probeMaterial ?? '',
      probeGeometry: record.probeGeometry ?? '',
      probeRadius: record.probeRadius ?? '',
      probeRoughness: record.probeRoughness ?? '',
      substrateMaterial: record.substrateMaterial ?? record.materialName ?? '',
      substrateCoating: record.substrateCoating ?? '',
      substrateRoughness: record.substrateRoughness ?? record.surfaceRoughness ?? '',
      filmThickness: record.filmThickness ?? '',
      cof: record.cofRaw ?? (record.cofValue != null ? String(record.cofValue) : ''),
    }
  }
}

function openEvidenceModal(record: RecordResponse) {
  editDrawerRecord.value = null
  evidenceModalRecord.value = record
  fetchEvidence(record)
}

function closeEvidenceModal() {
  evidenceModalRecord.value = null
}

function openEditModal(record: RecordResponse) {
  ensureEditingValues(record)
  evidenceModalRecord.value = null
  editDrawerRecord.value = record
}

function closeEditDrawer() {
  editDrawerRecord.value = null
}

function updateActiveEditingField(field: keyof EditableRecordValues, value: string) {
  if (!editDrawerRecord.value) return
  updateEditingField(editDrawerRecord.value.id, field, value)
}

function saveActiveEditRecord() {
  if (!editDrawerRecord.value) return
  saveRecord(editDrawerRecord.value)
}

function isSavingActiveEditRecord(): boolean {
  return !!editDrawerRecord.value && savingRowId.value === editDrawerRecord.value.id
}

function openStructurePreview(record: RecordResponse) {
  structurePreview.value = {
    open: true,
    rowId: record.id,
    title: record.lubricant || 'Chemical Structure',
    cationSmiles: record.cationSmiles || null,
    anionSmiles: record.anionSmiles || null,
    cationLabel: record.cation ? `Cation: ${record.cation}` : 'Cation',
    anionLabel: record.anion ? `Anion: ${record.anion}` : 'Anion',
  }
}

function closeStructurePreview() {
  structurePreview.value.open = false
  structurePreview.value.rowId = null
}

function updateEditingField(recordId: number, field: keyof EditableRecordValues, value: string) {
  const target = editingValues.value[recordId]
  if (!target) return
  target[field] = value
}

function toggleConfidencePopover(recordId: number) {
  activeConfidencePopoverId.value = activeConfidencePopoverId.value === recordId ? null : recordId
}

function isParameterEditorOpen(recordId: number): boolean {
  return Boolean(parameterEditorOpen.value[recordId])
}

function toggleParameterEditor(recordId: number) {
  parameterEditorOpen.value[recordId] = !parameterEditorOpen.value[recordId]
}

function isConfidenceCardOpen(recordId: number): boolean {
  return Boolean(confidenceCardOpen.value[recordId])
}

function toggleConfidenceCard(recordId: number) {
  confidenceCardOpen.value[recordId] = !confidenceCardOpen.value[recordId]
}

function evidenceImageSrc(recordId: number): string | null {
  const ev = evidenceData.value[recordId]
  if (!ev?.image_b64) return null
  return `data:image/png;base64,${ev.image_b64}`
}

function evidencePagePreviewSrc(recordId: number): string | null {
  const ev = evidenceData.value[recordId]
  if (!ev?.page_preview_b64) return null
  return `data:image/png;base64,${ev.page_preview_b64}`
}

function firstNonEmpty(...values: Array<string | null | undefined>): string | undefined {
  for (const value of values) {
    const normalized = String(value || '').trim()
    if (normalized) return normalized
  }
  return undefined
}

function normalizeEvidencePage(...values: Array<number | null | undefined>): number {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      return Math.max(1, Math.floor(value))
    }
  }
  return 1
}

function buildInteractiveEvidenceSnippet(
  record: RecordResponse,
  section: string,
  target: string | null | undefined,
  options?: {
    fallbackPage?: number | null
    preferImage?: boolean
  },
): InteractiveEvidenceSnippet | undefined {
  const ev = evidenceData.value[record.id]
  const normalizedTarget = firstNonEmpty(target)
  const hit = normalizedTarget ? findBestTermHit(ev, normalizedTarget) : null
  const page = normalizeEvidencePage(hit?.page, options?.fallbackPage, ev?.page, record.evidencePage, record.sourcePage)
  const text = firstNonEmpty(ev?.text_snippet, ev?.evidence_text, record.evidence)
  const previewSrc = evidencePagePreviewSrc(record.id) || evidenceImageSrc(record.id)
  const shouldUseImage = Boolean(options?.preferImage && previewSrc && isVisualEvidenceSource(ev))

  if (shouldUseImage) {
    return {
      page,
      section,
      type: 'image',
      target: normalizedTarget,
      imageUrl: previewSrc || undefined,
      boundingBox: hit?.bbox || ev?.bbox || undefined,
    }
  }

  if (!text || !normalizedTarget) return undefined

  return {
    page,
    section,
    type: 'text',
    text,
    target: normalizedTarget,
  }
}

function buildInteractiveEvidenceRow(record: RecordResponse): InteractiveEvidenceRow | null {
  const ev = evidenceData.value[record.id]
  const primaryPage = normalizeEvidencePage(ev?.page, record.evidencePage, record.sourcePage)
  const cofTarget = firstNonEmpty(record.cofRaw, record.cofValue != null ? String(record.cofValue) : undefined)
  const cof =
    buildInteractiveEvidenceSnippet(record, firstNonEmpty(ev?.source, record.sourceFigure, 'Primary evidence') || 'Primary evidence', cofTarget, {
      fallbackPage: primaryPage,
      preferImage: true,
    }) ||
    buildInteractiveEvidenceSnippet(record, 'Primary evidence', cofTarget, {
      fallbackPage: primaryPage,
    })

  if (!cof) return null

  const ionicLiquid = buildInteractiveEvidenceSnippet(record, 'Ionic liquid', record.lubricant, {
    fallbackPage: primaryPage,
  })
  const surface = buildInteractiveEvidenceSnippet(
    record,
    'Surface / substrate',
    firstNonEmpty(record.substrateMaterial, record.substrateCoating, record.materialName),
    { fallbackPage: primaryPage },
  )
  const condition = buildInteractiveEvidenceSnippet(
    record,
    'Condition',
    firstNonEmpty(record.potential, record.waterContent, record.speedValue, record.loadValue),
    { fallbackPage: primaryPage },
  )
  const temperature = buildInteractiveEvidenceSnippet(record, 'Temperature', record.temperature, {
    fallbackPage: primaryPage,
  })

  return {
    id: record.id,
    evidenceType: 'multi-snippet',
    evidenceMap: {
      cof,
      ionicLiquid,
      surface,
      condition,
      temperature,
    },
    highlight:
      firstNonEmpty(record.evidence, ev?.text_snippet, ev?.evidence_text, ev?.source, record.sourceFigure)
      || 'Source-grounded evidence synthesized from the current record.',
  }
}

function interactiveEvidenceHighlightColor(tag: InteractiveEvidenceTagType): string {
  if (tag === 'ionicLiquid') return 'rgba(99, 102, 241, 0.35)'
  if (tag === 'surface') return 'rgba(249, 115, 22, 0.35)'
  if (tag === 'condition') return 'rgba(16, 185, 129, 0.35)'
  if (tag === 'temperature') return 'rgba(244, 63, 94, 0.35)'
  return 'rgba(59, 130, 246, 0.35)'
}

function openInteractiveEvidencePdf(
  record: RecordResponse,
  payload: {
    page: number
    snippet: InteractiveEvidenceSnippet
    activeTag: InteractiveEvidenceTagType
  },
) {
  if (!record.literatureId) return

  const highlight =
    buildHighlightRect(
      `${record.id}-${payload.activeTag}-${Date.now()}`,
      payload.page,
      payload.snippet.boundingBox,
      interactiveEvidenceHighlightColor(payload.activeTag),
    ) ||
    buildPageAnchorHighlight(
      `${record.id}-${payload.activeTag}-page-${payload.page}-${Date.now()}`,
      payload.page,
      interactiveEvidenceHighlightColor(payload.activeTag),
    )

  pdfLocate.value.open = true
  pdfLocate.value.title = `Evidence Locator · ${payload.activeTag} · Page ${payload.page}`
  pdfLocate.value.pdfUrl = `/api/pdf/${record.literatureId}`
  pdfLocate.value.highlights = [highlight]
  pdfLocate.value.activeHighlightId = highlight.id
  pdfLocate.value.notice =
    payload.activeTag !== 'cof' && payload.page !== normalizeEvidencePage(evidenceData.value[record.id]?.page, record.evidencePage, record.sourcePage)
      ? `Cross-page evidence jump: ${payload.activeTag} is grounded on page ${payload.page}.`
      : ''
}

function handleEvidenceModalPdfOpen(payload: {
  page: number
  snippet: InteractiveEvidenceSnippet
  activeTag: InteractiveEvidenceTagType
}) {
  if (!evidenceModalRecord.value) return
  openInteractiveEvidencePdf(evidenceModalRecord.value, payload)
}

function openImagePreview(src: string, title: string) {
  imagePreview.value = {
    open: true,
    src,
    title,
    scale: 1,
  }
}

function closeImagePreview() {
  imagePreview.value.open = false
}

function zoomInPreview() {
  imagePreview.value.scale = Math.min(4, Number((imagePreview.value.scale + 0.2).toFixed(2)))
}

function zoomOutPreview() {
  imagePreview.value.scale = Math.max(0.5, Number((imagePreview.value.scale - 0.2).toFixed(2)))
}

function resetPreviewZoom() {
  imagePreview.value.scale = 1
}

function onPreviewWheel(e: WheelEvent) {
  if (!imagePreview.value.open) return
  if (e.deltaY < 0) {
    zoomInPreview()
  } else {
    zoomOutPreview()
  }
}

function onGlobalKeydown(e: KeyboardEvent) {
  if (e.key !== 'Escape') return
  if (showExportMenu.value) showExportMenu.value = false
  if (imagePreview.value.open) closeImagePreview()
  if (structurePreview.value.open) closeStructurePreview()
  if (pdfLocate.value.open) closePdfLocate()
  if (editDrawerRecord.value) closeEditDrawer()
}

function normalizeTermKey(input: string): string {
  return String(input || '')
    .toLowerCase()
    .replace(/[\u03bc\u00b5]/g, 'u')
    .replace(/μ/g, 'u')
    .replace(/[^a-z0-9]/g, '')
    .replace(/\s+/g, '')
    .replace(/[()=:,.;]/g, '')
}

function normalizeIlCationToken(input: string): string {
  const token = String(input || '').toLowerCase().replace(/[^a-z0-9]/g, '')
  if (!token) return ''
  if (/^p\d+$/.test(token)) return token
  if (token === '1ethyl3methylimidazolium' || token === 'ethyl3methylimidazolium') return 'emim'
  if (token === '1butyl3methylimidazolium' || token === 'butyl3methylimidazolium') return 'bmim'
  if (token === '1hexyl3methylimidazolium' || token === 'hexyl3methylimidazolium') return 'hmim'
  if (token === 'tributylmethylphosphonium') return 'p4441'
  if (token === 'trihexyltetradecylphosphonium') return 'p66614'
  return token
}

function normalizeIlAnionToken(input: string): string {
  const token = String(input || '').toLowerCase().replace(/[^a-z0-9]/g, '')
  if (!token) return ''
  if (token === 'tfsi' || token === 'ntf2') return 'tfsi'
  if (token === 'fap' || token === 'tris(pentafluoroethyl)trifluorophosphate'.replace(/[^a-z0-9]/g, '')) return 'fap'
  if (
    token === 'bistrifluoromethanesulfonamide'
    || token === 'bistrifluoromethylsulfonylimide'
    || token === 'bistrifluoromethanesulfonylimide'
  ) {
    return 'tfsi'
  }
  return token
}

function inferIlAliasKeyFromName(input: string): string {
  const lower = String(input || '').toLowerCase()
  if (!lower) return ''

  let cation = ''
  if (lower.includes('imidazolium')) {
    if (/1?\s*[-]?\s*ethyl\s*[-]?\s*3\s*[-]?\s*methyl/.test(lower) || /ethyl\s*methylimidazolium/.test(lower)) cation = 'emim'
    if (/1?\s*[-]?\s*butyl\s*[-]?\s*3\s*[-]?\s*methyl/.test(lower) || /butyl\s*methylimidazolium/.test(lower)) cation = 'bmim'
    if (/1?\s*[-]?\s*hexyl\s*[-]?\s*3\s*[-]?\s*methyl/.test(lower) || /hexyl\s*methylimidazolium/.test(lower)) cation = 'hmim'
  }
  if (lower.includes('phosphonium')) {
    if (lower.includes('tributyl') && lower.includes('methyl')) cation = 'p4441'
    if (lower.includes('trihexyl') && lower.includes('tetradecyl')) cation = 'p66614'
  }

  let anion = ''
  if (lower.includes('tris(pentafluoroethyl)trifluorophosphate') || /\bfap\b/.test(lower)) {
    anion = 'fap'
  }
  if (
    lower.includes('ntf2')
    || (lower.includes('bis(trifluoromethane') && lower.includes('sulfonamide'))
    || (lower.includes('bis(trifluoromethylsulfonyl') && lower.includes('imide'))
  ) {
    anion = 'tfsi'
  }

  if (!cation || !anion) return ''
  return `${cation}|${anion}`
}

function normalizeIlAliasKey(input: string): string {
  const raw = String(input || '').trim()
  if (!raw) return ''

  const bracketPair = raw.match(/\[([^\]]+)\]\s*\[([^\]]+)\]/i)
  if (bracketPair) {
    const cation = normalizeIlCationToken(bracketPair[1] || '')
    const anion = normalizeIlAnionToken(bracketPair[2] || '')
    if (cation && anion) return `${cation}|${anion}`
  }

  return inferIlAliasKeyFromName(raw)
}

function extractNumberTokens(input: string): string[] {
  return (String(input || '').match(/\d+(?:\.\d+)?/g) || []).map((v) => String(v))
}

function numericTokensConsistent(term: string, matched: string): boolean {
  const termNums = extractNumberTokens(term).map((n) => Number(n)).filter((n) => Number.isFinite(n))
  if (!termNums.length) return true
  const matchedNums = extractNumberTokens(matched).map((n) => Number(n)).filter((n) => Number.isFinite(n))
  if (!matchedNums.length) return false
  return termNums.every((tv) => {
    const tol = Math.max(1e-6, Math.abs(tv) * 0.01)
    return matchedNums.some((mv) => Math.abs(mv - tv) <= tol)
  })
}

function commonPrefixLen(a: string, b: string): number {
  const n = Math.min(a.length, b.length)
  let i = 0
  while (i < n && a[i] === b[i]) i += 1
  return i
}

function closePdfLocate() {
  pdfLocate.value.open = false
  pdfLocate.value.title = ''
  pdfLocate.value.pdfUrl = ''
  pdfLocate.value.highlights = []
  pdfLocate.value.activeHighlightId = null
  pdfLocate.value.notice = ''
}

function findBestTermHit(ev: EvidenceResult | null | undefined, term: string): EvidenceTermHit | null {
  const hits = Array.isArray(ev?.term_hits) ? (ev?.term_hits as EvidenceTermHit[]) : []
  if (!hits.length) return null

  const termRaw = String(term || '').trim()
  const termIlKey = normalizeIlAliasKey(termRaw)
  const key = normalizeTermKey(termRaw)
  const keyWithoutPrefix = key.replace(/^[a-z]+/, '')
  const termNums = extractNumberTokens(termRaw)

  if (termIlKey) {
    const ilExact = hits.find((h) => {
      const hk = normalizeIlAliasKey(h.term)
      const mk = normalizeIlAliasKey(h.matched_text || '')
      return hk === termIlKey || mk === termIlKey
    })
    if (ilExact && !ilExact.inferred) return ilExact
    if (ilExact) return ilExact
  }

  const exact = hits.find((h) => {
    const hk = normalizeTermKey(h.term)
    const mk = normalizeTermKey(h.matched_text || '')
    return (hk === key || mk === key) && !h.inferred
  })
  if (exact) return exact

  const inferredExact = hits.find((h) => {
    const hk = normalizeTermKey(h.term)
    const mk = normalizeTermKey(h.matched_text || '')
    return hk === key || mk === key
  })
  if (inferredExact) return inferredExact

  // Keep numeric consistency first; avoids speed/temperature drifting to unrelated values.
  const numericConsistent = hits.filter((h) => {
    if (!termNums.length) return true
    return numericTokensConsistent(termRaw, String(h.matched_text || ''))
  })
  if (numericConsistent.length === 1) return numericConsistent[0] || null

  const candidates = numericConsistent.length ? numericConsistent : hits
  const compact = candidates.find((h) => {
    const hk = normalizeTermKey(h.term)
    const mk = normalizeTermKey(h.matched_text || '')
    const best = hk.length >= mk.length ? hk : mk
    const short = hk.length < 4 && mk.length < 4
    if (!best || short) return false
    const prefix = commonPrefixLen(key, best)
    const prefixRatio = prefix / Math.max(1, Math.min(key.length, best.length))
    const contains =
      (best.length >= Math.max(5, Math.floor(key.length * 0.55)) && key.includes(best))
      || (key.length >= Math.max(5, Math.floor(best.length * 0.55)) && best.includes(key))
    return (prefixRatio >= 0.6 || contains) && !h.inferred
  })
  if (compact) return compact

  if (keyWithoutPrefix && keyWithoutPrefix !== key) {
    const fallback = hits.find((h) => {
      const hk = normalizeTermKey(h.term)
      if (!hk || hk.length < 4) return false
      return hk === keyWithoutPrefix
    })
    if (fallback) return fallback
  }

  return null
}

function buildHighlightRect(
  id: string,
  page: number,
  bbox: number[] | null | undefined,
  color?: string,
): HighlightRect | null {
  if (!bbox || bbox.length < 4) return null
  const a = Number(bbox[0])
  const b = Number(bbox[1])
  const c = Number(bbox[2])
  const d = Number(bbox[3])
  if (![a, b, c, d].every((v) => Number.isFinite(v))) return null

  const left = Math.min(a, c)
  const top = Math.min(b, d)
  const right = Math.max(a, c)
  const bottom = Math.max(b, d)
  const padX = 2
  const padY = 1.5
  return {
    id,
    page: Math.max(1, Math.floor(Number(page) || 1)),
    color,
    coords: {
      x: Math.max(0, left - padX),
      y: Math.max(0, top - padY),
      w: Math.max(6, right - left + padX * 2),
      h: Math.max(6, bottom - top + padY * 2),
    },
  }
}

function buildPageAnchorHighlight(id: string, page: number, color?: string): HighlightRect {
  return {
    id,
    page: Math.max(1, Math.floor(Number(page) || 1)),
    color,
    coords: {
      x: 8,
      y: 8,
      w: 8,
      h: 8,
    },
  }
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
  // Subscript digits only inside chemical-looking tokens.
  // This preserves normal prose like "30 wt.% water" while still formatting
  // PF6, H2O, C8mim, [P6,6,6,14], [N1,8,8,8], etc.
  return input.replace(/(\[[A-Za-z][A-Za-z0-9,+\-\s]*\]|[A-Za-z][A-Za-z0-9,+\-\[\]\(\)]*)/g, (token) => {
    if (!/[A-Za-z]/.test(token) || !/\d/.test(token)) {
      return token
    }

    // Skip plain measurement/value phrases that only start with digits or are not chemical tokens.
    if (/^\d/.test(token)) {
      return token
    }

    return token.replace(/(\d+)/g, '<sub>$1</sub>')
  })
}

function formatIonicLiquidHtml(input: string | null | undefined): string {
  const value = String(input || '').trim()
  if (!value) return '--'
  return renderChemicalDigitsAsSubscriptHtml(escapeHtml(value))
}

function isVisualEvidenceSource(ev: EvidenceResult | null | undefined): boolean {
  const sourceType = String(ev?.source_type || '').trim().toLowerCase()
  if (sourceType === 'visual') return true
  if (sourceType === 'text') return false

  const source = String(ev?.source || '').trim().toLowerCase()
  if (!source) return false
  return (
    source.startsWith('fig')
    || source.startsWith('table')
    || source.startsWith('image')
    || source.startsWith('plot')
  )
}

function openRecordPdf(record: RecordResponse) {
  if (!record.literatureId) return
  const ev = evidenceData.value[record.id]
  if (isVisualEvidenceSource(ev)) {
    const previewSrc = evidenceImageSrc(record.id) || evidencePagePreviewSrc(record.id)
    if (previewSrc) {
      openImagePreview(
        previewSrc,
        `${ev?.source || 'Figure Evidence'} · Page ${ev?.page || record.sourcePage || '--'}`,
      )
      return
    }
  }
  const targetPage = ev?.page || 1
  const highlight =
    buildHighlightRect(`${record.id}-ev-${Date.now()}`, ev?.page || 0, ev?.bbox, 'rgba(250, 204, 21, 0.35)') ||
    buildPageAnchorHighlight(`${record.id}-page-${targetPage}-${Date.now()}`, targetPage, 'rgba(250, 204, 21, 0.35)')

  pdfLocate.value.open = true
  pdfLocate.value.title = `Source Locator · Page ${targetPage}`
  pdfLocate.value.pdfUrl = `/api/pdf/${record.literatureId}`
  pdfLocate.value.highlights = [highlight]
  pdfLocate.value.activeHighlightId = highlight.id
  pdfLocate.value.notice = ''
}

function onPdfLocateHighlightClick(id: string) {
  pdfLocate.value.activeHighlightId = id
}

async function fetchEvidence(record: RecordResponse) {
  if (!record.literatureId) return
  if (evidenceLoading.value[record.id]) return
  const cached = evidenceData.value[record.id]
  const hasUsefulCachedData =
    !!cached &&
    (cached.has_image ||
      !!cached.evidence_text ||
      !!cached.page ||
      !!cached.source)
  const hasTermHits = !!(cached && Array.isArray(cached.term_hits) && cached.term_hits.length > 0)
  if (hasUsefulCachedData && (!cached?.has_pdf || hasTermHits)) {
    const previousStoredScore = Number(record.confidence || 0)
    promoteRecordConfidence(record)
    await persistPromotedConfidence(record, previousStoredScore)
    return
  }

  evidenceLoading.value[record.id] = true
  evidenceError.value[record.id] = null

  try {
    const ev = await getRecordEvidence(record.literatureId, record.id)
    evidenceData.value[record.id] = ev
    const previousStoredScore = Number(record.confidence || 0)
    promoteRecordConfidence(record)
    await persistPromotedConfidence(record, previousStoredScore)
  } catch (err: any) {
    evidenceData.value[record.id] = null
    evidenceError.value[record.id] = err?.message || 'Failed to load evidence'
  } finally {
    evidenceLoading.value[record.id] = false
  }
}

async function loadOptions() {
  try {
    filterOptions.value = await getFilterOptions()
  } catch (err) {
    console.error('Failed to load filter options', err)
  }
}

function buildCurrentFilter(): SearchFilter {
  return {
    materials: selectedMaterial.value ? [selectedMaterial.value] : [],
    lubricants: selectedLubricant.value ? [selectedLubricant.value] : [],
    cof_min: cofMin.value ? parseFloat(cofMin.value) : undefined,
    cof_max: cofMax.value ? parseFloat(cofMax.value) : undefined,
    doi: searchDoi.value || undefined,
    fileId: props.selectedFileId || undefined,
  }
}

function exportFilename(ext: string): string {
  const now = new Date()
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`
  const doiPart = searchDoi.value ? searchDoi.value.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 40) : 'all'
  return `verified_data_${doiPart}_${stamp}.${ext}`
}

function triggerDownload(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

function csvEscape(value: unknown): string {
  const s = String(value ?? '')
  if (/[",\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

function toCsv(records: RecordResponse[]): string {
  const headers = [
    'id',
    'literatureId',
    'doi',
    'title',
    'lubricant',
    'tribopairLabel',
    'probeMaterial',
    'probeGeometry',
    'probeRadius',
    'probeRoughness',
    'substrateMaterial',
    'substrateCoating',
    'substrateRoughness',
    'temperature',
    'potential',
    'waterContent',
    'speedValue',
    'loadValue',
    'filmThickness',
    'cofRaw',
    'cofValue',
    'source',
    'evidence',
    'evidencePage',
  ]
  const rows = records.map((r) => [
    r.id,
    r.literatureId,
    r.literature?.doi || '',
    r.literature?.title || '',
    r.lubricant || '',
    tribopairDisplay(r),
    r.probeMaterial || '',
    r.probeGeometry || '',
    r.probeRadius || '',
    r.probeRoughness || '',
    r.substrateMaterial || '',
    r.substrateCoating || '',
    r.substrateRoughness || '',
    r.temperature || '',
    r.potential || '',
    r.waterContent || '',
    r.speedValue || '',
    r.loadValue || '',
    r.filmThickness || '',
    r.cofRaw || '',
    r.cofValue ?? '',
    r.source || '',
    r.evidence || '',
    r.evidencePage ?? '',
  ])
  return [headers.join(','), ...rows.map((r) => r.map(csvEscape).join(','))].join('\n')
}

async function fetchAllFilteredRecords(): Promise<RecordResponse[]> {
  const filter = buildCurrentFilter()
  const pageSize = 200
  let skip = 0
  const all: RecordResponse[] = []
  while (true) {
    const page = await searchRecords(filter, skip, pageSize)
    all.push(...(page.items || []))
    skip += page.items.length
    if (!page.items.length || skip >= page.total) break
  }
  return all
}

async function exportVerifiedData(format: ExportFormat) {
  showExportMenu.value = false
  if (exporting.value) return
  exporting.value = true
  try {
    const records = await fetchAllFilteredRecords()
    if (!records.length) {
      alert('No records to export under current filters.')
      return
    }

    if (format === 'json') {
      const payload = {
        exportedAt: new Date().toISOString(),
        total: records.length,
        filter: buildCurrentFilter(),
        records,
      }
      triggerDownload(exportFilename('json'), JSON.stringify(payload, null, 2), 'application/json;charset=utf-8')
      return
    }

    if (format === 'csv') {
      triggerDownload(exportFilename('csv'), toCsv(records), 'text/csv;charset=utf-8')
      return
    }

    const ndjson = records.map((r) => JSON.stringify(r)).join('\n')
    triggerDownload(exportFilename('ndjson'), ndjson, 'application/x-ndjson;charset=utf-8')
  } catch (err) {
    console.error('Export failed', err)
    alert('Export failed. Please try again.')
  } finally {
    exporting.value = false
  }
}

async function fetchData() {
  loading.value = true
  try {
    const filter = buildCurrentFilter()

    const skip = (currentPage.value - 1) * PAGE_SIZE
    result.value = await searchRecords(filter, skip, PAGE_SIZE)
  } catch (err) {
    console.error('Failed to fetch records', err)
  } finally {
    loading.value = false
  }
}

function handleSearch() {
  currentPage.value = 1
  fetchData()
}

function goToPage(page: number) {
  if (page < 1 || page > totalPages.value) return
  currentPage.value = page
  fetchData()
}

function clearDoiFilter() {
  searchDoi.value = ''
  emit('clear-doi')
  handleSearch()
}

async function saveRecord(record: RecordResponse) {
  const vals = editingValues.value[record.id]
  if (!vals) return

  savingRowId.value = record.id
  try {
    const cofRaw = vals.cof.trim()
    const parsed = cofRaw ? parseFloat(cofRaw.replace(/[<>~=]/g, '')) : undefined
    const lubricant = vals.lubricant.trim()
    const temperature = vals.temperature.trim()
    const potential = vals.potential.trim()
    const waterContent = vals.waterContent.trim()
    const speedValue = vals.speedValue.trim()
    const loadValue = vals.loadValue.trim()
    const probeMaterial = vals.probeMaterial.trim()
    const probeGeometry = vals.probeGeometry.trim()
    const probeRadius = vals.probeRadius.trim()
    const probeRoughness = vals.probeRoughness.trim()
    const substrateMaterial = vals.substrateMaterial.trim()
    const substrateCoating = vals.substrateCoating.trim()
    const substrateRoughness = vals.substrateRoughness.trim()
    const filmThickness = vals.filmThickness.trim()

    const updated = await updateTribologyRecord(record.id, {
      lubricant,
      temperature,
      potential,
      waterContent,
      speedValue,
      loadValue,
      probeMaterial,
      probeGeometry,
      probeRadius,
      probeRoughness,
      substrateMaterial,
      substrateCoating,
      substrateRoughness,
      filmThickness,
      cofRaw,
      cofValue: isNaN(parsed as number) ? undefined : parsed,
    })

    record.lubricant = lubricant
    record.temperature = temperature
    record.potential = potential
    record.waterContent = waterContent
    record.speedValue = speedValue
    record.loadValue = loadValue
    record.probeMaterial = probeMaterial || null
    record.probeGeometry = probeGeometry || null
    record.probeRadius = probeRadius || null
    record.probeRoughness = probeRoughness || null
    record.substrateMaterial = substrateMaterial || null
    record.substrateCoating = substrateCoating || null
    record.substrateRoughness = substrateRoughness || null
    record.materialName = substrateMaterial || record.materialName
    record.surfaceRoughness = substrateRoughness || probeRoughness || null
    record.tribopairLabel = formatTribopairLabel({
      probeMaterial: record.probeMaterial,
      substrateMaterial: record.substrateMaterial,
      substrateCoating: record.substrateCoating,
      materialName: record.materialName,
    })
    record.filmThickness = filmThickness
    record.cofRaw = cofRaw
    if (!isNaN(parsed as number)) {
      record.cofValue = parsed as number
    }
    if (typeof updated?.confidence === 'number') {
      record.confidence = updated.confidence
    }
    if (updated?.confidenceDetails) {
      record.confidenceDetails = updated.confidenceDetails
    }
    if (evidenceData.value[record.id]) {
      promoteRecordConfidence(record)
    }
    if (editDrawerRecord.value?.id === record.id) {
      closeEditDrawer()
    }
  } catch (err) {
    console.error('Failed to save record', err)
    alert('Save failed')
  } finally {
    savingRowId.value = null
  }
}

async function removeRecord(record: RecordResponse) {
  if (!confirm(`Delete record ${record.id}?`)) return

  deletingRowId.value = record.id
  try {
    const resp = await deleteTribologyRecord(record.id)
    if (resp?.success) {
      result.value.items = result.value.items.filter((r) => r.id !== record.id)
      result.value.total = Math.max(0, result.value.total - 1)
      if (evidenceModalRecord.value?.id === record.id) closeEvidenceModal()
      if (editDrawerRecord.value?.id === record.id) closeEditDrawer()
    }
  } catch (err) {
    console.error('Failed to delete record', err)
    alert('Delete failed')
  } finally {
    deletingRowId.value = null
  }
}

onMounted(async () => {
  await loadOptions()
  await fetchData()
  window.addEventListener('keydown', onGlobalKeydown)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onGlobalKeydown)
})

watch(
  () => props.initialDoi,
  (newDoi) => {
    searchDoi.value = newDoi || ''
    handleSearch()
  }
)

watch(
  () => props.selectedFileId,
  () => {
    currentPage.value = 1
    fetchData()
  }
)
</script>

<template>
  <div class="flex h-full flex-col overflow-hidden bg-slate-50 dark:bg-[#07111d] dark:text-slate-100">
    <div class="border-b bg-white px-6 py-4 dark:border-slate-800 dark:bg-slate-950/80">
      <div class="mb-6 flex items-start justify-between">
        <div>
          <div class="flex items-center gap-2">
            <BookOpen class="h-6 w-6 text-blue-600" />
            <h1 class="text-xl font-bold text-slate-900 dark:text-slate-100">IonicLink Sourcing</h1>
          </div>
          <p class="mt-1 text-xs text-slate-500 dark:text-slate-400">Automatically locate data sources; dual verification ensures extraction precision.</p>
        </div>
        <div class="flex items-center gap-3">
          <button
            class="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
            @click="emit('view-literature')"
          >
            <BookOpen class="h-4 w-4" /> Literature Mgmt
          </button>
          <div class="relative">
            <button
              class="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
              :disabled="exporting"
              @click="showExportMenu = !showExportMenu"
            >
              <Download class="h-4 w-4" />
              {{ exporting ? 'Exporting...' : 'Export Verified Data' }}
            </button>
            <div
              v-if="showExportMenu"
              class="absolute right-0 z-20 mt-2 w-44 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-900"
            >
              <button
                type="button"
                class="block w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800"
                @click="exportVerifiedData('json')"
              >
                Export as JSON
              </button>
              <button
                type="button"
                class="block w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800"
                @click="exportVerifiedData('csv')"
              >
                Export as CSV
              </button>
              <button
                type="button"
                class="block w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800"
                @click="exportVerifiedData('ndjson')"
              >
                Export as NDJSON
              </button>
            </div>
          </div>
        </div>
      </div>

      <div class="mb-6 flex flex-wrap items-center gap-2 text-xs">
        <span v-if="props.selectedFileId && props.sourceName" class="rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-blue-700 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-300">
          Source: {{ props.sourceName }}
        </span>
        <span v-else class="shrink-0 rounded-full border border-slate-200 bg-slate-100 px-3 py-1 text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
          Showing all data
        </span>

        <div class="relative flex w-64 items-center">
          <input
            v-model="searchDoi"
            type="text"
            placeholder="Search by Literature DOI..."
            class="w-full rounded-full border border-slate-200 bg-white py-1.5 pl-3 pr-8 text-xs text-slate-700 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:placeholder:text-slate-500"
            @keydown.enter="handleSearch"
          />
          <button
            v-if="searchDoi"
            class="absolute right-2.5 text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300"
            @click="clearDoiFilter"
          >
            <Trash2 class="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div class="mb-2 flex items-center gap-2">
        <svg class="h-4 w-4 text-blue-500" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4 6H20M4 12H20M4 18H20" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        <h2 class="text-sm font-bold text-slate-800 dark:text-slate-200">Advanced Search</h2>
      </div>

      <div class="flex flex-wrap items-end gap-4">
        <div class="w-48">
          <label class="mb-1.5 block text-xs text-slate-400 dark:text-slate-500">Ionic Liquid</label>
          <select v-model="selectedLubricant" class="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200" @change="handleSearch">
            <option value="">All</option>
            <option v-for="l in filterOptions.lubricants" :key="l" :value="l">{{ l }}</option>
          </select>
        </div>

        <div class="w-48">
          <label class="mb-1.5 block text-xs text-slate-400 dark:text-slate-500">Tribopair Term</label>
          <select v-model="selectedMaterial" class="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200" @change="handleSearch">
            <option value="">All</option>
            <option v-for="m in filterOptions.materials" :key="m" :value="m">{{ m }}</option>
          </select>
        </div>

        <div>
          <label class="mb-1.5 block text-xs text-slate-400 dark:text-slate-500">COF Range</label>
          <div class="flex items-center gap-2">
            <input v-model="cofMin" type="text" placeholder="Min" class="w-24 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:placeholder:text-slate-500" />
            <span class="text-slate-300 dark:text-slate-600">-</span>
            <input v-model="cofMax" type="text" placeholder="Max" class="w-24 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:placeholder:text-slate-500" />
          </div>
        </div>

        <button class="inline-flex h-[38px] w-[38px] items-center justify-center rounded-lg bg-slate-100 text-slate-500 hover:bg-slate-200 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800" @click="handleSearch">
          <Search class="h-4 w-4" />
        </button>
      </div>
    </div>

    <div class="flex-1 overflow-auto px-6 py-4">
      <div class="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-950/85 dark:shadow-[0_10px_30px_rgba(2,8,23,0.35)]">
        <table class="w-full text-left text-sm">
          <thead class="bg-slate-50 text-xs text-slate-500 dark:bg-slate-900 dark:text-slate-400">
            <tr>
              <th class="px-4 py-4 font-medium text-slate-500 dark:text-slate-400">ID</th>
              <th class="px-4 py-4 font-medium text-slate-500 dark:text-slate-400">IONIC LIQUID</th>
              <th class="px-4 py-4 font-medium text-slate-500 dark:text-slate-400">TRIBOPAIR</th>
              <th class="px-4 py-4 font-medium text-slate-500 dark:text-slate-400">CONDITIONS</th>
              <th class="px-4 py-4 font-medium text-blue-600">COF</th>
              <th class="px-4 py-4 text-right font-medium text-slate-500 dark:text-slate-400">ACTIONS</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="loading">
              <td colspan="6" class="px-4 py-8 text-center text-slate-400 dark:text-slate-500">Loading...</td>
            </tr>
            <template v-else-if="result.items.length">
              <template v-for="record in result.items" :key="record.id">
                <tr class="border-t border-slate-100 transition-colors hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-900/70">
                  <td class="px-4 py-4 text-slate-500 dark:text-slate-400">{{ record.id }}</td>
                  <td class="px-4 py-4">
                    <div class="flex items-center gap-2">
                      <div v-if="record.cationSmiles || record.anionSmiles" class="flex gap-1 shrink-0">
                        <button
                          v-if="record.cationSmiles"
                          type="button"
                          class="rounded-md transition hover:scale-[1.02]"
                          :class="structurePreview.open && structurePreview.rowId === record.id ? 'ring-2 ring-blue-500 ring-offset-2 ring-offset-white dark:ring-offset-slate-950' : ''"
                          title="Show chemical structures"
                          @click.stop="openStructurePreview(record)"
                        >
                          <MoleculeViewer
                            :smiles="record.cationSmiles"
                            size="thumbnail"
                            :width="40"
                            :height="30"
                          />
                        </button>
                        <button
                          v-if="record.anionSmiles"
                          type="button"
                          class="rounded-md transition hover:scale-[1.02]"
                          :class="structurePreview.open && structurePreview.rowId === record.id ? 'ring-2 ring-blue-500 ring-offset-2 ring-offset-white dark:ring-offset-slate-950' : ''"
                          title="Show chemical structures"
                          @click.stop="openStructurePreview(record)"
                        >
                          <MoleculeViewer
                            :smiles="record.anionSmiles"
                            size="thumbnail"
                            :width="40"
                            :height="30"
                          />
                        </button>
                      </div>
                      <div class="font-semibold text-slate-800 dark:text-slate-100" v-html="formatIonicLiquidHtml(record.lubricant || '--')"></div>
                    </div>
                  </td>
                  <td class="px-4 py-4">
                    <div class="flex flex-wrap items-center gap-2">
                      <div class="inline-flex min-w-0 max-w-full items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-900/80">
                        <span class="truncate rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 shadow-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200">
                          {{ tribopairParts(record).probe }}
                        </span>
                        <span class="text-slate-300 dark:text-slate-600">→</span>
                        <span class="truncate rounded-lg bg-slate-900 px-2.5 py-1 text-xs font-semibold text-white dark:bg-slate-100 dark:text-slate-900">
                          {{ tribopairParts(record).substrate }}
                        </span>
                      </div>
                      <div
                        v-if="tribopairParts(record).coating"
                        class="inline-flex items-center rounded-full border border-amber-300 bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-700 shadow-sm dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300"
                      >
                        COAT: {{ tribopairParts(record).coating }}
                      </div>
                    </div>
                  </td>
                  <td class="px-4 py-4">
                    <div class="flex flex-wrap gap-2">
                      <div
                        v-for="group in conditionGroups(record)"
                        :key="group.key"
                        :title="group.title"
                        class="inline-flex max-w-full items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-semibold shadow-sm"
                        :class="conditionGroupClass(group.key)"
                      >
                        <span class="tracking-[0.16em]">{{ group.label }}</span>
                        <span class="truncate border-l border-current/20 pl-2 tracking-normal">{{ group.summary }}</span>
                      </div>
                      <span v-if="!conditionGroups(record).length" class="text-slate-400 dark:text-slate-500">--</span>
                    </div>
                  </td>
                  <td class="px-4 py-4">
                    <div class="font-bold text-blue-600">{{ cofDisplay(record) }}</div>
                    <div class="mt-0.5 text-[11px] text-slate-400 dark:text-slate-500">Conf: {{ confidenceDisplay(confidenceValueFor(record)) }}</div>
                  </td>
                  <td class="px-4 py-4">
                    <div class="flex items-center justify-end gap-1.5" @click.stop>
                      <button
                        type="button"
                        class="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-blue-200 bg-blue-50 text-blue-600 transition hover:border-blue-300 hover:bg-blue-100 dark:border-blue-500/20 dark:bg-blue-500/10 dark:text-blue-300 dark:hover:bg-blue-500/15"
                        title="Open evidence workspace"
                        @click="openEvidenceModal(record)"
                      >
                        <Eye class="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        class="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition hover:border-slate-300 hover:bg-slate-100 hover:text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
                        title="Edit extracted parameters"
                        @click="openEditModal(record)"
                      >
                        <Edit class="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        class="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-red-200 bg-red-50 text-red-500 transition hover:border-red-300 hover:bg-red-100 hover:text-red-600 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300 dark:hover:bg-red-500/15"
                        :disabled="deletingRowId === record.id"
                        title="Delete record"
                        @click="removeRecord(record)"
                      >
                        <Trash2 class="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>

                <tr v-if="false" class="border-t bg-slate-50/50 dark:border-slate-800 dark:bg-slate-900/50">
                  <td colspan="6" class="px-4 py-4">
                    <div class="grid items-start gap-4 xl:grid-cols-[0.92fr_1.04fr_1.04fr]">
                      <div class="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-950">
                        <div class="mb-4 flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-200">
                          <BookOpen class="h-4 w-4" /> Reference Details
                        </div>

                        <div class="mb-4">
                          <div class="mb-1 text-xs text-slate-400 dark:text-slate-500">Title</div>
                          <div class="text-sm font-medium text-slate-900 dark:text-slate-100">{{ record.literature?.title || '--' }}</div>
                        </div>

                        <div class="mb-4 grid grid-cols-2 gap-4">
                          <div>
                            <div class="mb-1 text-xs text-slate-400 dark:text-slate-500">Authors</div>
                            <div class="text-sm text-slate-900 dark:text-slate-200">{{ record.literature?.authors || '--' }}</div>
                          </div>
                          <div>
                            <div class="mb-1 text-xs text-slate-400 dark:text-slate-500">Journal</div>
                            <div class="text-sm text-slate-900 dark:text-slate-200">
                              {{ record.literature?.journal || '--' }}
                            </div>
                          </div>
                        </div>

                        <div>
                          <div class="mb-1 text-xs text-slate-400 dark:text-slate-500">DOI</div>
                          <div class="text-sm text-blue-600">
                            <a
                              v-if="record.literature?.doi"
                              :href="`https://doi.org/${record.literature?.doi}`"
                              target="_blank"
                              class="inline-flex items-center gap-1 hover:underline cursor-pointer"
                            >
                              {{ record.literature?.doi }}
                              <ExternalLink class="h-3.5 w-3.5" />
                            </a>
                            <span v-else class="text-slate-900 dark:text-slate-200">--</span>
                          </div>
                        </div>

                      </div>

                      <div class="relative xl:col-span-2 rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-950" @click.stop>
                        <div class="mb-3 flex items-center justify-between">
                          <p class="text-xs font-semibold uppercase tracking-[0.2em] text-blue-700">Extracted Parameters</p>
                          <div class="relative" data-confidence-popover-root="true">
                            <button
                              type="button"
                              class="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald-100 transition hover:bg-emerald-100 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/20 dark:hover:bg-emerald-500/15"
                              @click.stop="toggleConfidencePopover(record.id)"
                            >
                              <span class="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500"></span>
                              Confidence {{ confidenceDisplay(confidenceValueFor(record)) }}
                            </button>

                            <div
                              v-if="activeConfidencePopoverId === record.id"
                              class="absolute right-0 z-20 mt-2 w-[340px] overflow-hidden rounded-2xl border border-emerald-50 bg-[linear-gradient(135deg,#ffffff_0%,#e8fcf5_100%)] shadow-[0_20px_60px_rgba(15,23,42,0.12)] dark:border-emerald-500/20 dark:bg-[linear-gradient(135deg,rgba(15,23,42,0.98)_0%,rgba(8,65,54,0.82)_100%)]"
                            >
                              <div class="px-5 py-5">
                                <!-- Header -->
                                <div class="mb-4 flex items-center gap-2">
                                  <ShieldCheck class="h-5 w-5 text-emerald-600" />
                                  <span class="text-sm font-bold text-slate-800 dark:text-slate-100">AI Confidence Score</span>
                                </div>

                                <!-- Big Score & Delta -->
                                <div class="mb-5 flex items-end gap-3">
                                  <div class="flex items-baseline text-emerald-600">
                                    <span class="text-6xl font-black tracking-tighter leading-none">{{ confidencePercentNumber(confidenceValueFor(record)).toFixed(0) }}</span>
                                    <span class="text-3xl font-bold leading-none">%</span>
                                  </div>
                                  <div class="pb-1">
                                    <div class="text-[11px] font-bold uppercase tracking-wide text-emerald-600">
                                      {{ confidencePercentNumber(confidenceValueFor(record)) >= 80 ? 'High Confidence' : confidencePercentNumber(confidenceValueFor(record)) >= 50 ? 'Medium Confidence' : 'Low Confidence' }}
                                    </div>
                                    <div class="mt-1">
                                      <div
                                        v-if="confidenceDeltaPercent(record) > 0"
                                        class="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-bold text-emerald-700 bg-emerald-100/60"
                                      >
                                        <ArrowUp class="h-3 w-3" /> Up from {{ confidencePercentNumber(record.confidence).toFixed(0) }}% (Stored)
                                      </div>
                                      <div
                                        v-else-if="confidenceDeltaPercent(record) < 0"
                                        class="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-bold text-rose-700 bg-rose-100/60"
                                      >
                                        <ArrowDown class="h-3 w-3" /> Down from {{ confidencePercentNumber(record.confidence).toFixed(0) }}% (Stored)
                                      </div>
                                      <div
                                        v-else
                                        class="inline-flex items-center gap-0.5 rounded bg-slate-100/80 px-1.5 py-0.5 text-[10px] font-bold text-slate-600 dark:bg-slate-800/80 dark:text-slate-300"
                                      >
                                        Synced with stored confidence
                                      </div>
                                    </div>
                                  </div>
                                </div>

                                <!-- Box Breakdown -->
                                <div class="rounded-xl bg-white/70 p-1 ring-1 ring-slate-100/50 backdrop-blur-sm dark:bg-slate-950/50 dark:ring-slate-700/70">
                                  <div class="flex flex-col gap-0.5">
                                    <div class="flex items-center justify-between px-3 py-2">
                                      <div class="flex items-center gap-2 text-slate-500 dark:text-slate-400">
                                        <Flag class="h-4 w-4 text-slate-400 dark:text-slate-500" />
                                        <span class="text-[13px] font-medium">Base Score</span>
                                      </div>
                                      <span class="text-[14px] font-bold text-slate-700 dark:text-slate-200">{{ confidenceDetailsFor(record).base_percent.toFixed(0) }}</span>
                                    </div>

                                    <div class="mx-3 h-px bg-slate-100 dark:bg-slate-800"></div>

                                    <template v-if="confidenceDetailsFor(record).penalties?.length">
                                      <div
                                        v-for="(penalty, idx) in confidenceDetailsFor(record).penalties"
                                        :key="`pen-${idx}`"
                                        class="flex flex-col"
                                      >
                                        <div class="flex items-center justify-between px-3 py-2 text-rose-500">
                                          <div class="flex items-center gap-2 max-w-[200px]">
                                            <MinusCircle class="h-4 w-4 shrink-0" />
                                            <span class="text-[13px] truncate">{{ confidencePenaltyLabel(penalty.reason) }}</span>
                                          </div>
                                          <span class="text-[14px] font-bold shrink-0">{{ confidencePenaltyValue(penalty.value) }}</span>
                                        </div>
                                      </div>
                                    </template>
                                    <template v-else>
                                      <div class="flex items-center justify-between px-3 py-2 text-rose-500/50">
                                        <div class="flex items-center gap-2">
                                          <MinusCircle class="h-4 w-4" />
                                          <span class="text-[13px]">No penalties applied</span>
                                        </div>
                                        <span class="text-[14px] font-bold">-0</span>
                                      </div>
                                    </template>

                                    <template v-if="confidenceDetailsFor(record).boosts?.length">
                                      <div
                                        v-for="(boost, idx) in confidenceDetailsFor(record).boosts"
                                        :key="`bst-${idx}`"
                                        class="flex flex-col"
                                      >
                                        <div class="flex items-center justify-between px-3 py-2 text-emerald-400">
                                          <div class="flex items-center gap-2 max-w-[200px]">
                                            <PlusCircle class="h-4 w-4 shrink-0" />
                                            <span class="text-[13px] truncate">{{ confidenceBoostLabel(boost.reason) }}</span>
                                          </div>
                                          <span class="text-[14px] font-bold shrink-0">{{ confidenceBoostValue(boost.value) }}</span>
                                        </div>
                                      </div>
                                    </template>
                                    <template v-else>
                                      <div class="flex items-center justify-between px-3 py-2 text-emerald-400">
                                        <div class="flex items-center gap-2">
                                          <PlusCircle class="h-4 w-4" />
                                          <span class="text-[13px]">No boosts applied</span>
                                        </div>
                                        <span class="text-[14px] font-bold">+0</span>
                                      </div>
                                    </template>
                                  </div>
                                </div>
                              </div>

                              <div class="px-5 pb-5">
                                <div class="flex h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                                  <div
                                    class="h-full rounded-full bg-emerald-500 transition-all"
                                    :style="{ width: `${confidencePercentNumber(confidenceValueFor(record))}%` }"
                                  ></div>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                        <div class="space-y-4">
                          <div class="grid gap-3 xl:grid-cols-[1.2fr_1.1fr_0.72fr]">
                            <div class="rounded-2xl border border-slate-200 bg-slate-50/80 p-3 dark:border-slate-800 dark:bg-slate-900/60">
                              <p class="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Ionic Liquid</p>
                              <p class="mt-2 text-lg font-semibold text-slate-900 dark:text-slate-100">{{ editingValues[record.id]?.lubricant || '--' }}</p>
                            </div>
                            <div class="rounded-2xl border border-slate-200 bg-slate-50/80 p-3 dark:border-slate-800 dark:bg-slate-900/60">
                              <p class="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Tribopair</p>
                              <p class="mt-2 text-base font-semibold text-slate-900 dark:text-slate-100">{{ tribopairDisplay(record) }}</p>
                              <p class="mt-1 text-xs text-slate-500 dark:text-slate-400">
                                {{ editingValues[record.id]?.probeGeometry || 'Geometry --' }} · {{ editingValues[record.id]?.probeRadius || 'Radius --' }}
                              </p>
                            </div>
                            <div class="rounded-2xl border border-blue-200 bg-blue-50/70 p-3 dark:border-blue-500/20 dark:bg-blue-500/10">
                              <p class="text-[11px] font-semibold uppercase tracking-[0.18em] text-blue-700 dark:text-blue-300">COF</p>
                              <p class="mt-2 text-3xl font-black tracking-tight text-blue-700 dark:text-blue-200">{{ editingValues[record.id]?.cof || '--' }}</p>
                            </div>
                          </div>

                          <div class="flex flex-wrap gap-2">
                            <div
                              v-for="group in conditionGroups(record)"
                              :key="`${record.id}-${group.key}`"
                              class="inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs"
                              :class="conditionGroupClass(group.key)"
                              :title="group.title"
                            >
                              <span class="font-semibold tracking-[0.16em]">{{ group.label }}</span>
                              <span class="font-medium">{{ group.summary }}</span>
                            </div>
                            <span
                              v-if="!conditionGroups(record).length"
                              class="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-400 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-500"
                            >
                              No condition summary
                            </span>
                          </div>

                          <div class="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3 dark:border-slate-800 dark:bg-slate-900/60">
                            <div>
                              <p class="text-sm font-medium text-slate-700 dark:text-slate-200">Compact mode enabled</p>
                              <p class="text-xs text-slate-500 dark:text-slate-400">Expand only when you need to edit the full parameter set.</p>
                            </div>
                            <button
                              type="button"
                              class="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-white px-3 py-1.5 text-xs font-semibold text-blue-700 transition hover:bg-blue-50 dark:border-blue-500/20 dark:bg-slate-950 dark:text-blue-300"
                              @click="toggleParameterEditor(record.id)"
                            >
                              {{ isParameterEditorOpen(record.id) ? 'Hide editor' : 'Edit parameters' }}
                              <ChevronUp v-if="isParameterEditorOpen(record.id)" class="h-3.5 w-3.5" />
                              <ChevronDown v-else class="h-3.5 w-3.5" />
                            </button>
                          </div>

                          <div v-if="isParameterEditorOpen(record.id)" class="grid grid-cols-1 gap-2 rounded-2xl border border-slate-200 bg-slate-50/80 p-4 dark:border-slate-800 dark:bg-slate-900/60">
                          <div>
                            <label class="mb-1 block text-[11px] font-medium text-slate-500 dark:text-slate-400">IONIC LIQUID</label>
                            <input
                              :value="editingValues[record.id]?.lubricant ?? ''"
                              @input="(e: Event) => updateEditingField(record.id, 'lubricant', (e.target as HTMLInputElement).value)"
                              type="text"
                              class="h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:placeholder:text-slate-500"
                              placeholder="Ionic liquid"
                            />
                          </div>

                          <div class="rounded-2xl border border-slate-200 bg-slate-50/80 p-3 dark:border-slate-800 dark:bg-slate-900/60">
                            <div class="mb-3 flex items-center justify-between">
                              <div>
                                <p class="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400">Tribopair Configuration</p>
                                <p class="mt-1 text-xs text-slate-500 dark:text-slate-400">{{ tribopairDisplay(record) }}</p>
                              </div>
                            </div>
                            <div class="grid gap-3 md:grid-cols-2">
                              <div class="rounded-2xl border border-emerald-200 bg-white p-3 dark:border-emerald-500/20 dark:bg-slate-950">
                                <p class="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-700 dark:text-emerald-300">Probe</p>
                                <div class="grid gap-2">
                                  <div>
                                    <label class="mb-1 block text-[11px] font-medium text-slate-500 dark:text-slate-400">Material</label>
                                    <input
                                      :value="editingValues[record.id]?.probeMaterial ?? ''"
                                      @input="(e: Event) => updateEditingField(record.id, 'probeMaterial', (e.target as HTMLInputElement).value)"
                                      type="text"
                                      class="h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                                      placeholder="e.g. Silica"
                                    />
                                  </div>
                                  <div>
                                    <label class="mb-1 block text-[11px] font-medium text-slate-500 dark:text-slate-400">Geometry</label>
                                    <input
                                      :value="editingValues[record.id]?.probeGeometry ?? ''"
                                      @input="(e: Event) => updateEditingField(record.id, 'probeGeometry', (e.target as HTMLInputElement).value)"
                                      type="text"
                                      class="h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                                      placeholder="e.g. Sphere"
                                    />
                                  </div>
                                  <div>
                                    <label class="mb-1 block text-[11px] font-medium text-slate-500 dark:text-slate-400">Radius</label>
                                    <input
                                      :value="editingValues[record.id]?.probeRadius ?? ''"
                                      @input="(e: Event) => updateEditingField(record.id, 'probeRadius', (e.target as HTMLInputElement).value)"
                                      type="text"
                                      class="h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                                      placeholder="e.g. 5 μm"
                                    />
                                  </div>
                                  <div>
                                    <label class="mb-1 block text-[11px] font-medium text-slate-500 dark:text-slate-400">Roughness</label>
                                    <input
                                      :value="editingValues[record.id]?.probeRoughness ?? ''"
                                      @input="(e: Event) => updateEditingField(record.id, 'probeRoughness', (e.target as HTMLInputElement).value)"
                                      type="text"
                                      class="h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                                      placeholder="e.g. < 2 nm RMS"
                                    />
                                  </div>
                                </div>
                              </div>

                              <div class="rounded-2xl border border-sky-200 bg-white p-3 dark:border-sky-500/20 dark:bg-slate-950">
                                <p class="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-700 dark:text-sky-300">Substrate</p>
                                <div class="grid gap-2">
                                  <div>
                                    <label class="mb-1 block text-[11px] font-medium text-slate-500 dark:text-slate-400">Material</label>
                                    <input
                                      :value="editingValues[record.id]?.substrateMaterial ?? ''"
                                      @input="(e: Event) => updateEditingField(record.id, 'substrateMaterial', (e.target as HTMLInputElement).value)"
                                      type="text"
                                      class="h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                                      placeholder="e.g. Mica"
                                    />
                                  </div>
                                  <div>
                                    <label class="mb-1 block text-[11px] font-medium text-slate-500 dark:text-slate-400">Coating</label>
                                    <input
                                      :value="editingValues[record.id]?.substrateCoating ?? ''"
                                      @input="(e: Event) => updateEditingField(record.id, 'substrateCoating', (e.target as HTMLInputElement).value)"
                                      type="text"
                                      class="h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                                      placeholder="e.g. PEG-brush"
                                    />
                                  </div>
                                  <div>
                                    <label class="mb-1 block text-[11px] font-medium text-slate-500 dark:text-slate-400">Roughness</label>
                                    <input
                                      :value="editingValues[record.id]?.substrateRoughness ?? ''"
                                      @input="(e: Event) => updateEditingField(record.id, 'substrateRoughness', (e.target as HTMLInputElement).value)"
                                      type="text"
                                      class="h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                                      placeholder="e.g. Atomically flat"
                                    />
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>

                          <div class="grid grid-cols-2 gap-2">
                            <div>
                              <label class="mb-1 block text-[11px] font-medium text-slate-500 dark:text-slate-400">COND · Temperature</label>
                              <input
                                :value="editingValues[record.id]?.temperature ?? ''"
                                @input="(e: Event) => updateEditingField(record.id, 'temperature', (e.target as HTMLInputElement).value)"
                                type="text"
                                class="h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:placeholder:text-slate-500"
                                placeholder="e.g. 298.15 K"
                              />
                            </div>
                            <div>
                              <label class="mb-1 block text-[11px] font-medium text-slate-500 dark:text-slate-400">COND · Potential</label>
                              <input
                                :value="editingValues[record.id]?.potential ?? ''"
                                @input="(e: Event) => updateEditingField(record.id, 'potential', (e.target as HTMLInputElement).value)"
                                type="text"
                                class="h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:placeholder:text-slate-500"
                                placeholder="e.g. +1.5 V / OCP"
                              />
                            </div>
                          </div>

                          <div class="grid grid-cols-2 gap-2">
                            <div>
                              <label class="mb-1 block text-[11px] font-medium text-slate-500 dark:text-slate-400">COND · Water</label>
                              <input
                                :value="editingValues[record.id]?.waterContent ?? ''"
                                @input="(e: Event) => updateEditingField(record.id, 'waterContent', (e.target as HTMLInputElement).value)"
                                type="text"
                                class="h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:placeholder:text-slate-500"
                                placeholder="e.g. 50 ppm"
                              />
                            </div>
                            <div>
                              <label class="mb-1 block text-[11px] font-medium text-slate-500 dark:text-slate-400">COND · Speed</label>
                              <input
                                :value="editingValues[record.id]?.speedValue ?? ''"
                                @input="(e: Event) => updateEditingField(record.id, 'speedValue', (e.target as HTMLInputElement).value)"
                                type="text"
                                class="h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:placeholder:text-slate-500"
                                placeholder="e.g. 1 μm/s"
                              />
                            </div>
                          </div>

                          <div class="grid grid-cols-2 gap-2">
                            <div>
                              <label class="mb-1 block text-[11px] font-medium text-slate-500 dark:text-slate-400">COND · Load</label>
                              <input
                                :value="editingValues[record.id]?.loadValue ?? ''"
                                @input="(e: Event) => updateEditingField(record.id, 'loadValue', (e.target as HTMLInputElement).value)"
                                type="text"
                                class="h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:placeholder:text-slate-500"
                                placeholder="e.g. 25 nN"
                              />
                            </div>
                            <div></div>
                          </div>

                          <div>
                            <label class="mb-1 block text-[11px] font-medium text-slate-500 dark:text-slate-400">COND · Roughness (Film)</label>
                            <input
                              :value="editingValues[record.id]?.filmThickness ?? ''"
                              @input="(e: Event) => updateEditingField(record.id, 'filmThickness', (e.target as HTMLInputElement).value)"
                              type="text"
                              class="h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:placeholder:text-slate-500"
                              placeholder='e.g. RMS 4.9 nm (BB5-1-M)'
                            />
                          </div>

                          <div class="flex items-end gap-2">
                            <div class="flex-1">
                              <label class="mb-1 block text-[11px] font-medium text-slate-500 dark:text-slate-400">COF</label>
                              <input
                                :value="editingValues[record.id]?.cof ?? ''"
                                @input="(e: Event) => updateEditingField(record.id, 'cof', (e.target as HTMLInputElement).value)"
                                type="text"
                                class="h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm font-mono dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500"
                                placeholder="COF raw value"
                              />
                            </div>
                            <button
                              class="inline-flex h-9 items-center gap-1 rounded-lg bg-blue-600 px-3 text-sm text-white hover:bg-blue-700 disabled:opacity-60"
                              :disabled="savingRowId === record.id"
                              @click="saveRecord(record)"
                            >
                              <Save class="h-4 w-4" /> Save
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>

                      <div class="rounded-[28px] border border-emerald-100 bg-[linear-gradient(135deg,#ffffff_0%,#effbf6_60%,#d7f7eb_100%)] p-5 shadow-sm dark:border-emerald-500/15 dark:bg-[linear-gradient(135deg,rgba(15,23,42,0.98)_0%,rgba(5,83,64,0.86)_100%)]">
                        <div class="flex items-center justify-between gap-3">
                          <div class="flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
                            <ShieldCheck class="h-4 w-4 text-emerald-600 dark:text-emerald-300" />
                            AI Confidence Score
                          </div>
                          <button
                            type="button"
                            class="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-white/70 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 transition hover:bg-white dark:border-emerald-500/20 dark:bg-slate-950/40 dark:text-emerald-300"
                            @click="toggleConfidenceCard(record.id)"
                          >
                            {{ isConfidenceCardOpen(record.id) ? 'Less' : 'More' }}
                            <ChevronUp v-if="isConfidenceCardOpen(record.id)" class="h-3.5 w-3.5" />
                            <ChevronDown v-else class="h-3.5 w-3.5" />
                          </button>
                        </div>

                        <div class="mt-4 flex items-end gap-3">
                          <div class="flex items-baseline text-emerald-600 dark:text-emerald-300">
                            <span class="text-5xl font-black leading-none tracking-tighter">{{ confidencePercentNumber(confidenceValueFor(record)).toFixed(0) }}</span>
                            <span class="text-2xl font-bold leading-none">%</span>
                          </div>
                          <div class="pb-1 text-[11px] font-bold uppercase tracking-[0.18em] text-emerald-600 dark:text-emerald-300">
                            {{ confidencePercentNumber(confidenceValueFor(record)) >= 80 ? 'High Confidence' : confidencePercentNumber(confidenceValueFor(record)) >= 50 ? 'Medium Confidence' : 'Low Confidence' }}
                          </div>
                        </div>

                        <div class="mt-4 rounded-2xl border border-emerald-100 bg-white/80 p-4 shadow-sm dark:border-emerald-500/15 dark:bg-slate-950/55">
                          <div class="flex items-center justify-between text-slate-600 dark:text-slate-300">
                            <span class="text-[13px] font-medium">Base Score</span>
                            <span class="text-xl font-bold text-slate-800 dark:text-slate-100">{{ confidenceDetailsFor(record).base_percent.toFixed(0) }}</span>
                          </div>

                          <div class="mt-3 space-y-2">
                            <div
                              v-for="(boost, idx) in confidenceDetailsFor(record).boosts?.slice(0, isConfidenceCardOpen(record.id) ? 4 : 2)"
                              :key="`inline-boost-${idx}`"
                              class="flex items-start justify-between gap-3 text-emerald-600 dark:text-emerald-300"
                            >
                              <div class="flex items-start gap-2">
                                <PlusCircle class="mt-0.5 h-4 w-4 shrink-0" />
                                <span class="text-[13px] leading-5">{{ confidenceBoostLabel(boost.reason) }}</span>
                              </div>
                              <span class="shrink-0 text-sm font-bold">{{ confidenceBoostValue(boost.value) }}</span>
                            </div>
                            <div
                              v-if="!confidenceDetailsFor(record).boosts?.length"
                              class="text-[13px] text-slate-500 dark:text-slate-400"
                            >
                              No confidence boosts applied
                            </div>
                          </div>

                          <div v-if="isConfidenceCardOpen(record.id) && confidenceDetailsFor(record).penalties?.length" class="mt-3 border-t border-slate-100 pt-3 dark:border-slate-800">
                            <div
                              v-for="(penalty, idx) in confidenceDetailsFor(record).penalties"
                              :key="`inline-penalty-${idx}`"
                              class="flex items-start justify-between gap-3 text-rose-500"
                            >
                              <div class="flex items-start gap-2">
                                <MinusCircle class="mt-0.5 h-4 w-4 shrink-0" />
                                <span class="text-[13px] leading-5">{{ confidencePenaltyLabel(penalty.reason) }}</span>
                              </div>
                              <span class="shrink-0 text-sm font-bold">{{ confidencePenaltyValue(penalty.value) }}</span>
                            </div>
                          </div>
                        </div>

                        <div class="mt-4 h-2 w-full overflow-hidden rounded-full bg-emerald-100/80 dark:bg-slate-800">
                          <div
                            class="h-full rounded-full bg-emerald-500 transition-all"
                            :style="{ width: `${confidencePercentNumber(confidenceValueFor(record))}%` }"
                          ></div>
                        </div>
                      </div>

                      <div class="xl:col-span-2 space-y-2" @click.stop>
                        <div class="flex items-center justify-between px-1">
                          <p class="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">Context-Aware Evidence</p>
                          <button
                            v-if="record.literatureId"
                            type="button"
                            class="text-xs text-blue-600 hover:underline dark:text-blue-300"
                            @click="openRecordPdf(record)"
                          >
                            Open PDF
                          </button>
                        </div>

                        <p v-if="evidenceLoading[record.id]" class="text-xs text-slate-400 dark:text-slate-500">Locating evidence...</p>
                        <p v-else-if="evidenceError[record.id]" class="text-xs text-red-500">{{ evidenceError[record.id] }}</p>
                        <template v-else-if="buildInteractiveEvidenceRow(record)">
                          <p v-if="evidenceData[record.id] && !evidenceData[record.id]?.has_pdf" class="px-1 text-xs text-amber-600 dark:text-amber-300">
                            PDF file not found on backend disk; evidence image cannot be generated.
                          </p>
                          <InteractiveEvidencePanelHost
                            :row="buildInteractiveEvidenceRow(record) as InteractiveEvidenceRow"
                            :pdf-url="record.literatureId ? `/api/pdf/${record.literatureId}` : ''"
                            class-name="rounded-[28px]"
                            @open-pdf="(payload) => openInteractiveEvidencePdf(record, payload)"
                          />
                        </template>
                        <p v-else class="text-xs text-slate-400 dark:text-slate-500">No evidence available</p>
                      </div>
                    </div>

                  </td>
                </tr>
              </template>
            </template>
              <tr v-else>
                <td colspan="6" class="px-4 py-8 text-center text-slate-400 dark:text-slate-500">No matching data</td>
              </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="flex items-center justify-between border-t bg-white px-6 py-3 text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-950/80 dark:text-slate-400">
      <div>
        <template v-if="result.total > 0">
          Showing {{ rangeStart }} to {{ rangeEnd }} (Total {{ result.total }})
        </template>
        <template v-else>
          No records found
        </template>
      </div>
      <div class="flex items-center gap-1">
        <button
          class="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2 py-1 hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:hover:bg-slate-800"
          :disabled="currentPage === 1"
          @click="goToPage(currentPage - 1)"
        >
          <ChevronLeft class="h-4 w-4" /> Prev
        </button>
        <span class="px-2">{{ currentPage }} / {{ totalPages }}</span>
        <button
          class="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2 py-1 hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:hover:bg-slate-800"
          :disabled="currentPage >= totalPages"
          @click="goToPage(currentPage + 1)"
        >
          Next <ChevronRight class="h-4 w-4" />
        </button>
      </div>
    </div>

    <Modal :show="!!evidenceModalRecord" max-width="full" @close="closeEvidenceModal">
      <template #header>
        <div v-if="evidenceModalRecord" class="flex w-full items-center justify-between gap-4">
          <div class="min-w-0">
            <div class="text-xs font-semibold uppercase tracking-[0.22em] text-blue-500">Evidence Workspace</div>
            <div class="mt-1 truncate text-base font-semibold text-slate-900 dark:text-slate-100">
              Record #{{ evidenceModalRecord.id }} · {{ tribopairDisplay(evidenceModalRecord) }}
            </div>
          </div>
          <div class="flex items-center gap-2">
            <button
              type="button"
              class="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
              @click="openEditModal(evidenceModalRecord)"
            >
              <Edit class="h-4 w-4" /> Edit
            </button>
            <button
              v-if="evidenceModalRecord.literatureId"
              type="button"
              class="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-blue-700"
              @click="openRecordPdf(evidenceModalRecord)"
            >
              <ExternalLink class="h-4 w-4" /> Open PDF
            </button>
          </div>
        </div>
      </template>

      <div v-if="evidenceModalRecord" class="grid h-[78vh] gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
        <aside class="space-y-4 overflow-auto pr-1">
          <div class="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-950">
            <div class="flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
              <BookOpen class="h-4 w-4" /> Reference Source
            </div>
            <div class="mt-4 space-y-4">
              <div>
                <div class="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">Title</div>
                <div class="mt-1 text-sm font-medium leading-6 text-slate-900 dark:text-slate-100">
                  {{ evidenceModalRecord.literature?.title || '--' }}
                </div>
              </div>
              <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                <div>
                  <div class="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">Authors</div>
                  <div class="mt-1 text-sm text-slate-700 dark:text-slate-300">{{ evidenceModalRecord.literature?.authors || '--' }}</div>
                </div>
                <div>
                  <div class="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">Journal</div>
                  <div class="mt-1 text-sm text-slate-700 dark:text-slate-300">{{ evidenceModalRecord.literature?.journal || '--' }}</div>
                </div>
              </div>
              <div>
                <div class="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">DOI</div>
                <div class="mt-1 text-sm">
                  <a
                    v-if="evidenceModalRecord.literature?.doi"
                    :href="`https://doi.org/${evidenceModalRecord.literature?.doi}`"
                    target="_blank"
                    class="inline-flex items-center gap-1 text-blue-600 hover:underline dark:text-blue-300"
                  >
                    {{ evidenceModalRecord.literature?.doi }}
                    <ExternalLink class="h-3.5 w-3.5" />
                  </a>
                  <span v-else class="text-slate-700 dark:text-slate-300">--</span>
                </div>
              </div>
            </div>
          </div>

          <div class="rounded-[24px] border border-emerald-100 bg-[linear-gradient(135deg,#ffffff_0%,#effbf6_60%,#d7f7eb_100%)] p-5 shadow-sm dark:border-emerald-500/15 dark:bg-[linear-gradient(135deg,rgba(15,23,42,0.98)_0%,rgba(5,83,64,0.86)_100%)]">
            <div class="flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
              <ShieldCheck class="h-4 w-4 text-emerald-600 dark:text-emerald-300" />
              AI Confidence
            </div>

            <div class="mt-4 flex items-end gap-3">
              <div class="flex items-baseline text-emerald-600 dark:text-emerald-300">
                <span class="text-5xl font-black leading-none tracking-tighter">{{ confidencePercentNumber(confidenceValueFor(evidenceModalRecord)).toFixed(0) }}</span>
                <span class="text-2xl font-bold leading-none">%</span>
              </div>
              <div class="pb-1 text-[11px] font-bold uppercase tracking-[0.18em] text-emerald-600 dark:text-emerald-300">
                {{ confidencePercentNumber(confidenceValueFor(evidenceModalRecord)) >= 80 ? 'High Confidence' : confidencePercentNumber(confidenceValueFor(evidenceModalRecord)) >= 50 ? 'Medium Confidence' : 'Low Confidence' }}
              </div>
            </div>

            <div class="mt-3">
              <div
                v-if="confidenceDeltaPercent(evidenceModalRecord) > 0"
                class="inline-flex items-center gap-1 rounded-full bg-emerald-100/80 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
              >
                <ArrowUp class="h-3.5 w-3.5" /> Live evidence boosted confidence
              </div>
              <div
                v-else-if="confidenceDeltaPercent(evidenceModalRecord) < 0"
                class="inline-flex items-center gap-1 rounded-full bg-rose-100/80 px-2.5 py-1 text-[11px] font-semibold text-rose-700 dark:bg-rose-500/15 dark:text-rose-300"
              >
                <ArrowDown class="h-3.5 w-3.5" /> Stored score exceeds live evidence
              </div>
              <div
                v-else
                class="inline-flex items-center gap-1 rounded-full bg-white/80 px-2.5 py-1 text-[11px] font-semibold text-slate-600 ring-1 ring-slate-200/70 dark:bg-slate-950/40 dark:text-slate-300 dark:ring-slate-700/70"
              >
                Synced with stored confidence
              </div>
            </div>

            <div class="mt-4 rounded-2xl border border-white/80 bg-white/70 p-4 shadow-sm backdrop-blur dark:border-slate-800/80 dark:bg-slate-950/45">
              <div class="flex items-center justify-between text-sm text-slate-600 dark:text-slate-300">
                <div class="flex items-center gap-2">
                  <Flag class="h-4 w-4" />
                  <span>Base Score</span>
                </div>
                <span class="font-bold text-slate-800 dark:text-slate-100">{{ confidenceDetailsFor(evidenceModalRecord).base_percent.toFixed(0) }}</span>
              </div>

              <div class="mt-4 space-y-2">
                <div
                  v-for="(boost, idx) in confidenceDetailsFor(evidenceModalRecord).boosts.slice(0, 3)"
                  :key="`modal-boost-${idx}`"
                  class="flex items-start justify-between gap-3 text-emerald-700 dark:text-emerald-300"
                >
                  <div class="flex items-start gap-2">
                    <PlusCircle class="mt-0.5 h-4 w-4 shrink-0" />
                    <span class="text-[13px] leading-5">{{ confidenceBoostLabel(boost.reason) }}</span>
                  </div>
                  <span class="shrink-0 text-sm font-bold">{{ confidenceBoostValue(boost.value) }}</span>
                </div>
                <div
                  v-for="(penalty, idx) in confidenceDetailsFor(evidenceModalRecord).penalties.slice(0, 2)"
                  :key="`modal-penalty-${idx}`"
                  class="flex items-start justify-between gap-3 text-rose-600 dark:text-rose-300"
                >
                  <div class="flex items-start gap-2">
                    <MinusCircle class="mt-0.5 h-4 w-4 shrink-0" />
                    <span class="text-[13px] leading-5">{{ confidencePenaltyLabel(penalty.reason) }}</span>
                  </div>
                  <span class="shrink-0 text-sm font-bold">{{ confidencePenaltyValue(penalty.value) }}</span>
                </div>
              </div>
            </div>

            <div class="mt-4 h-2 overflow-hidden rounded-full bg-emerald-100/80 dark:bg-slate-800">
              <div
                class="h-full rounded-full bg-emerald-500 transition-all"
                :style="{ width: `${confidencePercentNumber(confidenceValueFor(evidenceModalRecord))}%` }"
              ></div>
            </div>
          </div>
        </aside>

        <section class="flex min-h-0 flex-col rounded-[28px] bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.18),transparent_32%),radial-gradient(circle_at_bottom_right,rgba(168,85,247,0.12),transparent_26%),linear-gradient(135deg,#09101d_0%,#08162f_45%,#0b1530_100%)] p-4">
          <div class="mb-4 flex flex-wrap items-start justify-between gap-3 px-1">
            <div>
              <div class="text-xs font-semibold uppercase tracking-[0.24em] text-blue-200/70">Context-Aware Evidence</div>
              <div class="mt-1 text-sm text-slate-300">
                <span class="font-semibold text-white" v-html="formatIonicLiquidHtml(evidenceModalRecord.lubricant || '--')"></span>
                <span class="mx-2 text-slate-500">·</span>
                <span>{{ cofDisplay(evidenceModalRecord) }}</span>
              </div>
            </div>
            <div class="flex flex-wrap gap-2">
              <span
                v-for="group in conditionGroups(evidenceModalRecord)"
                :key="`modal-cond-${group.key}`"
                class="inline-flex max-w-full items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-semibold"
                :class="conditionGroupClass(group.key)"
              >
                <span class="tracking-[0.16em]">{{ group.label }}</span>
                <span class="truncate border-l border-current/20 pl-2 tracking-normal">{{ group.summary }}</span>
              </span>
            </div>
          </div>

          <div class="min-h-0 flex-1 overflow-auto">
            <p v-if="evidenceLoading[evidenceModalRecord.id]" class="rounded-2xl border border-slate-700/70 bg-slate-900/60 px-4 py-5 text-sm text-slate-300">
              Locating evidence...
            </p>
            <p v-else-if="evidenceError[evidenceModalRecord.id]" class="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-5 text-sm text-rose-200">
              {{ evidenceError[evidenceModalRecord.id] }}
            </p>
            <template v-else-if="activeEvidenceRow">
              <p v-if="evidenceData[evidenceModalRecord.id] && !evidenceData[evidenceModalRecord.id]?.has_pdf" class="mb-3 rounded-xl border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
                PDF file not found on backend disk; evidence image cannot be generated.
              </p>
              <InteractiveEvidencePanelHost
                :row="activeEvidenceRow"
                :pdf-url="evidenceModalRecord.literatureId ? `/api/pdf/${evidenceModalRecord.literatureId}` : ''"
                class-name="rounded-[26px]"
                @open-pdf="handleEvidenceModalPdfOpen"
              />
            </template>
            <p v-else class="rounded-2xl border border-slate-700/70 bg-slate-900/60 px-4 py-5 text-sm text-slate-300">
              No evidence available for this record.
            </p>
          </div>
        </section>
      </div>
    </Modal>

    <Transition
      enter-active-class="transition ease-out duration-300"
      enter-from-class="opacity-0"
      enter-to-class="opacity-100"
      leave-active-class="transition ease-in duration-200"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
    >
      <div v-if="editDrawerRecord && activeEditValues" class="fixed inset-0 z-50 bg-slate-950/35 backdrop-blur-[2px]" @click.self="closeEditDrawer">
        <Transition
          enter-active-class="transition ease-out duration-300"
          enter-from-class="translate-x-full"
          enter-to-class="translate-x-0"
          leave-active-class="transition ease-in duration-200"
          leave-from-class="translate-x-0"
          leave-to-class="translate-x-full"
        >
          <div class="absolute inset-y-0 right-0 flex w-full max-w-2xl flex-col border-l border-slate-200 bg-white shadow-[0_24px_80px_rgba(15,23,42,0.18)] dark:border-slate-800 dark:bg-slate-950">
            <div class="border-b border-slate-200 px-6 py-5 dark:border-slate-800">
              <div class="flex items-start justify-between gap-4">
                <div class="min-w-0">
                  <div class="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400 dark:text-slate-500">Edit Parameters</div>
                  <div class="mt-1 text-lg font-semibold text-slate-900 dark:text-slate-100">
                    Record #{{ editDrawerRecord.id }}
                  </div>
                  <div class="mt-2 text-sm text-slate-500 dark:text-slate-400" v-html="formatIonicLiquidHtml(editDrawerRecord.lubricant || '--')"></div>
                </div>
                <button
                  type="button"
                  aria-label="Close editor"
                  class="inline-flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 text-slate-500 transition hover:bg-slate-50 hover:text-slate-700 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                  @click="closeEditDrawer"
                >
                  <span class="text-lg leading-none">×</span>
                </button>
              </div>

              <div class="mt-4 flex flex-wrap gap-2 text-[11px] font-semibold">
                <span class="rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-blue-700 dark:border-blue-500/20 dark:bg-blue-500/10 dark:text-blue-300">
                  COF {{ cofDisplay(editDrawerRecord) }}
                </span>
                <span class="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300">
                  Confidence {{ confidenceDisplay(confidenceValueFor(editDrawerRecord)) }}
                </span>
                <span class="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
                  {{ tribopairDisplay(editDrawerRecord) }}
                </span>
              </div>
            </div>

            <div class="flex-1 overflow-auto px-6 py-5">
              <div class="space-y-5">
                <section class="rounded-2xl border border-slate-200 bg-slate-50/80 p-4 dark:border-slate-800 dark:bg-slate-900/60">
                  <div class="mb-4 text-sm font-semibold text-slate-900 dark:text-slate-100">Core Fields</div>
                  <div class="grid gap-4 md:grid-cols-2">
                    <div class="md:col-span-2">
                      <label class="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">Ionic Liquid</label>
                      <input
                        :value="activeEditValues.lubricant"
                        @input="(e: Event) => updateActiveEditingField('lubricant', (e.target as HTMLInputElement).value)"
                        type="text"
                        class="h-10 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                        placeholder="[EMIM][TFSI]"
                      />
                    </div>
                    <div>
                      <label class="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">COF</label>
                      <input
                        :value="activeEditValues.cof"
                        @input="(e: Event) => updateActiveEditingField('cof', (e.target as HTMLInputElement).value)"
                        type="text"
                        class="h-10 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm font-mono dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                        placeholder="0.020"
                      />
                    </div>
                    <div>
                      <label class="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">Temperature</label>
                      <input
                        :value="activeEditValues.temperature"
                        @input="(e: Event) => updateActiveEditingField('temperature', (e.target as HTMLInputElement).value)"
                        type="text"
                        class="h-10 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                        placeholder="298.15 K"
                      />
                    </div>
                  </div>
                </section>

                <section class="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-950">
                  <div class="mb-4 text-sm font-semibold text-slate-900 dark:text-slate-100">Tribopair</div>
                  <div class="grid gap-4 md:grid-cols-2">
                    <div>
                      <label class="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">Probe Material</label>
                      <input
                        :value="activeEditValues.probeMaterial"
                        @input="(e: Event) => updateActiveEditingField('probeMaterial', (e.target as HTMLInputElement).value)"
                        type="text"
                        class="h-10 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                        placeholder="Silica"
                      />
                    </div>
                    <div>
                      <label class="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">Substrate Material</label>
                      <input
                        :value="activeEditValues.substrateMaterial"
                        @input="(e: Event) => updateActiveEditingField('substrateMaterial', (e.target as HTMLInputElement).value)"
                        type="text"
                        class="h-10 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                        placeholder="Mica"
                      />
                    </div>
                    <div>
                      <label class="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">Probe Geometry</label>
                      <input
                        :value="activeEditValues.probeGeometry"
                        @input="(e: Event) => updateActiveEditingField('probeGeometry', (e.target as HTMLInputElement).value)"
                        type="text"
                        class="h-10 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                        placeholder="Sphere"
                      />
                    </div>
                    <div>
                      <label class="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">Probe Radius</label>
                      <input
                        :value="activeEditValues.probeRadius"
                        @input="(e: Event) => updateActiveEditingField('probeRadius', (e.target as HTMLInputElement).value)"
                        type="text"
                        class="h-10 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                        placeholder="5 μm"
                      />
                    </div>
                  </div>
                </section>

                <section class="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-950">
                  <div class="mb-4 text-sm font-semibold text-slate-900 dark:text-slate-100">Experimental Conditions</div>
                  <div class="grid gap-4 md:grid-cols-2">
                    <div>
                      <label class="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">Potential</label>
                      <input
                        :value="activeEditValues.potential"
                        @input="(e: Event) => updateActiveEditingField('potential', (e.target as HTMLInputElement).value)"
                        type="text"
                        class="h-10 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                        placeholder="+1.5 V / OCP"
                      />
                    </div>
                    <div>
                      <label class="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">Water Content</label>
                      <input
                        :value="activeEditValues.waterContent"
                        @input="(e: Event) => updateActiveEditingField('waterContent', (e.target as HTMLInputElement).value)"
                        type="text"
                        class="h-10 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                        placeholder="IL-0%"
                      />
                    </div>
                    <div>
                      <label class="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">Speed</label>
                      <input
                        :value="activeEditValues.speedValue"
                        @input="(e: Event) => updateActiveEditingField('speedValue', (e.target as HTMLInputElement).value)"
                        type="text"
                        class="h-10 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                        placeholder="1 μm/s"
                      />
                    </div>
                    <div>
                      <label class="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">Load</label>
                      <input
                        :value="activeEditValues.loadValue"
                        @input="(e: Event) => updateActiveEditingField('loadValue', (e.target as HTMLInputElement).value)"
                        type="text"
                        class="h-10 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                        placeholder="15-75 nN"
                      />
                    </div>
                  </div>
                </section>

                <details class="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-950">
                  <summary class="cursor-pointer list-none text-sm font-semibold text-slate-900 dark:text-slate-100">
                    Advanced Surface Metadata
                  </summary>
                  <div class="mt-4 grid gap-4 md:grid-cols-2">
                    <div>
                      <label class="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">Probe Roughness</label>
                      <input
                        :value="activeEditValues.probeRoughness"
                        @input="(e: Event) => updateActiveEditingField('probeRoughness', (e.target as HTMLInputElement).value)"
                        type="text"
                        class="h-10 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                        placeholder="< 2 nm RMS"
                      />
                    </div>
                    <div>
                      <label class="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">Substrate Coating</label>
                      <input
                        :value="activeEditValues.substrateCoating"
                        @input="(e: Event) => updateActiveEditingField('substrateCoating', (e.target as HTMLInputElement).value)"
                        type="text"
                        class="h-10 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                        placeholder="None"
                      />
                    </div>
                    <div>
                      <label class="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">Substrate Roughness</label>
                      <input
                        :value="activeEditValues.substrateRoughness"
                        @input="(e: Event) => updateActiveEditingField('substrateRoughness', (e.target as HTMLInputElement).value)"
                        type="text"
                        class="h-10 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                        placeholder="Atomically flat"
                      />
                    </div>
                    <div>
                      <label class="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">Film / Roughness Note</label>
                      <input
                        :value="activeEditValues.filmThickness"
                        @input="(e: Event) => updateActiveEditingField('filmThickness', (e.target as HTMLInputElement).value)"
                        type="text"
                        class="h-10 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                        placeholder="RMS 4.9 nm (BB5-1-M)"
                      />
                    </div>
                  </div>
                </details>
              </div>
            </div>

            <div class="border-t border-slate-200 px-6 py-4 dark:border-slate-800">
              <div class="flex items-center justify-between gap-3">
                <p class="text-xs text-slate-500 dark:text-slate-400">Focused editor for correcting extracted values without expanding the table.</p>
                <div class="flex items-center gap-2">
                  <button
                    type="button"
                    class="inline-flex h-10 items-center rounded-xl border border-slate-300 px-4 text-sm font-medium text-slate-600 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                    @click="closeEditDrawer"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    class="inline-flex h-10 items-center gap-1.5 rounded-xl bg-blue-600 px-4 text-sm font-medium text-white transition hover:bg-blue-700 disabled:opacity-60"
                    :disabled="isSavingActiveEditRecord()"
                    @click="saveActiveEditRecord"
                  >
                    <Save class="h-4 w-4" /> Save Changes
                  </button>
                </div>
              </div>
            </div>
          </div>
        </Transition>
      </div>
    </Transition>

    <Modal :show="pdfLocate.open" max-width="full" @close="closePdfLocate">
      <template #header>
        <div class="flex items-center justify-between gap-4">
          <span class="text-base font-semibold text-slate-900 dark:text-slate-100">{{ pdfLocate.title || 'Source Locator' }}</span>
        </div>
      </template>

      <div class="h-[78vh] min-h-[520px]">
        <div v-if="pdfLocate.notice" class="mb-2 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
          {{ pdfLocate.notice }}
        </div>
        <PdfViewerWithHighlight
          v-if="pdfLocate.pdfUrl"
          :src="pdfLocate.pdfUrl"
          :highlights="pdfLocate.highlights"
          :active-id="pdfLocate.activeHighlightId"
          @highlight-click="onPdfLocateHighlightClick"
        />
      </div>
    </Modal>

    <Modal :show="structurePreview.open" max-width="4xl" @close="closeStructurePreview">
      <template #header>
        <div class="flex items-center justify-between gap-4">
          <span class="text-base font-semibold text-slate-900 dark:text-slate-100">
            Chemical Structure · {{ structurePreview.title || 'Preview' }}
          </span>
        </div>
      </template>

      <div class="grid gap-4 md:grid-cols-2">
        <div v-if="structurePreview.cationSmiles">
          <MoleculeViewer
            :smiles="structurePreview.cationSmiles"
            :label="structurePreview.cationLabel"
            size="full"
          />
        </div>
        <div v-if="structurePreview.anionSmiles">
          <MoleculeViewer
            :smiles="structurePreview.anionSmiles"
            :label="structurePreview.anionLabel"
            size="full"
          />
        </div>
      </div>
    </Modal>

    <div v-if="imagePreview.open" class="fixed inset-0 z-50 bg-black/70 p-6 dark:bg-slate-950/85" @click.self="closeImagePreview">
      <div class="mx-auto flex h-full max-w-6xl flex-col rounded-lg bg-white shadow-2xl dark:border dark:border-slate-800 dark:bg-slate-950">
        <div class="flex items-center justify-between border-b px-4 py-3 dark:border-slate-800">
          <div class="text-sm font-medium text-slate-700 dark:text-slate-200">{{ imagePreview.title }}</div>
          <div class="flex items-center gap-2 text-xs">
            <button class="rounded border px-2 py-1 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800" @click="zoomOutPreview">-</button>
            <span class="w-12 text-center">{{ Math.round(imagePreview.scale * 100) }}%</span>
            <button class="rounded border px-2 py-1 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800" @click="zoomInPreview">+</button>
            <button class="rounded border px-2 py-1 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800" @click="resetPreviewZoom">Reset</button>
            <button class="rounded border px-2 py-1 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800" @click="closeImagePreview">Close</button>
          </div>
        </div>
        <div class="flex-1 overflow-auto bg-slate-100 p-4 dark:bg-slate-900" @wheel.prevent="onPreviewWheel">
          <div class="mx-auto w-fit">
            <img
              :src="imagePreview.src"
              alt="Evidence preview"
              class="block max-w-none rounded border border-slate-300 bg-white shadow dark:border-slate-700 dark:bg-slate-950"
              :style="{ transform: `scale(${imagePreview.scale})`, transformOrigin: 'top center' }"
            />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
