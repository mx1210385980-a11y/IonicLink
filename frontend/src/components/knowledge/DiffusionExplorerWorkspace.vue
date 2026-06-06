<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import {
  BookOpen,
  Box,
  Check,
  Download,
  ExternalLink,
  Filter,
  Loader2,
  RefreshCw,
  Search,
  Thermometer,
  X,
} from 'lucide-vue-next'

import {
  approveDiffusionReviewCandidate,
  rejectDiffusionReviewCandidate,
  getDiffusionCandidateEvidence,
  getDiffusionRecordEvidence,
  listDiffusionLibrary,
  type BatchFile,
  type DiffusionLibraryRecord,
  type EvidenceResult,
  type RecordResponse,
} from '@/lib/api'
import LubricantRecipeCell from '@/components/integrated-explorer/LubricantRecipeCell.vue'
import DiffusionReviewSheet from '@/components/knowledge/DiffusionReviewSheet.vue'
import Modal from '@/components/ui/Modal.vue'
import {
  lubricantDisplay,
  lubricantStructureItems,
  type IonStructurePreviewItem,
} from '@/lib/integratedExplorerHelpers'
import { lazyComponent } from '@/lib/lazyComponent'
import type { HighlightRect } from '@/types/pdf-highlight'

const MoleculeViewer = lazyComponent(() => import('@/components/MoleculeViewer.vue'))
const PdfViewerWithHighlight = lazyComponent(() => import('@/components/PdfViewerWithHighlight.vue'))

const props = defineProps<{
  currentSection: string
  selectedFile: BatchFile | null
  selectedFileName: string
  focusFileId?: string | null
  focusDoi?: string
  focusRecordId?: number | null
  focusEntityType?: 'record' | 'candidate' | null
  entityTypeFilter?: 'record' | 'candidate' | null
  recordScope?: 'active' | 'all_visible'
  externalExportRequest?: { id: number, format: 'json' | 'csv' | 'ndjson' } | null
  externalFilterRequestId?: number | null
}>()

const emit = defineEmits<{
  openReview: []
  openLiterature: [payload?: { literatureId?: number | null, recordId?: number | null }]
}>()

const query = ref('')
const ionicLiquidFilter = ref('all')
const materialFilter = ref('all')
const geometryFilter = ref('all')
const showFilters = ref(false)
const loading = ref(false)
const error = ref('')
const reviewActionError = ref('')
const libraryRecords = ref<DiffusionLibraryRecord[]>([])
const librarySummary = ref<Record<string, any>>({})
const pdfLocate = ref<{
  open: boolean
  title: string
  pdfUrl: string
  highlights: HighlightRect[]
  activeHighlightId: string | null
}>({
  open: false,
  title: '',
  pdfUrl: '',
  highlights: [],
  activeHighlightId: null,
})
const structurePreview = ref<{
  open: boolean
  title: string
  items: IonStructurePreviewItem[]
}>({
  open: false,
  title: '',
  items: [],
})

const allRecords = computed(() => libraryRecords.value)
const activeLibraryEntityType = computed<'record' | 'candidate'>(() =>
  props.entityTypeFilter === 'candidate' || props.focusEntityType === 'candidate' ? 'candidate' : 'record',
)
const diffusionLibraryScope = computed<'active' | 'all_visible'>(() =>
  props.recordScope || 'all_visible',
)

const weakOnly = ref(false)

const filteredRecords = computed(() => {
  const normalizedQuery = query.value.trim().toLowerCase()
  return allRecords.value.filter((record) => {
    if (ionicLiquidFilter.value !== 'all' && clean(record.ionic_liquid) !== ionicLiquidFilter.value) return false
    if (materialFilter.value !== 'all' && clean(record.confinement_material_class) !== materialFilter.value) return false
    if (geometryFilter.value !== 'all' && clean(record.confinement_geometry_class) !== geometryFilter.value) return false
    // Triage: show only weak (low-confidence) candidates when requested.
    if (weakOnly.value
      && String(record.reviewEntityType || record.review_entity_type).toLowerCase() === 'candidate'
      && Number((record as any).confidence ?? 1) >= 0.6) return false
    if (!normalizedQuery) return true
    return [
      record.system_name,
      record.ionic_liquid,
      record.confinement_material_class,
      record.confinement_geometry_class,
      record.confinement_dimensionality,
      record.confinement_scale_unit,
      record.source,
      record.evidence,
      record.literatureTitle,
      record.literature_title,
      record.literatureDoi,
      record.literature_doi,
    ].map((item) => String(item || '').toLowerCase()).join(' ').includes(normalizedQuery)
  })
})

const ionicLiquidOptions = computed(() => distinctOptions(allRecords.value.map((record) => record.ionic_liquid)))
const materialOptions = computed(() => distinctOptions(allRecords.value.map((record) => record.confinement_material_class)))
const geometryOptions = computed(() => distinctOptions(allRecords.value.map((record) => record.confinement_geometry_class)))

