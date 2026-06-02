<script setup lang="ts">
import { computed, ref, toRef } from 'vue'
import {
  ArrowRight,
  BookOpen,
  ChevronDown,
  LayoutGrid,
  ListChecks,
  Lock,
  MessageCircle,
  Search,
  Square,
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

const queryText = ref('')
const modeMenuOpen = ref(false)
const activeModeLabel = ref('Extraction workflow')

const modeMenuSections = [
  {
    label: 'WORKFLOWS',
    items: [
      { label: 'Extraction workflow', icon: BookOpen, target: 'upload-pdfs', locked: false },
      { label: 'Research agent', icon: LayoutGrid, target: 'library/explorer', locked: false },
      { label: 'Report', icon: Square, target: null, locked: false },
      { label: 'Systematic review', icon: ListChecks, target: null, locked: true },
    ],
  },
  {
    label: 'TOOLS',
    items: [
      { label: 'Extract data', icon: BookOpen, target: 'upload-pdfs', locked: false },
      { label: 'Database', icon: Table2, target: 'database', locked: false },
      { label: 'Find papers', icon: Search, target: 'library/explorer', locked: false },
      { label: 'Chat with papers', icon: MessageCircle, target: 'library/explorer', locked: false },
    ],
  },
]

const primaryWorkflowActions = [
  {
    label: 'Extraction workbench',
    eyebrow: 'Upload and extract',
    description: 'Run tribology or diffusion extraction with live worker status.',
    metric: computed(() => `${summary.value.today.runningRuns} active`),
    icon: BookOpen,
    target: 'upload-pdfs',
    tone: 'primary',
  },
  {
    label: 'Database workspace',
    eyebrow: 'Structured records',
    description: 'Open the unified table for candidates, records, and evidence.',
    metric: computed(() => `${summary.value.health.datasetReadyRecords} records`),
    icon: Table2,
    target: 'database',
    tone: 'secondary',
  },
  {
    label: 'Review evidence',
    eyebrow: 'Grounding queue',
    description: 'Check field-level evidence before publishing extracted data.',
    metric: computed(() => `${summary.value.today.reviewPending} checks`),
    icon: ListChecks,
    target: 'library/explorer',
    tone: 'review',
  },
]

const extractionCommandMetrics = computed(() => [
  { label: 'Active runs', value: summary.value.today.runningRuns },
  { label: 'Structured records', value: summary.value.health.datasetReadyRecords },
  { label: 'Evidence checks', value: summary.value.today.reviewPending },
])

const quickActions = [
  { label: 'Open Database', icon: Table2, target: 'database' },
  { label: 'Review evidence', icon: ListChecks, target: 'library/explorer' },
  { label: 'Upload papers', icon: Upload, target: 'upload-pdfs' },
]

const suggestedCards = computed(() => [
  {
    title: 'Extract COF from selected PDFs',
    body: `${summary.value.today.runningRuns} active runs in ${props.activeScopeLabel || 'Group Library'}.`,
    target: 'upload-pdfs',
  },
  {
    title: 'Review evidence for tables and figures',
    body: `${summary.value.today.reviewPending} items waiting for evidence checks.`,
    target: 'library/explorer',
  },
  {
    title: 'Build a modeling dataset',
    body: `${summary.value.health.datasetReadyRecords} records ready for downstream analysis.`,
    target: 'library/datasets',
  },
])

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

function toggleModeMenu() {
  modeMenuOpen.value = !modeMenuOpen.value
}

function closeModeMenu() {
  modeMenuOpen.value = false
}

function isModeItemLocked(item: (typeof modeMenuSections)[number]['items'][number]) {
  return item.locked && !props.canAccessAdmin
}

function selectMode(item: (typeof modeMenuSections)[number]['items'][number]) {
  if (isModeItemLocked(item)) return
  activeModeLabel.value = item.label
  closeModeMenu()
  if (item.target) {
    emitRoute(item.label, item.target)
  }
}

function submitResearchQuestion() {
  const query = queryText.value.trim()
  if (!query && activeModeLabel.value === 'Extraction workflow') {
    emitRoute('Extraction workflow', 'upload-pdfs')
    return
  }
  if (!query) return
  emitRoute(query, 'library/explorer')
}
</script>

<template>
  <section class="mx-auto flex h-full min-h-full w-full max-w-6xl flex-col items-center justify-start overflow-y-auto px-6 py-10 text-slate-950">
    <div class="w-full max-w-[58rem]">
      <p class="text-[11px] font-black uppercase tracking-[0.32em] text-[#0f7c82]">Extraction command center</p>
      <div class="mt-2 flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <h1 class="text-3xl font-black tracking-tight text-slate-950">Extract, verify, publish.</h1>
          <p class="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
            Start with a paper, finish in the database. The main workflow stays on extraction status and field evidence.
          </p>
        </div>
        <div class="grid min-w-[20rem] grid-cols-3 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div
            v-for="metric in extractionCommandMetrics"
            :key="metric.label"
            class="border-r border-slate-200 px-3 py-3 last:border-r-0"
          >
            <p class="text-lg font-black tracking-tight text-slate-950">{{ metric.value }}</p>
            <p class="mt-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-400">{{ metric.label }}</p>
          </div>
        </div>
      </div>
    </div>

    <div class="mt-6 grid w-full max-w-[58rem] gap-3 lg:grid-cols-3">
      <button
        v-for="action in primaryWorkflowActions"
        :key="action.label"
        type="button"
        class="group flex min-h-[7rem] flex-col justify-between rounded-xl border px-5 py-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
        :class="[
          action.tone === 'primary'
            ? 'border-[#0f7c82] bg-[#0f7c82] text-white shadow-[#0f7c82]/20 hover:bg-[#0b6c72]'
            : action.tone === 'secondary'
              ? 'border-[#39546a] bg-[#39546a] text-white shadow-slate-300/40 hover:bg-[#31495c]'
              : 'border-slate-200 bg-white text-slate-950 hover:border-[#0f7c82]/50',
        ]"
        @click="emitRoute(action.label, action.target)"
      >
        <span class="flex w-full min-w-0 items-start justify-between gap-4">
          <span>
            <span class="text-[10px] font-black uppercase tracking-[0.22em]" :class="action.tone === 'review' ? 'text-[#0f7c82]' : 'text-white/70'">
              {{ action.eyebrow }}
            </span>
            <span class="mt-2 block text-xl font-black tracking-tight">{{ action.label }}</span>
          </span>
          <span class="grid h-11 w-11 shrink-0 place-items-center rounded-lg" :class="action.tone === 'review' ? 'bg-[#e6f5f4] text-[#0f7c82]' : 'bg-white/15 text-white'">
            <component :is="action.icon" class="h-5 w-5" />
          </span>
        </span>
        <span class="mt-4 flex w-full items-end justify-between gap-3">
          <span class="text-sm leading-5" :class="action.tone === 'review' ? 'text-slate-500' : 'text-white/78'">{{ action.description }}</span>
          <span class="shrink-0 text-xs font-black uppercase tracking-wide" :class="action.tone === 'review' ? 'text-slate-500' : 'text-white/70'">{{ action.metric.value }}</span>
        </span>
      </button>
    </div>

    <div class="relative mt-5 w-full max-w-[58rem] rounded-xl border border-[#2e6c76] bg-white shadow-[0_10px_24px_rgba(15,80,90,0.12)]">
      <div class="relative z-20 rounded-t-[1rem] bg-[#2e6c76] px-4 py-3">
        <button
          type="button"
          class="inline-flex items-center gap-2 rounded-lg border border-white/20 bg-[#0f7c82]/70 px-4 py-2 text-sm font-semibold text-white shadow-sm"
          aria-haspopup="menu"
          :aria-expanded="modeMenuOpen"
          @click="toggleModeMenu"
        >
          <LayoutGrid class="h-4 w-4" />
          {{ activeModeLabel }}
          <ChevronDown class="h-4 w-4" />
        </button>

        <div
          v-if="modeMenuOpen"
          class="absolute left-4 top-[calc(100%+0.75rem)] z-30 w-[23.5rem] rounded-lg border border-slate-200 bg-white p-2 text-slate-800 shadow-[0_18px_42px_rgba(15,23,42,0.18)]"
          role="menu"
          aria-label="Research modes"
        >
          <section
            v-for="section in modeMenuSections"
            :key="section.label"
            class="py-2"
          >
            <p class="px-4 pb-2 text-xs font-bold uppercase tracking-wide text-slate-400">{{ section.label }}</p>
            <button
              v-for="item in section.items"
              :key="item.label"
              type="button"
              class="flex w-full items-center gap-3 rounded-md px-4 py-3 text-left text-base font-semibold transition"
              :class="[
                isModeItemLocked(item) ? 'text-slate-500' : 'text-slate-800 hover:bg-slate-100 hover:text-[#0f7c82]',
                activeModeLabel === item.label ? 'bg-slate-100 text-[#0f7c82]' : '',
              ]"
              role="menuitem"
              :aria-disabled="isModeItemLocked(item) ? 'true' : undefined"
              @click="selectMode(item)"
            >
              <component
                :is="item.icon"
                class="h-4 w-4 shrink-0"
                :class="activeModeLabel === item.label ? 'text-[#0f7c82]' : 'text-slate-500'"
              />
              <span class="min-w-0 flex-1">{{ item.label }}</span>
              <span
                v-if="isModeItemLocked(item)"
                class="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs font-semibold uppercase tracking-wide text-slate-500"
              >
                <Lock class="h-3 w-3" />
                PRO
              </span>
            </button>
          </section>
        </div>
      </div>

      <textarea
        v-model="queryText"
        rows="3"
        class="block w-full resize-none border-0 px-8 py-5 text-base leading-7 text-slate-800 outline-none placeholder:text-slate-400"
        placeholder="Upload a paper, extract friction records, or open the database..."
        @keydown.enter.exact.prevent="submitResearchQuestion"
      />

      <div class="flex items-center justify-between border-t border-slate-200 px-4 py-3">
        <button
          type="button"
          class="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 text-slate-600 transition hover:border-slate-300 hover:bg-slate-50"
          aria-label="Upload papers"
          @click="emitRoute('Upload papers', 'upload-pdfs')"
        >
          <Upload class="h-5 w-5" />
        </button>

        <div class="flex items-center gap-2">
          <button
            type="button"
            class="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-500"
          >
            Extended
          </button>
          <button
            type="button"
            class="flex h-10 w-10 items-center justify-center rounded-lg bg-[#77b6bd] text-white transition hover:bg-[#5aa4ac]"
            aria-label="Run extraction workflow"
            @click="submitResearchQuestion"
          >
            <ArrowRight class="h-5 w-5" />
          </button>
        </div>
      </div>
    </div>

    <div class="mt-8 flex flex-wrap justify-center gap-3">
      <button
        v-for="item in quickActions"
        :key="item.label"
        type="button"
        class="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-800 shadow-sm transition hover:border-[#0f7c82]/50 hover:text-[#0f7c82]"
        @click="emitRoute(item.label, item.target)"
      >
        <component :is="item.icon" class="h-4 w-4 text-slate-500" />
        {{ item.label }}
      </button>
    </div>

    <div class="mt-12 grid w-full max-w-[58rem] gap-4 md:grid-cols-3">
      <button
        v-for="card in suggestedCards"
        :key="card.title"
        type="button"
        class="min-h-[10rem] rounded-2xl border border-slate-200 bg-white p-5 text-left transition hover:-translate-y-0.5 hover:border-[#0f7c82]/40 hover:shadow-md"
        @click="emitRoute(card.title, card.target)"
      >
        <span class="inline-flex items-center rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-500">
          Suggested
        </span>
        <h2 class="mt-4 text-base font-semibold leading-6 text-slate-950">{{ card.title }}</h2>
        <p class="mt-2 text-sm leading-6 text-slate-500">{{ card.body }}</p>
      </button>
    </div>
  </section>
</template>
