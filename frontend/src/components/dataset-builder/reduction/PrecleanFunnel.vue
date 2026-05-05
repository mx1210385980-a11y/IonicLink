<script setup lang="ts">
import { computed } from 'vue'
import { Filter } from 'lucide-vue-next'

const props = defineProps<{
  initial: number
  removed: number
  final: number
  analyzableRows: number
}>()

const retentionRatio = computed(() => {
  if (props.initial <= 0) return 0
  return props.final / props.initial
})

const removedLabel = computed(() => {
  if (props.removed <= 0) return '本轮没有识别出需要自动剔除的字段。'
  return `已自动剔除 ${props.removed} 列不可分析字段。`
})

const sampleStatus = computed(() => {
  if (props.analyzableRows > 0) return `${props.analyzableRows} 行样本可参与相关性计算。`
  return '当前预览没有可直接计算相关性的样本,下面的敏感度排行会回退到离线分析结果。'
})
</script>

<template>
  <article class="rounded-3xl border border-slate-200 bg-white p-5">
    <div class="flex items-start gap-3">
      <div class="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
        <Filter class="h-4 w-4" />
      </div>
      <div>
        <p class="text-sm font-semibold text-slate-950">自动预清洗结果</p>
        <p class="mt-1 text-xs leading-5 text-slate-500">{{ removedLabel }}</p>
      </div>
    </div>

    <div class="mt-4 grid grid-cols-3 gap-3">
      <div class="rounded-xl bg-slate-50 px-3 py-3">
        <p class="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">候选</p>
        <p class="mt-1 text-xl font-semibold tabular-nums text-slate-950">{{ initial }}</p>
      </div>
      <div class="rounded-xl bg-slate-50 px-3 py-3">
        <p class="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">已剔除</p>
        <p class="mt-1 text-xl font-semibold tabular-nums" :class="removed > 0 ? 'text-rose-600' : 'text-emerald-600'">
          {{ removed }}
        </p>
      </div>
      <div class="rounded-xl bg-slate-900 px-3 py-3 text-white">
        <p class="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/60">进入分析</p>
        <p class="mt-1 text-xl font-semibold tabular-nums">{{ final }}</p>
      </div>
    </div>

    <div class="mt-4">
      <div class="flex items-center justify-between text-[11px] font-medium text-slate-500">
        <span>保留比例</span>
        <span>{{ Math.round(retentionRatio * 100) }}%</span>
      </div>
      <div class="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
        <div class="h-full rounded-full bg-indigo-500 transition-all" :style="{ width: `${Math.max(6, retentionRatio * 100)}%` }"></div>
      </div>
    </div>

    <p class="mt-4 rounded-xl bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-600">{{ sampleStatus }}</p>
  </article>
</template>