const finalRecordCount = computed(() =>
  allRecords.value.filter((record) => clean(record.reviewEntityType || record.review_entity_type) === 'record').length,
)
const candidateCount = computed(() =>
  activeLibraryEntityType.value === 'record'
    ? 0
    : Number(librarySummary.value?.candidateCount ?? allRecords.value.length - finalRecordCount.value),
)
const coefficientReadyCount = computed(() => allRecords.value.filter(hasDiffusionCoefficient).length)

// Bulk review: select candidates and approve/reject in one pass ────────────────
const selectedDiffusionCandidateIds = ref<Set<number>>(new Set())
const bulkReviewPending = ref(false)

const selectableCandidateIds = computed(() =>
  filteredRecords.value
    .filter((record) => recordReviewEntityType(record) === 'candidate')
    .map((record) => recordNumericId(record))
    .filter((id): id is number => typeof id === 'number' && id > 0),
)
const selectedDiffusionCandidateCount = computed(() =>
  selectableCandidateIds.value.filter((id) => selectedDiffusionCandidateIds.value.has(id)).length,
)
const allDiffusionCandidatesSelected = computed(() =>
  selectableCandidateIds.value.length > 0 && selectedDiffusionCandidateCount.value === selectableCandidateIds.value.length,
)

function isDiffusionCandidateSelected(record: DiffusionLibraryRecord) {
  const id = recordNumericId(record)
  return Boolean(id && selectedDiffusionCandidateIds.value.has(id))
}
function toggleSelectDiffusionCandidate(record: DiffusionLibraryRecord) {
  const id = recordNumericId(record)
  if (!id) return
  const next = new Set(selectedDiffusionCandidateIds.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selectedDiffusionCandidateIds.value = next
}
function toggleSelectAllDiffusionCandidates(select: boolean) {
  const next = new Set(selectedDiffusionCandidateIds.value)
  for (const id of selectableCandidateIds.value) {
    if (select) next.add(id)
    else next.delete(id)
  }
  selectedDiffusionCandidateIds.value = next
}
function clearDiffusionSelection() {
  selectedDiffusionCandidateIds.value = new Set()
}

// Drop selections for candidates no longer visible (filtered out / refetched).
watch(selectableCandidateIds, (ids) => {
  if (!selectedDiffusionCandidateIds.value.size) return
  const visible = new Set(ids)
  const pruned = new Set(Array.from(selectedDiffusionCandidateIds.value).filter((id) => visible.has(id)))
  if (pruned.size !== selectedDiffusionCandidateIds.value.size) selectedDiffusionCandidateIds.value = pruned
})

async function runBulkDiffusionReview(action: 'approve' | 'reject') {
  const ids = selectableCandidateIds.value.filter((id) => selectedDiffusionCandidateIds.value.has(id))
  if (!ids.length || bulkReviewPending.value) return
  if (!confirm(`${action === 'approve' ? 'Approve' : 'Reject'} ${ids.length} selected diffusion candidate${ids.length === 1 ? '' : 's'}?`)) return
  bulkReviewPending.value = true
  reviewActionError.value = ''
  try {
    for (const id of ids) {
      try {
        if (action === 'approve') await approveDiffusionReviewCandidate(id)
        else await rejectDiffusionReviewCandidate(id)
      } catch (err: any) {
        reviewActionError.value = `Failed to ${action} candidate #${id}: ${err?.response?.data?.detail || err?.message || 'Unknown error'}`
        break
      }
    }
  } finally {
    clearDiffusionSelection()
    bulkReviewPending.value = false
    await loadLibrary()
  }
}

const exportRows = computed(() => filteredRecords.value.map((record) => ({
  id: record.libraryId || record.library_id || record.id,
  ionic_liquid: record.ionic_liquid || '',
  D_total: record.D_total ?? null,
  D_cation: record.D_cation ?? null,
  D_anion: record.D_anion ?? null,
  D_unit: record.D_unit || '',
  confinement_material_class: record.confinement_material_class || '',
  confinement_geometry_class: record.confinement_geometry_class || '',
  confinement_dimensionality: record.confinement_dimensionality || '',
  confinement_scale_value: record.confinement_scale_value ?? null,
  confinement_scale_unit: record.confinement_scale_unit || '',
  temperature_value: record.temperature_value ?? null,
  literature_title: record.literatureTitle || record.literature_title || '',
  literature_doi: record.literatureDoi || record.literature_doi || '',
  source: record.source || '',
  source_page: record.source_page ?? null,
  evidence: record.evidence || '',
  review_entity_type: record.reviewEntityType || record.review_entity_type || '',
})))

watch(
  () => props.externalExportRequest?.id,
  () => {
    if (!props.externalExportRequest) return
    exportData(props.externalExportRequest.format)
  },
)

watch(
  () => props.externalFilterRequestId,
  () => {
    if (props.externalFilterRequestId == null) return
    showFilters.value = true
  },
)

watch(() => [props.focusFileId, props.focusRecordId, props.focusEntityType, props.entityTypeFilter, props.focusDoi], () => {
  void loadLibrary()
})

onMounted(() => {
  void loadLibrary()
})

async function loadLibrary() {
  loading.value = true
  error.value = ''
  try {
    const result = await listDiffusionLibrary('', 0, 1000, {
      literatureId: props.focusFileId || undefined,
      recordId: props.focusRecordId ?? undefined,
      entityType: activeLibraryEntityType.value,
      scope: diffusionLibraryScope.value,
    })
    libraryRecords.value = result.items || []
    librarySummary.value = result.summary || {}
    if (!props.focusFileId && props.focusDoi) {
      query.value = props.focusDoi
    }
  } catch (err: any) {
    error.value = err?.message || 'Failed to load diffusion library.'
  } finally {
    loading.value = false
  }
}

// Diffusion review sheet: evidence-first verify before approve/reject ──────────
const reviewSheetRecord = ref<DiffusionLibraryRecord | null>(null)
const reviewSheetNextRecord = computed(() => {
  const current = reviewSheetRecord.value
  if (!current) return null
  const candidates = filteredRecords.value.filter((record) => recordReviewEntityType(record) === 'candidate')
  const currentId = recordNumericId(current)
  const index = candidates.findIndex((record) => recordNumericId(record) === currentId)
  if (index < 0) return null
  return candidates[index + 1] || null
})

function openDiffusionReviewSheet(record: DiffusionLibraryRecord) {
  if (recordReviewEntityType(record) !== 'candidate') return
  reviewSheetRecord.value = record
}

function openNextDiffusionReviewSheet() {
  if (!reviewSheetNextRecord.value) return
  reviewSheetRecord.value = reviewSheetNextRecord.value
}

async function handleDiffusionReviewResolved() {
  // Capture the next candidate before refetch so the sheet advances in place.
  const next = reviewSheetNextRecord.value
  reviewSheetRecord.value = next ?? null
  await loadLibrary()
}

function clean(value: unknown) {
  return String(value ?? '').trim()
}

function distinctOptions(values: unknown[]) {
  return ['all', ...new Set(values.map(clean).filter(Boolean).sort((a, b) => a.localeCompare(b)))].slice(0, 60)
}

function hasDiffusionCoefficient(record: DiffusionLibraryRecord) {
  return [record.D_total, record.D_cation, record.D_anion].some((value) => value !== null && value !== undefined)
}

function formatNumber(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === '') return '--'
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return String(value)
  return `${numeric.toPrecision(4)}`.replace(/\.?0+e/, 'e').replace(/\.?0+$/, '')
}

