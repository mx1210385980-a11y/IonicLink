<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  AlertCircle,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Download,
  FileSearch,
  FileText,
  Layers,
  RefreshCw,
  Search,
} from 'lucide-vue-next'
import type { BatchFile, LiteratureMetadata, RecordResponse, TribologyData } from '@/lib/api'
import ConditionMicrobar from '@/components/integrated-explorer/ConditionMicrobar.vue'
import LubricantRecipeCell from '@/components/integrated-explorer/LubricantRecipeCell.vue'
import TribopairCapsule from '@/components/integrated-explorer/TribopairCapsule.vue'
import {
  cofDisplay,
  compactRecordDisplayId,
  recordDisplayId,
} from '@/lib/integratedExplorerHelpers'
import { useValidation } from '@/composables/useValidation'
import LiteratureMetadataCard from '@/components/LiteratureMetadataCard.vue'
import Button from '@/components/ui/Button.vue'
import Badge from '@/components/ui/Badge.vue'

const props = defineProps<{
  files: BatchFile[]
  selectedId: string | null
  loading?: boolean
}>()

const emit = defineEmits<{
  'export': [fileId: string, format: 'json' | 'csv']
  'retry': [fileId: string]
  'update:record': [fileId: string, recordId: string, record: TribologyData]
  'update:file': [fileId: string]
  'update:metadata': [fileId: string, metadata: LiteratureMetadata]
  'save': [fileId: string]
  'view-grounding': [fileId: string]
}>()

const { validateRecord } = useValidation()

const COL_SELECT = 'w-[48px]'
const COL_ID = 'w-[56px]'
const COL_IONIC = 'w-[280px]'
const COL_TRIBOPAIR = 'w-[240px]'
const COL_CONDITIONS = 'w-[304px]'
const COL_COF = 'w-[126px]'
const COL_LITERATURE = 'w-[210px]'

const selectedFileId = computed(() => props.selectedId)
const expandedRows = ref<Set<string>>(new Set())
const showExportMenu = ref(false)

const selectedFile = computed(() => {
  if (!selectedFileId.value) return null
  return props.files.find((file) => file.id === selectedFileId.value) || null
})

const selectedLiquidFilter = ref<string>('All')
const filterSearch = ref('')
const isFilterExpanded = ref(false)

watch(selectedFileId, () => {
  selectedLiquidFilter.value = 'All'
  filterSearch.value = ''
  isFilterExpanded.value = false
})

const uniqueLiquids = computed(() => {
  if (!selectedFile.value) return []
  const counts: Record<string, number> = {}
  selectedFile.value.records.forEach((record) => {
    const name = record.ionic_liquid?.trim() || 'Unknown'
    counts[name] = (counts[name] || 0) + 1
  })
  return Object.entries(counts)
    .map(([name, count]) => ({ name, count }))
    .sort((left, right) => right.count - left.count)
})

const visibleUniqueLiquids = computed(() => {
  if (!filterSearch.value) return uniqueLiquids.value
  const search = filterSearch.value.toLowerCase()
  return uniqueLiquids.value.filter((liquid) => liquid.name.toLowerCase().includes(search))
})

const displayedFilterLiquids = computed(() => (
  isFilterExpanded.value ? visibleUniqueLiquids.value : visibleUniqueLiquids.value.slice(0, 8)
))

const filteredRecords = computed(() => {
  if (!selectedFile.value) return []
  if (selectedLiquidFilter.value === 'All') return selectedFile.value.records
  return selectedFile.value.records.filter((record) => (record.ionic_liquid?.trim() || 'Unknown') === selectedLiquidFilter.value)
})

const stats = computed(() => {
  const total = props.files.length
  const completed = props.files.filter((file) => file.status === 'success').length
  const totalRecords = props.files.reduce((sum, file) => sum + file.records.length, 0)
  const withWarnings = props.files.filter((file) => file.hasWarnings).length
  return { total, completed, totalRecords, withWarnings }
})

function toggleRow(id: string) {
  if (expandedRows.value.has(id)) {
    expandedRows.value.delete(id)
  } else {
    expandedRows.value.add(id)
  }
}

