<script setup lang="ts">
import { computed } from 'vue'
import { Activity, AlertTriangle, ClipboardCheck, ScanLine } from 'lucide-vue-next'

import type { HomeSummary } from '@/composables/useHomeSummary'

const props = defineProps<{
  today: HomeSummary['today']
}>()

const emit = defineEmits<{
  action: []
}>()

const items = computed(() => [
  {
    key: 'running',
    label: 'Running Runs',
    value: props.today.runningRuns,
    helper: 'Protection jobs still in flight',
    icon: Activity,
  },
  {
    key: 'failed',
    label: 'Failed Runs',
    value: props.today.failedRuns,
    helper: 'Clear failures and blockers first',
    icon: AlertTriangle,
  },
  {
    key: 'pending',
    label: 'Pending Review',
    value: props.today.reviewPending,
    helper: 'Records waiting for human judgment',
    icon: ScanLine,
  },
  {
    key: 'reviewed',
    label: 'Reviewed Today',
    value: props.today.reviewedToday,
    helper: 'Review actions completed today',
    icon: ClipboardCheck,
  },
])
</script>

<template>
  <section class="shell-surface border border-[#dbe4f2] bg-white px-5 py-5 shadow-[0_16px_34px_-26px_rgba(15,23,42,0.18)] dark:border-white/10 dark:bg-[#0f1728]">
    <div class="flex items-start justify-between gap-3">
      <div class="min-w-0">
        <p class="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-400 dark:text-slate-500">
          Today
        </p>
        <h2 class="mt-1 whitespace-nowrap text-[1.12rem] font-semibold tracking-[-0.05em] text-slate-950 dark:text-white">
          Read pressure first.
        </h2>
      </div>

      <button
        type="button"
        class="inline-flex shrink-0 items-center whitespace-nowrap rounded-lg border border-[#d7e1ee] bg-[#f8fbff] px-3 py-1.5 text-[11px] font-medium text-slate-700 transition hover:bg-white dark:border-white/10 dark:bg-white/5 dark:text-slate-200 dark:hover:bg-white/10"
        @click="emit('action')"
      >
        Open Review Queue
      </button>
    </div>

    <div class="mt-5 grid gap-x-5 gap-y-6 border-t border-[#e6edf6] pt-5 sm:grid-cols-2 dark:border-white/10">
      <div
        v-for="item in items"
        :key="item.key"
        class="min-w-0"
      >
        <div class="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
          <component :is="item.icon" class="h-3.5 w-3.5 shrink-0 text-slate-400 dark:text-slate-500" />
          <span class="whitespace-nowrap">{{ item.label }}</span>
        </div>
        <p class="mt-2 text-[2.15rem] font-semibold leading-none tracking-[-0.06em] text-slate-950 dark:text-white">{{ item.value }}</p>
        <p class="mt-2 overflow-hidden text-ellipsis whitespace-nowrap text-[11px] leading-4 text-slate-400 dark:text-slate-500">
          {{ item.helper }}
        </p>
      </div>
    </div>
  </section>
</template>
