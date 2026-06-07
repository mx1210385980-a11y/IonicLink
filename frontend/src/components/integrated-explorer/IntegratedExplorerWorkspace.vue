<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, toRef, watch } from 'vue'
import {
  batchDeleteTribologyRecords,
  extractData,
  getCandidateFieldEvidence,
  getLatestExtractionRun,
  getPdfBboxPreview,
  getPdfFigurePreviews,
  getRecordFieldEvidence,
  getReviewBacklog,
  searchRecords,
  type ExtractionRunDetail,
  type ExtractionSummary,
  type ReviewBacklogPaper,
  type RecordResponse,
  type EvidenceResult,
  type FieldEvidenceEntry,
  type PdfFigurePreview,
  type RecordFieldEvidenceResponse,
} from '@/lib/api'
import {
  canonicalExperimentScaleValue,
} from '@/lib/experimentScale'
import {
  Search,
  ChevronLeft,
  ChevronRight,
  Save,
  Trash2,
  Ban,
  BookOpen,
  X,
  Check,
  Layers,
  Maximize2,
  FileText,
  ChevronsLeft,
  ChevronsRight,
  RefreshCw,
} from 'lucide-vue-next'
import ChemicalText from '@/components/ChemicalText.vue'
import CandidateReviewSheet from '@/components/integrated-explorer/CandidateReviewSheet.vue'
import RecordTable from '@/components/integrated-explorer/RecordTable.vue'
import Modal from '@/components/ui/Modal.vue'
import { recordEvidenceCacheKey, useEvidencePanel } from '@/composables/useEvidencePanel'
import { useRecordEditing } from '@/composables/useRecordEditing'
import { useRecordSearch } from '@/composables/useRecordSearch'
import { evidencePreviewErrorMessage } from '@/lib/evidencePreviewErrors'
import type { HighlightRect } from '@/types/pdf-highlight'
import {
  candidateAgeDays,
  candidateEvidenceQuality,
  candidateMissingFields,
  cofDisplay,
  compactRecordDisplayId,
  conditionGroups,
  confidenceDisplay,
  confidenceValueFor,
  formatIonicLiquidHtml,
  ionicLiquidCationAliasNote,
  lubricantDisplay,
  lubricantStructureItems,
  missingFieldLabel,
  recordDisplayId,
  tribopairDisplay,
  type CandidateEvidenceQuality,
  type IonStructurePreviewItem,
} from '@/lib/integratedExplorerHelpers'
import { normalizePotentialDisplayText } from '@/lib/potential'
import { lazyComponent } from '@/lib/lazyComponent'
import { sessionState } from '@/lib/session'

const props = defineProps<{
  initialDoi?: string
  sourceName?: string
  literatureMetadata?: any
  selectedFileId?: string | null
  recordScope?: 'active' | 'group_library' | 'all_visible'
  fixedExperimentScale?: string | null
  focusRecordId?: number | null
  focusEntityType?: 'record' | 'candidate' | null
  entityTypeFilter?: 'record' | 'candidate' | null
  externalExportRequest?: { id: number, format: ExportFormat } | null
  externalFilterRequestId?: number | null
}>()

const emit = defineEmits<{
  'view-literature': [payload?: { literatureId?: number | null, recordId?: number | null, mode?: 'grounding' | null }]
  'clear-doi': []
  'clear-source': []
  'clear-focused-record': []
}>()

const MoleculeViewer = lazyComponent(() => import('@/components/MoleculeViewer.vue'))
const PdfViewerWithHighlight = lazyComponent(() => import('@/components/PdfViewerWithHighlight.vue'))

const PAGE_SIZE = 10
const exporting = ref(false)
type ExportFormat = 'json' | 'csv' | 'ndjson'

// Review master-detail: which paper's candidates the right pane is scoped to
// (null = all papers). Declared before useRecordSearch so it can drive the query.
const selectedReviewLiteratureId = ref<number | null>(null)
const selectedReviewLiteratureIds = ref<number[]>([])
const selectedReviewLiteratureFileId = computed(() =>
  selectedReviewLiteratureIds.value.length ? selectedReviewLiteratureIds.value.join(',') : null,
)

const {
  loading,
  error: searchError,
  result,
  filterOptions,
  selectedExperimentScale,
  selectedCation,
  selectedAnion,
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
  sortBy,
  sortDir,
  setSort,
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
  targetRecordId: toRef(props, 'focusRecordId'),
  targetEntityType: toRef(props, 'focusEntityType'),
  entityTypeFilter: toRef(props, 'entityTypeFilter'),
  reviewLiteratureId: selectedReviewLiteratureFileId,
  scope: toRef(props, 'recordScope'),
  fixedExperimentScale: toRef(props, 'fixedExperimentScale'),
  pageSize: PAGE_SIZE,
})

const activeLibraryEntityType = computed<'record' | 'candidate'>(() =>
  props.entityTypeFilter === 'candidate' ? 'candidate' : 'record',
)
const isReviewQueue = computed(() => activeLibraryEntityType.value === 'candidate')
const canLoadReviewBacklog = computed(() => sessionState.ready && Boolean(sessionState.token))

// Track 2: review-queue triage ───────────────────────────────────────────────
// Client-side narrowing + backlog ordering over the candidate rows the queue
// already returns. Triage fields (confidenceTier, missingFields, recordOrigin)
// ride along on each candidate payload, so no extra query is needed.
const triageMissingField = ref('')
// Staleness presets (whole days). 0 = off; a candidate matches when its age in
// days is >= the selected threshold.
const STALE_DAY_PRESETS = [7, 30, 90] as const
const triageStaleDays = ref(0)

const queueCandidateItems = computed(() =>
  result.value.items.filter((record) => databaseRecordEntityType(record) === 'candidate'),
)

const triageTierCounts = computed(() => {
  const all = queueCandidateItems.value.length
  return { all }
})

const triageMissingFieldOptions = computed(() => {
  const counts = new Map<string, number>()
  for (const record of queueCandidateItems.value) {
    for (const field of candidateMissingFields(record)) {
      counts.set(field, (counts.get(field) || 0) + 1)
    }
  }
  return Array.from(counts.entries())
    .sort((left, right) => right[1] - left[1])
    .map(([key, count]) => ({ key, count, label: missingFieldLabel(key) }))
})

const EVIDENCE_QUALITY_SORT_RANK: Record<CandidateEvidenceQuality, number> = {
  weak: 0,
  text_only: 1,
  page_only: 2,
  exact: 3,
}

const triageStaleOptions = computed(() =>
  STALE_DAY_PRESETS.map((days) => ({
    days,
    count: queueCandidateItems.value.filter((record) => {
      const age = candidateAgeDays(record)
      return age !== null && age >= days
    }).length,
  })).filter((option) => option.count > 0),
)

const hasTriageFilters = computed(() =>
  isReviewQueue.value &&
  (
    Boolean(triageMissingField.value) ||
    triageStaleDays.value > 0
  ),
)

function candidateMatchesTriage(record: RecordResponse) {
  if (triageMissingField.value && !candidateMissingFields(record).includes(triageMissingField.value)) return false
  if (triageStaleDays.value > 0) {
    const age = candidateAgeDays(record)
    if (age === null || age < triageStaleDays.value) return false
  }
  return true
}

function toggleTriageMissingField(field: string) {
  triageMissingField.value = triageMissingField.value === field ? '' : field
}

function setTriageStaleDays(days: number) {
  triageStaleDays.value = triageStaleDays.value === days ? 0 : days
}

function clearTriageFilters() {
  triageMissingField.value = ''
  triageStaleDays.value = 0
}

// Backlog ranking: surface candidates from the most-backlogged literature first
// (mirrors the monitor extraction-review-progress ordering), weakest within.
const queueBacklogByLiterature = computed(() => {
  const counts = new Map<number, number>()
  for (const record of queueCandidateItems.value) {
    const litId = Number(record.literatureId || 0)
    counts.set(litId, (counts.get(litId) || 0) + 1)
  }
  return counts
})

const displayedRecords = computed<RecordResponse[]>(() => {
  if (!isReviewQueue.value) return result.value.items
  const backlog = queueBacklogByLiterature.value
  return result.value.items
    .filter((record) => databaseRecordEntityType(record) !== 'candidate' || candidateMatchesTriage(record))
    .slice()
    .sort((left, right) => {
      const leftLit = Number(left.literatureId || 0)
      const rightLit = Number(right.literatureId || 0)
      const leftCount = backlog.get(leftLit) || 0
      const rightCount = backlog.get(rightLit) || 0
      if (leftCount !== rightCount) return rightCount - leftCount
      if (leftLit !== rightLit) return leftLit - rightLit
      const leftQuality = candidateEvidenceQuality(left)
      const rightQuality = candidateEvidenceQuality(right)
      if (leftQuality !== rightQuality) return EVIDENCE_QUALITY_SORT_RANK[leftQuality] - EVIDENCE_QUALITY_SORT_RANK[rightQuality]
      return (Number(left.confidence) || 0) - (Number(right.confidence) || 0)
    })
})

const displayedCandidateCount = computed(() =>
  displayedRecords.value.filter((record) => databaseRecordEntityType(record) === 'candidate').length,
)

watch([isReviewQueue, () => sessionState.ready, () => sessionState.token, () => props.recordScope], ([inQueue]) => {
  if (!inQueue) {
    clearTriageFilters()
    selectedReviewLiteratureId.value = null
    selectedReviewLiteratureIds.value = []
  } else if (canLoadReviewBacklog.value) {
    void loadReviewBacklog()
  }
}, { immediate: true })

// Drop a missing-field filter once no queued candidate is missing that field.
watch(triageMissingFieldOptions, (options) => {
  if (triageMissingField.value && !options.some((option) => option.key === triageMissingField.value)) {
    triageMissingField.value = ''
  }
})

// Drop a staleness filter once no queued candidate is old enough to match it.
watch(triageStaleOptions, (options) => {
  if (triageStaleDays.value && !options.some((option) => option.days === triageStaleDays.value)) {
    triageStaleDays.value = 0
  }
})

type AdvancedFilterState = {
  cation: string[]
  anion: string[]
  probe: string[]
  substrate: string[]
  coating: string[]
  speed: string[]
  temperature: string[]
  potential: string[]
  water: string[]
  scale: string
  loadMin: string
  loadMax: string
  cofMin: string
  cofMax: string
}

const showAdvancedFilters = ref(false)
const appliedAdvancedFilterState = ref<AdvancedFilterState>(captureAdvancedFilterState())

type AdvancedOptionKey =
  | 'ions'
  | 'probe'
  | 'substrate'
  | 'coating'
  | 'speed'
  | 'temperature'
  | 'potential'
  | 'water'

type AdvancedFilterField = {
  key: AdvancedOptionKey
  label: string
  group: 'Material' | 'Condition'
  description: string
  options: string[]
  selected: string[]
  accentClass: string
  optionCount?: number
}

const ADVANCED_OPTION_LIMIT = 36
const activeAdvancedOptionKey = ref<AdvancedOptionKey>('ions')
type IonFilterRole = 'cation' | 'anion'
const activeIonRole = ref<IonFilterRole>('cation')
const advancedOptionSearch = ref('')

type ScaleLaneValue = '' | 'nanoscale' | 'macroscale'

const scaleLaneOptions: Array<{
  value: ScaleLaneValue
  label: string
  shortLabel: string
  detail: string
}> = [
  { value: '', label: 'All', shortLabel: 'All', detail: '全部摩擦记录' },
  { value: 'nanoscale', label: 'Nano / AFM', shortLabel: 'Nano', detail: 'AFM / SFB / FFM' },
  { value: 'macroscale', label: 'Macro / Tribometer', shortLabel: 'Macro', detail: 'Ball / pin / wear' },
]

const activeScaleLane = computed<ScaleLaneValue>(() => {
  const canonical = canonicalExperimentScaleValue(selectedExperimentScale.value)
  if (canonical === 'nanoscale' || canonical === 'macroscale') return canonical
  return ''
})

function setScaleLane(value: ScaleLaneValue) {
  selectedExperimentScale.value = canonicalExperimentScaleValue(value)
  clearSelection()
  handleSearch()
  appliedAdvancedFilterState.value = captureAdvancedFilterState()
}

const contactPrimaryFilterLabel = computed(() =>
  activeScaleLane.value === 'macroscale' ? 'Counterface' : 'Probe',
)
const contactPrimaryFilterDescription = computed(() =>
  activeScaleLane.value === 'macroscale' ? 'Ball, pin, block, or upper body' : 'Upper surface or probe tip',
)
const contactSecondaryFilterLabel = computed(() =>
  activeScaleLane.value === 'macroscale' ? 'Specimen / Disk' : 'Substrate',
)
const contactSecondaryFilterDescription = computed(() =>
  activeScaleLane.value === 'macroscale' ? 'Disk, ring, lower balls, or specimen' : 'Lower surface / base material',
)

const ionFilterRoles = computed(() => [
  {
    key: 'cation' as const,
    label: 'Cation',
    description: 'Pin the positive ion',
    options: filterOptions.value.cations,
    selected: selectedCation.value,
    accentClass: 'bg-sky-500',
  },
  {
    key: 'anion' as const,
    label: 'Anion',
    description: 'Pin the negative ion',
    options: filterOptions.value.anions,
    selected: selectedAnion.value,
    accentClass: 'bg-teal-500',
  },
])

const activeIonFilterRole = computed(() => {
  return ionFilterRoles.value.find((role) => role.key === activeIonRole.value) || ionFilterRoles.value[0]
})

const ionSelectionSummary = computed(() => {
  const parts = []
  if (selectedCation.value.length) parts.push(`C+ ${selectedCation.value.join(', ')}`)
  if (selectedAnion.value.length) parts.push(`A- ${selectedAnion.value.join(', ')}`)
  return parts.join(' · ')
})

const advancedFilterFields = computed<AdvancedFilterField[]>(() => [
  {
    key: 'ions',
    label: 'Ion pair',
    group: 'Material',
    description: 'Cation / anion',
    options: [],
    selected: ionSelectionSummary.value ? [ionSelectionSummary.value] : [],
    accentClass: 'bg-sky-500',
    optionCount: filterOptions.value.cations.length + filterOptions.value.anions.length,
  },
  {
    key: 'probe',
    label: contactPrimaryFilterLabel.value,
    group: 'Material',
    description: contactPrimaryFilterDescription.value,
    options: filterOptions.value.probeMaterials,
    selected: selectedProbeMaterial.value,
    accentClass: 'bg-cyan-500',
  },
  {
    key: 'substrate',
    label: contactSecondaryFilterLabel.value,
    group: 'Material',
    description: contactSecondaryFilterDescription.value,
    options: filterOptions.value.substrateMaterials,
    selected: selectedSubstrateMaterial.value,
    accentClass: 'bg-slate-700',
  },
  {
    key: 'coating',
    label: 'Coating',
    group: 'Material',
    description: 'Oxide, film, or surface modifier',
    options: filterOptions.value.substrateCoatings,
    selected: selectedSubstrateCoating.value,
    accentClass: 'bg-amber-500',
  },
  {
    key: 'speed',
    label: 'Sliding speed',
    group: 'Condition',
    description: 'Linear speed, μm/s or mm/s',
    options: filterOptions.value.speedValues,
    selected: selectedSpeedValue.value,
    accentClass: 'bg-violet-500',
  },
  {
    key: 'temperature',
    label: 'Temperature',
    group: 'Condition',
    description: 'Room, high, or low temperature',
    options: filterOptions.value.temperatureValues,
    selected: selectedTemperatureValue.value,
    accentClass: 'bg-rose-500',
  },
  {
    key: 'potential',
    label: 'Potential',
    group: 'Condition',
    description: 'Electrochemical bias',
    options: filterOptions.value.potentialValues,
    selected: selectedPotentialValue.value,
    accentClass: 'bg-blue-500',
  },
  {
    key: 'water',
    label: 'Water',
    group: 'Condition',
    description: 'Water content or humidity',
    options: filterOptions.value.waterContentValues,
    selected: selectedWaterContentValue.value,
    accentClass: 'bg-emerald-500',
  },
])

const emptyAdvancedFilterField: AdvancedFilterField = {
  key: 'ions',
  label: 'Ion pair',
  group: 'Material',
  description: 'Cation / anion',
  options: [],
  selected: [],
  accentClass: 'bg-sky-500',
}

const activeAdvancedFilterField = computed<AdvancedFilterField>(() => {
  return advancedFilterFields.value.find((field) => field.key === activeAdvancedOptionKey.value)
    || advancedFilterFields.value[0]
    || emptyAdvancedFilterField
})

const advancedTypedCandidate = computed(() => advancedOptionSearch.value.trim())

const activeAdvancedOptions = computed(() => {
  if (activeAdvancedOptionKey.value === 'ions') return activeIonFilterRole.value?.options || []
  return activeAdvancedFilterField.value.options
})

const activeAdvancedSelectedValues = computed(() => {
  if (activeAdvancedOptionKey.value === 'ions') return activeIonFilterRole.value?.selected || []
  return activeAdvancedFilterField.value.selected
})

const activeAdvancedCandidateLabel = computed(() => {
  if (activeAdvancedOptionKey.value === 'ions') return activeIonFilterRole.value?.label || '离子'
  return activeAdvancedFilterField.value.label
})

const matchingAdvancedOptions = computed(() => {
  const query = normalizeAdvancedOptionText(advancedOptionSearch.value)
  if (!query) return activeAdvancedOptions.value
  return activeAdvancedOptions.value.filter((option) => advancedFilterSearchText(activeAdvancedOptionKey.value, option).includes(query))
})

