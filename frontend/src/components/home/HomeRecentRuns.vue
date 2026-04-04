<script setup lang="ts">
import { computed } from 'vue'

import { useI18n } from '@/composables/useI18n'
import type { HomeRecentRun } from '@/composables/useHomeSummary'

const props = defineProps<{
  runs: HomeRecentRun[]
}>()

const emit = defineEmits<{
  action: []
}>()

const { isChinese } = useI18n()

const displayedRuns = computed(() => props.runs.slice(0, 4))

const emptyLabel = computed(() => (
  isChinese.value
    ? '当前还没有可显示的近期抽取运行。'
    : 'There are no recent extraction runs to show yet.'
))

function formatStatus(status: string) {
  const normalized = String(status || '').trim().toLowerCase()
  if (normalized === 'completed' || normalized === 'success') return isChinese.value ? '已完成' : 'Completed'
  if (normalized === 'processing' || normalized === 'running') return isChinese.value ? '运行中' : 'Running'
  if (normalized === 'failed' || normalized === 'error') return isChinese.value ? '失败' : 'Failed'
  if (normalized === 'cancelled') return isChinese.value ? '已取消' : 'Cancelled'
  return status || (isChinese.value ? '未知' : 'Unknown')
}

function statusClasses(status: string) {
  const normalized = String(status || '').trim().toLowerCase()
  if (normalized === 'completed' || normalized === 'success') return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-200'
  if (normalized === 'processing' || normalized === 'running') return 'bg-sky-100 text-sky-700 dark:bg-sky-500/10 dark:text-sky-200'
  if (normalized === 'failed' || normalized === 'error') return 'bg-rose-100 text-rose-700 dark:bg-rose-500/10 dark:text-rose-200'
  return 'bg-slate-100 text-slate-700 dark:bg-white/10 dark:text-slate-200'
}

function formatUpdatedAt(value: string) {
  if (!value) return isChinese.value ? '暂无时间' : 'No timestamp'
  const stamp = new Date(value)
  if (Number.isNaN(stamp.getTime())) return value
  return new Intl.DateTimeFormat(isChinese.value ? 'zh-CN' : 'en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(stamp)
}
</script>

<template>
  <section class="shell-surface flex min-h-0 flex-col px-4 py-3.5 sm:px-4.5">
    <div class="flex items-start justify-between gap-4">
      <div>
        <p class="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-400 dark:text-slate-500">
          {{ isChinese ? 'Recent Runs' : 'Recent Runs' }}
        </p>
        <h2 class="mt-1 text-lg font-semibold tracking-[-0.04em] text-slate-950 dark:text-white">
          {{ isChinese ? '近期运行。' : 'Recent runs only.' }}
        </h2>
      </div>

      <button
        type="button"
        class="inline-flex items-center rounded-full border border-black/8 bg-white/72 px-3.5 py-2 text-xs font-semibold text-slate-700 transition hover:bg-white dark:border-white/10 dark:bg-white/5 dark:text-slate-200 dark:hover:bg-white/10"
        @click="emit('action')"
      >
        {{ isChinese ? '打开 Pipeline' : 'Open Pipeline' }}
      </button>
    </div>

    <div class="mt-3 flex min-h-0 flex-1 flex-col gap-2 overflow-hidden">
      <article
        v-for="run in displayedRuns"
        :key="run.runId"
        class="grid gap-2 rounded-[1rem] border border-black/8 bg-white/70 px-3 py-2.5 dark:border-white/10 dark:bg-white/5 md:grid-cols-[minmax(0,1fr)_5.5rem_6.5rem]"
      >
        <div class="min-w-0">
          <p class="truncate text-sm font-semibold text-slate-950 dark:text-white">{{ run.literatureTitle }}</p>
          <p class="mt-0.5 text-xs leading-5 text-slate-500 dark:text-slate-400">Run ID: {{ run.runId }}</p>
        </div>
        <div class="md:text-center">
          <span class="inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold" :class="statusClasses(run.status)">
            {{ formatStatus(run.status) }}
          </span>
        </div>
        <p class="text-xs text-slate-500 dark:text-slate-400 md:text-right">{{ formatUpdatedAt(run.updatedAt) }}</p>
      </article>

      <div
        v-if="displayedRuns.length === 0"
        class="rounded-[1rem] border border-dashed border-black/10 px-4 py-5 text-center text-sm text-slate-500 dark:border-white/10 dark:text-slate-400"
      >
        {{ emptyLabel }}
      </div>
    </div>
  </section>
</template>
