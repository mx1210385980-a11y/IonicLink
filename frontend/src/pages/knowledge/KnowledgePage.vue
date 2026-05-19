<script setup lang="ts">
import { computed, onMounted, ref, watch, type Component } from 'vue'
import { Atom, Gauge, GitBranch, TimerReset, Zap } from 'lucide-vue-next'

import KnowledgeContextPanel from '@/components/knowledge/KnowledgeContextPanel.vue'
import KnowledgeSidebar from '@/components/knowledge/KnowledgeSidebar.vue'
import { backfillLiteratureMetadata, listDiffusionLibrary, listLiterature, searchRecords, type Literature, type SearchFilter } from '@/lib/api'
import { lazyComponent } from '@/lib/lazyComponent'

const props = defineProps<{
  currentSection: string
  activeScopeLabel: string
  operatorName: string
  selectedFileName: string
  explorerDoi: string
  selectedFile: any | null
  selectedFileId: string | null
  focusRecordId?: number | null
  scopeKey?: string | null
}>()

const emit = defineEmits<{
  'change-section': [section: string]
  'open-training': [datasetId: number | null]
  'open-review': [payload?: { literatureId?: number | null, recordId?: number | null, mode?: 'training-blockers' | null }]
  'select-source': [fileId: string | null]
  'clear-doi': []
  'clear-source': []
  'clear-focused-record': []
}>()

const DataCleaningWorkbench = lazyComponent(() => import('@/components/DataCleaningWorkbench.vue'))
const DiffusionExplorerWorkspace = lazyComponent(() => import('@/components/knowledge/DiffusionExplorerWorkspace.vue'))
const IntegratedExplorer = lazyComponent(() => import('@/components/IntegratedExplorer.vue'))
const KnowledgeDataSnapshot = lazyComponent(() => import('@/components/knowledge/KnowledgeDataSnapshot.vue'))
const KnowledgePatternDiscovery = lazyComponent(() => import('@/components/knowledge/KnowledgePatternDiscovery.vue'))
const LiteratureSourceAtlas = lazyComponent(() => import('@/components/knowledge/LiteratureSourceAtlas.vue'))
const RelationshipGraphPanel = lazyComponent(() => import('@/components/RelationshipGraphPanel.vue'))

type KnowledgeLibraryKey = 'tribology_macro' | 'tribology_nano' | 'conductivity' | 'diffusion'
type LibraryTone = 'macro' | 'nano' | 'conductivity' | 'diffusion'

interface KnowledgeLibrary {
  key: KnowledgeLibraryKey
  title: string
  label: string
  subtitle: string
  detail: string
  status: 'ready' | 'reserved'
  statusLabel: string
  count: number | null
  experimentScale?: 'macroscale' | 'nanoscale'
  icon: Component
  tone: LibraryTone
}

const LITERATURE_LIST_LIMIT = 1000
const exportRequestId = ref(0)
const externalExportRequest = ref<{ id: number, format: 'json' | 'csv' | 'ndjson' } | null>(null)
const scopeLiterature = ref<Literature[]>([])
const literatureLoading = ref(false)
const literatureError = ref('')
const activeKnowledgeLibraryKey = ref<KnowledgeLibraryKey>('tribology_macro')
const knowledgeLibraryCounts = ref<{ macro: number | null; nano: number | null; diffusion: number | null }>({
  macro: null,
  nano: null,
  diffusion: null,
})
const metadataBackfillAttempted = new Set<number>()
const metadataBackfillInFlight = new Set<number>()

const isDiffusionScope = computed(() => {
  const extractorType = props.selectedFile?.extractor_type
  if (extractorType === 'diffusion') return true
  const records = props.selectedFile?.records || []
  return records.some((record: any) => {
    return Boolean(String(record?.system_name || '').trim())
      || record?.D_total != null
      || record?.D_cation != null
      || record?.D_anion != null
  })
})

