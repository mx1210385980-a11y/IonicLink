<script setup lang="ts">
import { computed } from 'vue'

import DataCleaningWorkbench from '@/components/DataCleaningWorkbench.vue'
import IntegratedExplorer from '@/components/IntegratedExplorer.vue'
import RelationshipGraphPanel from '@/components/RelationshipGraphPanel.vue'
import PlatformSectionHeader from '@/components/shell/PlatformSectionHeader.vue'
import { useI18n } from '@/composables/useI18n'
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
}>()

const { isChinese } = useI18n()
const emptyFilter: SearchFilter = {}

const tabs = computed(() => [
  { key: 'explorer', label: isChinese.value ? '知识浏览' : 'Explorer' },
  { key: 'graph', label: isChinese.value ? '关系图谱' : 'Relationship Graph' },
  { key: 'cleaning', label: isChinese.value ? '清洗工作台' : 'Cleaning Studio' },
  { key: 'datasets', label: isChinese.value ? '数据集构建' : 'Dataset Builder' },
])

const signals = computed(() => [
  { key: 'scope', label: isChinese.value ? '当前范围' : 'Active Scope', value: props.activeScopeLabel },
  { key: 'source', label: isChinese.value ? '当前来源' : 'Source', value: props.selectedFileName },
  { key: 'operator', label: isChinese.value ? '当前操作员' : 'Operator', value: props.operatorName },
])
</script>

<template>
  <div class="flex h-full min-h-0 flex-col gap-3 sm:gap-4">
    <PlatformSectionHeader
      :eyebrow="isChinese ? 'Knowledge' : 'Knowledge'"
      :title="isChinese ? '把抽取结果沉淀成可复用的研究知识资产。' : 'Turn extracted output into reusable research knowledge assets.'"
      :description="isChinese
        ? '这一层不只是查数据，还要承接关系图、数据质量、清洗和数据集构建，把平台主线推进到建模前。'
        : 'This layer is more than search. It should carry relationship views, data quality work, cleaning, and dataset building before modeling begins.'"
      :tabs="tabs"
      :active-tab="currentSection"
      :signals="signals"
      :primary-action-label="isChinese ? '进入建模层' : 'Open Modeling'"
      :secondary-action-label="isChinese ? '返回审阅层' : 'Back To Review'"
      @select-tab="emit('change-section', $event)"
      @primary-action="emit('open-training', null)"
      @secondary-action="emit('open-review')"
    />

    <div v-if="currentSection === 'graph'" class="shell-surface min-h-0 flex-1 overflow-hidden">
      <RelationshipGraphPanel :filter="emptyFilter" :active="true" :refresh-key="0" />
    </div>

    <div v-else-if="currentSection === 'cleaning' || currentSection === 'datasets'" class="shell-surface min-h-0 flex-1 overflow-hidden">
      <DataCleaningWorkbench :key="scopeKey || 'knowledge-cleaning'" @open-training="emit('open-training', $event)" />
    </div>

    <div v-else class="shell-surface min-h-0 flex-1 overflow-hidden">
      <IntegratedExplorer
        :key="scopeKey || 'knowledge-explorer'"
        :initial-doi="explorerDoi"
        :selected-file-id="selectedFileId"
        :source-name="selectedFile?.name"
        :literature-metadata="selectedFile?.metadata"
        @view-literature="emit('open-review')"
        @clear-doi="emit('clear-doi')"
      />
    </div>
  </div>
</template>
