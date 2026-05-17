<script setup lang="ts">
import { computed, toRef } from 'vue'
import { Activity, AlertTriangle, RefreshCw, ScanLine } from 'lucide-vue-next'

import HomeHealthSnapshot from '@/components/home/HomeHealthSnapshot.vue'
import HomeLiteratureChat from '@/components/home/HomeLiteratureChat.vue'
import HomeRecentRuns from '@/components/home/HomeRecentRuns.vue'
import HomeSuggestedActions from '@/components/home/HomeSuggestedActions.vue'
import HomeTodayPanel from '@/components/home/HomeTodayPanel.vue'
import { useHomeSummary, type HomeSuggestedAction } from '@/composables/useHomeSummary'
import { useI18n } from '@/composables/useI18n'
import type { AgentWorkflow, BatchFile, ChatSource, ExtractionRunDetail } from '@/lib/api'

const props = defineProps<{
  activeScopeLabel: string
  operatorName: string
  files: BatchFile[]
  activeRun: ExtractionRunDetail | null
  latestWorkflow: AgentWorkflow | null
  preferredTrainingDatasetId: number | null
}>()

const emit = defineEmits<{
  action: [action: HomeSuggestedAction]
  openSource: [source: ChatSource]
}>()

const { isChinese } = useI18n()
const { summary, loading, error } = useHomeSummary({
  files: toRef(props, 'files'),
  activeRun: toRef(props, 'activeRun'),
  latestWorkflow: toRef(props, 'latestWorkflow'),
  preferredTrainingDatasetId: toRef(props, 'preferredTrainingDatasetId'),
})

const reviewQueueAction = computed(() => summary.value.suggestedActions.find((item) => item.id === 'open-review-queue') || null)
const datasetBuilderAction = computed(() => summary.value.suggestedActions.find((item) => item.id === 'open-dataset-builder') || null)
const pipelineAction = computed<HomeSuggestedAction>(() => ({
  id: 'open-pipeline',
  label: isChinese.value ? '打开 Pipeline' : 'Open Pipeline',
  description: isChinese.value ? '回到抽取运行与重试队列。' : 'Return to extraction runs and retries.',
  actionType: 'route',
  target: 'pipeline/runs',
  priority: 'medium',
}))

const commandStatus = computed(() => {
  if (summary.value.today.failedRuns > 0) {
    return {
      badge: isChinese.value ? '阻塞优先' : 'Blockers First',
      title: isChinese.value ? '现在最值得处理的是失败运行和待审积压。' : 'Failed runs and review backlog need attention first.',
      body: isChinese.value
        ? 'Home 只做推进：先清失败，再清待审，不在首页做图表过滤。'
        : 'Home is for momentum only: clear failures first, then reduce review debt, without turning the page into an exploration surface.',
    }
  }

  if (summary.value.today.reviewPending > 0) {
    return {
      badge: isChinese.value ? '审阅优先' : 'Review First',
      title: isChinese.value ? '平台当前的关键动作是把机器结果推进到人工确认。' : 'The highest-value move now is turning machine output into reviewed records.',
      body: isChinese.value
        ? '继续审阅最近文献，或者直接打开待审队列，不要在 Home 里停留。'
        : 'Continue reviewing the latest paper or jump straight into the review queue instead of lingering on Home.',
    }
  }

  if (summary.value.today.runningRuns > 0) {
    return {
      badge: isChinese.value ? '流程进行中' : 'Pipeline Active',
      title: isChinese.value ? '抽取管线正在推进，下一步是盯运行并准备审阅。' : 'The extraction pipeline is active. Watch runs and prepare for review.',
      body: isChinese.value
        ? '状态和下一步都已经给出，Home 不再承担探索和筛选工作。'
        : 'The current state and next step are already visible here. Home no longer carries exploration or filtering.',
    }
  }

  return {
    badge: isChinese.value ? '平台稳定' : 'Platform Stable',
    title: isChinese.value ? '当前可以继续把清洗结果推进到数据集构建。' : 'The platform is stable enough to push cleaned output into dataset building.',
    body: isChinese.value
      ? '当失败和待审压力不高时，直接把可用记录推进到下游建模准备。'
      : 'When failure pressure and review debt are low, move ready records directly toward dataset preparation.',
  }
})

