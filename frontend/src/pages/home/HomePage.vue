<script setup lang="ts">
import { computed, toRef } from 'vue'
import { Activity, Orbit, RefreshCw } from 'lucide-vue-next'

import HomeCurrentFocus from '@/components/home/HomeCurrentFocus.vue'
import HomeHealthSnapshot from '@/components/home/HomeHealthSnapshot.vue'
import HomeRecentRuns from '@/components/home/HomeRecentRuns.vue'
import HomeSuggestedActions from '@/components/home/HomeSuggestedActions.vue'
import HomeTodayPanel from '@/components/home/HomeTodayPanel.vue'
import { useHomeSummary, type HomeSuggestedAction } from '@/composables/useHomeSummary'
import { useI18n } from '@/composables/useI18n'
import type { AgentWorkflow, BatchFile, ExtractionRunDetail } from '@/lib/api'

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

function emitAction(action: HomeSuggestedAction | null) {
  if (action) {
    emit('action', action)
  }
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col gap-2.5 overflow-auto xl:overflow-hidden">
    <section class="relative overflow-hidden rounded-[1.5rem] border border-[#22338b]/10 bg-[linear-gradient(135deg,#16265e_0%,#23378f_48%,#3f55c4_100%)] px-4 py-3.5 text-white shadow-[0_20px_44px_-34px_rgba(28,42,120,0.72)] sm:px-5 sm:py-4">
      <div class="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.14),transparent_24%),radial-gradient(circle_at_bottom_left,rgba(107,163,255,0.16),transparent_28%)]" />
      <div class="absolute -right-8 top-2 h-32 w-32 rounded-full border border-white/10 bg-white/5 blur-2xl" />

      <div class="relative grid gap-3 xl:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)] xl:gap-4">
        <div class="flex min-w-0 flex-col rounded-[1.35rem] border border-white/12 bg-white/6 px-4 py-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] sm:px-5">
          <div class="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-white/82">
            <Orbit class="h-3.5 w-3.5" />
            {{ isChinese ? 'Platform Command Center' : 'Platform Command Center' }}
          </div>

          <h1
            class="mt-3 max-w-none text-[1.5rem] font-semibold leading-[1.14] tracking-[-0.055em] sm:text-[1.75rem]"
          >
            {{ commandStatus.title }}
          </h1>
          <p
            class="mt-1.5 max-w-none text-[13px] leading-5 text-white/76 sm:text-sm"
          >
            {{ commandStatus.body }}
          </p>

          <div class="mt-3 flex flex-wrap gap-2">
            <span class="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-[11px] font-semibold text-white">
              <Activity class="h-4 w-4" />
              {{ commandStatus.badge }}
            </span>
            <span class="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/8 px-3 py-1.5 text-[11px] text-white/78">
              {{ activeScopeLabel }}
            </span>
            <span class="hidden items-center gap-2 rounded-full border border-white/15 bg-white/8 px-3 py-1.5 text-[11px] text-white/78 xl:inline-flex">
              {{ operatorName }}
            </span>
          </div>
        </div>

        <HomeCurrentFocus
          compact
          class="h-full"
          :badge="commandStatus.badge"
          :title="commandStatus.title"
          :failed-runs="summary.today.failedRuns"
          :review-pending="summary.today.reviewPending"
          :running-runs="summary.today.runningRuns"
        />
      </div>
    </section>

    <div class="grid min-h-0 flex-1 gap-2.5 xl:grid-cols-[minmax(0,1.48fr)_22.5rem]">
      <div class="grid min-h-0 gap-2.5 xl:grid-rows-[auto_minmax(0,1fr)]">
        <HomeSuggestedActions :actions="summary.suggestedActions" :loading="loading" @action="emitAction" />
        <HomeRecentRuns :runs="summary.recentRuns" @action="emitAction(pipelineAction)" />
      </div>

      <div class="grid min-h-0 gap-2.5 xl:grid-rows-[auto_minmax(0,1fr)]">
        <HomeTodayPanel :today="summary.today" @action="emitAction(reviewQueueAction)" />
        <HomeHealthSnapshot :health="summary.health" @action="emitAction(datasetBuilderAction)" />
      </div>
    </div>

    <div
      v-if="error"
      class="inline-flex max-w-max items-center gap-2 rounded-full border border-black/8 bg-white/70 px-4 py-2 text-sm text-slate-600 dark:border-white/10 dark:bg-white/5 dark:text-slate-300"
    >
      <RefreshCw class="h-4 w-4" />
      {{ error }}
    </div>
  </div>
</template>