const effectiveKnowledgeLibraryKey = computed<KnowledgeLibraryKey>(() => {
  return isDiffusionScope.value ? 'diffusion' : activeKnowledgeLibraryKey.value
})

const knowledgeLibraries = computed<KnowledgeLibrary[]>(() => [
  {
    key: 'tribology_macro',
    title: '宏观摩擦库',
    label: 'Macro Tribology',
    subtitle: '球盘、四球、销盘等宏观摩擦实验',
    detail: '用于配方性能对比、COF 区间筛选和宏观工况建模。',
    status: 'ready',
    statusLabel: '已接入',
    count: knowledgeLibraryCounts.value.macro,
    experimentScale: 'macroscale',
    icon: Gauge,
    tone: 'macro',
  },
  {
    key: 'tribology_nano',
    title: '纳米摩擦库',
    label: 'Nano / AFM Tribology',
    subtitle: 'AFM、SFA、纳米摩擦和表面力实验',
    detail: '用于界面结构、层化、探针-基底响应和纳米尺度规律归纳。',
    status: 'ready',
    statusLabel: '已接入',
    count: knowledgeLibraryCounts.value.nano,
    experimentScale: 'nanoscale',
    icon: Atom,
    tone: 'nano',
  },
  {
    key: 'conductivity',
    title: '电导库',
    label: 'Conductivity',
    subtitle: '电导率、离子迁移数和温度依赖',
    detail: '先预留入口，后续接入电化学/输运抽取器和专属字段。',
    status: 'reserved',
    statusLabel: '预留',
    count: null,
    icon: Zap,
    tone: 'conductivity',
  },
  {
    key: 'diffusion',
    title: '扩散库',
    label: 'Diffusion',
    subtitle: '扩散系数、限域输运和分子动力学数据',
    detail: '已接入全局扩散数据库，汇总已入库记录和待审阅候选记录。',
    status: 'ready',
    statusLabel: '已接入',
    count: knowledgeLibraryCounts.value.diffusion,
    icon: GitBranch,
    tone: 'diffusion',
  },
])

const activeKnowledgeLibrary = computed(() => {
  return knowledgeLibraries.value.find((library) => library.key === effectiveKnowledgeLibraryKey.value)
    || knowledgeLibraries.value[0]!
})

const isReservedKnowledgeLibrary = computed(() => {
  return activeKnowledgeLibrary.value.status === 'reserved'
})

const activeKnowledgeScale = computed(() => {
  if (isReservedKnowledgeLibrary.value || isDiffusionScope.value) return ''
  return activeKnowledgeLibrary.value.experimentScale || ''
})

const activeKnowledgeFilter = computed<SearchFilter>(() => {
  const filter: SearchFilter = {}
  if (activeKnowledgeScale.value) {
    filter.experiment_scales = [activeKnowledgeScale.value]
  }
  return filter
})

const activeGraphRefreshKey = computed(() => {
  if (activeKnowledgeLibrary.value.key === 'tribology_macro') return 1
  if (activeKnowledgeLibrary.value.key === 'tribology_nano') return 2
  return 0
})

const activeKnowledgeScopeLabel = computed(() => {
  return `${props.activeScopeLabel} / ${activeKnowledgeLibrary.value.title}`
})

const selectedLiterature = computed(() => {
  const selectedId = String(props.selectedFileId || '')
  if (!selectedId) return null
  return scopeLiterature.value.find((item) => String(item.id) === selectedId) || null
})

