<script setup lang="ts">
import { computed } from 'vue'
import { ArrowRight, CheckCircle2, RefreshCcw, Sparkles, TriangleAlert, XCircle } from 'lucide-vue-next'
import type { NextActionTarget, QualitySeverity } from './useQualityIssues'

type ProgressTone = 'slate' | 'emerald' | 'rose' | 'amber'
type ProgressItem = { label: string; value: number; helper: string; tone: ProgressTone }

const props = defineProps<{
  stageLabel: string
  progressItems: ProgressItem[]
  verdict: { tone: QualitySeverity; label: string; helper: string }
  nextAction: { target: NextActionTarget; label: string; title: string; description: string }
  rebuilding: boolean
}>()

const emit = defineEmits<{
  (e: 'primary-action'): void
  (e: 'rebuild-recommended'): void
}>()

const verdictIcon = computed(() => {
  if (props.verdict.tone === 'ok') return CheckCircle2
  if (props.verdict.tone === 'watch') return TriangleAlert
  return XCircle
})

const verdictBgClass = computed(() => {
  if (props.verdict.tone === 'ok') return 'bg-emerald-50 border-emerald-200 text-emerald-800'
  if (props.verdict.tone === 'watch') return 'bg-amber-50 border-amber-200 text-amber-800'
  return 'bg-rose-50 border-rose-200 text-rose-800'
})

function progressToneClass(tone: ProgressTone) {
  if (tone === 'rose') return 'bg-rose-50 text-rose-900 ring-rose-100'
  if (tone === 'amber') return 'bg-amber-50 text-amber-900 ring-amber-100'
  if (tone === 'emerald') return 'bg-emerald-50 text-emerald-900 ring-emerald-100'
  return 'bg-slate-50 text-slate-900 ring-slate-200'
}

function progressValueClass(tone: ProgressTone) {
  if (tone === 'rose') return 'text-rose-700'
  if (tone === 'amber') return 'text-amber-700'
  if (tone === 'emerald') return 'text-emerald-700'
  return 'text-slate-900'
}
</script>

<template>
  <section class="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div class="min-w-0">
        <div class="inline-flex items-center gap-1.5 rounded-full border border-indigo-100 bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-indigo-700">
          <Sparkles class="h-3 w-3" />
          数据清洗工作台
        </div>
        <h1 class="mt-2 text-xl font-semibold tracking-tight text-slate-950 sm:text-2xl">
          先清洗,再训练
          <span class="ml-2 inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700 align-middle">
            {{ stageLabel }}
          </span>
        </h1>
      </div>

      <button
        type="button"
        class="inline-flex h-9 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
        :disabled="rebuilding"
        @click="emit('rebuild-recommended')"
      >
        <RefreshCcw class="h-3.5 w-3.5" :class="rebuilding && 'animate-spin'" />
        {{ rebuilding ? '重建中' : '恢复推荐' }}
      </button>
    </div>

    <div class="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
      <div
        v-for="item in progressItems"
        :key="item.label"
        class="rounded-xl px-3 py-2.5 ring-1"
        :class="progressToneClass(item.tone)"
      >
        <p class="whitespace-nowrap text-[10px] font-semibold uppercase tracking-wider opacity-80">{{ item.label }}</p>
        <p class="mt-0.5 text-2xl font-semibold leading-none tabular-nums" :class="progressValueClass(item.tone)">{{ item.value }}</p>
        <p class="mt-1 truncate text-[11px] leading-4 opacity-80">{{ item.helper }}</p>
      </div>
    </div>

    <div
      class="mt-3 flex flex-wrap items-center gap-3 rounded-xl border px-3.5 py-3"
      :class="verdictBgClass"
    >
      <component :is="verdictIcon" class="h-5 w-5 shrink-0" />
      <div class="min-w-0 flex-1">
        <p class="text-sm font-semibold">{{ nextAction.title }}</p>
        <p class="mt-0.5 text-xs leading-5 opacity-90">{{ nextAction.description }}</p>
      </div>
      <button
        type="button"
        class="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-xl bg-slate-950 px-4 text-sm font-semibold text-white transition hover:bg-slate-800"
        @click="emit('primary-action')"
      >
        {{ nextAction.label }}
        <ArrowRight class="h-4 w-4" />
      </button>
    </div>
  </section>
</template>
