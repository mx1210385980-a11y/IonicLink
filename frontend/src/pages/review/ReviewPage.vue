<script setup lang="ts">
import { computed } from 'vue'
import { Files, FileSearch, ShieldCheck } from 'lucide-vue-next'

import LiteratureList from '@/components/LiteratureList.vue'
import PlatformSectionHeader from '@/components/shell/PlatformSectionHeader.vue'
import SourceGroundingView from '@/components/SourceGroundingView.vue'
import { useI18n } from '@/composables/useI18n'
import type { HighlightRect } from '@/types/pdf-highlight'

const props = defineProps<{
  currentSection: string
  activeScopeLabel: string
  selectedFileName: string
  highlightCount: number
  pdfUrl: string
  highlightData: HighlightRect[]
  scopeKey?: string | null
}>()

const emit = defineEmits<{
  'change-section': [section: string]
  'open-pipeline': []
  'open-knowledge': []
}>()

const { isChinese } = useI18n()

const tabs = computed(() => [
  { key: 'inbox', label: isChinese.value ? '文献待审' : 'Literature Inbox' },
  { key: 'record-review', label: isChinese.value ? '记录审阅' : 'Record Review' },
  { key: 'grounding', label: isChinese.value ? '证据定位' : 'Grounding Viewer' },
  { key: 'queue', label: isChinese.value ? '审阅队列' : 'Review Queue' },
])

const signals = computed(() => [
  { key: 'scope', label: isChinese.value ? '当前范围' : 'Active Scope', value: props.activeScopeLabel },
  { key: 'source', label: isChinese.value ? '当前来源' : 'Source', value: props.selectedFileName },
  { key: 'highlights', label: isChinese.value ? '高亮数量' : 'Highlights', value: String(props.highlightCount) },
])

const reviewNotes = computed(() => {
  if (props.currentSection === 'grounding') {
    return {
      icon: FileSearch,
      title: isChinese.value ? '直接回到 PDF 证据层。' : 'Return directly to the PDF evidence layer.',
      body: isChinese.value
        ? '任何结构化记录都应该尽量回溯到页码和文本片段，Grounding Viewer 是 Review 的核心能力之一。'
        : 'Structured records should be traceable back to pages and snippets. The grounding viewer is a core Review capability.',
    }
  }

  if (props.currentSection === 'queue') {
    return {
      icon: ShieldCheck,
      title: isChinese.value ? '下一步在这里建立优先级队列。' : 'This is where prioritization should land next.',
      body: isChinese.value
        ? '后续会把低置信度、缺字段和冲突记录聚合成真正的 Review Queue。'
        : 'Low-confidence, incomplete, and conflicting records should converge here as a proper review queue.',
    }
  }

  return {
    icon: Files,
    title: isChinese.value ? 'Review 成为独立主线。' : 'Review becomes a first-class workflow.',
    body: isChinese.value
      ? '文献列表、记录修订和 evidence 对照不再被埋在 Workspace 里，而是被整理为独立任务域。'
      : 'Literature lists, record corrections, and evidence checks are no longer buried inside Workspace but organized as a dedicated task domain.',
  }
})
</script>

<template>
  <div class="flex h-full min-h-0 flex-col gap-3 sm:gap-4">
    <PlatformSectionHeader
      :eyebrow="isChinese ? 'Review' : 'Review'"
      :title="isChinese ? '把机器输出变成人机协同的审阅主线。' : 'Turn machine output into a focused human review workflow.'"
      :description="isChinese
        ? '这一层负责待审文献、字段修正、证据对照和问题回标，是平台最有价值的人工确认界面。'
        : 'This surface handles literature review, field correction, evidence checks, and issue confirmation as the platform’s highest-value human layer.'"
      :tabs="tabs"
      :active-tab="currentSection"
      :signals="signals"
      :primary-action-label="isChinese ? '返回 Pipeline' : 'Back To Pipeline'"
      :secondary-action-label="isChinese ? '进入 Knowledge' : 'Open Knowledge'"
      @select-tab="emit('change-section', $event)"
      @primary-action="emit('open-pipeline')"
      @secondary-action="emit('open-knowledge')"
    />

    <section class="shell-surface px-5 py-5 sm:px-6">
      <div class="flex items-start gap-3">
        <div class="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#101b29] text-[#f4d18f] dark:bg-[#f4d18f] dark:text-[#111827]">
          <component :is="reviewNotes.icon" class="h-5 w-5" />
        </div>
        <div>
          <h3 class="text-lg font-semibold text-slate-900 dark:text-white">{{ reviewNotes.title }}</h3>
          <p class="mt-2 text-sm leading-7 text-slate-600 dark:text-slate-300">{{ reviewNotes.body }}</p>
        </div>
      </div>
    </section>

    <div v-if="currentSection === 'grounding'" class="shell-surface min-h-0 flex-1 overflow-hidden">
      <div v-if="pdfUrl" class="h-full overflow-hidden">
        <SourceGroundingView :pdf-url="pdfUrl" :highlight-data="highlightData" />
      </div>
      <div v-else class="flex h-full items-center justify-center px-6 text-center">
        <div class="max-w-md">
          <h3 class="text-lg font-semibold text-slate-900 dark:text-white">{{ isChinese ? '还没有可定位的文献' : 'No literature selected for grounding' }}</h3>
          <p class="mt-3 text-sm leading-7 text-slate-600 dark:text-slate-300">
            {{ isChinese
              ? '先在 Pipeline 里上传或选择一篇文献，再回到 Grounding Viewer 检查页码与高亮。'
              : 'Upload or select a document in Pipeline first, then return here to inspect pages and highlight overlays.' }}
          </p>
        </div>
      </div>
    </div>

    <div v-else class="shell-surface min-h-0 flex-1 overflow-hidden">
      <LiteratureList :key="scopeKey || 'review-literature'" />
    </div>
  </div>
</template>
