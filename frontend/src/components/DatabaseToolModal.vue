<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ChevronDown, Database as DatabaseIcon, Download, SlidersHorizontal, X } from 'lucide-vue-next'

import IntegratedExplorer from '@/components/IntegratedExplorer.vue'
import DiffusionExplorerWorkspace from '@/components/knowledge/DiffusionExplorerWorkspace.vue'
import { listDiffusionLibrary, searchRecords, type BatchFile } from '@/lib/api'

type DatasetKey = 'tribology' | 'diffusion'
type EntityTypeFilter = 'record' | 'candidate'

const props = defineProps<{
  show: boolean
  files: BatchFile[]
  selectedFile: BatchFile | null
  selectedFileId: string | null
  selectedFileName: string
  explorerDoi: string
  focusFileId?: string | null
  focusDoi?: string
  focusDataset?: 'tribology' | 'diffusion' | null
  focusRecordId?: number | null
  focusEntityType?: 'record' | 'candidate' | null
  entityTypeFilter?: 'record' | 'candidate' | null
}>()

const emit = defineEmits<{
  close: []
  openLiterature: [payload?: { literatureId?: number | null, recordId?: number | null, mode?: 'grounding' | null }]
  clearDoi: []
  clearFocusedRecord: []
}>()

const activeDataset = ref<DatasetKey>('tribology')
const activeEntityTypeFilter = ref<EntityTypeFilter>('record')
const datasetMenuOpen = ref(false)
const exportRequestId = ref(0)
const externalExportRequest = ref<{ id: number, format: 'json' | 'csv' | 'ndjson' } | null>(null)
const filterRequestId = ref(0)
const remoteCounts = ref<Record<EntityTypeFilter, Partial<Record<DatasetKey, number>>>>({
  record: {},
  candidate: {},
})
const countsLoading = ref(false)

function isDiffusionRecord(record: any) {
  return Boolean(String(record?.system_name || '').trim())
    || record?.D_total != null
    || record?.D_cation != null
    || record?.D_anion != null
}

function recordEntityType(record: any): EntityTypeFilter {
  const value = String(record?.review_entity_type || record?.reviewEntityType || record?.entity_type || record?.entityType || '').trim().toLowerCase()
  return value === 'candidate' ? 'candidate' : 'record'
}

const datasetCounts = computed<Record<DatasetKey, number>>(() => {
  let diffusion = 0
  let tribology = 0

  for (const file of props.files) {
    for (const record of file.records || []) {
      if (recordEntityType(record) !== activeEntityTypeFilter.value) continue
      if (isDiffusionRecord(record)) diffusion += 1
      else tribology += 1
    }
  }

  return {
    tribology: remoteCounts.value[activeEntityTypeFilter.value].tribology ?? tribology,
    diffusion: remoteCounts.value[activeEntityTypeFilter.value].diffusion ?? diffusion,
  }
})

const datasets = computed(() => [
  { key: 'tribology' as const, label: 'Lubrication', count: datasetCounts.value.tribology, hint: 'COF · IL structures' },
  { key: 'diffusion' as const, label: 'Diffusion', count: datasetCounts.value.diffusion, hint: 'D values · RDKit features' },
])

const activeDatasetMeta = computed(() =>
  datasets.value.find((dataset) => dataset.key === activeDataset.value) || datasets.value[0]!,
)
const entityTypeModes = computed(() => [
  {
    key: 'record' as const,
    label: 'Official Database',
    count: remoteCounts.value.record[activeDataset.value] ?? 0,
    hint: 'Approved library rows',
  },
  {
    key: 'candidate' as const,
    label: 'Review Queue',
    count: remoteCounts.value.candidate[activeDataset.value] ?? 0,
    hint: 'Candidates to approve',
  },
])
const globalTribologyInitialDoi = computed(() => props.focusDoi || '')
const globalTribologySelectedFileId = computed(() => props.focusFileId || null)
const globalTribologyExplorerKey = computed(() => [
  'database-tribology',
  globalTribologySelectedFileId.value || 'global',
  props.focusRecordId ?? 'all',
  props.focusEntityType ?? 'entity-all',
  activeEntityTypeFilter.value,
].join('-'))
const databaseRecordScope = computed<'active' | 'all_visible'>(() => {
  return 'all_visible'
})

function selectDataset(key: DatasetKey) {
  activeDataset.value = key
  datasetMenuOpen.value = false
}

function selectEntityTypeFilter(entityType: 'record' | 'candidate') {
  activeEntityTypeFilter.value = entityType
}

function requestExport(format: 'json' | 'csv' | 'ndjson' = 'csv') {
  exportRequestId.value += 1
  externalExportRequest.value = { id: exportRequestId.value, format }
}

