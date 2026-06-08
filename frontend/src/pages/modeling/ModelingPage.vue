<script setup lang="ts">
import { computed } from 'vue'

import ModelTrainingWorkbench from '@/components/ModelTrainingWorkbench.vue'
import PlatformSectionHeader from '@/components/shell/PlatformSectionHeader.vue'
import { useI18n } from '@/composables/useI18n'

const props = defineProps<{
  currentSection: string
  activeScopeLabel: string
  operatorName: string
  preferredTrainingDatasetId: number | null
  scopeKey?: string | null
}>()

const emit = defineEmits<{
  'change-section': [section: string]
  'open-knowledge': []
}>()

const { isChinese } = useI18n()

const tabs = computed(() => [
  { key: 'training', label: isChinese.value ? '训练任务' : 'Training Runs' },
  { key: 'evaluation', label: isChinese.value ? '评估结果' : 'Evaluation' },
  { key: 'registry', label: isChinese.value ? '模型注册' : 'Model Registry' },
])

const signals = computed(() => [
  { key: 'scope', label: isChinese.value ? '当前账户' : 'Active Account', value: props.activeScopeLabel },
  {
    key: 'dataset',
    label: isChinese.value ? '接收数据集' : 'Dataset Handoff',
    value: props.preferredTrainingDatasetId === null
      ? (isChinese.value ? '等待选择' : 'Awaiting selection')
      : (isChinese.value ? `数据集 ${props.preferredTrainingDatasetId}` : `Dataset ${props.preferredTrainingDatasetId}`),
  },
  { key: 'operator', label: isChinese.value ? '当前操作员' : 'Operator', value: props.operatorName },
])
</script>

<template>
  <div class="flex h-full min-h-0 flex-col gap-3 sm:gap-4">
    <PlatformSectionHeader
      :eyebrow="isChinese ? 'Modeling' : 'Modeling'"
      :title="isChinese ? '让训练、评估和模型资产成为独立能力层。' : 'Make training, evaluation, and model assets their own layer.'"
      :description="isChinese
        ? '建模不再与上传和清洗平级混杂，而是承接 Knowledge 层整理好的数据集和特征准备结果。'
        : 'Modeling should not live beside upload and cleaning. It should receive prepared datasets and feature work from Knowledge.'"
      :tabs="tabs"
      :active-tab="currentSection"
      :signals="signals"
      :primary-action-label="isChinese ? '返回 Knowledge' : 'Back To Knowledge'"
      @select-tab="emit('change-section', $event)"
      @primary-action="emit('open-knowledge')"
    />

    <div class="shell-surface min-h-0 flex-1 overflow-hidden">
      <ModelTrainingWorkbench
        :key="scopeKey || 'modeling-training'"
        :preselected-cleaned-dataset-id="preferredTrainingDatasetId"
      />
    </div>
  </div>
</template>