function formatDiffusionValue(value: number | string | null | undefined, unit: string | null | undefined) {
  const formatted = formatNumber(value)
  if (formatted === '--') return '--'
  return unit ? `${formatted} ${unit}` : formatted
}

function layerDiffusionRows(record: DiffusionLibraryRecord) {
  const features =
    (record as any).novel_features_json
    ?? (record as any).novelFeaturesJson
    ?? {}
  const rows = Array.isArray(features?.layer_diffusion_coefficients)
    ? features.layer_diffusion_coefficients
    : []

  return rows
    .map((row: Record<string, any>) => ({
      layer: clean(row.layer),
      D_cation: row.D_cation ?? row.d_cation ?? null,
      D_anion: row.D_anion ?? row.d_anion ?? null,
      unit: clean(row.unit) || record.D_unit || null,
    }))
    .filter((row: { layer: string, D_cation: unknown, D_anion: unknown }) =>
      row.layer && (row.D_cation !== null || row.D_anion !== null),
    )
}

function coefficientTone(kind: 'total' | 'cation' | 'anion') {
  if (kind === 'total') return 'border-[#86e7ef] bg-[#effeff] text-[#0b7280]'
  if (kind === 'cation') return 'border-sky-200 bg-sky-50 text-sky-700'
  return 'border-emerald-200 bg-emerald-50 text-emerald-700'
}

function formatTemperature(record: DiffusionLibraryRecord) {
  return record.temperature_value != null ? `${formatNumber(record.temperature_value)} K` : '--'
}

function formatScale(record: DiffusionLibraryRecord) {
  if (record.confinement_scale_value == null) return ''
  return `${formatNumber(record.confinement_scale_value)}${record.confinement_scale_unit ? ` ${record.confinement_scale_unit}` : ''}`
}

function literatureTitle(record: DiffusionLibraryRecord) {
  return clean(record.literatureTitle || record.literature_title) || 'Untitled literature'
}