function requestFilters() {
  filterRequestId.value += 1
}

async function refreshDatasetCounts() {
  countsLoading.value = true
  try {
    const [tribologyRecordResult, tribologyCandidateResult, diffusionRecordResult, diffusionCandidateResult] = await Promise.allSettled([
      searchRecords({ entityType: 'record' }, 0, 1, { scope: databaseRecordScope.value }),
      searchRecords({ entityType: 'candidate' }, 0, 1, { scope: databaseRecordScope.value }),
      listDiffusionLibrary('', 0, 1, { scope: databaseRecordScope.value, entityType: 'record' }),
      listDiffusionLibrary('', 0, 1, { scope: databaseRecordScope.value, entityType: 'candidate' }),
    ])
    const nextCounts: Record<EntityTypeFilter, Partial<Record<DatasetKey, number>>> = {
      record: {},
      candidate: {},
    }
    if (tribologyRecordResult.status === 'fulfilled') {
      nextCounts.record.tribology = Number(tribologyRecordResult.value.total || 0)
    }
    if (tribologyCandidateResult.status === 'fulfilled') {
      nextCounts.candidate.tribology = Number(tribologyCandidateResult.value.total || 0)
    }
    if (diffusionRecordResult.status === 'fulfilled') {
      nextCounts.record.diffusion = Number(diffusionRecordResult.value.total || 0)
    }
    if (diffusionCandidateResult.status === 'fulfilled') {
      nextCounts.candidate.diffusion = Number(diffusionCandidateResult.value.total || 0)
    }
    remoteCounts.value = {
      record: { ...remoteCounts.value.record, ...nextCounts.record },
      candidate: { ...remoteCounts.value.candidate, ...nextCounts.candidate },
    }
  } finally {
    countsLoading.value = false
  }
}

watch(() => [props.show, props.focusDataset, props.entityTypeFilter, props.focusEntityType],
  ([show]) => {
    if (!show) return
    activeDataset.value = props.focusDataset === 'diffusion' ? 'diffusion' : 'tribology'
    activeEntityTypeFilter.value = props.entityTypeFilter === 'candidate' || props.focusEntityType === 'candidate' ? 'candidate' : 'record'
    void refreshDatasetCounts()
  },
)
</script>

