<script setup lang="ts">
import { computed } from 'vue'
import { BellRing, Compass, Workflow } from 'lucide-vue-next'

import Dashboard from '@/components/Dashboard.vue'
import PlatformSectionHeader from '@/components/shell/PlatformSectionHeader.vue'
import { useI18n } from '@/composables/useI18n'

const props = defineProps<{
  currentSection: string
  activeScopeLabel: string
  queueSizeLabel: string
  operatorName: string
  scopeKey?: string | null
}>()

const emit = defineEmits<{
  'change-section': [section: string]
  'open-review': []
  'open-knowledge': []
}>()

const { isChinese } = useI18n()

const tabs = computed(() => [
  { key: 'today', label: isChinese.value ? '今日' : 'Today' },
  { key: 'alerts', label: isChinese.value ? '告警' : 'Alerts' },
  { key: 'actions', label: isChinese.value ? '推荐动作' : 'Suggested Actions' },
])

const signals = computed(() => [
  { key: 'scope', label: isChinese.value ? '当前范围' : 'Active Scope', value: props.activeScopeLabel },
  { key: 'queue', label: isChinese.value ? '待处理队列' : 'Queue', value: props.queueSizeLabel },
  { key: 'operator', label: isChinese.value ? '当前操作员' : 'Operator', value: props.operatorName },
])

const highlights = computed(() => {
  if (props.currentSection === 'alerts') {
    return [
      {
        key: 'alerts',
        icon: BellRing,
        title: isChinese.value ? '优先看异常和失败运行' : 'Surface failures before routine work',
        body: isChinese.value
          ? '把失败运行、低置信度记录和范围覆盖缺口放到第一屏，首页不再承担入口目录职责。'
          : 'Keep failed runs, low-confidence records, and coverage gaps above the fold instead of using Home as a feature directory.',
      },
    ]
  }

  if (props.currentSection === 'actions') {
    return [
      {
        key: 'actions',
        icon: Compass,
        title: isChinese.value ? '推荐下一步动作' : 'Recommend the next best move',
        body: isChinese.value
          ? '首页应该告诉操作者先去哪里：补抽取、进审阅，还是推进数据清洗。'
          : 'Home should tell the operator where to go next: retry extraction, review evidence, or continue data cleaning.',
      },
    ]
  }

  return [
    {
      key: 'today',
      icon: Workflow,
      title: isChinese.value ? '把平台主线放在首页前台' : 'Lead with the platform workflow',
      body: isChinese.value
        ? '当前首页先承担状态理解：今天的工作量、活跃范围和接下来最值得处理的环节。'
        : 'The first job of Home is state awareness: today’s workload, active scope, and the stage that deserves attention next.',
    },
  ]
})
</script>

<template>
  <div class="flex h-full min-h-0 flex-col gap-3 sm:gap-4">
    <PlatformSectionHeader
      :eyebrow="isChinese ? '平台首页' : 'Home Surface'"
      :title="isChinese ? '把今天最值得处理的任务放到第一屏。' : 'Put the most valuable work for today on the first screen.'"
      :description="isChinese
        ? '这里先回答现在该处理什么，再把用户送往 Pipeline、Review 或 Knowledge，而不是平铺全部功能入口。'
        : 'Home should answer what deserves attention now, then route people into Pipeline, Review, or Knowledge instead of listing every feature.'"
      :tabs="tabs"
      :active-tab="currentSection"
      :signals="signals"
      :primary-action-label="isChinese ? '打开知识层' : 'Open Knowledge'"
      :secondary-action-label="isChinese ? '进入审阅层' : 'Open Review'"
      @select-tab="emit('change-section', $event)"
      @primary-action="emit('open-knowledge')"
      @secondary-action="emit('open-review')"
    />

    <section class="grid gap-3 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
      <div
        v-for="item in highlights"
        :key="item.key"
        class="shell-surface px-5 py-5 sm:px-6"
      >
        <div class="flex items-start gap-3">
          <div class="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#101b29] text-[#f4d18f] dark:bg-[#f4d18f] dark:text-[#111827]">
            <component :is="item.icon" class="h-5 w-5" />
          </div>
          <div class="space-y-2">
            <h3 class="text-lg font-semibold text-slate-900 dark:text-white">{{ item.title }}</h3>
            <p class="text-sm leading-7 text-slate-600 dark:text-slate-300">{{ item.body }}</p>
          </div>
        </div>
      </div>

      <div class="shell-surface px-5 py-5 sm:px-6">
        <p class="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-400 dark:text-slate-500">
          {{ isChinese ? '首页重构方向' : 'Home Restructure' }}
        </p>
        <div class="mt-4 grid gap-4 sm:grid-cols-3">
          <div>
            <p class="text-sm font-semibold text-slate-900 dark:text-white">{{ isChinese ? '状态优先' : 'State First' }}</p>
            <p class="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
              {{ isChinese ? '强调范围、队列、失败和建议动作。' : 'Emphasize scope, queue, failures, and suggested actions.' }}
            </p>
          </div>
          <div>
            <p class="text-sm font-semibold text-slate-900 dark:text-white">{{ isChinese ? '入口降噪' : 'Lower Entry Noise' }}</p>
            <p class="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
              {{ isChinese ? '一级导航不再堆叠所有功能。' : 'Stop stacking every capability into top-level navigation.' }}
            </p>
          </div>
          <div>
            <p class="text-sm font-semibold text-slate-900 dark:text-white">{{ isChinese ? '流程导向' : 'Workflow Driven' }}</p>
            <p class="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
              {{ isChinese ? '把用户送到下一步真正该工作的页面。' : 'Route people into the page where real work should continue.' }}
            </p>
          </div>
        </div>
      </div>
    </section>

    <div class="shell-surface min-h-0 flex-1 overflow-hidden">
      <Dashboard :key="scopeKey || 'home-dashboard'" @open-library="emit('open-review')" @explore-data="emit('open-knowledge')" />
    </div>
  </div>
</template>