const selectedRecordCount = computed(() => {
  if (activeKnowledgeLibrary.value.key === 'diffusion' && !props.selectedFile?.records?.length) {
    return knowledgeLibraryCounts.value.diffusion || 0
  }
  if (props.selectedFile?.records?.length) return props.selectedFile.records.length
  if (selectedLiterature.value) {
    return Number(selectedLiterature.value.recordCount || selectedLiterature.value.candidateCount || 0)
  }
  return 0
})
const qualityIssueCount = computed(() => {
  const records = props.selectedFile?.records || []
  if (isDiffusionScope.value) {
    return records.filter((record: any) => {
      const validationWarning = record.validationStatus === 'warning'
      const missingCore = !String(record.system_name || '').trim()
        || !String(record.ionic_liquid || '').trim()
        || ![record.D_total, record.D_cation, record.D_anion].some((value: unknown) => value !== null && value !== undefined)
      const missingEvidence = !record.source_page && !String(record.source || record.evidence || '').trim()
      return validationWarning || missingCore || missingEvidence
    }).length
  }
  return records.filter((record: any) => {
    const validationWarning = record.validationStatus === 'warning'
    const missingCore = !String(record.material_name || '').trim()
      || !String(record.ionic_liquid || '').trim()
      || !String(record.cof || '').trim()
    const missingEvidence = !record.source_page && !String(record.source_figure || '').trim() && !String(record.evidence || record.notes || record.source || '').trim()
    return validationWarning || missingCore || missingEvidence
  }).length
})

const sidebarModes = computed(() => [
  { key: 'explorer', label: 'Data Grid', count: selectedRecordCount.value || undefined },
  { key: 'snapshots', label: 'Data Snapshot' },
  { key: 'insights', label: 'Pattern Discovery' },
  { key: 'sources', label: 'Source Atlas', count: scopeLiterature.value.length || undefined },
  { key: 'graph', label: 'Graph View' },
  { key: 'datasets', label: 'Dataset Workflow', count: qualityIssueCount.value || undefined },
])

const sourceLabel = computed(() => {
  if (activeKnowledgeLibrary.value.key === 'diffusion' && !selectedLiterature.value) {
    return '全局扩散库'
  }
  if (selectedLiterature.value) {
    return selectedLiterature.value.title || selectedLiterature.value.doi || `Literature ${selectedLiterature.value.id}`
  }
  return props.selectedFileName || activeKnowledgeLibrary.value.title || 'Scope Library'
})
const modeMeta = computed<{ label: string }>(() => {
  const modes: Record<string, { label: string }> = {
    explorer: { label: 'Data Grid' },
    snapshots: { label: 'Data Snapshot' },
    insights: { label: 'Pattern Discovery' },
    sources: { label: 'Source Atlas' },
    graph: { label: isDiffusionScope.value ? 'Evidence View' : 'Graph View' },
    cleaning: { label: 'Dataset Workflow' },
    datasets: { label: 'Dataset Workflow' },
  }
  return modes[props.currentSection] ?? modes.explorer!
})

function requestExport(format: 'json' | 'csv' | 'ndjson') {
  exportRequestId.value += 1
  externalExportRequest.value = {
    id: exportRequestId.value,
    format,
  }
}

function hasMetadataText(value: unknown) {
  const text = String(value || '').trim()
  return Boolean(text && !['-', '--', 'n/a', 'na', 'none', 'null', 'unknown', 'untitled'].includes(text.toLowerCase()))
}

function isTemporaryIdentifier(value: unknown) {
  const text = String(value || '').trim().toLowerCase()
  return Boolean(text && (text.startsWith('temp-') || text.startsWith('temporary-')))
}

function isNoDataLiterature(item: Literature) {
  return String(item.status || '').trim().toLowerCase() === 'no_data'
}

function sortLiteratureForList(items: Literature[]) {
  return [...items].sort((a, b) => {
    const aNoData = isNoDataLiterature(a) ? 1 : 0
    const bNoData = isNoDataLiterature(b) ? 1 : 0
    if (aNoData !== bNoData) return aNoData - bNoData
    return Number(b.id || 0) - Number(a.id || 0)
  })
}

function needsMetadataBackfill(item: Literature) {
  const hasExtractedData = Number(item.recordCount || item.candidateCount || 0) > 0
  if (!hasExtractedData) return false
  return !hasMetadataText(item.title)
    || !hasMetadataText(item.authors)
    || !hasMetadataText(item.journal)
    || !item.year
    || !hasMetadataText(item.doi)
    || isTemporaryIdentifier(item.doi)
}