function literatureMeta(record: DiffusionLibraryRecord) {
  const literature = record.literature || {}
  return [
    clean(record.literatureDoi || record.literature_doi || literature.doi),
    clean(literature.journal),
    clean(literature.year),
  ].filter(Boolean).join(' · ') || clean(record.source) || 'No source'
}

function recordBadge(record: DiffusionLibraryRecord) {
  return clean(record.reviewEntityType || record.review_entity_type) === 'record' ? 'Library' : 'Candidate'
}

function isFocusedDiffusionRecord(record: DiffusionLibraryRecord) {
  const targetEntityType = String(props.focusEntityType || '').trim().toLowerCase()
  const recordEntityType = String(record.reviewEntityType || record.review_entity_type || 'record').trim().toLowerCase()
  return props.focusRecordId != null
    && Number(record.id) === Number(props.focusRecordId)
    && (!targetEntityType || recordEntityType === targetEntityType)
}

function diffusionRecipeRecord(record: DiffusionLibraryRecord): RecordResponse {
  const ionicLiquid = clean(record.ionic_liquid)
  const base = record as any
  return {
    ...base,
    lubricant: base.lubricant || ionicLiquid,
    ionicLiquidDisplay: base.ionicLiquidDisplay || base.ionic_liquid_display || ionicLiquid,
    cation: base.cation || base.cation_raw || '',
    anion: base.anion || base.anion_raw || '',
    cationSmiles: base.cationSmiles || base.cation_smiles || null,
    anionSmiles: base.anionSmiles || base.anion_smiles || null,
  } as RecordResponse
}

function openStructurePreview(record: RecordResponse) {
  structurePreview.value = {
    open: true,
    title: lubricantDisplay(record),
    items: lubricantStructureItems(record),
  }
}

function closeStructurePreview() {
  structurePreview.value.open = false
  structurePreview.value.title = ''
  structurePreview.value.items = []
}

function numericId(value: unknown) {
  const numeric = Number(value)
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null
}

function recordNumericId(record: DiffusionLibraryRecord) {
  return numericId(record.id)
    ?? numericId(String(record.libraryId || record.library_id || '').split(':').pop())
}

function recordLiteratureId(record: DiffusionLibraryRecord) {
  return numericId(record.literatureId)
    ?? numericId(record.literature_id)
    ?? numericId(record.literature?.id)
}

function recordSourcePage(record: DiffusionLibraryRecord) {
  return numericId(record.source_page)
    ?? numericId((record as any).sourcePage)
    ?? numericId((record as any).evidencePage)
    ?? 1
}

function recordReviewEntityType(record: DiffusionLibraryRecord) {
  return clean(record.reviewEntityType || record.review_entity_type).toLowerCase() === 'candidate'
    ? 'candidate'
    : 'record'
}

function parseRecordBbox(record: DiffusionLibraryRecord) {
  const raw = record.source_bbox ?? (record as any).sourceBbox ?? (record as any).evidenceBbox
  if (Array.isArray(raw)) return raw
  if (typeof raw !== 'string' || !raw.trim()) return null
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : null
  } catch {
    return raw
      .split(',')
      .map((part) => Number(part.trim()))
      .filter((value) => Number.isFinite(value))
  }
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
  if (![a, b, c, d].every((value) => Number.isFinite(value))) return null

  const left = Math.min(a, c)
  const top = Math.min(b, d)
  const right = Math.max(a, c)
  const bottom = Math.max(b, d)
  const padX = 6
  const padY = 8
  const minWidth = 96
  const minHeight = 32
  const width = Math.max(minWidth, right - left + padX * 2)
  const height = Math.max(minHeight, bottom - top + padY * 2)
  const centerX = (left + right) / 2
  const centerY = (top + bottom) / 2
  return {
    id,
    page: Math.max(1, Math.floor(Number(page) || 1)),
    color,
    coords: {
      x: Math.max(0, centerX - width / 2),
      y: Math.max(0, centerY - height / 2),
      w: width,
      h: height,
    },
  }
}

function buildPageAnchorHighlight(id: string, page: number, color?: string): HighlightRect {
  return {
    id,
    page: Math.max(1, Math.floor(Number(page) || 1)),
    color,
    coords: { x: 36, y: 36, w: 220, h: 46 },
  }
}

function evidenceBbox(evidence: EvidenceResult | null) {
  return Array.isArray(evidence?.bbox) && evidence.bbox.length >= 4
    ? evidence.bbox
    : null
}

async function loadRecordEvidence(record: DiffusionLibraryRecord, literatureId: number, recordId: number) {
  try {
    return recordReviewEntityType(record) === 'candidate'
      ? await getDiffusionCandidateEvidence(literatureId, recordId)
      : await getDiffusionRecordEvidence(literatureId, recordId)
  } catch (err) {
    console.warn('[DiffusionExplorer] Failed to load source-grounded evidence:', err)
    return null
  }
}

