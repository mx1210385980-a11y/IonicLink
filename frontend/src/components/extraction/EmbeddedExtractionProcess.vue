<script setup lang="ts">
import { computed } from 'vue'

import ExtractionProcessHeader from './ExtractionProcessHeader.vue'
import RawContentPanel from './RawContentPanel.vue'
import type { ExtractorType } from '@/lib/api'
import { useExtractionProcess } from '@/composables/useExtractionProcess'

const props = withDefaults(defineProps<{
  literatureId: number | null
  extractorType?: ExtractorType
  title?: string
}>(), {
  extractorType: 'tribology',
  title: 'Live model output',
})

const literatureIdRef = computed(() => props.literatureId)
const extractorTypeRef = computed(() => props.extractorType)
const proc = useExtractionProcess({
  literatureId: literatureIdRef,
  extractorType: extractorTypeRef,
})
</script>

<template>
  <section class="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
    <div class="mb-3 flex items-center justify-between gap-3">
      <div>
        <h3 class="text-sm font-extrabold text-slate-900">{{ title }}</h3>
        <p class="mt-0.5 text-xs font-semibold text-slate-500">
          Raw rows, normalized rows, kept/dropped reasons, and run telemetry.
        </p>
      </div>
      <span class="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-black uppercase tracking-[0.12em] text-slate-500">
        {{ extractorType }}
      </span>
    </div>

    <div v-if="literatureId == null" class="rounded-md border border-dashed bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
      Select or start extracting a paper to inspect the model output here.
    </div>
    <template v-else>
      <ExtractionProcessHeader :process="proc" />
      <div
        v-if="proc.phase.value === 'idle' && !proc.loading.value"
        class="mt-3 rounded-md border border-dashed bg-slate-50 px-4 py-6 text-center text-sm font-semibold text-slate-500"
      >
        Waiting for this paper's extraction run.
      </div>
      <div v-else class="mt-4 max-h-[22rem] overflow-y-auto pr-1">
        <RawContentPanel
          :groups="proc.itemsByPage.value"
          :rollup="proc.rollup.value"
          :loading="proc.rawLoading.value"
          :phase="proc.phase.value"
        />
      </div>
    </template>
  </section>
</template>
