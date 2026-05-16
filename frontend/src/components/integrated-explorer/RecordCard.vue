<script setup lang="ts">
import { computed } from 'vue'

import type { EvidenceResult, RecordResponse } from '@/lib/api'
import { canonicalExperimentScaleValue, experimentScaleBadgeClass, experimentScaleLabel } from '@/lib/experimentScale'
import {
  cofDisplay,
  confidenceDisplay,
  confidenceValueFor,
  formatIonicLiquidPartHtml,
  ionicLiquidParts,
  lubricantAliasDisplay,
  type LubricantDisplayLine,
  lubricantDisplayRows,
  tribopairDisplay,
} from '@/lib/integratedExplorerHelpers'

const props = withDefaults(defineProps<{
  record: RecordResponse
  evidence?: EvidenceResult | null
  eyebrow?: string
}>(), {
  evidence: null,
  eyebrow: 'Record Summary',
})

const confidenceValue = computed(() => confidenceValueFor(props.record, props.evidence))
const experimentScaleValue = computed(() => canonicalExperimentScaleValue(
  props.record.experimentScale
  || props.record.experimentProfile?.scale
  || props.record.tribologicalSystem?.scale,
))
const experimentScaleDisplay = computed(() => experimentScaleValue.value ? experimentScaleLabel(experimentScaleValue.value) : '')

function lubricantLineClass(line: LubricantDisplayLine): string {
  if (line.kind === 'ratio') return 'mt-1'
  return line.emphasis === 'secondary'
    ? 'text-sm font-semibold text-slate-500 dark:text-slate-400'
    : 'text-base font-bold text-slate-900 dark:text-slate-100'
}
</script>

<template>
  <div class="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-950">
    <div class="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">
      {{ eyebrow }}
    </div>
    <div class="mt-2 leading-tight">
      <span
        v-for="(line, lineIndex) in lubricantDisplayRows(record)"
        :key="`${record.id}-card-il-${lineIndex}-${line.text}`"
        class="block"
        :class="lubricantLineClass(line)"
      >
        <template v-if="line.kind === 'ratio'">
          <span class="inline-flex items-center gap-1.5 rounded-[0.25rem] bg-[#f8fafc] px-1.5 py-[2px] text-[9.5px] font-bold text-[#475569] shadow-[inset_0_0_0_1px_rgba(226,232,240,1)] dark:bg-slate-800 dark:text-slate-300 dark:shadow-[inset_0_0_0_1px_rgba(51,65,85,1)]">
            <span class="text-[8.5px] font-black uppercase tracking-wider text-[#94a3b8] dark:text-slate-500">Ratio</span>
            {{ line.text.slice(1, -1) }}
          </span>
        </template>
        <template v-else>
          <span
            v-for="(part, partIndex) in ionicLiquidParts(line.text)"
            :key="`${record.id}-card-il-${lineIndex}-${partIndex}-${part}`"
            class="inline whitespace-normal break-words"
            v-html="formatIonicLiquidPartHtml(part)"
          />
        </template>
      </span>
    </div>
    <div
      v-if="lubricantAliasDisplay(record)"
      class="mt-1 inline-flex max-w-full items-center gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-[10px] font-bold text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300"
    >
      <span class="shrink-0 text-[9px] font-black uppercase tracking-wider text-amber-600/80 dark:text-amber-300/80">Alias</span>
      <span class="min-w-0 truncate">{{ lubricantAliasDisplay(record) }}</span>
    </div>
    <div class="mt-2 text-sm text-slate-600 dark:text-slate-300">
      {{ tribopairDisplay(record) }}
    </div>
    <div class="mt-4 flex flex-wrap gap-2 text-[11px] font-semibold">
      <span
        v-if="experimentScaleDisplay"
        class="rounded-full border px-3 py-1"
        :class="experimentScaleBadgeClass(experimentScaleValue)"
        :title="experimentScaleValue"
      >
        尺度 {{ experimentScaleDisplay }}
      </span>
      <span class="rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-blue-700 dark:border-blue-500/20 dark:bg-blue-500/10 dark:text-blue-300">
        COF {{ cofDisplay(record) }}
      </span>
      <span class="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300">
        Confidence {{ confidenceDisplay(confidenceValue) }}
      </span>
      <span class="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
        Record #{{ record.id }}
      </span>
    </div>
  </div>
</template>