async function openRecordPdf(record: DiffusionLibraryRecord) {
  const literatureId = recordLiteratureId(record)
  const recordId = recordNumericId(record)
  if (!literatureId) {
    emit('openLiterature', {
      literatureId,
      recordId,
    })
    return
  }

  const evidence = recordId ? await loadRecordEvidence(record, literatureId, recordId) : null
  const page = numericId(evidence?.page) ?? recordSourcePage(record)
  const bbox = evidence ? evidenceBbox(evidence) : parseRecordBbox(record)
  const highlight =
    buildHighlightRect(`diffusion-${recordId || 'record'}-${Date.now()}`, page, bbox, 'rgba(250, 204, 21, 0.35)')
    || buildPageAnchorHighlight(`diffusion-page-${page}-${Date.now()}`, page, 'rgba(250, 204, 21, 0.35)')

  pdfLocate.value.open = true
  pdfLocate.value.title = `${literatureTitle(record)} · Page ${page}`
  pdfLocate.value.pdfUrl = `/api/pdf/${literatureId}`
  pdfLocate.value.highlights = [highlight]
  pdfLocate.value.activeHighlightId = highlight.id
}

function closePdfLocate() {
  pdfLocate.value.open = false
  pdfLocate.value.title = ''
  pdfLocate.value.pdfUrl = ''
  pdfLocate.value.highlights = []
  pdfLocate.value.activeHighlightId = null
}

function onPdfLocateHighlightClick(id: string) {
  pdfLocate.value.activeHighlightId = id
}

function resetFilters() {
  query.value = ''
  ionicLiquidFilter.value = 'all'
  materialFilter.value = 'all'
  geometryFilter.value = 'all'
}

