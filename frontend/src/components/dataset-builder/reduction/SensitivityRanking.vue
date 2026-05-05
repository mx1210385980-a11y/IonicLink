<script setup lang="ts">
import { computed } from 'vue'
import { BarChart3, TriangleAlert } from 'lucide-vue-next'
import { formatColumnLabel } from '../formatters'
import type { SensitivityItem } from './featureSemantics'
import { formatMetricCompact } from './sensitivityComputations'

const props = defineProps<{
  items: SensitivityItem[]
  measured: boolean
  targetLabel: string
  advice: string
}>()

const emit = defineEmits<{
  (e: 'focus', feature: string): void
}>()

const maxAbs = computed(() => props.items.reduce((max, item) => Math.max(max, Math.abs(item.correlation)), 0.001))

function strengthBarWidth(value: number) {
  return `${(Math.abs(value) / maxAbs.value) * 100}%`
}

function suggestedBarWidth(index: number) {
  return `${Math.max(36, 100 - index * 14)}%`
}
</script>

<template>
  <article class="rounded-3xl border border-slate-200 bg-white p-5">
    <div class="flex items-start gap-3">
      <div class="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
        <BarChart3 class="h-4 w-4" />
      </div>
      <div>
        <p class="text-sm font-semibold text-slate-950">目标敏感度 Top 5</p>
        <p class="mt-1 text-xs leading-5 text-slate-500">与 {{ targetLabel }} 的 Pearson 线性相关性最显著的变量。</p>
      </div>
    </div>

    <div v-if="!measured && items.length" class="mt-4 rounded-xl border border-emerald-100 bg-emerald-50/70 px-3 py-2 text-xs text-emerald-700">
      当前页样本不足以计算 Pearson,改为展示离线分析的 Top 5。
    </div>

    <div v-if="items.length" class="mt-4 space-y-2">
      <div v-for="(item, index) in items" :key="item.feature" class="rounded-xl bg-slate-50 px-3 py-2.5">
        <div class="flex items-center justify-between gap-3">
          <button type="button" class="text-left text-sm font-semibold text-slate-950 transition hover:text-indigo-700" @click="emit('focus', item.feature)">
            {{ item.feature }}
            <span class="ml-1 text-xs font-normal text-slate-500">{{ formatColumnLabel(item.feature) }}</span>
          </button>
          <p v-if="measured" class="shrink-0 text-sm font-semibold tabular-nums" :class="item.correlation >= 0 ? 'text-rose-600' : 'text-cyan-700'">
            {{ item.correlation >= 0 ? '+' : '' }}{{ formatMetricCompact(item.correlation, 4) }}
          </p>
          <span v-else class="shrink-0 rounded-full bg-slate-900 px-2.5 py-1 text-[10px] font-semibold text-white">离线</span>
        </div>
        <div class="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200">
          <div
            class="h-full rounded-full transition-all"
            :class="measured ? (item.correlation >= 0 ? 'bg-rose-500' : 'bg-cyan-500') : 'bg-emerald-500'"
            :style="{ width: measured ? strengthBarWidth(item.correlation) : suggestedBarWidth(index) }"
          ></div>
        </div>
      </div>
    </div>

    <div v-else class="mt-4 rounded-xl bg-slate-50 px-3 py-5 text-center text-xs text-slate-500">
      当前页还没有可用的敏感性结果。
    </div>

    <div class="mt-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5">
      <TriangleAlert class="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
      <p class="text-xs leading-5 text-amber-900">{{ advice }}</p>
    </div>
  </article>
</template>
