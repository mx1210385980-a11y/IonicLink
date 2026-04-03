<script setup lang="ts">
import { computed } from 'vue'
import { ArrowDown, ArrowUp, Flag, MinusCircle, PlusCircle, ShieldCheck } from 'lucide-vue-next'

import type { EvidenceResult, RecordResponse } from '@/lib/api'
import {
  confidenceBoostLabel,
  confidenceBoostValue,
  confidenceDeltaPercent,
  confidenceDetailsFor,
  confidencePenaltyLabel,
  confidencePenaltyValue,
  confidencePercentNumber,
  confidenceValueFor,
} from '@/lib/integratedExplorerHelpers'

const props = withDefaults(defineProps<{
  record: RecordResponse
  evidence?: EvidenceResult | null
  title?: string
  deltaMode?: 'evidence' | 'stored'
  maxBoosts?: number
  maxPenalties?: number
}>(), {
  evidence: null,
  title: 'AI Confidence',
  deltaMode: 'stored',
  maxBoosts: 3,
  maxPenalties: 2,
})

const details = computed(() => confidenceDetailsFor(props.record, props.evidence))
const scorePercent = computed(() => confidencePercentNumber(confidenceValueFor(props.record, props.evidence)))
const deltaPercent = computed(() => confidenceDeltaPercent(props.record, props.evidence))
const confidenceBand = computed(() => {
  if (scorePercent.value >= 80) return 'High Confidence'
  if (scorePercent.value >= 50) return 'Medium Confidence'
  return 'Low Confidence'
})
</script>

<template>
  <div class="rounded-[24px] border border-emerald-100 bg-[linear-gradient(135deg,#ffffff_0%,#effbf6_60%,#d7f7eb_100%)] p-5 shadow-sm dark:border-emerald-500/15 dark:bg-[linear-gradient(135deg,rgba(15,23,42,0.98)_0%,rgba(5,83,64,0.86)_100%)]">
    <div class="flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
      <ShieldCheck class="h-4 w-4 text-emerald-600 dark:text-emerald-300" />
      {{ title }}
    </div>

    <div class="mt-4 flex items-end gap-3">
      <div class="flex items-baseline text-emerald-600 dark:text-emerald-300">
        <span class="text-5xl font-black leading-none tracking-tighter">{{ scorePercent.toFixed(0) }}</span>
        <span class="text-2xl font-bold leading-none">%</span>
      </div>
      <div class="pb-1 text-[11px] font-bold uppercase tracking-[0.18em] text-emerald-600 dark:text-emerald-300">
        {{ confidenceBand }}
      </div>
    </div>

    <div class="mt-3">
      <div
        v-if="deltaPercent > 0"
        class="inline-flex items-center gap-1 rounded-full bg-emerald-100/80 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
      >
        <ArrowUp class="h-3.5 w-3.5" />
        {{ deltaMode === 'evidence' ? 'Live evidence boosted confidence' : `Up from ${confidencePercentNumber(record.confidence).toFixed(0)}% (Stored)` }}
      </div>
      <div
        v-else-if="deltaPercent < 0"
        class="inline-flex items-center gap-1 rounded-full bg-rose-100/80 px-2.5 py-1 text-[11px] font-semibold text-rose-700 dark:bg-rose-500/15 dark:text-rose-300"
      >
        <ArrowDown class="h-3.5 w-3.5" />
        {{ deltaMode === 'evidence' ? 'Stored score exceeds live evidence' : `Down from ${confidencePercentNumber(record.confidence).toFixed(0)}% (Stored)` }}
      </div>
      <div
        v-else
        class="inline-flex items-center gap-1 rounded-full bg-white/80 px-2.5 py-1 text-[11px] font-semibold text-slate-600 ring-1 ring-slate-200/70 dark:bg-slate-950/40 dark:text-slate-300 dark:ring-slate-700/70"
      >
        Synced with stored confidence
      </div>
    </div>

    <div class="mt-4 rounded-2xl border border-white/80 bg-white/70 p-4 shadow-sm backdrop-blur dark:border-slate-800/80 dark:bg-slate-950/45">
      <div class="flex items-center justify-between text-sm text-slate-600 dark:text-slate-300">
        <div class="flex items-center gap-2">
          <Flag class="h-4 w-4" />
          <span>Base Score</span>
        </div>
        <span class="font-bold text-slate-800 dark:text-slate-100">{{ details.base_percent.toFixed(0) }}</span>
      </div>

      <div class="mt-4 space-y-2">
        <div
          v-for="(boost, idx) in details.boosts.slice(0, maxBoosts)"
          :key="`boost-${idx}`"
          class="flex items-start justify-between gap-3 text-emerald-700 dark:text-emerald-300"
        >
          <div class="flex items-start gap-2">
            <PlusCircle class="mt-0.5 h-4 w-4 shrink-0" />
            <span class="text-[13px] leading-5">{{ confidenceBoostLabel(boost.reason) }}</span>
          </div>
          <span class="shrink-0 text-sm font-bold">{{ confidenceBoostValue(boost.value) }}</span>
        </div>
        <div
          v-if="!details.boosts.length"
          class="text-[13px] text-slate-500 dark:text-slate-400"
        >
          No confidence boosts applied
        </div>

        <div
          v-for="(penalty, idx) in details.penalties.slice(0, maxPenalties)"
          :key="`penalty-${idx}`"
          class="flex items-start justify-between gap-3 text-rose-600 dark:text-rose-300"
        >
          <div class="flex items-start gap-2">
            <MinusCircle class="mt-0.5 h-4 w-4 shrink-0" />
            <span class="text-[13px] leading-5">{{ confidencePenaltyLabel(penalty.reason) }}</span>
          </div>
          <span class="shrink-0 text-sm font-bold">{{ confidencePenaltyValue(penalty.value) }}</span>
        </div>
      </div>
    </div>

    <div class="mt-4 h-2 overflow-hidden rounded-full bg-emerald-100/80 dark:bg-slate-800">
      <div
        class="h-full rounded-full bg-emerald-500 transition-all"
        :style="{ width: `${scorePercent}%` }"
      />
    </div>
  </div>
</template>
