<script setup lang="ts">
import { computed, toRef } from 'vue'
import { ArrowRight, Upload } from 'lucide-vue-next'

import { useHomeSummary, type HomeSuggestedAction } from '@/composables/useHomeSummary'
import type { AgentWorkflow, BatchFile, ChatSource, ExtractionRunDetail } from '@/lib/api'

const props = defineProps<{
  activeScopeLabel: string
  operatorName: string
  files: BatchFile[]
  activeRun: ExtractionRunDetail | null
  latestWorkflow: AgentWorkflow | null
  preferredTrainingDatasetId: number | null
  canAccessAdmin: boolean
}>()

const emit = defineEmits<{
  action: [action: HomeSuggestedAction]
  openSource: [source: ChatSource]
}>()

const { summary, loading } = useHomeSummary({
  files: toRef(props, 'files'),
  activeRun: toRef(props, 'activeRun'),
  latestWorkflow: toRef(props, 'latestWorkflow'),
  preferredTrainingDatasetId: toRef(props, 'preferredTrainingDatasetId'),
  canAccessAdmin: toRef(props, 'canAccessAdmin'),
})

const extractionStatusItems = computed(() => [
  {
    label: 'Needs review',
    value: loading.value ? '--' : summary.value.today.reviewPending,
    target: 'review-evidence',
  },
  {
    label: 'Official database',
    value: loading.value ? '--' : summary.value.health.officialDatabaseRecords,
    target: 'database',
  },
])

// Drop metrics that are zero so a fresh-but-not-empty workspace shows only the
// numbers that matter. Loading placeholders ('--') and non-zero counts are kept.
const visibleStatusItems = computed(() =>
  extractionStatusItems.value.filter((item) => item.value !== 0),
)

const isEmptyWorkspace = computed(() => {
  return !loading.value
    && props.files.length === 0
    && summary.value.today.runningRuns === 0
    && summary.value.health.officialDatabaseRecords === 0
    && summary.value.health.datasetReadyRecords === 0
    && summary.value.today.reviewPending === 0
})

const primaryAction = {
  label: 'Upload PDF papers',
  detail: 'Start a clean extraction run.',
  target: 'upload-pdfs',
}

const secondaryActions = [
  { label: 'Database', target: 'database' },
  { label: 'Review Queue', target: 'review-evidence' },
]

function routeAction(label: string, target: string): HomeSuggestedAction {
  return {
    id: `home-${target.replace(/[^\w]+/g, '-')}-${label.toLowerCase().replace(/[^\w]+/g, '-')}`,
    label,
    description: label,
    actionType: 'route',
    target,
    priority: 'medium',
  }
}

function emitRoute(label: string, target: string) {
  emit('action', routeAction(label, target))
}
</script>

<template>
  <section class="grid min-h-full w-full place-items-center overflow-y-auto bg-[#f8fbfc] px-6 py-14 text-slate-950">
    <div class="w-full max-w-[30rem] text-center">
      <p class="text-[11px] font-black uppercase tracking-[0.34em] text-[#0f7c82]">IonicLink Extract</p>
      <h1 class="mt-4 text-4xl font-black leading-tight text-slate-950">Add papers. Review rows.</h1>
      <p class="mx-auto mt-3 max-w-xs text-base font-medium leading-7 text-slate-500">
        Upload PDFs, extract the data, review the evidence.
      </p>

      <button
        type="button"
        class="mt-10 flex w-full items-center justify-between gap-5 rounded-xl bg-[#0f7c82] px-6 py-5 text-left text-white shadow-[0_22px_50px_-32px_rgba(15,124,130,0.9)] transition hover:-translate-y-0.5 hover:bg-[#0b6870]"
        aria-label="Upload PDF papers"
        @click="emitRoute(primaryAction.label, primaryAction.target)"
      >
        <span class="flex min-w-0 items-center gap-4">
          <span class="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-white/15">
            <Upload class="h-5 w-5" />
          </span>
          <span class="min-w-0">
            <span class="block text-xl font-black">{{ primaryAction.label }}</span>
            <span class="mt-0.5 block text-sm font-semibold leading-6 text-white/75">{{ primaryAction.detail }}</span>
          </span>
        </span>
        <ArrowRight class="h-5 w-5 shrink-0" />
      </button>

      <div class="mt-6 flex items-center justify-center gap-8">
        <button
          v-for="item in secondaryActions"
          :key="item.label"
          type="button"
          class="text-sm font-bold text-slate-500 underline-offset-[6px] transition hover:text-[#0f7c82] hover:underline"
          @click="emitRoute(item.label, item.target)"
        >
          {{ item.label }}
        </button>
      </div>

      <p
        v-if="isEmptyWorkspace"
        class="mx-auto mt-10 max-w-sm border-t border-slate-200 pt-6 text-sm font-semibold leading-6 text-slate-400"
      >
        No papers in this workspace yet. Your first useful step is importing a source PDF.
      </p>
      <div
        v-else-if="visibleStatusItems.length"
        class="mt-10 flex items-center justify-center gap-3 border-t border-slate-200 pt-6 text-sm text-slate-400"
      >
        <template v-for="(item, index) in visibleStatusItems" :key="item.label">
          <span v-if="index > 0" class="text-slate-300" aria-hidden="true">·</span>
          <button
            type="button"
            class="font-semibold transition hover:text-[#0f7c82]"
            @click="emitRoute(item.label, item.target)"
          >
            <span class="font-black text-slate-700">{{ item.value }}</span>
            {{ item.label }}
          </button>
        </template>
      </div>
    </div>
  </section>
</template>
