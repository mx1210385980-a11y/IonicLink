<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, toRef } from 'vue'
import {
  searchRecords,
  type RecordResponse,
  type EvidenceResult,
} from '@/lib/api'
import type {
  EvidenceSnippet as InteractiveEvidenceSnippet,
  EvidenceTagType as InteractiveEvidenceTagType,
  RowData as InteractiveEvidenceRow,
} from '@/components/InteractiveEvidencePanel'
import {
  Search,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronDown,
  BookOpen,
  Save,
  ExternalLink,
  Edit,
  Download,
  SlidersHorizontal,
  FlaskConical,
  Waves,
  X,
} from 'lucide-vue-next'
import ConfidencePanel from '@/components/integrated-explorer/ConfidencePanel.vue'
import RecordCard from '@/components/integrated-explorer/RecordCard.vue'
import RecordTable from '@/components/integrated-explorer/RecordTable.vue'
import Modal from '@/components/ui/Modal.vue'
import InteractiveEvidencePanelHost from '@/components/InteractiveEvidencePanelHost.vue'
import PdfViewerWithHighlight from '@/components/PdfViewerWithHighlight.vue'
import MoleculeViewer from '@/components/MoleculeViewer.vue'
import RelationshipGraphPanel from '@/components/RelationshipGraphPanel.vue'
import { useEvidencePanel } from '@/composables/useEvidencePanel'
import { useRecordEditing } from '@/composables/useRecordEditing'
import { useRecordSearch } from '@/composables/useRecordSearch'
import type { HighlightRect } from '@/types/pdf-highlight'
import {
  cofDisplay,
  conditionGroupClass,
  conditionGroups,
  confidenceDisplay,
  confidenceValueFor,
  formatIonicLiquidHtml,
  tribopairDisplay,
} from '@/lib/integratedExplorerHelpers'

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
const showExportMenu = ref(false)
const exporting = ref(false)
type ExportFormat = 'json' | 'csv' | 'ndjson'

const {
  loading,
  result,
  filterOptions,
  selectedLubricant,
  selectedProbeMaterial,
  selectedSubstrateMaterial,
  selectedSubstrateCoating,
  selectedSpeedValue,
  selectedTemperatureValue,
  selectedPotentialValue,
  selectedWaterContentValue,
  searchDoi,
  loadMin,
  loadMax,
  cofMin,
  cofMax,
  currentPage,
  resultView,
  graphRefreshKey,
  totalPages,
  rangeStart,
  rangeEnd,
  currentFilter,
  isLoadRangeInvalid,
  isCofRangeInvalid,
  hasInvalidManualRange,
  manualFilterChips,
  activeManualFilterCount,
  hasManualFilters,
  buildCurrentFilter,
  markGraphDirty,
  loadOptions,
  fetchData,
  handleSearch,
  clearAdvancedSearch,
  goToPage,
  clearDoiFilter,
} = useRecordSearch({
  initialDoi: toRef(props, 'initialDoi'),
  selectedFileId: toRef(props, 'selectedFileId'),
  pageSize: PAGE_SIZE,
})

const advancedSearchSummary = computed(() => {
  if (!hasManualFilters.value) {
    return 'Use workspace filters to refine the current record set. Manual filters here override linked dashboard selections for the same dimension.'
  }
  return `Manual workspace filters active: ${activeManualFilterCount.value}. These conditions are applied on top of the current dataset view.`
})

type AdvancedFilterTab = 'tribopair' | 'conditions' | 'windows'
type AdvancedFilterState = {
  lubricant: string
  probe: string
  substrate: string
  coating: string
  speed: string
  temperature: string
  potential: string
  water: string
  loadMin: string
  loadMax: string
  cofMin: string
  cofMax: string
}

const showAdvancedFilters = ref(true)
const activeAdvancedFilterTab = ref<AdvancedFilterTab>('tribopair')
const appliedAdvancedFilterState = ref<AdvancedFilterState>(captureAdvancedFilterState())