function parseNumericValue(value: string | undefined) {
  if (!value) return null
  const match = value.match(/[-+]?\d+(?:\.\d+)?/)
  if (!match) return null
  const parsed = Number(match[0])
  return Number.isFinite(parsed) ? parsed : null
}

function previewNumericId(record: TribologyData, index: number) {
  const parsed = Number(record.id)
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : index + 1
}

function previewDisplayId(record: TribologyData, index: number) {
  const direct = String((record as any).displayId || '').trim()
  if (direct) return direct
  const raw = String(record.id || '').trim()
  if (raw && !/^\d+$/.test(raw)) return raw
  return `P-${String(index + 1).padStart(3, '0')}`
}

function previewRecordResponse(record: TribologyData, index: number): RecordResponse {
  const metadata = selectedFile.value?.metadata
  const confidenceDetails = (record as any).confidence_details || (record as any).confidenceDetails
  return {
    id: previewNumericId(record, index),
    displayId: previewDisplayId(record, index),
    materialName: record.material_name,
    lubricant: record.ionic_liquid,
    lubricantComponents: record.lubricant_components || null,
    lubricantAlias: record.lubricant_alias || null,
    ionicLiquidDisplay: record.ionic_liquid_display || record.ionic_liquid || null,
    lubricantTooltip: record.lubricant_tooltip || null,
    cofValue: parseNumericValue(record.cof),
    cofOperator: record.cof?.match(/[<>~=]/)?.[0] || null,
    cofRaw: record.cof || null,
    cofExtracted: record.cof_extracted || null,
    loadValue: record.load || record.normal_load || null,
    loadRaw: record.load || record.normal_load || null,
    loadConditions: record.load_conditions || null,
    speedValue: record.speed || null,
    speedConditions: record.speed_conditions || null,
    shearRate: record.shear_rate || null,
    temperature: record.temperature || null,
    potential: record.potential || null,
    waterContent: record.water_content || null,
    probeMaterial: record.probe_material || null,
    probeGeometry: record.probe_geometry || null,
    probeRadius: record.probe_radius || null,
    probeRoughness: record.probe_roughness || null,
    substrateMaterial: record.substrate_material || null,
    substrateCoating: record.substrate_coating || null,
    substrateRoughness: record.substrate_roughness || null,
    tribopairLabel: null,
    surfaceRoughness: record.surface_roughness || null,
    residualFilmThicknessD: record.residual_film_thickness_d || null,
    layerSpacingDelta: record.layer_spacing_delta || null,
    filmThickness: record.film_thickness || null,
    regime: record.regime || null,
    tribologicalSystem: record.tribological_system || null,
    experimentProfile: null,
    experimentScale: record.experiment_scale || null,
    experimentMethod: record.experiment_method || null,
    measurementType: record.measurement_type || null,
    trainingView: null,
    molRatio: record.mol_ratio || null,
    cation: record.cation || null,
    anion: record.anion || null,
    cationSmiles: record.cation_smiles || null,
    anionSmiles: record.anion_smiles || null,
    ilSmiles: record.il_smiles || null,
    ilInchikey: record.il_inchikey || null,
    alkylChainLength: record.alkyl_chain_length || null,
    confidence: Number(record.confidence ?? 0.9),
    confidenceDetails: confidenceDetails
      && typeof confidenceDetails.score === 'number'
      && typeof confidenceDetails.percent === 'number'
      && Array.isArray(confidenceDetails.penalties)
      ? confidenceDetails
      : undefined,
    reviewStatus: record.review_status || null,
    literatureId: 0,
    literature: {
      id: 0,
      doi: metadata?.doi || '',
      title: metadata?.title || selectedFile.value?.name || 'Extraction preview',
      authors: metadata?.authors || null,
      journal: metadata?.journal || '',
      year: metadata?.year ? Number(metadata.year) : null,
    },
    evidence: record.evidence || null,
    evidencePage: record.source_page || null,
    evidenceBbox: String((record as any).evidence_bbox || '').trim() || null,
    source: record.source || null,
    sourcePage: record.source_page || null,
    sourceFigure: record.source_figure || null,
  }
}

function previewLiteratureTitle() {
  return selectedFile.value?.metadata?.title || selectedFile.value?.name || 'Extraction preview'
}

