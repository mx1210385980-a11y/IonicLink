<script setup lang="ts">
import IntegratedExplorerWorkspace from '@/components/integrated-explorer/IntegratedExplorerWorkspace.vue'

defineProps<{
  initialDoi?: string
  sourceName?: string
  literatureMetadata?: any
  selectedFileId?: string | null
}>()

defineEmits<{
  'view-literature': []
  'clear-doi': []
}>()
</script>

<template>
  <IntegratedExplorerWorkspace
    :initial-doi="initialDoi"
    :source-name="sourceName"
    :literature-metadata="literatureMetadata"
    :selected-file-id="selectedFileId"
    @view-literature="$emit('view-literature')"
    @clear-doi="$emit('clear-doi')"
  />
</template>