<template>
  <Transition
    enter-active-class="transition duration-200 ease-out"
    enter-from-class="opacity-0"
    enter-to-class="opacity-100"
    leave-active-class="transition duration-150 ease-in"
    leave-from-class="opacity-100"
    leave-to-class="opacity-0"
  >
    <div
      v-if="show"
      class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 p-4 backdrop-blur-[2px]"
      @click.self="emit('close')"
    >
      <div data-testid="database-tool-shell" class="flex h-[88vh] w-[min(96vw,1360px)] flex-col overflow-hidden rounded-[14px] border border-slate-200 bg-[#f8fbfd] text-slate-950 shadow-[0_24px_72px_rgba(15,23,42,0.22)]">
        <header class="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-white px-3 py-2.5">
          <div class="flex min-w-0 flex-wrap items-center gap-3">
            <h2 class="inline-flex shrink-0 items-center gap-2 text-[1rem] font-semibold leading-none text-slate-800">
              <DatabaseIcon class="h-4 w-4 text-[#0f7c82]" />
              Database
            </h2>
            <div class="relative">
              <button
                type="button"
                class="inline-flex min-w-[9.25rem] items-center justify-between gap-2 rounded-[8px] border border-slate-200 bg-[#fbfdff] px-2.5 py-1.5 text-sm font-semibold text-slate-700 transition hover:border-[#0f7c82]/35 hover:bg-white"
                aria-haspopup="menu"
                :aria-expanded="datasetMenuOpen"
                @click="datasetMenuOpen = !datasetMenuOpen"
              >
                <span>{{ activeDatasetMeta.label }}</span>
                <span class="font-black text-[#0f7c82]">{{ countsLoading ? '--' : activeDatasetMeta.count }}</span>
                <ChevronDown class="h-4 w-4 text-slate-500" />
              </button>

              <div
                v-if="datasetMenuOpen"
                class="absolute left-0 top-[calc(100%+0.4rem)] z-20 w-[15rem] rounded-[10px] border border-slate-200 bg-white p-1.5 shadow-[0_20px_48px_rgba(15,23,42,0.16)]"
                role="menu"
              >
                <button
                  v-for="dataset in datasets"
                  :key="dataset.key"
                  type="button"
                  class="flex w-full items-center justify-between gap-3 rounded-[8px] px-2.5 py-2 text-left transition hover:bg-slate-50"
                  :class="activeDataset === dataset.key ? 'bg-[#eefafa] text-[#0f7c82]' : 'text-slate-800'"
                  role="menuitem"
                  @click="selectDataset(dataset.key)"
                >
                  <span class="min-w-0">
                    <span class="block text-sm font-extrabold">{{ dataset.label }}</span>
                    <span class="block truncate text-xs font-medium text-slate-500">{{ dataset.hint }}</span>
                  </span>
                  <span class="text-lg font-black text-[#0f7c82]">{{ countsLoading ? '--' : dataset.count }}</span>
                </button>
              </div>
            </div>
            <div class="flex h-9 max-w-full shrink-0 items-center overflow-x-auto rounded-[8px] border border-slate-200 bg-[#fbfdff] p-1">
              <button
                v-for="mode in entityTypeModes"
                :key="mode.key"
                type="button"
                class="inline-flex h-7 items-center gap-1.5 rounded-[6px] px-2.5 text-xs font-semibold transition"
                :class="activeEntityTypeFilter === mode.key ? 'bg-[#e7f6f5] text-[#0f7c82]' : 'text-slate-500 hover:bg-white hover:text-slate-800'"
                :title="mode.hint"
                @click="selectEntityTypeFilter(mode.key)"
              >
                <span>{{ mode.label }}</span>
                <span
                  class="rounded-full px-1.5 py-0.5 text-[10px]"
                  :class="activeEntityTypeFilter === mode.key ? 'bg-white/18 text-white' : 'bg-slate-100 text-slate-400'"
                >
                  {{ countsLoading ? '--' : mode.count }}
                </span>
              </button>
            </div>
          </div>

          <div class="flex shrink-0 items-center gap-2">
            <button
              type="button"
              class="inline-flex h-9 items-center justify-center gap-1.5 rounded-[8px] border border-slate-200 bg-white px-2.5 text-sm font-semibold text-slate-600 transition hover:border-slate-300 hover:bg-slate-50"
              aria-label="Export database as CSV"
              @click="requestExport('csv')"
            >
              <Download class="h-4 w-4" />
              CSV
            </button>
            <button
              type="button"
              class="inline-flex h-9 items-center justify-center gap-1.5 rounded-[8px] border border-[#b7e6e1] bg-[#e7f6f5] px-2.5 text-sm font-semibold text-[#0f7c82] transition hover:border-[#8fdad5] hover:bg-[#dff5f2]"
              aria-label="Open database filters"
              @click="requestFilters"
            >
              <SlidersHorizontal class="h-4 w-4" />
              Filters
            </button>
            <button
              type="button"
              class="flex h-9 w-9 items-center justify-center rounded-[8px] border border-slate-200 bg-white text-slate-500 transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900"
              aria-label="Close database"
              @click="emit('close')"
            >
              <X class="h-4 w-4" />
            </button>
          </div>
        </header>

        <section class="min-h-0 flex-1 p-2.5">
          <div class="h-full min-h-0 overflow-hidden rounded-[10px] border border-slate-200 bg-white">
            <IntegratedExplorer
              v-if="activeDataset === 'tribology'"
              :key="globalTribologyExplorerKey"
              :initial-doi="globalTribologyInitialDoi"
              :selected-file-id="globalTribologySelectedFileId"
              :focus-record-id="focusRecordId ?? null"
              :focus-entity-type="focusEntityType || null"
              :entity-type-filter="activeEntityTypeFilter"
              :record-scope="databaseRecordScope"
              :source-name="selectedFile?.name"
              :literature-metadata="selectedFile?.metadata"
              :external-export-request="externalExportRequest"
              :external-filter-request-id="filterRequestId"
              @view-literature="(payload) => emit('openLiterature', payload)"
              @clear-doi="emit('clearDoi')"
              @clear-focused-record="emit('clearFocusedRecord')"
            />

            <DiffusionExplorerWorkspace
              v-else-if="activeDataset === 'diffusion'"
              :current-section="'explorer'"
              :selected-file="selectedFile"
              :selected-file-name="selectedFileName"
              :focus-file-id="focusFileId || null"
              :focus-doi="focusDoi || ''"
              :focus-record-id="focusRecordId ?? null"
              :focus-entity-type="focusEntityType || null"
              :entity-type-filter="activeEntityTypeFilter"
              :record-scope="databaseRecordScope"
              :external-export-request="externalExportRequest"
              :external-filter-request-id="filterRequestId"
              @open-literature="(payload) => emit('openLiterature', payload)"
            />
          </div>
        </section>
      </div>
    </div>
  </Transition>
</template>
