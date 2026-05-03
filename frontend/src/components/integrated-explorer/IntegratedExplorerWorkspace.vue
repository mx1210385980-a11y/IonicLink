<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, toRef, watch } from 'vue'
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
  Save,
  ExternalLink,
  Edit,
  SlidersHorizontal,
  X,
  Check,
  Layers,
  ChevronsLeft,
  ChevronsRight,
} from 'lucide-vue-next'
import ConfidencePanel from '@/components/integrated-explorer/ConfidencePanel.vue'
import RecordCard from '@/components/integrated-explorer/RecordCard.vue'
import RecordTable from '@/components/integrated-explorer/RecordTable.vue'
import Modal from '@/components/ui/Modal.vue'
import InteractiveEvidencePanelHost from '@/components/InteractiveEvidencePanelHost.vue'
import PdfViewerWithHighlight from '@/components/PdfViewerWithHighlight.vue'
import MoleculeViewer from '@/components/MoleculeViewer.vue'
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
  lubricantDisplay,
  lubricantStructureItems,
  tribopairDisplay,
  tribopairParts,
  tribopairExtras,
  surfaceRoughnessBadge,
  type IonStructurePreviewItem,
} from '@/lib/integratedExplorerHelpers'
import { normalizePotentialDisplayText } from '@/lib/potential'

const props = defineProps<{
  initialDoi?: string
  sourceName?: string
  literatureMetadata?: any
  selectedFileId?: string | null
  focusRecordId?: number | null
  externalExportRequest?: { id: number, format: ExportFormat } | null
}>()

const emit = defineEmits<{
  'view-literature': [payload?: { literatureId?: number | null, recordId?: number | null }]
  'clear-doi': []
  'clear-source': []
  'clear-focused-record': []
}>()

const PAGE_SIZE = 10
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
  selectedShearRateValue,
  selectedTemperatureValue,
  selectedPotentialValue,
  selectedWaterContentValue,
  searchDoi,
  loadMin,
  loadMax,
  cofMin,
  cofMax,
  currentPage,
  totalPages,
  rangeStart,
  rangeEnd,
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
    return props.selectedFileId
      ? '当前文献内浏览全部记录，可用高级筛选缩小到特定摩擦副、条件或区间。'
      : '可按 DOI 搜索，或点"高级筛选"按摩擦副 / 条件 / 区间精确筛选。'
  }
  return `已启用 ${activeManualFilterCount.value} 个筛选条件，结果在下表中实时更新。`
})

type AdvancedFilterState = {
  lubricant: string
  probe: string
  substrate: string
  coating: string
  speed: string
  shearRate: string
  temperature: string
  potential: string
  water: string
  loadMin: string
  loadMax: string
  cofMin: string
  cofMax: string
}

const showAdvancedFilters = ref(false)
const appliedAdvancedFilterState = ref<AdvancedFilterState>(captureAdvancedFilterState())

type AdvancedOptionKey =
  | 'lubricant'
  | 'probe'
  | 'substrate'
  | 'coating'
  | 'speed'
  | 'shearRate'
  | 'temperature'
  | 'potential'
  | 'water'

type AdvancedFilterField = {
  key: AdvancedOptionKey
  label: string
  group: '材料层' | '工况'
  description: string
  options: string[]
  selected: string
  accentClass: string
}

const ADVANCED_OPTION_LIMIT = 36
const activeAdvancedOptionKey = ref<AdvancedOptionKey>('lubricant')
const advancedOptionSearch = ref('')

const advancedFilterFields = computed<AdvancedFilterField[]>(() => [
  {
    key: 'lubricant',
    label: '离子液体',
    group: '材料层',
    description: '阳离子 / 阴离子体系',
    options: filterOptions.value.lubricants,
    selected: selectedLubricant.value,
    accentClass: 'bg-sky-500',
  },
  {
    key: 'probe',
    label: '探针材料',
    group: '材料层',
    description: '上表面或探针端',
    options: filterOptions.value.probeMaterials,
    selected: selectedProbeMaterial.value,
    accentClass: 'bg-cyan-500',
  },
  {
    key: 'substrate',
    label: '基底材料',
    group: '材料层',
    description: '下表面 / 基底',
    options: filterOptions.value.substrateMaterials,
    selected: selectedSubstrateMaterial.value,
    accentClass: 'bg-slate-700',
  },
  {
    key: 'coating',
    label: '涂层',
    group: '材料层',
    description: '氧化层、膜层、修饰层',
    options: filterOptions.value.substrateCoatings,
    selected: selectedSubstrateCoating.value,
    accentClass: 'bg-amber-500',
  },
  {
    key: 'speed',
    label: '滑移速度',
    group: '工况',
    description: '线速度，单位通常为 μm/s、mm/s',
    options: filterOptions.value.speedValues,
    selected: selectedSpeedValue.value,
    accentClass: 'bg-violet-500',
  },
  {
    key: 'shearRate',
    label: '剪切率',
    group: '工况',
    description: '速度梯度，单位通常为 s^-1',
    options: filterOptions.value.shearRateValues || [],
    selected: selectedShearRateValue.value,
    accentClass: 'bg-fuchsia-500',
  },
  {
    key: 'temperature',
    label: '温度',
    group: '工况',
    description: '室温、高温或低温',
    options: filterOptions.value.temperatureValues,
    selected: selectedTemperatureValue.value,
    accentClass: 'bg-rose-500',
  },
  {
    key: 'potential',
    label: '电势',
    group: '工况',
    description: '电化学窗口',
    options: filterOptions.value.potentialValues,
    selected: selectedPotentialValue.value,
    accentClass: 'bg-blue-500',
  },
  {
    key: 'water',
    label: '含水量',
    group: '工况',
    description: '水含量 / 湿度记录',
    options: filterOptions.value.waterContentValues,
    selected: selectedWaterContentValue.value,
    accentClass: 'bg-emerald-500',
  },
])