async function autoBackfillMissingMetadata(items: Literature[]) {
  const candidates = items.filter((item) => {
    return needsMetadataBackfill(item)
      && !metadataBackfillAttempted.has(item.id)
      && !metadataBackfillInFlight.has(item.id)
  })
  if (!candidates.length) return

  let updatedAny = false
  for (const item of candidates) {
    metadataBackfillAttempted.add(item.id)
    metadataBackfillInFlight.add(item.id)
    try {
      const result = await backfillLiteratureMetadata(item.id)
      updatedAny = updatedAny || Boolean(result.updated)
    } catch (error) {
      console.warn('[Knowledge] Metadata backfill skipped:', item.id, error)
    } finally {
      metadataBackfillInFlight.delete(item.id)
    }
  }

  if (updatedAny) {
    try {
      scopeLiterature.value = sortLiteratureForList(await listLiterature(0, LITERATURE_LIST_LIMIT))
    } catch (error) {
      console.warn('[Knowledge] Failed to refresh literature after metadata backfill:', error)
    }
  }
}

async function loadScopeLiterature() {
  literatureLoading.value = true
  literatureError.value = ''
  try {
    const items = await listLiterature(0, LITERATURE_LIST_LIMIT)
    scopeLiterature.value = sortLiteratureForList(items)
    void autoBackfillMissingMetadata(items)
  } catch (error: any) {
    literatureError.value = error?.message || '加载文献库失败'
    console.warn('[Knowledge] Failed to load scope literature:', error)
  } finally {
    literatureLoading.value = false
  }
}

async function loadKnowledgeLibraryCounts() {
  try {
    const [macro, nano, diffusion] = await Promise.all([
      searchRecords({ experiment_scales: ['macroscale'] }, 0, 1),
      searchRecords({ experiment_scales: ['nanoscale'] }, 0, 1),
      listDiffusionLibrary('', 0, 1),
    ])
    knowledgeLibraryCounts.value = {
      macro: macro.total,
      nano: nano.total,
      diffusion: diffusion.total,
    }
  } catch (error) {
    console.warn('[Knowledge] Failed to load library counts:', error)
  }
}

function selectKnowledgeLibrary(library: KnowledgeLibrary) {
  activeKnowledgeLibraryKey.value = library.key
  if (props.selectedFileId) {
    emit('clear-source')
  }
  if (library.status === 'reserved' && props.currentSection !== 'explorer') {
    emit('change-section', 'explorer')
  }
}

function libraryToneClass(library: KnowledgeLibrary, active: boolean) {
  if (active && library.tone === 'macro') return 'border-orange-300 bg-orange-50 text-orange-950 ring-1 ring-orange-200/80'
  if (active && library.tone === 'nano') return 'border-indigo-300 bg-indigo-50 text-indigo-950 ring-1 ring-indigo-200/80'
  if (active && library.tone === 'conductivity') return 'border-emerald-300 bg-emerald-50 text-emerald-950 ring-1 ring-emerald-200/80'
  if (active && library.tone === 'diffusion') return 'border-cyan-300 bg-cyan-50 text-cyan-950 ring-1 ring-cyan-200/80'
  return 'border-slate-200 bg-slate-50 text-slate-700 hover:border-slate-300 hover:bg-white dark:border-slate-800 dark:bg-slate-950/45 dark:text-slate-200 dark:hover:border-slate-700 dark:hover:bg-slate-900'
}

function libraryIconClass(library: KnowledgeLibrary, active: boolean) {
  if (library.tone === 'macro') return active ? 'bg-orange-500 text-white' : 'bg-orange-50 text-orange-600 dark:bg-orange-500/12 dark:text-orange-300'
  if (library.tone === 'nano') return active ? 'bg-indigo-500 text-white' : 'bg-indigo-50 text-indigo-600 dark:bg-indigo-500/12 dark:text-indigo-300'
  if (library.tone === 'conductivity') return active ? 'bg-emerald-500 text-white' : 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/12 dark:text-emerald-300'
  return active ? 'bg-cyan-500 text-white' : 'bg-cyan-50 text-cyan-600 dark:bg-cyan-500/12 dark:text-cyan-300'
}

