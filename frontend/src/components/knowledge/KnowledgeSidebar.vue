<script setup lang="ts">
import { ArrowUpRight, BookOpen, Database, FolderKanban, GitBranch, Sparkles } from 'lucide-vue-next'

type KnowledgeMode = {
  key: string
  label: string
  count?: number | null
}

const props = defineProps<{
  currentSection: string
  modes: KnowledgeMode[]
  activeScopeLabel: string
  selectedSourceName: string
  selectedRecordCount: number
}>()

const emit = defineEmits<{
  select: [section: string]
  openReview: []
}>()

function iconFor(section: string) {
  if (section === 'graph') return GitBranch
  if (section === 'cleaning') return Sparkles
  if (section === 'datasets') return FolderKanban
  return Database
}
</script>

<template>
  <aside class="flex min-h-0 flex-col rounded-[1.8rem] border border-[#dbe5f0] bg-[#eff4fa] p-4">
    <div>
      <p class="text-[11px] font-bold uppercase tracking-[0.24em] text-[#8ca0ba]">Asset Explorer</p>
      <div class="mt-4 space-y-2">
        <button
          v-for="mode in props.modes"
          :key="mode.key"
          type="button"
          class="flex w-full items-center justify-between rounded-[1rem] border px-3.5 py-3 text-left transition"
          :class="mode.key === props.currentSection
            ? 'border-[#cfd9ff] bg-white text-[#4c4fdc] shadow-[0_18px_35px_-28px_rgba(76,79,220,0.6)]'
            : 'border-transparent bg-transparent text-slate-700 hover:border-[#d9e3ef] hover:bg-white/80'"
          @click="emit('select', mode.key)"
        >
          <span class="flex items-center gap-3">
            <component :is="iconFor(mode.key)" class="h-4.5 w-4.5" />
            <span class="text-[1rem] font-semibold">{{ mode.label }}</span>
          </span>
          <span
            v-if="mode.count !== undefined && mode.count !== null"
            class="rounded-[0.65rem] px-2 py-1 text-xs font-semibold"
            :class="mode.key === props.currentSection ? 'bg-[#eef0ff] text-[#4c4fdc]' : 'bg-[#ffeef1] text-[#f04d75]'"
          >
            {{ mode.count }}
          </span>
        </button>
      </div>
    </div>

    <div class="mt-8">
      <div class="flex items-center justify-between gap-3">
        <p class="text-[11px] font-bold uppercase tracking-[0.24em] text-[#8ca0ba]">Pinned Assets</p>
        <span class="text-sm text-[#93a2b8]">...</span>
      </div>

      <div class="mt-4 space-y-3">
        <article class="rounded-[1.15rem] border border-white/70 bg-white/88 px-4 py-4 shadow-[0_14px_32px_-28px_rgba(15,23,42,0.35)]">
          <p class="text-[0.98rem] font-semibold tracking-[-0.03em] text-slate-900">{{ props.selectedSourceName }}</p>
          <div class="mt-2 flex items-center gap-3 text-sm text-slate-500">
            <span>{{ props.selectedRecordCount }} records</span>
            <span class="font-semibold text-[#5a6f8d]">ACTIVE SOURCE</span>
          </div>
        </article>

        <article class="rounded-[1.15rem] border border-white/70 bg-white/88 px-4 py-4 shadow-[0_14px_32px_-28px_rgba(15,23,42,0.35)]">
          <p class="text-[0.98rem] font-semibold tracking-[-0.03em] text-slate-900">{{ props.activeScopeLabel }}</p>
          <div class="mt-2 flex items-center gap-3 text-sm text-slate-500">
            <span>Account-linked library</span>
            <span class="font-semibold text-[#5a6f8d]">WORKSPACE</span>
          </div>
        </article>

        <article class="rounded-[1.15rem] border border-dashed border-[#d7e0ed] bg-[#f8fbff] px-4 py-4">
          <p class="text-[0.95rem] font-semibold tracking-[-0.02em] text-slate-800">Dataset Builder Queue</p>
          <p class="mt-2 text-sm leading-6 text-slate-500">
            Promote verified records into a clean, exportable asset bundle from the right-hand rail.
          </p>
        </article>

        <button
          type="button"
          class="inline-flex w-full items-center justify-between rounded-[1.1rem] border border-[#d7e0ed] bg-white px-4 py-3.5 text-left transition hover:bg-[#f8fbff]"
          @click="emit('openReview')"
        >
          <span class="flex items-center gap-3">
            <BookOpen class="h-4.5 w-4.5 text-[#4c4fdc]" />
            <span>
              <span class="block text-[0.96rem] font-semibold text-slate-900">Literature Mgmt</span>
              <span class="mt-1 block text-sm text-slate-500">Back to review queue and source papers</span>
            </span>
          </span>
          <ArrowUpRight class="h-4 w-4 text-slate-400" />
        </button>
      </div>
    </div>
  </aside>
</template>