const visibleAdvancedOptions = computed(() => {
  const selectedValues = new Set(activeAdvancedSelectedValues.value)
  return [...matchingAdvancedOptions.value]
    .sort((a, b) => {
      if (selectedValues.has(a) && !selectedValues.has(b)) return -1
      if (!selectedValues.has(a) && selectedValues.has(b)) return 1
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

function advancedFilterValueDisplay(_key: AdvancedOptionKey, value: string): string {
  if (!value) return ''
  return value
}

function advancedFilterSearchText(_key: AdvancedOptionKey, value: string): string {
  return normalizeAdvancedOptionText(value)
}

function advancedFilterRawTitle(_key: AdvancedOptionKey, value: string): string | undefined {
  if (!value) return undefined
  return value
}

function selectAdvancedFilterField(key: AdvancedOptionKey) {
  activeAdvancedOptionKey.value = key
  advancedOptionSearch.value = ''
}

function selectIonFilterRole(role: IonFilterRole) {
  activeIonRole.value = role
  advancedOptionSearch.value = ''
}

function commitAdvancedDiscreteFilterChange() {
  handleSearch()
  appliedAdvancedFilterState.value = captureAdvancedFilterState()
}

function toggleSelectedValue(values: string[], value: string): string[] {
  const normalized = String(value || '').trim()
  if (!normalized) return values
  return values.includes(normalized)
    ? values.filter((item) => item !== normalized)
    : [...values, normalized]
}

function setAdvancedFilterValue(key: AdvancedOptionKey, value: string) {
  if (key === 'ions') {
    if (activeIonRole.value === 'cation') selectedCation.value = toggleSelectedValue(selectedCation.value, value)
    if (activeIonRole.value === 'anion') selectedAnion.value = toggleSelectedValue(selectedAnion.value, value)
  }
  if (key === 'probe') selectedProbeMaterial.value = toggleSelectedValue(selectedProbeMaterial.value, value)
  if (key === 'substrate') selectedSubstrateMaterial.value = toggleSelectedValue(selectedSubstrateMaterial.value, value)
  if (key === 'coating') selectedSubstrateCoating.value = toggleSelectedValue(selectedSubstrateCoating.value, value)
  if (key === 'speed') selectedSpeedValue.value = toggleSelectedValue(selectedSpeedValue.value, value)
  if (key === 'temperature') selectedTemperatureValue.value = toggleSelectedValue(selectedTemperatureValue.value, value)
  if (key === 'potential') selectedPotentialValue.value = toggleSelectedValue(selectedPotentialValue.value, value)
  if (key === 'water') selectedWaterContentValue.value = toggleSelectedValue(selectedWaterContentValue.value, value)
  advancedOptionSearch.value = ''
  commitAdvancedDiscreteFilterChange()
}

function clearAdvancedFilterValue(key: AdvancedOptionKey) {
  if (key === 'ions') {
    if (activeIonRole.value === 'cation') selectedCation.value = []
    if (activeIonRole.value === 'anion') selectedAnion.value = []
    commitAdvancedDiscreteFilterChange()
    return
  }
  if (key === 'probe') selectedProbeMaterial.value = []
  if (key === 'substrate') selectedSubstrateMaterial.value = []
  if (key === 'coating') selectedSubstrateCoating.value = []
  if (key === 'speed') selectedSpeedValue.value = []
  if (key === 'temperature') selectedTemperatureValue.value = []
  if (key === 'potential') selectedPotentialValue.value = []
  if (key === 'water') selectedWaterContentValue.value = []
  commitAdvancedDiscreteFilterChange()
}

function clearIonFilterRole(role: IonFilterRole) {
  if (role === 'cation') selectedCation.value = []
  if (role === 'anion') selectedAnion.value = []
  commitAdvancedDiscreteFilterChange()
}

function applyAdvancedTypedValue() {
  if (!advancedTypedCandidate.value) return
  setAdvancedFilterValue(activeAdvancedOptionKey.value, advancedTypedCandidate.value)
}

function captureAdvancedFilterState(): AdvancedFilterState {
  return {
    cation: [...selectedCation.value],
    anion: [...selectedAnion.value],
    probe: [...selectedProbeMaterial.value],
    substrate: [...selectedSubstrateMaterial.value],
    coating: [...selectedSubstrateCoating.value],
    speed: [...selectedSpeedValue.value],
    temperature: [...selectedTemperatureValue.value],
    potential: [...selectedPotentialValue.value],
    water: [...selectedWaterContentValue.value],
    scale: selectedExperimentScale.value,
    loadMin: loadMin.value,
    loadMax: loadMax.value,
    cofMin: cofMin.value,
    cofMax: cofMax.value,
  }
}

function restoreAdvancedFilterState(state: AdvancedFilterState) {
  selectedCation.value = [...state.cation]
  selectedAnion.value = [...state.anion]
  selectedProbeMaterial.value = [...state.probe]
  selectedSubstrateMaterial.value = [...state.substrate]
  selectedSubstrateCoating.value = [...state.coating]
  selectedSpeedValue.value = [...state.speed]
  selectedTemperatureValue.value = [...state.temperature]
  selectedPotentialValue.value = [...state.potential]
  selectedWaterContentValue.value = [...state.water]
  selectedExperimentScale.value = state.scale
  loadMin.value = state.loadMin
  loadMax.value = state.loadMax
  cofMin.value = state.cofMin
  cofMax.value = state.cofMax
}

function applyAdvancedFilters() {
  clearSelection()
  handleSearch()
  appliedAdvancedFilterState.value = captureAdvancedFilterState()
}

function cancelAdvancedFilters() {
  restoreAdvancedFilterState(appliedAdvancedFilterState.value)
  showAdvancedFilters.value = false
}

function collapseAdvancedFilters() {
  showAdvancedFilters.value = false
}

function clearAllAdvancedFilters() {
  clearSelection()
  clearAdvancedSearch()
  appliedAdvancedFilterState.value = captureAdvancedFilterState()
}

function removeAdvancedSearchChip(id: string) {
  if (id === 'manual-cation') selectedCation.value = []
  if (id === 'manual-anion') selectedAnion.value = []
  if (id === 'manual-probe') selectedProbeMaterial.value = []
  if (id === 'manual-substrate') selectedSubstrateMaterial.value = []
  if (id === 'manual-coating') selectedSubstrateCoating.value = []
  if (id === 'manual-speed') selectedSpeedValue.value = []
  if (id === 'manual-temperature') selectedTemperatureValue.value = []
  if (id === 'manual-potential') selectedPotentialValue.value = []
  if (id === 'manual-water') selectedWaterContentValue.value = []
  if (id === 'manual-load') {
    loadMin.value = ''
    loadMax.value = ''
  }
  if (id === 'manual-cof') {
    cofMin.value = ''
    cofMax.value = ''
  }
  clearSelection()
  handleSearch()
  appliedAdvancedFilterState.value = captureAdvancedFilterState()
}

const {
  evidenceModalRecord,
  evidenceData,
  evidenceError,
  closeEvidenceModal,
  openEvidenceModal,
} = useEvidencePanel()

type DatabaseEvidenceField = 'ionic-liquid' | 'tribopair' | 'conditions' | 'cof'
const databaseEvidenceField = ref<DatabaseEvidenceField>('conditions')
const databaseEvidenceFocusedFieldKey = ref<string | null>(null)

type DatabaseEvidenceQuote = {
  text: string
  highlights?: string[]
  fieldKey?: string
}

type DatabaseEvidenceSlide = {
  id: string
  fieldKey?: string
  label: string
  page: number | null
  value: string
  quote: DatabaseEvidenceQuote | null
  aliasNote?: string
  note?: string
  noteLabel?: string
  locatorKey?: string
  confidence?: number | null
  imageSrc: string | null
  imageLoading?: boolean
  imageError?: string | null
}

const databaseFieldEvidence = ref<Record<string, RecordFieldEvidenceResponse | null>>({})
const databaseFieldEvidenceLoading = ref<Record<string, boolean>>({})
const databaseFieldEvidenceError = ref<Record<string, string | null>>({})
const databaseEvidenceSlideIndex = ref(0)
const databaseEvidenceOpenToken = ref(0)
const databaseEvidencePreviewImages = ref<Record<string, string | null>>({})
const databaseEvidencePreviewLoading = ref<Record<string, boolean>>({})
const databaseEvidencePreviewError = ref<Record<string, string | null>>({})
const databaseEvidenceFigurePreviews = ref<Record<number, PdfFigurePreview[]>>({})
const databaseEvidenceFigurePreviewLoading = ref<Record<string, boolean>>({})
const databaseEvidenceFigurePreviewImages = ref<Record<string, string | null>>({})
const databaseEvidenceFigurePreviewError = ref<Record<string, string | null>>({})

const {
  deletingRowId,
  editDrawerRecord,
  activeEditValues,
  openEditModal,
  closeEditDrawer,
  updateActiveEditingField,
  correctionPending,
  correctionError,
  correctionPreview,
  correctionReviewMode,
  previewActiveCorrection,
  commitActiveCorrection,
  cancelCorrectionReview,
} = useRecordEditing({
  result,
  evidenceData,
  evidenceModalRecord,
  markGraphDirty,
})

// Friendly labels for the dry-run correction diff (keys = backend columns).
const CORRECTION_FIELD_LABELS: Record<string, string> = {
  lubricant: 'Ionic Liquid',
  temperature: 'Temperature',
  potential: 'Potential',
  water_content: 'Water Content',
  speed_value: 'Speed',
  shear_rate: 'Shear Rate',
  load_value: 'Load',
  probe_material: 'Probe Material',
  probe_geometry: 'Probe Geometry',
  probe_radius: 'Probe Radius',
  probe_roughness: 'Probe Roughness',
  substrate_material: 'Substrate',
  material_name: 'Material',
  substrate_coating: 'Coating',
  substrate_roughness: 'Substrate Roughness',
  film_thickness: 'Film / Roughness',
  cof_raw: 'COF (raw)',
  cof_value: 'COF',
}

function correctionValueDisplay(value: unknown): string {
  if (value === null || value === undefined || value === '') return '∅'
  return String(value)
}

const correctionDiffEntries = computed(() => {
  const diff = correctionPreview.value?.diff
  if (!diff) return [] as Array<{ field: string; label: string; before: string; after: string }>
  return Object.entries(diff).map(([field, change]) => ({
    field,
    label: CORRECTION_FIELD_LABELS[field] ?? field,
    before: correctionValueDisplay(change?.before),
    after: correctionValueDisplay(change?.after),
  }))
})

const correctionConfidenceDelta = computed(() => {
  const next = correctionPreview.value?.confidence
  if (typeof next !== 'number' || !editDrawerRecord.value) return null
  const current = Number(confidenceValueFor(editDrawerRecord.value) ?? 0)
  return { next, delta: next - current }
})

// Table density (Comfortable ↔ Compact) — persisted so reviewers keep their choice.
const TABLE_DENSITY_KEY = 'ioniclink:db-density'
function readStoredDensity(): 'comfortable' | 'compact' {
  try {
    return localStorage.getItem(TABLE_DENSITY_KEY) === 'compact' ? 'compact' : 'comfortable'
  } catch {
    return 'comfortable'
  }
}
const tableDensity = ref<'comfortable' | 'compact'>(readStoredDensity())
function setTableDensity(value: 'comfortable' | 'compact') {
  tableDensity.value = value
  try {
    localStorage.setItem(TABLE_DENSITY_KEY, value)
  } catch {
    /* ignore persistence failures (private mode, etc.) */
  }
}

// Group-by-paper: collapse same-source records under one citation header. Only
// meaningful when not actively sorting by a data column (sorting flattens the
// list, which would scatter papers) and only in the record-centric view.
const TABLE_GROUP_KEY = 'ioniclink:db-group-by-paper'
const tableGroupByPaper = ref<boolean>((() => {
  try {
    return localStorage.getItem(TABLE_GROUP_KEY) === '1'
  } catch {
    return false
  }
})())
function setGroupByPaper(value: boolean) {
  tableGroupByPaper.value = value
  try {
    localStorage.setItem(TABLE_GROUP_KEY, value ? '1' : '0')
  } catch {
    /* ignore persistence failures */
  }
}
const groupingDisabledBySort = computed(() => Boolean(sortBy.value))
const effectiveGroupByPaper = computed(
  () => tableGroupByPaper.value && !groupingDisabledBySort.value && !isReviewQueue.value,
)

// Review master-detail paper rail: whole-queue per-paper pending counts.
const reviewBacklog = ref<ReviewBacklogPaper[]>([])
const reviewBacklogLoading = ref(false)
const reviewBacklogError = ref('')
const reviewBacklogTotal = computed(() =>
  reviewBacklog.value.reduce((sum, paper) => sum + paper.pendingCount, 0),
)
const reviewQueueTotalCount = computed(() =>
  Math.max(reviewBacklogTotal.value, triageTierCounts.value.all, Number(result.value.total || 0)),
)
const reviewSourceCountLabel = computed(() =>
  reviewBacklogError.value && !reviewBacklog.value.length ? '--' : String(reviewBacklog.value.length),
)
const reviewBacklogEmptyMessage = computed(() => {
  if (reviewBacklogError.value) {
    return reviewQueueTotalCount.value > 0
      ? 'Could not load sources. Showing all candidates.'
      : reviewBacklogError.value
  }
  if (reviewQueueTotalCount.value > 0) return 'Loading sources for these candidates...'
  return 'No candidates waiting for review.'
})
const selectedReviewPaper = computed(() =>
  reviewBacklog.value.find((paper) => paper.literatureId === selectedReviewLiteratureId.value) || null,
)
const REVIEW_REEXTRACT_POLL_DELAY_MS = 1400
const REVIEW_REEXTRACT_MAX_POLLS = 1280
const reviewReextractConfirmOpen = ref(false)
const reviewReextractPending = ref(false)
const reviewReextractError = ref('')
const reviewReextractSuccess = ref('')
const reviewReextractProgress = ref(0)
const reviewReextractMessage = ref('')
const reviewReextractRunId = ref<string | null>(null)
const reviewReextractStage = ref('')
const reviewReextractCandidateCount = ref(0)
let reviewReextractRunToken = 0

function closeReviewReextractConfirm() {
  if (reviewReextractPending.value) return
  reviewReextractConfirmOpen.value = false
}

function openReviewReextractConfirm() {
  if (reviewReextractPending.value) return
  reviewReextractError.value = ''
  reviewReextractSuccess.value = ''
  reviewReextractProgress.value = 0
  reviewReextractMessage.value = ''
  reviewReextractRunId.value = null
  reviewReextractStage.value = ''
  reviewReextractCandidateCount.value = 0
  reviewReextractConfirmOpen.value = true
}

function clampReviewReextractProgress(value: unknown) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return 0
  return Math.max(0, Math.min(100, numeric))
}

function isReviewReextractActiveStatus(status: string) {
  return ['queued', 'running', 'processing', 'extracting'].includes(status.toLowerCase())
}

function reviewReextractRunMessage(run: ExtractionRunDetail | null | undefined) {
  const summary = (run?.summary || {}) as ExtractionSummary
  const progressLog = Array.isArray(run?.progress_log) ? run.progress_log : []
  const latestProgress = progressLog.length ? progressLog[progressLog.length - 1] : null
  return String(
    summary.current_message
    || run?.error_message
    || latestProgress?.message
    || summary.no_data_reason
    || '',
  )
}

function applyReviewReextractInitialResponse(response: Awaited<ReturnType<typeof extractData>>) {
  const summary = response.extraction_summary as ExtractionSummary | undefined
  const status = String(response.status || '').toLowerCase()
  reviewReextractRunId.value = summary?.run_id || null
  reviewReextractStage.value = String(summary?.current_stage || '')
  reviewReextractCandidateCount.value = Number(summary?.candidate_count ?? 0)
  reviewReextractProgress.value = clampReviewReextractProgress(
    typeof summary?.progress_percent === 'number'
      ? summary.progress_percent
      : (isReviewReextractActiveStatus(status) ? 6 : 100),
  )
  reviewReextractMessage.value = String(
    summary?.current_message
    || response.message
    || (isReviewReextractActiveStatus(status) ? 'Extraction queued. Waiting for progress...' : 'Extraction finished.'),
  )
}

function applyReviewReextractRun(run: ExtractionRunDetail) {
  const summary = (run.summary || {}) as ExtractionSummary
  const status = String(run.status || '').toLowerCase()
  reviewReextractRunId.value = run.run_id || reviewReextractRunId.value
  reviewReextractStage.value = String(summary.current_stage || '')
  reviewReextractCandidateCount.value = Number(summary.candidate_count ?? run.candidate_count ?? 0)
  reviewReextractProgress.value = clampReviewReextractProgress(
    typeof summary.progress_percent === 'number'
      ? summary.progress_percent
      : (isReviewReextractActiveStatus(status) ? Math.max(reviewReextractProgress.value, 10) : 100),
  )
  reviewReextractMessage.value = reviewReextractRunMessage(run)
    || (isReviewReextractActiveStatus(status) ? 'Extraction is running...' : 'Extraction finished.')
}

function waitForReviewReextractPollDelay() {
  return new Promise((resolve) => window.setTimeout(resolve, REVIEW_REEXTRACT_POLL_DELAY_MS))
}

async function waitForReviewReextractRun(literatureId: number) {
  const token = reviewReextractRunToken
  let pollFailures = 0
  for (let attempt = 0; attempt < REVIEW_REEXTRACT_MAX_POLLS; attempt += 1) {
    await waitForReviewReextractPollDelay()
    if (token !== reviewReextractRunToken) return
    let run: ExtractionRunDetail
    try {
      run = await getLatestExtractionRun(literatureId, 'tribology')
      pollFailures = 0
    } catch (err: any) {
      pollFailures += 1
      reviewReextractMessage.value = 'Status check delayed, retrying...'
      if (pollFailures >= 5) {
        throw new Error(err?.message || 'Extraction status check failed repeatedly.')
      }
      continue
    }
    if (token !== reviewReextractRunToken) return
    applyReviewReextractRun(run)
    const status = String(run.status || '').toLowerCase()
    if (isReviewReextractActiveStatus(status)) continue
    if (status === 'failed' || status === 'error' || status === 'cancelled' || status === 'canceled') {
      throw new Error(reviewReextractRunMessage(run) || `Extraction ended with status: ${run.status || 'failed'}.`)
    }
    return
  }
  throw new Error('Extraction is still running after a long status check window.')
}

async function confirmReviewReextract() {
  const literatureId = selectedReviewLiteratureId.value
  if (!literatureId || reviewReextractPending.value) return
  const token = ++reviewReextractRunToken
  reviewReextractPending.value = true
  reviewReextractError.value = ''
  reviewReextractSuccess.value = ''
  reviewReextractProgress.value = 4
  reviewReextractMessage.value = 'Submitting fresh extraction...'
  reviewReextractRunId.value = null
  reviewReextractStage.value = 'stage_a.queued'
  reviewReextractCandidateCount.value = 0
  try {
    const response = await extractData(String(literatureId), true, 'auto', undefined, 'tribology')
    if (token !== reviewReextractRunToken) return
    applyReviewReextractInitialResponse(response)
    await waitForReviewReextractRun(literatureId)
    if (token !== reviewReextractRunToken) return
    await loadReviewBacklog()
    const paper = reviewBacklog.value.find((item) => item.literatureId === literatureId)
    selectedReviewLiteratureId.value = literatureId
    selectedReviewLiteratureIds.value = (paper?.literatureIds?.length ? paper.literatureIds : [literatureId])
      .map((item) => Number(item))
      .filter((item) => Number.isFinite(item) && item > 0)
    if (currentPage.value !== 1) currentPage.value = 1
    await fetchData()
    reviewReextractProgress.value = 100
    reviewReextractSuccess.value = 'Review candidates refreshed.'
    reviewReextractConfirmOpen.value = false
  } catch (err: any) {
    reviewReextractError.value = err?.response?.data?.detail || err?.message || 'Could not re-extract this paper.'
    reviewReextractMessage.value = reviewReextractError.value
  } finally {
    if (token === reviewReextractRunToken) {
      reviewReextractPending.value = false
    }
  }
}

function shouldLoadReviewBacklogFromVisibleQueue() {
  return isReviewQueue.value
    && canLoadReviewBacklog.value
    && reviewQueueTotalCount.value > 0
    && !reviewBacklog.value.length
    && !reviewBacklogLoading.value
}

async function loadReviewBacklog() {
  if (!canLoadReviewBacklog.value) return
  reviewBacklogLoading.value = true
  reviewBacklogError.value = ''
  try {
    const response = await getReviewBacklog({ scope: props.recordScope })
    const papers = Array.isArray(response.papers) ? response.papers : []
    reviewBacklog.value = papers
    // Drop the scoping if the selected paper no longer has pending candidates.
    if (
      selectedReviewLiteratureId.value != null &&
      !papers.some((paper) => paper.literatureId === selectedReviewLiteratureId.value)
    ) {
      selectedReviewLiteratureId.value = null
      selectedReviewLiteratureIds.value = []
    }
  } catch (err) {
    reviewBacklogError.value = 'Source list could not be loaded.'
    console.error('Failed to load review backlog', err)
  } finally {
    reviewBacklogLoading.value = false
  }
}

watch([() => result.value.total, () => result.value.items.length, isReviewQueue, canLoadReviewBacklog], () => {
  if (shouldLoadReviewBacklogFromVisibleQueue()) {
    void loadReviewBacklog()
  }
})

function selectReviewPaper(literatureId: number | null) {
  if (reviewReextractPending.value) reviewReextractRunToken += 1
  reviewReextractPending.value = false
  reviewReextractConfirmOpen.value = false
  reviewReextractError.value = ''
  reviewReextractSuccess.value = ''
  reviewReextractProgress.value = 0
  reviewReextractMessage.value = ''
  reviewReextractRunId.value = null
  reviewReextractStage.value = ''
  reviewReextractCandidateCount.value = 0
  if (selectedReviewLiteratureId.value === literatureId || literatureId == null) {
    selectedReviewLiteratureId.value = null
    selectedReviewLiteratureIds.value = []
    return
  }
  const paper = reviewBacklog.value.find((item) => item.literatureId === literatureId)
  selectedReviewLiteratureId.value = literatureId
  selectedReviewLiteratureIds.value = (paper?.literatureIds?.length ? paper.literatureIds : [literatureId])
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item) && item > 0)
}

// 批量选择 + 批量操作 ─────────────────────────────────────────
const selectedIds = ref<Set<number>>(new Set())
const batchActionPending = ref(false)
const batchError = ref('')
const reviewSheetRecord = ref<RecordResponse | null>(null)
const reviewSheetNextRecord = computed(() => {
  const current = reviewSheetRecord.value
  if (!current) return null
  // Follow the displayed (triage-filtered + backlog-sorted) order so "next"
  // matches what the reviewer sees in the queue.
  const candidateRecords = displayedRecords.value.filter((record) => databaseRecordEntityType(record) === 'candidate')
  const currentEntityId = String(databaseRecordEntityId(current))
  const currentIndex = candidateRecords.findIndex((record) => String(databaseRecordEntityId(record)) === currentEntityId)
  if (currentIndex < 0) return null
  return candidateRecords[currentIndex + 1] || null
})
const selectablePageRecordIds = computed(() =>
  result.value.items
    .filter((record) => databaseRecordEntityType(record) !== 'candidate')
    .map((record) => Number(record.id))
    .filter((id) => Number.isFinite(id)),
)
const visibleRecordIds = computed(() => new Set(selectablePageRecordIds.value))
const visibleSelectedIds = computed(() => new Set(
  Array.from(selectedIds.value).filter((id) => visibleRecordIds.value.has(id)),
))
const visibleRecordSelectionKey = computed(() => Array.from(visibleRecordIds.value).join('|'))

function toggleSelectOne(recordId: number) {
  const next = new Set(selectedIds.value)
  if (next.has(recordId)) next.delete(recordId)
  else next.add(recordId)
  selectedIds.value = next
}
function toggleSelectPage(select: boolean) {
  const next = new Set(selectedIds.value)
  for (const id of selectablePageRecordIds.value) {
    if (select) next.add(id)
    else next.delete(id)
  }
  selectedIds.value = next
}
function clearSelection() {
  selectedIds.value = new Set()
}

// Track 4: bulk candidate review ──────────────────────────────────────────────
// A candidate-only selection (keyed by entity id) that drives bulk approve/reject
// over the same per-candidate endpoints the single-row review sheet uses.
const selectedCandidateIds = ref<Set<string>>(new Set())
const bulkReviewPending = ref(false)
const bulkReviewError = ref('')

const selectablePageCandidateIds = computed(() =>
  displayedRecords.value
    .filter((record) => databaseRecordEntityType(record) === 'candidate')
    .map((record) => String(record.entityId ?? record.id)),
)
const selectedCandidateCount = computed(() =>
  selectablePageCandidateIds.value.filter((id) => selectedCandidateIds.value.has(id)).length,
)

function toggleSelectCandidate(entityId: string) {
  const next = new Set(selectedCandidateIds.value)
  if (next.has(entityId)) next.delete(entityId)
  else next.add(entityId)
  selectedCandidateIds.value = next
}
function toggleSelectAllCandidates(select: boolean) {
  const next = new Set(selectedCandidateIds.value)
  for (const id of selectablePageCandidateIds.value) {
    if (select) next.add(id)
    else next.delete(id)
  }
  selectedCandidateIds.value = next
}
function clearCandidateSelection() {
  selectedCandidateIds.value = new Set()
}

// Drop selections for candidates no longer visible (filtered out / refetched).
watch(selectablePageCandidateIds, (ids) => {
  if (!selectedCandidateIds.value.size) return
  const visible = new Set(ids)
  const pruned = new Set(Array.from(selectedCandidateIds.value).filter((id) => visible.has(id)))
  if (pruned.size !== selectedCandidateIds.value.size) selectedCandidateIds.value = pruned
})
watch(isReviewQueue, (inQueue) => {
  if (!inQueue) clearCandidateSelection()
})

function selectedCandidateRecords() {
  return displayedRecords.value.filter(
    (record) =>
      databaseRecordEntityType(record) === 'candidate'
      && selectedCandidateIds.value.has(String(record.entityId ?? record.id)),
  )
}

async function runBulkCandidateReview(
  action: 'approve' | 'reject',
  apiCall: (candidateId: number) => Promise<unknown>,
) {
  const targets = selectedCandidateRecords()
  if (!targets.length || bulkReviewPending.value) return
  const verb = action === 'approve' ? 'Approve' : 'Reject'
  if (!confirm(`${verb} ${targets.length} selected candidate${targets.length === 1 ? '' : 's'}?`)) return
  bulkReviewPending.value = true
  bulkReviewError.value = ''
  let processed = 0
  try {
    for (const record of targets) {
      const candidateId = Number(record.entityId ?? record.id)
      if (!Number.isFinite(candidateId) || candidateId <= 0) continue
      try {
        await apiCall(candidateId)
        processed += 1
      } catch (e: any) {
        bulkReviewError.value = `Failed to ${action} candidate #${candidateId}: ${e?.response?.data?.detail || e?.message || 'Unknown error'}`
        break
      }
    }
  } finally {
    clearCandidateSelection()
    if (reviewSheetRecord.value) reviewSheetRecord.value = null
    if (processed > 0) {
      window.dispatchEvent(new CustomEvent('ioniclink:review-data-changed', {
        detail: { dataset: 'lubrication', entityType: 'candidate' },
      }))
      await fetchData()
      void loadReviewBacklog()
    }
    bulkReviewPending.value = false
  }
}

async function handleBulkApproveCandidates() {
  const { approveReviewCandidate } = await import('@/lib/api')
  await runBulkCandidateReview('approve', approveReviewCandidate)
}

async function handleBulkRejectCandidates() {
  const { rejectReviewCandidate } = await import('@/lib/api')
  await runBulkCandidateReview('reject', (candidateId) => rejectReviewCandidate(candidateId))
}

async function handleBatchDelete() {
  if (!visibleSelectedIds.value.size) return
  if (!confirm(`Delete ${visibleSelectedIds.value.size} selected records? This cannot be undone.`)) return
  batchActionPending.value = true
  batchError.value = ''
  try {
    const ids = Array.from(visibleSelectedIds.value)
    const result = await batchDeleteTribologyRecords(ids)
    if (result.failed.length) {
      const sample = result.failed
        .slice(0, 3)
        .map((entry) => `#${entry.id} (${entry.reason})`)
        .join(', ')
      const more = result.failed.length > 3 ? `, +${result.failed.length - 3} more` : ''
      batchError.value =
        `Deleted ${result.deletedCount} of ${result.requested}. ` +
        `Could not delete ${result.failed.length}: ${sample}${more}`
    }
    clearSelection()
    await fetchData()
  } catch (e: any) {
    batchError.value = `Batch delete failed: ${e?.response?.data?.detail || e?.message || 'Unknown error'}`
  } finally {
    batchActionPending.value = false
  }
}

function openCandidateReviewSheet(record: RecordResponse) {
  if (databaseRecordEntityType(record) !== 'candidate') return
  closeDatabaseEvidencePopover()
  reviewSheetRecord.value = record
}

function openNextCandidateReviewSheet() {
  if (!reviewSheetNextRecord.value) return
  closeDatabaseEvidencePopover()
  reviewSheetRecord.value = reviewSheetNextRecord.value
}

async function handleCandidateReviewApproved() {
  advancePastReviewedCandidate(reviewSheetRecord.value)
}

async function handleCandidateReviewRejected() {
  advancePastReviewedCandidate(reviewSheetRecord.value)
}

function advancePastReviewedCandidate(reviewedRecord: RecordResponse | null) {
  // Capture the next candidate before removing the current one, so the queue
  // advances in place and the sheet stays open across candidates.
  const nextRecord = reviewSheetNextRecord.value
  closeDatabaseEvidencePopover()
  if (reviewedRecord) {
    optimisticallyRemoveApprovedCandidate(reviewedRecord)
  }
  reviewSheetRecord.value = nextRecord ?? null
  window.dispatchEvent(new CustomEvent('ioniclink:review-data-changed', {
    detail: { dataset: 'lubrication', entityType: 'candidate' },
  }))
  void fetchData()
  void loadReviewBacklog()
}

function optimisticallyRemoveApprovedCandidate(record: RecordResponse) {
  const approvedId = String(record.entityId ?? record.id)
  result.value = {
    ...result.value,
    total: Math.max(0, result.value.total - 1),
    items: result.value.items.filter((item) => String(item.entityId ?? item.id) !== approvedId),
  }
}

watch(
  visibleRecordSelectionKey,
  () => {
    if (!selectedIds.value.size) return
    selectedIds.value = visibleSelectedIds.value
  },
)

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

function databaseRecordEntityType(record: RecordResponse) {
  return String(record.reviewEntityType || record.entityType || 'record').trim().toLowerCase() === 'candidate'
    ? 'candidate'
    : 'record'
}

function databaseRecordEntityId(record: RecordResponse) {
  const parsed = Number(record.entityId || record.id)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : record.id
}

function databaseRecordCacheKey(record: RecordResponse) {
  return recordEvidenceCacheKey(record)
}

function databaseRecordEvidenceData(record: RecordResponse): EvidenceResult | null | undefined {
  return evidenceData.value[databaseRecordCacheKey(record)]
}

function evidenceImageSrc(record: RecordResponse): string | null {
  const ev = databaseRecordEvidenceData(record)
  if (!ev?.image_b64) return null
  return `data:image/png;base64,${ev.image_b64}`
}

function evidencePagePreviewSrc(record: RecordResponse): string | null {
  const ev = databaseRecordEvidenceData(record)
  if (!ev?.page_preview_b64) return null
  return `data:image/png;base64,${ev.page_preview_b64}`
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
  if (evidenceModalRecord.value) closeDatabaseEvidencePopover()
}

function closePdfLocate() {
  pdfLocate.value.open = false
  pdfLocate.value.title = ''
  pdfLocate.value.pdfUrl = ''
  pdfLocate.value.highlights = []
  pdfLocate.value.activeHighlightId = null
  pdfLocate.value.notice = ''
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

function parseRecordEvidenceBbox(record: RecordResponse): number[] | null {
  const raw = record.evidenceBbox
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.map((value) => Number(value)) : null
  } catch {
    const values = String(raw)
      .split(',')
      .map((value) => Number(value.trim()))
      .filter((value) => Number.isFinite(value))
    return values.length >= 4 ? values : null
  }
}

function isVisualEvidenceSource(ev: EvidenceResult | null | undefined): boolean {
  // Rely on the explicit source_type only. A `source` label that merely cites a
  // figure (e.g. a text value referencing "Fig. 2") must NOT open the whole figure
  // image — it should locate the text region in the PDF. Aligns with
  // isDatabaseVisualEvidenceEntry so click-to-open and inline display agree.
  const sourceType = String(ev?.source_type || '').trim().toLowerCase()
  return sourceType === 'visual'
    || sourceType === 'figure'
    || sourceType === 'image'
    || sourceType === 'table'
}

function openRecordPdf(record: RecordResponse, options: { forcePdf?: boolean } = {}) {
  if (!record.literatureId) return
  const ev = databaseRecordEvidenceData(record)
  if (!options.forcePdf && isVisualEvidenceSource(ev)) {
    const previewSrc = evidenceImageSrc(record) || evidencePagePreviewSrc(record)
    if (previewSrc) {
      openImagePreview(
        previewSrc,
        `${ev?.source || 'Figure Evidence'} · Page ${ev?.page || record.sourcePage || '--'}`,
      )
      return
    }
  }
  const targetPage = ev?.page || record.evidencePage || record.sourcePage || 1
  const targetBbox = ev?.bbox || parseRecordEvidenceBbox(record)
  const highlight =
    buildHighlightRect(`${record.id}-ev-${Date.now()}`, targetPage, targetBbox, 'rgba(250, 204, 21, 0.35)') ||
    buildPageAnchorHighlight(`${record.id}-page-${targetPage}-${Date.now()}`, targetPage, 'rgba(250, 204, 21, 0.35)')

  pdfLocate.value.open = true
  pdfLocate.value.title = `${record.literature?.title || 'Source Locator'} · Page ${targetPage}`
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

async function fetchDatabaseFieldEvidence(record: RecordResponse) {
  const cacheKey = databaseRecordCacheKey(record)
  if (!record.id || databaseFieldEvidenceLoading.value[cacheKey]) return
  if (databaseFieldEvidence.value[cacheKey]) return

  databaseFieldEvidenceLoading.value[cacheKey] = true
  databaseFieldEvidenceError.value[cacheKey] = null
  try {
    const entityId = databaseRecordEntityId(record)
    databaseFieldEvidence.value[cacheKey] = databaseRecordEntityType(record) === 'candidate'
      ? await getCandidateFieldEvidence(entityId, record.literatureId)
      : await getRecordFieldEvidence(entityId)
  } catch (err: any) {
    databaseFieldEvidence.value[cacheKey] = null
    databaseFieldEvidenceError.value[cacheKey] = err?.message || 'Failed to load field evidence'
  } finally {
    databaseFieldEvidenceLoading.value[cacheKey] = false
  }
}

function parseDatabaseEvidenceBbox(raw: unknown): number[] | null {
  if (!raw) return null
  if (Array.isArray(raw)) {
    const values = raw.map((value) => Number(value)).filter((value) => Number.isFinite(value))
    return values.length >= 4 ? values.slice(0, 4) : null
  }
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw)
      return parseDatabaseEvidenceBbox(parsed)
    } catch {
      const values = raw.split(',').map((value) => Number(value.trim())).filter((value) => Number.isFinite(value))
      return values.length >= 4 ? values.slice(0, 4) : null
    }
  }
  return null
}