function captureAdvancedFilterState(): AdvancedFilterState {
  return {
    lubricant: selectedLubricant.value,
    probe: selectedProbeMaterial.value,
    substrate: selectedSubstrateMaterial.value,
    coating: selectedSubstrateCoating.value,
    speed: selectedSpeedValue.value,
    temperature: selectedTemperatureValue.value,
    potential: selectedPotentialValue.value,
    water: selectedWaterContentValue.value,
    loadMin: loadMin.value,
    loadMax: loadMax.value,
    cofMin: cofMin.value,
    cofMax: cofMax.value,
  }
}

function restoreAdvancedFilterState(state: AdvancedFilterState) {
  selectedLubricant.value = state.lubricant
  selectedProbeMaterial.value = state.probe
  selectedSubstrateMaterial.value = state.substrate
  selectedSubstrateCoating.value = state.coating
  selectedSpeedValue.value = state.speed
  selectedTemperatureValue.value = state.temperature
  selectedPotentialValue.value = state.potential
  selectedWaterContentValue.value = state.water
  loadMin.value = state.loadMin
  loadMax.value = state.loadMax
  cofMin.value = state.cofMin
  cofMax.value = state.cofMax
}

function applyAdvancedFilters() {
  handleSearch()
  appliedAdvancedFilterState.value = captureAdvancedFilterState()
}

function cancelAdvancedFilters() {
  restoreAdvancedFilterState(appliedAdvancedFilterState.value)
  showAdvancedFilters.value = false
}

function toggleAdvancedFilters() {
  showAdvancedFilters.value = !showAdvancedFilters.value
}

function clearAllAdvancedFilters() {
  clearAdvancedSearch()
  appliedAdvancedFilterState.value = captureAdvancedFilterState()
}

function removeAdvancedSearchChip(id: string) {
  if (id === 'manual-lubricant') selectedLubricant.value = ''
  if (id === 'manual-probe') selectedProbeMaterial.value = ''
  if (id === 'manual-substrate') selectedSubstrateMaterial.value = ''
  if (id === 'manual-coating') selectedSubstrateCoating.value = ''
  if (id === 'manual-speed') selectedSpeedValue.value = ''
  if (id === 'manual-temperature') selectedTemperatureValue.value = ''
  if (id === 'manual-potential') selectedPotentialValue.value = ''
  if (id === 'manual-water') selectedWaterContentValue.value = ''
  if (id === 'manual-load') {
    loadMin.value = ''
    loadMax.value = ''
  }
  if (id === 'manual-cof') {
    cofMin.value = ''
    cofMax.value = ''
  }
  handleSearch()
  appliedAdvancedFilterState.value = captureAdvancedFilterState()
}

const {
  evidenceModalRecord,
  evidenceData,
  evidenceLoading,
  evidenceError,
  closeEvidenceModal,
  openEvidenceModal,
} = useEvidencePanel()

const {
  deletingRowId,
  editDrawerRecord,
  activeEditValues,
  openEditModal,
  closeEditDrawer,
  updateActiveEditingField,
  saveActiveEditRecord,
  isSavingActiveEditRecord,
  removeRecord,
} = useRecordEditing({
  result,
  evidenceData,
  evidenceModalRecord,
  markGraphDirty,
})

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
  semantic_type?: string | null
  inferred?: boolean
  snippet_text?: string | null
  image_b64?: string | null
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

const activeEvidenceRow = computed<InteractiveEvidenceRow | null>(() => {
  if (!evidenceModalRecord.value) return null
  return buildInteractiveEvidenceRow(evidenceModalRecord.value)
})
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

