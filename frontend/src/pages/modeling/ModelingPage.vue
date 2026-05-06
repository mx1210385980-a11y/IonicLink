<script setup lang="ts">
import ModelTrainingWorkbench from '@/components/ModelTrainingWorkbench.vue'

const props = defineProps<{
  currentSection: string
  activeScopeLabel: string
  operatorName: string
  preferredTrainingDatasetId: number | null
  scopeKey?: string | null
}>()

defineEmits<{
  'change-section': [section: string]
  'open-knowledge': []
  'inspect-record': [payload: {
    literatureId?: number | null
    recordId?: number | null
    rowIndex?: number | null
    source: 'val' | 'test' | 'external'
    actual: number
    predicted: number
    residual: number
    absResidual: number
  }]
}>()

void props.currentSection
void props.activeScopeLabel
void props.operatorName
</script>

<template>
  <div class="flex h-full min-h-0 flex-col bg-[#f1f5f9]">
    <ModelTrainingWorkbench
      :key="scopeKey || 'modeling-training'"
      :preselected-cleaned-dataset-id="preferredTrainingDatasetId"
      @open-knowledge="$emit('open-knowledge')"
      @inspect-record="$emit('inspect-record', $event)"
    />
  </div>
</template>