function databaseEvidencePreviewKey(record: RecordResponse, page: number, bbox: number[]) {
  return [
    record.literatureId,
    page,
    'wide',
    ...bbox.map((value) => Number(value).toFixed(1)),
  ].join(':')
}

function databaseEvidenceFigurePreviewKey(record: RecordResponse, entry: FieldEvidenceEntry) {
  const page = typeof entry.evidence?.page === 'number' && Number.isFinite(entry.evidence.page)
    ? entry.evidence.page
    : null
  return [
    record.literatureId || 'no-lit',
    page || 'no-page',
    databaseEvidenceFigureLabelKey(entry.evidence?.source_label) || 'no-label',
  ].join(':')
}

function databaseEvidenceFigureLabelKey(value: unknown) {
  return normalizeDatabaseEvidenceText(value)
    .toLowerCase()
    .replace(/^(?:fig(?:ure)?|table)/, '')
    .replace(/[^a-z0-9]+/g, '')
}

function extractDatabaseEvidenceFigureLabelsFromText(value: unknown) {
  const text = normalizeDatabaseEvidenceText(value)
  if (!text) return []
  return Array.from(text.matchAll(/\b(?:fig(?:ure)?|table)\.?\s*[a-z]?\d+[a-z]?\b/gi))
    .map((match) => match[0])
}

function databaseEvidenceFigureLabelCandidates(entry: FieldEvidenceEntry) {
  const candidates = new Set<string>()
  const sourceLabel = databaseEvidenceFigureLabelKey(entry.evidence?.source_label)
  if (sourceLabel) candidates.add(sourceLabel)
  const textValues = [
    entry.evidence?.quote,
    entry.evidence?.matched_text,
    entry.evidence?.matchedText,
    entry.evidence?.context,
    entry.value,
  ]
  textValues
    .flatMap((value) => extractDatabaseEvidenceFigureLabelsFromText(value))
    .map((value) => databaseEvidenceFigureLabelKey(value))
    .filter(Boolean)
    .forEach((value) => candidates.add(value))
  return [...candidates]
}

function databaseEvidenceFigurePreviewMatchesEntry(preview: PdfFigurePreview, entry: FieldEvidenceEntry) {
  const page = typeof entry.evidence?.page === 'number' && Number.isFinite(entry.evidence.page)
    ? entry.evidence.page
    : null
  if (page && preview.page !== page) return false
  const sourceLabels = databaseEvidenceFigureLabelCandidates(entry)
  const previewLabel = databaseEvidenceFigureLabelKey(preview.label)
  if (!sourceLabels.length || !previewLabel) return false
  return sourceLabels.some((sourceLabel) =>
    sourceLabel === previewLabel
    || sourceLabel.startsWith(previewLabel)
    || previewLabel.startsWith(sourceLabel),
  )
}

function databaseEntryHasTextMatch(entry: FieldEvidenceEntry) {
  const evidence = entry.evidence || {}
  return Boolean(normalizeDatabaseEvidenceText(evidence.matched_text) || normalizeDatabaseEvidenceText(evidence.matchedText))
}

function isDatabaseVisualEvidenceEntry(entry: FieldEvidenceEntry) {
  const evidence = entry.evidence || {}
  const sourceType = normalizeDatabaseEvidenceText(evidence.source_type).toLowerCase()
  // Rely on the explicit source_type only. A source_label that merely cites a
  // figure (e.g. a text sentence referencing "Fig. 2") must NOT be treated as a
  // figure, or text-grounded values render as a whole, unhelpful figure crop.
  return sourceType === 'table'
    || sourceType === 'figure'
    || sourceType === 'visual'
    || sourceType === 'image'
}

function databaseEvidenceEntryHasPdfLocator(entry: FieldEvidenceEntry) {
  const page = typeof entry.evidence?.page === 'number' && Number.isFinite(entry.evidence.page)
    ? entry.evidence.page
    : null
  return Boolean(page && parseDatabaseEvidenceBbox(entry.evidence?.bbox))
}

function databaseEvidenceShouldRenderPdfPreview(entry: FieldEvidenceEntry) {
  const sourceType = normalizeDatabaseEvidenceText(entry.evidence?.source_type).toLowerCase()
  if (sourceType === 'text' && normalizeDatabaseEvidenceText(entry.evidence?.quote)) return false
  if (String(entry.grounding_mode || '').toLowerCase() === 'derived') return false
  return isDatabaseVisualEvidenceEntry(entry) || !normalizeDatabaseEvidenceText(entry.evidence?.quote)
}

async function fetchDatabaseEvidencePreview(record: RecordResponse, page: number | null | undefined, bbox: number[] | null | undefined) {
  if (!record.literatureId || !page || !bbox?.length) return
  const key = databaseEvidencePreviewKey(record, page, bbox)
  if (databaseEvidencePreviewImages.value[key] || databaseEvidencePreviewLoading.value[key]) return

  databaseEvidencePreviewLoading.value[key] = true
  databaseEvidencePreviewError.value[key] = null
  try {
    const response = await getPdfBboxPreview(record.literatureId, page, bbox, 'region', 'wide')
    databaseEvidencePreviewImages.value[key] = `data:image/png;base64,${response.image_b64}`
  } catch (err: any) {
    databaseEvidencePreviewImages.value[key] = null
    databaseEvidencePreviewError.value[key] = evidencePreviewErrorMessage(err)
  } finally {
    databaseEvidencePreviewLoading.value[key] = false
  }
}

async function fetchDatabaseFigureEvidencePreview(record: RecordResponse, entry: FieldEvidenceEntry) {
  if (!record.literatureId || !isDatabaseVisualEvidenceEntry(entry) || databaseEntryHasTextMatch(entry)) return
  const literatureId = record.literatureId
  const key = databaseEvidenceFigurePreviewKey(record, entry)
  if (databaseEvidenceFigurePreviewImages.value[key] || databaseEvidenceFigurePreviewLoading.value[key]) return

  databaseEvidenceFigurePreviewLoading.value[key] = true
  databaseEvidenceFigurePreviewError.value[key] = null
  try {
    if (!databaseEvidenceFigurePreviews.value[literatureId]) {
      const response = await getPdfFigurePreviews(literatureId)
      databaseEvidenceFigurePreviews.value[literatureId] = response.items || []
    }
    const matched = databaseEvidenceFigurePreviews.value[literatureId]
      .find((preview) => databaseEvidenceFigurePreviewMatchesEntry(preview, entry))
    databaseEvidenceFigurePreviewImages.value[key] = matched?.image_b64
      ? `data:image/png;base64,${matched.image_b64}`
      : null
  } catch (err: any) {
    databaseEvidenceFigurePreviewImages.value[key] = null
    databaseEvidenceFigurePreviewError.value[key] = evidencePreviewErrorMessage(err)
  } finally {
    databaseEvidenceFigurePreviewLoading.value[key] = false
  }
}

