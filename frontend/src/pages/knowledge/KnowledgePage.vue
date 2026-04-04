<script setup lang="ts">
import { computed, ref } from 'vue'
import { nextTick } from 'vue'

import Dashboard from '@/components/Dashboard.vue'
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
const recordExplorerRef = ref<HTMLElement | null>(null)

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

async function focusRecordExplorer() {
  await nextTick()
  recordExplorerRef.value?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}
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

    <div v-else class="min-h-0 flex-1 overflow-auto">
      <div class="flex min-h-full flex-col gap-4">
        <section class="shell-surface px-5 py-5 sm:px-6">
          <div class="max-w-3xl">
            <p class="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-400 dark:text-slate-500">
              {{ isChinese ? 'Knowledge / Explorer' : 'Knowledge / Explorer' }}
            </p>
            <h3 class="mt-2 text-2xl font-semibold tracking-[-0.04em] text-slate-950 dark:text-white">
              {{ isChinese ? '把探索、过滤、导出都收回到 Knowledge。' : 'Pull exploration, filters, and exports back into Knowledge.' }}
            </h3>
            <p class="mt-3 text-sm leading-7 text-slate-600 dark:text-slate-300">
              {{ isChinese
                ? '这里才是图表联动、Filter Chips、快照导出和知识探索该发生的地方。Home 只负责判断平台状态和给出下一步动作。'
                : 'This is where linked charts, filter chips, snapshot exports, and data exploration belong. Home should only summarize state and suggest the next step.' }}
            </p>
          </div>
        </section>

        <Dashboard @open-library="emit('open-review')" @explore-data="focusRecordExplorer" />

        <section ref="recordExplorerRef" class="shell-surface min-h-[38rem] overflow-hidden">
          <div class="border-b border-black/8 px-5 py-4 dark:border-white/10 sm:px-6">
            <p class="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-400 dark:text-slate-500">
              {{ isChinese ? 'Record Explorer' : 'Record Explorer' }}
            </p>
            <h3 class="mt-2 text-xl font-semibold tracking-[-0.04em] text-slate-950 dark:text-white">
              {{ isChinese ? '把图表选择继续落到具体记录。' : 'Carry chart selections into concrete records.' }}
            </h3>
            <p class="mt-2 max-w-3xl text-sm leading-7 text-slate-600 dark:text-slate-300">
              {{ isChinese
                ? '图表探索确定方向后，再往下进入记录级浏览与修订，不再让首页承担这类探索入口。'
                : 'After the charts set direction, continue into record-level browsing and correction here instead of using Home as the entry for exploration.' }}
            </p>
          </div>
          <div class="min-h-0 overflow-hidden">
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
        </section>
      </div>
    </div>
  </div>
</template>
