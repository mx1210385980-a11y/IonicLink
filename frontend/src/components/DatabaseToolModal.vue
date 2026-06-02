<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ChevronDown, X } from 'lucide-vue-next'

import IntegratedExplorer from '@/components/IntegratedExplorer.vue'
import DiffusionExplorerWorkspace from '@/components/knowledge/DiffusionExplorerWorkspace.vue'
import { listDiffusionLibrary, searchRecords, type BatchFile } from '@/lib/api'

type DatasetKey = 'tribology' | 'diffusion'

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
}>()

const emit = defineEmits<{
  close: []
  openLiterature: [payload?: { literatureId?: number | null, recordId?: number | null, mode?: 'grounding' | null }]
  clearDoi: []
  clearFocusedRecord: []
}>()

const activeDataset = ref<DatasetKey>('tribology')
const datasetMenuOpen = ref(false)
const exportRequestId = ref(0)
const externalExportRequest = ref<{ id: number, format: 'json' | 'csv' | 'ndjson' } | null>(null)
const filterRequestId = ref(0)
const remoteCounts = ref<Partial<Record<DatasetKey, number>>>({})
const countsLoading = ref(false)

function isDiffusionRecord(record: any) {
  return Boolean(String(record?.system_name || '').trim())
    || record?.D_total != null
    || record?.D_cation != null
    || record?.D_anion != null
}

const datasetCounts = computed<Record<DatasetKey, number>>(() => {
  let diffusion = 0
  let tribology = 0

  for (const file of props.files) {
    for (const record of file.records || []) {
      if (isDiffusionRecord(record)) diffusion += 1
      else tribology += 1
    }
  }

  return {
    tribology: remoteCounts.value.tribology ?? tribology,
    diffusion: remoteCounts.value.diffusion ?? diffusion,
  }
})

const datasets = computed(() => [
  { key: 'tribology' as const, label: 'Tribology', count: datasetCounts.value.tribology, hint: 'COF · IL structures' },
  { key: 'diffusion' as const, label: 'Diffusion', count: datasetCounts.value.diffusion, hint: 'D values · RDKit features' },
])

const activeDatasetMeta = computed(() =>
  datasets.value.find((dataset) => dataset.key === activeDataset.value) || datasets.value[0]!,
)
const globalTribologyInitialDoi = computed(() => props.focusDoi || '')
const globalTribologySelectedFileId = computed(() => props.focusFileId || null)
const globalTribologyExplorerKey = computed(() => [
  'database-tribology',
  globalTribologySelectedFileId.value || 'global',
  props.focusRecordId ?? 'all',
  props.focusEntityType ?? 'entity-all',
].join('-'))
const databaseRecordScope = computed<'active' | 'group_library'>(() => 'active')

function selectDataset(key: DatasetKey) {
  activeDataset.value = key
  datasetMenuOpen.value = false
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
    const [tribologyResult, diffusionResult] = await Promise.allSettled([
      searchRecords({}, 0, 1),
      listDiffusionLibrary('', 0, 1),
    ])
    const nextCounts: Partial<Record<DatasetKey, number>> = {}
    if (tribologyResult.status === 'fulfilled') {
      nextCounts.tribology = Number(tribologyResult.value.total || 0)
    }
    if (diffusionResult.status === 'fulfilled') {
      nextCounts.diffusion = Number(diffusionResult.value.total || 0)
    }
    remoteCounts.value = { ...remoteCounts.value, ...nextCounts }
  } finally {
    countsLoading.value = false
  }
}

watch(() => [props.show, props.focusDataset],
  ([show]) => {
    if (!show) return
    activeDataset.value = props.focusDataset === 'diffusion' ? 'diffusion' : 'tribology'
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
      <div class="flex h-[84vh] w-[min(94vw,1320px)] flex-col overflow-hidden rounded-[1.25rem] border border-slate-200 bg-[#f8fbfd] text-slate-950 shadow-[0_34px_90px_rgba(15,23,42,0.28)]">
        <header class="flex shrink-0 items-center justify-between border-b border-slate-200 bg-white px-4 py-3.5">
          <div class="flex min-w-0 items-center gap-3">
            <h2 class="shrink-0 text-[1.38rem] font-black leading-none tracking-[-0.035em] text-[#0f7c82]">Database</h2>
            <div class="relative">
              <button
                type="button"
                class="inline-flex min-w-[10rem] items-center justify-between gap-3 rounded-lg border border-slate-200 bg-[#fbfdff] px-3 py-2 text-sm font-bold text-slate-800 transition hover:border-[#0f7c82]/35 hover:bg-white"
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
                class="absolute left-0 top-[calc(100%+0.5rem)] z-20 w-[16rem] rounded-xl border border-slate-200 bg-white p-1.5 shadow-[0_24px_60px_rgba(15,23,42,0.18)]"
                role="menu"
              >
                <button
                  v-for="dataset in datasets"
                  :key="dataset.key"
                  type="button"
                  class="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left transition hover:bg-slate-50"
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
          </div>

          <div class="flex shrink-0 items-center gap-2">
            <button
              type="button"
              class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-600 transition hover:border-slate-300 hover:bg-slate-50"
              @click="requestExport('csv')"
            >
              Export
            </button>
            <button
              type="button"
              class="rounded-lg bg-[#0f7c82] px-3 py-2 text-sm font-extrabold text-white transition hover:bg-[#0b6870]"
              @click="requestFilters"
            >
              Filters
            </button>
            <button
              type="button"
              class="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900"
              aria-label="Close database"
              @click="emit('close')"
            >
              <X class="h-4 w-4" />
            </button>
          </div>
        </header>

        <section class="min-h-0 flex-1 p-3">
          <div class="h-full min-h-0 overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <IntegratedExplorer
              v-if="activeDataset === 'tribology'"
              :key="globalTribologyExplorerKey"
              :initial-doi="globalTribologyInitialDoi"
              :selected-file-id="globalTribologySelectedFileId"
              :focus-record-id="focusRecordId ?? null"
              :focus-entity-type="focusEntityType || null"
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