function evidenceTermImageSrc(hit: EvidenceTermHit | null | undefined): string | null {
  if (!hit?.image_b64) return null
  return `data:image/png;base64,${hit.image_b64}`
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

function normalizeEvidenceTargets(value: string | Array<string | null | undefined> | null | undefined): string[] {
  const items = Array.isArray(value) ? value : [value]
  const seen = new Set<string>()
  const normalized: string[] = []
  for (const item of items) {
    const text = String(item || '').trim()
    if (!text || seen.has(text)) continue
    seen.add(text)
    normalized.push(text)
  }
  return normalized
}

function buildInteractiveEvidenceSnippet(
  record: RecordResponse,
  section: string,
  target: string | Array<string | null | undefined> | null | undefined,
  options?: {
    fallbackPage?: number | null
    preferImage?: boolean
    semanticTypes?: string[]
    previewLabel?: string
    previewHtml?: string
    allowFallbackBoundingBox?: boolean
  },
): InteractiveEvidenceSnippet | undefined {
  const ev = evidenceData.value[record.id]
  const normalizedTargets = normalizeEvidenceTargets(target)
  const normalizedTarget = normalizedTargets[0]
  const hit = normalizedTargets.length ? findBestTermHit(ev, normalizedTargets, options?.semanticTypes) : null
  const allowsImageOnlyFallback = Boolean(options?.preferImage && isVisualEvidenceSource(ev))
  const requiresResolvedHit = !allowsImageOnlyFallback
  if (requiresResolvedHit && !hit) return undefined
  const page = normalizeEvidencePage(hit?.page, options?.fallbackPage, ev?.page, record.evidencePage, record.sourcePage)
  const text = firstNonEmpty(hit?.snippet_text, ev?.text_snippet, ev?.evidence_text, record.evidence)
  const hitImageSrc = evidenceTermImageSrc(hit)
  const previewSrc = evidenceImageSrc(record.id) || evidencePagePreviewSrc(record.id)
  const shouldUseHitImage = Boolean(hitImageSrc && isVisualEvidenceSource(ev))
  const shouldUseImage = Boolean(options?.preferImage && previewSrc && isVisualEvidenceSource(ev))
  const previewLabel = firstNonEmpty(
    normalizeTraceDisplayText(options?.previewLabel),
    normalizedTargets.length > 1
      ? normalizedTargets.map((item) => normalizeTraceDisplayText(item)).join(' · ')
      : normalizeTraceDisplayText(normalizedTarget),
  )

  if (shouldUseHitImage) {
    return {
      page,
      section,
      type: 'image',
      target: normalizedTarget,
      highlightTargets: normalizedTargets.length > 1 ? normalizedTargets : undefined,
      previewLabel,
      previewHtml: options?.previewHtml,
      imageUrl: hitImageSrc || undefined,
      boundingBox: hit?.bbox || undefined,
    }
  }

  if (shouldUseImage) {
    return {
      page,
      section,
      type: 'image',
      target: normalizedTarget,
      highlightTargets: normalizedTargets.length > 1 ? normalizedTargets : undefined,
      previewLabel,
      previewHtml: options?.previewHtml,
      imageUrl: previewSrc || undefined,
      boundingBox: hit?.bbox || (options?.allowFallbackBoundingBox ? ev?.bbox || undefined : undefined),
    }
  }

  if (!text || !normalizedTarget) return undefined

  return {
    page,
    section,
    type: 'text',
    text,
    target: normalizedTarget,
    highlightTargets: normalizedTargets.length > 1 ? normalizedTargets : undefined,
    previewLabel,
    previewHtml: options?.previewHtml,
    boundingBox: hit?.bbox || undefined,
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
      semanticTypes: ['cof'],
      allowFallbackBoundingBox: true,
    }) ||
    buildInteractiveEvidenceSnippet(record, 'Primary evidence', cofTarget, {
      fallbackPage: primaryPage,
      semanticTypes: ['cof'],
    })

  if (!cof) return null

  const ionicLiquid = buildInteractiveEvidenceSnippet(record, 'Ionic liquid', record.lubricant, {
    fallbackPage: primaryPage,
    semanticTypes: ['lubricant'],
    previewLabel: record.lubricant || undefined,
    previewHtml: formatIonicLiquidHtml(record.lubricant),
  })
  const surface = buildInteractiveEvidenceSnippet(
    record,
    'Surface / substrate',
    firstNonEmpty(record.substrateMaterial, record.substrateCoating, record.materialName),
    {
      fallbackPage: primaryPage,
      semanticTypes: ['material'],
      previewLabel: firstNonEmpty(record.substrateMaterial, record.substrateCoating, record.materialName),
    },
  )
  const speed = buildInteractiveEvidenceSnippet(
    record,
    'Slip velocity',
    record.speedValue,
    {
      fallbackPage: primaryPage,
      preferImage: true,
      semanticTypes: ['speed'],
      previewLabel: record.speedValue || undefined,
    },
  )
  const load = buildInteractiveEvidenceSnippet(
    record,
    'Load range',
    record.loadValue,
    {
      fallbackPage: primaryPage,
      preferImage: true,
      semanticTypes: ['load'],
      previewLabel: record.loadValue || undefined,
    },
  )
  const condition = buildInteractiveEvidenceSnippet(
    record,
    'Condition',
    [record.potential, record.waterContent],
    {
      fallbackPage: primaryPage,
      semanticTypes: ['potential', 'water_content'],
      previewLabel: [record.potential, record.waterContent].filter((value) => String(value || '').trim()).join(' · ') || undefined,
    },
  )
  const temperature = buildInteractiveEvidenceSnippet(record, 'Temperature', record.temperature, {
    fallbackPage: primaryPage,
    semanticTypes: ['temperature'],
    previewLabel: record.temperature || undefined,
  })

  return {
    id: record.id,
    evidenceType: 'multi-snippet',
    evidenceMap: {
      cof,
      ionicLiquid,
      surface,
      speed,
      load,
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
  if (tag === 'speed') return 'rgba(14, 165, 233, 0.35)'
  if (tag === 'load') return 'rgba(6, 182, 212, 0.35)'
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
    .replace(/Î¼|Âµ|渭|碌/g, 'u')
    .replace(/[^a-z0-9]/g, '')
    .replace(/\s+/g, '')
    .replace(/[()=:,.;]/g, '')
}

function normalizeTraceDisplayText(input: string | null | undefined): string {
  return String(input || '')
    .trim()
    .replace(/[\u03bc\u00b5]/g, 'μ')
    .replace(/Î¼|Âµ|渭|碌/g, 'μ')
    .replace(/\s+/g, ' ')
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

function findBestTermHitWithinHits(hits: EvidenceTermHit[], term: string): EvidenceTermHit | null {
  const termRaw = String(term || '').trim()
  if (!termRaw) return null
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
  if (termNums.length && numericConsistent.length === 0) return null
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

function findBestTermHit(
  ev: EvidenceResult | null | undefined,
  term: string | string[],
  semanticTypes?: string[],
): EvidenceTermHit | null {
  const hits = Array.isArray(ev?.term_hits) ? (ev?.term_hits as EvidenceTermHit[]) : []
  if (!hits.length) return null

  const normalizedTerms = (Array.isArray(term) ? term : [term])
    .map((value) => String(value || '').trim())
    .filter(Boolean)
  if (!normalizedTerms.length) return null

  const semanticSet = new Set(
    (semanticTypes || [])
      .map((value) => String(value || '').trim().toLowerCase())
      .filter(Boolean),
  )
  const semanticallyMatchedHits = semanticSet.size
    ? hits.filter((hit) => semanticSet.has(String(hit.semantic_type || '').trim().toLowerCase()))
    : []
  const hitPools = semanticallyMatchedHits.length ? [semanticallyMatchedHits, hits] : [hits]

  for (const hitPool of hitPools) {
    for (const candidateTerm of normalizedTerms) {
      const match = findBestTermHitWithinHits(hitPool, candidateTerm)
      if (match) return match
    }
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

function clearDoiSearch() {
  clearDoiFilter(() => emit('clear-doi'))
}

function handleOpenEvidenceModal(record: RecordResponse) {
  closeEditDrawer()
  openEvidenceModal(record)
}

function handleOpenEditModal(record: RecordResponse) {
  closeEvidenceModal()
  openEditModal(record)
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

onMounted(async () => {
  await loadOptions()
  await fetchData()
  appliedAdvancedFilterState.value = captureAdvancedFilterState()
  window.addEventListener('keydown', onGlobalKeydown)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onGlobalKeydown)
})
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

      <section class="mb-6 overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-[0_18px_60px_-40px_rgba(15,23,42,0.4)] dark:border-slate-800 dark:bg-slate-950/85">
        <div class="space-y-4 p-4 md:p-5">
          <div class="flex flex-col gap-3 xl:flex-row xl:items-center">
            <div class="relative min-w-0 flex-1">
              <Search class="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                v-model="searchDoi"
                type="text"
                placeholder="Search by Literature DOI..."
                class="h-12 w-full rounded-2xl border border-slate-200 bg-slate-50/60 pl-11 pr-12 text-sm text-slate-700 shadow-sm transition focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-4 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-900/80 dark:text-slate-200 dark:placeholder:text-slate-500 dark:focus:border-blue-500 dark:focus:bg-slate-900 dark:focus:ring-blue-500/10"
                @keydown.enter.prevent="applyAdvancedFilters"
              />
              <button
                v-if="searchDoi"
                type="button"
                class="absolute right-3 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-200 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                @click="clearDoiSearch"
              >
                <X class="h-4 w-4" />
              </button>
            </div>

            <div class="flex flex-wrap items-center gap-2">
              <span v-if="props.selectedFileId && props.sourceName" class="rounded-full border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-300">
                Source: {{ props.sourceName }}
              </span>
              <span v-else class="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
                Showing all data
              </span>

              <button
                v-for="chip in manualFilterChips"
                :key="chip.id"
                type="button"
                class="inline-flex items-center gap-2 rounded-2xl border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 transition hover:border-blue-300 hover:bg-blue-100/80 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-200 dark:hover:bg-blue-500/15"
                @click="removeAdvancedSearchChip(chip.id)"
              >
                <span>{{ chip.label }}: {{ chip.value }}</span>
                <X class="h-3.5 w-3.5" />
              </button>

              <button
                v-if="hasManualFilters"
                type="button"
                class="px-2 py-1 text-sm text-slate-500 underline-offset-4 transition hover:text-slate-800 hover:underline dark:text-slate-400 dark:hover:text-slate-200"
                @click="clearAllAdvancedFilters"
              >
                Clear all
              </button>

              <button
                type="button"
                class="inline-flex h-12 items-center gap-2 rounded-2xl bg-blue-600 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
                @click="toggleAdvancedFilters"
              >
                <SlidersHorizontal class="h-4 w-4" />
                <span>Advanced Filters</span>
                <span class="inline-flex min-w-6 items-center justify-center rounded-full bg-white/20 px-1.5 py-0.5 text-xs font-bold">
                  {{ activeManualFilterCount }}
                </span>
                <ChevronUp v-if="showAdvancedFilters" class="h-4 w-4" />
                <ChevronDown v-else class="h-4 w-4" />
              </button>
            </div>
          </div>

          <p class="text-xs leading-5 text-slate-500 dark:text-slate-400">
            {{ advancedSearchSummary }}
          </p>
        </div>

        <div v-if="showAdvancedFilters" class="grid border-t border-slate-200 dark:border-slate-800 lg:grid-cols-[220px_minmax(0,1fr)]">
          <div class="border-b border-slate-200 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-900/50 lg:border-b-0 lg:border-r">
            <div class="space-y-2">
              <button
                type="button"
                class="flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left text-sm font-medium transition"
                :class="activeAdvancedFilterTab === 'tribopair'
                  ? 'bg-blue-50 text-blue-700 shadow-sm dark:bg-blue-500/10 dark:text-blue-300'
                  : 'text-slate-600 hover:bg-white hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-950 dark:hover:text-slate-100'"
                @click="activeAdvancedFilterTab = 'tribopair'"
              >
                <FlaskConical class="h-4 w-4" />
                <div>
                  <div>Tribopair Layers</div>
                  <div class="text-xs font-normal text-slate-400 dark:text-slate-500">Probe, substrate, coating</div>
                </div>
              </button>
              <button
                type="button"
                class="flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left text-sm font-medium transition"
                :class="activeAdvancedFilterTab === 'conditions'
                  ? 'bg-blue-50 text-blue-700 shadow-sm dark:bg-blue-500/10 dark:text-blue-300'
                  : 'text-slate-600 hover:bg-white hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-950 dark:hover:text-slate-100'"
                @click="activeAdvancedFilterTab = 'conditions'"
              >
                <SlidersHorizontal class="h-4 w-4" />
                <div>
                  <div>Conditions</div>
                  <div class="text-xs font-normal text-slate-400 dark:text-slate-500">Speed, temp, potential, water</div>
                </div>
              </button>
              <button
                type="button"
                class="flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left text-sm font-medium transition"
                :class="activeAdvancedFilterTab === 'windows'
                  ? 'bg-blue-50 text-blue-700 shadow-sm dark:bg-blue-500/10 dark:text-blue-300'
                  : 'text-slate-600 hover:bg-white hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-950 dark:hover:text-slate-100'"
                @click="activeAdvancedFilterTab = 'windows'"
              >
                <Waves class="h-4 w-4" />
                <div>
                  <div>Data Windows</div>
                  <div class="text-xs font-normal text-slate-400 dark:text-slate-500">Load and COF ranges</div>
                </div>
              </button>
            </div>
          </div>

          <div class="p-4 md:p-5">
            <div class="mb-5">
              <h3 class="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
                {{ activeAdvancedFilterTab === 'tribopair' ? 'Tribopair Layers' : activeAdvancedFilterTab === 'conditions' ? 'Conditions' : 'Data Windows' }}
              </h3>
              <p class="mt-2 text-sm text-slate-500 dark:text-slate-400">
                {{
                  activeAdvancedFilterTab === 'tribopair'
                    ? 'Layered material filters narrow records by counterface structure instead of a single merged surface label.'
                    : activeAdvancedFilterTab === 'conditions'
                      ? 'Match exact recorded operating conditions for speed, temperature, electrochemical potential, and water content.'
                      : 'Use numeric windows to constrain load and COF while keeping other condition filters independent.'
                }}
              </p>
            </div>

            <div v-if="activeAdvancedFilterTab === 'tribopair'" class="grid gap-4 xl:grid-cols-4">
              <div class="min-w-0">
                <div class="mb-1.5 flex items-center justify-between gap-2">
                  <label class="block text-xs font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">Ionic Liquid</label>
                  <span class="text-[11px] text-slate-400 dark:text-slate-500">{{ filterOptions.lubricants.length }} options</span>
                </div>
                <select
                  v-model="selectedLubricant"
                  class="h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm text-slate-700 transition focus:border-blue-400 focus:outline-none focus:ring-4 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-blue-500 dark:focus:ring-blue-500/10"
                >
                  <option value="">All Ionic Liquids</option>
                  <option v-for="l in filterOptions.lubricants" :key="l" :value="l">{{ l }}</option>
                </select>
              </div>
              <div class="min-w-0">
                <div class="mb-1.5 flex items-center justify-between gap-2">
                  <label class="block text-xs font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">Probe Material</label>
                  <span class="text-[11px] text-slate-400 dark:text-slate-500">{{ filterOptions.probeMaterials.length }} options</span>
                </div>
                <select
                  v-model="selectedProbeMaterial"
                  class="h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm text-slate-700 transition focus:border-blue-400 focus:outline-none focus:ring-4 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-blue-500 dark:focus:ring-blue-500/10"
                >
                  <option value="">All Probes</option>
                  <option v-for="m in filterOptions.probeMaterials" :key="m" :value="m">{{ m }}</option>
                </select>
              </div>
              <div class="min-w-0">
                <div class="mb-1.5 flex items-center justify-between gap-2">
                  <label class="block text-xs font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">Substrate</label>
                  <span class="text-[11px] text-slate-400 dark:text-slate-500">{{ filterOptions.substrateMaterials.length }} options</span>
                </div>
                <select
                  v-model="selectedSubstrateMaterial"
                  class="h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm text-slate-700 transition focus:border-blue-400 focus:outline-none focus:ring-4 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-blue-500 dark:focus:ring-blue-500/10"
                >
                  <option value="">All Substrates</option>
                  <option v-for="m in filterOptions.substrateMaterials" :key="m" :value="m">{{ m }}</option>
                </select>
              </div>
              <div class="min-w-0">
                <div class="mb-1.5 flex items-center justify-between gap-2">
                  <label class="block text-xs font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">Coating</label>
                  <span class="text-[11px] text-slate-400 dark:text-slate-500">{{ filterOptions.substrateCoatings.length }} options</span>
                </div>
                <select
                  v-model="selectedSubstrateCoating"
                  class="h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm text-slate-700 transition focus:border-blue-400 focus:outline-none focus:ring-4 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-blue-500 dark:focus:ring-blue-500/10"
                >
                  <option value="">All Coatings</option>
                  <option v-for="m in filterOptions.substrateCoatings" :key="m" :value="m">{{ m }}</option>
                </select>
              </div>
            </div>

            <div v-else-if="activeAdvancedFilterTab === 'conditions'" class="grid gap-4 xl:grid-cols-4">
              <div>
                <label class="mb-1.5 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">Speed</label>
                <select
                  v-model="selectedSpeedValue"
                  class="h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm text-slate-700 transition focus:border-blue-400 focus:outline-none focus:ring-4 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-blue-500 dark:focus:ring-blue-500/10"
                >
                  <option value="">All Speeds</option>
                  <option v-for="value in filterOptions.speedValues" :key="value" :value="value">{{ value }}</option>
                </select>
              </div>
              <div>
                <label class="mb-1.5 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">Temperature</label>
                <select
                  v-model="selectedTemperatureValue"
                  class="h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm text-slate-700 transition focus:border-blue-400 focus:outline-none focus:ring-4 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-blue-500 dark:focus:ring-blue-500/10"
                >
                  <option value="">All Temperatures</option>
                  <option v-for="value in filterOptions.temperatureValues" :key="value" :value="value">{{ value }}</option>
                </select>
              </div>
              <div>
                <label class="mb-1.5 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">Potential</label>
                <select
                  v-model="selectedPotentialValue"
                  class="h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm text-slate-700 transition focus:border-blue-400 focus:outline-none focus:ring-4 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-blue-500 dark:focus:ring-blue-500/10"
                >
                  <option value="">All Potentials</option>
                  <option v-for="value in filterOptions.potentialValues" :key="value" :value="value">{{ value }}</option>
                </select>
              </div>
              <div>
                <label class="mb-1.5 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">Water Content</label>
                <select
                  v-model="selectedWaterContentValue"
                  class="h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm text-slate-700 transition focus:border-blue-400 focus:outline-none focus:ring-4 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-blue-500 dark:focus:ring-blue-500/10"
                >
                  <option value="">All Water Levels</option>
                  <option v-for="value in filterOptions.waterContentValues" :key="value" :value="value">{{ value }}</option>
                </select>
              </div>
            </div>

            <div v-else class="grid gap-4 xl:grid-cols-2">
              <div class="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-900/60">
                <label class="mb-2 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">Load Window</label>
                <div class="flex items-center gap-3">
                  <input
                    v-model="loadMin"
                    type="text"
                    inputmode="decimal"
                    placeholder="Min"
                    class="h-12 w-full rounded-2xl border bg-white px-4 text-sm text-slate-700 transition focus:border-blue-400 focus:outline-none focus:ring-4 focus:ring-blue-100 dark:bg-slate-950 dark:text-slate-200 dark:focus:border-blue-500 dark:focus:ring-blue-500/10"
                    :class="isLoadRangeInvalid ? 'border-rose-300 dark:border-rose-500/40' : 'border-slate-200 dark:border-slate-700'"
                    @keydown.enter.prevent="applyAdvancedFilters"
                  />
                  <span class="text-slate-300 dark:text-slate-600">-</span>
                  <input
                    v-model="loadMax"
                    type="text"
                    inputmode="decimal"
                    placeholder="Max"
                    class="h-12 w-full rounded-2xl border bg-white px-4 text-sm text-slate-700 transition focus:border-blue-400 focus:outline-none focus:ring-4 focus:ring-blue-100 dark:bg-slate-950 dark:text-slate-200 dark:focus:border-blue-500 dark:focus:ring-blue-500/10"
                    :class="isLoadRangeInvalid ? 'border-rose-300 dark:border-rose-500/40' : 'border-slate-200 dark:border-slate-700'"
                    @keydown.enter.prevent="applyAdvancedFilters"
                  />
                </div>
                <p class="mt-2 text-xs" :class="isLoadRangeInvalid ? 'text-rose-500 dark:text-rose-300' : 'text-slate-500 dark:text-slate-400'">
                  {{ isLoadRangeInvalid ? 'Enter valid numbers and keep Min <= Max.' : 'Numeric load filter in recorded units.' }}
                </p>
              </div>

              <div class="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-900/60">
                <label class="mb-2 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">COF Window</label>
                <div class="flex items-center gap-3">
                  <input
                    v-model="cofMin"
                    type="text"
                    inputmode="decimal"
                    placeholder="Min"
                    class="h-12 w-full rounded-2xl border bg-white px-4 text-sm text-slate-700 transition focus:border-blue-400 focus:outline-none focus:ring-4 focus:ring-blue-100 dark:bg-slate-950 dark:text-slate-200 dark:focus:border-blue-500 dark:focus:ring-blue-500/10"
                    :class="isCofRangeInvalid ? 'border-rose-300 dark:border-rose-500/40' : 'border-slate-200 dark:border-slate-700'"
                    @keydown.enter.prevent="applyAdvancedFilters"
                  />
                  <span class="text-slate-300 dark:text-slate-600">-</span>
                  <input
                    v-model="cofMax"
                    type="text"
                    inputmode="decimal"
                    placeholder="Max"
                    class="h-12 w-full rounded-2xl border bg-white px-4 text-sm text-slate-700 transition focus:border-blue-400 focus:outline-none focus:ring-4 focus:ring-blue-100 dark:bg-slate-950 dark:text-slate-200 dark:focus:border-blue-500 dark:focus:ring-blue-500/10"
                    :class="isCofRangeInvalid ? 'border-rose-300 dark:border-rose-500/40' : 'border-slate-200 dark:border-slate-700'"
                    @keydown.enter.prevent="applyAdvancedFilters"
                  />
                </div>
                <p class="mt-2 text-xs" :class="isCofRangeInvalid ? 'text-rose-500 dark:text-rose-300' : 'text-slate-500 dark:text-slate-400'">
                  {{ isCofRangeInvalid ? 'Enter valid numbers and keep Min <= Max.' : 'Supports partial range filtering.' }}
                </p>
              </div>
            </div>

            <div class="mt-6 flex items-center justify-end gap-3 border-t border-slate-200 pt-5 dark:border-slate-800">
              <button
                type="button"
                class="rounded-2xl px-4 py-2.5 text-sm font-medium text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-900 dark:hover:text-slate-200"
                @click="cancelAdvancedFilters"
              >
                Cancel
              </button>
              <button
                type="button"
                class="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-slate-900 px-5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200"
                :disabled="hasInvalidManualRange"
                @click="applyAdvancedFilters"
              >
                <Search class="h-4 w-4" />
                Apply Filters
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>

    <div class="flex-1 overflow-auto px-6 py-4">
      <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div class="inline-flex rounded-full border border-slate-200 bg-white p-1 shadow-sm dark:border-slate-800 dark:bg-slate-950/80">
          <button
            type="button"
            class="rounded-full px-4 py-2 text-sm font-semibold transition"
            :class="resultView === 'table'
              ? 'bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300'
              : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'"
            @click="resultView = 'table'"
          >
            数据表
          </button>
          <button
            type="button"
            class="rounded-full px-4 py-2 text-sm font-semibold transition"
            :class="resultView === 'graph'
              ? 'bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300'
              : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'"
            @click="resultView = 'graph'"
          >
            关系图谱
          </button>
        </div>
        <p class="text-xs text-slate-500 dark:text-slate-400">
          图谱基于当前筛选结果生成，点击节点或边查看参数关系明细。
        </p>
      </div>

      <RelationshipGraphPanel
        v-if="resultView === 'graph'"
        :filter="currentFilter"
        :active="resultView === 'graph'"
        :refresh-key="graphRefreshKey"
      />

      <RecordTable
        v-else
        :loading="loading"
        :records="result.items"
        :deleting-row-id="deletingRowId"
        :evidence-data="evidenceData"
        :structure-preview-open="structurePreview.open"
        :structure-preview-row-id="structurePreview.rowId"
        :open-evidence-modal="handleOpenEvidenceModal"
        :open-edit-modal="handleOpenEditModal"
        :remove-record="removeRecord"
        :open-structure-preview="openStructurePreview"
      />
    </div>

    <div v-if="resultView === 'table'" class="flex items-center justify-between border-t bg-white px-6 py-3 text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-950/80 dark:text-slate-400">
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
              @click="handleOpenEditModal(evidenceModalRecord)"
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
          <RecordCard
            :record="evidenceModalRecord"
            :evidence="evidenceData[evidenceModalRecord.id] || null"
            eyebrow="Selected Record"
          />

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

          <ConfidencePanel
            :record="evidenceModalRecord"
            :evidence="evidenceData[evidenceModalRecord.id] || null"
            delta-mode="evidence"
          />
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