async function hydrateDatabaseEvidencePreviews(record: RecordResponse) {
  await fetchDatabaseFieldEvidence(record)
  const selectedEntries = databaseEvidenceSelectedEntries(record)
  const fieldTargets = selectedEntries
    .filter(({ entry }) => databaseEvidenceEntryHasPdfLocator(entry) && databaseEvidenceShouldRenderPdfPreview(entry))
    .map(({ entry }) => ({
      page: entry.evidence?.page ?? null,
      bbox: parseDatabaseEvidenceBbox(entry.evidence?.bbox),
    }))
  await Promise.all(
    [
      ...selectedEntries.map(({ entry }) => fetchDatabaseFigureEvidencePreview(record, entry)),
      ...fieldTargets.map((target) => fetchDatabaseEvidencePreview(record, target.page, target.bbox)),
    ],
  )
}

function isCurrentDatabaseEvidenceRequest(record: RecordResponse, field: DatabaseEvidenceField, focusedFieldKey: string | null, evidenceOpenToken: number) {
  return databaseEvidenceOpenToken.value === evidenceOpenToken
    && evidenceModalRecord.value
    && databaseRecordCacheKey(evidenceModalRecord.value) === databaseRecordCacheKey(record)
    && databaseEvidenceField.value === field
    && databaseEvidenceFocusedFieldKey.value === focusedFieldKey
}

function handleOpenEvidenceModal(record: RecordResponse, field: DatabaseEvidenceField = 'conditions', _event?: Event, fieldKey?: string) {
  closeEditDrawer()
	  databaseEvidenceField.value = field
	  const focusedFieldKey = normalizeDatabaseEvidenceFieldKey(fieldKey)
	  databaseEvidenceFocusedFieldKey.value = focusedFieldKey
	  databaseEvidenceSlideIndex.value = 0
	  const evidenceOpenToken = databaseEvidenceOpenToken.value + 1
	  databaseEvidenceOpenToken.value = evidenceOpenToken
	  openEvidenceModal(record, { syncConfidence: false })
	  setDatabaseEvidencePreferredSlide(record, field)
	  void hydrateDatabaseEvidencePreviews(record).then(() => {
	    if (isCurrentDatabaseEvidenceRequest(record, field, focusedFieldKey, evidenceOpenToken)) {
	      setDatabaseEvidencePreferredSlide(record, field)
	    }
	  })
	}

function databaseEvidenceTitle(field = databaseEvidenceField.value) {
  if (databaseEvidenceFocusedFieldKey.value) return databaseEvidenceFieldLabel(databaseEvidenceFocusedFieldKey.value)
  if (field === 'ionic-liquid') return 'Ionic Liquid'
  if (field === 'tribopair') return 'Tribopair'
  if (field === 'cof') return 'COF'
  return 'Conditions'
}

function databaseEvidenceValue(record: RecordResponse, field = databaseEvidenceField.value) {
  const focusedValue = databaseEvidenceFocusedValue(record)
  if (focusedValue) return focusedValue
  if (field === 'ionic-liquid') return lubricantDisplay(record)
  if (field === 'tribopair') return tribopairDisplay(record)
  if (field === 'cof') return cofDisplay(record)
  const summaries = conditionGroups(record)
    .map((group) => `${group.label}: ${group.summary}`)
    .filter((value) => String(value || '').trim())
  return summaries.join(' · ') || '--'
}

function databaseEvidencePage(record: RecordResponse) {
  const fieldPage = databaseEvidenceSelectedEntries(record)
    .filter(({ fieldKey, entry }) => databaseEvidenceEntryHasContent(fieldKey, entry))
    .map(({ entry }) => entry.evidence?.page)
    .find((page) => typeof page === 'number' && Number.isFinite(page) && page > 0)
  if (fieldPage) return `Page ${fieldPage}`

  const hitPage = databaseEvidenceTermHits(record)
    .map((hit) => hit.page)
    .find((page) => typeof page === 'number' && Number.isFinite(page) && page > 0)
  if (hitPage) return `Page ${hitPage}`

  const ev = databaseRecordEvidenceData(record)
  const page = ev?.page || record.evidencePage || record.sourcePage
  return page ? `Page ${page}` : 'Source'
}

function normalizeDatabaseEvidenceText(value: unknown) {
  return String(value || '').trim().replace(/\s+/g, ' ')
}

function normalizeDatabaseEvidenceFieldKey(value: unknown) {
  const key = String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_')
  const aliases: Record<string, string> = {
    water: 'water_content',
    lubricant: 'ionic_liquid',
    ionic_liquid_display: 'ionic_liquid',
    material_name: 'material',
    loadvalue: 'load',
    load_value: 'load',
    loadraw: 'load',
    load_raw: 'load',
    normal_load: 'load',
    normalload: 'load',
  }
  return aliases[key] || key || null
}

function databaseEvidenceFocusedValue(record: RecordResponse) {
  const focusedKey = databaseEvidenceFocusedFieldKey.value
  if (!focusedKey) return ''
  const fields = databaseFieldEvidence.value[databaseRecordCacheKey(record)]?.fields || {}
  const entry = databaseEvidenceEntryForKey(fields, focusedKey)
  const entryValue = normalizeDatabaseEvidenceText(entry?.value)
  if (entryValue) return entryValue
  const fallbacks: Record<string, unknown> = {
    ionic_liquid: lubricantDisplay(record),
    cation: record.cation,
    anion: record.anion,
    material: record.materialName,
    probe_material: record.probeMaterial,
    probe_geometry: record.probeGeometry,
    probe_radius: record.probeRadius,
    probe_roughness: record.probeRoughness,
    substrate_material: record.substrateMaterial || record.materialName,
    substrate_coating: record.substrateCoating,
    substrate_roughness: record.substrateRoughness,
    surface_roughness: record.surfaceRoughness,
    film_thickness: record.filmThickness,
    load: record.loadValue,
    speed: record.speedValue,
    shear_rate: record.shearRate,
    potential: record.potential,
    current: entryValue,
    current_density: entryValue,
    temperature: record.temperature,
    water_content: record.waterContent,
    cof: cofDisplay(record),
  }
  return normalizeDatabaseEvidenceText(fallbacks[focusedKey])
}

function databaseEvidenceFieldKeys(field = databaseEvidenceField.value) {
  if (databaseEvidenceFocusedFieldKey.value) return databaseEvidenceFocusedFieldKeys(databaseEvidenceFocusedFieldKey.value)
  if (field === 'ionic-liquid') return ['ionic_liquid', 'lubricant', 'lubricant_alias', 'ionic_liquid_display', 'cation', 'anion']
  if (field === 'tribopair') return [
    'probe_material',
    'probe_geometry',
    'probe_radius',
	    'probe_roughness',
	    'film_thickness',
	    'substrate_material',
    'substrate_coating',
    'substrate_roughness',
    'surface_roughness',
    'material',
    'material_name',
  ]
  if (field === 'cof') return ['cof', 'cof_extracted', 'friction_force', 'wear_rate']
	  return ['temperature', 'load', 'normal_load', 'speed', 'shear_rate', 'current', 'current_density', 'potential', 'water_content']
}

function databaseEvidenceSemanticTypes(field = databaseEvidenceField.value) {
  if (databaseEvidenceFocusedFieldKey.value) return new Set(databaseEvidenceFocusedFieldKeys(databaseEvidenceFocusedFieldKey.value).map(databaseEvidenceSemanticKey))
  if (field === 'ionic-liquid') return new Set(['lubricant', 'ionic_liquid', 'cation', 'anion'])
		  if (field === 'tribopair') return new Set(['material', 'probe_material', 'substrate_material', 'substrate_coating', 'surface_roughness', 'film_thickness'])
  if (field === 'cof') return new Set(['cof', 'friction_force', 'wear_rate'])
		  return new Set(['temperature', 'load', 'speed', 'shear_rate', 'current', 'current_density', 'potential', 'water_content'])
}

function databaseEvidenceEntryQualityScore(fieldKey: string, entry: FieldEvidenceEntry) {
  const evidence = entry.evidence || {}
  let score = 0
  if (normalizeDatabaseEvidenceText(evidence.quote)) score += 6
  if (normalizeDatabaseEvidenceText(evidence.matched_text) || normalizeDatabaseEvidenceText(evidence.matchedText)) score += 4
  if (typeof evidence.page === 'number' && Number.isFinite(evidence.page)) score += 2
  if (parseDatabaseEvidenceBbox(evidence.bbox)) score += isDatabaseVisualEvidenceEntry(entry) ? 3 : 1
  if (normalizeDatabaseEvidenceText(entry.grounding_note)) score += 2
  if (String(entry.grounding_mode || '').toLowerCase() === 'derived') score += 2
  if (normalizeDatabaseEvidenceText(entry.value)) score += 1
  if (fieldKey.includes('alias') || fieldKey === 'lubricant') score -= 1
  return score
}

function databaseEvidenceBestEntriesBySemanticKey(entries: Array<{ fieldKey: string, entry: FieldEvidenceEntry }>) {
  const bySemantic = new Map<string, { fieldKey: string, entry: FieldEvidenceEntry }>()
  for (const item of entries) {
    const semanticKey = databaseEvidenceSemanticKey(item.fieldKey)
    const existing = bySemantic.get(semanticKey)
    if (!existing || databaseEvidenceEntryQualityScore(item.fieldKey, item.entry) > databaseEvidenceEntryQualityScore(existing.fieldKey, existing.entry)) {
      bySemantic.set(semanticKey, item)
    }
  }
  return Array.from(bySemantic.values())
}

function databaseEvidenceFocusedFieldKeys(fieldKey: string) {
  const normalized = normalizeDatabaseEvidenceFieldKey(fieldKey) || fieldKey
  const fallbackKeys: Record<string, string[]> = {
    cation: ['cation'],
    anion: ['anion'],
    material: ['material', 'material_name'],
    probe_material: ['probe_material'],
    substrate_material: ['substrate_material'],
    substrate_coating: ['substrate_coating'],
    probe_roughness: ['probe_roughness'],
    substrate_roughness: ['substrate_roughness'],
    surface_roughness: ['surface_roughness'],
    load: ['load', 'normal_load'],
    current: ['current'],
    current_density: ['current_density'],
    water_content: ['water_content', 'water'],
    cof: ['cof', 'cof_extracted'],
  }
  return Array.from(new Set(fallbackKeys[normalized] || [normalized]))
}

function databaseEvidenceFlexibleEntryValue(entry: any) {
  const value = normalizeDatabaseEvidenceText(entry?.value)
  const unit = normalizeDatabaseEvidenceText(entry?.unit)
  if (!value) return ''
  if (unit && !value.toLowerCase().includes(unit.toLowerCase())) return `${value} ${unit}`
  return value
}

function databaseEvidenceEntryForKey(fields: Record<string, FieldEvidenceEntry | undefined>, fieldKey: string): FieldEvidenceEntry | undefined {
  const directEntry = fields[fieldKey]
  if (directEntry) return directEntry
  const flexibleFields = (fields as any)?._flexible_fields
  if (!flexibleFields || typeof flexibleFields !== 'object' || Array.isArray(flexibleFields)) return undefined
  const rawEntry = flexibleFields[fieldKey]
  const entry = Array.isArray(rawEntry) ? rawEntry.find(Boolean) : rawEntry
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return undefined
  const value = databaseEvidenceFlexibleEntryValue(entry)
  if (!value) return undefined
  return {
    value,
    confidence: typeof entry.confidence === 'number' ? entry.confidence : entry._norm?.confidence,
    evidence: entry.evidence && typeof entry.evidence === 'object' ? entry.evidence : null,
    status: entry._norm?.resolved === false ? 'partial' : 'grounded',
    grounding_mode: entry._norm?.stage || 'flexible',
    grounding_note: entry._norm?.notes || null,
  }
}

function databaseEvidenceFocusedEntries(fields: Record<string, FieldEvidenceEntry | undefined>) {
  const focusedKey = databaseEvidenceFocusedFieldKey.value
  if (!focusedKey) return null
  const entries = databaseEvidenceFocusedFieldKeys(focusedKey)
    .map((fieldKey) => ({ fieldKey, entry: databaseEvidenceEntryForKey(fields, fieldKey) }))
    .filter((item): item is { fieldKey: string, entry: FieldEvidenceEntry } => Boolean(item.entry))
  const exact = entries.filter(({ fieldKey, entry }) => (
    databaseEvidenceSemanticKey(fieldKey) === databaseEvidenceSemanticKey(focusedKey)
    && databaseEvidenceEntryHasContent(fieldKey, entry)
  ))
  if (exact.length) return databaseEvidenceBestEntriesBySemanticKey(exact)
  return []
}

function databaseEvidenceSelectedEntries(record: RecordResponse) {
  const fields = databaseFieldEvidence.value[databaseRecordCacheKey(record)]?.fields || {}
  const focusedEntries = databaseEvidenceFocusedEntries(fields)
  if (focusedEntries) return focusedEntries
  const entries = databaseEvidenceFieldKeys()
    .map((fieldKey) => ({ fieldKey, entry: databaseEvidenceEntryForKey(fields, fieldKey) }))
    .filter((item): item is { fieldKey: string, entry: FieldEvidenceEntry } => Boolean(item.entry))
  if (databaseEvidenceField.value !== 'tribopair') return databaseEvidenceBestEntriesBySemanticKey(entries)

  const roleSpecificKeys = new Set(['probe_material', 'probe_geometry', 'probe_radius', 'probe_roughness', 'substrate_material', 'substrate_coating', 'substrate_roughness', 'surface_roughness'])
  const hasRoleSpecificEvidence = entries.some(({ fieldKey, entry }) => roleSpecificKeys.has(fieldKey) && databaseEvidenceEntryHasContent(fieldKey, entry))
  const selectedEntries = hasRoleSpecificEvidence
    ? entries.filter(({ fieldKey }) => !['material', 'material_name'].includes(fieldKey))
    : entries
  return databaseEvidenceBestEntriesBySemanticKey(selectedEntries)
}

const databaseEvidenceConditionBaseKeys = ['temperature', 'load', 'speed', 'shear_rate', 'current', 'current_density', 'potential', 'water_content']

function databaseEvidenceConditionSwitchEntry(record: RecordResponse, fieldKey: string) {
  const fields = databaseFieldEvidence.value[databaseRecordCacheKey(record)]?.fields || {}
  return databaseEvidenceFocusedFieldKeys(fieldKey)
    .map((candidateKey) => ({ fieldKey: candidateKey, entry: databaseEvidenceEntryForKey(fields, candidateKey) }))
    .find((item): item is { fieldKey: string, entry: FieldEvidenceEntry } =>
      Boolean(item.entry && databaseEvidenceEntryHasContent(item.fieldKey, item.entry)),
    ) || null
}

function databaseEvidenceConditionSwitchKeys(record: RecordResponse) {
  if (databaseEvidenceField.value !== 'conditions') return []
  const seen = new Set<string>()
  const keys: string[] = []
  for (const fieldKey of databaseEvidenceConditionBaseKeys) {
    const entry = databaseEvidenceConditionSwitchEntry(record, fieldKey)
    if (!entry) continue
    const semanticKey = databaseEvidenceSemanticKey(entry.fieldKey)
    if (seen.has(semanticKey)) continue
    seen.add(semanticKey)
    keys.push(fieldKey)
  }
  return keys
}

function databaseEvidenceConditionSwitchValue(record: RecordResponse, fieldKey: string) {
  const item = databaseEvidenceConditionSwitchEntry(record, fieldKey)
  return item ? databaseEvidenceEntryValue(item.entry) : ''
}

function databaseEvidenceConditionSwitchActive(record: RecordResponse, fieldKey: string) {
  const targetKey = databaseEvidenceSemanticKey(fieldKey)
  const focusedKey = databaseEvidenceFocusedFieldKey.value
  if (focusedKey) return databaseEvidenceSemanticKey(focusedKey) === targetKey
  return databaseEvidenceSemanticKey(activeDatabaseEvidenceSlide(record)?.fieldKey || '') === targetKey
}

function focusDatabaseEvidenceConditionKey(record: RecordResponse, fieldKey: string | null) {
  databaseEvidenceField.value = 'conditions'
  databaseEvidenceFocusedFieldKey.value = fieldKey ? normalizeDatabaseEvidenceFieldKey(fieldKey) : null
  databaseEvidenceSlideIndex.value = 0
  const evidenceOpenToken = databaseEvidenceOpenToken.value + 1
  databaseEvidenceOpenToken.value = evidenceOpenToken
  if (!fieldKey) {
    setDatabaseEvidencePreferredSlide(record, 'conditions')
    return
  }
  void hydrateDatabaseEvidencePreviews(record).then(() => {
    if (isCurrentDatabaseEvidenceRequest(record, 'conditions', databaseEvidenceFocusedFieldKey.value, evidenceOpenToken)) {
      setDatabaseEvidencePreferredSlide(record, 'conditions')
    }
  })
}

function switchDatabaseEvidenceConditionKey(record: RecordResponse, fieldKey: string) {
  focusDatabaseEvidenceConditionKey(record, fieldKey)
}

function databaseEvidenceTermHits(record: RecordResponse) {
  if (databaseEvidenceFocusedFieldKey.value) return []
  const semanticTypes = databaseEvidenceSemanticTypes()
  const coveredSemanticKeys = databaseEvidenceCoveredSemanticKeys(record)
  return (databaseRecordEvidenceData(record)?.term_hits || []).filter((hit) => {
    const semanticType = String(hit.semantic_type || '').trim().toLowerCase()
    return semanticTypes.has(semanticType) && !coveredSemanticKeys.has(databaseEvidenceSemanticKey(semanticType))
  })
}

function databaseEvidenceSemanticKey(fieldKey: string) {
  const normalized = String(fieldKey || '').trim().toLowerCase().replace(/[\s-]+/g, '_')
  const aliases: Record<string, string> = {
    material_name: 'material',
    ionic_liquid_display: 'ionic_liquid',
    lubricant_alias: 'ionic_liquid',
    lubricant: 'ionic_liquid',
    cof_extracted: 'cof',
    loadvalue: 'load',
    load_value: 'load',
    loadraw: 'load',
    load_raw: 'load',
    normal_load: 'load',
    normalload: 'load',
  }
  return aliases[normalized] || normalized
}

function databaseEvidenceEntryHasContent(fieldKey: string, entry: FieldEvidenceEntry) {
  if (!databaseEvidenceEntryHasDisplayValue(entry)) return false
  const quotes = databaseEvidenceQuoteFromEntry(fieldKey, entry)
  const page = typeof entry.evidence?.page === 'number' && Number.isFinite(entry.evidence.page)
    ? entry.evidence.page
    : null
  const bbox = parseDatabaseEvidenceBbox(entry.evidence?.bbox)
  return Boolean(quotes.length || (page && bbox && databaseEvidenceShouldRenderPdfPreview(entry)))
}

function databaseEvidenceCoveredSemanticKeys(record: RecordResponse) {
  const covered = new Set<string>()
  for (const { fieldKey, entry } of databaseEvidenceSelectedEntries(record)) {
    if (!databaseEvidenceEntryHasContent(fieldKey, entry)) continue
    covered.add(databaseEvidenceSemanticKey(fieldKey))
  }
  return covered
}