function libraryStatusClass(library: KnowledgeLibrary, active: boolean) {
  if (library.status === 'reserved') return 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
  if (active) return 'bg-white/85 text-slate-700 dark:bg-white/10 dark:text-slate-200'
  return 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/12 dark:text-emerald-300'
}

function libraryCountLabel(library: KnowledgeLibrary) {
  if (library.count == null) return library.status === 'reserved' ? '待接入' : '统计中'
  return `${library.count} 条`
}

function libraryCountClass(library: KnowledgeLibrary, active: boolean) {
  if (library.status === 'reserved') return 'text-slate-400'
  if (active && library.tone === 'macro') return 'text-orange-700'
  if (active && library.tone === 'nano') return 'text-indigo-700'
  if (active && library.tone === 'diffusion') return 'text-cyan-700'
  return 'text-slate-500 dark:text-slate-400'
}

function selectLiteratureSource(literatureId: number | null) {
  if (!literatureId) {
    emit('clear-source')
    return
  }
  emit('select-source', String(literatureId))
}

function openSelectedLiteratureReview(literatureId?: number | null) {
  emit('open-review', { literatureId: literatureId || Number(props.selectedFileId || 0) || null })
}

onMounted(() => {
  void loadScopeLiterature()
  void loadKnowledgeLibraryCounts()
})

watch(
  () => props.scopeKey,
  () => {
    emit('clear-source')
    void loadScopeLiterature()
  },
)
</script>

