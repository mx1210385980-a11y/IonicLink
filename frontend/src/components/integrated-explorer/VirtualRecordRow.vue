<script setup lang="ts">
import ConditionMicrobar from '@/components/integrated-explorer/ConditionMicrobar.vue'
import LubricantRecipeCell from '@/components/integrated-explorer/LubricantRecipeCell.vue'
import TribopairCapsule from '@/components/integrated-explorer/TribopairCapsule.vue'
import type { RecordResponse } from '@/lib/api'
import {
  cofDisplay,
  compactRecordDisplayId,
  recordDisplayId,
} from '@/lib/integratedExplorerHelpers'

const props = defineProps<{
  record: RecordResponse
  style: Record<string, string>
  structurePreviewOpen: boolean
  structurePreviewRowId: number | null
}>()

const emit = defineEmits<{
  openEvidence: [record: RecordResponse]
  openStructure: [record: RecordResponse]
}>()

</script>

<template>
  <div
    class="virtual-record-row flex items-start border-b border-slate-100 transition-colors hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-900/70"
    :style="style"
  >
    <!-- ID Column -->
    <div class="w-[56px] shrink-0 self-center px-3 py-4 text-center">
      <span
        class="inline-flex h-6 min-w-9 items-center justify-center rounded-md border border-slate-200 bg-slate-50 px-1.5 text-[12px] font-bold leading-none text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400"
        :title="recordDisplayId(record)"
      >
        {{ compactRecordDisplayId(record) }}
      </span>
    </div>

    <!-- Ionic Liquid Column -->
    <div class="w-[280px] shrink-0 px-4 py-4">
      <div
        class="workspace-card cursor-pointer rounded-[9px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f7c82]/35"
        tabindex="0"
        aria-label="Open record workspace"
        title="Open evidence and editing workspace"
        @click.stop="emit('openEvidence', record)"
        @keydown.enter.prevent.stop="emit('openEvidence', record)"
      >
        <LubricantRecipeCell
          :record="record"
          :active="structurePreviewOpen && structurePreviewRowId === record.id"
          @open-structure="emit('openStructure', $event)"
        />
      </div>
    </div>

    <!-- Tribopair Column -->
    <div class="w-[240px] shrink-0 px-4 py-3">
      <div
        class="workspace-card cursor-pointer rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f7c82]/35"
        tabindex="0"
        aria-label="Open record workspace"
        title="Open evidence and editing workspace"
        @click.stop="emit('openEvidence', record)"
        @keydown.enter.prevent.stop="emit('openEvidence', record)"
      >
        <TribopairCapsule :record="record" />
      </div>
    </div>

    <!-- Conditions Column -->
    <div class="flex w-[304px] shrink-0 justify-center px-3 py-3">
      <div
        class="workspace-card block w-fit max-w-[296px] cursor-pointer rounded-[9px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f7c82]/35"
        tabindex="0"
        aria-label="Open record workspace"
        title="Open evidence and editing workspace"
        @click.stop="emit('openEvidence', record)"
        @keydown.enter.prevent.stop="emit('openEvidence', record)"
      >
        <ConditionMicrobar :record="record" />
      </div>
    </div>

    <!-- COF Column -->
    <div class="w-[126px] shrink-0 self-center px-4 py-4">
      <div
        class="workspace-card cursor-pointer rounded-lg px-1 py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f7c82]/35"
        tabindex="0"
        aria-label="Open record workspace"
        title="Open evidence and editing workspace"
        @click.stop="emit('openEvidence', record)"
        @keydown.enter.prevent.stop="emit('openEvidence', record)"
      >
        <div class="text-[clamp(1.05rem,0.95rem+0.28vw,1.28rem)] font-extrabold leading-none text-blue-600">{{ cofDisplay(record) }}</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.virtual-record-row {
  contain: layout style;
  box-sizing: border-box;
}

.ionic-liquid-name :deep(sub) {
  font-size: 0.72em;
}

.condition-chip {
  max-width: 100%;
}

.workspace-card {
  transition: transform 140ms ease, box-shadow 140ms ease, background-color 140ms ease;
}

.workspace-card:hover {
  transform: translateY(-1px);
}
</style>
