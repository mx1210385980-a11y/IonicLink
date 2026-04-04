<script setup lang="ts">
import { AlertTriangle, Activity, ScanLine } from 'lucide-vue-next'

import { useI18n } from '@/composables/useI18n'

defineProps<{
  badge: string
  title: string
  failedRuns: number
  reviewPending: number
  runningRuns: number
  compact?: boolean
}>()

const { isChinese } = useI18n()
</script>

<template>
  <section
    class="shell-surface"
    :class="compact
      ? 'w-full min-w-0 border border-white/12 bg-white/10 px-4 py-3.5 text-white shadow-none backdrop-blur-xl'
      : 'border border-[#dbe4f2] bg-white px-5 py-5 shadow-[0_16px_34px_-26px_rgba(15,23,42,0.18)] dark:border-white/10 dark:bg-[#0f1728]'"
  >
    <div v-if="compact" class="flex min-h-full flex-col gap-3 xl:flex-row xl:items-stretch">
      <div class="flex min-w-0 items-start justify-between gap-3 xl:w-[15rem] xl:flex-none xl:flex-col xl:justify-between">
        <div class="min-w-0">
          <p class="text-[11px] font-semibold uppercase tracking-[0.28em] text-white/62">
            {{ isChinese ? 'Current Focus' : 'Current Focus' }}
          </p>
          <h2 class="mt-1 max-w-[28ch] text-sm font-semibold leading-5 tracking-[-0.04em] text-white/84">
            {{ title }}
          </h2>
        </div>

        <div class="inline-flex shrink-0 rounded-full border border-white/12 bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-white/82">
          {{ badge }}
        </div>
      </div>

      <div class="grid min-w-0 flex-1 gap-2 sm:grid-cols-3">
        <div class="rounded-xl border border-white/10 bg-black/10 px-4 py-3">
          <div class="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-white/62">
            <AlertTriangle class="h-3.5 w-3.5 text-white/55" />
            <span>Failed Runs</span>
          </div>
          <p class="mt-2 text-[1.6rem] font-semibold leading-none tracking-[-0.05em] text-white">{{ failedRuns }}</p>
          <p class="mt-2 text-[11px] leading-4 text-white/58">
            Clear blockers before the pipeline advances.
          </p>
        </div>

        <div class="rounded-xl border border-white/10 bg-black/10 px-4 py-3">
          <div class="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-white/62">
            <ScanLine class="h-3.5 w-3.5 text-white/55" />
            <span>Pending Review</span>
          </div>
          <p class="mt-2 text-[1.6rem] font-semibold leading-none tracking-[-0.05em] text-white">{{ reviewPending }}</p>
          <p class="mt-2 text-[11px] leading-4 text-white/58">
            Recent machine output still needs human review.
          </p>
        </div>

        <div class="rounded-xl border border-white/10 bg-black/10 px-4 py-3">
          <div class="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-white/62">
            <Activity class="h-3.5 w-3.5 text-white/55" />
            <span>Running Runs</span>
          </div>
          <p class="mt-2 text-[1.6rem] font-semibold leading-none tracking-[-0.05em] text-white">{{ runningRuns }}</p>
          <p class="mt-2 text-[11px] leading-4 text-white/58">
            Live jobs still need monitoring.
          </p>
        </div>
      </div>
    </div>

    <template v-else>
      <div>
        <p class="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-400 dark:text-slate-500">
          {{ isChinese ? 'Current Focus' : 'Current Focus' }}
        </p>
        <h2 class="mt-1 text-[1.45rem] font-semibold leading-8 tracking-[-0.05em] text-slate-950 dark:text-white">
          {{ title }}
        </h2>
      </div>

      <div class="mt-3 inline-flex rounded-full border border-[#dbe4f2] bg-[#f7faff] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-[#4153cb] dark:border-white/10 dark:bg-white/5 dark:text-slate-200">
        {{ badge }}
      </div>

      <div class="mt-5 border-t border-[#e6edf6] pt-5 dark:border-white/10">
        <div class="grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
          <div class="rounded-xl border border-[#e3eaf5] bg-[#f8fbff] px-4 py-3 dark:border-white/10 dark:bg-white/5">
            <div class="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
              <AlertTriangle class="h-3.5 w-3.5 text-slate-400 dark:text-slate-500" />
              <span>Failed Runs</span>
            </div>
            <p class="mt-2 text-[2.1rem] font-semibold leading-none tracking-[-0.05em] text-slate-950 dark:text-white">{{ failedRuns }}</p>
          </div>

          <div class="rounded-xl border border-[#e8eef7] px-4 py-3 dark:border-white/10">
            <div class="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
              <ScanLine class="h-3.5 w-3.5 text-slate-400 dark:text-slate-500" />
              <span>Pending Review</span>
            </div>
            <p class="mt-2 text-[1.7rem] font-semibold leading-none tracking-[-0.05em] text-slate-950 dark:text-white">{{ reviewPending }}</p>
          </div>

          <div class="rounded-xl border border-[#e8eef7] px-4 py-3 dark:border-white/10">
            <div class="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
              <Activity class="h-3.5 w-3.5 text-slate-400 dark:text-slate-500" />
              <span>Running Runs</span>
            </div>
            <p class="mt-2 text-[1.7rem] font-semibold leading-none tracking-[-0.05em] text-slate-950 dark:text-white">{{ runningRuns }}</p>
          </div>
        </div>
      </div>
    </template>
  </section>
</template>
