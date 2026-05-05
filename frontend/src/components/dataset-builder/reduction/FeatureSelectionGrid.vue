<script setup lang="ts">
import { computed } from 'vue'
import { Check, Sparkles } from 'lucide-vue-next'
import { formatColumnLabel } from '../formatters'
import { SEMANTIC_MAP } from './featureSemantics'

const props = defineProps<{
  shortTitle: string
  availableColumns: string[]
  selectedFeatures: string[]
  recommendedFeatures: string[]
}>()

const emit = defineEmits<{
  (e: 'update', features: string[]): void
  (e: 'focus', feature: string): void
}>()

const selectedSet = computed(() => new Set(props.selectedFeatures))
const recommendedSet = computed(() => new Set(props.recommendedFeatures))

function toggle(feature: string) {
  const next = new Set(selectedSet.value)
  if (next.has(feature)) next.delete(feature)
  else next.add(feature)
  emit('update', Array.from(next))
}

function applyRecommended() {
  emit('update', [...props.recommendedFeatures])
}

function selectAll() {
  emit('update', [...props.availableColumns])
}

function clearAll() {
  emit('update', [])
}
</script>

<template>
  <article class="rounded-3xl border border-slate-200 bg-white p-6">
    <div class="flex flex-wrap items-start justify-between gap-4">
      <div>
        <p class="text-[11px] font-semibold uppercase tracking-[0.18em] text-indigo-600">第 1 步 · 选择保留特征</p>
        <h3 class="mt-1.5 text-xl font-semibold tracking-tight text-slate-950">{{ shortTitle }} 保留清单</h3>
        <p class="mt-1.5 max-w-xl text-sm leading-6 text-slate-500">勾选会直接传给下一步导出。可以先一键应用推荐,再手动微调。</p>
      </div>

      <div class="flex items-center gap-2">
        <div class="rounded-xl bg-slate-50 px-3 py-2 text-right">
          <p class="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">已选</p>
          <p class="text-lg font-semibold tabular-nums text-slate-950">{{ selectedFeatures.length }}<span class="ml-1 text-xs font-medium text-slate-400">/ {{ availableColumns.length }}</span></p>
        </div>
      </div>
    </div>

    <div class="mt-4 flex flex-wrap gap-2">
      <button
        type="button"
        class="inline-flex h-10 items-center gap-1.5 rounded-xl bg-slate-950 px-3.5 text-sm font-semibold text-white transition hover:bg-slate-800"
        @click="applyRecommended"
      >
        <Sparkles class="h-3.5 w-3.5" />
        应用推荐 ({{ recommendedFeatures.length }})
      </button>
      <button type="button" class="inline-flex h-10 items-center rounded-xl border border-slate-200 bg-white px-3.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50" @click="selectAll">
        全选
      </button>
      <button type="button" class="inline-flex h-10 items-center rounded-xl border border-slate-200 bg-white px-3.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50" @click="clearAll">
        清空
      </button>
    </div>

    <div v-if="availableColumns.length" class="mt-5 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
      <button
        v-for="feature in availableColumns"
        :key="feature"
        type="button"
        class="group rounded-xl border px-3 py-2.5 text-left transition"
        :class="selectedSet.has(feature) ? 'border-emerald-300 bg-emerald-50/70' : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'"
        @click="toggle(feature)"
      >
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0">
            <div class="flex flex-wrap items-center gap-1.5">
              <p class="truncate text-sm font-semibold text-slate-950">{{ feature }}</p>
              <span
                v-if="recommendedSet.has(feature)"
                class="rounded-full bg-indigo-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-indigo-700"
              >
                推荐
              </span>
            </div>
            <p class="mt-0.5 truncate text-xs text-slate-500">{{ SEMANTIC_MAP[feature]?.title || formatColumnLabel(feature) }}</p>
          </div>
          <span
            class="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold"
            :class="selectedSet.has(feature) ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-400 group-hover:bg-slate-200'"
          >
            <Check v-if="selectedSet.has(feature)" class="h-3.5 w-3.5" />
            <span v-else>+</span>
          </span>
        </div>
        <button
          type="button"
          class="mt-1.5 text-[10px] font-medium text-slate-400 underline-offset-2 hover:text-indigo-600 hover:underline"
          @click.stop="emit('focus', feature)"
        >
          查看含义
        </button>
      </button>
    </div>

    <div v-else class="mt-5 rounded-xl bg-slate-50 px-4 py-6 text-sm text-slate-500">
      当前数据集还没有可供选择的特征列。
    </div>
  </article>
</template>