const focusMetrics = computed(() => [
  {
    key: 'failed',
    label: isChinese.value ? '失败运行' : 'Failed Runs',
    value: summary.value.today.failedRuns,
    helper: isChinese.value ? '优先重试或排查' : 'Retry or inspect first',
    icon: AlertTriangle,
  },
  {
    key: 'review',
    label: isChinese.value ? '待审记录' : 'Pending Review',
    value: summary.value.today.reviewPending,
    helper: isChinese.value ? '等待人工确认' : 'Awaiting human review',
    icon: ScanLine,
  },
  {
    key: 'running',
    label: isChinese.value ? '运行中' : 'Running Runs',
    value: summary.value.today.runningRuns,
    helper: isChinese.value ? '持续监控状态' : 'Keep an eye on status',
    icon: Activity,
  },
])

function emitAction(action: HomeSuggestedAction | null) {
  if (action) {
    emit('action', action)
  }
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col gap-3 overflow-auto xl:overflow-hidden">
    <section class="shell-surface px-5 py-4">
      <div class="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(26rem,0.78fr)] xl:items-start">
        <div class="min-w-0">
          <div class="inline-flex items-center rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-widest text-slate-500 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400">
            {{ isChinese ? '工作台概览' : 'Workspace Overview' }}
          </div>
          <h1 class="mt-3 max-w-3xl text-xl font-semibold leading-7 text-slate-950 dark:text-white sm:text-2xl">
            {{ commandStatus.title }}
          </h1>
          <p class="mt-2 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-300">
            {{ commandStatus.body }}
          </p>

          <div class="mt-4 flex flex-wrap gap-2 text-xs">
            <span class="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 font-semibold text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200">
              <Activity class="h-3.5 w-3.5" />
              {{ commandStatus.badge }}
            </span>
            <span class="inline-flex items-center rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
              {{ activeScopeLabel }}
            </span>
            <span class="inline-flex items-center rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
              {{ operatorName }}
            </span>
          </div>
        </div>

        <div class="grid gap-2 sm:grid-cols-3">
          <article
            v-for="metric in focusMetrics"
            :key="metric.key"
            class="rounded-md border border-slate-200 bg-slate-50 px-3 py-3 dark:border-slate-800 dark:bg-slate-950"
          >
            <div class="flex items-center gap-2 text-xs font-semibold text-slate-600 dark:text-slate-300">
              <component :is="metric.icon" class="h-4 w-4 shrink-0 text-slate-500 dark:text-slate-400" />
              <span>{{ metric.label }}</span>
            </div>
            <p class="mt-2 text-2xl font-semibold leading-none text-slate-950 dark:text-white">{{ metric.value }}</p>
            <p class="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">{{ metric.helper }}</p>
          </article>
        </div>
      </div>
    </section>

    <div class="grid min-h-0 flex-1 gap-3 xl:grid-cols-[minmax(0,1.35fr)_minmax(18rem,0.9fr)_22rem]">
      <HomeLiteratureChat class="min-h-[34rem] xl:min-h-0" @open-source="emit('openSource', $event)" />

      <div class="grid min-h-0 gap-3 xl:grid-rows-[auto_minmax(0,1fr)]">
        <HomeSuggestedActions :actions="summary.suggestedActions" :loading="loading" @action="emitAction" />
        <HomeRecentRuns :runs="summary.recentRuns" @action="emitAction(pipelineAction)" />
      </div>

      <div class="grid min-h-0 gap-3 xl:grid-rows-[auto_minmax(0,1fr)]">
        <HomeTodayPanel :today="summary.today" @action="emitAction(reviewQueueAction)" />
        <HomeHealthSnapshot :health="summary.health" @action="emitAction(datasetBuilderAction)" />
      </div>
    </div>

    <div
      v-if="error"
      class="inline-flex max-w-max items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300"
    >
      <RefreshCw class="h-4 w-4" />
      {{ error }}
    </div>
  </div>
</template>