const emptyAdvancedFilterField: AdvancedFilterField = {
  key: 'lubricant',
  label: '离子液体',
  group: '材料层',
  description: '阳离子 / 阴离子体系',
  options: [],
  selected: '',
  accentClass: 'bg-sky-500',
}

const activeAdvancedFilterField = computed<AdvancedFilterField>(() => {
  return advancedFilterFields.value.find((field) => field.key === activeAdvancedOptionKey.value)
    || advancedFilterFields.value[0]
    || emptyAdvancedFilterField
})

const advancedTypedCandidate = computed(() => advancedOptionSearch.value.trim())

const matchingAdvancedOptions = computed(() => {
  const activeField = activeAdvancedFilterField.value
  const query = normalizeAdvancedOptionText(advancedOptionSearch.value)
  if (!query) return activeField.options
  return activeField.options.filter((option) => normalizeAdvancedOptionText(option).includes(query))
})

const visibleAdvancedOptions = computed(() => {
  const selectedValue = activeAdvancedFilterField.value.selected
  return [...matchingAdvancedOptions.value]
    .sort((a, b) => {
      if (a === selectedValue) return -1
      if (b === selectedValue) return 1
      return a.localeCompare(b)
    })
    .slice(0, ADVANCED_OPTION_LIMIT)
})

const hiddenAdvancedOptionCount = computed(() => {
  return Math.max(0, matchingAdvancedOptions.value.length - visibleAdvancedOptions.value.length)
})

function normalizeAdvancedOptionText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim()
}

function selectAdvancedFilterField(key: AdvancedOptionKey) {
  activeAdvancedOptionKey.value = key
  advancedOptionSearch.value = ''
}

function setAdvancedFilterValue(key: AdvancedOptionKey, value: string) {
  if (key === 'lubricant') selectedLubricant.value = value
  if (key === 'probe') selectedProbeMaterial.value = value
  if (key === 'substrate') selectedSubstrateMaterial.value = value
  if (key === 'coating') selectedSubstrateCoating.value = value
  if (key === 'speed') selectedSpeedValue.value = value
  if (key === 'shearRate') selectedShearRateValue.value = value
  if (key === 'temperature') selectedTemperatureValue.value = value
  if (key === 'potential') selectedPotentialValue.value = value
  if (key === 'water') selectedWaterContentValue.value = value
  advancedOptionSearch.value = ''
}

function clearAdvancedFilterValue(key: AdvancedOptionKey) {
  setAdvancedFilterValue(key, '')
}

function applyAdvancedTypedValue() {
  if (!advancedTypedCandidate.value) return
  setAdvancedFilterValue(activeAdvancedOptionKey.value, advancedTypedCandidate.value)
}