function databaseEvidenceContextualNumericHighlight(text: string, numericText: string, fieldKey: string) {
  const normalizedNumber = normalizeDatabaseEvidenceText(numericText).replace(/[^\d.+-]/g, '')
  if (!normalizedNumber) return ''
  const unitPattern = fieldKey.includes('roughness')
    ? '(?:nm|μm|um)'
    : '(?:nm|μm|um|mm|cm|m|hz|n|mn|nn|v|mv|k|°c|c)'
  const escaped = normalizedNumber.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\./g, '[.]')
  const unitHit = new RegExp(`(?:RMS\\s+|roughness\\s+|scan\\s+(?:size|rate)\\s+(?:was\\s+)?|velocity\\s+(?:of\\s+)?)?${escaped}\\s*${unitPattern}\\b`, 'i').exec(text)
  return normalizeDatabaseEvidenceText(unitHit?.[0])
}

function databaseEvidenceDerivedHighlights(text: string) {
  return Array.from(text.matchAll(/\b(?:scan\s+(?:size|length|range|rate|frequency)\s+(?:was\s+)?)?\d+(?:\.\d+)?\s*(?:nm|μm|um|mm|hz)\b/gi))
    .map((match) => normalizeDatabaseEvidenceText(match[0]))
    .filter(Boolean)
}

function databaseEvidenceTrustedContext(fieldKey: string, entry: FieldEvidenceEntry) {
  const context = normalizeDatabaseEvidenceText(entry.evidence?.context)
  if (!context) return ''
  const lowerContext = context.toLowerCase()
  const matchedText = normalizeDatabaseEvidenceText(entry.evidence?.matched_text)
    || normalizeDatabaseEvidenceText(entry.evidence?.matchedText)
  const anchors = [
    matchedText,
    normalizeDatabaseEvidenceText(entry.evidence?.quote),
    normalizeDatabaseEvidenceText(entry.value),
  ]
  if (anchors.some((anchor) => anchor.length >= 8 && lowerContext.includes(anchor.toLowerCase()))) {
    return context
  }
  const isDerived = String(entry.grounding_mode || '').toLowerCase() === 'derived'
  if (fieldKey === 'speed' && isDerived) {
    const derivedHighlights = databaseEvidenceDerivedHighlights(context)
    const hasScanRate = /\b(?:scan\s+(?:rate|frequency)|\d+(?:\.\d+)?\s*hz)\b/i.test(context)
    const hasScanLength = /\b(?:scan\s+(?:size|length|range)|\d+(?:\.\d+)?\s*(?:nm|μm|um|mm))\b/i.test(context)
    if (derivedHighlights.length >= 2 && hasScanRate && hasScanLength) return context
  }
  return ''
}

function databaseEvidenceQuoteHighlights(fieldKey: string, entry: FieldEvidenceEntry, quote: string, matchedText: string) {
  const isDerived = String(entry.grounding_mode || '').toLowerCase() === 'derived'
  const text = quote || matchedText
  if (isDerived) {
    const derivedHighlights = databaseEvidenceDerivedHighlights(text)
    return derivedHighlights.length ? derivedHighlights : [text].filter(Boolean)
  }

  const highlights: string[] = []
  if (/^\s*[-+]?\d+(?:\.\d+)?\s*$/.test(matchedText)) {
    const contextual = databaseEvidenceContextualNumericHighlight(text, matchedText, fieldKey)
    if (contextual) highlights.push(contextual)
  } else if (matchedText) {
    highlights.push(matchedText)
  }

  const valueText = normalizeDatabaseEvidenceText(entry.value)
  if (valueText && text.toLowerCase().includes(valueText.toLowerCase())) highlights.push(valueText)
  return Array.from(new Set(highlights.filter(Boolean)))
}

function databaseEvidenceShouldSuppressBareEvidence(fieldKey: string, quote = '', matchedText = '', groundingMode = '') {
  const combined = `${normalizeDatabaseEvidenceText(quote)} ${normalizeDatabaseEvidenceText(matchedText)}`.trim()
  const matched = normalizeDatabaseEvidenceText(matchedText)
  const quoteText = normalizeDatabaseEvidenceText(quote)
  const isBareMatchedNumber = /^\s*[-+]?\d+(?:\.\d+)?\s*$/.test(matched)
  const isBareQuoteNumber = /^\s*[-+]?\d+(?:\.\d+)?\s*$/.test(quoteText)
  if (groundingMode === 'derived' && !databaseEvidenceDerivedHighlights(combined).length) return true
  if (isBareMatchedNumber && (!quoteText || isBareQuoteNumber)) return true
  if (fieldKey.includes('roughness')) {
    const hasContext = /\b(?:nm|μm|um|rms|roughness|root[- ]mean[- ]square)\b/i.test(combined)
    if ((isBareMatchedNumber || isBareQuoteNumber) && !hasContext) return true
  }
  return false
}

function databaseEvidenceQuoteFromEntry(fieldKey: string, entry: FieldEvidenceEntry): DatabaseEvidenceQuote[] {
  const matchedText = normalizeDatabaseEvidenceText(entry.evidence?.matched_text)
    || normalizeDatabaseEvidenceText(entry.evidence?.matchedText)
  const trustedContext = databaseEvidenceTrustedContext(fieldKey, entry)
  const quote = trustedContext || normalizeDatabaseEvidenceText(entry.evidence?.quote)
  const note = normalizeDatabaseEvidenceText(entry.grounding_note)
  const isDerived = String(entry.grounding_mode || '').toLowerCase() === 'derived'
  const quotes: DatabaseEvidenceQuote[] = []
  const primaryText = quote || matchedText
  const suppressBareEvidence = databaseEvidenceShouldSuppressBareEvidence(fieldKey, quote, matchedText, String(entry.grounding_mode || '').toLowerCase())

  if (primaryText && !suppressBareEvidence) {
    const text = note && !isDerived && note !== primaryText ? `${primaryText} ${note}` : primaryText
    quotes.push({ text, highlights: databaseEvidenceQuoteHighlights(fieldKey, entry, text, matchedText), fieldKey })
  }
  if ((suppressBareEvidence || !primaryText) && note) {
    quotes.push({ text: note, highlights: databaseEvidenceQuoteHighlights(fieldKey, entry, note, matchedText), fieldKey })
  }
  return quotes
}