function previewLiteratureMeta(record: TribologyData) {
  const source = record.source_figure || record.source || (record.source_page ? `Page ${record.source_page}` : '')
  if (source) return source
  const metadata = selectedFile.value?.metadata
  const journal = String(metadata?.journal || '').trim()
  const year = metadata?.year ? String(metadata.year) : ''
  if (journal && year) return `${journal} (${year})`
  return journal || year || 'Source grounding'
}

function exportCurrentFile(format: 'json' | 'csv' = 'json') {
  if (selectedFileId.value) emit('export', selectedFileId.value, format)
}

async function handleReprocess(fileId?: string) {
  const targetId = typeof fileId === 'string' ? fileId : selectedFileId.value
  if (!targetId) return
  emit('retry', targetId)
}

function updateRecordField(recordId: string, fieldName: keyof TribologyData, value: string | undefined) {
  if (!selectedFile.value) return
  const record = selectedFile.value.records.find((item) => item.id === recordId)
  if (!record) return
  if (!record.originalValue) record.originalValue = { ...record }
  ;(record as any)[fieldName] = value
  record.validationStatus = 'modified'
  const validation = validateRecord(record)
  record.validationStatus = validation.status
  record.validationMessage = validation.message
  emit('update:record', selectedFile.value.id, recordId, record)
}

function verifyRecord(recordId: string) {
  if (!selectedFile.value) return
  const record = selectedFile.value.records.find((item) => item.id === recordId)
  if (!record) return
  if (record.validationStatus === 'verified') {
    const validation = validateRecord(record)
    record.validationStatus = validation.status
    record.validationMessage = validation.message
  } else {
    record.validationStatus = 'verified'
    record.validationMessage = undefined
  }
  emit('update:record', selectedFile.value.id, recordId, record)
}

function markAllAsVerified() {
  if (!selectedFile.value) return
  selectedFile.value.records.forEach((record) => {
    const validation = validateRecord(record)
    if (validation.issues.every((issue) => issue.severity !== 'error')) {
      record.validationStatus = 'verified'
      record.validationMessage = undefined
    }
  })
  emit('update:file', selectedFile.value.id)
}
</script>