function captureAdvancedFilterState(): AdvancedFilterState {
  return {
    lubricant: selectedLubricant.value,
    probe: selectedProbeMaterial.value,
    substrate: selectedSubstrateMaterial.value,
    coating: selectedSubstrateCoating.value,
    speed: selectedSpeedValue.value,
    shearRate: selectedShearRateValue.value,
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
  selectedShearRateValue.value = state.shearRate
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
  if (id === 'manual-shear-rate') selectedShearRateValue.value = ''
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

// 批量选择 + 批量操作 ─────────────────────────────────────────
const selectedIds = ref<Set<number>>(new Set())
const batchActionPending = ref(false)
const batchEditField = ref<string>('')
const batchEditValue = ref<string>('')
const batchError = ref('')

function toggleSelectOne(recordId: number) {
  const next = new Set(selectedIds.value)
  if (next.has(recordId)) next.delete(recordId)
  else next.add(recordId)
  selectedIds.value = next
}
function toggleSelectPage(select: boolean) {
  const next = new Set(selectedIds.value)
  for (const r of result.value.items) {
    const id = Number(r.id)
    if (select) next.add(id)
    else next.delete(id)
  }
  selectedIds.value = next
}
function clearSelection() {
  selectedIds.value = new Set()
}

async function handleBatchDelete() {
  if (!selectedIds.value.size) return
  if (!confirm(`确定要删除选中的 ${selectedIds.value.size} 条记录？此操作不可撤销。`)) return
  batchActionPending.value = true
  batchError.value = ''
  try {
    const ids = Array.from(selectedIds.value)
    for (const id of ids) {
      try {
        const { deleteTribologyRecord } = await import('@/lib/api')
        await deleteTribologyRecord(id)
      } catch (e: any) {
        batchError.value = `删除记录 #${id} 失败：${e?.response?.data?.detail || e?.message || '未知错误'}`
        break
      }
    }
    clearSelection()
    await fetchData()
  } finally {
    batchActionPending.value = false
  }
}

const BATCH_FIELD_OPTIONS: Array<{ key: string; label: string }> = [
  { key: 'substrateMaterial', label: '基底材料' },
  { key: 'substrateCoating', label: '涂层' },
  { key: 'probeMaterial', label: '探针材料' },
  { key: 'temperature', label: '温度' },
  { key: 'potential', label: '电势' },
  { key: 'speedValue', label: '滑动速度' },
  { key: 'shearRate', label: '剪切率' },
  { key: 'loadValue', label: '法向载荷' },
]

async function handleBatchEdit() {
  if (!selectedIds.value.size) return
  if (!batchEditField.value) {
    batchError.value = '请先选择要修改的字段'
    return
  }
  if (!confirm(`将选中的 ${selectedIds.value.size} 条记录的「${
    BATCH_FIELD_OPTIONS.find((o) => o.key === batchEditField.value)?.label || batchEditField.value
  }」改为「${batchEditValue.value || '空'}」？`)) return
  batchActionPending.value = true
  batchError.value = ''
  try {
    const ids = Array.from(selectedIds.value)
    const { updateTribologyRecord } = await import('@/lib/api')
    for (const id of ids) {
      try {
        await updateTribologyRecord(id, { [batchEditField.value]: batchEditValue.value })
      } catch (e: any) {
        batchError.value = `更新记录 #${id} 失败：${e?.response?.data?.detail || e?.message || '未知错误'}`
        break
      }
    }
    batchEditField.value = ''
    batchEditValue.value = ''
    clearSelection()
    await fetchData()
  } finally {
    batchActionPending.value = false
  }
}

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
  items: IonStructurePreviewItem[]
}>({
  open: false,
  rowId: null,
  title: '',
  items: [],
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
  const items = lubricantStructureItems(record)
  structurePreview.value = {
    open: true,
    rowId: record.id,
    title: record.lubricant || 'Chemical Structure',
    items,
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
    previewLabel: lubricantDisplay(record),
    previewHtml: formatIonicLiquidHtml(lubricantDisplay(record)),
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
  const shearRate = buildInteractiveEvidenceSnippet(
    record,
    'Shear rate',
    record.shearRate,
    {
      fallbackPage: primaryPage,
      preferImage: true,
      semanticTypes: ['shear_rate'],
      previewLabel: record.shearRate || undefined,
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
      previewLabel: [normalizePotentialDisplayText(record.potential), record.waterContent].filter((value) => String(value || '').trim()).join(' · ') || undefined,
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
      shearRate,
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
  if (tag === 'shearRate') return 'rgba(217, 70, 239, 0.35)'
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

function handleOpenReviewRecord(record: RecordResponse) {
  emit('view-literature', {
    literatureId: record.literatureId ?? null,
    recordId: record.id ?? null,
  })
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
    'surfaceRoughnessCompositeRq',
    'temperature',
    'potential',
    'waterContent',
    'speedValue',
    'shearRate',
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
    r.surfaceRoughness || '',
    r.temperature || '',
    normalizePotentialDisplayText(r.potential) || '',
    r.waterContent || '',
    r.speedValue || '',
    r.shearRate || '',
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

watch(
  () => props.externalExportRequest?.id,
  (requestId, previousId) => {
    if (!requestId || requestId === previousId || !props.externalExportRequest) return
    void exportVerifiedData(props.externalExportRequest.format)
  },
)

// 自动翻页找到目标记录（最多 12 跳，防死循环）
const focusHopsRemaining = ref(0)
watch(
  () => props.focusRecordId,
  (id) => {
    if (id == null) return
    focusHopsRemaining.value = 12
    if (currentPage.value !== 1) goToPage(1)
  },
)
watch(
  [() => props.focusRecordId, () => result.value.items, () => loading.value],
  ([id, items, isLoading]) => {
    if (id == null || isLoading) return
    const found = (items as any[]).some((row) => Number(row?.id) === Number(id))
    if (found) {
      focusHopsRemaining.value = 0
      return
    }
    if (focusHopsRemaining.value <= 0) return
    if (currentPage.value >= totalPages.value) {
      // 整个文献集都翻完仍没找到——清掉，让 App 解除 focusedRecordId
      focusHopsRemaining.value = 0
      emit('clear-focused-record')
      return
    }
    focusHopsRemaining.value -= 1
    goToPage(currentPage.value + 1)
  },
)

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
    <div class="border-b border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-950/80">
      <section class="overflow-hidden">
        <div class="space-y-2.5">
          <div class="flex flex-col gap-2 xl:flex-row xl:items-center xl:justify-between">
            <div v-if="!props.selectedFileId" class="relative min-w-0 flex-1">
              <Search class="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                v-model="searchDoi"
                type="text"
                placeholder="按文献 DOI 搜索…"
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

            <div class="flex min-w-0 flex-1 flex-wrap items-center gap-2">
              <button
                type="button"
                class="inline-flex h-9 shrink-0 items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-3 text-sm font-semibold text-blue-700 transition hover:border-blue-300 hover:bg-blue-100 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-200 dark:hover:bg-blue-500/15"
                @click="toggleAdvancedFilters"
              >
                <SlidersHorizontal class="h-4 w-4" />
                <span>高级筛选</span>
                <span
                  v-if="activeManualFilterCount"
                  class="inline-flex min-w-5 items-center justify-center rounded-full bg-blue-600 px-1.5 py-0.5 text-[11px] font-bold text-white"
                >
                  {{ activeManualFilterCount }}
                </span>
                <ChevronUp v-if="showAdvancedFilters" class="h-4 w-4" />
                <ChevronDown v-else class="h-4 w-4" />
              </button>

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
                class="h-8 px-2 text-xs font-medium text-slate-500 underline-offset-4 transition hover:text-slate-800 hover:underline dark:text-slate-400 dark:hover:text-slate-200"
                @click="clearAllAdvancedFilters"
              >
                清空筛选
              </button>
            </div>
          </div>

          <p class="text-xs leading-5 text-slate-500 dark:text-slate-400">
            {{ advancedSearchSummary }}
          </p>
        </div>

        <div
          v-if="showAdvancedFilters"
          class="mt-3 overflow-hidden rounded-[1.6rem] border border-slate-200 bg-white shadow-xl shadow-slate-200/40 dark:border-slate-800 dark:bg-slate-900/90 dark:shadow-none"
        >
          <!-- Header -->
          <div class="flex flex-col gap-4 border-b border-slate-100 px-5 py-4 dark:border-slate-800/60 lg:flex-row lg:items-center lg:justify-between">
            <div class="flex min-w-0 items-center gap-3">
              <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-400">
                <SlidersHorizontal class="h-5 w-5" />
              </div>
              <div class="min-w-0">
                <div class="flex items-center gap-2">
                  <h3 class="text-base font-bold text-slate-900 dark:text-white">高级筛选检索台</h3>
                  <span v-if="activeManualFilterCount" class="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-bold text-blue-700 dark:bg-blue-500/20 dark:text-blue-300">
                    {{ activeManualFilterCount }} active
                  </span>
                </div>
                <p class="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">
                  先选字段，再搜索候选；候选列表只渲染前 {{ ADVANCED_OPTION_LIMIT }} 条，数据量大时也保持轻、快、干净。
                </p>
              </div>
            </div>
            <div class="flex shrink-0 items-center gap-2">
              <button
                v-if="hasManualFilters"
                type="button"
                class="rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/50 dark:hover:text-slate-200"
                @click="clearAllAdvancedFilters"
              >
                清空全部
              </button>
              <button
                type="button"
                class="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 hover:text-slate-900 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                @click="cancelAdvancedFilters"
              >
                收起
              </button>
            </div>
          </div>

          <!-- Body -->
          <div class="grid divide-y divide-slate-100 dark:divide-slate-800/60 xl:grid-cols-[240px_minmax(0,1fr)_320px] xl:divide-x xl:divide-y-0">
            <!-- Col 1: Fields Nav -->
            <nav class="flex flex-col bg-slate-50/30 p-4 dark:bg-slate-950/20">
              <div class="mb-4 px-1">
                <p class="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">字段导航</p>
              </div>
              <div class="space-y-1">
                <button
                  v-for="field in advancedFilterFields"
                  :key="field.key"
                  type="button"
                  class="group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition"
                  :class="field.key === activeAdvancedOptionKey
                    ? 'bg-white shadow-sm ring-1 ring-slate-200 dark:bg-slate-800 dark:ring-slate-700'
                    : 'text-slate-600 hover:bg-slate-100/50 dark:text-slate-400 dark:hover:bg-slate-800/30'"
                  @click="selectAdvancedFilterField(field.key)"
                >
                  <span class="h-2 w-2 shrink-0 rounded-full" :class="field.accentClass" />
                  <span class="min-w-0 flex-1">
                    <span class="flex items-center justify-between gap-2">
                      <span class="truncate text-sm font-semibold" :class="field.key === activeAdvancedOptionKey ? 'text-slate-900 dark:text-white' : ''">{{ field.label }}</span>
                      <span class="text-[10px] font-medium text-slate-400">{{ field.options.length }}</span>
                    </span>
                    <span
                      class="mt-0.5 block truncate text-[11px]"
                      :class="field.key === activeAdvancedOptionKey ? 'text-slate-500 dark:text-slate-400' : 'text-slate-400/80 dark:text-slate-500/80'"
                    >
                      {{ field.selected || field.description }}
                    </span>
                  </span>
                </button>
              </div>
            </nav>

            <!-- Col 2: Candidates -->
            <section class="flex flex-col p-5">
              <div class="mb-5 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <div class="flex items-center gap-2">
                    <span class="h-2 w-2 rounded-full" :class="activeAdvancedFilterField.accentClass" />
                    <p class="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                      {{ activeAdvancedFilterField.group }}
                    </p>
                  </div>
                  <h3 class="mt-1 text-lg font-bold text-slate-900 dark:text-white">{{ activeAdvancedFilterField.label }}</h3>
                </div>
                <p class="text-xs font-medium text-slate-500 dark:text-slate-400">
                  {{ matchingAdvancedOptions.length }} / {{ activeAdvancedFilterField.options.length }}
                </p>
              </div>

              <div class="relative mb-4">
                <Search class="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  v-model="advancedOptionSearch"
                  type="search"
                  :placeholder="`搜索 ${activeAdvancedFilterField.label} 候选…`"
                  class="h-10 w-full rounded-xl border-0 bg-slate-100 pl-10 pr-10 text-sm text-slate-900 ring-1 ring-inset ring-slate-200 transition placeholder:text-slate-500 focus:bg-white focus:ring-2 focus:ring-inset focus:ring-blue-500 dark:bg-slate-800 dark:text-white dark:ring-slate-700 dark:focus:bg-slate-900"
                  @keydown.enter.prevent="advancedTypedCandidate ? applyAdvancedTypedValue() : applyAdvancedFilters()"
                >
                <button
                  v-if="advancedOptionSearch"
                  type="button"
                  class="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-200 hover:text-slate-700 dark:hover:bg-slate-700 dark:hover:text-slate-200"
                  @click="advancedOptionSearch = ''"
                >
                  <X class="h-3.5 w-3.5" />
                </button>
              </div>

              <button
                v-if="advancedTypedCandidate"
                type="button"
                class="mb-4 flex w-full items-center justify-between rounded-xl border border-dashed border-blue-200 bg-blue-50/50 px-4 py-2.5 text-left text-sm font-medium text-blue-700 transition hover:bg-blue-50 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-300 dark:hover:bg-blue-500/20"
                @click="applyAdvancedTypedValue"
              >
                <span class="truncate">使用 “{{ advancedTypedCandidate }}”</span>
                <span class="ml-3 shrink-0 rounded bg-blue-100 px-1.5 py-0.5 text-[10px] uppercase text-blue-600 dark:bg-blue-500/20 dark:text-blue-400">Enter</span>
              </button>

              <div
                v-if="activeAdvancedFilterField.selected"
                class="mb-4 flex items-center justify-between gap-3 rounded-xl bg-blue-50 px-4 py-3 dark:bg-blue-500/10"
              >
                <div class="min-w-0">
                  <p class="text-[10px] font-bold uppercase tracking-wider text-blue-500/80 dark:text-blue-400/80">已选择</p>
                  <p class="mt-0.5 truncate text-sm font-semibold text-blue-900 dark:text-blue-100">{{ activeAdvancedFilterField.selected }}</p>
                </div>
                <button
                  type="button"
                  class="shrink-0 rounded-lg bg-white/60 px-2.5 py-1.5 text-xs font-semibold text-blue-700 transition hover:bg-white dark:bg-slate-800 dark:text-blue-300 dark:hover:bg-slate-700"
                  @click="clearAdvancedFilterValue(activeAdvancedFilterField.key)"
                >
                  清除
                </button>
              </div>

              <div class="flex-1 min-h-0 relative">
                <div class="absolute inset-0 overflow-auto rounded-xl border border-slate-100 bg-white dark:border-slate-800 dark:bg-slate-950/50">
                  <button
                    v-for="option in visibleAdvancedOptions"
                    :key="`${activeAdvancedFilterField.key}-${option}`"
                    type="button"
                    class="flex w-full items-center gap-3 border-b border-slate-50 px-4 py-2.5 text-left text-sm transition last:border-b-0 hover:bg-slate-50 dark:border-slate-800/50 dark:hover:bg-slate-800/50"
                    :class="option === activeAdvancedFilterField.selected ? 'bg-blue-50/50 dark:bg-blue-500/10' : ''"
                    @click="setAdvancedFilterValue(activeAdvancedFilterField.key, option)"
                  >
                    <span class="min-w-0 flex-1 truncate text-slate-700 dark:text-slate-300" :class="option === activeAdvancedFilterField.selected ? 'font-semibold text-blue-700 dark:text-blue-300' : ''">{{ option }}</span>
                    <Check v-if="option === activeAdvancedFilterField.selected" class="h-4 w-4 text-blue-600 dark:text-blue-400" />
                  </button>
                  <div v-if="!visibleAdvancedOptions.length" class="px-4 py-8 text-center text-sm text-slate-400">
                    没有匹配候选。可以直接使用当前输入作为筛选值。
                  </div>
                </div>
              </div>
              <p v-if="hiddenAdvancedOptionCount" class="mt-3 text-center text-xs text-slate-400">
                还有 {{ hiddenAdvancedOptionCount }} 个候选未展示，继续输入可缩小范围。
              </p>
            </section>

            <!-- Col 3: Values & Active -->
            <aside class="flex flex-col bg-slate-50/30 p-5 dark:bg-slate-950/20">
              <div class="mb-6">
                <div class="mb-4 flex items-center justify-between">
                  <p class="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">Active Slice</p>
                  <span v-if="activeManualFilterCount" class="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-400">{{ activeManualFilterCount }}</span>
                </div>
                <div v-if="manualFilterChips.length" class="flex flex-wrap gap-2">
                  <button
                    v-for="chip in manualFilterChips"
                    :key="chip.id"
                    type="button"
                    class="group flex max-w-full items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                    @click="removeAdvancedSearchChip(chip.id)"
                  >
                    <span class="truncate font-medium">{{ chip.label }}</span>
                    <span class="text-slate-400 dark:text-slate-500">:</span>
                    <span class="truncate text-slate-900 dark:text-white">{{ chip.value }}</span>
                    <X class="ml-0.5 h-3 w-3 text-slate-400 group-hover:text-slate-600 dark:group-hover:text-slate-300" />
                  </button>
                </div>
                <p v-else class="text-xs text-slate-400 dark:text-slate-500">
                  当前没有手动筛选，表格显示当前文献或全库范围。
                </p>
              </div>

              <div>
                <p class="mb-4 text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">数值窗口</p>
                <div class="space-y-4">
                  <div>
                    <label class="mb-2 block text-xs font-medium text-slate-700 dark:text-slate-300">载荷窗口 (Load)</label>
                    <div class="flex items-center gap-2">
                      <input
                        v-model="loadMin"
                        type="text"
                        inputmode="decimal"
                        placeholder="Min"
                        class="h-9 w-full rounded-lg border-0 bg-white px-3 text-sm text-slate-900 ring-1 ring-inset transition focus:ring-2 focus:ring-inset dark:bg-slate-900 dark:text-white"
                        :class="isLoadRangeInvalid ? 'ring-rose-300 focus:ring-rose-500 dark:ring-rose-500/50' : 'ring-slate-200 focus:ring-blue-500 dark:ring-slate-700'"
                        @keydown.enter.prevent="applyAdvancedFilters"
                      />
                      <span class="text-slate-400">-</span>
                      <input
                        v-model="loadMax"
                        type="text"
                        inputmode="decimal"
                        placeholder="Max"
                        class="h-9 w-full rounded-lg border-0 bg-white px-3 text-sm text-slate-900 ring-1 ring-inset transition focus:ring-2 focus:ring-inset dark:bg-slate-900 dark:text-white"
                        :class="isLoadRangeInvalid ? 'ring-rose-300 focus:ring-rose-500 dark:ring-rose-500/50' : 'ring-slate-200 focus:ring-blue-500 dark:ring-slate-700'"
                        @keydown.enter.prevent="applyAdvancedFilters"
                      />
                    </div>
                    <p v-if="isLoadRangeInvalid" class="mt-1 text-[11px] text-rose-500">输入无效，最小值不能大于最大值。</p>
                  </div>

                  <div>
                    <label class="mb-2 block text-xs font-medium text-slate-700 dark:text-slate-300">COF 窗口</label>
                    <div class="flex items-center gap-2">
                      <input
                        v-model="cofMin"
                        type="text"
                        inputmode="decimal"
                        placeholder="Min"
                        class="h-9 w-full rounded-lg border-0 bg-white px-3 text-sm text-slate-900 ring-1 ring-inset transition focus:ring-2 focus:ring-inset dark:bg-slate-900 dark:text-white"
                        :class="isCofRangeInvalid ? 'ring-rose-300 focus:ring-rose-500 dark:ring-rose-500/50' : 'ring-slate-200 focus:ring-blue-500 dark:ring-slate-700'"
                        @keydown.enter.prevent="applyAdvancedFilters"
                      />
                      <span class="text-slate-400">-</span>
                      <input
                        v-model="cofMax"
                        type="text"
                        inputmode="decimal"
                        placeholder="Max"
                        class="h-9 w-full rounded-lg border-0 bg-white px-3 text-sm text-slate-900 ring-1 ring-inset transition focus:ring-2 focus:ring-inset dark:bg-slate-900 dark:text-white"
                        :class="isCofRangeInvalid ? 'ring-rose-300 focus:ring-rose-500 dark:ring-rose-500/50' : 'ring-slate-200 focus:ring-blue-500 dark:ring-slate-700'"
                        @keydown.enter.prevent="applyAdvancedFilters"
                      />
                    </div>
                    <p v-if="isCofRangeInvalid" class="mt-1 text-[11px] text-rose-500">输入无效，最小值不能大于最大值。</p>
                  </div>
                </div>
              </div>
            </aside>
          </div>

          <!-- Footer -->
          <div class="flex items-center justify-between border-t border-slate-100 bg-slate-50/50 px-5 py-3 dark:border-slate-800/60 dark:bg-slate-900/50">
            <p class="text-xs text-slate-500 dark:text-slate-400 hidden sm:block">
              应用后刷新下方记录；取消会回到上一次已应用的筛选状态。
            </p>
            <div class="flex w-full justify-end gap-3 sm:w-auto">
              <button
                type="button"
                class="rounded-lg px-4 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-200/50 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
                @click="cancelAdvancedFilters"
              >
                取消
              </button>
              <button
                type="button"
                class="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-blue-600 px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 dark:focus:ring-offset-slate-900"
                :disabled="hasInvalidManualRange"
                @click="applyAdvancedFilters"
              >
                <Search class="h-4 w-4" />
                应用筛选
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>

    <div v-if="selectedIds.size > 0" class="px-6 pt-3">
      <div class="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-white/90 px-3 py-2.5 text-sm text-slate-700 shadow-[0_18px_42px_-34px_rgba(15,23,42,0.65)] ring-1 ring-slate-100 backdrop-blur dark:border-slate-800 dark:bg-slate-950/85 dark:text-slate-200 dark:ring-slate-800">
        <div class="mr-1 flex items-center gap-2">
          <span class="inline-flex h-7 min-w-7 items-center justify-center rounded-full bg-slate-950 px-2 text-xs font-black tabular-nums text-white dark:bg-white dark:text-slate-950">
            {{ selectedIds.size }}
          </span>
          <span class="text-xs font-black uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">Batch Edit</span>
        </div>

        <button
          type="button"
          class="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-bold text-slate-500 transition hover:border-slate-300 hover:bg-white hover:text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
          @click="clearSelection"
        >
          取消选择
        </button>

        <span class="mx-1 hidden h-6 w-px bg-slate-200 dark:bg-slate-800 sm:block" />

        <select
          v-model="batchEditField"
          class="h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-700 outline-none transition focus:border-blue-300 focus:ring-4 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:focus:border-blue-500 dark:focus:ring-blue-500/10"
        >
          <option value="">选择字段...</option>
          <option v-for="opt in BATCH_FIELD_OPTIONS" :key="opt.key" :value="opt.key">{{ opt.label }}</option>
        </select>
        <input
          v-model="batchEditValue"
          type="text"
          :placeholder="batchEditField ? '新值，留空则清除' : '先选字段'"
          :disabled="!batchEditField"
          class="h-9 w-48 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-700 outline-none transition placeholder:text-slate-400 focus:border-blue-300 focus:ring-4 focus:ring-blue-100 disabled:bg-slate-50 disabled:text-slate-400 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:focus:border-blue-500 dark:focus:ring-blue-500/10 dark:disabled:bg-slate-900"
        >
        <button
          type="button"
          class="inline-flex h-9 items-center gap-1 rounded-lg bg-slate-950 px-3 text-xs font-black text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-45 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200"
          :disabled="!batchEditField || batchActionPending"
          @click="handleBatchEdit"
        >
          <span v-if="batchActionPending">应用中...</span>
          <span v-else>应用修改</span>
        </button>

        <button
          type="button"
          class="ml-auto inline-flex h-9 items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-3 text-xs font-black text-rose-600 transition hover:border-rose-300 hover:bg-rose-100 disabled:opacity-50 dark:border-rose-500/25 dark:bg-rose-500/10 dark:text-rose-300"
          :disabled="batchActionPending"
          @click="handleBatchDelete"
        >
          删除选中
        </button>

        <span
          v-if="batchError"
          class="basis-full rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-600 dark:border-rose-500/25 dark:bg-rose-500/10 dark:text-rose-300"
        >
          {{ batchError }}
        </span>
      </div>
    </div>

    <div class="flex-1 overflow-auto px-6 py-4">
      <RecordTable
        :loading="loading"
        :records="result.items"
        :row-number-start="rangeStart || 1"
        :deleting-row-id="deletingRowId"
        :evidence-data="evidenceData"
        :structure-preview-open="structurePreview.open"
        :structure-preview-row-id="structurePreview.rowId"
        :focus-record-id="focusRecordId ?? null"
        :selected-ids="selectedIds"
        :open-evidence-modal="handleOpenEvidenceModal"
        :open-review-record="handleOpenReviewRecord"
        :open-edit-modal="handleOpenEditModal"
        :remove-record="removeRecord"
        :open-structure-preview="openStructurePreview"
        @toggle-select="toggleSelectOne"
        @toggle-select-page="toggleSelectPage"
      />
    </div>

    <div class="flex items-center justify-between border-t bg-white px-6 py-3 text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-950/80 dark:text-slate-400">
      <div>
        <template v-if="result.total > 0">
          第 {{ rangeStart }}–{{ rangeEnd }} 条 / 共 {{ result.total }} 条
        </template>
        <template v-else>
          暂无符合条件的记录
        </template>
      </div>
      <div class="flex items-center gap-1">
        <button
          class="inline-flex items-center gap-1 rounded-md border border-slate-300 px-1.5 py-1 text-slate-400 hover:bg-slate-50 hover:text-slate-600 disabled:opacity-40 dark:border-slate-700 dark:hover:bg-slate-800"
          :disabled="currentPage === 1"
          title="首页"
          @click="goToPage(1)"
        >
          <ChevronsLeft class="h-4 w-4" />
        </button>
        <button
          class="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2 py-1 hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:hover:bg-slate-800"
          :disabled="currentPage === 1"
          @click="goToPage(currentPage - 1)"
        >
          <ChevronLeft class="h-4 w-4" /> 上一页
        </button>
        <span class="px-2">{{ currentPage }} / {{ totalPages }}</span>
        <button
          class="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2 py-1 hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:hover:bg-slate-800"
          :disabled="currentPage >= totalPages"
          @click="goToPage(currentPage + 1)"
        >
          下一页 <ChevronRight class="h-4 w-4" />
        </button>
        <button
          class="inline-flex items-center gap-1 rounded-md border border-slate-300 px-1.5 py-1 text-slate-400 hover:bg-slate-50 hover:text-slate-600 disabled:opacity-40 dark:border-slate-700 dark:hover:bg-slate-800"
          :disabled="currentPage >= totalPages"
          title="尾页"
          @click="goToPage(totalPages)"
        >
          <ChevronsRight class="h-4 w-4" />
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
          <!-- Tribopair Cross-Check Card -->
          <div class="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-950">
            <div class="flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
              <Layers class="h-4 w-4 text-emerald-500" /> Tribopair Cross-Check
            </div>
            <div class="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
              <!-- Probe -->
              <div>
                <div class="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">Probe</div>
                <div class="mt-1 text-sm font-medium text-slate-900 dark:text-slate-100">
                  {{ tribopairParts(evidenceModalRecord).probe }}
                </div>
                <div v-if="tribopairExtras(evidenceModalRecord).probeDetails" class="mt-0.5 text-xs text-slate-500">
                  {{ tribopairExtras(evidenceModalRecord).probeDetails }}
                </div>
              </div>
              
              <!-- Substrate -->
              <div>
                <div class="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">Substrate</div>
                <div class="mt-1 text-sm font-medium text-slate-900 dark:text-slate-100">
                  {{ tribopairParts(evidenceModalRecord).substrate }}
                </div>
                <div v-if="surfaceRoughnessBadge(evidenceModalRecord)" class="mt-0.5 text-xs text-slate-500">
                  Roughness: {{ surfaceRoughnessBadge(evidenceModalRecord)?.label }}
                </div>
              </div>

              <!-- Coating -->
              <div v-if="tribopairParts(evidenceModalRecord).coating">
                <div class="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">Coating</div>
                <div class="mt-1 text-sm font-medium text-slate-900 dark:text-slate-100">
                  {{ tribopairParts(evidenceModalRecord).coating }}
                </div>
              </div>

              <!-- Film Thickness -->
              <div v-if="tribopairExtras(evidenceModalRecord).filmThickness">
                <div class="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">Film Thickness</div>
                <div class="mt-1 text-sm font-medium text-slate-900 dark:text-slate-100">
                  {{ tribopairExtras(evidenceModalRecord).filmThickness }}
                </div>
              </div>
            </div>
          </div>

          <RecordCard
            :record="evidenceModalRecord"
            :evidence="evidenceData[evidenceModalRecord.id] || null"
            eyebrow="Selected Record"
          />

          <div class="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-950">
            <div class="flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-book-open h-4 w-4"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg> Reference Source
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
                <span class="font-semibold text-white" v-html="formatIonicLiquidHtml(lubricantDisplay(evidenceModalRecord))"></span>
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
                  <div class="mt-2 text-sm text-slate-500 dark:text-slate-400" v-html="formatIonicLiquidHtml(lubricantDisplay(editDrawerRecord))"></div>
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
                      <label class="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">Slip Velocity</label>
                      <input
                        :value="activeEditValues.speedValue"
                        @input="(e: Event) => updateActiveEditingField('speedValue', (e.target as HTMLInputElement).value)"
                        type="text"
                        class="h-10 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                        placeholder="1 μm/s"
                      />
                    </div>
                    <div>
                      <label class="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">Shear Rate</label>
                      <input
                        :value="activeEditValues.shearRate"
                        @input="(e: Event) => updateActiveEditingField('shearRate', (e.target as HTMLInputElement).value)"
                        type="text"
                        class="h-10 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                        placeholder="195-1300 s^-1"
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
        <div
          v-for="item in structurePreview.items"
          :key="item.key"
        >
          <MoleculeViewer
            :smiles="item.smiles"
            :label="`${item.role === 'cation' ? 'Cation' : 'Anion'}: ${item.label}`"
            size="full"
          />
        </div>
        <div v-if="!structurePreview.items.length" class="rounded-lg border border-dashed border-slate-200 p-6 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
          No chemical structure is available for this record.
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
