<script setup lang="ts">
import { computed, ref } from 'vue'

import DataCleaningWorkbench from '@/components/DataCleaningWorkbench.vue'
import IntegratedExplorer from '@/components/IntegratedExplorer.vue'
import DiffusionExplorerWorkspace from '@/components/knowledge/DiffusionExplorerWorkspace.vue'
import KnowledgeContextPanel from '@/components/knowledge/KnowledgeContextPanel.vue'
import KnowledgeSidebar from '@/components/knowledge/KnowledgeSidebar.vue'
import RelationshipGraphPanel from '@/components/RelationshipGraphPanel.vue'
import type { SearchFilter } from '@/lib/api'

const props = defineProps<{
  currentSection: string
  activeScopeLabel: string
  operatorName: string
  selectedFileName: string
  explorerDoi: string
  selectedFile: any | null
  selectedFileId: string | null
  scopeKey?: string | null
}>()

const emit = defineEmits<{
  'change-section': [section: string]
  'open-training': [datasetId: number | null]
  'open-review': []
  'clear-doi': []
  'clear-source': []
}>()

const emptyFilter: SearchFilter = {}
const exportRequestId = ref(0)
const externalExportRequest = ref<{ id: number, format: 'json' | 'csv' | 'ndjson' } | null>(null)

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

const selectedRecordCount = computed(() => props.selectedFile?.records?.length || 0)
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
  { key: 'graph', label: 'Graph View' },
  { key: 'cleaning', label: 'Data Quality', count: qualityIssueCount.value || undefined },
  { key: 'datasets', label: 'Dataset Builder' },
])

const sourceLabel = computed(() => props.selectedFileName || 'Scope Library')
const modeMeta = computed<{ label: string }>(() => {
  const modes: Record<string, { label: string }> = {
    explorer: { label: 'Data Grid' },
    graph: { label: isDiffusionScope.value ? 'Evidence View' : 'Graph View' },
    cleaning: { label: 'Data Quality' },
    datasets: { label: isDiffusionScope.value ? 'Feature Builder' : 'Dataset Builder' },
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
</script>

<template>
  <div class="flex h-full min-h-0 flex-col bg-[#f3f7fb] p-3">
    <div class="grid min-h-0 flex-1 gap-3 xl:grid-cols-[18.5rem_minmax(0,1fr)_20rem]">
      <KnowledgeSidebar
        :current-section="currentSection"
        :modes="sidebarModes"
        :active-scope-label="activeScopeLabel"
        :selected-source-name="sourceLabel"
        :selected-record-count="selectedRecordCount"
        @select="emit('change-section', $event)"
        @open-review="emit('open-review')"
      />

      <main class="flex min-h-0 flex-col gap-3 overflow-hidden">
        <section class="min-h-0 flex-1 overflow-hidden rounded-[1.8rem] border border-[#dbe5f0] bg-white shadow-[0_28px_64px_-46px_rgba(15,23,42,0.34)]">
          <div
            v-if="isDiffusionScope && currentSection !== 'graph'"
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
                <p class="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#8ca0ba]">Diffusion Evidence</p>
                <h3 class="mt-3 text-[1.55rem] font-semibold tracking-[-0.05em] text-slate-950">Graph view is still tribology-only.</h3>
                <p class="mt-3 text-sm leading-7 text-slate-500">
                  Use the diffusion grid, quality, and feature builder views to filter records, inspect evidence, and export model-ready feature sets.
                </p>
              </div>
            </div>
            <RelationshipGraphPanel v-else :filter="emptyFilter" :active="true" :refresh-key="0" />
          </div>

          <div
            v-else-if="currentSection === 'cleaning' || currentSection === 'datasets'"
            class="h-full min-h-0 overflow-hidden"
          >
            <DataCleaningWorkbench :key="scopeKey || 'knowledge-cleaning'" @open-training="emit('open-training', $event)" />
          </div>

          <div v-else class="h-full min-h-0 overflow-hidden">
            <IntegratedExplorer
              :key="scopeKey || 'knowledge-explorer'"
              :initial-doi="explorerDoi"
              :selected-file-id="selectedFileId"
              :source-name="selectedFile?.name"
              :literature-metadata="selectedFile?.metadata"
              :external-export-request="externalExportRequest"
              @view-literature="emit('open-review')"
              @clear-doi="emit('clear-doi')"
              @clear-source="emit('clear-source')"
            />
          </div>
        </section>
      </main>

      <KnowledgeContextPanel
        :current-section="currentSection"
        :mode-label="modeMeta.label"
        :selected-source-name="sourceLabel"
        :active-scope-label="activeScopeLabel"
        :selected-record-count="selectedRecordCount"
        :explorer-doi="explorerDoi"
        :extractor-type="isDiffusionScope ? 'diffusion' : 'tribology'"
        @open-training="emit('open-training', null)"
        @open-review="emit('open-review')"
        @change-section="emit('change-section', $event)"
        @export-data="requestExport"
      />
    </div>
  </div>
</template>
