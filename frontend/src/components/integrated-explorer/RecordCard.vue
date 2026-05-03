<script setup lang="ts">
import { computed } from 'vue'

import type { EvidenceResult, RecordResponse } from '@/lib/api'
import {
  cofDisplay,
  confidenceDisplay,
  confidenceValueFor,
  formatIonicLiquidHtml,
  lubricantDisplay,
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
</script>

<template>
  <div class="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-950">
    <div class="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">
      {{ eyebrow }}
    </div>
    <div class="mt-2 text-base font-semibold text-slate-900 dark:text-slate-100" v-html="formatIonicLiquidHtml(lubricantDisplay(record))"></div>
    <div class="mt-2 text-sm text-slate-600 dark:text-slate-300">
      {{ tribopairDisplay(record) }}
    </div>
    <div class="mt-4 flex flex-wrap gap-2 text-[11px] font-semibold">
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