function databaseEvidenceFieldLabel(fieldKey: string) {
  return fieldKey
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

function databaseEvidenceEntryValue(entry: FieldEvidenceEntry) {
  return normalizeDatabaseEvidenceText(entry.value)
}

function databaseEvidenceEntryHasDisplayValue(entry: FieldEvidenceEntry) {
  const value = databaseEvidenceEntryValue(entry).toLowerCase()
  return Boolean(value && !['unknown', 'unknown material', 'unknown il', 'n/a', 'none', '-', '--'].includes(value))
}

function databaseEvidenceSlideHasContent(slide: DatabaseEvidenceSlide) {
  return Boolean(
    normalizeDatabaseEvidenceText(slide.quote?.text)
      || normalizeDatabaseEvidenceText(slide.aliasNote)
      || normalizeDatabaseEvidenceText(slide.note)
      || slide.imageSrc
  )
}

function databaseEvidenceCationAliasNote(
  record: RecordResponse,
  fieldKey: string,
  entry: FieldEvidenceEntry,
  quote: DatabaseEvidenceQuote | null,
) {
  const semanticKey = databaseEvidenceSemanticKey(fieldKey)
  if (!['ionic_liquid', 'cation'].includes(semanticKey)) return ''

  const evidenceText = [
    quote?.text,
    entry.evidence?.quote,
    entry.evidence?.matched_text,
    (entry.evidence as any)?.matchedText,
    entry.evidence?.context,
    entry.value,
  ].map((part) => normalizeDatabaseEvidenceText(part)).filter(Boolean).join(' ')

  return ionicLiquidCationAliasNote(record, evidenceText)
}

function databaseEvidenceSlides(record: RecordResponse): DatabaseEvidenceSlide[] {
  const slides: DatabaseEvidenceSlide[] = []
  for (const { fieldKey, entry } of databaseEvidenceSelectedEntries(record)) {
    if (!databaseEvidenceEntryHasDisplayValue(entry)) continue
    if (!databaseEvidenceEntryHasContent(fieldKey, entry)) continue
    const page = typeof entry.evidence?.page === 'number' && Number.isFinite(entry.evidence.page)
      ? entry.evidence.page
      : null
    const bbox = parseDatabaseEvidenceBbox(entry.evidence?.bbox)
    const key = page && bbox && databaseEvidenceShouldRenderPdfPreview(entry) ? databaseEvidencePreviewKey(record, page, bbox) : ''
    // Text-grounded values (a matched phrase) get the tight bbox crop, never the
    // whole figure — only genuinely figure-sourced values fall back to the figure.
    const figureKey = isDatabaseVisualEvidenceEntry(entry) && !databaseEntryHasTextMatch(entry)
      ? databaseEvidenceFigurePreviewKey(record, entry)
      : ''
    const quote = databaseEvidenceQuoteFromEntry(fieldKey, entry)[0] || null
    const aliasNote = databaseEvidenceCationAliasNote(record, fieldKey, entry, quote)
    const isDerived = String(entry.grounding_mode || '').toLowerCase() === 'derived'
    const bboxOnlyNote = !quote && page && bbox
      ? 'PDF locator available; quote text was not stored for this field.'
      : ''
	    const slide = {
	      id: `field-${fieldKey}-${page || 'text'}-${slides.length}`,
	      fieldKey,
	      label: databaseEvidenceFieldLabel(fieldKey),
	      page,
	      value: databaseEvidenceEntryValue(entry),
	      quote,
	      aliasNote,
	      note: isDerived
	        ? normalizeDatabaseEvidenceText(entry.grounding_note)
	        : bboxOnlyNote,
	      noteLabel: isDerived ? 'Derived calculation' : 'Evidence locator',
	      locatorKey: page ? `${page}:${bbox ? bbox.join(',') : 'page-only'}` : '',
	      confidence: typeof entry.confidence === 'number' && Number.isFinite(entry.confidence) ? entry.confidence : null,
	      imageSrc: (figureKey ? databaseEvidenceFigurePreviewImages.value[figureKey] || null : null)
          || (key ? databaseEvidencePreviewImages.value[key] || null : null),
      imageLoading: Boolean(
        (figureKey && databaseEvidenceFigurePreviewLoading.value[figureKey])
          || (key && databaseEvidencePreviewLoading.value[key]),
      ),
      imageError: (figureKey ? databaseEvidenceFigurePreviewError.value[figureKey] || null : null)
        || (key ? databaseEvidencePreviewError.value[key] || null : null),
    }
    if (databaseEvidenceSlideHasContent(slide)) slides.push(slide)
  }

  for (const hit of databaseEvidenceTermHits(record)) {
    const value = normalizeDatabaseEvidenceText(hit.matched_text) || normalizeDatabaseEvidenceText(hit.term)
    const quoteText = normalizeDatabaseEvidenceText(hit.snippet_text) || value
    const slide = {
      id: `term-${hit.semantic_type || 'hit'}-${hit.page}-${slides.length}`,
      fieldKey: hit.semantic_type || undefined,
      label: databaseEvidenceFieldLabel(String(hit.semantic_type || databaseEvidenceTitle())),
      page: hit.page || null,
      value,
      quote: quoteText ? { text: quoteText, highlights: [value, normalizeDatabaseEvidenceText(hit.term)].filter(Boolean) } : null,
      imageSrc: hit.image_b64 ? `data:image/png;base64,${hit.image_b64}` : null,
    }
    if (databaseEvidenceSlideHasContent(slide)) slides.push(slide)
  }

  const seen = new Set<string>()
  return slides.filter((slide) => {
    const key = databaseEvidenceSlideDedupeKey(slide)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function databaseEvidenceSlideDedupeKey(slide: DatabaseEvidenceSlide) {
  return [
    slide.locatorKey || slide.page || '',
    normalizeDatabaseEvidenceText(slide.value),
    normalizeDatabaseEvidenceText(slide.quote?.text),
    normalizeDatabaseEvidenceText(slide.aliasNote),
    normalizeDatabaseEvidenceText(slide.note),
  ].join('|')
}

function activeDatabaseEvidenceSlide(record: RecordResponse) {
  const slides = databaseEvidenceSlides(record)
  if (!slides.length) return null
  const boundedIndex = Math.min(Math.max(0, databaseEvidenceSlideIndex.value), slides.length - 1)
  if (boundedIndex !== databaseEvidenceSlideIndex.value) databaseEvidenceSlideIndex.value = boundedIndex
  return slides[boundedIndex] || null
}

function databaseEvidenceIsLoading(record: RecordResponse) {
  return Boolean(databaseFieldEvidenceLoading.value[databaseRecordCacheKey(record)] && databaseEvidenceSlides(record).length === 0)
}

function databaseEvidenceDisplayError(record: RecordResponse) {
  const fieldError = databaseFieldEvidenceError.value[databaseRecordCacheKey(record)]
  if (fieldError) return fieldError
  return databaseEvidenceSlides(record).length === 0 ? evidenceError.value[databaseRecordCacheKey(record)] : ''
}

function databaseEvidencePreferredSlideIndex(record: RecordResponse, field = databaseEvidenceField.value) {
  const slides = databaseEvidenceSlides(record)
  if (!slides.length) return 0
  if (field === 'conditions') {
    const derivedSpeedIndex = slides.findIndex((slide) => (
      databaseEvidenceSemanticKey(slide.fieldKey || '') === 'speed'
      && Boolean(normalizeDatabaseEvidenceText(slide.note))
    ))
    if (derivedSpeedIndex >= 0) return derivedSpeedIndex
  }
  const imageIndex = slides.findIndex((slide) => Boolean(slide.imageSrc || slide.imageLoading))
  return imageIndex >= 0 ? imageIndex : 0
}

function setDatabaseEvidencePreferredSlide(record: RecordResponse, field = databaseEvidenceField.value) {
  databaseEvidenceSlideIndex.value = databaseEvidencePreferredSlideIndex(record, field)
}

function activeDatabaseEvidenceQuote(record: RecordResponse): DatabaseEvidenceQuote | null {
  return activeDatabaseEvidenceSlide(record)?.quote || null
}

function activeDatabaseEvidenceNote(record: RecordResponse): string {
  return normalizeDatabaseEvidenceText(activeDatabaseEvidenceSlide(record)?.note)
}

function databaseEvidenceSlideCount(record: RecordResponse) {
  return databaseEvidenceSlides(record).length
}

function moveDatabaseEvidenceSlide(record: RecordResponse, direction: -1 | 1) {
  const count = databaseEvidenceSlideCount(record)
  if (count <= 1) return
  databaseEvidenceSlideIndex.value = (databaseEvidenceSlideIndex.value + direction + count) % count
}

function splitDatabaseEvidenceQuote(quote: DatabaseEvidenceQuote) {
  const highlights = (quote.highlights || [])
    .map((value) => normalizeDatabaseEvidenceText(value))
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
  if (!highlights.length) return [{ text: quote.text, active: false }]

  const source = quote.text
  const normalizedSource = source.toLowerCase()
  const ranges: Array<{ start: number, end: number }> = []
  for (const highlight of highlights) {
    const normalizedHighlight = highlight.toLowerCase()
    let cursor = 0
    while (normalizedHighlight && cursor < normalizedSource.length) {
      const index = normalizedSource.indexOf(normalizedHighlight, cursor)
      if (index < 0) break
      const end = index + highlight.length
      const overlaps = ranges.some((range) => index < range.end && end > range.start)
      if (!overlaps) ranges.push({ start: index, end })
      cursor = end
    }
  }
  if (!ranges.length) return [{ text: source, active: false }]

  ranges.sort((a, b) => a.start - b.start)
  const parts: Array<{ text: string, active: boolean }> = []
  let cursor = 0
  for (const range of ranges) {
    if (range.start > cursor) parts.push({ text: source.slice(cursor, range.start), active: false })
    parts.push({ text: source.slice(range.start, range.end), active: true })
    cursor = range.end
  }
  if (cursor < source.length) parts.push({ text: source.slice(cursor), active: false })
  return parts.filter((part) => part.text)
}

function closeDatabaseEvidencePopover() {
  databaseEvidenceFocusedFieldKey.value = null
  closeEvidenceModal()
}

function handleOpenLiteratureRecord(record: RecordResponse) {
  if (!record.literatureId) {
    openRecordPdf(record, { forcePdf: true })
    return
  }
  emit('view-literature', {
    literatureId: record.literatureId,
    recordId: databaseRecordEntityId(record),
    mode: 'grounding',
  })
  closeDatabaseEvidencePopover()
  closeEditDrawer()
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
    'recordId',
    'internalId',
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
    recordDisplayId(r),
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
    const page = await searchRecords(filter, skip, pageSize, { scope: props.recordScope })
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

watch(
  () => props.externalFilterRequestId,
  (requestId, previousId) => {
    if (!requestId || requestId === previousId) return
    showAdvancedFilters.value = true
  },
)

// 自动翻页找到目标记录（最多 12 跳，防死循环）
const focusHopsRemaining = ref(0)
watch(
  () => [props.focusRecordId, props.focusEntityType],
  ([id]) => {
    if (id == null) return
    focusHopsRemaining.value = 12
    if (currentPage.value !== 1) goToPage(1)
  },
  { immediate: true },
)
watch(
  [() => props.focusRecordId, () => props.focusEntityType, () => result.value.items, () => loading.value],
  ([id, entityType, items, isLoading]) => {
    if (id == null || isLoading) return
    const targetEntityType = String(entityType || '').trim().toLowerCase()
    const found = (items as any[]).some((row) => {
      const rowEntityType = String(row?.reviewEntityType || row?.entityType || 'record').trim().toLowerCase()
      return Number(row?.id) === Number(id) && (!targetEntityType || rowEntityType === targetEntityType)
    })
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
  if (shouldLoadReviewBacklogFromVisibleQueue()) {
    await loadReviewBacklog()
  }
  appliedAdvancedFilterState.value = captureAdvancedFilterState()
  window.addEventListener('keydown', onGlobalKeydown)
})

onBeforeUnmount(() => {
  reviewReextractRunToken += 1
  window.removeEventListener('keydown', onGlobalKeydown)
})
</script>

<template>
  <div class="flex h-full flex-col overflow-hidden bg-slate-50 dark:bg-[#07111d] dark:text-slate-100">
    <div class="border-b border-slate-200 bg-white px-4 py-2.5 dark:border-slate-800 dark:bg-slate-950/80">
      <section class="relative">
        <div class="flex min-w-0 items-center gap-3">
          <div v-if="!props.selectedFileId" class="flex min-w-[20rem] flex-[0_1_38rem] items-center gap-2">
            <div class="relative min-w-0 flex-1">
              <Search class="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                v-model="searchDoi"
                type="text"
                placeholder="Search"
                class="h-10 w-full rounded-[9px] border border-slate-200 bg-slate-50/70 pl-11 pr-10 text-sm font-semibold text-slate-800 shadow-sm transition placeholder:text-slate-400 focus:border-[#92e6dc] focus:bg-white focus:outline-none focus:ring-4 focus:ring-[#ddfbf7] dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:ring-cyan-500/10"
                @keydown.enter.prevent="applyAdvancedFilters"
              />
              <button
                v-if="searchDoi"
                type="button"
                class="absolute right-3 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-full text-slate-400 transition hover:bg-slate-200 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                @click="clearDoiSearch"
              >
                <X class="h-4 w-4" />
              </button>
            </div>
            <button
              type="button"
              class="inline-flex h-10 shrink-0 items-center gap-2 rounded-[9px] border border-slate-200 bg-white px-3 text-sm font-black text-slate-700 shadow-sm transition hover:border-[#92e6dc] hover:text-[#0f7c82] focus:outline-none focus:ring-4 focus:ring-[#ddfbf7]"
              aria-label="Apply database search"
              @click="applyAdvancedFilters"
            >
              <Search class="h-4 w-4" />
              Search records
            </button>
          </div>

          <div
            v-if="!props.fixedExperimentScale"
            class="filter-scale-strip inline-flex h-10 shrink-0 items-center rounded-[9px] border border-slate-200 bg-white p-1 shadow-sm dark:border-slate-700 dark:bg-slate-950"
            aria-label="Lubrication library lane"
          >
            <button
              v-for="lane in scaleLaneOptions"
              :key="lane.value || 'all'"
              type="button"
              class="group inline-flex h-8 min-w-0 items-center gap-1.5 rounded-[6px] px-3 text-xs font-black transition"
              :class="activeScaleLane === lane.value
                ? lane.value === 'macroscale'
                  ? 'bg-orange-100 text-orange-700 shadow-sm dark:bg-orange-400/15 dark:text-orange-300'
                  : lane.value === 'nanoscale'
                    ? 'bg-[#e9fbf8] text-[#0f7c82] shadow-sm dark:bg-cyan-400/10 dark:text-cyan-300'
                    : 'bg-slate-950 text-white shadow-sm dark:bg-slate-100 dark:text-slate-950'
                : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-900 dark:hover:text-slate-200'"
              :title="lane.detail"
              @click="setScaleLane(lane.value)"
            >
              <span
                class="h-1.5 w-1.5 rounded-full"
                :class="lane.value === 'macroscale'
                  ? 'bg-orange-500'
                  : lane.value === 'nanoscale'
                    ? 'bg-[#0f7c82]'
                    : 'bg-slate-400'"
              />
              <span>{{ lane.label }}</span>
            </button>
          </div>

          <button
            v-if="!isReviewQueue"
            type="button"
            class="ml-auto flex h-10 shrink-0 items-center gap-1.5 rounded-[9px] border px-3 text-xs font-black shadow-sm transition disabled:cursor-not-allowed disabled:opacity-45"
            :class="effectiveGroupByPaper
              ? 'border-[#b7e6e1] bg-[#e7f6f5] text-[#0f7c82]'
              : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-400 dark:hover:bg-slate-800'"
            :aria-pressed="effectiveGroupByPaper"
            :disabled="groupingDisabledBySort"
            :title="groupingDisabledBySort ? 'Clear the column sort to group by paper' : 'Group records under their source paper'"
            @click="setGroupByPaper(!tableGroupByPaper)"
          >
            <BookOpen class="h-3.5 w-3.5" />
            Group by paper
          </button>

          <div
            class="flex h-10 shrink-0 items-center gap-0.5 rounded-[9px] border border-slate-200 bg-white px-1 shadow-sm dark:border-slate-700 dark:bg-slate-950"
            :class="isReviewQueue ? 'ml-auto' : ''"
            role="group"
            aria-label="Row density"
          >
            <button
              type="button"
              class="rounded-[7px] px-2.5 py-1 text-xs font-black transition"
              :class="tableDensity === 'comfortable' ? 'bg-[#e7f6f5] text-[#0f7c82]' : 'text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800'"
              :aria-pressed="tableDensity === 'comfortable'"
              title="Comfortable rows"
              @click="setTableDensity('comfortable')"
            >
              Comfortable
            </button>
            <button
              type="button"
              class="rounded-[7px] px-2.5 py-1 text-xs font-black transition"
              :class="tableDensity === 'compact' ? 'bg-[#e7f6f5] text-[#0f7c82]' : 'text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800'"
              :aria-pressed="tableDensity === 'compact'"
              title="Compact rows — fit more on screen"
              @click="setTableDensity('compact')"
            >
              Compact
            </button>
          </div>

          <div v-if="isReviewQueue" class="flex h-10 shrink-0 items-center gap-1.5 rounded-[9px] border border-slate-200 bg-white px-2 shadow-sm dark:border-slate-700 dark:bg-slate-950">
            <span class="px-2 text-xs font-black text-slate-500 dark:text-slate-400">
              Selected {{ selectedCandidateCount }}
            </span>
            <button
              type="button"
              class="inline-flex h-8 items-center gap-1.5 rounded-[7px] border border-emerald-200 bg-emerald-50 px-3 text-xs font-black text-emerald-600 transition hover:border-emerald-300 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-45 dark:border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-300"
              :disabled="selectedCandidateCount === 0 || bulkReviewPending"
              @click="handleBulkApproveCandidates"
            >
              <Check class="h-3.5 w-3.5 stroke-[3]" />
              <span v-if="bulkReviewPending">Working...</span>
              <span v-else>Approve selected</span>
            </button>
            <button
              type="button"
              class="inline-flex h-8 items-center gap-1.5 rounded-[7px] border border-rose-200 bg-rose-50 px-3 text-xs font-black text-rose-500 transition hover:border-rose-300 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-45 dark:border-rose-500/25 dark:bg-rose-500/10 dark:text-rose-300"
              :disabled="selectedCandidateCount === 0 || bulkReviewPending"
              @click="handleBulkRejectCandidates"
            >
              <Ban class="h-3.5 w-3.5" />
              <span>Reject selected</span>
            </button>
            <button
              v-if="selectedCandidateCount > 0 && !bulkReviewPending"
              type="button"
              class="rounded-[7px] px-2.5 py-1.5 text-xs font-black text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
              @click="clearCandidateSelection"
            >
              Clear
            </button>
          </div>
          <div v-else class="flex h-10 shrink-0 items-center gap-1.5 rounded-[9px] border border-slate-200 bg-white px-2 shadow-sm dark:border-slate-700 dark:bg-slate-950">
            <span class="px-2 text-xs font-black text-slate-500 dark:text-slate-400">
              Selected {{ visibleSelectedIds.size }}
            </span>
            <button
              type="button"
              class="inline-flex h-8 items-center gap-1.5 rounded-[7px] border border-rose-200 bg-rose-50 px-3 text-xs font-black text-rose-500 transition hover:border-rose-300 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-45 dark:border-rose-500/25 dark:bg-rose-500/10 dark:text-rose-300"
              :disabled="visibleSelectedIds.size === 0 || batchActionPending"
              @click="handleBatchDelete"
            >
              <Trash2 class="h-3.5 w-3.5" />
              <span v-if="batchActionPending">Deleting...</span>
              <span v-else>Delete selected</span>
            </button>
          </div>
        </div>

        <p
          v-if="bulkReviewError"
          class="mt-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-600 dark:border-rose-500/25 dark:bg-rose-500/10 dark:text-rose-300"
        >
          {{ bulkReviewError }}
        </p>

        <p
          v-if="batchError"
          class="mt-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-600 dark:border-rose-500/25 dark:bg-rose-500/10 dark:text-rose-300"
        >
          {{ batchError }}
        </p>

        <div class="mt-2 flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-500 dark:text-slate-400">
          <span class="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 font-black text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
            {{ activeLibraryEntityType === 'candidate' ? 'Review Queue' : 'Official Database' }}
          </span>
          <span>
            {{ activeLibraryEntityType === 'candidate'
              ? 'Candidates waiting for review before entering the official library.'
              : 'Approved library records only; review candidates are kept separate.' }}
          </span>
        </div>

        <div
          v-if="isReviewQueue"
          class="mt-2 flex items-center gap-1.5 overflow-x-auto text-xs font-semibold"
          data-testid="review-queue-triage"
        >
          <span class="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">Triage</span>
          <template v-if="triageMissingFieldOptions.length">
            <span class="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">Missing</span>
            <button
              v-for="option in triageMissingFieldOptions"
              :key="option.key"
              type="button"
              class="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 transition"
              :class="triageMissingField === option.key
                ? 'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300'
                : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800'"
              @click="toggleTriageMissingField(option.key)"
            >
              {{ option.label }}
              <span class="text-[10px] font-black opacity-70">{{ option.count }}</span>
            </button>
          </template>

          <template v-if="triageStaleOptions.length">
            <span class="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">Stale</span>
            <button
              v-for="option in triageStaleOptions"
              :key="option.days"
              type="button"
              class="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 transition"
              :class="triageStaleDays === option.days
                ? 'border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-300'
                : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800'"
              @click="setTriageStaleDays(option.days)"
            >
              ≥ {{ option.days }}d
              <span class="text-[10px] font-black opacity-70">{{ option.count }}</span>
            </button>
          </template>

          <button
            v-if="hasTriageFilters"
            type="button"
            class="rounded-md px-2 py-1 font-black text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800"
            @click="clearTriageFilters"
          >
            Clear
          </button>
          <span v-if="hasTriageFilters" class="text-slate-500 dark:text-slate-400">
            Showing {{ displayedCandidateCount }} of {{ triageTierCounts.all }}
          </span>
        </div>

        <div
          v-if="showAdvancedFilters"
          class="filter-lens-panel filter-deck absolute right-0 top-12 z-40 max-h-[calc(100vh-9rem)] w-[min(980px,calc(100vw-2rem))] overflow-hidden rounded-[14px] border border-slate-200 bg-white shadow-[0_26px_70px_-34px_rgba(15,23,42,0.55)] dark:border-slate-800 dark:bg-slate-900/96"
        >
          <div class="flex flex-col gap-3 border-b border-slate-100 bg-[linear-gradient(180deg,#ffffff_0%,#f7fffd_100%)] px-4 py-3 dark:border-slate-800/60 dark:bg-none lg:flex-row lg:items-center lg:justify-between">
            <div class="flex min-w-0 items-center gap-3">
              <div class="grid h-10 w-10 shrink-0 place-items-center rounded-[10px] bg-[#079672] text-white shadow-[0_12px_28px_-20px_rgba(7,150,114,0.9)] dark:bg-emerald-400 dark:text-slate-950">
                <Layers class="h-5 w-5" />
              </div>
              <div class="min-w-0">
                <div class="flex items-center gap-2">
                  <h3 class="text-base font-black tracking-[0.02em] text-slate-950 dark:text-white">Filters</h3>
                  <span v-if="activeManualFilterCount" class="rounded-full bg-[#e6fbf8] px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.12em] text-[#0f7c82] dark:bg-cyan-500/10 dark:text-cyan-200">
                    {{ activeManualFilterCount }} active
                  </span>
                </div>
                <p class="mt-0.5 truncate text-xs font-medium text-slate-500 dark:text-slate-400">
                  Search, choose a lane, then pin the smallest useful slice.
                </p>
              </div>
            </div>
            <div class="flex shrink-0 items-center gap-2">
              <button
                v-if="hasManualFilters"
                type="button"
                class="rounded-[7px] px-3 py-1.5 text-xs font-black text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                @click="clearAllAdvancedFilters"
              >
                Clear all
              </button>
              <button
                type="button"
                class="grid h-8 w-8 place-items-center rounded-[7px] border border-slate-200 text-slate-500 transition hover:bg-slate-50 hover:text-slate-900 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                aria-label="Close filters"
                @click="collapseAdvancedFilters"
              >
                <X class="h-4 w-4" />
              </button>
            </div>
          </div>

          <div class="max-h-[calc(100vh-18rem)] overflow-y-auto">
            <div class="grid gap-3 border-b border-slate-100 p-4 dark:border-slate-800/60 lg:grid-cols-[minmax(260px,1fr)_auto] lg:items-center">
              <div v-if="!props.selectedFileId" class="relative min-w-0">
                <Search class="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  v-model="searchDoi"
                  type="text"
                  placeholder="Search DOI, title, ion, surface..."
                  class="h-11 w-full rounded-[10px] border border-slate-200 bg-slate-50/80 pl-11 pr-12 text-sm font-semibold text-slate-800 transition placeholder:text-slate-400 focus:border-[#92e6dc] focus:bg-white focus:outline-none focus:ring-4 focus:ring-[#ddfbf7] dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:ring-cyan-500/10"
                  @keydown.enter.prevent="applyAdvancedFilters"
                />
                <button
                  v-if="searchDoi"
                  type="button"
                  class="absolute right-3 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-full text-slate-400 transition hover:bg-slate-200 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                  @click="clearDoiSearch"
                >
                  <X class="h-4 w-4" />
                </button>
              </div>

              <div
                v-if="!props.fixedExperimentScale"
                class="filter-scale-strip inline-flex h-11 shrink-0 items-center rounded-[10px] border border-slate-200 bg-slate-50 p-1 dark:border-slate-700 dark:bg-slate-950"
                aria-label="Lubrication library lane"
              >
                <button
                  v-for="lane in scaleLaneOptions"
                  :key="lane.value || 'all'"
                  type="button"
                  class="group inline-flex h-9 min-w-0 items-center gap-1.5 rounded-[7px] px-3 text-xs font-black transition"
                  :class="activeScaleLane === lane.value
                    ? lane.value === 'macroscale'
                      ? 'bg-orange-100 text-orange-700 shadow-sm dark:bg-orange-400/15 dark:text-orange-300'
                      : lane.value === 'nanoscale'
                        ? 'bg-[#e9fbf8] text-[#0f7c82] shadow-sm dark:bg-cyan-400/10 dark:text-cyan-300'
                        : 'bg-slate-950 text-white shadow-sm dark:bg-slate-100 dark:text-slate-950'
                    : 'text-slate-500 hover:bg-white hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-900 dark:hover:text-slate-200'"
                  :title="lane.detail"
                  @click="setScaleLane(lane.value)"
                >
                  <span
                    class="h-1.5 w-1.5 rounded-full"
                    :class="lane.value === 'macroscale'
                      ? 'bg-orange-500'
                      : lane.value === 'nanoscale'
                        ? 'bg-[#0f7c82]'
                        : 'bg-slate-400'"
                  />
                  {{ lane.shortLabel }}
                </button>
              </div>
            </div>

            <div class="grid divide-y divide-slate-100 dark:divide-slate-800/60 lg:grid-cols-[250px_minmax(0,1fr)] lg:divide-x lg:divide-y-0">
              <nav class="filter-field-dock bg-slate-50/55 p-3 dark:bg-slate-950/20">
                <p class="mb-2 px-1 text-[10px] font-black uppercase tracking-[0.22em] text-slate-400 dark:text-slate-500">Facet map</p>
                <div class="grid gap-1.5">
                <button
                  v-for="field in advancedFilterFields"
                  :key="field.key"
                  type="button"
                  class="filter-field-card group grid w-full grid-cols-[10px_minmax(0,1fr)_auto] items-center gap-2 rounded-[9px] border px-2.5 py-2.5 text-left transition"
                  :class="field.key === activeAdvancedOptionKey
                    ? 'border-[#9de9df] bg-white shadow-[0_14px_30px_-24px_rgba(7,150,114,0.75)] dark:border-cyan-500/30 dark:bg-slate-900'
                    : 'border-transparent text-slate-600 hover:border-slate-200 hover:bg-white dark:text-slate-400 dark:hover:border-slate-700 dark:hover:bg-slate-900/70'"
                  @click="selectAdvancedFilterField(field.key)"
                >
                  <span class="h-2.5 w-2.5 rounded-full" :class="field.accentClass" />
                  <span class="min-w-0">
                    <span class="block truncate text-[13px] font-black" :class="field.key === activeAdvancedOptionKey ? 'text-slate-950 dark:text-white' : ''">{{ field.label }}</span>
                    <span class="mt-0.5 block truncate text-[11px] text-slate-400 dark:text-slate-500">
                      {{ field.selected.length ? field.selected.join(', ') : field.description }}
                    </span>
                  </span>
                  <span class="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-black text-slate-400 dark:bg-slate-800 dark:text-slate-500">{{ field.optionCount ?? field.options.length }}</span>
                </button>
                </div>
              </nav>

              <section class="filter-candidate-stage min-w-0 p-4">
                <div class="mb-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div class="min-w-0">
                    <div class="flex items-center gap-2">
                      <span class="h-2 w-2 rounded-full" :class="activeAdvancedFilterField.accentClass" />
                      <p class="text-[10px] font-black uppercase tracking-[0.22em] text-slate-400 dark:text-slate-500">
                        {{ activeAdvancedFilterField.group }}
                      </p>
                    </div>
                    <h3 class="mt-1 truncate text-xl font-black leading-tight text-slate-950 dark:text-white">
                      {{ activeAdvancedFilterField.label }}
                    </h3>
                  </div>
                  <p class="shrink-0 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-black text-slate-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-400">
                    {{ matchingAdvancedOptions.length }} / {{ activeAdvancedOptions.length }}
                  </p>
                </div>

                <div
                  v-if="activeAdvancedOptionKey === 'ions'"
                  class="ion-filter-switch mb-3 grid gap-2 rounded-[11px] border border-slate-200 bg-slate-50/70 p-1.5 dark:border-slate-800 dark:bg-slate-950/30 sm:grid-cols-2"
                >
                  <div
                    v-for="role in ionFilterRoles"
                    :key="role.key"
                    class="group flex min-w-0 items-center overflow-hidden rounded-[9px] transition"
                    :class="role.key === activeIonRole
                      ? 'bg-white shadow-sm ring-1 ring-[#9de9df] dark:bg-slate-900 dark:ring-cyan-500/30'
                      : 'hover:bg-white/80 dark:hover:bg-slate-900/70'"
                  >
                    <button
                      type="button"
                      class="flex min-w-0 flex-1 items-center gap-2.5 px-3 py-2.5 text-left"
                      @click="selectIonFilterRole(role.key)"
                    >
                      <span class="grid h-8 w-8 shrink-0 place-items-center rounded-[8px] text-xs font-black" :class="role.key === 'cation' ? 'bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-200' : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-200'">
                        {{ role.key === 'cation' ? 'C+' : 'A-' }}
                      </span>
                      <span class="min-w-0 flex-1">
                        <span class="flex min-w-0 items-center gap-2">
                          <span class="shrink-0 whitespace-nowrap text-sm font-black text-slate-950 dark:text-white">
                            {{ role.label }}
                          </span>
                          <span class="shrink-0 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-400 dark:bg-slate-800">
                            {{ role.options.length }}
                          </span>
                        </span>
                        <span
                          class="mt-0.5 block truncate text-xs"
                          :class="role.selected.length ? 'font-black text-slate-900 dark:text-slate-100' : 'text-slate-400 dark:text-slate-500'"
                        >
                          {{ role.selected.length ? role.selected.join(', ') : 'Any' }}
                        </span>
                      </span>
                      <Check v-if="role.selected.length && role.key === activeIonRole" class="h-4 w-4 shrink-0 text-[#0f7c82] dark:text-cyan-200" />
                    </button>
                    <button
                      v-if="role.selected.length"
                      type="button"
                      class="mr-1 grid h-7 w-7 shrink-0 place-items-center rounded-[7px] text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                      @click.stop="clearIonFilterRole(role.key)"
                    >
                      <X class="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                <div class="relative mb-3">
                  <Search class="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    v-model="advancedOptionSearch"
                    type="search"
                    :placeholder="`Find ${activeAdvancedCandidateLabel}`"
                    class="h-10 w-full rounded-[9px] border-0 bg-slate-100 pl-10 pr-10 text-sm font-semibold text-slate-900 ring-1 ring-inset ring-slate-200 transition placeholder:text-slate-400 focus:bg-white focus:ring-2 focus:ring-inset focus:ring-[#93e7e8] dark:bg-slate-800 dark:text-white dark:ring-slate-700 dark:focus:bg-slate-900"
                    @keydown.enter.prevent="advancedTypedCandidate ? applyAdvancedTypedValue() : applyAdvancedFilters()"
                  >
                  <button
                    v-if="advancedOptionSearch"
                    type="button"
                    class="absolute right-2 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-full text-slate-400 transition hover:bg-slate-200 hover:text-slate-700 dark:hover:bg-slate-700 dark:hover:text-slate-200"
                    @click="advancedOptionSearch = ''"
                  >
                    <X class="h-3.5 w-3.5" />
                  </button>
                </div>

                <button
                  v-if="advancedTypedCandidate"
                  type="button"
                  class="mb-3 flex w-full items-center justify-between rounded-[9px] border border-dashed border-[#9debed] bg-[#f4fffe] px-4 py-2.5 text-left text-sm font-black text-[#0f7c82] transition hover:bg-white dark:border-cyan-500/30 dark:bg-cyan-500/10 dark:text-cyan-200 dark:hover:bg-slate-900"
                  @click="applyAdvancedTypedValue"
                >
                  <span class="truncate">Use “{{ advancedFilterValueDisplay(activeAdvancedOptionKey, advancedTypedCandidate) }}” as {{ activeAdvancedCandidateLabel }}</span>
                  <span class="ml-3 shrink-0 rounded-full bg-white px-1.5 py-0.5 text-[10px] uppercase text-slate-500 dark:bg-slate-900 dark:text-slate-300">Enter</span>
                </button>

                <div
                  v-if="activeAdvancedOptionKey !== 'ions' && activeAdvancedSelectedValues.length"
                  class="mb-3 flex items-center justify-between gap-3 rounded-[9px] bg-[#f4fffe] px-4 py-3 ring-1 ring-[#b8eff0] dark:bg-cyan-500/10 dark:ring-cyan-500/30"
                >
                  <div class="min-w-0">
                    <p class="text-[10px] font-black uppercase tracking-[0.2em] text-[#0f7c82] dark:text-cyan-200">Pinned</p>
                    <p
                      class="mt-0.5 truncate text-sm font-black text-slate-950 dark:text-slate-100"
                      :title="activeAdvancedSelectedValues.join(', ')"
                    >{{ activeAdvancedSelectedValues.join(', ') }}</p>
                  </div>
                  <button
                    type="button"
                    class="shrink-0 rounded-[7px] bg-white px-2.5 py-1.5 text-xs font-black text-slate-700 transition hover:bg-slate-100 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-700"
                    @click="clearAdvancedFilterValue(activeAdvancedFilterField.key)"
                  >
                    Clear
                  </button>
                </div>

                <div class="option-river grid max-h-56 grid-cols-1 gap-2 overflow-auto rounded-[10px] border border-slate-100 bg-white p-2 dark:border-slate-800 dark:bg-slate-950/50 sm:grid-cols-2">
                  <button
                    v-for="option in visibleAdvancedOptions"
                    :key="`${activeAdvancedFilterField.key}-${activeIonRole}-${option}`"
                    type="button"
                    class="flex min-w-0 items-center gap-2 rounded-[8px] border px-3 py-2.5 text-left text-sm transition hover:border-[#9debed] hover:bg-[#f4fffe] dark:hover:border-cyan-500/30 dark:hover:bg-cyan-500/10"
                    :class="activeAdvancedSelectedValues.includes(option) ? 'border-[#9debed] bg-[#ecfeff] dark:border-cyan-500/30 dark:bg-cyan-500/10' : 'border-slate-100 dark:border-slate-800'"
                    :title="advancedFilterRawTitle(activeAdvancedFilterField.key, option)"
                    @click="setAdvancedFilterValue(activeAdvancedFilterField.key, option)"
                  >
                    <span class="min-w-0 flex-1 truncate text-slate-700 dark:text-slate-300" :class="activeAdvancedSelectedValues.includes(option) ? 'font-black text-slate-950 dark:text-slate-100' : 'font-semibold'">{{ advancedFilterValueDisplay(activeAdvancedFilterField.key, option) }}</span>
                    <Check v-if="activeAdvancedSelectedValues.includes(option)" class="h-4 w-4 shrink-0 text-[#0f7c82] dark:text-cyan-200" />
                  </button>
                  <div v-if="!visibleAdvancedOptions.length" class="col-span-full px-4 py-8 text-center text-sm font-semibold text-slate-400">
                    No matches. Press Enter to use the current value.
                  </div>
                </div>
                <p v-if="hiddenAdvancedOptionCount" class="mt-3 text-center text-xs font-medium text-slate-400">
                  {{ hiddenAdvancedOptionCount }} more options. Type to narrow.
                </p>
              </section>
            </div>

            <div class="filter-slice-panel border-t border-slate-100 bg-slate-50/55 p-4 dark:border-slate-800/60 dark:bg-slate-950/20">
              <div class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
                <div>
                  <div class="mb-2 flex items-center justify-between">
                    <p class="text-[10px] font-black uppercase tracking-[0.22em] text-slate-400 dark:text-slate-500">Active slice</p>
                    <span v-if="activeManualFilterCount" class="rounded-full bg-[#e6fbf8] px-2 py-0.5 text-[10px] font-black text-[#0f7c82] dark:bg-cyan-500/10 dark:text-cyan-200">{{ activeManualFilterCount }}</span>
                  </div>
                  <div v-if="manualFilterChips.length" class="flex flex-wrap gap-2">
                    <button
                      v-for="chip in manualFilterChips"
                      :key="chip.id"
                      type="button"
                      class="group flex max-w-full items-center gap-1.5 rounded-[8px] border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-600 transition hover:border-[#9debed] hover:bg-[#f4fffe] dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:border-cyan-500/30 dark:hover:bg-cyan-500/10"
                      @click="removeAdvancedSearchChip(chip.id)"
                    >
                      <span class="truncate font-black">{{ chip.label }}</span>
                      <span class="text-slate-400 dark:text-slate-500">:</span>
                      <span class="truncate font-semibold text-slate-950 dark:text-white">{{ chip.value }}</span>
                      <X class="ml-0.5 h-3 w-3 shrink-0 text-slate-400 group-hover:text-[#0f7c82] dark:group-hover:text-cyan-200" />
                    </button>
                  </div>
                  <p v-else class="rounded-[9px] border border-dashed border-slate-200 bg-white px-3 py-3 text-xs font-semibold text-slate-400 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-500">
                    No filters pinned.
                  </p>
                </div>

                <div>
                  <p class="mb-2 text-[10px] font-black uppercase tracking-[0.22em] text-slate-400 dark:text-slate-500">Ranges</p>
                  <div class="grid gap-2 sm:grid-cols-2">
                    <div class="rounded-[9px] border border-slate-200 bg-white p-2.5 dark:border-slate-800 dark:bg-slate-900/70">
                      <label class="mb-2 block text-xs font-black text-slate-700 dark:text-slate-300">Load</label>
                      <div class="flex items-center gap-2">
                        <input
                          v-model="loadMin"
                          type="text"
                          inputmode="decimal"
                          placeholder="Min"
                          class="h-9 w-full rounded-[7px] border-0 bg-slate-50 px-3 text-sm font-semibold text-slate-900 ring-1 ring-inset transition focus:ring-2 focus:ring-inset dark:bg-slate-950 dark:text-white"
                          :class="isLoadRangeInvalid ? 'ring-rose-300 focus:ring-rose-500 dark:ring-rose-500/50' : 'ring-slate-200 focus:ring-[#93e7e8] dark:ring-slate-700'"
                          @keydown.enter.prevent="applyAdvancedFilters"
                        />
                        <span class="text-slate-300">-</span>
                        <input
                          v-model="loadMax"
                          type="text"
                          inputmode="decimal"
                          placeholder="Max"
                          class="h-9 w-full rounded-[7px] border-0 bg-slate-50 px-3 text-sm font-semibold text-slate-900 ring-1 ring-inset transition focus:ring-2 focus:ring-inset dark:bg-slate-950 dark:text-white"
                          :class="isLoadRangeInvalid ? 'ring-rose-300 focus:ring-rose-500 dark:ring-rose-500/50' : 'ring-slate-200 focus:ring-[#93e7e8] dark:ring-slate-700'"
                          @keydown.enter.prevent="applyAdvancedFilters"
                        />
                      </div>
                      <p v-if="isLoadRangeInvalid" class="mt-1 text-[11px] font-semibold text-rose-500">Min cannot exceed max.</p>
                    </div>

                    <div class="rounded-[9px] border border-slate-200 bg-white p-2.5 dark:border-slate-800 dark:bg-slate-900/70">
                      <label class="mb-2 block text-xs font-black text-slate-700 dark:text-slate-300">COF</label>
                      <div class="flex items-center gap-2">
                        <input
                          v-model="cofMin"
                          type="text"
                          inputmode="decimal"
                          placeholder="Min"
                          class="h-9 w-full rounded-[7px] border-0 bg-slate-50 px-3 text-sm font-semibold text-slate-900 ring-1 ring-inset transition focus:ring-2 focus:ring-inset dark:bg-slate-950 dark:text-white"
                          :class="isCofRangeInvalid ? 'ring-rose-300 focus:ring-rose-500 dark:ring-rose-500/50' : 'ring-slate-200 focus:ring-[#93e7e8] dark:ring-slate-700'"
                          @keydown.enter.prevent="applyAdvancedFilters"
                        />
                        <span class="text-slate-300">-</span>
                        <input
                          v-model="cofMax"
                          type="text"
                          inputmode="decimal"
                          placeholder="Max"
                          class="h-9 w-full rounded-[7px] border-0 bg-slate-50 px-3 text-sm font-semibold text-slate-900 ring-1 ring-inset transition focus:ring-2 focus:ring-inset dark:bg-slate-950 dark:text-white"
                          :class="isCofRangeInvalid ? 'ring-rose-300 focus:ring-rose-500 dark:ring-rose-500/50' : 'ring-slate-200 focus:ring-[#93e7e8] dark:ring-slate-700'"
                          @keydown.enter.prevent="applyAdvancedFilters"
                        />
                      </div>
                      <p v-if="isCofRangeInvalid" class="mt-1 text-[11px] font-semibold text-rose-500">Min cannot exceed max.</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div class="flex items-center justify-between border-t border-slate-100 bg-slate-50/50 px-5 py-3 dark:border-slate-800/60 dark:bg-slate-900/50">
            <div class="flex min-w-0 items-center gap-2">
              <span class="hidden text-xs font-black text-slate-500 dark:text-slate-400 sm:inline">
                Selected {{ visibleSelectedIds.size }}
              </span>
              <button
                v-if="selectedIds.size > 0"
                type="button"
                class="rounded-[7px] px-2.5 py-1.5 text-xs font-black text-slate-500 transition hover:bg-slate-200/50 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
                @click="clearSelection"
              >
                Clear selected
              </button>
              <button
                type="button"
                class="inline-flex h-8 items-center gap-1.5 rounded-[7px] border border-rose-200 bg-rose-50 px-3 text-xs font-black text-rose-600 transition hover:border-rose-300 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-45 dark:border-rose-500/25 dark:bg-rose-500/10 dark:text-rose-300"
                :disabled="visibleSelectedIds.size === 0 || batchActionPending"
                @click="handleBatchDelete"
              >
                <Trash2 class="h-3.5 w-3.5" />
                <span v-if="batchActionPending">Deleting...</span>
                <span v-else>Delete</span>
              </button>
            </div>
            <div class="flex shrink-0 justify-end gap-2">
              <button
                type="button"
                class="rounded-[7px] px-4 py-2 text-sm font-black text-slate-600 transition hover:bg-slate-200/50 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
                @click="cancelAdvancedFilters"
              >
                Cancel
              </button>
              <button
                type="button"
                class="inline-flex h-9 items-center justify-center gap-2 rounded-[7px] bg-slate-950 px-5 text-sm font-black text-white shadow-sm transition hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-[#93e7e8] focus:ring-offset-2 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-950 dark:hover:bg-white dark:focus:ring-offset-slate-900"
                :disabled="hasInvalidManualRange"
                @click="applyAdvancedFilters"
              >
                <Search class="h-4 w-4" />
                Apply
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>

    <div class="flex min-h-0 flex-1 flex-col overflow-hidden px-6 py-4">
      <div
        v-if="searchError"
        aria-label="Database records could not be loaded"
        class="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-[8px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700 dark:border-rose-500/25 dark:bg-rose-500/10 dark:text-rose-200"
      >
        <span>{{ searchError }}</span>
        <button
          type="button"
          class="rounded-[7px] border border-rose-200 bg-white px-3 py-1.5 text-xs font-black text-rose-700 transition hover:bg-rose-100 dark:border-rose-400/30 dark:bg-rose-500/10 dark:text-rose-100 dark:hover:bg-rose-500/20"
          @click="fetchData"
        >
          Retry
        </button>
      </div>
      <div class="flex min-h-0 flex-1 gap-2.5">
        <!-- Review master-detail: paper rail -->
        <aside
          v-if="isReviewQueue"
          data-testid="review-paper-rail"
          class="flex w-[14.5rem] shrink-0 flex-col overflow-hidden rounded-[8px] border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950"
          aria-label="Sources in review queue"
        >
          <div class="flex items-center justify-between border-b border-slate-200 px-2.5 py-2 dark:border-slate-800">
            <span class="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400 dark:text-slate-500">Sources</span>
            <span class="text-[11px] font-semibold text-slate-400 dark:text-slate-500">{{ reviewSourceCountLabel }}</span>
          </div>
          <div class="flex-1 overflow-y-auto p-1">
            <button
              type="button"
              class="mb-1 flex w-full items-center justify-between gap-2 rounded-[7px] px-2 py-1.5 text-left transition"
              :class="selectedReviewLiteratureId === null
                ? 'border-l-2 border-l-[#0f7c82] bg-[#f1fbfa] text-[#0f7c82]'
                : 'border-l-2 border-l-transparent font-semibold text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'"
              :aria-pressed="selectedReviewLiteratureId === null"
              @click="selectReviewPaper(null)"
            >
              <span class="text-[12px] font-semibold">All candidates</span>
              <span
                class="shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold"
                :class="selectedReviewLiteratureId === null ? 'bg-white text-[#0f7c82]' : 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-200'"
              >{{ reviewQueueTotalCount }}</span>
            </button>
            <button
              v-for="paper in reviewBacklog"
              :key="paper.literatureId"
              type="button"
              class="mb-1 flex w-full items-start gap-2 rounded-[7px] px-2 py-1.5 text-left transition"
              :class="selectedReviewLiteratureId === paper.literatureId
                ? 'border-l-2 border-l-[#0f7c82] bg-[#f1fbfa] text-[#0f7c82]'
                : 'border-l-2 border-l-transparent font-semibold text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'"
              :aria-pressed="selectedReviewLiteratureId === paper.literatureId"
              :title="paper.title"
              @click="selectReviewPaper(paper.literatureId)"
            >
              <span class="min-w-0 flex-1">
                <span class="block truncate text-[12px] font-semibold leading-4">{{ paper.title }}</span>
                <span class="block truncate text-[10.5px] font-semibold leading-4 opacity-70">
                  {{ paper.journal }}{{ paper.year ? ` (${paper.year})` : '' }}
                </span>
              </span>
              <span
                class="mt-0.5 shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold"
                :class="selectedReviewLiteratureId === paper.literatureId ? 'bg-white text-[#0f7c82]' : 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-200'"
              >{{ paper.pendingCount }}</span>
            </button>
            <p v-if="reviewBacklogLoading && !reviewBacklog.length" class="px-2.5 py-3 text-[12px] text-slate-400">Loading papers…</p>
            <div v-else-if="!reviewBacklog.length" class="px-2.5 py-3">
              <p class="text-[12px] font-semibold text-slate-400">{{ reviewBacklogEmptyMessage }}</p>
              <button
                v-if="reviewQueueTotalCount > 0"
                type="button"
                class="mt-2 rounded-[7px] border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-500 transition hover:border-[#0f7c82] hover:bg-[#eefafa] hover:text-[#0f7c82] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
                @click="loadReviewBacklog"
              >
                Refresh sources
              </button>
            </div>
          </div>
        </aside>

        <div class="flex min-h-0 min-w-0 flex-1 flex-col">
          <div
            v-if="isReviewQueue && selectedReviewPaper"
            data-testid="review-queue-scope-pill"
            class="mb-2 flex items-center gap-2 rounded-[7px] border border-slate-200 bg-slate-50/80 px-2.5 py-1.5 text-xs dark:border-slate-800 dark:bg-slate-900/60"
          >
            <BookOpen class="h-3.5 w-3.5 shrink-0 text-[#0f7c82]" />
            <span class="min-w-0 truncate font-bold text-slate-700 dark:text-slate-200" :title="selectedReviewPaper.title">{{ selectedReviewPaper.title }}</span>
            <span
              v-if="reviewReextractSuccess"
              class="hidden shrink-0 text-[11px] font-bold text-emerald-600 dark:text-emerald-300 sm:inline"
            >
              {{ reviewReextractSuccess }}
            </span>
            <div class="relative ml-auto shrink-0">
              <button
                type="button"
                data-testid="review-reextract-button"
                class="inline-flex h-7 items-center gap-1.5 rounded-[6px] border border-[#8bd9df] bg-white px-2.5 text-[11px] font-black text-[#0f7c82] shadow-sm transition hover:border-[#0f7c82] hover:bg-[#eefafa] disabled:cursor-not-allowed disabled:opacity-60 dark:border-[#0f7c82]/60 dark:bg-slate-950 dark:text-[#8bd9df] dark:hover:bg-[#0f7c82]/10"
                :aria-expanded="reviewReextractConfirmOpen ? 'true' : 'false'"
                aria-haspopup="dialog"
                aria-label="Re-extract selected review paper"
                :disabled="reviewReextractPending"
                @click="openReviewReextractConfirm"
              >
                <RefreshCw class="h-3.5 w-3.5" :class="{ 'animate-spin': reviewReextractPending }" />
                <span>{{ reviewReextractPending ? `${Math.round(reviewReextractProgress)}%` : 'Re-extract' }}</span>
              </button>
              <div
                v-if="reviewReextractConfirmOpen"
                class="absolute right-0 top-[calc(100%+0.35rem)] z-30 w-72 rounded-[8px] border border-slate-200 bg-white p-3 text-left shadow-xl shadow-slate-900/10 dark:border-slate-700 dark:bg-slate-950"
                role="dialog"
                aria-label="Confirm review paper re-extraction"
              >
                <div class="flex items-start gap-2">
                  <div class="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#e8f8f8] text-[#0f7c82] dark:bg-[#0f7c82]/15 dark:text-[#8bd9df]">
                    <RefreshCw class="h-3.5 w-3.5" :class="{ 'animate-spin': reviewReextractPending }" />
                  </div>
                  <div class="min-w-0">
                    <div class="text-[13px] font-black text-slate-800 dark:text-slate-100">Re-extract this paper?</div>
                    <p class="mt-1 text-[11px] font-semibold leading-4 text-slate-500 dark:text-slate-400">
                      Regenerate pending review candidates from the source PDF. Official records stay unchanged.
                    </p>
                  </div>
                </div>
                <div
                  v-if="reviewReextractPending || reviewReextractProgress > 0"
                  class="mt-3 rounded-[7px] border border-[#d5eeee] bg-[#f2fbfb] p-2 dark:border-[#0f7c82]/30 dark:bg-[#0f7c82]/10"
                >
                  <div class="mb-1.5 flex items-center justify-between gap-2 text-[10px] font-black uppercase tracking-[0.14em] text-[#0f7c82] dark:text-[#8bd9df]">
                    <span class="truncate">{{ reviewReextractStage || 'Queued' }}</span>
                    <span>{{ Math.round(reviewReextractProgress) }}%</span>
                  </div>
                  <div
                    class="h-1.5 overflow-hidden rounded-full bg-white shadow-inner dark:bg-slate-900"
                    role="progressbar"
                    :aria-valuenow="Math.round(reviewReextractProgress)"
                    aria-valuemin="0"
                    aria-valuemax="100"
                    aria-label="Review paper re-extraction progress"
                    data-testid="review-reextract-progressbar"
                  >
                    <div
                      class="h-full rounded-full bg-[#0f7c82] transition-all duration-300 ease-out"
                      :style="{ width: `${reviewReextractProgress}%` }"
                    ></div>
                  </div>
                  <div class="mt-1.5 flex items-center justify-between gap-2 text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                    <span class="min-w-0 truncate">{{ reviewReextractMessage || 'Waiting for extraction status...' }}</span>
                    <span v-if="reviewReextractCandidateCount" class="shrink-0 tabular-nums">{{ reviewReextractCandidateCount }} candidates</span>
                  </div>
                  <div v-if="reviewReextractRunId" class="mt-1 truncate text-[10px] font-semibold text-slate-400 dark:text-slate-500">
                    run {{ reviewReextractRunId.slice(0, 8) }}
                  </div>
                </div>
                <p
                  v-if="reviewReextractError"
                  class="mt-2 rounded-[6px] border border-rose-200 bg-rose-50 px-2 py-1.5 text-[11px] font-semibold text-rose-600 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300"
                >
                  {{ reviewReextractError }}
                </p>
                <div class="mt-3 flex items-center justify-end gap-2">
                  <button
                    type="button"
                    class="h-7 rounded-[6px] px-2.5 text-[11px] font-black text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 disabled:opacity-60 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
                    :disabled="reviewReextractPending"
                    @click="closeReviewReextractConfirm"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    class="inline-flex h-7 items-center gap-1.5 rounded-[6px] bg-[#0f7c82] px-2.5 text-[11px] font-black text-white shadow-sm transition hover:bg-[#0b666b] disabled:cursor-not-allowed disabled:opacity-60"
                    :disabled="reviewReextractPending"
                    @click="confirmReviewReextract"
                  >
                    <RefreshCw class="h-3.5 w-3.5" :class="{ 'animate-spin': reviewReextractPending }" />
                    {{ reviewReextractPending ? 'Extracting' : 'Re-extract' }}
                  </button>
                </div>
              </div>
            </div>
            <button
              type="button"
              class="shrink-0 rounded-[6px] px-2 py-0.5 font-black text-slate-500 transition hover:bg-slate-200 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-700"
              @click="selectReviewPaper(null)"
            >
              Clear ✕
            </button>
          </div>
          <RecordTable
            :loading="loading"
            :records="displayedRecords"
            :row-number-start="rangeStart || 1"
            :deleting-row-id="deletingRowId"
            :structure-preview-open="structurePreview.open"
            :structure-preview-row-id="structurePreview.rowId"
            :focus-record-id="focusRecordId ?? null"
            :focus-entity-type="focusEntityType || null"
            :selected-ids="selectedIds"
            :review-queue-mode="isReviewQueue"
            :density="tableDensity"
            :group-by-paper="effectiveGroupByPaper"
            :sort-by="sortBy"
            :sort-dir="sortDir"
            :selected-candidate-ids="selectedCandidateIds"
            :open-evidence-modal="handleOpenEvidenceModal"
            :open-literature="handleOpenLiteratureRecord"
            :review-candidate-record="openCandidateReviewSheet"
            :open-structure-preview="openStructurePreview"
            @toggle-select="toggleSelectOne"
            @toggle-select-page="toggleSelectPage"
            @toggle-select-candidate="toggleSelectCandidate"
            @toggle-select-all-candidates="toggleSelectAllCandidates"
            @sort="setSort"
            @edit-record="openEditModal"
          />
        </div>
      </div>
      <CandidateReviewSheet
        :show="Boolean(reviewSheetRecord)"
        :record="reviewSheetRecord"
        :next-record="reviewSheetNextRecord"
        :has-next-candidate="Boolean(reviewSheetNextRecord)"
        @close="reviewSheetRecord = null"
        @next-candidate="openNextCandidateReviewSheet"
        @saved-and-approved="handleCandidateReviewApproved"
        @rejected="handleCandidateReviewRejected"
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
      <div v-if="result.total > 0" class="flex items-center gap-1">
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

    <Transition
      enter-active-class="transition ease-out duration-200"
      enter-from-class="opacity-0"
      enter-to-class="opacity-100"
      leave-active-class="transition ease-in duration-150"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
    >
      <div
        v-if="evidenceModalRecord"
        class="database-field-evidence-popover fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-[2px]"
        @click.self="closeDatabaseEvidencePopover"
      >
        <div class="flex max-h-[88vh] w-[min(1080px,96vw)] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white text-left shadow-[0_32px_120px_-32px_rgba(15,23,42,0.6)]">
          <!-- Header: field, page, value, slide nav, close -->
          <div class="flex shrink-0 items-center justify-between gap-3 border-b border-slate-100 px-5 py-3">
            <div class="flex min-w-0 items-center gap-3">
              <div class="min-w-0">
                <h4 class="truncate text-sm font-black text-slate-950">{{ databaseEvidenceTitle() }}</h4>
                <p class="text-xs font-bold text-slate-400">{{ databaseEvidencePage(evidenceModalRecord) }}</p>
              </div>
              <div class="shrink-0 rounded-md bg-teal-50/70 px-3 py-1 text-sm font-extrabold text-[#0f7c82]">
                <ChemicalText :text="databaseEvidenceValue(evidenceModalRecord)" />
              </div>
            </div>
            <div class="flex shrink-0 items-center gap-2">
              <div v-if="databaseEvidenceSlideCount(evidenceModalRecord) > 1" class="flex items-center gap-1">
                <button
                  type="button"
                  class="grid h-7 w-7 place-items-center rounded-md border border-slate-200 bg-white text-slate-500 transition hover:border-teal-200 hover:text-[#0f7c82]"
                  aria-label="Previous evidence"
                  @click="moveDatabaseEvidenceSlide(evidenceModalRecord, -1)"
                >
                  <ChevronLeft class="h-4 w-4" />
                </button>
                <span class="min-w-10 text-center text-[11px] font-black text-slate-400">
                  {{ databaseEvidenceSlideIndex + 1 }}/{{ databaseEvidenceSlideCount(evidenceModalRecord) }}
                </span>
                <button
                  type="button"
                  class="grid h-7 w-7 place-items-center rounded-md border border-slate-200 bg-white text-slate-500 transition hover:border-teal-200 hover:text-[#0f7c82]"
                  aria-label="Next evidence"
                  @click="moveDatabaseEvidenceSlide(evidenceModalRecord, 1)"
                >
                  <ChevronRight class="h-4 w-4" />
                </button>
              </div>
              <button
                type="button"
                class="grid h-8 w-8 shrink-0 place-items-center rounded-md text-slate-400 transition hover:bg-slate-100 hover:text-slate-800"
                aria-label="Close evidence"
                @click="closeDatabaseEvidencePopover"
              >
                <X class="h-4 w-4" />
              </button>
            </div>
          </div>

          <div
            v-if="databaseEvidenceField === 'conditions' && databaseEvidenceConditionSwitchKeys(evidenceModalRecord).length > 1"
            class="database-evidence-condition-switcher flex shrink-0 items-center gap-2 overflow-x-auto border-b border-slate-100 bg-slate-50/70 px-5 py-2"
          >
            <button
              type="button"
              class="inline-flex h-8 shrink-0 items-center rounded-md border px-3 text-xs font-black transition"
              :class="!databaseEvidenceFocusedFieldKey
                ? 'border-[#b7e6e1] bg-[#e7f6f5] text-[#0f7c82] shadow-sm'
                : 'border-slate-200 bg-white text-slate-500 hover:border-teal-200 hover:text-[#0f7c82]'"
              @click="focusDatabaseEvidenceConditionKey(evidenceModalRecord, null)"
            >
              All
            </button>
            <button
              v-for="fieldKey in databaseEvidenceConditionSwitchKeys(evidenceModalRecord)"
              :key="fieldKey"
              type="button"
              class="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border px-3 text-xs font-black transition"
              :class="databaseEvidenceConditionSwitchActive(evidenceModalRecord, fieldKey)
                ? 'border-[#0f7c82] bg-white text-[#0f7c82] shadow-sm'
                : 'border-slate-200 bg-white text-slate-500 hover:border-teal-200 hover:text-[#0f7c82]'"
              @click="switchDatabaseEvidenceConditionKey(evidenceModalRecord, fieldKey)"
            >
              <span>{{ databaseEvidenceFieldLabel(fieldKey) }}</span>
              <span
                v-if="databaseEvidenceConditionSwitchValue(evidenceModalRecord, fieldKey)"
                class="max-w-[8rem] truncate rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500"
              >
                {{ databaseEvidenceConditionSwitchValue(evidenceModalRecord, fieldKey) }}
              </span>
            </button>
          </div>

          <!-- Body: two-pane (image | text+context), both visible together -->
          <div class="min-h-0 flex-1 overflow-hidden">
            <div v-if="databaseEvidenceIsLoading(evidenceModalRecord)" class="grid h-full place-items-center p-10 text-sm font-semibold text-slate-500">
              Locating evidence...
            </div>
            <div v-else-if="databaseEvidenceDisplayError(evidenceModalRecord)" class="grid h-full place-items-center p-10 text-sm font-semibold text-rose-600">
              {{ databaseEvidenceDisplayError(evidenceModalRecord) }}
            </div>
            <template v-else>
              <div
                v-if="activeDatabaseEvidenceSlide(evidenceModalRecord)"
                class="grid h-full min-h-0"
                :class="(activeDatabaseEvidenceSlide(evidenceModalRecord)?.imageSrc || activeDatabaseEvidenceSlide(evidenceModalRecord)?.imageLoading || activeDatabaseEvidenceSlide(evidenceModalRecord)?.imageError)
                  ? 'md:grid-cols-[1.3fr_1fr]'
                  : 'grid-cols-1'"
              >
                <!-- Image pane -->
                <div
                  v-if="activeDatabaseEvidenceSlide(evidenceModalRecord)?.imageSrc || activeDatabaseEvidenceSlide(evidenceModalRecord)?.imageLoading || activeDatabaseEvidenceSlide(evidenceModalRecord)?.imageError"
                  class="database-evidence-image-pane flex min-h-0 items-center justify-center overflow-auto border-b border-slate-100 bg-slate-50 p-4 md:border-b-0 md:border-r"
                >
                  <button
                    v-if="activeDatabaseEvidenceSlide(evidenceModalRecord)?.imageSrc"
                    type="button"
                    class="group relative block w-full cursor-zoom-in outline-none focus-visible:ring-4 focus-visible:ring-[#d8fbfb]"
                    aria-label="Enlarge evidence image"
                    @click="openImagePreview(activeDatabaseEvidenceSlide(evidenceModalRecord)?.imageSrc || '', `${databaseEvidenceTitle()} · ${databaseEvidencePage(evidenceModalRecord)}`)"
                  >
                    <img
                      :src="activeDatabaseEvidenceSlide(evidenceModalRecord)?.imageSrc || ''"
                      alt="Highlighted PDF evidence"
                      class="mx-auto max-h-[74vh] w-full rounded-md border border-emerald-100 bg-white object-contain"
                    >
                    <span class="pointer-events-none absolute right-2 top-2 grid h-8 w-8 place-items-center rounded-md bg-slate-950/70 text-white opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100">
                      <Maximize2 class="h-4 w-4" />
                    </span>
                  </button>
                  <div v-else-if="activeDatabaseEvidenceSlide(evidenceModalRecord)?.imageLoading" class="text-sm font-semibold text-slate-400">
                    Rendering highlighted PDF evidence...
                  </div>
                  <div v-else class="rounded-md border border-amber-100 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-700">
                    {{ activeDatabaseEvidenceSlide(evidenceModalRecord)?.imageError }}
                  </div>
                </div>

                <!-- Text + context pane -->
                <div class="database-evidence-content-scroll flex min-h-0 flex-col overflow-y-auto px-5 py-4">
                  <div class="shrink-0">
                    <div class="truncate text-xs font-black uppercase tracking-[0.12em] text-slate-400">
                      {{ activeDatabaseEvidenceSlide(evidenceModalRecord)?.label }}
                    </div>
                    <div class="text-xs font-bold text-slate-500">
                      {{ activeDatabaseEvidenceSlide(evidenceModalRecord)?.page ? `Page ${activeDatabaseEvidenceSlide(evidenceModalRecord)?.page}` : 'Text evidence' }}
                    </div>
                  </div>
                  <div
                    v-if="activeDatabaseEvidenceSlide(evidenceModalRecord)?.aliasNote"
                    class="mt-3 rounded-lg border border-cyan-100 bg-cyan-50 px-3.5 py-2.5 text-sm font-semibold leading-6 text-cyan-900"
                  >
                    <div class="text-[11px] font-black uppercase tracking-[0.14em] text-cyan-600">
                      Cation note
                    </div>
                    <ChemicalText :text="activeDatabaseEvidenceSlide(evidenceModalRecord)?.aliasNote || ''" />
                  </div>
                  <p
                    v-if="activeDatabaseEvidenceQuote(evidenceModalRecord)"
                    class="mt-3 rounded-lg border border-slate-100 bg-slate-50 px-3.5 py-3 text-[15px] font-medium leading-7 text-slate-700"
                  >
                    <template
                      v-for="(part, partIndex) in splitDatabaseEvidenceQuote(activeDatabaseEvidenceQuote(evidenceModalRecord)!)"
                      :key="`${evidenceModalRecord.id}-slide-${databaseEvidenceSlideIndex}-${partIndex}`"
                    >
                      <mark v-if="part.active" class="rounded bg-[#cdf3ef] px-0.5 py-0 font-black text-[#0b6870]">
                        <ChemicalText :text="part.text" />
                      </mark>
                      <ChemicalText v-else :text="part.text" />
                    </template>
                  </p>
                  <p v-else class="mt-3 rounded-lg border border-dashed border-slate-200 px-3.5 py-3 text-sm font-semibold text-slate-400">
                    No field-level quote was stored for this value.
                  </p>
                  <div
                    v-if="activeDatabaseEvidenceNote(evidenceModalRecord)"
                    class="mt-3 rounded-lg border border-teal-100 bg-teal-50 px-3.5 py-3 text-sm font-semibold leading-6 text-teal-800"
                  >
                    <div class="text-[11px] font-black uppercase tracking-[0.14em] text-teal-600">
                      {{ activeDatabaseEvidenceSlide(evidenceModalRecord)?.noteLabel || 'Derived calculation' }}
                    </div>
                    <ChemicalText :text="activeDatabaseEvidenceNote(evidenceModalRecord)" />
                  </div>
                  <div class="mt-auto flex items-center justify-between gap-3 pt-4">
                    <span class="text-[11px] font-black uppercase tracking-[0.1em] text-slate-400">
                      <template v-if="activeDatabaseEvidenceSlide(evidenceModalRecord)?.page">p.{{ activeDatabaseEvidenceSlide(evidenceModalRecord)?.page }}</template>
                      <template v-if="activeDatabaseEvidenceSlide(evidenceModalRecord)?.confidence != null"> · {{ Math.round((activeDatabaseEvidenceSlide(evidenceModalRecord)?.confidence || 0) * 100) }}%</template>
                    </span>
                    <button
                      v-if="evidenceModalRecord.literatureId"
                      type="button"
                      class="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-black text-slate-600 transition hover:border-[#8fe5e7] hover:text-[#0f7c82]"
                      @click="openRecordPdf(evidenceModalRecord, { forcePdf: true })"
                    >
                      <FileText class="h-3.5 w-3.5" />
                      Open in PDF
                    </button>
                  </div>
                </div>
              </div>
              <div v-else class="grid h-full place-items-center p-10 text-sm font-semibold text-slate-400">
                No field-level quote was stored for this {{ databaseEvidenceTitle().toLowerCase() }} value.
              </div>
            </template>
          </div>
        </div>
      </div>
    </Transition>

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
                    {{ compactRecordDisplayId(editDrawerRecord) }}
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
                <span class="rounded-md border border-slate-200 bg-slate-50 px-3 py-1 text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
                  COF {{ cofDisplay(editDrawerRecord) }}
                </span>
                <span class="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-1 text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300">
                  Confidence {{ confidenceDisplay(confidenceValueFor(editDrawerRecord)) }}
                </span>
                <span class="rounded-md border border-slate-200 bg-slate-50 px-3 py-1 text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
                  {{ tribopairDisplay(editDrawerRecord) }}
                </span>
              </div>
            </div>

            <div class="flex-1 overflow-auto px-6 py-5">
              <div class="space-y-5">
                <section class="rounded-md border border-slate-200 bg-slate-50/80 p-4 dark:border-slate-800 dark:bg-slate-900/60">
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

                <section class="rounded-md border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-950">
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

                <section class="rounded-md border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-950">
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

                <details class="rounded-md border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-950">
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
              <p
                v-if="correctionError"
                class="mb-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-600 dark:border-rose-500/25 dark:bg-rose-500/10 dark:text-rose-300"
              >
                {{ correctionError }}
              </p>

              <div
                v-if="correctionReviewMode"
                class="mb-3 rounded-lg border border-slate-200 bg-slate-50/80 p-3 dark:border-slate-800 dark:bg-slate-900/60"
              >
                <div class="flex items-center justify-between gap-2">
                  <span class="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">Review changes</span>
                  <span
                    v-if="correctionConfidenceDelta"
                    class="text-[11px] font-semibold text-slate-500 dark:text-slate-400"
                  >
                    Confidence {{ confidenceDisplay(correctionConfidenceDelta.next) }}
                    <span
                      v-if="Math.abs(correctionConfidenceDelta.delta) >= 0.005"
                      :class="correctionConfidenceDelta.delta >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-500 dark:text-rose-400'"
                    >
                      ({{ correctionConfidenceDelta.delta >= 0 ? '+' : '' }}{{ (correctionConfidenceDelta.delta * 100).toFixed(0) }}%)
                    </span>
                  </span>
                </div>
                <div v-if="correctionDiffEntries.length" class="mt-2 max-h-52 space-y-1.5 overflow-auto">
                  <div
                    v-for="entry in correctionDiffEntries"
                    :key="entry.field"
                    class="grid grid-cols-[120px_1fr] items-start gap-2 text-xs"
                  >
                    <span class="font-semibold text-slate-500 dark:text-slate-400">{{ entry.label }}</span>
                    <span class="min-w-0">
                      <span class="break-words text-rose-500 line-through dark:text-rose-400">{{ entry.before }}</span>
                      <span class="mx-1 text-slate-400">→</span>
                      <span class="break-words font-semibold text-emerald-600 dark:text-emerald-400">{{ entry.after }}</span>
                    </span>
                  </div>
                </div>
                <p v-else class="mt-2 text-xs text-slate-500 dark:text-slate-400">No field changes detected — nothing to save.</p>
              </div>

              <div class="flex items-center justify-between gap-3">
                <p class="text-xs text-slate-500 dark:text-slate-400">
                  <template v-if="correctionReviewMode">Confirm to apply via the audited correction service.</template>
                  <template v-else>Changes are previewed before saving via the audited correction service.</template>
                </p>
                <div class="flex items-center gap-2">
                  <template v-if="correctionReviewMode">
                    <button
                      type="button"
                      class="inline-flex h-10 items-center rounded-md border border-slate-300 px-4 text-sm font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                      :disabled="correctionPending"
                      @click="cancelCorrectionReview"
                    >
                      Back
                    </button>
                    <button
                      type="button"
                      class="inline-flex h-10 items-center gap-1.5 rounded-md bg-slate-900 px-4 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-60"
                      :disabled="correctionPending || correctionDiffEntries.length === 0"
                      @click="commitActiveCorrection"
                    >
                      <Save class="h-4 w-4" /> {{ correctionPending ? 'Saving…' : 'Confirm & save' }}
                    </button>
                  </template>
                  <template v-else>
                    <button
                      type="button"
                      class="inline-flex h-10 items-center rounded-md border border-slate-300 px-4 text-sm font-medium text-slate-600 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                      @click="closeEditDrawer"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      class="inline-flex h-10 items-center gap-1.5 rounded-md bg-slate-900 px-4 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-60 dark:bg-slate-100 dark:text-slate-950 dark:hover:bg-white"
                      :disabled="correctionPending"
                      @click="previewActiveCorrection"
                    >
                      {{ correctionPending ? 'Checking…' : 'Review changes' }}
                    </button>
                  </template>
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
