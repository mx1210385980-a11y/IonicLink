<script setup lang="ts">
import { Edit, Eye, Trash2 } from 'lucide-vue-next'

import MoleculeViewer from '@/components/MoleculeViewer.vue'
import type { EvidenceResult, RecordResponse } from '@/lib/api'
import {
  cofDisplay,
  conditionGroupClass,
  conditionGroups,
  confidenceDisplay,
  confidenceValueFor,
  formatIonicLiquidPartHtml,
  ionicLiquidParts,
  surfaceRoughnessBadge,
  surfaceRoughnessBadgeClass,
  tribopairParts,
} from '@/lib/integratedExplorerHelpers'

const props = defineProps<{
  record: RecordResponse
  style: Record<string, string>
  deletingRowId: number | null
  evidenceData: Record<number, EvidenceResult | null>
  structurePreviewOpen: boolean
  structurePreviewRowId: number | null
}>()

const emit = defineEmits<{
  openEvidence: [record: RecordResponse]
  openEdit: [record: RecordResponse]
  remove: [record: RecordResponse]
  openStructure: [record: RecordResponse]
}>()

function roughnessBadge(record: RecordResponse) {
  return surfaceRoughnessBadge(record)
}
</script>

<template>
  <div
    class="virtual-record-row flex items-start border-b border-slate-100 transition-colors hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-900/70"
    :style="style"
  >
    <!-- ID Column -->
    <div class="w-[60px] shrink-0 self-center px-4 py-4 text-slate-500 dark:text-slate-400">
      {{ record.id }}
    </div>

    <!-- Ionic Liquid Column -->
    <div class="w-[260px] shrink-0 px-4 py-4">
      <div class="flex items-start gap-2">
        <div v-if="record.cationSmiles || record.anionSmiles" class="shrink-0 flex gap-1 pt-0.5">
          <button
            v-if="record.cationSmiles"
            type="button"
            class="rounded-md transition hover:scale-[1.02]"
            :class="structurePreviewOpen && structurePreviewRowId === record.id ? 'ring-2 ring-blue-500 ring-offset-2 ring-offset-white dark:ring-offset-slate-950' : ''"
            title="Show chemical structures"
            @click.stop="emit('openStructure', record)"
          >
            <MoleculeViewer
              :smiles="record.cationSmiles"
              size="thumbnail"
              :width="40"
              :height="30"
            />
          </button>
          <button
            v-if="record.anionSmiles"
            type="button"
            class="rounded-md transition hover:scale-[1.02]"
            :class="structurePreviewOpen && structurePreviewRowId === record.id ? 'ring-2 ring-blue-500 ring-offset-2 ring-offset-white dark:ring-offset-slate-950' : ''"
            title="Show chemical structures"
            @click.stop="emit('openStructure', record)"
          >
            <MoleculeViewer
              :smiles="record.anionSmiles"
              size="thumbnail"
              :width="40"
              :height="30"
            />
          </button>
        </div>
        <div class="ionic-liquid-name min-w-0 flex-1 font-semibold leading-5 text-slate-800 dark:text-slate-100">
          <span
            v-for="(part, partIndex) in ionicLiquidParts(record.lubricant || '--')"
            :key="`${record.id}-il-${partIndex}-${part}`"
            class="block whitespace-normal break-words"
            v-html="formatIonicLiquidPartHtml(part)"
          />
        </div>
      </div>
    </div>

    <!-- Tribopair Column -->
    <div class="w-[240px] shrink-0 px-4 py-3">
      <div class="flex flex-col gap-1.5">
        <div
          class="inline-flex min-w-0 max-w-full items-center gap-2 rounded-md border border-slate-200 bg-white px-2 py-1 shadow-sm dark:border-slate-700 dark:bg-slate-950"
          :title="'Probe: ' + tribopairParts(record).probe"
        >
          <span class="shrink-0 text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">Probe</span>
          <span class="min-w-0 truncate text-[11.5px] font-semibold text-slate-700 dark:text-slate-200">
            {{ tribopairParts(record).probe }}
          </span>
        </div>
        <div
          class="inline-flex min-w-0 max-w-full items-center gap-2 rounded-md bg-slate-800 px-2 py-1 shadow-sm dark:bg-slate-100"
          :title="'Substrate: ' + tribopairParts(record).substrate"
        >
          <span class="shrink-0 text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">Sub</span>
          <span class="min-w-0 truncate text-[11.5px] font-semibold text-white dark:text-slate-900">
            {{ tribopairParts(record).substrate }}
          </span>
        </div>
        <div
          v-if="tribopairParts(record).coating"
          class="inline-flex min-w-0 max-w-full items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 shadow-sm dark:border-amber-500/30 dark:bg-amber-500/10"
          :title="'Coating: ' + tribopairParts(record).coating"
        >
          <span class="shrink-0 text-[10px] font-bold uppercase tracking-wider text-amber-600/70 dark:text-amber-500/70">Coat</span>
          <span class="min-w-0 truncate text-[11.5px] font-semibold text-amber-800 dark:text-amber-300">
            {{ tribopairParts(record).coating }}
          </span>
        </div>
      </div>
    </div>

    <!-- Conditions Column -->
    <div class="min-w-0 flex-1 px-4 py-3">
      <div class="flex flex-wrap items-center gap-1.5">
        <div
          v-for="group in conditionGroups(record)"
          :key="group.key"
          :title="group.title + ': ' + group.summary"
          class="condition-chip inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-md border px-2 py-1 text-[10.5px] font-semibold shadow-sm"
          :class="conditionGroupClass(group.key)"
        >
          <span class="shrink-0 tracking-[0.08em]">{{ group.label }}</span>
          <span class="min-w-0 truncate border-l border-current/20 pl-1.5 tracking-normal opacity-90">{{ group.summary }}</span>
        </div>
        <div
          v-if="roughnessBadge(record)"
          :title="'Surface Roughness: ' + roughnessBadge(record)?.label"
          class="condition-chip inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-md border px-2 py-1 text-[10.5px] font-semibold shadow-sm"
          :class="roughnessBadge(record) ? surfaceRoughnessBadgeClass(roughnessBadge(record)!.tone) : ''"
        >
          <span class="shrink-0 tracking-[0.08em]">ROUGH</span>
          <span class="min-w-0 truncate border-l border-current/20 pl-1.5 tracking-normal opacity-90">{{ roughnessBadge(record)?.label }}</span>
        </div>
      </div>
    </div>

    <!-- COF Column -->
    <div class="w-[100px] shrink-0 self-center px-4 py-4">
      <div class="font-bold text-blue-600">{{ cofDisplay(record) }}</div>
      <div class="mt-0.5 text-[11px] text-slate-400 dark:text-slate-500">
        Conf: {{ confidenceDisplay(confidenceValueFor(record, evidenceData[record.id])) }}
      </div>
    </div>

    <!-- Actions Column -->
    <div class="w-[120px] shrink-0 self-center px-4 py-4">
      <div class="flex items-center justify-end gap-1.5" @click.stop>
        <button
          type="button"
          class="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-blue-200 bg-blue-50 text-blue-600 transition hover:border-blue-300 hover:bg-blue-100 dark:border-blue-500/20 dark:bg-blue-500/10 dark:text-blue-300 dark:hover:bg-blue-500/15"
          title="Open evidence workspace"
          @click="emit('openEvidence', record)"
        >
          <Eye class="h-4 w-4" />
        </button>
        <button
          type="button"
          class="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition hover:border-slate-300 hover:bg-slate-100 hover:text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
          title="Edit extracted parameters"
          @click="emit('openEdit', record)"
        >
          <Edit class="h-4 w-4" />
        </button>
        <button
          type="button"
          class="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-red-200 bg-red-50 text-red-500 transition hover:border-red-300 hover:bg-red-100 hover:text-red-600 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300 dark:hover:bg-red-500/15"
          :disabled="deletingRowId === record.id"
          title="Delete record"
          @click="emit('remove', record)"
        >
          <Trash2 class="h-4 w-4" />
        </button>
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
</style>
