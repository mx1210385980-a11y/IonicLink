<script setup lang="ts">
import { computed } from 'vue'
import { ArrowRight } from 'lucide-vue-next'

import { useI18n } from '@/composables/useI18n'
import type { HomeSummary } from '@/composables/useHomeSummary'

const props = defineProps<{
  health: HomeSummary['health']
}>()

const emit = defineEmits<{
  action: []
}>()

const { isChinese } = useI18n()

const items = computed(() => [
  {
    key: 'success',
    label: isChinese.value ? '抽取成功率' : 'Extraction Success Rate',
    value: formatRate(props.health.extractionSuccessRate),
    progress: props.health.extractionSuccessRate,
    detail: isChinese.value ? '基于近期可见运行的终态统计' : 'Based on recent terminal runs visible to Home',
  },
  {
    key: 'evidence',
    label: isChinese.value ? 'Evidence 完整率' : 'Evidence Coverage',
    value: formatRate(props.health.evidenceCoverageRate),
    progress: props.health.evidenceCoverageRate,
    detail: isChinese.value ? '优先用现有 records stats 估算' : 'Estimated first from current record stats',
  },
  {
    key: 'review',
    label: isChinese.value ? '审阅完成率' : 'Review Completion',
    value: formatRate(props.health.reviewCompletionRate),
    progress: props.health.reviewCompletionRate,
    detail: isChinese.value ? '审阅积压越低，这个值越高' : 'This rises as review backlog falls',
  },
  {
    key: 'dataset',
    label: isChinese.value ? '可建模记录数' : 'Records Ready For Dataset',
    value: String(props.health.datasetReadyRecords),
    progress: props.health.datasetReadyRecords > 0 ? 1 : 0,
    detail: isChinese.value ? '下一步可直接推进到数据集构建' : 'The next workable batch for dataset building',
  },
])

function formatRate(value: number | null) {
  if (value === null) return '--'
  return `${Math.round(value * 100)}%`
}

function meterWidth(value: number | null) {
  if (value === null) return '10%'
  return `${Math.max(10, Math.round(value * 100))}%`
}
</script>

<template>
  <section class="shell-surface flex min-h-0 flex-col px-4 py-3.5 sm:px-4.5">
    <div class="flex items-start justify-between gap-4">
      <div>
        <p class="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-400 dark:text-slate-500">
          {{ isChinese ? 'Health Snapshot' : 'Health Snapshot' }}
        </p>
        <h2 class="mt-1 text-lg font-semibold tracking-[-0.04em] text-slate-950 dark:text-white">
          {{ isChinese ? '质量快照。' : 'Quality snapshot.' }}
        </h2>
      </div>

      <button
        type="button"
        class="inline-flex items-center gap-2 rounded-full border border-black/8 bg-white/72 px-3.5 py-2 text-xs font-semibold text-slate-700 transition hover:bg-white dark:border-white/10 dark:bg-white/5 dark:text-slate-200 dark:hover:bg-white/10"
        @click="emit('action')"
      >
        {{ isChinese ? '进入数据集构建' : 'Open Dataset Builder' }}
        <ArrowRight class="h-4 w-4" />
      </button>
    </div>

    <div class="mt-3 flex min-h-0 flex-1 flex-col gap-2">
      <article
        v-for="item in items"
        :key="item.key"
        class="rounded-[1rem] border border-black/8 bg-white/70 px-3 py-2.5 dark:border-white/10 dark:bg-white/5"
      >
        <div class="flex items-start justify-between gap-3">
          <div>
            <p class="text-sm font-semibold text-slate-950 dark:text-white">{{ item.label }}</p>
            <p class="mt-0.5 text-[11px] leading-4 text-slate-500 dark:text-slate-400">{{ item.detail }}</p>
          </div>
          <p class="text-lg font-semibold tracking-[-0.04em] text-slate-950 dark:text-white">{{ item.value }}</p>
        </div>

        <div class="mt-2.5 h-1.5 overflow-hidden rounded-full bg-slate-200/80 dark:bg-white/10">
          <div
            class="h-full rounded-full bg-gradient-to-r from-[#22338b] via-[#4153cb] to-[#6ba3ff]"
            :style="{ width: meterWidth(item.progress) }"
          />
        </div>
      </article>
    </div>
  </section>
</template>
