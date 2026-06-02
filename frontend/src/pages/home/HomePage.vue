<script setup lang="ts">
import { computed, toRef } from 'vue'
import {
  ArrowRight,
  ListChecks,
  Table2,
  Upload,
} from 'lucide-vue-next'

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

const { summary } = useHomeSummary({
  files: toRef(props, 'files'),
  activeRun: toRef(props, 'activeRun'),
  latestWorkflow: toRef(props, 'latestWorkflow'),
  preferredTrainingDatasetId: toRef(props, 'preferredTrainingDatasetId'),
})

const extractionStatusItems = computed(() => [
  { label: 'Active', value: summary.value.today.runningRuns },
  { label: 'Rows', value: summary.value.health.datasetReadyRecords },
  { label: 'Review', value: summary.value.today.reviewPending },
])

const primaryAction = {
  label: 'Upload PDF papers',
  detail: 'Start a clean extraction run.',
  target: 'upload-pdfs',
}

const secondaryActions = [
  { label: 'Database', detail: 'Review rows', icon: Table2, target: 'database' },
  { label: 'Evidence', detail: 'Check sources', icon: ListChecks, target: 'library/explorer' },
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
  <section class="grid h-full min-h-full w-full place-items-center overflow-y-auto bg-white px-6 py-10 text-slate-950">
    <div class="w-full max-w-[42rem]">
      <p class="text-[11px] font-black uppercase tracking-[0.34em] text-[#0f7c82]">IonicLink Extract</p>
      <h1 class="mt-3 text-4xl font-black text-slate-950">Add papers. Review rows.</h1>
      <p class="mt-3 max-w-xl text-base font-medium leading-7 text-slate-500">
        Upload PDFs, choose Lubrication or Diffusion, then finish evidence review in Database.
      </p>

      <button
        type="button"
        class="mt-8 flex w-full items-center justify-between gap-5 rounded-lg border border-[#0f7c82]/20 bg-[#0f7c82] px-6 py-6 text-left text-white shadow-[0_22px_50px_-32px_rgba(15,124,130,0.9)] transition hover:-translate-y-0.5 hover:bg-[#0b6870]"
        aria-label="Upload PDF papers"
        @click="emitRoute(primaryAction.label, primaryAction.target)"
      >
        <span class="flex min-w-0 items-center gap-4">
          <span class="grid h-12 w-12 shrink-0 place-items-center rounded-lg bg-white/15">
            <Upload class="h-6 w-6" />
          </span>
          <span class="min-w-0">
            <span class="block text-2xl font-black">{{ primaryAction.label }}</span>
            <span class="mt-1 block text-sm font-semibold leading-6 text-white/75">{{ primaryAction.detail }}</span>
          </span>
        </span>
        <ArrowRight class="h-6 w-6 shrink-0" />
      </button>

      <div class="mt-4 grid gap-3 sm:grid-cols-2">
        <button
          v-for="item in secondaryActions"
          :key="item.label"
          type="button"
          class="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-4 py-4 text-left shadow-sm transition hover:border-[#0f7c82]/40 hover:text-[#0f7c82]"
          @click="emitRoute(item.label, item.target)"
        >
          <span class="flex items-center gap-3">
            <span class="grid h-10 w-10 place-items-center rounded-md bg-slate-50 text-slate-500">
              <component :is="item.icon" class="h-5 w-5" />
            </span>
            <span>
              <span class="block text-sm font-black text-slate-950">{{ item.label }}</span>
              <span class="mt-0.5 block text-xs font-semibold text-slate-500">{{ item.detail }}</span>
            </span>
          </span>
          <ArrowRight class="h-4 w-4 text-slate-400" />
        </button>
      </div>

      <div class="mt-6 grid grid-cols-3 overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
        <div
          v-for="item in extractionStatusItems"
          :key="item.label"
          class="border-r border-slate-200 px-4 py-3 last:border-r-0"
        >
          <p class="text-xl font-black text-slate-950">{{ item.value }}</p>
          <p class="mt-0.5 text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">{{ item.label }}</p>
        </div>
      </div>
    </div>
  </section>
</template>
