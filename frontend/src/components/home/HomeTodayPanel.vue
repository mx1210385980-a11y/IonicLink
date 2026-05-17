<script setup lang="ts">
import { computed } from 'vue'
import { Activity, AlertTriangle, ClipboardCheck, ScanLine } from 'lucide-vue-next'

import { useI18n } from '@/composables/useI18n'
import type { HomeSummary } from '@/composables/useHomeSummary'

const props = defineProps<{
  today: HomeSummary['today']
}>()

const emit = defineEmits<{
  action: []
}>()

const { isChinese } = useI18n()

const items = computed(() => [
  {
    key: 'running',
    label: isChinese.value ? '运行中' : 'Running Runs',
    value: props.today.runningRuns,
    helper: isChinese.value ? '仍在执行的抽取任务' : 'Extraction jobs still in flight',
    icon: Activity,
  },
  {
    key: 'failed',
    label: isChinese.value ? '失败运行' : 'Failed Runs',
    value: props.today.failedRuns,
    helper: isChinese.value ? '优先清理阻塞项' : 'Clear failures and blockers first',
    icon: AlertTriangle,
  },
  {
    key: 'pending',
    label: isChinese.value ? '待审记录' : 'Pending Review',
    value: props.today.reviewPending,
    helper: isChinese.value ? '等待人工判断的记录' : 'Records waiting for human judgment',
    icon: ScanLine,
  },
  {
    key: 'reviewed',
    label: isChinese.value ? '今日已审' : 'Reviewed Today',
    value: props.today.reviewedToday,
    helper: isChinese.value ? '今日完成的审阅动作' : 'Review actions completed today',
    icon: ClipboardCheck,
  },
])
</script>

<template>
  <section class="shell-surface px-5 py-5">
    <div class="flex items-start justify-between gap-3">
      <div class="min-w-0">
        <p class="text-[11px] font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-500">
          {{ isChinese ? '今日' : 'Today' }}
        </p>
        <h2 class="mt-1 whitespace-nowrap text-[1.12rem] font-semibold tracking-normal text-slate-950 dark:text-white">
          {{ isChinese ? '先看压力项' : 'Pressure first' }}
        </h2>
      </div>

      <button
        type="button"
        class="inline-flex shrink-0 items-center whitespace-nowrap rounded-md border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-medium text-slate-700 transition hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
        @click="emit('action')"
      >
        {{ isChinese ? '打开待审队列' : 'Open Review Queue' }}
      </button>
    </div>

    <div class="mt-5 grid gap-x-5 gap-y-6 border-t border-slate-200 pt-5 sm:grid-cols-2 dark:border-slate-800">
      <div
        v-for="item in items"
        :key="item.key"
        class="min-w-0"
      >
        <div class="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400">
          <component :is="item.icon" class="h-3.5 w-3.5 shrink-0 text-slate-400 dark:text-slate-500" />
          <span class="whitespace-nowrap">{{ item.label }}</span>
        </div>
        <p class="mt-2 text-[2.15rem] font-semibold leading-none tracking-normal text-slate-950 dark:text-white">{{ item.value }}</p>
        <p class="mt-2 overflow-hidden text-ellipsis whitespace-nowrap text-[11px] leading-4 text-slate-400 dark:text-slate-500">
          {{ item.helper }}
        </p>
      </div>
    </div>
  </section>
</template>
