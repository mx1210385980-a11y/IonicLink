<script setup lang="ts">
import IntegratedExplorerWorkspace from '@/components/integrated-explorer/IntegratedExplorerWorkspace.vue'

defineProps<{
  initialDoi?: string
  sourceName?: string
  literatureMetadata?: any
  selectedFileId?: string | null
  fixedExperimentScale?: string | null
  focusRecordId?: number | null
  externalExportRequest?: { id: number, format: 'json' | 'csv' | 'ndjson' } | null
}>()

defineEmits<{
  'view-literature': [payload?: { literatureId?: number | null, recordId?: number | null }]
  'clear-doi': []
  'clear-source': []
  'clear-focused-record': []
}>()
</script>

<template>
  <IntegratedExplorerWorkspace
    :initial-doi="initialDoi"
    :source-name="sourceName"
    :literature-metadata="literatureMetadata"
    :selected-file-id="selectedFileId"
    :fixed-experiment-scale="fixedExperimentScale"
    :focus-record-id="focusRecordId ?? null"
    :external-export-request="externalExportRequest"
    @view-literature="$emit('view-literature', $event)"
    @clear-doi="$emit('clear-doi')"
    @clear-source="$emit('clear-source')"
    @clear-focused-record="$emit('clear-focused-record')"
  />
</template>