<template>
  <div class="flex h-full min-h-0 flex-col bg-slate-100 p-2.5 dark:bg-slate-950">
    <section class="mb-2 shrink-0 rounded-lg border border-slate-200 bg-white px-3 py-2.5 dark:border-slate-800 dark:bg-slate-900">
      <div class="flex flex-col gap-2 xl:flex-row xl:items-center xl:justify-between">
        <div class="flex min-w-0 items-center gap-2.5">
          <span
            class="flex h-10 w-10 shrink-0 items-center justify-center rounded-md"
            :class="libraryIconClass(activeKnowledgeLibrary, true)"
          >
            <component :is="activeKnowledgeLibrary.icon" class="h-4 w-4" />
          </span>
          <div class="min-w-0">
            <div class="flex flex-wrap items-center gap-2">
              <p class="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400">
                Knowledge
              </p>
              <span
                class="rounded-md px-2 py-0.5 text-[10px] font-semibold"
                :class="libraryStatusClass(activeKnowledgeLibrary, true)"
              >
                {{ activeKnowledgeLibrary.statusLabel }}
              </span>
            </div>
            <h2 class="mt-0.5 truncate text-[1.05rem] font-semibold tracking-normal text-slate-950 dark:text-white">
              {{ activeKnowledgeLibrary.title }}
            </h2>
            <p class="truncate text-[12px] font-medium text-slate-500 dark:text-slate-400">
              {{ activeKnowledgeLibrary.subtitle }}
            </p>
          </div>
        </div>

        <div class="grid gap-1.5 sm:grid-cols-2 xl:w-[44rem] xl:grid-cols-4">
        <button
          v-for="library in knowledgeLibraries"
          :key="library.key"
          type="button"
          class="flex h-[4.6rem] min-w-0 items-center gap-2 rounded-lg border px-2.5 py-2 text-left transition"
          :class="libraryToneClass(library, library.key === effectiveKnowledgeLibraryKey)"
          @click="selectKnowledgeLibrary(library)"
        >
          <span
            class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md"
            :class="libraryIconClass(library, library.key === effectiveKnowledgeLibraryKey)"
          >
            <component :is="library.icon" class="h-3.5 w-3.5" />
          </span>
          <span class="min-w-0 flex-1">
            <span class="block truncate text-[13px] font-semibold leading-4">{{ library.title }}</span>
            <span class="mt-0.5 block truncate text-[10.5px] font-semibold uppercase tracking-[0.1em] text-slate-400">
              {{ library.label }}
            </span>
            <span class="mt-1 block truncate text-[11px] font-semibold tabular-nums" :class="libraryCountClass(library, library.key === effectiveKnowledgeLibraryKey)">
              {{ libraryCountLabel(library) }}
            </span>
          </span>
        </button>
        </div>
      </div>

      <div class="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] font-medium text-slate-500 dark:text-slate-400">
        <span class="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 dark:border-slate-800 dark:bg-slate-950/40">
          {{ activeScopeLabel }}
        </span>
        <span class="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 tabular-nums dark:border-slate-800 dark:bg-slate-950/40">
          {{ libraryCountLabel(activeKnowledgeLibrary) }}
        </span>
        <span class="min-w-0 truncate rounded-md border border-slate-200 bg-slate-50 px-2 py-1 dark:border-slate-800 dark:bg-slate-950/40">
          {{ activeKnowledgeLibrary.detail }}
        </span>
      </div>
    </section>

    <div
      class="grid min-h-0 flex-1 gap-3"
      :class="isReservedKnowledgeLibrary
        ? 'xl:grid-cols-[minmax(0,1fr)]'
        : currentSection === 'snapshots' || currentSection === 'insights'
        ? 'xl:grid-cols-[12rem_minmax(0,1fr)] 2xl:grid-cols-[12.5rem_minmax(0,1fr)]'
        : 'xl:grid-cols-[12rem_minmax(0,1fr)_15rem] 2xl:grid-cols-[12.5rem_minmax(0,1fr)_15rem]'"
    >
      <KnowledgeSidebar
        v-if="!isReservedKnowledgeLibrary"
        :current-section="currentSection"
        :modes="sidebarModes"
        :selected-record-count="selectedRecordCount"
        @select="emit('change-section', $event)"
        @open-review="openSelectedLiteratureReview"
      />

      <main class="flex min-h-0 flex-col gap-3 overflow-hidden">
        <section class="min-h-0 flex-1 overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <div
            v-if="isReservedKnowledgeLibrary"
            class="flex h-full min-h-[22rem] items-center justify-center bg-slate-50 px-6 text-center dark:bg-slate-950/40"
          >
            <div class="max-w-2xl">
              <div class="mx-auto flex h-12 w-12 items-center justify-center rounded-lg bg-white text-slate-500 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
                <TimerReset class="h-5 w-5" />
              </div>
              <p class="mt-5 text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">
                Reserved Library
              </p>
              <h3 class="mt-2 text-[1.45rem] font-semibold tracking-normal text-slate-950 dark:text-white">
                {{ activeKnowledgeLibrary.title }} 已预留
              </h3>
              <p class="mt-3 text-sm leading-7 text-slate-500 dark:text-slate-400">
                {{ activeKnowledgeLibrary.detail }} 当前不会混入宏观/纳米摩擦数据，等抽取字段和审核流程稳定后再接入整库浏览、来源图谱和训练数据集。
              </p>
            </div>
          </div>

          <div
            v-else-if="currentSection === 'snapshots'"
            class="h-full min-h-0 overflow-hidden"
          >
            <KnowledgeDataSnapshot
              @open-record="(payload) => emit('open-review', payload)"
            />
          </div>

          <div
            v-else-if="currentSection === 'insights'"
            class="h-full min-h-0 overflow-hidden"
          >
            <KnowledgePatternDiscovery :active-scope-label="activeKnowledgeScopeLabel" />
          </div>

          <div
            v-else-if="currentSection === 'sources'"
            class="h-full min-h-0 overflow-hidden"
          >
            <LiteratureSourceAtlas
              :literature-items="scopeLiterature"
              :loading="literatureLoading"
              :error="literatureError"
              :active-source-id="selectedFileId"
              :active-scope-label="activeKnowledgeScopeLabel"
              @select-source="selectLiteratureSource"
              @refresh-literature="loadScopeLiterature"
              @open-review-source="openSelectedLiteratureReview"
            />
          </div>

          <div
            v-else-if="activeKnowledgeLibrary.key === 'diffusion' && currentSection !== 'graph'"
            class="h-full min-h-0 overflow-hidden"
          >
            <DiffusionExplorerWorkspace
              :current-section="currentSection"
              :selected-file="selectedFile"
              :selected-file-name="selectedFileName"
              :external-export-request="externalExportRequest"
              @open-review="emit('open-review', $event)"
            />
          </div>

          <div
            v-else-if="currentSection === 'graph'"
            class="h-full min-h-0 overflow-hidden"
          >
            <div
              v-if="activeKnowledgeLibrary.key === 'diffusion'"
              class="flex h-full min-h-[18rem] items-center justify-center bg-[#fbfdff] px-6 text-center"
            >
              <div class="max-w-xl">
                <p class="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#8ca0ba]">扩散数据</p>
                <h3 class="mt-3 text-[1.55rem] font-semibold tracking-normal text-slate-950">关系图当前仅支持摩擦学数据</h3>
                <p class="mt-3 text-sm leading-7 text-slate-500">
                  扩散数据请使用"数据浏览"、"质量检查"和"训练数据集"三个视图来筛选记录、检查证据并导出特征集。
                </p>
              </div>
            </div>
            <RelationshipGraphPanel v-else :filter="activeKnowledgeFilter" :active="true" :refresh-key="activeGraphRefreshKey" />
          </div>

          <div
            v-else-if="currentSection === 'cleaning' || currentSection === 'datasets'"
            class="h-full min-h-0 overflow-hidden"
          >
            <DataCleaningWorkbench
              :key="scopeKey || 'knowledge-cleaning'"
              :current-section="currentSection"
              @change-section="emit('change-section', $event)"
              @open-training="emit('open-training', $event)"
              @open-review="(payload?: { mode?: 'training-blockers' | null }) => emit('open-review', payload)"
            />
          </div>

          <div v-else class="h-full min-h-0 overflow-hidden">
            <IntegratedExplorer
              :key="scopeKey || 'knowledge-explorer'"
              :initial-doi="explorerDoi"
              :selected-file-id="selectedFileId"
              :fixed-experiment-scale="activeKnowledgeScale"
              :focus-record-id="focusRecordId ?? null"
              :source-name="selectedFile?.name"
              :literature-metadata="selectedFile?.metadata"
              :external-export-request="externalExportRequest"
              @view-literature="emit('open-review', $event)"
              @clear-doi="emit('clear-doi')"
              @clear-source="emit('clear-source')"
              @clear-focused-record="emit('clear-focused-record')"
            />
          </div>
        </section>
      </main>

      <KnowledgeContextPanel
        v-if="!isReservedKnowledgeLibrary && currentSection !== 'snapshots' && currentSection !== 'insights'"
        :current-section="currentSection"
        :mode-label="modeMeta.label"
        :selected-source-name="sourceLabel"
        :active-scope-label="activeKnowledgeScopeLabel"
        :selected-record-count="selectedRecordCount"
        :explorer-doi="explorerDoi"
        :extractor-type="activeKnowledgeLibrary.key === 'diffusion' ? 'diffusion' : 'tribology'"
        :active-source-id="selectedFileId"
        :literature-items="scopeLiterature"
        :literature-loading="literatureLoading"
        :literature-error="literatureError"
        @open-training="emit('open-training', null)"
        @open-review="emit('open-review')"
        @change-section="emit('change-section', $event)"
        @export-data="requestExport"
        @select-source="selectLiteratureSource"
        @refresh-literature="loadScopeLiterature"
        @open-review-source="openSelectedLiteratureReview"
      />
    </div>
  </div>
</template>