<template>
  <div class="h-full flex flex-col bg-background">
    <div class="px-4 py-3 border-b flex items-center justify-between">
      <div>
        <h2 class="text-lg font-semibold">Extracted Data Preview</h2>
        <p class="text-sm text-muted-foreground">
          Total {{ stats.totalRecords }} records · {{ stats.completed }}/{{ stats.total }} files completed
        </p>
      </div>
    </div>

    <div class="flex-1 overflow-hidden p-4 relative">
      <div class="h-full flex flex-col min-w-0">
        <div v-if="!selectedFile" class="absolute inset-0 flex items-center justify-center p-6">
          <div class="text-center bg-white rounded-2xl shadow-sm border border-gray-100/50 p-12 max-w-2xl w-full mx-auto">
            <div class="w-16 h-16 bg-blue-50/80 rounded-2xl flex items-center justify-center mx-auto mb-6 ring-8 ring-blue-50/30">
              <FileSearch class="h-8 w-8 text-blue-600" />
            </div>
            <h3 class="text-[17px] font-bold text-gray-800 mb-3">No Literature Selected</h3>
            <p class="text-[13px] text-gray-500 leading-relaxed mb-8 max-w-sm mx-auto">
              Please select a file from the sidebar to view extracted results, or upload new files for analysis.
            </p>
            <Button variant="outline" class="w-auto h-10 px-6 font-medium text-gray-600 bg-gray-50 hover:bg-gray-100 border-gray-200 shadow-sm rounded-lg" @click="$emit('view-grounding', '')" disabled>
              <Layers class="w-4 h-4 mr-2 text-gray-400" />
              Browse All Data
            </Button>
          </div>
        </div>

        <div v-else class="h-full flex flex-col">
          <div class="flex items-center justify-between mb-3 pb-3 border-b gap-4">
            <div class="min-w-0 flex-1 overflow-hidden">
              <h3 class="font-semibold truncate" :title="selectedFile.name">{{ selectedFile.name }}</h3>
              <p class="text-xs text-muted-foreground mt-0.5">{{ selectedFile.records.length }} records</p>
            </div>
            <div class="flex gap-2">
              <Button
                v-if="selectedFile.status === 'success' && selectedFile.records.length > 0"
                size="sm"
                variant="outline"
                class="text-green-600 border-green-500 hover:bg-green-50"
                @click="markAllAsVerified"
              >
                <CheckCircle2 class="h-4 w-4 mr-1" />
                Verify All
              </Button>
              <Button
                v-if="selectedFile.status === 'success' && selectedFile.records.length > 0"
                size="sm"
                variant="outline"
                class="text-blue-600 border-blue-500 hover:bg-blue-50"
                @click="emit('save', selectedFile.id)"
              >
                <RefreshCw class="h-4 w-4 mr-1" />
                Sync to DB
              </Button>
              <Button
                v-if="['success', 'error', 'no_data'].includes(selectedFile.status)"
                size="sm"
                variant="outline"
                title="Re-extract data"
                @click="handleReprocess()"
              >
                <RefreshCw class="h-4 w-4 mr-1" />
                Re-extract
              </Button>
              <div v-if="selectedFile.records.length > 0" class="relative">
                <Button size="sm" variant="outline" @click="showExportMenu = !showExportMenu">
                  <Download class="h-4 w-4 mr-1" />
                  Export
                  <ChevronDown class="h-3 w-3 ml-1" />
                </Button>
                <div
                  v-if="showExportMenu"
                  class="absolute right-0 top-full mt-1 w-36 rounded-md border bg-popover shadow-lg z-50 py-1"
                  @mouseleave="showExportMenu = false"
                >
                  <button
                    class="w-full text-left px-3 py-1.5 text-sm hover:bg-accent transition-colors"
                    @click="exportCurrentFile('json'); showExportMenu = false"
                  >
                    Export JSON
                  </button>
                  <button
                    class="w-full text-left px-3 py-1.5 text-sm hover:bg-accent transition-colors"
                    @click="exportCurrentFile('csv'); showExportMenu = false"
                  >
                    Export CSV
                  </button>
                </div>
              </div>
              <Button
                v-if="selectedFile.status === 'success' && selectedFile.records.length > 0"
                size="sm"
                variant="outline"
                class="text-amber-600 border-amber-500 hover:bg-amber-50"
                title="View source highlights"
                @click="emit('view-grounding', selectedFile.id)"
              >
                <FileText class="h-4 w-4 mr-1" />
                Source
              </Button>
            </div>
          </div>

          <div v-if="selectedFile.records.length > 0 && uniqueLiquids.length > 0" class="px-4 py-2 border-b bg-muted/5 flex flex-wrap items-center gap-2 text-xs">
            <div class="flex items-center gap-1.5 mr-1 text-muted-foreground shrink-0">
              <span class="font-medium">Filter:</span>
              <Badge variant="outline" class="text-[10px] h-4 px-1 font-normal border-muted-foreground/30">
                {{ uniqueLiquids.length }} types
              </Badge>
            </div>
            <button
              class="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium transition-colors border shadow-sm h-6"
              :class="selectedLiquidFilter === 'All' ? 'bg-primary text-primary-foreground border-primary' : 'bg-card text-card-foreground hover:bg-muted border-border'"
              @click="selectedLiquidFilter = 'All'"
            >
              All
              <span class="ml-1 opacity-70 scale-90">({{ selectedFile.records.length }})</span>
            </button>
            <button
              v-for="liquid in displayedFilterLiquids"
              :key="liquid.name"
              class="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium transition-colors border shadow-sm h-6"
              :class="selectedLiquidFilter === liquid.name ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-700 hover:bg-blue-50 border-slate-200'"
              @click="selectedLiquidFilter = liquid.name"
            >
              {{ liquid.name }}
              <span class="ml-1 opacity-70 scale-90">({{ liquid.count }})</span>
            </button>
            <button
              v-if="visibleUniqueLiquids.length > 8"
              class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium text-primary hover:text-primary/80 hover:bg-primary/5 transition-colors h-6"
              @click="isFilterExpanded = !isFilterExpanded"
            >
              <component :is="isFilterExpanded ? ChevronUp : ChevronDown" class="h-3 w-3 mr-0.5" />
              {{ isFilterExpanded ? 'Collapse' : `+${visibleUniqueLiquids.length - 8}` }}
            </button>
            <div v-if="uniqueLiquids.length > 5 || filterSearch" class="relative w-32 ml-auto">
              <Search class="absolute left-1.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
              <input
                v-model="filterSearch"
                class="w-full h-6 pl-6 pr-2 rounded border text-[10px] bg-background focus:outline-none focus:ring-1 focus:ring-primary"
                placeholder="Search..."
              />
            </div>
          </div>

          <div class="flex-1 overflow-y-auto min-h-0 relative">
            <div v-if="selectedFile.records.length === 0" class="absolute inset-0 flex items-center justify-center">
              <div class="text-center">
                <AlertCircle class="mx-auto h-10 w-10 text-muted-foreground/50" />
                <p class="mt-2 text-sm font-semibold text-muted-foreground">
                  {{ selectedFile.status === 'no_data' ? 'No extractable records were found for this mode.' : 'No data extracted for this file' }}
                </p>
                <Button
                  v-if="['error', 'no_data'].includes(selectedFile.status)"
                  size="sm"
                  variant="outline"
                  class="mt-4"
                  @click="handleReprocess()"
                >
                  <RefreshCw class="h-4 w-4 mr-1" />
                  Re-extract
                </Button>
              </div>
            </div>

            <LiteratureMetadataCard
              v-if="selectedFile.metadata"
              :metadata="selectedFile.metadata"
              :editable="true"
              @update:metadata="(metadata) => selectedFile && emit('update:metadata', selectedFile.id, metadata)"
            />

            <div v-if="filteredRecords.length > 0" class="virtual-table-container database-record-table flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-950/85">
              <div class="virtual-table-header shrink-0 border-b border-slate-200 bg-[linear-gradient(180deg,#fcfeff_0%,#f7fafc_100%)] text-[0.68rem] font-black uppercase tracking-[0.18em] text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
                <div class="flex items-center">
                  <div :class="COL_SELECT" class="shrink-0 px-3 py-3.5"><span class="column-ruler-label justify-center"><span class="column-ruler-mark" />OK</span></div>
                  <div :class="COL_ID" class="shrink-0 px-3 py-3.5 text-center"><span class="column-ruler-label justify-center"><span class="column-ruler-mark" />#</span></div>
                  <div :class="COL_IONIC" class="shrink-0 px-4 py-3.5"><span class="column-ruler-label"><span class="column-ruler-mark" />IONIC LIQUID</span></div>
                  <div :class="COL_TRIBOPAIR" class="shrink-0 px-4 py-3.5"><span class="column-ruler-label"><span class="column-ruler-mark" />TRIBOPAIR</span></div>
                  <div :class="COL_CONDITIONS" class="shrink-0 px-3 py-3.5"><span class="column-ruler-label"><span class="column-ruler-mark" />CONDITIONS</span></div>
                  <div :class="COL_COF" class="shrink-0 px-4 py-3.5 text-[#0f7c82]"><span class="column-ruler-label column-ruler-label--metric"><span class="column-ruler-mark" />COF</span></div>
                  <div :class="COL_LITERATURE" class="shrink-0 px-4 py-3.5"><span class="column-ruler-label"><span class="column-ruler-mark" />SOURCE</span></div>
                </div>
              </div>

              <div class="virtual-table-body overflow-auto">
                <template v-for="(item, index) in filteredRecords" :key="item.id || index">
                  <div
                    class="virtual-record-row group flex w-full items-start border-b border-slate-100 transition-colors hover:bg-[#f8fcfd] dark:border-slate-800 dark:hover:bg-slate-900/70"
                    :class="{
                      'border-l-4 border-l-green-500': item.validationStatus === 'verified',
                      'bg-yellow-50/40': item.validationStatus === 'warning',
                    }"
                    @click="toggleRow(item.id!)"
                  >
                    <div :class="COL_SELECT" class="shrink-0 self-center px-3 py-4">
                      <button
                        type="button"
                        class="inline-flex h-7 w-7 items-center justify-center rounded-md border transition hover:border-[#0f7c82] hover:bg-[#eefafa] hover:text-[#0f7c82]"
                        :class="item.validationStatus === 'verified' ? 'border-[#0f7c82] bg-[#0f7c82] text-white shadow-sm' : 'border-slate-300 bg-white text-transparent'"
                        :title="item.validationStatus === 'verified' ? 'Verified' : 'Mark as verified'"
                        @click.stop="verifyRecord(item.id!)"
                      >
                        <Check class="h-4 w-4 stroke-[3]" />
                      </button>
                    </div>

                    <div :class="COL_ID" class="shrink-0 self-center px-3 py-4 text-center">
                      <span
                        class="inline-flex h-6 min-w-9 items-center justify-center rounded-md border border-slate-200 bg-slate-50 px-1.5 text-[12px] font-bold leading-none text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400"
                        :title="recordDisplayId(previewRecordResponse(item, index))"
                      >
                        {{ compactRecordDisplayId(previewRecordResponse(item, index)) }}
                      </span>
                    </div>

                    <div :class="COL_IONIC" class="shrink-0 px-4 py-4">
                      <div class="workspace-card cursor-pointer rounded-[9px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f7c82]/35">
                        <LubricantRecipeCell :record="previewRecordResponse(item, index)" />
                      </div>
                    </div>

                    <div :class="COL_TRIBOPAIR" class="shrink-0 px-4 py-3">
                      <div class="workspace-card cursor-pointer rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f7c82]/35">
                        <TribopairCapsule :record="previewRecordResponse(item, index)" />
                      </div>
                    </div>

                    <div :class="COL_CONDITIONS" class="flex shrink-0 justify-center px-3 py-3">
                      <div class="workspace-card block w-fit max-w-[296px] cursor-pointer rounded-[9px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f7c82]/35">
                        <ConditionMicrobar :record="previewRecordResponse(item, index)" />
                      </div>
                    </div>

                    <div :class="COL_COF" class="shrink-0 self-center px-4 py-4">
                      <div class="workspace-card cursor-pointer rounded-lg px-1 py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f7c82]/35">
                        <div class="text-[clamp(1.05rem,0.95rem+0.28vw,1.28rem)] font-extrabold leading-none text-blue-600" @click.stop>
                          <EditableField
                            :model-value="cofDisplay(previewRecordResponse(item, index))"
                            field-name="cof"
                            :validation-status="item.validationStatus"
                            :validation-message="item.validationMessage"
                            placeholder="-"
                            @update:model-value="updateRecordField(item.id!, 'cof', $event)"
                          />
                        </div>
                      </div>
                    </div>

                    <div :class="COL_LITERATURE" class="shrink-0 self-center px-4 py-3">
                      <button
                        type="button"
                        class="group flex min-h-11 w-full cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-left transition hover:border-[#0f7c82]/35 hover:bg-[#f3fbfc] dark:border-slate-700 dark:bg-slate-950 dark:hover:border-[#0f7c82]/40 dark:hover:bg-slate-900"
                        :title="previewLiteratureTitle()"
                        aria-label="Open extraction source grounding"
                        @click.stop="emit('view-grounding', selectedFile.id)"
                      >
                        <BookOpen class="h-4 w-4 shrink-0 text-[#0f7c82]" />
                        <span class="min-w-0">
                          <span class="block truncate text-[13px] font-extrabold leading-4 text-slate-800 group-hover:text-[#0f7c82] dark:text-slate-100">{{ previewLiteratureTitle() }}</span>
                          <span class="block truncate text-[11.5px] font-semibold leading-4 text-slate-500 dark:text-slate-400">{{ previewLiteratureMeta(item) }}</span>
                        </span>
                      </button>
                    </div>
                  </div>

                  <div v-if="expandedRows.has(item.id!)" class="border-b border-slate-100 bg-muted/30 px-4 py-3">
                    <div class="grid grid-cols-2 gap-3 text-sm">
                      <div class="flex items-center gap-2">
                        <span class="text-muted-foreground">COF:</span>
                        <EditableField
                          :model-value="item.cof"
                          field-name="cof"
                          :validation-status="item.validationStatus"
                          :validation-message="item.validationMessage"
                          placeholder="-"
                          @update:model-value="updateRecordField(item.id!, 'cof', $event)"
                        />
                      </div>
                      <div v-if="item.wear_rate" class="flex items-center gap-2">
                        <span class="text-muted-foreground">Wear Rate:</span>
                        <EditableField
                          :model-value="item.wear_rate"
                          field-name="wear_rate"
                          :validation-status="item.validationStatus"
                          placeholder="-"
                          @update:model-value="updateRecordField(item.id!, 'wear_rate', $event)"
                        />
                      </div>
                      <div v-if="item.load" class="flex items-center gap-2">
                        <span class="text-muted-foreground">Load:</span>
                        <EditableField :model-value="item.load" field-name="load" :validation-status="item.validationStatus" placeholder="-" @update:model-value="updateRecordField(item.id!, 'load', $event)" />
                      </div>
                      <div v-if="item.speed" class="flex items-center gap-2">
                        <span class="text-muted-foreground">Speed:</span>
                        <EditableField :model-value="item.speed" field-name="speed" :validation-status="item.validationStatus" placeholder="-" @update:model-value="updateRecordField(item.id!, 'speed', $event)" />
                      </div>
                      <div v-if="item.temperature" class="flex items-center gap-2">
                        <span class="text-muted-foreground">Temperature:</span>
                        <EditableField :model-value="item.temperature" field-name="temperature" :validation-status="item.validationStatus" placeholder="-" @update:model-value="updateRecordField(item.id!, 'temperature', $event)" />
                      </div>
                      <div v-if="item.potential" class="flex items-center gap-2">
                        <span class="text-muted-foreground">Potential:</span>
                        <EditableField :model-value="item.potential" field-name="potential" :validation-status="item.validationStatus" placeholder="-" @update:model-value="updateRecordField(item.id!, 'potential', $event)" />
                      </div>
                      <div v-if="item.base_oil"><span class="text-muted-foreground">Base Oil:</span><span class="ml-2">{{ item.base_oil }}</span></div>
                      <div v-if="item.concentration"><span class="text-muted-foreground">Concentration:</span><span class="ml-2">{{ item.concentration }}</span></div>
                      <div v-if="item.film_thickness"><span class="text-muted-foreground">Film Thickness:</span><span class="ml-2">{{ item.film_thickness }}</span></div>
                      <div v-if="item.mol_ratio"><span class="text-muted-foreground">Mol Ratio:</span><span class="ml-2">{{ item.mol_ratio }}</span></div>
                      <div v-if="item.water_content"><span class="text-muted-foreground">Water / Humidity:</span><span class="ml-2">{{ item.water_content }}</span></div>
                      <div v-if="item.cation"><span class="text-muted-foreground">Cation:</span><span class="ml-2">{{ item.cation }}</span></div>
                      <div v-if="item.anion"><span class="text-muted-foreground">Anion:</span><span class="ml-2">{{ item.anion }}</span></div>
                      <div v-if="item.source" class="col-span-2"><span class="text-muted-foreground">Source:</span><span class="ml-2">{{ item.source }}</span></div>
                      <div v-if="item.notes" class="col-span-2"><span class="text-muted-foreground">Notes:</span><span class="ml-2">{{ item.notes }}</span></div>
                    </div>
                  </div>
                </template>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.database-record-table {
  font-size: clamp(14px, 13px + 0.18vw, 16px);
}

.database-record-table .virtual-table-header {
  font-size: clamp(0.72rem, 0.68rem + 0.16vw, 0.84rem);
}

.virtual-table-body {
  -webkit-overflow-scrolling: touch;
}

.workspace-card {
  transition: transform 140ms ease, box-shadow 140ms ease, background-color 140ms ease;
}

.workspace-card:hover {
  transform: translateY(-1px);
}

.column-ruler-label {
  display: inline-flex;
  align-items: center;
  gap: 0.38rem;
  min-height: 1.25rem;
  color: #64748b;
  text-shadow: 0 1px 0 rgba(255, 255, 255, 0.75);
  position: relative;
}

.column-ruler-label::after {
  content: "";
  position: absolute;
  left: 1rem;
  right: 0;
  bottom: -0.42rem;
  height: 1px;
  background: linear-gradient(90deg, rgba(15, 124, 130, 0.34), rgba(148, 163, 184, 0.08));
}

.column-ruler-mark {
  width: 0.42rem;
  height: 0.42rem;
  border-radius: 999px;
  background: #0f7c82;
  box-shadow: 0 0 0 3px rgba(15, 124, 130, 0.1);
}

.column-ruler-label--metric {
  color: #0f7c82;
}
</style>
