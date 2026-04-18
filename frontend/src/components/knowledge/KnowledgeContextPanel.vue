<script setup lang="ts">
import { computed } from 'vue'
import { Download, FolderKanban, GitBranch, ShieldCheck, Sparkles } from 'lucide-vue-next'

const props = defineProps<{
  currentSection: string
  modeLabel: string
  selectedSourceName: string
  activeScopeLabel: string
  selectedRecordCount: number
  explorerDoi: string
  extractorType?: 'tribology' | 'diffusion'
}>()

const emit = defineEmits<{
  openTraining: []
  openReview: []
  changeSection: [section: string]
  exportData: [format: 'json' | 'csv' | 'ndjson']
}>()

const modeNotes: Record<'tribology' | 'diffusion', Record<string, { title: string, body: string, cta: string, nextSection?: string }>> = {
  tribology: {
    explorer: {
      title: 'Grid-first sourcing',
      body: 'Search, filter, inspect, and select records before promoting them into a model-ready bundle.',
      cta: 'Open Review',
    },
    graph: {
      title: 'Relationship scan',
      body: 'Use the graph to see which lubricants, tribopairs, and conditions form reusable clusters.',
      cta: 'Back To Grid',
      nextSection: 'explorer',
    },
    cleaning: {
      title: 'Quality pressure',
      body: 'Resolve noisy or incomplete fields before they flow into builder subsets and exports.',
      cta: 'Open Dataset Builder',
      nextSection: 'datasets',
    },
    datasets: {
      title: 'Builder active',
      body: 'Package cleaned records into reusable datasets for downstream export and modeling.',
      cta: 'Open Review',
    },
  },
  diffusion: {
    explorer: {
      title: 'Diffusion grid',
      body: 'Inspect system, confinement, diffusion coefficients, and evidence before promoting records into the knowledge layer.',
      cta: 'Open Review',
    },
    graph: {
      title: 'Evidence workspace',
      body: 'Diffusion graphing is not enabled yet, so this lane stays focused on evidence-led filtering and record inspection.',
      cta: 'Back To Grid',
      nextSection: 'explorer',
    },
    cleaning: {
      title: 'Field audit',
      body: 'Resolve missing system names, ionic liquids, diffusion coefficients, and evidence before feature export.',
      cta: 'Open Feature Builder',
      nextSection: 'datasets',
    },
    datasets: {
      title: 'Feature builder',
      body: 'Package reviewed diffusion records with SMILES, novel features, and RDKit descriptors for downstream modeling.',
      cta: 'Open Review',
    },
  },
}

function noteFor(section: string): { title: string, body: string, cta: string, nextSection?: string } {
  const extractorType = props.extractorType === 'diffusion' ? 'diffusion' : 'tribology'
  return modeNotes[extractorType][section] ?? modeNotes[extractorType].explorer!
}

const currentNote = computed(() => noteFor(props.currentSection))

function modeIcon(section: string) {
  if (section === 'graph') return GitBranch
  if (section === 'cleaning') return Sparkles
  if (section === 'datasets') return FolderKanban
  return ShieldCheck
}

function handleSecondaryAction() {
  const note = noteFor(props.currentSection)
  if (note.nextSection) {
    emit('changeSection', note.nextSection)
    return
  }
  emit('openReview')
}
</script>

<template>
  <aside class="flex min-h-0 flex-col gap-3">
    <section class="rounded-[1.6rem] border border-[#dce5ef] bg-white px-5 py-5">
      <div class="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.24em] text-[#8ca0ba]">
        <Download class="h-4 w-4" />
        Data Export
      </div>
      <h3 class="mt-3 text-[1.9rem] font-semibold tracking-[-0.05em] leading-[1.15] text-slate-950">Package the current knowledge slice.</h3>
      <p class="mt-5 text-[1.05rem] leading-8 text-slate-500">
        Export the visible, filtered record set from the active knowledge workspace.
      </p>

      <div class="mt-8 grid gap-3">
        <button
          type="button"
          class="inline-flex w-full items-center justify-center rounded-[1.25rem] bg-[#101b29] px-4 py-4 text-base font-semibold text-white transition hover:bg-[#172538]"
          @click="emit('exportData', 'csv')"
        >
          Export CSV
        </button>
        <button
          type="button"
          class="inline-flex w-full items-center justify-center rounded-[1.25rem] border border-[#dde6f1] px-4 py-4 text-base font-semibold text-slate-700 transition hover:bg-[#f8fbff]"
          @click="emit('exportData', 'json')"
        >
          Export JSON
        </button>
        <button
          type="button"
          class="inline-flex w-full items-center justify-center rounded-[1.25rem] border border-[#dde6f1] px-4 py-4 text-base font-semibold text-slate-700 transition hover:bg-[#f8fbff]"
          @click="emit('exportData', 'ndjson')"
        >
          Export NDJSON
        </button>
      </div>
    </section>

    <section class="rounded-[1.6rem] border border-[#dce5ef] bg-white px-5 py-5">
      <div class="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.24em] text-[#8ca0ba]">
        <component :is="modeIcon(props.currentSection)" class="h-4 w-4" />
        {{ props.modeLabel }}
      </div>
      <h3 class="mt-3 text-[1.35rem] font-semibold tracking-[-0.04em] text-slate-950">{{ currentNote.title }}</h3>
      <p class="mt-3 text-sm leading-7 text-slate-600">{{ currentNote.body }}</p>

      <div class="mt-5 grid gap-3">
        <div class="rounded-[1rem] border border-[#edf2f7] bg-[#fafcff] px-4 py-3">
          <p class="text-[11px] font-bold uppercase tracking-[0.2em] text-[#8ca0ba]">Current DOI</p>
          <p class="mt-2 text-sm font-medium text-slate-700">{{ props.explorerDoi || 'All visible literature' }}</p>
        </div>
      </div>

      <button
        type="button"
        class="mt-5 inline-flex w-full items-center justify-center rounded-[1rem] border border-[#dde6f1] px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-[#f8fbff]"
        @click="handleSecondaryAction"
      >
        {{ currentNote.cta }}
      </button>
    </section>
  </aside>
</template>
