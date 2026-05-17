<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'

import DataCleaningWorkbench from '@/components/DataCleaningWorkbench.vue'
import IntegratedExplorer from '@/components/IntegratedExplorer.vue'
import DiffusionExplorerWorkspace from '@/components/knowledge/DiffusionExplorerWorkspace.vue'
import KnowledgeContextPanel from '@/components/knowledge/KnowledgeContextPanel.vue'
import KnowledgeDataSnapshot from '@/components/knowledge/KnowledgeDataSnapshot.vue'
import KnowledgePatternDiscovery from '@/components/knowledge/KnowledgePatternDiscovery.vue'
import KnowledgeSidebar from '@/components/knowledge/KnowledgeSidebar.vue'
import LiteratureSourceAtlas from '@/components/knowledge/LiteratureSourceAtlas.vue'
import RelationshipGraphPanel from '@/components/RelationshipGraphPanel.vue'
import { backfillLiteratureMetadata, listLiterature, type Literature, type SearchFilter } from '@/lib/api'

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

const emptyFilter: SearchFilter = {}
const LITERATURE_LIST_LIMIT = 1000
const exportRequestId = ref(0)
const externalExportRequest = ref<{ id: number, format: 'json' | 'csv' | 'ndjson' } | null>(null)
const scopeLiterature = ref<Literature[]>([])
const literatureLoading = ref(false)
const literatureError = ref('')
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

const selectedLiterature = computed(() => {
  const selectedId = String(props.selectedFileId || '')
  if (!selectedId) return null
  return scopeLiterature.value.find((item) => String(item.id) === selectedId) || null
})

const selectedRecordCount = computed(() => {
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
  if (selectedLiterature.value) {
    return selectedLiterature.value.title || selectedLiterature.value.doi || `Literature ${selectedLiterature.value.id}`
  }
  return props.selectedFileName || 'Scope Library'
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
  <div class="flex h-full min-h-0 flex-col bg-slate-100 p-3 dark:bg-slate-950">
    <div
      class="grid min-h-0 flex-1 gap-3"
      :class="currentSection === 'snapshots' || currentSection === 'insights'
        ? 'xl:grid-cols-[12rem_minmax(0,1fr)] 2xl:grid-cols-[12.5rem_minmax(0,1fr)]'
        : 'xl:grid-cols-[12rem_minmax(0,1fr)_15rem] 2xl:grid-cols-[12.5rem_minmax(0,1fr)_15rem]'"
    >
      <KnowledgeSidebar
        :current-section="currentSection"
        :modes="sidebarModes"
        :selected-record-count="selectedRecordCount"
        @select="emit('change-section', $event)"
        @open-review="openSelectedLiteratureReview"
      />

      <main class="flex min-h-0 flex-col gap-3 overflow-hidden">
        <section class="min-h-0 flex-1 overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <div
            v-if="currentSection === 'snapshots'"
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
            <KnowledgePatternDiscovery :active-scope-label="activeScopeLabel" />
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
              :active-scope-label="activeScopeLabel"
              @select-source="selectLiteratureSource"
              @refresh-literature="loadScopeLiterature"
              @open-review-source="openSelectedLiteratureReview"
            />
          </div>

          <div
            v-else-if="isDiffusionScope && currentSection !== 'graph'"
            class="h-full min-h-0 overflow-hidden"
          >
            <DiffusionExplorerWorkspace
              :current-section="currentSection"
              :selected-file="selectedFile"
              :selected-file-name="selectedFileName"
              :external-export-request="externalExportRequest"
              @open-review="emit('open-review')"
            />
          </div>

          <div
            v-else-if="currentSection === 'graph'"
            class="h-full min-h-0 overflow-hidden"
          >
            <div
              v-if="isDiffusionScope"
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
            <RelationshipGraphPanel v-else :filter="emptyFilter" :active="true" :refresh-key="0" />
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
        v-if="currentSection !== 'snapshots' && currentSection !== 'insights'"
        :current-section="currentSection"
        :mode-label="modeMeta.label"
        :selected-source-name="sourceLabel"
        :active-scope-label="activeScopeLabel"
        :selected-record-count="selectedRecordCount"
        :explorer-doi="explorerDoi"
        :extractor-type="isDiffusionScope ? 'diffusion' : 'tribology'"
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
