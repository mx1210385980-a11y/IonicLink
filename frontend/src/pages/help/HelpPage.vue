<script setup lang="ts">
import { computed } from 'vue'
import { BookMarked, CircleHelp, ScrollText } from 'lucide-vue-next'

import GettingStarted from '@/components/GettingStarted.vue'
import PlatformSectionHeader from '@/components/shell/PlatformSectionHeader.vue'
import { useI18n } from '@/composables/useI18n'

const props = defineProps<{
  currentSection: string
  activeScopeLabel: string
  operatorName: string
}>()

const emit = defineEmits<{
  'change-section': [section: string]
  'open-pipeline': []
  'open-blog': []
}>()

const { isChinese } = useI18n()

const tabs = computed(() => [
  { key: 'quick-start', label: isChinese.value ? '快速开始' : 'Quick Start' },
  { key: 'workflow', label: isChinese.value ? '流程指南' : 'Workflow Guide' },
  { key: 'content', label: isChinese.value ? '内容中心' : 'Content Center' },
])

const signals = computed(() => [
  { key: 'scope', label: isChinese.value ? '当前范围' : 'Active Scope', value: props.activeScopeLabel },
  { key: 'operator', label: isChinese.value ? '当前操作员' : 'Operator', value: props.operatorName },
  { key: 'mode', label: isChinese.value ? '模式' : 'Mode', value: isChinese.value ? '帮助与上手' : 'Help And Onboarding' },
])

const callout = computed(() => {
  if (props.currentSection === 'content') {
    return {
      icon: BookMarked,
      title: isChinese.value ? '把文档、文章和蓝图放到内容中心。' : 'Move documentation and long-form content into a content center.',
      body: isChinese.value
        ? '这一步先把 Blog 从主导航中降级，但继续保留为独立内容模块。'
        : 'This first pass removes Blog from primary navigation while keeping it available as a dedicated content module.',
    }
  }

  if (props.currentSection === 'workflow') {
    return {
      icon: ScrollText,
      title: isChinese.value ? '帮助内容要跟新平台主线对齐。' : 'Help content should align with the new platform workflow.',
      body: isChinese.value
        ? '后续需要把 Pipeline -> Review -> Knowledge -> Modeling 的主线同步进帮助文档。'
        : 'The next documentation pass should reflect the Pipeline -> Review -> Knowledge -> Modeling workflow directly.',
    }
  }

  return {
    icon: CircleHelp,
    title: isChinese.value ? 'Help 成为非主导航模块。' : 'Help becomes a non-primary navigation module.',
    body: isChinese.value
      ? 'Guide 不再占据一级产品主线，但继续保留上手、解释和内容沉淀职责。'
      : 'Guide no longer occupies a primary product lane, but still owns onboarding, explanation, and content accumulation.',
  }
})
</script>

<template>
  <div class="flex h-full min-h-0 flex-col gap-3 sm:gap-4">
    <PlatformSectionHeader
      :eyebrow="isChinese ? 'Help' : 'Help'"
      :title="isChinese ? '把导览、文档和内容沉淀放到非主导航模块。' : 'Move guidance, docs, and long-form content into a non-primary module.'"
      :description="isChinese
        ? '帮助中心继续存在，但不再和 Pipeline、Review、Knowledge、Modeling 竞争一级任务位置。'
        : 'Help still matters, but it should not compete with Pipeline, Review, Knowledge, and Modeling for first-class task space.'"
      :tabs="tabs"
      :active-tab="currentSection"
      :signals="signals"
      :primary-action-label="isChinese ? '打开 Pipeline' : 'Open Pipeline'"
      :secondary-action-label="isChinese ? '进入内容中心' : 'Open Content'"
      @select-tab="emit('change-section', $event)"
      @primary-action="emit('open-pipeline')"
      @secondary-action="emit('open-blog')"
    />

    <section class="shell-surface px-5 py-5 sm:px-6">
      <div class="flex items-start gap-3">
        <div class="flex h-11 w-11 items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300">
          <component :is="callout.icon" class="h-5 w-5" />
        </div>
        <div>
          <h3 class="text-lg font-semibold text-slate-900 dark:text-white">{{ callout.title }}</h3>
          <p class="mt-2 text-sm leading-7 text-slate-600 dark:text-slate-300">{{ callout.body }}</p>
        </div>
      </div>
    </section>

    <div class="shell-surface min-h-0 flex-1 overflow-hidden">
      <GettingStarted />
    </div>
  </div>
</template>