function triggerDownload(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

function toCsv(rows: Array<Record<string, unknown>>) {
  if (!rows.length) return ''
  const headers = Object.keys(rows[0] || {})
  const escapeCell = (value: unknown) => {
    const text = String(value ?? '')
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
  }
  return [
    headers.join(','),
    ...rows.map((row) => headers.map((header) => escapeCell(row[header])).join(',')),
  ].join('\n')
}

function exportData(format: 'json' | 'csv' | 'ndjson') {
  const baseName = 'diffusion-library'
  if (format === 'json') {
    triggerDownload(`${baseName}.json`, JSON.stringify(exportRows.value, null, 2), 'application/json')
    return
  }
  if (format === 'ndjson') {
    triggerDownload(
      `${baseName}.ndjson`,
      exportRows.value.map((row) => JSON.stringify(row)).join('\n'),
      'application/x-ndjson',
    )
    return
  }
  triggerDownload(`${baseName}.csv`, toCsv(exportRows.value), 'text/csv;charset=utf-8')
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col bg-white">
    <div class="shrink-0 border-b border-slate-100 px-5 py-4">
      <div class="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div class="min-w-0">
          <p class="text-[11px] font-black uppercase tracking-[0.24em] text-[#0f7c82]">Diffusion Library</p>
          <h2 class="mt-1 text-[1.35rem] font-black tracking-[-0.04em] text-slate-950">Ionic liquid diffusion coefficient</h2>
          <div class="mt-2 flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-500">
            <span class="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 font-black text-slate-700">
              {{ activeLibraryEntityType === 'candidate' ? 'Review Queue' : 'Official Database' }}
            </span>
            <span>
              {{ activeLibraryEntityType === 'candidate'
                ? 'Diffusion candidates waiting for review.'
                : 'Approved diffusion records only.' }}
            </span>
          </div>
        </div>

        <div class="grid grid-cols-3 gap-2 rounded-xl border border-slate-200 bg-[#f8fbfd] p-1.5 text-center">
          <div class="rounded-lg bg-white px-3 py-2 shadow-sm">
            <p class="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Library</p>
            <p class="text-lg font-black text-[#0f7c82]">{{ finalRecordCount }}</p>
          </div>
          <div class="rounded-lg px-3 py-2">
            <p class="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Candidate</p>
            <p class="text-lg font-black text-slate-800">{{ candidateCount }}</p>
          </div>
          <div class="rounded-lg px-3 py-2">
            <p class="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">D-ready</p>
            <p class="text-lg font-black text-slate-800">{{ coefficientReadyCount }}</p>
          </div>
        </div>
      </div>

      <div v-if="activeLibraryEntityType === 'candidate'" class="mt-3 flex flex-wrap items-center gap-2 text-xs font-semibold" data-testid="diffusion-triage">
        <button
          type="button"
          class="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 transition"
          :class="weakOnly ? 'border-amber-300 bg-amber-50 text-amber-700' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'"
          @click="weakOnly = !weakOnly"
        >
          Weak only
        </button>
        <div class="ml-auto flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2 py-1">
          <button
            type="button"
            class="rounded-md px-2 py-1 font-black text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
            @click="toggleSelectAllDiffusionCandidates(!allDiffusionCandidatesSelected)"
          >
            {{ allDiffusionCandidatesSelected ? 'Clear page' : 'Select page' }}
          </button>
          <span class="px-1 font-black text-slate-500">Selected {{ selectedDiffusionCandidateCount }}</span>
          <button
            type="button"
            class="inline-flex h-8 items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-3 font-black text-emerald-600 transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-45"
            :disabled="selectedDiffusionCandidateCount === 0 || bulkReviewPending"
            @click="runBulkDiffusionReview('approve')"
          >
            <Check class="h-3.5 w-3.5 stroke-[3]" />
            <span v-if="bulkReviewPending">Working...</span>
            <span v-else>Approve selected</span>
          </button>
          <button
            type="button"
            class="inline-flex h-8 items-center gap-1.5 rounded-md border border-rose-200 bg-rose-50 px-3 font-black text-rose-500 transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-45"
            :disabled="selectedDiffusionCandidateCount === 0 || bulkReviewPending"
            @click="runBulkDiffusionReview('reject')"
          >
            <X class="h-3.5 w-3.5" />
            Reject selected
          </button>
        </div>
      </div>

      <div class="mt-4 flex flex-col gap-2 lg:flex-row lg:items-center">
        <label class="relative min-w-0 flex-1">
          <Search class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            v-model="query"
            type="text"
            class="h-10 w-full rounded-lg border border-[#d9e2ef] bg-white pl-10 pr-3 text-sm font-semibold text-slate-700 outline-none transition placeholder:text-slate-400 focus:border-[#93e7e8] focus:ring-4 focus:ring-[#dffafb]"
            placeholder="Search IL, confinement, paper..."
          >
        </label>
        <button
          type="button"
          class="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-black text-slate-700 transition hover:border-[#93e7e8] hover:text-[#0f7c82]"
          @click="showFilters = !showFilters"
        >
          <Filter class="h-4 w-4" />
          Filters
        </button>
        <button
          type="button"
          class="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-black text-slate-700 transition hover:border-[#93e7e8] hover:text-[#0f7c82]"
          :disabled="loading"
          @click="loadLibrary"
        >
          <RefreshCw class="h-4 w-4" :class="loading ? 'animate-spin' : ''" />
          Refresh
        </button>
        <button
          type="button"
          class="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-[#0f7c82] px-3 text-sm font-black text-white transition hover:bg-[#0b6870]"
          @click="exportData('csv')"
        >
          <Download class="h-4 w-4" />
          CSV
        </button>
      </div>

      <div
        v-if="showFilters"
        class="mt-3 grid gap-2 rounded-xl border border-slate-200 bg-[#fbfdff] p-3 lg:grid-cols-[1fr_1fr_1fr_auto]"
      >
        <select v-model="ionicLiquidFilter" class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 outline-none">
          <option value="all">All ionic liquids</option>
          <option v-for="item in ionicLiquidOptions.filter((value) => value !== 'all')" :key="item" :value="item">{{ item }}</option>
        </select>
        <select v-model="materialFilter" class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 outline-none">
          <option value="all">All materials</option>
          <option v-for="item in materialOptions.filter((value) => value !== 'all')" :key="item" :value="item">{{ item }}</option>
        </select>
        <select v-model="geometryFilter" class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 outline-none">
          <option value="all">All geometries</option>
          <option v-for="item in geometryOptions.filter((value) => value !== 'all')" :key="item" :value="item">{{ item }}</option>
        </select>
        <button
          type="button"
          class="inline-flex h-10 items-center justify-center gap-1 rounded-lg px-3 text-sm font-black text-slate-500 transition hover:bg-white hover:text-slate-900"
          @click="resetFilters"
        >
          <X class="h-4 w-4" />
          Clear
        </button>
      </div>
      <p
        v-if="reviewActionError"
        class="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700"
      >
        {{ reviewActionError }}
      </p>
    </div>

    <div class="min-h-0 flex-1 overflow-auto px-5 py-4">
      <div v-if="loading" class="flex h-full min-h-[18rem] items-center justify-center text-sm font-bold text-slate-500">
        <Loader2 class="mr-2 h-4 w-4 animate-spin" />
        Loading diffusion library...
      </div>

      <div v-else-if="error" class="flex h-full min-h-[18rem] items-center justify-center rounded-xl border border-rose-100 bg-rose-50 text-sm font-bold text-rose-600">
        {{ error }}
      </div>

      <div v-else-if="filteredRecords.length" class="overflow-hidden rounded-2xl border border-[#dce6f2] bg-white shadow-[0_18px_50px_-42px_rgba(15,23,42,0.7)]">
        <div class="diffusion-legend flex flex-wrap items-center justify-end gap-2 border-b border-slate-100 bg-white px-5 py-2.5 text-[11px] font-black text-slate-500">
          <span class="mr-auto hidden uppercase tracking-[0.2em] text-slate-400 md:inline">Legend</span>
          <span class="inline-flex items-center gap-1.5 rounded-full bg-slate-50 px-2.5 py-1">
            <Thermometer class="h-3.5 w-3.5 text-slate-400" />
            Temperature
          </span>
          <span class="inline-flex items-center gap-1.5 rounded-full bg-[#f2ffff] px-2.5 py-1 text-[#0f7c82]">
            <span class="font-black italic">D</span>
            Confinement scale
          </span>
          <span class="inline-flex items-center gap-1.5 rounded-full bg-[#effeff] px-2.5 py-1 text-[#0b7280]">
            Dtot / D+ / D-
          </span>
        </div>
        <table class="min-w-[1320px] table-fixed text-left">
          <thead class="bg-[#f8fbfd] text-[12px] font-black uppercase tracking-[0.2em] text-slate-500">
            <tr>
              <th class="w-[31%] px-5 py-4">Ionic Liquid</th>
              <th class="w-[23%] px-5 py-4">Diffusion System</th>
              <th class="w-[12%] px-5 py-4">Environment</th>
              <th class="w-[18%] px-5 py-4 text-[#0f7c82]">Diffusion Coefficient</th>
              <th class="w-[16%] px-5 py-4">Literature</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100">
            <tr
              v-for="record in filteredRecords"
              :key="record.libraryId || record.library_id || record.id"
              class="align-middle transition hover:bg-[#f7fcfc]"
              :class="isFocusedDiffusionRecord(record) ? 'bg-[#f2ffff] ring-2 ring-inset ring-[#63dce6]' : ''"
            >
              <td class="px-5 py-4">
                <div class="min-w-[23rem] max-w-[29rem]">
                  <LubricantRecipeCell
                    :record="diffusionRecipeRecord(record)"
                    @open-structure="openStructurePreview"
                  />
                  <p class="mt-1 ml-[2.45rem] text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">{{ recordBadge(record) }}</p>
                </div>
              </td>

              <td class="px-5 py-4">
                <div class="rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm">
                  <div class="flex items-center gap-2">
                    <Box class="h-4 w-4 text-[#0f7c82]" />
                    <p class="truncate text-sm font-black text-slate-950">{{ record.system_name || 'Confinement system' }}</p>
                  </div>
                  <div class="mt-2 flex flex-wrap gap-1.5">
                    <span class="rounded-md bg-slate-100 px-2 py-1 text-[11px] font-black text-slate-600">{{ record.confinement_material_class || 'Material N/A' }}</span>
                    <span class="rounded-md bg-[#effafa] px-2 py-1 text-[11px] font-black text-[#0f7c82]">{{ record.confinement_geometry_class || 'Geometry N/A' }}</span>
                    <span v-if="record.confinement_dimensionality" class="rounded-md bg-slate-50 px-2 py-1 text-[11px] font-black text-slate-500">{{ record.confinement_dimensionality }}</span>
                  </div>
                </div>
              </td>

              <td class="px-5 py-4">
                <div class="flex flex-wrap gap-2">
                  <span class="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm font-black text-slate-700">
                    <Thermometer class="h-4 w-4 text-slate-400" />
                    {{ formatTemperature(record) }}
                  </span>
                  <span v-if="formatScale(record)" class="inline-flex items-center gap-1.5 rounded-lg border border-[#d9f4f5] bg-[#f2ffff] px-2.5 py-1.5 text-sm font-black text-[#0f7c82]">
                    <span class="font-black italic">D</span>
                    {{ formatScale(record) }}
                  </span>
                </div>
              </td>

              <td class="px-5 py-4">
                <div class="grid gap-1.5">
                  <div
                    v-if="record.D_total !== null && record.D_total !== undefined"
                    class="rounded-xl border px-3 py-2"
                    :class="coefficientTone('total')"
                  >
                    <div class="flex items-baseline justify-between gap-2">
                      <span class="text-[12px] font-black uppercase tracking-[0.18em]">Dtot</span>
                      <span class="truncate text-[1rem] font-black">{{ formatDiffusionValue(record.D_total, record.D_unit) }}</span>
                    </div>
                  </div>
                  <div class="grid grid-cols-2 gap-1.5">
                    <div class="rounded-lg border px-2.5 py-1.5" :class="coefficientTone('cation')">
                      <span class="mr-1 text-[11px] font-black uppercase tracking-[0.12em]">D+</span>
                      <span class="text-sm font-black">{{ formatDiffusionValue(record.D_cation, record.D_unit) }}</span>
                    </div>
                    <div class="rounded-lg border px-2.5 py-1.5" :class="coefficientTone('anion')">
                      <span class="mr-1 text-[11px] font-black uppercase tracking-[0.12em]">D-</span>
                      <span class="text-sm font-black">{{ formatDiffusionValue(record.D_anion, record.D_unit) }}</span>
                    </div>
                  </div>
                  <div
                    v-if="layerDiffusionRows(record).length"
                    class="grid gap-1 rounded-lg border border-slate-200 bg-slate-50/80 px-2.5 py-2"
                  >
                    <div
                      v-for="layer in layerDiffusionRows(record)"
                      :key="layer.layer"
                      class="flex items-center justify-between gap-2 text-[11px] font-black text-slate-600"
                    >
                      <span class="shrink-0 uppercase tracking-[0.14em] text-slate-400">Layer {{ layer.layer }}</span>
                      <span class="min-w-0 truncate tabular-nums text-slate-800">
                        D+ {{ formatDiffusionValue(layer.D_cation, layer.unit || record.D_unit) }}
                        · D- {{ formatDiffusionValue(layer.D_anion, layer.unit || record.D_unit) }}
                      </span>
                    </div>
                  </div>
                </div>
              </td>

              <td class="px-5 py-4">
                <button
                  type="button"
                  class="group flex max-w-full items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-left shadow-sm transition hover:border-[#93e7e8]"
                  @click="openRecordPdf(record)"
                >
                  <BookOpen class="h-4 w-4 shrink-0 text-[#0f7c82]" />
                  <span class="min-w-0">
                    <span class="block truncate text-sm font-black text-slate-900 group-hover:text-[#0f7c82]">{{ literatureTitle(record) }}</span>
                    <span class="block truncate text-xs font-bold text-slate-500">{{ literatureMeta(record) }}</span>
                  </span>
                  <ExternalLink class="h-3.5 w-3.5 shrink-0 text-slate-300 group-hover:text-[#0f7c82]" />
                </button>
                <div v-if="recordReviewEntityType(record) === 'candidate'" class="mt-2 flex items-center gap-2">
                  <button
                    type="button"
                    class="grid h-8 w-8 shrink-0 place-items-center rounded-md border transition"
                    :class="isDiffusionCandidateSelected(record) ? 'border-[#0f7c82] bg-[#0f7c82] text-white' : 'border-slate-300 bg-white text-transparent hover:border-[#0f7c82]'"
                    :aria-pressed="isDiffusionCandidateSelected(record)"
                    title="Select candidate for bulk review"
                    aria-label="Select candidate"
                    @click.stop="toggleSelectDiffusionCandidate(record)"
                  >
                    <Check class="h-4 w-4 stroke-[3]" />
                  </button>
                  <button
                    type="button"
                    class="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-[#0f7c82]/25 bg-[#eefafa] px-3 text-xs font-black text-[#0f7c82] transition hover:border-[#0f7c82]/45 hover:bg-white"
                    title="Review this candidate's evidence before approving"
                    aria-label="Review candidate"
                    @click.stop="openDiffusionReviewSheet(record)"
                  >
                    <Check class="h-3.5 w-3.5 stroke-[3]" />
                    Review
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div
        v-else
        class="flex h-full min-h-[18rem] items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white/70 px-6 text-center text-sm font-bold text-slate-500"
      >
        No diffusion records match the current view.
      </div>
    </div>

    <Modal :show="pdfLocate.open" max-width="full" @close="closePdfLocate">
      <template #header>
        <div class="flex min-w-0 items-center justify-between gap-4">
          <span class="truncate text-base font-black text-slate-900">{{ pdfLocate.title || 'Diffusion Source Locator' }}</span>
        </div>
      </template>

      <div class="h-[78vh] min-h-[520px]">
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
        <div class="flex min-w-0 items-center justify-between gap-4">
          <span class="truncate text-base font-black text-slate-900">Chemical Structure · {{ structurePreview.title || 'Ionic liquid' }}</span>
        </div>
      </template>

      <div class="grid gap-4 md:grid-cols-2">
        <div
          v-for="item in structurePreview.items"
          :key="item.key"
          class="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
        >
          <p class="mb-3 text-[11px] font-black uppercase tracking-[0.18em] text-[#0f7c82]">{{ item.role }}</p>
          <MoleculeViewer :smiles="item.smiles" size="full" :width="360" :height="220" />
          <p class="mt-3 text-sm font-black text-slate-900">{{ item.label }}</p>
        </div>
        <div v-if="!structurePreview.items.length" class="rounded-xl border border-dashed border-slate-200 p-6 text-sm font-bold text-slate-500">
          No chemical structure is available for this diffusion record.
        </div>
      </div>
    </Modal>

    <DiffusionReviewSheet
      :show="Boolean(reviewSheetRecord)"
      :record="reviewSheetRecord"
      :next-record="reviewSheetNextRecord"
      :has-next-candidate="Boolean(reviewSheetNextRecord)"
      @close="reviewSheetRecord = null"
      @next-candidate="openNextDiffusionReviewSheet"
      @approved="handleDiffusionReviewResolved"
      @rejected="handleDiffusionReviewResolved"
    />
  </div>
</template>
