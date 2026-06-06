<script setup lang="ts">
import IntegratedExplorerWorkspace from '@/components/integrated-explorer/IntegratedExplorerWorkspace.vue'

defineProps<{
  initialDoi?: string
  sourceName?: string
  literatureMetadata?: any
  selectedFileId?: string | null
  recordScope?: 'active' | 'group_library' | 'all_visible'
  focusRecordId?: number | null
  focusEntityType?: 'record' | 'candidate' | null
  entityTypeFilter?: 'record' | 'candidate' | null
  externalExportRequest?: { id: number, format: 'json' | 'csv' | 'ndjson' } | null
  externalFilterRequestId?: number | null
}>()

defineEmits<{
  'view-literature': [payload?: { literatureId?: number | null, recordId?: number | null, mode?: 'grounding' | null }]
  'clear-doi': []
  'clear-focused-record': []
}>()
</script>

<template>
  <IntegratedExplorerWorkspace
    :initial-doi="initialDoi"
    :source-name="sourceName"
    :literature-metadata="literatureMetadata"
    :selected-file-id="selectedFileId"
    :record-scope="recordScope"
    :focus-record-id="focusRecordId"
    :focus-entity-type="focusEntityType"
    :entity-type-filter="entityTypeFilter"
    :external-export-request="externalExportRequest"
    :external-filter-request-id="externalFilterRequestId"
    @view-literature="(payload) => $emit('view-literature', payload)"
    @clear-doi="$emit('clear-doi')"
    @clear-focused-record="$emit('clear-focused-record')"
  />
</template>
